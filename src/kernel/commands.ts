import type {
  BodyRef,
  Contract,
  ContractId,
  DataStore,
  EventWire,
  FieldDecl,
  Grant,
  Node,
  NodeId,
  Page,
  PageId,
  Predicate,
  Row,
  Sig,
  StateDecl,
  StatePath,
  StoreId,
  ThemeTokens,
  Value,
} from "./types";

// The v1 command set (MVP1_PLAN_AND_SPEC.md §4), plus RemoveContract — it is
// AuthorContract's inverse, so the kernel cannot exist without it.
//
// Conventions that make apply(cmd); apply(inverse(cmd)) an exact identity:
// - Creator commands carry an optional `index` so an inverse can restore
//   array order precisely; omitted means append.
// - SetProp/SetStyleProp with `value` omitted deletes the key (the inverse of
//   setting a previously-absent prop).
// - StorePatch.seed: null clears the seed (the inverse of seeding a store
//   that had none).

export interface StorePatch {
  name?: string;
  schema?: FieldDecl[];
  seed?: Row[] | null;
}

export interface ContractPatch {
  name?: string;
  signature?: Sig;
  grants?: Grant[];
  predicates?: Predicate[];
}

export type Command =
  | { t: "InsertNode"; parent: NodeId; index: number; node: Node; descendants?: Node[] }
  | { t: "RemoveNode"; node: NodeId }
  | { t: "MoveNode"; node: NodeId; toParent: NodeId; toIndex: number }
  | { t: "SetProp"; node: NodeId; key: string; value?: Value }
  | { t: "SetStyleProp"; node: NodeId; key: string; value?: Value }
  | { t: "BindProp"; node: NodeId; prop: string; path: StatePath; index?: number }
  | { t: "UnbindProp"; node: NodeId; prop: string }
  | { t: "WireEvent"; node: NodeId; wire: EventWire; index?: number }
  | { t: "UnwireEvent"; node: NodeId; event: string }
  | { t: "DeclareState"; page: PageId; decl: StateDecl; index?: number }
  | { t: "RemoveState"; page: PageId; name: string }
  | { t: "DeclareStore"; store: DataStore; index?: number }
  | { t: "EditStore"; store: StoreId; patch: StorePatch }
  | { t: "RemoveStore"; store: StoreId }
  | { t: "AuthorContract"; contract: Contract; index?: number }
  | { t: "EditContract"; contract: ContractId; patch: ContractPatch }
  | { t: "RemoveContract"; contract: ContractId }
  | { t: "FillBody"; contract: ContractId; body: BodyRef }
  | { t: "SetTheme"; theme: ThemeTokens }
  | { t: "AddPage"; page: Page; nodes: Node[]; index?: number }
  | { t: "EditPage"; page: PageId; route: string }
  | { t: "RemovePage"; page: PageId };

// Every applied command yields a delta; deltas are the only thing the
// preview subscribes to. Replaying delta.cmd from an empty graph reproduces
// the graph (tested in tests/deltas.test.ts).
export interface GraphDelta {
  cmd: Command;
  inverse: Command;
}
