import { describe, expect, it } from "vitest";
import type { StateChange } from "../src/runtime/state";
import { StateStore, buildStateStore, pathsIntersect } from "../src/runtime/state";

describe("pathsIntersect", () => {
  it("matches exact, ancestor, and descendant paths segment-wise", () => {
    expect(pathsIntersect("state.form", "state.form")).toBe(true);
    expect(pathsIntersect("state.form", "state.form.name")).toBe(true);
    expect(pathsIntersect("state.form.name", "state.form")).toBe(true);
    expect(pathsIntersect("state.form", "state.formal")).toBe(false);
    expect(pathsIntersect("state.a", "store.a")).toBe(false);
  });
});

describe("StateStore", () => {
  const make = () =>
    new StateStore([
      ["state.greeting", "Hello"],
      ["state.form", { name: "", email: "" }],
      ["store.customers", [{ name: "Ada" }, { name: "Grace" }]],
    ]);

  it("gets root and nested paths", () => {
    const s = make();
    expect(s.get("state.greeting")).toBe("Hello");
    expect(s.get("state.form.name")).toBe("");
    expect(s.get("state.form.missing")).toBeUndefined();
    expect(s.get("store.customers")).toHaveLength(2);
  });

  it("clones initial entries — graph seeds stay untouched", () => {
    const seed = [{ name: "Ada" }];
    const s = new StateStore([["store.x", seed]]);
    s.apply({ t: "append", path: "store.x", value: { name: "Grace" } });
    expect(seed).toHaveLength(1);
  });

  it("set writes roots and nested keys", () => {
    const s = make();
    s.apply({ t: "set", path: "state.greeting", value: "Hi" });
    expect(s.get("state.greeting")).toBe("Hi");
    s.apply({ t: "set", path: "state.form.name", value: "Ada" });
    expect(s.get("state.form.name")).toBe("Ada");
  });

  it("append pushes to lists and reports the new value", () => {
    const s = make();
    const change = s.apply({ t: "append", path: "store.customers", value: { name: "Edsger" } });
    expect(s.get("store.customers")).toHaveLength(3);
    expect((change.value as unknown[]).length).toBe(3);
  });

  it("removeWhere reports removed indices", () => {
    const s = make();
    const change = s.apply({
      t: "removeWhere",
      path: "store.customers",
      pred: (row) => (row as { name: string }).name === "Ada",
    });
    expect(change.removedIndices).toEqual([0]);
    expect(s.get("store.customers")).toEqual([{ name: "Grace" }]);
  });

  it("merge shallow-merges records", () => {
    const s = make();
    s.apply({ t: "merge", path: "state.form", value: { name: "Ada" } });
    expect(s.get("state.form")).toEqual({ name: "Ada", email: "" });
  });

  it("rejects writes to undeclared roots and type mismatches", () => {
    const s = make();
    expect(() => s.apply({ t: "set", path: "state.ghost", value: 1 })).toThrow(/unknown/);
    expect(() => s.apply({ t: "append", path: "state.greeting", value: 1 })).toThrow(/not a list/);
    expect(() => s.apply({ t: "merge", path: "store.customers", value: {} })).toThrow(/not a record/);
    expect(() => s.get("state")).toThrow(/state path/);
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const s = make();
    const seen: StateChange[] = [];
    const unsub = s.subscribe((c) => seen.push(c));
    s.apply({ t: "set", path: "state.greeting", value: "Hi" });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.path).toBe("state.greeting");
    unsub();
    s.apply({ t: "set", path: "state.greeting", value: "Yo" });
    expect(seen).toHaveLength(1);
  });
});

describe("buildStateStore", () => {
  it("seeds page state decls and store rows", () => {
    const s = buildStateStore(
      {
        pages: [
          { id: "p1", route: "/", root: "r", state: [{ name: "count", type: "number", initial: 7 }] },
          { id: "p2", route: "/x", root: "r2", state: [{ name: "other", type: "string", initial: "" }] },
        ],
        stores: [{ id: "s1", name: "customers", schema: [], seed: [{ name: "Ada" }] }],
      },
      "p1",
    );
    expect(s.get("state.count")).toBe(7);
    expect(s.get("store.customers")).toEqual([{ name: "Ada" }]);
    expect(s.keys()).not.toContain("state.other"); // other page's state
  });
});
