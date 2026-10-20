<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";
import LibraryPanel from "@/components/LibraryPanel.vue";

const { t } = useI18n();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

interface PaletteEntry {
  kind: string;
  labelKey: string;
  hintKey: string;
}

interface PaletteCategory {
  id: string;
  labelKey: string;
  entries: PaletteEntry[];
}

/** The palette is grouped the way a production tool groups it: by what the
 *  node is for, not by its implementation. */
const categories: PaletteCategory[] = [
  {
    id: "assets",
    labelKey: "palette.assets",
    entries: [
      { kind: "prompt", labelKey: "node.prompt", hintKey: "palette.promptHint" },
      { kind: "text", labelKey: "node.text", hintKey: "palette.textHint" },
      { kind: "image", labelKey: "node.image", hintKey: "palette.imageHint" },
    ],
  },
  {
    id: "generation",
    labelKey: "palette.generation",
    entries: [
      { kind: "generator", labelKey: "node.generator", hintKey: "palette.generatorHint" },
    ],
  },
  {
    id: "three",
    labelKey: "palette.three",
    entries: [
      { kind: "stage", labelKey: "node.stage", hintKey: "palette.stageHint" },
    ],
  },
];

const active = ref(categories[0]!.id);
const current = computed(() => categories.find((category) => category.id === active.value)!);

function add(kind: string): void {
  // New nodes land in a column beside what is already there, so they do not
  // cover the node they were dropped next to.
  const index = canvas.flowNodes.length;
  const column = index % 4;
  const row = Math.floor(index / 4);
  canvas.addNode(kind, { x: 80 + column * 320, y: 80 + row * 250 });
}
</script>

<template>
  <aside class="panel">
    <section class="panel__section">
      <h2 class="panel__title">{{ t("sidebar.canvases") }}</h2>
      <ul class="list">
        <li v-for="item in catalog.canvases" :key="item.id">
          <button
            class="list__item"
            :class="{ 'is-active': item.id === canvas.currentId }"
            @click="canvas.open(item.id)"
          >
            <span>{{ item.name }}</span>
            <span class="list__meta">{{ t("sidebar.nodeCounts", { count: item.nodeCount }) }}</span>
          </button>
        </li>
      </ul>
      <button class="panel__wide" type="button" @click="canvas.create($t('sidebar.newCanvas'))">
        {{ t("sidebar.newCanvas") }}
      </button>
    </section>

    <section class="panel__section">
      <h2 class="panel__title">{{ t("sidebar.nodes") }}</h2>
      <div class="palette__tabs">
        <button
          v-for="category in categories"
          :key="category.id"
          class="palette__tab"
          :class="{ 'is-active': category.id === active }"
          type="button"
          @click="active = category.id"
        >
          {{ t(category.labelKey) }}
        </button>
      </div>
      <div class="palette">
        <button v-for="entry in current.entries" :key="entry.kind" @click="add(entry.kind)">
          <strong>{{ t(entry.labelKey) }}</strong>
          <span>{{ t(entry.hintKey) }}</span>
        </button>
      </div>
    </section>

    <LibraryPanel />
  </aside>
</template>
