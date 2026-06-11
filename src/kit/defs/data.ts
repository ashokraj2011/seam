import type { Value } from "../../kernel/types";
import type { Instance, KitDef } from "../kitdef";
import { el, setHidden, str, strs } from "../kitdef";

// Table v1 caps at 1,000 rendered rows with a visible notice; virtualization
// is a named MVP2 task (MVP1_PLAN_AND_SPEC.md §5).
export const TABLE_ROW_CAP = 1000;

type RowValue = Record<string, Value>;

const rows = (v: Value | undefined): RowValue[] =>
  Array.isArray(v) ? (v.filter((r) => r && typeof r === "object" && !Array.isArray(r)) as RowValue[]) : [];

const cell = (row: RowValue, col: string): string => {
  const v = row[col];
  if (v === undefined || v === null) return "";
  return typeof v === "object" ? JSON.stringify(v) : String(v);
};

function renderHead(head: HTMLTableRowElement, columns: string[]): void {
  head.textContent = "";
  const doc = head.ownerDocument;
  for (const col of columns) {
    const th = doc.createElement("th");
    th.textContent = col;
    head.appendChild(th);
  }
}

function renderBody(
  body: HTMLTableSectionElement,
  notice: HTMLElement,
  columns: string[],
  data: RowValue[],
): void {
  body.textContent = "";
  const doc = body.ownerDocument;
  const shown = data.slice(0, TABLE_ROW_CAP);
  for (const row of shown) {
    const tr = doc.createElement("tr");
    for (const col of columns) {
      const td = doc.createElement("td");
      td.textContent = cell(row, col);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  if (data.length > TABLE_ROW_CAP) {
    notice.textContent = `Showing ${TABLE_ROW_CAP} of ${data.length} rows`;
    setHidden(notice, false);
  } else {
    notice.textContent = "";
    setHidden(notice, true);
  }
}

export const Table: KitDef = {
  kind: "Table",
  props: {
    columns: { t: "strings", default: ["Column 1"] },
    rows: { t: "json", default: [], bindable: true },
  },
  events: { "row-click": { payload: { index: "number", row: "json" } } },
  deps: { columns: ["head", "body", "notice"], rows: ["body", "notice"] },
  mount({ doc, props, emit }) {
    const root = el(doc, "div", "k-table");
    const table = el(doc, "table", "k-table__table");
    const thead = el(doc, "thead");
    const head = el(doc, "tr");
    thead.appendChild(head);
    const body = el(doc, "tbody");
    table.append(thead, body);
    const notice = el(doc, "div", "k-table__notice");
    setHidden(notice, true);
    root.append(table, notice);

    const inst: Instance = {
      kind: "Table",
      root,
      parts: { root, head, body, notice },
      state: { columns: strs(props["columns"]), rows: rows(props["rows"]) as Value },
    };
    renderHead(head, strs(props["columns"]));
    renderBody(body, notice, strs(props["columns"]), rows(props["rows"]));

    body.addEventListener("click", (e) => {
      const target = e.target as HTMLElement | null;
      const tr = target?.closest ? (target.closest("tr") as HTMLTableRowElement | null) : null;
      if (!tr || tr.parentNode !== body) return;
      const index = Array.prototype.indexOf.call(body.children, tr);
      const data = rows(inst.state!["rows"]);
      emit("row-click", { index, row: data[index] ?? {} });
    });
    return inst;
  },
  patch(inst, key, value) {
    const state = inst.state!;
    const head = inst.parts["head"] as HTMLTableRowElement;
    const body = inst.parts["body"] as HTMLTableSectionElement;
    const notice = inst.parts["notice"] as HTMLElement;
    if (key === "columns") {
      state["columns"] = strs(value);
      renderHead(head, strs(value));
      renderBody(body, notice, strs(value), rows(state["rows"]));
    } else if (key === "rows") {
      state["rows"] = rows(value) as Value;
      renderBody(body, notice, strs(state["columns"]), rows(value));
    }
  },
  // The P4 exit-test path: an append to a bound rows path renders ONE <tr>;
  // a removeWhere drops exactly the removed rows. Anything else (set, merge,
  // cap-boundary cases) falls back to a full body render.
  applyWrite(inst, key, change) {
    if (key !== "rows") return false;
    const state = inst.state!;
    const body = inst.parts["body"] as HTMLTableSectionElement;
    const notice = inst.parts["notice"] as HTMLElement;
    const columns = strs(state["columns"]);
    const data = rows(change.value);

    if (change.write.t === "append") {
      state["rows"] = data as Value;
      if (data.length <= TABLE_ROW_CAP) {
        const row = data[data.length - 1]!;
        const tr = body.ownerDocument.createElement("tr");
        for (const col of columns) {
          const td = body.ownerDocument.createElement("td");
          td.textContent = cell(row, col);
          tr.appendChild(td);
        }
        body.appendChild(tr);
        if (!notice.hasAttribute("hidden")) {
          notice.textContent = "";
          setHidden(notice, true);
        }
      } else {
        notice.textContent = `Showing ${TABLE_ROW_CAP} of ${data.length} rows`;
        if (notice.hasAttribute("hidden")) setHidden(notice, false);
      }
      return true;
    }

    if (change.write.t === "removeWhere" && change.removedIndices) {
      const prevLen = data.length + change.removedIndices.length;
      if (prevLen > TABLE_ROW_CAP) return false; // was capped — full render
      for (let i = change.removedIndices.length - 1; i >= 0; i--) {
        body.children[change.removedIndices[i]!]?.remove();
      }
      state["rows"] = data as Value;
      return true;
    }

    return false;
  },
};
