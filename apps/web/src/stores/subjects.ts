import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { AssetRef, Subject, SubjectKind, SubjectSpec } from "@prism/contracts";
import { api } from "@/api/client";

/**
 * The subject library.
 *
 * Subjects belong to the account rather than to one canvas, so the same actor
 * or prop can be used in as many productions as the account wants. What a
 * production uses is recorded in its outline.
 */
export const useSubjectStore = defineStore("subjects", () => {
  const subjects = ref<Subject[]>([]);
  const search = ref("");
  const kind = ref<SubjectKind | "">("");
  const loading = ref(false);
  const error = ref<string | null>(null);

  const byId = computed(() => {
    const map = new Map<string, Subject>();
    for (const subject of subjects.value) map.set(subject.id, subject);
    return map;
  });

  const counts = computed(() => {
    const result: Record<string, number> = { actor: 0, scene: 0, prop: 0, effect: 0 };
    for (const subject of subjects.value) {
      result[subject.kind] = (result[subject.kind] ?? 0) + 1;
    }
    return result;
  });

  /**
   * The image that stands for a subject.
   *
   * The bytes live behind the API's token, so the image is fetched with the
   * token rather than linked directly.
   */
  function thumbnailOf(subject: Subject): AssetRef | null {
    if (!subject.thumbnailAssetId) return null;
    return {
      id: subject.thumbnailAssetId,
      url: `/api/assets/${subject.thumbnailAssetId}`,
      mime: "image/*",
      filename: subject.name,
      bytes: 0,
      createdAt: subject.updatedAt,
    };
  }

  async function load(): Promise<void> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.listSubjects({
        ...(kind.value ? { kind: kind.value } : {}),
        ...(search.value ? { q: search.value } : {}),
      });
      subjects.value = response.subjects;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The library could not be loaded";
    } finally {
      loading.value = false;
    }
  }

  async function create(input: {
    kind: SubjectKind;
    name: string;
    description?: string;
    tags?: string[];
    data: SubjectSpec;
    thumbnailAssetId?: string | null;
  }): Promise<Subject | null> {
    try {
      await api.createSubject(input);
      // The list is read back from the server rather than patched locally: a
      // load that was already in flight would otherwise overwrite the new
      // entry with a list that predates it.
      await load();
      return subjects.value.find((subject) => subject.name === input.name) ?? null;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The subject could not be created";
      return null;
    }
  }

  async function update(
    id: string,
    patch: Partial<Pick<Subject, "name" | "description" | "tags" | "data" | "kind" | "thumbnailAssetId">>,
  ): Promise<void> {
    try {
      await api.updateSubject(id, patch);
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The subject could not be saved";
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await api.deleteSubject(id);
      await load();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "The subject could not be removed";
    }
  }

  function setKind(next: SubjectKind | ""): void {
    kind.value = next;
    void load();
  }

  function setSearch(next: string): void {
    search.value = next;
  }

  return {
    subjects,
    search,
    kind,
    loading,
    error,
    byId,
    counts,
    thumbnailOf,
    load,
    create,
    update,
    remove,
    setKind,
    setSearch,
  };
});
