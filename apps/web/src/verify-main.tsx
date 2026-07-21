// Dev-only verification harness entry (see verify.html). Mounts the REAL App
// with every network call stubbed, so auth, the board shelf, board flows, and
// notes flows can be driven end-to-end without Google. Not part of the
// production build.
//
// The stubbed world: a signed-in session, one account with two boards
// ("Todos" — the cached one — and "Groceries") plus a "Notes" collection, a
// Todos board holding one task per column, and a Notes sheet holding three
// notes (one agent-written, one carrying a drive: image attachment). The
// Sheets stub is a real fake backend: per-tab in-memory grids that
// append/update/delete rows exactly like the API, so flushed mutations
// survive the next poll. Drive is stubbed far enough for the folder
// organizer, attachment upload (uploaded images echo back a tiny PNG), and
// attachment download. Every write is also recorded on `window.__sheetWrites`
// / `window.__driveWrites` — stubbed calls never reach the network, so
// browser-level request interception won't see them.
//
// Offline simulation: `window.__setOffline(true)` (or loading with
// `?offline=1`) makes every stubbed Google/auth call reject like a dead
// network, without touching the page's real connectivity.
import { createRoot } from "react-dom/client";
import {
  HEADERS,
  NOTES_APP_PROPERTY_KEY,
  NOTES_HEADERS,
  noteToRow,
  taskToRow,
  type Note,
  type Task,
} from "@memoria/sheet-core";
import { App } from "./App.js";
import "./styles.css";

interface FakeGTask {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: string;
}

declare global {
  interface Window {
    /** Every stubbed Sheets write, in order — the harness's assertion surface. */
    __sheetWrites: { method: string; url: string; body: string | null }[];
    /** Every stubbed Drive mutation (folder create, move, upload). */
    __driveWrites: { method: string; url: string }[];
    /** Simulate a dead network for all stubbed calls. */
    __setOffline: (offline: boolean) => void;
    /** The fake backend's current Tasks grid (header + rows) — for assertions. */
    __grid: () => string[][];
    /** The fake Google Tasks store: listId → tasks. */
    __gtasks: () => Record<string, FakeGTask[]>;
    /** The fake backend's current Notes grid (header + rows) — for assertions. */
    __notesGrid: () => string[][];
  }
}

const now = new Date().toISOString();

function task(id: string, title: string, status: Task["status"], dueDate = "", tags: string[] = []): Task {
  return {
    id,
    title,
    status,
    sortOrder: 1,
    notes: "",
    source: "user",
    createdAt: now,
    updatedAt: now,
    dueDate,
    blockedUntil: "",
    recurs: "" as const,
    tags,
  };
}

function note(id: string, title: string, body: string, source: Note["source"], updatedAt = now): Note {
  return { id, title, body, source, createdAt: updatedAt, updatedAt };
}

const grid: string[][] = [
  [...HEADERS],
  taskToRow(task("t1", "Write the report", "backlog", "2026-07-21", ["revolut"])),
  taskToRow(task("t2", "Ship it", "in_progress", "", ["anthropic"])),
  taskToRow(task("t3", "Old done thing", "done")),
];

const notesGrid: string[][] = [
  [...NOTES_HEADERS],
  noteToRow(
    note(
      "n1",
      "Flat handover checklist",
      "- [ ] Meter readings photo\n- [x] Keys ×3 (spare with Dan)\n- [ ] Council tax final bill",
      "user",
      new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    ),
  ),
  noteToRow(
    note(
      "n2",
      "SF trip — logistics",
      "Flight **UA901** out 24 Jul, back 2 Aug.\nHotel near Mission — booking ref in email.\n\n> ESTA pending the invitation letter (chase Friday).\n\nMore at https://example.com/esta",
      "agent",
      new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ),
  ),
  noteToRow(
    note(
      "n3",
      "Whiteboard from the pension call",
      "The three SIPP options compared:\n\n![whiteboard](drive:att-seed)\n\nVanguard cheapest at `0.15%`.",
      "user",
      new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    ),
  ),
];

// A 1×1 red PNG — what attachment downloads return.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG = Uint8Array.from(atob(TINY_PNG_B64), (c) => c.charCodeAt(0));
/** What the thumbnailLink stub serves — a data URL, so <img> loads need no interception. */
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

