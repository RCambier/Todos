import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBlob, sealBlob } from "../../api/_lib/blob.js";
import {
  clearSessionCookieHeader,
  openSession,
  readCookie,
  sealSession,
  SESSION_COOKIE_NAME,
  sessionCookieHeader,
  WEB_AUTH_STATE_PURPOSE,
} from "../../api/_lib/webSession.js";
import { GET as authStart, TASKS_SCOPE, WEB_AUTH_SCOPE } from "../../api/auth/start.js";
import { GET as authCallback } from "../../api/auth/callback.js";
import { POST as authSession } from "../../api/auth/session.js";
import { POST as authSignout } from "../../api/auth/signout.js";

const SECRET = "a".repeat(64); // 32 bytes of hex
const OTHER_SECRET = "b".repeat(64);
const ORIGIN = "https://todos.example";

beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("AUTH_SIGNING_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Stubs global fetch to answer Google's token endpoint with `body` at `status`. */
function stubGoogleTokenEndpoint(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("webSession helpers", () => {
  it("round-trips a session payload", () => {
    const sealed = sealSession(SECRET, { refreshToken: "rt-123", issuedAt: 42 });
    expect(openSession(SECRET, sealed)).toEqual({ refreshToken: "rt-123", issuedAt: 42 });
  });

  it("rejects a session sealed under a different secret", () => {
    const sealed = sealSession(OTHER_SECRET, { refreshToken: "rt-123", issuedAt: 42 });
    expect(openSession(SECRET, sealed)).toBeUndefined();
  });

  it("rejects a blob sealed under a different purpose (no token confusion)", () => {
    const sealed = sealBlob(SECRET, WEB_AUTH_STATE_PURPOSE, { refreshToken: "rt-123", issuedAt: 42 });
    expect(openSession(SECRET, sealed)).toBeUndefined();
  });

  it("rejects a session payload without a refresh token", () => {
    const sealed = sealBlob(SECRET, "web-session", { issuedAt: 42 });
    expect(openSession(SECRET, sealed)).toBeUndefined();
  });

  it("reads its cookie out of a multi-cookie header", () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE_NAME}=blob-value; b=2`, SESSION_COOKIE_NAME)).toBe("blob-value");
    expect(readCookie("a=1; b=2", SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie(null, SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("scopes the cookie to /api/auth, httpOnly, secure", () => {
    const header = sessionCookieHeader("value");
    expect(header).toContain("Path=/api/auth");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });
});

describe("GET /api/auth/start", () => {
  it("503s when the deployment is unconfigured", () => {
    vi.stubEnv("AUTH_SIGNING_SECRET", "");
    expect(authStart(new Request(`${ORIGIN}/api/auth/start`)).status).toBe(503);
  });

  it("redirects to Google with offline access, consent, and the web scopes", () => {
    const res = authStart(new Request(`${ORIGIN}/api/auth/start`));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback`);
    expect(location.searchParams.get("access_type")).toBe("offline");
    expect(location.searchParams.get("prompt")).toBe("consent");
    expect(location.searchParams.get("scope")).toBe(WEB_AUTH_SCOPE);
    expect(location.searchParams.get("include_granted_scopes")).toBe("true");

    const state = openBlob<{ issuedAt: number }>(
      SECRET,
      WEB_AUTH_STATE_PURPOSE,
      location.searchParams.get("state")!,
    );
    expect(state?.issuedAt).toBeTypeOf("number");
  });

  it("adds the Google Tasks scope for the calendar-mirror re-consent (?scope=tasks)", () => {
    const res = authStart(new Request(`${ORIGIN}/api/auth/start?scope=tasks`));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("scope")).toBe(`${WEB_AUTH_SCOPE} ${TASKS_SCOPE}`);
    expect(location.searchParams.get("include_granted_scopes")).toBe("true");
  });
});

function sealedState(issuedAt = Date.now()): string {
  return sealBlob(SECRET, WEB_AUTH_STATE_PURPOSE, { issuedAt });
}

