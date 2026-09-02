import {
  authenticateRivetRequest,
  getConnectionSessionToken,
  requestBodyExceedsLimit,
  rivetRequestLimiter,
  timingSafeStringEqual,
  type DemoSession,
  type FixedWindowRateLimiter,
  MAX_RIVET_REQUEST_BYTES,
} from "./security";

export type RivetHandler = () => Response | Promise<Response>;

export interface RivetGuardOptions {
  expectedStartToken?: string;
  limiter?: FixedWindowRateLimiter;
  requireStartToken?: boolean;
}

export async function guardRivetRequest(
  request: Request,
  pathSegments: readonly string[],
  next: RivetHandler,
  options: RivetGuardOptions = {},
): Promise<Response> {
  if (await requestBodyExceedsLimit(request, MAX_RIVET_REQUEST_BYTES)) {
    return jsonError(
      "Request body exceeds the 16 KiB demo limit.",
      413,
    );
  }

  const path = normalizePath(pathSegments);
  if (path === "/start" && request.method === "GET") {
    return guardStartRequest(request, next, options);
  }
  if (isPublicControlPath(path, request.method)) return next();

  let session: DemoSession | null;
  try {
    session = authenticateRivetRequest(request);
  } catch {
    return jsonError("Demo authentication is not configured.", 503);
  }

  if (!session) {
    return jsonError("A valid demo session is required.", 401, {
      "WWW-Authenticate": "Session",
    });
  }

  const rateLimit = (options.limiter ?? rivetRequestLimiter).consume(
    session.id,
  );
  if (!rateLimit.allowed) {
    return jsonError("Too many requests. Try again later.", 429, {
      "Retry-After": String(rateLimit.retryAfterSeconds),
    });
  }

  const policyError = await validateRoutePolicy(request, path, session);
  if (policyError) return policyError;

  return next();
}

function normalizePath(pathSegments: readonly string[]): string {
  if (pathSegments.length === 0) return "/";
  return `/${pathSegments.join("/")}`;
}

function isPublicControlPath(path: string, method: string): boolean {
  if (method === "OPTIONS") return true;
  if (path === "/") return method === "GET" || method === "HEAD";
  return (
    (path === "/health" || path === "/metadata") &&
    (method === "GET" || method === "HEAD")
  );
}

function guardStartRequest(
  request: Request,
  next: RivetHandler,
  options: RivetGuardOptions,
): Response | Promise<Response> {
  const expected = options.expectedStartToken;
  if (!expected) {
    return options.requireStartToken
      ? jsonError("Rivet control-plane authentication is not configured.", 503)
      : next();
  }

  const provided = request.headers.get("x-rivet-token");
  return provided && timingSafeStringEqual(provided, expected)
    ? next()
    : jsonError("A valid Rivet control-plane token is required.", 401, {
        "WWW-Authenticate": "Bearer",
      });
}

async function validateRoutePolicy(
  request: Request,
  path: string,
  session: DemoSession,
): Promise<Response | null> {
  if (path === "/actors") {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const name = url.searchParams.get("name");
      const key = url.searchParams.get("key");
      return name === "counter" && key === session.id
        ? null
        : jsonError("Only the current counter actor is available.", 403);
    }

    if (request.method === "PUT" || request.method === "POST") {
      const body = await parseJsonBody(request);
      return isCurrentCounterRequest(body, session.id)
        ? null
        : jsonError("Only the current counter actor is available.", 403);
    }

    return jsonError("This manager operation is not available.", 405, {
      Allow: "GET, PUT, POST",
    });
  }

  if (path === "/actors/names" || path.startsWith("/actors/")) {
    return jsonError("Actor enumeration is not available.", 403);
  }

  if (path.startsWith("/.test/")) {
    return jsonError("Test routes are not available.", 404);
  }

  if (path.startsWith("/gateway/") && !getConnectionSessionToken(request)) {
    return jsonError("A Rivet connection session is required.", 401, {
      "WWW-Authenticate": "Session",
    });
  }

  return null;
}

function isCurrentCounterRequest(body: unknown, sessionId: string): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const record = body as Record<string, unknown>;

  // Rivet's manager API serializes the client key `[sessionId]` as this
  // single string before it sends the PUT or POST body.
  return record.name === "counter" && record.key === sessionId;
}

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

function jsonError(
  message: string,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      },
    },
  );
}
