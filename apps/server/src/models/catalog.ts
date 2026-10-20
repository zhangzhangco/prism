import type { DataType, ModelDescriptor, ParamSpec } from "@prism/contracts";

/**
 * The built-in model registry.
 *
 * Entries are static and describe what a provider can do, not what a given
 * deployment has access to. `enabled` reflects local configuration, so a
 * deployment without credentials simply does not advertise that model.
 */

const SIZE_PARAM: ParamSpec = {
  key: "size",
  label: "Size",
  type: "enum",
  default: "1024x1024",
  options: [
    { value: "512x512", label: "512 × 512" },
    { value: "1024x1024", label: "1024 × 1024" },
    { value: "1536x1024", label: "1536 × 1024" },
    { value: "1024x1536", label: "1024 × 1536" },
  ],
};

const QUALITY_PARAM: ParamSpec = {
  key: "quality",
  label: "Quality",
  type: "enum",
  default: "standard",
  options: [
    { value: "standard", label: "Standard" },
    { value: "high", label: "High" },
  ],
};

const COUNT_PARAM: ParamSpec = {
  key: "count",
  label: "Images",
  type: "number",
  default: 1,
  min: 1,
  max: 4,
  step: 1,
};

export interface BuiltinModel extends ModelDescriptor {
  mediaType: DataType;
}

export function builtinModels(options: { hasRemoteProvider: boolean }): BuiltinModel[] {
  return [
    {
      key: "prism-diffusion-v1",
      provider: "mock",
      label: "Prism Diffusion v1 (demo)",
      mediaType: "image",
      params: [SIZE_PARAM, QUALITY_PARAM, COUNT_PARAM],
      enabled: true,
    },
    {
      key: "prism-diffusion-xl",
      provider: "mock",
      label: "Prism Diffusion XL (demo)",
      mediaType: "image",
      params: [SIZE_PARAM, { ...QUALITY_PARAM, default: "high" }, COUNT_PARAM],
      enabled: true,
    },
    {
      key: "openai-image",
      provider: "openai-compatible",
      label: "OpenAI Image",
      mediaType: "image",
      params: [SIZE_PARAM, QUALITY_PARAM, COUNT_PARAM],
      enabled: options.hasRemoteProvider,
    },
  ];
}
