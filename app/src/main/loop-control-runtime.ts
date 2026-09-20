/**
 * The running half of "who decides that the next work step starts".
 *
 * `shared/loop-control.ts` holds the rules and knows nothing about time, windows or
 * cancellation; this holds the one state a run is actually controlled by, turns a held
 * step into a real wait, and tells every window what it may say. Every decision here is
 * delegated — `decideNextStep` for whether a step starts, `applyControlAction` for what
 * each event does to the state, `describeControl` for the sentence — so there is one
 * rule and one place it lives, rather than a second copy that drifts.
 *
 * **A paused run is a waiting run, not a stopped one.** `awaitStepRelease` returns a
 * promise the runner is sitting on inside `runLoopGraph`, so the journal, the counters,
 * the mandate and the graph version are all still in that closure. That is DSP-30 #4
 * expressed structurally: there is no restart path to get wrong, because continuing is
 * the same call returning.
 *
 * **Cancel stays a separate action.** A run cancelled while it is waiting is not
 * released into the step it was holding: the wait ends with `cancelled`, and the runner
 * ends the run without ever starting the work. Without this, a cancel pressed during a
 * pause would sit unheard until a step that is never going to start finished.
 */

import {
  applyControlAction,
  controlForNewRun,
  decideNextStep,
  initialControlState,
  type LoopControlOutcome,
  type LoopControlReport,
  type LoopControlState,
  type LoopMode,
  type StepHold,
  type StepRef,
} from '../shared/loop-control';
import type { RunControlPort, StepReleaseOutcome } from '../shared/loop-run';

/**
 * What a request to start a run achieved.
 *
 * A result rather than a thrown error, because refusing an overlap is an ordinary
 * answer the person has to read, not a fault: the caller turns it into the sentence
 * its own window shows.
 */
export interface RunBeginOutcome {
  readonly started: boolean;
  readonly note: string;
  /** The run that holds the control afterwards: this one, or the one that refused it. */
  readonly runId: string | null;
}

export interface LoopControlOptions {
  /** Called on every change, with the whole report. Windows re-derive; they are not told. */
  readonly publish?: (report: LoopControlReport) => void;
  readonly now?: () => number;
}

export class LoopRunController implements RunControlPort {
  private state: LoopControlState;

  private runId: string | null = null;

  /** Resolvers woken by anything that could change a held step's answer. */
  private waiting: (() => void)[] = [];

  private abortSignal: AbortSignal | null = null;

  private onAbort: (() => void) | null = null;

  private readonly publish: (report: LoopControlReport) => void;

  private readonly now: () => number;

  constructor(options: LoopControlOptions = {}) {
    this.state = initialControlState();
    this.publish = options.publish ?? ((): void => undefined);
    this.now = options.now ?? ((): number => Date.now());
  }

  report(): LoopControlReport {
    return { runId: this.runId, state: this.state };
  }

  /* --------------------------------------------------------------------- */
  /* What the person does                                                  */
  /* --------------------------------------------------------------------- */

  /**
   * Ask the run to pause.
   *
   * Deliberately says *requested*, and says it even when nothing is in flight — the
   * window reads the phase for what actually happened rather than trusting this note.
   */
  requestPause(): LoopControlOutcome {
    if (this.runId === null) {
      return { accepted: false, note: 'No loop is running, so there is nothing to pause.', report: this.report() };
    }
    this.change({ kind: 'request-pause' });
    const inFlight = this.state.inFlight;
    return {
      accepted: true,
      note:
        inFlight === null
          ? 'The run is paused: nothing was in flight, and no new work step will be started until you continue.'
          : `Pause requested. "${inFlight.nodeLabel}" is still running and DSpatch will not stop it — ` +
            `the run stops when that step ends. Cancel is the separate action for abandoning work in progress.`,
      report: this.report(),
    };
  }

  /** Clear any pause and let exactly one held work step start. */
  continueRun(): LoopControlOutcome {
    if (this.runId === null) {
      return { accepted: false, note: 'No loop is running, so there is nothing to continue.', report: this.report() };
    }
    this.change({ kind: 'continue' });
    return {
      accepted: true,
      note: 'Continuing. Steps that already finished are not repeated and nothing was reset.',
      report: this.report(),
    };
  }

  /**
   * Change who decides the next step.
   *
   * Allowed while a run is walking and while one is not, because the moment a person
   * most wants to take over is the middle of a run. Nothing else moves: the mandate,
   * the graph version, the history, the results and the budgets are not in this object,
   * so there is nothing here that could reset them.
   */
  setMode(mode: LoopMode): LoopControlOutcome {
    const before = this.state.mode;
    this.change({ kind: 'set-mode', mode });
    return {
      accepted: true,
      note:
        before === mode
          ? `Already ${mode}.`
          : mode === 'interactive'
            ? 'Interactive from here: DSpatch will ask before it starts an agent or runs a command. ' +
              'The run keeps its mandate, its graph version, its history and the budget it has already spent, ' +
              'and no step that has run will run again.'
            : 'Autonomous from here: the run continues within the graph rules and the mandate it already has. ' +
              'An explicit human step still waits for an answer.',
      report: this.report(),
    };
  }

