<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetRef } from "@prism/contracts";
import { api } from "@/api/client";
import { useCanvasStore } from "@/stores/canvas";
import { SOURCE_HANDLE } from "@/graph/types";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const { t } = useI18n();
const canvas = useCanvasStore();
const uploading = ref(false);
const uploadError = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const assets = computed<AssetRef[]>(() => {
  const value = (props.data as { assets?: AssetRef[] })?.assets;
  return Array.isArray(value) ? value : [];
});

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !canvas.currentId) return;

  uploading.value = true;
  uploadError.value = null;
  try {
    const asset = await api.uploadAsset(canvas.currentId, file);
    canvas.updateNodeData(props.id, { assets: [...assets.value, asset] });
  } catch (cause) {
    uploadError.value = cause instanceof Error ? cause.message : t("library.uploadFailed");
  } finally {
    uploading.value = false;
    input.value = "";
  }
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--image">I</span>
      {{ t("node.image") }}
    </div>
    <div class="node__body">
      <div v-if="assets.length" class="node__thumbs">
        <AssetImage v-for="asset in assets" :key="asset.id" :asset="asset" />
      </div>
      <p v-else class="node__hint">{{ t("node.imageEmpty") }}</p>

      <div class="node__actions">
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="onFile"
        />
        <button type="button" :disabled="uploading" @click="fileInput?.click()">
          {{ uploading ? t("node.uploading") : t("node.upload") }}
        </button>
      </div>

      <p v-if="uploadError" class="node__error">{{ uploadError }}</p>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
