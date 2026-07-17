import { getPublicOrigin } from "mcp-handler";
import { loadConfig, unconfiguredResponse } from "../_lib/config.js";
import { isFresh, openBlob } from "../_lib/blob.js";
import { exchangeGoogleAuthCode, GoogleTokenError } from "../_lib/google.js";
import { sealSession, sessionCookieHeader, WEB_AUTH_STATE_PURPOSE } from "../_lib/webSession.js";

/**
 * Web-app sign-in, second leg: Google redirects back here with an
 * authorization code. We exchange it server-side (the client secret never
 * leaves this function), seal the refresh token into the httpOnly session
 * cookie, and land the user on the board. The access token is *not* passed
 * to the page through the URL — the app immediately calls
 * `/api/auth/session`, which mints one from the cookie.
 */

interface WebAuthState {
  issuedAt: number;
}

function redirectWithError(origin: string, message: string): Response {
  const target = new URL(origin);
  target.searchParams.set("auth_error", message);
  return Response.redirect(target.toString(), 302);
}

export async function GET(request: Request): Promise<Response> {
  const config = loadConfig();
  if (!config) return unconfiguredResponse();

  const origin = getPublicOrigin(request);
  const params = new URL(request.url).searchParams;

  const stateParam = params.get("state");
  const state = stateParam
    ? openBlob<WebAuthState>(config.authSigningSecret, WEB_AUTH_STATE_PURPOSE, stateParam)
    : undefined;
  if (!state || !isFresh(state.issuedAt)) {
    return redirectWithError(origin, "This sign-in link is invalid or has expired. Please try again.");
  }

  const googleError = params.get("error");
  if (googleError) {
    return redirectWithError(
      origin,
      googleError === "access_denied" ? "Sign-in was cancelled." : `Google sign-in failed (${googleError}).`,
    );
  }

  const code = params.get("code");
  if (!code) return redirectWithError(origin, "Google sign-in failed (no authorization code).");

  let refreshToken: string | undefined;
  try {
    const tokens = await exchangeGoogleAuthCode({
      googleClientId: config.googleClientId,
      googleClientSecret: config.googleClientSecret,
      code,
      redirectUri: `${origin}/api/auth/callback`,
    });
    refreshToken = tokens.refresh_token;
  } catch (err) {
    const detail = err instanceof GoogleTokenError ? ` (${err.code})` : "";
    return redirectWithError(origin, `Google sign-in failed${detail}. Please try again.`);
  }

  // prompt=consent should always yield one; if Google didn't, a cookie
  // without a refresh token would "succeed" into a broken session.
  if (!refreshToken) {
    return redirectWithError(origin, "Google did not grant offline access. Please try signing in again.");
  }

  const cookieValue = sealSession(config.authSigningSecret, { refreshToken, issuedAt: Date.now() });

  // Response.redirect() forbids extra headers, so build the 302 by hand.
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${origin}/`,
      "Set-Cookie": sessionCookieHeader(cookieValue),
      "Cache-Control": "no-store",
    },
  });
}
