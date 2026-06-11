import { For, Show, createMemo, createSignal } from "solid-js";
import type { EventWire, FieldDecl, InputSource, Node, NodeId, TypeRef, Value } from "../kernel/types";
import type { EventSpec, PropSpec } from "../kit";
import { KIT } from "../kit";
import { STYLE_PROP_KEYS, stylePropClass } from "../kit/styleprops";
import { apply, currentPage, kernel, selection, setStatus, version } from "./store";

// Fully generated from KitDef.props (MVP1_PLAN_AND_SPEC.md §6). The v1
// editor set is closed: text, number, toggle, dropdown, token-picker —
// anything else renders as JSON-with-warning (§11). Bind affordances arrive
// in P4.

const STYLE_OPTIONS: Record<string, string[]> = {
  pad: ["0", "1", "2", "3"],
  bg: ["none", "surface", "primary", "danger"],
  fg: ["text", "muted", "primary", "danger"],
  radius: ["none", "md"],
  size: ["auto", "fill"],
  align: ["start", "center", "end", "stretch"],
};

export function Inspector() {
  const node = createMemo(() => {
    version();
    const id = selection();
    return id ? kernel.state.nodes.get(id) : undefined;
  });
  return (
    <aside class="s-inspector">
      <Show when={node()} keyed fallback={<p class="s-hint">Select a node to edit it.</p>}>
        {(n) => <NodeInspector node={n} />}
      </Show>
    </aside>
  );
}

function NodeInspector(props: { node: Node }) {
  const def = KIT[props.node.kind];
  const isRoot = () => kernel.state.pages.some((p) => p.root === props.node.id);
  return (
    <div>
      <header class="s-inspector__head">
        <strong>{props.node.kind}</strong>
        <code>{props.node.id}</code>
        <button
          class="s-danger"
          disabled={isRoot()}
          title={isRoot() ? "page roots are removed with their page" : "delete node"}
          onClick={() => apply({ t: "RemoveNode", node: props.node.id })}
        >
          Delete
        </button>
      </header>

      <h4>Props</h4>
      <For each={Object.entries(def.props)}>
        {([key, spec]) => <PropEditor node={props.node} propKey={key} spec={spec} />}
      </For>

      <h4>Style</h4>
      <For each={STYLE_PROP_KEYS.filter((k) => k !== "visible")}>
        {(key) => <StyleEditor node={props.node} styleKey={key} />}
      </For>
      <label class="s-row">
        <span>visible</span>
        <input
          type="checkbox"
          checked={(version(), props.node.styleProps["visible"] !== false)}
          onChange={(e) =>
            apply({
              t: "SetStyleProp",
              node: props.node.id,
              key: "visible",
              ...(e.currentTarget.checked ? {} : { value: false }),
            })
          }
        />
      </label>

      <Show when={Object.keys(def.events).length > 0}>
        <h4>Events</h4>
        <For each={Object.entries(def.events)}>
          {([event, spec]) => <EventWireEditor node={props.node} event={event} spec={spec} />}
        </For>
      </Show>
    </div>
  );
}

// ── event wiring: the wire maps sources onto contract inputs (T0) ──────────

const VALUE_KINDS: Record<string, "string" | "number" | "bool"> = {
  TextInput: "string",
  TextArea: "string",
  Select: "string",
  NumberInput: "number",
  Checkbox: "bool",
};

function pageNodeIds(): NodeId[] {
  const page = kernel.state.pages.find((p) => p.id === currentPage());
  if (!page) return [];
  const out: NodeId[] = [];
  const visit = (id: NodeId) => {
    out.push(id);
    for (const child of kernel.state.nodes.get(id)?.children ?? []) visit(child);
  };
  visit(page.root);
  return out;
}

interface SourceOption {
  label: string;
  source: InputSource;
}

