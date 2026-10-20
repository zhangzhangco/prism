import type { AssetRef, RunStatus } from "@prism/contracts";
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

/** Payload of a generator node: the plugin it runs and its parameters. */
export interface GeneratorNodeData {
  pluginId: string;
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
