import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Connection } from "@vue-flow/core";
import type { AssetRef, CanvasDocument, Run, Viewport } from "@prism/contracts";
import { documentFingerprint } from "@prism/contracts";
import { api, ApiError } from "@/api/client";
import { documentToEdges, documentToNodes, nodesToDocument } from "@/graph/convert";
import { SOURCE_HANDLE, slotHandle, type FlowEdge, type FlowNode, type GeneratorNodeData } from "@/graph/types";
import { defaultStage } from "@/stage/defaults";

let idCounter = 0;
function localId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}

const SAVE_DEBOUNCE_MS = 600;

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

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const pollers = new Map<string, ReturnType<typeof setInterval>>();

  const document = computed<CanvasDocument>(() => ({
    ...nodesToDocument(flowNodes.value, flowEdges.value),
    viewport: viewport.value,
  }));
  const fingerprint = computed(() => documentFingerprint(document.value));
  const selectedNode = computed(() =>
    flowNodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );

  function applyDocument(next: CanvasDocument): void {
    flowNodes.value = documentToNodes(next);
    flowEdges.value = documentToEdges(next);
    viewport.value = next.viewport ?? { x: 0, y: 0, zoom: 1 };
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
    const id = localId(kind);
    const data: Record<string, unknown> = { text: "" };
    if (kind === "image" || kind === "result") data.assets = [];
    if (kind === "generator") {
      data.pluginId = "text-to-image";
      data.params = { ratio: "1:1" };
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
    try {
      return await api.startRun(canvasId, {
        nodeId,
        pluginId: data.pluginId,
        params: data.params ?? {},
        documentFingerprint: fingerprint.value,
      });
    } catch (cause) {
      // The graph on the server was older than the one on screen. Save and
      // try once more before giving up.
      if (cause instanceof ApiError && cause.code === "stale_document") {
        dirty.value = true;
        await saveNow();
        return api.startRun(canvasId, {
          nodeId,
          pluginId: data.pluginId,
          params: data.params ?? {},
          documentFingerprint: fingerprint.value,
        });
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
    run,
    reset,
  };
});
