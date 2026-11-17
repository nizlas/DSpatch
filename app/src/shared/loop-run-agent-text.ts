/**
 * What a window says about the agent a loop run uses (DSP-138).
 *
 * One sentence, built from the provider and model a run started now would actually use
 * (`prepareLoopRun` in the main process resolves both). Shared, so the editor's graph
 * panel, the stand-by preview and the running announcement word it the same way. A
 * drawing's `target` is not named here (DSP-218): it does not choose the agent, and a
 * framework named beside the agent read as the agent.
 */

import { RUN_PROVIDER_NAMES, type ModelPolicy } from './loop-graph';

export type LoopRunProvider = 'cursor' | 'claude' | 'copilot';

/**
 * What the graph editor tells the main process when it asks for the line: the drawing's
 * entry step, so the line applies the same model rule the Run applies to the same drawing.
 */
export interface LoopRunAgentQuery {
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
  /** DSP-218: provider and model in a few words, `null` when no run would start. */
  readonly summary: string | null;
}

/**
 * DSP-218: the provider and model a run uses, in a few words, for the loop view beside Run.
 * Read-only information: the choice is made in the chat.
 */
export function loopRunAgentSummary(provider: LoopRunProvider, model: string): string {
  return `${RUN_PROVIDER_NAMES[provider]} · ${model === '' ? 'its default model' : model}`;
}

export function describeLoopRunAgent(input: {
  readonly provider: LoopRunProvider;
  readonly modelRequested: string;
}): string {
  if (input.provider === 'claude') {
    return (
      `Runs with Claude (${input.modelRequested === "" ? "its default model" : input.modelRequested}): its agent steps read and edit files and run ` +
      "builds and tests with Claude Code's own shell tools, which DSpatch records. A gate " +
      "step's command is run by DSpatch itself."
    );
  }
  if (input.provider === 'copilot') {
    return (
      `Runs with Copilot (${input.modelRequested}): its agent steps read and edit files and run ` +
      "builds and tests with Copilot's own shell tools, which DSpatch records. A gate step's " +
      'command is run by DSpatch itself.'
    );
  }
  return (
    `Runs with Cursor (${input.modelRequested}): Cursor's own tools, which can read and edit ` +
    'files and run commands.'
  );
}

/** The line shown where no run would start, from the refusal's own reason. */
export function describeLoopRunRefused(why: string): string {
  return `No loop run can start: ${why}`;
}
