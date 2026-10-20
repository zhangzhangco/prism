import type { Run, RunStatus, RunTask } from "@prism/contracts";
import type { Db } from "../db.js";
import { newId } from "../ids.js";

export interface RunRow {
  id: string;
  userId: string;
  canvasId: string;
  nodeId: string;
  pluginId: string;
  modelKey: string;
  status: RunStatus;
  params: Record<string, unknown>;
  /**
   * The inputs the run was submitted with, captured at that moment. The
   * worker uses this snapshot rather than re-reading the canvas, so a run
   * cannot pick up changes made while it was queued.
   */
  inputs: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
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
    modelKey: string;
    params: Record<string, unknown>;
    inputs?: Record<string, unknown>;
  }): RunRow {
    const id = newId("run");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs(id, user_id, canvas_id, node_id, plugin_id, model_key, status, params, inputs, error, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, 'queued', ?, ?, NULL, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.canvasId,
        input.nodeId,
        input.pluginId,
        input.modelKey,
        JSON.stringify(input.params),
        input.inputs ? JSON.stringify(input.inputs) : null,
        now,
        now,
      );
    return {
      id,
      userId: input.userId,
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      pluginId: input.pluginId,
      modelKey: input.modelKey,
      status: "queued",
      params: input.params,
      inputs: input.inputs ?? null,
      error: null,
      attempts: 0,
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

  /**
   * Runs that were in flight when the process stopped.
   *
   * A run left in `running` when the worker dies would otherwise sit there
   * for ever, so they are collected on startup and either queued again or
   * failed with a clear reason.
   */
  findInterrupted(): RunRow[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE status = 'running'").all();
    return rows.map((row) => toRun(row as Record<string, unknown>));
  }

  /** Put a run back on the queue for another attempt. */
  requeue(runId: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE runs SET status = 'queued', attempts = attempts + 1, recovered_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(now, now, runId);
  }

  /** Mark a run as impossible to resume. */
  failInterrupted(runId: string, reason: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE runs SET status = 'failed', error = ?, recovered_at = ?, updated_at = ? WHERE id = ?",
      )
      .run(reason, now, now, runId);
  }

  /** How many times a run has been attempted. */
  attemptsFor(runId: string): number {
    const row = this.db.prepare("SELECT attempts FROM runs WHERE id = ?").get(runId);
    return row ? Number((row as { attempts: number }).attempts) : 0;
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
    synthetic?: boolean;
  }): RunTask {
    const id = task.id ?? newId("tsk");
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT id FROM run_tasks WHERE id = ?").get(id);
    if (existing) {
      this.db
        .prepare(
          "UPDATE run_tasks SET status = ?, assets = ?, text = ?, error = ?, synthetic = ?, updated_at = ? WHERE id = ?",
        )
        .run(
          task.status,
          task.assets === undefined ? null : JSON.stringify(task.assets),
          task.text ?? null,
          task.error ?? null,
          task.synthetic ? 1 : 0,
          now,
          id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO run_tasks(id, run_id, key, status, assets, text, error, synthetic, created_at, updated_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          task.runId,
          task.key,
          task.status,
          task.assets === undefined ? null : JSON.stringify(task.assets),
          task.text ?? null,
          task.error ?? null,
          task.synthetic ? 1 : 0,
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
      synthetic: task.synthetic,
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
        synthetic: Number(record.synthetic ?? 0) === 1,
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
    modelKey: String(row.model_key ?? ""),
    status: String(row.status) as RunStatus,
    params,
    inputs: row.inputs ? (JSON.parse(String(row.inputs)) as Record<string, unknown>) : null,
    error: row.error === null ? null : String(row.error),
    attempts: Number(row.attempts ?? 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
