/**
 * Plain `fetch` wrappers around the three Google OAuth endpoints this
 * server proxies to. Deliberately not shared with `apps/web/src/config.ts`
 * (a Vite build-time constant baked in via `import.meta.env`, which
 * wouldn't resolve the same way from a Vercel Function) — this scope
 * literal is the one honest duplication in this feature.
 */

export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const GOOGLE_AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_ENDPOINT = "https://oauth2.googleapis.com/tokeninfo";

/** Google rejected a token exchange or refresh — `code`/`message` come straight from Google's response. */
export class GoogleTokenError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "GoogleTokenError";
  }
}

export function buildGoogleAuthorizeUrl(opts: {
  googleClientId: string;
  redirectUri: string;
  state: string;
  /** Defaults to `drive.file` alone (the MCP connector's grant). */
  scope?: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.googleClientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope ?? DRIVE_FILE_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: opts.state,
  });
  return `${GOOGLE_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

async function googleTokenRequest(params: Record<string, string>): Promise<GoogleTokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as
    GoogleTokenResponse | { error?: string; error_description?: string };
  if (!res.ok) {
    const err = body as { error?: string; error_description?: string };
    throw new GoogleTokenError(err.error ?? "token_exchange_failed", err.error_description);
  }
  return body as GoogleTokenResponse;
}

/** Exchanges an authorization code Google issued for tokens. Never logs the code or the result. */
export function exchangeGoogleAuthCode(opts: {
  googleClientId: string;
  googleClientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<GoogleTokenResponse> {
  return googleTokenRequest({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.googleClientId,
    client_secret: opts.googleClientSecret,
  });
}

/** Proxies a refresh_token grant straight to Google. Never logs the token or the result. */
export function refreshGoogleToken(opts: {
  googleClientId: string;
  googleClientSecret: string;
  refreshToken: string;
}): Promise<GoogleTokenResponse> {
  return googleTokenRequest({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.googleClientId,
    client_secret: opts.googleClientSecret,
  });
}

export interface GoogleTokenInfo {
  scope?: string;
  aud?: string;
  [key: string]: unknown;
}

/** Looks up an access token's scopes and audience. Returns `undefined` for any invalid/expired token. */
export async function fetchGoogleTokenInfo(accessToken: string): Promise<GoogleTokenInfo | undefined> {
  // POST with the token in the body, not `?access_token=` — query strings are
  // the part of a request most likely to end up in an intermediary's logs.
  const res = await fetch(GOOGLE_TOKENINFO_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: accessToken }),
  });
  if (!res.ok) return undefined;
  return (await res.json()) as GoogleTokenInfo;
}
