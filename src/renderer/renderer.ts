import type { GraphKernel } from "../kernel/kernel";
import type { GraphDelta } from "../kernel/commands";
import type { NodeId, PageId, Value } from "../kernel/types";
import type { Instance } from "../kit/kitdef";
import type { StateChange } from "../runtime/state";
import { StateStore, buildStateStore, pathsIntersect } from "../runtime/state";
import { KIT, resolveProps } from "../kit";
import { stylePropClass } from "../kit/styleprops";

// The framework-free renderer (BUILD_SPEC.md §6 preview path). It walks the
// graph to mount a page, then subscribes to kernel deltas and patches
// surgically: prop edits go through each KitDef's dependency-mapped patch,
// structural edits move real DOM nodes (no remount on MoveNode).
//
// P4 adds bindings: each rendered page gets a StateStore seeded from state
// decls and store seeds; bound props resolve from it and re-patch on
// StateWrites — incrementally where the KitDef offers applyWrite (Table).
// Events dispatch into the interpreter in P5 — here they surface through
// `onEvent`.

export type EventSink = (node: NodeId, event: string, payload: Value | null) => void;

interface BindingEntry {
  path: string;
  node: NodeId;
  prop: string;
}

export class Renderer {
  readonly instances = new Map<NodeId, Instance>();
  private elementIndex = new Map<Element, NodeId>();
  private styleClasses = new Map<NodeId, Map<string, string>>();
  private bindings: BindingEntry[] = [];
  private state: StateStore | null = null;
  private stateUnsub: (() => void) | null = null;
  private themeKeys: string[] = [];
  private pageId: PageId | null = null;
  private doc: Document;
  private unsubscribe: () => void;

  constructor(
    private kernel: GraphKernel,
    private mountEl: HTMLElement,
    private onEvent?: EventSink,
    private opts?: { initialStores?: Record<string, Value> },
  ) {
    this.doc = mountEl.ownerDocument;
    this.unsubscribe = kernel.subscribe((delta) => this.onDelta(delta));
  }

  destroy(): void {
    this.unsubscribe();
    this.clear();
  }

  get renderedPage(): PageId | null {
    return this.pageId;
  }

  // The live runtime state for the rendered page — the interpreter's write
  // target (P5) and the bind system's read source.
  get stateStore(): StateStore | null {
    return this.state;
  }

  // The live value of a value-bearing control — what an event wire's
  // nodeValue input source reads at dispatch.
  readNodeValue(id: NodeId): Value | undefined {
    const inst = this.instances.get(id);
    if (!inst) return undefined;
    return KIT[inst.kind].getValue?.(inst);
  }

  // Nearest mounted instance for a DOM element — the studio's hit-test for
  // selection and drag-and-drop.
  nodeIdForElement(el: Element | null): NodeId | null {
    let cur: Element | null = el;
    while (cur) {
      const id = this.elementIndex.get(cur);
      if (id !== undefined) return id;
      cur = cur.parentElement;
    }
    return null;
  }

  renderPage(pageId: PageId): void {
    this.clear();
    const page = this.kernel.state.pages.find((p) => p.id === pageId);
    if (!page) return;
    this.pageId = pageId;
    this.state = buildStateStore(this.kernel.state, pageId, this.opts?.initialStores);
    this.stateUnsub = this.state.subscribe((change) => this.onStateChange(change));
    this.applyTheme();
    this.mountEl.appendChild(this.mountNode(page.root).root);
  }

  private clear(): void {
    for (const inst of this.instances.values()) inst.destroy?.();
    this.instances.clear();
    this.elementIndex.clear();
    this.styleClasses.clear();
    this.bindings = [];
    this.stateUnsub?.();
    this.stateUnsub = null;
    this.state = null;
    this.mountEl.textContent = "";
    this.pageId = null;
  }

  // ── bindings ─────────────────────────────────────────────────────────────

  private onStateChange(change: StateChange): void {
    for (const binding of this.bindings) {
      if (!pathsIntersect(binding.path, change.path)) continue;
      const inst = this.instances.get(binding.node);
      if (!inst) continue;
      const def = KIT[inst.kind];
      if (binding.path === change.path && def.applyWrite?.(inst, binding.prop, change)) continue;
      this.repatchBinding(binding);
    }
  }

  // Re-resolve one bound prop: state value if it resolves, else the node's
  // own prop, else the schema default.
  private repatchBinding(binding: BindingEntry): void {
    const inst = this.instances.get(binding.node);
    const node = this.kernel.state.nodes.get(binding.node);
    if (!inst || !node) return;
    const def = KIT[inst.kind];
    const spec = def.props[binding.prop];
    if (!spec) return;
    const bound = this.state?.get(binding.path);
    const value =
      bound !== undefined
        ? bound
        : (node.props[binding.prop] ?? (structuredClone(spec.default) as Value));
    def.patch(inst, binding.prop, value);
  }

  // State shape changed (decls/stores/seeds) — rebuild the runtime store and
  // re-resolve every binding.
  private rebuildState(): void {
    if (!this.pageId) return;
    this.stateUnsub?.();
    this.state = buildStateStore(this.kernel.state, this.pageId, this.opts?.initialStores);
    this.stateUnsub = this.state.subscribe((change) => this.onStateChange(change));
    for (const binding of this.bindings) this.repatchBinding(binding);
  }

  private isBound(node: NodeId, prop: string): boolean {
    return this.bindings.some((b) => b.node === node && b.prop === prop);
  }

