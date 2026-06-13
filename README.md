# Seam Studio

Implementation of the contract-first application fabric studio.
Specs: `~/Documents/artcle/BUILD_SPEC.md` (architecture) and
`~/Documents/artcle/MVP1_PLAN_AND_SPEC.md` (MVP1 plan).

**Current phase: M2 complete — the WASM substrate, with IR lowered to Rust.**
MVP1 (P1–P6) is done, and M2's exit criterion holds in its strong form: the
`save-customer` Rust component is **generated from the action-IR body**
(`src/runtime/lower.ts`), compiled with cargo-component, run in the jco
browser host, and is behaviorally identical to the interpreter on the drift
corpus — same result, traces, and full post-state. Because the Rust is
lowered from the same IR the interpreter runs, equivalence is by
construction. Swapping `BodyRef` between IR and component in the contract
editor changes nothing the user can observe — the product thesis.

## What M2 contains

- `components/save-customer/` — the `app:caps` WIT package (kv-store, toast,
  clock, nav, ui-state) and the `lib.rs`/`world.wit` **generated from the
  IR**. The component's imports are exactly the contract's grants (plus the
  base ui-state channel); nothing else exists at runtime.
- `src/runtime/lower.ts` — IR → Rust lowering (the §6 "one implementation"
  mechanism). Covers the save-customer action set: Validate(nonEmpty),
  KvInsert, Toast, SetState(lit). KvUpdate/KvDelete, KvQuery/Branch, and
  var-sourced SetState throw `LoweringError` — the next lowering increment.
- `scripts/lower-and-build.mjs` (`npm run build:component`) — the build
  worker: lower IR → cargo-component → jco transpile → hashed manifest. Runs
  out of band via `node --experimental-strip-types`; the studio never
  compiles during design. **No thick desktop IDE needed** — the toolchain is
  a sidecar of the local dev process.
- `src/runtime/host.ts` + `caps/` — the host import table: journaled kv,
  toast, and ui-state with the interpreter's exact atomic semantics. State
  writes are output (a delta, no trace); kv/toast/nav are granted effects.
- `src/runtime/component-host.ts` + `registry.ts` — invoke-by-hash (registry
  v0; M3 adds receipts and content-addressed storage).
- The dispatcher's third arm is live: `BodyRef::component` instantiates and
  calls through the same `applyOutcome` seam as the interpreter.
- `tests/drift.test.ts` — the M2 exit test: identical result, traces, and
  full post-state (store rows AND cleared draft state) across both arms,
  plus a lowering snapshot. Runs on the committed transpiled artifact, so CI
  needs no Rust toolchain.

**M2 edges finished:**
- **Live build endpoint** — `vite.config.ts` adds a dev middleware
  `POST /api/build-component`; the contract editor's **⚙ compile to Rust**
  button lowers the current IR, compiles, and swaps in the result without
  leaving the browser. The Rust toolchain is a sidecar of the dev server —
  the concrete proof that no thick desktop IDE is needed. Absent
  cargo-component, it returns a clean error.
- **Lowering increment** — `KvUpdate`/`KvDelete` now lower via a shared
  filter matcher (`src/runtime/filter.ts`, used identically by interpreter
  and host) with a no-serde `json_str` value encoder. `delete-customer` is
  now lowered, built, and drift-tested alongside `save-customer`.

**Remaining lowering gap (before M5):** `KvQuery`+`Branch` and record-input
contracts (e.g. `select-customer`) still throw `LoweringError` — the
interpreter runs them; the compiled path is the next increment.

## Standalone export — the app runs with the studio gone

The **⬇ Standalone** button emits the current app as **one self-contained HTML
file**: the kit CSS, a Solid-free runtime bundle (`src/runtime-app/run.ts` →
`public/seam-runtime.js`, ~39 KB), and the graph, all inlined. Open the file
and the app runs — no studio, no server, data kept locally in the browser.
This is the lock-in-free claim made tangible: the artifact is portable and
entirely yours.

- `src/runtime-app/run.ts` — the standalone bootstrap: reuses the renderer,
  dispatcher, and interpreter; browser host (kv → localStorage, toast → DOM);
  no studio chrome.
- `src/export/standalone.ts` — the packager (`buildStandaloneHtml`), pure and
  unit-tested, with `</script>`-injection guards.
- Built via `npm run build:runtime` (a Vite library build → IIFE exposing
  `SeamRuntime.run`); `npm run dev` and `npm run build` produce it automatically.
- Verified end to end (`tests/runtime-app.test.ts`): a generated app, run from
  its graph JSON alone, renders, saves, and persists across a fresh run; and
  live, a generated Tasks app served as a standalone file runs with no studio.

