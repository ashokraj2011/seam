import type { Value } from "../kernel/types";

// The closed StyleProps set (MVP1_PLAN_AND_SPEC.md §5): token-scaled
// spacing/color/radius/size/align/visible, projected to a generated
// utility-class layer. The utilities block in app.css is generated from
// this module (drift-tested in tests/appcss.test.ts).

const SCALE = ["0", "1", "2", "3"] as const;
const BG = ["none", "surface", "primary", "danger"] as const;
const FG = ["text", "muted", "primary", "danger"] as const;
const RADIUS = ["none", "md"] as const;
const SIZE = ["auto", "fill"] as const;
const ALIGN = ["start", "center", "end", "stretch"] as const;

export const STYLE_PROP_KEYS = ["pad", "bg", "fg", "radius", "size", "align", "visible"] as const;
export type StylePropKey = (typeof STYLE_PROP_KEYS)[number];

const inList = (list: readonly string[], v: Value | undefined): v is string =>
  typeof v === "string" && list.includes(v);

// Returns the utility class for a style prop value, or null when the value
// produces no class (visible: true, unknown values, unset).
export function stylePropClass(key: string, value: Value | undefined): string | null {
  switch (key) {
    case "visible":
      return value === false ? "u-hidden" : null;
    case "pad":
      return inList(SCALE, value) ? `u-pad-${value}` : null;
    case "bg":
      return inList(BG, value) ? `u-bg-${value}` : null;
    case "fg":
      return inList(FG, value) ? `u-fg-${value}` : null;
    case "radius":
      return inList(RADIUS, value) ? `u-radius-${value}` : null;
    case "size":
      return inList(SIZE, value) ? `u-size-${value}` : null;
    case "align":
      return inList(ALIGN, value) ? `u-align-${value}` : null;
    default:
      return null;
  }
}

// Layout utilities consumed by Container's KitDef.
export const LAYOUT_CLASSES = {
  directions: ["row", "column"] as const,
  gaps: SCALE,
};

export function utilitiesCss(): string {
  const lines: string[] = [];
  lines.push(".u-hidden { display: none !important; }");
  lines.push(".u-flex-row { display: flex; flex-direction: row; }");
  lines.push(".u-flex-column { display: flex; flex-direction: column; }");
  lines.push(".u-wrap { flex-wrap: wrap; }");
  lines.push(".u-grid { display: grid; }");
  for (const g of SCALE) lines.push(`.u-gap-${g} { gap: ${g === "0" ? "0" : `var(--space-${g})`}; }`);
  for (const p of SCALE)
    lines.push(`.u-pad-${p} { padding: ${p === "0" ? "0" : `var(--space-${p})`}; }`);
  lines.push(".u-bg-none { background: transparent; }");
  lines.push(".u-bg-surface { background: var(--color-surface); }");
  lines.push(".u-bg-primary { background: var(--color-primary); color: #ffffff; }");
  lines.push(".u-bg-danger { background: var(--color-danger); color: #ffffff; }");
  for (const f of FG) lines.push(`.u-fg-${f} { color: var(--color-${f}); }`);
  lines.push(".u-radius-none { border-radius: 0; }");
  lines.push(".u-radius-md { border-radius: var(--radius-md); }");
  lines.push(".u-size-auto { width: auto; }");
  lines.push(".u-size-fill { width: 100%; }");
  for (const a of ALIGN) {
    const css = a === "start" ? "flex-start" : a === "end" ? "flex-end" : a;
    lines.push(`.u-align-${a} { align-self: ${css}; }`);
  }
  return lines.join("\n") + "\n";
}

export function tokensCss(theme: Record<string, string>): string {
  const lines = Object.keys(theme)
    .sort()
    .map((k) => `  --${k}: ${theme[k]};`);
  return `:root {\n${lines.join("\n")}\n}\n`;
}
