<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetRef } from "@prism/contracts";
import { SOURCE_HANDLE } from "@/graph/types";
import { useCanvasStore } from "@/stores/canvas";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const { t } = useI18n();
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
      {{ t("node.stage") }}
    </div>
    <div class="node__body">
      <AssetImage v-if="frame" :asset="frame" />
      <p v-else class="node__hint">{{ t("node.stageHint", { count: objectCount }) }}</p>

      <div class="node__actions">
        <button type="button" @click="open">{{ t("node.openConsole") }}</button>
      </div>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
