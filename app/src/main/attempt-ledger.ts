import type {
  AttemptInfo,
  AttemptKind,
  AttemptReconciliation,
  AttemptState,
  AttemptStep,
  NextAction,
  RunStateReport,
  StillRunning,
  StoredAttempt,
} from '../shared/bridge';

/**
 * Every attempt DSpatch has made, in an explicit state, with its own ID.
 *
 * DSP-2 could say what was happening while things went well. The states it could
 * not distinguish are the ones this module exists for: a message that has been
 * sent but has not started anything, a cancellation that was asked for but never
 * confirmed, and an outcome nobody knows. Report 003 found both gaps by
 * measurement — 11–12 s between Send and the first text with no way out of that
 * wait, and a cancel path whose one-run invariant was still unknown because both
 * observed cancels happened to resolve in ~50 ms.
 *
 * Three properties are deliberate.
 *
 * **Pure and injected clock.** No `fs`, no `child_process`, no provider. The
 * cases that matter here are the ones a live session almost never produces on
 * demand, so they have to be reachable in a test.
 *
 * **Nothing is overwritten in silence.** A transition the rules refuse is still
 * appended to the history with `applied: false`. A late claim that a run finished
 * after DSpatch already recorded it as stopped is evidence about the provider,
 * not noise to discard.
 *
 * **Unknown is a state, not a gap.** `outcome-unknown` is reachable, is displayed
 * as itself, and is what blocks a repeat until someone has seen it. It is never
 * collapsed into "stopped": DSP-1 measured 69.5 s of continued remote work after
 * a severed connection, so silence is not an ending.
 */

const SETTLED: readonly AttemptState[] = [
  'stopped-confirmed',
  'completed',
  'failed',
];

/** States in which nothing can be said about the outcome yet. */
const AMBIGUOUS: readonly AttemptState[] = [
  'waiting',
  'cancel-requested',
  'outcome-unknown',
];

export function isSettled(state: AttemptState): boolean {
  return SETTLED.includes(state);
}

interface AttemptRecord {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  label: string;
  state: AttemptState;
  stateReason: string;
  readonly requestedAtUtc: string;
  endedAtUtc: string | null;
  providerRunId: string | null;
  localPid: number | null;
  cancelRequestedAtUtc: string | null;
  acknowledgedAtUtc: string | null;
  readonly history: AttemptStep[];
  /** Read back from a saved conversation rather than observed in this window. */
  readonly restoredFromFile?: boolean;
}

/** What adopting a saved conversation's attempts did, including what it could not. */
export interface RestoreOutcome {
  readonly reconciliations: readonly AttemptReconciliation[];
  /**
   * IDs the ledger already held, which were therefore not adopted.
   *
   * Never silently: the caller is expected to say so. An attempt whose saved state
   * was not read back is one the reconciliation gate does not know about, and that
   * is exactly the kind of gap this project does not leave unstated.
   */
  readonly skippedAttemptIds: readonly string[];
}

/** Whether a repeat may proceed, and what has to be named if it may not. */
export interface RepeatDecision {
  readonly allowed: boolean;
  /** The attempt standing in the way, if any. */
  readonly blockedBy: string | null;
  readonly reason: string;
  /**
   * Every attempt ID the caller must pass to proceed. Empty when acknowledging
   * would not help, which is the case for work that is confirmed to be running:
   * a second one cannot be made safe by admitting the first exists.
   *
   * All of them rather than the first. Report 006 measured the consequence of
   * taking the first: with `dsp-attempt-0003` and `dsp-attempt-0004` both unknown
   * after a restart, naming 0003 let the message through and 0004 stayed unnamed.
   * It was still listed and still counted as unresolved, so nothing was lost — but
   * the gate is supposed to mean "you have seen these", and it did not.
   *
   * Empty as well once every unresolved attempt has already been acknowledged:
   * there is nothing left for the caller to name. See {@link AttemptLedger.mayRepeat}.
   */
  readonly acknowledgeableAttemptIds: readonly string[];
}

