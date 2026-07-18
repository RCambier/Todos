# Setup

A walkthrough for forking this repo and running your own instance: your own
Google Cloud credentials, your own Vercel deploy. Nothing in this repo talks
to any server but Google's and yours. Should take about 15 minutes,
including the MCP connector for your agents.

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
   `drive.file` plus basic profile info at runtime, all non-sensitive
   scopes that don't require verification.
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
cd Memoria
npm install
cp apps/web/.env.example apps/web/.env
```

Fill in `apps/web/.env`:

```
VITE_GOOGLE_CLIENT_ID=<from step 4>
VITE_GOOGLE_API_KEY=<from step 5>
```

```bash
npm run dev --workspace=@memoria/web
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

## 8. Enable the MCP connector and persistent sign-in (5 min)

This one section powers two things:

- **Agents**: your deployment serves a standard remote MCP server at
  `/api/mcp` — the board tools, authenticated per-request with each
  user's own Google account (no credentials stored anywhere, no
  per-machine install). It works from claude.ai (including scheduled/cloud
  routines), Claude Code, and any MCP client speaking Streamable HTTP with
  OAuth.
- **Staying signed in**: the web app uses the same backend to keep users
  signed in across visits (a refresh token sealed into an httpOnly cookie
  — the server still stores nothing). Skip this section and the board
  still works, but sign-in falls back to a Google popup on every visit
  (and popups are unreliable on mobile); everything else under `/api/*`
  just answers 503.

1. In **Google Cloud → Credentials → Create Credentials → OAuth client
   ID**, create a **second** client, also type **Web application**. Under
   **Authorized redirect URIs** (not JavaScript origins this time), add
   exactly these two:

   ```
   https://<your-deployment>/api/oauth/callback
   https://<your-deployment>/api/auth/callback
   ```

   e.g. `https://your-app.vercel.app/api/oauth/callback` and
   `https://your-app.vercel.app/api/auth/callback` (the first serves MCP
   clients, the second the web app's own sign-in). Save, and copy the
   client ID **and** client secret.

2. In your Vercel project settings, add three environment variables:
   - `GOOGLE_OAUTH_CLIENT_ID` — from the client you just created,
   - `GOOGLE_OAUTH_CLIENT_SECRET` — same place (this one is a real secret;
     it never leaves Vercel),
   - `AUTH_SIGNING_SECRET` — 32+ random bytes as hex, e.g. the output of
     `openssl rand -hex 32`.

3. Redeploy so the functions pick up the env vars.

## 9. Connect your agents (1 min each)

The connector URL is `https://<your-deployment>/api/mcp` — the app's
**Connect from agents** panel shows it with a copy button and these same
instructions. Sign in with the Google account whose Drive holds your
board(s); the connector lists that account's boards (`list_boards`) and
each tool call can target one by `board_id` — with a single board, the
board can be omitted everywhere.

- **claude.ai** (chats, projects, scheduled routines): Settings →
  Connectors → **Add custom connector** → paste the URL → approve the
  Google consent screen.
- **Claude Code**:

  ```bash
  claude mcp add --transport http --scope user memoria https://<your-deployment>/api/mcp
  ```

  Then complete the OAuth prompt with `/mcp` in a session.

- **Other MCP clients** (Codex, Claude Desktop, …): add it as a remote
  MCP server (Streamable HTTP); the client's own OAuth flow handles
  sign-in.

Ask your agent to list, add, or move tasks — it's using the tools
described in `docs/ARCHITECTURE.md`.

To revoke a connector's access later, remove the app under
[myaccount.google.com](https://myaccount.google.com) → **Security →
Third-party access** (and delete the connector in the client). The
deployment itself stores nothing to revoke — it never sees or keeps your
tokens beyond the request it's serving.

## Troubleshooting

- **"redirect_uri_mismatch" or sign-in fails** — double check the exact
  origin (scheme + host + port, no trailing slash) is listed under
  Authorized JavaScript origins for your OAuth client.
- **Picker doesn't open** — confirm the API key is unrestricted-enough to
  call the Picker API (step 5), and that you're signed in.
- **Connector answers 503** — one of the three env vars from step 8 is
  missing or malformed on the deployment; the response body says which
  setup step to revisit. A 401 with `WWW-Authenticate` is healthy — it
  means the connector is up and asking the client to authenticate.
- **"Sheet doesn't match the expected format"** — someone hand-edited the
  sheet in a way `sheet-core` can't parse. The banner names the exact row,
  column, and value; fix it in Google Sheets and the board resumes on the
  next sync (every 5s while the tab is visible).
