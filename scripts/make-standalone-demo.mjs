// Build a standalone demo app to public/standalone-demo.html so it can be
// opened directly (served by Vite) to prove it runs with no studio.
// Run: node --experimental-strip-types scripts/make-standalone-demo.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { GraphKernel } from "../src/kernel/kernel.ts";
import { generateApp } from "../src/studio/generate.ts";
import { buildStandaloneHtml } from "../src/export/standalone.ts";

let t = 0;
const kernel = new GraphKernel({ projectName: "tasks", now: () => (t += 1000) });
generateApp(kernel, {
  entity: "task",
  fields: [
    { name: "title", type: "string" },
    { name: "done", type: "bool" },
  ],
});

const html = buildStandaloneHtml({
  title: "tasks",
  graphJson: kernel.snapshotJson(),
  runtimeJs: readFileSync("public/seam-runtime.js", "utf8"),
  css: readFileSync("src/kit/app.css", "utf8"),
});
writeFileSync("public/standalone-demo.html", html);
console.log(`wrote public/standalone-demo.html (${html.length} bytes)`);
