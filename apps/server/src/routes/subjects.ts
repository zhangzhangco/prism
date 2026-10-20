import type { FastifyInstance } from "fastify";
import type { SubjectKind, SubjectSpec } from "@prism/contracts";
import type { AssetsStore } from "../store/assets.js";
import type { SubjectsStore } from "../store/subjects.js";
import type { UsersStore } from "../store/users.js";
import { authenticate, currentUserId } from "./auth.js";

export interface SubjectRouteContext {
  subjects: SubjectsStore;
  assets: AssetsStore;
  users: UsersStore;
  publicBaseUrl: string;
}

const KINDS: SubjectKind[] = ["actor", "scene", "prop", "effect"];

export function registerSubjectRoutes(
  app: FastifyInstance,
  context: SubjectRouteContext,
): void {
  const auth = authenticate(context.users);

  /**
   * A thumbnail has to be an asset of the account that owns the subject.
   * Without this check a caller could point a subject at somebody else's
   * asset — and the subject's thumbnail is served to whoever can read it.
   */
  function checkThumbnail(userId: string, assetId: string | null | undefined): string | null {
    if (!assetId) return null;
    const asset = context.assets.get(userId, assetId);
    if (!asset) return "The thumbnail is not an asset of this account";
    return null;
  }

  app.get<{ Querystring: { kind?: string; q?: string } }>(
    "/api/subjects",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const kind = KINDS.includes(request.query.kind as SubjectKind)
        ? (request.query.kind as SubjectKind)
        : undefined;
      const subjects = context.subjects.list(userId, {
        ...(kind ? { kind } : {}),
        ...(request.query.q ? { search: request.query.q } : {}),
      });

      // The thumbnail is an asset, so the client can show it without a second
      // round trip per subject.
      return reply.send({
        subjects: subjects.map((subject) => ({
          ...subject,
          thumbnailUrl: subject.thumbnailAssetId
            ? `${context.publicBaseUrl.replace(/\/$/, "")}/api/assets/${subject.thumbnailAssetId}`
            : null,
        })),
      });
    },
  );

  app.post<{
    Body: {
      kind: SubjectKind;
      name: string;
      description?: string;
      tags?: string[];
      data: SubjectSpec;
      thumbnailAssetId?: string | null;
    };
  }>(
    "/api/subjects",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const body = request.body ?? ({} as never);
      if (!body.name || !body.name.trim()) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "A subject needs a name" },
        });
      }
      if (!KINDS.includes(body.kind)) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: `Unknown kind "${body.kind}"` },
        });
      }
      const thumbnailProblem = checkThumbnail(
        currentUserId(request),
        body.thumbnailAssetId,
      );
      if (thumbnailProblem) {
        return reply.code(400).send({
          error: { code: "invalid_thumbnail", message: thumbnailProblem },
        });
      }
      const subject = context.subjects.create({
        userId,
        kind: body.kind,
        name: body.name,
        description: body.description,
        tags: body.tags,
        data: body.data,
        thumbnailAssetId: body.thumbnailAssetId ?? null,
      });
      return reply.code(201).send({ subject });
    },
  );
  app.patch<{
    Params: { id: string };
    Body: {
      kind?: SubjectKind;
      name?: string;
      description?: string;
      tags?: string[];
      data?: SubjectSpec;
      thumbnailAssetId?: string | null;
    };
  }>(
    "/api/subjects/:id",
    { preHandler: auth },
    async (request, reply) => {
      const userId = currentUserId(request);
      const body = request.body ?? {};
      if (body.thumbnailAssetId !== undefined) {
        const thumbnailProblem = checkThumbnail(userId, body.thumbnailAssetId);
        if (thumbnailProblem) {
          return reply.code(400).send({
            error: { code: "invalid_thumbnail", message: thumbnailProblem },
          });
        }
      }
      const subject = context.subjects.update(userId, request.params.id, body);
      if (!subject) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such subject" } });
      }
      return reply.send({ subject });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/subjects/:id",
    { preHandler: auth },
    async (request, reply) => {
      const removed = context.subjects.remove(currentUserId(request), request.params.id);
      if (!removed) {
        return reply
          .code(404)
          .send({ error: { code: "not_found", message: "No such subject" } });
      }
      return reply.code(204).send();
    },
  );
}
