import { describe, expect, test } from "bun:test";
import { UserError } from "rivetkit";
import { counter, scheduleCounterConnectionExpiry } from "./counter";
import {
  ACTION_WINDOW_MS,
  MAX_ACTIONS_PER_WINDOW,
  assertCounterConnectionActive,
  authenticateCounterConnection,
  applyIncrement,
  parseIncrement,
  type CounterState,
} from "./counter-policy";
import { issueDemoSession } from "./security";

describe("counter policy", () => {
  test("binds actor access to the signed session key", () => {
    const session = issueDemoSession();

    expect(
      authenticateCounterConnection([session.id], {
        sessionToken: session.token,
      }),
    ).toEqual({ sessionId: session.id, expiresAt: session.expiresAt });
    expect(() =>
      authenticateCounterConnection(["another-session"], {
        sessionToken: session.token,
      }),
    ).toThrow("Unauthorized");
    expect(() => authenticateCounterConnection([session.id], {})).toThrow(
      "Unauthorized",
    );
  });

  test("rejects direct actor connections without a valid session", async () => {
    const session = issueDemoSession();
    const context = { key: [session.id] };
    const onBeforeConnect = counter.config.onBeforeConnect as unknown as Hook;
    if (!("createConnState" in counter.config)) {
      throw new Error("counter connection state hook is missing");
    }
    const createConnState = counter.config.createConnState as unknown as Hook;
    const connect = (params: unknown) =>
      Promise.resolve().then(() => onBeforeConnect(context, params));

    await expect(connect({})).rejects.toThrow("Unauthorized");
    await expect(
      connect({ sessionToken: `${session.token}x` }),
    ).rejects.toThrow("Unauthorized");
    await expect(
      connect({ sessionToken: session.token }),
    ).resolves.toBeUndefined();
    await expect(
      Promise.resolve().then(() =>
        createConnState(context, {
          sessionToken: session.token,
        }),
      ),
    ).resolves.toEqual({
      sessionId: session.id,
      expiresAt: session.expiresAt,
    });
  });

  test("rejects actions after an established session expires", () => {
    const now = Date.parse("2026-09-01T00:00:00Z");
    const active = {
      sessionId: "session",
      expiresAt: Math.floor(now / 1_000) + 60,
    };

    expect(() => assertCounterConnectionActive(active, now)).not.toThrow();
    expect(() =>
      assertCounterConnectionActive(active, now + 61 * 1_000),
    ).toThrow("Unauthorized");

    const actions = counter.config.actions;
    if (!actions || typeof actions.increment !== "function") {
      throw new Error("counter increment action is missing");
    }
    const increment = actions.increment as unknown as (
      context: {
        conn: { state: typeof active };
        state: CounterState;
        broadcast: () => void;
      },
      amount: unknown,
    ) => number;
    const context = {
      conn: {
        state: {
          ...active,
          expiresAt: Math.floor(Date.now() / 1_000) - 1,
        },
      },
      state: { count: 0, windowStartedAt: 0, actionsInWindow: 0 },
      broadcast: () => {},
    };
    expect(() => increment(context, 1)).toThrow("Unauthorized");
  });

  test("disconnects an established connection when its session expires", () => {
    let now = 1_000_000;
    let callback: (() => void) | undefined;
    let scheduledDelay = -1;
    let disconnectReason: string | undefined;
    const connection = {
      state: { sessionId: "session", expiresAt: 1_001 },
      disconnect: async (reason?: string) => {
        disconnectReason = reason;
      },
    };
    const schedule = (next: () => void, delay: number) => {
      callback = next;
      scheduledDelay = delay;
      return setTimeout(() => {}, 60_000);
    };

    const cancel = scheduleCounterConnectionExpiry(
      connection,
      () => now,
      schedule,
    );
    expect(scheduledDelay).toBe(1_000);

    now = 1_001_000;
    callback!();
    expect(disconnectReason).toBe("Demo session expired");
    cancel();
  });

  test("accepts only small positive safe integers", () => {
    expect(parseIncrement(1)).toBe(1);
    expect(parseIncrement(10)).toBe(10);
    for (const value of [0, -1, 11, 1.5, Number.NaN, Infinity, "1"]) {
      expect(() => parseIncrement(value)).toThrow(UserError);
    }
  });

  test("enforces a durable per-session rate limit and count bound", () => {
    const state: CounterState = {
      count: 0,
      windowStartedAt: 1_000,
      actionsInWindow: 0,
    };

    expect(applyIncrement(state, 3, 1_001)).toBe(3);
    expect(state.actionsInWindow).toBe(1);
    for (let i = 1; i < MAX_ACTIONS_PER_WINDOW; i += 1) {
      applyIncrement(state, 1, 1_001);
    }
    expect(() => applyIncrement(state, 1, 1_001)).toThrow("Too many increments");
    expect(applyIncrement(state, 1, 1_000 + ACTION_WINDOW_MS)).toBe(
      MAX_ACTIONS_PER_WINDOW + 3,
    );
  });
});

type Hook = (
  context: { key: readonly string[] },
  params: unknown,
) => unknown;
