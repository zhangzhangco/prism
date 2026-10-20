import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { encodePng } from "../png.js";
import { decodePng, type DecodedImage } from "../png-decode.js";
import type {
  GenerationProvider,
  ProviderInputValue,
  ProviderOutputAsset,
  ProviderRequest,
  ProviderResult,
  ProviderTask,
} from "./types.js";

/**
 * The built-in generation backend.
 *
 * It produces real image bytes without any credentials or network access, so
 * the application is usable out of the box. Two things keep it honest:
 *
 * - the output is **synthetic**. A reference image is composited into it, so
 *   the input demonstrably changes the result, and the image carries a
 *   diagonal hatch so nobody mistakes it for a model output.
 * - the model entries in the catalogue are labelled as a demo.
 */

const QUALITY_SCALE: Record<string, number> = {
  standard: 1,
  high: 1.5,
};

/** Parse a "1024x1024" size into pixels. */
function parseSize(value: unknown): [number, number] {
  if (typeof value === "string") {
    const match = /^(\d+)x(\d+)$/.exec(value.trim());
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width > 0 && height > 0) return [width, height];
    }
  }
  return [1024, 1024];
}

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

/** Sample the reference image at a point, in normalised coordinates. */
function sampleReference(image: DecodedImage, u: number, v: number): [number, number, number] {
  const x = Math.min(image.width - 1, Math.max(0, Math.round(u * (image.width - 1))));
  const y = Math.min(image.height - 1, Math.max(0, Math.round(v * (image.height - 1))));
  const index = (y * image.width + x) * 4;
  return [image.data[index] ?? 0, image.data[index + 1] ?? 0, image.data[index + 2] ?? 0];
}

/** The average colour of the reference image. */
function averageColour(image: DecodedImage): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = image.width * image.height;
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    r += image.data[offset] ?? 0;
    g += image.data[offset + 1] ?? 0;
    b += image.data[offset + 2] ?? 0;
  }
  return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
}

function renderImage(
  prompt: string,
  index: number,
  width: number,
  height: number,
  reference: DecodedImage | null,
): Buffer {
  const palette = paletteFor(`${prompt}#${index}`);
  const cx = width * (0.3 + ((index * 0.17) % 0.4));
  const cy = height * (0.3 + ((index * 0.29) % 0.4));
  const maxDistance = Math.hypot(width, height);

  return encodePng(width, height, (x, y) => {
    const u = x / width;
    const v = y / height;
    const diagonal = (u + v) / 2;
    let colour = mix(palette.from, palette.to, diagonal);

    // A soft radial highlight keeps the output from looking like a plain ramp.
    const distance = Math.hypot(x - cx, y - cy) / maxDistance;
    const glow = Math.max(0, 1 - distance * 3.2);
    colour = mix(colour, palette.accent, glow * 0.35);

    // A faint band gives the image some structure.
    const band = Math.sin(u * Math.PI * 6 + index) * 0.5 + 0.5;
    let shade = 0.92 + band * 0.08;

    if (reference) {
      // Composite the reference so the input demonstrably drives the output.
      const sampled = sampleReference(reference, u, v);
      const tint = mix(colour, sampled, 0.55);
      colour = tint;
      shade = 0.88 + band * 0.12;
    }

    let r = Math.round(colour[0] * shade);
    let g = Math.round(colour[1] * shade);
    let b = Math.round(colour[2] * shade);

    // A diagonal hatch marks the image as a demo result.
    if ((x + y) % 48 < 6) {
      r = Math.min(255, r + 38);
      g = Math.min(255, g + 38);
      b = Math.min(255, b + 38);
    }

    return { r, g, b };
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

/** Read the first reference image, if the run has one we can open. */
async function loadReference(request: ProviderRequest): Promise<DecodedImage | null> {
  const candidates = Object.values(request.inputs)
    .flat()
    .filter((value) => value.kind === "image" && value.localPath);
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate.localPath!);
      return decodePng(bytes);
    } catch {
      // A reference we cannot read is treated as absent rather than fatal.
    }
  }
  return null;
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

    if (request.modelKey === "prism-text-sculptor") {
      return { status: "succeeded", text: this.sculpt(request), synthetic: true };
    }

    const quality = typeof request.params.quality === "string" ? request.params.quality : "standard";
    const count = clampCount(request.params.count);
    const factor = QUALITY_SCALE[quality] ?? 1;
    const [baseWidth, baseHeight] = parseSize(request.params.size);
    const width = Math.max(64, Math.round(baseWidth * factor));
    const height = Math.max(64, Math.round(baseHeight * factor));

    const prompt = promptFor(request);
    const reference = await loadReference(request);

    const assets: ProviderOutputAsset[] = [];
    for (let index = 0; index < count; index += 1) {
      assets.push({
        data: renderImage(prompt, index, width, height, reference),
        mime: "image/png",
        filename: `demo-${slug(request.taskKey)}-${index + 1}.png`,
        width,
        height,
      });
    }

    return { status: "succeeded", assets, synthetic: true };
  }

  private sculpt(request: ProviderRequest): string {
    const source = promptFor(request);
    const tone = typeof request.params.tone === "string" ? request.params.tone : "descriptive";
    const maxWords = typeof request.params.maxWords === "number" ? request.params.maxWords : 120;

    const openers: Record<string, string[]> = {
      descriptive: [
        "A detailed scene in which",
        "A carefully composed frame showing",
        "A richly textured view of",
      ],
      concise: ["A clear view of", "A simple frame of", "A focused shot of"],
      cinematic: ["A cinematic frame featuring", "A dramatically lit shot of", "A wide-angle view of"],
    };
    const closers: Record<string, string[]> = {
      descriptive: [
        ", rendered with soft volumetric light and shallow depth of field.",
        ", with layered depth and carefully separated planes.",
        ", emphasising material texture and natural falloff.",
      ],
      concise: [", evenly lit.", ", centred.", ", uncluttered."],
      cinematic: [
        ", with strong rim light and deep shadows.",
        ", shot on a wide lens with anamorphic flare.",
        ", graded with cool shadows and warm highlights.",
      ],
    };

    const opener = openers[tone]?.[0] ?? openers.descriptive![0]!;
    const closer = closers[tone]?.[0] ?? closers.descriptive![0]!;
    const text = `${opener} ${source}${closer}`;
    const words = text.split(/\s+/);
    return words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}…`;
  }
}

function clampCount(value: unknown): number {
  const n = typeof value === "number" ? Math.round(value) : 1;
  return Math.min(4, Math.max(1, n));
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").toLowerCase().slice(0, 40) || "output";
}
