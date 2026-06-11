// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Value } from "../src/kernel/types";
import { KIT, resolveProps } from "../src/kit";

// P2 exit test, half one: every kind × every prop renders from fixtures.
// Fixtures are renderer-agnostic DOM expectations — the same files later
// test the Dioxus projection (MVP1_PLAN_AND_SPEC.md §10).

interface Expectation {
  is: "text" | "class" | "attr" | "count";
  selector: string;
  equals?: string | number;
  has?: string[];
  lacks?: string[];
  name?: string;
  present?: boolean;
}

interface FixtureCase {
  name: string;
  props: Record<string, Value>;
  expect: Expectation[];
}

interface Fixture {
  kind: string;
  cases: FixtureCase[];
}

// import.meta.url is an http: URL under the happy-dom environment — resolve
// from the project root instead (vitest runs with cwd at the package root).
const FIXTURES_DIR = join(process.cwd(), "fixtures", "kit");

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf8")) as Fixture);
}

function check(host: HTMLElement, e: Expectation): void {
  const label = `${e.is} ${e.selector}`;
  if (e.is === "count") {
    expect(host.querySelectorAll(e.selector).length, label).toBe(e.equals);
    return;
  }
  const target = host.querySelector(e.selector);
  if (e.is === "attr" && e.present === false && !target) return; // absent element ⇒ attr absent
  expect(target, `${label}: element not found`).toBeTruthy();
  if (e.is === "text") {
    expect(target!.textContent, label).toBe(e.equals);
  } else if (e.is === "class") {
    for (const cls of e.has ?? []) expect(target!.classList.contains(cls), `${label} has ${cls}`).toBe(true);
    for (const cls of e.lacks ?? []) expect(target!.classList.contains(cls), `${label} lacks ${cls}`).toBe(false);
  } else if (e.is === "attr") {
    const value = target!.getAttribute(e.name!);
    if (e.present !== undefined) expect(value !== null, `${label}[${e.name}] present`).toBe(e.present);
    if (e.equals !== undefined) expect(value, `${label}[${e.name}]`).toBe(e.equals);
  }
}

const fixtures = loadFixtures();

it("has a fixture file for every kit kind", () => {
  expect(fixtures.map((f) => f.kind).sort()).toEqual(Object.keys(KIT).sort());
});

for (const fixture of fixtures) {
  const def = KIT[fixture.kind as keyof typeof KIT];
  describe(`${fixture.kind} fixtures`, () => {
    it("covers every prop in the schema", () => {
      const covered = new Set(fixture.cases.flatMap((c) => Object.keys(c.props)));
      for (const prop of Object.keys(def.props)) {
        expect(covered.has(prop), `prop ${prop} appears in no fixture case`).toBe(true);
      }
    });

    for (const fixtureCase of fixture.cases) {
      it(fixtureCase.name, () => {
        const host = document.createElement("div");
        const inst = def.mount({
          doc: document,
          props: resolveProps(def, fixtureCase.props),
          emit: () => {},
        });
        host.appendChild(inst.root);
        for (const e of fixtureCase.expect) check(host, e);
        inst.destroy?.();
      });
    }
  });
}
