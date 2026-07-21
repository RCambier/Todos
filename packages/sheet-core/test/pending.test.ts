import { describe, expect, it } from "vitest";
import { applyPending, enqueueOp, type PendingOp } from "../src/pending.js";
import type { Task } from "../src/types.js";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    status: "backlog",
    sortOrder: 1,
    notes: "",
    source: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dueDate: "",
    blockedUntil: "",
    tags: [],
    recurs: "",
    ...overrides,
  };
}

const AT = "2026-07-19T12:00:00.000Z";

describe("applyPending", () => {
  it("returns the replica untouched for an empty queue", () => {
    const replica = [task("a"), task("b")];
    expect(applyPending(replica, [])).toEqual(replica);
  });

  it("never mutates the replica it was given", () => {
    const replica = [task("a")];
    applyPending(replica, [{ kind: "edit", id: "a", patch: { title: "X" }, at: AT }]);
    expect(replica[0]!.title).toBe("Task a");
  });

  it("appends a pending add", () => {
    const out = applyPending([task("a")], [{ kind: "add", task: task("new") }]);
    expect(out.map((t) => t.id)).toEqual(["a", "new"]);
  });

  it("skips an add whose id already landed in the replica (flushed, then polled)", () => {
    const out = applyPending([task("a")], [{ kind: "add", task: task("a", { title: "dup" }) }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("Task a");
  });

  it("applies an edit's patch and stamps updatedAt", () => {
    const out = applyPending(
      [task("a")],
      [{ kind: "edit", id: "a", patch: { title: "New", tags: ["x"] }, at: AT }],
    );
    expect(out[0]!.title).toBe("New");
    expect(out[0]!.tags).toEqual(["x"]);
    expect(out[0]!.notes).toBe(""); // untouched fields survive
    expect(out[0]!.updatedAt).toBe(AT);
  });

  it("mirrors the either/or schedule rule: an edit setting blockedUntil clears dueDate", () => {
    const out = applyPending(
      [task("a", { dueDate: "2026-08-01" })],
      [{ kind: "edit", id: "a", patch: { blockedUntil: "Trip done" }, at: AT }],
    );
    expect(out[0]!.blockedUntil).toBe("Trip done");
    expect(out[0]!.dueDate).toBe("");
  });

  it("applies a move's status and sortOrder", () => {
    const out = applyPending([task("a")], [{ kind: "move", id: "a", status: "done", sortOrder: -3, at: AT }]);
    expect(out[0]!.status).toBe("done");
    expect(out[0]!.sortOrder).toBe(-3);
  });

  it("completing a yearly dated task in the projection re-dates it, like the real write will", () => {
    const yearly = task("a", { recurs: "yearly", dueDate: "2026-03-01", status: "health_checks" });
    const out = applyPending([yearly], [{ kind: "move", id: "a", status: "done", sortOrder: 0, at: AT }]);
    expect(out[0]!.status).toBe("health_checks"); // stays put
    expect(out[0]!.dueDate).toBe("2027-03-01"); // AT is 2026-07-19 → next 1 Mar is 2027
  });

  it("removes a deleted task", () => {
    const out = applyPending([task("a"), task("b")], [{ kind: "delete", id: "a" }]);
    expect(out.map((t) => t.id)).toEqual(["b"]);
  });

  it("skips ops whose target vanished remotely", () => {
    const ops: PendingOp[] = [
      { kind: "edit", id: "ghost", patch: { title: "X" }, at: AT },
      { kind: "move", id: "ghost", status: "done", sortOrder: 0, at: AT },
      { kind: "delete", id: "ghost" },
    ];
    expect(applyPending([task("a")], ops).map((t) => t.id)).toEqual(["a"]);
  });

  it("chains ops in order: add then edit then move", () => {
    const ops: PendingOp[] = [
      { kind: "add", task: task("n") },
      { kind: "edit", id: "n", patch: { title: "Renamed" }, at: AT },
      { kind: "move", id: "n", status: "in_progress", sortOrder: 0.5, at: AT },
    ];
    const out = applyPending([], ops);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "n", title: "Renamed", status: "in_progress", sortOrder: 0.5 });
  });

  it("survives a stale replica: pending ops re-apply over an older snapshot", () => {
    // The bug this whole layer exists to kill: a poll that predates the add.
    const staleReplica = [task("a")];
    const ops: PendingOp[] = [{ kind: "add", task: task("just-added") }];
    expect(applyPending(staleReplica, ops).map((t) => t.id)).toContain("just-added");
  });
});

