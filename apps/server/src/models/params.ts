import type { ModelDescriptor, ParamSpec, PluginManifest } from "@prism/contracts";

/**
 * Parameters and their validation.
 *
 * A generator node shows two kinds of parameter: the ones the selected model
 * accepts, and the ones the plugin adds of its own. When both define the same
 * key the model's definition wins, because only the model knows which values
 * the backend will take.
 */

export function effectiveParams(
  plugin: PluginManifest,
  model: ModelDescriptor | undefined,
): ParamSpec[] {
  const pluginParams = plugin.outputs[0]?.params ?? [];
  const modelParams = model?.params ?? [];

  const byKey = new Map<string, ParamSpec>();
  for (const spec of pluginParams) byKey.set(spec.key, spec);
  for (const spec of modelParams) byKey.set(spec.key, spec);

  // The model's own parameters come first, since they are what the backend
  // actually takes.
  const ordered: ParamSpec[] = [];
  for (const spec of modelParams) ordered.push(spec);
  for (const spec of pluginParams) {
    if (!modelParams.some((candidate) => candidate.key === spec.key)) ordered.push(spec);
  }
  return ordered;
}

export interface ParamValidation {
  /** The parameters that survived validation, with defaults filled in. */
  values: Record<string, unknown>;
  /** Human readable reasons for anything that was rejected. */
  rejected: string[];
}

function isValid(spec: ParamSpec, value: unknown): boolean {
  switch (spec.type) {
    case "enum":
      return typeof value === "string" && (spec.options ?? []).some((option) => option.value === value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

/**
 * Check the parameters a client sent against what the model accepts.
 *
 * A value the model would refuse is reported rather than quietly changed:
 * silently turning "standard" into "medium" would hide the fact that the
 * request was not what the user asked for.
 */
export function validateParams(
  plugin: PluginManifest,
  model: ModelDescriptor | undefined,
  submitted: Record<string, unknown>,
): ParamValidation {
  const specs = effectiveParams(plugin, model);
  const values: Record<string, unknown> = {};
  const rejected: string[] = [];

  for (const spec of specs) {
    const given = submitted[spec.key];

    if (given === undefined) {
      if (spec.default !== undefined) values[spec.key] = spec.default;
      continue;
    }

    if (!isValid(spec, given)) {
      const allowed =
        spec.type === "enum"
          ? (spec.options ?? []).map((option) => option.value).join(", ")
          : spec.type;
      rejected.push(
        `"${spec.key}" cannot be ${JSON.stringify(given)}; expected ${spec.type} (${allowed})`,
      );
      continue;
    }

    values[spec.key] = given;
  }

  // Anything the client sent that nothing declares is dropped: the backend
  // would reject it.
  for (const key of Object.keys(submitted)) {
    if (!specs.some((spec) => spec.key === key)) {
      rejected.push(`"${key}" is not a parameter of this generator`);
    }
  }

  return { values, rejected };
}
