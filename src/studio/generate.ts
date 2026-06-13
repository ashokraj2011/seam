import type { GraphKernel } from "../kernel/kernel";
import type { Action, ComponentKind, Expr, FieldDecl, PageId, TypeRef, Value } from "../kernel/types";
import { blankNode, newId } from "../shared/nodes";

// Schema → working app generator. Given an entity name and a list of fields,
// it emits a complete, runnable CRUD app — store, page, a bound form, a bound
// table, a delete-with-confirm flow, and the save/select/delete contracts with
// the right grants, predicates, and wired inputs.
//
// This is the on-demand-UI / lock-in-free thesis made concrete: the output is
// just graph data + interpretable contracts you own — no vendor runtime, and
// each contract can later compile to a portable WASM component. The structure
// mirrors the hand-built demo (src/shared/seed.ts) that the drift corpus and
// e2e already prove, so a generated app is a proven app.

export interface AppSpec {
  entity: string; // singular, e.g. "task"
  fields: FieldDecl[]; // at least one
}

const inputKind = (type: TypeRef): ComponentKind =>
  type === "number" ? "NumberInput" : type === "bool" ? "Checkbox" : "TextInput";

const valueProp = (type: TypeRef): string => (type === "bool" ? "checked" : "value");

const emptyValue = (type: TypeRef): Value => (type === "number" ? 0 : type === "bool" ? false : "");

const draftPath = (field: string): string => `state.draft_${field}`;

