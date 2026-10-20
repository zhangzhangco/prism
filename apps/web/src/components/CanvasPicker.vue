<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";

const { t } = useI18n();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

const search = ref("");
const renamingId = ref<string | null>(null);
const draftName = ref("");

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return catalog.canvases;
  return catalog.canvases.filter((item) => item.name.toLowerCase().includes(needle));
});

async function open(id: string): Promise<void> {
  await canvas.open(id);
  emit("close");
}

function startRename(id: string, name: string): void {
  renamingId.value = id;
  draftName.value = name;
}

function commitRename(): void {
  if (renamingId.value && draftName.value.trim()) {
    canvas.rename(draftName.value);
  }
  renamingId.value = null;
}

async function remove(id: string): Promise<void> {
  await catalog.refreshCanvases();
  if (canvas.currentId === id) {
    const next = catalog.canvases.find((item) => item.id !== id);
    if (next) await canvas.open(next.id);
    else await canvas.create(t("sidebar.newCanvas"));
  }
}

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="modal" @click.self="emit('close')">
    <div class="modal__panel">
      <header class="modal__bar">
        <h2>{{ t("topbar.allCanvases") }}</h2>
        <button class="ghost" @click="emit('close')">{{ t("common.close") }}</button>
      </header>

      <div class="modal__body">
        <input
          v-model="search"
          type="search"
          :placeholder="t('common.search')"
        />

        <p v-if="visible.length === 0" class="node__hint">{{ t("common.none") }}</p>

        <ul class="list">
          <li v-for="item in visible" :key="item.id" class="picker__row">
            <input
              v-if="renamingId === item.id"
              v-model="draftName"
              class="picker__rename"
              autofocus
              @keydown.enter="commitRename"
              @keydown.esc="renamingId = null"
              @blur="commitRename"
            />
            <button
              v-else
              class="list__item"
              :class="{ 'is-active': item.id === canvas.currentId }"
              @click="open(item.id)"
            >
              <span>{{ item.name }}</span>
              <span class="list__meta">{{ t("sidebar.nodeCounts", { count: item.nodeCount }) }}</span>
            </button>
            <button class="ghost" :title="t('common.rename')" @click="startRename(item.id, item.name)">
              ✎
            </button>
            <button class="ghost" :title="t('common.delete')" @click="remove(item.id)">×</button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
