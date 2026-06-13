import { For, Show, createSignal } from "solid-js";
import type { TypeRef } from "../kernel/types";
import { generateApp } from "./generate";
import {
  kernel,
  setCurrentPage,
  setMode,
  setSelection,
  setShowGenerate,
  setStatus,
  showGenerate,
} from "./store";

// "Generate app from a data shape" — type an entity + fields, get a complete,
// running CRUD app instantly. The on-demand-UI / lock-in-free demo: what you
// get out is graph data + interpretable contracts you own, runnable with no
// vendor runtime, and each contract can later compile to a portable component.

interface DraftField {
  name: string;
  type: TypeRef;
}

const STARTERS: Array<{ label: string; entity: string; fields: DraftField[] }> = [
  { label: "Tasks", entity: "task", fields: [{ name: "title", type: "string" }, { name: "done", type: "bool" }] },
  {
    label: "Contacts",
    entity: "contact",
    fields: [{ name: "name", type: "string" }, { name: "email", type: "string" }, { name: "company", type: "string" }],
  },
  {
    label: "Inventory",
    entity: "product",
    fields: [{ name: "sku", type: "string" }, { name: "name", type: "string" }, { name: "qty", type: "number" }],
  },
];

export function GenerateDialog() {
  const [entity, setEntity] = createSignal("task");
  const [fields, setFields] = createSignal<DraftField[]>([
    { name: "title", type: "string" },
    { name: "done", type: "bool" },
  ]);

  const setField = (i: number, patch: Partial<DraftField>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const generate = () => {
    const pageId = generateApp(kernel, { entity: entity().trim(), fields: fields() });
    setShowGenerate(false);
    setCurrentPage(pageId);
    setSelection(null);
    setMode("run");
    setStatus(`generated ${entity()} app — running. The output is yours: export graph.json anytime.`);
  };

  return (
    <Show when={showGenerate()}>
      <div class="s-contract-overlay" onClick={(e) => e.target === e.currentTarget && setShowGenerate(false)}>
        <div class="s-gen">
          <header class="s-gen__head">
            <strong>Generate an app from a data shape</strong>
            <button onClick={() => setShowGenerate(false)}>Close</button>
          </header>

          <div class="s-gen__starters">
            <span class="s-dim">Start from:</span>
            <For each={STARTERS}>
              {(s) => (
                <button
                  onClick={() => {
                    setEntity(s.entity);
                    setFields(s.fields.map((f) => ({ ...f })));
                  }}
                >
                  {s.label}
                </button>
              )}
            </For>
          </div>

          <label class="s-row">
            <span>Entity</span>
            <input type="text" value={entity()} onInput={(e) => setEntity(e.currentTarget.value)} placeholder="task" />
          </label>

          <h4>Fields</h4>
          <For each={fields()}>
            {(f, i) => (
              <div class="s-panel__row">
                <input
                  class="s-mini"
                  value={f.name}
                  placeholder="field name"
                  onInput={(e) => setField(i(), { name: e.currentTarget.value })}
                />
                <select
                  value={typeof f.type === "string" ? f.type : "string"}
                  onChange={(e) => setField(i(), { type: e.currentTarget.value as TypeRef })}
                >
                  <option value="string">text</option>
                  <option value="number">number</option>
                  <option value="bool">yes/no</option>
                </select>
                <button class="s-x" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i()))}>
                  ×
                </button>
              </div>
            )}
          </For>
          <button onClick={() => setFields((fs) => [...fs, { name: "", type: "string" }])}>+ field</button>

          <footer class="s-gen__foot">
            <p class="s-dim">
              Generates a store, a bound form + table, a delete-with-confirm flow, and save / select / delete
              contracts — running instantly. No vendor runtime: the result is graph.json you own.
            </p>
            <button class="s-gen__go" onClick={generate}>
              ✨ Generate app
            </button>
          </footer>
        </div>
      </div>
    </Show>
  );
}
