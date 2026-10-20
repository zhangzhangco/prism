import type { FastifyInstance } from "fastify";
import type { PluginManifest } from "@prism/contracts";
import type { ModelDescriptor } from "@prism/contracts";
import type { UsersStore } from "../store/users.js";
import { authenticate } from "./auth.js";

export interface CatalogRouteContext {
  plugins: PluginManifest[];
  models: ModelDescriptor[];
  users: UsersStore;
}

export function registerCatalogRoutes(
  app: FastifyInstance,
  context: CatalogRouteContext,
): void {
  const auth = authenticate(context.users);

  app.get("/api/plugins", { preHandler: auth }, async (_request, reply) => {
    return reply.send({ plugins: context.plugins.filter((plugin) => plugin.enabled) });
  });

  app.get<{ Params: { id: string } }>(
    "/api/plugins/:id",
    { preHandler: auth },
    async (request, reply) => {
      const plugin = context.plugins.find((item) => item.id === request.params.id);
      if (!plugin) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such plugin" } });
      }
      return reply.send({ plugin });
    },
  );

  app.get("/api/models", { preHandler: auth }, async (_request, reply) => {
    return reply.send({ models: context.models.filter((model) => model.enabled) });
  });
}
