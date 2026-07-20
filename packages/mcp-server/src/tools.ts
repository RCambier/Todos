import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as board from "@memoria/sheet-core";
import { STATUSES, type Note, type Task } from "@memoria/sheet-core";
import { z } from "zod";
import { resolveBoard, resolveNotes, type MemoriaCatalog } from "./catalog.js";

const statusSchema = z.enum(STATUSES);

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

function taskText(task: Task): string {
  return JSON.stringify(task, null, 2);
}

function noteText(note: Note): string {
  return JSON.stringify(note, null, 2);
}

function errorResult(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Registers the board and notes tools on an MCP server. Every task tool
 * resolves its target board first (see `resolveBoard`), every note tool its
 * notes collection (`resolveNotes`), and every mutation re-locates its row
 * by id.
 */
export function registerTools(server: McpServer, catalog: MemoriaCatalog): void {
  server.tool(
    "list_boards",
    "List the account's boards (id, name, last modified; newest first). Pass a board's id as " +
      "board_id to the other tools; with exactly one board, board_id can be omitted everywhere.",
    {},
    async () => {
      try {
        const boards = await catalog.listBoards();
        return { content: [{ type: "text", text: JSON.stringify(boards, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_tasks",
    "List tasks on a board, in board order (backlog, then in_progress, then done; " +
      "top to bottom within each). Optionally filter to a single status.",
    {
      board_id: boardIdSchema,
      status: statusSchema.optional().describe("Only return tasks in this column."),
    },
    async ({ board_id, status }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        const tasks = await board.listTasks(client, status);
        return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "add_task",
    "Create a new task and insert it at the top of the given column (default: backlog). " +
      "Tasks created this way are tagged source=agent.",
    {
      board_id: boardIdSchema,
      title: z.string().min(1, "title is required"),
      notes: z.string().optional(),
      status: statusSchema.optional().describe("Defaults to backlog."),
      due_date: dueDateSchema,
      tags: tagsSchema,
    },
    async ({ board_id, title, notes, status, due_date, tags }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        const task = await board.addTask(client, { title, notes, status, dueDate: due_date, tags }, "agent");
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_task",
    "Edit a task's title, notes, due date, and/or tags. Fields you omit are left unchanged. " +
      "Get the id from list_tasks.",
    {
      board_id: boardIdSchema,
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      notes: z.string().optional(),
      due_date: dueDateSchema,
      tags: tagsSchema,
    },
    async ({ board_id, id, title, notes, due_date, tags }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        const task = await board.updateTask(client, id, { title, notes, dueDate: due_date, tags });
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "move_task",
    "Move a task to a different column, placing it at the top of that column.",
    { board_id: boardIdSchema, id: z.string().min(1), status: statusSchema },
    async ({ board_id, id, status }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        const task = await board.moveTask(client, id, status);
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "complete_task",
    "Mark a task done. Shorthand for move_task with status=done.",
    { board_id: boardIdSchema, id: z.string().min(1) },
    async ({ board_id, id }) => {
      try {
        const client = await resolveBoard(catalog, board_id);
        const task = await board.completeTask(client, id);
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
      title: z.string().min(1, "title is required"),
      body: z.string().optional().describe("Markdown body of the note."),
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
      title: z.string().min(1).optional(),
      body: z.string().optional().describe("New markdown body; replaces the existing one."),
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
}
