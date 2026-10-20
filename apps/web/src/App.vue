<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";
import { useSessionStore } from "@/stores";
import SignInView from "@/components/SignInView.vue";
import TopBar from "@/components/TopBar.vue";
import Sidebar from "@/components/Sidebar.vue";
import CanvasBoard from "@/components/CanvasBoard.vue";
import Inspector from "@/components/Inspector.vue";
import DirectorConsole from "@/components/DirectorConsole.vue";

const { t } = useI18n();
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

/** The shortcuts a canvas editor is expected to have. */
function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  const modifier = event.metaKey || event.ctrlKey;

  if (modifier && event.key.toLowerCase() === "s") {
    event.preventDefault();
    void canvas.flushSave();
    return;
  }

  if (typing) return;

  if (modifier && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) canvas.redo();
    else canvas.undo();
    return;
  }

  if (modifier && event.key.toLowerCase() === "y") {
    event.preventDefault();
    canvas.redo();
    return;
  }

  if (modifier && event.key.toLowerCase() === "c") {
    if (canvas.selectedNodeId) {
      event.preventDefault();
      canvas.copyNodes([canvas.selectedNodeId]);
    }
    return;
  }

  if (modifier && event.key.toLowerCase() === "v") {
    event.preventDefault();
    canvas.pasteNodes();
    return;
  }

  if (event.key === "Delete" || event.key === "Backspace") {
    if (canvas.selectedNodeId) {
      event.preventDefault();
      canvas.removeNode(canvas.selectedNodeId);
    }
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
      bootError.value = cause instanceof Error ? cause.message : t("api.requestFailed");
    }
  }
  window.addEventListener("beforeunload", onUnload);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("visibilitychange", onVisibilityChange);
  ready.value = true;
});

onBeforeUnmount(() => {
  window.removeEventListener("beforeunload", onUnload);
  window.removeEventListener("keydown", onKeyDown);
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
