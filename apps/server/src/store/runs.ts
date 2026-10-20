import type { Run, RunStatus, RunTask } from "@prism/contracts";
import type { Db } from "../db.js";
import { newId } from "../ids.js";

export interface RunRow {
  id: string;
  userId: string;
  canvasId: string;
  nodeId: string;
  pluginId: string;
  status: RunStatus;
  params: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export class RunsStore {
  constructor(private readonly db: Db) {}

  create(input: {
    userId: string;
    canvasId: string;
    nodeId: string;
    pluginId: string;
    params: Record<string, unknown>;
  }): RunRow {
    const id = newId("run");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs(id, user_id, canvas_id, node_id, plugin_id, status, params, error, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, 'queued', ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.canvasId,
        input.nodeId,
        input.pluginId,
        JSON.stringify(input.params),
        now,
        now,
      );
    return {
      id,
      userId: input.userId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      pluginId: input.pluginId,
      status: "queued",
      params: input.params,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  get(userId: string, runId: string): RunRow | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ? AND user_id = ?").get(runId, userId);
    return row ? toRun(row as Record<string, unknown>) : null;
  }

  /** Look up a run without knowing its owner. Used by the worker. */
  getById(runId: string): RunRow | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    return row ? toRun(row as Record<string, unknown>) : null;
  }

  listForCanvas(userId: string, canvasId: string, limit = 50): RunRow[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE user_id = ? AND canvas_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, canvasId, limit);
    return rows.map((row) => toRun(row as Record<string, unknown>));
  }

  /** Runs that are waiting for a worker slot, oldest first. */
  claimQueued(limit: number): RunRow[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
      .all(limit);
    return rows.map((row) => toRun(row as Record<string, unknown>));
  }

  setStatus(runId: string, status: RunStatus, error: string | null = null): void {
    this.db
      .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(status, error, new Date().toISOString(), runId);
  }

  upsertTask(task: {
    id?: string;
    runId: string;
    key: string;
    status: RunStatus;
    assets?: unknown;
    text?: string;
    error?: string;
  }): RunTask {
    const id = task.id ?? newId("tsk");
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM run_tasks WHERE id = ?").get(id);
    if (existing) {
      this.db
        .prepare(
          "UPDATE run_tasks SET status = ?, assets = ?, text = ?, error = ?, updated_at = ? WHERE id = ?",
        )
        .run(task.status, task.assets === undefined ? null : JSON.stringify(task.assets), task.text ?? null, task.error ?? null, now, id);
    } else {
      this.db
        .prepare(
          `INSERT INTO run_tasks(id, run_id, key, status, assets, text, error, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          task.runId,
          task.key,
          task.status,
          task.assets === undefined ? null : JSON.stringify(task.assets),
          task.text ?? null,
          task.error ?? null,
          now,
          now,
        );
    }
    return {
      id,
      key: task.key,
      status: task.status,
      assets: task.assets as RunTask["assets"],
      text: task.text,
      error: task.error,
    };
  }

  listTasks(runId: string): RunTask[] {
    const rows = this.db
      .prepare("SELECT * FROM run_tasks WHERE run_id = ? ORDER BY created_at ASC")
      .all(runId);
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: String(record.id),
        key: String(record.key),
        status: String(record.status) as RunStatus,
        assets: record.assets ? JSON.parse(String(record.assets)) : undefined,
        text: record.text === null ? undefined : String(record.text),
        error: record.error === null ? undefined : String(record.error),
      } as RunTask;
    });
  }
}

function toRun(row: Record<string, unknown>): RunRow {
  let params: Record<string, unknown> = {};
  try {
    params = JSON.parse(String(row.params)) as Record<string, unknown>;
  } catch {
    params = {};
  }
  return {
    id: String(row.id),
    userId: String(row.user_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    pluginId: String(row.plugin_id),
    status: String(row.status) as RunStatus,
    params,
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
