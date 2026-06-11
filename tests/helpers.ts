import { GraphKernel } from "../src/kernel/kernel";
import type { Command, StorePatch } from "../src/kernel/commands";
import type {
  ComponentKind,
  Contract,
  Grant,
  InputSource,
  Node,
  NodeId,
} from "../src/kernel/types";

// Deterministic PRNG so every fuzz failure is reproducible by seed.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Ids {
  private n = 0;
  next(prefix: string): string {
    return `${prefix}-${this.n++}`;
  }
}

export interface Ctx {
  kernel: GraphKernel;
  rand: () => number;
  ids: Ids;
}

export function makeCtx(seed: number): Ctx {
  const rand = mulberry32(seed);
  let t = 0;
  // Monotonic fake clock, 1s steps — fuzz sessions never coalesce, so every
  // command gets its own undo entry (coalescing has its own dedicated test).
  const kernel = new GraphKernel({ projectName: "fuzz", now: () => (t += 1000) });
  return { kernel, rand, ids: new Ids() };
}

export const pick = <T,>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (rand: () => number, n: number): number => Math.floor(rand() * n);

const KINDS: ComponentKind[] = [
  "Label", "Button", "TextInput", "NumberInput", "Checkbox", "Select",
  "TextArea", "Container", "Card", "Table", "Modal", "Toast",
];
const PROP_KEYS = ["text", "title", "placeholder", "value", "rows"];
const STYLE_KEYS = ["gap", "pad", "radius", "color"];
const EVENTS = ["click", "change", "row-click"];

export function blankNode(ids: Ids, rand: () => number): Node {
  return {
    id: ids.next("n"),
    kind: pick(rand, KINDS),
    props: {},
    styleProps: {},
    bindings: [],
    events: [],
    children: [],
  };
}

function inSubtree(kernel: GraphKernel, rootId: NodeId, id: NodeId): boolean {
  if (rootId === id) return true;
  const node = kernel.state.nodes.get(rootId);
  if (!node) return false;
  return node.children.some((child) => inSubtree(kernel, child, id));
}

function parentOf(kernel: GraphKernel, id: NodeId): Node | undefined {
  for (const node of kernel.state.nodes.values()) {
    if (node.children.includes(id)) return node;
  }
  return undefined;
}

// ── per-command generators: return null when not applicable ────────────────

function genAddPage({ rand, ids }: Ctx): Command {
  const root: Node = {
    id: ids.next("n"),
    kind: "Container",
    props: {},
    styleProps: {},
    bindings: [],
    events: [],
    children: [],
  };
  return {
    t: "AddPage",
    page: { id: ids.next("p"), route: `/${ids.next("r")}`, root: root.id, state: [] },
    nodes: [root],
  };
}

function genInsertNode(ctx: Ctx): Command | null {
  const all = [...ctx.kernel.state.nodes.values()];
  if (!all.length) return null;
  const parent = pick(ctx.rand, all);
  return {
    t: "InsertNode",
    parent: parent.id,
    index: int(ctx.rand, parent.children.length + 1),
    node: blankNode(ctx.ids, ctx.rand),
  };
}

function nonRootIds(ctx: Ctx): NodeId[] {
  const roots = new Set(ctx.kernel.state.pages.map((p) => p.root));
  return [...ctx.kernel.state.nodes.keys()].filter((id) => !roots.has(id));
}

function genRemoveNode(ctx: Ctx): Command | null {
  const candidates = nonRootIds(ctx);
  if (!candidates.length) return null;
  return { t: "RemoveNode", node: pick(ctx.rand, candidates) };
}

function genMoveNode(ctx: Ctx): Command | null {
  const movable = nonRootIds(ctx);
  if (!movable.length) return null;
  const node = pick(ctx.rand, movable);
  const targets = [...ctx.kernel.state.nodes.keys()].filter(
    (id) => !inSubtree(ctx.kernel, node, id),
  );
  if (!targets.length) return null;
  const toParent = pick(ctx.rand, targets);
  const target = ctx.kernel.state.nodes.get(toParent)!;
  const parent = parentOf(ctx.kernel, node)!;
  const max = parent.id === toParent ? target.children.length - 1 : target.children.length;
  return { t: "MoveNode", node, toParent, toIndex: int(ctx.rand, max + 1) };
}

