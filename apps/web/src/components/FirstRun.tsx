import { useEffect, useState } from "react";
import { findBoards, type DriveFile } from "../api/drive.js";
import { pickSpreadsheet } from "../api/picker.js";
import { attachOrBootstrap, createBoard } from "../board/onboarding.js";

interface FirstRunProps {
  token: string;
  onBoardReady: (spreadsheetId: string) => void;
}

type Busy = "create" | "attach" | null;

/**
 * The three converging first-run paths from the architecture doc: reconnect
 * to a board this app created (found via Drive appProperties), create a new
 * one, or attach an existing sheet via the Picker.
 */
export function FirstRun({ token, onBoardReady }: FirstRunProps) {
  const [boards, setBoards] = useState<DriveFile[] | null>(null);
  const [boardsError, setBoardsError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    findBoards(token)
      .then((found) => {
        if (!cancelled) setBoards(found);
      })
      .catch((err) => {
        if (!cancelled) setBoardsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleCreate(): Promise<void> {
    setBusy("create");
    setError(null);
    try {
      const id = await createBoard(token);
      onBoardReady(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleAttach(): Promise<void> {
    setBusy("attach");
    setError(null);
    try {
      const fileId = await pickSpreadsheet(token);
      if (!fileId) return;
      const outcome = await attachOrBootstrap(token, fileId);
      if (outcome.kind === "refused") {
        setError(`Can't use that sheet: ${outcome.reason}`);
      } else {
        onBoardReady(fileId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="first-run">
      <div>
        <h1>Your boards</h1>
        <p>Each board is a Google Sheet in your Drive.</p>
      </div>

      {error && <div className="first-run-error">{error}</div>}

      <div className="board-shelf">
        {boards === null && !boardsError && (
          <>
            <div className="board-row skeleton" aria-hidden="true" />
            <div className="board-row skeleton" aria-hidden="true" />
          </>
        )}
        {boardsError && <p className="shelf-note">Couldn&rsquo;t list your boards: {boardsError}</p>}
        {boards && boards.length === 0 && (
          <div className="shelf-empty">
            <SheetGlyph />
            <p>No boards yet</p>
          </div>
        )}
        {boards?.map((b) => (
          <button className="board-row" key={b.id} onClick={() => onBoardReady(b.id)}>
            <SheetGlyph />
            <span className="board-name">{b.name}</span>
            <span className="board-open">Open →</span>
          </button>
        ))}
      </div>

      <div className="board-actions">
        <button className="btn-primary" onClick={handleCreate} disabled={busy !== null}>
          {busy === "create" ? "Creating…" : "+ New board"}
        </button>
        <button className="btn-ghost" onClick={handleAttach} disabled={busy !== null}>
          {busy === "attach" ? "Opening Drive…" : "Link a sheet as a board"}
        </button>
      </div>
    </div>
  );
}

/** Small Google-Sheets-style tile: green rounded square with a white grid. */
function SheetGlyph() {
  return (
    <svg className="sheet-glyph" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="4" fill="var(--status-done)" />
      <path
        d="M5.5 7h9M5.5 10h9M5.5 13h9M8.5 7v8.5"
        stroke="#fff"
        strokeWidth="1.3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
