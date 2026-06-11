// Pure slot-DnD geometry — framework- and DOM-free so the index math is unit
// testable. The drop model (MVP1_PLAN_AND_SPEC.md §6): indicators at valid
// container slots — before/after siblings, into empty containers.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IndicatorBox extends Box {
  into: boolean; // true → highlight the empty slot itself, not an edge line
}

// Index = number of children whose midpoint (along the layout axis) the
// pointer has passed. 0..children.length inclusive.
export function dropIndexFor(coord: number, axis: "x" | "y", children: Box[]): number {
  let index = 0;
  for (const box of children) {
    const mid = axis === "x" ? box.x + box.w / 2 : box.y + box.h / 2;
    if (coord > mid) index++;
  }
  return index;
}

export function indicatorBoxFor(
  axis: "x" | "y",
  slot: Box,
  children: Box[],
  index: number,
): IndicatorBox {
  if (children.length === 0) {
    return { x: slot.x + 2, y: slot.y + 2, w: slot.w - 4, h: slot.h - 4, into: true };
  }
  const last = children[children.length - 1]!;
  if (axis === "y") {
    const edge = index < children.length ? children[index]!.y : last.y + last.h;
    return { x: slot.x, y: edge - 1, w: slot.w, h: 2, into: false };
  }
  const edge = index < children.length ? children[index]!.x : last.x + last.w;
  return { x: edge - 1, y: slot.y, w: 2, h: slot.h, into: false };
}
