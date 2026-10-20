import { mkdir, writeFile } from "node:fs/promises";
import { assetPath } from "../storage.js";
import { join } from "node:path";
import type { RunStatus } from "@prism/contracts";
import type { AssetRef } from "@prism/contracts";
import type { ServerConfig } from "../config.js";
import { assertInputsSatisfied, composePrompt, resolveInputs, GraphResolutionError } from "../graph.js";
import { runLocal } from "../local/executors.js";
import { readPngSize } from "../png.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { ProviderError, type ProviderRequest, type ProviderTask } from "../providers/types.js";
import type { AssetsStore } from "../store/assets.js";
import type { CanvasesStore } from "../store/canvases.js";
import { toAssetRef } from "../store/assets.js";
import type { RunsStore } from "../store/runs.js";

/**
 * The generation runner.
 *
 * Runs are picked up from the database, executed against a provider, and their
 * results written back as assets. Work is intentionally kept in the database
 * rather than in memory: a restart loses no queued work, and the client can
 * always ask the server what happened.
 */
const MAX_ATTEMPTS = 3;

export class Runner {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private active = new Set<string>();

  constructor(
    private readonly deps: {
      config: ServerConfig;
      runs: RunsStore;
      canvases: CanvasesStore;
      assets: AssetsStore;
      providers: ProviderRegistry;
      pluginById: (id: string) => ReturnType<typeof Object> | undefined;
    },
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.recoverInterrupted();
    const tick = () => {
      void this.tick().catch((error) => {
        console.error("[runner] tick failed", error);
      });
    };
    tick();
    this.timer = setInterval(tick, this.deps.config.pollIntervalMs);
    this.timer.unref?.();
  }

