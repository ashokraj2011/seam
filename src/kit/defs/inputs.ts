import type { Instance, KitDef, MountCtx } from "../kitdef";
import { bool, el, num, str, strs } from "../kitdef";

// Shared field scaffold: <label.k-field> <span.k-field__label/> <control/> </label>
function field(ctx: MountCtx, labelKey = "label") {
  const root = el(ctx.doc, "label", "k-field");
  const labelText = el(ctx.doc, "span", "k-field__label");
  labelText.textContent = str(ctx.props[labelKey]);
  root.appendChild(labelText);
  return { root, labelText };
}

export const TextInput: KitDef = {
  kind: "TextInput",
  props: {
    label: { t: "string", default: "Label" },
    placeholder: { t: "string", default: "", bindable: true },
    value: { t: "string", default: "", bindable: true },
  },
  events: { change: { payload: { value: "string" } } },
  deps: { label: ["labelText"], placeholder: ["input"], value: ["input"] },
  mount(ctx) {
    const { root, labelText } = field(ctx);
    const input = el(ctx.doc, "input", "k-input");
    input.type = "text";
    const placeholder = str(ctx.props["placeholder"]);
    if (placeholder) input.setAttribute("placeholder", placeholder);
    input.value = str(ctx.props["value"]);
    input.setAttribute("value", str(ctx.props["value"]));
    input.addEventListener("input", () => ctx.emit("change", { value: input.value }));
    root.appendChild(input);
    return { kind: "TextInput", root, parts: { root, labelText, input } };
  },
  patch(inst, key, value) {
    const input = inst.parts["input"] as HTMLInputElement;
    if (key === "label") (inst.parts["labelText"] as HTMLElement).textContent = str(value);
    else if (key === "placeholder") input.setAttribute("placeholder", str(value));
    else if (key === "value") {
      input.value = str(value);
      input.setAttribute("value", str(value));
    }
  },
  getValue(inst) {
    return (inst.parts["input"] as HTMLInputElement).value;
  },
};

export const NumberInput: KitDef = {
  kind: "NumberInput",
  props: {
    label: { t: "string", default: "Label" },
    value: { t: "number", default: 0, bindable: true },
  },
  events: { change: { payload: { value: "number" } } },
  deps: { label: ["labelText"], value: ["input"] },
  mount(ctx) {
    const { root, labelText } = field(ctx);
    const input = el(ctx.doc, "input", "k-input");
    input.type = "number";
    input.value = String(num(ctx.props["value"]));
    input.setAttribute("value", String(num(ctx.props["value"])));
    input.addEventListener("input", () => ctx.emit("change", { value: Number(input.value) }));
    root.appendChild(input);
    return { kind: "NumberInput", root, parts: { root, labelText, input } };
  },
  patch(inst, key, value) {
    const input = inst.parts["input"] as HTMLInputElement;
    if (key === "label") (inst.parts["labelText"] as HTMLElement).textContent = str(value);
    else if (key === "value") {
      input.value = String(num(value));
      input.setAttribute("value", String(num(value)));
    }
  },
  getValue(inst) {
    return Number((inst.parts["input"] as HTMLInputElement).value) || 0;
  },
};

export const Checkbox: KitDef = {
  kind: "Checkbox",
  props: {
    label: { t: "string", default: "Checkbox" },
    checked: { t: "bool", default: false, bindable: true },
  },
  events: { change: { payload: { value: "bool" } } },
  deps: { label: ["labelText"], checked: ["input"] },
  mount(ctx) {
    const root = el(ctx.doc, "label", "k-check");
    const input = el(ctx.doc, "input");
    input.type = "checkbox";
    input.checked = bool(ctx.props["checked"]);
    if (input.checked) input.setAttribute("checked", "");
    const labelText = el(ctx.doc, "span", "k-check__label");
    labelText.textContent = str(ctx.props["label"]);
    input.addEventListener("change", () => ctx.emit("change", { value: input.checked }));
    root.append(input, labelText);
    return { kind: "Checkbox", root, parts: { root, input, labelText } };
  },
  patch(inst, key, value) {
    const input = inst.parts["input"] as HTMLInputElement;
    if (key === "label") (inst.parts["labelText"] as HTMLElement).textContent = str(value);
    else if (key === "checked") {
      input.checked = bool(value);
      if (input.checked) input.setAttribute("checked", "");
      else input.removeAttribute("checked");
    }
  },
  getValue(inst) {
    return (inst.parts["input"] as HTMLInputElement).checked;
  },
};