  private mountNode(id: NodeId): Instance {
    const node = this.kernel.state.nodes.get(id);
    if (!node) throw new Error(`renderer: unknown node ${id}`);
    const def = KIT[node.kind];
    const props = resolveProps(def, node.props);
    for (const binding of node.bindings) {
      if (!(binding.prop in def.props)) continue;
      const bound = this.state?.get(binding.path);
      if (bound !== undefined) props[binding.prop] = bound;
      this.bindings.push({ path: binding.path, node: id, prop: binding.prop });
    }
    const inst = def.mount({
      doc: this.doc,
      props,
      emit: (event, payload) => this.onEvent?.(id, event, payload),
    });
    this.instances.set(id, inst);
    this.elementIndex.set(inst.root, id);

    const applied = new Map<string, string>();
    for (const [key, value] of Object.entries(node.styleProps)) {
      const cls = stylePropClass(key, value);
      if (cls) {
        inst.root.classList.add(cls);
        applied.set(key, cls);
      }
    }
    this.styleClasses.set(id, applied);

    if (inst.slot) {
      for (const child of node.children) inst.slot.appendChild(this.mountNode(child).root);
    }
    return inst;
  }

  private destroyIds(ids: NodeId[]): void {
    const removed = new Set(ids);
    this.bindings = this.bindings.filter((b) => !removed.has(b.node));
    for (const id of ids) {
      const inst = this.instances.get(id);
      if (inst) {
        inst.destroy?.();
        this.elementIndex.delete(inst.root);
      }
      this.instances.delete(id);
      this.styleClasses.delete(id);
    }
  }

  private applyTheme(): void {
    for (const key of this.themeKeys) this.mountEl.style.removeProperty(`--${key}`);
    const theme = this.kernel.state.theme;
    this.themeKeys = Object.keys(theme);
    for (const key of this.themeKeys) this.mountEl.style.setProperty(`--${key}`, theme[key]!);
  }

  private onDelta({ cmd, inverse }: GraphDelta): void {
    if (!this.pageId) return;
    switch (cmd.t) {
      case "InsertNode": {
        const parent = this.instances.get(cmd.parent);
        if (!parent?.slot) return;
        const inst = this.mountNode(cmd.node.id);
        parent.slot.insertBefore(inst.root, parent.slot.children[cmd.index] ?? null);
        return;
      }
      case "RemoveNode": {
        const inst = this.instances.get(cmd.node);
        if (!inst) return;
        inst.root.remove();
        // The inverse carries the removed subtree — exactly the ids to clean up.
        const ids =
          inverse.t === "InsertNode"
            ? [inverse.node.id, ...(inverse.descendants?.map((d) => d.id) ?? [])]
            : [cmd.node];
        this.destroyIds(ids);
        return;
      }
      case "MoveNode": {
        const inst = this.instances.get(cmd.node);
        const target = this.instances.get(cmd.toParent);
        if (!inst || !target?.slot) return;
        inst.root.remove(); // match kernel splice semantics: remove, then index
        target.slot.insertBefore(inst.root, target.slot.children[cmd.toIndex] ?? null);
        return;
      }
      case "SetProp": {
        const inst = this.instances.get(cmd.node);
        if (!inst) return;
        if (this.isBound(cmd.node, cmd.key)) return; // the binding wins
        const def = KIT[inst.kind];
        const spec = def.props[cmd.key];
        if (!spec) return; // not a schema prop — nothing renders it
        const value =
          cmd.value === undefined ? (structuredClone(spec.default) as Value) : cmd.value;
        def.patch(inst, cmd.key, value);
        return;
      }
      case "BindProp": {
        if (!this.instances.has(cmd.node)) return;
        this.bindings = this.bindings.filter((b) => !(b.node === cmd.node && b.prop === cmd.prop));
        const entry: BindingEntry = { path: cmd.path, node: cmd.node, prop: cmd.prop };
        this.bindings.push(entry);
        this.repatchBinding(entry);
        return;
      }
      case "UnbindProp": {
        const inst = this.instances.get(cmd.node);
        this.bindings = this.bindings.filter((b) => !(b.node === cmd.node && b.prop === cmd.prop));
        if (!inst) return;
        const node = this.kernel.state.nodes.get(cmd.node);
        const def = KIT[inst.kind];
        const spec = def.props[cmd.prop];
        if (!node || !spec) return;
        def.patch(
          inst,
          cmd.prop,
          node.props[cmd.prop] ?? (structuredClone(spec.default) as Value),
        );
        return;
      }
      case "DeclareState":
      case "RemoveState": {
        if (cmd.page === this.pageId) this.rebuildState();
        return;
      }
      case "DeclareStore":
      case "EditStore":
      case "RemoveStore":
        this.rebuildState();
        return;
      case "SetStyleProp": {
        const inst = this.instances.get(cmd.node);
        if (!inst) return;
        const applied = this.styleClasses.get(cmd.node) ?? new Map<string, string>();
        const prev = applied.get(cmd.key);
        if (prev) {
          inst.root.classList.remove(prev);
          applied.delete(cmd.key);
        }
        const next = stylePropClass(cmd.key, cmd.value);
        if (next) {
          inst.root.classList.add(next);
          applied.set(cmd.key, next);
        }
        this.styleClasses.set(cmd.node, applied);
        return;
      }
      case "SetTheme":
        this.applyTheme();
        return;
      case "RemovePage":
        if (cmd.page === this.pageId) this.clear();
        return;
      default:
        // Contracts and event wires (P5), page edits — no visual effect here.
        return;
    }
  }
}
