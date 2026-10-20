<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useCanvasStore } from "@/stores/canvas";
import { SOURCE_HANDLE } from "@/graph/types";

const props = defineProps<NodeProps>();
const canvas = useCanvasStore();

const text = computed(() => String((props.data as { text?: string })?.text ?? ""));

function onInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value;
  canvas.updateNodeData(props.id, { text: value });
}
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--prompt">P</span>
      Prompt
    </div>
    <div class="node__body">
      <textarea
        :value="text"
        rows="2"
        placeholder="Describe the subject…"
        @input="onInput"
      ></textarea>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
