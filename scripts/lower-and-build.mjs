// IR → Rust lowering build worker (BUILD_SPEC.md §6). Generates a whole crate
// (Cargo.toml, world.wit, lib.rs) FROM a contract's action-IR body, then
// compiles and transpiles. The generated component is equivalent to the IR by
// construction — the drift corpus proves it.
//
//   node --experimental-strip-types scripts/lower-and-build.mjs            # demo set
//   node --experimental-strip-types scripts/lower-and-build.mjs <file.json> # one contract -> manifest on stdout
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loweredRust, loweredWorld } from "../src/runtime/lower.ts";

// The demo contracts — same bodies the studio seeds (src/shared/seed.ts).
const DEMO = [
  {
    name: "save-customer",
    signature: {
      inputs: [
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
      result: { t: "error" },
    },
    grants: [{ t: "kv", store: "customers", mode: "rw" }, { t: "toast" }],
    stores: { customers: "customers" },
    seq: [
      { t: "Validate", var: "name", rule: { t: "nonEmpty" }, elseError: "name is required" },
      {
        t: "KvInsert",
        store: "customers",
        record: { name: { t: "var", name: "name" }, email: { t: "var", name: "email" } },
      },
      { t: "Toast", template: "Saved {name}" },
      { t: "SetState", path: "state.draftName", from: { t: "lit", value: "" } },
      { t: "SetState", path: "state.draftEmail", from: { t: "lit", value: "" } },
    ],
  },
  {
    name: "delete-customer",
    signature: { inputs: [{ name: "name", type: "string" }], result: { t: "ok" } },
    grants: [{ t: "kv", store: "customers", mode: "rw" }, { t: "toast" }],
    stores: { customers: "customers" },
    seq: [
      {
        t: "KvDelete",
        store: "customers",
        where: { field: "name", op: "eq", value: { t: "var", name: "name" } },
      },
      { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: false } },
      { t: "Toast", template: "Deleted {name}" },
    ],
  },
];

const CARGO = (name) => `[package]
name = "${name}"
version = "0.1.0"
edition = "2021"

[dependencies]
wit-bindgen-rt = { version = "0.39.0", features = ["bitflags"] }

[lib]
crate-type = ["cdylib"]

[profile.release]
codegen-units = 1
opt-level = "s"
strip = true
lto = true

[package.metadata.component]
package = "app:customer"

[package.metadata.component.target.dependencies]
"app:caps" = { path = "wit/deps/caps" }
`;

function buildContract(spec) {
  const contract = { ...spec, storeName: (id) => spec.stores[id] ?? id };
  const name = spec.name;
  const crate = join("components", name);
  const underscored = name.replaceAll("-", "_");

  // Scaffold/refresh the crate entirely from the contract.
  mkdirSync(join(crate, "src"), { recursive: true });
  mkdirSync(join(crate, "wit", "deps", "caps"), { recursive: true });
  writeFileSync(join(crate, "Cargo.toml"), CARGO(name));
  cpSync("components/caps.wit", join(crate, "wit", "deps", "caps", "caps.wit"));
  writeFileSync(join(crate, "wit", "world.wit"), loweredWorld(contract));
  writeFileSync(join(crate, "src", "lib.rs"), loweredRust(contract));

  execSync("cargo component build --release", { cwd: crate, stdio: "inherit" });

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

  const hash = `sha256:${createHash("sha256").update(readFileSync(wasm)).digest("hex")}`;
  const manifest = {
    name,
    hash,
    module: `/components/dist/${name}/${underscored}.js`,
    export: underscored.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    builtWith: "lower.ts -> cargo-component -> jco",
  };
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

const arg = process.argv[2];
if (arg) {
  // Single contract from a JSON file — used by the studio's live build endpoint.
  const spec = JSON.parse(readFileSync(arg, "utf8"));
  const manifest = buildContract(spec);
  process.stdout.write("\n__MANIFEST__" + JSON.stringify(manifest) + "\n");
} else {
  for (const spec of DEMO) {
    console.log(`\n=== building ${spec.name} ===`);
    console.log(buildContract(spec));
  }
}
