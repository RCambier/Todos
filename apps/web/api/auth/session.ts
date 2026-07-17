import { loadConfig, unconfiguredResponse } from "../_lib/config.js";
import { GoogleTokenError, refreshGoogleToken } from "../_lib/google.js";
import {
  clearSessionCookieHeader,
  openSession,
  readCookie,
  sealSession,
  SESSION_COOKIE_NAME,
  sessionCookieHeader,
} from "../_lib/webSession.js";

/**
 * Turns the session cookie into a short-lived Google access token. The app
 * calls this on every load (that's what "staying signed in" is) and again
 * shortly before each token expires. 401 means "no usable session — show
 * the connect screen"; the body's `reason` says why without leaking detail.
 *
 * The cookie is re-sealed on every success so its Max-Age slides forward —
 * a board you actually use never signs itself out.
 */

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig();
  if (!config) return unconfiguredResponse();

  const cookieValue = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const session = cookieValue ? openSession(config.authSigningSecret, cookieValue) : undefined;
  if (!session) return json(401, { reason: "signed_out" });

  try {
    const tokens = await refreshGoogleToken({
      googleClientId: config.googleClientId,
      googleClientSecret: config.googleClientSecret,
      refreshToken: session.refreshToken,
    });
    const resealed = sealSession(config.authSigningSecret, {
      refreshToken: session.refreshToken,
      issuedAt: Date.now(),
    });
    return json(
      200,
      { access_token: tokens.access_token, expires_in: tokens.expires_in },
      { "Set-Cookie": sessionCookieHeader(resealed) },
    );
  } catch (err) {
    if (err instanceof GoogleTokenError && err.code === "invalid_grant") {
      // The refresh token is dead (user revoked access, or Google expired
      // it). The cookie is useless now — clear it.
      return json(401, { reason: "session_expired" }, { "Set-Cookie": clearSessionCookieHeader() });
    }
    // Anything else (Google hiccup, network) is transient — keep the cookie.
    return json(502, { reason: "google_unreachable" });
  }
}
