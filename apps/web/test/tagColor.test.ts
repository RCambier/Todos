import { describe, expect, it } from "vitest";
import { setTagColor, TAG_COLORS, tagColorClass, tagColorId } from "../src/lib/tagColor.js";

describe("tagColorId", () => {
  it("gives the two named tags their built-in colors", () => {
    expect(tagColorId("revolut")).toBe("blue");
    expect(tagColorId("anthropic")).toBe("orange");
  });

  it("matches built-ins case- and whitespace-insensitively", () => {
    expect(tagColorId("  Revolut ")).toBe("blue");
    expect(tagColorId("ANTHROPIC")).toBe("orange");
  });

  it("falls back to a deterministic, stable color for other tags", () => {
    const first = tagColorId("groceries");
    expect(TAG_COLORS).toContain(first);
    expect(tagColorId("groceries")).toBe(first);
    expect(tagColorId("GROCERIES")).toBe(first); // same tag, same color everywhere
  });

  it("lets an explicit map override a built-in", () => {
    expect(tagColorId("revolut", { revolut: "green" })).toBe("green");
  });
});

describe("tagColorClass", () => {
  it("wraps the color id in a CSS class", () => {
    expect(tagColorClass("revolut")).toBe("tag-blue");
    expect(tagColorClass("anthropic")).toBe("tag-orange");
  });
});

describe("setTagColor", () => {
  it("changes a tag's resolved color (a user pick beats the built-in)", () => {
    setTagColor("anthropic", "purple");
    expect(tagColorId("anthropic")).toBe("purple");
    setTagColor("brand-new-tag", "teal");
    expect(tagColorId("brand-new-tag")).toBe("teal");
  });

  it("ignores a blank name", () => {
    expect(() => setTagColor("   ", "pink")).not.toThrow();
  });
});
