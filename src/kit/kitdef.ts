import type { ComponentKind, Value } from "../kernel/types";
import type { StateChange } from "../runtime/state";

// KitDef — the typed-TS shape the .kit DSL will eventually parse into
// (MVP1_PLAN_AND_SPEC.md §5). Each component declares its props schema,
// events with payload schemas, the dependency map for surgical patching,
// and hand-written mount/patch against that map.

export type PropType = "string" | "number" | "bool" | "enum" | "strings" | "json";

export interface PropSpec {
  t: PropType;
  default: Value;
  options?: string[]; // enum only
  bindable?: boolean;
}

export type PayloadType = "string" | "number" | "bool" | "json";

export interface EventSpec {
  payload: Record<string, PayloadType> | null;
}

export interface MountCtx {
  doc: Document;
  props: Record<string, Value>; // fully resolved — defaults applied
  emit: (event: string, payload: Value | null) => void;
}

export interface Instance {
  kind: ComponentKind;
  root: HTMLElement;
  parts: Record<string, Node>; // named parts — the dependency map's targets
  slot?: HTMLElement; // where child instances mount
  state?: Record<string, Value>; // last-applied props, for multi-prop patches
  hooks?: Record<string, (value: Value) => void>; // behavior closures (timers, listeners)
  destroy?: () => void;
}

export interface KitDef {
  kind: ComponentKind;
  props: Record<string, PropSpec>;
  events: Record<string, EventSpec>;
  deps: Record<string, string[]>; // prop → part names a patch may touch
  mount: (ctx: MountCtx) => Instance;
  patch: (inst: Instance, key: string, value: Value) => void;
  // Optional fine-grained path for bound props: handle a StateWrite
  // incrementally (e.g. Table appends one <tr>). Return false to fall back
  // to a full patch. Same dependency-map rules as patch.
  applyWrite?: (inst: Instance, key: string, change: StateChange) => boolean;
  // For value-bearing controls: the live value the event wire reads when an
  // input binding's source is nodeValue (BUILD_SPEC.md §4 InputSource).
  getValue?: (inst: Instance) => Value;
}

export function resolveProps(def: KitDef, props: Record<string, Value>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [key, spec] of Object.entries(def.props)) {
    const v = props[key];
    out[key] = v === undefined ? (structuredClone(spec.default) as Value) : v;
  }
  return out;
}

// ── tiny DOM/coercion helpers shared by the defs ───────────────────────────

export const str = (v: Value | undefined): string =>
  typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);

export const num = (v: Value | undefined): number => (typeof v === "number" ? v : Number(v ?? 0));

export const bool = (v: Value | undefined): boolean => v === true;

export const strs = (v: Value | undefined): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)) : [];

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function swapClass(
  target: HTMLElement,
  prefix: string,
  options: string[],
  value: string,
): void {
  for (const opt of options) target.classList.remove(`${prefix}${opt}`);
  target.classList.add(`${prefix}${value}`);
}

export function setHidden(target: HTMLElement, hidden: boolean): void {
  if (hidden) target.setAttribute("hidden", "");
  else target.removeAttribute("hidden");
}
