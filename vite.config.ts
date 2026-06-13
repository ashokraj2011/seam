import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// Dev-only build endpoint: POST a contract's IR to /api/build-component and
// the local dev process lowers + compiles + transpiles it, returning the
// component manifest. This is the "no thick desktop IDE" proof — the Rust
// toolchain is a sidecar of the dev server, not a separate app. Requires
// cargo-component on the machine; absent, it returns a clean error.
function componentBuilder(): Plugin {
  return {
    name: "seam-component-builder",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/build-component", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          res.setHeader("content-type", "application/json");
          let tmp: string;
          try {
            tmp = join(mkdtempSync(join(tmpdir(), "seam-")), "contract.json");
            writeFileSync(tmp, Buffer.concat(chunks).toString("utf8"));
          } catch (err) {
            res.statusCode = 500;
            return res.end(JSON.stringify({ ok: false, error: String(err) }));
          }
          try {
            const out = execFileSync(
              "node",
              ["--experimental-strip-types", "scripts/lower-and-build.mjs", tmp],
              { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
            );
            const line = out.split("\n").find((l) => l.startsWith("__MANIFEST__"));
            if (!line) throw new Error("build produced no manifest");
            res.end(JSON.stringify({ ok: true, manifest: JSON.parse(line.slice("__MANIFEST__".length)) }));
          } catch (err) {
            const e = err as { stderr?: string; message?: string };
            res.statusCode = 200; // a build failure is a normal result the UI shows
            res.end(JSON.stringify({ ok: false, error: (e.stderr || e.message || String(err)).trim() }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [solid(), componentBuilder()],
  build: {
    // jco-transpiled components use top-level await for WASM instantiation;
    // Vite's default es2020 target rejects it.
    target: "es2022",
  },
  server: {
    port: process.env["PORT"] ? Number(process.env["PORT"]) : 5173,
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
