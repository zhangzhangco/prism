import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelDescriptor, PluginManifest } from "@prism/contracts";
import { effectiveParams, validateParams } from "./params.js";

const plugin: PluginManifest = {
  id: "text-to-image",
  name: "Text to Image",
  version: "1.0.0",
  category: "generation",
  summary: "",
  icon: "",
  inputs: [],
  outputs: [
    {
      key: "images",
      label: "Images",
      dataType: "image",
      params: [{ key: "prompt", label: "Prompt", type: "string", default: "" }],
    },
  ],
  defaults: {},
  runtime: { kind: "provider", modelKey: "gpt-image-1" },
  enabled: true,
};

const gptImage: ModelDescriptor = {
  key: "gpt-image-1",
  provider: "openai-compatible",
  label: "GPT Image 1",
  mediaType: "image",
  dialect: "gpt-image",
  params: [
    {
      key: "quality",
      label: "Quality",
      type: "enum",
      default: "high",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" },
      ],
    },
    {
      key: "size",
      label: "Size",
      type: "enum",
      default: "1024x1024",
      options: [{ value: "1024x1024", label: "1024 × 1024" }],
    },
  ],
  enabled: true,
  supportsReference: true,
};

const demoModel: ModelDescriptor = {
  ...gptImage,
  key: "prism-diffusion-v1",
  provider: "mock",
  dialect: "mock",
  params: [
    {
      key: "quality",
      label: "Quality",
      type: "enum",
      default: "standard",
      options: [
        { value: "standard", label: "Standard" },
        { value: "high", label: "High" },
      ],
    },
  ],
};

test("the model's parameters come first, the plugin's after", () => {
  const specs = effectiveParams(plugin, gptImage);
  assert.deepEqual(
    specs.map((spec) => spec.key),
    ["quality", "size", "prompt"],
  );
});

test("a value the model accepts is kept", () => {
  const result = validateParams(plugin, gptImage, { quality: "low", size: "1024x1024" });
  assert.deepEqual(result.rejected, []);
  assert.equal(result.values.quality, "low");
});

test("a quality the model does not accept is reported, not changed", () => {
  const result = validateParams(plugin, gptImage, { quality: "standard" });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0]!, /quality/);
  assert.match(result.rejected[0]!, /low, medium, high/);
  assert.equal(result.values.quality, undefined);
});

test("the same value is fine for a model that accepts it", () => {
  const result = validateParams(plugin, demoModel, { quality: "standard" });
  assert.deepEqual(result.rejected, []);
  assert.equal(result.values.quality, "standard");
});

test("a parameter nothing declares is dropped", () => {
  const result = validateParams(plugin, gptImage, { ratio: "16:9" });
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0]!, /ratio/);
});

test("missing parameters fall back to the model's default", () => {
  const result = validateParams(plugin, gptImage, {});
  assert.equal(result.values.quality, "high");
  assert.equal(result.values.size, "1024x1024");
});
