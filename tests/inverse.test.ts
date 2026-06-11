import { describe, expect, it } from "vitest";
import { genCommand, makeCtx } from "./helpers";

// P1 exit test: apply(cmd); apply(inverse(cmd)) is identity on the graph for
// every command type, fuzzed (MVP1_PLAN_AND_SPEC.md §4).

describe("command/inverse identity (fuzzed)", () => {
  for (let seed = 1; seed <= 25; seed++) {
    it(`seed ${seed}`, () => {
      const ctx = makeCtx(seed);
      for (let i = 0; i < 25; i++) ctx.kernel.apply(genCommand(ctx)); // grow a graph
      for (let step = 0; step < 120; step++) {
        const before = ctx.kernel.snapshotJson();
        const cmd = genCommand(ctx);
        const { inverse } = ctx.kernel.apply(cmd);
        ctx.kernel.apply(inverse);
        expect(ctx.kernel.snapshotJson(), `${cmd.t} @ step ${step}`).toBe(before);
        if (ctx.rand() < 0.7) ctx.kernel.apply(cmd); // let the graph evolve
      }
    });
  }
});