function rebuildOptions(select: HTMLSelectElement, options: string[], value: string): void {
  select.textContent = "";
  const doc = select.ownerDocument;
  for (const opt of options) {
    const option = doc.createElement("option");
    option.value = opt;
    option.textContent = opt;
    if (opt === value) option.setAttribute("selected", "");
    select.appendChild(option);
  }
  if (options.includes(value)) select.value = value;
}

export const Select: KitDef = {
  kind: "Select",
  props: {
    label: { t: "string", default: "Select" },
    options: { t: "strings", default: ["Option 1", "Option 2"], bindable: true },
    value: { t: "string", default: "", bindable: true },
  },
  events: { change: { payload: { value: "string" } } },
  deps: { label: ["labelText"], options: ["select"], value: ["select"] },
  mount(ctx) {
    const { root, labelText } = field(ctx);
    const select = el(ctx.doc, "select", "k-select");
    rebuildOptions(select, strs(ctx.props["options"]), str(ctx.props["value"]));
    select.addEventListener("change", () => ctx.emit("change", { value: select.value }));
    root.appendChild(select);
    const inst: Instance = {
      kind: "Select",
      root,
      parts: { root, labelText, select },
      state: { value: str(ctx.props["value"]), options: strs(ctx.props["options"]) },
    };
    return inst;
  },
  patch(inst, key, value) {
    const select = inst.parts["select"] as HTMLSelectElement;
    const state = inst.state!;
    if (key === "label") (inst.parts["labelText"] as HTMLElement).textContent = str(value);
    else if (key === "options") {
      state["options"] = strs(value);
      rebuildOptions(select, strs(value), str(state["value"]));
    } else if (key === "value") {
      state["value"] = str(value);
      rebuildOptions(select, strs(state["options"]), str(value));
    }
  },
  getValue(inst) {
    return (inst.parts["select"] as HTMLSelectElement).value;
  },
};

export const TextArea: KitDef = {
  kind: "TextArea",
  props: {
    label: { t: "string", default: "Label" },
    placeholder: { t: "string", default: "", bindable: true },
    value: { t: "string", default: "", bindable: true },
    rows: { t: "number", default: 3 },
  },
  events: { change: { payload: { value: "string" } } },
  deps: { label: ["labelText"], placeholder: ["textarea"], value: ["textarea"], rows: ["textarea"] },
  mount(ctx) {
    const { root, labelText } = field(ctx);
    const textarea = el(ctx.doc, "textarea", "k-textarea");
    textarea.setAttribute("rows", String(num(ctx.props["rows"])));
    const placeholder = str(ctx.props["placeholder"]);
    if (placeholder) textarea.setAttribute("placeholder", placeholder);
    textarea.textContent = str(ctx.props["value"]);
    textarea.value = str(ctx.props["value"]);
    textarea.addEventListener("input", () => ctx.emit("change", { value: textarea.value }));
    root.appendChild(textarea);
    return { kind: "TextArea", root, parts: { root, labelText, textarea } };
  },
  patch(inst, key, value) {
    const textarea = inst.parts["textarea"] as HTMLTextAreaElement;
    if (key === "label") (inst.parts["labelText"] as HTMLElement).textContent = str(value);
    else if (key === "placeholder") textarea.setAttribute("placeholder", str(value));
    else if (key === "rows") textarea.setAttribute("rows", String(num(value)));
    else if (key === "value") {
      textarea.value = str(value);
      textarea.textContent = str(value);
    }
  },
  getValue(inst) {
    return (inst.parts["textarea"] as HTMLTextAreaElement).value;
  },
};
