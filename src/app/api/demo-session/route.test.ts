import { describe, expect, test } from "bun:test";
import { GET } from "./route";
import { createDemoSessionHandler } from "./handler";
import {
  FixedWindowRateLimiter,
  SESSION_COOKIE_NAME,
  verifyDemoSession,
} from "@/rivet/security";

describe("demo session route", () => {
  test("creates a session cookie and reuses it", async () => {
    const first = GET(new Request("https://demo.test/api/demo-session"));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    const cookie = first.headers.get("set-cookie");

    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(verifyDemoSession(firstBody.sessionToken)).toMatchObject({
      id: firstBody.sessionId,
    });

    const second = GET(
      new Request("https://demo.test/api/demo-session", {
        headers: { cookie: cookie?.split(";")[0] ?? "" },
      }),
    );
    expect((await second.json()).sessionToken).toBe(firstBody.sessionToken);
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  test("limits new sessions from the same requester", () => {
    const GET = createDemoSessionHandler({
      issuerLimiter: new FixedWindowRateLimiter(1, 60_000, 10),
      globalLimiter: new FixedWindowRateLimiter(10, 60_000, 1),
      trustProxyHeaders: true,
    });

    expect(GET(sessionRequest("203.0.113.1")).status).toBe(200);
    const rejected = GET(sessionRequest("203.0.113.1"));
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("60");
    expect(GET(sessionRequest("203.0.113.2")).status).toBe(200);
  });

  test("applies a global fallback across requester identities", () => {
    const GET = createDemoSessionHandler({
      issuerLimiter: new FixedWindowRateLimiter(10, 60_000, 10),
      globalLimiter: new FixedWindowRateLimiter(1, 60_000, 1),
      trustProxyHeaders: true,
    });

    expect(GET(sessionRequest("203.0.113.1")).status).toBe(200);
    expect(GET(sessionRequest("203.0.113.2")).status).toBe(429);
  });

  test("does not trust client forwarding headers outside a trusted proxy", () => {
    const GET = createDemoSessionHandler({
      issuerLimiter: new FixedWindowRateLimiter(1, 60_000, 10),
      globalLimiter: new FixedWindowRateLimiter(10, 60_000, 1),
      trustProxyHeaders: false,
    });

    expect(GET(sessionRequest("203.0.113.1")).status).toBe(200);
    expect(GET(sessionRequest("203.0.113.2")).status).toBe(429);
  });
});

function sessionRequest(ip: string) {
  return new Request("https://demo.test/api/demo-session", {
    headers: { "x-vercel-forwarded-for": ip },
  });
}
