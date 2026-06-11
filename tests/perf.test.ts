// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import type { Node } from "../src/kernel/types";
import { Renderer } from "../src/renderer/renderer";
import { dispatchWire } from "../src/runtime/dispatch";
import { seedDemo } from "../src/shared/seed";

// §9 quantitative gates. Run in happy-dom, which is *slower* than real DOM
// for these paths — passing here is conservative.
//  - prop edit → visible update p95 < 16ms on a 500-node page
//  - Run-mode invocation of a five-action body p95 < 5ms (in-memory commit;
//    the IndexedDB flush is write-behind and excluded by construction)

const p95 = (samples: number[]): number => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
};

const node = (id: string, kind: Node["kind"], children: string[] = []): Node => ({
  id,
  kind,
  props: {},
  styleProps: {},
  bindings: [],
  events: [],
  children,
});

describe("§9 quantitative gates", () => {
  it("prop edit p95 < 16ms on a 500-node page", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "perf", now: () => (t += 1000) });
    // 500 nodes: root + 24 cards × ~21 labels each
    const nodes: Node[] = [node("root", "Container")];
    const labelIds: string[] = [];
    for (let c = 0; c < 24; c++) {
      const children: string[] = [];
      for (let l = 0; l < 20; l++) {
        const id = `label-${c}-${l}`;
        children.push(id);
        labelIds.push(id);
        nodes.push(node(id, "Label"));
      }
      const cardId = `card-${c}`;
      nodes.push(node(cardId, "Card", children));
      nodes[0]!.children.push(cardId);
    }
    kernel.apply({
      t: "AddPage",
      page: { id: "p", route: "/", root: "root", state: [] },
      nodes,
    });
    expect(kernel.state.nodes.size).toBeGreaterThanOrEqual(500);

    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const live = new Renderer(kernel, mountEl);
    live.renderPage("p");

    const samples: number[] = [];
    for (let i = 0; i < 300; i++) {
      const target = labelIds[i % labelIds.length]!;
      const start = performance.now();
      kernel.apply({ t: "SetProp", node: target, key: "text", value: `v${i}` });
      samples.push(performance.now() - start);
    }
    const result = p95(samples);
    expect(result, `prop-edit p95 was ${result.toFixed(2)}ms`).toBeLessThan(16);
  });

  it("five-action invocation p95 < 5ms to in-memory commit", () => {
    let t = 0;
    const kernel = new GraphKernel({ projectName: "perf", now: () => (t += 1000) });
    seedDemo(kernel);
    const mountEl = document.createElement("div");
    document.body.appendChild(mountEl);
    const renderer = new Renderer(kernel, mountEl);
    renderer.renderPage(kernel.state.pages[0]!.id);

    const saveBtn = [...kernel.state.nodes.values()].find(
      (n) => n.kind === "Button" && n.props["text"] === "Save",
    )!;
    const wire = saveBtn.events.find((w) => w.event === "click")!;
    const inputs = mountEl.querySelectorAll(".k-input");
    const deps = {
      kernel,
      state: renderer.stateStore!,
      readNodeValue: (id: string) => renderer.readNodeValue(id),
      toast: () => {},
      navigate: () => {},
    };

    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      (inputs[0] as HTMLInputElement).value = `Customer ${i}`;
      (inputs[1] as HTMLInputElement).value = `c${i}@example.com`;
      const start = performance.now();
      dispatchWire(deps, saveBtn.id, wire, null);
      samples.push(performance.now() - start);
    }
    const result = p95(samples);
    expect(result, `invocation p95 was ${result.toFixed(2)}ms`).toBeLessThan(5);
  });
});
