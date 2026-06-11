import type { GraphKernel } from "../kernel/kernel";
import type { EventWire, InputSource, NodeId, Row, TypeRef, Value } from "../kernel/types";
import type { StateStore } from "./state";
import type { Outcome, PredicateCheck } from "./interpret";
import { checkPredicates, interpret } from "./interpret";

// Dispatcher v1 (MVP1_PLAN_AND_SPEC.md §7) — the one seam between UI events
// and logic. Two live arms: unfilled → stub toast (an editor affordance, not
// an error), actionIr → interpret. The component arm is stubbed until MVP2.

export interface DispatchDeps {
  kernel: GraphKernel;
  state: StateStore;
  readNodeValue: (node: NodeId) => Value | undefined;
  toast: (message: string, kind?: "info" | "error") => void;
  navigate: (route: string) => void;
  onPredicates?: (node: NodeId, checks: PredicateCheck[]) => void;
}

const defaultFor = (type: TypeRef): Value =>
  type === "number" ? 0 : type === "bool" ? false : typeof type === "object" ? {} : "";

function resolveSource(
  source: InputSource | undefined,
  payload: Value | null,
  deps: DispatchDeps,
): Value | undefined {
  if (!source) return undefined;
  switch (source.t) {
    case "nodeValue":
      return deps.readNodeValue(source.node);
    case "statePath":
      return deps.state.get(source.path);
    case "payloadField": {
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        return (payload as Record<string, Value>)[source.field];
      }
      return undefined;
    }
    case "literal":
      return source.value;
  }
}

export function dispatchWire(
  deps: DispatchDeps,
  nodeId: NodeId,
  wire: EventWire,
  payload: Value | null,
): Outcome | null {
  const contract = deps.kernel.state.contracts.find((c) => c.id === wire.contract);
  if (!contract) {
    deps.toast(`orphaned wire: contract ${wire.contract} is gone`, "error");
    return null;
  }

  // The wire — not the body — maps sources onto the contract's declared
  // inputs (BUILD_SPEC.md §4). T0 happened at design time; here we resolve.
  const input: Record<string, Value> = {};
  for (const field of contract.signature.inputs) {
    const resolved = resolveSource(wire.inputs[field.name], payload, deps);
    input[field.name] = resolved === undefined ? defaultFor(field.type) : resolved;
  }

  const storeNameOf = (id: string) =>
    deps.kernel.state.stores.find((s) => s.id === id)?.name ?? id;
  const readStore = (name: string): Row[] => {
    const rows = deps.state.get(`store.${name}`);
    return Array.isArray(rows) ? (rows as Row[]) : [];
  };

  switch (contract.body.t) {
    case "unfilled":
      deps.toast(`'${contract.name}' is not filled yet`);
      return null;
    case "actionIr": {
      const outcome = interpret(contract.body.seq, {
        vars: input,
        storeNameOf,
        readStore,
        now: () => Date.now(),
      });
      if (outcome.result.t === "ok") {
        try {
          for (const write of outcome.delta) deps.state.apply(write);
        } catch (err) {
          deps.toast(err instanceof Error ? err.message : String(err), "error");
          return outcome;
        }
        for (const trace of outcome.traces) {
          if (trace.cap === "toast") deps.toast(trace.message);
          else if (trace.cap === "nav") deps.navigate(trace.route);
        }
      } else {
        deps.toast(outcome.result.message, "error");
      }
      deps.onPredicates?.(
        nodeId,
        checkPredicates(contract, input, outcome, storeNameOf, readStore),
      );
      return outcome;
    }
    default:
      // BodyRef::Component — MVP2's arm.
      throw new Error("component bodies arrive in MVP2");
  }
}
