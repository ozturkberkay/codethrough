import { array, type InferOutput, object } from "valibot";
import { Step } from "./step.js";
import { Summary } from "./summary.js";

/// The full walkthrough the model produces: a summary plus the ordered steps.
export const Walkthrough = object({
  summary: Summary,
  steps: array(Step),
});

export type Walkthrough = InferOutput<typeof Walkthrough>;
