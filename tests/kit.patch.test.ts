// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { Value } from "../src/kernel/types";
import type { PropSpec } from "../src/kit";
import { KIT, resolveProps } from "../src/kit";

// P2 exit test, half two: a prop patch touches only dependency-mapped nodes,
// asserted via MutationObserver — for every kind × every prop.

function altValue(spec: PropSpec): Value {
  switch (spec.t) {
    case "string":
      return "zzz-alt";
    case "number":
      return typeof spec.default === "number" ? spec.default + 41 : 41;
    case "bool":
      return spec.default !== true;
    case "enum":
      return spec.options!.find((o) => o !== spec.default)!;
    case "strings":
      return ["alt-a", "alt-b"];
    case "json":
      return [{ "Column 1": "alt", name: "alt" }];
  }
}

function isWithin(target: Node, part: Node): boolean {
  let cur: Node | null = target;
  while (cur) {
    if (cur === part) return true;
    cur = cur.parentNode;
  }
  return false;
}

for (const def of Object.values(KIT)) {
  describe(`${def.kind} patch scoping`, () => {
    it("declares deps for every prop", () => {
      expect(Object.keys(def.deps).sort()).toEqual(Object.keys(def.props).sort());
    });

    for (const [prop, spec] of Object.entries(def.props)) {
      it(`${prop} touches only dep-mapped parts`, () => {
        const inst = def.mount({ doc: document, props: resolveProps(def, {}), emit: () => {} });
        document.body.appendChild(inst.root);

        const observer = new MutationObserver(() => {});
        observer.observe(inst.root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });

        def.patch(inst, prop, altValue(spec));

        const records = observer.takeRecords();
        observer.disconnect();
        const allowedParts = (def.deps[prop] ?? [])
          .map((name) => inst.parts[name])
          .filter((p): p is Node => Boolean(p));

        if (allowedParts.length === 0) {
          expect(records.length, `${def.kind}.${prop} has no deps — patch must not touch DOM`).toBe(0);
        } else {
          expect(records.length, `${def.kind}.${prop} patch should mutate DOM`).toBeGreaterThan(0);
          for (const record of records) {
            const ok = allowedParts.some((part) => isWithin(record.target, part));
            expect(
              ok,
              `${def.kind}.${prop}: mutation on ${record.target.nodeName} (${record.type}) outside deps [${def.deps[prop]!.join(", ")}]`,
            ).toBe(true);
          }
        }

        inst.destroy?.();
        inst.root.remove();
      });
    }
  });
}
