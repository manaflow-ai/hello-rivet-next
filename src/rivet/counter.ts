import { actor } from "rivetkit";
import {
  assertCounterConnectionActive,
  authenticateCounterConnection,
  applyIncrement,
  type CounterConnectionParams,
  type CounterConnectionState,
  type CounterState,
} from "./counter-policy";

type CounterConnection = {
  state: CounterConnectionState;
  disconnect: (reason?: string) => Promise<void>;
};
type TimerScheduler = (
  callback: () => void,
  delay: number,
) => ReturnType<typeof setTimeout>;

const connectionExpiryCancellations = new WeakMap<
  CounterConnection,
  () => void
>();

export const counter = actor({
  state: {
    count: 0,
    windowStartedAt: 0,
    actionsInWindow: 0,
  } satisfies CounterState,
  onBeforeConnect: (c, params: CounterConnectionParams) => {
    authenticateCounterConnection(c.key, params);
  },
  createConnState: (
    c,
    params: CounterConnectionParams,
  ): CounterConnectionState => authenticateCounterConnection(c.key, params),
  onConnect: (c) => {
    connectionExpiryCancellations.get(c.conn)?.();
    connectionExpiryCancellations.set(
      c.conn,
      scheduleCounterConnectionExpiry(c.conn),
    );
  },
  onDisconnect: (_c, conn) => {
    connectionExpiryCancellations.get(conn)?.();
    connectionExpiryCancellations.delete(conn);
  },
  actions: {
    increment: (c, amount: unknown) => {
      assertCounterConnectionActive(c.conn.state);
      const count = applyIncrement(c.state, amount);
      c.broadcast("newCount", count);
      return count;
    },
  },
});

export function scheduleCounterConnectionExpiry(
  connection: CounterConnection,
  now: () => number = Date.now,
  schedule: TimerScheduler = setTimeout,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleNext = () => {
    if (cancelled) return;
    const delay = Math.max(
      0,
      connection.state.expiresAt * 1_000 - now(),
    );
    timer = schedule(() => {
      if (cancelled) return;
      if (connection.state.expiresAt <= Math.floor(now() / 1_000)) {
        void connection.disconnect("Demo session expired");
      } else {
        scheduleNext();
      }
    }, delay);
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
