import type { Row, Value } from "../kernel/types";
import type { CapTrace, Outcome } from "./interpret";
import type { StateWrite } from "./state";
import { rowMatches } from "./filter";
import type { FilterOp } from "./filter";

// The component host (BUILD_SPEC.md §7): an import table plus an invoke
// call. The component's imports are exactly the contract's grants; this
// host satisfies them with the SAME journaled semantics the interpreter
// uses — writes stage in the journal, traces record every capability
// crossing, and nothing commits unless the invocation succeeds. That
// equivalence is what the drift corpus checks.

export interface HostCtx {
  readStore: (name: string) => Row[];
}

export interface CapImports {
  kvStore: {
    insert: (store: string, record: Array<[string, string]>) => void;
    query: (store: string, field: string, op: string, value: string) => string[];
    update: (store: string, field: string, op: string, value: string, fields: Array<[string, string]>) => void;
    delete: (store: string, field: string, op: string, value: string) => void;
  };
  toast: { show: (message: string) => void };
  clock: { nowMs: () => bigint };
  nav: { go: (route: string) => void };
  uiState: { set: (path: string, value: string) => void };
}

export interface HostJournal {
  imports: CapImports;
  finish: (result: Outcome["result"]) => Outcome;
}

// Build one invocation's import table + journal. The transpiled component
// calls these synchronously during invoke(); finish() turns the journal
// into the standard Outcome shape.
export function createHostJournal(ctx: HostCtx): HostJournal {
  const traces: CapTrace[] = [];
  const delta: StateWrite[] = [];
  const overlay = new Map<string, Row[]>();

  const rowsOf = (name: string): Row[] => {
    let rows = overlay.get(name);
    if (!rows) {
      rows = structuredClone(ctx.readStore(name));
      overlay.set(name, rows);
    }
    return rows;
  };

  const imports: CapImports = {
    kvStore: {
      insert: (store, record) => {
        const row: Row = {};
        for (const [key, value] of record) row[key] = value;
        rowsOf(store).push(row);
        delta.push({ t: "append", path: `store.${store}`, value: row as Value });
        traces.push({ cap: "kv", op: "insert", store });
      },
      query: (store, field, op, valueJson) => {
        traces.push({ cap: "kv", op: "query", store });
        const value = JSON.parse(valueJson) as Value;
        return rowsOf(store)
          .filter((r) => rowMatches(r[field], op as FilterOp, value))
          .map((r) => JSON.stringify(r));
      },
      update: (store, field, op, valueJson, fields) => {
        const value = JSON.parse(valueJson) as Value;
        const rows = rowsOf(store);
        const patch: Row = {};
        for (const [k, v] of fields) patch[k] = v;
        for (const row of rows) {
          if (rowMatches(row[field], op as FilterOp, value)) Object.assign(row, patch);
        }
        delta.push({ t: "set", path: `store.${store}`, value: structuredClone(rows) as Value });
        traces.push({ cap: "kv", op: "update", store });
      },
      delete: (store, field, op, valueJson) => {
        const value = JSON.parse(valueJson) as Value;
        overlay.set(
          store,
          rowsOf(store).filter((r) => !rowMatches(r[field], op as FilterOp, value)),
        );
        delta.push({
          t: "removeWhere",
          path: `store.${store}`,
          pred: (item) => rowMatches((item as Row)[field], op as FilterOp, value),
        });
        traces.push({ cap: "kv", op: "delete", store });
      },
    },
    toast: {
      show: (message) => traces.push({ cap: "toast", message }),
    },
    clock: {
      nowMs: () => {
        traces.push({ cap: "clock" });
        return BigInt(Date.now());
      },
    },
    nav: {
      go: (route) => traces.push({ cap: "nav", route }),
    },
    // State writes are output, not an effect: a delta, no trace — matching
    // the interpreter's SetState, which emits a delta and no capability trace.
    uiState: {
      set: (path, json) => {
        delta.push({ t: "set", path, value: JSON.parse(json) as Value });
      },
    },
  };

  return {
    imports,
    finish: (result) =>
      result.t === "ok" ? { result, delta, traces } : { result, delta: [], traces },
  };
}
