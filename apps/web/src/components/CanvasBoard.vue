<script setup lang="ts">
import { VueFlow, useVueFlow, type Connection, type Edge } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { DataType } from "@prism/contracts";
import { useCatalogStore } from "@/stores";
import { useSubjectStore } from "@/stores/subjects";
import { useCanvasStore } from "@/stores/canvas";
import { nodeDataType } from "@/graph/types";
import type { FlowNode } from "@/graph/types";
import PromptNode from "@/nodes/PromptNode.vue";
import TextNode from "@/nodes/TextNode.vue";
import ImageNode from "@/nodes/ImageNode.vue";
import SubjectNode from "@/nodes/SubjectNode.vue";
import GeneratorNode from "@/nodes/GeneratorNode.vue";
import ResultNode from "@/nodes/ResultNode.vue";
import StageNode from "@/nodes/StageNode.vue";

const { t } = useI18n();
const canvas = useCanvasStore();
const catalog = useCatalogStore();
const library = useSubjectStore();
const { fitView, setViewport, viewport, onInit, screenToFlowCoordinate } = useVueFlow();

/**
 * Drop a node type or a subject onto the canvas.
 *
 * The drop position is turned into the canvas's own coordinates, so the node
 * lands where the pointer was released rather than in the corner.
 */
function onDrop(event: DragEvent): void {
  const payload = event.dataTransfer?.getData("application/prism");
  if (!payload) return;

  const position = screenToFlowCoordinate({ x: event.clientX, y: event.clientY });

  if (payload.startsWith("node:")) {
    canvas.addNode(payload.slice("node:".length), position);
    return;
  }

  if (payload.startsWith("subject:")) {
    const subject = library.byId.get(payload.slice("subject:".length));
    if (subject) canvas.addSubjectNode(subject, position);
  }
}

/** The type of value a generator puts on its wire. */
function generatorOutputType(node: FlowNode | undefined): DataType | null {
  if (!node || node.type !== "generator") return null;
  const pluginId = (node.data as { pluginId?: string })?.pluginId;
  const plugin = pluginId ? catalog.pluginById.get(pluginId) : undefined;
  return plugin?.outputs[0]?.dataType ?? null;
}

/** The type a target handle accepts, read from the plugin's slot. */
function slotType(node: FlowNode | undefined, handle: string | null): DataType | null {
  if (!node || !handle) return null;
  if (node.type !== "generator") return null;
  const pluginId = (node.data as { pluginId?: string })?.pluginId;
  const plugin = pluginId ? catalog.pluginById.get(pluginId) : undefined;
  const key = handle.startsWith("slot:") ? handle.slice(5) : handle;
  const slot = plugin?.inputs.find((candidate) => candidate.key === key);
  return slot?.dataType ?? null;
}

/**
 * Refuse a connection that could never carry anything.
 *
 * A picture cannot feed a text slot, and a generator can only feed a slot
 * that accepts what it produces.
 */
function isValidConnection(connection: Connection | Edge): boolean {
  const source = canvas.flowNodes.find((node) => node.id === connection.source);
  const target = canvas.flowNodes.find((node) => node.id === connection.target);
  if (!source || !target) return false;

  const produced = nodeDataType(source) ?? generatorOutputType(source);
  const accepted = slotType(target, connection.targetHandle ?? null);
  if (!produced || !accepted) return true;

  return produced === accepted || accepted === "any";
}

function onConnect(connection: Connection): void {
  canvas.connect(connection);
}

function onNodeDragStop(): void {
  canvas.scheduleSave();
}

function onPaneClick(): void {
  canvas.selectedNodeId = null;
}

/** Keep the stored viewport in step with the visible one. */
watch(
  viewport,
  (next) => {
    const current = canvas.viewport;
    if (
      Math.abs(current.x - next.x) < 0.5 &&
      Math.abs(current.y - next.y) < 0.5 &&
      Math.abs(current.zoom - next.zoom) < 0.001
    ) {
      return;
    }
    canvas.setViewport({ x: next.x, y: next.y, zoom: next.zoom });
  },
  { deep: true },
);

/** Restore the viewport of the canvas that was just opened. */
watch(
  () => canvas.currentId,
  () => {
    const saved = canvas.viewport;
    if (saved.x === 0 && saved.y === 0 && saved.zoom === 1) {
      void fitView({ padding: 0.2 });
    } else {
      void setViewport(saved);
    }
  },
);

onMounted(() => {
  const saved = canvas.viewport;
  if (saved.x === 0 && saved.y === 0 && saved.zoom === 1) {
    void fitView({ padding: 0.2 });
  } else {
    void setViewport(saved);
  }
});

onInit(() => {
  const saved = canvas.viewport;
  if (saved.x !== 0 || saved.y !== 0 || saved.zoom !== 1) {
    void setViewport(saved);
  }
});
</script>

<template>
  <div class="board" @dragover.prevent @drop.prevent="onDrop">
    <VueFlow
      v-model:nodes="canvas.flowNodes"
      v-model:edges="canvas.flowEdges"
      :min-zoom="0.2"
      :max-zoom="2"
      :snap-to-grid="canvas.snapToGrid"
      :snap-grid="[8, 8]"
      :is-valid-connection="isValidConnection"
      @connect="onConnect"
      @node-drag-stop="onNodeDragStop"
      @pane-click="onPaneClick"
    >
      <template #node-prompt="props">
        <PromptNode v-bind="props" />
      </template>
      <template #node-text="props">
        <TextNode v-bind="props" />
      </template>
      <template #node-image="props">
        <ImageNode v-bind="props" />
      </template>
      <template #node-subject="props">
        <SubjectNode v-bind="props" />
      </template>
      <template #node-generator="props">
        <GeneratorNode v-bind="props" />
      </template>
      <template #node-result="props">
        <ResultNode v-bind="props" />
      </template>
      <template #node-stage="props">
        <StageNode v-bind="props" />
      </template>

      <Background :gap="16" :size="1" pattern-color="#d7dbe0" />
      <Controls />
      <MiniMap v-if="canvas.showMinimap" pannable zoomable />
    </VueFlow>

    <div class="board__overlay">
      <span>{{ t("sidebar.nodeCounts", { count: canvas.flowNodes.length }) }}</span>
      <span>·</span>
      <span>{{ t("node.connections") }} {{ canvas.flowEdges.length }}</span>
      <template v-if="canvas.dirty">
        <span>·</span>
        <span>unsaved changes</span>
      </template>
    </div>
  </div>
</template>