describe("GET /api/auth/callback", () => {
  it("redirects home with auth_error for a missing or forged state", async () => {
    for (const url of [
      `${ORIGIN}/api/auth/callback?code=x`,
      `${ORIGIN}/api/auth/callback?code=x&state=garbage`,
    ]) {
      const res = await authCallback(new Request(url));
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin).toBe(ORIGIN);
      expect(location.searchParams.get("auth_error")).toContain("invalid or has expired");
    }
  });

  it("redirects home with auth_error for an expired state", async () => {
    const url = `${ORIGIN}/api/auth/callback?code=x&state=${sealedState(Date.now() - 11 * 60 * 1000)}`;
    const res = await authCallback(new Request(url));
    expect(new URL(res.headers.get("location")!).searchParams.get("auth_error")).toContain("expired");
  });

  it("surfaces a cancelled consent screen as a friendly message, not a broken session", async () => {
    const url = `${ORIGIN}/api/auth/callback?error=access_denied&state=${sealedState()}`;
    const res = await authCallback(new Request(url));
    expect(new URL(res.headers.get("location")!).searchParams.get("auth_error")).toBe(
      "Sign-in was cancelled.",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("exchanges the code and seals the refresh token into the session cookie", async () => {
    const fetchMock = stubGoogleTokenEndpoint(200, {
      access_token: "at-1",
      expires_in: 3599,
      refresh_token: "rt-1",
      scope: WEB_AUTH_SCOPE,
      token_type: "Bearer",
    });

    const url = `${ORIGIN}/api/auth/callback?code=google-code&state=${sealedState()}`;
    const res = await authCallback(new Request(url));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);

    const exchangeBody = String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
    expect(exchangeBody).toContain("grant_type=authorization_code");
    expect(exchangeBody).toContain("code=google-code");

    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
    const value = readCookie(setCookie.split(";")[0] ?? null, SESSION_COOKIE_NAME)!;
    expect(openSession(SECRET, value)?.refreshToken).toBe("rt-1");
  });

  it("refuses to create a session when Google returns no refresh token", async () => {
    stubGoogleTokenEndpoint(200, {
      access_token: "at-1",
      expires_in: 3599,
      scope: WEB_AUTH_SCOPE,
      token_type: "Bearer",
    });

    const url = `${ORIGIN}/api/auth/callback?code=google-code&state=${sealedState()}`;
    const res = await authCallback(new Request(url));
    expect(new URL(res.headers.get("location")!).searchParams.get("auth_error")).toContain("offline access");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

function sessionRequest(cookie?: string): Request {
  return new Request(`${ORIGIN}/api/auth/session`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("POST /api/auth/session", () => {
  it("401s as signed_out without a cookie", async () => {
    const res = await authSession(sessionRequest());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ reason: "signed_out" });
  });

  it("401s as signed_out for a tampered cookie", async () => {
    const forged = sealSession(OTHER_SECRET, { refreshToken: "rt-1", issuedAt: Date.now() });
    const res = await authSession(sessionRequest(`${SESSION_COOKIE_NAME}=${forged}`));
    expect(res.status).toBe(401);
  });

  it("mints an access token from a valid cookie and slides the cookie forward", async () => {
    const fetchMock = stubGoogleTokenEndpoint(200, {
      access_token: "at-fresh",
      expires_in: 3599,
      scope: WEB_AUTH_SCOPE,
      token_type: "Bearer",
    });

    const cookie = sealSession(SECRET, { refreshToken: "rt-1", issuedAt: 1 });
    const res = await authSession(sessionRequest(`${SESSION_COOKIE_NAME}=${cookie}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ access_token: "at-fresh", expires_in: 3599, scope: WEB_AUTH_SCOPE });

    const refreshBody = String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
    expect(refreshBody).toContain("grant_type=refresh_token");
    expect(refreshBody).toContain("refresh_token=rt-1");

    const setCookie = res.headers.get("set-cookie")!;
    const value = readCookie(setCookie.split(";")[0] ?? null, SESSION_COOKIE_NAME)!;
    const reissued = openSession(SECRET, value)!;
    expect(reissued.refreshToken).toBe("rt-1");
    expect(reissued.issuedAt).toBeGreaterThan(1);
  });

  it("clears the cookie when Google rejects the refresh token", async () => {
    stubGoogleTokenEndpoint(400, { error: "invalid_grant", error_description: "Token revoked." });

    const cookie = sealSession(SECRET, { refreshToken: "rt-dead", issuedAt: Date.now() });
    const res = await authSession(sessionRequest(`${SESSION_COOKIE_NAME}=${cookie}`));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ reason: "session_expired" });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("502s (keeping the cookie) when Google is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const cookie = sealSession(SECRET, { refreshToken: "rt-1", issuedAt: Date.now() });
    const res = await authSession(sessionRequest(`${SESSION_COOKIE_NAME}=${cookie}`));

    expect(res.status).toBe(502);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/auth/signout", () => {
  it("clears the session cookie", () => {
    const res = authSignout();
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