const title = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// Build the whole app on the kernel and return the new page id. Non-destructive:
// it adds a store, page, and contracts alongside anything already present.
export function generateApp(kernel: GraphKernel, spec: AppSpec): PageId {
  const entity = spec.entity.trim() || "item";
  const fields = spec.fields.filter((f) => f.name.trim());
  if (fields.length === 0) fields.push({ name: "title", type: "string" });
  const storeName = entity.endsWith("s") ? entity : `${entity}s`;
  const firstString = fields.find((f) => f.type === "string") ?? fields[0]!;

  // ── store ────────────────────────────────────────────────────────────────
  const storeId = newId("store");
  kernel.apply({
    t: "DeclareStore",
    store: { id: storeId, name: storeName, schema: fields.map((f) => ({ ...f })), seed: [] },
  });

  // ── page + state ──────────────────────────────────────────────────────────
  const root = blankNode("Container", { gap: "3" });
  const pageId = newId("page");
  kernel.apply({
    t: "AddPage",
    page: {
      id: pageId,
      route: `/${storeName}`,
      root: root.id,
      state: [
        ...fields.map((f) => ({ name: `draft_${f.name}`, type: f.type, initial: emptyValue(f.type) })),
        { name: "pendingKey", type: "string" as const, initial: "" },
        { name: "confirmOpen", type: "bool" as const, initial: false },
      ],
    },
    nodes: [root],
  });

  // ── form card: one input per field, bound to draft state ──────────────────
  const form = blankNode("Card", { title: `New ${entity}` });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 0, node: form });
  const inputNodes: Record<string, string> = {};
  fields.forEach((f, i) => {
    const node = blankNode(inputKind(f.type), { label: title(f.name) });
    kernel.apply({ t: "InsertNode", parent: form.id, index: i, node });
    kernel.apply({ t: "BindProp", node: node.id, prop: valueProp(f.type), path: draftPath(f.name) });
    inputNodes[f.name] = node.id;
  });
  const saveBtn = blankNode("Button", { text: `Save ${entity}` });
  kernel.apply({ t: "InsertNode", parent: form.id, index: fields.length, node: saveBtn });

  // ── list card: table bound to the store ───────────────────────────────────
  const list = blankNode("Card", { title: `${title(storeName)}` });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 1, node: list });
  const table = blankNode("Table", { columns: fields.map((f) => f.name) });
  kernel.apply({ t: "InsertNode", parent: list.id, index: 0, node: table });
  kernel.apply({ t: "BindProp", node: table.id, prop: "rows", path: `store.${storeName}` });

  // ── delete-confirm modal ──────────────────────────────────────────────────
  const modal = blankNode("Modal", { title: `Delete ${entity}?` });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 2, node: modal });
  kernel.apply({ t: "BindProp", node: modal.id, prop: "open", path: "state.confirmOpen" });
  const modalLabel = blankNode("Label");
  kernel.apply({ t: "InsertNode", parent: modal.id, index: 0, node: modalLabel });
  kernel.apply({ t: "BindProp", node: modalLabel.id, prop: "text", path: "state.pendingKey" });
  const confirmBtn = blankNode("Button", { text: "Delete", variant: "danger" });
  kernel.apply({ t: "InsertNode", parent: modal.id, index: 1, node: confirmBtn });

  // ── contracts ──────────────────────────────────────────────────────────────
  const recordExpr: Record<string, Expr> = {};
  for (const f of fields) recordExpr[f.name] = { t: "var", name: f.name };

  const saveSeq: Action[] = [
    { t: "Validate", var: firstString.name, rule: { t: "nonEmpty" }, elseError: `${firstString.name} is required` },
    { t: "KvInsert", store: storeId, record: recordExpr },
    { t: "Toast", template: `Saved {${firstString.name}}` },
    ...fields.map((f): Action => ({ t: "SetState", path: draftPath(f.name), from: { t: "lit", value: emptyValue(f.type) } })),
  ];
  const saveId = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: saveId,
      name: `save-${entity}`,
      signature: { inputs: fields.map((f) => ({ ...f })), result: { t: "error" } },
      grants: [{ t: "kv", store: storeId, mode: "rw" }, { t: "toast" }],
      predicates: [{ t: "nonEmpty", field: firstString.name }, { t: "persists", store: storeId }],
      body: { t: "actionIr", seq: saveSeq },
    },
  });

  const selectId = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: selectId,
      name: `select-${entity}`,
      // Takes the whole clicked row (a record) and pulls the key field out of
      // it — mirrors the proven seed's select flow.
      signature: { inputs: [{ name: "row", type: { record: storeId } }], result: { t: "ok" } },
      grants: [],
      predicates: [],
      body: {
        t: "actionIr",
        seq: [
          { t: "SetState", path: "state.pendingKey", from: { t: "var", name: `row.${firstString.name}` } },
          { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: true } },
        ],
      },
    },
  });

  const deleteId = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: deleteId,
      name: `delete-${entity}`,
      signature: { inputs: [{ name: "key", type: "string" }], result: { t: "ok" } },
      grants: [{ t: "kv", store: storeId, mode: "rw" }, { t: "toast" }],
      predicates: [],
      body: {
        t: "actionIr",
        seq: [
          { t: "KvDelete", store: storeId, where: { field: firstString.name, op: "eq", value: { t: "var", name: "key" } } },
          { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: false } },
          { t: "Toast", template: `Deleted {key}` },
        ],
      },
    },
  });

  // ── wires: sources → contract inputs (T0-checked) ─────────────────────────
  const saveInputs: Record<string, { t: "nodeValue"; node: string }> = {};
  for (const f of fields) saveInputs[f.name] = { t: "nodeValue", node: inputNodes[f.name]! };
  kernel.apply({ t: "WireEvent", node: saveBtn.id, wire: { event: "click", contract: saveId, inputs: saveInputs } });
  kernel.apply({
    t: "WireEvent",
    node: table.id,
    wire: { event: "row-click", contract: selectId, inputs: { row: { t: "payloadField", field: "row" } } },
  });
  kernel.apply({
    t: "WireEvent",
    node: confirmBtn.id,
    wire: { event: "click", contract: deleteId, inputs: { key: { t: "statePath", path: "state.pendingKey" } } },
  });

  return pageId;
}