function genSetValue(ctx: Ctx, t: "SetProp" | "SetStyleProp"): Command | null {
  const all = [...ctx.kernel.state.nodes.keys()];
  if (!all.length) return null;
  const node = pick(ctx.rand, all);
  const key = pick(ctx.rand, t === "SetProp" ? PROP_KEYS : STYLE_KEYS);
  if (ctx.rand() < 0.15) return { t, node, key }; // unset
  const r = ctx.rand();
  const value = r < 0.5 ? pick(ctx.rand, ["save", "hello", "x", ""]) : r < 0.8 ? int(ctx.rand, 100) : ctx.rand() < 0.5;
  return { t, node, key, value };
}

function genBindProp(ctx: Ctx): Command | null {
  const all = [...ctx.kernel.state.nodes.keys()];
  if (!all.length) return null;
  return {
    t: "BindProp",
    node: pick(ctx.rand, all),
    prop: pick(ctx.rand, PROP_KEYS),
    path: `state.s${int(ctx.rand, 5)}`,
  };
}

function genUnbindProp(ctx: Ctx): Command | null {
  const bound = [...ctx.kernel.state.nodes.values()].filter((n) => n.bindings.length);
  if (!bound.length) return null;
  const node = pick(ctx.rand, bound);
  return { t: "UnbindProp", node: node.id, prop: pick(ctx.rand, node.bindings).prop };
}

function genWireEvent(ctx: Ctx): Command | null {
  const s = ctx.kernel.state;
  if (!s.contracts.length || !s.nodes.size) return null;
  const all = [...s.nodes.keys()];
  const inputs: Record<string, InputSource> = {};
  if (ctx.rand() < 0.7) {
    const kind = int(ctx.rand, 4);
    inputs[`in${int(ctx.rand, 3)}`] =
      kind === 0
        ? { t: "nodeValue", node: pick(ctx.rand, all) }
        : kind === 1
          ? { t: "statePath", path: "state.a" }
          : kind === 2
            ? { t: "payloadField", field: "row" }
            : { t: "literal", value: "v" };
  }
  return {
    t: "WireEvent",
    node: pick(ctx.rand, all),
    wire: { event: pick(ctx.rand, EVENTS), contract: pick(ctx.rand, s.contracts).id, inputs },
  };
}

function genUnwireEvent(ctx: Ctx): Command | null {
  const wired = [...ctx.kernel.state.nodes.values()].filter((n) => n.events.length);
  if (!wired.length) return null;
  const node = pick(ctx.rand, wired);
  return { t: "UnwireEvent", node: node.id, event: pick(ctx.rand, node.events).event };
}

function genDeclareState(ctx: Ctx): Command | null {
  const s = ctx.kernel.state;
  if (!s.pages.length) return null;
  const type = pick(ctx.rand, ["string", "number", "bool"] as const);
  const initial = type === "string" ? "x" : type === "number" ? 1 : true;
  return {
    t: "DeclareState",
    page: pick(ctx.rand, s.pages).id,
    decl: { name: ctx.ids.next("st"), type, initial },
  };
}

function genRemoveState(ctx: Ctx): Command | null {
  const withState = ctx.kernel.state.pages.filter((p) => p.state.length);
  if (!withState.length) return null;
  const page = pick(ctx.rand, withState);
  return { t: "RemoveState", page: page.id, name: pick(ctx.rand, page.state).name };
}

