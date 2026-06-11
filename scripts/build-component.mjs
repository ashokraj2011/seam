// The M2 build worker, CLI form: compile a Rust component body and transpile
// it for the browser/node hosts. The studio never compiles during design —
// this runs out of band (here; later as a sidecar endpoint of the dev
// process). Usage: node scripts/build-component.mjs <component-dir-name>
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2] ?? "save-customer";
const crate = join("components", name);
const underscored = name.replaceAll("-", "_");
const wasm = join(crate, "target", "wasm32-wasip1", "release", `${underscored}.wasm`);
const out = join("components", "dist", name);

console.log(`[1/3] cargo component build --release (${name})`);
execSync("cargo component build --release", { cwd: crate, stdio: "inherit" });

console.log("[2/3] jco transpile");
mkdirSync(out, { recursive: true });
execSync(
  `npx jco transpile ${wasm} -o ${out} ` +
    `--map 'app:caps/kv-store=../../../src/runtime/caps/kv-store.js' ` +
    `--map 'app:caps/toast=../../../src/runtime/caps/toast.js' ` +
    `--map 'app:caps/clock=../../../src/runtime/caps/clock.js' ` +
    `--map 'app:caps/nav=../../../src/runtime/caps/nav.js'`,
  { stdio: "inherit" },
);

console.log("[3/3] manifest");
// sha256 in the spike; M3's registry formalizes content addressing (Blake3).
const hash = `sha256:${createHash("sha256").update(readFileSync(wasm)).digest("hex")}`;
const manifest = {
  name,
  hash,
  module: `/components/dist/${name}/${underscored}.js`,
  export: underscored.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  builtWith: "cargo-component + jco",
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
