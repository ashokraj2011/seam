import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Action, Row, Value } from "../src/kernel/types";
import { invokeComponent } from "../src/runtime/component-host";
import { interpret } from "../src/runtime/interpret";
import { StateStore } from "../src/runtime/state";

// The M2 exit test (BUILD_SPEC §10): the same save-customer, hand-written in
// Rust and compiled to a WASM component, produces IDENTICAL behavior to the
// action-IR twin on the drift corpus — same results, same capability traces,
// same post-state. A divergence here is a build failure (§6 drift control).
//
// M2 finding, recorded: SetState has no capability analog yet — UI-state
// writes are interpreter-side only. The equivalence body is therefore the
// effectful core (validate → insert → toast); lowering SetState needs either
// a ui-state capability or wire-level state mapping. Decide before M5.

const DIST = join(process.cwd(), "components", "dist", "save-customer", "save_customer.js");

const IR_TWIN: Action[] = [
  { t: "Validate", var: "name", rule: { t: "nonEmpty" }, elseError: "name is required" },
  {
    t: "KvInsert",
    store: "s1",
    record: { name: { t: "var", name: "name" }, email: { t: "var", name: "email" } },
  },
  { t: "Toast", template: "Saved {name}" },
];

interface Payload {
  name: string;
  input: Record<string, Value>;
  seedRows: Row[];
}

const PAYLOADS: Payload[] = [
  {
    name: "happy path",
    input: { name: "Edsger Dijkstra", email: "edsger@example.com" },
    seedRows: [{ name: "Ada Lovelace", email: "ada@example.com" }],
  },
  {
    name: "empty name → validation error, rollback",
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
  return new StateStore([["store.customers", structuredClone(rows) as Value]]);
}

describe.skipIf(!existsSync(DIST))("M2 drift corpus: IR twin vs compiled component", () => {
  for (const payload of PAYLOADS) {
    it(payload.name, async () => {
      // Arm 1: the action-IR twin through the interpreter.
      const irState = freshState(payload.seedRows);
      const irOutcome = interpret(IR_TWIN, {
        vars: payload.input,
        storeNameOf: () => "customers",
        readStore: (name) => (irState.get(`store.${name}`) as Row[]) ?? [],
        now: () => 0,
      });
      if (irOutcome.result.t === "ok") for (const w of irOutcome.delta) irState.apply(w);

      // Arm 2: the Rust component through the host.
      const wasmState = freshState(payload.seedRows);
      const wasmOutcome = await invokeComponent(
        await currentHash(),
        payload.input,
        (name) => (wasmState.get(`store.${name}`) as Row[]) ?? [],
      );
      if (wasmOutcome.result.t === "ok") for (const w of wasmOutcome.delta) wasmState.apply(w);

      // The drift check: result, capability traces, and post-state must match.
      expect(wasmOutcome.result).toEqual(irOutcome.result);
      expect(wasmOutcome.traces).toEqual(irOutcome.traces);
      expect(wasmState.get("store.customers")).toEqual(irState.get("store.customers"));
    });
  }

  it("the component is sandboxed to its grants: traces contain only kv and toast", async () => {
    const state = freshState([]);
    const outcome = await invokeComponent(
      await currentHash(),
      { name: "x", email: "y" },
      (name) => (state.get(`store.${name}`) as Row[]) ?? [],
    );
    for (const trace of outcome.traces) {
      expect(["kv", "toast"]).toContain(trace.cap);
    }
  });
});

async function currentHash(): Promise<string> {
  const manifest = await import("../components/dist/save-customer/manifest.json");
  return manifest.default.hash;
}
