import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Shell } from "./components/Shell.js";
import { Welcome } from "./components/Welcome.js";
import { assertConfigured } from "./config.js";
import { deriveSlots } from "./lib/slots.js";
import {
  clearConnectedSheetId,
  getActiveKind,
  getConnectedSheetId,
  readNotesReplica,
  readReplica,
  setActiveKind as cacheActiveKind,
  setConnectedSheetId,
} from "./lib/storage.js";

/** Refresh the access token this long before it actually expires. */
const TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1000;

/** One connected sheet id per kind — the whole point of the simplified model. */
type SheetIds = { board: string | null; notes: string | null };

export function App() {
  const [configError, setConfigError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(true);
  const [authError, setAuthError] = useState<string | null>(() => consumeAuthError());
  const [activeKind, setActiveKind] = useState<CollectionKind>(() => getActiveKind());
  const [sheetIds, setSheetIds] = useState<SheetIds>(() => ({
    board: getConnectedSheetId("board"),
    notes: getConnectedSheetId("notes"),
  }));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  /** Null until the first Drive listing lands (the setup screen shows skeletons). */
  const [collections, setCollections] = useState<Collection[] | null>(null);
  /** Bumped to re-run the Drive listing (after create / link / unlink). */
  const [listEpoch, setListEpoch] = useState(0);
  // True on deployments without the auth backend (see docs/SETUP.md): sign-in
  // falls back to the GIS popup, and sessions last one visit.
  const [popupMode, setPopupMode] = useState(false);
  // Session restore failed for network-ish reasons (not "signed out") —
  // offline boots keep showing the cached view instead of a sign-in wall.
  const [sessionUnreachable, setSessionUnreachable] = useState(false);
  // Optional grants on the current session (e.g. the calendar mirror's tasks scope).
  const [scopes, setScopes] = useState<string[]>([]);
  const expiresAtRef = useRef<number | null>(null);

  const sheetIdsRef = useRef(sheetIds);
  sheetIdsRef.current = sheetIds;

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

  /** Adopts the listing's verdict for one kind's connected sheet (state + cache). */
  const applyConnected = useCallback((kind: CollectionKind, id: string | null) => {
    if (id) setConnectedSheetId(kind, id);
    else clearConnectedSheetId(kind);
    setSheetIds((prev) => (prev[kind] === id ? prev : { ...prev, [kind]: id }));
  }, []);

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setCollections(null);
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
        // The Drive listing is the authority on what each slot connects to —
        // a cached id wins while it's still tagged, otherwise newest of kind.
        const slots = deriveSlots(found, sheetIdsRef.current);
        applyConnected("board", slots.board.connected?.id ?? null);
        applyConnected("notes", slots.notes.connected?.id ?? null);
        // File everything under Memoria/todos | Memoria/notes, moving
        // strays in. Fire-and-forget: never load-bearing.
        void organizeCollections(token, found);
      })
      .catch(() => {
        // Listing failed (offline, hiccup) — keep whatever we had; the tabs and
        // any cached view still work, and the next epoch retries.
      });
    return () => {
      cancelled = true;
    };
  }, [token, listEpoch, applyConnected]);

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

  /** A kind got a sheet (created, linked, or connected from extras) — connect and show it. */
  function handleSheetReady(kind: CollectionKind, id: string): void {
    applyConnected(kind, id);
    setActiveKind(kind);
    cacheActiveKind(kind);
    setListEpoch((e) => e + 1);
  }

  /** Tab click: switch the active view. An empty kind shows its inline setup (design 9b). */
  function handleSelectKind(kind: CollectionKind): void {
    setActiveKind(kind);
    cacheActiveKind(kind);
  }

  const slots = useMemo(
    () => (collections ? deriveSlots(collections, sheetIds) : null),
    [collections, sheetIds],
  );

  if (configError) {
    return (
      <div className="first-run">
        <h1>Configuration needed</h1>
        <div className="first-run-error">{configError}</div>
      </div>
    );
  }

  const activeSheetId = sheetIds[activeKind];

  /** True when the active sheet has a local replica to paint from. */
  const hasLocalCache = (id: string): boolean =>
    activeKind === "notes" ? readNotesReplica(id) !== null : readReplica(id) !== null;

  const shellProps = {
    spreadsheetId: activeSheetId ?? "",
    kind: activeKind,
    connectedKinds: { board: sheetIds.board !== null, notes: sheetIds.notes !== null },
    extras: slots?.[activeKind].extras ?? [],
    listingLoading: collections === null,
    onSelectKind: handleSelectKind,
    onSheetReady: handleSheetReady,
    onSignOut: handleSignOut,
  };

  function handleSignOut(): void {
    if (popupMode) {
      clearToken();
    } else {
      void signOutSession();
    }
    expiresAtRef.current = null;
    setToken(null);
  }

  if (authBusy) {
    // Paint the last known view instantly while the session restores in the
    // background — the local replica needs no network, and any mutations made
    // in the meantime queue in the outbox until the token arrives.
    if (activeSheetId && hasLocalCache(activeSheetId)) {
      return <Shell {...shellProps} token={null} profile={null} />;
    }
    return (
      <div className="first-run">
        <p>Loading…</p>
      </div>
    );
  }

  if (!token) {
    // Offline boot with a local sheet: show it (mutations queue) — a sign-in
    // wall would be useless without a network anyway.
    if (sessionUnreachable && activeSheetId && hasLocalCache(activeSheetId)) {
      return <Shell {...shellProps} token={null} sessionOffline profile={null} />;
    }
    return <Welcome error={authError} onConnect={() => void handleConnect()} />;
  }

  // Signed in: always the app frame. An empty kind's tab shows inline setup
  // (design 9b) — there is no separate "sheets" screen.
  return (
    <Shell
      {...shellProps}
      token={token}
      profile={profile}
      calendarMirrorAvailable={!popupMode}
      hasTasksScope={scopes.includes(TASKS_SCOPE)}
    />
  );
}