const KIND_LABEL: Record<AttemptKind, string> = {
  'agent-turn': 'message to the agent',
  command: 'build or test command',
};

export class AttemptLedger {
  private readonly now: () => string;

  private readonly attempts: AttemptRecord[] = [];

  private counter = 0;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  /**
   * Register an attempt before the work is asked for.
   *
   * Before, not after: an attempt that fails on its first instruction still
   * happened, and an attempt whose request never returns is the whole point.
   */
  open(kind: AttemptKind, label: string): AttemptInfo {
    this.counter += 1;
    const attemptId = `dsp-attempt-${String(this.counter).padStart(4, '0')}`;
    const record: AttemptRecord = {
      attemptId,
      kind,
      label,
      state: 'waiting',
      stateReason:
        kind === 'agent-turn'
          ? 'Sent to the provider. Nothing has confirmed that a run started yet.'
          : 'Asked for. The process has not been reported as started yet.',
      requestedAtUtc: this.now(),
      endedAtUtc: null,
      providerRunId: null,
      localPid: null,
      cancelRequestedAtUtc: null,
      acknowledgedAtUtc: null,
      history: [],
    };
    this.attempts.push(record);
    this.record(record, 'waiting', 'Attempt opened.', true);
    return describe(record);
  }

  /**
   * Adopt attempts saved by an earlier run of DSpatch, and reconcile them.
   *
   * This is DSP-4's AC#3, and it is deliberately the *same* mechanism as every
   * other unknown outcome rather than a second one. An attempt that was `waiting`,
   * `running` or `cancel-requested` when the window closed is not merely old data:
   * DSpatch stopped receiving its events at an unknown point, so whether the work
   * ended is exactly as unknown as it is after a cancellation nobody confirmed.
   * Such an attempt is therefore adopted as `outcome-unknown`, which is what makes
   * {@link mayRepeat} refuse the next message or command until someone names it.
   *
   * Two things it must not do, and does not. It does not settle anything: a saved
   * `running` never becomes `stopped-confirmed`, because closing a window is not an
   * ending and DSP-1 measured 69.5 s of continued remote work after DSpatch stopped
   * listening. And it starts nothing — this function has no provider, no process
   * and no file system, so restoring history cannot restart activity.
   *
   * `counter` is advanced past every ID adopted here so that a new attempt in this
   * process cannot reuse one, which would make two different pieces of work share
   * an identity across the restart.
   *
   * The records are trusted to be well-formed; validating a file a user may have
   * hand-edited belongs to the store that reads it, not here.
   *
   * An ID that is already in this ledger is **not** adopted, and is reported instead.
   * Attempt IDs are numbered per window, so two conversations written by two runs of
   * DSpatch both contain `dsp-attempt-0001`. Merging them would put one piece of
   * work's history under another's identity, which is worse than saying that this
   * window cannot show both.
   */
  restore(records: readonly StoredAttempt[]): RestoreOutcome {
    const reconciliations: AttemptReconciliation[] = [];
    const skippedAttemptIds: string[] = [];
    for (const stored of records) {
      if (this.attempts.some((entry) => entry.attemptId === stored.attemptId)) {
        skippedAttemptIds.push(stored.attemptId);
        continue;
      }
      const record: AttemptRecord = {
        attemptId: stored.attemptId,
        kind: stored.kind,
        label: stored.label,
        state: stored.state,
        stateReason: stored.stateReason,
        requestedAtUtc: stored.requestedAtUtc,
        endedAtUtc: stored.endedAtUtc,
        providerRunId: stored.providerRunId,
        localPid: stored.localPid,
        cancelRequestedAtUtc: stored.cancelRequestedAtUtc,
        acknowledgedAtUtc: stored.acknowledgedAtUtc,
        history: [...stored.history],
        restoredFromFile: true,
      };
      this.attempts.push(record);
      this.counter = Math.max(this.counter, ordinalOf(stored.attemptId));

      const stateAtClose = stored.state;
      if (stateAtClose === 'waiting' || stateAtClose === 'running') {
        this.transition(
          record,
          'outcome-unknown',
          'DSpatch was closed while this was still going, so it stopped receiving ' +
            'the events that would have said how it ended. Whether the work ' +
            'finished, failed or is still running somewhere is unknown — closing a ' +
            'window is not an ending. Nothing has been repeated on your behalf.',
        );
      } else if (stateAtClose === 'cancel-requested') {
        this.transition(
          record,
          'outcome-unknown',
          'A stop had been asked for and no end had been confirmed when DSpatch ' +
            'closed, so the ending was never established and cannot be now. This ' +
            'is recorded as unknown rather than as stopped.',
        );
      } else if (stateAtClose === 'outcome-unknown') {
        this.record(
          record,
          'outcome-unknown',
          'Carried across a restart still unresolved. It was unknown when DSpatch ' +
            'closed and nothing since then could have made it known.',
          true,
        );
      }

      if (!isSettled(record.state)) {
        reconciliations.push({
          attemptId: record.attemptId,
          kind: record.kind,
          label: record.label,
          stateAtClose,
          stateNow: record.state,
          // Not `true` unconditionally, which is what it was until Verifier 004
          // measured the consequence: an attempt whose acknowledgement is on the
          // record no longer blocks anything — {@link mayRepeat} lets the next
          // message through — so a panel saying "the next message needs this named
          // first" was telling the reader to do something that had already been
          // done and would not be asked for. `blocksRepeat` means what its name
          // says, and for an acknowledged attempt that is `false`.
          blocksRepeat: record.acknowledgedAtUtc === null,
          note: record.stateReason,
        });
      }
    }
    return { reconciliations, skippedAttemptIds };
  }

