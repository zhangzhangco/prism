#!/usr/bin/env node
/**
 * End-to-end smoke test.
 *
 * Exercises the whole product path against a running server: sign up, create
 * a canvas, wire a prompt into a generator, run it, chain the result into
 * another generator, and check the guards that keep a run honest.
 *
 * Run it with `pnpm smoke` while the server is listening.
 */
import { documentFingerprint } from "../packages/contracts/dist/index.js";

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

async function waitForRun(token, runId, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const status = await api(`/api/runs/${runId}`, { token });
    const run = status.payload?.run;
    if (run && ["succeeded", "failed", "canceled"].includes(run.status)) return run;
  }
  return null;
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
const upscale = (plugins.payload?.plugins ?? []).find((plugin) => plugin.id === "upscale");
check("upscale is a local runtime", upscale?.runtime?.kind === "local", JSON.stringify(upscale?.runtime));

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
      data: { pluginId: "text-to-image", params: { size: "1024x1024" } },
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

const viewportSaved = saved.payload?.canvas?.document?.viewport;
check(
  "the viewport is saved with the document",
  viewportSaved && typeof viewportSaved.zoom === "number",
  JSON.stringify(viewportSaved),
);

console.log("\nstale document guard");
const stale = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: {
    nodeId: "gen-1",
    pluginId: "text-to-image",
    params: { size: "1024x1024" },
    documentFingerprint: "not-the-current-fingerprint",
  },
});
check("a run against a changed graph is refused", stale.status === 409, `got ${stale.status}`);
check(
  "the refusal names the reason",
  stale.payload?.error?.code === "stale_document",
  JSON.stringify(stale.payload?.error),
);

const fresh = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: {
    nodeId: "gen-1",
    pluginId: "text-to-image",
    params: { size: "1024x1024" },
    documentFingerprint: documentFingerprint(document),
  },
});
check("a run against the current graph is accepted", fresh.status === 202, `got ${fresh.status}`);

console.log("\ngeneration");
const run = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-1", pluginId: "text-to-image", params: { size: "1024x1024" } },
});
check("run is accepted", run.status === 202, `got ${run.status}`);
const runId = run.payload?.run?.id;

const final = await waitForRun(token, runId);
check("run finishes", final?.status === "succeeded", `status ${final?.status} ${final?.error ?? ""}`);
const asset = final?.tasks?.[0]?.assets?.[0];
check("run produced an asset", Boolean(asset?.url), JSON.stringify(final?.tasks));
check(
  "the result is marked as coming from the demo backend",
  final?.tasks?.[0]?.synthetic === true,
  JSON.stringify(final?.tasks?.[0]),
);

