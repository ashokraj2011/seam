import type { Row, Value } from "../kernel/types";
import type { CapTrace, Outcome } from "./interpret";
import type { StateWrite } from "./state";

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
    query: (store: string, filter: string) => string[];
  };
  toast: { show: (message: string) => void };
  clock: { nowMs: () => bigint };
  nav: { go: (route: string) => void };
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
      query: (store, filter) => {
        traces.push({ cap: "kv", op: "query", store });
        const rows = rowsOf(store);
        const needle = filter.trim();
        const matched = needle
          ? rows.filter((r) => Object.values(r).some((v) => String(v ?? "").includes(needle)))
          : rows;
        return matched.map((r) => JSON.stringify(r));
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
  };

  return {
    imports,
    finish: (result) =>
      result.t === "ok" ? { result, delta, traces } : { result, delta: [], traces },
  };
}
