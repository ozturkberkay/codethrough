import type { AppConfig, DeepPartial } from "../schema.js";

export const productionOverrides = {
  landing: { base_url: "https://codethrough.dev" },
} satisfies DeepPartial<AppConfig>;
