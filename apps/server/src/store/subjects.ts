import type { Subject, SubjectKind, SubjectSpec } from "@prism/contracts";
import type { Db } from "../db.js";
import { newId } from "../ids.js";

export interface SubjectRow {
  id: string;
  userId: string;
  kind: SubjectKind;
  name: string;
  description: string;
  tags: string[];
  data: SubjectSpec;
  thumbnailAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectQuery {
  kind?: SubjectKind;
  /** Matched against the name, the description and the tags. */
  search?: string;
}

export class SubjectsStore {
  constructor(private readonly db: Db) {}

  list(userId: string, query: SubjectQuery = {}): SubjectRow[] {
    const conditions = ["user_id = ?"];
    const values: (string | number)[] = [userId];

    if (query.kind) {
      conditions.push("kind = ?");
      values.push(query.kind);
    }

    if (query.search && query.search.trim()) {
      const needle = `%${query.search.trim().toLowerCase()}%`;
      conditions.push(
        "(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ?)",
      );
      values.push(needle, needle, needle);
    }

    const rows = this.db
      .prepare(
        `SELECT * FROM subjects WHERE ${conditions.join(" AND ")} ORDER BY kind, name COLLATE NOCASE`,
      )
      .all(...values);
    return rows.map((row) => toSubject(row as Record<string, unknown>));
  }

  get(userId: string, subjectId: string): SubjectRow | null {
    const row = this.db
      .prepare("SELECT * FROM subjects WHERE id = ? AND user_id = ?")
      .get(subjectId, userId);
    return row ? toSubject(row as Record<string, unknown>) : null;
  }

  /** Look up several subjects at once, keyed by id. */
  getMany(userId: string, subjectIds: string[]): Map<string, SubjectRow> {
    const found = new Map<string, SubjectRow>();
    for (const id of subjectIds) {
      const subject = this.get(userId, id);
      if (subject) found.set(id, subject);
    }
    return found;
  }

  create(input: {
    userId: string;
    kind: SubjectKind;
    name: string;
    description?: string;
    tags?: string[];
    data: SubjectSpec;
    thumbnailAssetId?: string | null;
  }): SubjectRow {
    const id = newId("sub");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO subjects(id, user_id, kind, name, description, tags, data, thumbnail_asset_id, created_at, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        input.kind,
        input.name.trim(),
        input.description?.trim() ?? "",
        JSON.stringify(input.tags ?? []),
        JSON.stringify(input.data),
        input.thumbnailAssetId ?? null,
        now,
        now,
      );
    return {
      id,
      userId: input.userId,
      kind: input.kind,
      name: input.name.trim(),
      description: input.description?.trim() ?? "",
      tags: input.tags ?? [],
      data: input.data,
      thumbnailAssetId: input.thumbnailAssetId ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  update(
    userId: string,
    subjectId: string,
    patch: {
      name?: string;
      description?: string;
      tags?: string[];
      data?: SubjectSpec;
      thumbnailAssetId?: string | null;
      kind?: SubjectKind;
    },
  ): SubjectRow | null {
    const existing = this.get(userId, subjectId);
    if (!existing) return null;

    const name = patch.name?.trim() || existing.name;
    const description = patch.description ?? existing.description;
    const tags = patch.tags ?? existing.tags;
    const data = patch.data ?? existing.data;
    const thumbnailAssetId =
      patch.thumbnailAssetId === undefined ? existing.thumbnailAssetId : patch.thumbnailAssetId;
    const kind = patch.kind ?? existing.kind;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE subjects SET kind = ?, name = ?, description = ?, tags = ?, data = ?, thumbnail_asset_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        kind,
        name,
        description,
        JSON.stringify(tags),
        JSON.stringify(data),
        thumbnailAssetId,
        now,
        subjectId,
        userId,
      );

    return { ...existing, kind, name, description, tags, data, thumbnailAssetId, updatedAt: now };
  }

  remove(userId: string, subjectId: string): boolean {
    const result = this.db
      .prepare("DELETE FROM subjects WHERE id = ? AND user_id = ?")
      .run(subjectId, userId);
    return Number(result.changes) > 0;
  }
}

function toSubject(row: Record<string, unknown>): SubjectRow {
  let tags: string[] = [];
  let data: SubjectSpec = {} as SubjectSpec;
  try {
    tags = JSON.parse(String(row.tags)) as string[];
  } catch {
    tags = [];
  }
  try {
    data = JSON.parse(String(row.data)) as SubjectSpec;
  } catch {
    data = {} as SubjectSpec;
  }

  return {
    id: String(row.id),
    userId: String(row.user_id),
    kind: String(row.kind) as SubjectKind,
    name: String(row.name),
    description: String(row.description ?? ""),
    tags: Array.isArray(tags) ? tags : [],
    data,
    thumbnailAssetId:
      row.thumbnail_asset_id === null || row.thumbnail_asset_id === undefined
        ? null
        : String(row.thumbnail_asset_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
