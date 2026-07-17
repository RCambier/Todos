import { useEffect, useRef, useState } from "react";
import type { DriveFile } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import type { BoardState } from "../board/useBoard.js";

interface TopbarProps {
  spreadsheetId: string;
  boardStatus: BoardState["status"];
  lastSyncedAt: Date | null;
  profile: UserProfile | null;
  /** All boards this account can see — rendered as tabs, current one active. */
  boards: DriveFile[];
  onSelectBoard: (id: string) => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  onSwitchBoard: () => void;
}

function syncLabel(status: BoardState["status"], lastSyncedAt: Date | null): string {
  if (status === "error") return "Offline — retrying…";
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

/** The account button: profile photo when we have one, an initial otherwise. Opens a small menu. */
function AccountMenu({
  profile,
  onSignOut,
  onSwitchBoard,
}: Pick<TopbarProps, "profile" | "onSignOut" | "onSwitchBoard">) {
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
            Switch board
          </button>
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
  boardStatus,
  lastSyncedAt,
  profile,
  boards,
  onSelectBoard,
  onOpenSettings,
  onSignOut,
  onSwitchBoard,
}: TopbarProps) {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const offline = boardStatus === "error";
  const label = syncLabel(boardStatus, lastSyncedAt);
  const activeBoard = boards.find((b) => b.id === spreadsheetId);

  return (
    <div className="topbar">
      <div className="wordmark">
        <span className="wordmark-glyph" aria-hidden="true">
          M
        </span>
        <span className="wordmark-name">Memoria</span>
      </div>

      {/* One tab per board this account can see; + opens the board shelf. */}
      <div className="board-tabs" role="tablist" aria-label="Boards">
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            role="tab"
            aria-selected={b.id === spreadsheetId}
            className={`board-tab${b.id === spreadsheetId ? " active" : ""}`}
            onClick={() => b.id !== spreadsheetId && onSelectBoard(b.id)}
          >
            {b.name}
          </button>
        ))}
        {boards.length === 0 && (
          <span className="board-tab active" role="tab" aria-selected="true">
            Board
          </span>
        )}
        <button type="button" className="board-tab add-board" aria-label="Add board" onClick={onSwitchBoard}>
          +
        </button>
      </div>

      {/* Mobile shows just the active board's name where the tabs would be. */}
      <span className="mobile-board-name">{activeBoard?.name ?? "Board"}</span>

      <div className="spacer" />
      <div className={`sync${offline ? " offline" : ""}`} title={label} aria-label={label} role="status">
        <span className="dot" />
        <span className="sync-label">{label}</span>
      </div>
      <a
        className="top-link"
        href={sheetUrl}
        target="_blank"
        rel="noreferrer"
        aria-label="Open in Google Sheets"
        title="Open in Google Sheets"
      >
        <SheetIcon />
        <span className="top-link-label">Open in Google Sheets</span>
      </a>
      <button
        className="top-link"
        onClick={onOpenSettings}
        aria-label="Connect from agents"
        title="Connect from agents"
      >
        <AgentIcon />
        <span className="top-link-label">Connect from agents</span>
      </button>
      <AccountMenu profile={profile} onSignOut={onSignOut} onSwitchBoard={onSwitchBoard} />
    </div>
  );
}
