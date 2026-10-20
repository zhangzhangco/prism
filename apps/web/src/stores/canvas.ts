import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Connection } from "@vue-flow/core";
import type { AssetRef, CanvasDocument, Run } from "@prism/contracts";
import { api } from "@/api/client";
import { documentToEdges, documentToNodes, nodesToDocument } from "@/graph/convert";
import { SOURCE_HANDLE, slotHandle, type FlowEdge, type FlowNode, type GeneratorNodeData } from "@/graph/types";
import { useCatalogStore } from "./index";

let idCounter = 0;
function localId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${idCounter}-${random}`;
}

const SAVE_DEBOUNCE_MS = 700;

export const useCanvasStore = defineStore("canvas", () => {
  const flowNodes = shallowRef<FlowNode[]>([]);
  const flowEdges = shallowRef<FlowEdge[]>([]);
  const currentId = ref<string | null>(null);
  const currentName = ref("");
  const runs = ref<Record<string, Run>>({});
  const saving = ref(false);
  const lastSavedAt = ref<string | null>(null);
  const error = ref<string | null>(null);
  const selectedNodeId = ref<string | null>(null);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const pollers = new Map<string, ReturnType<typeof setInterval>>();

  const document = computed<CanvasDocument>(() =>
    nodesToDocument(flowNodes.value, flowEdges.value),
  );
  const selectedNode = computed(() =>
    flowNodes.value.find((node) => node.id === selectedNodeId.value) ?? null,
  );

  function applyDocument(next: CanvasDocument): void {
    flowNodes.value = documentToNodes(next);
    flowEdges.value = documentToEdges(next);
  }

  async function open(canvasId: string): Promise<void> {
    const response = await api.getCanvas(canvasId);
    currentId.value = response.canvas.id;
    currentName.value = response.canvas.name;
    applyDocument(response.canvas.document);
    lastSavedAt.value = new Date().toISOString();
    error.value = null;
  }

  async function create(name: string): Promise<string> {
    const response = await api.createCanvas(name);
    currentId.value = response.canvas.id;
    currentName.value = name;
    applyDocument({ version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    lastSavedAt.value = new Date().toISOString();
    return response.canvas.id;
  }

  function scheduleSave(): void {
    if (!currentId.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveNow();
    }, SAVE_DEBOUNCE_MS);
  }

  async function saveNow(): Promise<void> {
    if (!currentId.value) return;
    saving.value = true;
    try {
      await api.saveCanvas(currentId.value, document.value, currentName.value);
      lastSavedAt.value = new Date().toISOString();
      error.value = null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Could not save the canvas";
    } finally {
      saving.value = false;
    }
  }

  function addNode(kind: string, position: { x: number; y: number }): FlowNode {
    const id = localId(kind);
    const data: Record<string, unknown> = { text: "" };
    if (kind === "image") data.assets = [];
    if (kind === "generator") {
      data.pluginId = "text-to-image";
      data.params = { ratio: "1:1" };
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
    const data = node.data as unknown as unknown as GeneratorNodeData;
    node.data = { ...(node.data ?? {}), params: { ...(data.params ?? {}), [key]: value } };
    flowNodes.value = [...flowNodes.value];
    scheduleSave();
  }

  /**
   * Start a generation and follow it until it settles.
   *
   * The server owns the graph: it reads the stored document to work out what
   * the generator consumed, so the client only has to name the node and the
   * parameters.
   */
  async function run(nodeId: string): Promise<void> {
    if (!currentId.value) return;
    const node = flowNodes.value.find((item) => item.id === nodeId);
    if (!node) return;

    const data = node.data as unknown as GeneratorNodeData;
    updateNodeData(nodeId, { status: "queued", error: undefined });

    try {
      const response = await api.startRun(currentId.value, {
        nodeId,
        pluginId: data.pluginId,
        params: data.params ?? {},
      });
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
              if (assets.length > 0) {
                addResultNode(nodeId, response.run, assets);
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
    const node: FlowNode = {
      id,
      type: "result",
      position: { x: producer.position.x + 300, y: producer.position.y },
      data: {
        assets,
        runId: run.id,
        label: "Result",
        producerNodeId: producerId,
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

  function reset(): void {
    for (const timer of pollers.values()) clearInterval(timer);
    pollers.clear();
    flowNodes.value = [];
    flowEdges.value = [];
    currentId.value = null;
    currentName.value = "";
    runs.value = {};
    selectedNodeId.value = null;
  }

  return {
    flowNodes,
    flowEdges,
    currentId,
    currentName,
    runs,
    saving,
    lastSavedAt,
    error,
    selectedNodeId,
    selectedNode,
    document,
    open,
    create,
    scheduleSave,
    saveNow,
    addNode,
    connect,
    removeNode,
    updateNodeData,
    setParam,
    run,
    reset,
  };
});
