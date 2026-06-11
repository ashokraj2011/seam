import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
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
