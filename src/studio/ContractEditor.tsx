import { For, Show, createMemo } from "solid-js";
import type {
  Action,
  BodyRef,
  Contract,
  ContractId,
  Expr,
  FieldDecl,
  FilterExpr,
  Grant,
  Predicate,
  TypeRef,
  Value,
} from "../kernel/types";
import { actionProblems } from "../runtime/lint";
import { componentForContract } from "../runtime/registry";
import { contractToWit } from "../runtime/wit";
import { newId } from "../shared/nodes";
import {
  apply,
  editingContract,
  kernel,
  setEditingContract,
  setStatus,
  version,
} from "./store";

// Form-based contract authoring (MVP1_PLAN_AND_SPEC.md §7): signature,
// grants from the closed capability list, predicates from the template list,
// the IR body as reorderable typed rows, and a read-only WIT preview. The
// editor refuses ungranted actions at add time and flags actions orphaned by
// grant revocation — MVP1's foreshadowing of T1.

const storeNameOf = (id: string): string =>
  kernel.state.stores.find((s) => s.id === id)?.name ?? id;

// Session-local stash so "⇄ use action IR" can restore the body an IR↔
// component swap replaced (undo also works — FillBody carries its inverse).
const irStash = new Map<ContractId, BodyRef>();

// ── contracts panel (left rail) ─────────────────────────────────────────────

export function ContractsPanel() {
  const contracts = createMemo(() => (version(), [...kernel.state.contracts]));
  const problemsOf = (c: Contract) =>
    c.body.t === "actionIr" ? actionProblems(c.body.seq, c.grants, storeNameOf).length : 0;
  return (
    <section class="s-panel">
      <h3>Contracts</h3>
      <For each={contracts()}>
        {(contract) => (
          <div class="s-panel__row">
            <button class="s-link" onClick={() => setEditingContract(contract.id)}>
              {contract.name}
            </button>
            <Show when={contract.body.t === "unfilled"}>
              <span class="s-dim" title="body not filled yet">
                ∅
              </span>
            </Show>
            <Show when={problemsOf(contract) > 0}>
              <span class="s-error" title="body has orphaned actions — open to fix">
                ⚠ {problemsOf(contract)}
              </span>
            </Show>
            <button class="s-x" onClick={() => apply({ t: "RemoveContract", contract: contract.id })}>
              ×
            </button>
          </div>
        )}
      </For>
      <button
        onClick={() => {
          const id = newId("ct");
          if (
            apply({
              t: "AuthorContract",
              contract: {
                id,
                name: "new-contract",
                signature: { inputs: [], result: { t: "error" } },
                grants: [],
                predicates: [],
                body: { t: "unfilled" },
              },
            })
          )
            setEditingContract(id);
        }}
      >
        + Author contract
      </button>
    </section>
  );
}

// ── the editor overlay ──────────────────────────────────────────────────────

export function ContractEditorOverlay() {
  const contract = createMemo(() => {
    version();
    const id = editingContract();
    return id ? kernel.state.contracts.find((c) => c.id === id) : undefined;
  });
  return (
    <Show when={contract()}>
      {(c) => (
        <div class="s-contract-overlay" onClick={(e) => e.target === e.currentTarget && setEditingContract(null)}>
          <div class="s-contract">
            <Editor contract={c()} />
          </div>
        </div>
      )}
    </Show>
  );
}

