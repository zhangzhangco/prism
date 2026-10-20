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

**A run keeps the inputs it was submitted with.** The inputs are resolved
when the run is accepted, against the document as it stands at that moment,
and stored with the run. The worker uses that snapshot rather than re-reading
the canvas, so a change made while the run was queued cannot alter what it
consumes.

**The input slot key is the address.** A plugin declares slots; an edge names
the slot it feeds in `targetHandle` as `slot:<key>`; the provider receives the
collected values under the same key. One convention, used everywhere.

**Runs are rows, not futures.** A run is a row in `runs` with a status. The
worker polls the database for queued rows, so a restart loses nothing and the
client can always ask what happened.

## Wiring is type checked

A node knows what it puts on its wire: text for a prompt, an image for an
uploaded picture, a result or a 3D stage. A generator's slots know what they
accept. The canvas refuses a connection between the two when the types do not
match, so a picture cannot be dragged into a text slot.

The server checks the same thing, and refuses a run whose required slot came
up empty.

## Models and parameters

A model owns its parameters. The catalogue entry lists what the model accepts
and the values it allows, and the client renders exactly that on the node.
The plugin contributes parameters of its own — a free-text prompt, for
instance — which are shown alongside the model's. When both define the same
key, the model's definition wins.

The server checks the submitted parameters against the model before the run
is queued. A value the backend would refuse is reported rather than quietly
changed: turning `standard` into `medium` without saying so would hide the
fact that the request was not what the user asked for.

Each model also declares a **dialect**, which is how the request is shaped:

| Dialect | Behaviour |
| --- | --- |
| `mock` | The built-in backend. |
| `gpt-image` | Returns base64 unconditionally and rejects the legacy `response_format` field, so it is never sent. Takes `background` and `output_format`. |
| `dall-e` | The older dialect, which expects `response_format`, knows only its own quality names, and cannot work from a reference image. OpenAI retired its own DALL·E 3 endpoint in May 2026, so the built-in catalogue does not offer it; compatible servers still implement the dialect and the adapter keeps speaking it. |
| `generic` | The conservative middle ground. |

A run records the model it was submitted against, so the record says which
model produced an image.

## Interrupted runs

A run that was in flight when the process stopped is collected on startup.
A provider cannot be re-attached to, so the run is started again from the
beginning; after three attempts it is failed with a reason rather than being
retried for ever. A run is never left showing "running" with nobody working
on it.

Every provider request carries an `Idempotency-Key` derived from the run id,
so a provider that honours one will not bill the same job twice when a run
is repeated. The caveat is worth stating plainly: a provider that ignores
the header will bill the first attempt, and the repeated one as well.

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
polled until the job settles. Three implementations ship with Prism:

- `mock` — produces real PNG bytes from a deterministic gradient derived from
  the prompt. No credentials, no network. A reference image is composited into
  the output, so the input demonstrably changes the result.
- `openai-compatible` — serves the models whose provider is
  `openai-compatible`, shaping the request for the model's dialect. A run
  with a reference image goes to `/images/edits` with the image attached;
  without one it goes to `/images/generations`.

The PNG encoder lives in `apps/server/src/png.js` and its counterpart
`apps/server/src/png-decode.ts` so the built-in backend has no image
dependency and can read back what it wrote.

`scripts/fake-openai.mjs` is a stand-in for the endpoint. It is deliberately
strict, because the point is to catch the mistakes a lenient mock would hide:
it rejects `response_format` the way the GPT Image family does, it rejects a
size or quality the model does not accept, it requires an image part on an
edit, and it honours `Idempotency-Key` so a repeated request returns the
first answer instead of producing a second job.

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

### Undo, redo and the rest of the keyboard

The store keeps a bounded history of the node and edge lists. Every change
that a person makes — adding a node, connecting two, removing one, editing a
parameter — records the previous state, so `Ctrl`/`Cmd` + `Z` steps back
through them. The shortcut set is the one a canvas editor is expected to have:
undo, redo, copy, paste, delete and save.

### Languages

The interface ships in English and Simplified Chinese, and the choice is
remembered per browser. The catalogue entries the server sends carry a
translation key next to the label:

```json
{ "key": "gpt-image-1", "label": "GPT Image 1", "labelKey": "model.gptImage1.label" }
```

The client prefers the key when the catalogue has an entry for it and falls
back to the raw label otherwise, so a deployment can add its own models
without having to translate them. The same applies to plugins, slots, output
parameters and the values an enum can take.

## Subjects and the outline

A production is built from reusable **subjects**: actors, scenes, props and
effects. A subject belongs to the account rather than to one canvas, so the
same character can be used in as many productions as the account wants. What a
production uses is recorded in its **outline**, which lives inside the canvas
document:

```json
{
  "outline": { "actors": ["sub_…"], "scenes": [], "props": ["sub_…"], "effects": [] }
}
```

Because the outline is part of the document, it is saved and restored with
everything else.

A subject reaches a run in two ways, and both leave a link behind:

- **Into the 3D stage.** The staged object keeps the id of the subject it
  came from, so it can be traced back to the library and picks up changes made
  to the subject later.
- **Into a generator.** The generator keeps the ids of its subjects. When the
  run is accepted, the server resolves them: the description of each subject
  becomes part of the prompt, and its thumbnail — if it has one — becomes a
  reference image in the first slot that accepts images.

The resolution happens when the run is accepted, so the snapshot the worker
uses already contains the subject's contribution.

A subject can also be placed on the canvas as a node of its own, in which case
it behaves like any other source: its description is text, and its thumbnail is
an image. The server resolves it the same way.

### Thumbnails

A subject may carry an image that stands for it. The image is an ordinary
asset, so the server checks that it belongs to the account that owns the
subject before accepting it — otherwise a caller could point a subject at
somebody else's asset, and the subject's thumbnail is served to whoever can
read the subject.

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
