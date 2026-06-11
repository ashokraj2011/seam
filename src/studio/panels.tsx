import { For, Show, createMemo, createSignal } from "solid-js";
import type { TypeRef, Value } from "../kernel/types";
import { blankNode, newId } from "../shared/nodes";
import {
  apply,
  currentPage,
  kernel,
  setCurrentPage,
  setSelection,
  setStatus,
  version,
} from "./store";

// Page / state / store panels — deliberately small in P3; the bind picker
// (P4) and contract editor (P5) are where these become load-bearing.

export function PagesPanel() {
  const pages = createMemo(() => (version(), [...kernel.state.pages]));
  return (
    <section class="s-panel">
      <h3>Pages</h3>
      <For each={pages()}>
        {(page) => (
          <div class="s-panel__row" classList={{ "s-active": currentPage() === page.id }}>
            <button
              class="s-link"
              onClick={() => {
                setCurrentPage(page.id);
                setSelection(null);
              }}
            >
              {page.route}
            </button>
            <input
              class="s-mini"
              value={page.route}
              onChange={(e) => apply({ t: "EditPage", page: page.id, route: e.currentTarget.value })}
            />
            <button
              class="s-x"
              title="remove page"
              onClick={() => {
                if (apply({ t: "RemovePage", page: page.id }) && currentPage() === page.id) {
                  setCurrentPage(kernel.state.pages[0]?.id ?? null);
                }
              }}
            >
              ×
            </button>
          </div>
        )}
      </For>
      <button
        onClick={() => {
          const root = blankNode("Container");
          const id = newId("page");
          if (
            apply({
              t: "AddPage",
              page: { id, route: `/${id}`, root: root.id, state: [] },
              nodes: [root],
            })
          ) {
            setCurrentPage(id);
            setSelection(null);
          }
        }}
      >
        + Add page
      </button>
    </section>
  );
}

const initialFor = (type: TypeRef): Value => (type === "number" ? 0 : type === "bool" ? false : "");

export function StatePanel() {
  // Fresh array each bump — the kernel mutates page objects in place, so a
  // memo on the page object itself would never re-notify Solid.
  const decls = createMemo(() => {
    version();
    return [...(kernel.state.pages.find((p) => p.id === currentPage())?.state ?? [])];
  });
  const [name, setName] = createSignal("");
  const [type, setType] = createSignal<"string" | "number" | "bool">("string");
  return (
    <section class="s-panel">
      <h3>Page state</h3>
      <Show when={currentPage()} fallback={<p class="s-hint">No page selected.</p>}>
        <For each={decls()}>
          {(decl) => (
            <div class="s-panel__row">
              <code>{decl.name}</code>
              <span class="s-dim">{typeof decl.type === "string" ? decl.type : "record"}</span>
              <button
                class="s-x"
                onClick={() => apply({ t: "RemoveState", page: currentPage()!, name: decl.name })}
              >
                ×
              </button>
            </div>
          )}
        </For>
        <div class="s-panel__row">
          <input
            class="s-mini"
            placeholder="name"
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <select value={type()} onChange={(e) => setType(e.currentTarget.value as never)}>
            <option>string</option>
            <option>number</option>
            <option>bool</option>
          </select>
          <button
            onClick={() => {
              if (!name().trim()) return setStatus("state needs a name");
              if (
                apply({
                  t: "DeclareState",
                  page: currentPage()!,
                  decl: { name: name().trim(), type: type(), initial: initialFor(type()) },
                })
              )
                setName("");
            }}
          >
            +
          </button>
        </div>
      </Show>
    </section>
  );
}

export function StoresPanel() {
  const stores = createMemo(() => (version(), [...kernel.state.stores]));
  const [name, setName] = createSignal("");
  return (
    <section class="s-panel">
      <h3>Data stores</h3>
      <For each={stores()}>
        {(store) => (
          <details class="s-panel__details">
            <summary>
              <code>{store.name}</code>
              <button class="s-x" onClick={() => apply({ t: "RemoveStore", store: store.id })}>
                ×
              </button>
            </summary>
            <label class="s-row">
              <span>schema</span>
              <textarea
                rows={3}
                onChange={(e) => {
                  try {
                    apply({
                      t: "EditStore",
                      store: store.id,
                      patch: { schema: JSON.parse(e.currentTarget.value) },
                    });
                  } catch {
                    setStatus("invalid schema JSON — not applied");
                  }
                }}
              >
                {JSON.stringify(store.schema)}
              </textarea>
            </label>
            <label class="s-row">
              <span>seed</span>
              <textarea
                rows={3}
                onChange={(e) => {
                  try {
                    const text = e.currentTarget.value.trim();
                    apply({
                      t: "EditStore",
                      store: store.id,
                      patch: { seed: text === "" ? null : JSON.parse(text) },
                    });
                  } catch {
                    setStatus("invalid seed JSON — not applied");
                  }
                }}
              >
                {JSON.stringify(store.seed ?? [])}
              </textarea>
            </label>
          </details>
        )}
      </For>
      <div class="s-panel__row">
        <input
          class="s-mini"
          placeholder="store name"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <button
          onClick={() => {
            const n = name().trim();
            if (!n) return setStatus("store needs a name");
            if (
              apply({
                t: "DeclareStore",
                store: {
                  id: newId("store"),
                  name: n,
                  schema: [{ name: "name", type: "string" }],
                },
              })
            )
              setName("");
          }}
        >
          +
        </button>
      </div>
    </section>
  );
}
