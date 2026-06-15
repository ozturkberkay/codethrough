import type { BaseIssue, BaseSchema } from "valibot";
import { type JsonSchema, toJsonSchema as convert } from "@valibot/to-json-schema";

/// Any Valibot schema, the input type for the converter.
type AnySchema = BaseSchema<unknown, unknown, BaseIssue<unknown>>;

/// Turn a Valibot schema into a JSON Schema object. We send the result to the
/// model so its output follows that shape. Wrapped so callers use one entry point.
export const toJsonSchema = (schema: AnySchema): JsonSchema => convert(schema);

export type { JsonSchema };