let offline = new URLSearchParams(window.location.search).get("offline") === "1";
window.__setOffline = (v: boolean) => {
  offline = v;
  if (!v) window.dispatchEvent(new Event("online"));
};
window.__sheetWrites = [];
window.__driveWrites = [];
window.__grid = () => grid.map((r) => [...r]);
window.__notesGrid = () => notesGrid.map((r) => [...r]);

let uploadCounter = 0;

// ---- Fake Drive file store (the tagged collections the listing serves) ----
// `?nokind=notes` (or `board`) omits that kind's sheets, so the empty-tab
// setup (design 9b) can be driven.
const noKind = new URLSearchParams(window.location.search).get("nokind");
const allDriveFiles: { id: string; name: string; appProperties: Record<string, string> }[] = [
  { id: "sheet-1", name: "Todos", appProperties: { todosBoard: "1" } },
  { id: "sheet-2", name: "Groceries", appProperties: { todosBoard: "1" } },
  { id: "sheet-3", name: "Notes", appProperties: { [NOTES_APP_PROPERTY_KEY]: "1" } },
];
const driveFiles = allDriveFiles.filter((f) =>
  noKind === "notes"
    ? f.appProperties[NOTES_APP_PROPERTY_KEY] === undefined
    : noKind === "board"
      ? f.appProperties["todosBoard"] === undefined
      : true,
);

// ---- Fake Google Tasks backend (for the calendar mirror) ----
const gtaskLists: { id: string; title: string }[] = [];
const gtasksByList: Record<string, FakeGTask[]> = {};
let gtaskSeq = 0;
window.__gtasks = () => JSON.parse(JSON.stringify(gtasksByList)) as Record<string, FakeGTask[]>;

/** Row number (1-indexed) from a `Tasks!A5:J5`-style range in a values URL. */
function rowNumberFromUrl(url: string): number | null {
  const m = /values\/[^?]*%21A(\d+)/.exec(url) ?? /values\/[^?]*!A(\d+)/.exec(decodeURIComponent(url));
  return m ? Number(m[1]) : null;
}

