import type { KitDef } from "../kitdef";
import { bool, el, str, swapClass } from "../kitdef";

export const Label: KitDef = {
  kind: "Label",
  props: {
    text: { t: "string", default: "Label", bindable: true },
  },
  events: {},
  deps: { text: ["text"] },
  mount({ doc, props }) {
    const root = el(doc, "span", "k-label");
    const text = doc.createTextNode(str(props["text"]));
    root.appendChild(text);
    return { kind: "Label", root, parts: { root, text } };
  },
  patch(inst, key, value) {
    if (key === "text") (inst.parts["text"] as Text).nodeValue = str(value);
  },
};

const VARIANTS = ["primary", "secondary", "danger"];

export const Button: KitDef = {
  kind: "Button",
  props: {
    text: { t: "string", default: "Button", bindable: true },
    variant: { t: "enum", options: VARIANTS, default: "primary" },
    disabled: { t: "bool", default: false, bindable: true },
  },
  events: { click: { payload: null } },
  deps: { text: ["label"], variant: ["root"], disabled: ["root"] },
  mount({ doc, props, emit }) {
    const root = el(doc, "button", `k-btn k-btn--${str(props["variant"])}`);
    root.type = "button";
    const label = el(doc, "span", "k-btn__label");
    label.textContent = str(props["text"]);
    root.appendChild(label);
    if (bool(props["disabled"])) root.setAttribute("disabled", "");
    root.addEventListener("click", () => emit("click", null));
    return { kind: "Button", root, parts: { root, label } };
  },
  patch(inst, key, value) {
    if (key === "text") (inst.parts["label"] as HTMLElement).textContent = str(value);
    else if (key === "variant") swapClass(inst.root, "k-btn--", VARIANTS, str(value));
    else if (key === "disabled") {
      if (bool(value)) inst.root.setAttribute("disabled", "");
      else inst.root.removeAttribute("disabled");
    }
  },
};