  /**
   * Deal with runs that were in flight when the process stopped.
   *
   * A provider cannot be re-attached to, so an interrupted run is started
   * again from the beginning. After a few attempts it is failed with a clear
   * reason rather than being retried for ever.
   */
  private recoverInterrupted(): void {
    const { runs } = this.deps;
    const interrupted = runs.findInterrupted();
    for (const run of interrupted) {
      const attempts = runs.attemptsFor(run.id);
      if (attempts >= MAX_ATTEMPTS) {
        runs.failInterrupted(
          run.id,
          "The run was interrupted too many times and could not be resumed.",
        );
        continue;
      }
      runs.requeue(run.id);
    }
    if (interrupted.length > 0) {
      console.log(
        `[runner] recovered ${interrupted.length} interrupted run(s): ${interrupted
          .map((run) => run.id)
          .join(", ")}`,
      );
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Give in-flight work a chance to finish so we do not leave rows stuck in
    // a "running" state.
    const deadline = Date.now() + 5000;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private async tick(): Promise<void> {
    const capacity = this.deps.config.workerConcurrency - this.active.size;
    if (capacity <= 0) return;

    const queued = this.deps.runs.claimQueued(capacity);
    for (const run of queued) {
      if (this.active.has(run.id)) continue;
      this.active.add(run.id);
      void this.execute(run.id)
        .catch((error) => {
          console.error(`[runner] run ${run.id} failed`, error);
        })
        .finally(() => {
          this.active.delete(run.id);
        });
    }
  }

  private async execute(runId: string): Promise<void> {
    const { runs, canvases, assets, providers, config } = this.deps;
    const run = runs.getById(runId);
    if (!run) return;

    const plugin = this.deps.pluginById(run.pluginId);
    if (!plugin) {
      runs.setStatus(runId, "failed", `Unknown plugin "${run.pluginId}"`);
      return;
    }

    const canvas = canvases.get(run.userId, run.canvasId);
    if (!canvas) {
      runs.setStatus(runId, "failed", "The canvas no longer exists");
      return;
    }

    runs.setStatus(runId, "running");

    const resolved = resolveInputs(canvas.document, run.nodeId, plugin as never);
    try {
      assertInputsSatisfied(resolved);
    } catch (error) {
      const message =
        error instanceof GraphResolutionError ? error.message : "Could not resolve the inputs";
      runs.setStatus(runId, "failed", message);
      return;
    }

    const taskKey = plugin.outputs[0]?.key ?? "output";
    const runtime = (plugin as { runtime: { kind: string; modelKey?: string } }).runtime;

    // Give providers a direct path to the bytes of every referenced image, so
    // they do not have to fetch it back over the network.
    const inputs = Object.fromEntries(
      resolved.map((input) => [
        input.slot.key,
        input.values.map((value) => {
          if (value.kind !== "image" || !value.assetId) return value;
          const asset = assets.get(run.userId, value.assetId);
          if (!asset) return value;
          return {
            ...value,
            localPath: assetPath(config.storageDir, run.userId, asset.id, asset.filename),
          };
        }),
      ]),
    );

    // A local runtime runs in process and finishes immediately.
    if (runtime.kind === "local") {
      try {
        const result = await runLocal(plugin.id, {
          prompt: composePrompt(resolved, run.params),
          params: run.params,
          inputs,
        });

        const produced: AssetRef[] = [];
        for (const [index, image] of (result.images ?? []).entries()) {
          const filename = image.filename || `output-${index + 1}.png`;
          const directory = join(config.storageDir, run.userId);
          await mkdir(directory, { recursive: true });
          const row = assets.create({
            userId: run.userId,
            canvasId: run.canvasId,
            mime: image.mime,
            filename,
            bytes: image.data.byteLength,
            width: image.width,
            height: image.height,
          });
          await writeFile(
            assetPath(config.storageDir, run.userId, row.id, filename),
            image.data,
          );
          produced.push(toAssetRef(row, config.publicBaseUrl));
        }

        runs.upsertTask({
          runId: run.id,
          key: taskKey,
          status: "succeeded",
          text: result.text,
          assets: produced,
        });
        runs.setStatus(run.id, "succeeded");
      } catch (error) {
        const message = describeError(error);
        runs.upsertTask({ runId: run.id, key: taskKey, status: "failed", error: message });
        runs.setStatus(run.id, "failed", message);
      }
      return;
    }

    const request: ProviderRequest = {
      runId: run.id,
      taskKey,
      modelKey: runtime.kind === "provider" ? (runtime.modelKey ?? "") : "",
      prompt: composePrompt(resolved, run.params),
      params: run.params,
      inputs,
    };

    const matching = providers.resolve(request.modelKey);
    if (matching.length === 0) {
      runs.setStatus(runId, "failed", `No provider is registered for model "${request.modelKey}"`);
      return;
    }
    const provider = matching[0]!;

    let handle: ProviderTask;
    try {
      handle = await provider.submit(request);
    } catch (error) {
      runs.setStatus(runId, "failed", describeError(error));
      return;
    }

    const task = runs.upsertTask({ runId: run.id, key: taskKey, status: "running" });

    for (;;) {
      await delay(this.deps.config.pollIntervalMs);
      let result;
      try {
        result = await provider.poll(handle, request);
      } catch (error) {
        runs.upsertTask({ id: task.id, runId: run.id, key: taskKey, status: "failed", error: describeError(error) });
        runs.setStatus(runId, "failed", describeError(error));
        return;
      }

      if (result.status === "running") continue;

      if (result.status === "failed") {
        const message = result.error ?? "The provider reported a failure";
        runs.upsertTask({ id: task.id, runId: run.id, key: taskKey, status: "failed", error: message });
        runs.setStatus(runId, "failed", message);
        return;
      }

      const stored = [];
      for (const [index, output] of (result.assets ?? []).entries()) {
        const filename = output.filename || `output-${index + 1}.png`;
        const directory = join(config.storageDir, run.userId);
        await mkdir(directory, { recursive: true });

        const png = output.mime === "image/png" ? readPngSize(output.data) : null;
        const row = assets.create({
          userId: run.userId,
          canvasId: run.canvasId,
          mime: output.mime,
          filename,
          bytes: output.data.byteLength,
          width: output.width ?? png?.width,
          height: output.height ?? png?.height,
        });

        const path = assetPath(config.storageDir, run.userId, row.id, filename);
        await writeFile(path, output.data);
        stored.push(toAssetRef(row, config.publicBaseUrl));
      }

      runs.upsertTask({
        id: task.id,
        runId: run.id,
        key: taskKey,
        status: "succeeded",
        assets: stored,
        text: result.text,
        synthetic: result.synthetic,
      });
      runs.setStatus(runId, "succeeded");
      return;
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unexpected error";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { RunStatus };
