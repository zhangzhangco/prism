<script setup lang="ts">
import { computed } from "vue";
import { useCanvasStore } from "@/stores/canvas";
import { useCatalogStore } from "@/stores";
import { describeNode } from "@/graph/convert";

const canvas = useCanvasStore();
const catalog = useCatalogStore();

const node = computed(() => canvas.selectedNode);
const plugin = computed(() => {
  if (!node.value || node.value.type !== "generator") return undefined;
  const pluginId = (node.value.data as { pluginId?: string }).pluginId;
  return pluginId ? catalog.pluginById.get(pluginId) : undefined;
});

const incoming = computed(() =>
  canvas.flowEdges.filter((edge) => edge.target === node.value?.id),
);
const outgoing = computed(() =>
  canvas.flowEdges.filter((edge) => edge.source === node.value?.id),
);

function remove(): void {
  if (node.value) canvas.removeNode(node.value.id);
}
</script>

<template>
  <aside class="panel panel--right">
    <section class="panel__section">
      <h2 class="panel__title">Inspector</h2>

      <p v-if="!node" class="inspector__empty">Select a node to inspect it.</p>

      <template v-else>
        <div class="inspector__row">
          <span>Type</span>
          <strong>{{ node.type }}</strong>
        </div>
        <div class="inspector__row">
          <span>Label</span>
          <strong>{{ describeNode(node) }}</strong>
        </div>
        <div class="inspector__row">
          <span>Id</span>
          <code style="font-family: var(--mono); font-size: 11px">{{ node.id }}</code>
        </div>

        <template v-if="plugin">
          <div class="inspector__row">
            <span>Plugin</span>
            <strong>{{ plugin.name }}</strong>
          </div>
          <div class="inspector__row">
            <span>Summary</span>
            <span style="color: var(--text)">{{ plugin.summary }}</span>
          </div>
        </template>

        <div class="inspector__row">
          <span>Connections</span>
          <div class="kv">
            <span>in</span><span class="kv__value">{{ incoming.length }}</span>
            <span>out</span><span class="kv__value">{{ outgoing.length }}</span>
          </div>
        </div>

        <div class="inspector__actions">
          <button @click="remove">Delete node</button>
        </div>
      </template>
    </section>
  </aside>
</template>
