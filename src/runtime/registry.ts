import saveManifest from "../../components/dist/save-customer/manifest.json";
import deleteManifest from "../../components/dist/delete-customer/manifest.json";

// Registry v0 (M3 formalizes this as a content-addressed store with receipts):
// an index of built components by hash. `module` is loaded lazily — the studio
// never pays for WASM it doesn't run. A dynamic registry (registerDynamic)
// holds components built live via the dev-server build endpoint.

export interface ComponentEntry {
  name: string;
  hash: string;
  export: string;
  load: () => Promise<Record<string, { invoke: (input: unknown) => unknown }>>;
}

type LoadedModule = Record<string, { invoke: (input: unknown) => unknown }>;

const entries: ComponentEntry[] = [
  {
    name: saveManifest.name,
    hash: saveManifest.hash,
    export: saveManifest.export,
    load: () =>
      import("../../components/dist/save-customer/save_customer.js") as unknown as Promise<LoadedModule>,
  },
  {
    name: deleteManifest.name,
    hash: deleteManifest.hash,
    export: deleteManifest.export,
    load: () =>
      import("../../components/dist/delete-customer/delete_customer.js") as unknown as Promise<LoadedModule>,
  },
];

// Components built live by the dev-server endpoint, keyed by hash. Loaded by
// dynamic import of the freshly transpiled module (cache-busted).
const dynamic = new Map<string, ComponentEntry>();

export function registerDynamic(entry: ComponentEntry): void {
  dynamic.set(entry.hash, entry);
  const i = entries.findIndex((e) => e.name === entry.name);
  if (i >= 0) entries[i] = { ...entries[i]!, hash: entry.hash, load: entry.load };
}

export function componentByHash(hash: string): ComponentEntry | undefined {
  return dynamic.get(hash) ?? entries.find((e) => e.hash === hash);
}

export function componentForContract(contractName: string): ComponentEntry | undefined {
  return entries.find((e) => e.name === contractName);
}
