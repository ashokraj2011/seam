import { GraphKernel } from "../kernel/kernel";
import type { NodeId, Value } from "../kernel/types";
import { Renderer } from "../renderer/renderer";
import { dispatchWire } from "../runtime/dispatch";

// The standalone runtime: everything a built app needs to run with the studio
// gone — the framework-free renderer, the dispatcher, and the action-IR
// interpreter, plus a browser host (kv → localStorage, toast → a DOM layer).
// No SolidJS, no studio chrome, no server. This is what gets bundled into the
// single exported HTML file. Compiled WASM bodies are out of scope here
// (interpreted apps only); a component-body app would need its wasm inlined.

interface StoreTables {
  [name: string]: Value;
}

export function run(graph: unknown, mountEl: HTMLElement): void {
  const graphJson = typeof graph === "string" ? graph : JSON.stringify(graph);
  const kernel = GraphKernel.fromJson(graphJson);
  const appKey = `seam-app:${kernel.state.project.name}`;

  // Local persistence: store.* rows survive reloads (own-your-data, no server).
  let saved: StoreTables | undefined;
  try {
    saved = JSON.parse(localStorage.getItem(appKey) ?? "null") ?? undefined;
  } catch {
    saved = undefined;
  }

  const toastEl = mountEl.ownerDocument.createElement("div");
  toastEl.setAttribute(
    "style",
    "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c2024;color:#fff;" +
      "padding:8px 16px;border-radius:6px;font:13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);" +
      "z-index:9999;display:none",
  );
  mountEl.ownerDocument.body.appendChild(toastEl);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (message: string, kind: "info" | "error" = "info") => {
    toastEl.textContent = message;
    toastEl.style.background = kind === "error" ? "#e5464d" : "#1c2024";
    toastEl.style.display = "";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.display = "none"), 2600);
  };

  let renderer!: Renderer;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const state = renderer.stateStore;
      if (!state) return;
      const tables: StoreTables = {};
      for (const key of state.keys()) {
        if (key.startsWith("store.")) tables[key.slice("store.".length)] = state.get(key) as Value;
      }
      try {
        localStorage.setItem(appKey, JSON.stringify(tables));
      } catch {
        /* storage full / unavailable — app still runs in memory */
      }
    }, 200);
  };

  const navigate = (route: string) => {
    const page = kernel.state.pages.find((p) => p.route === route);
    if (page) renderer.renderPage(page.id);
    else showToast(`no page at ${route}`, "error");
  };

  const onEvent = (node: NodeId, event: string, payload: Value | null) => {
    const wire = kernel.state.nodes.get(node)?.events.find((w) => w.event === event);
    if (wire) {
      try {
        const outcome = dispatchWire(
          {
            kernel,
            state: renderer.stateStore!,
            readNodeValue: (id) => renderer.readNodeValue(id),
            toast: showToast,
            navigate,
          },
          node,
          wire,
          payload,
        );
        if (outcome?.traces.some((t) => t.cap === "kv" && t.op !== "query")) persist();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
      return;
    }
    // Overlay dismissals with bound `open` state flip the bound value back.
    if (event === "dismiss" || event === "close") {
      const binding = kernel.state.nodes.get(node)?.bindings.find((b) => b.prop === "open");
      if (binding) renderer.stateStore?.apply({ t: "set", path: binding.path, value: false });
    }
  };

  renderer = new Renderer(kernel, mountEl, onEvent, { initialStores: saved });

  const start =
    kernel.state.pages.find((p) => p.route === mountEl.ownerDocument.location.hash.slice(1)) ??
    kernel.state.pages[0];
  if (start) renderer.renderPage(start.id);
}
