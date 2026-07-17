import { AUTH_SCOPES, GOOGLE_CLIENT_ID } from "../config.js";

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
 * Requests a `drive.file`-scoped access token via the GIS popup. This is the
 * *fallback* sign-in, used only on deployments without the auth backend
 * (src/auth/session.ts): the popup can only open from a user gesture — a
 * silent `prompt: "none"` variant of this call is popup-blocked on load,
 * which is why it no longer exists — so call this from a click handler.
 */
export async function requestToken(): Promise<string> {
  await loadGisScript();
  if (!window.google) throw new Error("Google Identity Services failed to load.");

  return new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: AUTH_SCOPES,
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
    client.requestAccessToken({ prompt: "consent" });
  });
}

export function getToken(): string | null {
  return currentToken;
}

export interface UserProfile {
  name: string;
  email: string;
  /** Google profile photo URL, or "" if none. */
  picture: string;
}

/**
 * Fetches the signed-in user's basic profile for the account menu. Returns
 * `null` on any failure — the menu falls back to a generic avatar; identity
 * display is never worth blocking the app over.
 */
export async function fetchUserProfile(token: string): Promise<UserProfile | null> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { name?: string; email?: string; picture?: string };
    return { name: data.name ?? "", email: data.email ?? "", picture: data.picture ?? "" };
  } catch {
    return null;
  }
}

export function clearToken(): void {
  if (currentToken && window.google) {
    window.google.accounts.oauth2.revoke(currentToken, () => {});
  }
  currentToken = null;
}
