import { actor } from "rivetkit";
import {
  assertCounterConnectionActive,
  authenticateCounterConnection,
  applyIncrement,
  type CounterConnectionParams,
  type CounterConnectionState,
  type CounterState,
} from "./counter-policy";

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
  actions: {
    increment: (c, amount: unknown) => {
      assertCounterConnectionActive(c.conn.state);
      const count = applyIncrement(c.state, amount);
      c.broadcast("newCount", count);
      return count;
    },
  },
});
