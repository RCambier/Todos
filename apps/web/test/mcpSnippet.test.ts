import { describe, expect, it } from "vitest";
import { buildMcpConfigSnippet } from "../src/lib/mcpSnippet.js";

describe("buildMcpConfigSnippet", () => {
  it("embeds the spreadsheet id in the env block", () => {
    const snippet = buildMcpConfigSnippet("SHEET_ID_123");
    const parsed = JSON.parse(snippet);
    expect(parsed.mcpServers.todos.env.TODOS_SPREADSHEET_ID).toBe("SHEET_ID_123");
  });

  it("produces valid JSON pointing node at the built server entrypoint", () => {
    const parsed = JSON.parse(buildMcpConfigSnippet("abc"));
    expect(typeof parsed.mcpServers.todos.env.GOOGLE_APPLICATION_CREDENTIALS).toBe("string");
    expect(parsed.mcpServers.todos.command).toBe("node");
    expect(parsed.mcpServers.todos.args[0]).toMatch(/mcp-server\/dist\/index\.js$/);
  });
});
