// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import { Renderer } from "../src/renderer/renderer";
import type { DispatchDeps } from "../src/runtime/dispatch";
import { dispatchWire } from "../src/runtime/dispatch";
import type { PredicateCheck } from "../src/runtime/interpret";
import { seedDemo } from "../src/shared/seed";

// End-to-end P5: the seeded §9 demo driven through the dispatcher — the same
// graph, renderer, state store, and wires the studio uses in Run mode.

function setup() {
  let t = 0;
  const kernel = new GraphKernel({ projectName: "t", now: () => (t += 1000) });
  seedDemo(kernel);
  const mountEl = document.createElement("div");
  document.body.appendChild(mountEl);
  const renderer = new Renderer(kernel, mountEl);
  renderer.renderPage(kernel.state.pages[0]!.id);

  const toasts: Array<{ message: string; kind: string }> = [];
  let predicateChecks: PredicateCheck[] = [];
  const deps: DispatchDeps = {
    kernel,
    state: renderer.stateStore!,
    readNodeValue: (id) => renderer.readNodeValue(id),
    toast: (message, kind = "info") => toasts.push({ message, kind }),
    navigate: () => {},
    onPredicates: (_node, checks) => (predicateChecks = checks),
  };

  const nodeByKind = (kind: string, index = 0) =>
    [...kernel.state.nodes.values()].filter((n) => n.kind === kind)[index]!;
  const fire = (nodeId: string, event: string, payload: Parameters<typeof dispatchWire>[3] = null) => {
    const wire = kernel.state.nodes.get(nodeId)!.events.find((w) => w.event === event)!;
    return dispatchWire(deps, nodeId, wire, payload);
  };

  return { kernel, mountEl, renderer, toasts, deps, nodeByKind, fire, predicates: () => predicateChecks };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("the §9 demo through the dispatcher", () => {
  it("save: validate → insert → toast → inputs cleared, table grows by one", () => {
    const { mountEl, nodeByKind, fire, toasts, predicates } = setup();
    const nameInput = mountEl.querySelectorAll(".k-input")[0] as HTMLInputElement;
    const emailInput = mountEl.querySelectorAll(".k-input")[1] as HTMLInputElement;
    nameInput.value = "Edsger Dijkstra";
    emailInput.value = "edsger@example.com";

    const body = mountEl.querySelector("tbody")!;
    expect(body.children.length).toBe(2);
    const firstTr = body.children[0]!;

    const outcome = fire(nodeByKind("Button").id, "click");
    expect(outcome?.result).toEqual({ t: "ok" });
    expect(body.children.length).toBe(3); // fine-grained append
    expect(body.children[0]).toBe(firstTr);
    expect(body.lastElementChild!.textContent).toContain("Edsger Dijkstra");
    expect(toasts).toEqual([{ message: "Saved Edsger Dijkstra", kind: "info" }]);
    expect(nameInput.value).toBe(""); // SetState cleared the bound inputs
    expect(emailInput.value).toBe("");
    expect(predicates().every((p) => p.ok)).toBe(true);
  });

  it("save with empty name: error toast, nothing persists, predicate fails", () => {
    const { mountEl, nodeByKind, fire, toasts, predicates } = setup();
    const outcome = fire(nodeByKind("Button").id, "click");
    expect(outcome?.result).toEqual({ t: "error", message: "name is required" });
    expect(mountEl.querySelector("tbody")!.children.length).toBe(2); // rollback
    expect(toasts).toEqual([{ message: "name is required", kind: "error" }]);
    expect(predicates().find((p) => p.label === "non-empty(name)")?.ok).toBe(false);
  });

  it("row-click opens the confirm modal with the pending name; confirm deletes", () => {
    const { kernel, mountEl, nodeByKind, fire, toasts } = setup();
    const modal = mountEl.querySelector(".k-modal")!;
    expect(modal.hasAttribute("hidden")).toBe(true);

    const table = nodeByKind("Table");
    fire(table.id, "row-click", { index: 0, row: { name: "Ada Lovelace", email: "ada@example.com" } });

    expect(modal.hasAttribute("hidden")).toBe(false); // bound open ← state.confirmOpen
    expect(modal.querySelector(".k-label")!.textContent).toBe("Ada Lovelace");

    const confirmBtn = [...kernel.state.nodes.values()].find(
      (n) => n.kind === "Button" && n.props["variant"] === "danger",
    )!;
    fire(confirmBtn.id, "click");

    expect(modal.hasAttribute("hidden")).toBe(true);
    const body = mountEl.querySelector("tbody")!;
    expect(body.children.length).toBe(1);
    expect(body.textContent).not.toContain("Ada Lovelace");
    expect(toasts).toEqual([{ message: "Deleted Ada Lovelace", kind: "info" }]);
  });

  it("an unfilled contract shows the stub toast — an affordance, not an error", () => {
    const { kernel, deps, nodeByKind, toasts } = setup();
    kernel.apply({
      t: "AuthorContract",
      contract: {
        id: "ct-stub",
        name: "not-ready",
        signature: { inputs: [], result: { t: "ok" } },
        grants: [],
        predicates: [],
        body: { t: "unfilled" },
      },
    });
    const label = nodeByKind("Label");
    const outcome = dispatchWire(
      deps,
      label.id,
      { event: "click", contract: "ct-stub", inputs: {} },
      null,
    );
    expect(outcome).toBeNull();
    expect(toasts).toEqual([{ message: "'not-ready' is not filled yet", kind: "info" }]);
  });

  it("an orphaned wire (contract removed) degrades to an error toast", () => {
    const { deps, nodeByKind, toasts } = setup();
    const outcome = dispatchWire(
      deps,
      nodeByKind("Button").id,
      { event: "click", contract: "ghost", inputs: {} },
      null,
    );
    expect(outcome).toBeNull();
    expect(toasts[0]!.kind).toBe("error");
  });
});