function Editor(props: { contract: Contract }) {
  const c = () => props.contract;
  // The kernel mutates the contract in place — JSX reading c().body alone
  // would never re-render. Route every body read through the version signal.
  const body = createMemo(() => (version(), c().body));
  const vars = createMemo(() => (version(), knownVars(c())));
  const problems = createMemo(() => {
    version();
    const b = c().body;
    return b.t === "actionIr" ? actionProblems(b.seq, c().grants, storeNameOf) : [];
  });

  const updateBody = (mutate: (seq: Action[]) => void) => {
    const body = c().body;
    const seq = body.t === "actionIr" ? (structuredClone(body.seq) as Action[]) : [];
    mutate(seq);
    apply({ t: "FillBody", contract: c().id, body: { t: "actionIr", seq } });
  };

  return (
    <>
      <header class="s-contract__head">
        <input
          class="s-contract__name"
          value={c().name}
          onChange={(e) => apply({ t: "EditContract", contract: c().id, patch: { name: e.currentTarget.value } })}
        />
        <label>
          result
          <select
            value={c().signature.result.t}
            onChange={(e) =>
              apply({
                t: "EditContract",
                contract: c().id,
                patch: { signature: { ...c().signature, result: { t: e.currentTarget.value as "ok" | "error" } } },
              })
            }
          >
            <option value="ok">ok</option>
            <option value="error">error(string)</option>
          </select>
        </label>
        <button onClick={() => setEditingContract(null)}>Close</button>
      </header>

      <div class="s-contract__cols">
        <section>
          <h4>Inputs</h4>
          <For each={c().signature.inputs}>
            {(field, i) => (
              <div class="s-panel__row">
                <input
                  class="s-mini"
                  value={field.name}
                  onChange={(e) => editInput(c(), i(), { ...field, name: e.currentTarget.value })}
                />
                <select
                  value={typeKey(field.type)}
                  onChange={(e) => editInput(c(), i(), { ...field, type: typeFromKey(e.currentTarget.value) })}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="bool">bool</option>
                  <For each={kernel.state.stores}>
                    {(s) => <option value={`record:${s.id}`}>record({s.name})</option>}
                  </For>
                </select>
                <button class="s-x" onClick={() => removeInput(c(), i())}>
                  ×
                </button>
              </div>
            )}
          </For>
          <button
            onClick={() =>
              apply({
                t: "EditContract",
                contract: c().id,
                patch: {
                  signature: {
                    ...c().signature,
                    inputs: [...c().signature.inputs, { name: `in${c().signature.inputs.length}`, type: "string" }],
                  },
                },
              })
            }
          >
            + input
          </button>

          <h4>Grants</h4>
          <For each={["toast", "nav", "clock"] as const}>
            {(cap) => (
              <label class="s-panel__row">
                <input
                  type="checkbox"
                  checked={c().grants.some((g) => g.t === cap)}
                  onChange={(e) => toggleGrant(c(), { t: cap }, e.currentTarget.checked)}
                />
                <span>{cap}</span>
              </label>
            )}
          </For>
          <For each={kernel.state.stores}>
            {(store) => (
              <label class="s-panel__row">
                <span class="s-dim">kv({store.name})</span>
                <select
                  value={kvMode(c(), store.id)}
                  onChange={(e) => setKvGrant(c(), store.id, e.currentTarget.value as "none" | "r" | "rw")}
                >
                  <option value="none">none</option>
                  <option value="r">r</option>
                  <option value="rw">rw</option>
                </select>
              </label>
            )}
          </For>

          <h4>Predicates</h4>
          <For each={c().predicates}>
            {(p, i) => (
              <div class="s-panel__row">
                <code>{predicateLabel(p)}</code>
                <button class="s-x" onClick={() => removePredicate(c(), i())}>
                  ×
                </button>
              </div>
            )}
          </For>
          <AddPredicate contract={c()} />
        </section>

        <section>
          <h4>
            Body{" "}
            <Show when={body().t === "unfilled"}>
              <button onClick={() => updateBody(() => {})}>Fill with action IR</button>
            </Show>
            <Show when={body().t !== "component" && componentForContract(c().name)}>
              {(entry) => (
                <button
                  title="swap BodyRef to the compiled Rust component — same contract, same grants"
                  onClick={() => {
                    irStash.set(c().id, structuredClone(c().body));
                    apply({ t: "FillBody", contract: c().id, body: { t: "component", hash: entry().hash } });
                  }}
                >
                  ⇄ use Rust component
                </button>
              )}
            </Show>
          </h4>
          <Show when={body().t === "component"}>
            <div class="s-action">
              <header>
                <strong>Compiled Rust component</strong>
                <span class="s-action__tools">
                  <button
                    onClick={() =>
                      apply({
                        t: "FillBody",
                        contract: c().id,
                        body: irStash.get(c().id) ?? { t: "unfilled" },
                      })
                    }
                  >
                    ⇄ use action IR
                  </button>
                </span>
              </header>
              <code class="s-dim">{(body() as { hash: string }).hash.slice(0, 26)}…</code>
              <p class="s-hint">
                Built with cargo-component, runs in the jco host. Imports = grants — ungranted effects
                are physically absent. Behavior verified against the drift corpus (tests/drift.test.ts).
              </p>
            </div>
          </Show>
          <Show
            when={body().t === "actionIr"}
            fallback={
              <Show when={body().t === "unfilled"}>
                <p class="s-hint">
                  Unfilled — wiring an event to this contract shows the stub toast. Bodies that outgrow
                  the action vocabulary graduate to Rust behind the same contract.
                </p>
              </Show>
            }
          >
            <For each={(body() as { t: "actionIr"; seq: Action[] }).seq}>
              {(action, i) => (
                <div class="s-action" classList={{ "s-action--bad": problems().some((p) => p.index === i()) }}>
                  <header>
                    <strong>{action.t}</strong>
                    <Show when={problems().find((p) => p.index === i())}>
                      {(p) => <span class="s-error">⚠ {p().message}</span>}
                    </Show>
                    <span class="s-action__tools">
                      <button disabled={i() === 0} onClick={() => updateBody((s) => move(s, i(), -1))}>
                        ↑
                      </button>
                      <button
                        disabled={i() === (body() as { seq: Action[] }).seq.length - 1}
                        onClick={() => updateBody((s) => move(s, i(), 1))}
                      >
                        ↓
                      </button>
                      <button class="s-x" onClick={() => updateBody((s) => s.splice(i(), 1))}>
                        ×
                      </button>
                    </span>
                  </header>
                  <ActionEditor
                    action={action}
                    vars={vars()}
                    onChange={(next) => updateBody((s) => (s[i()] = next))}
                  />
                </div>
              )}
            </For>
            <AddAction contract={c()} onAdd={(a) => updateBody((s) => s.push(a))} />
          </Show>
        </section>

        <section class="s-contract__wit">
          <h4>WIT preview (read-only projection)</h4>
          <pre>{(version(), contractToWit(c(), kernel.state.stores))}</pre>
        </section>
      </div>
    </>
  );
}

