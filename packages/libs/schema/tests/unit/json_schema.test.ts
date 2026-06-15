import { describe, expect, it } from "vitest";
import { Summary } from "../../src/summary.js";
import { Walkthrough } from "../../src/walkthrough.js";
import { type JsonSchema, toJsonSchema } from "../../src/json_schema.js";

/// Read one property's `type`, checking the property and its entry exist and are
/// objects.
const propertyType = (schema: JsonSchema, key: string): JsonSchema["type"] => {
  const { properties } = schema;
  expect(properties).toBeDefined();
  const property = properties?.[key];
  expect(typeof property).toBe("object");
  return (property as JsonSchema).type;
};

describe("toJsonSchema", () => {
  it("converts Summary to an object schema with its property keys", () => {
    const schema = toJsonSchema(Summary);

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual([
      "problem",
      "statusQuo",
      "solution",
      "keyDecisions",
    ]);
  });

  it("converts Walkthrough to an object schema with summary and steps", () => {
    const schema = toJsonSchema(Walkthrough);

    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties ?? {})).toEqual(["summary", "steps"]);
    expect(propertyType(schema, "steps")).toBe("array");
  });
});
