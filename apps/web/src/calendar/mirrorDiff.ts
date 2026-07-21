import type { Task } from "@memoria/sheet-core";
import { isDateOnly } from "../lib/dates.js";

/**
 * Pure planning for the Google Tasks mirror (one-way: board → Google).
 *
 * The mirror is entirely DERIVABLE: each mirrored Google Task carries a
 * marker line `[memoria:<boardId>/<taskId>]` in its notes, which is the only
 * join key — no sync state is stored anywhere. Reconcile = read board tasks
 * + read the "Memoria" list, diff, apply. Idempotent; two devices racing
 * converge; deleting the whole list just regenerates it.
 *
 * Rules:
 * - A task is mirrored when it has a date to show on: its due date, or the
 *   date it unblocks (`blockedUntil`). A task carries one or the other, never
 *   both. A blocked-until naming an event ("Trip done") has no date, so it
 *   can't be placed on the Calendar grid and is skipped.
 * - A board task in `done` marks its mirror completed but never creates one.
 * - Mirrors whose board task vanished (deleted, or its date cleared) are
 *   deleted. Duplicate mirrors for one task (a historical race) keep the
 *   first and delete the rest.
 * - Board-scoped: mirrors carrying another board's marker are untouched.
 */

export interface GTaskLite {
  id: string;
  title: string;
  notes: string;
  /** RFC3339; Google keeps only the date part. Empty when unset. */
  due: string;
  status: "needsAction" | "completed";
}

export type MirrorOp =
  | { kind: "create"; title: string; notes: string; due: string }
  | {
      kind: "patch";
      googleId: string;
      fields: Partial<Pick<GTaskLite, "title" | "notes" | "due" | "status">>;
    }
  | { kind: "delete"; googleId: string };

export function mirrorMarker(boardId: string, taskId: string): string {
  return `[memoria:${boardId}/${taskId}]`;
}

const MARKER_RE = /\[memoria:([^/\]]+)\/([^/\]]+)\]/;

/** The board task id a mirrored Google Task belongs to, if its marker matches `boardId`. */
export function markerTaskId(notes: string, boardId: string): string | null {
  const m = MARKER_RE.exec(notes);
  return m && m[1] === boardId ? (m[2] ?? null) : null;
}

function desiredNotes(task: Task, boardId: string): string {
  const marker = mirrorMarker(boardId, task.id);
  return task.notes ? `${task.notes}\n\n${marker}` : marker;
}

/**
 * The date this task should appear on in Google: its due date, or the date it
 * unblocks. Empty when it has neither — including a blocked-until that names
 * an event rather than a date, which has nowhere to sit on a calendar.
 */
export function scheduledDate(task: Task): string {
  if (task.dueDate !== "") return task.dueDate;
  return isDateOnly(task.blockedUntil) ? task.blockedUntil : "";
}

/** Google due timestamps are date-only; compare (and write) just the date. */
function desiredDue(task: Task): string {
  return `${scheduledDate(task)}T00:00:00.000Z`;
}

function sameDue(googleDue: string, date: string): boolean {
  return googleDue.startsWith(date);
}

export function planMirror(
  boardId: string,
  tasks: readonly Task[],
  googleTasks: readonly GTaskLite[],
  /** The board's done-role column id (or null) — tasks there mirror as completed. */
  doneStatus: string | null = "done",
): MirrorOp[] {
  const ops: MirrorOp[] = [];

  // This board's mirrors, first one wins; extras are stale duplicates.
  const mirrorByTaskId = new Map<string, GTaskLite>();
  for (const g of googleTasks) {
    const taskId = markerTaskId(g.notes, boardId);
    if (!taskId) continue;
    if (mirrorByTaskId.has(taskId)) {
      ops.push({ kind: "delete", googleId: g.id });
    } else {
      mirrorByTaskId.set(taskId, g);
    }
  }

  const candidates = tasks.filter((t) => scheduledDate(t) !== "");
  const candidateIds = new Set(candidates.map((t) => t.id));

  for (const task of candidates) {
    const mirror = mirrorByTaskId.get(task.id);
    const status = doneStatus !== null && task.status === doneStatus ? "completed" : "needsAction";

    if (!mirror) {
      if (status === "completed") continue; // never create a mirror just to cross it off
      ops.push({
        kind: "create",
        title: task.title,
        notes: desiredNotes(task, boardId),
        due: desiredDue(task),
      });
      continue;
    }

    const fields: Extract<MirrorOp, { kind: "patch" }>["fields"] = {};
    if (mirror.title !== task.title) fields.title = task.title;
    const notes = desiredNotes(task, boardId);
    if (mirror.notes !== notes) fields.notes = notes;
    if (!sameDue(mirror.due, scheduledDate(task))) fields.due = desiredDue(task);
    if (mirror.status !== status) fields.status = status;
    if (Object.keys(fields).length > 0) ops.push({ kind: "patch", googleId: mirror.id, fields });
  }

  for (const [taskId, mirror] of mirrorByTaskId) {
    if (!candidateIds.has(taskId)) ops.push({ kind: "delete", googleId: mirror.id });
  }

  return ops;
}
