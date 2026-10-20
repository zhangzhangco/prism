<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useCanvasStore } from "@/stores/canvas";
import { useCatalogStore } from "@/stores";
import { describeNode } from "@/graph/convert";
import { useLabel } from "@/composables/useLabel";

const { t } = useI18n();
const { label } = useLabel();
const canvas = useCanvasStore();
const catalog = useCatalogStore();

const node = computed(() => canvas.selectedNode);

/** The display name of a node kind. */
const kindLabel = computed(() => {
  switch (node.value?.type) {
    case "prompt":
      return t("node.prompt");
    case "text":
      return t("node.text");
    case "image":
      return t("node.image");
    case "result":
      return t("node.result");
    case "stage":
      return t("node.stage");
    case "generator":
      return t("node.generator");
    default:
      return node.value?.type ?? "";
  }
});

const plugin = computed(() => {
  if (!node.value || node.value.type !== "generator") return undefined;
  const pluginId = (node.value.data as { pluginId?: string }).pluginId;
  return pluginId ? catalog.pluginById.get(pluginId) : undefined;
});

/** The name shown for the selected node. */
const displayName = computed(() => {
  const current = node.value;
  if (!current) return "";
  if (current.type === "prompt" || current.type === "text") return describeNode(current);
  if (current.type === "generator") {
    return plugin.value ? label(plugin.value.nameKey, plugin.value.name) : kindLabel.value;
  }
  return kindLabel.value;
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
      <h2 class="panel__title">{{ t("topbar.projectActions") }}</h2>

      <p v-if="!node" class="inspector__empty">{{ t("node.selectNode") }}</p>

      <template v-else>
        <div class="inspector__row">
          <span>{{ t("common.type") }}</span>
          <strong>{{ kindLabel }}</strong>
        </div>
        <div class="inspector__row">
          <span>{{ t("common.name") }}</span>
          <strong>{{ displayName }}</strong>
        </div>
        <div class="inspector__row">
          <span>ID</span>
          <code class="inspector__id">{{ node.id }}</code>
        </div>

        <template v-if="plugin">
          <div class="inspector__row">
            <span>{{ t("node.plugin") }}</span>
            <strong>{{ label(plugin.nameKey, plugin.name) }}</strong>
          </div>
          <div class="inspector__row">
            <span>{{ t("common.name") }}</span>
            <span class="inspector__text">{{ label(plugin.summaryKey, plugin.summary) }}</span>
          </div>
        </template>

        <div class="inspector__row">
          <span>{{ t("node.connections") }}</span>
          <div class="kv">
            <span>{{ t("node.in") }}</span><span class="kv__value">{{ incoming.length }}</span>
            <span>{{ t("node.out") }}</span><span class="kv__value">{{ outgoing.length }}</span>
          </div>
        </div>

        <div class="inspector__actions">
          <button type="button" @click="remove">{{ t("node.deleteNode") }}</button>
        </div>
      </template>
    </section>
  </aside>
</template>
