// Turns the walkthrough into Markdown the user can copy and share. Pure, so it is
// unit-tested.
import type { ReviewMeta, Step, Summary } from "@codethrough/schema";

// A blank line between Markdown blocks.
const SECTION_SEP = "\n\n";

// Render the summary: a paragraph per field, then the key decisions list.
const summarySection = (summary: Summary): string => {
  const decisions =
    summary.keyDecisions.length > 0
      ? summary.keyDecisions.map((decision) => `- ${decision}`).join("\n")
      : "- (none stated)";
  return [
    `## Problem${SECTION_SEP}${summary.problem}`,
    `## Status quo${SECTION_SEP}${summary.statusQuo}`,
    `## Solution${SECTION_SEP}${summary.solution}`,
    `## Key decisions${SECTION_SEP}${decisions}`,
  ].join(SECTION_SEP);
};

// Render one step as a numbered section. The number is just its position in the
// list.
const stepSection = (step: Step, position: number): string =>
  `### Step ${position}: ${step.title}${SECTION_SEP}${step.explanation}`;

// Render the steps, or a note saying there were none. The note matches what the
// UI shows.
const stepsSection = (steps: Step[]): string => {
  if (steps.length === 0) {
    return `## Walkthrough${SECTION_SEP}No steps were produced for this walkthrough.`;
  }
  const body = steps.map((step, index) => stepSection(step, index + 1)).join(SECTION_SEP);
  return `## Walkthrough${SECTION_SEP}${body}`;
};

// Build the full document: title, the summary if there is one, then the steps.
const walkthroughToMarkdown = (
  meta: ReviewMeta,
  summary: Summary | null,
  steps: Step[],
): string => {
  const sections = [`# ${meta.title}`];
  if (summary !== null) {
    sections.push(summarySection(summary));
  }
  sections.push(stepsSection(steps));
  return sections.join(SECTION_SEP);
};

export { walkthroughToMarkdown };
