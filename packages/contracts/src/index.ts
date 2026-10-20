/**
 * Shared wire types for Prism.
 *
 * The server and the web client both speak these shapes. Keeping them in one
 * place means a change to the canvas document format or the plugin manifest
 * breaks compilation on both sides at once instead of at runtime.
 */

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Logical data type flowing along an edge or produced by a slot. */
export type DataType = "image" | "text" | "audio" | "video" | "any";

export type ParamType = "enum" | "number" | "string" | "boolean";

export interface ParamOption {
  value: string;
  label: string;
}

/** A user-configurable knob on a plugin output. */
export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default?: unknown;
  options?: ParamOption[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}

/* ------------------------------------------------------------------ *
 * Plugins
 * ------------------------------------------------------------------ */

/**
 * An input slot on a plugin. Slots are addressable: an edge that delivers a
 * value into a generator node names the slot key in its `targetHandle`, and
 * the collected values are handed to the provider under the same key.
 */
export interface SlotSpec {
  key: string;
  label: string;
  dataType: DataType;
  required: boolean;
  min?: number;
  max?: number;
  help?: string;
}

/** A produced value, together with the parameters that shape it. */
export interface OutputSpec {
  key: string;
  label: string;
  dataType: DataType;
  params: ParamSpec[];
}

export type PluginRuntime =
  | { kind: "provider"; modelKey: string }
  | { kind: "local" };

/** The declarative description of one generator. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  category: string;
  summary: string;
  icon: string;
  inputs: SlotSpec[];
  outputs: OutputSpec[];
  defaults: Record<string, unknown>;
  runtime: PluginRuntime;
  enabled: boolean;
}

/* ------------------------------------------------------------------ *
 * Canvas document
 * ------------------------------------------------------------------ */

export type NodeKind = "prompt" | "text" | "image" | "collection" | "generator";

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  /** Kind-specific payload. See the node type definitions in the web app. */
  data: Record<string, unknown>;
  width?: number;
  height?: number;
}

export interface CanvasEdge {
  id: string;
  source: string;
  /** Handle id on the source node. */
  sourceHandle: string;
  target: string;
  /** Handle id on the target node, which encodes the slot key. */
  targetHandle: string;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasDocument {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: Viewport;
}

export interface CanvasSummary {
  id: string;
  name: string;
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Assets
 * ------------------------------------------------------------------ */

export interface AssetRef {
  id: string;
  url: string;
  mime: string;
  filename: string;
  bytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

export interface ModelDescriptor {
  key: string;
  provider: string;
  label: string;
  mediaType: DataType;
  params: ParamSpec[];
  enabled: boolean;
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface RunTask {
  id: string;
  key: string;
  status: RunStatus;
  assets?: AssetRef[];
  text?: string;
  error?: string;
}

export interface Run {
  id: string;
  canvasId: string;
  nodeId: string;
  pluginId: string;
  status: RunStatus;
  params: Record<string, unknown>;
  tasks: RunTask[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: SessionUser;
}

/* ------------------------------------------------------------------ *
 * API envelope
 * ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** The shape of a successful run submission request. */
export interface RunRequest {
  nodeId: string;
  pluginId: string;
  params?: Record<string, unknown>;
  /** Values for each input slot, keyed by slot key. */
  inputs?: Record<string, unknown>;
}
