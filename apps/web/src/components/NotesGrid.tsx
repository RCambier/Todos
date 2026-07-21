import type { Note } from "@memoria/sheet-core";
import { useState } from "react";
import { formatShortDate } from "../lib/dates.js";
import { noteImages, type NoteImage } from "../lib/noteImages.js";
import { AddFab } from "./AddFab.js";
import { AgentMark } from "./AgentMark.js";
import { DriveImage, Markdown } from "./Markdown.js";

/** The grid's provenance filter — design 5a's chip row. */
type NotesFilter = "all" | "user" | "agent";

interface NotesGridProps {
  notes: Note[];
  /** Null while the session restores — drive: images wait; everything else renders. */
  token: string | null;
  readOnly: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
}

function editedLabel(note: Note): string {
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
 * the ✳ chip; yours stay plain.
 */
export function NotesGrid({ notes, token, readOnly, onOpen, onCreate }: NotesGridProps) {
  const [filter, setFilter] = useState<NotesFilter>("all");

  const visible = filter === "all" ? notes : notes.filter((n) => n.source === filter);

  return (
    <div className="notes-view">
      <div className="notes-toolbar">
        <button
          type="button"
          className="notes-capture"
          onClick={onCreate}
          disabled={readOnly}
          aria-label="Take a note"
        >
          Take a note…
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
            <p>No notes yet. Use the bar above to take one.</p>
          ) : (
            <p>No {filter === "agent" ? "agent" : "your"} notes here.</p>
          )}
        </div>
      ) : (
        <div className="notes-grid">
          {visible.map((note) => {
            const { images, text } = noteImages(note.body);
            const hasText = text.trim() !== "";
            return (
              // A div, not a button: the body renders real markdown (block
              // elements, links, checkboxes), which can't nest in a button.
              <div
                role="button"
                tabIndex={0}
                key={note.id}
                className={`note-card${note.source === "agent" ? " agent" : ""}${images.length > 0 ? " has-thumb" : ""}`}
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
                    <span className="note-card-body empty">Empty note</span>
                  )}
                  <span className="note-card-meta">
                    {note.source === "agent" && (
                      <span className="chip">
                        <AgentMark /> agent
                      </span>
                    )}
                    <span className="note-card-date">Edited {editedLabel(note)}</span>
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
      {!readOnly && <AddFab label="Take a note" onClick={onCreate} />}
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
