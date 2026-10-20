import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Connection } from "@vue-flow/core";
import type {
  AssetRef,
  CanvasDocument,
  Outline,
  StageObject,
  PluginManifest,
  Run,
  Subject,
  SubjectKind,
  Viewport,
} from "@prism/contracts";
import { documentFingerprint, effectiveParams, EMPTY_OUTLINE, reconcileParams } from "@prism/contracts";
import { api, ApiError } from "@/api/client";
import { documentToEdges, documentToNodes, nodesToDocument } from "@/graph/convert";
import { SOURCE_HANDLE, slotHandle, type FlowEdge, type FlowNode, type GeneratorNodeData } from "@/graph/types";
import { defaultStage } from "@/stage/defaults";
import { useCatalogStore } from "./index";

let idCounter = 0;
function localId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}

const SAVE_DEBOUNCE_MS = 600;

/** A stand-in used when a plugin is unknown, so the code stays total. */
const emptyPlugin: PluginManifest = {
  id: "",
  name: "",
  version: "",
  category: "",
  summary: "",
  icon: "",
  inputs: [],
  outputs: [{ key: "output", label: "Output", dataType: "any" }],
  defaults: {},
  runtime: { kind: "local" },
  enabled: false,
};

export const useCanvasStore = defineStore("canvas", () => {
  const flowNodes = shallowRef<FlowNode[]>([]);
  const flowEdges = shallowRef<FlowEdge[]>([]);
  const currentId = ref<string | null>(null);
  const currentName = ref("");
  const runs = ref<Record<string, Run>>({});
  const saving = ref(false);
  const dirty = ref(false);
  const lastSavedAt = ref<string | null>(null);
  const error = ref<string | null>(null);
  const selectedNodeId = ref<string | null>(null);
  const consoleNodeId = ref<string | null>(null);
  const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 });
  const snapToGrid = ref(true);
  const showMinimap = ref(true);
  const clipboard = shallowRef<FlowNode[]>([]);
  const outline = ref<Outline>({ ...EMPTY_OUTLINE });
  const pickerOpen = ref(false);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const pollers = new Map<string, ReturnType<typeof setInterval>>();

  /* ---- undo / redo ---- */

  interface HistoryEntry {
    nodes: FlowNode[];
    edges: FlowEdge[];
  }

  const undoStack = shallowRef<HistoryEntry[]>([]);
  const redoStack = shallowRef<HistoryEntry[]>([]);
  let restoring = false;

  function snapshot(): HistoryEntry {
    return {
      nodes: JSON.parse(JSON.stringify(flowNodes.value)) as FlowNode[],
      edges: JSON.parse(JSON.stringify(flowEdges.value)) as FlowEdge[],
    };
  }

  /** Record the state before a change, so it can be undone. */
  function remember(): void {
    if (restoring) return;
    undoStack.value = [...undoStack.value.slice(-49), snapshot()];
    redoStack.value = [];
  }

  function undo(): void {
    const previous = undoStack.value[undoStack.value.length - 1];
    if (!previous) return;
    redoStack.value = [...redoStack.value, snapshot()];
    undoStack.value = undoStack.value.slice(0, -1);
    restoring = true;
    flowNodes.value = previous.nodes;
    flowEdges.value = previous.edges;
    restoring = false;
    scheduleSave();
  }

  function redo(): void {
    const next = redoStack.value[redoStack.value.length - 1];
    if (!next) return;
    undoStack.value = [...undoStack.value, snapshot()];
    redoStack.value = redoStack.value.slice(0, -1);
    restoring = true;
    flowNodes.value = next.nodes;
    flowEdges.value = next.edges;
    restoring = false;
    scheduleSave();
  }

  const canUndo = computed(() => undoStack.value.length > 0);
  const canRedo = computed(() => redoStack.value.length > 0);


  const document = computed<CanvasDocument>(() => ({
    ...nodesToDocument(flowNodes.value, flowEdges.value),
    viewport: viewport.value,
    outline: outline.value,
  }));
  const fingerprint = computed(() => documentFingerprint(document.value));
  const selectedNode = computed(() =>
    flowNodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );

  function applyDocument(next: CanvasDocument): void {
    flowNodes.value = documentToNodes(next);
    flowEdges.value = documentToEdges(next);
    viewport.value = next.viewport ?? { x: 0, y: 0, zoom: 1 };
    outline.value = { ...EMPTY_OUTLINE, ...(next.outline ?? {}) };
    dirty.value = false;
  }

  /**
   * Write the current state out and wait for it.
   *
   * Everything that can end a session — starting a run, switching canvas,
   * closing the tab — goes through this first, so the server never acts on a
   * graph that is older than what the user is looking at.
   */
  async function flushSave(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (inFlight) {
      await inFlight;
    }
    if (!dirty.value || !currentId.value) return;
    await saveNow();
  }

  async function open(canvasId: string): Promise<void> {
    await flushSave();
    const response = await api.getCanvas(canvasId);
    currentId.value = response.canvas.id;
    currentName.value = response.canvas.name;
    applyDocument(response.canvas.document);
    lastSavedAt.value = new Date().toISOString();
    error.value = null;
  }

  async function create(name: string): Promise<string> {
    await flushSave();
    const response = await api.createCanvas(name);
    currentId.value = response.canvas.id;
    currentName.value = name;
    applyDocument({ version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    lastSavedAt.value = new Date().toISOString();
    return response.canvas.id;
  }

  function scheduleSave(): void {
    dirty.value = true;
    if (!currentId.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow(): Promise<void> {
    if (!currentId.value) return;
    const canvasId = currentId.value;
    const snapshot = document.value;
    saving.value = true;
    const task = (async () => {
      try {
        await api.saveCanvas(canvasId, snapshot, currentName.value);
        lastSavedAt.value = new Date().toISOString();
        error.value = null;
        // Only clear the flag if nothing changed while the write was in flight.
        if (fingerprint.value === documentFingerprint(snapshot)) {
          dirty.value = false;
        }
      } catch (cause) {
        error.value = cause instanceof Error ? cause.message : "Could not save the canvas";
      } finally {
        saving.value = false;
      }
    })();
    inFlight = task;
    await task;
    if (inFlight === task) inFlight = null;
  }

  function setViewport(next: Viewport): void {
    viewport.value = next;
    scheduleSave();
  }

  /**
   * Save while the tab is going away.
   *
   * A normal request would be cancelled by the navigation, so this one is
   * sent with `keepalive`, which the browser lets finish.
   */
  function flushSaveOnUnload(): void {
    if (!dirty.value || !currentId.value) return;
    dirty.value = false;
    api.saveCanvasKeepalive(currentId.value, document.value, currentName.value);
  }

  function addNode(kind: string, position: { x: number; y: number }): FlowNode {
    remember();
    const id = localId(kind);
    const data: Record<string, unknown> = { text: "" };
    if (kind === "image" || kind === "result") data.assets = [];
    if (kind === "generator") {
      const plugin = useCatalogStore().pluginById.get("text-to-image");
      data.pluginId = "text-to-image";
      data.modelKey = plugin?.runtime.kind === "provider" ? plugin.runtime.modelKey : undefined;
      data.params = { ...(plugin?.defaults ?? {}) };
    }
    if (kind === "stage") {
      data.stage = defaultStage();
    }

    const node: FlowNode = { id, type: kind, position, data };
    flowNodes.value = [...flowNodes.value, node];
    selectedNodeId.value = id;
    scheduleSave();
    return node;
  }

  function connect(connection: Connection): void {
    if (!connection.source || !connection.target) return;
    const target = flowNodes.value.find((node) => node.id === connection.target);
    if (!target) return;
    remember();

    // A generator consumes one value per input slot, so connecting to the
    // same slot twice replaces the previous edge.
    flowEdges.value = flowEdges.value.filter(
      (edge) =>
        !(
          edge.target === connection.target &&
          (edge.targetHandle ?? "") === (connection.targetHandle ?? "")
        ),
    );

    flowEdges.value = [
      ...flowEdges.value,
      {
        id: localId("edge"),
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? SOURCE_HANDLE,
        target: connection.target,
        targetHandle: connection.targetHandle ?? "",
        type: "smoothstep",
      },
    ];
    scheduleSave();
  }

  function removeNode(nodeId: string): void {
    remember();
    flowNodes.value = flowNodes.value.filter((node) => node.id !== nodeId);
    flowEdges.value = flowEdges.value.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    );
    if (selectedNodeId.value === nodeId) selectedNodeId.value = null;
    scheduleSave();
  }

  function updateNodeData(nodeId: string, patch: Record<string, unknown>): void {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    node.data = { ...(node.data ?? {}), ...patch };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  function setParam(nodeId: string, key: string, value: unknown): void {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const data = node.data as unknown as GeneratorNodeData;
    node.data = { ...(node.data ?? {}), params: { ...(data.params ?? {}), [key]: value } };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  /** Switch a generator to another model, dropping parameters it cannot take. */
  function setModel(nodeId: string, modelKey: string): void {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const data = node.data as unknown as GeneratorNodeData;
    const plugin = useCatalogStore().pluginById.get(data.pluginId);
    const model = useCatalogStore().models.find((candidate) => candidate.key === modelKey);
    const specs = effectiveParams(plugin ?? emptyPlugin, model);
    node.data = {
      ...(node.data ?? {}),
      modelKey,
      params: reconcileParams(specs, data.params ?? {}),
    };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  /**
   * Start a generation and follow it until it settles.
   *
   * The server owns the graph: it reads the stored document to work out what
   * the generator consumed, so the client only has to name the node and the
   * parameters. The document is flushed first, and the request carries a
   * fingerprint so the server can refuse to run against a stale graph.
   */
  async function run(nodeId: string): Promise<void> {
    if (!currentId.value) return;
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;

    const data = node.data as unknown as GeneratorNodeData;
    updateNodeData(nodeId, { status: "queued", error: undefined });

    try {
      await flushSave();
      const response = await startRun(nodeId, data);
      runs.value = { ...runs.value, [response.run.id]: response.run };
      updateNodeData(nodeId, { runId: response.run.id, status: response.run.status });
      follow(response.run.id, nodeId);
    } catch (cause) {
      updateNodeData(nodeId, {
        status: "failed",
        error: cause instanceof Error ? cause.message : "The run could not be started",
      });
    }
  }

  async function startRun(nodeId: string, data: GeneratorNodeData) {
    const canvasId = currentId.value!;
    const body = {
      nodeId,
      pluginId: data.pluginId,
      modelKey: data.modelKey,
      params: data.params ?? {},
      documentFingerprint: fingerprint.value,
    };
    try {
      return await api.startRun(canvasId, body);
    } catch (cause) {
      // The graph on the server was older than the one on screen. Save and
      // try once more before giving up.
      if (cause instanceof ApiError && cause.code === "stale_document") {
        dirty.value = true;
        await saveNow();
        return api.startRun(canvasId, body);
      }
      throw cause;
    }
  }

  function follow(runId: string, nodeId: string): void {
    if (pollers.has(runId)) return;
    const timer = setInterval(() => {
      void api
        .getRun(runId)
        .then((response) => {
          runs.value = { ...runs.value, [response.run.id]: response.run };
          updateNodeData(nodeId, { status: response.run.status, error: response.run.error });

          if (["succeeded", "failed", "canceled"].includes(response.run.status)) {
            clearInterval(timer);
            pollers.delete(runId);
            if (response.run.status === "succeeded") {
              const assets = response.run.tasks.flatMap((task) => task.assets ?? []);
              const text = response.run.tasks.map((task) => task.text ?? "").join("\n").trim();
              if (assets.length > 0) {
                addResultNode(nodeId, response.run, assets);
              } else if (text) {
                addTextNode(nodeId, response.run, text);
              }
            }
          }
        })
        .catch(() => {
          clearInterval(timer);
          pollers.delete(runId);
        });
    }, 900);
    pollers.set(runId, timer);
  }

  function addResultNode(producerId: string, run: Run, assets: AssetRef[]): void {
    const producer = flowNodes.value.find((node) => node.id === producerId);
    if (!producer) return;

    const id = localId("result");
    const synthetic = run.tasks.some((task) => task.synthetic);
    const node: FlowNode = {
      id,
      type: "result",
      position: { x: producer.position.x + 300, y: producer.position.y },
      data: {
        assets,
        runId: run.id,
        label: synthetic ? "Demo result" : "Result",
        producerNodeId: producerId,
        synthetic,
        // The first output is the one carried onto the wire until the user
        // picks another one.
        selectedAssetId: assets[0]?.id,
      },
    };
    flowNodes.value = [...flowNodes.value, node];
    flowEdges.value = [
      ...flowEdges.value,
      {
        id: localId("edge"),
        source: producerId,
        sourceHandle: SOURCE_HANDLE,
        target: id,
        targetHandle: slotHandle("output"),
        type: "smoothstep",
      },
    ];
    scheduleSave();
  }

  /** A run that produced text leaves a node the user can wire onwards. */
  function addTextNode(producerId: string, run: Run, text: string): void {
    const producer = flowNodes.value.find((node) => node.id === producerId);
    if (!producer) return;

    const id = localId("text");
    const node: FlowNode = {
      id,
      type: "text",
      position: { x: producer.position.x + 300, y: producer.position.y },
      data: { text, runId: run.id, label: "Text result" },
    };
    flowNodes.value = [...flowNodes.value, node];
    flowEdges.value = [
      ...flowEdges.value,
      {
        id: localId("edge"),
        source: producerId,
        sourceHandle: SOURCE_HANDLE,
        target: id,
        targetHandle: slotHandle("output"),
        type: "smoothstep",
      },
    ];
    scheduleSave();
  }

  function reset(): void {
    for (const timer of pollers.values()) clearInterval(timer);
    pollers.clear();
    flowNodes.value = [];
    flowEdges.value = [];
    currentId.value = null;
    currentName.value = "";
    runs.value = {};
    selectedNodeId.value = null;
    viewport.value = { x: 0, y: 0, zoom: 1 };
    undoStack.value = [];
    redoStack.value = [];
  }

  /* ---- subjects: the outline, the stage and the generators ---- */

  const outlineKeyFor = (kind: SubjectKind): keyof Outline =>
    kind === "actor" ? "actors" : kind === "scene" ? "scenes" : kind === "prop" ? "props" : "effects";

  /** Record a subject as part of this production. */
  function addToOutline(subject: { id: string; kind: SubjectKind }): void {
    const key = outlineKeyFor(subject.kind);
    if (outline.value[key].includes(subject.id)) return;
    outline.value = { ...outline.value, [key]: [...outline.value[key], subject.id] };
    scheduleSave();
  }

  function removeFromOutline(subjectId: string, kind: SubjectKind): void {
    const key = outlineKeyFor(kind);
    if (!outline.value[key].includes(subjectId)) return;
    outline.value = {
      ...outline.value,
      [key]: outline.value[key].filter((id) => id !== subjectId),
    };
    scheduleSave();
  }

  function inOutline(subjectId: string): boolean {
    return (
      outline.value.actors.includes(subjectId) ||
      outline.value.scenes.includes(subjectId) ||
      outline.value.props.includes(subjectId) ||
      outline.value.effects.includes(subjectId)
    );
  }

  /** Attach a subject to a generator, so it joins the prompt. */
  function attachSubjectToNode(nodeId: string, subjectId: string): void {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const subjects = Array.isArray((node.data as { subjects?: string[] }).subjects)
      ? ((node.data as { subjects: string[] }).subjects ?? [])
      : [];
    if (subjects.includes(subjectId)) return;
    node.data = { ...(node.data ?? {}), subjects: [...subjects, subjectId] };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  function detachSubjectFromNode(nodeId: string, subjectId: string): void {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;
    const subjects = Array.isArray((node.data as { subjects?: string[] }).subjects)
      ? ((node.data as { subjects: string[] }).subjects ?? [])
      : [];
    node.data = {
      ...(node.data ?? {}),
      subjects: subjects.filter((id) => id !== subjectId),
    };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  function subjectsOfNode(nodeId: string): string[] {
    const node = flowNodes.value.find((item) => item.id === nodeId);
    const subjects = (node?.data as { subjects?: string[] } | undefined)?.subjects;
    return Array.isArray(subjects) ? subjects : [];
  }

  /** The stage node of this canvas, if there is one. */
  function stageNode(): FlowNode | undefined {
    return flowNodes.value.find((node) => node.type === "stage");
  }

  /**
   * Put a subject into the 3D stage.
   *
   * An actor becomes a figure and a prop becomes a primitive. A scene is not an
   * object but a set of stage settings, so it is applied to the stage
   * instead. The object keeps a link to the subject, so the link survives a
   * save and the object can be traced back to the library.
   */
  function addSubjectToStage(subject: Subject): boolean {
    const stage = stageNode();
    if (!stage) return false;

    const stageData = (stage.data ?? {}) as {
      stage?: {
        objects: StageObject[];
        settings: { ground: boolean; grid: boolean; backdrop: boolean; light: number };
      };
    };
    const current = stageData.stage ?? defaultStage();

    if (subject.kind === "scene") {
      const spec = subject.data as unknown as Record<string, unknown>;
      const settings = {
        ...current.settings,
        light: typeof spec.light === "number" ? spec.light : current.settings.light,
      };
      stage.data = {
        ...(stage.data ?? {}),
        stage: { ...current, settings },
      };
      flowNodes.value = [...flowNodes.value];
      scheduleSave();
      return true;
    }

    if (subject.kind === "effect") return false;

    const spec = subject.data as unknown as Record<string, unknown>;
    const object: StageObject = {
      id: localId("object"),
      name: subject.name,
      kind: (subject.kind === "actor"
        ? "figure"
        : ((spec.shape as string) ?? "box")) as StageObject["kind"],
      subjectId: subject.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: typeof spec.color === "string" ? spec.color : "#4c6ef5",
      height:
        subject.kind === "actor"
          ? typeof spec.height === "number"
            ? spec.height
            : 1.75
          : typeof spec.size === "number"
            ? spec.size
            : 1,
    };

    stage.data = {
      ...(stage.data ?? {}),
      stage: { ...current, objects: [...current.objects, object] },
    };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
    return true;
  }

  /** Drop a subject onto the canvas as a node of its own. */
  function addSubjectNode(subject: Subject, position: { x: number; y: number }): FlowNode {
    remember();
    const id = localId("subject");
    const node: FlowNode = {
      id,
      type: "subject",
      position,
      data: { subjectId: subject.id, text: subject.name },
    };
    flowNodes.value = [...flowNodes.value, node];
    selectedNodeId.value = id;
    scheduleSave();
    return node;
  }

  /* ---- canvas operations ---- */

  function setSnapToGrid(value: boolean): void {
    snapToGrid.value = value;
  }

  function setShowMinimap(value: boolean): void {
    showMinimap.value = value;
  }

  function rename(name: string): void {
    currentName.value = name.trim() || currentName.value;
    scheduleSave();
  }

  /**
   * Lay the nodes out in a grid.
   *
   * A canvas drifts as nodes are moved around. Tidy puts them back into
   * readable columns, keeping the order they are in.
   */
  function tidy(): void {
    if (flowNodes.value.length === 0) return;
    remember();

    const columnWidth = 320;
    const rowHeight = 260;
    const perRow = Math.max(1, Math.ceil(Math.sqrt(flowNodes.value.length * 1.6)));

    const sorted = [...flowNodes.value].sort((a, b) => {
      if (a.position.y !== b.position.y) return a.position.y - b.position.y;
      return a.position.x - b.position.x;
    });

    const moved = sorted.map((node, index) => ({
      ...node,
      position: {
        x: 60 + (index % perRow) * columnWidth,
        y: 60 + Math.floor(index / perRow) * rowHeight,
      },
    }));
    flowNodes.value = moved;
    scheduleSave();
  }

  /** Copy the given nodes, and the wires between them, to the clipboard. */
  function copyNodes(nodeIds: string[]): void {
    const wanted = new Set(nodeIds);
    clipboard.value = flowNodes.value
      .filter((node) => wanted.has(node.id))
      .map((node) => ({ ...node, position: { ...node.position } }));
  }

  /** Paste the clipboard, offset so it does not land on the original. */
  function pasteNodes(): void {
    if (clipboard.value.length === 0) return;
    remember();

    const remap = new Map<string, string>();
    const copies = clipboard.value.map((node) => {
      const id = localId(node.type ?? "prompt");
      remap.set(node.id, id);
      return {
        ...node,
        id,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
      };
    });

    const extraEdges = flowEdges.value
      .filter((edge) => wanted(edge.source) && wanted(edge.target))
      .map((edge) => ({
        ...edge,
        id: localId("edge"),
        source: remap.get(edge.source) ?? edge.source,
        target: remap.get(edge.target) ?? edge.target,
      }));

    flowNodes.value = [...flowNodes.value, ...copies];
    flowEdges.value = [...flowEdges.value, ...extraEdges];
    scheduleSave();
  }

  function wanted(id: string): boolean {
    return clipboard.value.some((node) => node.id === id);
  }

  /** Download the document, so a workflow can be shared or kept. */
  function exportDocument(): void {
    const payload = JSON.stringify(document.value, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${currentName.value || "canvas"}.prism.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return {
    flowNodes,
    flowEdges,
    currentId,
    currentName,
    runs,
    saving,
    dirty,
    lastSavedAt,
    error,
    selectedNodeId,
    consoleNodeId,
    selectedNode,
    viewport,
    snapToGrid,
    showMinimap,
    canUndo,
    canRedo,
    undo,
    redo,
    remember,
    rename,
    tidy,
    copyNodes,
    pasteNodes,
    exportDocument,
    setSnapToGrid,
    setShowMinimap,
    outline,
    pickerOpen,
    addToOutline,
    removeFromOutline,
    inOutline,
    attachSubjectToNode,
    detachSubjectFromNode,
    subjectsOfNode,
    stageNode,
    addSubjectToStage,
    addSubjectNode,
    document,
    fingerprint,
    open,
    create,
    scheduleSave,
    saveNow,
    flushSave,
    flushSaveOnUnload,
    setViewport,
    addNode,
    connect,
    removeNode,
    updateNodeData,
    setParam,
    setModel,
    run,
    reset,
  };
});
