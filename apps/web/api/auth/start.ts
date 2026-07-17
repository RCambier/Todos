import { getPublicOrigin } from "mcp-handler";
import { loadConfig, unconfiguredResponse } from "../_lib/config.js";
import { sealBlob } from "../_lib/blob.js";
import { buildGoogleAuthorizeUrl, DRIVE_FILE_SCOPE } from "../_lib/google.js";
import { WEB_AUTH_STATE_PURPOSE } from "../_lib/webSession.js";

/**
 * Web-app sign-in, first leg: a plain top-level redirect to Google's consent
 * screen. No popups anywhere — this is what makes sign-in work on mobile,
 * where the Google Identity Services popup model is blocked or lands in a
 * junk tab. `access_type=offline` + `prompt=consent` guarantees Google
 * returns a refresh token, which `/api/auth/callback` seals into the session
 * cookie: that cookie is the "stay signed in" part.
 */

/** What the web app asks for: the board files plus basic profile for the account menu. */
export const WEB_AUTH_SCOPE =
  "openid https://www.googleapis.com/auth/userinfo.profile " +
  `https://www.googleapis.com/auth/userinfo.email ${DRIVE_FILE_SCOPE}`;

export function GET(request: Request): Response {
  const config = loadConfig();
  if (!config) return unconfiguredResponse();

  const state = sealBlob(config.authSigningSecret, WEB_AUTH_STATE_PURPOSE, { issuedAt: Date.now() });

  const googleAuthorizeUrl = buildGoogleAuthorizeUrl({
    googleClientId: config.googleClientId,
    redirectUri: `${getPublicOrigin(request)}/api/auth/callback`,
    state,
    scope: WEB_AUTH_SCOPE,
  });

  return Response.redirect(googleAuthorizeUrl, 302);
}
