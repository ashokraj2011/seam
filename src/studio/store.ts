import { createSignal } from "solid-js";
import type { Command } from "../kernel/commands";
import type { ComponentKind, ContractId, NodeId, PageId } from "../kernel/types";
import { GraphKernel } from "../kernel/kernel";
import { attachAutosave, loadSnapshot, saveSnapshot } from "../kernel/autosave";
import type { KvTables } from "../runtime/kvpersist";
import { loadKvTables } from "../runtime/kvpersist";
import { seedDemo } from "../shared/seed";

// Studio-wide state. The kernel owns the graph; Solid only gets a version
// counter bumped on every delta — components re-read the graph through it.

export const [ready, setReady] = createSignal(false);
export const [version, setVersion] = createSignal(0);
export const [mode, setMode] = createSignal<"design" | "run">("design");
export const [selection, setSelection] = createSignal<NodeId | null>(null);
export const [currentPage, setCurrentPage] = createSignal<PageId | null>(null);
export const [editingContract, setEditingContract] = createSignal<ContractId | null>(null);
export const [status, setStatus] = createSignal("loading…");
export const [showGenerate, setShowGenerate] = createSignal(false);

export let kernel: GraphKernel;
export let kvTables: KvTables | null = null; // persisted kv rows, loaded at boot

// CanvasHost registers the palette's drag entry point here (it owns the
// renderer and indicator the drag needs).
export const canvasBridge: {
  startNewDrag?: (e: PointerEvent, kind: ComponentKind) => void;
} = {};

export async function initStudio(): Promise<void> {
  const saved = await loadSnapshot();
  kvTables = await loadKvTables().catch(() => null);
  if (saved) {
    kernel = GraphKernel.fromJson(saved);
  } else {
    kernel = new GraphKernel({ projectName: "seam-demo" });
    seedDemo(kernel);
  }
  kernel.subscribe(() => {
    setVersion((v) => v + 1);
    const sel = selection();
    if (sel && !kernel.state.nodes.has(sel)) setSelection(null);
  });
  attachAutosave(kernel, {
    onSaved: (at) => setStatus(`autosaved ${at.toLocaleTimeString()}`),
    onError: (err) => setStatus(`autosave failed: ${String(err)}`),
  });
  if (!saved) await saveSnapshot(kernel.snapshotJson());
  setCurrentPage(kernel.state.pages[0]?.id ?? null);
  setStatus(saved ? "restored from IndexedDB" : "new project seeded");
  setReady(true);
}

// All studio mutations go through this guard so kernel validation errors
// surface in the status bar instead of breaking interactions.
export function apply(cmd: Command): boolean {
  try {
    kernel.apply(cmd);
    return true;
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    return false;
  }
}
