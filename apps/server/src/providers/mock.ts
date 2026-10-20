import { createHash } from "node:crypto";
import { encodePng } from "../png.js";
import type {
  GenerationProvider,
  ProviderInputValue,
  ProviderOutputAsset,
  ProviderRequest,
  ProviderResult,
  ProviderTask,
} from "./types.js";

/**
 * A self-contained generation backend.
 *
 * It produces real image bytes — a deterministic gradient derived from the
 * prompt — so the application is fully usable with no credentials and no
 * network access. It is also the reference implementation of the provider
 * contract: submit, then poll until the result is ready.
 */

const RATIO_SIZES: Record<string, [number, number]> = {
  "1:1": [1024, 1024],
  "4:3": [1024, 768],
  "3:4": [768, 1024],
  "16:9": [1280, 720],
  "9:16": [720, 1280],
};

const QUALITY_SCALE: Record<string, number> = {
  standard: 1,
  high: 1.5,
};

interface Palette {
  from: [number, number, number];
  to: [number, number, number];
  accent: [number, number, number];
}

function paletteFor(seed: string): Palette {
  const digest = createHash("sha256").update(seed).digest();
  const channel = (offset: number, spread: number) => 40 + ((digest[offset]! / 255) * spread);
  return {
    from: [channel(0, 160), channel(1, 160), channel(2, 160)],
    to: [channel(3, 200), channel(4, 200), channel(5, 200)],
    accent: [channel(6, 255), channel(7, 255), channel(8, 255)],
  };
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function renderImage(prompt: string, index: number, width: number, height: number): Buffer {
  const palette = paletteFor(`${prompt}#${index}`);
  const cx = width * (0.3 + ((index * 0.17) % 0.4));
  const cy = height * (0.3 + ((index * 0.29) % 0.4));
  const maxDistance = Math.hypot(width, height);

  return encodePng(width, height, (x, y) => {
    const diagonal = (x / width + y / height) / 2;
    let colour = mix(palette.from, palette.to, diagonal);

    // A soft radial highlight keeps the output from looking like a plain ramp.
    const distance = Math.hypot(x - cx, y - cy) / maxDistance;
    const glow = Math.max(0, 1 - distance * 3.2);
    colour = mix(colour, palette.accent, glow * 0.35);

    // A faint band gives the image some structure.
    const band = Math.sin((x / width) * Math.PI * 6 + index) * 0.5 + 0.5;
    const shade = 0.92 + band * 0.08;
    return {
      r: Math.round(colour[0] * shade),
      g: Math.round(colour[1] * shade),
      b: Math.round(colour[2] * shade),
    };
  });
}

function promptFor(request: ProviderRequest): string {
  // The server composes the prompt from the wired inputs before handing the
  // job over, so `request.prompt` is the authoritative value.
  if (request.prompt.trim()) return request.prompt.trim();

  const explicit = typeof request.params.prompt === "string" ? request.params.prompt.trim() : "";
  if (explicit) return explicit;

  const textInputs = Object.values(request.inputs)
    .flat()
    .filter((value): value is ProviderInputValue & { text: string } => typeof value.text === "string")
    .map((value) => value.text.trim())
    .filter(Boolean);

  if (textInputs.length > 0) return textInputs.join(", ");

  const imageInputs = Object.values(request.inputs)
    .flat()
    .filter((value) => value.kind === "image")
    .map((value) => value.assetId ?? "image");

  return imageInputs.length > 0 ? `reference:${imageInputs.join(",")}` : "an abstract scene";
}

export class MockProvider implements GenerationProvider {
  readonly id = "mock";

  /** Prompts that were accepted, so the poller can answer on a later tick. */
  private readonly pending = new Map<string, { request: ProviderRequest; ticks: number }>();

  supports(modelKey: string): boolean {
    return modelKey.startsWith("prism-");
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    const externalId = createHash("sha1")
      .update(`${request.runId}:${request.taskKey}`)
      .digest("hex")
      .slice(0, 24);
    this.pending.set(externalId, { request, ticks: 0 });
    return { externalId };
  }

  async poll(task: ProviderTask, request: ProviderRequest): Promise<ProviderResult> {
    const entry = this.pending.get(task.externalId);
    if (!entry) {
      return { status: "failed", error: "Unknown task" };
    }
    entry.ticks += 1;

    // Report progress once, so the client has a chance to render a running
    // state rather than jumping straight to the result.
    if (entry.ticks === 1) {
      return { status: "running" };
    }

    this.pending.delete(task.externalId);

    const ratio = typeof request.params.ratio === "string" ? request.params.ratio : "1:1";
    const quality = typeof request.params.quality === "string" ? request.params.quality : "standard";
    const count = clampCount(request.params.count);
    const factor = QUALITY_SCALE[quality] ?? 1;
    const [baseWidth, baseHeight] = RATIO_SIZES[ratio] ?? RATIO_SIZES["1:1"]!;
    const width = Math.max(64, Math.round(baseWidth * factor));
    const height = Math.max(64, Math.round(baseHeight * factor));

    const prompt = promptFor(request);
    const assets: ProviderOutputAsset[] = [];
    for (let index = 0; index < count; index += 1) {
      assets.push({
        data: renderImage(prompt, index, width, height),
        mime: "image/png",
        filename: `${slug(request.taskKey)}-${index + 1}.png`,
        width,
        height,
      });
    }

    return { status: "succeeded", assets };
  }

}

function clampCount(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : 1;
  return Math.min(4, Math.max(1, n));
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase().slice(0, 40) || "output";
}
