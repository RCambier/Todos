import { orderColumns, slugifyColumnId, type BoardColumn } from "@memoria/sheet-core";
import { useEffect, useState, type CSSProperties } from "react";
import { buildColumnMeta } from "../lib/statusMeta.js";

interface ColumnsSettingsProps {
  /** The board's saved columns (source of truth from the sheet). */
  columns: BoardColumn[];
  /** Last save failure, surfaced inline. */
  saveError: string | null;
  /** Persists a new column set. Resolves on success, rejects on write failure. */
  onSave: (next: BoardColumn[]) => Promise<void>;
}

/** Re-numbers `sortOrder` to match array position, so the saved order is the shown order. */
function renumber(columns: BoardColumn[]): BoardColumn[] {
  return columns.map((c, i) => ({ ...c, sortOrder: i }));
}

/**
 * The board-columns editor: rename, reorder, add, and remove columns, and set
 * the Done / Blocked / Hidden roles. Edits are staged locally and committed
 * with Save (a whole-tab write) — so a half-finished rename never reaches the
 * sheet. Removing a column doesn't touch its tasks; they keep their status and
 * simply reappear if the column is recreated.
 */
export function ColumnsSettings({ columns, saveError, onSave }: ColumnsSettingsProps) {
  const [draft, setDraft] = useState<BoardColumn[]>(() => orderColumns(columns));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Adopt server changes when not mid-edit (a sync, or the initial migration).
  useEffect(() => {
    setDraft((prev) => (dirty(prev, columns) && prev.length > 0 ? prev : orderColumns(columns)));
  }, [columns]);

  const meta = buildColumnMeta(draft);
  const isDirty = dirty(draft, columns);

  function update(index: number, patch: Partial<BoardColumn>): void {
    setDraft((cols) => cols.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    setSaved(false);
  }

  /** Roles Done and Blocked are single-select across the board — setting one clears it elsewhere. */
  function setRole(index: number, role: "done" | "blocked", on: boolean): void {
    setDraft((cols) => cols.map((c, i) => ({ ...c, [role]: on && i === index })));
    setSaved(false);
  }

  function move(index: number, delta: number): void {
    setDraft((cols) => {
      const next = [...cols];
      const target = index + delta;
      if (target < 0 || target >= next.length) return cols;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return renumber(next);
    });
    setSaved(false);
  }

  function remove(index: number): void {
    setDraft((cols) => renumber(cols.filter((_, i) => i !== index)));
    setSaved(false);
  }

  function add(): void {
    setDraft((cols) => {
      const id = slugifyColumnId(
        "New column",
        cols.map((c) => c.id),
      );
      return renumber([
        ...cols,
        { id, label: "New column", sortOrder: cols.length, done: false, blocked: false, hidden: false },
      ]);
    });
    setSaved(false);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      // Drop blank labels back to something usable, and re-number.
      const cleaned = renumber(draft.map((c) => ({ ...c, label: c.label.trim() || c.id })));
      await onSave(cleaned);
      setDraft(orderColumns(cleaned));
      setSaved(true);
    } catch {
      // saveError (from the hook) is rendered below.
    } finally {
      setSaving(false);
    }
  }

  const canSave = isDirty && draft.length > 0 && !saving;

  return (
    <section className="settings-body" aria-label="Board columns">
      <p className="settings-intro">
        Customize your board&rsquo;s columns — rename, reorder, add, or remove them. Mark one as{" "}
        <strong>Done</strong> (where the ✓ and agents&rsquo; complete send tasks), one as{" "}
        <strong>Blocked</strong> (a task gaining a &ldquo;blocked until&rdquo; date moves here), and hide the
        long-horizon ones so the board opens focused. Columns live in a <code>Columns</code> tab on your
        sheet.
      </p>

      <ul className="col-editor">
        {draft.map((column, index) => (
          <li key={column.id} className="col-editor-row">
            <span
              className="col-editor-swatch"
              style={meta.get(column.id)?.style as CSSProperties}
              aria-hidden
            />
            <input
              type="text"
              className="col-editor-name"
              aria-label={`Column ${index + 1} name`}
              value={column.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder="Column name"
            />
            <div className="col-editor-roles">
              <label title="Tasks completed here (the ✓ and agents' complete_task)">
                <input
                  type="checkbox"
                  checked={column.done}
                  onChange={(e) => setRole(index, "done", e.target.checked)}
                />
                Done
              </label>
              <label title="A task gaining a blocked-until date auto-moves here">
                <input
                  type="checkbox"
                  checked={column.blocked}
                  onChange={(e) => setRole(index, "blocked", e.target.checked)}
                />
                Blocked
              </label>
              <label title="Folded away by default, revealed from the board's right edge">
                <input
                  type="checkbox"
                  checked={column.hidden}
                  onChange={(e) => update(index, { hidden: e.target.checked })}
                />
                Hidden
              </label>
            </div>
            <div className="col-editor-actions">
              <button
                type="button"
                aria-label={`Move ${column.label} left`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${column.label} right`}
                disabled={index === draft.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="danger"
                aria-label={`Remove ${column.label}`}
                disabled={draft.length <= 1}
                onClick={() => remove(index)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>

      <button type="button" className="col-editor-add" onClick={add}>
        + Add column
      </button>

      <div className="col-editor-footer">
        <button type="button" className="btn-primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : "Save columns"}
        </button>
        {saved && !isDirty && <span className="status-msg success">Saved</span>}
        {saveError && <span className="status-msg error">{saveError}</span>}
      </div>
    </section>
  );
}

/** True when the draft differs from the saved columns (order, labels, or roles). */
function dirty(draft: BoardColumn[], saved: BoardColumn[]): boolean {
  const a = renumber(draft);
  const b = orderColumns(saved);
  if (a.length !== b.length) return true;
  return a.some((c, i) => {
    const o = b[i]!;
    return (
      c.id !== o.id ||
      c.label.trim() !== o.label ||
      c.done !== o.done ||
      c.blocked !== o.blocked ||
      c.hidden !== o.hidden
    );
  });
}
