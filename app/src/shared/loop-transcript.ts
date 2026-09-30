/**
 * A loop run as it appears in the conversation.
 *
 * Niclas asked for one thing on 16 September: *"Loopkörningen ska synas i
 * samtalet."* The run must be visible in the conversation — his mandate as his own
 * message, the entry agent's reply as the answer to it. Before this module the
 * loop branch of `send()` cleared the composer and appended nothing, and the
 * agent's own account of what it had done to the project was collected by
 * `waitForTurn` and used only to classify the step.
 *
 * Three decisions are worth stating here rather than leaving to be re-derived:
 *
 * **A loop turn is not a chat turn.** These entries live beside `ChatState.turns`
 * instead of inside it. A loop run produces no `run.started` and no provider run
 * the window is subscribed to, so folding it into `ChatState` would either mean
 * synthesising events the adapter never emitted or teaching every predicate that
 * reads a turn — the send gate, Cancel's enablement, the unresolved-turn
 * reconciliation — about a second kind of turn. The `loopBusy` / `sendGeneration`
 * state machine settled over three calls of the previous run is left exactly as
 * it was, and it decides nothing here.
 *
 * **Nothing is ever shown without an account of how it ended.** An echoed mandate
 * with no answer and no explanation would be worse than the silence it replaces,
 * so {@link loopTurnStatusText} returns a sentence for every state a run can be
 * in, including refusal, fault, spent bound, cancellation and an empty reply. The
 * test for that is the one that matters: it asserts the sentence, not the flags.
 *
 * **Text is passed through whole.** A reply is shown as the agent wrote it and a
 * reconciliation instruction is shown as the runner wrote it. Same reason as the
 * live log's: a summarised instruction for reconciling a run is worse than none.
 */

import type { CapabilitySupport } from '../adapter/types';
import type { ChatLoopRunOutcome } from './bridge';
import type { TrailBranch } from './chat-workspace';
import {
  finishStep,
  foldStepActivity,
  type StepActivity,
  type StepActivityState,
} from './loop-activity';
import { endingWithoutDetail } from './loop-chat';
import { type LoopInstruction } from './loop-instruction';
import {
  briefRunOutcome,
  parseRunRecord,
  RUN_OUTCOME_BADGE_TEXT,
  type ParsedRunRecord,
  type RecordedEndingKind,
  type RunOutcomeKind,
} from './loop-record';
import type { RunJournalEntry, RunResult, RunStatus } from './loop-run';

/** One agent node's own words during a loop run. */
export interface LoopAgentReply {
  readonly nodeId: string;
  /** The node's label from the graph, so a reader can see who is speaking. */
  readonly nodeLabel: string;
  /** Exactly what the executor collected. Never trimmed for length. */
  readonly text: string;
  /**
   * Which visit to this node produced it, as the **runner** counted it.
   *
   * DSP-94. Carried rather than recomputed, and that is the whole reason it is here:
   * `handoffTrail` numbers the replies it is given, so a node whose first visit
   * answered with nothing — a silent step, which never reaches the reply list — comes
   * out of it as visit 1 on its second turn. For a caption that is a small
   * imprecision; for binding a saved prompt to the call it was sent on it is the
   * difference between the right message and a plausible wrong one, so the two counts
   * are kept apart and this one is the run's.
   *
   * Optional: a turn written before this field means what it meant, and absent is
   * *not recorded*.
   */
  readonly occurrence?: number;
  /**
   * The whole message this step was sent, as the run record keeps it.
   *
   * DSP-92's F5, closed here: the data existed on `RecordedAgentReply.prompt` from the
   * first per-step session and nothing a person could open ever read it. It is passed
   * through whole for the same reason `text` is — a summarised brief is not the brief
   * — and it is shown on request rather than standing open, because it is thousands of
   * characters of role text.
   *
   * Absent means *not recorded*, never *nothing was sent*: a record written before the
   * field, or a caller that does not know the prompt, must not be shown as a call with
   * an empty message.
   */
  readonly prompt?: string;
}

export type LoopEndingKind =
  | 'completed'
  | 'limit-reached'
  | 'runtime-fault'
  | 'awaiting-human'
  | 'refused'
  | 'failed'
  | 'cancelled'
  /**
   * Read back from a record that has a header and no ending line.
   *
   * Its own kind rather than one of the six above, because none of them is true of
   * it: the run did not complete, was not refused, did not fault and was not
   * cancelled — DSpatch simply stopped before the run did, and what happened after
   * the last recorded line is not known to anybody. DSP-25 #4 asks for exactly this
   * to be shown as itself.
   */
  | 'interrupted';

export interface LoopEnding {
  readonly kind: LoopEndingKind;
  /** Why the run ended, in the runner's own words where it has them. Never empty. */
  readonly text: string;
  /**
   * A circumstance the person has to do something about, in a sentence or two, or
   * `null` when the ending has none.
   *
   * Separate from {@link text} because it is the one part of an ending that outlives
   * the suppression of the rest (DSP-90). At a stop someone asked for and got, the
   * column says nothing but the badge — and *the record could not be written* has to
   * survive that, because it is a fact about their project rather than an account of
   * a run they already know the fate of. Niclas named a file that could not be saved
   * as the case that must still speak.
   *
   * Only for things with an action in them. Not a place to keep a paragraph that this
   * card removed by rerouting it.
   */
  readonly actionNote: string | null;
  /**
   * The same ending in one short factual line, or `null` when {@link text} is already
   * the shortest honest thing to say.
   *
   * The pair is what lets the conversation show an ending without showing a technical
   * paragraph: this in the column, `text` behind a disclosure at the run it belongs
   * to. `null` is a real answer and not a gap — a run that was stopped, is waiting for
   * a person, or was interrupted has one specific thing to say and its own sentence
   * says it, so the caller keeps that sentence in view. Those are also precisely the
   * endings a person may still have to act on.
   *
   * Never a truncation of `text`. It is built from the recorded outcome and terminal,
   * so it cannot contradict the long version by having been cut in the wrong place.
   */
  readonly shortText: string | null;
  /**
   * The terminal the run stopped at, when it reached one; `null` otherwise.
   *
   * Carried so the badge can name it instead of the run's status word. `completed`
   * is the runner's word for "a terminal was reached", and the chat graph has four
   * terminals — `done`, `not-met`, `not-established` and `stopped` — so the status
   * word says nothing about which.
   */
  readonly terminalNodeId: string | null;
  /**
   * That terminal's label from the drawing, or `null` when there is none to read.
   *
   * The id is what the runner carries; the label is what the drawing shows and what
   * a person can read. `stopped`, `not-met` and `not-established` are three
   * identifiers, while *Stopped without doing the work*, *Assignment not met* and
   * *Could not establish* are three sentences, and the badge is the one part of the
   * card that is read before anything else. The ending's own sentence has named the
   * terminal by its label since DSP-51 and the badge beside it could not, because
   * only the id reached this far — so the label is carried here rather than looked up
   * again from a journal the badge does not have.
   *
   * Falls back to the id wherever a journal is absent or predates the field, which is
   * what the sentence does for the same reason: an id is worse than a label and much
   * better than silence.
   */
  readonly terminalLabel: string | null;
  /**
   * Which of the five things "did it work" can mean this run reached, as it was
   * **recorded**, or `null` when no record was written.
   *
   * Not computed here. The main process writes the outcome into the run record and
   * hands the same value back with the run, so the chat column, the saved history
   * and anything later that reads the record are all reporting one decision made
   * once. That is DSP-26 #1: a second derivation of the same question is a second
   * state model, and two of those are what drew a green badge over a failed run.
   */
  readonly outcome: RunOutcomeKind | null;
}

