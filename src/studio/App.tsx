import { Show, createMemo, onCleanup, onMount } from "solid-js";
import type { Subtree } from "../shared/nodes";
import { collectSubtree, currentParentOf, remapSubtree } from "../shared/nodes";
import { GraphKernel } from "../kernel/kernel";
import { saveSnapshot, wipeSnapshot } from "../kernel/autosave";
import { CanvasHost } from "./CanvasHost";
import { ContractEditorOverlay, ContractsPanel } from "./ContractEditor";
import { GenerateDialog } from "./GenerateDialog";
import { Inspector } from "./Inspector";
import { Palette } from "./Palette";
import { PagesPanel, StatePanel, StoresPanel } from "./panels";
import { wipeKvTables } from "../runtime/kvpersist";
import { buildStandaloneHtml } from "../export/standalone";
import appCss from "../kit/app.css?inline";
import {
  apply,
  kernel,
  mode,
  ready,
  selection,
  setMode,
  setSelection,
  setShowGenerate,
  setStatus,
  status,
  version,
} from "./store";

export function App() {
  let clipboard: Subtree | null = null;
  let importInput!: HTMLInputElement;

  const onKey = (e: KeyboardEvent) => {
    if (!ready()) return;
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) kernel.redo();
      else kernel.undo();
      return;
    }
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable]")) return;
    if (mode() !== "design") return;
    const sel = selection();
    if (!sel) return;
    const isRoot = kernel.state.pages.some((p) => p.root === sel);

    if ((e.key === "Backspace" || e.key === "Delete") && !isRoot) {
      e.preventDefault();
      apply({ t: "RemoveNode", node: sel });
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !isRoot) {
      // keyboard nudging of slot position (§6)
      e.preventDefault();
      const parent = currentParentOf(kernel.state.nodes, sel);
      if (!parent) return;
      const index = parent.children.indexOf(sel);
      const toIndex = e.key === "ArrowUp" ? index - 1 : index + 1;
      if (toIndex < 0 || toIndex > parent.children.length - 1) return;
      apply({ t: "MoveNode", node: sel, toParent: parent.id, toIndex });
    } else if (meta && e.key.toLowerCase() === "c") {
      e.preventDefault();
      clipboard = collectSubtree(kernel.state.nodes, sel);
      setStatus(`copied ${clipboard.node.kind} (${1 + clipboard.descendants.length} node${clipboard.descendants.length ? "s" : ""})`);
    } else if (meta && e.key.toLowerCase() === "v") {
      e.preventDefault();
      if (!clipboard) return;
      const { node, descendants } = remapSubtree(clipboard);
      // Paste into the selected container, else after the selection.
      const selected = kernel.state.nodes.get(sel);
      const container = selected && ["Container", "Card", "Modal"].includes(selected.kind);
      let parent: string;
      let index: number;
      if (container) {
        parent = sel;
        index = selected.children.length;
      } else {
        const parentNode = currentParentOf(kernel.state.nodes, sel);
        if (!parentNode) return;
        parent = parentNode.id;
        index = parentNode.children.indexOf(sel) + 1;
      }
      if (
        apply({
          t: "InsertNode",
          parent,
          index,
          node,
          ...(descendants.length ? { descendants } : {}),
        })
      )
        setSelection(node.id);
    }
  };

  onMount(() => window.addEventListener("keydown", onKey));
  onCleanup(() => window.removeEventListener("keydown", onKey));

  const download = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportGraph = () => download(kernel.snapshotJson(), "graph.json", "application/json");

  // Emit the current app as ONE self-contained HTML file — no studio, no
  // server, data kept locally. The lock-in-free artifact you own.
  const exportStandalone = async () => {
    try {
      const runtimeJs = await fetch("/seam-runtime.js").then((r) => {
        if (!r.ok) throw new Error("runtime bundle missing — run: npm run build:runtime");
        return r.text();
      });
      const name = kernel.state.project.name || "app";
      const html = buildStandaloneHtml({
        title: name,
        graphJson: kernel.snapshotJson(),
        runtimeJs,
        css: appCss,
      });
      download(html, `${name}.html`, "text/html");
      setStatus(`exported ${name}.html — open it anywhere, no studio or server needed`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const importGraphFile = async (file: File) => {
    try {
      const imported = GraphKernel.fromJson(await file.text());
      await saveSnapshot(imported.snapshotJson());
      location.reload();
    } catch (err) {
      setStatus(`import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Guard on ready(): memos evaluate eagerly, and the kernel is assigned
  // asynchronously by initStudio.
  const stats = createMemo(() => {
    if (!ready()) return "";
    version();
    const s = kernel.state;
    return `${s.pages.length} page${s.pages.length === 1 ? "" : "s"} · ${s.nodes.size} nodes · ${s.contracts.length} contracts`;
  });

  return (
    <Show when={ready()} fallback={<div class="s-loading">loading…</div>}>
      <header class="s-header">
        <h1>
          Seam Studio<span class="s-tag">MVP1</span>
        </h1>
        <div class="s-modes">
          <button classList={{ "s-active": mode() === "design" }} onClick={() => setMode("design")}>
            Design
          </button>
          <button class="s-run" classList={{ "s-active": mode() === "run" }} onClick={() => setMode("run")}>
            ▶ Run
          </button>
        </div>
        <button disabled={(version(), kernel.undoDepth === 0)} onClick={() => kernel.undo()}>
          Undo
        </button>
        <button disabled={(version(), kernel.redoDepth === 0)} onClick={() => kernel.redo()}>
          Redo
        </button>
        <button class="s-generate" onClick={() => setShowGenerate(true)}>
          ✨ Generate
        </button>
        <button onClick={exportGraph}>Export</button>
        <button class="s-generate" onClick={() => void exportStandalone()} title="emit a single self-contained HTML file — runs with no studio or server">
          ⬇ Standalone
        </button>
        <button onClick={() => importInput.click()}>Import</button>
        <input
          ref={importInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void importGraphFile(file);
          }}
        />
        <button
          class="s-danger"
          onClick={async () => {
            await wipeSnapshot();
            await wipeKvTables();
            location.reload();
          }}
        >
          Wipe
        </button>
      </header>
      <div class="s-main">
        <aside class="s-left">
          <Palette />
          <PagesPanel />
          <StatePanel />
          <StoresPanel />
          <ContractsPanel />
        </aside>
        <CanvasHost />
        <Inspector />
      </div>
      <footer class="s-statusbar">
        <span>{status()}</span>
        <span class="s-statusbar__right">
          <span>{mode() === "run" ? "▶ running" : "designing"}</span>
          <span>{stats()}</span>
        </span>
      </footer>
      <ContractEditorOverlay />
      <GenerateDialog />
    </Show>
  );
}