## Generate an app from a data shape (lock-in-free demo)

The **✨ Generate** button (or `src/studio/generate.ts`) turns an entity + a
list of fields into a complete, running CRUD app — a store, a bound form, a
bound table, a delete-with-confirm flow, and `save` / `select` / `delete`
contracts with the right grants, predicates, and wired inputs. It's the
on-demand-UI / lock-in-free thesis made concrete: what you get out is graph
data + interpretable contracts **you own** — no vendor runtime, runnable
instantly, and each contract can later compile to a portable WASM component.
The generated structure mirrors the hand-built demo the drift corpus and e2e
already prove, so a generated app is a proven app (`tests/generate.test.ts`
drives generate → save → delete through the real dispatcher).

## Run

```bash
npm install
npm run dev        # the studio at http://localhost:5173
npm test           # 218 unit/property tests (kernel, kit, runtime, perf gates)
npm run test:e2e   # Playwright: the §9 demo script in a real browser
npm run typecheck
```

New here? Read [docs/QUICKSTART.md](docs/QUICKSTART.md) — the one-page guide
§9 hands to a cold user.

## What P6 contains

- IntelliJ-style dark chrome (`src/studio/studio.css`): dark tool windows,
  slim toolbar with the green ▶ Run control, status bar, and the page
  rendered as a light artboard on the dark workspace.
- Empty-page state and a dismissible first-run hint.
- `tests/perf.test.ts` — the §9 quantitative gates: prop edit p95 < 16ms on
  a 500-node page; five-action invocation p95 < 5ms to in-memory commit.
- `e2e/demo.spec.ts` — the §9 demo script in CI: save, validation error +
  predicate badge, modal delete, reload persistence, palette drag + inspector
  edit + undo/redo, and a byte-stable export → wipe → import round trip.
- `docs/QUICKSTART.md` — the one-page quickstart.

