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
  - Optional, opt-in (Settings): the **Google Tasks calendar mirror** adds
    the sensitive `auth/tasks` scope via incremental re-consent
    (`/api/auth/start?scope=tasks`, `include_granted_scopes`) — only users
    who flip the toggle ever see that consent screen.
  - Base scopes in both modes: `https://www.googleapis.com/auth/drive.file` — the
    app can only access files it created or files the user explicitly picked
    — plus basic profile (name, photo, email) for the account menu; all
    non-sensitive. Sheets/Drive calls are plain `fetch` against the REST
    APIs with the browser-held access token.
- **The app manages exactly three sheets** — one Todos board, one Notes
  grid, and one AI Memories grid — surfaced as three fixed tabs (visible on
  desktop and mobile; the tabs are the whole navigation, there is no
  separate "sheets" screen — design 9b). `lib/slots.ts` folds the Drive
  listing into one *slot* per kind: the connected sheet plus any extras.
  - A kind **with** a connected sheet shows its board/notes/memories view.
  - A kind **without** one shows its setup inline in the tab's content
    area (`components/KindEmpty.tsx`): _create_ (new spreadsheet, tagged,
    header row written, filed under `Memoria/…`), _link an existing sheet_
    (Google Picker: an empty sheet gets the kind's tab + headers
    bootstrapped; valid rows of that kind attach as-is; anything else is
    refused with a clear message), or _connect_ one of the extras. Filling
    it in place makes the tab spring to life.
  - Drive may still hold several tagged sheets of a kind (older versions
    allowed it) — the newest is connected, the rest are the slot's extras,
    offered by the empty state.
- The connected sheet id per kind (and the active view) is cached in
  `localStorage`; old single-sheet caches seed the matching slot.