/**
 * A step that finished its provider turn and said nothing at all.
 *
 * DSP-57 #1, and the reason it needs a field of its own rather than an empty
 * reply in the list above. An empty reply is not shown as an empty answer — the
 * rule below `agent-replied` explains why, and it is still right — but until now
 * it was *dropped*, which made "the agent replied with nothing" and "DSpatch lost
 * the reply" identical on screen, and left a run that reached a terminal after a
 * silent step reading as an ordinary one.
 *
 * So the emptiness is kept as a fact about the step rather than as a blank answer
 * attributed to an agent. Nothing invents words for it: {@link loopTurnStatusText}
 * says a step produced none, and the ending still speaks for the run.
 */
export interface LoopSilentStep {
  readonly nodeId: string;
  readonly nodeLabel: string;
  /** 1 for the first time this node ran in this run, 2 for the second, and so on. */
  readonly occurrence: number;
}

/** One loop run in the transcript: the mandate, what came back, and how it ended. */
export interface LoopTurn {
  /** The run id the window generated for this send. Correlates every event. */
  readonly runId: string;
  /** The composer's text, as the user typed it. */
  readonly mandate: string;
  readonly sentAtUtc: string;
  readonly replies: readonly LoopAgentReply[];
  /**
   * What each step was observed doing while it worked.
   *
   * The same fold the graph view uses, over the same events, so one run cannot be
   * described two ways in two windows. Optional, because every `LoopTurn` written
   * before this field existed still means exactly what it meant: absent is a run
   * nobody watched step by step, not a run in which nothing happened.
   *
   * **This is a live view and not a second history.** The run record already keeps
   * each reply with the whole prompt it answered, and a completed step's streamed
   * text is the same text as its reply — which is why the window shows the streamed
   * text *in the reply's place* and the reply replaces it, rather than showing both.
   */
  readonly steps?: readonly StepActivityState[];
  /**
   * Steps that answered with nothing, in the order they happened.
   *
   * Optional so that every `LoopTurn` written before this field existed still
   * type-checks and reads identically: absent and empty mean the same thing, which
   * is that no step was observed to go silent.
   */
  readonly silentSteps?: readonly LoopSilentStep[];
  /**
   * The branches the run took, for the handover sentences in the thread.
   *
   * Read off the runner's own `edge-taken` journal entries. Optional for the same
   * reason as above: a turn without them produces the handover sentences it
   * produced before, naming the roles and not the reason.
   */
  readonly branches?: readonly TrailBranch[];
  /** A stop was asked for. Nothing here claims the provider stopped. */
  readonly cancelRequested: boolean;
  /** The window gave up waiting for this run's own result. */
  readonly abandoned: boolean;
  /** `null` while the run has not reported an end. */
  readonly ending: LoopEnding | null;
  /**
   * Which loop this run walked, for the caption above the mandate.
   *
   * Carried on the turn because the alternative was a constant, and the constant was
   * wrong: every loop turn used to be captioned `dspatch-chat-loop` whatever had been
   * chosen, so a person who picked a project's own loop by name was told in the
   * transcript that something else had run. That is the card's whole point undone at
   * the last inch.
   *
   * `name` is the definition's name as the person read it in the list — their own
   * vocabulary, which is what a caption should echo. `id` names what ran when there is
   * no name: the definition's id live, and the **graph's** id for a turn read back
   * from a record, because a record carries the graph it walked and not the
   * declaration that named it. Either way it names the thing that ran.
   *
   * Optional, because a turn written before this field existed still means what it
   * meant. {@link loopTurnCaption} decides what absence reads as, rather than each
   * caller guessing.
   */
  readonly loop?: {
    readonly name: string | null;
    readonly id: string | null;
  };
  /**
   * `'record'` when this entry was read back from disk rather than watched happen.
   *
   * Carried so the window can say so. A run restored after a restart is history and
   * not something in flight, and a reader who cannot tell the two apart might wait
   * for an answer that arrived yesterday.
   */
  readonly restoredFrom?: 'record';
}

export type LoopTurnEvent =
  /** Send was pressed. The mandate is echoed here, not when the run ends. */
  | {
      readonly kind: 'mandate-sent';
      readonly runId: string;
      readonly mandate: string;
      readonly atUtc: string;
      /** The definition this send chose, so the caption names what ran. */
      readonly loop?: { readonly name: string | null; readonly id: string | null };
    }
  /** An agent node finished a provider turn. Its text may be empty; see the reducer. */
  | { readonly kind: 'agent-replied'; readonly runId: string; readonly reply: LoopAgentReply }
  /**
   * Something the provider reported while a step was working.
   *
   * `waitForTurn` used to drop every one of these, which is why a loop run was an
   * opaque call. They arrive *during* a step, so they land here rather than waiting
   * for `agent-replied`, which is the whole point.
   */
  | { readonly kind: 'step-activity'; readonly runId: string; readonly activity: StepActivity }
  /**
   * A step's turn is over, so it stops reporting that it is waiting for anything.
   *
   * Separate from `agent-replied` and carrying the executor's own occurrence rather
   * than a count recomputed here: an empty reply becomes a silent step and never
   * reaches the reply list, and a step that went quiet must still stop being live.
   */
  | {
      readonly kind: 'step-finished';
      readonly runId: string;
      readonly nodeId: string;
      readonly occurrence: number;
    }
  /**
   * The run took a branch, so the thread can say why control moved.
   *
   * From the runner's `edge-taken` journal entry and nothing else. The window
   * already receives every journal entry; this is the one kind the conversation
   * needs, rather than the whole journal being folded into the transcript.
   */
  | {
      readonly kind: 'branch-taken';
      readonly runId: string;
      readonly branch: TrailBranch;
    }
  /** Cancel, Stop waiting, or Use loop switched off. */
  | {
      readonly kind: 'stop-requested';
      readonly runId: string;
      /** True for Stop waiting, which stops waiting for the result as well. */
      readonly abandonsWait: boolean;
    }
  /** The `startChatLoopRun` call came back. */
  | { readonly kind: 'run-settled'; readonly runId: string; readonly outcome: ChatLoopRunOutcome }
  /** The call itself failed, so there is no outcome to read. */
  | { readonly kind: 'send-threw'; readonly runId: string; readonly message: string }
  /**
   * The live conversation this column shows was replaced.
   *
   * A different project was opened, a new provider session was started, or a saved
   * conversation was read back — in every one of those the window empties
   * `ChatState.turns`, and these entries are the other half of the same column.
   */
  | { readonly kind: 'conversation-replaced' }
  /**
   * Runs read back from disk for the conversation now on screen.
   *
   * Additive and never destructive: a run already in the column — the one being
   * watched right now — keeps the live entry rather than being replaced by the
   * record of itself, because the live one is at least as complete and the record
   * of a run still in flight has no ending line yet.
   */
  | { readonly kind: 'records-restored'; readonly turns: readonly LoopTurn[] };

/**
 * Fold one event into the loop turns.
 *
 * Keyed by run id throughout, and deliberately **not** guarded by the send
 * generation. A run whose wait the user abandoned still ends, and its ending
 * belongs on the entry that echoed its mandate; dropping it because the window
 * had stopped waiting would leave a mandate on screen with no account of it,
 * which is the state this module exists to prevent.
 */
