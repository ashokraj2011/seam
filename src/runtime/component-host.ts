import type { Row, Value } from "../kernel/types";
import type { Outcome } from "./interpret";
import { createHostJournal } from "./host";
import { componentByHash } from "./registry";
import { bindImports } from "./caps/context.js";

// Invoke a compiled component body by hash. Same journaled capability
// semantics as the interpreter: traces record every crossing, kv writes
// stage in the journal, and the caller applies `delta` only on ok — so the
// two BodyRef arms are drop-in equivalent (the drift corpus enforces it).
//
// jco maps `result<_, string>` errs onto thrown ComponentError with a
// `payload` carrying the error value.

export async function invokeComponent(
  hash: string,
  input: Record<string, Value>,
  readStore: (name: string) => Row[],
): Promise<Outcome> {
  const entry = componentByHash(hash);
  if (!entry) {
    return {
      result: { t: "error", message: `no component ${hash.slice(0, 18)}… in the registry` },
      delta: [],
      traces: [],
    };
  }
  const journal = createHostJournal({ readStore });
  bindImports(journal.imports);
  const mod = await entry.load();
  const iface = mod[entry.export];
  if (!iface) {
    return {
      result: { t: "error", message: `component lacks export ${entry.export}` },
      delta: [],
      traces: [],
    };
  }
  try {
    iface.invoke(input);
    return journal.finish({ t: "ok" });
  } catch (err) {
    const payload = (err as { payload?: unknown }).payload;
    return journal.finish({
      t: "error",
      message: typeof payload === "string" ? payload : err instanceof Error ? err.message : String(err),
    });
  }
}
