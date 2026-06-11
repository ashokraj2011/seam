import type { Contract, DataStore, Grant, TypeRef } from "../kernel/types";

// Read-only WIT projection (MVP1_PLAN_AND_SPEC.md §7) — nobody hand-writes
// WIT; this pane exists to keep the architecture visible and validate the
// projection logic early. MVP2's toolchain consumes the same mapping.

export function kebab(name: string): string {
  return (
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "contract"
  );
}

function witType(type: TypeRef, stores: DataStore[]): string {
  if (type === "string") return "string";
  if (type === "number") return "f64";
  if (type === "bool") return "bool";
  const store = stores.find((s) => s.id === type.record);
  return `${kebab(store?.name ?? "unknown")}-row`;
}

const CAP_IMPORTS: Record<Grant["t"], string> = {
  kv: "app:caps/kv-store",
  toast: "app:caps/toast",
  nav: "app:caps/nav",
  clock: "app:caps/clock",
};

export function contractToWit(contract: Contract, stores: DataStore[]): string {
  const name = kebab(contract.name);
  const lines: string[] = ["package app:project;", ""];

  lines.push(`interface ${name} {`);

  // Row records for any record(store) inputs.
  const rowStores = new Map<string, DataStore>();
  for (const field of contract.signature.inputs) {
    const type = field.type;
    if (typeof type === "object") {
      const store = stores.find((s) => s.id === type.record);
      if (store) rowStores.set(store.id, store);
    }
  }
  for (const store of rowStores.values()) {
    const fields = store.schema.map((f) => `${kebab(f.name)}: ${witType(f.type, stores)}`);
    lines.push(`  record ${kebab(store.name)}-row { ${fields.join(", ")} }`);
  }

  if (contract.signature.inputs.length > 0) {
    const fields = contract.signature.inputs.map(
      (f) => `${kebab(f.name)}: ${witType(f.type, stores)}`,
    );
    lines.push(`  record ${name}-input { ${fields.join(", ")} }`);
    const ret = contract.signature.result.t === "error" ? " -> result<_, string>" : "";
    lines.push(`  invoke: func(input: ${name}-input)${ret};`);
  } else {
    const ret = contract.signature.result.t === "error" ? " -> result<_, string>" : "";
    lines.push(`  invoke: func()${ret};`);
  }
  lines.push("}", "");

  lines.push(`world ${name}-body {`);
  const imports = [...new Set(contract.grants.map((g) => CAP_IMPORTS[g.t]))];
  for (const imp of imports) lines.push(`  import ${imp};`);
  if (imports.length === 0) lines.push("  // no grants — no imports: effects are physically absent");
  lines.push(`  export ${name};`);
  lines.push("}", "");
  return lines.join("\n");
}
