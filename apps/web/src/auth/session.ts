/**
 * Client side of the persistent cookie session (see api/auth/*). Sign-in is
 * a plain top-level redirect — no popups, which is what makes it work on
 * mobile — and every later visit restores the session with one silent
 * `POST /api/auth/session`. The refresh token itself lives in an httpOnly
 * cookie this code can never read; all we ever hold is a short-lived access
 * token in memory.
 *
 * Deployments without the server env vars (see docs/SETUP.md) report
 * `unavailable`, and the app falls back to the old popup sign-in
 * (`auth/googleAuth.ts`) — signed in per visit only.
 */

export type SessionState =
  | { status: "ok"; token: string; expiresAt: number; scopes: string[] }
  | { status: "signed_out" }
  /** Deployment has no auth backend — use the popup fallback. */
  | { status: "unavailable" }
  /** Transient failure (Google or network); an existing token may still be good. */
  | { status: "error"; message: string };

export async function fetchSession(): Promise<SessionState> {
  let res: Response;
  try {
    res = await fetch("/api/auth/session", { method: "POST" });
  } catch {
    return { status: "error", message: "Couldn't reach the server to restore your session." };
  }
  if (res.ok) {
    const body = (await res.json()) as { access_token: string; expires_in: number; scope?: string };
    return {
      status: "ok",
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
      scopes: (body.scope ?? "").split(" ").filter(Boolean),
    };
  }
  if (res.status === 401) return { status: "signed_out" };
  if (res.status === 503 || res.status === 404) return { status: "unavailable" };
  return { status: "error", message: "Couldn't restore your session. Please try again." };
}

export function beginSignIn(): void {
  window.location.assign("/api/auth/start");
}

/** Re-consent adding the Google Tasks scope (Settings → calendar mirror). */
export function beginTasksConsent(): void {
  window.location.assign("/api/auth/start?scope=tasks");
}

/** The scope the calendar mirror needs (matches api/auth/start.ts TASKS_SCOPE). */
export const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

/** Clears the session cookie for this browser. Best-effort — worst case the user is signed back in on next load. */
export async function signOutSession(): Promise<void> {
  try {
    await fetch("/api/auth/signout", { method: "POST" });
  } catch {
    // Offline — the cookie survives, which only means staying signed in.
  }
}

/** Reads `?auth_error=` left by /api/auth/callback and strips it from the URL. */
export function consumeAuthError(): string | null {
  const url = new URL(window.location.href);
  const message = url.searchParams.get("auth_error");
  if (message === null) return null;
  url.searchParams.delete("auth_error");
  window.history.replaceState(null, "", url.toString());
  return message;
}
