// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import type { Node, Row } from "../src/kernel/types";
import { Renderer } from "../src/renderer/renderer";

// P4: bindings resolve from the runtime StateStore, re-patch on StateWrites,
// and Table takes the incremental path. The §8 exit test lives here:
// bind a table to a store with 1,000 seed rows; append re-renders one row,
// not the table.

const node = (id: string, kind: Node["kind"], props: Node["props"] = {}): Node => ({
  id,
  kind,
  props,
  styleProps: {},
  bindings: [],
  events: [],
  children: [],
});

function setup(seed: Row[]) {
  let t = 0;
  const kernel = new GraphKernel({ projectName: "t", now: () => (t += 1000) });
  kernel.apply({
    t: "DeclareStore",
    store: { id: "s1", name: "customers", schema: [{ name: "name", type: "string" }], seed },
  });
  const root = node("root", "Container");
  root.children = ["label", "table"];
  kernel.apply({
    t: "AddPage",
    page: {
      id: "p1",
      route: "/",
      root: "root",
      state: [{ name: "greeting", type: "string", initial: "Hello" }],
    },
    nodes: [root, node("label", "Label", { text: "fallback" }), node("table", "Table", { columns: ["name"] })],
  });
  kernel.apply({ t: "BindProp", node: "label", prop: "text", path: "state.greeting" });
  kernel.apply({ t: "BindProp", node: "table", prop: "rows", path: "store.customers" });

  const mountEl = document.createElement("div");
  document.body.appendChild(mountEl);
  const renderer = new Renderer(kernel, mountEl);
  renderer.renderPage("p1");
  return { kernel, mountEl, renderer };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("bindings", () => {
  it("resolves bound props from state at mount", () => {
    const { mountEl } = setup([{ name: "Ada" }]);
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Hello"); // not "fallback"
    expect(mountEl.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("re-patches when state changes", () => {
    const { mountEl, renderer } = setup([]);
    renderer.stateStore!.apply({ t: "set", path: "state.greeting", value: "Hi there" });
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Hi there");
  });

  it("the binding wins over SetProp while bound; unbind falls back", () => {
    const { kernel, mountEl } = setup([]);
    kernel.apply({ t: "SetProp", node: "label", key: "text", value: "ignored" });
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Hello");
    kernel.apply({ t: "UnbindProp", node: "label", prop: "text" });
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("ignored");
    kernel.apply({ t: "BindProp", node: "label", prop: "text", path: "state.greeting" });
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Hello");
  });

  it("seed edits flow into bound tables (rebuildState)", () => {
    const { kernel, mountEl } = setup([{ name: "Ada" }]);
    kernel.apply({
      t: "EditStore",
      store: "s1",
      patch: { seed: [{ name: "Ada" }, { name: "Grace" }, { name: "Edsger" }] },
    });
    expect(mountEl.querySelectorAll("tbody tr")).toHaveLength(3);
  });

  it("undo of a binding command restores the previous rendering", () => {
    const { kernel, mountEl } = setup([]);
    kernel.apply({ t: "UnbindProp", node: "label", prop: "text" });
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("fallback");
    kernel.undo();
    expect(mountEl.querySelector(".k-label")!.textContent).toBe("Hello");
  });
});

describe("P4 exit test — fine-grained table updates", () => {
  it("append to a 1,000-row bound store is O(1): one row, not the table", () => {
    const seed = Array.from({ length: 999 }, (_, i) => ({ name: `customer ${i}` }));
    const { mountEl, renderer } = setup(seed);
    const body = mountEl.querySelector("tbody")!;
    expect(body.children.length).toBe(999);
    const firstTr = body.children[0]!;
    const lastTr = body.children[998]!;

    const observer = new MutationObserver(() => {});
    observer.observe(mountEl.querySelector(".k-table")!, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    renderer.stateStore!.apply({ t: "append", path: "store.customers", value: { name: "customer 999" } });

    const records = observer.takeRecords();
    expect(records).toHaveLength(1); // exactly one mutation…
    expect(records[0]!.type).toBe("childList");
    expect(records[0]!.target).toBe(body); // …on the tbody…
    expect(records[0]!.addedNodes).toHaveLength(1); // …adding one <tr>
    expect(body.children.length).toBe(1000);
    expect(body.children[0]).toBe(firstTr); // existing rows untouched
    expect(body.children[998]).toBe(lastTr);
    expect(body.lastElementChild!.textContent).toBe("customer 999");

    // Past the cap: O(1) again — only the notice changes, no new rows.
    renderer.stateStore!.apply({ t: "append", path: "store.customers", value: { name: "overflow" } });
    const capRecords = observer.takeRecords();
    observer.disconnect();
    expect(body.children.length).toBe(1000);
    const notice = mountEl.querySelector(".k-table__notice")!;
    expect(notice.hasAttribute("hidden")).toBe(false);
    expect(notice.textContent).toBe("Showing 1000 of 1001 rows");
    for (const record of capRecords) {
      expect(record.target === notice || notice.contains(record.target)).toBe(true);
    }
  });

  it("removeWhere drops exactly the removed rows", () => {
    const seed = Array.from({ length: 5 }, (_, i) => ({ name: `r${i}` }));
    const { mountEl, renderer } = setup(seed);
    const body = mountEl.querySelector("tbody")!;
    const keep0 = body.children[0]!;
    const keep4 = body.children[4]!;

    renderer.stateStore!.apply({
      t: "removeWhere",
      path: "store.customers",
      pred: (row) => (row as { name: string }).name === "r2",
    });

    expect(body.children.length).toBe(4);
    expect(body.children[0]).toBe(keep0); // identities stable
    expect(body.children[3]).toBe(keep4);
    expect([...body.children].map((tr) => tr.textContent)).toEqual(["r0", "r1", "r3", "r4"]);
  });
});