// Only type-compatible sources are offered — the design-time T0 check.
function sourceOptions(fieldType: TypeRef, spec: EventSpec): SourceOption[] {
  const out: SourceOption[] = [];
  if (typeof fieldType === "string") {
    for (const id of pageNodeIds()) {
      const node = kernel.state.nodes.get(id)!;
      if (VALUE_KINDS[node.kind] === fieldType) {
        out.push({ label: `node ${id} (${node.kind})`, source: { t: "nodeValue", node: id } });
      }
    }
    const page = kernel.state.pages.find((p) => p.id === currentPage());
    for (const decl of page?.state ?? []) {
      if (decl.type === fieldType) {
        out.push({ label: `state.${decl.name}`, source: { t: "statePath", path: `state.${decl.name}` } });
      }
    }
  }
  for (const [field, type] of Object.entries(spec.payload ?? {})) {
    const compatible = typeof fieldType === "string" ? type === fieldType : type === "json";
    if (compatible) out.push({ label: `payload.${field}`, source: { t: "payloadField", field } });
  }
  return out;
}

function EventWireEditor(props: { node: Node; event: string; spec: EventSpec }) {
  const wire = createMemo(() => {
    version();
    return props.node.events.find((w) => w.event === props.event);
  });
  const contract = createMemo(() => {
    version();
    return kernel.state.contracts.find((c) => c.id === wire()?.contract);
  });
  return (
    <div class="s-wireblock">
      <label class="s-row">
        <span>{props.event}</span>
        <select
          value={wire()?.contract ?? ""}
          onChange={(e) => {
            const id = e.currentTarget.value;
            if (!id) {
              if (wire()) apply({ t: "UnwireEvent", node: props.node.id, event: props.event });
              return;
            }
            apply({
              t: "WireEvent",
              node: props.node.id,
              wire: {
                event: props.event,
                contract: id,
                inputs: wire()?.contract === id ? wire()!.inputs : {},
              },
            });
          }}
        >
          <option value="">— unwired —</option>
          <For each={(version(), kernel.state.contracts)}>
            {(c) => <option value={c.id}>{c.name}</option>}
          </For>
        </select>
      </label>
      <Show when={contract()}>
        {(c) => (
          <For each={c().signature.inputs}>
            {(field) => (
              <InputSourceRow node={props.node} wire={wire()!} field={field} spec={props.spec} />
            )}
          </For>
        )}
      </Show>
    </div>
  );
}

function InputSourceRow(props: { node: Node; wire: EventWire; field: FieldDecl; spec: EventSpec }) {
  const options = () => (version(), sourceOptions(props.field.type, props.spec));
  const current = () => props.wire.inputs[props.field.name];
  const key = (s: InputSource | undefined) => (s ? JSON.stringify(s) : "");
  const setSource = (source: InputSource | undefined) => {
    const inputs = { ...props.wire.inputs };
    if (source) inputs[props.field.name] = source;
    else delete inputs[props.field.name];
    apply({ t: "WireEvent", node: props.node.id, wire: { ...props.wire, inputs } });
  };
  return (
    <label class="s-row s-row--sub">
      <span>← {props.field.name}</span>
      <select
        value={current()?.t === "literal" ? "LIT" : key(current())}
        onChange={(e) => {
          const v = e.currentTarget.value;
          if (v === "") setSource(undefined);
          else if (v === "LIT") setSource({ t: "literal", value: "" });
          else setSource(JSON.parse(v) as InputSource);
        }}
      >
        <option value="">— default —</option>
        <For each={options()}>
          {(opt) => <option value={key(opt.source)}>{opt.label}</option>}
        </For>
        <option value="LIT">literal…</option>
      </select>
      <Show when={current()?.t === "literal"}>
        <input
          class="s-mini"
          value={String((current() as { value: Value }).value ?? "")}
          onChange={(e) => setSource({ t: "literal", value: e.currentTarget.value })}
        />
      </Show>
    </label>
  );
}

// Type-compatible state paths for the bind picker (§6: the picker only
// offers paths whose type matches the prop).
function compatiblePaths(spec: PropSpec): string[] {
  const out: string[] = [];
  const page = kernel.state.pages.find((p) => p.id === currentPage());
  for (const decl of page?.state ?? []) {
    const declType = typeof decl.type === "string" ? decl.type : "record";
    if (
      (spec.t === "string" && declType === "string") ||
      (spec.t === "number" && declType === "number") ||
      (spec.t === "bool" && declType === "bool") ||
      (spec.t === "json" && declType === "record")
    ) {
      out.push(`state.${decl.name}`);
    }
  }
  if (spec.t === "json") {
    for (const store of kernel.state.stores) out.push(`store.${store.name}`);
  }
  return out;
}

