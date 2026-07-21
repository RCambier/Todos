import type { Note } from "@memoria/sheet-core";
import { useState } from "react";
import { formatDueDate, formatShortDate, localToday } from "../lib/dates.js";
import { noteImages, type NoteImage } from "../lib/noteImages.js";
import { useTagColors } from "../lib/tagColor.js";
import { AddFab } from "./AddFab.js";
import { AgentMark } from "./AgentMark.js";
import { DriveImage, Markdown } from "./Markdown.js";
import { TagChip } from "./TagChip.js";

/** The grid's provenance filter — design 5a's chip row. */
type NotesFilter = "all" | "user" | "agent";

/** What the grid renders: a note, or anything note-shaped with tags and an expiry (an AI memory). */
type NoteLike = Note & { tags?: string[]; expiresAt?: string };

/** A memory's expiry marker for the card meta row, or null when there is none. */
function expiryLabel(item: NoteLike, today: string): { text: string; expired: boolean } | null {
  if (!item.expiresAt) return null;
  const expired = item.expiresAt < today;
  return { text: expired ? "Expired" : `Until ${formatDueDate(item.expiresAt)}`, expired };
}

/** The grid's user-facing wording — the AI Memories view swaps in its own. */
export interface NotesGridCopy {
  /** Capture bar text and the mobile FAB label. */
  capture: string;
  /** Empty-state line when the sheet has no items at all. */
  emptyAll: string;
  /** Plural noun for the filtered empty state ("notes", "memories"). */
  noun: string;
}

const NOTES_COPY: NotesGridCopy = {
  capture: "Take a note…",
  emptyAll: "No notes yet. Use the bar above to take one.",
  noun: "notes",
};

interface NotesGridProps {
  notes: NoteLike[];
  /** Null while the session restores — drive: images wait; everything else renders. */
  token: string | null;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  /** Defaults to the Notes wording. */
  copy?: NotesGridCopy;
}

function editedLabel(note: NoteLike): string {
  const edited = formatShortDate(note.updatedAt);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  if (edited === formatShortDate(today.toISOString())) return "today";
  if (edited === formatShortDate(yesterday.toISOString())) return "yesterday";
  return edited;
}

/**
 * The Notes view — design 5a: capture bar, provenance filter chips, and a
 * Keep-style masonry grid. Agent-written notes carry the warm paper tint and
 * the ✳ chip; yours stay plain. Also serves the AI Memories grid (same
 * shape plus tag chips), with its own `copy`.
 */
export function NotesGrid({ notes, token, readOnly, onOpen, onCreate, copy = NOTES_COPY }: NotesGridProps) {
  const [filter, setFilter] = useState<NotesFilter>("all");
  const tagClass = useTagColors();
  const today = localToday();

  const visible = filter === "all" ? notes : notes.filter((n) => n.source === filter);

  return (
    <div className="notes-view">
      <div className="notes-toolbar">
        <button
          type="button"
          className="notes-capture"
          onClick={onCreate}
          disabled={readOnly}
          aria-label={copy.capture.replace(/…$/, "")}
        >
          {copy.capture}
        </button>
        <div className="notes-filters" role="group" aria-label="Filter notes">
          <button
            type="button"
            className={`notes-filter${filter === "all" ? " active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            className={`notes-filter${filter === "user" ? " active" : ""}`}
            onClick={() => setFilter("user")}
          >
            By you
          </button>
          <button
            type="button"
            className={`notes-filter${filter === "agent" ? " active" : ""}`}
            onClick={() => setFilter("agent")}
          >
            <AgentMark /> By agents
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="notes-empty">
          {notes.length === 0 ? (
            <p>{copy.emptyAll}</p>
          ) : (
            <p>
              No {filter === "agent" ? "agent" : "your"} {copy.noun} here.
            </p>
          )}
        </div>
      ) : (
        <div className="notes-grid">
          {visible.map((note) => {
            const { images, text } = noteImages(note.body);
            const hasText = text.trim() !== "";
            const expiry = expiryLabel(note, today);
            return (
              // A div, not a button: the body renders real markdown (block
              // elements, links, checkboxes), which can't nest in a button.
              <div
                role="button"
                tabIndex={0}
                key={note.id}
                className={`note-card${note.source === "agent" ? " agent" : ""}${images.length > 0 ? " has-thumb" : ""}${expiry?.expired ? " expired" : ""}`}
                onClick={() => onOpen(note.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(note.id);
                  }
                }}
              >
                {/* Design 10b: text is the hero on the left; images collapse
                    into one 56px thumbnail on the right with a +N badge. */}
                <div className="note-card-text">
                  {note.title && <span className="note-card-title">{note.title}</span>}
                  {hasText && (
                    <div className="note-card-md">
                      <Markdown text={text} token={token} />
                    </div>
                  )}
                  {!note.title && !hasText && images.length === 0 && (
                    <span className="note-card-body empty">Empty {copy.noun.replace(/s$/, "")}</span>
                  )}
                  {note.tags && note.tags.length > 0 && (
                    <span className="card-tags">
                      {note.tags.map((t) => (
                        <TagChip key={t} name={t} colorClass={tagClass(t)} />
                      ))}
                    </span>
                  )}
                  <span className="note-card-meta">
                    {note.source === "agent" && (
                      <span className="chip">
                        <AgentMark /> agent
                      </span>
                    )}
                    <span className="note-card-date">Edited {editedLabel(note)}</span>
                    {expiry && (
                      <span className={`note-expiry${expiry.expired ? " lapsed" : ""}`}>{expiry.text}</span>
                    )}
                  </span>
                </div>
                {images.length > 0 && (
                  <NoteThumb image={images[0]!} extra={images.length - 1} token={token} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mobile-only "+" — the capture bar's counterpart on small screens. */}
      {!readOnly && <AddFab label={copy.capture.replace(/…$/, "")} onClick={onCreate} />}
    </div>
  );
}

/** The 56px side thumbnail (design 10b): first image, with a +N badge for the rest. */
function NoteThumb({ image, extra, token }: { image: NoteImage; extra: number; token: string | null }) {
  return (
    <div className="note-thumb" aria-hidden="true">
      {image.src.startsWith("drive:") ? (
        <DriveImage
          fileId={image.src.slice("drive:".length)}
          alt={image.alt}
          token={token}
          className="note-thumb-img"
          displayPx={112}
        />
      ) : (
        <img className="note-thumb-img" src={image.src} alt={image.alt} referrerPolicy="no-referrer" />
      )}
      {extra > 0 && <span className="note-thumb-badge">+{extra}</span>}
    </div>
  );
}
