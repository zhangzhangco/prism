#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Exercises the whole product path against a running server: sign up, create
 * a canvas, wire a prompt into a generator, run it, and fetch the produced
 * asset. Run it with `pnpm smoke` while the server is listening.
 */
import { readFileSync } from "node:fs";

const baseUrl = process.env.PRISM_BASE_URL ?? "http://127.0.0.1:4319";
const email = `smoke-${Date.now()}@example.test`;
const password = "smoke-test-password";

let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(path, { method = "GET", token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

console.log(`Smoke test against ${baseUrl}\n`);

console.log("auth");
const registration = await api("/api/auth/register", {
  method: "POST",
  body: { email, password, displayName: "Smoke" },
});
check("register returns 201", registration.status === 201, `got ${registration.status}`);
const token = registration.payload?.token;
check("register returns a token", typeof token === "string");

const duplicate = await api("/api/auth/register", { method: "POST", body: { email, password } });
check("duplicate registration is rejected", duplicate.status === 409, `got ${duplicate.status}`);

const login = await api("/api/auth/login", { method: "POST", body: { email, password } });
check("login returns a token", login.status === 200 && typeof login.payload?.token === "string");

const anonymous = await api("/api/canvases");
check("unauthenticated request is rejected", anonymous.status === 401, `got ${anonymous.status}`);

console.log("\ncatalog");
const plugins = await api("/api/plugins", { token });
check("plugin catalog is not empty", (plugins.payload?.plugins ?? []).length > 0);
const models = await api("/api/models", { token });
check("model catalog is not empty", (models.payload?.models ?? []).length > 0);

console.log("\ncanvas");
const created = await api("/api/canvases", {
  method: "POST",
  token,
  body: { name: "Smoke canvas" },
});
check("canvas is created", created.status === 201, `got ${created.status}`);
const canvasId = created.payload?.canvas?.id;
check("canvas has an id", typeof canvasId === "string");

const document = {
  version: 1,
  nodes: [
    {
      id: "prompt-1",
      kind: "prompt",
      position: { x: 0, y: 0 },
      data: { text: "a quiet harbour at dawn" },
    },
    {
      id: "gen-1",
      kind: "generator",
      position: { x: 320, y: 0 },
      data: { pluginId: "text-to-image", params: { ratio: "1:1" } },
    },
  ],
  edges: [
    {
      id: "edge-1",
      source: "prompt-1",
      sourceHandle: "out",
      target: "gen-1",
      targetHandle: "slot:prompt",
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
};

const saved = await api(`/api/canvases/${canvasId}`, {
  method: "PATCH",
  token,
  body: { document },
});
check("document is saved", saved.status === 200, `got ${saved.status}`);
check("saved document keeps the nodes", (saved.payload?.canvas?.document?.nodes ?? []).length === 2);

console.log("\ngeneration");
const run = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-1", pluginId: "text-to-image", params: { ratio: "1:1" } },
});
check("run is accepted", run.status === 202, `got ${run.status}`);
const runId = run.payload?.run?.id;

let final = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const status = await api(`/api/runs/${runId}`, { token });
  final = status.payload?.run;
  if (final && ["succeeded", "failed", "canceled"].includes(final.status)) break;
}
check("run finishes", final?.status === "succeeded", `status ${final?.status} ${final?.error ?? ""}`);
const asset = final?.tasks?.[0]?.assets?.[0];
check("run produced an asset", Boolean(asset?.url), JSON.stringify(final?.tasks));

if (asset?.url) {
  const download = await fetch(asset.url, { headers: { authorization: `Bearer ${token}` } });
  check("asset downloads", download.ok, `got ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  check("asset is a PNG", bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
  check("asset is not empty", bytes.length > 1000, `${bytes.length} bytes`);
}

console.log("\nvalidation");
const missingPlugin = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-1", pluginId: "does-not-exist" },
});
check("unknown plugin is rejected", missingPlugin.status === 404, `got ${missingPlugin.status}`);

console.log("\ngraph resolution");
// The server reads the stored document to decide what a generator consumed.
// A local plugin returns text, so the produced text must contain the prompt
// that was wired into it — proof that the edge was followed.
const graphCanvas = await api("/api/canvases", {
  method: "POST",
  token,
  body: { name: "Graph canvas" },
});
const graphId = graphCanvas.payload?.canvas?.id;
await api(`/api/canvases/${graphId}`, {
  method: "PATCH",
  token,
  body: {
    document: {
      version: 1,
      nodes: [
        { id: "text-1", kind: "text", position: { x: 0, y: 0 }, data: { text: "a red bicycle" } },
        {
          id: "sculpt-1",
          kind: "generator",
          position: { x: 320, y: 0 },
          data: { pluginId: "prompt-sculptor", params: { tone: "concise" } },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "text-1",
          sourceHandle: "out",
          target: "sculpt-1",
          targetHandle: "slot:text",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
});

const graphRun = await api(`/api/canvases/${graphId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "sculpt-1", pluginId: "prompt-sculptor", params: { tone: "concise" } },
});
let graphFinal = null;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 400));
  const status = await api(`/api/runs/${graphRun.payload?.run?.id}`, { token });
  graphFinal = status.payload?.run;
  if (graphFinal && ["succeeded", "failed", "canceled"].includes(graphFinal.status)) break;
}
check("local plugin run finishes", graphFinal?.status === "succeeded", `status ${graphFinal?.status} ${graphFinal?.error ?? ""}`);
const producedText = graphFinal?.tasks?.[0]?.text ?? "";
check(
  "the wired input reached the plugin",
  producedText.includes("a red bicycle"),
  producedText.slice(0, 120),
);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