export function loopTurnsAfter(
  turns: readonly LoopTurn[],
  event: LoopTurnEvent,
): readonly LoopTurn[] {
  if (event.kind === 'conversation-replaced') {
    // A loop entry is scoped to the conversation it was sent in, exactly as an
    // ordinary turn is. Keeping it across a replacement would put one project's
    // mandate — and an agent's account of what it did to that project's files —
    // in another project's column with nothing saying it belongs elsewhere.
    return [];
  }
  if (event.kind === 'records-restored') {
    const known = new Set(turns.map((turn) => turn.runId));
    const restored = event.turns.filter((turn) => !known.has(turn.runId));
    return restored.length === 0 ? turns : [...turns, ...restored];
  }
  if (event.kind === 'mandate-sent') {
    if (turns.some((turn) => turn.runId === event.runId)) {
      // Run ids come from the clock, so this is a fault rather than a second send.
      // Keeping the first entry is the honest half of that.
      return turns;
    }
    return [
      ...turns,
      {
        runId: event.runId,
        mandate: event.mandate,
        sentAtUtc: event.atUtc,
        replies: [],
        cancelRequested: false,
        abandoned: false,
        ending: null,
        ...(event.loop === undefined ? {} : { loop: event.loop }),
      },
    ];
  }

  const index = turns.findIndex((turn) => turn.runId === event.runId);
  if (index === -1) {
    return turns;
  }
  const turn = turns[index]!;
  const replaced = (next: LoopTurn): readonly LoopTurn[] =>
    turns.map((existing, at) => (at === index ? next : existing));

  switch (event.kind) {
    case 'agent-replied': {
      // An empty reply is still not shown as an empty answer. `waitForTurn` collects
      // `assistant.message` only, so a turn that was cancelled before the model
      // finished can carry no text at all, and a blank block attributed to an agent
      // would be DSpatch putting silence in its mouth.
      //
      // It is no longer *dropped*, which is the DSP-57 #1 correction. Dropping made
      // three different things look identical on screen — the agent said nothing,
      // DSpatch lost the reply, and the step never ran — and the first of those is a
      // fact the run knows and the reader needs. It is kept as a silent step, and
      // `loopTurnStatusText` says so in words rather than showing an empty box.
      if (event.reply.text.trim() === '') {
        return replaced({
          ...turn,
          silentSteps: [
            ...(turn.silentSteps ?? []),
            {
              nodeId: event.reply.nodeId,
              nodeLabel: event.reply.nodeLabel,
              // Which time round this node spoke, counting both the turns it
              // answered and the ones it did not — the same count `handoffTrail`
              // puts on a reply, so a reader comparing the two is comparing like
              // with like.
              occurrence: occurrenceOf(event.reply.nodeId, turn),
            },
          ],
        });
      }
      return replaced({ ...turn, replies: [...turn.replies, event.reply] });
    }
    case 'branch-taken': {
      const already = turn.branches ?? [];
      return replaced({ ...turn, branches: [...already, event.branch] });
    }
    case 'step-activity': {
      const steps = foldStepActivity(turn.steps ?? [], event.activity);
      // The same array back when the fold changed nothing, so an event about a step
      // this turn never saw open costs no render.
      return steps === turn.steps ? turns : replaced({ ...turn, steps });
    }
    case 'step-finished': {
      const steps = finishStep(turn.steps ?? [], {
        runId: event.runId,
        nodeId: event.nodeId,
        occurrence: event.occurrence,
      });
      return steps === turn.steps ? turns : replaced({ ...turn, steps });
    }
    case 'stop-requested': {
      if (turn.ending !== null) {
        return turns;
      }
      return replaced({
        ...turn,
        cancelRequested: true,
        abandoned: turn.abandoned || event.abandonsWait,
      });
    }
    case 'run-settled': {
      if (turn.ending !== null) {
        return turns;
      }
      return replaced({ ...turn, ending: describeLoopEnding(event.outcome, turn) });
    }
    case 'send-threw': {
      if (turn.ending !== null) {
        return turns;
      }
      const said = event.message.trim();
      return replaced({
        ...turn,
        ending: {
          kind: 'failed',
          terminalNodeId: null,
          terminalLabel: null,
          shortText: null,
          // The throw is the circumstance and the sentence below states it, so there
          // is nothing to add in a second line.
          actionNote: null,
          // No record came back, so there is nothing recorded to report. `null`
          // rather than a guessed `unresolved`: the sentence already says the
          // outcome is unknown, and inventing a recorded value the record does not
          // contain is the contradiction this field exists to prevent.
          outcome: null,
          text:
            `DSpatch could not read the result of this loop run: ${
              said === '' ? 'the call failed and reported no message.' : said
            } Treat the outcome as unknown and check the project before anything is ` +
            `repeated: the run may have changed files before the call failed.`,
        },
      });
    }
  }
}

/**
 * How a finished, refused, failed or cancelled run reads in the conversation.
 *
 * Every branch produces a sentence. Where the runner recorded a reason it is
 * passed through whole — `RuntimeFault.detail` plus `reconcile` is written for
 * whoever has to reconcile the run — and where it recorded none, the fallbacks
 * from the live log are reused rather than reworded, so the window says the same
 * thing about the same ending in both places.
 */
export function describeLoopEnding(
  outcome: ChatLoopRunOutcome,
  context: { readonly cancelRequested: boolean; readonly abandoned: boolean },
): LoopEnding {
  const lead = context.abandoned
    ? 'You stopped waiting for this run. '
    : context.cancelRequested
      ? 'You asked this run to stop. '
      : '';
  switch (outcome.kind) {
    case 'refused': {
      const reason = outcome.reason.trim();
      return {
        kind: 'refused',
        terminalNodeId: null,
        terminalLabel: null,
        // Nothing started, so nothing was recorded and there is no recorded outcome
        // to report. Not `verification-not-performed`: that is a state a run
        // reached, and this run never happened.
        outcome: null,
        // No shorter honest line exists: why a loop refused to start is the whole of
        // what happened, and it is already one sentence.
        shortText: null,
        // The refusal *is* the circumstance, and it is already the whole sentence in
        // the column. Repeating it here would put it on screen twice.
        actionNote: null,
        text:
          reason === ''
            ? `${lead}The loop did not start and gave no reason. Nothing was run and no file was changed.`
            : `${lead}The loop did not start: ${reason}`,
      };
    }
    case 'failed': {
      const note = outcome.note.trim();
      return {
        kind: 'failed',
        terminalNodeId: null,
        terminalLabel: null,
        outcome: null,
        shortText: null,
        actionNote: null,
        text:
          note === ''
            ? `${lead}The loop could not be run and gave no reason. Treat the outcome as ` +
              `unknown and check the project before anything is repeated.`
            : `${lead}The loop could not be run: ${note}`,
      };
    }
    case 'cancelled':
      return {
        kind: 'cancelled',
        // Deliberately not the result's terminal, even when the aborted walk had
        // already reached one. What the reader needs first from a cancelled run is
        // that it was cut short; the sentence beside the badge says the rest.
        terminalNodeId: null,
        terminalLabel: null,
        outcome: outcome.recorded?.ending.outcome ?? null,
        // Still no short line. Not because a cancelled run needs the long one — at a
        // stop the person asked for, `loopTurnEndingLine` shows neither — but because
        // a stop nobody here asked for has only this sentence to explain itself with.
        shortText: null,
        actionNote: recordFault(outcome),
        text: withRecordedOutcome(
          outcome,
          `${lead === '' ? 'This run was stopped before it finished. ' : lead}` +
            `Completed steps were not replayed and files were left as they are. ` +
            `${describeRunResult(outcome.result, measuredFileChanges(outcome))}`,
        ),
      };
    case 'finished': {
      // Only `completed` means a terminal was reached. The runner leaves
      // `terminalNodeId` null on every other status, and the badge must not borrow
      // one if that ever stops being true: `reached "Assignment met"` over a faulted
      // run would be the same class of claim this change removes.
      const terminalNodeId =
        outcome.result.status === 'completed' ? outcome.result.terminalNodeId : null;
      const recordedOutcome = outcome.recorded?.ending.outcome ?? null;
      return {
        kind: endingKindOf(outcome.result.status),
        terminalNodeId,
        terminalLabel: terminalNameFor(terminalNodeId, outcome.result.journal),
        outcome: recordedOutcome,
        // Only a run that ended of its own accord gets a short line. `lead` is
        // non-empty exactly when the person asked it to stop or stopped waiting, and
        // both are states they may have to act on, so those keep the full sentence in
        // view rather than being summarised away.
        shortText:
          lead === '' && recordedOutcome !== null
            ? briefRunOutcome(recordedOutcome, terminalNodeId)
            : null,
        actionNote: recordFault(outcome),
        text: withRecordedOutcome(
          outcome,
          `${lead}${describeRunResult(outcome.result, measuredFileChanges(outcome))}`,
        ),
      };
    }
  }
}

