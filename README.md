# Seam

**A contract-first application fabric. Describe the UI visually, fill the logic
behind typed contracts, and ship each contract body as a portable,
capability-sandboxed component that is verified against its contract before it
runs — with zero round-trip between the visual model and the code.**

Seam Studio is the reference implementation. This README is the whole vision;
the phase-by-phase implementation log is further down, and the architecture
specs live in `~/Documents/artcle/BUILD_SPEC.md`, `MVP1_PLAN_AND_SPEC.md`, and
the design-principle white paper `CONTRACT_FIRST_WHITEPAPER.md`.

---

## 1. The problem

Every visual application builder in history dies at the same wall: the
**round-trip** between the visual model and hand-edited code. The moment you
edit the generated logic, regenerating the UI either destroys your work or must
parse arbitrary code back into the model — which is intractable, because any
representation expressive enough to capture arbitrary computation *is itself a
programming language*.

So every builder makes the same losing choice: stay visual and toylike, or
"eject to code" and never come back. The wall isn't a UX or tooling problem.
It's a **representational** problem, and it comes from one shared mistake —
these tools try to own the *implementation*.

## 2. The principle

> **The model stores interfaces, never implementations.** UI is pure data.
> Logic appears in the model only as a *contract* — a typed signature, a set of
> granted capabilities, and pre/post predicates — whose body is a *reference*,
> never source code.

That is the whole idea, and everything follows from it. Call it the
**invariant**: if a change would put an implementation into the model, the
change is wrong.

```
The design graph (source of truth)
├── UI tree ............ pure data — round-trips losslessly
└── Contracts .......... interfaces only
    ├── signature ....... types in / types out
    ├── grants .......... capabilities the body may use
    ├── predicates ...... pre/post, machine-checkable
    └── body: BodyRef ... a POINTER (unfilled | action-IR | compiled component)
```

## 3. What the principle buys

- **The round-trip problem dissolves.** Regenerating the UI can't touch the
  logic, because the model never held the logic. Redraw a screen, restructure a
  layout, regenerate a whole page — every body behind every contract is
  *untouched*, by construction. A whole category of failure has nowhere to occur.
- **Bodies are polymorphic.** The same contract can be filled by a visual
  action sequence, generated code, or hand-written code — interchangeably, same
  slot, same signature, same grants. The fill method is a private detail of the
  body.
- **Effects are physically bounded.** A contract's grants become its compiled
  component's *imports*, so a body **cannot exceed its declared effects** — a
  handler granted only storage has no way to reach the network; the call site
  doesn't exist.
- **Logic is verifiable against a stable target.** Because the contract is fixed
  and the body interchangeable, a body can be checked against it before it loads
  — shape conformance, imports ⊆ grants, behavioral drift, predicates — yielding
  a receipt the host enforces.

## 4. How it stays instant *and* shippable: two paths, one seam

A builder that's correct but slow loses to one that feels fast. Seam runs two
execution paths that meet at a single **dispatcher** — the one place a UI event
touches logic:

- **Design path (interpreted).** A framework-free renderer draws the UI tree
  directly; action-IR bodies run in a small evaluator against in-memory
  capability fakes. Every edit reflects in a frame. No code generation anywhere.
- **Ship path (compiled).** Bodies compile to portable, sandboxed WASM
  components. Action-IR bodies are **lowered to the same Rust** and compiled
  through the identical pipeline, so production has *one implementation, not two*.

The discipline that keeps them honest: a **drift corpus** runs recorded payloads
through both paths and diffs the results, state changes, and capability traces.
A divergence is a build failure. Because the Rust is generated from the same IR
the interpreter runs, equivalence is *by construction* — and it's checked in CI
with no compiler toolchain present.

## 5. One artifact, many hosts

The **runtime is the host**. The same built app — graph + components — runs
unchanged wherever a thin host satisfies its capability imports:

| Host | `kv` storage | `toast` | distribute as | status |
|---|---|---|---|---|
| **Browser** | IndexedDB / localStorage | DOM | static files / one HTML file | **built** |
| **Server / edge** | Postgres / D1 | SSE push | a container or worker | designed (M4) |
| **Desktop** | SQLite | native notify | a signed `.app` / `.exe` | designed (M5) |
| **Embedded** | host's choice | host's choice | a `.wasm` invoked in-process | follows from M2 |

