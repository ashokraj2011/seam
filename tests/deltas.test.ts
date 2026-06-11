import { describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import type { GraphDelta } from "../src/kernel/commands";
import { genCommand, makeCtx } from "./helpers";

// Delta completeness: replaying deltas from empty reproduces the graph
// (MVP1_PLAN_AND_SPEC.md §10). Deltas are the only thing the preview
// subscribes to, so this is the preview's correctness guarantee.

describe("delta completeness", () => {
  for (let seed = 100; seed < 110; seed++) {
    it(`replay reproduces the graph (seed ${seed})`, () => {
      const ctx = makeCtx(seed);
      const deltas: GraphDelta[] = [];
      ctx.kernel.subscribe((d) => deltas.push(d));
      for (let i = 0; i < 150; i++) ctx.kernel.apply(genCommand(ctx));

      const replay = new GraphKernel({ projectName: "fuzz" });
      for (const delta of deltas) replay.apply(delta.cmd);
      expect(replay.snapshotJson()).toBe(ctx.kernel.snapshotJson());
    });
  }
});