  /* --------------------------------------------------------------------- */
  /* What the run does                                                     */
  /* --------------------------------------------------------------------- */

  /**
   * A run is starting. The mode survives it; a pause asked of the previous run does not.
   *
   * **Refused while another run is walking, rather than replacing it.** The rule in
   * `controlPhase` cannot be broken by anything that goes through it, but it answers
   * from `inFlight`, and a second run resetting the state used to make that input
   * false while an agent was genuinely still writing — so the product said *Paused*
   * with a step in flight, honestly, from inputs that had stopped being true. The two
   * callers in `main.ts` refuse the overlap as well, because a refusal there can name
   * the window and the graph; this refusal is the one that cannot be forgotten by a
   * third caller added later. Two runs also meant one control and one abort signal
   * between them, which left the first run unable to hear its own Cancel.
   *
   * A second call with the same run id is refused too: nothing legitimately starts a
   * run twice, and the reset is exactly what must not happen underneath a step.
   */
  beginRun(runId: string, abortSignal: AbortSignal | null = null): RunBeginOutcome {
    if (this.runId !== null) {
      return { started: false, note: this.refuseSecondRun(), runId: this.runId };
    }
    this.runId = runId;
    this.state = controlForNewRun(this.state);
    this.attachAbort(abortSignal);
    this.publish(this.report());
    return { started: true, note: 'The run has the control.', runId };
  }

  /**
   * Why a second run was not started, in words a person can act on.
   *
   * Names the run that holds the control and what it is doing right now, because
   * "already running" on its own leaves someone looking at two windows with no way to
   * tell which one to deal with.
   */
  private refuseSecondRun(): string {
    const inFlight = this.state.inFlight;
    const doing =
      inFlight === null
        ? 'It has no work step running at this moment, but it has not ended.'
        : `"${inFlight.nodeLabel}" is running in it right now.`;
    return (
      `A loop run is already in progress (${this.runId ?? 'unknown'}). ${doing} DSpatch runs one ` +
      `loop at a time, so this one was not started: no step was begun, nothing was reset and the ` +
      `run that is walking was not disturbed. Let it finish or cancel it, then start this one.`
    );
  }

  /**
   * A run has ended.
   *
   * Guarded on the run id the way `LoopRunAudience.end` is: a slow `finally` from a run
   * the user already cancelled must not clear the control of the run they have since
   * started, which would leave that run reporting a pause nobody asked it for.
   */
  endRun(runId: string): void {
    if (this.runId !== runId) {
      return;
    }
    this.runId = null;
    this.state = controlForNewRun(this.state);
    this.attachAbort(null);
    this.wake();
    this.publish(this.report());
  }

  /* --------------------------------------------------------------------- */
  /* RunControlPort                                                         */
  /* --------------------------------------------------------------------- */

  async awaitStepRelease(
    step: StepRef,
    onHeld: (hold: StepHold, why: string) => void,
  ): Promise<StepReleaseOutcome> {
    const first = decideNextStep(this.state, step);
    if (first.start) {
      return { kind: 'start', detail: first.why, heldBy: null, waitedMs: 0 };
    }
    const hold = first.hold;
    const heldAt = this.now();
    this.change({ kind: 'step-held', step });
    onHeld(hold, first.why);

    for (;;) {
      // Checked before waiting as well as after, so a cancel that arrived while the
      // state was being written is not slept through.
      if (this.abortSignal?.aborted === true) {
        return {
          kind: 'cancelled',
          detail:
            `The run was cancelled while it was waiting, so the step it was holding was not ` +
            `started.`,
          heldBy: hold,
          waitedMs: this.now() - heldAt,
        };
      }
      const again = decideNextStep(this.state, step);
      if (again.start) {
        return { kind: 'start', detail: again.why, heldBy: hold, waitedMs: this.now() - heldAt };
      }
      // A human node reaches here only if a caller asks about one; the runner does not,
      // because a human step waits by its own mechanism. DSP-31 is what will resolve
      // this wait, and it will do it by making `decideNextStep` answer differently
      // rather than by adding a second rule beside it.
      await this.nextChange();
    }
  }

  stepStarted(step: StepRef): void {
    this.change({ kind: 'step-started', step });
  }

  /**
   * The step ended, which is the **only** thing that turns a requested pause into a
   * pause. Not a timer, and not the request arriving.
   */
  stepEnded(step: StepRef): void {
    this.change({ kind: 'step-ended', step });
  }

  /* --------------------------------------------------------------------- */
  /* Plumbing                                                              */
  /* --------------------------------------------------------------------- */

  private change(action: Parameters<typeof applyControlAction>[1]): void {
    this.state = applyControlAction(this.state, action);
    this.wake();
    this.publish(this.report());
  }

  private nextChange(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = [];
    for (const resolve of waiting) {
      resolve();
    }
  }

  private attachAbort(signal: AbortSignal | null): void {
    if (this.abortSignal !== null && this.onAbort !== null) {
      this.abortSignal.removeEventListener('abort', this.onAbort);
    }
    this.abortSignal = signal;
    this.onAbort = signal === null ? null : (): void => this.wake();
    if (signal !== null && this.onAbort !== null) {
      signal.addEventListener('abort', this.onAbort, { once: true });
    }
  }
}
