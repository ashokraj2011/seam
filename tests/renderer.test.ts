// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import type { Node } from "../src/kernel/types";
import { Renderer } from "../src/renderer/renderer";

// Renderer correctness: mount from graph, then every delta patches the live
// DOM — inserts, removals (with subtree restore on undo), moves without
// remount, dep-mapped prop patches, styleProps, theme.

const node = (id: string, kind: Node["kind"], children: string[] = []): Node => ({
  id,
  kind,
  props: {},
  styleProps: {},
  bindings: [],
  events: [],
  children,
});

function setup() {
  let t = 0;
  const kernel = new GraphKernel({ projectName: "t", now: () => (t += 1000) });
  kernel.apply({
    t: "AddPage",
    page: { id: "p1", route: "/", root: "root", state: [] },
    nodes: [node("root", "Container", ["card"]), node("card", "Card", ["label"]), node("label", "Label")],
  });
  const mountEl = document.createElement("div");
  document.body.appendChild(mountEl);
  const events: Array<{ node: string; event: string }> = [];
  const renderer = new Renderer(kernel, mountEl, (n, event) => events.push({ node: n, event }));
  renderer.renderPage("p1");
  return { kernel, mountEl, renderer, events };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("renderer", () => {
  it("mounts the page tree", () => {
    const { mountEl } = setup();
    expect(mountEl.querySelector(".k-container .k-card .k-label")).toBeTruthy();
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Label");
  });

  it("patches a prop without remounting the element", () => {
    const { kernel, mountEl } = setup();
    const label = mountEl.querySelector(".k-label")!;
    kernel.apply({ t: "SetProp", node: "label", key: "text", value: "Hello" });
    expect(mountEl.querySelector(".k-label")).toBe(label); // same element
    expect(label.textContent).toBe("Hello");
  });

  it("inserts a node at the commanded index", () => {
    const { kernel, mountEl } = setup();
    kernel.apply({ t: "InsertNode", parent: "card", index: 0, node: node("btn", "Button") });
    const body = mountEl.querySelector(".k-card__body")!;
    expect(body.children.length).toBe(2);
    expect(body.children[0]!.classList.contains("k-btn")).toBe(true);
  });

  it("removes a subtree and restores it on undo", () => {
    const { kernel, mountEl } = setup();
    kernel.apply({ t: "RemoveNode", node: "card" });
    expect(mountEl.querySelector(".k-card")).toBeNull();
    kernel.undo();
    expect(mountEl.querySelector(".k-card .k-label")).toBeTruthy();
  });

  it("moves DOM nodes without remounting", () => {
    const { kernel, mountEl } = setup();
    kernel.apply({ t: "InsertNode", parent: "root", index: 1, node: node("btn", "Button") });
    const btn = mountEl.querySelector(".k-btn")!;
    kernel.apply({ t: "MoveNode", node: "btn", toParent: "card", toIndex: 0 });
    expect(mountEl.querySelector(".k-btn")).toBe(btn); // same element, new home
    expect(btn.parentElement!.classList.contains("k-card__body")).toBe(true);
    kernel.apply({ t: "MoveNode", node: "btn", toParent: "root", toIndex: 0 });
    expect(mountEl.querySelector(".k-container")!.children[0]).toBe(btn);
  });

  it("applies and swaps styleProp utility classes", () => {
    const { kernel, mountEl } = setup();
    const card = mountEl.querySelector(".k-card")!;
    kernel.apply({ t: "SetStyleProp", node: "card", key: "pad", value: "3" });
    expect(card.classList.contains("u-pad-3")).toBe(true);
    kernel.apply({ t: "SetStyleProp", node: "card", key: "pad", value: "1" });
    expect(card.classList.contains("u-pad-1")).toBe(true);
    expect(card.classList.contains("u-pad-3")).toBe(false);
    kernel.apply({ t: "SetStyleProp", node: "card", key: "visible", value: false });
    expect(card.classList.contains("u-hidden")).toBe(true);
    kernel.undo();
    expect(card.classList.contains("u-hidden")).toBe(false);
  });

  it("applies theme tokens as CSS custom properties", () => {
    const { kernel, mountEl } = setup();
    expect(mountEl.style.getPropertyValue("--color-primary")).toBe("#4f63f5");
    kernel.apply({ t: "SetTheme", theme: { "color-primary": "#000000" } });
    expect(mountEl.style.getPropertyValue("--color-primary")).toBe("#000000");
  });

  it("routes component events through the sink", () => {
    const { kernel, mountEl, events } = setup();
    kernel.apply({ t: "InsertNode", parent: "card", index: 0, node: node("btn", "Button") });
    (mountEl.querySelector(".k-btn") as HTMLButtonElement).click();
    expect(events).toEqual([{ node: "btn", event: "click" }]);
  });

  it("clears the canvas when the rendered page is removed", () => {
    const { kernel, mountEl } = setup();
    kernel.apply({ t: "RemovePage", page: "p1" });
    expect(mountEl.children.length).toBe(0);
  });
});
