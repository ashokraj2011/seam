import type {
  Contract,
  DataStore,
  Node,
  NodeId,
  Page,
  ProjectMeta,
  ThemeTokens,
} from "./types";
import type { GraphState } from "./kernel";

// graph.json is the contract between the TS kernel (MVP1) and the Rust
// kernel (MVP2). Serialization is canonical from day one — stable key order,
// stable array order — so round-trips are byte-stable (§9 gate).

export interface DesignGraphJson {
  graphVersion: 1;
  project: ProjectMeta;
  pages: Page[];
  nodes: Record<NodeId, Node>;
  contracts: Contract[];
  stores: DataStore[];
  theme: ThemeTokens;
}

export function canonicalStringify(value: unknown, indent = 2): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v instanceof Map) throw new Error("canonicalStringify: convert Maps to plain objects first");
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        const entry = (v as Record<string, unknown>)[key];
        if (entry !== undefined) out[key] = sort(entry);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, indent) + "\n";
}

export function exportGraph(state: GraphState): string {
  const json: DesignGraphJson = {
    graphVersion: state.graphVersion,
    project: state.project,
    pages: state.pages,
    nodes: Object.fromEntries(state.nodes),
    contracts: state.contracts,
    stores: state.stores,
    theme: state.theme,
  };
  return canonicalStringify(json);
}

export function importGraph(text: string): GraphState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("graph.json is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("graph.json must be a JSON object");
  }
  const j = raw as Partial<DesignGraphJson>;
  if (j.graphVersion !== 1) {
    throw new Error(`unsupported graphVersion: ${String(j.graphVersion)} (expected 1)`);
  }
  if (!j.project || typeof j.project !== "object" || typeof j.project.name !== "string") {
    throw new Error("graph.json: missing project.name");
  }
  if (!Array.isArray(j.pages) || !Array.isArray(j.contracts) || !Array.isArray(j.stores)) {
    throw new Error("graph.json: pages, contracts, and stores must be arrays");
  }
  if (!j.nodes || typeof j.nodes !== "object" || Array.isArray(j.nodes)) {
    throw new Error("graph.json: nodes must be an object map");
  }
  if (!j.theme || typeof j.theme !== "object" || Array.isArray(j.theme)) {
    throw new Error("graph.json: theme must be an object");
  }

  const cloned = structuredClone(j) as DesignGraphJson;
  const nodes = new Map<NodeId, Node>(Object.entries(cloned.nodes));

  // Referential integrity: every page root and every child id must resolve.
  for (const page of cloned.pages) {
    if (!nodes.has(page.root)) {
      throw new Error(`graph.json: page ${page.id} root ${page.root} is missing from nodes`);
    }
  }
  for (const node of nodes.values()) {
    for (const child of node.children) {
      if (!nodes.has(child)) {
        throw new Error(`graph.json: node ${node.id} child ${child} is missing from nodes`);
      }
    }
  }

  return {
    graphVersion: 1,
    project: cloned.project,
    pages: cloned.pages,
    nodes,
    contracts: cloned.contracts,
    stores: cloned.stores,
    theme: cloned.theme,
  };
}