// ── small mutation helpers ──────────────────────────────────────────────────

const typeKey = (t: TypeRef): string => (typeof t === "string" ? t : `record:${t.record}`);
const typeFromKey = (k: string): TypeRef => (k.startsWith("record:") ? { record: k.slice(7) } : (k as TypeRef));

function editInput(c: Contract, index: number, field: FieldDecl): void {
  const inputs = [...c.signature.inputs];
  inputs[index] = field;
  apply({ t: "EditContract", contract: c.id, patch: { signature: { ...c.signature, inputs } } });
}

function removeInput(c: Contract, index: number): void {
  const inputs = c.signature.inputs.filter((_, i) => i !== index);
  apply({ t: "EditContract", contract: c.id, patch: { signature: { ...c.signature, inputs } } });
}

function kvMode(c: Contract, store: string): "none" | "r" | "rw" {
  const grant = c.grants.find((g) => g.t === "kv" && g.store === store);
  return grant && grant.t === "kv" ? grant.mode : "none";
}

function setKvGrant(c: Contract, store: string, mode: "none" | "r" | "rw"): void {
  const grants = c.grants.filter((g) => !(g.t === "kv" && g.store === store));
  if (mode !== "none") grants.push({ t: "kv", store, mode });
  apply({ t: "EditContract", contract: c.id, patch: { grants } });
}

