import { authedFetch, authedJson } from "../api/http.js";
import type { GTaskLite, MirrorOp } from "./mirrorDiff.js";

/**
 * Thin `fetch` wrappers around the Google Tasks API, in the same style as
 * `api/sheets.ts`. All mirrored tasks live in one list named "Memoria"
 * (found by title, created on first use) — board scoping happens via the
 * notes marker, not per-board lists, so renaming a board changes nothing.
 */

const BASE = "https://tasks.googleapis.com/tasks/v1";
export const MEMORIA_LIST_TITLE = "Memoria";

interface TaskListsResponse {
  items?: { id: string; title: string }[];
  nextPageToken?: string;
}

export async function ensureMemoriaList(token: string): Promise<string> {
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await authedJson<TaskListsResponse>(token, `${BASE}/users/@me/lists?${params}`);
    const hit = data.items?.find((l) => l.title === MEMORIA_LIST_TITLE);
    if (hit) return hit.id;
    pageToken = data.nextPageToken;
  } while (pageToken);

  const created = await authedJson<{ id: string }>(token, `${BASE}/users/@me/lists`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: MEMORIA_LIST_TITLE }),
  });
  return created.id;
}

interface TasksResponse {
  items?: { id: string; title?: string; notes?: string; due?: string; status?: string }[];
  nextPageToken?: string;
}

export async function listMirrorTasks(token: string, listId: string): Promise<GTaskLite[]> {
  const all: GTaskLite[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "true",
      showHidden: "true",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await authedJson<TasksResponse>(token, `${BASE}/lists/${listId}/tasks?${params}`);
    for (const item of data.items ?? []) {
      all.push({
        id: item.id,
        title: item.title ?? "",
        notes: item.notes ?? "",
        due: item.due ?? "",
        status: item.status === "completed" ? "completed" : "needsAction",
      });
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  return all;
}

/** Applies one planned mirror op. */
export async function applyMirrorOp(token: string, listId: string, op: MirrorOp): Promise<void> {
  if (op.kind === "create") {
    await authedFetch(token, `${BASE}/lists/${listId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: op.title, notes: op.notes, due: op.due }),
    });
  } else if (op.kind === "patch") {
    await authedFetch(token, `${BASE}/lists/${listId}/tasks/${op.googleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op.fields),
    });
  } else {
    await authedFetch(token, `${BASE}/lists/${listId}/tasks/${op.googleId}`, { method: "DELETE" });
  }
}
