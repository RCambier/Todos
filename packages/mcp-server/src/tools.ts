import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as board from "@memoria/sheet-core";
import {
  columnIds,
  doneColumnId,
  MAX_CELL_CHARS,
  type BoardColumn,
  type Memory,
  type Note,
  type Task,
} from "@memoria/sheet-core";
import { z } from "zod";
import {
  resolveBoard,
  resolveBoardWithColumns,
  resolveMemories,
  resolveNotes,
  type MemoriaCatalog,
} from "./catalog.js";

// A status is a column id — customizable per board, so it's validated at call
// time against the board's actual columns rather than pinned to a fixed enum.
const statusSchema = z
  .string()
  .min(1)
  .describe("A column id — call list_boards to see a board's columns. Custom per board.");

/** Human-readable list of a board's columns for an error or description. */
function columnListing(columns: readonly BoardColumn[]): string {
  return columns.map((c) => `${c.id} ("${c.label}")`).join(", ");
}

/** Throws a helpful error if `status` isn't one of the board's column ids. */
function assertKnownStatus(status: string, columns: readonly BoardColumn[]): void {
  if (!columnIds(columns).includes(status)) {
    throw new Error(`"${status}" isn't a column on this board. Valid columns: ${columnListing(columns)}.`);
  }
}

const boardIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Which board to operate on — an id from list_boards. Optional when the account has exactly one board.",
  );

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD")
  .or(z.literal(""))
  .optional()
  .describe("Due date as YYYY-MM-DD; pass an empty string to clear it.");

const blockedUntilSchema = z
  .string()
  .optional()
  .describe(
    'Blocks the task until a date (YYYY-MM-DD) or an event (free text, e.g. "Trip done"). ' +
      "A task has either a due date or a blocked-until, never both — setting one clears the other. " +
      "Pass an empty string to clear it.",
  );

const recursSchema = z
  .enum(board.RECURRENCES)
  .optional()
  .describe(
    '"yearly" makes completing the task advance its date one year instead of finishing it ' +
      '(for renewals and recurring check-ups); pass "" to make it one-off again.',
  );

const tagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .regex(/^[^,]+$/, "tag names can't contain commas"),
  )
  .optional()
  .describe("Labels for the task; replaces the existing set when provided.");

const notesIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Which notes collection to operate on — an id from list_note_collections. Optional when " +
      "the account has exactly one notes collection.",
  );

const memoriesIdSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Which AI Memories collection to operate on — an id from list_memory_collections. Optional " +
      "when the account has exactly one memories collection.",
  );

const memoryTagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .regex(/^[^,]+$/, "tag names can't contain commas"),
  )
  .optional()
  .describe(
    "Labels categorizing the memory; replaces the existing set when provided. Prefer the " +
      'shared vocabulary — "profile", "preferences", "work", "projects", "relationships", ' +
      '"health", "context" — adding specific tags alongside as needed.',
  );

const memoryExpiresSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expires_at must be YYYY-MM-DD")
  .or(z.literal(""))
  .optional()
  .describe(
    "For time-bound facts: the YYYY-MM-DD date after which the fact no longer holds " +
      '(e.g. "in SF until Aug 2" expires 2026-08-02). Omit for facts with no natural end; ' +
      "pass an empty string to clear it.",
  );

function taskText(task: Task): string {
  return JSON.stringify(task, null, 2);
}

function noteText(note: Note): string {
  return JSON.stringify(note, null, 2);
}

function memoryText(memory: Memory): string {
  return JSON.stringify(memory, null, 2);
}

/** Rejects a call that sets both scheduling fields at once — they're mutually exclusive. */
function bothScheduled(due_date?: string, blocked_until?: string): boolean {
  return Boolean(due_date) && Boolean(blocked_until);
}

const BOTH_SCHEDULED_MESSAGE =
  "A task can have a due date or a blocked-until, not both — set only one " +
  '(pass "" to explicitly clear the other).';

