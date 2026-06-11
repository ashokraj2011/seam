// Per-invocation capability binding for transpiled components. The jco
// output imports plain functions, so the host swaps the live journal in
// here before each invoke. Plain JS (with context.d.ts) because the
// generated component JS imports it directly.

const unbound = () => {
  throw new Error("capability called outside an invocation — host did not bind imports");
};

export const current = {
  kvStore: { insert: unbound, query: unbound },
  toast: { show: unbound },
  clock: { nowMs: unbound },
  nav: { go: unbound },
};

export function bindImports(imports) {
  current.kvStore = imports.kvStore;
  current.toast = imports.toast;
  current.clock = imports.clock;
  current.nav = imports.nav;
}
