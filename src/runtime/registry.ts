import manifest from "../../components/dist/save-customer/manifest.json";

// Registry v0 (the M3 milestone formalizes this as a content-addressed
// store with receipts): a static index of built components by hash.
// `module` is loaded lazily — the studio never pays for WASM it doesn't run.

export interface ComponentEntry {
  name: string;
  hash: string;
  export: string;
  load: () => Promise<Record<string, { invoke: (input: unknown) => unknown }>>;
}

const entries: ComponentEntry[] = [
  {
    name: manifest.name,
    hash: manifest.hash,
    export: manifest.export,
    load: () =>
      import("../../components/dist/save-customer/save_customer.js") as unknown as Promise<
        Record<string, { invoke: (input: unknown) => unknown }>
      >,
  },
];

export function componentByHash(hash: string): ComponentEntry | undefined {
  return entries.find((e) => e.hash === hash);
}

export function componentForContract(contractName: string): ComponentEntry | undefined {
  return entries.find((e) => e.name === contractName);
}
