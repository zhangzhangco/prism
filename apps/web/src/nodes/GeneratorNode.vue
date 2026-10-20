<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { effectiveParams } from "@prism/contracts";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";
import { SOURCE_HANDLE, slotHandle, type GeneratorNodeData } from "@/graph/types";
import { useLabel } from "@/composables/useLabel";

const props = defineProps<NodeProps>();
const { t } = useI18n();
const { label } = useLabel();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

const data = computed(() => props.data as unknown as GeneratorNodeData);

const plugin = computed(() => catalog.pluginById.get(data.value.pluginId));

/**
 * The models that can serve this plugin.
 *
 * A plugin that runs a model offers the models of the same kind; a plugin
 * with a local runtime has no model to choose.
 */
const models = computed(() => {
  const wanted = plugin.value?.outputs[0]?.dataType ?? "image";
  return catalog.models.filter((model) => model.enabled && model.mediaType === wanted);
});

const selectedModel = computed(
  () =>
    catalog.models.find((model) => model.key === data.value.modelKey) ?? models.value[0],
);

const params = computed(() => effectiveParams(plugin.value!, selectedModel.value));

const status = computed(() => data.value.status ?? "idle");

const statusText = computed(() => {
  switch (status.value) {
    case "queued":
      return t("node.queued");
    case "running":
      return t("node.running");
    case "succeeded":
      return t("node.succeeded");
    case "failed":
      return t("node.failed");
    case "canceled":
      return t("node.canceled");
    default:
      return "";
  }
});

function onPluginChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const next = catalog.pluginById.get(value);
  const modelKey = next?.runtime.kind === "provider" ? next.runtime.modelKey : undefined;
  canvas.updateNodeData(props.id, {
    pluginId: value,
    modelKey,
    params: { ...(next?.defaults ?? {}) },
    error: undefined,
  });
}

function onModelChange(event: Event): void {
  canvas.setModel(props.id, (event.target as HTMLSelectElement).value);
}

function onParamChange(key: string, event: Event): void {
  const element = event.target as HTMLInputElement | HTMLSelectElement;
  let value: unknown = element.value;
  if (element instanceof HTMLInputElement && element.type === "number") {
    value = Number(element.value);
  }
  canvas.setParam(props.id, key, value);
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--generator">G</span>
      {{ plugin ? label(plugin.nameKey, plugin.name) : t("node.generator") }}
    </div>
    <div class="node__body">
      <label class="node__field">
        <span>{{ t("node.plugin") }}</span>
        <select :value="data.pluginId" @change="onPluginChange">
          <option v-for="item in catalog.plugins" :key="item.id" :value="item.id">
            {{ label(item.nameKey, item.name) }}
          </option>
        </select>
      </label>

      <label v-if="models.length" class="node__field">
        <span>{{ t("node.model") }}</span>
        <select :value="selectedModel?.key" @change="onModelChange">
          <option v-for="model in models" :key="model.key" :value="model.key">
            {{ label(model.labelKey, model.label) }}
          </option>
        </select>
      </label>

      <label v-for="param in params" :key="param.key" class="node__field">
        <span>{{ label(param.labelKey, param.label) }}</span>
        <select
          v-if="param.type === 'enum'"
          :value="String(data.params?.[param.key] ?? param.default ?? '')"
          @change="onParamChange(param.key, $event)"
        >
          <option
            v-for="option in param.options ?? []"
            :key="option.value"
            :value="option.value"
          >
            {{ label(option.labelKey, option.label) }}
          </option>
        </select>
        <input
          v-else-if="param.type === 'number'"
          type="number"
          :min="param.min"
          :max="param.max"
          :step="param.step"
          :value="Number(data.params?.[param.key] ?? param.default ?? 0)"
          @input="onParamChange(param.key, $event)"
        />
        <input
          v-else
          type="text"
          :value="String(data.params?.[param.key] ?? param.default ?? '')"
          @input="onParamChange(param.key, $event)"
        />
      </label>

      <div class="node__actions">
        <button
          class="primary"
          :disabled="status === 'queued' || status === 'running'"
          @click="canvas.run(props.id)"
        >
          {{ status === "queued" || status === "running" ? t("node.running") : t("node.run") }}
        </button>
        <span v-if="statusText" class="node__status" :class="`node__status--${status}`">
          {{ statusText }}
        </span>
      </div>

      <p v-if="data.error" class="node__error">{{ data.error }}</p>

      <Handle
        v-for="slot in plugin?.inputs ?? []"
        :key="slot.key"
        type="target"
        :id="slotHandle(slot.key)"
        :position="Position.Left"
      />
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
