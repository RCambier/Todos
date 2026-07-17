import { DRIVE_FILE_SCOPE, GOOGLE_CLIENT_ID } from "../config.js";

// Types for `window.google.accounts.oauth2` live in ../global.d.ts — GIS
// loads as a global via a <script> tag, there is no npm package for it.

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gisLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

/** The live access token, kept in memory only — never persisted to disk. */
let currentToken: string | null = null;

/**
 * Requests (or silently refreshes) a `drive.file`-scoped access token.
 * `interactive: false` tries to get a token without showing a consent
 * screen (used for silent refresh on load); pass `true` for the first sign-in.
 */
export async function requestToken(interactive: boolean): Promise<string> {
  await loadGisScript();
  if (!window.google) throw new Error("Google Identity Services failed to load.");

  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_FILE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? "Sign-in failed."));
          return;
        }
        currentToken = response.access_token;
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? error.type ?? "Sign-in failed."));
      },
    });
    client.requestAccessToken({ prompt: interactive ? "consent" : "none" });
  });
}

export function getToken(): string | null {
  return currentToken;
}

export function clearToken(): void {
  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {});
  }
  currentToken = null;
}
