import { array, type InferOutput, integer, nullable, number, object, pipe, string } from "valibot";

/// A whole number. Reused by every model-output field that must be an integer.
const integerSchema = pipe(number(), integer());

/// One stop in the walkthrough, tied to a single diff hunk. Kept simple on
/// purpose: the model's output format does not support tuples or min/max, so
/// `lineRange` is a plain number array here. The engine checks the exact shape
/// (two line numbers, in order, inside the hunk) later.
export const Step = object({
  order: integerSchema,
  hunkId: string(),
  lineRange: nullable(array(integerSchema)),
  title: string(),
  explanation: string(),
});

export type Step = InferOutput<typeof Step>;
