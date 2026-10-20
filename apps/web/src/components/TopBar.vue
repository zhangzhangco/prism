<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { LOCALES, setLocale, type LocaleCode } from "@/i18n";
import { useCatalogStore } from "@/stores";
import { useSessionStore } from "@/stores";
import { useCanvasStore } from "@/stores/canvas";

const { t, locale } = useI18n();
const session = useSessionStore();
const catalog = useCatalogStore();
const canvas = useCanvasStore();

const languages = LOCALES;
const current = computed(() => locale.value as LocaleCode);

const menuOpen = ref(false);
const menuRoot = ref<HTMLElement | null>(null);
const renaming = ref(false);
const draftName = ref("");

function onDocumentClick(event: MouseEvent): void {
  if (menuRoot.value && !menuRoot.value.contains(event.target as Node)) {
    menuOpen.value = false;
  }
}

onMounted(() => document.addEventListener("click", onDocumentClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocumentClick));

function choose(code: LocaleCode): void {
  setLocale(code);
}
</script>

<template>
  <header class="topbar">
    <div class="topbar__brand">
      <span class="topbar__mark" aria-hidden="true"></span>
      {{ t("app.name") }}
    </div>

    <nav class="topbar__menu">
      <div ref="menuRoot" class="topbar__dropdown">
        <button
          class="topbar__item"
          type="button"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          {{ t("topbar.projectActions") }}
        </button>
        <div v-if="menuOpen" class="topbar__panel">
          <button
            class="topbar__panel-item"
            type="button"
            @click="
              renaming = true;
              draftName = canvas.currentName;
              menuOpen = false;
            "
          >
            {{ t("common.rename") }}
          </button>
          <button
            class="topbar__panel-item"
            type="button"
            @click="
              canvas.tidy();
              menuOpen = false;
            "
          >
            {{ t("topbar.tidyCanvas") }}
          </button>
          <button
            class="topbar__panel-item"
            type="button"
            @click="
              canvas.exportDocument();
              menuOpen = false;
            "
          >
            {{ t("topbar.shareWorkflow") }}
          </button>
          <button
            class="topbar__panel-item"
            type="button"
            @click="
              canvas.snapToGrid = !canvas.snapToGrid;
              menuOpen = false;
            "
          >
            {{ t("topbar.snapToGrid") }}
          </button>
          <button
            class="topbar__panel-item"
            type="button"
            @click="
              canvas.showMinimap = !canvas.showMinimap;
              menuOpen = false;
            "
          >
            {{ t("topbar.minimap") }}
          </button>
        </div>
      </div>

      <button
        class="topbar__item topbar__item--toggle"
        :class="{ 'is-on': canvas.snapToGrid }"
        type="button"
        @click="canvas.setSnapToGrid(!canvas.snapToGrid)"
      >
        {{ t("topbar.snapToGrid") }}
      </button>
      <button
        class="topbar__item topbar__item--toggle"
        :class="{ 'is-on': canvas.showMinimap }"
        type="button"
        @click="canvas.setShowMinimap(!canvas.showMinimap)"
      >
        {{ t("topbar.minimap") }}
      </button>
      <button class="topbar__item" type="button" @click="canvas.tidy()">
        {{ t("topbar.tidyCanvas") }}
      </button>
      <button class="topbar__item" type="button" @click="canvas.exportDocument()">
        {{ t("topbar.shareWorkflow") }}
      </button>
      <button class="topbar__item" type="button" @click="canvas.pickerOpen = true">
        {{ t("topbar.allCanvases") }}
      </button>
    </nav>

    <div class="topbar__spacer"></div>

    <div class="topbar__title" :title="canvas.currentName">
      <input
        v-if="renaming"
        v-model="draftName"
        class="topbar__rename"
        autofocus
        @keydown.enter="canvas.rename(draftName); renaming = false"
        @keydown.esc="renaming = false"
        @blur="canvas.rename(draftName); renaming = false"
      />
      <span v-else @dblclick="renaming = true; draftName = canvas.currentName">{{ canvas.currentName }}</span>
    </div>

    <span class="topbar__status">
      <template v-if="canvas.saving">{{ t("common.saving") }}</template>
      <template v-else-if="canvas.dirty">{{ t("common.unsaved") }}</template>
      <template v-else>{{ t("common.saved") }}</template>
    </span>

    <label class="topbar__language">
      <select
        :value="current"
        @change="choose(($event.target as HTMLSelectElement).value as LocaleCode)"
      >
        <option v-for="item in languages" :key="item.code" :value="item.code">
          {{ item.label }}
        </option>
      </select>
    </label>

    <button class="ghost" type="button" @click="session.signOut()">
      {{ t("topbar.signOut") }}
    </button>
  </header>
</template>
