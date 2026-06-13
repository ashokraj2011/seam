// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import { Renderer } from "../src/renderer/renderer";
import { dispatchWire } from "../src/runtime/dispatch";
import type { DispatchDeps } from "../src/runtime/dispatch";
import { generateApp } from "../src/studio/generate";

// The generator turns a data shape into a complete, RUNNING app. This proves
// the generated graph is not just well-formed but functional end to end:
// generate -> save a row -> delete it, all through the real dispatcher.

beforeEach(() => {
  document.body.innerHTML = "";
});

function setup(spec: Parameters<typeof generateApp>[1]) {
  let t = 0;
  const kernel = new GraphKernel({ projectName: "gen", now: () => (t += 1000) });
  const pageId = generateApp(kernel, spec);
  const mountEl = document.createElement("div");
  document.body.appendChild(mountEl);
  const renderer = new Renderer(kernel, mountEl);
  renderer.renderPage(pageId);

  const toasts: string[] = [];
  const deps: DispatchDeps = {
    kernel,
    state: renderer.stateStore!,
    readNodeValue: (id) => renderer.readNodeValue(id),
    toast: (m) => toasts.push(m),
    navigate: () => {},
  };
  const fire = (nodeId: string, event: string, payload: Parameters<typeof dispatchWire>[3] = null) => {
    const wire = kernel.state.nodes.get(nodeId)!.events.find((w) => w.event === event)!;
    return dispatchWire(deps, nodeId, wire, payload);
  };
  const byKind = (kind: string, i = 0) => [...kernel.state.nodes.values()].filter((n) => n.kind === kind)[i]!;
  return { kernel, mountEl, renderer, toasts, fire, byKind };
}

describe("generateApp", () => {
  it("builds a store, page, and three contracts from a spec", () => {
    const { kernel } = setup({
      entity: "task",
      fields: [{ name: "title", type: "string" }, { name: "done", type: "bool" }],
    });
    expect(kernel.state.stores.map((s) => s.name)).toEqual(["tasks"]);
    expect(kernel.state.contracts.map((c) => c.name).sort()).toEqual([
      "delete-task",
      "save-task",
      "select-task",
    ]);
    const page = kernel.state.pages[0]!;
    expect(page.route).toBe("/tasks");
    // one input per field + a save button rendered in the form card
    expect([...kernel.state.nodes.values()].filter((n) => n.kind === "TextInput")).toHaveLength(1);
    expect([...kernel.state.nodes.values()].filter((n) => n.kind === "Checkbox")).toHaveLength(1);
  });

  it("generated app saves a row end to end (validate → insert → toast → clear)", () => {
    const { mountEl, fire, byKind, toasts, renderer } = setup({
      entity: "contact",
      fields: [{ name: "name", type: "string" }, { name: "email", type: "string" }],
    });
    const inputs = mountEl.querySelectorAll(".k-input");
    (inputs[0] as HTMLInputElement).value = "Ada Lovelace";
    (inputs[1] as HTMLInputElement).value = "ada@example.com";

    const outcome = fire(byKind("Button").id, "click");
    expect(outcome?.result).toEqual({ t: "ok" });
    expect(renderer.stateStore!.get("store.contacts")).toEqual([
      { name: "Ada Lovelace", email: "ada@example.com" },
    ]);
    expect(toasts).toEqual(["Saved Ada Lovelace"]);
    expect((inputs[0] as HTMLInputElement).value).toBe(""); // drafts cleared
    expect(mountEl.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("generated validation blocks an empty key field and rolls back", () => {
    const { fire, byKind, renderer, toasts } = setup({
      entity: "note",
      fields: [{ name: "text", type: "string" }],
    });
    const outcome = fire(byKind("Button").id, "click");
    expect(outcome?.result).toEqual({ t: "error", message: "text is required" });
    expect(renderer.stateStore!.get("store.notes")).toEqual([]);
    expect(toasts).toEqual(["text is required"]);
  });

  it("generated delete-with-confirm flow removes the clicked row", () => {
    const { kernel, mountEl, fire, byKind, renderer } = setup({
      entity: "contact",
      fields: [{ name: "name", type: "string" }, { name: "email", type: "string" }],
    });
    // seed two rows directly into the live store
    renderer.stateStore!.apply({ t: "set", path: "store.contacts", value: [
      { name: "Ada Lovelace", email: "a@x.com" },
      { name: "Grace Hopper", email: "g@x.com" },
    ] });

    const table = byKind("Table");
    fire(table.id, "row-click", { index: 0, row: { name: "Ada Lovelace", email: "a@x.com" } });
    const modal = mountEl.querySelector(".k-modal")!;
    expect(modal.hasAttribute("hidden")).toBe(false);
    expect(modal.querySelector(".k-label")!.textContent).toBe("Ada Lovelace");

    const confirmBtn = [...kernel.state.nodes.values()].find(
      (n) => n.kind === "Button" && n.props["variant"] === "danger",
    )!;
    fire(confirmBtn.id, "click");
    expect(modal.hasAttribute("hidden")).toBe(true);
    expect(renderer.stateStore!.get("store.contacts")).toEqual([{ name: "Grace Hopper", email: "g@x.com" }]);
  });
});
