# Seam Studio — one-page quickstart

Build a working customer manager in ten minutes, with zero code and zero
compilation. Everything you design runs live in the browser.

## The studio at a glance

- **Left rail** — component palette, pages, page state, data stores, contracts.
- **Canvas** — your page, rendered for real. Click selects; drag moves.
- **Right rail** — the inspector for whatever is selected.
- **Design / ▶ Run** — one toggle. Design: events inert, drag targets active.
  Run: the same renderer, events live. No rebuild.
- **⌘Z / ⇧⌘Z** undo/redo · **⌘C/⌘V** copy/paste · **↑/↓** nudge · **Delete** removes.

## Build the customer manager

1. **Form.** Drag a `Card` onto the page; set its title to “New customer” in
   the inspector. Drag two `TextInput`s into it (labels “Name”, “Email”) and
   a `Button` (“Save”).

2. **Store.** In *Data stores*, add a store named `customers`. Open it and
   set its schema to
   `[{"name":"name","type":"string"},{"name":"email","type":"string"}]`.

3. **Table.** Drag a second `Card` (“Customers”) and a `Table` into it. Set
   the table's columns to `["name","email"]`, then click the ⛓ next to its
   `rows` prop and bind it to `store.customers`.

4. **Contract.** In *Contracts*, author `save-customer`: inputs `name` and
   `email` (both string), result `error(string)`. Grant `kv(customers, rw)`
   and `toast`. Add predicates `non-empty(name)` and `persists(customers)`.
   The WIT pane on the right shows the interface you just authored — the
   grants are its imports; anything not granted is physically absent.

5. **Body.** Fill the body with five actions:
   `Validate name (non-empty)` → `KvInsert customers {name←var name,
   email←var email}` → `Toast "Saved {name}"` → two `SetState`s clearing
   your draft state. The add-menu greys out any action whose capability you
   didn't grant.

6. **Wire.** Select the Save button. Under *Events → click*, pick
   `save-customer`, then map `name ← node (Name input)` and
   `email ← node (Email input)`. Only type-compatible sources are offered.

7. **▶ Run.** Type a name and email, click Save: validation, insert, toast,
   table updates — and an empty name shows the error path plus a red
   `non-empty(name)` badge. Reload the tab: everything is still there.
   Export `graph.json`, wipe, import — identical app.

## Where the delete flow comes from

Row-click → a `select-customer` contract stores the pending row in page
state and opens a confirm `Modal` (its `open` prop is bound to a bool state);
the modal's Delete button wires to `delete-customer`, which `KvDelete`s by
name. Escape closes the modal. The seeded demo project has the whole flow —
open its contracts to read them.

## Rules worth knowing

- The graph stores **interfaces, never implementations** — bodies live
  behind contracts, so regenerating UI can never clobber logic.
- The action IR is deliberately **not Turing-complete**: one Branch level,
  no loops. Logic that outgrows it graduates to a Rust body behind the same
  contract (MVP2) — same slot, same predicates, same gate.
- Layout is containers/grid only. There is no absolute positioning, so
  there is nothing to misalign.
