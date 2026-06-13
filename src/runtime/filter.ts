import type { Value } from "../kernel/types";

// Shared row-filter evaluation — the ONE comparison both the interpreter and
// the component host use, so kv query/update/delete filter identically across
// the two BodyRef arms (the drift corpus depends on this being literally the
// same function). The filter value is always concrete here (the interpreter
// resolves Exprs against vars; the host parses the JSON the lowered Rust
// built at runtime).

export type FilterOp = "eq" | "neq" | "contains";

export interface ConcreteFilter {
  field: string;
  op: FilterOp;
  value: Value;
}

export function rowMatches(left: Value | undefined, op: FilterOp, right: Value): boolean {
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "contains":
      return typeof left === "string" && typeof right === "string" && left.includes(right);
  }
}

