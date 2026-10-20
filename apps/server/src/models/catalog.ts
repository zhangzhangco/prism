import type { DataType, ModelDescriptor, ModelDialect, ParamSpec } from "@prism/contracts";

/**
 * The built-in model registry.
 *
 * A model owns its own parameters: the values it accepts differ between
 * model families, and the client renders exactly what the chosen model
 * allows. Entries are static and describe what a provider can do; `enabled`
 * reflects local configuration, so a deployment without credentials simply
 * does not advertise that model.
 */

/* ---------- the built-in backend ---------- */

const MOCK_SIZE: ParamSpec = {
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

const MOCK_QUALITY: ParamSpec = {
  key: "quality",
  label: "Quality",
  type: "enum",
  default: "standard",
  options: [
    { value: "standard", label: "Standard" },
    { value: "high", label: "High" },
  ],
};

const COUNT: ParamSpec = {
  key: "count",
  label: "Images",
  type: "number",
  default: 1,
  min: 1,
  max: 4,
  step: 1,
};

/* ---------- the GPT Image family ---------- */

const GPT_IMAGE_SIZE: ParamSpec = {
  key: "size",
  label: "Size",
  type: "enum",
  default: "1024x1024",
  options: [
    { value: "1024x1024", label: "1024 × 1024" },
    { value: "1536x1024", label: "1536 × 1024" },
    { value: "1024x1536", label: "1024 × 1536" },
  ],
};

const GPT_IMAGE_QUALITY: ParamSpec = {
  key: "quality",
  label: "Quality",
  type: "enum",
  default: "high",
  options: [
    { value: "auto", label: "Auto" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
};

const GPT_IMAGE_BACKGROUND: ParamSpec = {
  key: "background",
  label: "Background",
  type: "enum",
  default: "auto",
  options: [
    { value: "auto", label: "Auto" },
    { value: "opaque", label: "Opaque" },
    { value: "transparent", label: "Transparent" },
  ],
};

const GPT_IMAGE_OUTPUT_FORMAT: ParamSpec = {
  key: "output_format",
  label: "File format",
  type: "enum",
  default: "png",
  options: [
    { value: "png", label: "PNG" },
    { value: "jpeg", label: "JPEG" },
    { value: "webp", label: "WebP" },
  ],
};

/* ---------- the DALL·E family ---------- */

const DALL_E_SIZE: ParamSpec = {
  key: "size",
  label: "Size",
  type: "enum",
  default: "1024x1024",
  options: [
    { value: "1024x1024", label: "1024 × 1024" },
    { value: "1792x1024", label: "1792 × 1024" },
    { value: "1024x1792", label: "1024 × 1792" },
  ],
};

const DALL_E_QUALITY: ParamSpec = {
  key: "quality",
  label: "Quality",
  type: "enum",
  default: "standard",
  options: [
    { value: "standard", label: "Standard" },
    { value: "hd", label: "HD" },
  ],
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
      dialect: "mock",
      params: [MOCK_SIZE, MOCK_QUALITY, COUNT],
      enabled: true,
      supportsReference: true,
    },
    {
      key: "prism-diffusion-xl",
      provider: "mock",
      label: "Prism Diffusion XL (demo)",
      mediaType: "image",
      dialect: "mock",
      params: [MOCK_SIZE, { ...MOCK_QUALITY, default: "high" }, COUNT],
      enabled: true,
      supportsReference: true,
    },
    {
      key: "gpt-image-1",
      provider: "openai-compatible",
      label: "GPT Image 1",
      mediaType: "image",
      dialect: "gpt-image",
      params: [
        GPT_IMAGE_SIZE,
        GPT_IMAGE_QUALITY,
        GPT_IMAGE_BACKGROUND,
        GPT_IMAGE_OUTPUT_FORMAT,
        { ...COUNT, default: 1, max: 4 },
      ],
      enabled: options.hasRemoteProvider,
      supportsReference: true,
    },
    {
      key: "dall-e-3",
      provider: "openai-compatible",
      label: "DALL·E 3",
      mediaType: "image",
      dialect: "dall-e",
      params: [DALL_E_SIZE, DALL_E_QUALITY, { ...COUNT, default: 1, max: 1 }],
      enabled: options.hasRemoteProvider,
      supportsReference: false,
    },
  ];
}

/** The dialect of a model, defaulting to the conservative one. */
export function dialectOf(model: ModelDescriptor): ModelDialect {
  return model.dialect ?? "generic";
}
