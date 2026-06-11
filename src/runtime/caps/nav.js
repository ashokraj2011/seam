// app:caps/nav — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function go(route) {
  current.nav.go(route);
}
