import type { Note } from "@memoria/sheet-core";
import { useState } from "react";
import { formatShortDate } from "../lib/dates.js";
import { markdownPreview } from "../lib/markdown.js";

/** The grid's provenance filter — design 5a's chip row. */
type NotesFilter = "all" | "user" | "agent";

interface NotesGridProps {
  notes: Note[];
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
export function NotesGrid({ notes, readOnly, onOpen, onCreate }: NotesGridProps) {
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
            ✳ By agents
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="notes-empty">
          {notes.length === 0 ? (
            <>
              <p>No notes yet.</p>
              {!readOnly && (
                <button type="button" className="btn-primary btn-sm" onClick={onCreate}>
                  + New note
                </button>
              )}
            </>
          ) : (
            <p>No {filter === "agent" ? "agent" : "your"} notes here.</p>
          )}
        </div>
      ) : (
        <div className="notes-grid">
          {visible.map((note) => {
            const preview = markdownPreview(note.body);
            const hasImage = /!\[[^\]]*\]\((?:https?:\/\/|drive:)/.test(note.body);
            return (
              <button
                type="button"
                key={note.id}
                className={`note-card${note.source === "agent" ? " agent" : ""}`}
                onClick={() => onOpen(note.id)}
              >
                {note.title && <span className="note-card-title">{note.title}</span>}
                {preview && <span className="note-card-body">{preview}</span>}
                {!note.title && !preview && <span className="note-card-body empty">Empty note</span>}
                <span className="note-card-meta">
                  {note.source === "agent" && <span className="chip">✳ agent</span>}
                  {hasImage && (
                    <span className="note-card-img-mark" title="Has image" aria-label="Has image">
                      ▣
                    </span>
                  )}
                  <span className="note-card-date">Edited {editedLabel(note)}</span>
                </span>
              </button>
            );
          })}
          {!readOnly && (
            <button type="button" className="note-card new" onClick={onCreate}>
              + New note
            </button>
          )}
        </div>
      )}
    </div>
  );
}
