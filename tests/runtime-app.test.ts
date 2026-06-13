// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphKernel } from "../src/kernel/kernel";
import { generateApp } from "../src/studio/generate";
import { run } from "../src/runtime-app/run";

// Proves the standalone runtime entry — what gets bundled into the exported
// HTML — actually runs a built app end to end: render, save, persist, with no
// studio and no server. A generated graph is round-tripped through JSON (as the
// HTML embeds it) and driven through the real DOM.

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

function buildGraphJson() {
  let t = 0;
  const kernel = new GraphKernel({ projectName: "tasks", now: () => (t += 1000) });
  generateApp(kernel, {
    entity: "task",
    fields: [
      { name: "title", type: "string" },
      { name: "done", type: "bool" },
    ],
  });
  return kernel.snapshotJson();
}

describe("standalone runtime", () => {
  it("renders the generated app from its graph JSON alone", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    run(buildGraphJson(), mount);
    expect(mount.querySelector(".k-card__title")?.textContent).toBe("New task");
    expect(mount.querySelector(".k-input")).toBeTruthy();
    expect(mount.querySelector("tbody")).toBeTruthy();
  });

  it("runs logic live: typing + Save adds a row and clears the input", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    run(buildGraphJson(), mount);

    const input = mount.querySelector(".k-input") as HTMLInputElement;
    input.value = "Write the white paper";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (mount.querySelector(".k-btn") as HTMLButtonElement).click();

    expect(mount.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(mount.querySelector("tbody tr")!.textContent).toContain("Write the white paper");
    expect(input.value).toBe("");
  });

  it("persists data to localStorage and restores it on a fresh run", () => {
    vi.useFakeTimers();
    const graph = buildGraphJson();
    const first = document.createElement("div");
    document.body.appendChild(first);
    run(graph, first);
    const input = first.querySelector(".k-input") as HTMLInputElement;
    input.value = "Persisted task";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    (first.querySelector(".k-btn") as HTMLButtonElement).click();
    vi.advanceTimersByTime(300); // let the write-behind persist flush
    vi.useRealTimers();

    // A brand-new runtime instance (simulating reopening the file) restores it.
    document.body.innerHTML = "";
    const second = document.createElement("div");
    document.body.appendChild(second);
    run(graph, second);
    expect(second.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(second.querySelector("tbody tr")!.textContent).toContain("Persisted task");
  });
});