/**
 * Whether the run's own measurement found anything in the project to look at.
 *
 * `null` when there is no record to ask, which is not the same as none: a run
 * whose record could not be written is a run DSpatch cannot say this about, and
 * the sentence below keeps its old wording rather than asserting either way.
 */
function measuredFileChanges(
  outcome: Extract<ChatLoopRunOutcome, { readonly kind: 'finished' | 'cancelled' }>,
): boolean | null {
  const snapshots = outcome.recorded?.ending.snapshots;
  if (snapshots === undefined) {
    return null;
  }
  return (
    snapshots.changed.length > 0 || snapshots.added.length > 0 || snapshots.removed.length > 0
  );
}

/**
 * The terminal's own label, from the entry the runner wrote when it reached it.
 *
 * Read off the journal rather than off `RunResult`, which carries node ids and no
 * labels — and off the entry's `data` rather than its prose, because parsing a
 * sentence DSpatch wrote to recover a fact DSpatch had is how the two drift apart.
 * Falls back to the id, which is what this said before and is still better than
 * nothing when a journal is absent or predates the field.
 *
 * Takes the id and the journal rather than a `RunResult`, so a run read back from
 * disk can be named by the same rule. `ParsedRunRecord` keeps the runner's journal
 * entries unchanged and no label of its own, which means a restored run's label is
 * recoverable without adding a field to the record format — and so without every
 * record already on disk reading as one written before the label existed.
 */
function terminalNameFor(
  terminalNodeId: string | null,
  journal: readonly RunJournalEntry[],
): string | null {
  if (terminalNodeId === null) {
    return null;
  }
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    if (entry?.kind === 'node-entered' && entry.nodeId === terminalNodeId) {
      const label = entry.data?.['label'];
      return typeof label === 'string' && label.trim() !== '' ? label : terminalNodeId;
    }
  }
  return terminalNodeId;
}

/**
 * The recorded outcome first, then the runner's account of the walk.
 *
 * In that order deliberately. "Your command passed" and "your command failed" are
 * what the person came for; which terminal a drawing arrived at is context for it.
 * The first real run put those the other way round, and the walk's word is what
 * Niclas read first.
 */
function withRecordedOutcome(
  outcome: Extract<ChatLoopRunOutcome, { readonly kind: 'finished' | 'cancelled' }>,
  account: string,
): string {
  const recorded = outcome.recorded;
  if (recorded === undefined) {
    return account;
  }
  return `${recorded.ending.outcomeText} ${account}`;
}

/**
 * The one thing about an ending that a person may have to act on, or `null`.
 *
 * A record that could not be written is the case Niclas named, and it is the reason
 * this is a field of its own rather than a clause of the account: it is true of his
 * project and not of the run, so it has to keep speaking at an ending whose account
 * this card silences.
 *
 * It says what is wrong and what that means for him. There is no instruction to give
 * — nothing he can press will write a record after the fact — so it stops at the
 * consequence rather than inventing an action, which is the same discipline as the
 * pending-message line: state the limit, do not promise a remedy.
 */
function recordFault(
  outcome: Extract<ChatLoopRunOutcome, { readonly kind: 'finished' | 'cancelled' }>,
): string | null {
  const note = outcome.recorded?.recordNote ?? null;
  return note === null
    ? null
    : `This run was not fully kept on disk: ${note} What is on screen is all there ` +
      `will be after a restart.`;
}

function endingKindOf(status: RunStatus): LoopEndingKind {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'limit-reached':
      return 'limit-reached';
    case 'runtime-fault':
      return 'runtime-fault';
    case 'awaiting-human':
      return 'awaiting-human';
    case 'refused':
      return 'refused';
  }
}

/**
 * What a run's own result says happened, in one or two sentences.
 *
 * `measuredFileChanges` is the run's own comparison of the project before and
 * after, or `null` when there is no record to ask. The generic tail used to send
 * every completed run to the workspace view for its file changes, including the
 * read-only run that ends at *Nothing changed — the answer is the answer* having
 * measured none. Pointing at changes that do not exist on the one mandate a person
 * is most likely to try first is worse than saying nothing about them.
 */
function describeRunResult(result: RunResult, measuredFileChanges: boolean | null): string {
  switch (result.status) {
    case 'completed': {
      const terminal = terminalNameFor(result.terminalNodeId, result.journal);
      return (
        `The loop ran to a terminal step and stopped` +
        `${terminal === null ? '' : ` at "${terminal}"`}. ` +
        `Reaching a terminal is not a verdict on the work: the loop log below shows ` +
        `which branch it took` +
        `${measuredFileChanges === false ? '' : ', and the file changes are in the workspace view'}.`
      );
    }
    case 'runtime-fault': {
      const fault = result.fault;
      if (fault === null) {
        return endingWithoutDetail('runtime-fault');
      }
      return `${fault.detail} ${fault.reconcile}`;
    }
    case 'limit-reached':
      return result.limitsReached.length === 0
        ? endingWithoutDetail('limit-reached')
        : `The run spent a bound and stopped: ${result.limitsReached.join(', ')}. Nothing ` +
          `was repeated, and files were left as they are.`;
    case 'awaiting-human': {
      const question = result.awaiting?.question.trim() ?? '';
      return question === ''
        ? endingWithoutDetail('awaiting-human')
        : `The run is waiting for a person: ${question} Nothing was repeated. Resuming ` +
          `from here is not built yet, so a repeat starts a new run.`;
    }
    case 'refused': {
      const refusal = result.refusal?.trim() ?? '';
      return refusal === ''
        ? `The runner refused to run the graph and recorded no reason. Nothing was run.`
        : `The runner refused to run the graph: ${refusal}`;
    }
  }
}

/**
 * The one sentence the entry always has, whatever state its run is in.
 *
 * This is the user-visible guarantee of this module and the assertion its tests
 * turn on: a mandate is never left on screen with nothing said about it.
 */
/**
 * What a run's ending says in the conversation by default.
 *
 * The short line when the ending has one, and the full account when it does not —
 * which is the same rule stated twice: a run that is still going, was stopped, is
 * waiting for a person or was interrupted is a run someone may have to do something
 * about, and none of those gets summarised. `hasMore` says whether anything was held
 * back, so the caller draws a disclosure only when there is something behind it.
 *
 * A silent step is appended to whichever of the two is shown. Which step produced no
 * text is not technical detail about a run; it is the thing that decides whether the
 * ending means anything, and DSP-57 put it in the column deliberately.
 */