function toggleGrant(c: Contract, grant: Grant, on: boolean): void {
  const grants = c.grants.filter((g) => g.t !== grant.t);
  if (on) grants.push(grant);
  apply({ t: "EditContract", contract: c.id, patch: { grants } });
}

function removePredicate(c: Contract, index: number): void {
  apply({
    t: "EditContract",
    contract: c.id,
    patch: { predicates: c.predicates.filter((_, i) => i !== index) },
  });
}

export function predicateLabel(p: Predicate): string {
  switch (p.t) {
    case "nonEmpty":
      return `non-empty(${p.field})`;
    case "persists":
      return `persists(${storeNameOf(p.store)})`;
    case "unique":
      return `unique(${storeNameOf(p.store)}, ${p.field})`;
  }
}

function move(seq: Action[], index: number, dir: -1 | 1): void {
  const [a] = seq.splice(index, 1);
  seq.splice(index + dir, 0, a!);
}

// Vars the body can read: contract inputs (dot fields for record inputs)
// plus intos of earlier KvQuery actions.
function knownVars(c: Contract): string[] {
  const out: string[] = [];
  for (const field of c.signature.inputs) {
    out.push(field.name);
    const type = field.type;
    if (typeof type === "object") {
      const store = kernel.state.stores.find((s) => s.id === type.record);
      for (const f of store?.schema ?? []) out.push(`${field.name}.${f.name}`);
    }
  }
  if (c.body.t === "actionIr") {
    for (const a of c.body.seq) if (a.t === "KvQuery") out.push(a.into);
  }
  return out;
}

function AddPredicate(props: { contract: Contract }) {
  let kind!: HTMLSelectElement;
  let arg1!: HTMLInputElement;
  return (
    <div class="s-panel__row">
      <select ref={kind}>
        <option value="nonEmpty">non-empty(field)</option>
        <option value="persists">persists(store)</option>
        <option value="unique">unique(store, field)</option>
      </select>
      <input class="s-mini" ref={arg1} placeholder="field / store" />
      <button
        onClick={() => {
          const t = kind.value as Predicate["t"];
          const arg = arg1.value.trim();
          const store = kernel.state.stores.find((s) => s.name === arg || s.id === arg);
          let predicate: Predicate;
          if (t === "nonEmpty") {
            if (!arg) return setStatus("non-empty needs a field name");
            predicate = { t, field: arg };
          } else if (t === "persists") {
            if (!store) return setStatus("persists needs a store name");
            predicate = { t, store: store.id };
          } else {
            const [storeName, field] = arg.split(/[,\s]+/);
            const s2 = kernel.state.stores.find((s) => s.name === storeName);
            if (!s2 || !field) return setStatus('unique needs "store field"');
            predicate = { t, store: s2.id, field };
          }
          apply({
            t: "EditContract",
            contract: props.contract.id,
            patch: { predicates: [...props.contract.predicates, predicate] },
          });
          arg1.value = "";
        }}
      >
        +
      </button>
    </div>
  );
}

// ── action add menu: refuses ungranted actions (the design-time T1) ─────────

