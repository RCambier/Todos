import { openBlob, sealBlob } from "./blob.js";

/**
 * The web app's persistent session: a Google refresh token sealed into an
 * httpOnly cookie. The server stays stateless — the browser carries the
 * (encrypted, tamper-evident) credential, and `/api/auth/session` turns it
 * into a short-lived access token on demand. Same trust posture as the MCP
 * connector: the deployment can only touch a board while holding a live
 * credential the user's own browser sent it.
 */

export const SESSION_COOKIE_NAME = "memoria_session";

/** Sealed-blob purpose strings; distinct from the MCP connector's "oauth-*" purposes by design. */
export const SESSION_PURPOSE = "web-session";
export const WEB_AUTH_STATE_PURPOSE = "web-auth-state";

/**
 * Browsers cap cookie lifetime at 400 days; the cookie is re-set (sliding)
 * on every successful `/api/auth/session`, so an actively used board never
 * expires. Google may still invalidate the refresh token server-side (e.g.
 * user revokes access) — that surfaces as a 401 and a fresh sign-in.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export interface SessionPayload {
  refreshToken: string;
  issuedAt: number;
}

export function sealSession(signingSecretHex: string, payload: SessionPayload): string {
  return sealBlob(signingSecretHex, SESSION_PURPOSE, payload);
}

export function openSession(signingSecretHex: string, blob: string): SessionPayload | undefined {
  const payload = openBlob<SessionPayload>(signingSecretHex, SESSION_PURPOSE, blob);
  if (!payload || typeof payload.refreshToken !== "string" || !payload.refreshToken) return undefined;
  return payload;
}

/** Minimal Cookie-header parser — we only ever look up our own cookie by name. */
export function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * `Path=/api/auth` keeps the sealed refresh token off every other request —
 * the static app and the MCP routes never see it. `SameSite=Lax` still sends
 * it on the top-level redirect back from Google.
 */
export function sessionCookieHeader(value: string): string {
  return (
    `${SESSION_COOKIE_NAME}=${value}; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; ` +
    `Path=/api/auth; HttpOnly; Secure; SameSite=Lax`
  );
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; Max-Age=0; Path=/api/auth; HttpOnly; Secure; SameSite=Lax`;
}
