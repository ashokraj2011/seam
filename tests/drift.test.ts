import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Action, Row, Value } from "../src/kernel/types";
import { invokeComponent } from "../src/runtime/component-host";
import { interpret } from "../src/runtime/interpret";
import { loweredRust } from "../src/runtime/lower";
import { StateStore } from "../src/runtime/state";
import saveManifest from "../components/dist/save-customer/manifest.json";
import deleteManifest from "../components/dist/delete-customer/manifest.json";

// The M2 exit test (BUILD_SPEC §10): each demo body, LOWERED from its action-IR
// to Rust and compiled to a WASM component, produces IDENTICAL behavior to the
// interpreter running the same IR — same result, capability traces, and full
// post-state. A divergence is a build failure (§6 drift control). Because the
// Rust is generated from the IR (src/runtime/lower.ts), equivalence is by
// construction, not coincidence.

const SAVE_DIST = join(process.cwd(), "components", "dist", "save-customer", "save_customer.js");
const STORE_ID = "s-customers";

const SAVE_BODY: Action[] = [
  { t: "Validate", var: "name", rule: { t: "nonEmpty" }, elseError: "name is required" },
  {
    t: "KvInsert",
    store: STORE_ID,
    record: { name: { t: "var", name: "name" }, email: { t: "var", name: "email" } },
  },
  { t: "Toast", template: "Saved {name}" },
  { t: "SetState", path: "state.draftName", from: { t: "lit", value: "" } },
  { t: "SetState", path: "state.draftEmail", from: { t: "lit", value: "" } },
];

const DELETE_BODY: Action[] = [
  {
    t: "KvDelete",
    store: STORE_ID,
    where: { field: "name", op: "eq", value: { t: "var", name: "name" } },
  },
  { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: false } },
  { t: "Toast", template: "Deleted {name}" },
];

// Run a body through both arms over a seeded state, return both final states.
async function bothArms(
  body: Action[],
  hash: string,
  input: Record<string, Value>,
  seed: Array<[string, Value]>,
) {
  const mkState = () => new StateStore(seed.map(([k, v]) => [k, structuredClone(v)]));
  const readStore = (s: StateStore) => (name: string) => (s.get(`store.${name}`) as Row[]) ?? [];

  const ir = mkState();
  const irOutcome = interpret(body, {
    vars: input,
    storeNameOf: () => "customers",
    readStore: readStore(ir),
    now: () => 0,
  });
  if (irOutcome.result.t === "ok") for (const w of irOutcome.delta) ir.apply(w);

  const wasm = mkState();
  const wasmOutcome = await invokeComponent(hash, input, readStore(wasm));
  if (wasmOutcome.result.t === "ok") for (const w of wasmOutcome.delta) wasm.apply(w);

  return { ir, irOutcome, wasm, wasmOutcome };
}

