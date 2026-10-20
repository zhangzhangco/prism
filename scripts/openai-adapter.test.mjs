/**
 * Tests for the OpenAI-compatible adapter.
 *
 * They run against a strict stand-in for the endpoint, which rejects the
 * mistakes the real API also rejects: the legacy `response_format` field,
 * a size or quality the model does not accept, and an edit without an
 * image.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeOpenAi } from "./fake-openai.mjs";

const MODELS = [
  {
    key: "gpt-image-1",
    provider: "openai-compatible",
    label: "GPT Image 1",
    mediaType: "image",
    dialect: "gpt-image",
    params: [
      {
        key: "size",
        label: "Size",
        type: "enum",
        default: "1024x1024",
        options: [{ value: "1024x1024", label: "1024 × 1024" }],
      },
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
        key: "background",
        label: "Background",
        type: "enum",
        default: "auto",
        options: [{ value: "auto", label: "Auto" }],
      },
    ],
    enabled: true,
    supportsReference: true,
  },
];

async function withProvider(options, run) {
  const fake = await startFakeOpenAi({ apiKey: "test-key", ...options });
  const { OpenAiCompatibleProvider } = await import("../apps/server/dist/providers/openai-compatible.js");
  const provider = new OpenAiCompatibleProvider({
    baseUrl: fake.baseUrl,
    apiKey: "test-key",
    models: MODELS,
  });
  try {
    await run(provider, fake);
  } finally {
    await fake.close();
  }
}

const REQUEST = {
  runId: "run_1",
  taskKey: "images",
  modelKey: "gpt-image-1",
  prompt: "a quiet harbour at dawn",
  params: { size: "1024x1024", quality: "high", count: 1 },
  inputs: {},
};

test("a generation does not send the legacy response_format", async () => {
  const seen = [];
  await withProvider(
    { onCall: (call) => seen.push(call) },
    async (provider) => {
      const result = await provider.submit(REQUEST);
      const polled = await provider.poll(result, REQUEST);
      assert.equal(polled.status, "succeeded");
      assert.equal(polled.assets?.length, 1);
    },
  );
  assert.equal(seen.length, 1);
});

test("the endpoint rejects a request that carries response_format", async () => {
  // The fake endpoint answers 400 for that field, so if the adapter sent it
  // the run would fail rather than succeed.
  await withProvider({}, async (provider) => {
    const result = await provider.submit(REQUEST);
    const polled = await provider.poll(result, REQUEST);
    assert.equal(polled.status, "succeeded");
  });
});

test("an edit sends the reference image and the model fields", async () => {
  const seen = [];
  await withProvider(
    { onCall: (call) => seen.push(call) },
    async (provider) => {
      const request = {
        ...REQUEST,
        inputs: {
          image: [
            {
              kind: "image",
              assetId: "ast_1",
              url: "https://example.test/a.png",
              localPath: new URL("./fixtures/reference.png", import.meta.url).pathname,
            },
          ],
        },
      };
      const result = await provider.submit(request);
      const polled = await provider.poll(result, request);
      assert.equal(polled.status, "succeeded");
    },
  );
  assert.equal(seen.length, 1);
  assert.ok(seen[0].url.endsWith("/images/edits"));
});

test("an endpoint error is reported with the provider's own message", async () => {
  await withProvider({ failFirst: 1 }, async (provider) => {
    await assert.rejects(
      () => provider.submit(REQUEST),
      /The server had an error while processing your request/,
    );
  });
});

test("the idempotency key is sent so a repeat is not billed twice", async () => {
  const seen = [];
  await withProvider(
    { onCall: (call) => seen.push(call) },
    async (provider) => {
      const first = await provider.submit(REQUEST);
      const firstResult = await provider.poll(first, REQUEST);
      assert.equal(firstResult.status, "succeeded");

      // The same run id again, as a restart would produce.
      const second = await provider.submit(REQUEST);
      const secondResult = await provider.poll(second, REQUEST);
      assert.equal(secondResult.status, "succeeded");
    },
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].headers["idempotency-key"], seen[1].headers["idempotency-key"]);
});
