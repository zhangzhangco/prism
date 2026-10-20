<script setup lang="ts">
import { VueFlow, useVueFlow, type Connection } from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import { useCanvasStore } from "@/stores/canvas";
import PromptNode from "@/nodes/PromptNode.vue";
import TextNode from "@/nodes/TextNode.vue";
import ImageNode from "@/nodes/ImageNode.vue";
import GeneratorNode from "@/nodes/GeneratorNode.vue";
import ResultNode from "@/nodes/ResultNode.vue";

const canvas = useCanvasStore();
const { fitView, onInit } = useVueFlow();

function onConnect(connection: Connection): void {
  canvas.connect(connection);
}

function onNodeDragStop(): void {
  canvas.scheduleSave();
}

function onPaneClick(): void {
  canvas.selectedNodeId = null;
}

onInit(() => {
  void fitView({ padding: 0.2 });
});
</script>

<template>
  <div class="board">
    <VueFlow
      v-model:nodes="canvas.flowNodes"
      v-model:edges="canvas.flowEdges"
      :default-viewport="{ x: 0, y: 0, zoom: 1 }"
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

      <Background :gap="16" :size="1" pattern-color="#d7dbe0" />
      <Controls />
      <MiniMap pannable zoomable />
    </VueFlow>

    <div class="board__overlay">
      <span>{{ canvas.flowNodes.length }} nodes</span>
      <span>·</span>
      <span>{{ canvas.flowEdges.length }} links</span>
    </div>
  </div>
</template>
