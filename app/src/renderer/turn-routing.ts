/**
 * Routing of agent events into the visible conversation.
 *
 * This is deliberately a separate module with no DOM and no React in it. Two
 * reasons, and the second is the important one:
 *
 * 1. The rule it enforces is a correctness rule, not a rendering detail. Every
 *    turn carries its own run ID, and an event belonging to a run that has been
 *    superseded must **not** be folded into the conversation. DSP-1 measured a
 *    turn that kept producing tool calls for 69.5 s after DSpatch had stopped
 *    listening, and `cancel()` resolving in single-digit milliseconds means the
 *    terminal state was decided locally rather than by the provider. So late
 *    events are not a hypothetical: they are the documented behaviour of the one
 *    provider we are connected to.
 * 2. A guard welded to a live window cannot be shown to work. Here it can be fed
 *    a counter-example in `tests/turn-routing.test.ts`, including the unguarded
 *    rule it replaces, so the counter-example is visibly a counter-example.
 *
 * Nothing is dropped silently. A dropped event increments a counter on the turn
 * it belonged to and is summarised by type, because "the provider may still be
 * working and we are no longer applying what it says" is exactly the state the
 * user has to be able to see.
 */

import type { TurnUsage, UiAgentEvent } from '../shared/bridge';

/** A turn's state as the window shows it. Never inferred from silence. */
export type TurnStatus =
  | 'streaming'
  | 'awaiting-approval'
  | 'finished'
  | 'cancelled'
  | 'error';

/** Why an event was not applied. */
export type DropReason =
  | 'superseded-run'
  | 'other-session'
  | 'unknown-run'
  | 'duplicate-run-started';

export interface DroppedEvent {
  readonly dspatchRunId: string;
  readonly dspatchSessionId: string;
  readonly type: string;
  readonly atUtc: string;
  readonly reason: DropReason;
}

export interface TurnState {
  readonly dspatchRunId: string;
  readonly dspatchSessionId: string;
  readonly prompt: string;
  /**
   * DSpatch's recap of the earlier conversation, sent in front of this prompt.
   *
   * Non-null only on the first turn of a session that could not resume the
   * conversation's earlier provider session. Kept on the turn rather than in a
   * panel of its own because AC#2's question — what was this session actually
   * told — is a question about a particular message.
   */
  readonly resentContext: string | null;
  readonly answer: string;
  readonly deltaCount: number;
  readonly toolsStarted: number;
  readonly toolsFinished: number;
  readonly lastTool: string | null;
  /** Distinct tool names, in the order first seen. Names only: no arguments. */
  readonly toolNames: readonly string[];
  readonly status: TurnStatus;
  readonly errorMessage: string | null;
  readonly approvalSummary: string | null;
  readonly usage: TurnUsage | null;
  readonly cancelRequested: boolean;
  /** A newer run has started. This turn no longer receives events. */
  readonly superseded: boolean;
  readonly lateEventsDropped: number;
  readonly lateEventTypes: Readonly<Record<string, number>>;
  readonly lastLateEventAtUtc: string | null;
  readonly startedAtUtc: string;
  readonly finishedAtUtc: string | null;
}

export interface ChatState {
  /** The session events must belong to. `null` means no session is open. */
  readonly dspatchSessionId: string | null;
  readonly turns: readonly TurnState[];
  /** The newest run. Only this run's events are applied. */
  readonly currentRunId: string | null;
  /** The most recent drops, newest last. Capped; the counter is not. */
  readonly droppedEvents: readonly DroppedEvent[];
  readonly droppedCount: number;
}

/** Keeps the record useful without letting a chatty superseded run grow it forever. */
const DROPPED_EVENT_LIMIT = 25;

export function emptyChatState(dspatchSessionId: string | null): ChatState {
  return {
    dspatchSessionId,
    turns: [],
    currentRunId: null,
    droppedEvents: [],
    droppedCount: 0,
  };
}

function withDrop(
  state: ChatState,
  event: UiAgentEvent,
  reason: DropReason,
  turns: readonly TurnState[] = state.turns,
): ChatState {
  const dropped: DroppedEvent = {
    dspatchRunId: event.dspatchRunId,
    dspatchSessionId: event.dspatchSessionId,
    type: event.type,
    atUtc: event.at,
    reason,
  };
  const kept = [...state.droppedEvents, dropped].slice(-DROPPED_EVENT_LIMIT);
  return {
    ...state,
    turns,
    droppedEvents: kept,
    droppedCount: state.droppedCount + 1,
  };
}

