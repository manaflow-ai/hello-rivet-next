import { describe, expect, test } from "bun:test";
import { guardRivetRequest } from "./request-guard";
import { FixedWindowRateLimiter, issueDemoSession } from "./security";

describe("Rivet request guard", () => {
  test("rejects anonymous actor requests", async () => {
    let called = false;
    const response = await guardRivetRequest(
      new Request("https://demo.test/api/rivet/actors"),
      ["actors"],
      () => {
        called = true;
        return new Response("unexpected", { status: 200 });
      },
    );

    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  test("rejects oversized bodies before the handler", async () => {
    const session = issueDemoSession();
    const response = await guardRivetRequest(
      new Request("https://demo.test/api/rivet/actors", {
        method: "POST",
        headers: { cookie: `rivet_demo_session=${session.token}` },
        body: "x".repeat(16 * 1024 + 1),
      }),
      ["actors"],
      () => new Response("unexpected", { status: 200 }),
    );

    expect(response.status).toBe(413);
  });

  test("allows only the current session counter actor", async () => {
    const session = issueDemoSession();
    const request = new Request(
      `https://demo.test/api/rivet/actors?name=counter&key=${session.id}`,
      { headers: { cookie: `rivet_demo_session=${session.token}` } },
    );
    const response = await guardRivetRequest(
      request,
      ["actors"],
      () => new Response("ok", { status: 200 }),
    );
    expect(response.status).toBe(200);

    const denied = await guardRivetRequest(
      new Request(
        `https://demo.test/api/rivet/actors?name=counter&key=other-session`,
        { headers: { cookie: `rivet_demo_session=${session.token}` } },
      ),
      ["actors"],
      () => new Response("unexpected", { status: 200 }),
    );
    expect(denied.status).toBe(403);
  });

  test("accepts only Rivet's serialized session actor key", async () => {
    const session = issueDemoSession();
    const request = (key: unknown) =>
      new Request("https://demo.test/api/rivet/actors", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: `rivet_demo_session=${session.token}`,
        },
        body: JSON.stringify({ name: "counter", key }),
      });
    const next = () => new Response("ok", { status: 200 });

    expect(
      (await guardRivetRequest(request(session.id), ["actors"], next))
        .status,
    ).toBe(200);
    expect(
      (await guardRivetRequest(request([session.id]), ["actors"], next))
        .status,
    ).toBe(403);
  });

  test("returns 429 when a session exceeds the request budget", async () => {
    const session = issueDemoSession();
    const limiter = new FixedWindowRateLimiter(1, 60_000, 4);
    const request = new Request("https://demo.test/api/rivet/connect", {
      headers: { cookie: `rivet_demo_session=${session.token}` },
    });
    const next = () => new Response("ok", { status: 200 });

    expect(
      (await guardRivetRequest(request, ["connect"], next, { limiter }))
        .status,
    ).toBe(200);
    expect(
      (await guardRivetRequest(request, ["connect"], next, { limiter }))
        .status,
    ).toBe(429);
  });

  test("authenticates the Rivet control-plane start request", async () => {
    const next = () => new Response("ok", { status: 200 });
    const request = (method: string, token?: string) =>
      new Request("https://demo.test/api/rivet/start", {
        method,
        headers: token ? { "x-rivet-token": token } : undefined,
      });

    for (const method of ["GET", "POST", "PUT", "PATCH"]) {
      expect(
        (
          await guardRivetRequest(request(method), ["start"], next, {
            requireStartToken: true,
          })
        ).status,
      ).toBe(503);
      expect(
        (
          await guardRivetRequest(request(method, "wrong"), ["start"], next, {
            expectedStartToken: "expected",
            requireStartToken: true,
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await guardRivetRequest(request(method, "expected"), ["start"], next, {
            expectedStartToken: "expected",
            requireStartToken: true,
          })
        ).status,
      ).toBe(200);
    }
  });
});
