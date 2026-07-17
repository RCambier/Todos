# Todos

A kanban todo board whose only backend is a Google Sheet in your own Drive.
Two clients read and write that sheet: a static web app (the board UI) and
an MCP server (for coding agents like Claude Code or Codex). Neither holds
state — the sheet is the single source of truth, so your board, your agents,
and Google Sheets itself are always looking at the same data.

> _Screenshot coming soon — for the visual spec in the meantime, open
> `docs/design/mockup.html` in a browser._

No servers, no database, no hosted secrets. The web app is static files
deployed to Vercel; the only credentials involved are your own (Google
sign-in in the browser, a service-account key on your machine for agents).

See `docs/ARCHITECTURE.md` for the full design and `docs/design/mockup.html`
for the visual spec.

## Quickstart

Setting up your own instance (your own Google Cloud credentials, your own
Vercel deploy) takes about 15 minutes — follow **[docs/SETUP.md](docs/SETUP.md)**.

For local development once you have credentials:

```bash
git clone <this repo>
cd Todos
npm install
cp apps/web/.env.example apps/web/.env   # fill in your client ID / API key
npm run dev --workspace=@todos/web
```

## Monorepo map

```
apps/web              React + TypeScript + Vite SPA — the board UI
packages/sheet-core    Shared schema, validation, and ordering logic (no runtime deps)
packages/mcp-server    MCP stdio server for coding agents (Claude Code, Codex, ...)
docs/                  Architecture, setup guide, design mockup
```

- **`packages/sheet-core`** is the single definition of what a valid Todos
  sheet is — both other packages depend on it. It's tested exhaustively
  since it's the thing standing between a typo and your data.
- **`apps/web`** talks to Google Sheets/Drive directly via `fetch` using an
  OAuth token scoped to `drive.file` (it can only see files it created or
  you explicitly picked).
- **`packages/mcp-server`** exposes six tools (`list_tasks`, `add_task`,
  `update_task`, `move_task`, `complete_task`, `delete_task`) over stdio,
  authenticated as a service account you share your sheet with.

## Scripts (from the repo root)

```bash
npm run typecheck   # tsc --noEmit across all workspaces
npm run lint         # eslint .
npm run test          # vitest run across all workspaces
npm run build         # build every workspace (sheet-core first)
```

## License

MIT
