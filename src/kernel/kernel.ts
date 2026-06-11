import type {
  Contract,
  ContractId,
  DataStore,
  Node,
  NodeId,
  Page,
  PageId,
  ProjectMeta,
  StoreId,
  ThemeTokens,
} from "./types";
import type { Command, ContractPatch, GraphDelta, StorePatch } from "./commands";
import { exportGraph, importGraph } from "./serialize";

export interface GraphState {
  graphVersion: 1;
  project: ProjectMeta;
  pages: Page[];
  nodes: Map<NodeId, Node>; // flat map — cheap moves, stable undo, O(1) lookup
  contracts: Contract[];
  stores: DataStore[];
  theme: ThemeTokens;
}

// MVP1 ships a fixed default token set (no theming editor).
export const DEFAULT_THEME: ThemeTokens = {
  "color-bg": "#ffffff",
  "color-danger": "#e5484d",
  "color-muted": "#6b7280",
  "color-primary": "#4f63f5",
  "color-surface": "#f4f5f7",
  "color-text": "#1c2024",
  "radius-md": "6px",
  "space-1": "4px",
  "space-2": "8px",
  "space-3": "16px",
};

export function createEmptyGraph(projectName: string): GraphState {
  return {
    graphVersion: 1,
    project: { name: projectName },
    pages: [],
    nodes: new Map(),
    contracts: [],
    stores: [],
    theme: { ...DEFAULT_THEME },
  };
}

interface UndoEntry {
  cmd: Command;
  inverse: Command;
  at: number;
}

const UNDO_DEPTH = 200;
const COALESCE_MS = 300;

function coalesces(prev: Command, next: Command): boolean {
  return (
    ((prev.t === "SetProp" && next.t === "SetProp") ||
      (prev.t === "SetStyleProp" && next.t === "SetStyleProp")) &&
    prev.node === next.node &&
    prev.key === next.key
  );
}

export class GraphKernel {
  readonly state: GraphState;
  private listeners = new Set<(delta: GraphDelta) => void>();
  private undoStack: UndoEntry[] = [];
  private redoStack: Array<{ cmd: Command; inverse: Command }> = [];
  private now: () => number;

  constructor(init?: { state?: GraphState; projectName?: string; now?: () => number }) {
    this.state = init?.state ?? createEmptyGraph(init?.projectName ?? "untitled");
    this.now = init?.now ?? (() => Date.now());
  }

  static fromJson(text: string, init?: { now?: () => number }): GraphKernel {
    return new GraphKernel({ state: importGraph(text), now: init?.now });
  }

  snapshotJson(): string {
    return exportGraph(this.state);
  }

