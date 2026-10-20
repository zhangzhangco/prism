import type { ModelDescriptor } from "@prism/contracts";
import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";
import type { GenerationProvider } from "./types.js";

export interface ProviderRegistryOptions {
  openAiCompatible?: { baseUrl: string; apiKey: string } | null;
  /** Every known model, so a provider can tell what it serves. */
  models?: ModelDescriptor[];
}

export class ProviderRegistry {
  private readonly providers: GenerationProvider[];

  constructor(options: ProviderRegistryOptions = {}) {
    this.providers = [new MockProvider()];
    if (options.openAiCompatible) {
      const served = (options.models ?? []).filter(
        (model) => model.provider === "openai-compatible" && model.enabled,
      );
      if (served.length > 0) {
        this.providers.push(
          new OpenAiCompatibleProvider({
            baseUrl: options.openAiCompatible.baseUrl,
            apiKey: options.openAiCompatible.apiKey,
            models: served,
          }),
        );
      }
    }
  }

  /** Every provider that can serve the given model, most specific first. */
  resolve(modelKey: string): GenerationProvider[] {
    return this.providers.filter((provider) => provider.supports(modelKey));
  }

  list(): GenerationProvider[] {
    return [...this.providers];
  }
}
