import type { Action, Expr, Grant, Sig, TypeRef } from "../kernel/types";

// IR → Rust lowering (BUILD_SPEC.md §6): "Action-IR bodies are lowered to
// Rust and compiled through the identical pipeline, so shipped behavior has
// one implementation, not two." This is the mechanism behind drift control —
// the compiled body is GENERATED from the same IR the interpreter runs, so
// equivalence is by construction, not coincidence.
//
// Self-contained (only `import type`) so the build script can load it under
// node --experimental-strip-types. Coverage: Validate(nonEmpty), KvInsert,
// KvQuery, KvUpdate, KvDelete, Toast, SetState, with var/lit string values.
// Record(store) inputs, nested vars, and non-string filter/state vars throw
// LoweringError — the next increment.

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
  // Bodies are fallible (Validate errors, kv can fail), so invoke always
  // returns result<_, string> regardless of the contract's declared result —
  // the Outcome the dispatcher applies is ok|error either way.
  if (c.signature.inputs.length > 0) {
    const fields = c.signature.inputs.map((f) => `${kebab(f.name)}: ${witType(f.type)}`);
    lines.push(`  record ${iface}-input { ${fields.join(", ")} }`);
    lines.push(`  invoke: func(input: ${iface}-input) -> result<_, string>;`);
  } else {
    lines.push(`  invoke: func() -> result<_, string>;`);
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

const OPS: Record<string, string> = { eq: "eq", neq: "neq", contains: "contains" };

export function loweredRust(c: LoweringContract): string {
  const iface = kebab(c.name);
  const mod = snake(iface);
  const inputType = `${pascal(iface)}Input`;
  const fieldSet = new Set(c.signature.inputs.map((f) => f.name));
  let needsJsonStr = false;

  const fieldRef = (name: string): string => {
    if (name.includes(".")) throw new LoweringError(`nested var ${name} (record input) not lowered yet`);
    if (!fieldSet.has(name)) throw new LoweringError(`var ${name} is not a contract input`);
    return `input.${snake(name)}`;
  };

  // A kv record/set value (must be a string in v0 kv).
  const recordValue = (e: Expr): string => {
    if (e.t === "lit") {
      if (typeof e.value !== "string") throw new LoweringError("only string kv values are lowered");
      return `${rustStr(e.value)}.to_string()`;
    }
    return `${fieldRef(e.name)}.clone()`;
  };

  // A JSON-encoded filter value param: lit encoded at codegen, var via json_str.
  const filterValue = (e: Expr): string => {
    if (e.t === "lit") return rustStr(JSON.stringify(e.value));
    needsJsonStr = true;
    return `&json_str(&${fieldRef(e.name)})`;
  };

  const tuples = (rec: Record<string, Expr>): string[] =>
    Object.entries(rec).map(([k, v]) => `(${rustStr(k)}.to_string(), ${recordValue(v)})`);

  const body: string[] = [];
  const emitTuples = (head: string, tail: string, rec: Record<string, Expr>) => {
    body.push(`        ${head}`);
    for (const t of tuples(rec)) body.push(`            ${t},`);
    body.push(`        ${tail}`);
  };

  for (const action of c.seq) {
    switch (action.t) {
      case "Validate": {
        if (action.rule.t !== "nonEmpty") {
          throw new LoweringError(`Validate rule '${action.rule.t}' is not lowered yet`);
        }
        body.push(`        if ${fieldRef(action.var)}.trim().is_empty() {`);
        body.push(`            return Err(${rustStr(action.elseError)}.to_string());`);
        body.push(`        }`);
        break;
      }
      case "KvInsert":
        emitTuples(`kv_store::insert(${rustStr(c.storeName(action.store))}, &[`, `])?;`, action.record);
        break;
      case "KvUpdate":
        emitTuples(
          `kv_store::update(${rustStr(c.storeName(action.store))}, ${rustStr(action.where.field)}, ${rustStr(OPS[action.where.op]!)}, ${filterValue(action.where.value)}, &[`,
          `])?;`,
          action.set,
        );
        break;
      case "KvDelete":
        body.push(
          `        kv_store::delete(${rustStr(c.storeName(action.store))}, ${rustStr(action.where.field)}, ${rustStr(OPS[action.where.op]!)}, ${filterValue(action.where.value)})?;`,
        );
        break;
      case "KvQuery":
        throw new LoweringError("KvQuery + Branch are not lowered yet");
      case "Toast":
        body.push(`        ${toastCall(action.template, fieldRef)}`);
        break;
      case "SetState": {
        if (action.from.t === "lit") {
          body.push(
            `        ui_state::set(${rustStr(action.path)}, ${rustStr(JSON.stringify(action.from.value))});`,
          );
        } else {
          needsJsonStr = true;
          body.push(`        ui_state::set(${rustStr(action.path)}, &json_str(&${fieldRef(action.from.name)}));`);
        }
        break;
      }
      case "Navigate":
        body.push(`        nav::go(${rustStr(action.route)});`);
        break;
      case "Branch":
        throw new LoweringError("Branch is not lowered yet");
    }
  }

  const uses = neededImports(c)
    .map((imp) => `use bindings::app::caps::${snake(imp)};`)
    .join("\n");

  const helper = needsJsonStr
    ? `
// Minimal JSON string encoder so filter/state values round-trip to the host
// as the exact Value (no serde dependency for the v0 string case).
fn json_str(s: &str) -> String {
    let mut o = String::from("\\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\\\\""),
            '\\\\' => o.push_str("\\\\\\\\"),
            '\\n' => o.push_str("\\\\n"),
            '\\r' => o.push_str("\\\\r"),
            '\\t' => o.push_str("\\\\t"),
            _ => o.push(c),
        }
    }
    o.push('"');
    o
}
`
    : "";

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
${helper}
bindings::export!(Component with_types_in bindings);
`;
}

function toastCall(template: string, fieldRef: (name: string) => string): string {
  const args: string[] = [];
  const fmt = template.replace(/\{([\w.]+)\}/g, (_, name: string) => {
    args.push(fieldRef(name));
    return "{}";
  });
  if (args.length === 0) return `toast::show(${rustStr(fmt)});`;
  return `toast::show(&format!(${rustStr(fmt)}, ${args.join(", ")}));`;
}
