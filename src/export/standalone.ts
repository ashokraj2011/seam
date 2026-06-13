// Package a built app into ONE self-contained HTML file: the kit CSS, the
// runtime bundle, and the graph, inlined. Open the file → the app runs, with
// no studio, no server, and data kept locally. This is the lock-in-free claim
// made tangible — the artifact is portable and entirely yours.

export interface StandaloneParts {
  title: string;
  graphJson: string; // canonical graph.json (valid JSON == valid JS literal)
  runtimeJs: string; // the bundled SeamRuntime IIFE (exposes SeamRuntime.run)
  css: string; // app.css (tokens + kit styles + utilities)
}

// `</script` inside inlined data/JS would close the surrounding tag early.
const guard = (s: string): string => s.replace(/<\/(script)/gi, "<\\/$1");

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildStandaloneHtml(parts: StandaloneParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(parts.title)}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: var(--color-bg, #fff); }
#seam-app { max-width: 860px; margin: 0 auto; padding: 24px; }
${parts.css}
</style>
</head>
<body>
<div id="seam-app"></div>
<script>${guard(parts.runtimeJs)}</script>
<script>
  SeamRuntime.run(${guard(parts.graphJson)}, document.getElementById("seam-app"));
</script>
</body>
</html>
`;
}
