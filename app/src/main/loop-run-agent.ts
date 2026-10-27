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
import { modelForChatNode } from '../shared/loop-chat';

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
  /** DSP-149: the model chosen for Claude; `''` is the provider's own default. */
  readonly claudeModel: string;
  /**
   * DSP-149: the model ids Claude listed for this account in this launch, or absent
   * when no list has been read. Used only to make a conflict with a step's fixed model
   * understandable before anything starts.
   */
  readonly claudeModels?: readonly string[] | null;
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
  // DSP-149: no folder-count refusal for Claude, and no model refusal either. A step
  // that fixes its model keeps it, whichever agent runs the loop; otherwise the run
  // asks for the person's choice for that agent. A fixed model the agent does not
  // offer is refused by the agent, with its own reason, before anything is done.
  const fixed = request.entryNode?.model;
  if (
    provider === 'claude' &&
    fixed?.policy === 'fixed' &&
    fixed.model !== undefined &&
    fixed.model !== '' &&
    request.claudeModels != null &&
    !request.claudeModels.includes(fixed.model)
  ) {
    const step = request.entryNode?.label ?? request.entryNode?.id ?? 'the first step';
    return refused(
      `The loop's first step, "${step}", fixes the model ${fixed.model}, which Claude does not offer ` +
        "this account. Set that step's model to inherit to use the model chosen for Claude, or run " +
        'the loop with the agent that offers it.',
    );
  }
  const modelRequested =
    provider === 'claude' ? modelForChatNode(request.entryNode, request.claudeModel) : request.cursorModel;
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
