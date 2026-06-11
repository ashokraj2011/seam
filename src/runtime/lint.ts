import type { Action, Grant } from "../kernel/types";

// The design-time grant check (MVP1_PLAN_AND_SPEC.md §7) — MVP1's
// foreshadowing of the T1 capability lint. The body editor refuses to add
// ungrantable actions; this walker flags actions orphaned by a later grant
// revocation (the P5 exit test).

export interface BodyProblem {
  index: number; // top-level action index
  message: string;
}

export function actionProblems(
  seq: Action[],
  grants: Grant[],
  storeNameOf: (id: string) => string,
): BodyProblem[] {
  const kvGrant = (store: string, write: boolean) =>
    grants.some(
      (g) => g.t === "kv" && g.store === store && (g.mode === "rw" || (!write && g.mode === "r")),
    );

  const check = (action: Action): string | null => {
    switch (action.t) {
      case "KvInsert":
      case "KvUpdate":
      case "KvDelete":
        return kvGrant(action.store, true) ? null : `needs kv(${storeNameOf(action.store)}, rw)`;
      case "KvQuery":
        return kvGrant(action.store, false) ? null : `needs kv(${storeNameOf(action.store)}, r)`;
      case "Toast":
        return grants.some((g) => g.t === "toast") ? null : "needs the toast grant";
      case "Navigate":
        return grants.some((g) => g.t === "nav") ? null : "needs the nav grant";
      case "Branch": {
        for (const sub of [...action.then, ...action.else]) {
          const problem = check(sub);
          if (problem) return problem;
        }
        return null;
      }
      default:
        return null; // Validate / SetState are capability-free
    }
  };

  const out: BodyProblem[] = [];
  seq.forEach((action, index) => {
    const message = check(action);
    if (message) out.push({ index, message });
  });
  return out;
}
