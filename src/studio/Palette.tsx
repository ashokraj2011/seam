import { For } from "solid-js";
import type { ComponentKind } from "../kernel/types";
import { KIT } from "../kit";
import { canvasBridge, mode } from "./store";

// Drag a kind from here onto the canvas — drop indicators show valid slots.

export function Palette() {
  const kinds = Object.keys(KIT) as ComponentKind[];
  return (
    <section class="s-panel">
      <h3>Components</h3>
      <div class="s-palette" classList={{ "s-palette--disabled": mode() === "run" }}>
        <For each={kinds}>
          {(kind) => (
            <div
              class="s-palette__item"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                canvasBridge.startNewDrag?.(e, kind);
              }}
            >
              {kind}
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
