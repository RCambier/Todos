import { useEffect, useRef, useState } from "react";
import type { CollectionKind } from "../api/drive.js";
import type { UserProfile } from "../auth/googleAuth.js";
import { Logo } from "./Logo.js";

/** Sync status shape shared by the board and notes views. */
type ViewStatus = "loading" | "ready" | "malformed" | "error";

/** The two fixed tabs — the app manages exactly one sheet of each kind. */
const KIND_TABS: { kind: CollectionKind; label: string }[] = [
  { kind: "board", label: "Todos" },
  { kind: "notes", label: "Notes" },
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
  onOpenSettings: () => void;
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

/** Gear glyph for the single "Settings" entry that opens the settings drawer. */
function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.6v1.7M8 12.7v1.7M14.4 8h-1.7M3.3 8H1.6M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2M12.5 12.5l-1.2-1.2M4.7 4.7 3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
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
  onOpenSettings,
}: Pick<TopbarProps, "profile" | "onSignOut" | "onOpenSettings"> & {
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
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            <GearIcon /> Settings
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
        <div
          className={`sync${showOffline ? " offline" : ""}`}
          title={label}
          aria-label={label}
          role="status"
        >
          <span className="dot" />
          <span className="sync-label">{label}</span>
        </div>
      )}
      <AccountMenu
        profile={profile}
        sheetUrl={sheetUrl}
        onSignOut={onSignOut}
        onOpenSettings={onOpenSettings}
      />
    </div>
  );
}
