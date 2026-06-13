import type {
  Action,
  Contract,
  Expr,
  FilterExpr,
  Predicate,
  Row,
  ValidationRule,
  Value,
} from "../kernel/types";
import type { StateWrite } from "./state";
import { rowMatches } from "./filter";

// The action-IR interpreter (MVP1_PLAN_AND_SPEC.md §7). A body executes
// atomically against capability fakes: kv reads/writes go to a lazily-cloned
// overlay journal, toasts and navigation are buffered as traces, and nothing
// touches the real world until the whole body succeeds — if a later action
// errors, every kv write rolls back by never being applied. The dispatcher
// applies `delta` and plays the traces on an ok result.

export type CapTrace =
  | { cap: "kv"; op: "insert" | "query" | "update" | "delete"; store: string }
  | { cap: "toast"; message: string }
  | { cap: "nav"; route: string }
  | { cap: "clock" };

export interface Outcome {
  result: { t: "ok" } | { t: "error"; message: string };
  delta: StateWrite[]; // applied by the caller on ok, in order
  traces: CapTrace[];
}

export interface InterpretCtx {
  vars: Record<string, Value>; // contract inputs, pre-bound by the wire
  storeNameOf: (id: string) => string;
  readStore: (name: string) => Row[];
  now: () => number; // clock capability
}

function checkRule(value: Value | undefined, rule: ValidationRule): boolean {
  switch (rule.t) {
    case "nonEmpty":
      return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
    case "matches":
      return typeof value === "string" && new RegExp(rule.pattern).test(value);
    case "range": {
      if (typeof value !== "number") return false;
      if (rule.min !== undefined && value < rule.min) return false;
      if (rule.max !== undefined && value > rule.max) return false;
      return true;
    }
  }
}

export function interpret(seq: Action[], ctx: InterpretCtx): Outcome {
  const traces: CapTrace[] = [];
  const delta: StateWrite[] = [];
  const vars: Record<string, Value> = { ...ctx.vars };
  const overlay = new Map<string, Row[]>(); // journal: store name → working rows

  const rowsOf = (name: string): Row[] => {
    let rows = overlay.get(name);
    if (!rows) {
      rows = structuredClone(ctx.readStore(name));
      overlay.set(name, rows);
    }
    return rows;
  };

  // Var names may be dot paths into record vars: "row.name".
  const evalVar = (name: string): Value | undefined => {
    const [head, ...rest] = name.split(".");
    let v: Value | undefined = vars[head!];
    for (const seg of rest) {
      if (v && typeof v === "object" && !Array.isArray(v)) v = (v as Record<string, Value>)[seg];
      else return undefined;
    }
    return v;
  };
  const evalExpr = (e: Expr): Value => (e.t === "lit" ? e.value : (evalVar(e.name) ?? null));
  const template = (tpl: string): string =>
    tpl.replace(/\{([\w.]+)\}/g, (_, name: string) => String(evalVar(name) ?? ""));
  // Resolve a filter's value against current vars, then compare via the
  // shared rowMatches — the same function the component host uses.
  const matches = (row: Row, f: FilterExpr): boolean =>
    rowMatches(row[f.field], f.op, evalExpr(f.value));

  const run = (actions: Action[]): string | null => {
    for (const action of actions) {
      switch (action.t) {
        case "Validate": {
          if (!checkRule(evalVar(action.var), action.rule)) return action.elseError;
          break;
        }
        case "KvInsert": {
          const name = ctx.storeNameOf(action.store);
          const record: Row = {};
          for (const [key, expr] of Object.entries(action.record)) record[key] = evalExpr(expr);
          rowsOf(name).push(record);
          delta.push({ t: "append", path: `store.${name}`, value: record });
          traces.push({ cap: "kv", op: "insert", store: name });
          break;
        }
        case "KvQuery": {
          const name = ctx.storeNameOf(action.store);
          vars[action.into] = rowsOf(name).filter((row) => matches(row, action.filter)) as Value;
          traces.push({ cap: "kv", op: "query", store: name });
          break;
        }
        case "KvUpdate": {
          const name = ctx.storeNameOf(action.store);
          const rows = rowsOf(name);
          for (const row of rows) {
            if (!matches(row, action.where)) continue;
            for (const [key, expr] of Object.entries(action.set)) row[key] = evalExpr(expr);
          }
          delta.push({ t: "set", path: `store.${name}`, value: structuredClone(rows) });
          traces.push({ cap: "kv", op: "update", store: name });
          break;
        }
        case "KvDelete": {
          const name = ctx.storeNameOf(action.store);
          // Resolve the filter value ONCE, against vars at this point, so the
          // predicate is stable (and matches what the lowered Rust sends).
          const field = action.where.field;
          const op = action.where.op;
          const value = evalExpr(action.where.value);
          overlay.set(
            name,
            rowsOf(name).filter((row) => !rowMatches(row[field], op, value)),
          );
          delta.push({
            t: "removeWhere",
            path: `store.${name}`,
            pred: (item) => rowMatches((item as Row)[field], op, value),
          });
          traces.push({ cap: "kv", op: "delete", store: name });
          break;
        }
        case "SetState": {
          delta.push({ t: "set", path: action.path, value: evalExpr(action.from) });
          break;
        }
        case "Toast": {
          traces.push({ cap: "toast", message: template(action.template) });
          break;
        }
        case "Navigate": {
          traces.push({ cap: "nav", route: action.route });
          break;
        }
        case "Branch": {
          const taken = condHolds(action.cond) ? action.then : action.else;
          const error = run(taken);
          if (error !== null) return error;
          break;
        }
      }
    }
    return null;
  };

  const condHolds = (cond: Extract<Action, { t: "Branch" }>["cond"]): boolean => {
    if (cond.t === "eq") return evalExpr(cond.left) === evalExpr(cond.right);
    const v = evalVar(cond.var);
    if (v === undefined || v === null) return true;
    if (typeof v === "string") return v === "";
    if (Array.isArray(v)) return v.length === 0;
    return false;
  };

  const error = run(seq);
  if (error !== null) return { result: { t: "error", message: error }, delta: [], traces };
  return { result: { t: "ok" }, delta, traces };
}

