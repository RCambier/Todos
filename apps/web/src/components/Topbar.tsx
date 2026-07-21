import { useEffect, useRef, useState } from "react";
import type { CollectionKind } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import { useIsMobile } from "../lib/useIsMobile.js";
import { AgentMark } from "./AgentMark.js";
import { Logo } from "./Logo.js";
import type { SettingsSection } from "./SettingsPanel.js";

/** Sync status shape shared by the board and notes views. */
type ViewStatus = "loading" | "ready" | "malformed" | "error";

/** The fixed tabs — the app manages exactly one sheet of each kind. */
const KIND_TABS: { kind: CollectionKind; label: string }[] = [
  { kind: "board", label: "Todos" },
  { kind: "notes", label: "Notes" },
  { kind: "memories", label: "AI Memories" },
];

interface TopbarProps {
  spreadsheetId: string;
  status: ViewStatus;
  lastSyncedAt: Date | null;
  /** The sheet is unreachable; local changes queue until it's back. */
  offline: boolean;
  /** Local mutations not yet confirmed against the sheet. */
  pendingCount: number;
  profile: UserProfile | null;
  /** Which view is showing. Both tabs always render; the active one is highlighted. */
  activeKind: CollectionKind;
  /** Which kinds have a connected sheet — a kind without one routes to setup on click. */
  connectedKinds: Record<CollectionKind, boolean>;
  onSelectKind: (kind: CollectionKind) => void;
  onOpenSettings: (section: SettingsSection) => void;
  onSignOut: () => void;
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

/** Columns glyph for the "Customize board columns" menu entry. */
function ColumnsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="3.6" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.2" y="2.5" width="3.6" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="10.9" y="2.5" width="3.6" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** Calendar glyph for the "Sync with Google Calendar" menu entry. */
function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="11.5" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 6.5h13M5 1.5v3M11 1.5v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
  activeKind,
  onSignOut,
  onOpenSettings,
}: Pick<TopbarProps, "profile" | "onSignOut" | "onOpenSettings" | "activeKind"> & {
  /** Null when the active kind has no connected sheet — the Sheets link is hidden. */
  sheetUrl: string | null;
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
          {sheetUrl && (
            <>
              <a
                role="menuitem"
                href={sheetUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
              >
                <SheetIcon /> Open in Google Sheets
              </a>
              <div className="menu-divider" />
            </>
          )}
          {activeKind === "board" && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenSettings("columns");
              }}
            >
              <ColumnsIcon /> Customize board columns
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings("agents");
            }}
          >
            <AgentMark size={14} /> Connect with AI agents
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings("calendar");
            }}
          >
            <CalendarIcon /> Sync with Google Calendar
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
  activeKind,
  connectedKinds,
  onSelectKind,
  onOpenSettings,
  onSignOut,
}: TopbarProps) {
  const hasSheet = spreadsheetId !== "";
  const sheetUrl = hasSheet ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : null;
  const showOffline = offline || status === "error";
  const label = syncLabel(status, lastSyncedAt, offline, pendingCount);
  const isMobile = useIsMobile();

  // On phones the label is hidden and only the dot shows; tapping the dot
  // reveals the state in a short-lived bubble underneath it.
  const [syncPopOpen, setSyncPopOpen] = useState(false);
  const syncRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!syncPopOpen) return;
    const timer = window.setTimeout(() => setSyncPopOpen(false), 3000);
    function onPointerDown(e: PointerEvent): void {
      if (syncRef.current && !syncRef.current.contains(e.target as Node)) setSyncPopOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [syncPopOpen]);
  useEffect(() => {
    if (!isMobile) setSyncPopOpen(false);
  }, [isMobile]);

  return (
    <div className="topbar">
      {/* Brand mark — navigation is the tabs now, so this is decorative. */}
      <div className="wordmark">
        <span className="wordmark-glyph" aria-hidden="true">
          <Logo size={24} />
        </span>
        <span className="wordmark-name">
          Memor<span className="wordmark-ia">ia</span>
        </span>
      </div>

      {/* The two fixed views. A kind without a sheet still shows — clicking it
          routes to setup, where the sheet can be created or linked. */}
      <div className="board-tabs" role="tablist" aria-label="Views">
        {KIND_TABS.map(({ kind, label: tabLabel }) => (
          <button
            key={kind}
            type="button"
            role="tab"
            aria-selected={kind === activeKind}
            className={`board-tab${kind === activeKind ? " active" : ""}${connectedKinds[kind] ? "" : " unset"}`}
            onClick={() => kind !== activeKind && onSelectKind(kind)}
          >
            {tabLabel}
          </button>
        ))}
      </div>

      <div className="spacer" />
      {hasSheet && (
        <button
          type="button"
          ref={syncRef}
          className={`sync${showOffline ? " offline" : ""}`}
          title={label}
          aria-label={label}
          onClick={() => isMobile && setSyncPopOpen((o) => !o)}
        >
          <span className="dot" />
          <span className="sync-label" role="status">
            {label}
          </span>
          {syncPopOpen && (
            <span className="sync-pop" role="status">
              {label}
            </span>
          )}
        </button>
      )}
      <AccountMenu
        profile={profile}
        sheetUrl={sheetUrl}
        activeKind={activeKind}
        onSignOut={onSignOut}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