describe("enqueueOp", () => {
  it("folds an edit on a pending add into the add", () => {
    const q = enqueueOp([{ kind: "add", task: task("n") }], {
      kind: "edit",
      id: "n",
      patch: { title: "Renamed" },
      at: AT,
    });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "add", task: { title: "Renamed" } });
  });

  it("folds a move on a pending add into the add", () => {
    const q = enqueueOp([{ kind: "add", task: task("n") }], {
      kind: "move",
      id: "n",
      status: "done",
      sortOrder: -1,
      at: AT,
    });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "add", task: { status: "done", sortOrder: -1 } });
  });

  it("delete of a pending add cancels everything for that id", () => {
    let q: PendingOp[] = [];
    q = enqueueOp(q, { kind: "add", task: task("n") });
    q = enqueueOp(q, { kind: "edit", id: "n", patch: { notes: "hi" }, at: AT });
    q = enqueueOp(q, { kind: "delete", id: "n" });
    expect(q).toEqual([]);
  });

  it("merges consecutive edits to the same task, later fields winning", () => {
    let q: PendingOp[] = [];
    q = enqueueOp(q, { kind: "edit", id: "a", patch: { title: "One", notes: "n1" }, at: "t1" });
    q = enqueueOp(q, { kind: "edit", id: "a", patch: { title: "Two" }, at: "t2" });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "edit", patch: { title: "Two", notes: "n1" }, at: "t2" });
  });

  it("keeps only the last of consecutive moves for the same task", () => {
    let q: PendingOp[] = [];
    q = enqueueOp(q, { kind: "move", id: "a", status: "in_progress", sortOrder: 1, at: "t1" });
    q = enqueueOp(q, { kind: "move", id: "a", status: "done", sortOrder: 2, at: "t2" });
    expect(q).toEqual([{ kind: "move", id: "a", status: "done", sortOrder: 2, at: "t2" }]);
  });

  it("does not merge edits to the same task across an op on another task (order preserved)", () => {
    let q: PendingOp[] = [];
    q = enqueueOp(q, { kind: "edit", id: "a", patch: { title: "One" }, at: "t1" });
    q = enqueueOp(q, { kind: "move", id: "b", status: "done", sortOrder: 0, at: "t1" });
    q = enqueueOp(q, { kind: "edit", id: "a", patch: { title: "Two" }, at: "t2" });
    expect(q).toHaveLength(3);
  });

  it("delete drops earlier edits/moves for that id and queues one delete", () => {
    let q: PendingOp[] = [];
    q = enqueueOp(q, { kind: "edit", id: "a", patch: { title: "One" }, at: "t1" });
    q = enqueueOp(q, { kind: "move", id: "a", status: "done", sortOrder: 0, at: "t1" });
    q = enqueueOp(q, { kind: "edit", id: "b", patch: { title: "keep" }, at: "t1" });
    q = enqueueOp(q, { kind: "delete", id: "a" });
    expect(q).toEqual([
      { kind: "edit", id: "b", patch: { title: "keep" }, at: "t1" },
      { kind: "delete", id: "a" },
    ]);
  });

  it("projection of a collapsed queue equals projection of the raw sequence", () => {
    const replica = [task("a"), task("b")];
    const raw: PendingOp[] = [
      { kind: "add", task: task("n") },
      { kind: "edit", id: "n", patch: { title: "N2" }, at: "t1" },
      { kind: "edit", id: "a", patch: { notes: "note" }, at: "t1" },
      { kind: "move", id: "n", status: "done", sortOrder: -1, at: "t2" },
      { kind: "edit", id: "a", patch: { title: "A2" }, at: "t3" },
      { kind: "delete", id: "b" },
    ];
    let collapsed: PendingOp[] = [];
    for (const op of raw) collapsed = enqueueOp(collapsed, op);

    const byId = (ts: Task[]) => [...ts].sort((x, y) => x.id.localeCompare(y.id));
    expect(byId(applyPending(replica, collapsed))).toEqual(byId(applyPending(replica, raw)));
  });
});
