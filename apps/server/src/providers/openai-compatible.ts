import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ProviderError, type GenerationProvider, type ProviderInputValue, type ProviderOutputAsset, type ProviderRequest, type ProviderResult, type ProviderTask } from "./types.js";

/**
 * Adapter for any server that speaks the OpenAI image-generation dialect.
 *
 * Point `PRISM_OPENAI_BASE_URL` at a compatible endpoint and every plugin
 * bound to the `openai-compatible` model will be routed there.
 */

interface ChatCompletionResponse {
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: { message?: string };
}

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleProvider implements GenerationProvider {
  readonly id = "openai-compatible";

  private readonly completed = new Map<string, ProviderResult>();

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  supports(modelKey: string): boolean {
    return modelKey === "openai-image";
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

  private async call(request: ProviderRequest): Promise<ProviderResult> {
    const doFetch = this.options.fetchImpl ?? fetch;
    const prompt = this.buildPrompt(request);
    const count = typeof request.params.count === "number" ? request.params.count : 1;
    const references = this.referenceImages(request);

    // A run with a reference image is an edit; without one it is a plain
    // generation. The two use different endpoints on OpenAI-compatible
    // servers, so the request is shaped to match.
    const response = references.length
      ? await this.callEdits(doFetch, request, prompt, count, references)
      : await this.callGenerations(doFetch, request, prompt, count);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        `Image endpoint responded with ${response.status}: ${body.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    if (payload.error?.message) {
      throw new ProviderError(payload.error.message);
    }

    const assets: ProviderOutputAsset[] = [];
    for (const [index, item] of (payload.data ?? []).entries()) {
      if (item.b64_json) {
        assets.push({
          data: Buffer.from(item.b64_json, "base64"),
          mime: "image/png",
          filename: `image-${index + 1}.png`,
        });
      } else if (item.url) {
        const downloaded = await doFetch(item.url);
        if (!downloaded.ok) {
          throw new ProviderError(`Could not download generated image (${downloaded.status})`);
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

  private async callGenerations(
    doFetch: typeof fetch,
    request: ProviderRequest,
    prompt: string,
    count: number,
  ): Promise<Response> {
    return doFetch(`${this.baseUrl()}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        prompt,
        n: Math.min(4, Math.max(1, count)),
        size: typeof request.params.size === "string" ? request.params.size : "1024x1024",
        quality: typeof request.params.quality === "string" ? request.params.quality : undefined,
        response_format: "b64_json",
      }),
    });
  }

  private async callEdits(
    doFetch: typeof fetch,
    request: ProviderRequest,
    prompt: string,
    count: number,
    references: ProviderInputValue[],
  ): Promise<Response> {
    const form = new FormData();
    form.append("model", this.options.model);
    form.append("prompt", prompt);
    form.append("n", String(Math.min(4, Math.max(1, count))));
    form.append("size", typeof request.params.size === "string" ? request.params.size : "1024x1024");

    for (const [index, reference] of references.entries()) {
      const localPath = reference.localPath;
      const bytes = localPath ? await readFile(localPath) : await this.download(reference.url!);
      const name = localPath ? basename(localPath) : `reference-${index + 1}.png`;
      form.append("image", new Blob([bytes], { type: reference.mime ?? "image/png" }), name);
    }

    return doFetch(`${this.baseUrl()}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
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

  private baseUrl(): string {
    return this.options.baseUrl.replace(/\/$/, "");
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
}
