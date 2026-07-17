import { describe, expect, it } from "vitest";
import { buildClaudeCodeCliSnippet, buildConnectorUrl } from "../src/lib/mcpSnippet.js";

describe("buildConnectorUrl", () => {
  it("appends /api/mcp to the deployment origin", () => {
    expect(buildConnectorUrl("https://todos.example.vercel.app")).toBe(
      "https://todos.example.vercel.app/api/mcp",
    );
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(buildConnectorUrl("https://todos.example.vercel.app/")).toBe(
      "https://todos.example.vercel.app/api/mcp",
    );
  });
});

describe("buildClaudeCodeCliSnippet", () => {
  it("registers the connector as a remote HTTP MCP server at user scope", () => {
    expect(buildClaudeCodeCliSnippet("https://todos.example.vercel.app")).toBe(
      "claude mcp add --transport http --scope user memoria https://todos.example.vercel.app/api/mcp",
    );
  });
});
