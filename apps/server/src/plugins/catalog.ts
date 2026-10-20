import type { PluginManifest } from "@prism/contracts";

/**
 * The built-in plugin catalog.
 *
 * A plugin is a declarative description of a generator: what it consumes, what
 * it produces, and which knobs the user can turn. The runtime behaviour comes
 * from the provider the plugin is bound to, so adding a new generator means
 * adding a manifest and (optionally) a provider — never touching the canvas.
 */

const RATIO_PARAM = {
  key: "ratio",
  label: "Aspect ratio",
  type: "enum" as const,
  default: "1:1",
  options: [
    { value: "1:1", label: "1:1" },
    { value: "4:3", label: "4:3" },
    { value: "3:4", label: "3:4" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
  ],
};

const STRENGTH_PARAM = {
  key: "strength",
  label: "Strength",
  type: "number" as const,
  default: 0.65,
  min: 0.1,
  max: 1,
  step: 0.05,
  help: "How far the result may drift from the reference image.",
};

const PROMPT_PARAM = {
  key: "prompt",
  label: "Prompt",
  type: "string" as const,
  default: "",
  help: "Describes the subject, style and lighting.",
};

export function builtinPlugins(): PluginManifest[] {
  return [
    {
      id: "text-to-image",
      name: "Text to Image",
      version: "1.0.0",
      category: "generation",
      summary: "Generate an image from a written description.",
      icon: "sparkle",
      inputs: [
        {
          key: "prompt",
          label: "Prompt",
          dataType: "text",
          required: false,
          min: 0,
          max: 1,
        },
      ],
      outputs: [
        {
          key: "images",
          label: "Images",
          dataType: "image",
          params: [RATIO_PARAM, PROMPT_PARAM],
        },
      ],
      defaults: { ratio: "1:1", prompt: "" },
      runtime: { kind: "provider", modelKey: "prism-diffusion-v1" },
      enabled: true,
    },
    {
      id: "image-to-image",
      name: "Image to Image",
      version: "1.0.0",
      category: "generation",
      summary: "Redraw an image while keeping its composition.",
      icon: "shuffle",
      inputs: [
        {
          key: "prompt",
          label: "Prompt",
          dataType: "text",
          required: false,
          min: 0,
          max: 1,
        },
        {
          key: "image",
          label: "Reference",
          dataType: "image",
          required: true,
          min: 1,
          max: 4,
        },
      ],
      outputs: [
        {
          key: "images",
          label: "Images",
          dataType: "image",
          params: [RATIO_PARAM, STRENGTH_PARAM, PROMPT_PARAM],
        },
      ],
      defaults: { ratio: "1:1", strength: 0.65, prompt: "" },
      runtime: { kind: "provider", modelKey: "prism-diffusion-v1" },
      enabled: true,
    },
    {
      id: "upscale",
      name: "Upscale",
      version: "1.0.0",
      category: "edit",
      summary: "Increase the resolution of an existing image.",
      icon: "arrows-out",
      inputs: [
        {
          key: "image",
          label: "Source",
          dataType: "image",
          required: true,
          min: 1,
          max: 1,
        },
      ],
      outputs: [
        {
          key: "images",
          label: "Images",
          dataType: "image",
          params: [
            {
              key: "factor",
              label: "Scale",
              type: "enum",
              default: "2x",
              options: [
                { value: "2x", label: "2×" },
                { value: "4x", label: "4×" },
              ],
            },
          ],
        },
      ],
      defaults: { factor: "2x" },
      runtime: { kind: "provider", modelKey: "prism-diffusion-xl" },
      enabled: true,
    },
    {
      id: "prompt-sculptor",
      name: "Prompt Sculptor",
      version: "1.0.0",
      category: "utility",
      summary: "Expand a short prompt into a fuller description.",
      icon: "text",
      inputs: [
        {
          key: "text",
          label: "Text",
          dataType: "text",
          required: true,
          min: 1,
          max: 1,
        },
      ],
      outputs: [
        {
          key: "text",
          label: "Text",
          dataType: "text",
          params: [],
        },
      ],
      defaults: {},
      runtime: { kind: "local" },
      enabled: true,
    },
  ];
}
