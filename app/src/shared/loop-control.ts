/**
 * Who decides that the next work step starts.
 *
 * DSP-29 (pause) and DSP-30 (interactive versus autonomous) are the same mechanism
 * seen from two angles, so there is one of it here rather than two flags beside each
 * other. Two flags can disagree — paused but autonomous, running but interactive —
 * and the disagreement would reach Niclas before it reached us. Everything on screen
 * and everything the runner waits on is derived from {@link LoopControlState} by the
 * functions below.
 *
 * Three rules carry the weight.
 *
 * **Pause is a request until the work step actually ends.** {@link controlPhase}
 * cannot return `paused` while {@link LoopControlState.inFlight} is set, and the only
 * thing that clears `inFlight` is the runner reporting that the step ended. Not a
 * timer, and not the request being received. A pause that claims to have happened
 * while a provider call is in flight is the same class of untruth as a green badge
 * over a failed run, and this project has now produced that shape twice — the badge,
 * and a stop message that claimed a kill it had not achieved.
 *
 * **A pause and a mode hold the same thing: a work step.** A work step is one that
 * starts an agent, runs a command, or hands the step to a participant DSpatch does not
 * run. Routing along an edge and reaching a terminal are neither, so neither waits: a
 * person asked to approve the graph walking an edge would learn nothing and would stop
 * reading the prompts, which is worse than not asking.
 *
 * **A human node waits in either mode.** {@link decideNextStep} answers `human-node`
 * before it looks at the pause or the mode, and no release token can let one through.
 * Collecting the answer is DSP-31 and is not built here; what is built here is a rule
 * that DSP-31 can read rather than one it would have to work around.
 */

import type { NodeKind } from './loop-graph';

/** Who decides the next work step: the graph's rules, or the person watching. */
export const LOOP_MODES = ['autonomous', 'interactive'] as const;
export type LoopMode = (typeof LOOP_MODES)[number];

export const DEFAULT_LOOP_MODE: LoopMode = 'autonomous';

/**
 * What a step would actually do, which is what decides whether it waits.
 *
 * Derived from the node kind and nothing else, so the rule is the same for a live
 * run, a dry run and the editor's canvas.
 */
export type StepWork = 'agent' | 'command' | 'external' | 'human' | 'bookkeeping';

export function stepWorkFor(kind: NodeKind): StepWork {
  switch (kind) {
    case 'agent':
      return 'agent';
    case 'gate':
      return 'command';
    case 'external':
      return 'external';
    case 'human':
      return 'human';
    case 'router':
    case 'terminal':
      return 'bookkeeping';
  }
}

/**
 * Whether this step starts an agent, runs a command, or hands work outside.
 *
 * The one predicate that says what a pause holds and what interactive mode asks
 * about. A human node is deliberately not one of these: it does not wait because of
 * the mode, it waits because it is a human node.
 */
export function isWorkStep(work: StepWork): boolean {
  return work === 'agent' || work === 'command' || work === 'external';
}

/** The step being decided about, named the way a person would recognise it. */
export interface StepRef {
  readonly nodeId: string;
  readonly nodeLabel: string;
  /** 1-based: the second visit to a node is a different step from the first. */
  readonly occurrence: number;
  readonly callId: number;
  readonly work: StepWork;
}

export function sameStep(left: StepRef | null, right: StepRef | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return (
    left.nodeId === right.nodeId &&
    left.occurrence === right.occurrence &&
    left.callId === right.callId
  );
}

/**
 * Everything that decides whether the next work step starts.
 *
 * Five fields and no sixth. Anything derived — the phase, the sentence, which buttons
 * are offered — is a function of these, so there is nothing for a second derivation to
 * disagree with.
 */
export interface LoopControlState {
  readonly mode: LoopMode;
  /** The user has asked to pause. Says nothing about whether the run has stopped. */
  readonly pauseRequested: boolean;
  /**
   * The work step that is actually running, or `null`.
   *
   * The single source of "work is in flight". Set when the runner starts a step and
   * cleared when the runner reports it ended, which is the honest transition: the step
   * ending is the event, the request is not.
   */
  readonly inFlight: StepRef | null;
  /** A work step the runner has asked about and has not been allowed to start. */
  readonly held: StepRef | null;
  /** The user has released one work step, not yet consumed. Never more than one. */
  readonly released: boolean;
}

