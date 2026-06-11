import type { DataStore, Page, PageId, Value } from "../kernel/types";

// The runtime signal store (MVP1_PLAN_AND_SPEC.md §3/§7) — framework-free,
// because it ships inside user apps with the renderer. It holds the page's
// live state and the data stores' live rows; bindings subscribe to it, and
// (from P5) the interpreter writes to it through the StateWrite vocabulary.
//
// Paths are dot paths with a two-segment root: "state.<decl>" for page
// state, "store.<name>" for data stores. Deeper segments navigate into the
// value: "state.form.name".

export type StateWrite =
  | { t: "set"; path: string; value: Value }
  | { t: "append"; path: string; value: Value }
  | { t: "removeWhere"; path: string; pred: (item: Value, index: number) => boolean }
  | { t: "merge"; path: string; value: Record<string, Value> };

export interface StateChange {
  path: string;
  write: StateWrite;
  value: Value | undefined; // full value at path, after the write
  removedIndices?: number[]; // removeWhere only — lets a Table drop exact rows
}

type Listener = (change: StateChange) => void;

// Segment-wise prefix in either direction: a write to "state.form" affects a
// binding on "state.form.name" and vice versa.
export function pathsIntersect(a: string, b: string): boolean {
  const as = a.split(".");
  const bs = b.split(".");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) if (as[i] !== bs[i]) return false;
  return true;
}

function splitPath(path: string): { root: string; rest: string[] } {
  const segments = path.split(".");
  if (segments.length < 2 || !segments[0] || !segments[1]) {
    throw new Error(`state path must be "state.<name>" or "store.<name>": ${path}`);
  }
  return { root: `${segments[0]}.${segments[1]}`, rest: segments.slice(2) };
}

export class StateStore {
  private roots = new Map<string, Value>();
  private listeners = new Set<Listener>();

  constructor(entries: Iterable<[string, Value]> = []) {
    for (const [key, value] of entries) this.roots.set(key, structuredClone(value));
  }

  keys(): string[] {
    return [...this.roots.keys()];
  }

  get(path: string): Value | undefined {
    const { root, rest } = splitPath(path);
    let cur = this.roots.get(root);
    for (const seg of rest) {
      if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = cur[seg];
      else return undefined;
    }
    return cur;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(write: StateWrite): StateChange {
    const { root, rest } = splitPath(write.path);
    if (!this.roots.has(root)) throw new Error(`unknown state path ${write.path}`);

    let change: StateChange;
    switch (write.t) {
      case "set": {
        if (rest.length === 0) {
          this.roots.set(root, structuredClone(write.value));
        } else {
          const parent = this.navigate(root, rest.slice(0, -1), write.path);
          parent[rest[rest.length - 1]!] = structuredClone(write.value);
        }
        change = { path: write.path, write, value: this.get(write.path) };
        break;
      }
      case "append": {
        const arr = this.get(write.path);
        if (!Array.isArray(arr)) throw new Error(`append: ${write.path} is not a list`);
        arr.push(structuredClone(write.value));
        change = { path: write.path, write, value: arr };
        break;
      }
      case "removeWhere": {
        const arr = this.get(write.path);
        if (!Array.isArray(arr)) throw new Error(`removeWhere: ${write.path} is not a list`);
        const removedIndices: number[] = [];
        for (let i = 0; i < arr.length; i++) if (write.pred(arr[i]!, i)) removedIndices.push(i);
        for (let i = removedIndices.length - 1; i >= 0; i--) arr.splice(removedIndices[i]!, 1);
        change = { path: write.path, write, value: arr, removedIndices };
        break;
      }
      case "merge": {
        const obj = this.get(write.path);
        if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
          throw new Error(`merge: ${write.path} is not a record`);
        }
        Object.assign(obj, structuredClone(write.value));
        change = { path: write.path, write, value: obj };
        break;
      }
    }
    for (const fn of this.listeners) fn(change);
    return change;
  }

  private navigate(root: string, segments: string[], full: string): Record<string, Value> {
    let cur = this.roots.get(root);
    for (const seg of segments) {
      if (cur && typeof cur === "object" && !Array.isArray(cur)) cur = cur[seg];
      else throw new Error(`set: ${full} does not resolve to a record`);
    }
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) {
      throw new Error(`set: ${full} does not resolve to a record`);
    }
    return cur;
  }
}

// Seed-data flow: a fresh store per rendered page — state decls' initial
// values plus every data store's rows. Persisted kv tables (overrides) take
// precedence over graph seeds, so reload restores saved data.
export function buildStateStore(
  graph: { pages: Page[]; stores: DataStore[] },
  pageId: PageId | null,
  storeOverrides?: Record<string, Value>,
): StateStore {
  const entries: Array<[string, Value]> = [];
  const page = graph.pages.find((p) => p.id === pageId);
  for (const decl of page?.state ?? []) entries.push([`state.${decl.name}`, decl.initial]);
  for (const store of graph.stores) {
    entries.push([`store.${store.name}`, storeOverrides?.[store.name] ?? store.seed ?? []]);
  }
  return new StateStore(entries);
}
