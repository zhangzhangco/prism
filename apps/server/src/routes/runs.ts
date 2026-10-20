import type { FastifyInstance } from "fastify";
import type { ModelDescriptor, PluginManifest, Run, RunRequest } from "@prism/contracts";
import { documentFingerprint } from "@prism/contracts";
import { resolveInputs, slotKeyFromHandle } from "../graph.js";
import { validateParams } from "../models/params.js";
import type { CanvasesStore } from "../store/canvases.js";
import type { RunsStore } from "../store/runs.js";
import type { UsersStore } from "../store/users.js";
import { authenticate, currentUserId } from "./auth.js";

export interface RunRouteContext {
  runs: RunsStore;
  users: UsersStore;
  canvases: CanvasesStore;
  pluginById: (id: string) => PluginManifest | undefined;
  modelById: (key: string) => ModelDescriptor | undefined;
}

function toRun(row: ReturnType<RunsStore["get"]>, tasks: Run["tasks"]): Run | null {
  if (!row) return null;
  return {
    id: row.id,
    canvasId: row.canvasId,
    nodeId: row.nodeId,
    pluginId: row.pluginId,
    modelKey: row.modelKey,
    status: row.status,
    params: row.params,
    tasks,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerRunRoutes(app: FastifyInstance, context: RunRouteContext): void {
  const auth = authenticate(context.users);

  app.post<{ Params: { id: string }; Body: RunRequest }>(
    "/api/canvases/:id/runs",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const body = request.body ?? ({} as RunRequest);
      if (!body.nodeId || !body.pluginId) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "nodeId and pluginId are required" },
        });
      }

      const plugin = context.pluginById(body.pluginId);
      if (!plugin) {
        return reply.code(404).send({
          error: { code: "not_found", message: `No such plugin "${body.pluginId}"` },
        });
      }

      const canvas = context.canvases.get(userId, request.params.id);
      if (!canvas) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such canvas" } });
      }

      // The graph the server runs against is the stored one. If the client is
      // looking at a newer revision than the one on disk, the run would use
      // stale inputs, so it is refused instead.
      if (body.documentFingerprint) {
        const stored = documentFingerprint(canvas.document);
        if (stored !== body.documentFingerprint) {
          return reply.code(409).send({
            error: {
              code: "stale_document",
              message: "The canvas changed since it was last saved. Save it and try again.",
              details: { expected: stored, received: body.documentFingerprint },
            },
          });
        }
      }

      // Pick the model: the one the client asked for, or the plugin's own.
      const defaultModel =
        plugin.runtime.kind === "provider" ? plugin.runtime.modelKey : undefined;
      const modelKey = body.modelKey ?? defaultModel ?? "";
      const model = modelKey ? context.modelById(modelKey) : undefined;

      if (modelKey && !model) {
        return reply.code(404).send({
          error: { code: "not_found", message: `No such model "${modelKey}"` },
        });
      }
      if (model && !model.enabled) {
        return reply.code(400).send({
          error: {
            code: "model_unavailable",
            message: `The model "${model.label}" is not available on this server`,
          },
        });
      }
      if (plugin.runtime.kind === "provider" && !model) {
        return reply.code(400).send({
          error: {
            code: "no_model",
            message: "This generator needs a model, and none is available",
          },
        });
      }

      // Parameters are checked against the model, so a value the backend
      // would refuse is reported rather than sent.
      const validation = validateParams(plugin, model, body.params ?? {});
      if (validation.rejected.length > 0) {
        return reply.code(400).send({
          error: {
            code: "invalid_params",
            message: validation.rejected.join("; "),
            details: { rejected: validation.rejected },
          },
        });
      }

      // The inputs are resolved now, against the document as it stands, and
      // stored with the run. The worker uses that snapshot, so a change made
      // while the run was queued cannot alter what it consumes.
      const resolved = resolveInputs(canvas.document, body.nodeId, plugin);
      const snapshot: Record<string, unknown> = {};
      for (const input of resolved) {
        snapshot[input.slot.key] = input.values.map((value) => ({
          kind: value.kind,
          ...(value.assetId ? { assetId: value.assetId } : {}),
          ...(value.url ? { url: value.url } : {}),
          ...(value.mime ? { mime: value.mime } : {}),
          ...(value.text !== undefined ? { text: value.text } : {}),
        }));
      }

      const hasReference = resolved.some(
        (input) => input.slot.dataType === "image" && input.values.length > 0,
      );
      if (hasReference && model && !model.supportsReference) {
        return reply.code(400).send({
          error: {
            code: "model_cannot_edit",
            message: `The model "${model.label}" cannot work from a reference image`,
          },
        });
      }

      const run = context.runs.create({
        userId,
        canvasId: request.params.id,
        nodeId: body.nodeId,
        pluginId: body.pluginId,
        modelKey,
        params: validation.values,
        inputs: snapshot,
      });

      return reply.code(202).send({ run: toRun(run, []) });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/canvases/:id/runs",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const rows = context.runs.listForCanvas(userId, request.params.id);
      const runs = rows
        .map((row) => toRun(row, context.runs.listTasks(row.id)))
        .filter((run): run is Run => run !== null);
      return reply.send({ runs });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    { preHandler: auth },
    async (request, reply) => {
      const row = context.runs.get(currentUserId(request), request.params.id);
      if (!row) {
        return reply.code(404).send({ error: { code: "not_found", message: "No such run" } });
      }
      return reply.send({ run: toRun(row, context.runs.listTasks(row.id)) });
    },
  );
}

export { slotKeyFromHandle };
