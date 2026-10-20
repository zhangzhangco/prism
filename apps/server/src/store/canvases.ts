import type { CanvasDocument, CanvasSummary } from "@prism/contracts";
import type { Db } from "../db.js";
import { newId } from "../ids.js";

export const EMPTY_DOCUMENT: CanvasDocument = {
  version: 1,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export interface CanvasRow {
  id: string;
  userId: string;
  name: string;
  document: CanvasDocument;
  createdAt: string;
  updatedAt: string;
}

export class CanvasesStore {
  constructor(private readonly db: Db) {}

  list(userId: string): CanvasSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, document, created_at, updated_at
         FROM canvases WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(userId);
    return rows.map((row) => {
      const record = row as Record<string, unknown>;
      const document = parseDocument(String(record.document));
      return {
        id: String(record.id),
        name: String(record.name),
        nodeCount: document.nodes.length,
        createdAt: String(record.created_at),
        updatedAt: String(record.updated_at),
      };
    });
  }

  get(userId: string, canvasId: string): CanvasRow | null {
    const row = this.db
      .prepare("SELECT * FROM canvases WHERE id = ? AND user_id = ?")
      .get(canvasId, userId);
    if (!row) return null;
    const record = row as Record<string, unknown>;
    return {
      id: String(record.id),
      userId: String(record.user_id),
      name: String(record.name),
      document: parseDocument(String(record.document)),
      createdAt: String(record.created_at),
      updatedAt: String(record.updated_at),
    };
  }

  create(userId: string, name: string, document: CanvasDocument = EMPTY_DOCUMENT): CanvasRow {
    const id = newId("cvs");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO canvases(id, user_id, name, document, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, name, JSON.stringify(document), now, now);
    return { id, userId, name, document, createdAt: now, updatedAt: now };
  }

  update(userId: string, canvasId: string, patch: { name?: string; document?: CanvasDocument }): CanvasRow | null {
    const existing = this.get(userId, canvasId);
    if (!existing) return null;
    const name = patch.name?.trim() || existing.name;
    const document = patch.document ?? existing.document;
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE canvases SET name = ?, document = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .run(name, JSON.stringify(document), now, canvasId, userId);
    return { ...existing, name, document, updatedAt: now };
  }

  remove(userId: string, canvasId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM canvases WHERE id = ? AND user_id = ?")
      .run(canvasId, userId);
    return Number(result.changes) > 0;
  }
}

export function parseDocument(raw: string): CanvasDocument {
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDocument>;
    return {
      version: 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      viewport: parsed.viewport ?? { x: 0, y: 0, zoom: 1 },
      // The outline is part of the document, so it has to survive a
      // round-trip through the store.
      ...(parsed.outline ? { outline: parsed.outline } : {}),
    };
  } catch {
    return EMPTY_DOCUMENT;
  }
}
