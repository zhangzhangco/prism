import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ModelDescriptor, ParamSpec } from "@prism/contracts";
import {
  ProviderError,
  type GenerationProvider,
  type ProviderInputValue,
  type ProviderOutputAsset,
  type ProviderRequest,
  type ProviderResult,
  type ProviderTask,
} from "./types.js";

/**
 * Adapter for any server that speaks the OpenAI image dialect.
 *
 * The families differ in ways that matter, so the request is shaped per
 * model:
 *
 * - The GPT Image family returns base64 unconditionally and rejects the
 *   legacy `response_format` field, so it is never sent. It also takes
 *   `background` and `output_format`.
 * - The older dialect expects `response_format` and knows only its own
 *   quality names, and it cannot work from a reference image. OpenAI retired
 *   its own DALL·E 3 endpoint in May 2026, so the built-in catalogue does
 *   not offer it, but compatible servers still implement that dialect and the
 *   adapter keeps speaking it.
 */

interface ImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string; type?: string; code?: string };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  /** The models this endpoint serves. */
  models: ModelDescriptor[];
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleProvider implements GenerationProvider {
  readonly id = "openai-compatible";

  private readonly completed = new Map<string, ProviderResult>();

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  supports(modelKey: string): boolean {
    return this.options.models.some((model) => model.key === modelKey);
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    const externalId = `openai:${request.runId}:${request.taskKey}`;
    const result = await this.call(request);
    this.completed.set(externalId, result);
    return { externalId };
  }

  async poll(task: ProviderTask): Promise<ProviderResult> {
    const result = this.completed.get(task.externalId);
    if (!result) {
      return { status: "failed", error: "Unknown task" };
    }
    this.completed.delete(task.externalId);
    return result;
  }

  private model(request: ProviderRequest): ModelDescriptor {
    const model = this.options.models.find((candidate) => candidate.key === request.modelKey);
    if (!model) {
      throw new ProviderError(`This endpoint does not serve the model "${request.modelKey}"`);
    }
    return model;
  }

  private async call(request: ProviderRequest): Promise<ProviderResult> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const model = this.model(request);
    const prompt = this.buildPrompt(request);
    const references = this.referenceImages(request);

    if (references.length > 0 && !model.supportsReference) {
      throw new ProviderError(
        `The model "${model.label}" cannot work from a reference image`,
      );
    }

    // A stable key per run, so a provider that honours idempotency keys will
    // not bill the same job twice when a run is repeated after a restart.
    const idempotencyKey = `prism-${request.runId}-${request.taskKey}`;

    const response = references.length
      ? await this.callEdits(doFetch, request, model, prompt, references, idempotencyKey)
      : await this.callGenerations(doFetch, request, model, prompt, idempotencyKey);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let message = `The image endpoint responded with ${response.status}`;
      try {
        const parsed = JSON.parse(body) as ImageResponse;
        if (parsed.error?.message) {
          message = parsed.error.message;
        }
      } catch {
        if (body) message = `${message}: ${body.slice(0, 300)}`;
      }
      throw new ProviderError(message);
    }

    const payload = (await response.json()) as ImageResponse;
    if (payload.error?.message) {
      throw new ProviderError(payload.error.message);
    }

    const assets: ProviderOutputAsset[] = [];
    for (const [index, item] of (payload.data ?? []).entries()) {
      if (item.b64_json) {
        assets.push({
          data: Buffer.from(item.b64_json, "base64"),
          mime: this.mimeFor(model, request),
          filename: `image-${index + 1}.png`,
        });
      } else if (item.url) {
        const downloaded = await doFetch(item.url);
        if (!downloaded.ok) {
          throw new ProviderError(`Could not download the generated image (${downloaded.status})`);
        }
        assets.push({
          data: Buffer.from(await downloaded.arrayBuffer()),
          mime: downloaded.headers.get("content-type") ?? "image/png",
          filename: `image-${index + 1}.png`,
        });
      }
    }

    if (assets.length === 0) {
      return { status: "failed", error: "The endpoint returned no images" };
    }
    return { status: "succeeded", assets };
  }

  private mimeFor(model: ModelDescriptor, request: ProviderRequest): string {
    const format = request.params.output_format;
    if (model.dialect === "gpt-image" && typeof format === "string") {
      if (format === "jpeg") return "image/jpeg";
      if (format === "webp") return "image/webp";
    }
    return "image/png";
  }

  /** The fields the chosen model accepts, in its own vocabulary. */
  private payloadFor(
    model: ModelDescriptor,
    request: ProviderRequest,
    prompt: string,
  ): Record<string, unknown> {
    const params = request.params;
    const payload: Record<string, unknown> = { model: model.key, prompt };

    const count = params.count;
    if (typeof count === "number") payload.n = count;

    const size = params.size;
    if (typeof size === "string") payload.size = size;

    const quality = params.quality;
    if (typeof quality === "string") payload.quality = quality;

    if (model.dialect === "gpt-image") {
      // The GPT Image family rejects `response_format`; it always returns
      // base64, so the field is left out entirely.
      if (typeof params.background === "string") payload.background = params.background;
      if (typeof params.output_format === "string") payload.output_format = params.output_format;
    } else {
      payload.response_format = "b64_json";
    }

    return payload;
  }

  private async callGenerations(
    doFetch: typeof fetch,
    request: ProviderRequest,
    model: ModelDescriptor,
    prompt: string,
    idempotencyKey: string,
  ): Promise<Response> {
    return doFetch(`${this.baseUrl()}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(this.payloadFor(model, request, prompt)),
    });
  }

  private async callEdits(
    doFetch: typeof fetch,
    request: ProviderRequest,
    model: ModelDescriptor,
    prompt: string,
    references: ProviderInputValue[],
    idempotencyKey: string,
  ): Promise<Response> {
    const form = new FormData();
    for (const [key, value] of Object.entries(this.payloadFor(model, request, prompt))) {
      if (key === "model" || key === "prompt") continue;
      form.append(key, String(value));
    }
    form.append("model", model.key);
    form.append("prompt", prompt);

    for (const [index, reference] of references.entries()) {
      const localPath = reference.localPath;
      const bytes = localPath ? await readFile(localPath) : await this.download(reference.url!);
      const name = localPath ? basename(localPath) : `reference-${index + 1}.png`;
      form.append("image", new Blob([bytes], { type: reference.mime ?? "image/png" }), name);
    }

    return doFetch(`${this.baseUrl()}/images/edits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Idempotency-Key": idempotencyKey,
      },
      body: form,
    });
  }

  private async download(url: string): Promise<Buffer> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const response = await doFetch(url);
    if (!response.ok) {
      throw new ProviderError(`Could not fetch the reference image (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /** The reference images of a run, in slot order. */
  private referenceImages(request: ProviderRequest): ProviderInputValue[] {
    return Object.values(request.inputs)
      .flat()
      .filter((value) => value.kind === "image");
  }

  private buildPrompt(request: ProviderRequest): string {
    if (request.prompt.trim()) return request.prompt.trim();

    const explicit = typeof request.params.prompt === "string" ? request.params.prompt.trim() : "";
    if (explicit) return explicit;

    const texts = Object.values(request.inputs)
      .flat()
      .map((value) => value.text)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return texts.join(", ") || "an abstract scene";
  }

  private baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
  }
}

export type { ParamSpec };
