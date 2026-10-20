<script setup lang="ts">
import { useCatalogStore, useSessionStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";

const session = useSessionStore();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

async function createCanvas(): Promise<void> {
  const id = await canvas.create("Untitled canvas");
  await catalog.refreshCanvases();
  void id;
}
</script>

<template>
  <header class="topbar">
    <div class="topbar__brand">
      <span class="topbar__mark" aria-hidden="true"></span>
      Prism
    </div>
    <div class="topbar__title">{{ canvas.currentName || "No canvas" }}</div>
    <div class="topbar__spacer"></div>
    <span class="topbar__status">
      <template v-if="canvas.saving">Saving…</template>
      <template v-else-if="canvas.lastSavedAt">Saved</template>
    </span>
    <button class="ghost" @click="session.signOut()">Sign out</button>
  </header>
</template>
