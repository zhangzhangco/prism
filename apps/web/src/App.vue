<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";
import { useSessionStore } from "@/stores";
import SignInView from "@/components/SignInView.vue";
import TopBar from "@/components/TopBar.vue";
import Sidebar from "@/components/Sidebar.vue";
import CanvasBoard from "@/components/CanvasBoard.vue";
import Inspector from "@/components/Inspector.vue";
import DirectorConsole from "@/components/DirectorConsole.vue";

const session = useSessionStore();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

const ready = ref(false);
const bootError = ref<string | null>(null);

/** Save the canvas when the tab is hidden or closed. */
function onUnload(): void {
  canvas.flushSaveOnUnload();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    canvas.flushSaveOnUnload();
  }
}

onMounted(async () => {
  await session.restore();
  if (session.isAuthenticated) {
    try {
      await catalog.load();
      if (catalog.canvases.length > 0) {
        await canvas.open(catalog.canvases[0]!.id);
      }
    } catch (cause) {
      bootError.value = cause instanceof Error ? cause.message : "Could not load the workspace";
    }
  }
  window.addEventListener("beforeunload", onUnload);
  document.addEventListener("visibilitychange", onVisibilityChange);
  ready.value = true;
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", onUnload);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});
</script>

<template>
  <div class="app-shell">
    <div v-if="!ready" class="boot">Loading…</div>

    <SignInView v-else-if="!session.isAuthenticated" />

    <template v-else>
      <TopBar />
      <div class="workspace">
        <Sidebar />
        <main class="workspace__board">
          <CanvasBoard />
        </main>
        <Inspector />
      </div>

      <DirectorConsole
        v-if="canvas.consoleNodeId"
        :node-id="canvas.consoleNodeId"
        @close="canvas.consoleNodeId = null"
      />
    </template>

    <p v-if="bootError" class="boot-error">{{ bootError }}</p>
  </div>
</template>
