import { describe, expect, test } from "bun:test";
import {
  DemoSessionCache,
  isDemoSession,
  sessionRefreshDelay,
  type DemoSession,
} from "./demo-session";

function makeSession(id: string, expiresAt: number): DemoSession {
  return {
    sessionId: id,
    sessionToken: `${id}-token`,
    expiresAt,
  };
}

describe("demo session cache", () => {
  test("replaces the cached session after its expiry", async () => {
    let now = 1_000_000;
    const first = makeSession("first", Math.floor(now / 1_000) + 10);
    const second = makeSession("second", Math.floor(now / 1_000) + 20);
    const responses = [first, second];
    let loads = 0;
    const cache = new DemoSessionCache(
      async () => {
        loads += 1;
        return responses.shift()!;
      },
      () => now,
    );

    expect(await cache.get()).toBe(first);
    expect(await cache.get()).toBe(first);
    expect(loads).toBe(1);

    now = first.expiresAt * 1_000;
    expect(await cache.get()).toBe(second);
    expect(loads).toBe(2);
  });

  test("shares an in-flight load and retries after a rejected load", async () => {
    let rejectLoad: ((error: Error) => void) | undefined;
    let loads = 0;
    const cache = new DemoSessionCache(() => {
      loads += 1;
      if (loads === 1) {
        return new Promise<DemoSession>((_, reject) => {
          rejectLoad = reject;
        });
      }
      return Promise.resolve(makeSession("retry", 2_000));
    });

    const first = cache.get();
    expect(cache.get()).toBe(first);
    rejectLoad!(new Error("temporary failure"));
    await expect(first).rejects.toThrow("temporary failure");
    expect((await cache.get()).sessionId).toBe("retry");
    expect(loads).toBe(2);
  });
});

describe("demo session response", () => {
  test("requires a future expiry and schedules refresh after it", () => {
    const now = 1_000_000;
    const session = makeSession("valid", 1_010);

    expect(isDemoSession(session, now)).toBe(true);
    expect(isDemoSession({ ...session, expiresAt: 1_000 }, now)).toBe(false);
    expect(sessionRefreshDelay(session, now)).toBe(11_000);
    expect(sessionRefreshDelay(session, 1_010_000)).toBe(1_000);
  });
});
