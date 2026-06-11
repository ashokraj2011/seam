import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { DEFAULT_THEME } from "../src/kernel/kernel";
import { tokensCss, utilitiesCss } from "../src/kit/styleprops";

// app.css is one file (tokens + kit styles + utilities) loaded identically by
// studio preview and shipped apps. The generated blocks must match their
// sources; regenerate with UPDATE_CSS=1 npx vitest run tests/appcss.test.ts

const CSS_PATH = fileURLToPath(new URL("../src/kit/app.css", import.meta.url));

function block(css: string, name: string): { full: string; inner: string } {
  const start = `/* @generated ${name}:start */`;
  const end = `/* @generated ${name}:end */`;
  const from = css.indexOf(start);
  const to = css.indexOf(end);
  if (from < 0 || to < 0) throw new Error(`app.css: missing @generated ${name} markers`);
  const inner = css.slice(from + start.length, to).trim();
  return { full: css.slice(from, to + end.length), inner };
}

function regenerate(css: string, name: string, content: string): string {
  const { full } = block(css, name);
  return css.replace(full, `/* @generated ${name}:start */\n${content.trim()}\n/* @generated ${name}:end */`);
}

it("generated css blocks match their sources", () => {
  let css = readFileSync(CSS_PATH, "utf8");
  const wantTokens = tokensCss(DEFAULT_THEME).trim();
  const wantUtilities = utilitiesCss().trim();

  if (process.env["UPDATE_CSS"]) {
    css = regenerate(css, "tokens", wantTokens);
    css = regenerate(css, "utilities", wantUtilities);
    writeFileSync(CSS_PATH, css);
  }

  expect(block(css, "tokens").inner).toBe(wantTokens);
  expect(block(css, "utilities").inner).toBe(wantUtilities);
});
