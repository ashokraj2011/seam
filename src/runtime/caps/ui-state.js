// app:caps/ui-state — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function set(path, value) {
  current.uiState.set(path, value);
}
