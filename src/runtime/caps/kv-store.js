// app:caps/kv-store — host implementation, delegating to the bound journal.
import { current } from "./context.js";

export function insert(store, fields) {
  return current.kvStore.insert(store, fields);
}

export function query(store, field, op, value) {
  return current.kvStore.query(store, field, op, value);
}

export function update(store, field, op, value, fields) {
  return current.kvStore.update(store, field, op, value, fields);
}

function delete_(store, field, op, value) {
  return current.kvStore.delete(store, field, op, value);
}
export { delete_ as delete };
