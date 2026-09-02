export interface DemoSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: number;
}

export type DemoSessionLoader = () => Promise<DemoSession>;
export type Clock = () => number;

const SESSION_REFRESH_DELAY_MS = 1_000;

/**
 * Shares one session request while replacing the cached session after expiry.
 * The cache is intentionally client-side only. The server remains the source
 * of truth for session validity.
 */
export class DemoSessionCache {
  private cached: DemoSession | undefined;
  private inFlight: Promise<DemoSession> | undefined;

  constructor(
    private readonly load: DemoSessionLoader,
    private readonly now: Clock = Date.now,
  ) {}

  get(): Promise<DemoSession> {
    if (this.cached && this.cached.expiresAt * 1_000 > this.now()) {
      return Promise.resolve(this.cached);
    }
    if (this.inFlight) return this.inFlight;

    const request = this.load().then((session) => {
      this.cached = session;
      return session;
    });
    this.inFlight = request;
    void request.then(
      () => this.clear(request),
      () => this.clear(request),
    );
    return request;
  }

  private clear(request: Promise<DemoSession>) {
    if (this.inFlight === request) this.inFlight = undefined;
  }
}

export function sessionRefreshDelay(
  session: DemoSession,
  now = Date.now(),
): number {
  return Math.max(
    SESSION_REFRESH_DELAY_MS,
    session.expiresAt * 1_000 - now + SESSION_REFRESH_DELAY_MS,
  );
}

export async function loadDemoSession(): Promise<DemoSession> {
  const response = await fetch("/api/demo-session", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("demo session request failed");

  const value: unknown = await response.json();
  if (!isDemoSession(value)) throw new Error("invalid demo session response");
  return value;
}

export function isDemoSession(value: unknown, now = Date.now()): value is DemoSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sessionId === "string" &&
    typeof record.sessionToken === "string" &&
    typeof record.expiresAt === "number" &&
    Number.isSafeInteger(record.expiresAt) &&
    record.sessionId.length > 0 &&
    record.sessionToken.length > 0 &&
    record.expiresAt > Math.floor(now / 1_000)
  );
}