  /**
   * Forget the attempts that came from a file, keeping this window's own.
   *
   * Reading a second conversation back replaces the first, and its attempts have to
   * go with it: they are a view of a file rather than work observed here, the file
   * still holds every one of them, and two conversations' attempt lists in one panel
   * would collide on the per-window numbering. Nothing this process actually did is
   * touched, and `counter` is left where it is so no ID is ever reused.
   */
  dropRestored(): number {
    const before = this.attempts.length;
    const kept = this.attempts.filter((record) => record.restoredFromFile !== true);
    this.attempts.length = 0;
    this.attempts.push(...kept);
    return before - kept.length;
  }

  /** Confirmed started: an event carrying a run ID, or a process with a pid. */
  markRunning(
    attemptId: string,
    identity: { readonly providerRunId?: string; readonly localPid?: number | null },
    note: string,
  ): void {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    if (record === undefined) {
      return;
    }
    if (identity.providerRunId !== undefined) {
      record.providerRunId = identity.providerRunId;
    }
    if (identity.localPid !== undefined) {
      record.localPid = identity.localPid;
    }
    this.transition(record, 'running', note);
  }

  markCancelRequested(attemptId: string, note: string): void {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    if (record === undefined) {
      return;
    }
    record.cancelRequestedAtUtc ??= this.now();
    this.transition(record, 'cancel-requested', note);
  }

  /** An end that was observed. Never used for an end that was merely expected. */
  markStopped(attemptId: string, note: string): void {
    this.settle(attemptId, 'stopped-confirmed', note);
  }

  markCompleted(attemptId: string, note: string): void {
    this.settle(attemptId, 'completed', note);
  }

  markFailed(attemptId: string, note: string): void {
    this.settle(attemptId, 'failed', note);
  }

  /**
   * No end was confirmed, and DSpatch has stopped expecting one.
   *
   * Reached from the cancellation confirmation window and from a send the user
   * abandoned. Deliberately not settled: it is what a repeat has to reckon with.
   */
  markOutcomeUnknown(attemptId: string, note: string): void {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    if (record === undefined) {
      return;
    }
    this.transition(record, 'outcome-unknown', note);
  }

