import { describe, expect, test } from "bun:test";
import {
  authenticateRivetRequest,
  FixedWindowRateLimiter,
  getConnectionSessionToken,
  issueDemoSession,
  isExplicitLocalDevelopment,
  requestBodyExceedsLimit,
  verifyDemoSession,
} from "./security";

describe("demo session security", () => {
  test("allows the development fallback only with an explicit local flag", () => {
    expect(
      isExplicitLocalDevelopment({
        NODE_ENV: "development",
        RIVET_DEMO_ALLOW_INSECURE_LOCAL: "1",
      }),
    ).toBe(true);
    expect(
      isExplicitLocalDevelopment({
        NODE_ENV: "preview",
        RIVET_DEMO_ALLOW_INSECURE_LOCAL: "1",
      }),
    ).toBe(false);
    expect(
      isExplicitLocalDevelopment({
        NODE_ENV: "development",
        VERCEL: "1",
        RIVET_DEMO_ALLOW_INSECURE_LOCAL: "1",
      }),
    ).toBe(false);
  });

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
    // Fetch rejects GET bodies, but a proxy can forward one. Use a real body
    // stream and model the forwarded method after constructing the request.
    const request = new Request("https://demo.test/api/rivet/metadata", {
      method: "POST",
      body: "x".repeat(16 * 1024 + 1),
    });
    Object.defineProperty(request, "method", { value: "GET" });

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

  test("does not evict an active session bucket when full", () => {
    const limiter = new FixedWindowRateLimiter(1, 1_000, 1);

    expect(limiter.consume("first", 0).allowed).toBe(true);
    expect(limiter.consume("second", 1)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("first", 2)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("first", 1_000).allowed).toBe(true);
  });
});