// ── predicates: trace assertions after every Run-mode invocation ───────────

export interface PredicateCheck {
  label: string;
  ok: boolean;
}

export function checkPredicates(
  contract: Contract,
  input: Record<string, Value>,
  outcome: Outcome,
  storeNameOf: (id: string) => string,
  readStoreAfter: (name: string) => Row[],
): PredicateCheck[] {
  const checks: PredicateCheck[] = [];
  for (const predicate of contract.predicates) {
    checks.push(checkOne(predicate, input, outcome, storeNameOf, readStoreAfter));
  }
  return checks;
}

function checkOne(
  predicate: Predicate,
  input: Record<string, Value>,
  outcome: Outcome,
  storeNameOf: (id: string) => string,
  readStoreAfter: (name: string) => Row[],
): PredicateCheck {
  switch (predicate.t) {
    case "nonEmpty": {
      // pre-predicate — checked on every invocation
      const v = input[predicate.field];
      return {
        label: `non-empty(${predicate.field})`,
        ok: typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null,
      };
    }
    case "persists": {
      const name = storeNameOf(predicate.store);
      // post-predicate — only meaningful when the invocation succeeded
      const ok =
        outcome.result.t !== "ok" ||
        outcome.traces.some(
          (t) => t.cap === "kv" && (t.op === "insert" || t.op === "update") && t.store === name,
        );
      return { label: `persists(${name})`, ok };
    }
    case "unique": {
      const name = storeNameOf(predicate.store);
      if (outcome.result.t !== "ok") return { label: `unique(${name}, ${predicate.field})`, ok: true };
      const values = readStoreAfter(name).map((row) => row[predicate.field]);
      return {
        label: `unique(${name}, ${predicate.field})`,
        ok: new Set(values.map((v) => JSON.stringify(v ?? null))).size === values.length,
      };
    }
  }
}
