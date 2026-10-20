<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import type { AssetRef } from "@prism/contracts";
import { SOURCE_HANDLE } from "@/graph/types";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();

const assets = computed<AssetRef[]>(() => {
  const value = (props.data as { assets?: AssetRef[] })?.assets;
  return Array.isArray(value) ? value : [];
});
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--result">R</span>
      Result
    </div>
    <div class="node__body">
      <div v-if="assets.length" class="node__thumbs">
        <AssetImage v-for="asset in assets" :key="asset.id" :asset="asset" />
      </div>
      <p v-else class="node__hint">No output.</p>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
