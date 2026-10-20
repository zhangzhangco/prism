<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import type { AssetRef } from "@prism/contracts";
import { SOURCE_HANDLE } from "@/graph/types";
import { useCanvasStore } from "@/stores/canvas";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const canvas = useCanvasStore();

const assets = computed<AssetRef[]>(() => {
  const value = (props.data as { assets?: AssetRef[] })?.assets;
  return Array.isArray(value) ? value : [];
});

const selectedId = computed(() => {
  const value = (props.data as { selectedAssetId?: string })?.selectedAssetId;
  return value ?? assets.value[0]?.id ?? null;
});

const synthetic = computed(() => Boolean((props.data as { synthetic?: boolean })?.synthetic));

function select(asset: AssetRef): void {
  canvas.updateNodeData(props.id, { selectedAssetId: asset.id });
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--result">R</span>
      {{ synthetic ? "Demo result" : "Result" }}
    </div>
    <div class="node__body">
      <p v-if="synthetic" class="node__notice">
        Produced by the built-in demo backend, not a model.
      </p>

      <div v-if="assets.length" class="node__thumbs">
        <button
          v-for="asset in assets"
          :key="asset.id"
          class="node__thumb-button"
          :class="{ 'is-selected': asset.id === selectedId }"
          type="button"
          :title="asset.id === selectedId ? 'Carried onto the wire' : 'Use this one'"
          @click="select(asset)"
        >
          <AssetImage :asset="asset" />
        </button>
      </div>
      <p v-else class="node__hint">No output.</p>

      <p v-if="assets.length > 1" class="node__hint">
        The highlighted image is the one sent to the next node.
      </p>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
