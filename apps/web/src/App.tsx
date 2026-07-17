import { useCallback, useEffect, useRef, useState } from "react";
import { findBoards, type DriveFile } from "./api/drive.js";
import { clearToken, fetchUserProfile, requestToken, type UserProfile } from "./auth/googleAuth.js";
import {
  beginSignIn,
  consumeAuthError,
  fetchSession,
  signOutSession,
  type SessionState,
} from "./auth/session.js";
import { FirstRun } from "./components/FirstRun.js";
import { Shell } from "./components/Shell.js";
import { Welcome } from "./components/Welcome.js";
import { assertConfigured } from "./config.js";
import { clearCachedSpreadsheetId, getCachedSpreadsheetId, setCachedSpreadsheetId } from "./lib/storage.js";

/** Refresh the access token this long before it actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(() => consumeAuthError());
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => getCachedSpreadsheetId());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [boards, setBoards] = useState<DriveFile[]>([]);
  // True on deployments without the auth backend (see docs/SETUP.md): sign-in
  // falls back to the GIS popup, and sessions last one visit.
  const [popupMode, setPopupMode] = useState(false);
  const expiresAtRef = useRef<number | null>(null);

  const applySession = useCallback((session: SessionState, isBoot: boolean) => {
    switch (session.status) {
      case "ok":
        expiresAtRef.current = session.expiresAt;
        setToken(session.token);
        break;
      case "signed_out":
        expiresAtRef.current = null;
        setToken(null);
        break;
      case "unavailable":
        setPopupMode(true);
        break;
      case "error":
        // Mid-session, the current token may well outlive a transient blip —
        // keep it. On boot there is nothing to keep; surface the message.
        if (isBoot) setAuthError(session.message);
        break;
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setBoards([]);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(token).then((p) => {
      if (!cancelled) setProfile(p);
    });
    void findBoards(token)
      .then((found) => {
        if (!cancelled) setBoards(found);
      })
      .catch(() => {
        /* tabs just stay empty — the board itself doesn't depend on this */
      });
    return () => {
      cancelled = true;
    };
  }, [token, spreadsheetId]);

  // Boot: restore the persistent session with one silent call. No Google
  // popups here — the GIS popup can't open outside a click and is what made
  // every visit (and especially mobile) demand a fresh sign-in.
  useEffect(() => {
    try {
      assertConfigured();
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : String(err));
      setAuthBusy(false);
      return;
    }
    fetchSession()
      .then((session) => applySession(session, true))
      .finally(() => setAuthBusy(false));
  }, [applySession]);

  // Keep the token fresh: renew it shortly before expiry, and immediately
  // when the tab comes back after being hidden past that point.
  useEffect(() => {
    if (!token || popupMode) return;

    const refresh = (): void => {
      void fetchSession().then((session) => applySession(session, false));
    };
    const msUntilRefresh = Math.max((expiresAtRef.current ?? 0) - Date.now() - TOKEN_REFRESH_MARGIN_MS, 0);
    const timer = setTimeout(refresh, msUntilRefresh);

    const onVisibilityChange = (): void => {
      const expiresAt = expiresAtRef.current;
      if (!document.hidden && expiresAt !== null && Date.now() > expiresAt - TOKEN_REFRESH_MARGIN_MS) {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token, popupMode, applySession]);

  async function handleConnect(): Promise<void> {
    setAuthError(null);
    if (!popupMode) {
      beginSignIn(); // full-page redirect; nothing to await
      return;
    }
    try {
      setToken(await requestToken());
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleBoardReady(id: string): void {
    setCachedSpreadsheetId(id);
    setSpreadsheetId(id);
  }

  /** Signs out of this browser. The board stays cached — signing back in lands right on it. */
  function handleSignOut(): void {
    if (popupMode) {
      clearToken();
    } else {
      void signOutSession();
    }
    expiresAtRef.current = null;
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
      boards={boards}
      onSelectBoard={handleBoardReady}
      onSignOut={handleSignOut}
      onSwitchBoard={handleSwitchBoard}
    />
  );
}
