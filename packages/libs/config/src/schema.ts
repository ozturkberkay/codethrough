import convict from "convict";
import convictFormatWithValidator from "convict-format-with-validator";

/// The `url` format lives in an optional add-on package, so register it.
convict.addFormats(convictFormatWithValidator);

/// Drop blank env entries before handing them to convict. A blank value (say from
/// a docker `${VAR:-}` default) would otherwise count as a real empty string and
/// override the defaults, forcing every consumer to set every var.
const filteredEnv: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== "") {
    filteredEnv[key] = value;
  }
}

/// Lets the per-env override files set only the fields that differ from the
/// defaults; convict merges them in and keeps the rest.
export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export interface AppConfig {
  env: "local" | "production";
  landing: {
    base_url: string;
  };
}

export const configSchema = convict<AppConfig>(
  {
    env: {
      format: ["local", "production"],
      default: "local",
      env: "CODETHROUGH_ENV",
      doc: "Selects which per-env override file is layered on top of the schema defaults.",
    },
    landing: {
      base_url: {
        format: "url",
        default: "http://localhost:4321",
        doc: "Public URL of the static landing site; the BFF redirects here after the OAuth flow.",
      },
    },
  },
  { env: filteredEnv },
);
