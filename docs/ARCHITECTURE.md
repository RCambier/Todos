# Architecture

Memoria: a kanban board whose only backend is a Google Sheet.

A kanban todo app whose only backend is a Google Sheet in the user's own Drive.
Two clients read and write that sheet: a static web app (the board UI) and a
hosted MCP connector (for agents — claude.ai routines, Claude Code, any MCP
client). Neither holds state; the sheet is the single source of truth.

```
                 ┌────────────────────┐
                 │   Google Sheet     │  ← single source of truth
                 │   (user's Drive)   │
                 └───────┬───▲────────┘
             Sheets API  │   │  Sheets API
        ┌────────────────┘   └───────────────┐
        │                                    │
┌───────▼────────┐                  ┌────────▼──────────┐
│  apps/web      │                  │  apps/web/api     │
│  static SPA    │                  │  hosted MCP       │
│  OAuth (user)  │                  │  OAuth (caller)   │
└───────┬────────┘                  └────────┬──────────┘
        │            ┌────────────┐          │ tools from
        └──────────► │ packages/  │ ◄────────┤ packages/mcp-server
                     │ sheet-core │          │ (transport-free)
                     └────────────┘
```

## Principles

1. **The sheet is the database.** Both clients are stateless; sync happens
   because everyone reads and writes the same sheet.
2. **No servers to speak of, no stored user credentials.** The web app is
   static files; the MCP connector is a stateless function that only ever
   holds the caller's token for the duration of one request. The deployment's
   own secrets are exactly three env vars (an OAuth client secret and a
   signing secret — deployment credentials, never user credentials), and a
   fork that skips them loses only the connector.
3. **Never destroy user data.** Writes are surgical (one task at a time,
   row located by ID at write time). A malformed sheet makes the app
   read-only with a precise error — it is never auto-"repaired".
4. **Reusable by anyone.** Fork, create your own free Google Cloud
   credentials, deploy. See `docs/SETUP.md`.

## Components

### `apps/web` — the board UI

React + TypeScript + Vite static SPA. No backend of any kind.

- **Auth**: two modes, picked automatically at boot by probing
  `POST /api/auth/session`.
  - **Persistent session** (default when the deployment sets the three
    `/api` env vars): sign-in is a top-level redirect through
    `/api/auth/start` → Google consent → `/api/auth/callback`, which
    exchanges the code server-side and seals the Google **refresh token**
    into an httpOnly, `Path=/api/auth` cookie (AES-256-GCM, same sealed-blob
    scheme as the MCP OAuth proxy; server stays stateless). Every later
    visit silently mints a fresh access token from the cookie via
    `/api/auth/session`; the app renews it shortly before expiry and when a
    hidden tab becomes visible again. No popups anywhere — this is what
    makes sign-in work on mobile. Sign-out clears the cookie only (revoking
    the grant entirely is left to myaccount.google.com).
  - **Popup fallback** (deployments without the `/api` env vars, where the
    probe answers 503): Google Identity Services token model from a click —
    browser-held, short-lived access token, in memory only, re-requested
    each visit. GIS's `prompt: "none"` "silent refresh" is deliberately not
    used: it opens a popup, and popups outside a user gesture are blocked.
  - Scopes in both modes: `https://www.googleapis.com/auth/drive.file` — the
    app can only access files it created or files the user explicitly picked
    — plus basic profile (name, photo, email) for the account menu; all
    non-sensitive. Sheets/Drive calls are plain `fetch` against the REST
    APIs with the browser-held access token.
- **First run** offers three paths that converge on a spreadsheet ID:
  1. _Found your existing board_ — the app lists files it has access to,
     filtered by `appProperties.todosBoard = "1"` (set at creation), and
     offers to reconnect. This is the multi-device path.
  2. _Create a board_ — creates the spreadsheet (tagged with the
     appProperty), writes the header row.
  3. _Use an existing sheet_ — Google Picker. Empty sheet → bootstrap
     headers; valid headers → attach; anything else → refuse with a clear
     message.
- The chosen spreadsheet ID is cached in `localStorage`.
- **Sync**: poll the sheet every 5 s while the tab is visible (pause when
  hidden, refresh immediately on focus). Mutations are optimistic: apply to
  local state, write to the sheet, reconcile on next poll. Last write wins.
- **Writes are row-targeted**: to mutate a task, re-locate its row by task
  `id` in the freshest read, then write exactly that row. Never write the
  whole grid. Appends go through the Sheets `append` API.
