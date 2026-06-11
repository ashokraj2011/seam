// app:caps/clock — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function nowMs() {
  return current.clock.nowMs();
}
