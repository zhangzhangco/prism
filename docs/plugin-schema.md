# Plugin reference

A plugin describes one generator. It is a plain object, so a plugin can live
in a file, a database, or a remote service — the server only needs to be able
to look it up by id.

```ts
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  category: string;
  summary: string;
  icon: string;
  inputs: SlotSpec[];
  outputs: OutputSpec[];
  defaults: Record<string, unknown>;
  runtime: PluginRuntime;
  enabled: boolean;
}
```

## Input slots

```ts
interface SlotSpec {
  key: string;
  label: string;
  dataType: "image" | "text" | "audio" | "video" | "any";
  required: boolean;
  min?: number;
  max?: number;
  help?: string;
}
```

The slot key is an address. An edge that delivers a value into the generator
names it in the edge's `targetHandle`:

```
"targetHandle": "slot:prompt"
```

The values collected for a slot are handed to the provider under the same key:

```json
{
  "userInputJson": {
    "prompt": [{ "kind": "text", "text": "a quiet harbour at dawn" }],
    "image":  [{ "kind": "image", "assetId": "ast_…", "url": "https://…" }]
  }
}
```

A slot with `min` (or `required: true`) that receives too few values fails the
run before it reaches a provider.

## Outputs

```ts
interface OutputSpec {
  key: string;
  label: string;
  dataType: DataType;
  params: ParamSpec[];
}
```

The output key becomes the task key in the run record, and the parameters
become the controls the client renders on the node.

```ts
interface ParamSpec {
  key: string;
  label: string;
  type: "enum" | "number" | "string" | "boolean";
  default?: unknown;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  help?: string;
}
```

Parameters are collected from the node and sent with the run. `defaults` on
the manifest provides the initial values when a node is created.

## Runtime

```ts
type PluginRuntime =
  | { kind: "provider"; modelKey: string }
  | { kind: "local" };
```

`provider` routes the run to a generation backend. `modelKey` selects the
model, and the provider registry picks the first backend that supports it.

`local` runs the generator in process, synchronously. Local runtimes are
registered in `apps/server/src/local/executors.ts` and are useful for
transformations that do not need a model.

## Node kinds

The server understands five node kinds. Everything else is opaque data that
the server stores and returns unchanged.

| Kind | Produces | Data |
| --- | --- | --- |
| `prompt` | text | `{ text }` |
| `text` | text | `{ text }` |
| `image` | images | `{ assets: AssetRef[] }` |
| `collection` | images | `{ items: [{ assetId, url }] }` |
| `generator` | — | `{ pluginId, params, runId?, status? }` |

A result node is an `image` node produced by a run; the client adds it and
wires it to the generator that produced it.

## Adding a provider

```ts
export class MyProvider implements GenerationProvider {
  readonly id = "my-provider";

  supports(modelKey: string): boolean {
    return modelKey === "my-model-v1";
  }

  async submit(request: ProviderRequest): Promise<ProviderTask> {
    // Hand the job to the backend and return a handle.
  }

  async poll(task: ProviderTask, request: ProviderRequest): Promise<ProviderResult> {
    // Return `{ status: "running" }` until the job settles.
  }
}
```

Register it in `apps/server/src/providers/registry.ts` and add a model entry
in `apps/server/src/models/catalog.ts` that points at it.

The provider receives the composed prompt, the parameters, and the collected
slot values. It returns asset bytes; the server stores them and records the
metadata.