  /**
   * The user has been shown this attempt's unknown outcome and accepts it.
   *
   * Written once and then left alone. Since DSP-6 this timestamp is what
   * {@link mayRepeat} reads to stop asking, so it has to mean "when this was first
   * seen" rather than "when it was last mentioned"; the history keeps every later
   * mention anyway.
   */
  acknowledge(attemptId: string, note: string): void {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    if (record === undefined) {
      return;
    }
    record.acknowledgedAtUtc ??= this.now();
    this.record(record, record.state, note, true);
  }

  get(attemptId: string): AttemptInfo | null {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    return record === undefined ? null : describe(record);
  }

  all(): readonly AttemptInfo[] {
    return this.attempts.map(describe);
  }

  /** Every attempt in the shape that is written to disk. Nothing derived. */
  persistable(): readonly StoredAttempt[] {
    return this.attempts.map((record) => ({
      attemptId: record.attemptId,
      kind: record.kind,
      label: record.label,
      state: record.state,
      stateReason: record.stateReason,
      requestedAtUtc: record.requestedAtUtc,
      endedAtUtc: record.endedAtUtc,
      providerRunId: record.providerRunId,
      localPid: record.localPid,
      cancelRequestedAtUtc: record.cancelRequestedAtUtc,
      acknowledgedAtUtc: record.acknowledgedAtUtc,
      history: [...record.history],
    }));
  }

  latest(kind: AttemptKind): AttemptInfo | null {
    for (let index = this.attempts.length - 1; index >= 0; index -= 1) {
      const record = this.attempts[index];
      if (record !== undefined && record.kind === kind) {
        return describe(record);
      }
    }
    return null;
  }

  unresolved(kind?: AttemptKind): readonly AttemptInfo[] {
    return this.attempts
      .filter(
        (record) =>
          !isSettled(record.state) && (kind === undefined || record.kind === kind),
      )
      .map(describe);
  }