  subscribe(fn: (delta: GraphDelta) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  get redoDepth(): number {
    return this.redoStack.length;
  }

  // All mutation goes through apply. Validation happens before any mutation,
  // so a thrown command leaves the graph untouched.
  apply(cmd: Command): GraphDelta {
    const inverse = this.exec(cmd);
    this.pushUndo(cmd, inverse);
    this.redoStack = [];
    const delta: GraphDelta = { cmd, inverse };
    this.emit(delta);
    return delta;
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const inverse = this.exec(entry.inverse);
    this.redoStack.push({ cmd: entry.cmd, inverse: entry.inverse });
    this.emit({ cmd: entry.inverse, inverse });
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const inverse = this.exec(entry.cmd);
    this.undoStack.push({ cmd: entry.cmd, inverse, at: this.now() });
    this.emit({ cmd: entry.cmd, inverse });
    return true;
  }

  private emit(delta: GraphDelta): void {
    for (const fn of this.listeners) fn(delta);
  }

  private pushUndo(cmd: Command, inverse: Command): void {
    const at = this.now();
    const last = this.undoStack[this.undoStack.length - 1];
    if (last && at - last.at <= COALESCE_MS && coalesces(last.cmd, cmd)) {
      last.cmd = cmd; // redo replays the latest edit; inverse keeps the oldest value
      last.at = at;
      return;
    }
    this.undoStack.push({ cmd, inverse, at });
    if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift();
  }

  // ── exec: the one place state mutates; returns the inverse command ──────

  private exec(cmd: Command): Command {
    switch (cmd.t) {
      case "InsertNode":
        return this.execInsertNode(cmd);
      case "RemoveNode":
        return this.execRemoveNode(cmd);
      case "MoveNode":
        return this.execMoveNode(cmd);
      case "SetProp":
        return this.execSetValue(cmd, "props");
      case "SetStyleProp":
        return this.execSetValue(cmd, "styleProps");
      case "BindProp":
        return this.execBindProp(cmd);
      case "UnbindProp":
        return this.execUnbindProp(cmd);
      case "WireEvent":
        return this.execWireEvent(cmd);
      case "UnwireEvent":
        return this.execUnwireEvent(cmd);
      case "DeclareState":
        return this.execDeclareState(cmd);
      case "RemoveState":
        return this.execRemoveState(cmd);
      case "DeclareStore":
        return this.execDeclareStore(cmd);
      case "EditStore":
        return this.execEditStore(cmd);
      case "RemoveStore":
        return this.execRemoveStore(cmd);
      case "AuthorContract":
        return this.execAuthorContract(cmd);
      case "EditContract":
        return this.execEditContract(cmd);
      case "RemoveContract":
        return this.execRemoveContract(cmd);
      case "FillBody":
        return this.execFillBody(cmd);
      case "SetTheme":
        return this.execSetTheme(cmd);
      case "AddPage":
        return this.execAddPage(cmd);
      case "EditPage":
        return this.execEditPage(cmd);
      case "RemovePage":
        return this.execRemovePage(cmd);
      default: {
        const exhaustive: never = cmd;
        throw new Error(`unknown command: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  // ── node tree ────────────────────────────────────────────────────────────

  private execInsertNode(cmd: Extract<Command, { t: "InsertNode" }>): Command {
    const parent = this.requireNode(cmd.parent);
    const descendants = cmd.descendants ?? [];
    if (this.state.nodes.has(cmd.node.id)) {
      throw new Error(`InsertNode: node ${cmd.node.id} already exists`);
    }
    for (const d of descendants) {
      if (this.state.nodes.has(d.id)) throw new Error(`InsertNode: node ${d.id} already exists`);
    }
    if (cmd.index < 0 || cmd.index > parent.children.length) {
      throw new Error(`InsertNode: index ${cmd.index} out of range`);
    }
    // Children of inserted nodes must resolve within the inserted set.
    const inserted = new Set([cmd.node.id, ...descendants.map((d) => d.id)]);
    for (const n of [cmd.node, ...descendants]) {
      for (const child of n.children) {
        if (!inserted.has(child)) {
          throw new Error(`InsertNode: node ${n.id} child ${child} not part of the inserted subtree`);
        }
      }
    }
    this.state.nodes.set(cmd.node.id, structuredClone(cmd.node));
    for (const d of descendants) this.state.nodes.set(d.id, structuredClone(d));
    parent.children.splice(cmd.index, 0, cmd.node.id);
    return { t: "RemoveNode", node: cmd.node.id };
  }

  private execRemoveNode(cmd: Extract<Command, { t: "RemoveNode" }>): Command {
    const node = this.requireNode(cmd.node);
    if (this.rootIds().has(node.id)) {
      throw new Error(`RemoveNode: ${node.id} is a page root; use RemovePage`);
    }
    const parent = this.findParentOf(node.id);
    if (!parent) throw new Error(`RemoveNode: node ${node.id} has no parent`);
    const index = parent.children.indexOf(node.id);
    const descendants = this.collectDescendants(node.id);
    parent.children.splice(index, 1);
    this.state.nodes.delete(node.id);
    for (const d of descendants) this.state.nodes.delete(d.id);
    return {
      t: "InsertNode",
      parent: parent.id,
      index,
      node,
      ...(descendants.length ? { descendants } : {}),
    };
  }

  private execMoveNode(cmd: Extract<Command, { t: "MoveNode" }>): Command {
    const node = this.requireNode(cmd.node);
    if (this.rootIds().has(node.id)) throw new Error(`MoveNode: ${node.id} is a page root`);
    const target = this.requireNode(cmd.toParent);
    if (cmd.toParent === cmd.node || this.isInSubtree(cmd.node, cmd.toParent)) {
      throw new Error(`MoveNode: cannot move ${cmd.node} into its own subtree`);
    }
    const oldParent = this.findParentOf(node.id);
    if (!oldParent) throw new Error(`MoveNode: node ${node.id} has no parent`);
    const oldIndex = oldParent.children.indexOf(node.id);
    const max = oldParent.id === target.id ? target.children.length - 1 : target.children.length;
    if (cmd.toIndex < 0 || cmd.toIndex > max) {
      throw new Error(`MoveNode: index ${cmd.toIndex} out of range`);
    }
    oldParent.children.splice(oldIndex, 1);
    target.children.splice(cmd.toIndex, 0, node.id);
    return { t: "MoveNode", node: cmd.node, toParent: oldParent.id, toIndex: oldIndex };
  }

  private execSetValue(
    cmd: Extract<Command, { t: "SetProp" | "SetStyleProp" }>,
    field: "props" | "styleProps",
  ): Command {
    const node = this.requireNode(cmd.node);
    const bag = node[field];
    const had = Object.prototype.hasOwnProperty.call(bag, cmd.key);
    const old = bag[cmd.key];
    if (cmd.value === undefined) delete bag[cmd.key];
    else bag[cmd.key] = structuredClone(cmd.value);
    return {
      t: cmd.t,
      node: cmd.node,
      key: cmd.key,
      ...(had ? { value: structuredClone(old) } : {}),
    };
  }

  private execBindProp(cmd: Extract<Command, { t: "BindProp" }>): Command {
    const node = this.requireNode(cmd.node);
    const existing = node.bindings.findIndex((b) => b.prop === cmd.prop);
    if (existing >= 0) {
      const old = node.bindings[existing]!;
      node.bindings[existing] = { prop: cmd.prop, path: cmd.path };
      return { t: "BindProp", node: cmd.node, prop: cmd.prop, path: old.path, index: existing };
    }
    const index = cmd.index ?? node.bindings.length;
    if (index < 0 || index > node.bindings.length) {
      throw new Error(`BindProp: index ${index} out of range`);
    }
    node.bindings.splice(index, 0, { prop: cmd.prop, path: cmd.path });
    return { t: "UnbindProp", node: cmd.node, prop: cmd.prop };
  }

  private execUnbindProp(cmd: Extract<Command, { t: "UnbindProp" }>): Command {
    const node = this.requireNode(cmd.node);
    const index = node.bindings.findIndex((b) => b.prop === cmd.prop);
    if (index < 0) throw new Error(`UnbindProp: ${cmd.node}.${cmd.prop} is not bound`);
    const [old] = node.bindings.splice(index, 1);
    return { t: "BindProp", node: cmd.node, prop: cmd.prop, path: old!.path, index };
  }

  private execWireEvent(cmd: Extract<Command, { t: "WireEvent" }>): Command {
    // Deliberately no cross-entity validation here: RemoveContract/RemoveNode
    // do not cascade into wires, so wires may dangle and the editor flags
    // orphans (P5 exit test). Validating existence would make forward-valid
    // sessions impossible to undo in reverse order.
    const node = this.requireNode(cmd.node);
    const existing = node.events.findIndex((w) => w.event === cmd.wire.event);
    if (existing >= 0) {
      const old = node.events[existing]!;
      node.events[existing] = structuredClone(cmd.wire);
      return { t: "WireEvent", node: cmd.node, wire: old, index: existing };
    }
    const index = cmd.index ?? node.events.length;
    if (index < 0 || index > node.events.length) {
      throw new Error(`WireEvent: index ${index} out of range`);
    }
    node.events.splice(index, 0, structuredClone(cmd.wire));
    return { t: "UnwireEvent", node: cmd.node, event: cmd.wire.event };
  }

  private execUnwireEvent(cmd: Extract<Command, { t: "UnwireEvent" }>): Command {
    const node = this.requireNode(cmd.node);
    const index = node.events.findIndex((w) => w.event === cmd.event);
    if (index < 0) throw new Error(`UnwireEvent: ${cmd.node} has no wire for ${cmd.event}`);
    const [old] = node.events.splice(index, 1);
    return { t: "WireEvent", node: cmd.node, wire: old!, index };
  }

  // ── page state and stores ────────────────────────────────────────────────

  private execDeclareState(cmd: Extract<Command, { t: "DeclareState" }>): Command {
    const page = this.requirePage(cmd.page);
    if (page.state.some((s) => s.name === cmd.decl.name)) {
      throw new Error(`DeclareState: ${cmd.decl.name} already declared on ${cmd.page}`);
    }
    const index = cmd.index ?? page.state.length;
    if (index < 0 || index > page.state.length) {
      throw new Error(`DeclareState: index ${index} out of range`);
    }
    page.state.splice(index, 0, structuredClone(cmd.decl));
    return { t: "RemoveState", page: cmd.page, name: cmd.decl.name };
  }

  private execRemoveState(cmd: Extract<Command, { t: "RemoveState" }>): Command {
    const page = this.requirePage(cmd.page);
    const index = page.state.findIndex((s) => s.name === cmd.name);
    if (index < 0) throw new Error(`RemoveState: ${cmd.name} is not declared on ${cmd.page}`);
    const [old] = page.state.splice(index, 1);
    return { t: "DeclareState", page: cmd.page, decl: old!, index };
  }

  private execDeclareStore(cmd: Extract<Command, { t: "DeclareStore" }>): Command {
    if (this.state.stores.some((s) => s.id === cmd.store.id)) {
      throw new Error(`DeclareStore: ${cmd.store.id} already exists`);
    }
    const index = cmd.index ?? this.state.stores.length;
    if (index < 0 || index > this.state.stores.length) {
      throw new Error(`DeclareStore: index ${index} out of range`);
    }
    this.state.stores.splice(index, 0, structuredClone(cmd.store));
    return { t: "RemoveStore", store: cmd.store.id };
  }

  private execEditStore(cmd: Extract<Command, { t: "EditStore" }>): Command {
    const store = this.requireStore(cmd.store);
    const inverse: StorePatch = {};
    if (cmd.patch.name !== undefined) {
      inverse.name = store.name;
      store.name = cmd.patch.name;
    }
    if (cmd.patch.schema !== undefined) {
      inverse.schema = store.schema;
      store.schema = structuredClone(cmd.patch.schema);
    }
    if (cmd.patch.seed !== undefined) {
      inverse.seed = store.seed === undefined ? null : store.seed;
      if (cmd.patch.seed === null) delete store.seed;
      else store.seed = structuredClone(cmd.patch.seed);
    }
    return { t: "EditStore", store: cmd.store, patch: inverse };
  }

  private execRemoveStore(cmd: Extract<Command, { t: "RemoveStore" }>): Command {
    const index = this.state.stores.findIndex((s) => s.id === cmd.store);
    if (index < 0) throw new Error(`RemoveStore: unknown store ${cmd.store}`);
    const [old] = this.state.stores.splice(index, 1);
    return { t: "DeclareStore", store: old!, index };
  }

  // ── contracts ────────────────────────────────────────────────────────────

  private execAuthorContract(cmd: Extract<Command, { t: "AuthorContract" }>): Command {
    if (this.state.contracts.some((c) => c.id === cmd.contract.id)) {
      throw new Error(`AuthorContract: ${cmd.contract.id} already exists`);
    }
    const index = cmd.index ?? this.state.contracts.length;
    if (index < 0 || index > this.state.contracts.length) {
      throw new Error(`AuthorContract: index ${index} out of range`);
    }
    this.state.contracts.splice(index, 0, structuredClone(cmd.contract));
    return { t: "RemoveContract", contract: cmd.contract.id };
  }

  private execEditContract(cmd: Extract<Command, { t: "EditContract" }>): Command {
    const contract = this.requireContract(cmd.contract);
    const inverse: ContractPatch = {};
    if (cmd.patch.name !== undefined) {
      inverse.name = contract.name;
      contract.name = cmd.patch.name;
    }
    if (cmd.patch.signature !== undefined) {
      inverse.signature = contract.signature;
      contract.signature = structuredClone(cmd.patch.signature);
    }
    if (cmd.patch.grants !== undefined) {
      inverse.grants = contract.grants;
      contract.grants = structuredClone(cmd.patch.grants);
    }
    if (cmd.patch.predicates !== undefined) {
      inverse.predicates = contract.predicates;
      contract.predicates = structuredClone(cmd.patch.predicates);
    }
    return { t: "EditContract", contract: cmd.contract, patch: inverse };
  }

  private execRemoveContract(cmd: Extract<Command, { t: "RemoveContract" }>): Command {
    const index = this.state.contracts.findIndex((c) => c.id === cmd.contract);
    if (index < 0) throw new Error(`RemoveContract: unknown contract ${cmd.contract}`);
    const [old] = this.state.contracts.splice(index, 1);
    return { t: "AuthorContract", contract: old!, index };
  }

  private execFillBody(cmd: Extract<Command, { t: "FillBody" }>): Command {
    const contract = this.requireContract(cmd.contract);
    const old = contract.body;
    contract.body = structuredClone(cmd.body);
    return { t: "FillBody", contract: cmd.contract, body: old };
  }

  // ── theme and pages ──────────────────────────────────────────────────────

  private execSetTheme(cmd: Extract<Command, { t: "SetTheme" }>): Command {
    const old = this.state.theme;
    this.state.theme = structuredClone(cmd.theme);
    return { t: "SetTheme", theme: old };
  }

  private execAddPage(cmd: Extract<Command, { t: "AddPage" }>): Command {
    if (this.state.pages.some((p) => p.id === cmd.page.id)) {
      throw new Error(`AddPage: ${cmd.page.id} already exists`);
    }
    const byId = new Map(cmd.nodes.map((n) => [n.id, n]));
    if (!byId.has(cmd.page.root)) {
      throw new Error(`AddPage: nodes must include the page root ${cmd.page.root}`);
    }
    for (const n of cmd.nodes) {
      if (this.state.nodes.has(n.id)) throw new Error(`AddPage: node ${n.id} already exists`);
      for (const child of n.children) {
        if (!byId.has(child)) {
          throw new Error(`AddPage: node ${n.id} child ${child} not part of the page subtree`);
        }
      }
    }
    const index = cmd.index ?? this.state.pages.length;
    if (index < 0 || index > this.state.pages.length) {
      throw new Error(`AddPage: index ${index} out of range`);
    }
    for (const n of cmd.nodes) this.state.nodes.set(n.id, structuredClone(n));
    this.state.pages.splice(index, 0, structuredClone(cmd.page));
    return { t: "RemovePage", page: cmd.page.id };
  }

  private execEditPage(cmd: Extract<Command, { t: "EditPage" }>): Command {
    const page = this.requirePage(cmd.page);
    const old = page.route;
    page.route = cmd.route;
    return { t: "EditPage", page: cmd.page, route: old };
  }

  private execRemovePage(cmd: Extract<Command, { t: "RemovePage" }>): Command {
    const index = this.state.pages.findIndex((p) => p.id === cmd.page);
    if (index < 0) throw new Error(`RemovePage: unknown page ${cmd.page}`);
    const page = this.state.pages[index]!;
    const root = this.requireNode(page.root);
    const descendants = this.collectDescendants(page.root);
    this.state.pages.splice(index, 1);
    this.state.nodes.delete(root.id);
    for (const d of descendants) this.state.nodes.delete(d.id);
    return { t: "AddPage", page, nodes: [root, ...descendants], index };
  }

  // ── lookups ──────────────────────────────────────────────────────────────

  private requireNode(id: NodeId): Node {
    const node = this.state.nodes.get(id);
    if (!node) throw new Error(`unknown node ${id}`);
    return node;
  }

  private requirePage(id: PageId): Page {
    const page = this.state.pages.find((p) => p.id === id);
    if (!page) throw new Error(`unknown page ${id}`);
    return page;
  }

  private requireStore(id: StoreId): DataStore {
    const store = this.state.stores.find((s) => s.id === id);
    if (!store) throw new Error(`unknown store ${id}`);
    return store;
  }

  private requireContract(id: ContractId): Contract {
    const contract = this.state.contracts.find((c) => c.id === id);
    if (!contract) throw new Error(`unknown contract ${id}`);
    return contract;
  }

  private rootIds(): Set<NodeId> {
    return new Set(this.state.pages.map((p) => p.root));
  }

  private findParentOf(id: NodeId): Node | undefined {
    for (const node of this.state.nodes.values()) {
      if (node.children.includes(id)) return node;
    }
    return undefined;
  }

  private collectDescendants(id: NodeId): Node[] {
    const out: Node[] = [];
    const visit = (nid: NodeId) => {
      for (const child of this.requireNode(nid).children) {
        out.push(this.requireNode(child));
        visit(child);
      }
    };
    visit(id);
    return out;
  }

  private isInSubtree(rootId: NodeId, id: NodeId): boolean {
    if (rootId === id) return true;
    const node = this.state.nodes.get(rootId);
    if (!node) return false;
    return node.children.some((child) => this.isInSubtree(child, id));
  }
}
