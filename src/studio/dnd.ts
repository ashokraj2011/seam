import type { NodeId } from "../kernel/types";
import type { Renderer } from "../renderer/renderer";
import type { Box, IndicatorBox } from "./dnd-math";
import { dropIndexFor, indicatorBoxFor } from "./dnd-math";

// The pointer-driven slot-DnD engine (framework-free; Solid only wires it
// up). One drag = ghost chip following the pointer + a drop indicator at the
// resolved slot; Escape cancels, pointerup commits.

export interface DropResolution {
  parent: NodeId;
  index: number;
  box: IndicatorBox;
}

const toBox = (r: DOMRect): Box => ({ x: r.left, y: r.top, w: r.width, h: r.height });

// Find the container slot under the pointer: nearest mounted instance with a
// slot, climbing out of excluded (dragged) subtrees; falls back to the page
// root so dropping on empty canvas appends at the end.
export function resolveDrop(
  renderer: Renderer,
  host: HTMLElement,
  rootId: NodeId | null,
  x: number,
  y: number,
  exclude?: Set<NodeId>,
): DropResolution | null {
  const doc = host.ownerDocument;
  let parent: NodeId | null = null;
  let el: Element | null = doc.elementFromPoint(x, y);
  while (el && host.contains(el)) {
    const id = renderer.nodeIdForElement(el);
    if (!id) break;
    const inst = renderer.instances.get(id)!;
    if (inst.slot && !exclude?.has(id)) {
      parent = id;
      break;
    }
    el = inst.root.parentElement;
  }
  if (!parent && rootId && !exclude?.has(rootId)) {
    const rootInst = renderer.instances.get(rootId);
    if (rootInst?.slot) parent = rootId;
  }
  if (!parent) return null;

  const slot = renderer.instances.get(parent)!.slot!;
  const style = doc.defaultView!.getComputedStyle(slot);
  const axis: "x" | "y" =
    style.display !== "grid" && style.flexDirection.startsWith("row") ? "x" : "y";
  const children = [...slot.children].map((c) => toBox(c.getBoundingClientRect()));
  const index = dropIndexFor(axis === "x" ? x : y, axis, children);
  const box = indicatorBoxFor(axis, toBox(slot.getBoundingClientRect()), children, index);
  return { parent, index, box };
}

export interface DragSpec {
  label: string;
  host: HTMLElement; // positioned, scrollable canvas wrapper
  renderer: Renderer;
  rootId: NodeId | null;
  indicator: HTMLElement; // absolutely positioned inside host
  exclude?: Set<NodeId>; // dragged subtree — never a drop target
  commit: (parent: NodeId, index: number) => void;
  done?: () => void;
}

export function beginDrag(start: PointerEvent, spec: DragSpec): void {
  const doc = spec.host.ownerDocument;
  const ghost = doc.createElement("div");
  ghost.className = "s-ghost";
  ghost.textContent = spec.label;
  doc.body.appendChild(ghost);
  doc.body.classList.add("s-dragging");
  let target: DropResolution | null = null;

  const paint = (x: number, y: number) => {
    ghost.style.left = `${x + 12}px`;
    ghost.style.top = `${y + 12}px`;
    target = resolveDrop(spec.renderer, spec.host, spec.rootId, x, y, spec.exclude);
    const ind = spec.indicator;
    if (!target) {
      ind.hidden = true;
      return;
    }
    const hostRect = spec.host.getBoundingClientRect();
    const { box } = target;
    ind.hidden = false;
    ind.classList.toggle("s-indicator--into", box.into);
    ind.style.left = `${box.x - hostRect.left + spec.host.scrollLeft}px`;
    ind.style.top = `${box.y - hostRect.top + spec.host.scrollTop}px`;
    ind.style.width = `${box.w}px`;
    ind.style.height = `${box.h}px`;
  };

  const finish = (commit: boolean) => {
    doc.removeEventListener("pointermove", onMove);
    doc.removeEventListener("pointerup", onUp);
    doc.removeEventListener("keydown", onKey, true);
    ghost.remove();
    doc.body.classList.remove("s-dragging");
    spec.indicator.hidden = true;
    if (commit && target) spec.commit(target.parent, target.index);
    spec.done?.();
  };
  const onMove = (e: PointerEvent) => paint(e.clientX, e.clientY);
  const onUp = () => finish(true);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      finish(false);
    }
  };

  doc.addEventListener("pointermove", onMove);
  doc.addEventListener("pointerup", onUp);
  doc.addEventListener("keydown", onKey, true);
  paint(start.clientX, start.clientY);
}
