// Design-graph kernel types — MVP1_PLAN_AND_SPEC.md §4 / BUILD_SPEC.md §4.
// The graph stores interfaces, never implementations: UI nodes are pure data,
// logic appears only as a Contract whose body is a BodyRef.

export type NodeId = string;
export type PageId = string;
export type ContractId = string;
export type StoreId = string;
export type Var = string;
export type StatePath = string; // dot path into page state, e.g. "form.name"

export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value };

export type ComponentKind =
  | "Label"
  | "Button"
  | "TextInput"
  | "NumberInput"
  | "Checkbox"
  | "Select"
  | "TextArea"
  | "Container"
  | "Card"
  | "Table"
  | "Modal"
  | "Toast";

export type TypeRef = "string" | "number" | "bool" | { record: StoreId };

export interface Binding {
  prop: string;
  path: StatePath;
}

// The event wire — not the body — maps sources onto a contract's declared
// inputs at dispatch. Bodies never read the UI (BUILD_SPEC.md §4).
export type InputSource =
  | { t: "nodeValue"; node: NodeId }
  | { t: "statePath"; path: StatePath }
  | { t: "payloadField"; field: string }
  | { t: "literal"; value: Value };

export interface EventWire {
  event: string;
  contract: ContractId;
  inputs: Record<string, InputSource>; // contract input ← its source
}

export type StyleProps = Record<string, Value>;

export interface Node {
  id: NodeId;
  kind: ComponentKind;
  props: Record<string, Value>;
  styleProps: StyleProps;
  bindings: Binding[];
  events: EventWire[];
  children: NodeId[]; // by id — nodes live in a flat map
}

export interface StateDecl {
  name: string;
  type: TypeRef;
  initial: Value;
}

export interface Page {
  id: PageId;
  route: string;
  root: NodeId;
  state: StateDecl[];
}

export interface FieldDecl {
  name: string;
  type: TypeRef;
}

export type Row = Record<string, Value>;

export interface DataStore {
  id: StoreId;
  name: string;
  schema: FieldDecl[];
  seed?: Row[];
}

export type Grant =
  | { t: "kv"; store: StoreId; mode: "r" | "rw" }
  | { t: "toast" }
  | { t: "nav" }
  | { t: "clock" };

export type Predicate =
  | { t: "nonEmpty"; field: string }
  | { t: "persists"; store: StoreId }
  | { t: "unique"; store: StoreId; field: string };

export interface Sig {
  inputs: FieldDecl[];
  result: { t: "ok" } | { t: "error" }; // ok | error(string) in v1
}

export type ValidationRule =
  | { t: "nonEmpty" }
  | { t: "matches"; pattern: string }
  | { t: "range"; min?: number; max?: number };

export type Expr = { t: "var"; name: Var } | { t: "lit"; value: Value };

export interface FilterExpr {
  field: string;
  op: "eq" | "neq" | "contains";
  value: Expr;
}

export type RecordExpr = Record<string, Expr>;

export type Cond = { t: "empty"; var: Var } | { t: "eq"; left: Expr; right: Expr };

// Action IR v1 — closed set (MVP1_PLAN_AND_SPEC.md §7). Contract inputs
// arrive pre-bound as vars via the event wire.
export type Action =
  | { t: "Validate"; var: Var; rule: ValidationRule; elseError: string }
  | { t: "KvInsert"; store: StoreId; record: RecordExpr }
  | { t: "KvQuery"; store: StoreId; filter: FilterExpr; into: Var }
  | { t: "KvUpdate"; store: StoreId; where: FilterExpr; set: RecordExpr }
  | { t: "KvDelete"; store: StoreId; where: FilterExpr }
  | { t: "SetState"; path: StatePath; from: Expr }
  | { t: "Toast"; template: string }
  | { t: "Navigate"; route: string }
  | { t: "Branch"; cond: Cond; then: Action[]; else: Action[] }; // one level, no loops

export type BodyRef =
  | { t: "unfilled" }
  | { t: "actionIr"; seq: Action[] }
  | { t: "component"; hash: string };
// M3 adds the receipt: { t: "component"; hash; receipt } — hosts will then
// refuse hashes without a verification receipt.

export interface Contract {
  id: ContractId;
  name: string;
  signature: Sig;
  grants: Grant[];
  predicates: Predicate[];
  body: BodyRef;
}

export interface ProjectMeta {
  name: string;
}

export type ThemeTokens = Record<string, string>;
