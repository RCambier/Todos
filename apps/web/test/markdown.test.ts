import { describe, expect, it } from "vitest";
import { markdownPreview, parseBlocks, parseInline } from "../src/lib/markdown.js";

describe("parseInline", () => {
  it("passes plain text through", () => {
    expect(parseInline("just words")).toEqual([{ type: "text", text: "just words" }]);
  });

  it("parses code spans, bold, and italic", () => {
    expect(parseInline("a `x` **b** *c*")).toEqual([
      { type: "text", text: "a " },
      { type: "code", text: "x" },
      { type: "text", text: " " },
      { type: "strong", children: [{ type: "text", text: "b" }] },
      { type: "text", text: " " },
      { type: "em", children: [{ type: "text", text: "c" }] },
    ]);
  });

  it("parses markdown links (https only) and autolinks bare URLs", () => {
    expect(parseInline("[docs](https://a.example) and https://b.example.")).toEqual([
      { type: "link", href: "https://a.example", children: [{ type: "text", text: "docs" }] },
      { type: "text", text: " and " },
      { type: "link", href: "https://b.example", children: [{ type: "text", text: "https://b.example" }] },
      { type: "text", text: "." },
    ]);
  });

  it("does not linkify javascript: or other schemes", () => {
    const nodes = parseInline("[x](javascript:alert(1))");
    expect(nodes.every((n) => n.type !== "link")).toBe(true);
  });

  it("parses drive: and https images, but no other image schemes", () => {
    expect(parseInline("![shot](drive:abc123)")).toEqual([
      { type: "image", src: "drive:abc123", alt: "shot" },
    ]);
    expect(parseInline("![x](https://img.example/a.png)")).toEqual([
      { type: "image", src: "https://img.example/a.png", alt: "x" },
    ]);
    expect(parseInline("![x](file:///etc/passwd)").every((n) => n.type !== "image")).toBe(true);
  });

  it("keeps snake_case and asterisk math intact", () => {
    expect(parseInline("var_name and 2*3")).toEqual([{ type: "text", text: "var_name and 2*3" }]);
  });
});

describe("parseBlocks", () => {
  it("groups consecutive lines into one paragraph with hard breaks", () => {
    const blocks = parseBlocks("line one\nline two");
    expect(blocks).toEqual([
      {
        type: "paragraph",
        lines: [[{ type: "text", text: "line one" }], [{ type: "text", text: "line two" }]],
      },
    ]);
  });

  it("splits paragraphs on blank lines", () => {
    expect(parseBlocks("a\n\nb").map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
  });

  it("parses headings up to level 3", () => {
    const blocks = parseBlocks("# One\n## Two\n### Three");
    expect(blocks.map((b) => (b.type === "heading" ? b.level : null))).toEqual([1, 2, 3]);
  });

  it("parses bullet lists with checkboxes", () => {
    const blocks = parseBlocks("- plain\n- [ ] open\n- [x] done");
    expect(blocks).toHaveLength(1);
    const list = blocks[0]!;
    if (list.type === "bullets") {
      expect(list.items.map((i) => i.checked)).toEqual([undefined, false, true]);
    } else {
      expect.fail(`expected bullets, got ${list.type}`);
    }
  });

  it("parses numbered lists", () => {
    const blocks = parseBlocks("1. first\n2. second");
    expect(blocks[0]!.type).toBe("numbered");
  });

  it("parses quotes, rules, and fenced code", () => {
    const blocks = parseBlocks("> quoted\n\n---\n\n```\nconst x = 1;\n```");
    expect(blocks.map((b) => b.type)).toEqual(["quote", "hr", "code"]);
    const code = blocks[2]!;
    if (code.type === "code") expect(code.text).toBe("const x = 1;");
  });

  it("treats raw HTML as text — nothing to inject", () => {
    const blocks = parseBlocks("<script>alert(1)</script>");
    expect(blocks).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "<script>alert(1)</script>" }]] },
    ]);
  });

  it("leaves an unterminated fence as code to the end", () => {
    const blocks = parseBlocks("```\nunclosed");
    expect(blocks).toEqual([{ type: "code", text: "unclosed" }]);
  });
});

describe("markdownPreview", () => {
  it("strips markers and joins blocks", () => {
    expect(markdownPreview("# Title\n\n- **a**\n- b\n\nsome `code` here")).toBe("Title a · b some code here");
  });

  it("drops images but keeps their alt text", () => {
    expect(markdownPreview("before ![screenshot](drive:abc) after")).toBe("before screenshot after");
  });

  it("truncates long text with an ellipsis", () => {
    const long = "word ".repeat(100);
    const preview = markdownPreview(long, 50);
    expect(preview.length).toBeLessThanOrEqual(50);
    expect(preview.endsWith("…")).toBe(true);
  });
});
