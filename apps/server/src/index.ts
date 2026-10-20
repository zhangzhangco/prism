import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app, runner } = await buildServer(config);

runner.start();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await runner.stop();
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`Prism server listening on http://${config.host}:${config.port}`);
  if (!config.openAiCompatible) {
    app.log.info("No remote provider configured — using the built-in generation backend.");
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