You don't rebuild to move between them; you re-host. Portability is a property
of the boundary, not a porting project.

## 6. What you can build with it — and who it's for

The wedge is **lock-in-free low-code**: build visually, but the output is a
standard, portable artifact *you own* — `graph.json` plus standard WASM — not a
proprietary runtime you can never leave.

That serves a few real, underserved pains:

- **Own-your-data, local-first tools.** Describe a tool → get a real app that
  keeps its data on the device, needs no cloud account or subscription, and ships
  as a single file or a signed binary.
- **On-demand / generated UI.** Because UI is data and the renderer interprets it
  at runtime, a valid app can be produced by a human dragging, a program reading a
  schema, or an AI — and rendered with no build step. Seam already turns a data
  shape into a complete running CRUD app in one click.
- **Auditable AI-built apps.** Generated logic lands behind verified contracts:
  every action is capability-bounded and provable *before it runs*, so "the
  machine built this" becomes auditable rather than a wall of code you must trust.

It is **not** a freeform canvas for bespoke, pixel-exact, brand-expressive
design. It targets application-shaped UI — forms, tables, records, dashboards,
tools. That's the trade: less expressive freedom, in exchange for a design that
*is* the app, never drifts from it, and ships as verified portable logic.

## 7. The discipline (what it deliberately forbids)

These constraints are load-bearing, not limitations to lift later:

- **The action IR is deliberately not Turing-complete** — no loops, no
  arbitrary expressions. Logic that outgrows it *graduates* to a real code body
  behind the same contract. The boundary reads as a feature ("this is where you
  reach for code"), not a gap.
- **The component kit is closed and layout is structural** — containers, stacks,
  and grids only, no absolute positioning. Nothing is freely placed, so nothing
  can be misaligned; consistency is structural, not a review burden.
- **The graph schema is versioned from day one** — it's the contract between
  every tool and every version that reads it, so the implementation can evolve
  underneath without breaking the artifacts users already made.

## 8. Status

**Built and green in CI (no Rust toolchain required on the runner):**

- **MVP1 — the fully interpreted studio (M0 + M1).** Graph kernel (commands
  with inverses, deltas, coalescing undo, canonical `graph.json`, IndexedDB
  autosave); framework-free renderer + a 12-component kit; an IntelliJ-style
  SolidJS studio shell with slot drag-and-drop, a generated inspector, and an
  instant Design/Run toggle; reactive bindings with fine-grained table updates;
  a form-based contract editor with the action-IR interpreter, dispatcher,
  predicate badges, and a read-only WIT preview.
- **M2 — the WASM substrate.** The `app:caps` capability package; IR→Rust
  **lowering** (the body is generated from the IR, not hand-written); the jco
  browser host; the dispatcher's compiled-body arm; and a drift corpus proving
  the compiled component is behaviorally identical to the interpreter. Plus a
  live in-browser build endpoint and a **standalone export** that emits an app
  as one self-contained HTML file that runs with no studio and no server.
- **Generator + standalone export** — describe a data shape → a complete running
  CRUD app → exported as one portable file you own.

**Designed, sequenced, not yet built:**

- **M3** — the verification gate with receipts + a content-addressed registry;
  the demo is a *rejection*: a component importing an ungranted capability is
  refused at load.
- **M4** — a second (server) host with Postgres + SSE; the north star is a
  byte-identical component serving in a browser tab and behind a server route.
- **M5** — project export to a standalone codebase.
- **Kit gaps for real apps** — menu / tabs / nav-bar components, an app-shell
  with current-route highlighting, relational data (joins / related lists),
  responsive breakpoints, and an `http` capability for external APIs.

## 9. Run

```bash
npm install
npm run dev        # the studio at http://localhost:5173
npm test           # 238 unit/property tests (kernel, kit, runtime, perf gates)
npm run test:e2e   # Playwright: the demo script in a real browser
npm run typecheck
```

New here? Read [docs/QUICKSTART.md](docs/QUICKSTART.md) — the one-page guide for
building the customer manager cold.

---

# Implementation log

The vision above is realized phase by phase; each phase has a binary exit test.
What follows is the detail, newest first.

## Standalone export — the app runs with the studio gone

The **⬇ Standalone** button emits the current app as **one self-contained HTML
file**: the kit CSS, a Solid-free runtime bundle (`src/runtime-app/run.ts` →
`public/seam-runtime.js`, ~39 KB), and the graph, all inlined. Open the file and
the app runs — no studio, no server, data kept locally. The lock-in-free claim
made tangible.

- `src/runtime-app/run.ts` — the standalone bootstrap: reuses the renderer,
  dispatcher, and interpreter; browser host (kv → localStorage, toast → DOM).
- `src/export/standalone.ts` — the packager (`buildStandaloneHtml`), pure,
  `</script>`-injection-guarded, unit-tested.
- `vite.runtime.config.ts` — a Vite library build → the IIFE bundle; `dev` and
  `build` produce it automatically.
- Verified (`tests/runtime-app.test.ts` + live): a generated app, run from its
  graph JSON alone, renders, saves, and persists across a fresh run.

## Generate an app from a data shape

The **✨ Generate** button (`src/studio/generate.ts`) turns an entity + fields
into a complete, running CRUD app — store, bound form, bound table,
delete-with-confirm flow, and `save` / `select` / `delete` contracts with the
right grants, predicates, and wired inputs. The structure mirrors the hand-built
demo the drift corpus and e2e already prove, so a generated app is a proven app
(`tests/generate.test.ts` drives generate → save → delete through the real
dispatcher).

## M2 — the WASM substrate

- `components/` — the `app:caps` WIT package (kv-store, toast, clock, nav,
  ui-state) and per-contract crates whose `lib.rs`/`world.wit` are **generated
  from the IR**. Imports are exactly the contract's grants (plus the base
  ui-state channel).
