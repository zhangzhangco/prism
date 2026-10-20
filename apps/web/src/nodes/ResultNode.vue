<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetRef } from "@prism/contracts";
import { SOURCE_HANDLE } from "@/graph/types";
import { useCanvasStore } from "@/stores/canvas";
import { useLabel } from "@/composables/useLabel";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { label } = useLabel();
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
      {{ synthetic ? t("node.demoResult") : t("node.result") }}
    </div>
    <div class="node__body">
      <p v-if="synthetic" class="node__notice">{{ t("node.syntheticNotice") }}</p>

      <div v-if="assets.length" class="node__thumbs">
        <button
          v-for="asset in assets"
          :key="asset.id"
          class="node__thumb-button"
          :class="{ 'is-selected': asset.id === selectedId }"
          type="button"
          :title="asset.id === selectedId ? t('node.pickedImage') : t('library.place')"
          @click="select(asset)"
        >
          <AssetImage :asset="asset" />
        </button>
      </div>
      <p v-else class="node__hint">{{ t("common.none") }}</p>

      <p v-if="assets.length > 1" class="node__hint">{{ t("node.pickedImage") }}</p>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
