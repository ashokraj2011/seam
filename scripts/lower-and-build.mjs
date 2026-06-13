// IR → Rust lowering build worker (BUILD_SPEC.md §6). Generates the crate's
// lib.rs and world.wit FROM the contract's action-IR body, then compiles and
// transpiles. The generated component is equivalent to the IR by construction
// — the drift corpus proves it. Run: node --experimental-strip-types
// scripts/lower-and-build.mjs
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loweredRust, loweredWorld } from "../src/runtime/lower.ts";

// The save-customer contract — same body the studio seeds (seed.ts). In a
// full pipeline this comes from the graph; pinned here so the build is
// reproducible without a running studio.
const STORE = "customers";
const contract = {
  name: "save-customer",
  signature: {
    inputs: [
      { name: "name", type: "string" },
      { name: "email", type: "string" },
    ],
    result: { t: "error" },
  },
  grants: [
    { t: "kv", store: "s-customers", mode: "rw" },
    { t: "toast" },
  ],
  seq: [
    { t: "Validate", var: "name", rule: { t: "nonEmpty" }, elseError: "name is required" },
    {
      t: "KvInsert",
      store: "s-customers",
      record: { name: { t: "var", name: "name" }, email: { t: "var", name: "email" } },
    },
    { t: "Toast", template: "Saved {name}" },
    { t: "SetState", path: "state.draftName", from: { t: "lit", value: "" } },
    { t: "SetState", path: "state.draftEmail", from: { t: "lit", value: "" } },
  ],
  storeName: (id) => (id === "s-customers" ? STORE : id),
};

const name = contract.name;
const crate = join("components", name);
const underscored = name.replaceAll("-", "_");

console.log(`[1/4] lower IR -> Rust + WIT (${name})`);
writeFileSync(join(crate, "src", "lib.rs"), loweredRust(contract));
writeFileSync(join(crate, "wit", "world.wit"), loweredWorld(contract));

console.log("[2/4] cargo component build --release");
execSync("cargo component build --release", { cwd: crate, stdio: "inherit" });

console.log("[3/4] jco transpile");
const wasm = join(crate, "target", "wasm32-wasip1", "release", `${underscored}.wasm`);
const out = join("components", "dist", name);
mkdirSync(out, { recursive: true });
const maps = [
  "app:caps/kv-store=../../../src/runtime/caps/kv-store.js",
  "app:caps/toast=../../../src/runtime/caps/toast.js",
  "app:caps/clock=../../../src/runtime/caps/clock.js",
  "app:caps/nav=../../../src/runtime/caps/nav.js",
  "app:caps/ui-state=../../../src/runtime/caps/ui-state.js",
]
  .map((m) => `--map '${m}'`)
  .join(" ");
execSync(`npx jco transpile ${wasm} -o ${out} ${maps}`, { stdio: "inherit" });

console.log("[4/4] manifest");
const hash = `sha256:${createHash("sha256").update(readFileSync(wasm)).digest("hex")}`;
const manifest = {
  name,
  hash,
  module: `/components/dist/${name}/${underscored}.js`,
  export: underscored.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
  builtWith: "lower.ts -> cargo-component -> jco",
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(manifest);
