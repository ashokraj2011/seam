import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Renderer } from "../renderer/renderer";
import { invokeComponent } from "../runtime/component-host";
import type { PredicateCheck } from "../runtime/interpret";
import { dispatchWire } from "../runtime/dispatch";
import { collectKvTables, saveKvTables } from "../runtime/kvpersist";
import { blankNode, currentParentOf, subtreeIds } from "../shared/nodes";
import { beginDrag } from "./dnd";
import {
  apply,
  canvasBridge,
  currentPage,
  kernel,
  kvTables,
  mode,
  selection,
  setCurrentPage,
  setSelection,
  setStatus,
  version,
} from "./store";
import type { NodeId, Value } from "../kernel/types";

// The canvas: the framework-free renderer mounted inside the Solid shell.
// Design mode intercepts all pointer/click events at the capture phase —
// components stay inert — and turns them into selection and slot DnD.
// Run mode steps aside entirely: same renderer, live events. One flag.

interface Badge {
  node: NodeId;
  labels: string[];
  x: number;
  y: number;
}

export function CanvasHost() {
  let host!: HTMLDivElement;
  let mountEl!: HTMLDivElement;
  let indicator!: HTMLDivElement;
  let toastEl!: HTMLDivElement;
  let renderer: Renderer | undefined;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let kvTimer: ReturnType<typeof setTimeout> | undefined;
  const [badges, setBadges] = createSignal<Badge[]>([]);

  const rootId = (): NodeId | null =>
    kernel.state.pages.find((p) => p.id === currentPage())?.root ?? null;

  const pageIsEmpty = () => {
    version();
    const root = rootId();
    return !root || (kernel.state.nodes.get(root)?.children.length ?? 0) === 0;
  };

  const [hintDismissed, setHintDismissed] = createSignal(
    localStorage.getItem("seam-hint-dismissed") === "1",
  );

  // The ambient toast layer — the toast capability needs no Toast node on
  // the page (MVP1_PLAN_AND_SPEC.md §7).
  const showToast = (message: string, kind: "info" | "error" = "info") => {
    toastEl.textContent = message;
    toastEl.classList.toggle("s-ambient-toast--error", kind === "error");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 2600);
  };

  const scheduleKvSave = () => {
    clearTimeout(kvTimer);
    kvTimer = setTimeout(() => {
      const state = renderer?.stateStore;
      if (state) void saveKvTables(collectKvTables(state)).catch(() => {});
    }, 300);
  };

  // Predicate badges: non-blocking red chips on the wired control, the
  // cultural seed of the verification gate (§7).
  const setPredicateBadges = (node: NodeId, checks: PredicateCheck[]) => {
    const failed = checks.filter((c) => !c.ok).map((c) => c.label);
    setBadges((prev) => {
      const rest = prev.filter((b) => b.node !== node);
      if (!failed.length) return rest;
      const inst = renderer?.instances.get(node);
      if (!inst) return rest;
      const rect = inst.root.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      return [
        ...rest,
        {
          node,
          labels: failed,
          x: rect.right - hostRect.left + host.scrollLeft,
          y: rect.top - hostRect.top + host.scrollTop,
        },
      ];
    });
  };

  const handleRunEvent = (node: NodeId, event: string, payload: Value | null) => {
    const wire = kernel.state.nodes.get(node)?.events.find((w) => w.event === event);
    if (wire && renderer?.stateStore) {
      try {
        const outcome = dispatchWire(
          {
            kernel,
            state: renderer.stateStore,
            readNodeValue: (id) => renderer!.readNodeValue(id),
            toast: showToast,
            navigate: (route) => {
              const page = kernel.state.pages.find((p) => p.route === route);
              if (page) setCurrentPage(page.id);
              else showToast(`no page at ${route}`, "error");
            },
            onPredicates: setPredicateBadges,
            invokeComponent,
          },
          node,
          wire,
          payload,
        );
        if (outcome?.traces.some((t) => t.cap === "kv" && t.op !== "query")) scheduleKvSave();
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      }
      return;
    }
    // Unwired overlay events keep their built-in behavior: flip the bound
    // state when open is bound, else the prop itself.
    if (event === "dismiss" || event === "close") {
      const binding = kernel.state.nodes.get(node)?.bindings.find((b) => b.prop === "open");
      if (binding && renderer?.stateStore) {
        renderer.stateStore.apply({ t: "set", path: binding.path, value: false });
      } else {
        apply({ t: "SetProp", node, key: "open", value: false });
      }
    }
  };

  onMount(() => {
    renderer = new Renderer(
      kernel,
      mountEl,
      (node, event, payload) => {
        if (mode() !== "run") return;
        setStatus(`⚡ ${event} @ ${node}${payload ? ` ${JSON.stringify(payload)}` : ""}`);
        handleRunEvent(node, event, payload);
      },
      { initialStores: kvTables ?? undefined },
    );

    // Keep the rendered page in sync with currentPage and graph changes
    // (undo/redo of page commands self-heals here).
    createEffect(() => {
      version();
      const pageId = currentPage();
      if (!renderer) return;
      if (!pageId) return;
      if (!kernel.state.pages.some((p) => p.id === pageId)) {
        setCurrentPage(kernel.state.pages[0]?.id ?? null);
        return;
      }
      if (renderer.renderedPage !== pageId) renderer.renderPage(pageId);
    });

    // Selection highlight — re-applied after every delta, since undo/redo can
    // remount the selected element.
    createEffect(() => {
      version();
      const sel = selection();
      if (!renderer) return;
      for (const [id, inst] of renderer.instances) {
        inst.root.classList.toggle("s-selected", id === sel);
      }
    });

    // ── design-mode interception ─────────────────────────────────────────

    let pending: { id: NodeId | null; x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (mode() !== "design" || e.button !== 0) return;
      e.preventDefault(); // no focus, no native widget behavior
      const id = renderer!.nodeIdForElement(e.target as Element);
      pending = { id, x: e.clientX, y: e.clientY };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pending) return;
      const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
      if (dist < 5) return;
      const dragId = pending.id;
      stopTracking();
      if (!dragId || dragId === rootId()) return; // roots move via pages, not DnD
      const node = kernel.state.nodes.get(dragId);
      if (!node) return;
      setSelection(dragId);
      beginDrag(e, {
        label: node.kind,
        host,
        renderer: renderer!,
        rootId: rootId(),
        indicator,
        exclude: subtreeIds(kernel.state.nodes, dragId),
        commit: (parent, index) => commitMove(dragId, parent, index),
      });
    };

    const onPointerUp = () => {
      if (pending) setSelection(pending.id);
      stopTracking();
    };

    const stopTracking = () => {
      pending = null;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
    };

    const onClickCapture = (e: MouseEvent) => {
      if (mode() !== "design") return;
      e.preventDefault();
      e.stopPropagation(); // events inert in design mode
    };

    host.addEventListener("pointerdown", onPointerDown, true);
    host.addEventListener("click", onClickCapture, true);
    onCleanup(() => {
      host.removeEventListener("pointerdown", onPointerDown, true);
      host.removeEventListener("click", onClickCapture, true);
      stopTracking();
    });

    // Palette drags land here — the canvas owns the renderer and indicator.
    canvasBridge.startNewDrag = (e, kind) => {
      if (mode() !== "design") return;
      beginDrag(e, {
        label: kind,
        host,
        renderer: renderer!,
        rootId: rootId(),
        indicator,
        commit: (parent, index) => {
          const node = blankNode(kind);
          if (apply({ t: "InsertNode", parent, index, node })) setSelection(node.id);
        },
      });
    };
  });

  onCleanup(() => {
    canvasBridge.startNewDrag = undefined;
    clearTimeout(toastTimer);
    clearTimeout(kvTimer);
    renderer?.destroy();
  });

  // Mode switches and graph edits invalidate badge positions; clear them.
  createEffect(() => {
    mode();
    version();
    setBadges((prev) => prev.filter((b) => kernel.state.nodes.has(b.node)));
    if (mode() === "design") setBadges([]);
  });

  const commitMove = (node: NodeId, parent: NodeId, index: number) => {
    const current = currentParentOf(kernel.state.nodes, node);
    if (!current) return;
    let toIndex = index;
    if (current.id === parent) {
      const oldIndex = current.children.indexOf(node);
      if (index > oldIndex) toIndex = index - 1; // kernel removes first, then inserts
      if (toIndex === oldIndex) return; // dropped where it already is
    }
    apply({ t: "MoveNode", node, toParent: parent, toIndex });
  };

  return (
    <section class="s-canvas" classList={{ "s-canvas--run": mode() === "run" }} ref={host}>
      <div class="s-canvas__mount" ref={mountEl} />
      <div class="s-indicator" ref={indicator} hidden />
      <Show when={pageIsEmpty() && mode() === "design"}>
        <div class="s-empty">
          <p>This page is empty</p>
          <p>Drag components from the palette to start building.</p>
        </div>
      </Show>
      <Show when={!hintDismissed() && mode() === "design"}>
        <div class="s-firstrun">
          <span>
            Drag from the palette · click to select · <kbd>⌘Z</kbd> undo · <kbd>⌘C/V</kbd> copy ·{" "}
            <kbd>▶ Run</kbd> to use your app
          </span>
          <button
            title="dismiss"
            onClick={() => {
              localStorage.setItem("seam-hint-dismissed", "1");
              setHintDismissed(true);
            }}
          >
            ×
          </button>
        </div>
      </Show>
      <For each={badges()}>
        {(badge) => (
          <div class="s-predbadge" style={{ left: `${badge.x}px`, top: `${badge.y}px` }}>
            <For each={badge.labels}>{(label) => <span>{label}</span>}</For>
          </div>
        )}
      </For>
      <div class="s-ambient-toast" ref={toastEl} hidden />
    </section>
  );
}
