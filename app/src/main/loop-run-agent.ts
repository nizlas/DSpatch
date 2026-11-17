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
 *   handlers used before. That is the run's model, which a step naming none runs with;
 *   since DSP-209 S19 a step's own fixed model or `select` option is opened per step by
 *   the executor, and with the graph given, each is checked here first.
 */

import type { StoredSessionProvider } from '../shared/bridge';
import { modelsNamedBy, stepModelChoice, type LoopGraph, type LoopNode } from '../shared/loop-graph';
import {
  describeLoopRunAgent,
  describeLoopRunRefused,
  loopRunAgentSummary,
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
  /**
   * DSP-209 S19: the drawing the run walks. Given, every model a step may ask for - each
   * fixed model and each `select` option - is checked against the account's list before
   * the run starts. Absent, only the entry step's fixed model is, as before.
   */
  readonly graph?: Pick<LoopGraph, 'nodes'>;
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
  /** DSP-148: the model chosen for Copilot, or the runtime's default. */
  readonly copilotModel?: string;
  /**
   * DSP-209 S19b: the model ids Cursor and Copilot listed for this account in this launch
   * (`Cursor.models.list()`, Copilot's `listModels`), or absent when none has been read.
   * Read only to refuse a step's model the account does not have before the run starts.
   */
  readonly cursorModels?: readonly string[] | null;
  readonly copilotModels?: readonly string[] | null;
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
      /**
       * DSP-209 S19: the model a step naming no model of its own (`inherit`, or no `model`)
       * runs with: the person's choice for the provider, never the entry step's fixed model.
       * `modelRequested` keeps its meaning for the record and the "Runs with ..." line.
       */
      readonly personModel: string;
      /**
       * DSP-209 S19b: said when steps name models that could not be checked before the run
       * (no list read for this provider in this launch), so the provider decides; else `null`.
       */
      readonly modelCheck: string | null;
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
  // DSP-209 S19: every step's own model, not only the first's, by the same rule. A model
  // the account does not list is refused here rather than replaced by another.
  if (provider === 'claude' && request.graph !== undefined && request.claudeModels != null) {
    const listed = request.claudeModels;
    const missing = modelsNamedBy(request.graph).find((named) => !listed.includes(named.model));
    if (missing !== undefined) {
      return refused(
        `The step "${missing.label}" ${
          missing.option === null ? 'fixes' : `offers, as option "${missing.option}",`
        } the model ${missing.model}, which Claude does not offer this account. Change that ` +
          "step's model, or run the loop with the agent that offers it.",
      );
    }
  }
  // DSP-209 S19b: Cursor and Copilot by the same rule, against their own lists. Where no list
  // has been read in this launch, nothing is invented: the run is not refused, and what the
  // window shows says plainly that these models were not checked and the provider decides.
  let modelCheck: string | null = null;
  if (provider !== 'claude') {
    const name = provider === 'copilot' ? 'Copilot' : 'Cursor';
    const listed = provider === 'copilot' ? request.copilotModels : request.cursorModels;
    const named =
      request.graph !== undefined
        ? modelsNamedBy(request.graph)
        : fixed?.policy === 'fixed' && fixed.model !== undefined && fixed.model !== ''
          ? [{ nodeId: request.entryNode?.id ?? '', label: request.entryNode?.label ?? request.entryNode?.id ?? 'the first step', model: fixed.model, option: null }]
          : [];
    if (listed != null) {
      const missing = named.find((item) => !listed.includes(item.model));
      if (missing !== undefined) {
        return refused(
          `The step "${missing.label}" ${
            missing.option === null ? 'fixes' : `offers, as option "${missing.option}",`
          } the model ${missing.model}, which ${name} does not offer this account. Change that ` +
            "step's model, or run the loop with the agent that offers it.",
        );
      }
    } else if (named.length > 0) {
      const models = [...new Set(named.map((item) => item.model))].join(', ');
      modelCheck =
        `The model${named.length === 1 ? '' : 's'} the steps name (${models}) could not be checked: ` +
        `${name}'s model list has not been read in this launch, so ${name} decides whether it runs them. ` +
        `Opening ${name}'s model chooser reads the list.`;
    }
  }
  const modelRequested =
    provider === 'claude'
      ? modelForChatNode(request.entryNode, request.claudeModel)
      : provider === 'copilot'
        ? modelForChatNode(request.entryNode, request.copilotModel ?? '')
        : request.cursorModel;
  const personModel =
    provider === 'claude'
      ? request.claudeModel
      : provider === 'copilot'
        ? (request.copilotModel ?? '')
        : request.cursorModel;
  return {
    ok: true,
    provider,
    modelRequested,
    personModel,
    modelCheck,
    createAdapter: () => request.adapters.createAdapter({ provider, purpose }),
  };
}

/**
 * The "Runs with ..." line for a window: the same preparation the run makes, read
 * without starting anything. Nothing is constructed - `createAdapter` is not called.
 */
export function loopRunAgentInfo(request: LoopRunAgentRequest): LoopRunAgentInfo {
  const prepared = prepareLoopRun(request);
  if (!prepared.ok) {
    return { provider: null, line: describeLoopRunRefused(prepared.why), summary: null };
  }
  // DSP-209 S19b: a `select` entry runs its default option unless the arriving edge selects
  // another; the line names that model and says so. The run's `modelRequested` is unchanged.
  const entryChoice = request.entryNode === undefined ? null : stepModelChoice(request.entryNode, null);
  const shown =
    entryChoice?.policy === 'select' && entryChoice.model !== null
      ? `${entryChoice.model === '' ? 'the provider’s default' : entryChoice.model}, option “${entryChoice.option ?? ''}” by default; an edge may select another`
      : prepared.modelRequested;
  const line = describeLoopRunAgent({ provider: prepared.provider, modelRequested: shown });
  return {
    provider: prepared.provider,
    line: prepared.modelCheck === null ? line : `${line} ${prepared.modelCheck}`,
    // DSP-218: the run's own model choice; a step that fixes or selects its own is an exception
    // the window names beside it, from the drawing (or, while it runs, from the journal).
    summary: loopRunAgentSummary(prepared.provider, prepared.personModel),
  };
}
