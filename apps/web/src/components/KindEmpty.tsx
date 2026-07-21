import { useState } from "react";
import type { Collection, CollectionKind } from "../api/drive.js";
import { pickSpreadsheet } from "../api/picker.js";
import { attachOrBootstrap, createCollection } from "../board/onboarding.js";

interface KindEmptyProps {
  token: string | null;
  kind: CollectionKind;
  /** Other tagged sheets of this kind found in Drive, offered as "connect existing". */
  extras: Collection[];
  onSheetReady: (kind: CollectionKind, id: string) => void;
}

const LABEL: Record<CollectionKind, string> = { board: "Todos", notes: "Notes", memories: "AI Memories" };

/**
 * The empty tab IS the setup (design 9b): no separate screen. When the
 * active kind has no connected sheet, its content area shows this — create a
 * new sheet, link an existing one, or connect a tagged sheet already in
 * Drive. Filling it in place makes the tab spring to life.
 */
export function KindEmpty({ token, kind, extras, onSheetReady }: KindEmptyProps) {
  const [busy, setBusy] = useState<"create" | "attach" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = LABEL[kind];

  async function handleCreate(): Promise<void> {
    if (!token) return;
    setBusy("create");
    setError(null);
    try {
      onSheetReady(kind, await createCollection(token, label, kind));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleAttach(): Promise<void> {
    if (!token) return;
    setBusy("attach");
    setError(null);
    try {
      const fileId = await pickSpreadsheet(token);
      if (!fileId) return;
      const outcome = await attachOrBootstrap(token, fileId, kind);
      if (outcome.kind === "refused") setError(`Can't use that sheet: ${outcome.reason}`);
      else onSheetReady(kind, fileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="kind-empty">
      <SheetGlyph kind={kind} />
      <h2>No {label} sheet yet</h2>
      <p>
        {label} live in a Google Sheet in your Drive, like everything in Memoria.{" "}
        {kind === "memories"
          ? "Create one and your agents can start remembering facts about you — memories are written by agents, curated by you."
          : "Create one and you (or your agents) can start writing to it."}
      </p>

      {error && <div className="first-run-error">{error}</div>}

      <div className="kind-empty-actions">
        <button className="btn-primary" onClick={handleCreate} disabled={busy !== null || !token}>
          {busy === "create" ? "Creating…" : `Create ${label} sheet`}
        </button>
        <button className="btn-link" onClick={handleAttach} disabled={busy !== null || !token}>
          {busy === "attach" ? "Opening Drive…" : "link an existing sheet"}
        </button>
      </div>

      {extras.length > 0 && (
        <div className="kind-empty-extras">
          <span className="kind-empty-extras-label">Or connect one already in your Drive:</span>
          {extras.map((c) => (
            <button
              key={c.id}
              type="button"
              className="board-row"
              onClick={() => onSheetReady(kind, c.id)}
              disabled={busy !== null}
            >
              <SheetGlyph kind={kind} small />
              <span className="board-name">{c.name}</span>
              <span className="board-open">Connect →</span>
            </button>
          ))}
        </div>
      )}

      <p className="kind-empty-note">Takes a second. The file is yours, in your Drive.</p>
    </div>
  );
}

/** Google-Sheets-style tile; notes get the warm-paper variant, memories the accent one. */
function SheetGlyph({ kind, small }: { kind: CollectionKind; small?: boolean }) {
  const size = small ? 20 : 44;
  const fill =
    kind === "memories" ? "var(--accent)" : kind === "notes" ? "var(--warn)" : "var(--status-done)";
  const lines =
    kind === "memories"
      ? "M5.5 7h9M5.5 10h6.5M5.5 13h9"
      : kind === "notes"
        ? "M5.5 7h9M5.5 10h9M5.5 13h5.5"
        : "M5.5 7h9M5.5 10h9M5.5 13h9M8.5 7v8.5";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="sheet-glyph">
      <rect x="1" y="1" width="18" height="18" rx="4" fill={fill} />
      <path d={lines} stroke="#fff" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}
