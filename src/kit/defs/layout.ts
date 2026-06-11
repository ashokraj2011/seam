import type { Instance, KitDef } from "../kitdef";
import { bool, el, num, setHidden, str } from "../kitdef";

const DIRECTIONS = ["row", "column"];
const GAPS = ["0", "1", "2", "3"];
const LAYOUT_CLASSES = [
  ...DIRECTIONS.map((d) => `u-flex-${d}`),
  ...GAPS.map((g) => `u-gap-${g}`),
  "u-wrap",
  "u-grid",
];

function applyLayout(root: HTMLElement, state: Record<string, unknown>): void {
  for (const cls of LAYOUT_CLASSES) root.classList.remove(cls);
  const columns = num(state["columns"] as never);
  root.classList.add(`u-gap-${str(state["gap"] as never)}`);
  if (columns > 0) {
    root.classList.add("u-grid");
    root.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  } else {
    root.style.removeProperty("grid-template-columns");
    root.classList.add(`u-flex-${str(state["direction"] as never)}`);
    if (bool(state["wrap"] as never)) root.classList.add("u-wrap");
  }
}

export const Container: KitDef = {
  kind: "Container",
  props: {
    direction: { t: "enum", options: DIRECTIONS, default: "column" },
    gap: { t: "enum", options: GAPS, default: "2" },
    wrap: { t: "bool", default: false },
    columns: { t: "number", default: 0 },
  },
  events: {},
  deps: { direction: ["root"], gap: ["root"], wrap: ["root"], columns: ["root"] },
  mount({ doc, props }) {
    const root = el(doc, "div", "k-container");
    const inst: Instance = {
      kind: "Container",
      root,
      parts: { root },
      slot: root,
      state: { ...props },
    };
    applyLayout(root, inst.state!);
    return inst;
  },
  patch(inst, key, value) {
    inst.state![key] = value;
    applyLayout(inst.root, inst.state!);
  },
};

export const Card: KitDef = {
  kind: "Card",
  props: {
    title: { t: "string", default: "", bindable: true },
  },
  events: {},
  deps: { title: ["title"] },
  mount({ doc, props }) {
    const root = el(doc, "section", "k-card");
    const title = el(doc, "h3", "k-card__title");
    const text = str(props["title"]);
    title.textContent = text;
    setHidden(title, text === "");
    const body = el(doc, "div", "k-card__body");
    root.append(title, body);
    return { kind: "Card", root, parts: { root, title, body }, slot: body };
  },
  patch(inst, key, value) {
    if (key === "title") {
      const title = inst.parts["title"] as HTMLElement;
      const text = str(value);
      title.textContent = text;
      setHidden(title, text === "");
    }
  },
};
