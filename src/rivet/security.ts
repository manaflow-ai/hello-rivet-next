import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";

export const SESSION_COOKIE_NAME = "rivet_demo_session";
export const SESSION_TOKEN_PARAM = "sessionToken";
export const SESSION_TTL_SECONDS = 24 * 60 * 60;
export const MAX_RIVET_REQUEST_BYTES = 16 * 1024;

export const RIVET_REQUEST_LIMIT = {
  maxRequests: 120,
  windowMs: 60_000,
  maxEntries: 2_048,
} as const;

export const DEMO_SESSION_ISSUER_LIMIT = {
  maxRequests: 10,
  windowMs: 60_000,
  maxEntries: 2_048,
} as const;

export const DEMO_SESSION_GLOBAL_LIMIT = {
  maxRequests: 100,
  windowMs: 60_000,
  maxEntries: 1,
} as const;

const SESSION_ID_BYTES = 18;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SESSION_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_CLOCK_SKEW_SECONDS = 60;
const TOKEN_VERSION = "v1";
const DEVELOPMENT_SECRET =
  "hello-rivet-next-development-secret-do-not-use-in-production";

export interface DemoSession {
  id: string;
  token: string;
  expiresAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * A bounded fixed-window limiter for the demo endpoint.
 *
 * The actor also enforces a durable action limit. This limiter protects the
 * Next.js request boundary from connection and actor-lookup floods within one
 * server process.
 */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<
    string,
    { startedAt: number; count: number }
  >();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxEntries: number,
  ) {}

  consume(key: string, now = Date.now()): RateLimitResult {
    const existing = this.entries.get(key);
    const expired =
      existing &&
      (now < existing.startedAt || now - existing.startedAt >= this.windowMs);

    if (!existing || expired) {
      this.evictIfNeeded();
      this.entries.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.maxRequests) {
      const elapsed = Math.max(0, now - existing.startedAt);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.windowMs - elapsed) / 1_000),
        ),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private evictIfNeeded() {
    if (this.entries.size < this.maxEntries) return;
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) this.entries.delete(oldest);
  }
}

export const rivetRequestLimiter = new FixedWindowRateLimiter(
  RIVET_REQUEST_LIMIT.maxRequests,
  RIVET_REQUEST_LIMIT.windowMs,
  RIVET_REQUEST_LIMIT.maxEntries,
);

export const demoSessionIssuerLimiter = new FixedWindowRateLimiter(
  DEMO_SESSION_ISSUER_LIMIT.maxRequests,
  DEMO_SESSION_ISSUER_LIMIT.windowMs,
  DEMO_SESSION_ISSUER_LIMIT.maxEntries,
);

export const demoSessionGlobalLimiter = new FixedWindowRateLimiter(
  DEMO_SESSION_GLOBAL_LIMIT.maxRequests,
  DEMO_SESSION_GLOBAL_LIMIT.windowMs,
  DEMO_SESSION_GLOBAL_LIMIT.maxEntries,
);

export interface DemoSessionIssueLimitOptions {
  issuerLimiter?: FixedWindowRateLimiter;
  globalLimiter?: FixedWindowRateLimiter;
  now?: number;
  trustProxyHeaders?: boolean;
}

/**
 * Limits anonymous session creation by requester and across this process.
 * Vercel overwrites its forwarded IP header. Other deployments share one
 * fail-closed requester bucket unless they add an equivalent trusted proxy.
 */
export function consumeDemoSessionIssueLimit(
  request: Request,
  options: DemoSessionIssueLimitOptions = {},
): RateLimitResult {
  const issuerLimiter = options.issuerLimiter ?? demoSessionIssuerLimiter;
  const globalLimiter = options.globalLimiter ?? demoSessionGlobalLimiter;
  const now = options.now ?? Date.now();
  const issuerKey = getDemoSessionIssuerKey(
    request,
    options.trustProxyHeaders ?? process.env.VERCEL === "1",
  );
  const issuerResult = issuerLimiter.consume(issuerKey, now);
  if (!issuerResult.allowed) return issuerResult;

  return globalLimiter.consume("all-issuers", now);
}

