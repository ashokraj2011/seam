import { describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import { canonicalStringify, importGraph } from "../src/kernel/serialize";
import { genCommand, makeCtx } from "./helpers";

// §9 gate: graph.json round-trip byte-stable.

describe("canonical serialization", () => {
  for (let seed = 300; seed < 308; seed++) {
    it(`round-trip is byte-stable (seed ${seed})`, () => {
      const ctx = makeCtx(seed);
      for (let i = 0; i < 120; i++) ctx.kernel.apply(genCommand(ctx));
      const exported = ctx.kernel.snapshotJson();
      const reExported = GraphKernel.fromJson(exported).snapshotJson();
      expect(reExported).toBe(exported);
    });
  }

  it("is key-order independent", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("skips undefined values", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it("rejects unknown graphVersion", () => {
    expect(() => importGraph(JSON.stringify({ graphVersion: 2 }))).toThrow(/graphVersion/);
  });

  it("rejects non-JSON input", () => {
    expect(() => importGraph("not json {")).toThrow(/valid JSON/);
  });

  it("rejects dangling child references", () => {
    const bad = {
      graphVersion: 1,
      project: { name: "x" },
      pages: [{ id: "p", route: "/", root: "r", state: [] }],
      nodes: {
        r: {
          id: "r",
          kind: "Container",
          props: {},
          styleProps: {},
          bindings: [],
          events: [],
          children: ["ghost"],
        },
      },
      contracts: [],
      stores: [],
      theme: {},
    };
    expect(() => importGraph(JSON.stringify(bad))).toThrow(/ghost/);
  });

  it("rejects a page whose root is missing", () => {
    const bad = {
      graphVersion: 1,
      project: { name: "x" },
      pages: [{ id: "p", route: "/", root: "missing", state: [] }],
      nodes: {},
      contracts: [],
      stores: [],
      theme: {},
    };
    expect(() => importGraph(JSON.stringify(bad))).toThrow(/missing/);
  });
});
