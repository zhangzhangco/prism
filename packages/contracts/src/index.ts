/**
 * Shared wire types for Prism.
 *
 * The server and the web client both speak these shapes. Keeping them in one
 * place means a change to the canvas document format or the plugin manifest
 * breaks compilation on both sides at once instead of at runtime.
 */

/**
 * The parameters a generator node shows.
 *
 * The selected model contributes the parameters the backend accepts, and the
 * plugin contributes any of its own — a free-text prompt, for instance. When
 * both define the same key, the model's definition wins.
 */
export function effectiveParams(
  plugin: PluginManifest,
  model: ModelDescriptor | undefined,
): ParamSpec[] {
  const pluginParams = plugin.outputs[0]?.params ?? [];
  const modelParams = model?.params ?? [];

  const ordered: ParamSpec[] = [];
  for (const spec of modelParams) ordered.push(spec);
  for (const spec of pluginParams) {
    if (!modelParams.some((candidate) => candidate.key === spec.key)) ordered.push(spec);
  }
  return ordered;
}

/**
 * Drop the values a model would refuse and fill in its defaults.
 *
 * Used when the model changes: the parameters kept from the previous model
 * may not be valid for the new one.
 */
export function reconcileParams(
  specs: ParamSpec[],
  current: Record<string, unknown>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const spec of specs) {
    const given = current[spec.key];
    if (given === undefined) {
      if (spec.default !== undefined) values[spec.key] = spec.default;
      continue;
    }
    if (spec.type === "enum") {
      const allowed = (spec.options ?? []).some((option) => option.value === given);
      if (allowed) values[spec.key] = given;
      else if (spec.default !== undefined) values[spec.key] = spec.default;
      continue;
    }
    if (spec.type === "number" && typeof given === "number" && Number.isFinite(given)) {
      values[spec.key] = given;
      continue;
    }
    if (spec.type === "boolean" && typeof given === "boolean") {
      values[spec.key] = given;
      continue;
    }
    if (spec.type === "string" && typeof given === "string") {
      values[spec.key] = given;
      continue;
    }
    if (spec.default !== undefined) values[spec.key] = spec.default;
  }
  return values;
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Logical data type flowing along an edge or produced by a slot. */
export type DataType = "image" | "text" | "audio" | "video" | "any";

export type ParamType = "enum" | "number" | "string" | "boolean";

export interface ParamOption {
  value: string;
  label: string;
  /** Translation key for the display label, when there is one. */
  labelKey?: string;
}

/** A parameter the user can change on a generator node. */
export interface ParamSpec {
  key: string;
  label: string;
  /** Translation key for the display label, when there is one. */
  labelKey?: string;
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
  /** Translation key for the display label, when there is one. */
  labelKey?: string;
  dataType: DataType;
  required: boolean;
  min?: number;
  max?: number;
  help?: string;
}

/**
 * A produced value.
 *
 * The parameters a user can change come from the selected model. A plugin may
 * add parameters of its own — a free-text prompt, for instance — which are
 * shown alongside the model's. When both define the same key, the model's
 * definition wins, because it knows which values the backend accepts.
 */
export interface OutputSpec {
  key: string;
  label: string;
  /** Translation key for the display label, when there is one. */
  labelKey?: string;
  dataType: DataType;
  params?: ParamSpec[];
}

export type PluginRuntime =
  | { kind: "provider"; modelKey: string }
  | { kind: "local" };

/** The declarative description of one generator. */
export interface PluginManifest {
  id: string;
  name: string;
  /** Translation key for the display name, when there is one. */
  nameKey?: string;
  version: string;
  category: string;
  summary: string;
  /** Translation key for the summary, when there is one. */
  summaryKey?: string;
  icon: string;
  inputs: SlotSpec[];
  outputs: OutputSpec[];
  defaults: Record<string, unknown>;
  runtime: PluginRuntime;
  enabled: boolean;
}

/* ------------------------------------------------------------------ *
 * Subjects
 * ------------------------------------------------------------------ */

/** The four kinds of thing a production is built from. */
export type SubjectKind = "actor" | "scene" | "prop" | "effect";

/** What a subject of each kind describes. */
export interface ActorSpec {
  height: number;
  color: string;
  build: "slim" | "regular" | "heavy";
}

export interface SceneSpec {
  backdropColor: string;
  groundColor: string;
  light: number;
  description: string;
}

export interface PropSpec {
  shape: "box" | "sphere" | "cylinder" | "cone";
  size: number;
  color: string;
}

export interface EffectSpec {
  style: string;
  description: string;
}

export type SubjectSpec = ActorSpec | SceneSpec | PropSpec | EffectSpec;

/**
 * A reusable piece of a production.
 *
 * A subject belongs to the account, not to one canvas, so the same actor or
 * prop can be used in as many productions as the account wants. What a
 * production uses is recorded in its outline.
 */
export interface Subject {
  id: string;
  kind: SubjectKind;
  name: string;
  description: string;
  tags: string[];
  /** The kind-specific shape of the subject. */
  data: SubjectSpec;
  /** An optional image that stands for the subject. */
  thumbnailAssetId: string | null;
  /** A ready-to-use link to that image, filled in by the server. */
  thumbnailUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What a production is made of.
 *
 * The outline holds the ids of the subjects the production uses, grouped by
 * kind. It lives inside the canvas document, so it is saved and restored with
 * everything else.
 */
export interface Outline {
  actors: string[];
  scenes: string[];
  props: string[];
  effects: string[];
}

export const EMPTY_OUTLINE: Outline = { actors: [], scenes: [], props: [], effects: [] };

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
  /**
   * The subject this object came from, when it was placed from the library.
   * The link survives a save, so the object keeps its identity.
   */
  subjectId?: string;
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
  /** What this production is made of. */
  outline?: Outline;
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

/**
 * The request conventions of a model.
 *
 * Different image APIs accept different fields. The GPT Image family ignores
 * the legacy `response_format` and returns base64 unconditionally, while
 * the DALL·E family wants `response_format` and only understands its own
 * quality names. The adapter switches on this.
 */
export type ModelDialect = "mock" | "gpt-image" | "dall-e" | "generic";

export interface ModelDescriptor {
  key: string;
  provider: string;
  label: string;
  /** Translation key for the display label, when there is one. */
  labelKey?: string;
  mediaType: DataType;
  dialect: ModelDialect;
  /** The parameters this model accepts, with the values it allows. */
  params: ParamSpec[];
  enabled: boolean;
  /** True when the model can be given a reference image. */
  supportsReference: boolean;
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
  /** The model the run was submitted against. */
  modelKey: string;
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
  /** The model to run against. Defaults to the plugin's own. */
  modelKey?: string;
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