/** Which fake grid a values URL addresses (the tab name is in the range). */
function gridForUrl(url: string): string[][] {
  return decodeURIComponent(url).includes("Notes!") ? notesGrid : grid;
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const stubbed = url.includes("/api/auth/") || url.includes("googleapis.com") || url.includes("userinfo");
  if (!stubbed) return realFetch(input, init);
  if (offline) throw new TypeError("Failed to fetch (harness offline)");

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  if (url.includes("/api/auth/session"))
    return json({
      access_token: "tok",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/tasks",
    });
  if (url.includes("userinfo")) return json({ name: "Test User", email: "t@example.com", picture: "" });

  if (url.includes("googleapis.com/upload/drive")) {
    window.__driveWrites.push({ method: init?.method ?? "POST", url });
    return json({ id: `att-${++uploadCounter}`, name: `pasted-${uploadCounter}.png` });
  }

  if (url.includes("googleapis.com/drive")) {
    const method = init?.method ?? "GET";
    if (method === "GET" && url.includes("fields=thumbnailLink")) {
      return json({ thumbnailLink: TINY_PNG_DATA_URL });
    }
    if (method === "GET" && url.includes("alt=media")) {
      return new Response(TINY_PNG, { status: 200, headers: { "Content-Type": "image/png" } });
    }
    if (method === "GET" && url.includes("fields=parents")) {
      // Everything already lives in the Memoria tree — the organizer stays quiet.
      return json({ parents: ["folder-managed"] });
    }
    if (method === "GET" && decodeURIComponent(url).includes("folder")) {
      return json({ files: [{ id: "folder-managed" }] });
    }
    if (method === "POST") {
      window.__driveWrites.push({ method, url });
      return json({ id: "folder-created" });
    }
    if (method === "PATCH") {
      window.__driveWrites.push({ method, url });
      // Untag (appProperties key → null) really untags, so the setup
      // screen's unlink flow survives the refetch it triggers.
      const patch = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const props = patch.appProperties as Record<string, string | null> | undefined;
      const fileId = /files\/([^?/]+)/.exec(url)?.[1];
      const file = driveFiles.find((f) => f.id === fileId);
      if (props && file) {
        for (const [key, value] of Object.entries(props)) {
          if (value === null) delete file.appProperties[key];
          else file.appProperties[key] = value;
        }
      }
      return json({ id: "patched" });
    }
    return json({
      files: driveFiles
        .filter((f) => Object.keys(f.appProperties).length > 0)
        .map((f) => ({ id: f.id, name: f.name, modifiedTime: now, appProperties: f.appProperties })),
    });
  }

  if (url.includes("tasks.googleapis.com")) {
    const method = init?.method ?? "GET";
    const body: Partial<FakeGTask> =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Partial<FakeGTask>) : {};
    if (url.includes("/users/@me/lists")) {
      if (method === "POST") {
        const list = { id: `list-${++gtaskSeq}`, title: body.title ?? "" };
        gtaskLists.push(list);
        gtasksByList[list.id] = [];
        return json(list);
      }
      return json({ items: gtaskLists });
    }
    const listMatch = /\/lists\/([^/]+)\/tasks(?:\/([^/?]+))?/.exec(url);
    if (listMatch) {
      const tasks = (gtasksByList[listMatch[1]!] ??= []);
      const taskId = listMatch[2];
      if (method === "GET") return json({ items: tasks });
      if (method === "POST") {
        const created: FakeGTask = { status: "needsAction", ...body, id: `gt-${++gtaskSeq}` };
        tasks.push(created);
        return json(created);
      }
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (method === "PATCH" && idx !== -1) {
        tasks[idx] = { ...tasks[idx]!, ...body };
        return json(tasks[idx]);
      }
      if (method === "DELETE" && idx !== -1) {
        tasks.splice(idx, 1);
        return json({});
      }
      return json({});
    }
    return json({});
  }

  if (url.includes("sheets.googleapis.com")) {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      // getTabSheetId probes spreadsheet properties; everything else reads values.
      if (url.includes("fields=sheets.properties"))
        return json({
          sheets: [
            { properties: { title: "Tasks", sheetId: 0 } },
            { properties: { title: "Notes", sheetId: 1 } },
          ],
        });
      return json({ values: gridForUrl(url).map((r) => [...r]) });
    }

    const body = typeof init?.body === "string" ? init.body : null;
    window.__sheetWrites.push({ method, url, body });
    const payload = body ? (JSON.parse(body) as Record<string, unknown>) : {};

    // createSpreadsheet: a bare POST to the spreadsheets collection. The new
    // sheet joins the fake Drive store (untagged — the tag PATCH follows),
    // so it shows up in later listings exactly like production.
    if (method === "POST" && !url.includes(":append") && !url.includes(":batchUpdate")) {
      const id = `sheet-created-${++uploadCounter}`;
      const title = (payload.properties as { title?: string } | undefined)?.title ?? "Created";
      driveFiles.push({ id, name: title, appProperties: {} });
      return json({ spreadsheetId: id });
    }
    const target = gridForUrl(url);

    if (url.includes(":append")) {
      target.push((payload.values as string[][])[0]!);
    } else if (method === "PUT") {
      const n = rowNumberFromUrl(url);
      if (n) target[n - 1] = (payload.values as string[][])[0]!;
    } else if (url.includes(":batchUpdate")) {
      const requests = payload.requests as
        | { deleteDimension?: { range?: { sheetId?: number; startIndex?: number; endIndex?: number } } }[]
        | undefined;
      const range = requests?.[0]?.deleteDimension?.range;
      if (range?.startIndex !== undefined) {
        (range.sheetId === 1 ? notesGrid : grid).splice(range.startIndex, 1);
      }
    }
    return json({});
  }

  return realFetch(input, init);
};

localStorage.setItem("todos:spreadsheetId", "sheet-1");
localStorage.setItem("todos:collectionKind", "board");
// The organizer memo — the fixture pretends everything is already filed.
localStorage.setItem("todos:organizedFiles:v2", JSON.stringify(["sheet-1", "sheet-2", "sheet-3"]));

createRoot(document.getElementById("root")!).render(<App />);
