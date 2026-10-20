<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Subject, SubjectKind, SubjectSpec } from "@prism/contracts";
import { useSubjectStore } from "@/stores/subjects";
import { useCanvasStore } from "@/stores/canvas";

const { t } = useI18n();
const library = useSubjectStore();
const canvas = useCanvasStore();

const message = ref<string | null>(null);

const creating = ref(false);
const draft = ref<{
  kind: SubjectKind;
  name: string;
  description: string;
  tags: string;
  color: string;
  height: number;
  size: number;
  shape: "box" | "sphere" | "cylinder" | "cone";
  style: string;
}>({
  kind: "actor",
  name: "",
  description: "",
  tags: "",
  color: "#4c6ef5",
  height: 1.75,
  size: 1,
  shape: "box",
  style: "",
});

const kinds: { kind: SubjectKind; labelKey: string }[] = [
  { kind: "actor", labelKey: "outline.actors" },
  { kind: "scene", labelKey: "outline.scenes" },
  { kind: "prop", labelKey: "outline.props" },
  { kind: "effect", labelKey: "outline.effects" },
];

const visible = computed(() => library.subjects);

function kindLabel(kind: SubjectKind): string {
  const entry = kinds.find((item) => item.kind === kind);
  return entry ? t(entry.labelKey) : kind;
}

function specFor(draftValue: typeof draft.value): SubjectSpec {
  switch (draftValue.kind) {
    case "actor":
      return { height: draftValue.height, color: draftValue.color, build: "regular" };
    case "scene":
      return {
        backdropColor: "#e9ecf0",
        groundColor: "#dfe3e8",
        light: 1,
        description: draftValue.description,
      };
    case "prop":
      return { shape: draftValue.shape, size: draftValue.size, color: draftValue.color };
    case "effect":
    default:
      return { style: draftValue.style, description: draftValue.description };
  }
}

