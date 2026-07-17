import { loadConfig, unconfiguredResponse } from "../_lib/config.js";
import { clearSessionCookieHeader } from "../_lib/webSession.js";

/**
 * Signs this browser out by discarding the session cookie. Deliberately does
 * *not* revoke the Google grant — other signed-in devices keep working, and
 * the user can always revoke the app entirely from myaccount.google.com
 * (docs/SETUP.md points there).
 */
export function POST(): Response {
  const config = loadConfig();
  if (!config) return unconfiguredResponse();

  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearSessionCookieHeader(), "Cache-Control": "no-store" },
  });
}