function AddAction(props: { contract: Contract; onAdd: (a: Action) => void }) {
  const grants = () => props.contract.grants;
  const kvStores = (write: boolean) =>
    kernel.state.stores.filter((s) =>
      grants().some((g) => g.t === "kv" && g.store === s.id && (g.mode === "rw" || !write)),
    );
  const defaults = (): Array<[string, Action | null, string]> => {
    const rw = kvStores(true)[0];
    const r = kvStores(false)[0];
    const firstVar = knownVars(props.contract)[0] ?? "input";
    return [
      ["Validate", { t: "Validate", var: firstVar, rule: { t: "nonEmpty" }, elseError: "required" }, ""],
      [
        "KvInsert",
        rw ? { t: "KvInsert", store: rw.id, record: {} } : null,
        "needs a kv(store, rw) grant",
      ],
      [
        "KvQuery",
        r
          ? { t: "KvQuery", store: r.id, filter: { field: r.schema[0]?.name ?? "name", op: "eq", value: { t: "lit", value: "" } }, into: "found" }
          : null,
        "needs a kv(store, r) grant",
      ],
      [
        "KvUpdate",
        rw
          ? { t: "KvUpdate", store: rw.id, where: { field: rw.schema[0]?.name ?? "name", op: "eq", value: { t: "lit", value: "" } }, set: {} }
          : null,
        "needs a kv(store, rw) grant",
      ],
      [
        "KvDelete",
        rw
          ? { t: "KvDelete", store: rw.id, where: { field: rw.schema[0]?.name ?? "name", op: "eq", value: { t: "lit", value: "" } } }
          : null,
        "needs a kv(store, rw) grant",
      ],
      ["SetState", { t: "SetState", path: "state.value", from: { t: "lit", value: "" } }, ""],
      [
        "Toast",
        grants().some((g) => g.t === "toast") ? { t: "Toast", template: "done" } : null,
        "needs the toast grant",
      ],
      [
        "Navigate",
        grants().some((g) => g.t === "nav") ? { t: "Navigate", route: kernel.state.pages[0]?.route ?? "/" } : null,
        "needs the nav grant",
      ],
      ["Branch", { t: "Branch", cond: { t: "empty", var: firstVar }, then: [], else: [] }, ""],
    ];
  };
  return (
    <div class="s-panel__row">
      <select
        onChange={(e) => {
          const entry = defaults().find(([name]) => name === e.currentTarget.value);
          if (entry?.[1]) props.onAdd(structuredClone(entry[1]));
          e.currentTarget.value = "";
        }}
      >
        <option value="" selected>
          + add action…
        </option>
        <For each={defaults()}>
          {([name, action, reason]) => (
            <option value={name} disabled={!action} title={action ? "" : reason}>
              {name}
              {action ? "" : ` — ${reason}`}
            </option>
          )}
        </For>
      </select>
    </div>
  );
}

// ── per-action editors ──────────────────────────────────────────────────────