async function submit(): Promise<void> {
  if (!draft.value.name.trim()) return;
  const created = await library.create({
    kind: draft.value.kind,
    name: draft.value.name,
    description: draft.value.description,
    tags: draft.value.tags
      .split(/[,，\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    data: specFor(draft.value),
  });
  if (!created) return;
  creating.value = false;
  draft.value.name = "";
  draft.value.description = "";
  draft.value.tags = "";
  message.value = t("subject.created");
}

/** Put the subject into the 3D stage of this canvas. */
function toStage(subject: Subject): void {
  if (!canvas.stageNode()) {
    message.value = t("subject.noStage");
    return;
  }
  if (subject.kind === "effect") {
    message.value = t("subject.effectNotInStage");
    return;
  }
  const placed = canvas.addSubjectToStage(subject);
  message.value = placed ? t("subject.placedInStage") : t("subject.noStage");
}

/** Attach the subject to the selected generator. */
function toGenerator(subject: Subject): void {
  const selected = canvas.selectedNode;
  if (!selected || selected.type !== "generator") {
    message.value = t("subject.selectGenerator");
    return;
  }
  canvas.attachSubjectToNode(selected.id, subject.id);
  message.value = t("subject.attachedToGenerator");
}

function addToOutline(subject: Subject): void {
  canvas.addToOutline(subject);
  message.value = t("subject.addedToOutline");
}

function remove(subject: Subject): void {
  void library.remove(subject.id);
}
</script>

<template>
  <section class="panel__section">
    <h2 class="panel__title">{{ t("subject.library") }}</h2>

    <input
      class="subjects__search"
      type="search"
      :value="library.search"
      :placeholder="t('subject.search')"
      @input="library.setSearch(($event.target as HTMLInputElement).value)"
      @keyup.enter="library.load()"
      @search="library.load()"
    />

    <div class="library__tabs">
      <button
        class="library__tab"
        :class="{ 'is-active': library.kind === '' }"
        @click="library.setKind('')"
      >
        {{ t("common.all") }}
      </button>
      <button
        v-for="entry in kinds"
        :key="entry.kind"
        class="library__tab"
        :class="{ 'is-active': library.kind === entry.kind }"
        @click="library.setKind(entry.kind)"
      >
        {{ t(entry.labelKey) }}
        <span class="library__count">{{ library.counts[entry.kind] ?? 0 }}</span>
      </button>
    </div>

    <button class="panel__wide" type="button" @click="creating = !creating">
      {{ creating ? t("common.cancel") : t("subject.new") }}
    </button>

    <form v-if="creating" class="subjects__form" @submit.prevent="submit">
      <label class="subjects__field">
        <span>{{ t("common.type") }}</span>
        <select v-model="draft.kind">
          <option v-for="entry in kinds" :key="entry.kind" :value="entry.kind">
            {{ t(entry.labelKey) }}
          </option>
        </select>
      </label>

      <label class="subjects__field">
        <span>{{ t("common.name") }}</span>
        <input v-model="draft.name" type="text" required />
      </label>

      <label class="subjects__field">
        <span>{{ t("subject.description") }}</span>
        <input v-model="draft.description" type="text" />
      </label>

      <label class="subjects__field">
        <span>{{ t("subject.tags") }}</span>
        <input v-model="draft.tags" type="text" :placeholder="t('subject.tagsHint')" />
      </label>

      <label v-if="draft.kind === 'actor'" class="subjects__field">
        <span>{{ t("subject.height") }}</span>
        <input v-model.number="draft.height" type="number" step="0.05" min="0.5" max="2.5" />
      </label>

      <label v-if="draft.kind === 'prop'" class="subjects__field">
        <span>{{ t("subject.shape") }}</span>
        <select v-model="draft.shape">
          <option value="box">{{ t("console.addBox") }}</option>
          <option value="sphere">{{ t("console.addSphere") }}</option>
          <option value="cylinder">{{ t("console.addCylinder") }}</option>
          <option value="cone">{{ t("console.addCone") }}</option>
        </select>
      </label>

      <label v-if="draft.kind === 'actor' || draft.kind === 'prop'" class="subjects__field">
        <span>{{ t("subject.colour") }}</span>
        <input v-model="draft.color" type="color" />
      </label>

      <label v-if="draft.kind === 'effect'" class="subjects__field">
        <span>{{ t("subject.style") }}</span>
        <input v-model="draft.style" type="text" :placeholder="t('subject.styleHint')" />
      </label>

      <button class="primary" type="submit" style="width: 100%">{{ t("common.create") }}</button>
    </form>

    <p v-if="library.loading" class="node__hint">{{ t("common.loading") }}</p>
    <p v-else-if="visible.length === 0" class="node__hint">{{ t("subject.empty") }}</p>

    <ul v-else class="subjects">
      <li v-for="subject in visible" :key="subject.id" class="subjects__item">
        <div class="subjects__head">
          <strong>{{ subject.name }}</strong>
          <span class="subjects__kind">{{ kindLabel(subject.kind) }}</span>
        </div>
        <p v-if="subject.description" class="subjects__description">{{ subject.description }}</p>
        <p v-if="subject.tags.length" class="subjects__tags">
          <span v-for="tag in subject.tags" :key="tag">{{ tag }}</span>
        </p>
        <div class="subjects__actions">
          <button type="button" @click="toStage(subject)">{{ t("subject.toStage") }}</button>
          <button type="button" @click="toGenerator(subject)">{{ t("subject.toGenerator") }}</button>
          <button type="button" @click="addToOutline(subject)">
            {{ canvas.inOutline(subject.id) ? t("subject.inOutline") : t("subject.addToOutline") }}
          </button>
          <button class="ghost" type="button" @click="remove(subject)">{{ t("common.delete") }}</button>
        </div>
      </li>
    </ul>

    <p v-if="message" class="console__message">{{ message }}</p>
  </section>
</template>
