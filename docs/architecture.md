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
  │ flush the save       │                             │
  │ POST /runs           │                             │
  │  {nodeId, pluginId,  │                             │
  │   documentFingerprint}                             │
  ├─────────────────────▶│                             │
  │                      │ fingerprint matches?        │
  │                      │ no  → 409 stale_document    │
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

Four decisions shape this:

**The client does not send the payload of a run.** It names a node and its
parameters. The worker reads the stored document, finds the edges that
terminate on that node, and reads the values from the producing nodes. The
request is small and the server stays the authority on what a run consumed.

**A run carries a fingerprint of the document.** The client flushes any
pending save before it asks for a run, then sends a fingerprint of the
document it is looking at. The server compares that with the stored document
and refuses the run with `409 stale_document` if they differ. The client
saves and retries once. A run can therefore never silently use a stale graph.

**The input slot key is the address.** A plugin declares slots; an edge names
the slot it feeds in `targetHandle` as `slot:<key>`; the provider receives the
collected values under the same key. One convention, used everywhere.

**Runs are rows, not futures.** A run is a row in `runs` with a status. The
worker polls the database for queued rows, so a restart loses nothing and the
client can always ask what happened.

## Interrupted runs

A run that was in flight when the process stopped is collected on startup.
A provider cannot be re-attached to, so the run is started again from the
beginning; after three attempts it is failed with a reason rather than being
retried for ever. A run is never left showing "running" with nobody working
on it.

The caveat is worth stating plainly: a provider that bills on submission will
bill again when an interrupted run is repeated. A deployment that cares should
give its provider an idempotency key derived from the run id.

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
  the prompt. No credentials, no network. A reference image is composited into
  the output, so the input demonstrably changes the result.
- `openai-compatible` — posts to `/images/generations`, or to
  `/images/edits` with the reference images attached when the run has any.

The PNG encoder lives in `apps/server/src/png.ts` and its counterpart
`apps/server/src/png-decode.ts` so the built-in backend has no image
dependency and can read back what it wrote.

### Synthetic output is marked as such

The built-in backend is a demo, not a model, and the product says so:

- the model entries are labelled `(demo)`;
- a run that used it is flagged `synthetic` on the task;
- the client shows "Produced by the built-in demo backend, not a model" on the
  result node;
- the image itself carries a diagonal hatch.

A local runtime such as `Upscale` is *not* synthetic: it really does
resample the input, and the result is the source at a larger size.

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

Three things keep the client and the server in step:

- **Saving is flushed, not just scheduled.** Starting a run, switching canvas
  and closing the tab all go through `flushSave`, which cancels the debounce
  and waits for the write to land. A run therefore never starts against a
  document the server has not seen.
- **The fingerprint is a second line of defence.** Even if a save were still
  in flight, the server compares the fingerprint and refuses a stale run.
- **Unloading does not lose the last edit.** When the tab is hidden or
  closed, the document is sent with a `keepalive` request, which the browser
  lets finish.

## The 3D stage

A stage node holds a small document of its own — objects, cameras and stage
settings — inside the node's data, so it is saved with the canvas and comes
back when the canvas is reopened.

The console is a full-screen editor rather than a widget inside the node,
because a 3D viewport is unusable at node size. It uses
[three.js](https://threejs.org), loaded on demand so the library only ends
up in the chunk that needs it.

```
apps/web/src/stage/scene.ts    builds the scene from the document
apps/web/src/stage/orbit.ts    a small orbit controller
apps/web/src/stage/defaults.ts the starting point for a new stage
apps/web/src/components/DirectorConsole.vue  the editor
```

Exporting a frame renders the active camera to an offscreen buffer, uploads
it as an asset and stores the reference on the node. The server reads that
reference like any other image input, so a stage can be wired straight into a
generator.

The stage uses parametric shapes — boxes, spheres, cylinders, and a figure
assembled from primitives — rather than imported models. They need no assets
and they make it obvious what a composition looks like, which is the point of
a staging area.
