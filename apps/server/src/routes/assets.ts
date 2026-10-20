import { createReadStream, existsSync } from "node:fs";
import { assetPath } from "../storage.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import { readPngSize } from "../png.js";
import type { AssetsStore } from "../store/assets.js";
import { toAssetRef } from "../store/assets.js";
import type { UsersStore } from "../store/users.js";
import { authenticate, currentUserId } from "./auth.js";

export interface AssetRouteContext {
  assets: AssetsStore;
  users: UsersStore;
  config: ServerConfig;
}

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function registerAssetRoutes(app: FastifyInstance, context: AssetRouteContext): void {
  const auth = authenticate(context.users);

  app.get<{ Params: { id: string } }>(
    "/api/assets/:id",
    { preHandler: auth },
    async (request, reply) => {
      const asset = context.assets.get(currentUserId(request), request.params.id);
      if (!asset) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such asset" } });
      }
      const path = assetPath(context.config.storageDir, asset.userId, asset.id, asset.filename);
      if (!existsSync(path)) {
        return reply.code(404).send({ error: { code: "not_found", message: "The file is gone" } });
      }
      return reply
        .header("Content-Type", asset.mime)
        .header("Content-Length", String(asset.bytes))
        .header("Cache-Control", "private, max-age=31536000, immutable")
        .send(createReadStream(path));
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/canvases/:id/assets",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const file = await request.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
      if (!file) {
        return reply
          .code(400)
          .send({ error: { code: "invalid_request", message: "A file part is required" } });
      }

      const data = await file.toBuffer();
      const filename = file.filename || "upload.bin";
      const mime = file.mimetype || "application/octet-stream";
      const png = mime === "image/png" ? readPngSize(data) : null;

      const row = context.assets.create({
        userId,
        canvasId: request.params.id,
        mime,
        filename,
        bytes: data.byteLength,
        width: png?.width,
        height: png?.height,
      });

      const directory = join(context.config.storageDir, userId);
      await mkdir(directory, { recursive: true });
      await writeFile(assetPath(context.config.storageDir, userId, row.id, filename), data);

      return reply.code(201).send({ asset: toAssetRef(row, context.config.publicBaseUrl) });
    },
  );
}
