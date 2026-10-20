import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasDocument, PluginManifest } from "@prism/contracts";
import { composePrompt, resolveInputs, slotKeyFromHandle } from "./graph.js";

const plugin: PluginManifest = {
  id: "test",
  name: "Test",
  version: "1.0.0",
  category: "test",
  summary: "",
  icon: "",
  inputs: [
    { key: "prompt", label: "Prompt", dataType: "text", required: false, min: 0, max: 1 },
    { key: "image", label: "Image", dataType: "image", required: true, min: 1, max: 2 },
  ],
  outputs: [{ key: "images", label: "Images", dataType: "image", params: [] }],
  defaults: {},
  runtime: { kind: "provider", modelKey: "test-model" },
  enabled: true,
};

function documentWith(edges: CanvasDocument["edges"]): CanvasDocument {
  return {
    version: 1,
    nodes: [
      { id: "p", kind: "prompt", position: { x: 0, y: 0 }, data: { text: "a red bicycle" } },
      {
        id: "i",
        kind: "image",
        position: { x: 0, y: 0 },
        data: { assets: [{ id: "ast_1", url: "https://example.test/a.png" }] },
      },
      { id: "g", kind: "generator", position: { x: 0, y: 0 }, data: { pluginId: "test", params: {} } },
    ],
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

test("reads the slot key out of a handle", () => {
  assert.equal(slotKeyFromHandle("slot:prompt"), "prompt");
  assert.equal(slotKeyFromHandle("plain"), "plain");
});

test("collects the values on the wires that feed a slot", () => {
  const document = documentWith([
    { id: "e1", source: "p", sourceHandle: "out", target: "g", targetHandle: "slot:prompt" },
    { id: "e2", source: "i", sourceHandle: "out", target: "g", targetHandle: "slot:image" },
  ]);

  const resolved = resolveInputs(document, "g", plugin);
  const prompt = resolved.find((input) => input.slot.key === "prompt");
  const image = resolved.find((input) => input.slot.key === "image");

  assert.equal(prompt?.values.length, 1);
  assert.equal(prompt?.values[0]?.text, "a red bicycle");
  assert.deepEqual(prompt?.sources, ["p"]);

  assert.equal(image?.values.length, 1);
  assert.equal(image?.values[0]?.assetId, "ast_1");
});

test("ignores wires that point at another slot", () => {
  const document = documentWith([
    { id: "e1", source: "p", sourceHandle: "out", target: "g", targetHandle: "slot:image" },
  ]);
  const resolved = resolveInputs(document, "g", plugin);
  const prompt = resolved.find((input) => input.slot.key === "prompt");
  assert.equal(prompt?.values.length, 0);
});

test("composes the prompt from the text inputs", () => {
  const document = documentWith([
    { id: "e1", source: "p", sourceHandle: "out", target: "g", targetHandle: "slot:prompt" },
  ]);
  const resolved = resolveInputs(document, "g", plugin);
  assert.equal(composePrompt(resolved, {}), "a red bicycle");
});

test("an explicit prompt parameter wins over the wired text", () => {
  const document = documentWith([
    { id: "e1", source: "p", sourceHandle: "out", target: "g", targetHandle: "slot:prompt" },
  ]);
  const resolved = resolveInputs(document, "g", plugin);
  assert.equal(composePrompt(resolved, { prompt: "something else" }), "something else");
});
