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

export type NodeKind =
  | "prompt"
  | "text"
  | "image"
  | "result"
  | "collection"
  | "stage"
  | "generator";

/* ------------------------------------------------------------------ *
 * 3D stage
 * ------------------------------------------------------------------ */

export type StageObjectKind = "figure" | "box" | "sphere" | "cylinder" | "cone";

export interface StageVector {
  x: number;
  y: number;
  z: number;
}

export interface StageObject {
  id: string;
  name: string;
  kind: StageObjectKind;
  position: StageVector;
  /** Rotation in degrees. */
  rotation: StageVector;
  scale: StageVector;
  /** A hex colour. */
  color: string;
  /** Height in metres, used by figures and props. */
  height: number;
}

export interface StageCamera {
  id: string;
  name: string;
  position: StageVector;
  target: StageVector;
  /** Vertical field of view in degrees. */
  fov: number;
}

export interface StageSettings {
  ground: boolean;
  grid: boolean;
  backdrop: boolean;
  /** Directional light intensity. */
  light: number;
}

/**
 * The document of a 3D stage.
 *
 * It lives inside the node's data, so it is saved with the canvas and comes
 * back when the canvas is reopened.
 */
export interface StageDocument {
  objects: StageObject[];
  cameras: StageCamera[];
  activeCameraId: string;
  settings: StageSettings;
}

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
  /**
   * True when the backend produced a synthetic placeholder rather than a
   * real model output. The client surfaces this so a demo result is never
   * mistaken for a generated one.
   */
  synthetic?: boolean;
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
  /**
   * Fingerprint of the document the client is looking at. The server
   * compares it with the stored document and refuses the run if they differ,
   * so a run can never silently use a stale graph.
   */
  documentFingerprint?: string;
}

/**
 * A stable fingerprint of a canvas document.
 *
 * The client and the server both compute this over the same canonical form,
 * which lets the server detect that the graph changed after the client last
 * saved it. It is a consistency check rather than a security boundary, so a
 * fast non-cryptographic hash is enough.
 */
export function documentFingerprint(document: CanvasDocument): string {
  const canonical = canonicalize(document) as unknown;
  const text = JSON.stringify(canonical);
  // FNV-1a, 64 bit, as two 32 bit halves.
  let low = 0x811c9dc5;
  let high = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low ^= code;
    low = Math.imul(low, 0x01000193) >>> 0;
    high ^= code + index;
    high = Math.imul(high, 0x01000193) >>> 0;
  }
  return `${high.toString(16).padStart(8, "0")}${low.toString(16).padStart(8, "0")}`;
}

/** Recursively sort object keys so two equal documents serialise identically. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

