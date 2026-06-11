import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Action, Contract, Row, Value } from "../src/kernel/types";
import type { CapTrace, Outcome } from "../src/runtime/interpret";
import { checkPredicates, interpret } from "../src/runtime/interpret";
import { actionProblems } from "../src/runtime/lint";
import { StateStore } from "../src/runtime/state";

// Golden traces (MVP1_PLAN_AND_SPEC.md §10): recorded payload + expected
// Outcome per demo contract. The corpus/ files seed MVP2's drift corpus —
// the compiled twins must produce identical deltas and traces.

interface CorpusFile {
  name: string;
  stores: Array<{ id: string; name: string; rows: Row[] }>;
  state: Record<string, Value>;
  input: Record<string, Value>;
  body: Action[];
  expect: {
    result: Outcome["result"];
    traces: CapTrace[];
    storesAfter: Record<string, Row[]>;
    stateAfter: Record<string, Value>;
  };
}

const CORPUS_DIR = join(process.cwd(), "corpus");

function runCorpusCase(file: CorpusFile): void {
  const entries: Array<[string, Value]> = [
    ...file.stores.map((s): [string, Value] => [`store.${s.name}`, s.rows]),
    ...Object.entries(file.state),
  ];
  const state = new StateStore(entries);
  const outcome = interpret(file.body, {
    vars: file.input,
    storeNameOf: (id) => file.stores.find((s) => s.id === id)?.name ?? id,
    readStore: (name) => (state.get(`store.${name}`) as Row[]) ?? [],
    now: () => 0,
  });

  expect(outcome.result).toEqual(file.expect.result);
  expect(outcome.traces).toEqual(file.expect.traces);
  if (outcome.result.t === "ok") {
    for (const write of outcome.delta) state.apply(write);
  } else {
    expect(outcome.delta).toEqual([]); // rollback: nothing to apply
  }
  for (const [name, rows] of Object.entries(file.expect.storesAfter)) {
    expect(state.get(`store.${name}`), `store ${name}`).toEqual(rows);
  }
  for (const [path, value] of Object.entries(file.expect.stateAfter)) {
    expect(state.get(path), path).toEqual(value);
  }
}

describe("interpreter corpus (golden traces)", () => {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json"));
  it("has corpus files", () => expect(files.length).toBeGreaterThanOrEqual(4));
  for (const name of files) {
    const file = JSON.parse(readFileSync(join(CORPUS_DIR, name), "utf8")) as CorpusFile;
    it(file.name, () => runCorpusCase(file));
  }
});

describe("interpreter semantics", () => {
  const ctx = (rows: Row[], vars: Record<string, Value> = {}) => ({
    vars,
    storeNameOf: () => "t",
    readStore: () => rows,
    now: () => 0,
  });

  it("kv writes roll back when a later action errors", () => {
    const rows: Row[] = [{ name: "a" }];
    const outcome = interpret(
      [
        { t: "KvInsert", store: "s", record: { name: { t: "lit", value: "b" } } },
        { t: "Validate", var: "missing", rule: { t: "nonEmpty" }, elseError: "boom" },
      ],
      ctx(rows),
    );
    expect(outcome.result).toEqual({ t: "error", message: "boom" });
    expect(outcome.delta).toEqual([]);
    expect(rows).toEqual([{ name: "a" }]); // untouched — overlay journal only
  });

  it("queries see earlier writes in the same body (overlay reads)", () => {
    const outcome = interpret(
      [
        { t: "KvInsert", store: "s", record: { name: { t: "lit", value: "new" } } },
        {
          t: "KvQuery",
          store: "s",
          filter: { field: "name", op: "eq", value: { t: "lit", value: "new" } },
          into: "found",
        },
        {
          t: "Branch",
          cond: { t: "empty", var: "found" },
          then: [{ t: "Validate", var: "x", rule: { t: "nonEmpty" }, elseError: "should not happen" }],
          else: [],
        },
      ],
      ctx([]),
    );
    expect(outcome.result.t).toBe("ok");
  });

  it("resolves dot-path vars into record inputs", () => {
    const outcome = interpret(
      [{ t: "SetState", path: "state.x", from: { t: "var", name: "row.name" } }],
      ctx([], { row: { name: "Ada" } }),
    );
    expect(outcome.delta).toEqual([{ t: "set", path: "state.x", value: "Ada" }]);
  });

  it("interpolates {var} templates including dot paths", () => {
    const outcome = interpret(
      [{ t: "Toast", template: "hi {row.name}, {n}!" }],
      ctx([], { row: { name: "Ada" }, n: 7 }),
    );
    expect(outcome.traces).toEqual([{ cap: "toast", message: "hi Ada, 7!" }]);
  });

  it("validation rules: matches and range", () => {
    const bad = interpret(
      [{ t: "Validate", var: "email", rule: { t: "matches", pattern: "@" }, elseError: "bad email" }],
      ctx([], { email: "nope" }),
    );
    expect(bad.result).toEqual({ t: "error", message: "bad email" });
    const ok = interpret(
      [{ t: "Validate", var: "age", rule: { t: "range", min: 0, max: 130 }, elseError: "bad age" }],
      ctx([], { age: 44 }),
    );
    expect(ok.result.t).toBe("ok");
  });
});