- **Malformed sheet**: if validation (from `sheet-core`) fails, show a
  banner naming the exact row/column/value, disable all mutations, keep
  polling — the board resumes automatically once the sheet is fixed.
- **Connect from agents panel**: shows the deployment's connector URL and
  ready-made instructions (claude.ai, Claude Code one-liner) — connecting an
  agent is copy-paste plus a Google consent screen, nothing more.
- **Build-time config** (public by design, via Vite env vars):
  `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` (Picker only).

### `packages/sheet-core` — shared schema and validation

Dependency-free TypeScript. The single definition of what a valid sheet is.
Used by both other packages. Exports:

- `Task` type and `Status` enum (`backlog` | `in_progress` | `done`).
- `HEADERS`, sheet/tab name constants.
- `parseSheet(rows) → { ok: true, tasks } | { ok: false, error }` where
  `error` pinpoints row, column, and offending value in a human sentence.
- `taskToRow(task)` / `rowToTask(row)` serialization.
- Ordering helpers (see _Ordering_ below).
- ID generation (crypto-random, URL-safe, e.g. 12-char base62).

### `packages/mcp-server` — the board tools

Node + TypeScript, transport-free: it defines the MCP tools and the two
interfaces they run against — `SheetStore` (one board's rows) and
`BoardCatalog` (which boards exist, and a `SheetStore` for any of them) —
and nothing else. The hosted connector (next section) mounts them over
Streamable HTTP; tests run them against in-memory fakes.

Every task tool takes an optional `board_id` (from `list_boards`), resolved
by one shared rule (`resolveBoard`): an explicit `board_id` wins and skips
board listing entirely; otherwise a lone board is used, no board is an
error telling the user to create one, and several boards is an error naming
them — never a silent guess. Accounts with a single board can omit
`board_id` everywhere.

Tools (all mutations take a task `id` from `list_tasks`; every write
re-locates the row by ID first, exactly like the web app):

| tool            | input                                                                       | behavior                       |
| --------------- | --------------------------------------------------------------------------- | ------------------------------ |
| `list_boards`   | —                                                                           | boards (id, name, modified)    |
| `list_tasks`    | optional `status` filter                                                    | tasks in board order           |
| `add_task`      | `title`, optional `notes`, `status` (default `backlog`), `due_date`, `tags` | insert at top of column        |
| `update_task`   | `id`, optional `title`, `notes`, `due_date`, `tags`                         | edit fields                    |
| `move_task`     | `id`, `status`                                                              | move to top of target column   |
| `complete_task` | `id`                                                                        | sugar for `move_task(done)`    |
| `delete_task`   | `id`                                                                        | delete that row                |

No bulk or whole-sheet tools — a confused agent can damage at most one row,
and Sheets version history covers recovery. Tasks created via MCP set
`source = "agent"` (see schema) so the UI can show provenance.

The package's single entrypoint exports `registerTools` and the
`SheetStore` / `BoardCatalog` contracts — no HTTP, no filesystem access, no
Google client.
Board logic stays testable and transport-agnostic; transports live with
their hosts.

### `apps/web/api` — hosted MCP connector + web sessions (optional)

Vercel Functions deployed alongside the static build, so any user of a
deployed instance can add `https://<deployment>/api/mcp` as a claude.ai
custom connector and get the same tools operating on **their** boards in
**their** Drive. The same functions also back the web app's persistent
sign-in (`/api/auth/*`, described under *apps/web* above). It is opt-in per
deployment: it activates only when three env vars are set (below); a fork
that skips them serves 503 on `/api/*` with a plain explanation — the
static app still works, with sign-in degrading to the per-visit popup.

The server is stateless in the same spirit as everything else: no database,
no session store, no stored user credentials. Auth is the MCP authorization
spec pattern with this deployment acting as an OAuth authorization server
that proxies Google:

- Dynamic Client Registration returns a `client_id` that _is_ the client's
  redirect URIs (base64url + HMAC tag), so `/authorize` can validate it
  without storage. Redirect URIs are allowlisted to exactly the claude.ai
  and claude.com MCP callbacks.
- `/api/oauth/authorize` validates the client and PKCE (S256 only), seals
  `{client redirect_uri, state, code_challenge, issued_at}` into an
  AES-256-GCM blob (key derived from `AUTH_SIGNING_SECRET`) passed as the
  `state` to Google, and redirects to Google's consent screen
  (`drive.file` scope, offline access).
- `/api/oauth/callback` verifies the blob (10-minute TTL), wraps Google's
  authorization code in a fresh sealed blob — _our_ authorization code —
  and redirects back to the client.
- `/api/oauth/token` opens that blob, verifies the PKCE verifier
  (constant-time), exchanges the embedded Google code using our client
  credentials, and returns Google's tokens as our own. Refresh grants are
  proxied straight through.
- Every `/api/mcp` request is authenticated by validating the caller's
  bearer token against Google's tokeninfo endpoint (scope + audience
  checked); the caller's boards are listed per request from Drive (tagged
  spreadsheets, at most one listing per request) and each tool call
  targets its `board_id` — or the account's only board when omitted. All
  Sheets/Drive calls use the caller's own token — the deployment can never
  touch a board without the caller's live Google credential in hand.

