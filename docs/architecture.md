# Architecture

Prism has two processes and one shared contract package.

```
packages/contracts   The wire types both sides agree on
apps/server          API, storage, task runner, provider adapters
apps/web             Canvas editor
```

## The document is the source of truth

A canvas is a single JSON document:

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "prompt-1",
      "kind": "prompt",
      "position": { "x": 60, "y": 60 },
      "data": { "text": "a quiet harbour at dawn" }
    },
    {
      "id": "gen-1",
      "kind": "generator",
      "position": { "x": 360, "y": 60 },
      "data": { "pluginId": "text-to-image", "params": { "ratio": "1:1" } }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "prompt-1",
      "sourceHandle": "out",
      "target": "gen-1",
      "targetHandle": "slot:prompt"
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

The client edits the document in Vue Flow's node and edge lists and converts
between the two shapes at the boundary (`apps/web/src/graph/convert.ts`). The
server stores the document verbatim.

Nodes are intentionally opaque to the server: only the five node kinds and the
data each kind carries are understood. Everything else is passed through.

## A run

```
client                server                        worker
  │                      │                             │
  │ POST /runs           │                             │
  │  {nodeId, pluginId}  │                             │
  ├─────────────────────▶│                             │
  │                      │ insert run (status=queued)  │
  │                      ├────────────────────────────▶│ claim queued run
  │                      │                             │ read the document
  │                      │                             │ resolve the inputs
  │                      │                             │ submit to provider
  │                      │                             │ poll
  │                      │◀────────────────────────────┤
  │                      │ store assets, status=succeeded
  │ GET /runs/:id        │                             │
  ├─────────────────────▶│                             │
  │◀─────────────────────┤                             │
```

Three decisions shape this:

**The client does not send the payload of a run.** It names a node and its
parameters. The worker reads the stored document, finds the edges that
terminate on that node, and reads the values from the producing nodes. The
request is small and the server stays the authority on what a run consumed.

**The input slot key is the address.** A plugin declares slots; an edge names
the slot it feeds in `targetHandle` as `slot:<key>`; the provider receives the
collected values under the same key. One convention, used everywhere.

**Runs are rows, not futures.** A run is a row in `runs` with a status. The
worker polls the database for queued rows, so a restart loses nothing and the
client can always ask what happened.

## Task lifecycle

```
queued ──▶ running ──▶ succeeded
              │
              └──────▶ failed
```

The worker claims up to `PRISM_WORKER_CONCURRENCY` runs at a time. For a
provider-backed plugin it submits the job, then polls the provider on
`PRISM_POLL_INTERVAL_MS` until the provider reports a terminal state. Local
runtimes skip the queue entirely and finish in one pass.

Outputs are written to `PRISM_DATA_DIR/storage/<user>/<asset>` and recorded in
the `assets` table. Asset reads go through the API, so they carry the same
bearer token as everything else.

## Providers

```ts
interface GenerationProvider {
  readonly id: string;
  supports(modelKey: string): boolean;
  submit(request: ProviderRequest): Promise<ProviderTask>;
  poll(task: ProviderTask, request: ProviderRequest): Promise<ProviderResult>;
}
```

A provider is asked whether it can serve a model, is handed a job, and is then
polled until the job settles. Two implementations ship with Prism:

- `mock` — produces real PNG bytes from a deterministic gradient derived from
  the prompt. No credentials, no network.
- `openai-compatible` — posts to `/images/generations` on any endpoint that
  speaks that dialect.

The PNG encoder lives in `apps/server/src/png.ts` so the built-in backend has
no image dependency.

## Storage

SQLite through the built-in `node:sqlite` module, which keeps the install
free of native builds. The schema is applied as numbered migrations and
recorded in `schema_migrations`.

The tables are `users`, `api_tokens`, `canvases`, `assets`, `runs` and
`run_tasks`. Tokens are stored as a SHA-256 digest; the raw token is only ever
returned once, at issue time.

## Authentication

Registration and login exchange an email and password for an opaque bearer
token. Passwords are hashed with scrypt. The token is presented in the
`Authorization` header and resolved to a user by the `authenticate`
pre-handler, which every route except registration and login installs.

Assets are served behind the same check, which is why the web client fetches
image bytes with the token and renders an object URL rather than pointing an
`<img>` tag at the API.

## The web client

Vue 3 with Pinia for state and Vue Flow for the canvas. Two stores matter:

- `session` — the signed-in user and the token.
- `canvas` — the open canvas, the plugin and model catalogs, and the follow
  loop that watches a run until it settles.

The canvas store converts the Vue Flow lists into a document when it saves, and
back when it loads. Saving is debounced, so dragging a node does not produce a
request per frame.
