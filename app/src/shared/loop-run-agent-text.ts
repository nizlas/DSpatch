/**
 * What a window says about the agent a loop run uses (DSP-138).
 *
 * One sentence, built from the provider and model a run started now would actually use
 * (`prepareLoopRun` in the main process resolves both). Shared, so the editor's graph
 * panel, the stand-by preview and the running announcement word it the same way. A
 * drawing's `target` is a label: it is named when it differs, never used to choose.
 */

import type { LoopTarget, ModelPolicy } from './loop-graph';

export type LoopRunProvider = 'cursor' | 'claude';

/**
 * What the graph editor tells the main process when it asks for the line: the drawing's
 * `target` and its entry step, so the line applies the same model rule the Run applies
 * to the same drawing.
 */
export interface LoopRunAgentQuery {
  readonly target: string | null;
  readonly entry: {
    readonly id: string;
    readonly label?: string;
    readonly model?: ModelPolicy;
  } | null;
}

/** What the main process answers when a window asks which agent a loop run would use. */
export interface LoopRunAgentInfo {
  /** The provider a run started now would use, or `null` when it would be refused. */
  readonly provider: LoopRunProvider | null;
  /** The sentence to show: the agent line, or why no run would start. */
  readonly line: string;
}

export function describeLoopRunAgent(input: {
  readonly provider: LoopRunProvider;
  readonly modelRequested: string;
  /** The drawing's `target`, or `null` where no drawing is in hand. */
  readonly drawnFor: LoopTarget | null;
}): string {
  const drawn =
    input.drawnFor === null || input.drawnFor === input.provider
      ? ''
      : ` Drawn for ${input.drawnFor}, which is a label of the drawing and not used to run it.`;
  if (input.provider === 'claude') {
    return (
      `Runs with Claude (${input.modelRequested === "" ? "its default model" : input.modelRequested}): its agent steps read and edit files and run ` +
      "builds and tests with Claude Code's own shell tools, which DSpatch records. A gate " +
      "step's command is run by DSpatch itself." +
      drawn
    );
  }
  return (
    `Runs with Cursor (${input.modelRequested}): Cursor's own tools, which can read and edit ` +
    `files and run commands.${drawn}`
  );
}

/** The line shown where no run would start, from the refusal's own reason. */
export function describeLoopRunRefused(why: string): string {
  return `No loop run can start: ${why}`;
}
