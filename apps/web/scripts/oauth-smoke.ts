/**
 * In-process smoke test of the hosted-connector OAuth proxy: drives the real
 * route handlers (register → authorize → callback → token) as one continuous
 * flow, the way claude.ai would, plus the negative paths that matter. The
 * only thing faked is Google itself (`fetch` is stubbed for the token
 * exchange; the authorize redirect is inspected, not followed).
 *
 * Not shipped anywhere — run it from the repo root with:
 *   npm run smoke:oauth --workspace=@memoria/web
 */
import { createHash, randomBytes } from "node:crypto";

// Configure the connector before the route modules read process.env.
process.env.GOOGLE_OAUTH_CLIENT_ID = "smoke-client-id.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "smoke-client-secret";
process.env.AUTH_SIGNING_SECRET = randomBytes(32).toString("hex");

const { POST: registerPOST } = await import("../api/oauth/register.js");
const { GET: authorizeGET } = await import("../api/oauth/authorize.js");
const { GET: callbackGET } = await import("../api/oauth/callback.js");
const { POST: tokenPOST } = await import("../api/oauth/token.js");

const HOST = "https://todos.example.vercel.app";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

let failures = 0;

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok      ${name}`);
  } else {
    failures += 1;
    console.error(`  FAILED  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function formRequest(url: string, params: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

// ---------------------------------------------------------------- happy path

console.log("\n1. Dynamic Client Registration");
const registerRes = await registerPOST(
  jsonRequest(`${HOST}/api/oauth/register`, { redirect_uris: [CLAUDE_CALLBACK] }),
);
check("registration accepted", registerRes.status === 201, `status ${registerRes.status}`);
const { client_id: clientId } = (await registerRes.json()) as { client_id: string };
check("client_id issued", typeof clientId === "string" && clientId.length > 0);

console.log("\n2. Authorization request (PKCE S256)");
const codeVerifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
const clientState = "claude-opaque-state-123";
const authorizeUrl =
  `${HOST}/api/oauth/authorize?` +
  new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    state: clientState,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
const authorizeRes = authorizeGET(new Request(authorizeUrl));
check("302 to Google", authorizeRes.status === 302, `status ${authorizeRes.status}`);
const googleUrl = new URL(authorizeRes.headers.get("location") ?? "about:blank");
check("lands on accounts.google.com", googleUrl.hostname === "accounts.google.com");
check("drive.file scope requested", googleUrl.searchParams.get("scope")?.includes("drive.file") === true);
check("offline access + consent", googleUrl.searchParams.get("access_type") === "offline");
check(
  "Google redirects back to our /api/oauth/callback",
  googleUrl.searchParams.get("redirect_uri") === `${HOST}/api/oauth/callback`,
);
const sealedState = googleUrl.searchParams.get("state") ?? "";
check("state is an opaque sealed blob", sealedState.length > 0 && !sealedState.includes(clientState));

console.log("\n3. Google callback → our authorization code");
const callbackRes = callbackGET(
  new Request(
    `${HOST}/api/oauth/callback?` +
      new URLSearchParams({ code: "google-auth-code-xyz", state: sealedState }).toString(),
  ),
);
check("302 back to claude.ai", callbackRes.status === 302, `status ${callbackRes.status}`);
const clientRedirect = new URL(callbackRes.headers.get("location") ?? "about:blank");
check(
  "redirect target is the registered callback",
  clientRedirect.origin + clientRedirect.pathname === CLAUDE_CALLBACK,
);
check("client state echoed back", clientRedirect.searchParams.get("state") === clientState);
const ourCode = clientRedirect.searchParams.get("code") ?? "";
check(
  "our code is sealed (Google's code not visible)",
  ourCode.length > 0 && !ourCode.includes("google-auth-code-xyz"),
);

console.log("\n4. Token exchange (PKCE verified, Google proxied)");
const realFetch = globalThis.fetch;
let googleSawCode: string | undefined;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://oauth2.googleapis.com/token")) {
    const params = new URLSearchParams(String(init?.body));
    googleSawCode = params.get("code") ?? undefined;
    return new Response(
      JSON.stringify({
        access_token: "ya29.smoke-access-token",
        expires_in: 3599,
        refresh_token: "1//smoke-refresh-token",
        scope: "https://www.googleapis.com/auth/drive.file",
        token_type: "Bearer",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  throw new Error(`Unexpected fetch in smoke test: ${url}`);
}) as typeof fetch;

try {
  const tokenRes = await tokenPOST(
    formRequest(`${HOST}/api/oauth/token`, {
      grant_type: "authorization_code",
      code: ourCode,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  );
  check("token exchange succeeds", tokenRes.status === 200, `status ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
  check("Google's tokens returned as ours", tokens.access_token === "ya29.smoke-access-token");
  check("refresh token passed through", tokens.refresh_token === "1//smoke-refresh-token");
  check("Google received its own original code", googleSawCode === "google-auth-code-xyz");

  console.log("\n5. Refresh grant proxied");
  const refreshRes = await tokenPOST(
    formRequest(`${HOST}/api/oauth/token`, {
      grant_type: "refresh_token",
      refresh_token: "1//smoke-refresh-token",
      client_id: clientId,
    }),
  );
  check("refresh succeeds", refreshRes.status === 200, `status ${refreshRes.status}`);

  // ------------------------------------------------------------ negative paths

  console.log("\n6. Negative paths");
  const evilRegister = await registerPOST(
    jsonRequest(`${HOST}/api/oauth/register`, {
      redirect_uris: ["https://claude.ai.evil.example/api/mcp/auth_callback"],
    }),
  );
  check("lookalike redirect domain rejected at registration", evilRegister.status === 400);

  const forgedClientId = `${clientId.split(".")[0]}.${"A".repeat(43)}`;
  const forgedAuthorize = authorizeGET(
    new Request(
      `${HOST}/api/oauth/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: forgedClientId,
          redirect_uri: CLAUDE_CALLBACK,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }).toString(),
    ),
  );
  check("forged client_id rejected at authorize", forgedAuthorize.status === 400);

  const plainPkce = authorizeGET(
    new Request(
      `${HOST}/api/oauth/authorize?` +
        new URLSearchParams({
          response_type: "code",
          client_id: clientId,
          redirect_uri: CLAUDE_CALLBACK,
          code_challenge: codeChallenge,
          code_challenge_method: "plain",
        }).toString(),
    ),
  );
  check("PKCE method 'plain' rejected at authorize", plainPkce.status === 400);

  const tamperedState = callbackGET(
    new Request(
      `${HOST}/api/oauth/callback?` +
        new URLSearchParams({
          code: "google-auth-code-xyz",
          state: sealedState.slice(0, -4) + "AAAA",
        }).toString(),
    ),
  );
  check("tampered state rejected at callback", tamperedState.status === 400);

  const wrongVerifier = await tokenPOST(
    formRequest(`${HOST}/api/oauth/token`, {
      grant_type: "authorization_code",
      code: ourCode,
      redirect_uri: CLAUDE_CALLBACK,
      client_id: clientId,
      code_verifier: "totally-wrong-verifier",
    }),
  );
  check("wrong PKCE verifier rejected at token", wrongVerifier.status === 400);

  const codeAsToken = await tokenPOST(
    formRequest(`${HOST}/api/oauth/token`, {
      grant_type: "authorization_code",
      code: sealedState, // a state blob is not an authorization code — purposes must not be interchangeable
      redirect_uri: CLAUDE_CALLBACK,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  );
  check("state blob unusable as authorization code (purpose separation)", codeAsToken.status === 400);
} finally {
  globalThis.fetch = realFetch;
}

console.log("");
if (failures > 0) {
  console.error(`${failures} smoke check(s) FAILED`);
  process.exit(1);
}
console.log("All smoke checks passed.");
