import type { FastifyInstance } from "fastify";
import type { Run, RunRequest } from "@prism/contracts";
import { documentFingerprint } from "@prism/contracts";
import type { GraphResolutionError } from "../graph.js";
import type { CanvasesStore } from "../store/canvases.js";
import type { RunsStore } from "../store/runs.js";
import type { UsersStore } from "../store/users.js";
import { authenticate, currentUserId } from "./auth.js";

export interface RunRouteContext {
  runs: RunsStore;
  users: UsersStore;
  canvases: CanvasesStore;
  pluginById: (id: string) => { id: string; name: string } | undefined;
}

function toRun(row: ReturnType<RunsStore["get"]>, tasks: Run["tasks"]): Run | null {
  if (!row) return null;
  return {
    id: row.id,
    canvasId: row.canvasId,
    nodeId: row.nodeId,
    pluginId: row.pluginId,
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
      if (!context.pluginById(body.pluginId)) {
        return reply.code(404).send({
          error: { code: "not_found", message: `No such plugin "${body.pluginId}"` },
        });
      }

      // The graph the server runs against is the stored one. If the client is
      // looking at a newer revision than the one on disk, the run would use
      // stale inputs, so it is refused instead.
      const canvas = context.canvases.get(userId, request.params.id);
      if (!canvas) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such canvas" } });
      }
      if (body.documentFingerprint) {
        const stored = documentFingerprint(canvas.document);
        if (stored !== body.documentFingerprint) {
          return reply.code(409).send({
            error: {
              code: "stale_document",
              message:
                "The canvas changed since it was last saved. Save it and try again.",
              details: { expected: stored, received: body.documentFingerprint },
            },
          });
        }
      }

      const run = context.runs.create({
        userId,
        canvasId: request.params.id,
        nodeId: body.nodeId,
        pluginId: body.pluginId,
        params: body.params ?? {},
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

export type { GraphResolutionError };