export function initialControlState(mode: LoopMode = DEFAULT_LOOP_MODE): LoopControlState {
  return { mode, pauseRequested: false, inFlight: null, held: null, released: false };
}

/**
 * The state a new run begins in.
 *
 * The mode survives, because it is the user's standing answer to who decides the next
 * step. A pause request does not: it was about the run that has since ended, and a new
 * run that paused itself before its first step because of a button pressed during the
 * previous one would be a surprise nobody asked for.
 */
export function controlForNewRun(state: LoopControlState): LoopControlState {
  return initialControlState(state.mode);
}

export type LoopControlAction =
  | { readonly kind: 'request-pause' }
  /** One act: clear any pause and let exactly one held work step start. */
  | { readonly kind: 'continue' }
  | { readonly kind: 'set-mode'; readonly mode: LoopMode }
  | { readonly kind: 'step-held'; readonly step: StepRef }
  | { readonly kind: 'step-started'; readonly step: StepRef }
  | { readonly kind: 'step-ended'; readonly step: StepRef };

/**
 * Apply one thing that happened.
 *
 * `set-mode` touches `mode` and nothing else, which is DSP-30 #4 expressed where it can
 * be checked: the mandate, the graph version, the history, the results and the budgets
 * are not in this state at all, so switching mode has nothing to reset even by mistake.
 *
 * `step-ended` is guarded rather than unconditional, the way `LoopRunAudience.end` is:
 * a late report from a step that is no longer the one in flight must not clear the
 * current one and let the product say the run has stopped while it has not.
 */
export function applyControlAction(
  state: LoopControlState,
  action: LoopControlAction,
): LoopControlState {
  switch (action.kind) {
    case 'request-pause':
      // A release granted a moment ago is withdrawn: the newer instruction is the
      // pause, and a step starting anyway would be the product ignoring the button.
      return { ...state, pauseRequested: true, released: false };
    case 'continue':
      return { ...state, pauseRequested: false, released: true, held: null };
    case 'set-mode':
      return { ...state, mode: action.mode };
    case 'step-held':
      return { ...state, held: action.step };
    case 'step-started':
      return { ...state, inFlight: action.step, held: null, released: false };
    case 'step-ended':
      return sameStep(state.inFlight, action.step) ? { ...state, inFlight: null } : state;
  }
}

/**
 * What the product says is going on.
 *
 * `paused` is unreachable while a step is in flight, and that is the whole point of
 * this function existing rather than each surface wording its own answer.
 */
export type ControlPhase =
  /** A work step is running and nothing has asked it to stop. */
  | 'running'
  /** A pause has been asked for and the work step has not ended yet. */
  | 'pause-requested'
  /** Asked for, and arrived: nothing is in flight and nothing new will start. */
  | 'paused'
  /** A work step is held, waiting for the person to release it. */
  | 'waiting-for-you'
  /** Nothing in flight, nothing held, nothing asked for. */
  | 'ready';

export function controlPhase(state: LoopControlState): ControlPhase {
  if (state.pauseRequested) {
    // The one line this module exists for. `inFlight` is cleared by the step ending
    // and by nothing else, so there is no path from "pause pressed" to "paused" that
    // does not go through the work actually stopping.
    return state.inFlight === null ? 'paused' : 'pause-requested';
  }
  if (state.inFlight !== null) {
    return 'running';
  }
  if (state.held !== null) {
    return 'waiting-for-you';
  }
  return 'ready';
}

/** Why a step is not starting. */
export type StepHold = 'pause' | 'interactive-mode' | 'human-node';

export type StepDecision =
  | { readonly start: true; readonly why: string }
  | {
      readonly start: false;
      readonly hold: StepHold;
      readonly why: string;
      /** What has to happen before this step can start, in one phrase. */
      readonly waitingFor: string;
    };

/**
 * May this step start, and if not, why not.
 *
 * The order of the tests is the content and is not arbitrary:
 *
 * 1. **Bookkeeping never waits.** Routing and terminals start no agent and run no
 *    command; asking about them would teach a person nothing and would train them to
 *    click through the prompts that matter.
 * 2. **A human node always waits**, in either mode, before the pause and the mode are
 *    even looked at — so no release token can let one through and no future edit to the
 *    mode rules can quietly make one autonomous (DSP-30 #3).
 * 3. **A pause outranks a release**, so a release granted just before the pause
 *    cannot start work after it.
 * 4. **A release is spent on one step**, which is what makes interactive mode a
 *    decision per step rather than a switch that turns autonomy back on.
 */