describe("predicates", () => {
  const contract = (predicates: Contract["predicates"]): Contract => ({
    id: "c1",
    name: "t",
    signature: { inputs: [{ name: "name", type: "string" }], result: { t: "error" } },
    grants: [],
    predicates,
    body: { t: "unfilled" },
  });
  const okOutcome: Outcome = {
    result: { t: "ok" },
    delta: [],
    traces: [{ cap: "kv", op: "insert", store: "customers" }],
  };

  it("non-empty is a pre-check on the input", () => {
    const checks = checkPredicates(
      contract([{ t: "nonEmpty", field: "name" }]),
      { name: "" },
      okOutcome,
      () => "customers",
      () => [],
    );
    expect(checks).toEqual([{ label: "non-empty(name)", ok: false }]);
  });

  it("persists checks the kv trace post-hoc", () => {
    const checks = checkPredicates(
      contract([{ t: "persists", store: "s1" }]),
      { name: "x" },
      { ...okOutcome, traces: [] },
      () => "customers",
      () => [],
    );
    expect(checks).toEqual([{ label: "persists(customers)", ok: false }]);
  });

  it("unique queries the store's post-state", () => {
    const checks = checkPredicates(
      contract([{ t: "unique", store: "s1", field: "email" }]),
      { name: "x" },
      okOutcome,
      () => "customers",
      () => [{ email: "a@x" }, { email: "a@x" }],
    );
    expect(checks).toEqual([{ label: "unique(customers, email)", ok: false }]);
  });
});

describe("grant lint (the P5 exit test's revocation flag)", () => {
  const body: Action[] = [
    { t: "KvInsert", store: "s1", record: {} },
    { t: "Toast", template: "hi" },
    {
      t: "Branch",
      cond: { t: "empty", var: "x" },
      then: [{ t: "Navigate", route: "/" }],
      else: [],
    },
  ];

  it("clean when all capabilities are granted", () => {
    const problems = actionProblems(
      body,
      [{ t: "kv", store: "s1", mode: "rw" }, { t: "toast" }, { t: "nav" }],
      () => "customers",
    );
    expect(problems).toEqual([]);
  });

  it("flags every orphaned action after revocation", () => {
    const problems = actionProblems(body, [{ t: "kv", store: "s1", mode: "r" }], () => "customers");
    expect(problems).toEqual([
      { index: 0, message: "needs kv(customers, rw)" },
      { index: 1, message: "needs the toast grant" },
      { index: 2, message: "needs the nav grant" }, // inside the branch
    ]);
  });
});