function ActionEditor(props: { action: Action; vars: string[]; onChange: (a: Action) => void }) {
  const a = () => props.action;
  const set = (patch: Partial<Action>) => props.onChange({ ...a(), ...patch } as Action);
  const statePaths = () => {
    const out: string[] = [];
    for (const page of kernel.state.pages) for (const d of page.state) out.push(`state.${d.name}`);
    return out;
  };

  switch (a().t) {
    case "Validate": {
      const v = a() as Extract<Action, { t: "Validate" }>;
      return (
        <div class="s-action__form">
          <VarPick label="var" value={v.var} vars={props.vars} onChange={(name) => set({ var: name })} />
          <label>
            rule
            <select
              value={v.rule.t}
              onChange={(e) => {
                const t = e.currentTarget.value;
                set({
                  rule: t === "matches" ? { t, pattern: ".*" } : t === "range" ? { t, min: 0 } : { t: "nonEmpty" },
                } as Partial<Action>);
              }}
            >
              <option value="nonEmpty">non-empty</option>
              <option value="matches">matches</option>
              <option value="range">range</option>
            </select>
          </label>
          <Show when={v.rule.t === "matches"}>
            <label>
              pattern
              <input
                value={(v.rule as { pattern: string }).pattern}
                onChange={(e) => set({ rule: { t: "matches", pattern: e.currentTarget.value } })}
              />
            </label>
          </Show>
          <label>
            else error
            <input value={v.elseError} onChange={(e) => set({ elseError: e.currentTarget.value })} />
          </label>
        </div>
      );
    }
    case "KvInsert": {
      const v = a() as Extract<Action, { t: "KvInsert" }>;
      const store = kernel.state.stores.find((s) => s.id === v.store);
      return (
        <div class="s-action__form">
          <span class="s-dim">into {store?.name ?? v.store}</span>
          <For each={store?.schema ?? []}>
            {(field) => (
              <label>
                {field.name}
                <ExprEditor
                  value={v.record[field.name] ?? { t: "lit", value: "" }}
                  vars={props.vars}
                  onChange={(expr) => set({ record: { ...v.record, [field.name]: expr } })}
                />
              </label>
            )}
          </For>
        </div>
      );
    }
    case "KvQuery": {
      const v = a() as Extract<Action, { t: "KvQuery" }>;
      return (
        <div class="s-action__form">
          <span class="s-dim">from {storeNameOf(v.store)}</span>
          <FilterEditor value={v.filter} store={v.store} vars={props.vars} onChange={(filter) => set({ filter })} />
          <label>
            into
            <input class="s-mini" value={v.into} onChange={(e) => set({ into: e.currentTarget.value })} />
          </label>
        </div>
      );
    }
    case "KvUpdate": {
      const v = a() as Extract<Action, { t: "KvUpdate" }>;
      const store = kernel.state.stores.find((s) => s.id === v.store);
      return (
        <div class="s-action__form">
          <span class="s-dim">in {store?.name ?? v.store} where</span>
          <FilterEditor value={v.where} store={v.store} vars={props.vars} onChange={(where) => set({ where })} />
          <For each={store?.schema ?? []}>
            {(field) => (
              <label>
                set {field.name}
                <ExprEditor
                  value={v.set[field.name] ?? { t: "lit", value: "" }}
                  vars={props.vars}
                  onChange={(expr) => set({ set: { ...v.set, [field.name]: expr } })}
                />
              </label>
            )}
          </For>
        </div>
      );
    }
    case "KvDelete": {
      const v = a() as Extract<Action, { t: "KvDelete" }>;
      return (
        <div class="s-action__form">
          <span class="s-dim">from {storeNameOf(v.store)} where</span>
          <FilterEditor value={v.where} store={v.store} vars={props.vars} onChange={(where) => set({ where })} />
        </div>
      );
    }
    case "SetState": {
      const v = a() as Extract<Action, { t: "SetState" }>;
      return (
        <div class="s-action__form">
          <label>
            path
            <select value={v.path} onChange={(e) => set({ path: e.currentTarget.value })}>
              <option value={v.path}>{v.path}</option>
              <For each={statePaths().filter((p) => p !== v.path)}>{(p) => <option value={p}>{p}</option>}</For>
            </select>
          </label>
          <label>
            from
            <ExprEditor value={v.from} vars={props.vars} onChange={(from) => set({ from })} />
          </label>
        </div>
      );
    }
    case "Toast": {
      const v = a() as Extract<Action, { t: "Toast" }>;
      return (
        <div class="s-action__form">
          <label>
            template
            <input value={v.template} onChange={(e) => set({ template: e.currentTarget.value })} />
          </label>
          <span class="s-dim">{"{var}"} interpolates</span>
        </div>
      );
    }
    case "Navigate": {
      const v = a() as Extract<Action, { t: "Navigate" }>;
      return (
        <div class="s-action__form">
          <label>
            route
            <select value={v.route} onChange={(e) => set({ route: e.currentTarget.value })}>
              <For each={kernel.state.pages}>{(p) => <option value={p.route}>{p.route}</option>}</For>
            </select>
          </label>
        </div>
      );
    }
    case "Branch": {
      const v = a() as Extract<Action, { t: "Branch" }>;
      return (
        <div class="s-action__form">
          <label>
            if
            <select
              value={v.cond.t}
              onChange={(e) => {
                const t = e.currentTarget.value;
                set({
                  cond:
                    t === "empty"
                      ? { t: "empty", var: props.vars[0] ?? "input" }
                      : { t: "eq", left: { t: "var", name: props.vars[0] ?? "input" }, right: { t: "lit", value: "" } },
                } as Partial<Action>);
              }}
            >
              <option value="empty">empty(var)</option>
              <option value="eq">eq(left, right)</option>
            </select>
          </label>
          <Show when={v.cond.t === "empty"}>
            <VarPick
              label="var"
              value={(v.cond as { var: string }).var}
              vars={props.vars}
              onChange={(name) => set({ cond: { t: "empty", var: name } })}
            />
          </Show>
          <Show when={v.cond.t === "eq"}>
            <ExprEditor
              value={(v.cond as { left: Expr }).left}
              vars={props.vars}
              onChange={(left) => set({ cond: { ...(v.cond as { t: "eq"; left: Expr; right: Expr }), left } })}
            />
            <ExprEditor
              value={(v.cond as { right: Expr }).right}
              vars={props.vars}
              onChange={(right) => set({ cond: { ...(v.cond as { t: "eq"; left: Expr; right: Expr }), right } })}
            />
          </Show>
          <span class="s-dim">one level only — no loops; bigger logic graduates to Rust (MVP2)</span>
        </div>
      );
    }
    default:
      return <span class="s-dim">{JSON.stringify(a())}</span>;
  }
}