/**
 * Whether this run stopped because the person asked it to, and said that it had.
 *
 * The distinction DSP-90 turns on, and it is a conjunction of two facts DSpatch
 * already holds rather than a new inference. `cancelRequested` is set by all three
 * stop paths in the window — Cancel, Stop waiting, and unticking `Use loop` — and by
 * nothing else, so it *is* "the person asked". An `ending` of kind `cancelled` is the
 * run reporting that it stopped, which is the only thing that may be read as an end:
 * the same separation the attempt ledger keeps between `cancel-requested` and
 * `stopped-confirmed`, and for the same measured reason — DSP-1 saw 69.5 s of remote
 * work continue after a severed connection, so asking is not stopping.
 *
 * Both halves are necessary. Without the ending it is a stop that may not have
 * happened, which is the case Niclas wants to keep hearing about. Without the request
 * it is a stop he did not ask for and cannot be assumed to know the cause of.
 *
 * `abandoned` is deliberately not consulted. It says the window gave up waiting, and
 * an `ending` that arrived anyway settles the very thing abandoning left open.
 */
export function stoppedAsAsked(turn: LoopTurn): boolean {
  return turn.cancelRequested && turn.ending?.kind === 'cancelled';
}

/**
 * What the column says about the ending, and whether anything was held back.
 *
 * **A stop the person asked for and got says nothing here** (DSP-90). Niclas stopped
 * a run himself and met *stopped short* followed by the recorded outcome, the rule
 * that completed steps are not replayed, a definition of what reaching a terminal
 * does and does not prove, and where to look for file changes. Every clause of that
 * is true, and none of it was news to the person who had just pressed the button: he
 * knows the run stopped, because he stopped it, and the badge confirms it. The
 * technical account is not lost — it is in the run journal under **View → Run
 * journal (diagnostics)**, which is where DSP-86 put the detail of a run.
 *
 * The silent-step clause goes with it. Which step produced no text is what decides
 * whether an *ending* means anything (DSP-57), and a step that was cut off mid-answer
 * by a person is explained by the stop they asked for.
 *
 * `actionNote` is the exception and is handled by the caller, through
 * `conversationStanding`: a record that could not be written still speaks.
 */
export function loopTurnEndingLine(turn: LoopTurn): {
  readonly text: string;
  readonly hasMore: boolean;
} {
  if (stoppedAsAsked(turn)) {
    return { text: '', hasMore: false };
  }
  const full = loopTurnStatusText(turn);
  const short = turn.ending?.shortText ?? null;
  if (short === null) {
    return { text: full, hasMore: false };
  }
  return { text: `${short}${describeSilentSteps(turn)}`, hasMore: true };
}

export function loopTurnStatusText(turn: LoopTurn): string {
  const silence = describeSilentSteps(turn);
  if (turn.ending !== null) {
    return `${turn.ending.text}${silence}`;
  }
  /*
   * A run that has not ended says only that it is running, whatever has been asked of
   * it (DSP-90).
   *
   * Two branches used to sit here. *You stopped waiting for this run. It has not
   * reported an end, so it may still be working in the project…* and *A stop was
   * requested. The run has not reported an end yet, so nothing here says the agent has
   * stopped.* Both are true, and both are now said one line further down by
   * `conversationStanding` — with an action attached, which is what this card asks for
   * and what neither of these had.
   *
   * The window walk is what found this. It photographed the unconfirmed stop and
   * caught both on screen at once: the caption saying nothing here claims the agent
   * stopped, and the note under it saying asking is not stopping. Two sentences for
   * one fact is the duplication this card exists to remove, so the one with the
   * action in it is the one that stays.
   */
  if (turn.abandoned || turn.cancelRequested) {
    return `The loop is running.${silence}`;
  }
  /*
   * A running run says it is running, and nothing about silence (DSP-87).
   *
   * The second sentence used to be *Nothing has come back from the agent yet*, decided
   * by `replies` being empty — and `replies` holds **finished** replies. A step that had
   * been streaming for four minutes, with its text drawn directly above this line, was
   * captioned underneath as having produced nothing. The window walk found this one
   * still on screen 958 ms into a stream, over 37 characters of visible reply, after the
   * two louder copies of the same claim had been removed.
   *
   * The distinction the two branches drew is not lost: a finished reply is in the column
   * above, as itself, and what the working step is doing is the step's own status line.
   * Neither needed a sentence down here to announce it.
   */
  return `The loop is running.${silence}`;
}

/**
 * The clause that keeps a silent step from being invisible.
 *
 * DSP-57 #1. A step that completed its provider turn and produced no text is not
 * a failure, not a success and not nothing: it is a step that was asked something
 * and answered with silence, and a run that goes on to reach a terminal after one
 * reads exactly like a run where every step spoke. Naming the step is the whole
 * point — *report 006's lesson, named rather than counted* — because which step
 * went quiet is what tells a reader whether the run's ending means anything.
 *
 * Appended to whatever the run's own sentence says rather than replacing it. The
 * ending is still the ending; this says what it was reached over.
 */
function describeSilentSteps(turn: LoopTurn): string {
  const silent = turn.silentSteps ?? [];
  if (silent.length === 0) {
    return '';
  }
  const named = silent
    .map(
      (step) =>
        `“${step.nodeLabel}”${step.occurrence > 1 ? ` (${ordinal(step.occurrence)} turn)` : ''}`,
    )
    .join(', ');
  return (
    ` ${silent.length === 1 ? 'One step' : `${String(silent.length)} steps`} finished ` +
    `a provider turn and said nothing at all: ${named}. An empty reply is not an ` +
    `answer and is not a result — whatever this run ended as, it was not established ` +
    `by ${silent.length === 1 ? 'that step' : 'those steps'}.`
  );
}

/** Which time round this node has spoken in this turn, answered or not. */
function occurrenceOf(nodeId: string, turn: LoopTurn): number {
  const spoke = turn.replies.filter((reply) => reply.nodeId === nodeId).length;
  const silent = (turn.silentSteps ?? []).filter((step) => step.nodeId === nodeId).length;
  return spoke + silent + 1;
}

function ordinal(value: number): string {
  if (value === 2) {
    return 'second';
  }
  if (value === 3) {
    return 'third';
  }
  if (value === 4) {
    return 'fourth';
  }
  return `${String(value)}th`;
}

/** Whether this entry is still open, for the badge beside it. */
export function loopTurnIsRunning(turn: LoopTurn): boolean {
  return turn.ending === null;
}

/**
 * Which of the window's three badge tones an ending gets.
 *
 * `unknown` is a real answer here rather than a hedge, and the reason this table
 * exists: a run that stopped to ask a person a question and a run that spent its
 * bound both ended *without a verdict on the work*, and drawing them in the same
 * tone as a run that broke tells the reader something the sentence beside the
 * badge does not. The negative tone is kept for a run that broke, was refused, or
 * was stopped before it finished.
 *
 * **No ending earns the positive tone, and `completed` least of all.** On the
 * first real chat-loop run, a run that stopped at the *Failed or abandoned*
 * terminal was drawn green. `completed` is the runner's word for "a terminal was
 * reached" and nothing more; the chat graph now has four terminals — `done`,
 * `not-met`, `not-established` and `stopped` — and the format
 * still cannot say which of them means success, since all four are
 * `kind: "terminal"`, differing only in label and purpose. DSP-43 made the drawing
 * legible to a *reader* without making it legible to a *predicate*, which is the
 * distinction that matters here: a positive tone still cannot be earned
 * programmatically, and a tone that cannot be earned must not be given. Expressing
 * it belongs with DSP-21.
 *
 * Three values, no fourth: these are the same `supported` / `unsupported` /
 * `unknown` the capability, attempt, connection and test badges already use.
 */
