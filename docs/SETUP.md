# Setup

A walkthrough for forking this repo and running your own instance: your own
Google Cloud credentials, your own Vercel deploy, your own service account
for agents. Nothing in this repo talks to any server but Google's and yours.
Should take about 15 minutes.

## 1. Create a Google Cloud project (2 min)

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and
   create a new project (top-left project picker → **New Project**).
2. Once created, make sure it's selected in the project picker for the rest
   of these steps.

## 2. Enable the APIs (1 min)

In **APIs & Services → Library**, enable each of these for your project:

- **Google Sheets API**
- **Google Drive API**
- **Google Picker API**

## 3. Configure the OAuth consent screen (2 min)

In **APIs & Services → OAuth consent screen**:

1. Choose **External** (unless you're on Google Workspace and only need
   internal access) and fill in the required fields (app name, your email).
2. Scopes: you don't need to add anything here — the app requests
   `drive.file` at runtime, which doesn't require verification.
3. Test users: while the app is in **Testing** mode, add your own Google
   account (and anyone else who'll use this board) under **Test users**.
   This avoids Google's app-verification review, which is unnecessary for a
   personal tool.

## 4. Create an OAuth client ID (2 min)

In **APIs & Services → Credentials → Create Credentials → OAuth client ID**:

1. Application type: **Web application**.
2. **Authorized JavaScript origins**: add `http://localhost:5173` (the Vite
   dev server) now. You'll come back and add your Vercel URL after step 7.
3. Save, then copy the **Client ID** — this is your `VITE_GOOGLE_CLIENT_ID`.

## 5. Create an API key (1 min)

In the same **Credentials** page → **Create Credentials → API key**.

1. Copy the key — this is your `VITE_GOOGLE_API_KEY`.
2. Click **Restrict key** and limit it to the **Google Picker API**, so it's
   useless for anything else if it ever leaks (it's shipped in the public
   bundle by design — see `docs/ARCHITECTURE.md`).

## 6. Run it locally (2 min)

```bash
git clone <your fork>
cd Todos
npm install
cp apps/web/.env.example apps/web/.env
```

Fill in `apps/web/.env`:

```
VITE_GOOGLE_CLIENT_ID=<from step 4>
VITE_GOOGLE_API_KEY=<from step 5>
```

```bash
npm run dev --workspace=@todos/web
```

Open `http://localhost:5173`, connect your Google account, and create a
board. It's just a spreadsheet — open it from the topbar link to see it.

## 7. Deploy to Vercel (3 min)

1. [Import the repo](https://vercel.com/new) into Vercel.
2. Set **Root Directory** to `apps/web` (Vercel auto-detects the Vite
   framework preset and runs the monorepo's `npm install` first).
3. Add the same two environment variables from step 6
   (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`) in the Vercel project
   settings.
4. Deploy. Copy the resulting URL (e.g. `https://your-app.vercel.app`).
5. Back in **Google Cloud → Credentials → your OAuth client**, add that URL
   to **Authorized JavaScript origins** and save.

`apps/web/vercel.json` already handles the SPA fallback (all routes serve
`index.html`), so client-side routing (if any is added later) won't 404 on
refresh.

## 8. Connect an agent (service account) (3 min)

This lets Claude Code, Codex, or any MCP-speaking agent read and write your
board directly.

1. In Google Cloud → **IAM & Admin → Service Accounts → Create Service
   Account**. Name it anything (e.g. `todos-agent`). No project roles are
   needed — access is granted by sharing the sheet, not IAM.
2. Open the new service account → **Keys → Add Key → Create new key →
   JSON**. Save the downloaded file somewhere _outside_ this repo, e.g.
   `~/.config/todos/service-account.json`. Never commit it.
3. Copy the service account's email address (looks like
   `todos-agent@your-project.iam.gserviceaccount.com`).
4. In the running web app, open **Settings**, paste that email under
   **Connect an agent**, and click **Share**. This grants the service
   account writer access to just this one spreadsheet (no notification
   email is sent — service accounts don't read inboxes).
5. The Settings panel also shows your spreadsheet ID and a ready-made MCP
   config snippet — copy it for the next step.

## 9. Build and configure the MCP server

The server isn't published to npm — it's meant to be built once from your
clone and run with `node` from there:

```bash
npm run build --workspace=@todos/mcp-server
```

This produces `packages/mcp-server/dist/index.js`. You need three things
wherever your MCP client runs it:

- the absolute path to that `dist/index.js`,
- `TODOS_SPREADSHEET_ID` — from the Settings panel (it also generates this
  whole snippet for you, pre-filled),
- `GOOGLE_APPLICATION_CREDENTIALS` — absolute path to the JSON key from
  step 8.2.

### Claude Code

Add to your project's `.mcp.json` (or run `claude mcp add`):

```json
{
  "mcpServers": {
    "todos": {
      "command": "node",
      "args": ["/absolute/path/to/Todos/packages/mcp-server/dist/index.js"],
      "env": {
        "TODOS_SPREADSHEET_ID": "<your spreadsheet id>",
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/service-account.json"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.todos]
command = "node"
args = ["/absolute/path/to/Todos/packages/mcp-server/dist/index.js"]
env = { TODOS_SPREADSHEET_ID = "<your spreadsheet id>", GOOGLE_APPLICATION_CREDENTIALS = "/absolute/path/to/service-account.json" }
```

Restart your agent, then ask it to list, add, or move tasks — it's using
the same six tools described in `docs/ARCHITECTURE.md`.

## Troubleshooting

- **"redirect_uri_mismatch" or sign-in fails** — double check the exact
  origin (scheme + host + port, no trailing slash) is listed under
  Authorized JavaScript origins for your OAuth client.
- **Picker doesn't open** — confirm the API key is unrestricted-enough to
  call the Picker API (step 5), and that you're signed in.
- **MCP server exits immediately with a config error** — it prints exactly
  what's missing (env var name, or a bad/missing key file path) to stderr.
- **"Sheet doesn't match the expected format"** — someone hand-edited the
  sheet in a way `sheet-core` can't parse. The banner names the exact row,
  column, and value; fix it in Google Sheets and the board resumes on the
  next sync (every 5s while the tab is visible).