export function decideNextStep(state: LoopControlState, step: StepRef): StepDecision {
  if (step.work === 'bookkeeping') {
    return {
      start: true,
      why:
        `"${step.nodeLabel}" starts no agent and runs no command — it is the graph routing ` +
        `itself — so it does not wait for a decision.`,
    };
  }
  if (step.work === 'human') {
    return {
      start: false,
      hold: 'human-node',
      why:
        `"${step.nodeLabel}" is a human step, so it waits for an answer whichever way the ` +
        `run is set. That is what makes it a human step rather than a comment.`,
      waitingFor: 'an answer from a person',
    };
  }
  if (state.pauseRequested) {
    return {
      start: false,
      hold: 'pause',
      why:
        `A pause was asked for, so "${step.nodeLabel}" was not started. Steps that had already ` +
        `begun were left to finish, and nothing has been reset or repeated.`,
      waitingFor: 'you to continue the run',
    };
  }
  if (state.released) {
    return {
      start: true,
      why: `You released this step, so "${step.nodeLabel}" started.`,
    };
  }
  if (state.mode === 'interactive') {
    return {
      start: false,
      hold: 'interactive-mode',
      why:
        `You are working interactively, so DSpatch asks before ${describeWork(step)}. ` +
        `The run is otherwise exactly where it was: nothing was reset and no step will be repeated.`,
      waitingFor: 'you to let this step start',
    };
  }
  return {
    start: true,
    why: `The run is autonomous and within the graph's rules, so "${step.nodeLabel}" started.`,
  };
}

/** What this step would do, as a phrase that fits after "before". */
function describeWork(step: StepRef): string {
  switch (step.work) {
    case 'agent':
      return `starting the agent for "${step.nodeLabel}"`;
    case 'command':
      return `running the command for "${step.nodeLabel}"`;
    case 'external':
      return `handing "${step.nodeLabel}" to a participant it does not run`;
    case 'human':
      return `asking a person about "${step.nodeLabel}"`;
    case 'bookkeeping':
      return `walking on from "${step.nodeLabel}"`;
  }
}

/** What is still happening, for the sentence that must not claim a pause. */
function describeInFlight(step: StepRef): string {
  switch (step.work) {
    case 'agent':
      return `the agent for "${step.nodeLabel}" is still writing`;
    case 'command':
      return `the command for "${step.nodeLabel}" is still running`;
    case 'external':
      return `"${step.nodeLabel}" is still with a participant DSpatch does not run`;
    case 'human':
    case 'bookkeeping':
      return `"${step.nodeLabel}" has not finished`;
  }
}

export interface ControlReport {
  readonly phase: ControlPhase;
  /** Two or three words, and the one place a pause may be claimed. */
  readonly headline: string;
  readonly detail: string;
}

/**
 * The sentences a person reads.
 *
 * The `pause-requested` text deliberately does not contain the word *paused* in any
 * form. The rule this project keeps breaking is not that the wrong word gets used, it
 * is that a hopeful word gets used early; a sentence that has to explain that it does
 * not mean what it says is a sentence that will be skimmed as if it did.
 */