Env vars (all three required to activate, set in Vercel project settings):
`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (a second,
"Web application"-type OAuth client in the same GCP project) and
`AUTH_SIGNING_SECRET` (32+ random hex bytes for the AEAD keys). These are
the only server-side secrets in the whole project, and they are deployment
credentials, not user credentials.

## The sheet schema

One tab named `Tasks`. Row 1 is the header, frozen. Columns:

| column       | type            | notes                                                                |
| ------------ | --------------- | -------------------------------------------------------------------- |
| `id`         | string          | stable random ID, never reused                                       |
| `title`      | string          | required, non-empty                                                  |
| `status`     | enum            | `backlog` \| `in_progress` \| `done`                                 |
| `sort_order` | number          | ascending within a column = top→bottom                               |
| `notes`      | string          | optional                                                             |
| `source`     | string          | `user` or `agent`; informational only                                |
| `created_at` | ISO 8601 string | set once                                                             |
| `updated_at` | ISO 8601 string | set on every mutation                                                |
| `due_date`   | string          | `YYYY-MM-DD` or empty; optional                                      |
| `tags`       | string          | comma-separated labels; optional (so tag names can't contain commas) |

Validation rules (enforced identically by both clients via `sheet-core`):
header row must match exactly; `id`, `title`, `status` required;
`status` must be in the enum; `sort_order` must be numeric; `due_date`, if
present, must be `YYYY-MM-DD`. Empty rows are ignored. Anything else →
precise validation error.

**Schema evolution**: `due_date` and `tags` were added after the original
8-column schema. A sheet with the old header still validates (its tasks
just have empty due dates and tags), and the web app extends the header row
in place the first time it loads such a board — an additive write of two
header cells that never touches task rows. This keeps existing boards
working without a migration step.

**Ordering**: `sort_order` is a float. Insert at top = `min(column) − 1`
(or `0` for an empty column). Drop between two cards = midpoint. No global
renumbering — keeps every reorder a one-row write. (Float exhaustion needs
~50 consecutive midpoint inserts in the same gap to matter; accept the
theoretical limit rather than engineer around it.)

**Conflicts**: single-user tool; last write wins, the sheet wins over any
client's memory. Because writes re-locate rows by ID and touch one row,
the realistic worst case for a simultaneous edit is one field reverting —
acceptable, and version history exists.

## What we deliberately did not build

- **No push/webhook sync** — Drive push notifications need a hosted HTTPS
  endpoint; polling is free, simple, and plenty for a todo board.
- **No database or server-side session store** — the web session is a
  refresh token sealed into the user's own cookie; the functions stay
  stateless and store nothing.
- **No broad OAuth scopes** — `drive.file` plus basic profile only; the app
  cannot see the rest of the user's Drive, which is the right trust posture
  for a public reusable project.
- **No offline queue / CRDTs / realtime collab** — single user,
  last-write-wins.

## Repo layout & tooling

```
apps/web              React + TS + Vite SPA (@hello-pangea/dnd for drag & drop)
apps/web/api          optional hosted MCP connector (Vercel Functions, mcp-handler)
packages/sheet-core   shared schema/validation (no runtime deps)
packages/mcp-server   the MCP board tools, transport-free (@modelcontextprotocol/sdk)
docs/                 this file, SETUP.md, design/
```

npm workspaces (no extra workspace tooling). Vitest for tests —
`sheet-core` is tested exhaustively (it guards user data); the other
packages get focused tests where logic warrants. GitHub Actions CI:
typecheck, lint, test, build. Vercel deploys `apps/web` from `main`.

## Design

See `docs/design/mockup.html` (open in a browser) — Notion-inspired: system
font stack, hairline structure, muted status tints, color only where it
carries meaning (status, sync health, warnings). Light and dark themes. The
mockup is the visual spec: match its tokens, spacing, and states, including
the drag state, inline top-of-column composer, agent provenance chip,
malformed-sheet banner, and the one-column mobile layout.
