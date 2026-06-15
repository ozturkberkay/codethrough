import { localOverrides } from "./environments/local.js";
import { productionOverrides } from "./environments/production.js";
import { type AppConfig, configSchema } from "./schema.js";

const env = configSchema.get("env");

if (env === "production") {
  configSchema.load(productionOverrides);
} else if (env === "local") {
  configSchema.load(localOverrides);
}

configSchema.validate({ allowed: "strict" });

export const config: Readonly<AppConfig> = Object.freeze(configSchema.getProperties());
export type { AppConfig } from "./schema.js";

// The central Codethrough tuning config (engine and server knobs). Unlike the
// landing config above, the CLI builds this on demand per run, not on import.
export { defaultCodethroughConfig, EFFORTS, loadCodethroughConfig } from "./codethrough.js";
export type { CodethroughConfig, Effort, FlagOverrides, LoadOptions } from "./codethrough.js";