const LOOP_ENDING_BADGE: Record<LoopEndingKind, CapabilitySupport> = {
  completed: 'unknown',
  // Not failures. Neither is a verdict either: what the run left in the project is
  // in its sentence, not in its colour.
  'awaiting-human': 'unknown',
  'limit-reached': 'unknown',
  // The machinery broke, the runner would not walk the graph, the call could not be
  // made, or the user stopped the run before it finished.
  'runtime-fault': 'unsupported',
  refused: 'unsupported',
  failed: 'unsupported',
  cancelled: 'unsupported',
  // DSpatch stopped before the run did and nobody knows what happened next. Not a
  // failure, and emphatically not a success.
  interrupted: 'unknown',
};

/**
 * The tone a **recorded** outcome earns, or `null` to let the ending's own tone stand.
 *
 * This is where the rule from the previous increment is revised, and the revision
 * should be argued rather than noticed. That rule was *no ending earns the positive
 * tone*, and its reason was sound: a green badge was being drawn for `completed`,
 * which is the runner's word for "a terminal was reached", and the graph format
 * cannot say which of `done` and `failed` means success — so the tone could only
 * ever have been a guess about a drawing.
 *
 * The tone is no longer read from the drawing. `work-verified` means a command the
 * **user** chose ran to the end and exited 0, which is evidence about their project
 * rather than a guess about a graph, and a tone that has been earned should be
 * given: with all five states drawn in the same two colours, "your command passed"
 * and "we never checked" look alike at a glance, which is the very confusion this
 * work exists to remove. DSP-26 #3 still holds, and holds structurally:
 * `runOutcomeFrom` has no path to `work-verified` that does not go through a
 * command that ran, so completing the walk cannot produce this on its own.
 *
 * The two states that say nothing about the work defer to the ending's own tone, so
 * a refusal stays negative and a spent bound stays neutral exactly as before.
 */
const RUN_OUTCOME_BADGE: Readonly<Record<RunOutcomeKind, CapabilitySupport | null>> = {
  'work-verified': 'supported',
  'tests-failed': 'unsupported',
  'command-could-not-start': 'unsupported',
  'verification-not-performed': null,
  unresolved: null,
};

/**
 * What the caption above a loop turn calls the loop that ran.
 *
 * The name the person chose from the list when the turn has one, because that is the
 * vocabulary they used. Otherwise an id — the definition's, or a record's graph id —
 * which is less friendly and still true. Only when a turn carries neither does this
 * say so, and it says *this conversation did not record which loop*, not the name of
 * a loop that might not have run: the constant this replaced captioned every turn
 * `dspatch-chat-loop`, and being unable to name the loop is a much smaller problem
 * than naming the wrong one.
 *
 * `asCode` is for the window: an id is a machine name and reads as one.
 */
export function loopTurnCaption(turn: LoopTurn): {
  readonly text: string;
  readonly asCode: boolean;
} {
  const name = turn.loop?.name ?? null;
  if (name !== null && name.trim() !== '') {
    return { text: name, asCode: false };
  }
  const id = turn.loop?.id ?? null;
  if (id !== null && id.trim() !== '') {
    return { text: id, asCode: true };
  }
  return { text: 'a loop this conversation did not record by name', asCode: false };
}

export function loopTurnBadge(turn: LoopTurn): CapabilitySupport {
  const ending = turn.ending;
  if (ending === null) {
    return 'unknown';
  }
  const recorded = ending.outcome === null ? null : RUN_OUTCOME_BADGE[ending.outcome];
  return recorded ?? LOOP_ENDING_BADGE[ending.kind];
}

/**
 * The words inside the badge for an ending that reached no terminal at all.
 *
 * The badge used to read `ended: completed`, which was drawn over a run whose
 * tests had failed. The status word is the runner's vocabulary and answers a
 * question nobody asked; the terminal is the part of the ending a reader can act
 * on, and it is already what the sentence beside the badge names. Where there is no
 * terminal there is nothing to name, so these short phrases say what happened
 * instead — none of them a status word, and none of them a verdict.
 */
const LOOP_ENDING_BADGE_TEXT: Record<LoopEndingKind, string> = {
  completed: 'ran to a terminal',
  'limit-reached': 'spent a bound',
  'runtime-fault': 'could not finish',
  'awaiting-human': 'waiting for a person',
  refused: 'did not start',
  failed: 'could not be run',
  cancelled: 'stopped short',
  interrupted: 'DSpatch stopped first',
};

export function loopTurnBadgeText(turn: LoopTurn): string {
  const ending = turn.ending;
  if (ending === null) {
    return 'running …';
  }
  // The recorded outcome wins the badge when it has words of its own, because a
  // command that ran and passed or failed is a stronger fact about the project than
  // the terminal a drawing arrived at. Only two outcomes have words for that reason;
  // `unresolved` and `verification-not-performed` fall through, so a cancelled run
  // still reads `stopped short` and a run DSpatch started no command in is named by
  // the ending it actually reached rather than by what DSpatch did not do.
  const said = ending.outcome === null ? null : RUN_OUTCOME_BADGE_TEXT[ending.outcome];
  if (said !== null) {
    return said;
  }
  if (ending.terminalNodeId === null) {
    return LOOP_ENDING_BADGE_TEXT[ending.kind];
  }
  // `reached`, not `stopped at`. The old phrasing was written when the only
  // terminal ids a reader saw were `done` and `failed`, and over the ending that
  // met its assignment it read as a failure — *stopped at "done"* describes a run
  // that gave up somewhere. `reached` states what the walk did and claims nothing
  // about the work, which is the same care the sentence beside it takes: the label
  // is the drawing's word for the ending, not DSpatch's verdict on it.
  return `reached “${ending.terminalLabel ?? ending.terminalNodeId}”`;
}

/* ------------------------------------------------------------------------- */
/* What the conversation answers at a glance                                  */
/* ------------------------------------------------------------------------- */

/**
 * The six states §9 asks a reader to be able to tell apart.
 *
 * `unknown` is the one that earns this type. Before it, a run the window had
 * stopped watching and a run that was working looked the same: a spinner. §9 says
 * a running animation must not be shown as proof of activity when activity is not
 * known, which is only enforceable if "we do not know" is a value something can
 * hold rather than an absence of one.
 *
 * `stop-requested` and `stopped` are separate for the same reason §4.5 separates
 * them: asking a provider to stop is not the provider having stopped, and DSpatch
 * has measured runs that kept working afterwards.
 */
export type RunStanding =
  | 'idle'
  | 'active'
  | 'waiting-for-you'
  | 'stop-requested'
  | 'stopped'
  | 'unknown';

/**
 * Where a run stands: the state the window branches on, and a note only when
 * something needs doing.
 *
 * It used to be §9's last paragraph as a value — who is working, on what, what are
 * they waiting for, what happens next — four sentences for every state. DSP-87
 * emptied them for a working run, on the argument that the states a person may have
 * to act on should keep them. Niclas has now met that argument at his own
 * cancellation and judged it wrong for the ordinary case: he pressed stop, the stop
 * was confirmed, and he was then told the project's internal vocabulary about it.
 *
 * So the four questions are no longer answered here in prose. Three of them are
 * answered by the window without a paragraph — who is working and on what by the
 * step and the reply above, what it is waiting for by the control beside it — and
 * `standing` still carries the state itself, which is what the six-way distinction
 * §9 asks for actually consists of. What is left in words is the fourth question,
 * and only when its answer is something to do.
 */
