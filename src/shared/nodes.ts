import type { ComponentKind, Node, NodeId, Value } from "../kernel/types";

let seq = 0;
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function blankNode(kind: ComponentKind, props: Record<string, Value> = {}): Node {
  return {
    id: newId(kind.toLowerCase()),
    kind,
    props,
    styleProps: {},
    bindings: [],
    events: [],
    children: [],
  };
}

export function subtreeIds(nodes: ReadonlyMap<NodeId, Node>, id: NodeId): Set<NodeId> {
  const out = new Set<NodeId>([id]);
  const visit = (nid: NodeId) => {
    const node = nodes.get(nid);
    if (!node) return;
    for (const child of node.children) {
      out.add(child);
      visit(child);
    }
  };
  visit(id);
  return out;
}

export function currentParentOf(nodes: ReadonlyMap<NodeId, Node>, id: NodeId): Node | undefined {
  for (const node of nodes.values()) {
    if (node.children.includes(id)) return node;
  }
  return undefined;
}

export interface Subtree {
  node: Node;
  descendants: Node[];
}

// Deep-cloned copy of a node and its descendants, straight from the graph.
export function collectSubtree(nodes: ReadonlyMap<NodeId, Node>, id: NodeId): Subtree {
  const root = nodes.get(id);
  if (!root) throw new Error(`unknown node ${id}`);
  const descendants: Node[] = [];
  const visit = (nid: NodeId) => {
    for (const child of nodes.get(nid)!.children) {
      descendants.push(structuredClone(nodes.get(child)!));
      visit(child);
    }
  };
  visit(id);
  return { node: structuredClone(root), descendants };
}

// Fresh ids for a whole subtree, children arrays rewritten consistently —
// the §6 copy/paste semantics. makeId is injectable for deterministic tests.
export function remapSubtree(
  subtree: Subtree,
  makeId: (node: Node) => string = (n) => newId(n.kind.toLowerCase()),
): Subtree {
  const all = [subtree.node, ...subtree.descendants];
  const idMap = new Map(all.map((n) => [n.id, makeId(n)]));
  const remap = (n: Node): Node => ({
    ...structuredClone(n),
    id: idMap.get(n.id)!,
    children: n.children.map((c) => idMap.get(c)!),
  });
  return { node: remap(subtree.node), descendants: subtree.descendants.map(remap) };
}
