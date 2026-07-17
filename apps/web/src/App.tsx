import { useEffect, useState } from "react";
import { clearToken, fetchUserProfile, requestToken, type UserProfile } from "./auth/googleAuth.js";
import { FirstRun } from "./components/FirstRun.js";
import { Shell } from "./components/Shell.js";
import { Welcome } from "./components/Welcome.js";
import { assertConfigured } from "./config.js";
import { clearCachedSpreadsheetId, getCachedSpreadsheetId, setCachedSpreadsheetId } from "./lib/storage.js";

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => getCachedSpreadsheetId());
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(token).then((p) => {
      if (!cancelled) setProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

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

  /** Signs out of Google in this browser. The board stays cached — signing back in lands right on it. */
  function handleSignOut(): void {
    clearToken();
    setToken(null);
  }

  /** Forgets the cached board (the sheet itself is untouched) and returns to the board shelf. */
  function handleSwitchBoard(): void {
    clearCachedSpreadsheetId();
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
    return <Welcome error={authError} onConnect={() => void handleConnect()} />;
  }

  if (!spreadsheetId) {
    return <FirstRun token={token} onBoardReady={handleBoardReady} />;
  }

  return (
    <Shell
      token={token}
      spreadsheetId={spreadsheetId}
      profile={profile}
      onSignOut={handleSignOut}
      onSwitchBoard={handleSwitchBoard}
    />
  );
}
