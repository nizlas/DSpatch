/**
 * Which agent a loop run uses, decided once before anything starts (DSP-138).
 *
 * Both run handlers in `main.ts` - the graph editor's Run and the chat's *Use loop* -
 * call {@link prepareLoopRun} after their double-run guard and validation and **before**
 * the run record is opened and the loop control is claimed. A refusal is a plain
 * sentence ending "Nothing was started.", and on that path nothing is constructed,
 * nothing is recorded and no provider is asked anything. The windows' "Runs with ..."
 * line comes from the same function ({@link loopRunAgentInfo}), so what is shown and
 * what runs cannot be two answers.
 *
 * What is decided where:
 *
 * - **The provider** is the explicit agent choice: the open chat session's provider,
 *   else the stored choice. Never Cursor by default, and never a graph's `target`, which
 *   is a label of the drawing.
 * - **The agent's tools** are the shared factory's for purpose `'loop'`
 *   (`provider-adapters.ts`): Claude gets the main chat's `CHAT_PERMISSIONS`, Cursor
 *   `LOOP_RUN_TOOL_POLICY`. Commands DSpatch itself runs for a gate node are not the
 *   agent's tools and are not decided here.
 * - **The model** under Claude is the chat's Claude model; Cursor keeps the values the
 *   handlers used before.
 */

import type { StoredSessionProvider } from '../shared/bridge';
import type { LoopNode, LoopTarget } from '../shared/loop-graph';
import {
  describeLoopRunAgent,
  describeLoopRunRefused,
  type LoopRunAgentInfo,
} from '../shared/loop-run-agent-text';
import type { ChatAdapter } from './chat-service';
import type { AdapterRequest } from './provider-adapters';
import { CLAUDE_CHAT_MODEL } from './provider-availability';

export const NOTHING_WAS_STARTED = 'Nothing was started.';

/** The part of the shared factory a loop run uses. `providerAdapters` satisfies it. */
export interface LoopRunAdapterSource {
  preflight(request: AdapterRequest): string | null;
  createAdapter(request: AdapterRequest): ChatAdapter;
}

export interface LoopRunAgentRequest {
  /** The open chat session's provider, or `null` when none is open or it names none. */
  readonly sessionProvider: StoredSessionProvider | null;
  /** The stored explicit agent choice, or `null` when none was made. */
  readonly chosenAgent: StoredSessionProvider | null;
  /** How many working folders the run's sessions would be given. */
  readonly rootCount: number;
  /**
   * The entry node, where the run takes its model from it (the chat's *Use loop*), or
   * `undefined` where it does not (the editor's Run, which never has).
   */
  readonly entryNode?: Pick<LoopNode, 'id' | 'label' | 'model'>;
  /** The model a Cursor run asks for, as the handler worked it out before DSP-138. */
  readonly cursorModel: string;
  readonly adapters: LoopRunAdapterSource;
}

export type LoopRunPreparation =
  | {
      readonly ok: false;
      /** Why, without the closing sentence: what a preview shows. */
      readonly why: string;
      /** `why` and "Nothing was started.": what a refused run answers. */
      readonly reason: string;
    }
  | {
      readonly ok: true;
      readonly provider: StoredSessionProvider;
      readonly modelRequested: string;
      /** Builds the run's adapter. `runLiveGraph` calls it once and disposes what it got. */
      readonly createAdapter: () => ChatAdapter;
    };

/**
 * The provider a loop run started now would use: the open session's, else the stored
 * explicit choice, else none. One function for the shown line and the run.
 */
export function resolveLoopProvider(input: {
  readonly sessionProvider: StoredSessionProvider | null;
  readonly chosenAgent: StoredSessionProvider | null;
}): StoredSessionProvider | null {
  return input.sessionProvider ?? input.chosenAgent;
}

function refused(why: string): LoopRunPreparation {
  return { ok: false, why, reason: `${why} ${NOTHING_WAS_STARTED}` };
}

export function prepareLoopRun(request: LoopRunAgentRequest): LoopRunPreparation {
  const provider = resolveLoopProvider(request);
  if (provider === null) {
    return refused(
      'No agent is chosen, so this loop has nothing to run with. Choose an agent when you ' +
        'open a project, then run the loop again.',
    );
  }
  const purpose = 'loop' as const;
  // Availability and, for Claude, the adapter's own authentication rule - asked of the
  // factory without building anything. The factory's sentence, not reworded.
  const unavailable = request.adapters.preflight({ provider, purpose });
  if (unavailable !== null) {
    return refused(unavailable);
  }
  if (provider === 'claude') {
    // DSP-149: no folder-count refusal. A run's other folders reach Claude as
    // `additionalDirectories`, with the policy's read and edit rules restated for each.
    const model = request.entryNode?.model;
    if (
      model?.policy === 'fixed' &&
      model.model !== undefined &&
      model.model !== '' &&
      model.model !== CLAUDE_CHAT_MODEL
    ) {
      const step = request.entryNode?.label ?? request.entryNode?.id ?? 'the first step';
      return refused(
        `The loop's first step, "${step}", fixes the model ${model.model}, and a loop run ` +
          `with Claude uses ${CLAUDE_CHAT_MODEL}. Set that step's model to inherit to run ` +
          'this loop with Claude.',
      );
    }
  }
  const modelRequested = provider === 'claude' ? CLAUDE_CHAT_MODEL : request.cursorModel;
  return {
    ok: true,
    provider,
    modelRequested,
    createAdapter: () => request.adapters.createAdapter({ provider, purpose }),
  };
}

/**
 * The "Runs with ..." line for a window: the same preparation the run makes, read
 * without starting anything. Nothing is constructed - `createAdapter` is not called.
 */
export function loopRunAgentInfo(
  request: LoopRunAgentRequest,
  drawnFor: LoopTarget | null,
): LoopRunAgentInfo {
  const prepared = prepareLoopRun(request);
  if (!prepared.ok) {
    return { provider: null, line: describeLoopRunRefused(prepared.why) };
  }
  return {
    provider: prepared.provider,
    line: describeLoopRunAgent({
      provider: prepared.provider,
      modelRequested: prepared.modelRequested,
      drawnFor,
    }),
  };
}
