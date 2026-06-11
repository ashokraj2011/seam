import { expect, test } from "@playwright/test";

// The §9 demo script, end to end in a real browser. Each test gets a fresh
// browser context, so IndexedDB starts empty and the demo project seeds.

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(2);
});

const runMode = (page: import("@playwright/test").Page) =>
  page.locator(".s-modes button", { hasText: "Run" }).click();
const designMode = (page: import("@playwright/test").Page) =>
  page.locator(".s-modes button", { hasText: "Design" }).click();

test("save: validate → insert → toast → table updates → inputs clear", async ({ page }) => {
  await runMode(page);
  const inputs = page.locator(".s-canvas .k-input");
  await inputs.nth(0).fill("Edsger Dijkstra");
  await inputs.nth(1).fill("edsger@example.com");
  await page.locator(".s-canvas .k-btn", { hasText: "Save" }).click();

  await expect(page.locator(".s-ambient-toast")).toHaveText("Saved Edsger Dijkstra");
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(3);
  await expect(page.locator(".s-canvas tbody tr").last()).toContainText("Edsger Dijkstra");
  await expect(inputs.nth(0)).toHaveValue("");
  await expect(inputs.nth(1)).toHaveValue("");
});

test("validation error path: toast + predicate badge, nothing persists", async ({ page }) => {
  await runMode(page);
  await page.locator(".s-canvas .k-btn", { hasText: "Save" }).click();
  await expect(page.locator(".s-ambient-toast")).toHaveText("name is required");
  await expect(page.locator(".s-ambient-toast")).toHaveClass(/--error/);
  await expect(page.locator(".s-predbadge")).toContainText("non-empty(name)");
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(2);
});

test("delete with modal confirm on row click", async ({ page }) => {
  await runMode(page);
  await page.locator(".s-canvas tbody td", { hasText: "Ada Lovelace" }).click();
  const modal = page.locator(".k-modal");
  await expect(modal).toBeVisible();
  await expect(modal.locator(".k-label")).toHaveText("Ada Lovelace");
  await modal.locator(".k-btn--danger").click();
  await expect(modal).toBeHidden();
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(1);
  await expect(page.locator(".s-canvas tbody")).not.toContainText("Ada Lovelace");
});

test("reload restores design and data", async ({ page }) => {
  await runMode(page);
  const inputs = page.locator(".s-canvas .k-input");
  await inputs.nth(0).fill("Annie Easley");
  await inputs.nth(1).fill("annie@example.com");
  await page.locator(".s-canvas .k-btn", { hasText: "Save" }).click();
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(3);

  // kv persistence is write-behind (300ms debounce) — let it flush.
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(3);
  await expect(page.locator(".s-canvas tbody")).toContainText("Annie Easley");
});

test("drag from palette into the form card, edit in inspector, undo/redo", async ({ page }) => {
  const card = page.locator(".s-canvas .k-card__body").first();
  const palette = page.locator(".s-palette__item", { hasText: /^Checkbox$/ });
  const target = await card.boundingBox();
  const source = await palette.boundingBox();
  await page.mouse.move(source!.x + 10, source!.y + 10);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height - 6, { steps: 8 });
  await expect(page.locator(".s-indicator")).toBeVisible();
  await page.mouse.up();

  const check = page.locator(".s-canvas .k-check");
  await expect(check).toHaveCount(1);
  await expect(page.locator(".s-inspector strong")).toHaveText("Checkbox");

  const labelRow = page.locator(".s-inspector .s-row", { has: page.locator('span:text-is("label")') });
  await labelRow.locator("input[type=text]").fill("VIP");
  await expect(check).toContainText("VIP");

  await page.locator(".s-header button", { hasText: /^Undo$/ }).click();
  await page.locator(".s-header button", { hasText: /^Undo$/ }).click();
  await expect(page.locator(".s-canvas .k-check")).toHaveCount(0);
  await page.locator(".s-header button", { hasText: /^Redo$/ }).click();
  await page.locator(".s-header button", { hasText: /^Redo$/ }).click();
  await expect(page.locator(".s-canvas .k-check")).toContainText("VIP");
});

test("export → wipe → import reproduces the identical app", async ({ page }) => {
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".s-header button", { hasText: /^Export$/ }).click();
  const download = await downloadPromise;
  const path = await download.path();

  page.once("dialog", (d) => void d.accept());
  await page.locator(".s-header button", { hasText: /^Wipe$/ }).click();
  await page.waitForLoadState("load");
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(2);

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles(path!);
  await page.waitForLoadState("load");
  await expect(page.locator(".s-canvas tbody tr")).toHaveCount(2);
  await expect(page.locator(".s-canvas .k-card__title").first()).toHaveText("New customer");

  // Byte-stable round trip: exporting the imported graph yields identical bytes.
  const second = page.waitForEvent("download");
  await page.locator(".s-header button", { hasText: /^Export$/ }).click();
  const reExport = await second;
  const fs = await import("node:fs/promises");
  const [a, b] = await Promise.all([
    fs.readFile(path!, "utf8"),
    fs.readFile((await reExport.path())!, "utf8"),
  ]);
  expect(b).toBe(a);
});