- `src/runtime/lower.ts` — IR → Rust lowering (the "one implementation"
  mechanism). Covers Validate(nonEmpty), KvInsert/KvUpdate/KvDelete, Toast,
  SetState. `KvQuery`+`Branch` and record-input contracts throw `LoweringError`
  — the next increment.
- `src/runtime/filter.ts` — one `rowMatches` used identically by interpreter and
  host, so kv filtering can't drift.
- `scripts/lower-and-build.mjs` (`npm run build:component`) — lower → cargo-
  component → jco → hashed manifest, via `node --experimental-strip-types`. The
  studio never compiles during design; the toolchain is a dev-process sidecar
  (**no thick desktop IDE**). The contract editor's **⚙ compile to Rust** button
  drives it live via a dev middleware in `vite.config.ts`.
- `src/runtime/host.ts` + `caps/` — the host import table with the interpreter's
  exact atomic semantics. State writes are output (a delta, no trace);
  kv/toast/nav are granted effects.
- `src/runtime/component-host.ts` + `registry.ts` — invoke-by-hash (registry v0;
  M3 adds receipts + content addressing).
- `tests/drift.test.ts` — the M2 exit test: identical result, traces, and full
  post-state across both arms for `save-customer` and `delete-customer`, plus
  lowering snapshots. Runs on committed transpiled artifacts, so CI needs no Rust.

## P6 — hardening + IDE look

- IntelliJ-style dark chrome (`src/studio/studio.css`): dark tool windows, a
  slim toolbar with the green ▶ Run control, a status bar, and the page rendered
  as a light artboard on the dark workspace.
- Empty-page state + a dismissible first-run hint.
- `tests/perf.test.ts` — the quantitative gates: prop edit p95 < 16ms on a
  500-node page; five-action invocation p95 < 5ms to in-memory commit.
- `e2e/demo.spec.ts` — the demo script in CI: save, validation error + predicate
  badge, modal delete, reload persistence, palette drag + inspector edit +
  undo/redo, and a byte-stable export → wipe → import round trip.

## P5 — contracts + action IR

- `src/runtime/interpret.ts` — the interpreter: bodies execute atomically
  against an overlay journal (queries see earlier writes; a later error rolls
  everything back), yielding `Outcome { result, delta, traces }`. Predicates run
  as assertions after every Run-mode invocation.
- `src/runtime/dispatch.ts` — the dispatcher's arms: unfilled → stub toast,
  actionIr → interpret, component → instantiate-and-invoke. Wires resolve input
  sources (node values, state paths, payload fields, literals) onto contract
  inputs.
- `src/runtime/wit.ts` — the read-only WIT projection shown in the editor.
- `src/runtime/lint.ts` — the design-time grant check: flags actions orphaned by
  grant revocation.
- `src/studio/ContractEditor.tsx` — form-based authoring, the reorderable IR body
  editor that refuses ungranted actions, and the WIT preview.
