import { useEffect, useRef, useState } from "react";
import type { Collection, CollectionKind } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import { Logo } from "./Logo.js";

/** Sync status shape shared by the board and notes views. */
type ViewStatus = "loading" | "ready" | "malformed" | "error";

interface TopbarProps {
  spreadsheetId: string;
  status: ViewStatus;
  lastSyncedAt: Date | null;
  /** The sheet is unreachable; local changes queue until it's back. */
  offline: boolean;
  /** Local mutations not yet confirmed against the sheet. */
  pendingCount: number;
  profile: UserProfile | null;
  /** All collections this account can see — rendered as tabs, current one active. */
  collections: Collection[];
  onSelectCollection: (id: string, kind: CollectionKind) => void;
  onOpenSettings: (section: "agents" | "calendar") => void;
  onSignOut: () => void;
  onSwitchBoard: () => void;
}

function syncLabel(
  status: ViewStatus,
  lastSyncedAt: Date | null,
  offline: boolean,
  pendingCount: number,
): string {
  if (offline || status === "error") {
    return pendingCount > 0 ? `Offline · ${pendingCount} queued` : "Offline — retrying…";
  }
  if (pendingCount > 0) return "Syncing…";
  if (!lastSyncedAt) return "Syncing…";
  const seconds = Math.max(0, Math.round((Date.now() - lastSyncedAt.getTime()) / 1000));
  if (seconds < 5) return "Synced · just now";
  if (seconds < 60) return `Synced · ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Synced · ${minutes}m ago`;
}

/** Simple spreadsheet-grid glyph — stands in for the "Open in Google Sheets" link on narrow screens. */
function SheetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6h13M1.5 10h13M6 1.5v13" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/**
 * Six-ray spark — the app's own "agent" mark, matching the ✳ chip on
 * agent-created cards. (Deliberately not a Claude/Codex/MCP logo: those are
 * third-party trademarks this MIT repo shouldn't ship.)
 */
function AgentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.2v11.6M2.98 5.1l10.04 5.8M13.02 5.1 2.98 10.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The account button: profile photo when we have one, an initial otherwise.
 * Opens THE app menu — navigation, current-board actions, and integrations
 * grouped top to bottom, with sign-out isolated at the end (never adjacent
 * to the frequently-used items).
 */
function AccountMenu({
  profile,
  sheetUrl,
  onSignOut,
  onSwitchBoard,
  onOpenSettings,
}: Pick<TopbarProps, "profile" | "onSignOut" | "onSwitchBoard" | "onOpenSettings"> & {
  sheetUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (profile?.name || profile?.email || "?").slice(0, 1).toUpperCase();

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className="account-btn"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {profile?.picture ? (
          <img src={profile.picture} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="account-initial">{initial}</span>
        )}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          {profile && (
            <div className="account-info">
              {profile.name && <span className="account-name">{profile.name}</span>}
              {profile.email && <span className="account-email">{profile.email}</span>}
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSwitchBoard();
            }}
          >
            View all boards
          </button>
          <a role="menuitem" href={sheetUrl} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <SheetIcon /> Open in Google Sheets
          </a>
          <div className="menu-divider" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings("agents");
            }}
          >
            <AgentIcon /> Connect AI agents
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings("calendar");
            }}
          >
            Google Calendar sync
          </button>
          <div className="menu-divider" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({
  spreadsheetId,
  status,
  lastSyncedAt,
  offline,
  pendingCount,
  profile,
  collections,
  onSelectCollection,
  onOpenSettings,
  onSignOut,
  onSwitchBoard,
}: TopbarProps) {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const showOffline = offline || status === "error";
  const label = syncLabel(status, lastSyncedAt, offline, pendingCount);
  const activeCollection = collections.find((c) => c.id === spreadsheetId);

  return (
    <div className="topbar">
      {/* The logo is the "home" affordance: tap → the board shelf (all boards). */}
      <button
        type="button"
        className="wordmark"
        onClick={onSwitchBoard}
        aria-label="View all boards"
        title="View all boards"
      >
        <span className="wordmark-glyph" aria-hidden="true">
          <Logo size={24} />
        </span>
        <span className="wordmark-name">
          Memor<span className="wordmark-ia">ia</span>
        </span>
      </button>

      {/* One tab per collection this account can see; + opens the shelf. */}
      <div className="board-tabs" role="tablist" aria-label="Collections">
        {collections.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={c.id === spreadsheetId}
            className={`board-tab${c.id === spreadsheetId ? " active" : ""}`}
            onClick={() => c.id !== spreadsheetId && onSelectCollection(c.id, c.kind)}
          >
            {c.name}
          </button>
        ))}
        {collections.length === 0 && (
          <span className="board-tab active" role="tab" aria-selected="true">
            Board
          </span>
        )}
        <button
          type="button"
          className="board-tab add-board"
          aria-label="Add collection"
          onClick={onSwitchBoard}
        >
          +
        </button>
      </div>

      {/* Mobile shows just the active collection's name where the tabs would be. */}
      <span className="mobile-board-name">{activeCollection?.name ?? "Board"}</span>

      <div className="spacer" />
      <div className={`sync${showOffline ? " offline" : ""}`} title={label} aria-label={label} role="status">
        <span className="dot" />
        <span className="sync-label">{label}</span>
      </div>
      <AccountMenu
        profile={profile}
        sheetUrl={sheetUrl}
        onSignOut={onSignOut}
        onSwitchBoard={onSwitchBoard}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
