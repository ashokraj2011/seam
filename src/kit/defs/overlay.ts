import type { Instance, KitDef } from "../kitdef";
import { bool, el, num, setHidden, str } from "../kitdef";

// Behavior vocabulary v1 (MVP1_PLAN_AND_SPEC.md §5): open-on-trigger,
// dismiss-on-escape (Modal), dismiss-on-timeout (Toast). Nothing else.
// Components only EMIT close/dismiss — flipping `open` back is the
// dispatcher's job (state stays in the graph).

export const Modal: KitDef = {
  kind: "Modal",
  props: {
    title: { t: "string", default: "Modal" },
    open: { t: "bool", default: false, bindable: true },
  },
  events: { close: { payload: null } },
  deps: { title: ["title"], open: ["root"] },
  mount({ doc, props, emit }) {
    const root = el(doc, "div", "k-modal");
    const backdrop = el(doc, "div", "k-modal__backdrop");
    const panel = el(doc, "div", "k-modal__panel");
    const title = el(doc, "h3", "k-modal__title");
    title.textContent = str(props["title"]);
    const body = el(doc, "div", "k-modal__body");
    panel.append(title, body);
    root.append(backdrop, panel);

    const onKeydown = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") emit("close", null);
    };
    let listening = false;
    const setOpen = (open: boolean) => {
      setHidden(root, !open);
      if (open && !listening) {
        doc.addEventListener("keydown", onKeydown);
        listening = true;
      } else if (!open && listening) {
        doc.removeEventListener("keydown", onKeydown);
        listening = false;
      }
    };
    setOpen(bool(props["open"]));

    const inst: Instance = {
      kind: "Modal",
      root,
      parts: { root, title, body },
      slot: body,
      hooks: { setOpen: (v) => setOpen(bool(v)) },
      destroy: () => {
        if (listening) doc.removeEventListener("keydown", onKeydown);
        listening = false;
      },
    };
    return inst;
  },
  patch(inst, key, value) {
    if (key === "title") (inst.parts["title"] as HTMLElement).textContent = str(value);
    else if (key === "open") inst.hooks!["setOpen"]!(value);
  },
};

export const Toast: KitDef = {
  kind: "Toast",
  props: {
    text: { t: "string", default: "", bindable: true },
    open: { t: "bool", default: false, bindable: true },
    duration: { t: "number", default: 3000 },
  },
  events: { dismiss: { payload: null } },
  deps: { text: ["text"], open: ["root"], duration: [] },
  mount({ doc, props, emit }) {
    const root = el(doc, "div", "k-toast");
    const text = el(doc, "span", "k-toast__text");
    text.textContent = str(props["text"]);
    root.appendChild(text);

    let duration = num(props["duration"]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const setOpen = (open: boolean) => {
      setHidden(root, !open);
      clearTimeout(timer);
      timer = undefined;
      if (open) timer = setTimeout(() => emit("dismiss", null), duration);
    };
    setOpen(bool(props["open"]));

    const inst: Instance = {
      kind: "Toast",
      root,
      parts: { root, text },
      hooks: {
        setOpen: (v) => setOpen(bool(v)),
        setDuration: (v) => {
          duration = num(v);
        },
      },
      destroy: () => clearTimeout(timer),
    };
    return inst;
  },
  patch(inst, key, value) {
    if (key === "text") (inst.parts["text"] as HTMLElement).textContent = str(value);
    else if (key === "open") inst.hooks!["setOpen"]!(value);
    else if (key === "duration") inst.hooks!["setDuration"]!(value);
  },
};
