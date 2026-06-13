import { describe, expect, it } from "vitest";
import { buildStandaloneHtml } from "../src/export/standalone";

describe("buildStandaloneHtml", () => {
  const parts = {
    title: "tasks",
    graphJson: '{"graphVersion":1,"project":{"name":"tasks"}}',
    runtimeJs: "window.SeamRuntime = { run: function(){} };",
    css: ".k-btn { color: red; }",
  };

  it("inlines css, runtime, and graph into one self-contained document", () => {
    const html = buildStandaloneHtml(parts);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(".k-btn { color: red; }");
    expect(html).toContain("window.SeamRuntime");
    expect(html).toContain('SeamRuntime.run({"graphVersion":1');
    expect(html).toContain('id="seam-app"');
    // no external references — fully self-contained
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
  });

  it("neutralizes embedded </script> so inlined content can't break out", () => {
    const html = buildStandaloneHtml({
      ...parts,
      graphJson: '{"x":"</script><script>alert(1)</script>"}',
    });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("<\\/script");
  });

  it("escapes the title", () => {
    const html = buildStandaloneHtml({ ...parts, title: "<b>x</b>" });
    expect(html).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>");
  });
});