function PropEditor(props: { node: Node; propKey: string; spec: PropSpec }) {
  const value = () => {
    version();
    return props.node.props[props.propKey] ?? props.spec.default;
  };
  const binding = () => {
    version();
    return props.node.bindings.find((b) => b.prop === props.propKey);
  };
  const set = (v: Value | undefined) =>
    apply({
      t: "SetProp",
      node: props.node.id,
      key: props.propKey,
      ...(v === undefined ? {} : { value: v }),
    });

  const spec = props.spec;
  return (
    <label class="s-row">
      <span>{props.propKey}</span>
      <Show
        when={!binding()}
        fallback={
          <span class="s-bound" title={`bound to ${binding()?.path}`}>
            ⛓ {binding()?.path}
            <button
              class="s-x"
              title="unbind"
              onClick={() => apply({ t: "UnbindProp", node: props.node.id, prop: props.propKey })}
            >
              ×
            </button>
          </span>
        }
      >
        <Show when={spec.t === "string"}>
          <input type="text" value={String(value() ?? "")} onInput={(e) => set(e.currentTarget.value)} />
        </Show>
        <Show when={spec.t === "number"}>
          <input
            type="number"
            value={Number(value() ?? 0)}
            onInput={(e) => {
              const n = e.currentTarget.valueAsNumber;
              if (!Number.isNaN(n)) set(n);
            }}
          />
        </Show>
        <Show when={spec.t === "bool"}>
          <input type="checkbox" checked={value() === true} onChange={(e) => set(e.currentTarget.checked)} />
        </Show>
        <Show when={spec.t === "enum"}>
          <select value={String(value())} onChange={(e) => set(e.currentTarget.value)}>
            <For each={spec.options}>{(opt) => <option value={opt}>{opt}</option>}</For>
          </select>
        </Show>
        <Show when={spec.t === "strings" || spec.t === "json"}>
          <JsonEditor value={value()} onApply={set} />
        </Show>
        <Show when={spec.bindable}>
          <BindPicker node={props.node} propKey={props.propKey} spec={spec} />
        </Show>
      </Show>
    </label>
  );
}

function BindPicker(props: { node: Node; propKey: string; spec: PropSpec }) {
  let details!: HTMLDetailsElement;
  const candidates = () => (version(), compatiblePaths(props.spec));
  return (
    <details class="s-bind" ref={details}>
      <summary title="bind to state">⛓</summary>
      <div class="s-bind__menu">
        <Show
          when={candidates().length > 0}
          fallback={<p class="s-hint">no compatible paths — declare state or a store</p>}
        >
          <For each={candidates()}>
            {(path) => (
              <button
                onClick={() => {
                  apply({ t: "BindProp", node: props.node.id, prop: props.propKey, path });
                  details.open = false;
                }}
              >
                {path}
              </button>
            )}
          </For>
        </Show>
      </div>
    </details>
  );
}

function JsonEditor(props: { value: Value; onApply: (v: Value) => void }) {
  const [error, setError] = createSignal(false);
  return (
    <span class="s-json">
      <textarea
        rows={3}
        onChange={(e) => {
          try {
            props.onApply(JSON.parse(e.currentTarget.value) as Value);
            setError(false);
          } catch {
            setError(true);
            setStatus("invalid JSON — not applied");
          }
        }}
      >
        {JSON.stringify(props.value)}
      </textarea>
      <em classList={{ "s-error": error() }}>{error() ? "invalid JSON" : "JSON value"}</em>
    </span>
  );
}

function StyleEditor(props: { node: Node; styleKey: string }) {
  const value = () => {
    version();
    const v = props.node.styleProps[props.styleKey];
    return typeof v === "string" ? v : "";
  };
  return (
    <label class="s-row">
      <span>{props.styleKey}</span>
      <select
        value={value()}
        onChange={(e) => {
          const v = e.currentTarget.value;
          apply({
            t: "SetStyleProp",
            node: props.node.id,
            key: props.styleKey,
            ...(v === "" ? {} : { value: v }),
          });
        }}
      >
        <option value="">—</option>
        <For each={STYLE_OPTIONS[props.styleKey] ?? []}>
          {(opt) => <option value={opt} disabled={!stylePropClass(props.styleKey, opt)}>{opt}</option>}
        </For>
      </select>
    </label>
  );
}
