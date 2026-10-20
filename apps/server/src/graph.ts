import type { CanvasDocument, CanvasNode, PluginManifest, SlotSpec } from "@prism/contracts";
import type { ProviderInputValue } from "./providers/types.js";

/**
 * Derive the values a generator node receives from the canvas graph.
 *
 * The client never sends the payload of a run: the server walks the stored
 * document, finds the edges that terminate on the generator, and reads the
 * values from the producing nodes. That keeps the request small and makes the
 * server the single authority on what a run actually consumed.
 */

export interface ResolvedInput {
  slot: SlotSpec;
  values: ProviderInputValue[];
  /** Ids of the nodes that contributed, for auditing. */
  sources: string[];
}
export class GraphResolutionError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "GraphResolutionError";
  }
}

/** Slot keys are encoded into the target handle, e.g. `slot:image`. */
export function slotKeyFromHandle(handle: string): string {
  const match = /^slot:(.+)$/.exec(handle);
  return match?.[1] ?? handle;
}

function findNode(document: CanvasDocument, nodeId: string): CanvasNode | undefined {
  return document.nodes.find((node) => node.id === nodeId);
}

/** A stored asset as it appears inside a node's data. */
interface NodeAsset {
  id: string;
  url: string;
  mime?: string;
}

function toProviderImage(asset: NodeAsset): ProviderInputValue {
  return {
    kind: "image",
    assetId: asset.id,
    url: asset.url,
    ...(asset.mime ? { mime: asset.mime } : {}),
  };
}

function isNodeAsset(value: unknown): value is NodeAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Record<string, unknown>;
  return typeof asset.id === "string" && typeof asset.url === "string";
}

function valuesFromNode(node: CanvasNode): ProviderInputValue[] {
  const data = node.data ?? {};

  if (node.kind === "prompt" || node.kind === "text") {
    const text = typeof data.text === "string" ? data.text : "";
    return text.trim() ? [{ kind: "text", text }] : [];
  }

  if (node.kind === "image" || node.kind === "result") {
    const assets = Array.isArray(data.assets) ? data.assets : [];

    // A result node can carry several outputs. When the user has picked one,
    // that is the single value the wire carries.
    const selected = typeof data.selectedAssetId === "string" ? data.selectedAssetId : null;
    if (selected) {
      const chosen = assets.find((asset) => isNodeAsset(asset) && asset.id === selected);
      return chosen ? [toProviderImage(chosen)] : [];
    }

    return assets.filter(isNodeAsset).map(toProviderImage);
  }

  if (node.kind === "stage") {
    // A 3D stage hands on the frame its active camera produced.
    const frame = data.frame;
    return isNodeAsset(frame) ? [toProviderImage(frame)] : [];
  }

  if (node.kind === "collection") {
    const items = Array.isArray(data.items) ? data.items : [];
    return items
      .filter((item): item is { assetId: string; url: string; mime?: string } =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof (item as { assetId?: unknown }).assetId === "string" &&
            typeof (item as { url?: unknown }).url === "string",
        ),
      )
      .map((item) => ({
        kind: "image" as const,
        assetId: item.assetId,
        url: item.url,
        ...(item.mime ? { mime: item.mime } : {}),
      }));
  }

  return [];
}

export function resolveInputs(
  document: CanvasDocument,
  nodeId: string,
  plugin: PluginManifest,
): ResolvedInput[] {
  return plugin.inputs.map((slot) => {
    const values: ProviderInputValue[] = [];
    const sources: string[] = [];

    for (const edge of document.edges) {
      if (edge.target !== nodeId) continue;
      if (slotKeyFromHandle(edge.targetHandle) !== slot.key) continue;

      const source = findNode(document, edge.source);
      if (!source) continue;

      const produced = valuesFromNode(source);
      if (produced.length === 0) continue;

      values.push(...produced);
      sources.push(source.id);
    }

    const max = slot.max ?? Number.POSITIVE_INFINITY;
    return { slot, values: values.slice(0, max), sources };
  });
}

/** Throw when a required slot did not receive anything. */
export function assertInputsSatisfied(inputs: ResolvedInput[]): void {
  for (const input of inputs) {
    const min = input.slot.min ?? (input.slot.required ? 1 : 0);
    if (input.values.length < min) {
      throw new GraphResolutionError(
        `The "${input.slot.label}" input needs at least ${min} value(s), got ${input.values.length}`,
        "missing_input",
      );
    }
  }
}

/** Merge the text of every text-like input into a single prompt. */
export function composePrompt(inputs: ResolvedInput[], params: Record<string, unknown>): string {
  const explicit = typeof params.prompt === "string" ? params.prompt.trim() : "";
  if (explicit) return explicit;

  const parts: string[] = [];
  for (const input of inputs) {
    for (const value of input.values) {
      if (value.kind === "text" && value.text?.trim()) parts.push(value.text.trim());
    }
  }
  return parts.join(", ");
}