if (asset?.url) {
  const download = await fetch(asset.url, { headers: { authorization: `Bearer ${token}` } });
  check("asset downloads", download.ok, `got ${download.status}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  check("asset is a PNG", bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a");
  check("asset is not empty", bytes.length > 1000, `${bytes.length} bytes`);
}

console.log("\nchaining a result into the next generator");
const chainedCanvas = await api("/api/canvases", {
  method: "POST",
  token,
  body: { name: "Chained canvas" },
});
const chainedId = chainedCanvas.payload?.canvas?.id;

// A result node holding the asset the first run produced, wired into a
// second generator. This is the "generate, then use the result" path.
await api(`/api/canvases/${chainedId}`, {
  method: "PATCH",
  token,
  body: {
    document: {
      version: 1,
      nodes: [
        {
          id: "result-1",
          kind: "result",
          position: { x: 0, y: 0 },
          data: { assets: [asset], selectedAssetId: asset.id },
        },
        {
          id: "gen-2",
          kind: "generator",
          position: { x: 320, y: 0 },
          data: { pluginId: "image-to-image", params: { size: "1024x1024" } },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "result-1",
          sourceHandle: "out",
          target: "gen-2",
          targetHandle: "slot:image",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
});

const chainedRun = await api(`/api/canvases/${chainedId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-2", pluginId: "image-to-image", params: { size: "1024x1024" } },
});
check("the chained run is accepted", chainedRun.status === 202, `got ${chainedRun.status}`);
const chainedFinal = await waitForRun(token, chainedRun.payload?.run?.id);
check(
  "the chained run finishes",
  chainedFinal?.status === "succeeded",
  `status ${chainedFinal?.status} ${chainedFinal?.error ?? ""}`,
);
const chainedAsset = chainedFinal?.tasks?.[0]?.assets?.[0];
check("the chained run produced an asset", Boolean(chainedAsset?.url));

console.log("\nthe reference image changes the output");
if (chainedAsset && asset) {
  const first = await fetch(asset.url, { headers: { authorization: `Bearer ${token}` } });
  const second = await fetch(chainedAsset.url, { headers: { authorization: `Bearer ${token}` } });
  const firstBytes = Buffer.from(await first.arrayBuffer());
  const secondBytes = Buffer.from(await second.arrayBuffer());
  check(
    "a run with a reference differs from one without",
    !firstBytes.equals(secondBytes),
    "the reference image did not reach the backend",
  );
}

console.log("\nupscaling");
const upscaleCanvas = await api("/api/canvases", {
  method: "POST",
  token,
  body: { name: "Upscale canvas" },
});
const upscaleId = upscaleCanvas.payload?.canvas?.id;
await api(`/api/canvases/${upscaleId}`, {
  method: "PATCH",
  token,
  body: {
    document: {
      version: 1,
      nodes: [
        {
          id: "image-1",
          kind: "image",
          position: { x: 0, y: 0 },
          data: { assets: [asset] },
        },
        {
          id: "gen-3",
          kind: "generator",
          position: { x: 320, y: 0 },
          data: { pluginId: "upscale", params: { factor: "2x" } },
        },
      ],
      edges: [
        {
          id: "edge-1",
          source: "image-1",
          sourceHandle: "out",
          target: "gen-3",
          targetHandle: "slot:image",
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
});
const upscaleRun = await api(`/api/canvases/${upscaleId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-3", pluginId: "upscale", params: { factor: "2x" } },
});
const upscaleFinal = await waitForRun(token, upscaleRun.payload?.run?.id);
check(
  "the upscale run finishes",
  upscaleFinal?.status === "succeeded",
  `status ${upscaleFinal?.status} ${upscaleFinal?.error ?? ""}`,
);
const upscaled = upscaleFinal?.tasks?.[0]?.assets?.[0];
check("the upscale produced an asset", Boolean(upscaled?.url));
check(
  "the upscaled image is twice the size",
  upscaled?.width === asset?.width * 2 && upscaled?.height === asset?.height * 2,
  `${upscaled?.width}x${upscaled?.height} from ${asset?.width}x${asset?.height}`,
);
check(
  "an upscale is not a demo result",
  upscaleFinal?.tasks?.[0]?.synthetic !== true,
  JSON.stringify(upscaleFinal?.tasks?.[0]),
);

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
const graphFinal = await waitForRun(token, graphRun.payload?.run?.id);
check("local plugin run finishes", graphFinal?.status === "succeeded", `status ${graphFinal?.status} ${graphFinal?.error ?? ""}`);
const producedText = graphFinal?.tasks?.[0]?.text ?? "";
check(
  "the wired input reached the plugin",
  producedText.includes("a red bicycle"),
  producedText.slice(0, 120),
);

// When a remote endpoint is configured, the same path has to work against a
// real provider, and the result must not be marked as a demo.
if (process.env.PRISM_OPENAI_BASE_URL) {
  console.log("\nremote model");
  const remote = (models.payload?.models ?? []).find(
    (model) => model.provider === "openai-compatible",
  );
  check("a remote model is offered", Boolean(remote), JSON.stringify(remote));

  if (remote) {
    const remoteCanvas = await api("/api/canvases", {
      method: "POST",
      token,
      body: { name: "Remote canvas" },
    });
    const remoteId = remoteCanvas.payload?.canvas?.id;

    await api(`/api/canvases/${remoteId}`, {
      method: "PATCH",
      token,
      body: {
        document: {
          version: 1,
          nodes: [
            { id: "image-1", kind: "image", position: { x: 0, y: 0 }, data: { assets: [asset] } },
            {
              id: "gen-remote",
              kind: "generator",
              position: { x: 320, y: 0 },
              data: { pluginId: "image-to-image", modelKey: remote.key, params: {} },
            },
          ],
          edges: [
            {
              id: "edge-1",
              source: "image-1",
              sourceHandle: "out",
              target: "gen-remote",
              targetHandle: "slot:image",
            },
          ],
          viewport: { x: 0, y: 0, zoom: 1 },
        },
      },
    });

    const remoteRun = await api(`/api/canvases/${remoteId}/runs`, {
      method: "POST",
      token,
      body: {
        nodeId: "gen-remote",
        pluginId: "image-to-image",
        modelKey: remote.key,
        params: {},
      },
    });
    check("the remote run is accepted", remoteRun.status === 202, `got ${remoteRun.status} ${JSON.stringify(remoteRun.payload?.error ?? "")}`);

    const remoteFinal = await waitForRun(token, remoteRun.payload?.run?.id);
    check(
      "the remote run finishes",
      remoteFinal?.status === "succeeded",
      `status ${remoteFinal?.status} ${remoteFinal?.error ?? ""}`,
    );
    check(
      "the remote result is not marked as a demo",
      remoteFinal?.tasks?.[0]?.synthetic === false,
      JSON.stringify(remoteFinal?.tasks?.[0]),
    );
    check(
      "the remote run names the model it used",
      remoteFinal?.modelKey === remote.key,
      `${remoteFinal?.modelKey}`,
    );
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);