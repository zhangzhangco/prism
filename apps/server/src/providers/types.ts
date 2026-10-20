/** Contract every generation backend has to satisfy. */

export interface ProviderInputValue {
  kind: "image" | "text";
  /** Set for image inputs. */
  assetId?: string;
  url?: string;
  mime?: string;
  /**
   * Where the bytes live on this machine. Providers that need the original
   * file — an edit endpoint, a local resampler — read it from here instead of
   * fetching it back over the network.
   */
  localPath?: string;
  /** Set for text inputs. */
  text?: string;
}

export interface ProviderRequest {
  runId: string;
  taskKey: string;
  modelKey: string;
  prompt: string;
  params: Record<string, unknown>;
  /** Collected slot values, keyed by slot key. */
  inputs: Record<string, ProviderInputValue[]>;
}

export interface ProviderOutputAsset {
  data: Buffer;
  mime: string;
  filename: string;
  width?: number;
  height?: number;
}

export type ProviderResultStatus = "running" | "succeeded" | "failed";

export interface ProviderResult {
  status: ProviderResultStatus;
  assets?: ProviderOutputAsset[];
  text?: string;
  error?: string;
  /**
   * Set when the backend produced a synthetic image rather than a real
   * generation. The client surfaces this so a demo result is never mistaken
   * for a model output.
   */
  synthetic?: boolean;
}

export interface ProviderTask {
  externalId: string;
}

export interface GenerationProvider {
  readonly id: string;
  /** Whether this provider can serve the given model key. */
  supports(modelKey: string): boolean;
  /** Hand the job to the backend and return a handle to poll. */
  submit(request: ProviderRequest): Promise<ProviderTask>;
  /** Ask the backend for progress. */
  poll(task: ProviderTask, request: ProviderRequest): Promise<ProviderResult>;
}

/** Raised when a provider cannot be reached or returns nonsense. */
export class ProviderError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
