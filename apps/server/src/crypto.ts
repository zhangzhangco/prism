import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

interface ScryptParts {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseScrypt(stored: string): ScryptParts | null {
  const parts = stored.split("$");
  if (parts.length !== 6) return null;
  if (parts[0] !== "scrypt") return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return null;

  const salt = Buffer.from(parts[4] ?? "", "base64");
  const hash = Buffer.from(parts[5] ?? "", "base64");
  if (salt.length === 0 || hash.length === 0) return null;

  return { N, r, p, salt, hash };
}

/** Hash a password with scrypt. Format: `scrypt$N$r$p$salt$hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = parseScrypt(stored);
  if (!parts) return false;

  let actual: Buffer;
  try {
    actual = scryptSync(password.normalize("NFKC"), parts.salt, parts.hash.length, {
      N: parts.N,
      r: parts.r,
      p: parts.p,
    });
  } catch {
    return false;
  }
  return actual.length === parts.hash.length && timingSafeEqual(actual, parts.hash);
}

/** SHA-256, used to index bearer tokens so the raw token is never stored. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