The dev page is the P1 proof harness, not the studio (that's P3): it shows
the live canonical `graph.json`, a command log, and buttons that issue real
kernel commands. Autosave writes to IndexedDB on every delta (debounced
250ms).

## What P1 contains

- `src/kernel/types.ts` — the design graph types (`graphVersion: 1`).
- `src/kernel/commands.ts` — the v1 command set (+ `RemoveContract`, required
  as `AuthorContract`'s inverse) and `GraphDelta`.
- `src/kernel/kernel.ts` — flat node map, `apply(cmd): GraphDelta`, every
  command returns its inverse, 200-deep undo with 300ms coalescing of rapid
  prop edits, delta subscriptions.
- `src/kernel/serialize.ts` — canonical (sorted-key, byte-stable)
  `graph.json` export/import with referential-integrity checks.
- `src/kernel/autosave.ts` — debounced write-behind IndexedDB persistence.

## What P5 contains

- `src/runtime/interpret.ts` — the action-IR interpreter: bodies execute
  atomically against an overlay journal (queries see earlier writes; a later
  error rolls everything back), yielding `Outcome { result, delta, traces }`.
  Predicates run as assertions after every Run-mode invocation.
- `src/runtime/dispatch.ts` — the dispatcher's two live arms: unfilled →
  stub toast, actionIr → interpret; the component arm throws until MVP2.
  Wires resolve their input sources (node values, state paths, payload
  fields, literals) onto contract inputs.
- `src/runtime/wit.ts` — the read-only WIT projection shown in the editor.
- `src/runtime/lint.ts` — the design-time grant check: flags actions
  orphaned by grant revocation (T1's cultural seed).
- `src/runtime/kvpersist.ts` — kv tables persisted write-behind to
  IndexedDB; reload restores data, not just design.
- `src/studio/ContractEditor.tsx` — form-based contract authoring
  (signature, grants, predicate templates), the reorderable IR body editor
  that refuses ungranted actions, and the WIT preview.
- Inspector events section — wires events to contracts; only type-compatible
  sources are offered (the design-time T0).
- Ambient toast layer + red predicate badges on the wired control.
- `corpus/` — golden traces (payload + expected Outcome + post-state) that
  seed MVP2's drift corpus.

P5 exit test (verified live + `tests/dispatch.test.ts`): wire an unfilled
contract → stub toast; fill it → behavior; revoke a grant → the editor flags
the orphaned action.

## What P4 contains

- `src/runtime/state.ts` — the framework-free signal store: dot-path roots
  (`state.<decl>`, `store.<name>`), the v1 StateWrite vocabulary (`set`,
  `append`, `removeWhere`, `merge`), per-write change notifications with
  removed indices, and `buildStateStore` seeding from decls + store seeds.
- Renderer bindings — bound props resolve from the StateStore at mount,
  re-patch on intersecting StateWrites, rebuild on state-shape deltas
  (declare/edit/remove state/stores), and the binding wins over `SetProp`.
- `KitDef.applyWrite` — the incremental path: Table appends one `<tr>` per
  append write and drops exact rows on removeWhere; everything else falls
  back to a full dep-mapped patch.
- Typed bind picker in the inspector (⛓ on bindable props) offering only
  type-compatible paths; bound props show a path chip with unbind.
- Seed-data flow: store seed edits in the panel re-render bound tables live.

P4 exit test (`tests/binding.test.ts`): bind a table to a store with 1,000
seed rows; an append produces exactly one childList mutation on the tbody
(asserted via MutationObserver, row identities stable); appends past the
1,000-row cap touch only the notice.

## What P3 contains

- `src/studio/App.tsx` — SolidJS chrome: header (Design/Run toggle, undo/redo,
  export/import/wipe), left panels, canvas, inspector. Keyboard: ⌘Z/⇧⌘Z,
  Delete, ↑/↓ slot nudging, ⌘C/⌘V subtree copy/paste (id-remapped).
- `src/studio/CanvasHost.tsx` — the framework-free renderer mounted inside the
  shell. Design mode intercepts pointer/click at capture phase (components
  inert) for selection + DnD; Run mode is the same renderer with events live —
  one flag, no rebuild.
- `src/studio/dnd.ts` + `dnd-math.ts` — pointer-driven slot DnD: ghost chip,
  drop indicators before/after siblings and into empty containers, Escape
  cancels. Index math is pure and unit-tested.
- `src/studio/Inspector.tsx` — fully generated from `KitDef.props`; the closed
  v1 editor set (text, number, toggle, dropdown, token-picker) with
  JSON-with-warning for everything else. Bind affordances arrive in P4.
- `src/studio/panels.tsx` — pages / page-state / data-store panels.

P3 exit test (run in the browser): drag Button into Card → indicator shows,
node lands at the drop index, gets selected; change variant in the inspector →
canvas patches live; undo ×10 / redo ×10 → DOM returns to baseline and back,
toolbar disables at stack ends.

## What P2 contains

- `src/kit/kitdef.ts` — the `KitDef` shape (props schema, event payloads,
  dependency map, mount/patch) the `.kit` DSL will later parse into.
- `src/kit/defs/*` — all 12 component kinds with hand-written mount/patch
  against their dependency maps; behavior vocabulary v1 (open-on-trigger,
  dismiss-on-escape, dismiss-on-timeout); Table capped at 1,000 rows with a
  visible notice.
- `src/kit/styleprops.ts` — the closed StyleProps set projected to a
  generated utility-class layer.
- `src/kit/app.css` — one stylesheet: tokens + kit styles + utilities
  (generated blocks drift-tested; regenerate with
  `UPDATE_CSS=1 npx vitest run tests/appcss.test.ts`).
- `src/renderer/renderer.ts` — framework-free renderer: mounts a page from
  the graph, subscribes to deltas, patches surgically (MoveNode moves real
  DOM nodes, no remount).
- `fixtures/kit/*.json` — renderer-agnostic conformance fixtures per kind
  (MVP2 reuses these against the Dioxus projection).

## P2 exit tests

| Exit test (from the spec) | Where |
|---|---|
| Every kind × every prop renders from fixtures (coverage enforced) | `tests/kit.fixtures.test.ts` |
| Prop patch touches only dep-mapped nodes, via MutationObserver | `tests/kit.patch.test.ts` |
| Behavior vocabulary + Table cap + event payloads | `tests/kit.behavior.test.ts` |
| Delta-driven render: insert/remove/move/prop/style/theme | `tests/renderer.test.ts` |
| app.css generated blocks match their sources | `tests/appcss.test.ts` |

## P1 exit tests

| Exit test (from the spec) | Where |
|---|---|
| Fuzzed `apply(cmd); apply(inverse(cmd))` identity, every command type | `tests/inverse.test.ts` |
| Delta completeness: replay from empty reproduces the graph | `tests/deltas.test.ts` |
| Undo correct across a 100-command session; coalescing; 200-entry cap | `tests/undo.test.ts` |
| `graph.json` round-trip byte-stable | `tests/serialize.test.ts` |
| Kill the tab, reopen, graph intact | manual: `npm run dev`, mutate, close tab, reopen |

## Next phases

P2 renderer + 12-component kit → P3 studio shell (SolidJS) → P4 state +
bindings → P5 contracts + action IR → P6 hardening + demo. See the MVP1 plan
§8 for gates.