  /**
   * Whether an action of this kind may be started, given what came before.
   *
   * This is AC#4 in one function. Three outcomes:
   *
   * - Nothing unresolved: allowed.
   * - Something confirmed running: refused, and no acknowledgement changes that.
   *   Two commands in one working copy would interleave their writes, and the
   *   provider refuses a second run in a session that already holds one.
   * - Something ambiguous: refused **until the caller names every one of them**.
   *   That is the reconciliation. A name can only come from a caller that was
   *   shown the state, so nothing automatic — no retry loop, no reconnection — can
   *   repeat an action whose previous outcome nobody has looked at.
   *
   * **Once, not once per message.** An attempt counts as named either because this
   * call names it or because {@link acknowledge} already recorded that someone saw
   * it, in `acknowledgedAtUtc`. Until DSP-6 only the argument counted, and the
   * argument is supplied by one button on one send — so the acknowledgement written
   * to the record was never read back, and the next message met the same gate for
   * the same attempt. DSP-5's trial measured what that costs: a conversation with
   * eleven attempts, exactly one `outcome-unknown`, and no listener left that could
   * ever resolve it, so the gate was permanent. Niclas met it three times in twelve
   * minutes, the third time in a new provider session where a duplicate run is not
   * even possible.
   *
   * What this does **not** change: the first message after an unknown outcome is
   * still refused and still has to be answered deliberately, the attempt stays
   * unresolved in {@link unresolved} and in the saved conversation, and nothing
   * automatic can acknowledge anything — `acknowledgedAtUtc` is only ever written
   * by a caller that passed the ID, which only the window's own button does.
   */
  mayRepeat(
    kind: AttemptKind,
    acknowledgedAttemptIds: readonly string[] = [],
  ): RepeatDecision {
    const blocking = this.attempts.filter(
      (record) => record.kind === kind && !isSettled(record.state),
    );
    const running = blocking.find((record) => record.state === 'running');
    if (running !== undefined) {
      return {
        allowed: false,
        blockedBy: running.attemptId,
        reason:
          `${running.attemptId} is running (${KIND_LABEL[kind]}) and has not ` +
          'ended. Stop it first: starting a second one now would leave two ' +
          'pieces of work in the same place with no way to tell their effects ' +
          'apart.',
        acknowledgeableAttemptIds: [],
      };
    }
    const ambiguous = blocking.filter((record) => AMBIGUOUS.includes(record.state));
    if (ambiguous.length === 0) {
      return {
        allowed: true,
        blockedBy: null,
        reason: 'Nothing of this kind is unresolved.',
        acknowledgeableAttemptIds: [],
      };
    }
    const ids = ambiguous.map((record) => record.attemptId);
    const unnamed = ambiguous.filter(
      (record) =>
        record.acknowledgedAtUtc === null &&
        !acknowledgedAttemptIds.includes(record.attemptId),
    );
    if (unnamed.length === 0) {
      const alreadySeen = ambiguous.filter(
        (record) =>
          record.acknowledgedAtUtc !== null &&
          !acknowledgedAttemptIds.includes(record.attemptId),
      );
      return {
        allowed: true,
        blockedBy: null,
        reason:
          `Proceeding with ${ids.join(', ')} left unresolved (${ambiguous
            .map((record) => `${record.attemptId}: "${record.state}"`)
            .join('; ')}). ${
            ambiguous.length === 1 ? 'It stays' : 'They stay'
          } on the record as unresolved rather than being marked stopped.` +
          (alreadySeen.length === 0
            ? ''
            : ' Already acknowledged, and therefore not asked about again in this ' +
              `conversation: ${alreadySeen
                .map(
                  (record) =>
                    `${record.attemptId} at ${String(record.acknowledgedAtUtc)}`,
                )
                .join('; ')}.`),
        // Nothing left for the caller to name. Returning every ambiguous ID here
        // is what made the window raise the gate again after an acknowledgement:
        // `report()` reads this list, and a non-empty list means "you have not
        // seen these yet", which had stopped being true.
        acknowledgeableAttemptIds: [],
      };
    }
    const first = unnamed[0] as AttemptRecord;
    return {
      allowed: false,
      blockedBy: first.attemptId,
      reason:
        `${String(unnamed.length)} ${KIND_LABEL[kind]} attempt${
          unnamed.length === 1 ? '' : 's'
        } ${unnamed.length === 1 ? 'is' : 'are'} unresolved and ${
          unnamed.length === 1 ? 'has' : 'have'
        } not been named: ${unnamed.map((record) => record.attemptId).join(', ')}. ` +
        `${first.attemptId} is in state "${first.state}": ${first.stateReason} ` +
        'DSpatch will not repeat this by itself while that is unresolved. Confirm ' +
        `that you have seen ${
          unnamed.length === 1 ? 'it' : 'all of them'
        }, and the repeat will proceed with ${
          unnamed.length === 1 ? 'the earlier attempt' : 'those attempts'
        } still recorded as unresolved. You are asked this once per attempt, not ` +
        'once per message.',
      // All of them, as report 006 requires, minus any whose acknowledgement is
      // already on the record. The argument is deliberately not consulted here:
      // it is one caller's one-shot claim, while `acknowledgedAtUtc` is the
      // durable fact, and this list is what the window offers next.
      acknowledgeableAttemptIds: ambiguous
        .filter((record) => record.acknowledgedAtUtc === null)
        .map((record) => record.attemptId),
    };
  }

  report(): RunStateReport {
    const attempts = this.all();
    const needing = (kind: AttemptKind): readonly string[] =>
      this.mayRepeat(kind).acknowledgeableAttemptIds;
    return {
      attempts,
      unresolved: attempts.filter((attempt) => !isSettled(attempt.state)),
      needsAcknowledgement: {
        agentTurn: needing('agent-turn'),
        command: needing('command'),
      },
      observedAtUtc: this.now(),
    };
  }

