<script setup lang="ts">
import { computed } from "vue";
import type { AssetRef } from "@prism/contracts";
import { useAssetUrl } from "@/composables/useAssetUrl";

const props = defineProps<{ asset: AssetRef; alt?: string }>();

const asset = computed(() => props.asset);
const { src, failed } = useAssetUrl(asset);
</script>

<template>
  <img v-if="src" class="node__thumb" :src="src" :alt="props.alt ?? props.asset.filename" />
  <div v-else class="node__thumb node__thumb--placeholder">
    <span v-if="failed">Unavailable</span>
    <span v-else>Loading…</span>
  </div>
</template>
