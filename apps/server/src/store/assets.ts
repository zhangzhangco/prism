import type { AssetRef } from "@prism/contracts";
import type { Db } from "../db.js";
import { newId } from "../ids.js";

export interface AssetRow {
  id: string;
  userId: string;
  canvasId: string | null;
  mime: string;
  filename: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

export class AssetsStore {
  constructor(private readonly db: Db) {}

  create(input: {
    userId: string;
    canvasId: string | null;
    mime: string;
    filename: string;
    bytes: number;
    width?: number;
    height?: number;
  }): AssetRow {
    const id = newId("ast");
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO assets(id, user_id, canvas_id, mime, filename, bytes, width, height, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.canvasId,
        input.mime,
        input.filename,
        input.bytes,
        input.width ?? null,
        input.height ?? null,
        createdAt,
      );
    return {
      id,
      userId: input.userId,
      canvasId: input.canvasId,
      mime: input.mime,
      filename: input.filename,
      bytes: input.bytes,
      width: input.width ?? null,
      height: input.height ?? null,
      createdAt,
    };
  }

  get(userId: string, assetId: string): AssetRow | null {
    const row = this.db
      .prepare("SELECT * FROM assets WHERE id = ? AND user_id = ?")
      .get(assetId, userId);
    return row ? toAsset(row as Record<string, unknown>) : null;
  }

  listForCanvas(userId: string, canvasId: string): AssetRow[] {
    const rows = this.db
      .prepare("SELECT * FROM assets WHERE user_id = ? AND canvas_id = ? ORDER BY created_at DESC")
      .all(userId, canvasId);
    return rows.map((row) => toAsset(row as Record<string, unknown>));
  }

  /** Every asset the account owns, newest first. */
  listForUser(userId: string, limit = 200): AssetRow[] {
    const rows = this.db
      .prepare("SELECT * FROM assets WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(userId, limit);
    return rows.map((row) => toAsset(row as Record<string, unknown>));
  }
}

function toAsset(row: Record<string, unknown>): AssetRow {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    canvasId: row.canvas_id === null ? null : String(row.canvas_id),
    mime: String(row.mime),
    filename: String(row.filename),
    bytes: Number(row.bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    createdAt: String(row.created_at),
  };
}

export function toAssetRef(row: AssetRow, publicBaseUrl: string): AssetRef {
  return {
    id: row.id,
    url: `${publicBaseUrl.replace(/\/$/, "")}/api/assets/${row.id}`,
    mime: row.mime,
    filename: row.filename,
    bytes: row.bytes,
    ...(row.width ? { width: row.width } : {}),
    ...(row.height ? { height: row.height } : {}),
    createdAt: row.createdAt,
  };
}