function errorResult(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Registers the board, notes, and memories tools on an MCP server. Every
 * task tool resolves its target board first (see `resolveBoard`), every
 * note/memory tool its collection (`resolveNotes` / `resolveMemories`), and
 * every mutation re-locates its row by id.
 *
 * ## Tool naming convention (every new collection kind follows it)
 *
 * For a kind with singular `<x>` and plural `<xs>` (notes → note/notes,
 * memories → memory/memories):
 *
 * - `list_<x>_collections` — the kind's collections (id, name, modified)
 * - `list_<xs>`            — every item in one collection
 * - `add_<x>` / `update_<x>` / `delete_<x>` — item CRUD, one row each
 * - `<xs>_id`              — the optional collection-id parameter
 * - `id`                   — the item-id parameter on every mutation
 *
 * The board tools predate the multi-kind model and keep their historical
 * names as the one documented exception (`list_boards` not
 * `list_task_collections`, `board_id` not `tasks_id`, plus the
 * board-specific verbs `move_task` / `complete_task`) — renaming them would
 * break every connected agent for zero behavioral gain.
 */
export function registerTools(server: McpServer, catalog: MemoriaCatalog): void {
  server.tool(
    "list_boards",
    "List the account's boards (id, name, last modified; newest first) and each board's " +
      "columns. Columns are customizable per board — use their ids as the status value for " +
      "add_task / move_task / list_tasks. Pass a board's id as board_id to the other tools; " +
      "with exactly one board, board_id can be omitted everywhere.",
    {},
    async () => {
      try {
        const boards = await catalog.listBoards();
        const withColumns = await Promise.all(
          boards.map(async (b) => ({
            ...b,
            columns: (await catalog.readColumns(b.id)).map((c) => ({
              id: c.id,
              label: c.label,
              ...(c.done ? { done: true } : {}),
              ...(c.blocked ? { blocked: true } : {}),
              ...(c.hidden ? { hidden: true } : {}),
            })),
          })),
        );
        return { content: [{ type: "text", text: JSON.stringify(withColumns, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_tasks",
    "List tasks on a board, in board order (left-to-right by column, top to bottom within " +
      "each). Columns are customizable — see list_boards. Optionally filter to a single " +
      "status (column id).",
    {
      board_id: boardIdSchema,
      status: statusSchema.optional().describe("Only return tasks in this column (a column id)."),
    },
    async ({ board_id, status }) => {
      try {
        const { store, columns } = await resolveBoardWithColumns(catalog, board_id);
        const tasks = await board.listTasks(store, status, columnIds(columns));
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "add_task",
    "Create a new task and insert it at the top of the given column (a column id; defaults to " +
      "the board's first column). Columns are customizable — see list_boards. Tasks created " +
      "this way are tagged source=agent.",
    {
      board_id: boardIdSchema,
      title: z.string().min(1, "title is required").max(MAX_CELL_CHARS),
      notes: z.string().max(MAX_CELL_CHARS).optional(),
      status: statusSchema.optional().describe("Column id; defaults to the board's first column."),
      due_date: dueDateSchema,
      blocked_until: blockedUntilSchema,
      recurs: recursSchema,
      tags: tagsSchema,
    },
    async ({ board_id, title, notes, status, due_date, blocked_until, recurs, tags }) => {
      try {
        if (bothScheduled(due_date, blocked_until)) throw new Error(BOTH_SCHEDULED_MESSAGE);
        const { store, columns } = await resolveBoardWithColumns(catalog, board_id);
        if (status !== undefined) assertKnownStatus(status, columns);
        const task = await board.addTask(
          store,
          { title, notes, status, dueDate: due_date, blockedUntil: blocked_until, recurs, tags },
          "agent",
          columnIds(columns)[0] ?? board.DEFAULT_STATUS,
        );
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_task",
    "Edit a task's title, notes, due date, blocked-until, and/or tags. Fields you omit are " +
      "left unchanged. Get the id from list_tasks.",
    {
      board_id: boardIdSchema,
      id: z.string().min(1),
      title: z.string().min(1).max(MAX_CELL_CHARS).optional(),
      notes: z.string().max(MAX_CELL_CHARS).optional(),
      due_date: dueDateSchema,
      blocked_until: blockedUntilSchema,
      recurs: recursSchema,
      tags: tagsSchema,
    },
    async ({ board_id, id, title, notes, due_date, blocked_until, recurs, tags }) => {
      try {
        if (bothScheduled(due_date, blocked_until)) throw new Error(BOTH_SCHEDULED_MESSAGE);
        const client = await resolveBoard(catalog, board_id);
        const task = await board.updateTask(client, id, {
          title,
          notes,
          dueDate: due_date,
          blockedUntil: blocked_until,
          recurs,
          tags,
        });
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "move_task",
    "Move a task to a different column (a column id — see list_boards), placing it at the top " +
      "of that column.",
    { board_id: boardIdSchema, id: z.string().min(1), status: statusSchema },
    async ({ board_id, id, status }) => {
      try {
        const { store, columns } = await resolveBoardWithColumns(catalog, board_id);
        assertKnownStatus(status, columns);
        const task = await board.moveTask(store, id, status, undefined, doneColumnId(columns) ?? "done");
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "complete_task",
    "Mark a task done — moves it to the board's Done column (the column with the done role; " +
      "see list_boards). Completing a yearly recurring task advances its date one year " +
      "instead of finishing it.",
    { board_id: boardIdSchema, id: z.string().min(1) },
    async ({ board_id, id }) => {
      try {
        const { store, columns } = await resolveBoardWithColumns(catalog, board_id);
        const done = doneColumnId(columns);
        if (!done) {
          throw new Error(
            "This board has no Done column. Open the web app's board settings and mark a " +
              "column as Done, or use move_task with a specific column id.",
          );
        }
        const task = await board.completeTask(store, id, done);
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_task",
    "Permanently delete a single task row. There is no undo tool — use Google Sheets version " +
      "history to recover if needed.",
    { board_id: boardIdSchema, id: z.string().min(1) },
    async ({ board_id, id }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        await board.deleteTask(client, id);
        return { content: [{ type: "text", text: `Deleted task ${id}.` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_note_collections",
    "List the account's notes collections (id, name, last modified; newest first). A notes " +
      "collection is a grid of small markdown notes, separate from boards. Pass a collection's " +
      "id as notes_id to the note tools; with exactly one collection, notes_id can be omitted.",
    {},
    async () => {
      try {
        const collections = await catalog.listNotesCollections();
        return { content: [{ type: "text", text: JSON.stringify(collections, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_notes",
    "List every note in a notes collection, most recently edited first. Each note has a title " +
      "and a markdown body.",
    { notes_id: notesIdSchema },
    async ({ notes_id }) => {
      try {
        const client = await resolveNotes(catalog, notes_id);
        const notes = await board.listNotes(client);
        return { content: [{ type: "text", text: JSON.stringify(notes, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "add_note",
    "Create a new note. Give it a short title and a markdown body (headings, lists, links, " +
      "bold/italic, code). Notes created this way are tagged source=agent.",
    {
      notes_id: notesIdSchema,
      title: z.string().min(1, "title is required").max(MAX_CELL_CHARS),
      body: z.string().max(MAX_CELL_CHARS).optional().describe("Markdown body of the note."),
    },
    async ({ notes_id, title, body }) => {
      try {
        const client = await resolveNotes(catalog, notes_id);
        const note = await board.addNote(client, { title, body }, "agent");
        return { content: [{ type: "text", text: noteText(note) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_note",
    "Edit a note's title and/or markdown body. Fields you omit are left unchanged; the body " +
      "you pass replaces the whole body. Get the id from list_notes.",
    {
      notes_id: notesIdSchema,
      id: z.string().min(1),
      title: z.string().min(1).max(MAX_CELL_CHARS).optional(),
      body: z
        .string()
        .max(MAX_CELL_CHARS)
        .optional()
        .describe("New markdown body; replaces the existing one."),
    },
    async ({ notes_id, id, title, body }) => {
      try {
        const client = await resolveNotes(catalog, notes_id);
        const note = await board.updateNote(client, id, { title, body });
        return { content: [{ type: "text", text: noteText(note) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_note",
    "Permanently delete a single note row. There is no undo tool — use Google Sheets version " +
      "history to recover if needed.",
    { notes_id: notesIdSchema, id: z.string().min(1) },
    async ({ notes_id, id }) => {
      try {
        const client = await resolveNotes(catalog, notes_id);
        await board.deleteNote(client, id);
        return { content: [{ type: "text", text: `Deleted note ${id}.` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_memory_collections",
    "List the account's AI Memories collections (id, name, last modified; newest first). An AI " +
      "Memories collection stores the facts and memories an AI gathers about its user over time " +
      "— free-text markdown entries with tags, separate from boards and notes. Pass a " +
      "collection's id as memories_id to the memory tools; with exactly one collection, " +
      "memories_id can be omitted.",
    {},
    async () => {
      try {
        const collections = await catalog.listMemoriesCollections();
        return { content: [{ type: "text", text: JSON.stringify(collections, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_memories",
    "List every memory in an AI Memories collection, most recently edited first. Each memory " +
      "has a title, a markdown body, tags, and an optional expires_at date — treat entries " +
      "whose expires_at has passed as stale (update, re-date, or delete them). Check here " +
      "before adding a memory — update the existing entry when a fact changes rather than " +
      "recording it twice.",
    { memories_id: memoriesIdSchema },
    async ({ memories_id }) => {
      try {
        const client = await resolveMemories(catalog, memories_id);
        const memories = await board.listMemories(client);
        return { content: [{ type: "text", text: JSON.stringify(memories, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "add_memory",
    "Record a new memory — one atomic fact worth remembering about the user (a preference, a " +
      "person, context, a decision), stated so it stands alone. Give it a short title, a " +
      "markdown body, tags to categorize, and — for time-bound facts — an expires_at date. " +
      "Memories created this way are tagged source=agent.",
    {
      memories_id: memoriesIdSchema,
      title: z.string().min(1, "title is required").max(MAX_CELL_CHARS),
      body: z.string().max(MAX_CELL_CHARS).optional().describe("Markdown body of the memory."),
      tags: memoryTagsSchema,
      expires_at: memoryExpiresSchema,
    },
    async ({ memories_id, title, body, tags, expires_at }) => {
      try {
        const client = await resolveMemories(catalog, memories_id);
        const memory = await board.addMemory(client, { title, body, tags, expiresAt: expires_at }, "agent");
        return { content: [{ type: "text", text: memoryText(memory) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_memory",
    "Edit a memory's title, markdown body, tags, and/or expiry. Fields you omit are left " +
      "unchanged; the body and tags you pass replace the existing ones. Get the id from " +
      "list_memories.",
    {
      memories_id: memoriesIdSchema,
      id: z.string().min(1),
      title: z.string().min(1).max(MAX_CELL_CHARS).optional(),
      body: z
        .string()
        .max(MAX_CELL_CHARS)
        .optional()
        .describe("New markdown body; replaces the existing one."),
      tags: memoryTagsSchema,
      expires_at: memoryExpiresSchema,
    },
    async ({ memories_id, id, title, body, tags, expires_at }) => {
      try {
        const client = await resolveMemories(catalog, memories_id);
        const memory = await board.updateMemory(client, id, {
          title,
          body,
          tags,
          expiresAt: expires_at,
        });
        return { content: [{ type: "text", text: memoryText(memory) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "delete_memory",
    "Permanently delete a single memory row. There is no undo tool — use Google Sheets version " +
      "history to recover if needed.",
    { memories_id: memoriesIdSchema, id: z.string().min(1) },
    async ({ memories_id, id }) => {
      try {
        const client = await resolveMemories(catalog, memories_id);
        await board.deleteMemory(client, id);
        return { content: [{ type: "text", text: `Deleted memory ${id}.` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