function genDeclareStore(ctx: Ctx): Command {
  return {
    t: "DeclareStore",
    store: {
      id: ctx.ids.next("store"),
      name: ctx.ids.next("Store"),
      schema: [
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
      ...(ctx.rand() < 0.5 ? { seed: [{ name: "Ada", email: "ada@example.com" }] } : {}),
    },
  };
}

function genEditStore(ctx: Ctx): Command | null {
  const stores = ctx.kernel.state.stores;
  if (!stores.length) return null;
  const which = int(ctx.rand, 4);
  const patch: StorePatch =
    which === 0
      ? { name: ctx.ids.next("Store") }
      : which === 1
        ? { schema: [{ name: "name", type: "string" }, { name: ctx.ids.next("f"), type: "number" }] }
        : which === 2
          ? { seed: [{ name: "Grace" }] }
          : { seed: null };
  return { t: "EditStore", store: pick(ctx.rand, stores).id, patch };
}

function genRemoveStore(ctx: Ctx): Command | null {
  const stores = ctx.kernel.state.stores;
  if (!stores.length) return null;
  return { t: "RemoveStore", store: pick(ctx.rand, stores).id };
}

function genAuthorContract(ctx: Ctx): Command {
  const s = ctx.kernel.state;
  const grants: Grant[] = [{ t: "toast" }];
  if (s.stores.length && ctx.rand() < 0.7) {
    grants.push({ t: "kv", store: pick(ctx.rand, s.stores).id, mode: ctx.rand() < 0.5 ? "r" : "rw" });
  }
  const contract: Contract = {
    id: ctx.ids.next("ct"),
    name: ctx.ids.next("contract"),
    signature: {
      inputs: [{ name: "name", type: "string" }],
      result: ctx.rand() < 0.5 ? { t: "ok" } : { t: "error" },
    },
    grants,
    predicates: [],
    body: { t: "unfilled" },
  };
  return { t: "AuthorContract", contract };
}

function genEditContract(ctx: Ctx): Command | null {
  const contracts = ctx.kernel.state.contracts;
  if (!contracts.length) return null;
  const which = int(ctx.rand, 3);
  const patch =
    which === 0
      ? { name: ctx.ids.next("contract") }
      : which === 1
        ? { predicates: [{ t: "nonEmpty", field: "name" } as const] }
        : { grants: [{ t: "nav" } as const, { t: "clock" } as const] };
  return { t: "EditContract", contract: pick(ctx.rand, contracts).id, patch };
}

function genRemoveContract(ctx: Ctx): Command | null {
  const contracts = ctx.kernel.state.contracts;
  if (!contracts.length) return null;
  return { t: "RemoveContract", contract: pick(ctx.rand, contracts).id };
}

function genFillBody(ctx: Ctx): Command | null {
  const contracts = ctx.kernel.state.contracts;
  if (!contracts.length) return null;
  const body =
    ctx.rand() < 0.7
      ? { t: "actionIr" as const, seq: [{ t: "Toast" as const, template: "saved" }] }
      : { t: "unfilled" as const };
  return { t: "FillBody", contract: pick(ctx.rand, contracts).id, body };
}

function genSetTheme(ctx: Ctx): Command {
  return {
    t: "SetTheme",
    theme: {
      "color-primary": pick(ctx.rand, ["#111111", "#4f63f5", "#0a7a3d"]),
      "space-1": "4px",
    },
  };
}

function genEditPage(ctx: Ctx): Command | null {
  const pages = ctx.kernel.state.pages;
  if (!pages.length) return null;
  return { t: "EditPage", page: pick(ctx.rand, pages).id, route: `/${ctx.ids.next("r")}` };
}

function genRemovePage(ctx: Ctx): Command | null {
  const pages = ctx.kernel.state.pages;
  if (!pages.length) return null;
  return { t: "RemovePage", page: pick(ctx.rand, pages).id };
}

// ── weighted dispatch over every command type ──────────────────────────────

const GENERATORS: Array<[number, (ctx: Ctx) => Command | null]> = [
  [6, genInsertNode],
  [2, genRemoveNode],
  [2, genMoveNode],
  [8, (ctx) => genSetValue(ctx, "SetProp")],
  [3, (ctx) => genSetValue(ctx, "SetStyleProp")],
  [2, genBindProp],
  [1, genUnbindProp],
  [2, genWireEvent],
  [1, genUnwireEvent],
  [2, genDeclareState],
  [1, genRemoveState],
  [2, genDeclareStore],
  [1.5, genEditStore],
  [0.7, genRemoveStore],
  [2, genAuthorContract],
  [1, genEditContract],
  [0.5, genRemoveContract],
  [2, genFillBody],
  [1, genSetTheme],
  [1, genAddPage],
  [1, genEditPage],
  [0.3, genRemovePage],
];

export function genCommand(ctx: Ctx): Command {
  if (ctx.kernel.state.pages.length === 0) return genAddPage(ctx);
  const total = GENERATORS.reduce((sum, [w]) => sum + w, 0);
  for (let attempt = 0; attempt < 50; attempt++) {
    let r = ctx.rand() * total;
    for (const [weight, gen] of GENERATORS) {
      r -= weight;
      if (r <= 0) {
        const cmd = gen(ctx);
        if (cmd) return cmd;
        break;
      }
    }
  }
  return genSetTheme(ctx); // always applicable
}
