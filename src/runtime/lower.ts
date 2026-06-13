import type { Action, Expr, Grant, Sig, TypeRef, Value } from "../kernel/types";

// IR → Rust lowering (BUILD_SPEC.md §6): "Action-IR bodies are lowered to
// Rust and compiled through the identical pipeline, so shipped behavior has
// one implementation, not two." This is the mechanism behind drift control —
// the compiled body is GENERATED from the same IR the interpreter runs, so
// equivalence is by construction, not coincidence.
//
// Self-contained (only `import type`) so the build script can load it under
// node --experimental-strip-types. Coverage is the save-customer action set:
// Validate(nonEmpty), KvInsert (string record values), Toast, SetState (lit).
// Anything else throws LoweringError — the honest boundary; KvUpdate/KvDelete,
// KvQuery/Branch, and var-sourced SetState are the next lowering increment.

export class LoweringError extends Error {
  override name = "LoweringError";
}

export interface LoweringContract {
  name: string;
  signature: Sig;
  grants: Grant[];
  seq: Action[];
  storeName: (id: string) => string;
}

// ── identifier helpers (mirror runtime/wit.ts kebab) ───────────────────────

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

const snake = (name: string): string => kebab(name).replace(/-/g, "_");
const pascal = (name: string): string =>
  kebab(name)
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");

const rustStr = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// ── WIT world projection (build-time form, with caps versions) ─────────────

function witType(type: TypeRef): string {
  if (type === "string") return "string";
  if (type === "number") return "f64";
  if (type === "bool") return "bool";
  throw new LoweringError("record(store) inputs are not lowered yet");
}

export function loweredWorld(c: LoweringContract): string {
  const iface = kebab(c.name);
  const lines = [`package app:customer@0.1.0;`, "", `interface ${iface} {`];
  if (c.signature.inputs.length > 0) {
    const fields = c.signature.inputs.map((f) => `${kebab(f.name)}: ${witType(f.type)}`);
    lines.push(`  record ${iface}-input { ${fields.join(", ")} }`);
    const ret = c.signature.result.t === "error" ? " -> result<_, string>" : "";
    lines.push(`  invoke: func(input: ${iface}-input)${ret};`);
  } else {
    const ret = c.signature.result.t === "error" ? " -> result<_, string>" : "";
    lines.push(`  invoke: func()${ret};`);
  }
  lines.push("}", "", `world ${iface}-body {`);
  for (const imp of neededImports(c)) lines.push(`  import app:caps/${imp}@0.1.0;`);
  lines.push(`  export ${iface};`, "}", "");
  return lines.join("\n");
}

function neededImports(c: LoweringContract): string[] {
  const imports = new Set<string>();
  const grant = (t: Grant["t"]) => c.grants.some((g) => g.t === t);
  const walk = (actions: Action[]) => {
    for (const a of actions) {
      if (a.t === "KvInsert" || a.t === "KvQuery" || a.t === "KvUpdate" || a.t === "KvDelete") {
        if (grant("kv")) imports.add("kv-store");
      } else if (a.t === "Toast" && grant("toast")) imports.add("toast");
      else if (a.t === "Navigate" && grant("nav")) imports.add("nav");
      else if (a.t === "SetState") imports.add("ui-state");
      else if (a.t === "Branch") walk([...a.then, ...a.else]);
    }
  };
  walk(c.seq);
  return [...imports];
}

// ── Rust body projection ───────────────────────────────────────────────────

export function loweredRust(c: LoweringContract): string {
  const iface = kebab(c.name);
  const mod = snake(iface);
  const inputType = `${pascal(iface)}Input`;
  const fieldSet = new Set(c.signature.inputs.map((f) => f.name));

  const exprRust = (e: Expr): string => {
    if (e.t === "lit") {
      if (typeof e.value !== "string") {
        throw new LoweringError("only string literal record values are lowered");
      }
      return `${rustStr(e.value)}.to_string()`;
    }
    if (!fieldSet.has(e.name)) throw new LoweringError(`var ${e.name} is not a contract input`);
    return `input.${snake(e.name)}.clone()`;
  };

  const body: string[] = [];
  for (const action of c.seq) {
    switch (action.t) {
      case "Validate": {
        if (action.rule.t !== "nonEmpty") {
          throw new LoweringError(`Validate rule '${action.rule.t}' is not lowered yet`);
        }
        if (!fieldSet.has(action.var)) {
          throw new LoweringError(`Validate var ${action.var} is not a contract input`);
        }
        body.push(`        if input.${snake(action.var)}.trim().is_empty() {`);
        body.push(`            return Err(${rustStr(action.elseError)}.to_string());`);
        body.push(`        }`);
        break;
      }
      case "KvInsert": {
        const store = c.storeName(action.store);
        const tuples = Object.entries(action.record).map(
          ([k, expr]) => `(${rustStr(k)}.to_string(), ${exprRust(expr)})`,
        );
        body.push(`        kv_store::insert(${rustStr(store)}, &[`);
        for (const t of tuples) body.push(`            ${t},`);
        body.push(`        ])?;`);
        break;
      }
      case "Toast": {
        body.push(`        ${toastCall(action.template, fieldSet)}`);
        break;
      }
      case "SetState": {
        if (action.from.t !== "lit") {
          throw new LoweringError("only literal SetState values are lowered yet");
        }
        const json = JSON.stringify(action.from.value satisfies Value);
        body.push(`        ui_state::set(${rustStr(action.path)}, ${rustStr(json)});`);
        break;
      }
      default:
        throw new LoweringError(`action '${action.t}' is not lowered yet`);
    }
  }

  const uses = neededImports(c)
    .map((imp) => `use bindings::app::caps::${snake(imp)};`)
    .join("\n");

  return `// @generated by src/runtime/lower.ts from the ${iface} action-IR body.
// One implementation: this Rust is lowered from the same IR the interpreter
// runs, so the two BodyRef arms are equivalent by construction (drift corpus).
#[allow(warnings)]
mod bindings;

${uses}
use bindings::exports::app::customer::${mod}::{Guest, ${inputType}};

struct Component;

impl Guest for Component {
    fn invoke(input: ${inputType}) -> Result<(), String> {
${body.join("\n")}
        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
`;
}

function toastCall(template: string, fields: Set<string>): string {
  const args: string[] = [];
  const fmt = template.replace(/\{([\w.]+)\}/g, (_, name: string) => {
    if (!fields.has(name)) throw new LoweringError(`toast var ${name} is not a contract input`);
    args.push(`input.${snake(name)}`);
    return "{}";
  });
  if (args.length === 0) return `toast::show(${rustStr(fmt)});`;
  return `toast::show(&format!(${rustStr(fmt)}, ${args.join(", ")}));`;
}
