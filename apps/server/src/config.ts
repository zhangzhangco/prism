import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be an integer, got "${raw}"`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  databaseFile: string;
  storageDir: string;
  /** Concurrency of the generation runner. */
  workerConcurrency: number;
  /** How often the runner polls a provider for task progress, in ms. */
  pollIntervalMs: number;
  /** Public base URL used to build asset links. */
  publicBaseUrl: string;
  /** Enables the dev-only "bootstrap account" endpoint. */
  allowSignup: boolean;
  /**
   * Optional OpenAI-compatible image endpoint. When set, plugins bound to
   * the `openai-compatible` provider are routed there instead of the mock.
   */
  openAiCompatible: {
    baseUrl: string;
    apiKey: string;
    model: string;
  } | null;
}

export function loadConfig(): ServerConfig {
  const dataDir = resolve(process.env.PRISM_DATA_DIR ?? resolve(here, "../../../data"));
  const port = int("PRISM_PORT", 4319);
  const publicBaseUrl = process.env.PRISM_PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`;

  const apiKey = process.env.PRISM_OPENAI_API_KEY;
  const openAiCompatible = apiKey
    ? {
        baseUrl: process.env.PRISM_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey,
        model: process.env.PRISM_OPENAI_MODEL ?? "gpt-image-1",
      }
    : null;

  return {
    host: process.env.PRISM_HOST ?? "127.0.0.1",
    port,
    dataDir,
    databaseFile: resolve(dataDir, "prism.sqlite"),
    storageDir: resolve(dataDir, "storage"),
    workerConcurrency: int("PRISM_WORKER_CONCURRENCY", 2),
    pollIntervalMs: int("PRISM_POLL_INTERVAL_MS", 1500),
    publicBaseUrl,
    allowSignup: bool("PRISM_ALLOW_SIGNUP", true),
    openAiCompatible,
  };
}
