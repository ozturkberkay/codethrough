import { array, type InferOutput, object, string } from "valibot";

/// The PR summary the model writes: the problem, how things worked before, the
/// solution, and the key decisions.
export const Summary = object({
  problem: string(),
  statusQuo: string(),
  solution: string(),
  keyDecisions: array(string()),
});

export type Summary = InferOutput<typeof Summary>;
