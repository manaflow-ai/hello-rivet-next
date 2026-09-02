import { describe, expect, test } from "bun:test";
import {
  authenticateRivetRequest,
  FixedWindowRateLimiter,
  getConnectionSessionToken,
  issueDemoSession,
  requestBodyExceedsLimit,
  verifyDemoSession,
} from "./security";

describe("demo session security", () => {
  test("issues a signed session and rejects tampering or expiry", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    const session = issueDemoSession(now);

    expect(verifyDemoSession(session.token, now)).toMatchObject({
      id: session.id,
      token: session.token,
    });
    expect(verifyDemoSession(`${session.token}x`, now)).toBeNull();
    expect(
      verifyDemoSession(session.token, now + 24 * 60 * 60 * 1_000),
    ).toBeNull();
  });

  test("requires matching cookie and connection credentials", () => {
    const first = issueDemoSession();
    const second = issueDemoSession();
    const request = (cookie: string, params?: string) =>
      new Request("https://demo.test/api/rivet/gateway/actor/connect", {
        headers: {
          cookie,
          ...(params ? { "x-rivet-conn-params": params } : {}),
        },
      });

    expect(
      authenticateRivetRequest(
        request(`rivet_demo_session=${first.token}`, JSON.stringify({ sessionToken: first.token })),
      ),
    ).toMatchObject({ id: first.id });
    expect(
      authenticateRivetRequest(
        request(`rivet_demo_session=${first.token}`, JSON.stringify({ sessionToken: second.token })),
      ),
    ).toBeNull();
    expect(
      authenticateRivetRequest(
        request("", JSON.stringify({ sessionToken: first.token })),
      ),
    ).toMatchObject({ id: first.id });
    expect(getConnectionSessionToken(request("", "not-json"))).toBeNull();
  });

  test("stops oversized request bodies before Rivet parses them", async () => {
    const small = new Request("https://demo.test/api/rivet/actors", {
      method: "POST",
      body: "x".repeat(32),
    });
    const large = new Request("https://demo.test/api/rivet/actors", {
      method: "POST",
      body: "x".repeat(16 * 1024 + 1),
    });

    expect(await requestBodyExceedsLimit(small)).toBe(false);
    expect(await requestBodyExceedsLimit(large)).toBe(true);
  });

  test("stops oversized GET bodies without a content length", async () => {
    const request = new Request("https://demo.test/api/rivet/metadata", {
      method: "GET",
      body: "x".repeat(16 * 1024 + 1),
    });

    expect(request.headers.get("content-length")).toBeNull();
    expect(await requestBodyExceedsLimit(request)).toBe(true);
  });

  test("keeps the request limiter bounded and returns a retry window", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000, 1);

    expect(limiter.consume("session", 0).allowed).toBe(true);
    expect(limiter.consume("session", 1).allowed).toBe(true);
    expect(limiter.consume("session", 2)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("session", 1_001).allowed).toBe(true);
  });
});
