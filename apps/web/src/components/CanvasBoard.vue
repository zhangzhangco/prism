<script setup lang="ts">
import { VueFlow, useVueFlow, type Connection } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { onMounted, watch } from "vue";
import { useCanvasStore } from "@/stores/canvas";
import PromptNode from "@/nodes/PromptNode.vue";
import TextNode from "@/nodes/TextNode.vue";
import ImageNode from "@/nodes/ImageNode.vue";
import GeneratorNode from "@/nodes/GeneratorNode.vue";
import ResultNode from "@/nodes/ResultNode.vue";
import StageNode from "@/nodes/StageNode.vue";

const canvas = useCanvasStore();
const { fitView, setViewport, viewport, onInit } = useVueFlow();

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
  <div class="board">
    <VueFlow
      v-model:nodes="canvas.flowNodes"
      v-model:edges="canvas.flowEdges"
      :min-zoom="0.2"
      :max-zoom="2"
      :snap-to-grid="true"
      :snap-grid="[8, 8]"
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
      <MiniMap pannable zoomable />
    </VueFlow>

    <div class="board__overlay">
      <span>{{ canvas.flowNodes.length }} nodes</span>
      <span>·</span>
      <span>{{ canvas.flowEdges.length }} links</span>
      <template v-if="canvas.dirty">
        <span>·</span>
        <span>unsaved changes</span>
      </template>
    </div>
  </div>
</template>
