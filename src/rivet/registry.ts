import { setup } from "rivetkit";
import { counter } from "./counter";

export { counter } from "./counter";

export const registry = setup({
    use: { counter },
    maxIncomingMessageSize: 16 * 1024,
    maxOutgoingMessageSize: 64 * 1024,
});
