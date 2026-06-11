import type { Row } from "../kernel/types";
import type { StateStore } from "./state";

// kv capability persistence: in-memory tables (the StateStore's store.*
// roots) written behind to IndexedDB per project (MVP1_PLAN_AND_SPEC.md §7).
// On load, persisted rows take precedence over graph seeds — that's what
// makes "reload restores everything" true for data, not just design.

const DB_NAME = "seam-studio";
const STORE_NAME = "kv";
const KEY = "tables";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("graphs")) db.createObjectStore("graphs");
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
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

export type KvTables = Record<string, Row[]>;

export async function loadKvTables(): Promise<KvTables | null> {
  const value = await withStore<KvTables | undefined>("readonly", (s) => s.get(KEY));
  return value ?? null;
}

export async function saveKvTables(tables: KvTables): Promise<void> {
  await withStore("readwrite", (s) => s.put(tables, KEY));
}

export async function wipeKvTables(): Promise<void> {
  await withStore("readwrite", (s) => s.delete(KEY));
}

// Snapshot every store.* root from the live state store.
export function collectKvTables(state: StateStore): KvTables {
  const tables: KvTables = {};
  for (const key of state.keys()) {
    if (!key.startsWith("store.")) continue;
    const rows = state.get(key);
    if (Array.isArray(rows)) tables[key.slice("store.".length)] = structuredClone(rows) as Row[];
  }
  return tables;
}