export function describeControl(
  state: LoopControlState,
  options: { readonly runActive: boolean } = { runActive: true },
): ControlReport {
  const phase = controlPhase(state);
  if (!options.runActive) {
    return {
      phase,
      headline: state.mode === 'interactive' ? 'Interactive' : 'Autonomous',
      detail:
        state.mode === 'interactive'
          ? 'No loop is running. When one is, DSpatch will ask you before it starts an agent or runs a command.'
          : 'No loop is running. When one is, it will continue within the graph and the mandate it is given.',
    };
  }
  switch (phase) {
    case 'pause-requested':
      return {
        phase,
        headline: 'Pause requested',
        detail:
          `The run has not stopped yet: ${describeInFlight(state.inFlight as StepRef)}. DSpatch ` +
          `waits for that step to end and then stops before starting another — it does not stop ` +
          `on a timer, and it does not report a stop it has not reached. To stop work that is ` +
          `already in progress, use Cancel instead; that is a different action and it abandons ` +
          `what is in flight.`,
      };
    case 'paused':
      return {
        phase,
        headline: 'Paused',
        detail:
          `No work step is running and no new one will be started until you continue. Everything ` +
          `that finished stands: nothing was reset, and continuing repeats no step.`,
      };
    case 'running':
      return {
        phase,
        headline: 'Running',
        detail:
          `${capitalise(describeInFlight(state.inFlight as StepRef))}. ${
            state.mode === 'interactive'
              ? 'You will be asked before the next agent or command starts.'
              : 'The run continues on its own within the graph and the mandate it has.'
          }`,
      };
    case 'waiting-for-you': {
      const held = state.held as StepRef;
      return {
        phase,
        headline: 'Waiting for you',
        detail:
          held.work === 'human'
            ? `"${held.nodeLabel}" is a human step and waits for an answer either way.`
            : `DSpatch is asking before ${describeWork(held)}. Nothing has been reset and no ` +
              `finished step will be repeated.`,
      };
    }
    case 'ready':
      return {
        phase,
        headline: state.mode === 'interactive' ? 'Interactive' : 'Autonomous',
        detail:
          state.mode === 'interactive'
            ? 'The run is walking. DSpatch will ask you before it starts an agent or runs a command.'
            : 'The run is walking within the graph and the mandate it has.',
      };
  }
}

function capitalise(text: string): string {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

/**
 * One sentence for each mode, so the two windows word the choice identically.
 *
 * The labels read as the end of the sentence the chooser's own label begins — *agent
 * and command steps* **start on their own**, or **wait for me**. Naming the two modes
 * *Autonomous* and *Interactive* said something true about the run and nothing at all
 * about what the setting does, which is how it came to be read as a second switch for
 * turning the loop on.
 */
export const LOOP_MODE_CHOICES: readonly {
  readonly mode: LoopMode;
  readonly label: string;
  readonly title: string;
}[] = [
  {
    mode: 'autonomous',
    label: 'start on their own',
    title:
      'A step that starts an agent, runs a command or hands work outside begins within the ' +
      'graph rules and the mandate the run already has. An explicit human step still waits ' +
      'for an answer.',
  },
  {
    mode: 'interactive',
    label: 'wait for me',
    title:
      'DSpatch asks before each step that starts an agent, runs a command or hands work ' +
      'outside, and letting one through is spent on that step, so the next one asks again. ' +
      'Routing from one step to the next is not held: approving that would tell you nothing.',
  },
];

/**
 * What every window is told about the control, and all it needs.
 *
 * The state, not the sentences. Each window derives what it shows with the functions
 * above, so the chat and the graph view cannot word the same run differently — and a
 * window that opens halfway through gets the same answer as one that was there.
 */
export interface LoopControlReport {
  /** The run being controlled, or `null` when nothing is running. */
  readonly runId: string | null;
  readonly state: LoopControlState;
}

/** What a press of one of these buttons achieved, in the words the window shows. */
export interface LoopControlOutcome {
  readonly accepted: boolean;
  readonly note: string;
  readonly report: LoopControlReport;
}

export interface ControlActionOffer {
  readonly id: 'pause' | 'continue';
  readonly label: string;
  readonly enabled: boolean;
  readonly title: string;
}

/**
 * Which of the two buttons can do anything, and what the other one would need.
 *
 * Derived here rather than in each window so the chat and the graph view cannot offer
 * a person different answers about the same run.
 */
export function controlActionsFor(
  state: LoopControlState,
  options: { readonly runActive: boolean },
): readonly ControlActionOffer[] {
  const releasable = state.held !== null && state.held.work !== 'human';
  return [
    {
      id: 'pause',
      label: 'Pause',
      enabled: options.runActive && !state.pauseRequested,
      title: options.runActive
        ? 'Let the step that is running finish, then stop before starting another. Cancel is the separate action for abandoning work in progress.'
        : 'There is no run to pause.',
    },
    {
      id: 'continue',
      label: 'Continue',
      enabled: options.runActive && (state.pauseRequested || releasable),
      title: options.runActive
        ? 'Let the run start its next work step. Completed steps are not repeated.'
        : 'There is no run to continue.',
    },
  ];
}
