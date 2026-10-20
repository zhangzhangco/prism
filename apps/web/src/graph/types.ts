import type { AssetRef, DataType, RunStatus } from "@prism/contracts";
import type { Edge, Node } from "@vue-flow/core";

/**
 * Vue Flow's `Node` generic expands into a very deep type. Pinning the data
 * and event parameters keeps the compiler fast and the editor hints useful.
 */
export type FlowNode = Node<Record<string, unknown>, any, string>;
export type FlowEdge = Edge<Record<string, unknown>, any, string>;

/** Payload of a prompt node: a single line of text. */
export interface PromptNodeData {
  text: string;
}

/** Payload of a text node: a longer block of text. */
export interface TextNodeData {
  text: string;
}

/** Payload of an image node: one or more uploaded images. */
export interface ImageNodeData {
  assets: AssetRef[];
  label?: string;
}

/** Payload of a generator node: the plugin it runs, the model and its parameters. */
export interface GeneratorNodeData {
  pluginId: string;
  /** The model to run against. Defaults to the plugin's own. */
  modelKey?: string;
  params: Record<string, unknown>;
  runId?: string;
  status?: RunStatus;
  error?: string;
}

/** Payload of a result node: the assets produced by a run. */
export interface ResultNodeData {
  assets: AssetRef[];
  runId?: string;
  label?: string;
  producerNodeId?: string;
  /** True when the output came from the built-in demo backend. */
  synthetic?: boolean;
  /** The asset the wire carries when there is more than one. */
  selectedAssetId?: string;
}

/** Every node kind carries one of these payloads. */
export type AnyNodeData =
  | PromptNodeData
  | TextNodeData
  | ImageNodeData
  | GeneratorNodeData
  | ResultNodeData;

/** The id of the single output handle every node exposes. */
export const SOURCE_HANDLE = "out";

/** Target handles are `slot:<key>`, so an edge says which input it feeds. */
export function slotHandle(key: string): string {
  return `slot:${key}`;
}

export function slotKeyFromHandle(handle: string): string {
  const match = /^slot:(.+)$/.exec(handle);
  return match?.[1] ?? handle;
}

/**
 * The kind of value a node puts on its wire.
 *
 * The server refuses a run whose inputs do not match, but finding out at
 * run time is late. Knowing the type here lets the canvas refuse a
 * connection that could never work — a picture into a text slot, for
 * instance.
 */
export function nodeDataType(node: FlowNode | undefined): DataType | null {
  if (!node) return null;
  switch (node.type) {
    case "prompt":
    case "text":
      return "text";
    case "image":
    case "result":
    case "stage":
      return "image";
    default:
      return null;
  }
}