export function issueDemoSession(now = Date.now()): DemoSession {
  const issuedAt = Math.floor(now / 1_000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const id = randomBytes(SESSION_ID_BYTES).toString("base64url");
  const payload = `${TOKEN_VERSION}.${id}.${issuedAt}.${expiresAt}`;
  const token = `${payload}.${sign(payload)}`;

  return { id, token, expiresAt };
}

export function verifyDemoSession(
  token: unknown,
  now = Date.now(),
): DemoSession | null {
  if (typeof token !== "string" || token.length > 256) return null;

  const parts = token.split(".");
  if (parts.length !== 5) return null;

  const [version, id, issuedAtRaw, expiresAtRaw, signature] = parts;
  if (
    version !== TOKEN_VERSION ||
    !SESSION_ID_PATTERN.test(id) ||
    !/^\d+$/.test(issuedAtRaw) ||
    !/^\d+$/.test(expiresAtRaw) ||
    !SESSION_SIGNATURE_PATTERN.test(signature)
  ) {
    return null;
  }

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  const nowSeconds = Math.floor(now / 1_000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt - issuedAt !== SESSION_TTL_SECONDS ||
    issuedAt > nowSeconds + SESSION_CLOCK_SKEW_SECONDS ||
    expiresAt <= nowSeconds
  ) {
    return null;
  }

  const payload = `${version}.${id}.${issuedAtRaw}.${expiresAtRaw}`;
  if (!timingSafeStringEqual(signature, sign(payload))) return null;

  return { id, token, expiresAt };
}

export function getSessionCookieToken(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name === SESSION_COOKIE_NAME) {
      return item.slice(separator + 1).trim() || undefined;
    }
  }

  return undefined;
}

/**
 * Reads the connection token from Rivet's HTTP or WebSocket transport.
 * `undefined` means the header is absent. `null` means it is present but
 * malformed and must be rejected.
 */
export function getConnectionSessionToken(
  request: Request,
): string | null | undefined {
  const httpParams = request.headers.get("x-rivet-conn-params");
  if (httpParams !== null) return parseConnectionParams(httpParams);

  const protocols = request.headers.get("sec-websocket-protocol");
  if (!protocols) return undefined;

  const prefix = "rivet_conn_params.";
  for (const protocol of protocols.split(",")) {
    const value = protocol.trim();
    if (!value.startsWith(prefix)) continue;
    try {
      return parseConnectionParams(
        decodeURIComponent(value.slice(prefix.length)),
      );
    } catch {
      return null;
    }
  }

  return undefined;
}

/**
 * Authenticates a request using the signed session cookie or Rivet connection
 * parameters. If both are present, they must identify the same session.
 */
export function authenticateRivetRequest(
  request: Request,
): DemoSession | null {
  const cookieToken = getSessionCookieToken(request);
  const connectionToken = getConnectionSessionToken(request);
  if (connectionToken === null) return null;

  const cookieSession = cookieToken
    ? verifyDemoSession(cookieToken)
    : null;
  const connectionSession = connectionToken
    ? verifyDemoSession(connectionToken)
    : null;

  if (connectionToken && !connectionSession) return null;
  if (cookieToken && !cookieSession && !connectionSession) return null;
  if (
    cookieSession &&
    connectionSession &&
    !timingSafeStringEqual(cookieSession.token, connectionSession.token)
  ) {
    return null;
  }

  return connectionSession ?? cookieSession;
}

export async function requestBodyExceedsLimit(
  request: Request,
  limit = MAX_RIVET_REQUEST_BYTES,
): Promise<boolean> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return true;
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength > limit) {
      return true;
    }
  }

  if (!request.body) return false;

  try {
    const reader = request.clone().body?.getReader();
    if (!reader) return false;

    let total = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return false;
      total += chunk.value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return true;
      }
    }
  } catch {
    // An unreadable body is not safe to forward to the Rivet parser.
    return true;
  }
}

export function sessionCookieOptions(session: DemoSession) {
  return {
    name: SESSION_COOKIE_NAME,
    value: session.token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.max(1, session.expiresAt - Math.floor(Date.now() / 1_000)),
  };
}

function parseConnectionParams(raw: string): string | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const token = (parsed as Record<string, unknown>)[SESSION_TOKEN_PARAM];
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

function getSessionSecret(): string {
  const configured = process.env.RIVET_DEMO_SESSION_SECRET?.trim();
  if (configured) {
    if (configured.length < 32) {
      throw new Error(
        "RIVET_DEMO_SESSION_SECRET must contain at least 32 characters",
      );
    }
    return configured;
  }

  if (process.env.NODE_ENV !== "production") return DEVELOPMENT_SECRET;

  throw new Error(
    "RIVET_DEMO_SESSION_SECRET is required in production; generate one with `openssl rand -base64 32`",
  );
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function getDemoSessionIssuerKey(
  request: Request,
  trustProxyHeaders: boolean,
): string {
  if (!trustProxyHeaders) return "untrusted-proxy";

  const forwardedFor =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",", 1)[0]?.trim();
  if (!clientIp || !isIP(clientIp)) return "unknown-requester";

  return `requester.${sign(`requester.${clientIp}`)}`;
}
