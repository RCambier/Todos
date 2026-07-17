import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { STATUSES, type Task } from "@todos/sheet-core";
import { z } from "zod";
import * as board from "./board.js";
import type { SheetStore } from "./sheetsClient.js";

const statusSchema = z.enum(STATUSES);

function taskText(task: Task): string {
  return JSON.stringify(task, null, 2);
}

function errorResult(err: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Registers the six board tools on an MCP server. Every mutation re-locates its row by id. */
export function registerTools(server: McpServer, client: SheetStore): void {
  server.tool(
    "list_tasks",
    "List tasks on the Todos board, in board order (backlog, then in_progress, then done; " +
      "top to bottom within each). Optionally filter to a single status.",
    { status: statusSchema.optional().describe("Only return tasks in this column.") },
    async ({ status }) => {
      try {
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
      title: z.string().min(1, "title is required"),
      notes: z.string().optional(),
      status: statusSchema.optional().describe("Defaults to backlog."),
    },
    async ({ title, notes, status }) => {
      try {
        const task = await board.addTask(client, { title, notes, status });
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "update_task",
    "Edit a task's title and/or notes. Fields you omit are left unchanged. Get the id from list_tasks.",
    {
      id: z.string().min(1),
      title: z.string().min(1).optional(),
      notes: z.string().optional(),
    },
    async ({ id, title, notes }) => {
      try {
        const task = await board.updateTask(client, id, { title, notes });
        return { content: [{ type: "text", text: taskText(task) }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "move_task",
    "Move a task to a different column, placing it at the top of that column.",
    { id: z.string().min(1), status: statusSchema },
    async ({ id, status }) => {
      try {
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
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
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
    { id: z.string().min(1) },
    async ({ id }) => {
      try {
        await board.deleteTask(client, id);
        return { content: [{ type: "text", text: `Deleted task ${id}.` }] };
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
