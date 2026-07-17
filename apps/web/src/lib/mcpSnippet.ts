/**
 * Builds a ready-to-paste Claude Code / Codex MCP server config for this
 * board. The server isn't published to npm — it's meant to be built and run
 * from a clone of this repo (see docs/SETUP.md) — so the snippet points
 * `node` at the built entrypoint rather than an `npx` package name.
 */
export function buildMcpConfigSnippet(spreadsheetId: string): string {
  const config = {
    mcpServers: {
      todos: {
        command: "node",
        args: ["/absolute/path/to/Todos/packages/mcp-server/dist/index.js"],
        env: {
          TODOS_SPREADSHEET_ID: spreadsheetId,
          GOOGLE_APPLICATION_CREDENTIALS: "/absolute/path/to/service-account-key.json",
        },
      },
    },
  };
  return JSON.stringify(config, null, 2);
}
