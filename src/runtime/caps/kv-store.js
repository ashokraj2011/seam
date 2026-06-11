// app:caps/kv-store — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function insert(store, fields) {
  return current.kvStore.insert(store, fields);
}

export function query(store, filter) {
  return current.kvStore.query(store, filter);
}
