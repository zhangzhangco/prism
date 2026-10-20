import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai-compatible.js";
import type { GenerationProvider } from "./types.js";

export interface ProviderRegistryOptions {
  openAiCompatible?: { baseUrl: string; apiKey: string; model: string } | null;
}

export class ProviderRegistry {
  private readonly providers: GenerationProvider[];

  constructor(options: ProviderRegistryOptions = {}) {
    this.providers = [new MockProvider()];
    if (options.openAiCompatible) {
      this.providers.push(new OpenAiCompatibleProvider(options.openAiCompatible));
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
