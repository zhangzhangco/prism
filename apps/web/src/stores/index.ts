import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { CanvasSummary, ModelDescriptor, PluginManifest, Run, SessionUser } from "@prism/contracts";
import { api, getToken, setToken } from "@/api/client";

const TOKEN_STORAGE_KEY = "prism.token";

export const useSessionStore = defineStore("session", () => {
  const user = ref<SessionUser | null>(null);
  const token = ref<string | null>(getToken());
  const error = ref<string | null>(null);
  const busy = ref(false);

  const isAuthenticated = computed(() => Boolean(token.value && user.value));

  function persist(value: string | null): void {
    token.value = value;
    setToken(value);
    if (value) {
      localStorage.setItem(TOKEN_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }

  async function restore(): Promise<void> {
    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) return;
    setToken(stored);
    token.value = stored;
    try {
      const response = await api.me();
      user.value = response.user;
    } catch {
      persist(null);
      user.value = null;
    }
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      const response = await api.login(email, password);
      persist(response.token);
      user.value = response.user;
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Could not sign in";
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function signUp(email: string, password: string, displayName?: string): Promise<boolean> {
    busy.value = true;
    error.value = null;
    try {
      const response = await api.register(email, password, displayName);
      persist(response.token);
      user.value = response.user;
      return true;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Could not create the account";
      return false;
    } finally {
      busy.value = false;
    }
  }

  function signOut(): void {
    persist(null);
    user.value = null;
  }

  return { user, token, error, busy, isAuthenticated, restore, signIn, signUp, signOut };
});

export interface CatalogState {
  plugins: PluginManifest[];
  models: ModelDescriptor[];
  canvases: CanvasSummary[];
}

export const useCatalogStore = defineStore("catalog", () => {
  const plugins = ref<PluginManifest[]>([]);
  const models = ref<ModelDescriptor[]>([]);
  const canvases = ref<CanvasSummary[]>([]);

  const pluginById = computed(() => {
    const map = new Map<string, PluginManifest>();
    for (const plugin of plugins.value) map.set(plugin.id, plugin);
    return map;
  });

  async function load(): Promise<void> {
    const [pluginResponse, modelResponse, canvasResponse] = await Promise.all([
      api.plugins(),
      api.models(),
      api.listCanvases(),
    ]);
    plugins.value = pluginResponse.plugins;
    models.value = modelResponse.models;
    canvases.value = canvasResponse.canvases;
  }

  async function refreshCanvases(): Promise<void> {
    const response = await api.listCanvases();
    canvases.value = response.canvases;
  }

  return { plugins, models, canvases, pluginById, load, refreshCanvases };
});
