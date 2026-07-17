import { describe, expect, it } from "vitest";
import { generateId } from "../src/id.js";

describe("generateId", () => {
  it("generates a 12-character id by default", () => {
    expect(generateId()).toHaveLength(12);
  });

  it("respects a custom length", () => {
    expect(generateId(20)).toHaveLength(20);
    expect(generateId(1)).toHaveLength(1);
  });

  it("only uses URL-safe base62 characters", () => {
    const id = generateId(200);
    expect(id).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("is not deterministic across calls", () => {
    const ids = new Set(Array.from({ length: 500 }, () => generateId()));
    expect(ids.size).toBe(500);
  });
});