export interface ConversationStanding {
  readonly standing: RunStanding;
  /**
   * Whether an animation may be shown as evidence that work is happening.
   *
   * False for `unknown` and for everything that is not `active`. The window reads
   * this rather than deciding for itself, because "do not animate what you cannot
   * see" is a rule that decays the moment it lives in a component.
   */
  readonly activityIsKnown: boolean;
  /**
   * One or two sentences: what the concrete circumstance is, and what to do about it.
   * `null` whenever the state and the badge are the whole story.
   *
   * `null` is the common answer, including for the state Niclas complained about.
   * Anything that appears here has to earn it by being actionable — a stop that was
   * never confirmed, a run DSpatch lost sight of, a record that could not be written.
   * Not a summary of a state that is already marked.
   */
  readonly actionNote: string | null;
}

/**
 * `currentStepLabel` and `instructions` are gone from here, and their absence is the
 * point (DSP-90).
 *
 * Both existed to fill the four sentences. The step's label named the step a stop had
 * interrupted, and the messages counted the ones still waiting — and both facts are
 * already on screen in the place they belong: the step names itself while it works,
 * and a message carries its own state at the message, which is where DSP-87 put it
 * and where §6 says a question and its answer have to be readable together. Leaving
 * the inputs here with nothing reading them would be an invitation to grow the prose
 * back.
 */
export interface StandingInput {
  /** The newest loop run in the conversation, or `null` when there is none. */
  readonly turn: LoopTurn | null;
  /** Whether the window is still receiving this run's events. */
  readonly stillWatching: boolean;
}

/**
 * Which state the run is in, and whether anything about it needs doing.
 *
 * Read the branches as a claim about silence. Four of the six say nothing: no run,
 * a working run, a finished run and a stop that was asked for and confirmed. Two
 * speak, and both are the same kind of case — DSpatch does not know whether work is
 * still going on in the person's project, which is a fact about their machine that
 * they may have to check for themselves.
 *
 * What was here before was four sentences per state, and it was written to answer §9
 * in the column. DSP-87 removed them for a working run and argued that the other
 * states should keep them, because they are the states a person may have to act on.
 * The premise was right and the conclusion did not follow: *may have to act on* is
 * not the same as *has to act on*, and a confirmed stop someone asked for is the
 * clearest case of the difference. He pressed the button; the badge says it worked;
 * there is nothing to do.
 */
export function conversationStanding(input: StandingInput): ConversationStanding {
  const turn = input.turn;
  if (turn === null) {
    // Nothing has happened, so there is nothing to say about it. What to do next is
    // in the composer's own placeholder, which is where a person is already looking.
    return { standing: 'idle', activityIsKnown: true, actionNote: null };
  }
  if (turn.ending !== null) {
    /*
     * An ended run, including the stop Niclas complained about.
     *
     * Nothing of its own. Either the badge and the ending sentence above have already
     * said it, or — at a stop he asked for — the badge alone has, and `loopTurnEndingLine`
     * has withheld the rest. `actionNote` is the single exception, and it is a
     * circumstance rather than a description: a record that could not be written, or
     * one that could not be read back in full.
     */
    return {
      standing: 'stopped',
      activityIsKnown: true,
      actionNote: turn.ending.actionNote,
    };
  }
  if (!input.stillWatching) {
    return {
      standing: 'unknown',
      activityIsKnown: false,
      actionNote:
        'DSpatch stopped following this run and did not see it end, so an agent may still ' +
        'be working in your project. Check the project before starting work that repeats it.',
    };
  }
  if (turn.abandoned) {
    return {
      standing: 'unknown',
      activityIsKnown: false,
      actionNote:
        'You stopped waiting and this run has not reported an end, so it may still be ' +
        'working in your project. Whatever it reports will appear here if it arrives.',
    };
  }
  if (turn.cancelRequested) {
    /*
     * The case DSP-90 keeps, and the reason the card is not simply "delete it all".
     *
     * A stop that has been asked for and not confirmed is the one stop state a person
     * has something to do about, and §4.5 exists because DSP-1 measured 69.5 s of
     * remote work continuing after DSpatch stopped listening. Two sentences: what is
     * not known, and what to do while it is not known.
     */
    return {
      standing: 'stop-requested',
      activityIsKnown: false,
      actionNote:
        'The stop has not been confirmed: asking is not stopping. Wait for the run to ' +
        'report an end, or check your project for work that is still going.',
    };
  }
  /*
   * A working run says nothing here, and that is DSP-87.
   *
   * It used to answer all four questions, and one answer was wrong for the whole of
   * every run that had said anything: *the first step to answer, nothing has come back
   * yet* came from `replies`, which holds **finished** replies — so a step that had
   * been streaming for four minutes, with its text directly above, was described
   * underneath as having produced nothing. Niclas met that as *281 s with nothing back*.
   *
   * While a step works, the window already shows what it is saying, what it is running
   * and one status line for it, built by `stepStanding` from that step's own events.
   * A paragraph beside that is a second account that can only disagree with it.
   */
  return { standing: 'active', activityIsKnown: true, actionNote: null };
}

/* ------------------------------------------------------------------------- */
/* Reading runs back after a restart                                          */
/* ------------------------------------------------------------------------- */

/**
 * The loop turns a saved conversation's records describe.
 *
 * **Display, and nothing else.** This turns files into the same `LoopTurn` shape a
 * live run produces, so the column after a restart is drawn by the component that
 * already exists rather than by a second one that could word things differently.
 * Nothing here starts an agent, runs a command or touches the project, and there
 * is deliberately no way to ask it to: resuming a run is the next delivery, and a
 * "restore" that helpfully continued would be a bug here rather than a feature.
 *
 * A record that stops without an ending line becomes an `interrupted` turn, which
 * says DSpatch stopped before the run did and that what happened afterwards is not
 * known. It is never shown as a completed run and never as a failed one.
 */
export function loopTurnsFromRecords(
  records: readonly { readonly record: ParsedRunRecord | null; readonly error: string | null }[],
): readonly LoopTurn[] {
  const turns: LoopTurn[] = [];
  for (const entry of records) {
    const record = entry.record;
    const identity = record?.identity ?? null;
    if (record === null || identity === null) {
      continue;
    }
    // Split on disk exactly as it is split live, by the same rule, so a run reads
    // the same after a restart as it did while it was happening. A recorded reply
    // with no text is a step that went silent, and the record has always held that
    // fact — nothing was reading it.
    const spoke = record.replies.filter((reply) => reply.text.trim() !== '');
    const silent = record.replies.filter((reply) => reply.text.trim() === '');
    turns.push({
      runId: identity.runId,
      mandate: identity.mandate,
      sentAtUtc: identity.startedAtUtc,
      replies: spoke.map((reply) => ({
        nodeId: reply.nodeId,
        nodeLabel: reply.nodeLabel,
        text: reply.text,
        occurrence: reply.occurrence,
        // Only where the record has one. A run recorded before DSP-46 wrote no prompt,
        // and `undefined` here is what makes the window say nothing rather than offer
        // an empty message as the brief that step was given.
        ...(reply.prompt === undefined ? {} : { prompt: reply.prompt }),
      })),
      silentSteps: silent.map((reply) => ({
        nodeId: reply.nodeId,
        nodeLabel: reply.nodeLabel,
        occurrence: reply.occurrence,
      })),
      branches: branchesFromJournal(record.journal),
      // The graph the record says was walked. A record does not carry the
      // declaration's own name or id, so a restored turn is captioned by the drawing
      // rather than by the name the person chose from a list — which is what the
      // record knows, and saying more than it knows is what this column must not do.
      loop: { name: null, id: identity.graphId },
      cancelRequested: record.ending?.cancelled ?? false,
      abandoned: false,
      ending: endingFromRecord(record, entry.error),
      restoredFrom: 'record',
    });
  }
  return turns;
}