function countLateEvent(turn: TurnState, event: UiAgentEvent): TurnState {
  const types = { ...turn.lateEventTypes };
  types[event.type] = (types[event.type] ?? 0) + 1;
  return {
    ...turn,
    lateEventsDropped: turn.lateEventsDropped + 1,
    lateEventTypes: types,
    lastLateEventAtUtc: event.at,
  };
}

/**
 * Fold one event into the conversation, or drop it and say why.
 *
 * `promptForNewRun` is the text the composer just submitted. `run.started` is the
 * first thing that carries the run ID and it arrives while `sendPrompt` is still
 * pending, so the prompt cannot come from the call's own result.
 */
export function routeEvent(
  state: ChatState,
  event: UiAgentEvent,
  promptForNewRun: string,
): ChatState {
  if (event.dspatchSessionId !== state.dspatchSessionId) {
    // A session that has been replaced is not the conversation on screen. This is
    // not merely tidiness: the working copy may be a different directory
    // altogether, so applying the event would attribute work to the wrong project.
    return withDrop(state, event, 'other-session');
  }

  if (event.type === 'run.started') {
    if (state.turns.some((turn) => turn.dspatchRunId === event.dspatchRunId)) {
      return withDrop(state, event, 'duplicate-run-started');
    }
    const turn: TurnState = {
      dspatchRunId: event.dspatchRunId,
      dspatchSessionId: event.dspatchSessionId,
      prompt: promptForNewRun,
      resentContext: event.resentContext ?? null,
      answer: '',
      deltaCount: 0,
      toolsStarted: 0,
      toolsFinished: 0,
      lastTool: null,
      toolNames: [],
      status: 'streaming',
      errorMessage: null,
      approvalSummary: null,
      usage: null,
      cancelRequested: false,
      superseded: false,
      lateEventsDropped: 0,
      lateEventTypes: {},
      lastLateEventAtUtc: null,
      startedAtUtc: event.at,
      finishedAtUtc: null,
    };
    return {
      ...state,
      // Every earlier turn is superseded, whether or not it reported an end. A
      // turn that never reported one is the honest problem case and is shown as
      // such rather than left looking active.
      turns: [...state.turns.map((old) => ({ ...old, superseded: true })), turn],
      currentRunId: event.dspatchRunId,
    };
  }

  const index = state.turns.findIndex(
    (turn) => turn.dspatchRunId === event.dspatchRunId,
  );
  if (index === -1) {
    return withDrop(state, event, 'unknown-run');
  }

  if (event.dspatchRunId !== state.currentRunId) {
    const turns = state.turns.map((turn, at) =>
      at === index ? countLateEvent(turn, event) : turn,
    );
    return withDrop(state, event, 'superseded-run', turns);
  }

  const turns = state.turns.map((turn, at) =>
    at === index ? applyToTurn(turn, event) : turn,
  );
  return { ...state, turns };
}

function applyToTurn(turn: TurnState, event: UiAgentEvent): TurnState {
  switch (event.type) {
    case 'assistant.delta':
      return {
        ...turn,
        answer: turn.answer + (event.text ?? ''),
        deltaCount: turn.deltaCount + 1,
      };
    case 'assistant.message':
      // The adapter emits this once at the end with the same text the deltas
      // carried. Replacing rather than appending keeps the transcript honest.
      return { ...turn, answer: event.text ?? turn.answer };
    case 'tool.started':
      return {
        ...turn,
        toolsStarted: turn.toolsStarted + 1,
        lastTool: event.toolName ?? turn.lastTool,
        toolNames: addToolName(turn.toolNames, event.toolName),
      };
    case 'tool.finished':
      return {
        ...turn,
        toolsFinished: turn.toolsFinished + 1,
        lastTool: event.toolName ?? turn.lastTool,
        toolNames: addToolName(turn.toolNames, event.toolName),
      };
    case 'approval.requested':
      return {
        ...turn,
        status: 'awaiting-approval',
        approvalSummary: event.approvalSummary ?? null,
      };
    case 'run.finished':
      return {
        ...turn,
        status:
          event.status === 'finished'
            ? 'finished'
            : event.status === 'cancelled'
              ? 'cancelled'
              : 'error',
        errorMessage: event.errorMessage ?? null,
        finishedAtUtc: event.at,
      };
    default:
      return turn;
  }
}

function addToolName(
  names: readonly string[],
  name: string | undefined,
): readonly string[] {
  if (name === undefined || names.includes(name)) {
    return names;
  }
  return [...names, name];
}

/** Record that Cancel was pressed. The run has not ended because we asked. */
export function markCancelRequested(state: ChatState): ChatState {
  return {
    ...state,
    turns: state.turns.map((turn) =>
      turn.dspatchRunId === state.currentRunId && turn.status === 'streaming'
        ? { ...turn, cancelRequested: true }
        : turn,
    ),
  };
}

