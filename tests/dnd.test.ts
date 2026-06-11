import { describe, expect, it } from "vitest";
import type { Box } from "../src/studio/dnd-math";
import { dropIndexFor, indicatorBoxFor } from "../src/studio/dnd-math";

// Slot-DnD geometry: index by midpoints, indicator before/after siblings or
// into empty containers (MVP1_PLAN_AND_SPEC.md §6).

const col = (n: number): Box[] =>
  Array.from({ length: n }, (_, i) => ({ x: 0, y: i * 40, w: 100, h: 30 }));

describe("dropIndexFor", () => {
  it("returns 0 for an empty slot", () => {
    expect(dropIndexFor(50, "y", [])).toBe(0);
  });

  it("indexes by child midpoints on the y axis", () => {
    const children = col(3); // mids at 15, 55, 95
    expect(dropIndexFor(0, "y", children)).toBe(0);
    expect(dropIndexFor(14, "y", children)).toBe(0);
    expect(dropIndexFor(16, "y", children)).toBe(1);
    expect(dropIndexFor(56, "y", children)).toBe(2);
    expect(dropIndexFor(200, "y", children)).toBe(3);
  });

  it("indexes on the x axis for row containers", () => {
    const children: Box[] = [
      { x: 0, y: 0, w: 50, h: 20 },
      { x: 60, y: 0, w: 50, h: 20 },
    ]; // mids at 25, 85
    expect(dropIndexFor(10, "x", children)).toBe(0);
    expect(dropIndexFor(50, "x", children)).toBe(1);
    expect(dropIndexFor(120, "x", children)).toBe(2);
  });
});

describe("indicatorBoxFor", () => {
  const slot: Box = { x: 10, y: 10, w: 200, h: 300 };

  it("marks an empty slot as an into-target", () => {
    const box = indicatorBoxFor("y", slot, [], 0);
    expect(box.into).toBe(true);
    expect(box.x).toBe(12);
    expect(box.w).toBe(196);
  });

  it("draws a line before the indexed child", () => {
    const children = col(2);
    const box = indicatorBoxFor("y", slot, children, 1);
    expect(box.into).toBe(false);
    expect(box.y).toBe(39); // child[1].y - 1
    expect(box.w).toBe(slot.w);
    expect(box.h).toBe(2);
  });

  it("draws a line after the last child at the end index", () => {
    const children = col(2);
    const box = indicatorBoxFor("y", slot, children, 2);
    expect(box.y).toBe(40 + 30 - 1); // last bottom edge - 1
  });

  it("draws vertical lines on the x axis", () => {
    const children: Box[] = [{ x: 20, y: 10, w: 50, h: 100 }];
    const box = indicatorBoxFor("x", slot, children, 0);
    expect(box.x).toBe(19);
    expect(box.w).toBe(2);
    expect(box.h).toBe(slot.h);
  });
});
