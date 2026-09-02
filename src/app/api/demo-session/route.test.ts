import { describe, expect, test } from "bun:test";
import { GET } from "./route";
import { SESSION_COOKIE_NAME, verifyDemoSession } from "@/rivet/security";

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
});
