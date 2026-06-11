import { describe, expect, it } from "vitest";
import type { Node, NodeId } from "../src/kernel/types";
import {
  collectSubtree,
  currentParentOf,
  remapSubtree,
  subtreeIds,
} from "../src/shared/nodes";

// Copy/paste subtree semantics (§6): id-remapped, structure preserved,
// originals untouched.

const n = (id: string, children: string[] = []): Node => ({
  id,
  kind: "Container",
  props: {},
  styleProps: {},
  bindings: [],
  events: [],
  children,
});

const graph = (): Map<NodeId, Node> =>
  new Map(
    [n("root", ["a", "b"]), n("a", ["a1", "a2"]), n("a1"), n("a2"), n("b")].map((node) => [
      node.id,
      node,
    ]),
  );

describe("subtreeIds", () => {
  it("includes the node and all descendants", () => {
    expect([...subtreeIds(graph(), "a")].sort()).toEqual(["a", "a1", "a2"]);
    expect([...subtreeIds(graph(), "root")].sort()).toEqual(["a", "a1", "a2", "b", "root"]);
  });
});

describe("currentParentOf", () => {
  it("finds the parent, or undefined for roots", () => {
    expect(currentParentOf(graph(), "a1")?.id).toBe("a");
    expect(currentParentOf(graph(), "root")).toBeUndefined();
  });
});

describe("collectSubtree", () => {
  it("deep-clones the node and descendants", () => {
    const nodes = graph();
    const subtree = collectSubtree(nodes, "a");
    expect(subtree.node.id).toBe("a");
    expect(subtree.descendants.map((d) => d.id).sort()).toEqual(["a1", "a2"]);
    subtree.node.children.push("evil");
    expect(nodes.get("a")!.children).toEqual(["a1", "a2"]); // original untouched
  });
});

describe("remapSubtree", () => {
  it("remaps every id consistently, rewriting children", () => {
    const subtree = collectSubtree(graph(), "a");
    let i = 0;
    const remapped = remapSubtree(subtree, () => `new-${i++}`);
    expect(remapped.node.id).toBe("new-0");
    expect(remapped.node.children).toEqual(["new-1", "new-2"]);
    expect(remapped.descendants.map((d) => d.id)).toEqual(["new-1", "new-2"]);
    // originals untouched
    expect(subtree.node.id).toBe("a");
    expect(subtree.node.children).toEqual(["a1", "a2"]);
  });

  it("generates fresh unique ids by default", () => {
    const subtree = collectSubtree(graph(), "a");
    const remapped = remapSubtree(subtree);
    const ids = [remapped.node.id, ...remapped.descendants.map((d) => d.id)];
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain("a");
  });
});
