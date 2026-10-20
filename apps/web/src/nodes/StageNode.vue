<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import type { AssetRef } from "@prism/contracts";
import { SOURCE_HANDLE } from "@/graph/types";
import { useCanvasStore } from "@/stores/canvas";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const canvas = useCanvasStore();

const frame = computed<AssetRef | null>(() => {
  const value = (props.data as { frame?: AssetRef })?.frame;
  return value && typeof value.id === "string" ? value : null;
});

const objectCount = computed(() => {
  const stage = (props.data as { stage?: { objects?: unknown[] } })?.stage;
  return stage?.objects?.length ?? 0;
});

function open(): void {
  canvas.consoleNodeId = props.id;
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--stage">3D</span>
      Director's console
    </div>
    <div class="node__body">
      <AssetImage v-if="frame" :asset="frame" />
      <p v-else class="node__hint">
        {{ objectCount }} object{{ objectCount === 1 ? "" : "s" }}. Open the console to frame a
        shot and export it.
      </p>

      <div class="node__actions">
        <button type="button" @click="open">Open console</button>
      </div>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
