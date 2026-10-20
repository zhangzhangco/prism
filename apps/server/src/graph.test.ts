import assert from "node:assert/strict";
import { test } from "node:test";
import type { CanvasDocument } from "@prism/contracts";
import { documentFingerprint } from "@prism/contracts";
import { resolveInputs, slotKeyFromHandle } from "./graph.js";

const document: CanvasDocument = {
  version: 1,
  nodes: [
    { id: "p", kind: "prompt", position: { x: 0, y: 0 }, data: { text: "a red bicycle" } },
    {
      id: "r",
      kind: "result",
      position: { x: 0, y: 0 },
      data: {
        assets: [
          { id: "ast_1", url: "https://example.test/1.png" },
          { id: "ast_2", url: "https://example.test/2.png" },
        ],
      },
    },
    {
      id: "s",
      kind: "stage",
      position: { x: 0, y: 0 },
      data: { frame: { id: "ast_9", url: "https://example.test/frame.png" } },
    },
    { id: "g", kind: "generator", position: { x: 0, y: 0 }, data: {} },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

test("the fingerprint does not depend on key order", () => {
  const a: CanvasDocument = {
    version: 1,
    nodes: [{ id: "n", kind: "prompt", position: { x: 1, y: 2 }, data: { text: "hi" } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  const b: CanvasDocument = {
    viewport: { zoom: 1, y: 0, x: 0 },
    edges: [],
    nodes: [{ data: { text: "hi" }, position: { y: 2, x: 1 }, kind: "prompt", id: "n" }],
    version: 1,
  };
  assert.equal(documentFingerprint(a), documentFingerprint(b));
});

test("the fingerprint changes when the graph changes", () => {
  const changed: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === "p" ? { ...node, data: { text: "a blue bicycle" } } : node,
    ),
  };
  assert.notEqual(documentFingerprint(document), documentFingerprint(changed));
});

test("a result node hands on its selected asset", () => {
  const withEdges: CanvasDocument = {
    ...document,
    nodes: document.nodes.map((node) =>
      node.id === "r" ? { ...node, data: { ...node.data, selectedAssetId: "ast_2" } } : node,
    ),
    edges: [
      { id: "e1", source: "r", sourceHandle: "out", target: "g", targetHandle: "slot:image" },
    ],
  };

  const resolved = resolveInputs(
    withEdges,
    "g",
    {
      id: "p",
      name: "P",
      version: "1",
      category: "c",
      summary: "",
      icon: "",
      inputs: [{ key: "image", label: "Image", dataType: "image", required: true, min: 1, max: 4 }],
      outputs: [{ key: "images", label: "Images", dataType: "image", params: [] }],
      defaults: {},
      runtime: { kind: "provider", modelKey: "m" },
      enabled: true,
    },
  );

  const image = resolved.find((input) => input.slot.key === "image");
  assert.equal(image?.values.length, 1);
  assert.equal(image?.values[0]?.assetId, "ast_2");
});

test("a stage node hands on the frame it exported", () => {
  const withEdges: CanvasDocument = {
    ...document,
    edges: [{ id: "e1", source: "s", sourceHandle: "out", target: "g", targetHandle: "slot:image" }],
  };

  const resolved = resolveInputs(
    withEdges,
    "g",
    {
      id: "p",
      name: "P",
      version: "1",
      category: "c",
      summary: "",
      icon: "",
      inputs: [{ key: "image", label: "Image", dataType: "image", required: true, min: 1, max: 4 }],
      outputs: [{ key: "images", label: "Images", dataType: "image", params: [] }],
      defaults: {},
      runtime: { kind: "provider", modelKey: "m" },
      enabled: true,
    },
  );

  const image = resolved.find((input) => input.slot.key === "image");
  assert.equal(image?.values[0]?.assetId, "ast_9");
});

test("slot keys are read from the handle", () => {
  assert.equal(slotKeyFromHandle("slot:image"), "image");
});
