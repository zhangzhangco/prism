import type { FastifyInstance } from "fastify";
import type { CanvasDocument } from "@prism/contracts";
import type { CanvasesStore } from "../store/canvases.js";
import type { UsersStore } from "../store/users.js";
import { authenticate, currentUserId } from "./auth.js";

export interface CanvasRouteContext {
  canvases: CanvasesStore;
  users: UsersStore;
}

export function registerCanvasRoutes(app: FastifyInstance, context: CanvasRouteContext): void {
  const auth = authenticate(context.users);

  app.get("/api/canvases", { preHandler: auth }, async (request, reply) => {
    return reply.send({ canvases: context.canvases.list(currentUserId(request)) });
  });

  app.post<{ Body: { name?: string; document?: CanvasDocument } }>(
    "/api/canvases",
    { preHandler: auth },
    async (request, reply) => {
      const name = request.body?.name?.trim() || "Untitled canvas";
      const canvas = context.canvases.create(currentUserId(request), name, request.body?.document);
      return reply.code(201).send({ canvas });
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/canvases/:id",
    { preHandler: auth },
    async (request, reply) => {
      const canvas = context.canvases.get(currentUserId(request), request.params.id);
      if (!canvas) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such canvas" } });
      }
      return reply.send({ canvas });
    },
  );

  app.patch<{ Params: { id: string }; Body: { name?: string; document?: CanvasDocument } }>(
    "/api/canvases/:id",
    { preHandler: auth },
    async (request, reply) => {
      const canvas = context.canvases.update(
        currentUserId(request),
        request.params.id,
        request.body ?? {},
      );
      if (!canvas) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such canvas" } });
      }
      return reply.send({ canvas });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/canvases/:id",
    { preHandler: auth },
    async (request, reply) => {
      const removed = context.canvases.remove(currentUserId(request), request.params.id);
      if (!removed) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such canvas" } });
      }
      return reply.code(204).send();
    },
  );
}