describe.skipIf(!existsSync(SAVE_DIST))("M2 drift: lowered components vs IR interpreter", () => {
  const savePayloads = [
    { name: "happy path — insert + toast + clears both drafts", input: { name: "Edsger Dijkstra", email: "e@x.com" }, rows: [{ name: "Ada", email: "a@x.com" }] },
    { name: "empty name → validation error, full rollback", input: { name: "", email: "n@x.com" }, rows: [{ name: "Ada", email: "a@x.com" }] },
    { name: "whitespace name → validation error", input: { name: "   ", email: "x@x.com" }, rows: [] },
    { name: "insert into empty store", input: { name: "Grace Hopper", email: "g@x.com" }, rows: [] },
  ];

  for (const p of savePayloads) {
    it(`save-customer: ${p.name}`, async () => {
      const seed: Array<[string, Value]> = [
        ["store.customers", p.rows as Value],
        ["state.draftName", "dirty"],
        ["state.draftEmail", "dirty"],
      ];
      const { ir, irOutcome, wasm, wasmOutcome } = await bothArms(SAVE_BODY, saveManifest.hash, p.input, seed);
      expect(wasmOutcome.result).toEqual(irOutcome.result);
      expect(wasmOutcome.traces).toEqual(irOutcome.traces);
      expect(wasm.get("store.customers")).toEqual(ir.get("store.customers"));
      expect(wasm.get("state.draftName")).toEqual(ir.get("state.draftName"));
      expect(wasm.get("state.draftEmail")).toEqual(ir.get("state.draftEmail"));
    });
  }

  const deletePayloads = [
    { name: "removes the matching row, closes the modal", input: { name: "Ada Lovelace" }, expectRows: 1 },
    { name: "no match → store unchanged, still closes", input: { name: "Nobody" }, expectRows: 2 },
  ];

  for (const p of deletePayloads) {
    it(`delete-customer: ${p.name}`, async () => {
      const rows: Row[] = [
        { name: "Ada Lovelace", email: "ada@example.com" },
        { name: "Grace Hopper", email: "grace@example.com" },
      ];
      const seed: Array<[string, Value]> = [
        ["store.customers", rows as Value],
        ["state.confirmOpen", true],
      ];
      const { ir, irOutcome, wasm, wasmOutcome } = await bothArms(DELETE_BODY, deleteManifest.hash, p.input, seed);
      expect(wasmOutcome.result).toEqual(irOutcome.result);
      expect(wasmOutcome.traces).toEqual(irOutcome.traces);
      expect(wasm.get("store.customers")).toEqual(ir.get("store.customers"));
      expect((wasm.get("store.customers") as Row[]).length).toBe(p.expectRows);
      expect(wasm.get("state.confirmOpen")).toBe(false);
    });
  }

  it("components are sandboxed to their grants: only kv and toast traces", async () => {
    const state = new StateStore([["store.customers", [] as Value]]);
    const outcome = await invokeComponent(saveManifest.hash, { name: "x", email: "y" }, () =>
      (state.get("store.customers") as Row[]) ?? [],
    );
    for (const trace of outcome.traces) expect(["kv", "toast"]).toContain(trace.cap);
  });
});

// The lowering is deterministic and compile-free to check.
describe("IR → Rust lowering", () => {
  it("lowers KvInsert/Toast/SetState (save-customer)", () => {
    const rust = loweredRust({
      name: "save-customer",
      signature: { inputs: [{ name: "name", type: "string" }, { name: "email", type: "string" }], result: { t: "error" } },
      grants: [{ t: "kv", store: STORE_ID, mode: "rw" }, { t: "toast" }],
      seq: SAVE_BODY,
      storeName: () => "customers",
    });
    expect(rust).toContain(`return Err("name is required".to_string());`);
    expect(rust).toContain(`kv_store::insert("customers", &[`);
    expect(rust).toContain(`ui_state::set("state.draftName", "\\"\\"");`);
  });

  it("lowers KvDelete with a json_str filter value (delete-customer)", () => {
    const rust = loweredRust({
      name: "delete-customer",
      signature: { inputs: [{ name: "name", type: "string" }], result: { t: "ok" } },
      grants: [{ t: "kv", store: STORE_ID, mode: "rw" }, { t: "toast" }],
      seq: DELETE_BODY,
      storeName: () => "customers",
    });
    expect(rust).toContain(`kv_store::delete("customers", "name", "eq", &json_str(&input.name))?;`);
    expect(rust).toContain("fn json_str(s: &str) -> String");
    expect(rust).toContain(`ui_state::set("state.confirmOpen", "false");`);
  });

  it("refuses unlowered actions with a clear error", async () => {
    const { LoweringError } = await import("../src/runtime/lower");
    expect(() =>
      loweredRust({
        name: "q",
        signature: { inputs: [], result: { t: "ok" } },
        grants: [{ t: "kv", store: STORE_ID, mode: "r" }],
        seq: [{ t: "KvQuery", store: STORE_ID, filter: { field: "name", op: "eq", value: { t: "lit", value: "" } }, into: "x" }],
        storeName: () => "customers",
      }),
    ).toThrow(LoweringError);
  });
});
