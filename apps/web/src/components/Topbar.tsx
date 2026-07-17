import type { BoardState } from "../board/useBoard.js";

interface TopbarProps {
  spreadsheetId: string;
  boardStatus: BoardState["status"];
  lastSyncedAt: Date | null;
  onOpenSettings: () => void;
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

export function Topbar({ spreadsheetId, boardStatus, lastSyncedAt, onOpenSettings }: TopbarProps) {
  const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const offline = boardStatus === "error";

  return (
    <div className="topbar">
      <div className="board-name">
        <span className="glyph">✓</span> Todos
      </div>
      <div className={`sync${offline ? " offline" : ""}`}>
        <span className="dot" /> {syncLabel(boardStatus, lastSyncedAt)}
      </div>
      <div className="spacer" />
      <a className="top-link" href={sheetUrl} target="_blank" rel="noreferrer">
        Open in Google Sheets ↗
      </a>
      <button className="top-link" onClick={onOpenSettings}>
        Settings
      </button>
      <div className="avatar" aria-hidden="true">
        ✓
      </div>
    </div>
  );
}
