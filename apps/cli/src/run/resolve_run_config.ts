// Turn the run's flags and the two config files into the resolved config. Reading
// and parsing the files is the shell's job, kept out so this stays testable. The
// precedence, env settings, and validation all live in @codethrough/config.
//
// SECRETS NEVER COME FROM CONFIG: the loader drops any unknown key, so a token in a
// hand-edited file never reaches the resolved config.

import {
  type FlagOverrides,
  resolveRunConfig as resolveFromSources,
  type ResolvedRunConfig,
} from "../config/config_resolve.js";
import type { RunArgs } from "../args/run_args.js";
import { optionalField } from "../optional.js";

// Loads and parses a config file, or undefined when absent. The result is untyped;
// the loader keeps only the keys it knows.
type ConfigLoader = (location: "project" | "user") => Record<string, unknown> | undefined;

// The inputs: the run's flags and the config loader.
interface ResolveRunConfigInputs {
  args: RunArgs;
  loadConfig: ConfigLoader;
}

// Map the engine-related flags to the loader's shape, including each only when set.
const flagOverrides = (args: RunArgs): FlagOverrides => ({
  ...optionalField("model", args.model),
  ...optionalField("effort", args.effort),
});

// Resolve the config: load both files, then let the central loader apply the
// precedence (flags > env > project > user > defaults).
const resolveRunConfig = (inputs: ResolveRunConfigInputs): ResolvedRunConfig => {
  const project = inputs.loadConfig("project");
  const user = inputs.loadConfig("user");
  return resolveFromSources({
    flags: flagOverrides(inputs.args),
    ...optionalField("project", project),
    ...optionalField("user", user),
  });
};

export { resolveRunConfig };
export type { ConfigLoader, ResolveRunConfigInputs };
