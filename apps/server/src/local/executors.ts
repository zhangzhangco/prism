import { readFile } from "node:fs/promises";
import { decodePng, type DecodedImage } from "../png-decode.js";
import { encodeDecodedPng, resample } from "../resample.js";
import type { ProviderInputValue } from "../providers/types.js";

/**
 * Local runtimes.
 *
 * Some generators do not need a model at all — they transform text or image
 * data in process. They are declared with `runtime: { kind: "local" }` and
 * executed here, without touching a provider.
 */

export interface LocalRequest {
  prompt: string;
  params: Record<string, unknown>;
  /** Collected slot values, keyed by slot key. */
  inputs?: Record<string, ProviderInputValue[]>;
}

export interface LocalResult {
  text?: string;
  /** Images produced locally, for example a resampled source image. */
  images?: { data: Buffer; mime: string; filename: string; width: number; height: number }[];
}

export type LocalExecutor = (request: LocalRequest) => LocalResult | Promise<LocalResult>;

const OPENERS: Record<string, string[]> = {
  descriptive: [
    "A detailed scene in which",
    "A carefully composed frame showing",
    "A richly textured view of",
  ],
  concise: ["A clear view of", "A simple frame of", "A focused shot of"],
  cinematic: ["A cinematic frame featuring", "A dramatically lit shot of", "A wide-angle view of"],
};

const CLOSERS: Record<string, string[]> = {
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

/** Expand a short prompt into a fuller description. */
const promptSculptor: LocalExecutor = ({ prompt, params }) => {
  const source = prompt.trim();
  if (!source) return { text: "" };

  const tone = typeof params.tone === "string" ? params.tone : "descriptive";
  const maxWords = typeof params.maxWords === "number" ? params.maxWords : 120;

  const openers = OPENERS[tone] ?? OPENERS.descriptive!;
  const closers = CLOSERS[tone] ?? CLOSERS.descriptive!;

  const opener = openers[0]!;
  const closer = closers[0]!;
  const text = `${opener} ${source}${closer}`;

  const words = text.split(/\s+/);
  return { text: words.length <= maxWords ? text : `${words.slice(0, maxWords).join(" ")}…` };
};

/**
 * Enlarge the source image.
 *
 * This is a real resample of the input rather than a stand-in: the output
 * pixels come from the source, so the result is visibly the same picture at
 * a larger size.
 */
async function upscaleImage({ params, inputs }: LocalRequest): Promise<LocalResult> {
  const sources = Object.values(inputs ?? {})
    .flat()
    .filter((value) => value.kind === "image");
  const source = sources[0];
  if (!source?.localPath) {
    throw new Error("Upscale needs an image to work from");
  }

  const bytes = await readFile(source.localPath);
  const decoded = decodePng(bytes);
  const factor = params.factor === "4x" ? 4 : 2;

  const scaled = resample(decoded, decoded.width * factor, decoded.height * factor);
  return {
    images: [
      {
        data: encodeDecodedPng(scaled),
        mime: "image/png",
        filename: `upscale-${factor}x.png`,
        width: scaled.width,
        height: scaled.height,
      },
    ],
  };
}

const executors: Record<string, LocalExecutor> = {
  "prompt-sculptor": promptSculptor,
  upscale: upscaleImage,
};

export function hasLocalExecutor(pluginId: string): boolean {
  return pluginId in executors;
}

export async function runLocal(
  pluginId: string,
  request: LocalRequest,
): Promise<LocalResult> {
  const executor = executors[pluginId];
  if (!executor) {
    throw new Error(`No local runtime is registered for "${pluginId}"`);
  }
  return executor(request);
}