  private settle(attemptId: string, state: AttemptState, note: string): void {
    const record = this.attempts.find((entry) => entry.attemptId === attemptId);
    if (record === undefined) {
      return;
    }
    this.transition(record, state, note);
  }

  /**
   * Apply a state change, or record that it was refused.
   *
   * The one rule: a settled attempt stays settled. Without it, a `run.finished`
   * arriving after DSpatch confirmed a stop would quietly rewrite history, and a
   * killed command could end up recorded as having completed — which is exactly
   * the reading AC#6 forbids.
   */
  private transition(
    record: AttemptRecord,
    next: AttemptState,
    note: string,
  ): void {
    if (isSettled(record.state)) {
      this.record(
        record,
        next,
        `${note} Not applied: ${record.attemptId} was already settled as ` +
          `"${record.state}".`,
        false,
      );
      return;
    }
    record.state = next;
    record.stateReason = note;
    if (isSettled(next)) {
      record.endedAtUtc = this.now();
    }
    this.record(record, next, note, true);
  }

  private record(
    record: AttemptRecord,
    state: AttemptState,
    note: string,
    applied: boolean,
  ): void {
    record.history.push({ atUtc: this.now(), state, note, applied });
  }
}

/**
 * What may still be going, per state.
 *
 * The two channels are separate because they are stopped by different means and
 * known with different certainty. A process DSpatch spawned can be killed and
 * observed to be gone; a provider run can only be asked to stop.
 */
function stillRunning(record: AttemptRecord): StillRunning {
  const agentNote =
    'DSpatch started no process of its own for a message. The agent runs its own ' +
    'tools, and those are outside what DSpatch can see or stop.';
  if (record.kind === 'agent-turn') {
    switch (record.state) {
      case 'waiting':
        return {
          provider: null,
          dspatchProcess: false,
          note:
            'Unknown: the message was handed to the provider, and nothing has ' +
            `come back yet. ${agentNote}`,
        };
      case 'running':
        return {
          provider: true,
          dspatchProcess: false,
          note: `The run is going. ${agentNote}`,
        };
      case 'cancel-requested':
      case 'outcome-unknown':
        return {
          provider: null,
          dspatchProcess: false,
          note:
            'Unknown, and this is not a formality: DSP-1 measured a turn that ' +
            'kept producing tool calls for 69.5 seconds after its connection was ' +
            `severed. ${agentNote}`,
        };
      default:
        return {
          provider: false,
          dspatchProcess: false,
          note: `The run reported an end. ${agentNote}`,
        };
    }
  }
  switch (record.state) {
    case 'waiting':
      return {
        provider: false,
        dspatchProcess: null,
        note: 'The command was asked for; no process has been reported yet.',
      };
    case 'running':
      return {
        provider: false,
        dspatchProcess: true,
        note:
          `The process tree under pid ${String(record.localPid ?? -1)} is ` +
          'running in the working copy.',
      };
    case 'cancel-requested':
      return {
        provider: false,
        dspatchProcess: null,
        note: 'DSpatch asked the process tree to die and has not confirmed it yet.',
      };
    case 'outcome-unknown':
      return {
        provider: false,
        dspatchProcess: null,
        note:
          'Unknown. A surviving process holds the working directory open, which ' +
          'on Windows also prevents the folder from being replaced.',
      };
    default:
      return {
        provider: false,
        dspatchProcess: false,
        note: 'The process is gone: DSpatch saw it close.',
      };
  }
}

