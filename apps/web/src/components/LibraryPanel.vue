<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { AssetRef, Run } from "@prism/contracts";
import { api } from "@/api/client";
import { useCanvasStore } from "@/stores/canvas";
import AssetImage from "@/components/AssetImage.vue";

const canvas = useCanvasStore();

const tab = ref<"assets" | "runs">("assets");
const assets = ref<AssetRef[]>([]);
const runs = ref<Run[]>([]);
const loading = ref(false);
const message = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const assetResponse = await api.listAssets();
    assets.value = assetResponse.assets;
    if (canvas.currentId) {
      const runResponse = await api.listRuns(canvas.currentId);
      runs.value = runResponse.runs;
    }
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : "The library could not be loaded";
  } finally {
    loading.value = false;
  }
}

watch(() => canvas.currentId, () => void refresh(), { immediate: true });

// A finished run adds assets and a record, so the library follows the canvas
// rather than sitting on a stale snapshot.
watch(
  () => canvas.runs,
  () => void refresh(),
);

/** Put an asset on the canvas as an image node. */
function insertAsset(asset: AssetRef): void {
  const index = canvas.flowNodes.length;
  const node = canvas.addNode("image", { x: 60 + (index % 3) * 300, y: 60 + Math.floor(index / 3) * 240 });
  canvas.updateNodeData(node.id, { assets: [asset] });
  message.value = "Added to the canvas.";
}

async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !canvas.currentId) return;
  try {
    const asset = await api.uploadAsset(canvas.currentId, file);
    assets.value = [asset, ...assets.value];
    message.value = "Uploaded.";
  } catch (cause) {
    message.value = cause instanceof Error ? cause.message : "The upload failed";
  } finally {
    input.value = "";
  }
}

const runRows = computed(() =>
  runs.value.map((run) => ({
    run,
    assets: run.tasks.flatMap((task) => task.assets ?? []),
    synthetic: run.tasks.some((task) => task.synthetic),
  })),
);
</script>

<template>
  <section class="panel__section">
    <h2 class="panel__title">Library</h2>

    <div class="library__tabs">
      <button :class="{ 'is-active': tab === 'assets' }" @click="tab = 'assets'">Assets</button>
      <button :class="{ 'is-active': tab === 'runs' }" @click="tab = 'runs'">Runs</button>
    </div>

    <template v-if="tab === 'assets'">
      <div class="library__actions">
        <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="upload" />
        <button style="width: 100%" :disabled="!canvas.currentId" @click="fileInput?.click()">
          Upload an image
        </button>
      </div>

      <p v-if="loading" class="node__hint">Loading…</p>
      <p v-else-if="assets.length === 0" class="node__hint">No assets yet.</p>
      <div v-else class="library__grid">
        <button
          v-for="asset in assets"
          :key="asset.id"
          class="library__cell"
          :title="`${asset.filename} — click to place on the canvas`"
          @click="insertAsset(asset)"
        >
          <AssetImage :asset="asset" />
        </button>
      </div>
    </template>

    <template v-else>
      <p v-if="runRows.length === 0" class="node__hint">No runs on this canvas yet.</p>
      <ul v-else class="library__runs">
        <li v-for="row in runRows" :key="row.run.id">
          <div class="library__run-head">
            <span>{{ row.run.pluginId }}</span>
            <span class="list__meta">{{ row.run.status }}</span>
          </div>
          <div v-if="row.assets.length" class="library__grid">
            <button
              v-for="asset in row.assets"
              :key="asset.id"
              class="library__cell"
              @click="insertAsset(asset)"
            >
              <AssetImage :asset="asset" />
            </button>
          </div>
          <p v-else class="node__hint">
            {{ row.synthetic ? "Demo output" : "No image output" }}
          </p>
        </li>
      </ul>
    </template>

    <p v-if="message" class="console__message">{{ message }}</p>
  </section>
</template>
