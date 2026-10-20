import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { newId } from "../ids.js";
import type { UsersStore } from "../store/users.js";
import { toSessionUser } from "../store/users.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the `authenticate` pre-handler once a token has been resolved. */
    userId?: string;
  }
}

/** Resolve the bearer token on the request, if there is one. */
export function authenticate(users: UsersStore) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      await reply.code(401).send({
        error: { code: "unauthenticated", message: "A bearer token is required" },
      });
      return;
    }
    const token = header.slice(7).trim();
    const user = users.resolveToken(token);
    if (!user) {
      await reply.code(401).send({
        error: { code: "unauthenticated", message: "The token is not valid" },
      });
      return;
    }
    request.userId = user.id;
  };
}

export function currentUserId(request: FastifyRequest): string {
  if (!request.userId) {
    throw new Error("currentUserId called on an unauthenticated request");
  }
  return request.userId;
}

export function registerAuthRoutes(app: FastifyInstance, context: { users: UsersStore }): void {
  app.post<{ Body: { email: string; password: string; displayName?: string } }>(
    "/api/auth/register",
    async (request, reply) => {
      const { email, password, displayName } = request.body ?? {};
      if (!email || !password) {
        return reply
          .code(400)
          .send({ error: { code: "invalid_request", message: "email and password are required" } });
      }
      if (password.length < 8) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "The password must be at least 8 characters" },
        });
      }
      if (context.users.findByEmail(email)) {
        return reply
          .code(409)
          .send({ error: { code: "email_taken", message: "That email is already registered" } });
      }
      const user = context.users.create({ email, password, displayName });
      const token = context.users.issueToken(user.id);
      return reply.code(201).send({ token, user: toSessionUser(user) });
    },
  );

  app.post<{ Body: { email: string; password: string } }>("/api/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      return reply
        .code(400)
        .send({ error: { code: "invalid_request", message: "email and password are required" } });
    }
    const user = context.users.verify(email, password);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: "invalid_credentials", message: "Those credentials are not valid" } });
    }
    const token = context.users.issueToken(user.id);
    return reply.send({ token, user: toSessionUser(user) });
  });

  app.get("/api/auth/me", { preHandler: authenticate(context.users) }, async (request, reply) => {
    const user = context.users.findById(currentUserId(request));
    if (!user) {
      return reply
        .code(404)
        .send({ error: { code: "not_found", message: "The account no longer exists" } });
    }
    return reply.send({ user: toSessionUser(user) });
  });

  app.post("/api/auth/logout", { preHandler: authenticate(context.users) }, async (request, reply) => {
    return reply.code(204).send();
  });
}

export { newId };
