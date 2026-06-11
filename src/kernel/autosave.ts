import type { GraphKernel } from "./kernel";

// IndexedDB autosave — the P1 exit test is "kill the tab, reopen, graph
// intact". Saves are debounced and write-behind; the kernel never waits.

const DB_NAME = "seam-studio";
const STORE_NAME = "graphs";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2 adds the "kv" object store (runtime/kvpersist.ts); both modules
    // must agree on the version and create both stores on upgrade.
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const req = fn(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveSnapshot(json: string): Promise<void> {
  await withStore("readwrite", (store) => store.put(json, KEY));
}

export async function loadSnapshot(): Promise<string | null> {
  const value = await withStore<string | undefined>("readonly", (store) => store.get(KEY));
  return value ?? null;
}

export async function wipeSnapshot(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}

export function attachAutosave(
  kernel: GraphKernel,
  opts: {
    debounceMs?: number;
    onSaved?: (at: Date) => void;
    onError?: (err: unknown) => void;
  } = {},
): () => void {
  const debounceMs = opts.debounceMs ?? 250;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = kernel.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      saveSnapshot(kernel.snapshotJson()).then(
        () => opts.onSaved?.(new Date()),
        (err) => opts.onError?.(err),
      );
    }, debounceMs);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}
