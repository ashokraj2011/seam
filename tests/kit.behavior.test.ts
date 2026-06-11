// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Value } from "../src/kernel/types";
import { KIT, resolveProps } from "../src/kit";
import { TABLE_ROW_CAP } from "../src/kit/defs/data";

// Behavior vocabulary v1: open-on-trigger, dismiss-on-escape (Modal),
// dismiss-on-timeout (Toast) — plus event emission and the Table row cap.

function mount(kind: keyof typeof KIT, props: Record<string, Value>) {
  const def = KIT[kind];
  const events: Array<{ event: string; payload: Value | null }> = [];
  const inst = def.mount({
    doc: document,
    props: resolveProps(def, props),
    emit: (event, payload) => events.push({ event, payload }),
  });
  document.body.appendChild(inst.root);
  return { def, inst, events };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("event emission", () => {
  it("Button click emits", () => {
    const { inst, events } = mount("Button", {});
    (inst.root as HTMLButtonElement).click();
    expect(events).toEqual([{ event: "click", payload: null }]);
  });

  it("TextInput input emits change with the value", () => {
    const { inst, events } = mount("TextInput", {});
    const input = inst.parts["input"] as HTMLInputElement;
    input.value = "Ada";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toEqual([{ event: "change", payload: { value: "Ada" } }]);
  });

  it("Select change emits the selected value", () => {
    const { inst, events } = mount("Select", { options: ["a", "b"], value: "a" });
    const select = inst.parts["select"] as HTMLSelectElement;
    select.value = "b";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(events).toEqual([{ event: "change", payload: { value: "b" } }]);
  });
});

describe("Modal dismiss-on-escape", () => {
  it("emits close on Escape while open, not while closed", () => {
    const { def, inst, events } = mount("Modal", { open: true });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(events).toEqual([{ event: "close", payload: null }]);

    def.patch(inst, "open", false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(events.length).toBe(1);
  });

  it("removes its document listener on destroy", () => {
    const { inst, events } = mount("Modal", { open: true });
    inst.destroy?.();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(events.length).toBe(0);
  });
});

describe("Toast dismiss-on-timeout", () => {
  it("emits dismiss after duration when opened", () => {
    vi.useFakeTimers();
    const { def, inst, events } = mount("Toast", { duration: 3000 });
    def.patch(inst, "open", true);
    vi.advanceTimersByTime(2999);
    expect(events.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(events).toEqual([{ event: "dismiss", payload: null }]);
  });

  it("cancels the timer when closed early or destroyed", () => {
    vi.useFakeTimers();
    const { def, inst, events } = mount("Toast", { duration: 3000 });
    def.patch(inst, "open", true);
    vi.advanceTimersByTime(1000);
    def.patch(inst, "open", false);
    vi.advanceTimersByTime(10_000);
    expect(events.length).toBe(0);

    def.patch(inst, "open", true);
    inst.destroy?.();
    vi.advanceTimersByTime(10_000);
    expect(events.length).toBe(0);
  });
});

describe("Table", () => {
  it("caps rendering at 1,000 rows with a visible notice", () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ name: `row ${i}` }));
    const { inst } = mount("Table", { columns: ["name"], rows });
    const body = inst.parts["body"] as HTMLElement;
    const notice = inst.parts["notice"] as HTMLElement;
    expect(body.children.length).toBe(TABLE_ROW_CAP);
    expect(notice.hasAttribute("hidden")).toBe(false);
    expect(notice.textContent).toBe("Showing 1000 of 1200 rows");
  });

  it("emits row-click with index and row", () => {
    const rows = [{ name: "Ada" }, { name: "Grace" }];
    const { inst, events } = mount("Table", { columns: ["name"], rows });
    const body = inst.parts["body"] as HTMLElement;
    const secondCell = body.children[1]!.querySelector("td")!;
    secondCell.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(events).toEqual([
      { event: "row-click", payload: { index: 1, row: { name: "Grace" } } },
    ]);
  });
});
