import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { ServerConfig } from "./config.js";
import { openDatabase, type Db } from "./db.js";
import { builtinModels } from "./models/catalog.js";
import { builtinPlugins } from "./plugins/catalog.js";
import { ProviderRegistry } from "./providers/registry.js";
import { Runner } from "./queue/runner.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerCanvasRoutes } from "./routes/canvases.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerRunRoutes } from "./routes/runs.js";
import { AssetsStore } from "./store/assets.js";
import { CanvasesStore } from "./store/canvases.js";
import { RunsStore } from "./store/runs.js";
import { UsersStore } from "./store/users.js";

export interface PrismServer {
  app: FastifyInstance;
  db: Db;
  runner: Runner;
}

export async function buildServer(config: ServerConfig): Promise<PrismServer> {
  const db = openDatabase(config);

  const users = new UsersStore(db);
  const canvases = new CanvasesStore(db);
  const assets = new AssetsStore(db);
  const runs = new RunsStore(db);

  const plugins = builtinPlugins();
  const models = builtinModels({ hasRemoteProvider: config.openAiCompatible !== null });
  const providers = new ProviderRegistry({ openAiCompatible: config.openAiCompatible });

  const app = Fastify({
    logger: {
      level: process.env.PRISM_LOG_LEVEL ?? "info",
      transport: process.env.NODE_ENV === "production" ? undefined : undefined,
    },
    bodyLimit: 32 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  app.get("/api/health", async () => ({
    status: "ok",
    providers: providers.list().map((provider) => provider.id),
    plugins: plugins.length,
    models: models.filter((model) => model.enabled).length,
  }));

  registerAuthRoutes(app, { users });
  registerCanvasRoutes(app, { canvases, users });
  registerCatalogRoutes(app, { plugins, models, users });
  registerAssetRoutes(app, { assets, users, config });
  registerRunRoutes(app, {
    runs,
    users,
    canvases,
    pluginById: (id) => plugins.find((plugin) => plugin.id === id),
  });

  const runner = new Runner({
    config,
    runs,
    canvases,
    assets,
    providers,
    pluginById: (id) => plugins.find((plugin) => plugin.id === id),
  });

  return { app, db, runner };
}
