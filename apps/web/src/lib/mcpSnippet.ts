/**
 * The hosted MCP connector's URL and the ready-to-paste configs for it.
 * There is nothing to fill in: the connector is served by this same
 * deployment, and each user authenticates with their own Google account
 * when adding it (no spreadsheet ID needed — the connector finds the
 * caller's own board).
 */

export function buildConnectorUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/mcp`;
}

/** One-liner for Claude Code's CLI (remote MCP over Streamable HTTP + OAuth). */
export function buildClaudeCodeCliSnippet(origin: string): string {
  return `claude mcp add --transport http --scope user todos ${buildConnectorUrl(origin)}`;
}
