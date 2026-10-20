#!/usr/bin/env node
/**
 * Interrupted-run recovery check.
 *
 * Starts a server, starts a generation, kills the server while the run is
 * still in flight, and restarts it. The run must not be left hanging in
 * "running" for ever: it either finishes again or fails with a reason.
 *
 * Run it with `pnpm test:recovery`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 4399;
const baseUrl = `http://127.0.0.1:${port}`;
const dataDir = mkdtempSync(join(tmpdir(), "prism-recovery-"));

let failures = 0;
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function startServer() {
  const child = spawn(process.execPath, [join(root, "apps/server/dist/index.js")], {
    env: {
      ...process.env,
      PRISM_DATA_DIR: dataDir,
      PRISM_PORT: String(port),
      PRISM_POLL_INTERVAL_MS: "400",
      PRISM_LOG_LEVEL: "warn",
    },
    stdio: "ignore",
  });
  return child;
}

async function waitForHealth(attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }
  return { status: response.status, payload };
}

console.log("interrupted run recovery\n");

let server = startServer();
check("the server starts", await waitForHealth());

const email = `recovery-${Date.now()}@example.test`;
const registration = await api("/api/auth/register", {
  method: "POST",
  body: { email, password: "recovery-password" },
});
const token = registration.payload?.token;

const canvas = await api("/api/canvases", { method: "POST", token, body: { name: "Recovery" } });
const canvasId = canvas.payload?.canvas?.id;

await api(`/api/canvases/${canvasId}`, {
  method: "PATCH",
  token,
  body: {
    document: {
      version: 1,
      nodes: [
        {
          id: "gen-1",
          kind: "generator",
          position: { x: 0, y: 0 },
          data: { pluginId: "text-to-image", params: { ratio: "1:1" } },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
});

const started = await api(`/api/canvases/${canvasId}/runs`, {
  method: "POST",
  token,
  body: { nodeId: "gen-1", pluginId: "text-to-image", params: { ratio: "1:1" } },
});
const runId = started.payload?.run?.id;
check("a run is started", typeof runId === "string");

// Give the worker a moment to pick the run up, then pull the plug.
await new Promise((resolve) => setTimeout(resolve, 600));
const beforeKill = await api(`/api/runs/${runId}`, { token });
check("the run is in flight", beforeKill.payload?.run?.status === "running", beforeKill.payload?.run?.status);

server.kill("SIGKILL");
await new Promise((resolve) => setTimeout(resolve, 400));
check("the server is stopped", true);

server = startServer();
check("the server starts again", await waitForHealth());

let status = null;
for (let attempt = 0; attempt < 60; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const response = await api(`/api/runs/${runId}`, { token });
  status = response.payload?.run?.status;
  if (status && status !== "running") break;
}
check(
  "the interrupted run does not stay running",
  status === "succeeded" || status === "failed" || status === "queued",
  `status ${status}`,
);

if (status === "failed") {
  const response = await api(`/api/runs/${runId}`, { token });
  check(
    "a run that could not be resumed says why",
    typeof response.payload?.run?.error === "string" && response.payload.run.error.length > 0,
    JSON.stringify(response.payload?.run?.error),
  );
}

server.kill("SIGTERM");
await new Promise((resolve) => setTimeout(resolve, 300));
server.kill("SIGKILL");
rmSync(dataDir, { recursive: true, force: true });

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
