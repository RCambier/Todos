#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { listTasks, MalformedSheetError } from "./board.js";
import { ConfigError, loadConfig } from "./env.js";
import { SheetsClient } from "./sheetsClient.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[todos-mcp-server] Configuration error: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  let client: SheetsClient;
  try {
    client = await SheetsClient.create(config.spreadsheetId, config.credentialsPath);
    await client.ping();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[todos-mcp-server] Could not reach spreadsheet "${config.spreadsheetId}" with the given ` +
        `service account: ${message}\n` +
        "Check that: the spreadsheet ID is correct, the key file is valid, and the sheet has " +
        "been shared with the service account's email (as a writer) from the app's Settings panel.",
    );
    process.exit(1);
  }

  // Fail fast with a precise message if the sheet doesn't validate — rather than surfacing a
  // confusing error from the first tool call.
  try {
    await listTasks(client);
  } catch (err) {
    if (err instanceof MalformedSheetError) {
      console.error(`[todos-mcp-server] ${err.message}`);
      process.exit(1);
    }
    // Other errors (e.g. transient network) are not fatal at startup — tools will surface them.
  }

  const server = new McpServer({ name: "todos-mcp-server", version: "0.1.0" });
  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[todos-mcp-server] Connected. Waiting for requests over stdio.");
}

main().catch((err) => {
  console.error("[todos-mcp-server] Fatal error:", err);
  process.exit(1);
});
