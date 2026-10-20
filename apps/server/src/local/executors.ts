/**
 * Local runtimes.
 *
 * Some generators do not need a model at all — they transform text in
 * process. They are declared with `runtime: { kind: "local" }` and executed
 * here, synchronously, without touching a provider.
 */

export interface LocalRequest {
  prompt: string;
  params: Record<string, unknown>;
}

export interface LocalResult {
  text?: string;
}

export type LocalExecutor = (request: LocalRequest) => LocalResult;

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

const executors: Record<string, LocalExecutor> = {
  "prompt-sculptor": promptSculptor,
};

export function hasLocalExecutor(pluginId: string): boolean {
  return pluginId in executors;
}

export function runLocal(pluginId: string, request: LocalRequest): LocalResult {
  const executor = executors[pluginId];
  if (!executor) {
    throw new Error(`No local runtime is registered for "${pluginId}"`);
  }
  return executor(request);
}