/** The single action offered for this state. */
function nextAction(record: AttemptRecord): NextAction {
  const isTurn = record.kind === 'agent-turn';
  switch (record.state) {
    case 'waiting':
      return {
        kind: 'stop-waiting',
        label: isTurn ? 'Stop waiting for this message' : 'Stop waiting',
        detail:
          'A long wait is normal here: 11–12 seconds passed between Send and the ' +
          'first text in the runs that were measured, so slowness is not a ' +
          'failure. This gives you a way out of the wait without pretending the ' +
          'work stopped.',
      };
    case 'running':
      return {
        kind: 'stop-waiting',
        label: isTurn ? 'Cancel this message' : 'Stop this command',
        detail: isTurn
          ? 'Asks the provider to cancel. DSpatch then waits for a confirmed end ' +
            'and says so if none arrives.'
          : 'Kills the process and its children. Whatever it already wrote to ' +
            'disk stays there, and its output is not a result.',
      };
    case 'cancel-requested':
      return {
        kind: 'keep-waiting',
        label: 'Waiting for a confirmed end',
        detail:
          'The stop was asked for. DSpatch is waiting for something that confirms ' +
          'it, and will report the outcome as unknown rather than assume one.',
      };
    case 'outcome-unknown':
      if (record.acknowledgedAtUtc !== null) {
        // Seen once, and that holds for the rest of the conversation. Offering
        // *Send anyway* here would be the per-message toll DSP-6 removes: there is
        // no gate left to get past, so there is nothing to confirm. The state above
        // is still `outcome-unknown`, because being seen is not being resolved.
        return {
          kind: 'none',
          label: 'Nothing to confirm',
          detail:
            `You accepted this unknown outcome at ${record.acknowledgedAtUtc}, so ` +
            'DSpatch does not ask about it again in this conversation and the ' +
            'composer works normally. It stays recorded as unresolved: nothing has ' +
            'established whether the work finished, failed or is still going, and ' +
            'acknowledging it did not change that.',
        };
      }
      return {
        kind: 'acknowledge-then-repeat',
        label: isTurn
          ? 'Send anyway, with this left unresolved'
          : 'Run again, with this left unresolved',
        detail:
          'Nothing is repeated automatically while an outcome is unknown. ' +
          'Confirming this keeps the earlier attempt on the record as unresolved ' +
          'and starts a new one with its own ID; it does not claim the earlier ' +
          'work stopped. You are asked once per attempt, not once per message.',
      };
    case 'failed':
      return {
        kind: 'retry',
        label: isTurn ? 'Send it again' : 'Run it again',
        detail: isTurn
          ? 'The attempt failed and its end was observed, so repeating it cannot ' +
            'duplicate work that is still going. Everything already received stays ' +
            'in the conversation, and the message is put back in the box unless you ' +
            'have started typing something else — the window says which of the two ' +
            'happened rather than promising one of them.'
          : 'The attempt failed and its end was observed, so repeating it cannot ' +
            'duplicate work that is still going. The command, the working directory ' +
            'and the output of the failed run are all kept.',
      };
    default:
      return {
        kind: 'none',
        label: 'Nothing to do',
        detail: 'This attempt ended and its outcome is recorded.',
      };
  }
}

/**
 * The number in `dsp-attempt-0007`, or 0 when there is none.
 *
 * Used only to keep new IDs from colliding with adopted ones. A record whose ID
 * does not follow the pattern contributes nothing rather than throwing: it is still
 * a real attempt that happened, and refusing to restore the conversation because
 * one ID looks unfamiliar would lose more than it protects.
 */
function ordinalOf(attemptId: string): number {
  const digits = /^dsp-attempt-(\d+)$/.exec(attemptId)?.[1];
  const parsed = digits === undefined ? Number.NaN : Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function describe(record: AttemptRecord): AttemptInfo {
  return {
    attemptId: record.attemptId,
    kind: record.kind,
    label: record.label,
    state: record.state,
    stateReason: record.stateReason,
    requestedAtUtc: record.requestedAtUtc,
    endedAtUtc: record.endedAtUtc,
    providerRunId: record.providerRunId,
    localPid: record.localPid,
    cancelRequestedAtUtc: record.cancelRequestedAtUtc,
    acknowledgedAtUtc: record.acknowledgedAtUtc,
    stillRunning: stillRunning(record),
    nextAction: nextAction(record),
    history: [...record.history],
  };
}
