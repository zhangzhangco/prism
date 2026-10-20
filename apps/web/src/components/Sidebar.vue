<script setup lang="ts">
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";

const catalog = useCatalogStore();
const canvas = useCanvasStore();

interface PaletteEntry {
  kind: string;
  label: string;
  hint: string;
}

const palette: PaletteEntry[] = [
  { kind: "prompt", label: "Prompt", hint: "One line of text" },
  { kind: "text", label: "Text", hint: "A block of text" },
  { kind: "image", label: "Image", hint: "Upload an image" },
  { kind: "generator", label: "Generator", hint: "Run a model" },
  { kind: "stage", label: "Stage", hint: "Compose a 3D shot" },
];

async function open(id: string): Promise<void> {
  await canvas.open(id);
}

async function createCanvas(): Promise<void> {
  await canvas.create("Untitled canvas");
  await catalog.refreshCanvases();
}

function add(kind: string): void {
  // Lay new nodes out on a grid. Dropping them all on the same spot would
  // stack them on top of each other and hide their handles.
  const index = canvas.flowNodes.length;
  const column = index % 3;
  const row = Math.floor(index / 3);
  canvas.addNode(kind, { x: 60 + column * 300, y: 60 + row * 240 });
}
</script>

<template>
  <aside class="panel">
    <section class="panel__section">
      <h2 class="panel__title">Canvases</h2>
      <ul class="list">
        <li v-for="item in catalog.canvases" :key="item.id">
          <button
            class="list__item"
            :class="{ 'is-active': item.id === canvas.currentId }"
            @click="open(item.id)"
          >
            <span>{{ item.name }}</span>
            <span class="list__meta">{{ item.nodeCount }} nodes</span>
          </button>
        </li>
      </ul>
      <button style="margin-top: 8px; width: 100%" @click="createCanvas">New canvas</button>
    </section>

    <section class="panel__section">
      <h2 class="panel__title">Add a node</h2>
      <div class="palette">
        <button v-for="entry in palette" :key="entry.kind" @click="add(entry.kind)">
          <strong>{{ entry.label }}</strong>
          <span>{{ entry.hint }}</span>
        </button>
      </div>
    </section>
  </aside>
</template>
