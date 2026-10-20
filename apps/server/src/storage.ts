import { join } from "node:path";

/**
 * Where an asset's bytes live on disk.
 *
 * Both the upload path and the download path have to agree on this, so the
 * name is derived from the asset id rather than invented at each call site.
 */
export function assetFileName(assetId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "file";
  return `${assetId}--${safe}`;
}

export function assetPath(storageDir: string, userId: string, assetId: string, filename: string): string {
  return join(storageDir, userId, assetFileName(assetId, filename));
}
