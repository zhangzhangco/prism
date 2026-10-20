import type { Db } from "../db.js";
import { hashToken, hashPassword, verifyPassword } from "../crypto.js";
import { newId, newToken } from "../ids.js";
import type { SessionUser } from "@prism/contracts";

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

function toUser(row: Record<string, unknown>): UserRow {
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    passwordHash: String(row.password_hash),
    createdAt: String(row.created_at),
  };
}

export class UsersStore {
  constructor(private readonly db: Db) {}

  create(input: { email: string; displayName?: string; password: string }): UserRow {
    const id = newId("usr");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users(id, email, display_name, password_hash, created_at)
         VALUES(?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.email.toLowerCase().trim(),
        input.displayName?.trim() || input.email.split("@")[0] || "user",
        hashPassword(input.password),
        now,
      );
    return { id, email: input.email.toLowerCase().trim(), displayName: input.displayName ?? "", passwordHash: "", createdAt: now };
  }

  findByEmail(email: string): UserRow | null {
    const row = this.db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
    return row ? toUser(row as Record<string, unknown>) : null;
  }

  findById(id: string): UserRow | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    return row ? toUser(row as Record<string, unknown>) : null;
  }

  verify(email: string, password: string): UserRow | null {
    const user = this.findByEmail(email);
    if (!user) return null;
    return verifyPassword(password, user.passwordHash) ? user : null;
  }

  issueToken(userId: string): string {
    const token = newToken();
    this.db
      .prepare("INSERT INTO api_tokens(id, user_id, token_hash, created_at) VALUES(?, ?, ?, ?)")
      .run(newId("tok"), userId, hashToken(token), new Date().toISOString());
    return token;
  }

  /** Resolve a bearer token to its owner. */
  resolveToken(token: string): UserRow | null {
    const row = this.db
      .prepare(
        `SELECT u.* FROM api_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.revoked_at IS NULL`,
      )
      .get(hashToken(token));
    return row ? toUser(row as Record<string, unknown>) : null;
  }
}

export function toSessionUser(user: UserRow): SessionUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