- **Sync — local-first**: the UI renders a *projection*: the last known
  server state (the **replica**, persisted per board in `localStorage`)
  with the queue of pending local mutations (the **outbox**, also
  persisted) applied on top (`sheet-core`'s `applyPending`). Mutations are
  instant and never await the network; a reload paints the board from the
  replica before any request; offline just means the outbox grows. A
  single-flight flusher drains ops in order through the sheet-core board
  operations, dropping ops whose target vanished remotely (the sheet wins).
  An `add` is replay-safe against the *source of truth*, not the local
  replica: `appendTaskIfAbsent`/`appendNoteIfAbsent` re-read the sheet and
  skip the write if the client-generated id already landed — so an append
  whose response was lost cannot be written twice (no duplicate-id malformed
  sheet). Polls (every 5 s while visible, plus focus/online) update only
  the replica; a poll that raced a confirmed write is discarded and
  re-fetched, so the projection never regresses. Last write wins.
- **Writes are row-targeted**: to mutate a task, re-locate its row by task
  `id` in the freshest read, then write exactly that row. Never write the
  whole grid. Appends go through the Sheets `append` API.
- **Malformed sheet**: if validation (from `sheet-core`) fails, show a
  banner naming the exact row/column/value, disable all mutations, keep
  polling — the board resumes automatically once the sheet is fixed.
- **Google Tasks calendar mirror** (opt-in, one-way): tasks that have a date
  — a due date, or a `blockedUntil` that is a date rather than an event —
  are mirrored into a "Memoria" Google Tasks list, which Google Calendar
  shows on that date (Google Tasks are date-only). The board is the
  source of truth — the mirror is entirely *derivable*: each mirrored task
  carries a `[memoria:<boardId>/<taskId>]` marker in its notes as the only
  join key, and sync is a pure reconcile (`calendar/mirrorDiff.ts`): diff
  board tasks against marked Google Tasks, then create / patch / complete /
  delete. No sync state is stored anywhere; hand-made Google Tasks and other
  boards' mirrors are never touched; done tasks complete their mirror but
  never create one. Runs from the board loop (immediately on change,
  periodically for drift), silent on failure — the board never depends on
  it.
- **Connect from agents panel**: shows the deployment's connector URL and
  ready-made instructions (claude.ai, Claude Code one-liner) — connecting an
  agent is copy-paste plus a Google consent screen, nothing more.
- **Build-time config** (public by design, via Vite env vars):
  `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` (Picker only).

### `packages/sheet-core` — schema, validation, and the board operations

Dependency-free TypeScript. The single definition of what a valid sheet is
**and of the safe mutations on it**. Used by both other packages. Exports:

- `Task` type; `Status` is an open string — **a task's status is a column
  id**, and columns are customizable per board (see below), so a status is
  valid as long as it's non-empty. A task pointing at a deleted column is
  still valid data (the board folds it into a synthesized column); the model
  never rejects it.
- `BoardColumn` type and the columns model (`columns.ts`): each board's
  columns live in a `Columns` tab (`id, label, sort_order, done, blocked,
  hidden`). Roles are optional per-column flags — `done` (the ✓ / agents'
  `complete_task` land here, and the calendar mirror treats it as finished),
  `blocked` (a task gaining a blocked-until date auto-moves here), and
  `hidden` (folded away behind the board's right-edge rail). `DEFAULT_NEW_COLUMNS`
  (Backlog / In progress / Done) seeds brand-new boards; `LEGACY_COLUMNS`
  (the historical six) is the migration target for boards created before
  customization — so an existing board keeps exactly the columns it always
  showed. `parseColumnsSheet` is deliberately lenient (settings, not task
  data): a malformed row is skipped, never fatal.
- `HEADERS`, sheet/tab name constants.
- `parseSheet(rows) → { ok: true, tasks } | { ok: false, error }` where
  `error` pinpoints row, column, and offending value in a human sentence.
- `taskToRow(task)` / `rowToTask(row)` serialization.
- Ordering helpers (see _Ordering_ below).
- ID generation (crypto-random, URL-safe, e.g. 12-char base62).
- `SheetStore` — the four-method interface (read/append/update/delete rows)
  a sheet backend must satisfy, transport-free. One HTTP adapter
  (`apps/web/src/api/sheetStore.ts`) serves both the web app and the hosted
  connector; tests use an in-memory fake.
- The board operations (`listTasks`, `addTask`, `updateTask`, `moveTask`,
  `completeTask`, `deleteTask`, `fetchBoard`) — the ONE implementation of
  the write-safety invariant both clients rely on: every mutation does a
  fresh read, validates it, re-locates its row by task id, and touches
  exactly that row. The web app and the MCP tools call these same
  functions, differing only in the `SheetStore` adapter and the `source`
  stamped on new tasks.

### `packages/mcp-server` — the board and notes tools

Node + TypeScript, transport-free: it wraps the sheet-core board and note
operations as MCP tools and defines the catalog contracts (`BoardCatalog` +
`NotesCatalog`, together `MemoriaCatalog`: which collections exist, and a
`SheetStore` for any of them) — and nothing else. The hosted connector
(next section) mounts the tools over Streamable HTTP; tests run them
against in-memory fakes.

Every task tool takes an optional `board_id` (from `list_boards`), and
every note tool an optional `notes_id` (from `list_note_collections`),
resolved by one shared rule (`resolveBoard` / `resolveNotes`): an explicit
id wins and skips listing entirely; otherwise a lone collection of that
kind is used, none is an error telling the user to create one, and several
is an error naming them — never a silent guess. Accounts with a single
board (or notes collection) can omit the id everywhere.

Tools (all mutations take an `id` from the matching list tool; every write
re-locates the row by ID first, exactly like the web app):

| tool                    | input                                                                                        | behavior                     |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| `list_boards`           | —                                                                                            | boards (id, name, modified) + each board's columns |
| `list_tasks`            | optional `status` filter (a column id)                                                       | tasks in board order         |
| `add_task`              | `title`, optional `notes`, `status` (a column id; default = board's first column), `due_date`, `blocked_until`, `tags` | insert at top of column |
| `update_task`           | `id`, optional `title`, `notes`, `due_date`, `blocked_until`, `tags`                         | edit fields                  |
| `move_task`             | `id`, `status` (a column id, validated against the board)                                    | move to top of target column |
| `complete_task`         | `id`                                                                                         | move to the board's `done`-role column |
| `delete_task`           | `id`                                                                                         | delete that row              |
| `list_note_collections` | —                                                                                            | notes collections            |
| `list_notes`            | —                                                                                            | notes, newest-edited first   |
| `add_note`              | `title`, optional markdown `body`                                                            | append a note                |
| `update_note`           | `id`, optional `title`, `body` (replaces whole body)                                         | edit fields                  |
| `delete_note`           | `id`                                                                                         | delete that row              |
| `list_memory_collections` | —                                                                                          | AI Memories collections      |
| `list_memories`         | —                                                                                            | memories, newest-edited first |
| `add_memory`            | `title`, optional markdown `body`, `tags`, `expires_at`                                      | append a memory              |
| `update_memory`         | `id`, optional `title`, `body`, `tags`, `expires_at` (each replaces the whole field)         | edit fields                  |
| `delete_memory`         | `id`                                                                                         | delete that row              |

**Tool naming convention** (every future collection kind follows it): for a
kind with singular `<x>` / plural `<xs>` — `list_<x>_collections`,
`list_<xs>`, `add_<x>`, `update_<x>`, `delete_<x>`, with `<xs>_id` as the
optional collection parameter and `id` as the item parameter on mutations.
The board tools predate the multi-kind model and keep their historical names
as the one documented exception (`list_boards`, `board_id`, plus the
board-specific verbs `move_task`/`complete_task`) — renaming them would
break every connected agent for zero behavioral gain.

No bulk or whole-sheet tools — a confused agent can damage at most one row,
and Sheets version history covers recovery. Tasks, notes, and memories
created via MCP set `source = "agent"` (see schema) so the UI can show
provenance.

The package's single entrypoint exports `registerTools` and the
`SheetStore` / catalog contracts — no HTTP, no filesystem access, no
Google client.
Collection logic stays testable and transport-agnostic; transports live
with their hosts.

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
  checked); the caller's collections are listed per request from Drive
  (one tagged-spreadsheet listing at most, split into boards and notes
  collections by their `appProperties`) and each tool call targets its
  `board_id` / `notes_id` — or the account's only collection of that kind
  when omitted. All Sheets/Drive calls use the caller's own token — the
  deployment can never touch a sheet without the caller's live Google
  credential in hand.

Env vars (all three required to activate, set in Vercel project settings):
`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (a second,
"Web application"-type OAuth client in the same GCP project) and
`AUTH_SIGNING_SECRET` (32+ random hex bytes for the AEAD keys). These are
the only server-side secrets in the whole project, and they are deployment
credentials, not user credentials.

## Notes — the second collection kind

Since 2026-07, a tagged spreadsheet is a **collection** of one of several
kinds: a **board** (the kanban above), a **notes** grid (design 5a/5b: a
Keep-style masonry of small markdown notes, same shell, second tab), or an
**AI Memories** grid (below). The kind only changes the view — all are
plain sheets in the user's Drive, and the app connects exactly one of each
(see *First run* above).

- **Tagging**: boards keep `appProperties.todosBoard = "1"`; notes sheets
  are tagged `memoriaNotes = "1"` instead. The keys are deliberately
  different so the kinds can never be confused: everything lists through
  one Drive query (`findCollections`) that reads the tags back, the web
  app's tabs/shelf show every kind, and the hosted MCP connector splits
  the same listing so the board tools can never open a notes sheet (and
  vice versa).
- **Agent access**: the connector exposes notes to agents through their own
  tools (`list_note_collections`, `list_notes`, `add_note`, `update_note`,
  `delete_note` — see the mcp-server section); agent-written notes land
  with `source = "agent"`.
- **Schema**: one tab named `Notes`, header `id, title, body, source,
  created_at, updated_at`. `body` is markdown; `title` and `body` may be
  empty. Same validation posture as the board: precise errors, read-only on
  a malformed sheet, one row per mutation, rows re-located by id at write
  time (`sheet-core`'s `notes.ts` — the notes twin of `board.ts`).
- **Sync**: the notes view is local-first with the same replica + outbox
  scheme as the board (`notes/useNotes.ts`), minus what notes don't have
  (no columns, no ordering writes). The grid orders by `updated_at` desc.
- **Markdown**: a deliberately small dialect (`lib/markdown.ts`) — headings,
  lists with checkboxes, quotes, fenced code, bold/italic/code spans,
  http(s) links, images. It parses to a typed AST rendered as React
  elements, never HTML strings: raw HTML in a note renders as text, so
  agent-written notes have nothing to inject and there is no sanitizer.
- **Attachments**: any file pasted, dropped, or picked (📎, also the
  mobile path) on a note or a task uploads to
  `Memoria/notes/attachments/` / `Memoria/todos/attachments/` in the
  user's Drive (multipart, `drive.file` scope). Note **images** embed as
  `![name](drive:<fileId>)` and render inline through **Drive's own CDN
  thumbnails** (`files.get?fields=thumbnailLink`, size rewritten to the
  display size — 112px card tiles, 1600px in the open note; ladder falls
  back to a fresh link, then a full authed download). Any **other file**
  becomes a `[📎 name](drive.google.com/…)` markdown link on a note, or a
  `📎 name — url` description line on a task (plain text — clickable via
  Linkify and from the sheet itself). Large images (>1.5 MB) are
  downscaled in the browser first (WebP, ≤2048px); other files are
  refused above ~5 MB (the multipart ceiling). Attachments are ordinary
  Drive files the user owns.
- **Provenance**: `source` is `user` or `agent`, informational only.
  Agent-written notes render with a warm paper tint and an ✳ chip; the
  toolbar chips filter all / by you / by agents.

## AI Memories — the third collection kind

An **AI Memories** collection stores the facts and memories an AI gathers
about its user over time — preferences, people, context, decisions. It is
deliberately the notes grid's twin: free-text markdown entries with
attachments, plus **tags** to categorize (`family`, `preferences`,
`work`, …).

- **Tagging**: memories sheets carry `appProperties.memoriaMemories = "1"`
  — a third key, so no client ever mistakes a memories sheet for a notes
  sheet or a board.
  The structure borrows deliberately from the two mainstream AI memory
  systems: ChatGPT-style **atomic dated facts** (one row per fact,
  `created_at`/`updated_at` timestamps) and Claude-style **themed sections**
  (tags with a suggested shared vocabulary: `profile`, `preferences`,
  `work`, `projects`, `relationships`, `health`, `context`) — plus one thing
  neither has explicitly: an **expiry date** for time-bound facts.
- **Agent access**: their own connector tools (`list_memory_collections`,
  `list_memories`, `add_memory`, `update_memory`, `delete_memory`), with
  `tags` and `expires_at` on add/update; the `list_memories` description
  nudges agents to update an existing entry when a fact changes rather than
  record it twice, and to treat lapsed `expires_at` entries as stale.
  Agent-written memories land with `source = "agent"`.
- **Schema**: one tab named `Memories`, header `id, title, body, tags,
  source, created_at, updated_at, expires_at`. `body` is markdown; `tags`
  is comma-separated like task tags; `expires_at` is `YYYY-MM-DD` or empty
  — the date after which the fact no longer holds ("in SF until Aug 2").
  Expired memories are flagged, never hidden: the grid fades them and the
  tools call them out, but cleaning up stays a deliberate act
  (`sheet-core`'s `memories.ts`, `isMemoryExpired`).
- **View & sync**: the third tab reuses the notes grid and editor (tag
  chips on cards, a tag editor in the dialog — the same `TagsEditor` the
  board uses) and the same local-first replica + outbox scheme
  (`memories/useMemories.ts`). Attachments upload to
  `Memoria/memories/attachments/`.
- **Written by agents, curated by the user**: the web view deliberately has
  no capture bar or "+" for memories — a memory is something an agent
  learned, so agents (the MCP tools) are the only writers. The tab is the
  human's window and control panel: read, fix tags/expiry, edit a wrong
  fact, delete. (`useMemories` exposes no `addMemory`; it still drains
  pending "add" ops from an older client's outbox.)

### Drive layout

The app files its spreadsheets under one folder tree in My Drive, one
folder per sheet kind:

```
Memoria/
  todos/             the Todos sheet
  notes/             the Notes sheet
    attachments/     images pasted into notes
  memories/          the AI Memories sheet
    attachments/     images pasted into memories
```

New sheets are created there; on boot the web app quietly moves any tagged
sheet that lives elsewhere into place (`api/folders.ts`, best-effort,
memoized per browser, file contents never touched). An earlier layout named
the todos folder `boards/` — when found, it's renamed to `todos/` in place
(same folder id, contents follow for free). Sheets the user attached via
the Picker are left where the user keeps them.

## The sheet schema

One tab named `Tasks`. Row 1 is the header, frozen. Columns:

| column       | type            | notes                                                                |
| ------------ | --------------- | -------------------------------------------------------------------- |
| `id`         | string          | stable random ID, never reused                                       |
| `title`      | string          | required, non-empty                                                  |
| `status`     | string          | a **column id** — customizable per board (see _Board columns_ below); required, non-empty |
| `sort_order` | number          | ascending within a column = top→bottom                               |
| `notes`      | string          | optional                                                             |
| `source`     | string          | `user` or `agent`; informational only                                |
| `created_at` | ISO 8601 string | set once                                                             |
| `updated_at` | ISO 8601 string | set on every mutation                                                |
| `due_date`   | string          | `YYYY-MM-DD` or empty; optional                                      |
| `tags`       | string          | comma-separated labels; optional (so tag names can't contain commas) |
| `blocked_until` | string       | `YYYY-MM-DD` **or** free-text event (e.g. `Trip done`); empty = not blocked |
| `recurs`     | enum            | `yearly` or empty. Completing a yearly task advances its date one year (into the future) and leaves it in its column, instead of finishing it |

Validation rules (enforced identically by both clients via `sheet-core`):
header row must match exactly; `id`, `title`, `status` required;
`status` must be non-empty (any column id — see _Board columns_);
`sort_order` must be numeric; `due_date`, if
present, must be `YYYY-MM-DD`. `blocked_until` is free-form by design — a
value matching `YYYY-MM-DD` is treated as a date (the block lifts that
day), anything else as an event the user clears by hand. Empty rows are
ignored. Anything else → precise validation error.

**Due vs. blocked**: a task has *either* a due date *or* a blocked-until,
never both — one scheduling slot. `mergeSchedule` in `sheet-core` is the
single implementation of that rule (setting one non-empty clears the
other), shared by the board operations and the web app's projection.

**Schema evolution**: `due_date`/`tags` (columns I–J) and then
`blocked_until` (column K) were added after the original 8-column schema.
A sheet with either older header still validates (its tasks just have the
new fields empty), and the web app extends the header row in place the
first time it loads such a board — an additive write of the new header
cells that never touches task rows. This keeps existing boards working
without a migration step.

**Board columns**: a Todos sheet also has a `Columns` tab defining its
columns (customizable per board). Header `id, label, sort_order, done,
blocked, hidden`, one row per column. `done` / `blocked` / `hidden` are role
flags (`"1"` / empty); `done` and `blocked` are single per board (first row
claiming each wins on parse). A board with **no** `Columns` tab (every board
created before this feature) is migrated in place on first web-app load to
`LEGACY_COLUMNS` — the historical six — so nothing about an existing board
changes; brand-new boards are created with `DEFAULT_NEW_COLUMNS` (Backlog /
In progress / Done). The hosted MCP connector *reads* columns (reporting the
legacy set for an un-migrated board) but never writes them. Reads/parses via
`parseColumnsSheet`, which is lenient — the columns config is settings, not
task data, so a bad row is skipped rather than making the board read-only.
The behaviors bound to roles: the card ✓ and `complete_task` move a task to
the `done` column; giving a task a blocked-until date auto-moves it to the
`blocked` column (and clearing it releases the task); `hidden` columns fold
away behind the board's right-edge rail. With a role unset, its behavior
simply doesn't fire. Column edits (rename / reorder / add / remove / roles)
happen in the web app's settings and are a whole-tab overwrite — the only
place the app writes a whole grid, justified because reordering inherently
rewrites the small config tab; task rows are still only ever touched one at
a time.

**Ordering**: `sort_order` is a float. Insert at top = `min(column) − 1`
(or `0` for an empty column). Drop between two cards = midpoint. No global
renumbering — keeps every reorder a one-row write. (Float exhaustion needs
~50 consecutive midpoint inserts in the same gap to matter; accept the
theoretical limit rather than engineer around it.)

**Sheets limits**: Google caps a cell at 50,000 characters — the practical
ceiling on a note body or task description. The limit is enforced before
anything is written or queued (`sheet-core`'s `MAX_CELL_CHARS`, checked in
the build/update operations and mirrored as zod caps on the MCP tools and
`maxLength` on the web inputs), so an oversized value fails with a precise
error instead of a permanently-rejected write. Should a rejected write ever
end up queued anyway (an older client), the sync banner names Google's
rejection rather than mislabeling it "offline" — the queue is never
silently wedged. Every write uses `valueInputOption=RAW`, so cell content
is always literal text — a title like `=SUM(A:A)` is never interpreted as
a formula. The 10-million-cell spreadsheet ceiling is orders of magnitude
beyond any plausible board.

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
- **No CRDTs / realtime collab** — single user, last-write-wins; the
  replica + outbox scheme (see *Sync*) covers offline and instant edits
  without them.

## Repo layout & tooling

```
apps/web              React + TS + Vite SPA (@hello-pangea/dnd for drag & drop)
apps/web/api          optional hosted MCP connector (Vercel Functions, mcp-handler)
packages/sheet-core   schema/validation + SheetStore + board ops (no runtime deps)
packages/mcp-server   the MCP tool wrappers, transport-free (@modelcontextprotocol/sdk)
docs/                 this file, SETUP.md, design/
```

npm workspaces (no extra workspace tooling). Vitest for tests —
`sheet-core` is tested exhaustively (it guards user data); the other
packages get focused tests where logic warrants. GitHub Actions CI:
typecheck, lint, test, build. Vercel deploys `apps/web` from `main`.

For UI changes, `apps/web/verify.html` is a committed dev-only harness: it
mounts the real App with every network call stubbed (auth session, Drive
listing, Sheets grid), so the full signed-in flow can be driven end-to-end
in a browser without Google. Vite serves it in dev; the production build
ignores it.

## Design

See `docs/design/mockup.html` (open in a browser) — Notion-inspired: system
font stack, hairline structure, muted status tints, color only where it
carries meaning (status, sync health, warnings). Light and dark themes. The
mockup is the visual spec: match its tokens, spacing, and states, including
the drag state, inline top-of-column composer, agent provenance chip,
malformed-sheet banner, and the one-column mobile layout.
