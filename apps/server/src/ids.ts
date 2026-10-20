import { randomBytes, randomUUID } from "node:crypto";

/** Short, sortable-ish identifier with a type prefix. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 22)}`;
}

/** URL-safe random token, used for API credentials. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
