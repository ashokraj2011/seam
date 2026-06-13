import { defineConfig } from "vite";

// Builds the standalone app runtime as a single self-contained IIFE
// (public/seam-runtime.js), exposing `window.SeamRuntime.run(graph, el)`.
// The studio inlines this into the exported HTML. Solid-free by construction:
// the runtime imports only the kernel, renderer, dispatcher, and kit — none of
// which pull in the studio chrome.
export default defineConfig({
  build: {
    lib: {
      entry: "src/runtime-app/run.ts",
      name: "SeamRuntime",
      formats: ["iife"],
      fileName: () => "seam-runtime.js",
    },
    outDir: "public",
    emptyOutDir: false,
    target: "es2022",
    minify: true,
  },
});
