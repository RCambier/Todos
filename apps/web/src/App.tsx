import { useEffect, useState } from "react";
import { clearToken, requestToken } from "./auth/googleAuth.js";
import { FirstRun } from "./components/FirstRun.js";
import { Shell } from "./components/Shell.js";
import { assertConfigured } from "./config.js";
import { clearCachedSpreadsheetId, getCachedSpreadsheetId, setCachedSpreadsheetId } from "./lib/storage.js";

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => getCachedSpreadsheetId());

  useEffect(() => {
    try {
      assertConfigured();
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err));
      setAuthBusy(false);
      return;
    }
    // Try a silent, non-interactive token refresh first — if the user already
    // granted consent in a prior session, this signs them back in with no click.
    requestToken(false)
      .then(setToken)
      .catch(() => {
        /* no prior consent (or it expired) — fall through to the connect screen */
      })
      .finally(() => setAuthBusy(false));
  }, []);

  async function handleConnect(): Promise<void> {
    setAuthError(null);
    try {
      setToken(await requestToken(true));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBoardReady(id: string): void {
    setCachedSpreadsheetId(id);
    setSpreadsheetId(id);
  }

  function handleDisconnect(): void {
    clearToken();
    clearCachedSpreadsheetId();
    setToken(null);
    setSpreadsheetId(null);
  }

  if (configError) {
    return (
      <div className="first-run">
        <h1>Configuration needed</h1>
        <div className="first-run-error">{configError}</div>
      </div>
    );
  }

  if (authBusy) {
    return (
      <div className="first-run">
        <p>Loading…</p>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="first-run">
        <div>
          <h1>Todos</h1>
          <p>A quiet kanban board over a Google Sheet you own. Nothing leaves your Drive.</p>
        </div>
        {authError && <div className="first-run-error">{authError}</div>}
        <button className="btn-primary" onClick={() => void handleConnect()}>
          Connect Google Drive
        </button>
      </div>
    );
  }

  if (!spreadsheetId) {
    return <FirstRun token={token} onBoardReady={handleBoardReady} />;
  }

  return <Shell token={token} spreadsheetId={spreadsheetId} onDisconnect={handleDisconnect} />;
}
