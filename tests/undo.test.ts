import { describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import type { Node } from "../src/kernel/types";
import { genCommand, makeCtx } from "./helpers";

// §9 gate: undo correct across a recorded 100-command session.

const container = (id: string): Node => ({
  id,
  kind: "Container",
  props: {},
  styleProps: {},
  bindings: [],
  events: [],
  children: [],
});

describe("undo/redo", () => {
  for (let seed = 200; seed < 210; seed++) {
    it(`100-command session round-trips (seed ${seed})`, () => {
      const ctx = makeCtx(seed);
      const initial = ctx.kernel.snapshotJson();
      for (let i = 0; i < 100; i++) ctx.kernel.apply(genCommand(ctx));
      const final = ctx.kernel.snapshotJson();

      while (ctx.kernel.undo()) {
        /* drain */
      }
      expect(ctx.kernel.snapshotJson()).toBe(initial);

      while (ctx.kernel.redo()) {
        /* drain */
      }
      expect(ctx.kernel.snapshotJson()).toBe(final);
    });
  }

  it("coalesces rapid prop edits within 300ms into one undo entry", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "t", now: () => t });
    t = 1000;
    kernel.apply({
      t: "AddPage",
      page: { id: "p1", route: "/", root: "n1", state: [] },
      nodes: [container("n1")],
    });
    t = 2000;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "a" });
    t = 2100;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "ab" });
    t = 2200;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "abc" });

    expect(kernel.undoDepth).toBe(2); // AddPage + one coalesced SetProp entry
    kernel.undo();
    expect(kernel.state.nodes.get("n1")!.props["text"]).toBeUndefined();
    kernel.redo();
    expect(kernel.state.nodes.get("n1")!.props["text"]).toBe("abc"); // redo replays the latest edit
  });

  it("does not coalesce edits more than 300ms apart", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "t", now: () => t });
    t = 1000;
    kernel.apply({
      t: "AddPage",
      page: { id: "p1", route: "/", root: "n1", state: [] },
      nodes: [container("n1")],
    });
    t = 2000;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "a" });
    t = 2400;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "b" });
    expect(kernel.undoDepth).toBe(3);
    kernel.undo();
    expect(kernel.state.nodes.get("n1")!.props["text"]).toBe("a");
  });

  it("does not coalesce edits to different keys", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "t", now: () => t });
    t = 1000;
    kernel.apply({
      t: "AddPage",
      page: { id: "p1", route: "/", root: "n1", state: [] },
      nodes: [container("n1")],
    });
    t = 2000;
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "a" });
    t = 2100;
    kernel.apply({ t: "SetProp", node: "n1", key: "title", value: "b" });
    expect(kernel.undoDepth).toBe(3);
  });

  it("caps the undo stack at 200 entries", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "t", now: () => (t += 1000) });
    kernel.apply({
      t: "AddPage",
      page: { id: "p1", route: "/", root: "n1", state: [] },
      nodes: [container("n1")],
    });
    for (let i = 0; i < 230; i++) {
      kernel.apply({ t: "SetProp", node: "n1", key: "text", value: `v${i}` });
    }
    expect(kernel.undoDepth).toBe(200);
  });

  it("apply clears the redo stack", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "t", now: () => (t += 1000) });
    kernel.apply({
      t: "AddPage",
      page: { id: "p1", route: "/", root: "n1", state: [] },
      nodes: [container("n1")],
    });
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "a" });
    kernel.undo();
    expect(kernel.redoDepth).toBe(1);
    kernel.apply({ t: "SetProp", node: "n1", key: "text", value: "b" });
    expect(kernel.redoDepth).toBe(0);
  });
});
