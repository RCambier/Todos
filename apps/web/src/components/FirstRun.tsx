import { useEffect, useRef, useState } from "react";
import { findCollections, type Collection, type CollectionKind } from "../api/drive.js";
import { pickSpreadsheet } from "../api/picker.js";
import { attachOrBootstrap, createCollection } from "../board/onboarding.js";
import { Logo } from "./Logo.js";

interface FirstRunProps {
  token: string;
  onCollectionReady: (spreadsheetId: string, kind: CollectionKind) => void;
}

type Busy = "create" | "attach" | null;

/**
 * The converging first-run paths from the architecture doc: reconnect to a
 * collection this app created (found via Drive appProperties), create a new
 * one (a Todos board or a Notes grid — design 5c: the type only changes the
 * view; both are sheets), or attach an existing sheet via the Picker.
 */
export function FirstRun({ token, onCollectionReady }: FirstRunProps) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [newKind, setNewKind] = useState<CollectionKind>("board");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const named = useRef(false);

  useEffect(() => {
    if (naming) nameInputRef.current?.select();
  }, [naming]);

  useEffect(() => {
    let cancelled = false;
    findCollections(token)
      .then((found) => {
        if (!cancelled) setCollections(found);
      })
      .catch((err) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /** Default name per type, until the user types their own. */
  function pickKind(kind: CollectionKind): void {
    setNewKind(kind);
    const input = nameInputRef.current;
    if (input && !named.current) {
      input.value = kind === "notes" ? "Notes" : "Todos";
      input.select();
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const title = nameInputRef.current?.value.trim() || (newKind === "notes" ? "Notes" : "Todos");
    setBusy("create");
    setError(null);
    try {
      const id = await createCollection(token, title, newKind);
      onCollectionReady(id, newKind);
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
        onCollectionReady(fileId, "board");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="first-run">
      <div className="first-run-brand" aria-hidden="true">
        <Logo size={26} />
        <span className="wordmark-name">
          Memor<span className="wordmark-ia">ia</span>
        </span>
      </div>

      <div>
        <h1>Your collections</h1>
        <p>Each one — a board of todos or a grid of notes — is a Google Sheet in your Drive.</p>
      </div>

      {error && <div className="first-run-error">{error}</div>}

      <div className="board-shelf">
        {collections === null && !listError && (
          <>
            <div className="board-row skeleton" aria-hidden="true" />
            <div className="board-row skeleton" aria-hidden="true" />
          </>
        )}
        {listError && <p className="shelf-note">Couldn&rsquo;t list your collections: {listError}</p>}
        {collections && collections.length === 0 && (
          <div className="shelf-empty">
            <SheetGlyph kind="board" />
            <p>Nothing yet</p>
          </div>
        )}
        {collections?.map((c) => (
          <button className="board-row" key={c.id} onClick={() => onCollectionReady(c.id, c.kind)}>
            <SheetGlyph kind={c.kind} />
            <span className="board-name">{c.name}</span>
            <span className="board-kind">{c.kind === "notes" ? "Notes" : "Board"}</span>
            <span className="board-open">Open →</span>
          </button>
        ))}
      </div>

      {naming ? (
        <form className="board-name-form collection-form" onSubmit={handleCreate}>
          <div className="kind-cards" role="radiogroup" aria-label="Collection type">
            <button
              type="button"
              role="radio"
              aria-checked={newKind === "board"}
              className={`kind-card${newKind === "board" ? " selected" : ""}`}
              onClick={() => pickKind("board")}
              disabled={busy !== null}
            >
              <BoardKindGlyph />
              <span className="kind-card-name">Todos</span>
              <span className="kind-card-desc">A small board. Items move through statuses.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={newKind === "notes"}
              className={`kind-card${newKind === "notes" ? " selected" : ""}`}
              onClick={() => pickKind("notes")}
              disabled={busy !== null}
            >
              <NotesKindGlyph />
              <span className="kind-card-name">Notes</span>
              <span className="kind-card-desc">A grid of notes. Free-form markdown, no statuses.</span>
            </button>
          </div>
          <div className="collection-form-row">
            <input
              ref={nameInputRef}
              type="text"
              defaultValue="Todos"
              aria-label="Collection name"
              disabled={busy !== null}
              onChange={() => {
                named.current = true;
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape" && busy === null) setNaming(false);
              }}
            />
            <button className="btn-primary" type="submit" disabled={busy !== null}>
              {busy === "create" ? "Creating…" : "Create"}
            </button>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => setNaming(false)}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
          <p className="collection-form-note">
            Creates a new sheet in your Drive, under{" "}
            <code>Memoria/{newKind === "notes" ? "notes" : "boards"}/</code>.
          </p>
        </form>
      ) : (
        <div className="board-actions">
          <button className="btn-primary" onClick={() => setNaming(true)} disabled={busy !== null}>
            + New collection
          </button>
          <button className="btn-ghost" onClick={handleAttach} disabled={busy !== null}>
            {busy === "attach" ? "Opening Drive…" : "Link a sheet as a board"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Small Google-Sheets-style tile; notes collections get a warm paper variant. */
function SheetGlyph({ kind }: { kind: CollectionKind }) {
  if (kind === "notes") {
    return (
      <svg className="sheet-glyph" viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="1" width="18" height="18" rx="4" fill="var(--warn)" />
        <path
          d="M5.5 7h9M5.5 10h9M5.5 13h5.5"
          stroke="#fff"
          strokeWidth="1.3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
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

/** Design 5c's little type illustrations: three kanban columns / a 2×2 note grid. */
function BoardKindGlyph() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="10" height="26" rx="2.5" fill="var(--status-backlog-bg)" />
      <rect x="12" y="0" width="10" height="18" rx="2.5" fill="var(--status-progress-bg)" />
      <rect x="24" y="0" width="10" height="22" rx="2.5" fill="var(--status-done-bg)" />
    </svg>
  );
}

function NotesKindGlyph() {
  return (
    <svg width="34" height="26" viewBox="0 0 34 26" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="15" height="12" rx="2.5" fill="var(--warn-bg)" />
      <rect x="19" y="0" width="15" height="16" rx="2.5" fill="var(--bg-subtle)" />
      <rect x="0" y="15" width="15" height="11" rx="2.5" fill="var(--bg-subtle)" />
      <rect x="19" y="19" width="15" height="7" rx="2.5" fill="var(--warn-bg)" />
    </svg>
  );
}
