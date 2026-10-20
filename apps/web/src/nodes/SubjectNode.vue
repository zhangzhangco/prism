<script setup lang="ts">
import { Handle, Position, type NodeProps } from "@vue-flow/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSubjectStore } from "@/stores/subjects";
import { SOURCE_HANDLE } from "@/graph/types";
import AssetImage from "@/components/AssetImage.vue";

const props = defineProps<NodeProps>();
const { t } = useI18n();
const library = useSubjectStore();

const subject = computed(() => {
  const subjectId = (props.data as { subjectId?: string })?.subjectId;
  return subjectId ? library.byId.get(subjectId) : undefined;
});

const thumbnail = computed(() => (subject.value ? library.thumbnailOf(subject.value) : null));
</script>

<template>
  <div class="node" :class="{ 'is-selected': props.selected }">
    <div class="node__header">
      <span class="node__kind node__kind--subject">S</span>
      {{ subject?.name ?? t("subject.unknown") }}
    </div>
    <div class="node__body">
      <AssetImage v-if="thumbnail" :asset="thumbnail" />
      <p v-if="subject?.description" class="node__hint">
        {{ subject.description }}
      </p>
      <p v-else class="node__hint">{{ t("subject.missing") }}</p>
      <Handle type="source" :id="SOURCE_HANDLE" :position="Position.Right" />
    </div>
  </div>
</template>
