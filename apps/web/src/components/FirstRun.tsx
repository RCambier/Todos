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
        <h1>Set up your board</h1>
        <p>Todos lives in a Google Sheet in your own Drive. Pick how to get started.</p>
      </div>

      {error && <div className="first-run-error">{error}</div>}

      <div className="paths">
        <div className="path-card">
          <h2>Found your existing board</h2>
          <p>Boards this app created that you still have access to, on any device.</p>
          {boards === null && !boardsError && <p>Looking…</p>}
          {boardsError && <p>Couldn&rsquo;t list boards: {boardsError}</p>}
          {boards && boards.length === 0 && <p>None found yet.</p>}
          {boards && boards.length > 0 && (
            <div className="board-list">
              {boards.map((b) => (
                <div className="board-pick" key={b.id}>
                  <span>{b.name}</span>
                  <button onClick={() => onBoardReady(b.id)}>Use this</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="path-card">
          <h2>Create a board</h2>
          <p>Creates a new spreadsheet in your Drive, tagged so any device can find it later.</p>
          <button className="btn-primary" onClick={handleCreate} disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create a board"}
          </button>
        </div>

        <div className="path-card">
          <h2>Use an existing sheet</h2>
          <p>
            Pick a spreadsheet from Drive. An empty sheet gets the right columns set up automatically; a sheet
            with the right columns already is attached as-is.
          </p>
          <button className="btn-primary" onClick={handleAttach} disabled={busy !== null}>
            {busy === "attach" ? "Opening…" : "Choose from Drive"}
          </button>
        </div>
      </div>
    </div>
  );
}