- Inspector events section — wires events to contracts; only type-compatible
  sources are offered (design-time T0). Ambient toast + red predicate badges.
- `corpus/` — golden traces seeding the drift corpus.

P5 exit test (live + `tests/dispatch.test.ts`): wire an unfilled contract → stub
toast; fill it → behavior; revoke a grant → the editor flags the orphaned action.

## P4 — state + bindings

- `src/runtime/state.ts` — the framework-free signal store: dot-path roots
  (`state.<decl>`, `store.<name>`), the StateWrite vocabulary (`set`, `append`,
  `removeWhere`, `merge`), per-write change notifications, and `buildStateStore`.
- Renderer bindings re-patch on intersecting StateWrites; `KitDef.applyWrite` is
  the incremental path (Table appends one `<tr>`). Typed bind picker (⛓) offers
  only type-compatible paths.

P4 exit test (`tests/binding.test.ts`): bind a table to a 1,000-row store; an
append produces exactly one tbody mutation (MutationObserver, identities stable).

## P3 — studio shell

- `src/studio/App.tsx` — SolidJS chrome; keyboard: ⌘Z/⇧⌘Z, Delete, ↑/↓ slot
  nudging, ⌘C/⌘V subtree copy/paste (id-remapped).
- `src/studio/CanvasHost.tsx` — the framework-free renderer in the shell; Design
  intercepts events for selection + DnD, Run runs them live (one flag).
- `src/studio/dnd.ts` + `dnd-math.ts` — pointer-driven slot DnD; index math is
  pure and unit-tested.
- `src/studio/Inspector.tsx` — generated from `KitDef.props`.

## P2 — renderer + kit

- `src/kit/kitdef.ts` — the `KitDef` shape the `.kit` DSL will later parse into.
- `src/kit/defs/*` — all 12 components with dependency-mapped mount/patch; the
  behavior vocabulary; Table capped at 1,000 rows with a notice.
- `src/kit/styleprops.ts` + `app.css` — the closed StyleProps set → a generated
  utility layer; one stylesheet (drift-tested generated blocks).
- `src/renderer/renderer.ts` — mounts a page, subscribes to deltas, patches
  surgically (MoveNode moves real DOM nodes, no remount).
- `fixtures/kit/*.json` — renderer-agnostic conformance fixtures.

## P1 — graph kernel

- `src/kernel/types.ts` — the design graph types (`graphVersion: 1`).
- `src/kernel/commands.ts` — the command set (+ `RemoveContract`) and `GraphDelta`.
- `src/kernel/kernel.ts` — flat node map, `apply(cmd): GraphDelta`, inverses,
  200-deep undo with 300ms coalescing, delta subscriptions.
- `src/kernel/serialize.ts` — canonical (byte-stable) `graph.json` with
  referential-integrity checks. `src/kernel/autosave.ts` — write-behind IndexedDB.

## Exit tests by phase

| Phase | Exit test | Where |
|---|---|---|
| P1 | Fuzzed `apply(cmd); apply(inverse(cmd))` identity | `tests/inverse.test.ts` |
| P1 | Delta replay from empty reproduces the graph | `tests/deltas.test.ts` |
| P1 | Undo across 100 commands; coalescing; 200-cap | `tests/undo.test.ts` |
| P1 | `graph.json` round-trip byte-stable | `tests/serialize.test.ts` |
| P2 | Every kind × every prop renders from fixtures | `tests/kit.fixtures.test.ts` |
| P2 | Prop patch touches only dep-mapped nodes | `tests/kit.patch.test.ts` |
| P2 | Behavior vocabulary + Table cap + payloads | `tests/kit.behavior.test.ts` |
| P2 | Delta-driven render | `tests/renderer.test.ts` |
| P4 | 1,000-row bound table: append = one mutation | `tests/binding.test.ts` |
| P5 | unfilled → fill → revoke-grant flags orphan | `tests/dispatch.test.ts` |
| P6 | §9 quantitative perf gates | `tests/perf.test.ts` |
| P6 | The demo script, in a real browser | `e2e/demo.spec.ts` |
| M2 | Compiled component ≡ interpreter on the corpus | `tests/drift.test.ts` |
| — | Generator builds a working app | `tests/generate.test.ts` |
| — | Standalone export runs studio-free | `tests/runtime-app.test.ts` |
