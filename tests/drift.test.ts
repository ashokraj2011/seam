import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Action, Row, Value } from "../src/kernel/types";
import { invokeComponent } from "../src/runtime/component-host";
import { interpret } from "../src/runtime/interpret";
import { loweredRust } from "../src/runtime/lower";
import { StateStore } from "../src/runtime/state";

// The M2 exit test (BUILD_SPEC §10): save-customer, LOWERED from its action-IR
// body to Rust and compiled to a WASM component, produces IDENTICAL behavior
// to the interpreter running the same IR — same result, same capability
// traces, same post-state. A divergence is a build failure (§6 drift control).
// Because the Rust is generated from the IR (src/runtime/lower.ts), the
// equivalence is by construction, not coincidence.

const DIST = join(process.cwd(), "components", "dist", "save-customer", "save_customer.js");

// The full five-action save-customer body — the same one the studio seeds and
// scripts/lower-and-build.mjs lowered. SetState now lowers via the ui-state
// capability, so the component clears the draft inputs exactly as the
// interpreter does (the finding the spike had left open).
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

interface Payload {
  name: string;
  input: Record<string, Value>;
  seedRows: Row[];
}

const PAYLOADS: Payload[] = [
  {
    name: "happy path — insert + toast + clears both drafts",
    input: { name: "Edsger Dijkstra", email: "edsger@example.com" },
    seedRows: [{ name: "Ada Lovelace", email: "ada@example.com" }],
  },
  {
    name: "empty name → validation error, full rollback (no insert, no clears)",
    input: { name: "", email: "nobody@example.com" },
    seedRows: [{ name: "Ada Lovelace", email: "ada@example.com" }],
  },
  {
    name: "whitespace name → validation error",
    input: { name: "   ", email: "x@example.com" },
    seedRows: [],
  },
  {
    name: "insert into empty store",
    input: { name: "Grace Hopper", email: "grace@example.com" },
    seedRows: [],
  },
];

function freshState(rows: Row[]): StateStore {
  return new StateStore([
    ["store.customers", structuredClone(rows) as Value],
    ["state.draftName", "typed-but-not-yet-saved"],
    ["state.draftEmail", "typed-but-not-yet-saved"],
  ]);
}

describe.skipIf(!existsSync(DIST))("M2 drift corpus: lowered component vs IR interpreter", () => {
  for (const payload of PAYLOADS) {
    it(payload.name, async () => {
      // Arm 1: the action-IR body through the interpreter.
      const irState = freshState(payload.seedRows);
      const irOutcome = interpret(SAVE_BODY, {
        vars: payload.input,
        storeNameOf: () => "customers",
        readStore: (name) => (irState.get(`store.${name}`) as Row[]) ?? [],
        now: () => 0,
      });
      if (irOutcome.result.t === "ok") for (const w of irOutcome.delta) irState.apply(w);

      // Arm 2: the lowered Rust component through the host.
      const wasmState = freshState(payload.seedRows);
      const wasmOutcome = await invokeComponent(
        await currentHash(),
        payload.input,
        (name) => (wasmState.get(`store.${name}`) as Row[]) ?? [],
      );
      if (wasmOutcome.result.t === "ok") for (const w of wasmOutcome.delta) wasmState.apply(w);

      // The drift check: result, capability traces, and ALL post-state.
      expect(wasmOutcome.result).toEqual(irOutcome.result);
      expect(wasmOutcome.traces).toEqual(irOutcome.traces);
      expect(wasmState.get("store.customers")).toEqual(irState.get("store.customers"));
      expect(wasmState.get("state.draftName")).toEqual(irState.get("state.draftName"));
      expect(wasmState.get("state.draftEmail")).toEqual(irState.get("state.draftEmail"));
    });
  }

  it("the component is sandboxed to its grants: only kv and toast traces", async () => {
    const state = freshState([]);
    const outcome = await invokeComponent(
      await currentHash(),
      { name: "x", email: "y" },
      (name) => (state.get(`store.${name}`) as Row[]) ?? [],
    );
    // ui-state is a base capability (no trace); kv + toast are the only
    // granted effects, so those are the only traces that may appear.
    for (const trace of outcome.traces) {
      expect(["kv", "toast"]).toContain(trace.cap);
    }
  });
});

// The lowering itself is deterministic and compile-free to check: the Rust it
// emits is the source that was actually built into the component above.
describe("IR → Rust lowering", () => {
  it("emits the save-customer body with kv, toast, and ui-state calls", () => {
    const rust = loweredRust({
      name: "save-customer",
      signature: {
        inputs: [
          { name: "name", type: "string" },
          { name: "email", type: "string" },
        ],
        result: { t: "error" },
      },
      grants: [{ t: "kv", store: STORE_ID, mode: "rw" }, { t: "toast" }],
      seq: SAVE_BODY,
      storeName: () => "customers",
    });
    expect(rust).toContain("if input.name.trim().is_empty()");
    expect(rust).toContain(`return Err("name is required".to_string());`);
    expect(rust).toContain(`kv_store::insert("customers", &[`);
    expect(rust).toContain(`toast::show(&format!("Saved {}", input.name));`);
    expect(rust).toContain(`ui_state::set("state.draftName", "\\"\\"");`);
    expect(rust).toContain("use bindings::app::caps::ui_state;");
  });
});

async function currentHash(): Promise<string> {
  const manifest = await import("../components/dist/save-customer/manifest.json");
  return manifest.default.hash;
}