function VarPick(props: { label: string; value: string; vars: string[]; onChange: (v: string) => void }) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(e) => props.onChange(e.currentTarget.value)}>
        <option value={props.value}>{props.value}</option>
        <For each={props.vars.filter((v) => v !== props.value)}>{(v) => <option value={v}>{v}</option>}</For>
      </select>
    </label>
  );
}

function ExprEditor(props: { value: Expr; vars: string[]; onChange: (e: Expr) => void }) {
  const v = () => props.value;
  return (
    <span class="s-expr">
      <select
        value={v().t}
        onChange={(e) =>
          props.onChange(
            e.currentTarget.value === "var"
              ? { t: "var", name: props.vars[0] ?? "input" }
              : { t: "lit", value: "" },
          )
        }
      >
        <option value="var">var</option>
        <option value="lit">lit</option>
      </select>
      <Show when={v().t === "var"}>
        <select
          value={(v() as { name: string }).name}
          onChange={(e) => props.onChange({ t: "var", name: e.currentTarget.value })}
        >
          <option value={(v() as { name: string }).name}>{(v() as { name: string }).name}</option>
          <For each={props.vars.filter((name) => name !== (v() as { name: string }).name)}>
            {(name) => <option value={name}>{name}</option>}
          </For>
        </select>
      </Show>
      <Show when={v().t === "lit"}>
        <input
          class="s-mini"
          value={litText((v() as { value: Value }).value)}
          onChange={(e) => props.onChange({ t: "lit", value: parseLit(e.currentTarget.value) })}
        />
      </Show>
    </span>
  );
}

const litText = (v: Value): string => (typeof v === "string" ? v : JSON.stringify(v));
function parseLit(text: string): Value {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "number" || typeof parsed === "boolean" || parsed === null) return parsed;
  } catch {
    /* plain string */
  }
  return text;
}

function FilterEditor(props: {
  value: FilterExpr;
  store: string;
  vars: string[];
  onChange: (f: FilterExpr) => void;
}) {
  const fields = () => kernel.state.stores.find((s) => s.id === props.store)?.schema ?? [];
  return (
    <span class="s-expr">
      <select
        value={props.value.field}
        onChange={(e) => props.onChange({ ...props.value, field: e.currentTarget.value })}
      >
        <option value={props.value.field}>{props.value.field}</option>
        <For each={fields().filter((f) => f.name !== props.value.field)}>
          {(f) => <option value={f.name}>{f.name}</option>}
        </For>
      </select>
      <select
        value={props.value.op}
        onChange={(e) => props.onChange({ ...props.value, op: e.currentTarget.value as FilterExpr["op"] })}
      >
        <option value="eq">=</option>
        <option value="neq">≠</option>
        <option value="contains">contains</option>
      </select>
      <ExprEditor value={props.value.value} vars={props.vars} onChange={(value) => props.onChange({ ...props.value, value })} />
    </span>
  );
}
