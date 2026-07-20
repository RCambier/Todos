import { useCallback, useEffect, useRef, useState } from "react";
import { findCollections, type Collection, type CollectionKind } from "./api/drive.js";
import { organizeCollections } from "./api/folders.js";
import { clearToken, fetchUserProfile, requestToken, type UserProfile } from "./auth/googleAuth.js";
import {
  beginSignIn,
  consumeAuthError,
  fetchSession,
  signOutSession,
  TASKS_SCOPE,
  type SessionState,
} from "./auth/session.js";
import { FirstRun } from "./components/FirstRun.js";
import { Shell } from "./components/Shell.js";
import { Welcome } from "./components/Welcome.js";
import { assertConfigured } from "./config.js";
import {
  getCachedCollectionKind,
  getCachedSpreadsheetId,
  readNotesReplica,
  readReplica,
  setCachedCollectionKind,
  setCachedSpreadsheetId,
} from "./lib/storage.js";

/** Refresh the access token this long before it actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** The board shelf is a real history entry (`#boards`), so Back walks shelf ↔ board. */
const SHELF_HASH = "#boards";

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(() => consumeAuthError());
  const [spreadsheetId, setSpreadsheetId] = useState<string | null>(() => getCachedSpreadsheetId());
  const [kind, setKind] = useState<CollectionKind>(() => getCachedCollectionKind());
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  // True on deployments without the auth backend (see docs/SETUP.md): sign-in
  // falls back to the GIS popup, and sessions last one visit.
  const [popupMode, setPopupMode] = useState(false);
  // Session restore failed for network-ish reasons (not "signed out") —
  // offline boots keep showing the cached board instead of a sign-in wall.
  const [sessionUnreachable, setSessionUnreachable] = useState(false);
  // Optional grants on the current session (e.g. the calendar mirror's tasks scope).
  const [scopes, setScopes] = useState<string[]>([]);
  const expiresAtRef = useRef<number | null>(null);
  const [shelfOpen, setShelfOpen] = useState(() => window.location.hash === SHELF_HASH);

  useEffect(() => {
    const onHashChange = (): void => setShelfOpen(window.location.hash === SHELF_HASH);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const applySession = useCallback((session: SessionState, isBoot: boolean) => {
    switch (session.status) {
      case "ok":
        expiresAtRef.current = session.expiresAt;
        setToken(session.token);
        setScopes(session.scopes);
        setSessionUnreachable(false);
        break;
      case "signed_out":
        expiresAtRef.current = null;
        setToken(null);
        setSessionUnreachable(false);
        break;
      case "unavailable":
        setPopupMode(true);
        break;
      case "error":
        // Mid-session, the current token may well outlive a transient blip —
        // keep it. On boot there is nothing to keep; surface the message.
        if (isBoot) {
          setAuthError(session.message);
          setSessionUnreachable(true);
        }
        break;
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setCollections([]);
      return;
    }
    let cancelled = false;
    void fetchUserProfile(token).then((p) => {
      if (!cancelled) setProfile(p);
    });
    void findCollections(token)
      .then((found) => {
        if (cancelled) return;
        setCollections(found);
        // The cached kind can be stale (or predate kinds entirely) —
        // the Drive listing is the authority.
        const active = found.find((c) => c.id === getCachedSpreadsheetId());
        if (active) {
          setKind(active.kind);
          setCachedCollectionKind(active.kind);
        }
        // File everything under Memoria/boards | Memoria/notes, moving
        // strays in. Fire-and-forget: never load-bearing.
        void organizeCollections(token, found);
      })
      .catch(() => {
        /* tabs just stay empty — the active view itself doesn't depend on this */
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

  // An offline boot leaves the session unrestored — retry when connectivity returns.
  useEffect(() => {
    if (!sessionUnreachable) return;
    const retry = (): void => {
      void fetchSession().then((session) => applySession(session, true));
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [sessionUnreachable, applySession]);

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

  function handleCollectionReady(id: string, collectionKind: CollectionKind): void {
    setCachedSpreadsheetId(id);
    setCachedCollectionKind(collectionKind);
    setSpreadsheetId(id);
    setKind(collectionKind);
    if (window.location.hash === SHELF_HASH) {
      // Leave the shelf entry in history (Back returns to it) and show the board.
      history.pushState(null, "", window.location.pathname + window.location.search);
      setShelfOpen(false);
    }
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

  /** Opens the board shelf as a history entry; the current board stays cached, Back returns to it. */
  function handleSwitchBoard(): void {
    if (window.location.hash !== SHELF_HASH) window.location.hash = SHELF_HASH;
  }

  if (configError) {
    return (
      <div className="first-run">
        <h1>Configuration needed</h1>
        <div className="first-run-error">{configError}</div>
      </div>
    );
  }

  /** True when the active collection has a local replica to paint from. */
  const hasLocalCache = (id: string): boolean =>
    kind === "notes" ? readNotesReplica(id) !== null : readReplica(id) !== null;

  if (authBusy) {
    // Paint the last known view instantly while the session restores in the
    // background — the local replica needs no network, and any mutations made
    // in the meantime queue in the outbox until the token arrives.
    if (spreadsheetId && !shelfOpen && hasLocalCache(spreadsheetId)) {
      return (
        <Shell
          token={null}
          spreadsheetId={spreadsheetId}
          kind={kind}
          profile={null}
          collections={collections}
          onSelectCollection={handleCollectionReady}
          onSignOut={handleSignOut}
          onSwitchBoard={handleSwitchBoard}
        />
      );
    }
    return (
      <div className="first-run">
        <p>Loading…</p>
      </div>
    );
  }

  if (!token) {
    // Offline boot with a local collection: show it (mutations queue) — a
    // sign-in wall would be useless without a network anyway.
    if (sessionUnreachable && spreadsheetId && !shelfOpen && hasLocalCache(spreadsheetId)) {
      return (
        <Shell
          token={null}
          sessionOffline
          spreadsheetId={spreadsheetId}
          kind={kind}
          profile={null}
          collections={collections}
          onSelectCollection={handleCollectionReady}
          onSignOut={handleSignOut}
          onSwitchBoard={handleSwitchBoard}
        />
      );
    }
    return <Welcome error={authError} onConnect={() => void handleConnect()} />;
  }

  if (!spreadsheetId || shelfOpen) {
    return <FirstRun token={token} onCollectionReady={handleCollectionReady} />;
  }

  return (
    <Shell
      token={token}
      spreadsheetId={spreadsheetId}
      kind={kind}
      profile={profile}
      collections={collections}
      calendarMirrorAvailable={!popupMode}
      hasTasksScope={scopes.includes(TASKS_SCOPE)}
      onSelectCollection={handleCollectionReady}
      onSignOut={handleSignOut}
      onSwitchBoard={handleSwitchBoard}
    />
  );
}
