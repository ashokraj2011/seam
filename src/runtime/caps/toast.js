// app:caps/toast — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function show(message) {
  current.toast.show(message);
}
