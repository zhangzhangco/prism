<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useCatalogStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";
import { SOURCE_HANDLE, slotHandle } from "@/graph/types";

const props = defineProps<NodeProps>();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

const data = computed(() => props.data as {
  pluginId: string;
  params: Record<string, unknown>;
  runId?: string;
  status?: string;
  error?: string;
});

const plugin = computed(() => catalog.pluginById.get(data.value.pluginId));

const params = computed(() => {
  const output = plugin.value?.outputs?.[0];
  return output?.params ?? [];
});

const status = computed(() => data.value.status ?? "idle");

function onPluginChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  const next = catalog.pluginById.get(value);
  const defaults = { ...(next?.defaults ?? {}) };
  canvas.updateNodeData(props.id, { pluginId: value, params: defaults, error: undefined });
}

function onParamChange(key: string, event: Event): void {
  const element = event.target as HTMLInputElement | HTMLSelectElement;
  const value =
    element instanceof HTMLSelectElement || element.type === "checkbox"
      ? element.type === "checkbox"
        ? element.checked
        : element.value
      : element.type === "number"
        ? Number(element.value)
        : element.value;
  canvas.setParam(props.id, key, value);
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--generator">G</span>
      {{ plugin?.name ?? "Generator" }}
    </div>
    <div class="node__body">
      <label class="node__field">
        <span>Plugin</span>
        <select :value="data.pluginId" @change="onPluginChange">
          <option v-for="item in catalog.plugins" :key="item.id" :value="item.id">
            {{ item.name }}
          </option>
        </select>
      </label>

      <label v-for="param in params" :key="param.key" class="node__field">
        <span>{{ param.label }}</span>
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
            {{ option.label }}
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
          {{ status === "queued" || status === "running" ? "Running…" : "Run" }}
        </button>
        <span class="node__status" :class="`node__status--${status}`">{{ status }}</span>
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
