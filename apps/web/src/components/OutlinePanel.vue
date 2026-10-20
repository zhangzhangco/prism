<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { SubjectKind } from "@prism/contracts";
import { useSubjectStore } from "@/stores/subjects";
import { useCanvasStore } from "@/stores/canvas";

const { t } = useI18n();
const library = useSubjectStore();
const canvas = useCanvasStore();

const message = ref<string | null>(null);

const sections: { kind: SubjectKind; key: "actors" | "scenes" | "props" | "effects"; labelKey: string }[] = [
  { kind: "actor", key: "actors", labelKey: "outline.actors" },
  { kind: "scene", key: "scenes", labelKey: "outline.scenes" },
  { kind: "prop", key: "props", labelKey: "outline.props" },
  { kind: "effect", key: "effects", labelKey: "outline.effects" },
];

const counts = computed(() => ({
  actors: canvas.outline.actors.length,
  scenes: canvas.outline.scenes.length,
  props: canvas.outline.props.length,
  effects: canvas.outline.effects.length,
}));

/** The subjects of a section, resolved from the library. */
function inSection(kind: SubjectKind): { id: string; name: string }[] {
  const key =
    kind === "actor"
      ? "actors"
      : kind === "scene"
        ? "scenes"
        : kind === "prop"
          ? "props"
          : "effects";
  return canvas.outline[key]
    .map((id) => library.byId.get(id))
    .filter((subject): subject is NonNullable<typeof subject> => Boolean(subject))
    .map((subject) => ({ id: subject.id, name: subject.name }));
}

/** Subjects of a kind that are not in the outline yet. */
function candidates(kind: SubjectKind) {
  return library.subjects.filter(
    (subject) => subject.kind === kind && !canvas.inOutline(subject.id),
  );
}

function add(kind: SubjectKind, id: string): void {
  const subject = library.byId.get(id);
  if (!subject) return;
  canvas.addToOutline(subject);
  message.value = t("subject.addedToOutline");
}

function remove(kind: SubjectKind, id: string): void {
  canvas.removeFromOutline(id, kind);
  message.value = t("subject.removedFromOutline");
}
</script>

<template>
  <section class="panel__section">
    <h2 class="panel__title">{{ t("outline.title") }}</h2>

    <p v-if="!library.subjects.length" class="node__hint">{{ t("subject.empty") }}</p>

    <div v-for="section in sections" :key="section.kind" class="outline__section">
      <div class="outline__head">
        <span>{{ t(section.labelKey) }}</span>
        <span class="list__meta">{{ counts[section.key] }}</span>
      </div>

      <ul v-if="inSection(section.kind).length" class="outline__list">
        <li v-for="item in inSection(section.kind)" :key="item.id">
          <span>{{ item.name }}</span>
          <button class="outline__remove" :title="t('common.remove')" @click="remove(section.kind, item.id)">
            ×
          </button>
        </li>
      </ul>
      <p v-else class="outline__empty">{{ t("outline.empty") }}</p>

      <select
        v-if="candidates(section.kind).length"
        class="outline__add"
        :value="''"
        @change="
          add(section.kind, ($event.target as HTMLSelectElement).value);
          ($event.target as HTMLSelectElement).value = '';
        "
      >
        <option value="">{{ t("outline.add") }}</option>
        <option v-for="subject in candidates(section.kind)" :key="subject.id" :value="subject.id">
          {{ subject.name }}
        </option>
      </select>
    </div>

    <p v-if="message" class="console__message">{{ message }}</p>
  </section>
</template>
