import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { registerTools } from "@memoria/mcp-server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { loadConfig, unconfiguredResponse } from "./_lib/config.js";
import { DRIVE_FILE_SCOPE, fetchGoogleTokenInfo } from "./_lib/google.js";
import { RemoteBoardCatalog } from "./_lib/sheetStore.js";

/**
 * The hosted MCP endpoint: the board tools from `@memoria/mcp-server` (imported from its
 * transport-free entrypoint), operating on the caller's own boards — listed via `list_boards`,
 * targeted per call by `board_id` (optional while the account has a single board). Authenticated
 * per-request by the caller's Google access token — there is no session, no server-side
 * credential store, nothing to leak.
 */

/** Verifies a caller's bearer token directly against Google (no local session/token store). */
async function verifyToken(_request: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  const config = loadConfig();
  if (!config || !bearerToken) return undefined;

  const info = await fetchGoogleTokenInfo(bearerToken);
  if (!info) return undefined;

  const scopes = (info.scope ?? "").split(" ").filter(Boolean);
  if (!scopes.includes(DRIVE_FILE_SCOPE)) return undefined;
  if (info.aud !== config.googleClientId) return undefined;

  return { token: bearerToken, scopes, clientId: String(info.aud) };
}

/** Builds a fresh MCP server per request, bound to that request's caller via `RemoteBoardCatalog`. */
async function mcpHandler(request: Request): Promise<Response> {
  // withMcpAuth (below) only calls this once verifyToken has already succeeded with `required:
  // true`, so `request.auth` is always set here — this check is just satisfying the type.
  const token = request.auth?.token;
  if (!token) return new Response("Unauthorized", { status: 401 });

  const catalog = new RemoteBoardCatalog(token);
  const perRequestHandler = createMcpHandler(
    (server) => registerTools(server, catalog),
    { serverInfo: { name: "memoria-mcp-server", version: "0.1.0" } },
    { basePath: "/api" },
  );
  return perRequestHandler(request);
}

const authedHandler = withMcpAuth(mcpHandler, verifyToken, {
  required: true,
  requiredScopes: [DRIVE_FILE_SCOPE],
  // Guaranteed-reachable (not the bare well-known path — see _lib/metadata.ts).
  resourceMetadataPath: "/api/oauth/protected-resource",
});

async function handler(request: Request): Promise<Response> {
  if (!loadConfig()) return unconfiguredResponse();
  return authedHandler(request);
}

export { handler as GET, handler as POST, handler as DELETE };
