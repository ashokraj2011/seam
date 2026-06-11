import type { GraphKernel } from "../kernel/kernel";
import { blankNode, newId } from "./nodes";

// The §9 demo project, seeded into a fresh studio: a customer manager with a
// save-customer contract (validate → insert → toast → clear inputs) and a
// delete-with-Modal-confirm flow on row click.
export function seedDemo(kernel: GraphKernel): void {
  // ── data store ────────────────────────────────────────────────────────────
  const storeId = newId("store");
  kernel.apply({
    t: "DeclareStore",
    store: {
      id: storeId,
      name: "customers",
      schema: [
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
      seed: [
        { name: "Ada Lovelace", email: "ada@example.com" },
        { name: "Grace Hopper", email: "grace@example.com" },
      ],
    },
  });

  // ── page, state, UI tree ─────────────────────────────────────────────────
  const root = blankNode("Container", { gap: "3" });
  const pageId = newId("page");
  kernel.apply({
    t: "AddPage",
    page: {
      id: pageId,
      route: "/",
      root: root.id,
      state: [
        { name: "draftName", type: "string", initial: "" },
        { name: "draftEmail", type: "string", initial: "" },
        { name: "pendingName", type: "string", initial: "" },
        { name: "confirmOpen", type: "bool", initial: false },
      ],
    },
    nodes: [root],
  });

  const form = blankNode("Card", { title: "New customer" });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 0, node: form });
  const nameInput = blankNode("TextInput", { label: "Name", placeholder: "Ada Lovelace" });
  kernel.apply({ t: "InsertNode", parent: form.id, index: 0, node: nameInput });
  const emailInput = blankNode("TextInput", { label: "Email", placeholder: "ada@example.com" });
  kernel.apply({ t: "InsertNode", parent: form.id, index: 1, node: emailInput });
  const saveBtn = blankNode("Button", { text: "Save" });
  kernel.apply({ t: "InsertNode", parent: form.id, index: 2, node: saveBtn });
  kernel.apply({ t: "BindProp", node: nameInput.id, prop: "value", path: "state.draftName" });
  kernel.apply({ t: "BindProp", node: emailInput.id, prop: "value", path: "state.draftEmail" });

  const list = blankNode("Card", { title: "Customers" });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 1, node: list });
  const table = blankNode("Table", { columns: ["name", "email"] });
  kernel.apply({ t: "InsertNode", parent: list.id, index: 0, node: table });
  kernel.apply({ t: "BindProp", node: table.id, prop: "rows", path: "store.customers" });

  const modal = blankNode("Modal", { title: "Delete customer?" });
  kernel.apply({ t: "InsertNode", parent: root.id, index: 2, node: modal });
  kernel.apply({ t: "BindProp", node: modal.id, prop: "open", path: "state.confirmOpen" });
  const modalLabel = blankNode("Label");
  kernel.apply({ t: "InsertNode", parent: modal.id, index: 0, node: modalLabel });
  kernel.apply({ t: "BindProp", node: modalLabel.id, prop: "text", path: "state.pendingName" });
  const confirmBtn = blankNode("Button", { text: "Delete", variant: "danger" });
  kernel.apply({ t: "InsertNode", parent: modal.id, index: 1, node: confirmBtn });

  // ── contracts ────────────────────────────────────────────────────────────
  const saveCustomer = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: saveCustomer,
      name: "save-customer",
      signature: {
        inputs: [
          { name: "name", type: "string" },
          { name: "email", type: "string" },
        ],
        result: { t: "error" },
      },
      grants: [{ t: "kv", store: storeId, mode: "rw" }, { t: "toast" }],
      predicates: [
        { t: "nonEmpty", field: "name" },
        { t: "persists", store: storeId },
      ],
      body: { t: "unfilled" },
    },
  });
  // The five-action body: validate → insert → toast → clear both inputs.
  kernel.apply({
    t: "FillBody",
    contract: saveCustomer,
    body: {
      t: "actionIr",
      seq: [
        { t: "Validate", var: "name", rule: { t: "nonEmpty" }, elseError: "name is required" },
        {
          t: "KvInsert",
          store: storeId,
          record: { name: { t: "var", name: "name" }, email: { t: "var", name: "email" } },
        },
        { t: "Toast", template: "Saved {name}" },
        { t: "SetState", path: "state.draftName", from: { t: "lit", value: "" } },
        { t: "SetState", path: "state.draftEmail", from: { t: "lit", value: "" } },
      ],
    },
  });

  const selectCustomer = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: selectCustomer,
      name: "select-customer",
      signature: {
        inputs: [{ name: "row", type: { record: storeId } }],
        result: { t: "ok" },
      },
      grants: [],
      predicates: [],
      body: {
        t: "actionIr",
        seq: [
          { t: "SetState", path: "state.pendingName", from: { t: "var", name: "row.name" } },
          { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: true } },
        ],
      },
    },
  });

  const deleteCustomer = newId("ct");
  kernel.apply({
    t: "AuthorContract",
    contract: {
      id: deleteCustomer,
      name: "delete-customer",
      signature: {
        inputs: [{ name: "name", type: "string" }],
        result: { t: "ok" },
      },
      grants: [{ t: "kv", store: storeId, mode: "rw" }, { t: "toast" }],
      predicates: [],
      body: {
        t: "actionIr",
        seq: [
          {
            t: "KvDelete",
            store: storeId,
            where: { field: "name", op: "eq", value: { t: "var", name: "name" } },
          },
          { t: "SetState", path: "state.confirmOpen", from: { t: "lit", value: false } },
          { t: "Toast", template: "Deleted {name}" },
        ],
      },
    },
  });

  // ── wires: sources → contract inputs (T0-checked at design time) ─────────
  kernel.apply({
    t: "WireEvent",
    node: saveBtn.id,
    wire: {
      event: "click",
      contract: saveCustomer,
      inputs: {
        name: { t: "nodeValue", node: nameInput.id },
        email: { t: "nodeValue", node: emailInput.id },
      },
    },
  });
  kernel.apply({
    t: "WireEvent",
    node: table.id,
    wire: {
      event: "row-click",
      contract: selectCustomer,
      inputs: { row: { t: "payloadField", field: "row" } },
    },
  });
  kernel.apply({
    t: "WireEvent",
    node: confirmBtn.id,
    wire: {
      event: "click",
      contract: deleteCustomer,
      inputs: { name: { t: "statePath", path: "state.pendingName" } },
    },
  });
}
