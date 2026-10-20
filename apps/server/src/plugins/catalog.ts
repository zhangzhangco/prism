import type { PluginManifest } from "@prism/contracts";

/**
 * The built-in plugin catalog.
 *
 * A plugin is a declarative description of a generator: the input slots it
 * consumes, the output it produces, and which model it runs by default. The
 * runtime behaviour comes from the provider the model is bound to, so adding
 * a new generator means adding a manifest and (optionally) a provider — never
 * touching the canvas.
 *
 * The parameters a user can change come from the model, so a plugin only
 * declares the ones it owns, such as the free-text prompt.
 */

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
          params: [PROMPT_PARAM],
        },
      ],
      defaults: {},
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
          params: [PROMPT_PARAM],
        },
      ],
      defaults: {},
      runtime: { kind: "provider", modelKey: "prism-diffusion-v1" },
      enabled: true,
    },
    {
      id: "upscale",
      name: "Upscale",
      version: "1.0.0",
      category: "edit",
      summary: "Enlarge the resolution of an existing image.",
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
      // Resampling happens in process, so the result is a real enlargement of
      // the source rather than a model approximation. It needs no model.
      runtime: { kind: "local" },
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
          params: [
            {
              key: "tone",
              label: "Tone",
              type: "enum",
              default: "descriptive",
              options: [
                { value: "descriptive", label: "Descriptive" },
                { value: "concise", label: "Concise" },
                { value: "cinematic", label: "Cinematic" },
              ],
            },
            {
              key: "maxWords",
              label: "Max words",
              type: "number",
              default: 120,
              min: 20,
              max: 400,
              step: 10,
            },
          ],
        },
      ],
      defaults: {},
      runtime: { kind: "local" },
      enabled: true,
    },
  ];
}
