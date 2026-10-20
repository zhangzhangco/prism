import type {
  AssetRef,
  CanvasDocument,
  CanvasSummary,
  LoginResponse,
  ModelDescriptor,
  PluginManifest,
  Run,
  SessionUser,
} from "@prism/contracts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let token: string | null = null;

export function setToken(value: string | null): void {
  token = value;
}

export function getToken(): string | null {
  return token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(
      response.status,
      error?.code ?? "request_failed",
      error?.message ?? `Request to ${path} failed with ${response.status}`,
    );
  }

  return payload as T;
}

export const api = {
  register: (email: string, password: string, displayName?: string) =>
    request<LoginResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: SessionUser }>("/api/auth/me"),

  listCanvases: () => request<{ canvases: CanvasSummary[] }>("/api/canvases"),

  createCanvas: (name: string) =>
    request<{ canvas: { id: string } }>("/api/canvases", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  getCanvas: (id: string) =>
    request<{ canvas: { id: string; name: string; document: CanvasDocument } }>(`/api/canvases/${id}`),

  saveCanvas: (id: string, document: CanvasDocument, name?: string) =>
    request<{ canvas: { id: string } }>(`/api/canvases/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ document, name }),
    }),

  deleteCanvas: (id: string) =>
    request<void>(`/api/canvases/${id}`, { method: "DELETE" }),

  plugins: () => request<{ plugins: PluginManifest[] }>("/api/plugins"),

  models: () => request<{ models: ModelDescriptor[] }>("/api/models"),

  startRun: (
    canvasId: string,
    body: {
      nodeId: string;
      pluginId: string;
      params?: Record<string, unknown>;
      documentFingerprint?: string;
    },
  ) =>
    request<{ run: Run }>(`/api/canvases/${canvasId}/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  getRun: (runId: string) => request<{ run: Run }>(`/api/runs/${runId}`),

  listRuns: (canvasId: string) => request<{ runs: Run[] }>(`/api/canvases/${canvasId}/runs`),

  listAssets: () => request<{ assets: AssetRef[] }>("/api/assets"),

  uploadAsset: async (canvasId: string, file: File): Promise<AssetRef> => {
    const form = new FormData();
    form.append("file", file);
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`/api/canvases/${canvasId}/assets`, {
      method: "POST",
      headers,
      body: form,
    });
    const payload = (await response.json()) as { asset?: AssetRef; error?: { message?: string } };
    if (!response.ok || !payload.asset) {
      throw new ApiError(
        response.status,
        "upload_failed",
        payload.error?.message ?? "The upload failed",
      );
    }
    return payload.asset;
  },

  /**
   * Write a canvas without waiting for it.
   *
   * Used when the tab is closing: a `keepalive` request survives the
   * navigation, and it carries the bearer token like every other call.
   */
  saveCanvasKeepalive: (canvasId: string, document: CanvasDocument, name?: string): boolean => {
    if (!token) return false;
    try {
      void fetch(`/api/canvases/${canvasId}`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ document, name }),
      }).catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  },
};
