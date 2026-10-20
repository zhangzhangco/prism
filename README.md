# Prism

An open-source node canvas for AI media generation.

Prism is a small, self-hostable creative tool: you arrange prompts, images and
generators on an infinite canvas, wire them together, and run the graph. The
server owns the graph — it reads the stored document to decide what each
generator consumed — so a run is reproducible and auditable.

It ships with a built-in generation backend, which means you can clone the
repository and have a working product without any third-party credentials. Point
it at a different provider when you are ready.

```
┌────────────┐        ┌──────────────────────┐        ┌─────────────┐
│  prompt    │───────▶│  generator (plugin)  │───────▶│  result     │
│  (text)    │  slot  │  runs a model        │        │  (images)   │
└────────────┘        └──────────────────────┘        └─────────────┘
                              │
                              ▼
                    POST /api/canvases/:id/runs
                              │
                    ┌─────────▼──────────┐
                    │  task queue        │  queued → running → succeeded
                    │  provider adapter  │
                    └─────────┬──────────┘
                              ▼
                       assets on disk
```

## Features

- **Infinite canvas** built on [Vue Flow](https://vueflow.dev) — pan, zoom,
  minimap, snap-to-grid, and a node inspector.
- **Declarative plugins.** A generator is described by a manifest: the input
  slots it consumes, the output it produces, and the parameters the user can
  change. Adding a generator never touches the canvas code.
- **The server resolves the graph.** A run request names a node and its
  parameters; the server walks the stored document, collects the values on the
  wires feeding that node, and composes the prompt.
- **A real task queue.** Runs are persisted, picked up by a worker with a
  concurrency limit, and polled until they settle. A restart loses no work.
- **Pluggable providers.** A small adapter interface with two implementations
  out of the box: a local backend that needs no credentials, and an adapter
  for any OpenAI-compatible image endpoint.
- **Local runtimes.** Generators that do not need a model at all run in
  process.
- **Asset library.** Uploads and generated outputs are stored on disk and
  served behind the API's bearer token.

## Requirements

- Node.js 22.19 or newer (the server uses the built-in `node:sqlite` module)
- pnpm 10 or newer

## Getting started

```bash
pnpm install
pnpm build          # builds the shared contracts first
pnpm dev            # server on :4319, web app on :5173
```

Open <http://127.0.0.1:5173>, create an account, and the workspace opens with
an empty canvas.

Add a **Prompt** node, a **Generator** node, drag from the prompt's output
handle to the generator's `Prompt` input, and press **Run**.

### Running the smoke test

With the server running:

```bash
node scripts/smoke.mjs
```

It signs up, creates a canvas, wires a prompt into a generator, runs it, checks
that the produced bytes are a PNG, and verifies that the server followed the
wire when resolving inputs.

## Configuration

The server reads its configuration from the environment. Everything has a
sensible default; see `.env.example` for the full list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PRISM_HOST` | `127.0.0.1` | Bind address |
| `PRISM_PORT` | `4319` | Bind port |
| `PRISM_DATA_DIR` | `./data` | Database and asset storage |
| `PRISM_WORKER_CONCURRENCY` | `2` | Runs executed in parallel |
| `PRISM_POLL_INTERVAL_MS` | `1500` | How often a worker checks on a run |
| `PRISM_PUBLIC_BASE_URL` | `http://127.0.0.1:<port>` | Base URL used in asset links |
| `PRISM_ALLOW_SIGNUP` | `true` | Allow new accounts |
| `PRISM_OPENAI_BASE_URL` | `https://api.openai.com/v1` | Image endpoint |
| `PRISM_OPENAI_API_KEY` | — | Enables the `openai-image` model |
| `PRISM_OPENAI_MODEL` | `gpt-image-1` | Model id to request |

With `PRISM_OPENAI_API_KEY` set, a model called **OpenAI Image** appears in the
catalog and any plugin bound to it is routed to that endpoint instead of the
built-in backend.

## Layout

```
packages/contracts   Shared wire types: documents, manifests, runs, assets
apps/server          Fastify API, SQLite storage, task runner, providers
apps/web             Vue 3 client with the canvas editor
scripts/smoke.mjs    End-to-end check against a running server
docs/                Architecture notes and the plugin reference
```

## Writing a plugin

A plugin is a manifest. Drop it into `apps/server/src/plugins/catalog.ts`:

```ts
{
  id: "text-to-image",
  name: "Text to Image",
  version: "1.0.0",
  category: "generation",
  summary: "Generate an image from a written description.",
  icon: "sparkle",
  inputs: [
    { key: "prompt", label: "Prompt", dataType: "text", required: false, min: 0, max: 1 },
  ],
  outputs: [
    {
      key: "images",
      label: "Images",
      dataType: "image",
      params: [
        { key: "ratio", label: "Aspect ratio", type: "enum", default: "1:1",
          options: [{ value: "1:1", label: "1:1" }] },
      ],
    },
  ],
  defaults: { ratio: "1:1" },
  runtime: { kind: "provider", modelKey: "prism-diffusion-v1" },
  enabled: true,
}
```

The input slot key is the address of the slot: an edge that delivers a value
into the generator names it in its `targetHandle` as `slot:<key>`, and the
collected values are handed to the provider under the same key.

See [docs/plugin-schema.md](docs/plugin-schema.md) for the full reference and
[docs/architecture.md](docs/architecture.md) for how a run travels through the
system.

## API

All routes live under `/api` and require `Authorization: Bearer <token>`
except for registration and login.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create an account, returns a token |
| `POST` | `/api/auth/login` | Exchange credentials for a token |
| `GET` | `/api/auth/me` | Current user |
| `GET` | `/api/canvases` | List canvases |
| `POST` | `/api/canvases` | Create a canvas |
| `GET` | `/api/canvases/:id` | Read a canvas and its document |
| `PATCH` | `/api/canvases/:id` | Rename a canvas or replace its document |
| `DELETE` | `/api/canvases/:id` | Delete a canvas |
| `GET` | `/api/plugins` | Plugin catalog |
| `GET` | `/api/models` | Model catalog |
| `POST` | `/api/canvases/:id/assets` | Upload a file |
| `GET` | `/api/assets/:id` | Download a file |
| `POST` | `/api/canvases/:id/runs` | Start a generation |
| `GET` | `/api/runs/:id` | Read a run |
| `GET` | `/api/canvases/:id/runs` | List the runs of a canvas |

## Development

```bash
pnpm typecheck      # tsc across the workspace
pnpm build          # production build
pnpm --filter @prism/server dev
pnpm --filter @prism/web dev
```

## License

MIT — see [LICENSE](LICENSE).
