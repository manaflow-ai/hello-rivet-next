import { UserError } from "rivetkit";
import { verifyDemoSession } from "./security";

export const MAX_INCREMENT = 10;
export const MAX_COUNT = 1_000_000;
export const ACTION_WINDOW_MS = 60_000;
export const MAX_ACTIONS_PER_WINDOW = 30;

export interface CounterState {
  count: number;
  windowStartedAt: number;
  actionsInWindow: number;
}

export interface CounterConnectionParams {
  sessionToken: string;
}

export interface CounterConnectionState {
  sessionId: string;
}

export function authenticateCounterConnection(
  actorKey: readonly string[],
  params: unknown,
): CounterConnectionState {
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    typeof (params as Record<string, unknown>).sessionToken !== "string"
  ) {
    throw unauthorized();
  }

  const token = (params as CounterConnectionParams).sessionToken;
  let session;
  try {
    session = verifyDemoSession(token);
  } catch {
    session = null;
  }

  if (!session || actorKey.length !== 1 || actorKey[0] !== session.id) {
    throw unauthorized();
  }

  return { sessionId: session.id };
}

export function applyIncrement(
  state: CounterState,
  rawAmount: unknown,
  now = Date.now(),
): number {
  const amount = parseIncrement(rawAmount);
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("invalid clock value");
  }

  const windowExpired =
    now < state.windowStartedAt ||
    now - state.windowStartedAt >= ACTION_WINDOW_MS;
  if (windowExpired || !Number.isSafeInteger(state.windowStartedAt)) {
    state.windowStartedAt = now;
    state.actionsInWindow = 0;
  }

  if (
    !Number.isSafeInteger(state.actionsInWindow) ||
    state.actionsInWindow < 0
  ) {
    state.actionsInWindow = 0;
  }

  if (state.actionsInWindow >= MAX_ACTIONS_PER_WINDOW) {
    throw new UserError("Too many increments. Try again in a minute.", {
      code: "rate_limited",
    });
  }

  if (
    !Number.isSafeInteger(state.count) ||
    state.count < 0 ||
    state.count > MAX_COUNT - amount
  ) {
    throw new UserError("The counter limit has been reached.", {
      code: "counter_limit",
    });
  }

  state.count += amount;
  state.actionsInWindow += 1;
  return state.count;
}

export function parseIncrement(rawAmount: unknown): number {
  if (
    typeof rawAmount !== "number" ||
    !Number.isSafeInteger(rawAmount) ||
    rawAmount < 1 ||
    rawAmount > MAX_INCREMENT
  ) {
    throw new UserError(
      `Increment must be an integer from 1 to ${MAX_INCREMENT}.`,
      { code: "invalid_increment" },
    );
  }

  return rawAmount;
}

function unauthorized(): UserError {
  return new UserError("Unauthorized", { code: "unauthorized" });
}