/**
 * Attach a usage reading to a turn.
 *
 * This is a pull, not a pushed event: the renderer asks for it after the run
 * reported an end. A superseded turn may therefore still receive one, because
 * nothing about it can be mistaken for the current answer.
 */
export function attachUsage(
  state: ChatState,
  dspatchRunId: string,
  usage: TurnUsage,
): ChatState {
  return {
    ...state,
    turns: state.turns.map((turn) =>
      turn.dspatchRunId === dspatchRunId ? { ...turn, usage } : turn,
    ),
  };
}

/** The turn events are currently being applied to, if any. */
export function currentTurn(state: ChatState): TurnState | null {
  return (
    state.turns.find((turn) => turn.dspatchRunId === state.currentRunId) ?? null
  );
}

/** A turn that never reported an end and is no longer being listened to. */
export function unfinishedSupersededTurns(
  state: ChatState,
): readonly TurnState[] {
  return state.turns.filter(
    (turn) =>
      turn.superseded &&
      (turn.status === 'streaming' || turn.status === 'awaiting-approval'),
  );
}

export type ActivityKind =
  | 'no-session'
  | 'idle'
  | 'streaming'
  | 'tool'
  | 'awaiting-approval'
  | 'cancel-requested';

export interface Activity {
  readonly kind: ActivityKind;
  readonly text: string;
  /** Something may still be running that DSpatch is no longer applying. */
  readonly unresolvedRuns: number;
}

/**
 * What the agent is doing right now, in one line.
 *
 * "Waiting" has to read as waiting, and an unresolved earlier run has to stay
 * visible even while the window is otherwise idle.
 */
export function describeActivity(state: ChatState): Activity {
  const unresolvedRuns = unfinishedSupersededTurns(state).length;
  if (state.dspatchSessionId === null) {
    return {
      kind: 'no-session',
      text: 'No project open, so nothing is running.',
      unresolvedRuns,
    };
  }
  const turn = currentTurn(state);
  if (turn === null) {
    return { kind: 'idle', text: 'Waiting for your message.', unresolvedRuns };
  }
  if (turn.status === 'awaiting-approval') {
    return {
      kind: 'awaiting-approval',
      text: 'Waiting for an approval DSpatch cannot answer yet.',
      unresolvedRuns,
    };
  }
  if (turn.status !== 'streaming') {
    return { kind: 'idle', text: 'Waiting for your message.', unresolvedRuns };
  }
  if (turn.cancelRequested) {
    return {
      kind: 'cancel-requested',
      text:
        'Cancellation requested. The run has not reported an end, so work may ' +
        'still be going.',
      unresolvedRuns,
    };
  }
  if (turn.toolsStarted > turn.toolsFinished) {
    const name = turn.lastTool ?? 'unnamed tool';
    return {
      kind: 'tool',
      text: `Running a tool (${name}). ${String(turn.toolsFinished)} of ${String(
        turn.toolsStarted,
      )} tool calls have finished.`,
      unresolvedRuns,
    };
  }
  return {
    kind: 'streaming',
    text:
      turn.deltaCount === 0
        ? 'Sent. Waiting for the first text from the model.'
        : `Streaming the answer (${String(turn.deltaCount)} fragments so far).`,
    unresolvedRuns,
  };
}

/**
 * What DSpatch itself put in front of the model, and what it did not.
 *
 * AC#3 is explicit that choosing a folder must not imply that any file was read.
 * So this counts what was sent rather than what exists on disk: the prompts, and
 * the fact that no file contents were sent by DSpatch at all. Files the agent
 * read are its own tool calls, and the only thing the event stream exposes about
 * those is the tool name — never the arguments — so that is all this claims.
 */
export interface ContextSummary {
  readonly promptsSent: number;
  readonly promptCharactersSent: number;
  readonly fileContentsSentByDspatch: number;
  readonly toolCallsByAgent: number;
  readonly toolNames: readonly string[];
}

export function summariseContext(state: ChatState): ContextSummary {
  let promptCharactersSent = 0;
  let toolCallsByAgent = 0;
  const toolNames: string[] = [];
  for (const turn of state.turns) {
    promptCharactersSent += turn.prompt.length;
    toolCallsByAgent += turn.toolsStarted;
    for (const name of turn.toolNames) {
      if (!toolNames.includes(name)) {
        toolNames.push(name);
      }
    }
  }
  return {
    promptsSent: state.turns.length,
    promptCharactersSent,
    fileContentsSentByDspatch: 0,
    toolCallsByAgent,
    toolNames,
  };
}