/**
 * The moves between nodes, read off the runner's own `edge-taken` entries.
 *
 * The branch's name comes from what the runner *recorded* — the outcome or the
 * declared failure it routed on — rather than from the edge's label in a drawing
 * this function does not have. Those are close but not the same, and the recorded
 * value is the one that is true of every record ever written, including records of
 * graphs the window has no lookup for. The edge id is the last resort, which is
 * still better than a handover sentence that cannot say why control moved.
 */
export function branchesFromJournal(
  journal: readonly RunJournalEntry[],
): readonly TrailBranch[] {
  const branches: TrailBranch[] = [];
  for (const entry of journal) {
    if (entry.kind !== 'edge-taken') {
      continue;
    }
    const from = entry.data?.['from'];
    const to = entry.data?.['to'];
    if (typeof from !== 'string' || typeof to !== 'string') {
      continue;
    }
    const outcome = entry.data?.['outcome'];
    const failure = entry.data?.['failure'];
    const label =
      typeof outcome === 'string'
        ? outcome
        : typeof failure === 'string'
          ? failure
          : (entry.edgeId ?? '');
    branches.push({ fromNodeId: from, toNodeId: to, label });
  }
  return branches;
}

function endingFromRecord(record: ParsedRunRecord, readError: string | null): LoopEnding {
  /*
   * A record that cannot be read in full is the same class of fact as one that could
   * not be written, so it travels the same way (DSP-90): as `actionNote`, which
   * survives a stop the person asked for. A restored cancelled run is exactly that
   * stop — `cancelRequested` comes from `ending.cancelled` — so leaving this inside
   * `text` would have hidden a truncated record behind this card's own silence.
   */
  const unreadable =
    readError === null && !record.truncatedLastLine
      ? null
      : [
          record.truncatedLastLine
            ? 'The record ends in the middle of a line, so DSpatch was writing it when it ' +
              'stopped and the last thing the run did is missing from it.'
            : '',
          readError ?? '',
        ]
          .filter((part) => part !== '')
          .join(' ');
  const ending = record.ending;
  if (ending === null) {
    return {
      kind: 'interrupted',
      terminalNodeId: null,
      terminalLabel: null,
      // An interrupted record has no recorded outcome by definition, and the run may
      // well have gone on to reach one after DSpatch stopped watching. Claiming
      // `unresolved` as a *recorded* value would be putting words in the record.
      outcome: null,
      // An interrupted run keeps its sentence in the column. It is the ending most
      // likely to need something from a person, and what is unknown about it is the
      // part a short line would leave out.
      shortText: null,
      actionNote: unreadable,
      text:
        `This run was not finished as far as this record goes: DSpatch stopped before the ` +
        `run reported an end, so what happened after the last recorded step is unknown. ` +
        `It is not a pass and not a failure. Nothing has been repeated and nothing has ` +
        `been reset — anything the agent changed is still in your project, and the ` +
        `history below is what was written down before DSpatch stopped.`,
    };
  }
  return {
    kind: endingKindFromRecordedStatus(ending.kind, ending.status),
    terminalNodeId: ending.terminalNodeId,
    // The record keeps the runner's journal entries as they were written, so the
    // label the badge needs is already on disk for every run ever recorded.
    terminalLabel: terminalNameFor(ending.terminalNodeId, record.journal),
    outcome: ending.outcome,
    // Built from the recorded outcome and terminal, never from `outcomeText`.
    //
    // That is what lets an older record be read honestly without touching it. The
    // file keeps the exact sentence it was written with — including a version of the
    // *nothing changed* wording that claimed there was nothing to test — and that
    // stored text stays available in full behind the disclosure, which is where a
    // record of what was believed at the time belongs. What the column states now is
    // derived from the outcome the run actually recorded, so an old conclusion is not
    // presented as a current finding.
    shortText:
      ending.cancelled ? null : briefRunOutcome(ending.outcome, ending.terminalNodeId),
    actionNote: unreadable,
    text: `${ending.outcomeText} ${ending.note}`.trim(),
  };
}

function endingKindFromRecordedStatus(
  kind: RecordedEndingKind,
  status: RunStatus | null,
): LoopEndingKind {
  if (kind === 'cancelled') {
    return 'cancelled';
  }
  if (kind === 'failed' || status === null) {
    return 'failed';
  }
  return endingKindOf(status);
}

/** A record's text as `loopTurnsFromRecords` would read it. Exposed for tests. */
export function loopTurnsFromRecordText(text: string): readonly LoopTurn[] {
  const record = parseRunRecord(text);
  return loopTurnsFromRecords([{ record, error: record.error }]);
}

/**
 * The conversation column as one list, in the order things happened.
 *
 * Ordinary turns and loop turns are separate state, so something has to put them
 * in order for display. Time, not arrival: a loop run cannot overlap an ordinary
 * send — the send gate prevents it — but an ordinary send *after* a loop run would
 * otherwise be drawn above it, which would misstate the order of the user's own
 * work.
 */
export type TranscriptItem<Chat> =
  /** `index` is the position within its own list, which is what `data-ev` names. */
  | { readonly kind: 'chat'; readonly atUtc: string; readonly index: number; readonly turn: Chat }
  | { readonly kind: 'loop'; readonly atUtc: string; readonly index: number; readonly turn: LoopTurn }
  /**
   * A message the user typed while a run was working.
   *
   * In the same column as everything else, which is the whole of DSP-53 #3: a
   * question, its answer and the follow-up have to be readable together, and a
   * message that went into a run belongs beside the run it went into rather than
   * in a panel about pending instructions. Ordered by when it was *received*, so
   * it sits where the person typed it rather than where it was eventually used.
   */
  | {
      readonly kind: 'instruction';
      readonly atUtc: string;
      readonly index: number;
      readonly instruction: LoopInstruction;
    };

export function mergeTranscript<Chat extends { readonly startedAtUtc: string }>(
  chatTurns: readonly Chat[],
  loopTurns: readonly LoopTurn[],
  instructions: readonly LoopInstruction[] = [],
): readonly TranscriptItem<Chat>[] {
  const items: TranscriptItem<Chat>[] = [
    ...chatTurns.map((turn, index) => ({
      kind: 'chat' as const,
      atUtc: turn.startedAtUtc,
      index,
      turn,
    })),
    ...loopTurns.map((turn, index) => ({
      kind: 'loop' as const,
      atUtc: turn.sentAtUtc,
      index,
      turn,
    })),
    ...instructions.map((instruction, index) => ({
      kind: 'instruction' as const,
      atUtc: instruction.receivedAtUtc,
      index,
      instruction,
    })),
  ];
  // A timestamp DSpatch cannot parse orders nothing. `sort` is stable, so an
  // unparseable pair keeps the order it came in, which is per-list arrival order
  // — a worse order than by time, and better than an invented one.
  return items.sort((left, right) => {
    const at = Date.parse(left.atUtc);
    const to = Date.parse(right.atUtc);
    if (Number.isNaN(at) || Number.isNaN(to) || at === to) {
      return 0;
    }
    return at - to;
  });
}
