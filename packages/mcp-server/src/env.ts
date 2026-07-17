import { existsSync } from "node:fs";

export interface Config {
  spreadsheetId: string;
  credentialsPath: string;
}

/** Thrown for missing/invalid configuration. Message is meant to be printed as-is, not wrapped. */
export class ConfigError extends Error {}

/**
 * Validates the two required environment variables and gives a precise,
 * actionable message when either is missing or points nowhere — this is
 * the first thing a user sees if their MCP client config is wrong.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const spreadsheetId = env.TODOS_SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new ConfigError(
      "TODOS_SPREADSHEET_ID is not set. Set it to the spreadsheet ID from the sheet's URL " +
        "(https://docs.google.com/spreadsheets/d/<THIS PART>/edit). " +
        "You can find it in the app's Settings panel.",
    );
  }

  const credentialsPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!credentialsPath) {
    throw new ConfigError(
      "GOOGLE_APPLICATION_CREDENTIALS is not set. Set it to the absolute path of your Google " +
        "service account key JSON file. See docs/SETUP.md for how to create one.",
    );
  }
  if (!existsSync(credentialsPath)) {
    throw new ConfigError(
      `GOOGLE_APPLICATION_CREDENTIALS points to "${credentialsPath}", but no file exists there. ` +
        "Double-check the path (it must be absolute).",
    );
  }

  return { spreadsheetId, credentialsPath };
}
