import type { PairWindowCheckRequest, ScriptedRunPlan, ScriptedRunReport } from '../shared/bridge';
import type { WorkspaceView } from '../shared/workspace-folders';
import { nodeRunStates } from '../shared/loop-run-view';
import {
  checkAnswerGrewWhileStreaming,
  checkDeletedProseIsGone,
  checkFolderTree,
  checkLoopFiledAndHandedOver,
  checkNeverSilentWhileAnswering,
  checkSelectionIsInert,
  checkStopSaysNothingExtra,
  checkWorkingRootsReadHonestly,
  checkWorkspaceReopened,
  checkCaptureCanShowTheNode,
  checkEndingMarkFollowsTheOutcome,
  checkEndingMarkLastsAsLongAsItIsTrue,
  checkGlintKeepsTheNodesSize,
  checkGlintSurvivesSilence,
  checkGlintFrameIsWorthReading,
  checkLivenessStates,
  checkPulseCarriesFurther,
  checkReducedMotionIsStill,
  PULSE_RANGE_BEFORE,
  type EndingObservation,
  type GlintFootprint,
  type LivenessState,
  type SilenceSample,
  type GateVerdict,
  checkComposerKeysBehave,
  checkConnectionNamesAnAccount,
  checkConversationScrollsWell,
  checkErrorReadsWell,
  checkInterruptedRunKeepsItsWork,
  checkMessageJoinedTheRun,
  checkOneThreadWithHandover,
  checkRepliesRenderMarkdown,
  checkUserMessageLooksLikeTheReference,
  checkWindowFollowsItsWidth,
  checkWindowGivesTheConversationTheSpace,
  type DeletedProseObservation,
  type MarkdownObservation,
  type PlainErrorObservation,
  type StopAsAskedObservation,
  type StopSample,
  type StreamingSilenceSample,
  type ScrollObservation,
  type WindowShapeObservation,
  type StreamingGateVerdict,
} from './workflow-gates';

/**
 * Drive the window through the whole workflow and record what reached the DOM.
 *
 * This exists to answer one question honestly: does the **window** do the work,
 * or only the main process? So the script does not call the bridge. It finds the
 * real controls by their `data-ev` attribute, clicks them, types into the real
 * composer and then reads text out of the rendered document. If a value is in
 * here, the window displayed it.
 *
 * What it is not: a judgement of the interface. It cannot see layout, colour,
 * legibility or whether any of this is pleasant to use. Niclas decides that.
 *
 * Exit codes start at 30. The smoke test owns 0–4 and the connection probe 10–19.
 */

const CHAT_EXIT = {
  ok: 0,
  notConnected: 30,
  sessionFailed: 31,
  streamingNotDemonstrated: 32,
  followUpNotProven: 33,
  fileNotChanged: 34,
  testEvidenceMissing: 35,
  cancelNotDemonstrated: 36,
  scriptFailed: 37,
  /** Codes 40+ belong to the diff and build/test scenario. */
  diffMissing: 40,
  stalenessNotShown: 41,
  plantedBytesMissing: 42,
  ignoredFileLeaked: 43,
  limitationNotShown: 44,
  /** Codes 50+ belong to the conversation scenario: §10's trials 4, 10 and 11. */
  keysDoNotBehave: 50,
  threadIsNotOneConversation: 51,
  messageDidNotJoinTheRun: 52,
  interruptionLostTheWork: 53,
  loopRunNeverStarted: 54,
  /** Codes 60+ belong to the presentation scenario: §10's trials 13 and 14. */
  conversationJumped: 60,
  repliesNotRendered: 61,
  chromeInTheWay: 62,
  /** Code 63 belongs to the error-presentation scenario: DSP-64. */
  errorNotActionable: 63,
  /** 64 and 65 belong to the presentation scenario's two DSP-65 gates. */
  messageBoxNotLikeTheReference: 64,
  widthNotFollowed: 65,
  /** 66 belongs to the reopen scenario: §10 trial 8. */
  conversationDidNotComeBack: 66,
  /** 67 belongs to DSP-70: the graph on screen is not the one that was chosen. */
  chosenLoopNotShown: 67,
  /** 68–70 belong to DSP-71 and DSP-73: the folders, the tree and the reading view. */
  treeDoesNotRead: 68,
  selectionSteeredTheWork: 69,
  workspaceDidNotComeBack: 70,
  /** 71 belongs to DSP-72: the roots, or what the window says they are, read wrong. */
  workingRootsReadWrong: 71,
  /** 72 belongs to DSP-79: the window's loop filed no result, or handed nothing over. */
  loopFiledNothing: 72,
  /** 73 belongs to DSP-84: opened, chosen and run were not one loop. */
  choiceDidNotCarry: 73,
  /** 74 belongs to DSP-86: the one graph view did not survive a run passing through it. */
  oneViewDidNotHold: 74,
  /** 75 belongs to DSP-87: the window called a run silent while its reply was arriving. */
  silenceClaimedWhileAnswering: 75,
  /** 76: a passage the same card deletes was still in the document. */
  deletedProseStillOnScreen: 76,
  /** 77 belongs to DSP-88: a switch took an unsaved drawing away without being told to. */
  unsavedEditsWereLost: 77,
  /** 78 belongs to DSP-80: the states a run passes through did not read as themselves. */
  livenessDidNotRead: 78,
  /** 79 belongs to DSP-36: the mark where a run ended was wrong, or outlived its truth. */
  endingMarkWasWrong: 79,
  /** 80 belongs to DSP-80's second pass: the light along the glint, or the pulse's range. */
  theLightIsWrong: 80,
  /** 81 belongs to DSP-90: a stop the person asked for was explained to them anyway. */
  stopWasExplainedAnyway: 81,
  /** 82–86 belong to DSP-4 WS-1: saved conversations switched between, and a restart. */
  switchHistoryWrong: 82,
  switchDiffWrong: 83,
  switchSharedIdWrong: 84,
  switchRunAgainFailed: 85,
  switchRestartWrong: 86,
  /**
   * 87–89 belong to DSP-121: the refused or failed resume state and its choices.
   * 89 is set by the main process when its own record contradicts the window.
   */
  resumeStateNotShown: 87,
  resumeChoiceWrong: 88,
  /**
   * 90 belongs to DSP-124, the `ok` phase of `resume-choice`: *Send anyway* did not
   * send the draft once with the outcome-unknown turn acknowledged, or Enter got past
   * the gate without that choice.
   */
  sendAnywayWrong: 90,
  /**
   * 92–97 belong to DSP-126, review opened from the chat as a separate window (91 is
   * `review-direct`'s, set by the main process). The lowest failed one is the exit.
   */
  reviewWindowWrong: 92,
  reviewTouchedTheChat: 93,
  reviewIdentityLost: 94,
  reviewPositionLost: 95,
  reviewBoundaryWrong: 96,
  reviewTouchedLoops: 97,
  /**
   * 98-103 belong to DSP-127, the discussion in the review window. The lowest failed
   * one is the exit; 92 and 97 are reused for the window and loop checks it repeats.
   */
  reviewDiscussionMisplaced: 98,
  reviewDiscussionSentWrong: 99,
  reviewDiscussionStopWrong: 100,
  reviewDiscussionTouchedChat: 101,
  reviewDiscussionDraftLost: 102,
  reviewDiscussionLooksWrong: 103,
} as const;

const CHANGE_REQUEST =
  'In this repository, `src/duration.ts` exports `formatDuration`, which currently ' +
  'handles seconds only. Complete it so that the existing tests pass. The tests in ' +
  '`test/duration.test.ts` are the specification — read them. ' +
  'Edit `src/duration.ts` and nothing else: do not modify any test file, do not add ' +
  'dependencies, and do not run any commands. Reply with the single word DONE when ' +
  'the file is saved.';

const CANCEL_PROMPT =
  'Create 12 files in a subdirectory named scratch of this repository, named ' +
  'scratch/note-01.txt through scratch/note-12.txt. Each file must contain its own ' +
  'number written in English words and nothing else. Create them one at a time, in ' +
  'order, one tool call per file. Do not modify any existing file.';

function element(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-ev="${name}"]`);
}

function textOf(name: string): string {
  return (element(name)?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Whether the window is past its connection check, or has none to make yet (DSP-149):
 * the start page has no session details and checks no connection before a session.
 */
function connectionDecided(): boolean {
  return (
    element('start-page') !== null ||
    ['connected', 'not-connected', 'error'].includes(textOf('connection-kind'))
  );
}

function attributeOf(name: string, attribute: string): string {
  return element(name)?.getAttribute(attribute) ?? '';
}

/**
 * Whether the loop run at `index` has reported an end.
 *
 * Read from the run's own badge, and **not** from `run-standing`, which is what every
 * script here used to wait on. That element is now drawn only when a run has
 * something a person must act on (DSP-90), so an ordinary run that ended cleanly no
 * longer produces one at all — and `data-standing === 'stopped'` would therefore be
 * waited for until the timeout, reporting the product's correctness as a hang.
 *
 * The badge cannot go away: it is drawn for every loop turn in every state, and reads
 * `running …` for exactly as long as the turn has no ending. Same fact, from the
 * element that is not conditional on it.
 */
function loopRunEnded(index: number): boolean {
  const badge = textOf(`loop-turn-${String(index)}-status`);
  return badge !== '' && !badge.toLowerCase().startsWith('running');
}

/** The same, for the newest run in the window. `false` when there is none. */
function newestLoopRunEnded(): boolean {
  const entries = countEntries('loop-turn');
  return entries > 0 && loopRunEnded(entries - 1);
}

/**
 * Whether a `<details>` is open.
 *
 * The property and not `getAttribute('open')`: a boolean attribute reads back as `''`
 * when it is present, which `attributeOf` cannot tell from absent.
 */
function detailsOpen(name: string): boolean {
  const found = element(name);
  return found instanceof HTMLDetailsElement && found.open;
}

/**
 * The same reading, but only when the element is inside the conversation thread.
 *
 * `''` for an element that exists somewhere else in the window, which is what makes
 * §9's "one continuous thread" checkable rather than assumed: a message drawn in a
 * pending-instructions panel beside the conversation would be found by `textOf` and
 * missed by this, and the thread gate reports it as missing from the thread.
 */
function textInThread(name: string): string {
  const thread = element('transcript');
  const found = element(name);
  if (thread === null || found === null || !thread.contains(found)) {
    return '';
  }
  return (found.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function rawTextOf(name: string): string {
  return element(name)?.textContent ?? '';
}

/**
 * How a turn ended, from the turn's own `data-status`.
 *
 * It used to be read from the badge under the reply, and the badge is gone for a reply
 * that ended normally with text — DSP-65's decision that *finished* is a mark saying
 * what an answer being there already says. Reading the attribute keeps every assertion
 * about how a turn ended exactly as strong as it was, without requiring the window to
 * draw furniture for the script's benefit.
 *
 * `''` when there is no such turn, which is what the callers already treat as "not
 * this state" — a turn that never appeared cannot have finished.
 */
function statusOfTurn(index: number): string {
  return element(`turn-${String(index)}`)?.getAttribute('data-status') ?? '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait for a condition about the document, or throw naming what never happened. */
async function waitFor(
  description: string,
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(
        `timed out after ${String(Math.round(performance.now() - startedAt))} ms ` +
          `waiting for: ${description}. This is a timeout, not a verdict.`,
      );
    }
    await sleep(intervalMs);
  }
}

/** Click a real control, once it exists and is enabled. */
async function click(name: string, timeoutMs = 60_000): Promise<void> {
  await waitFor(
    `control "${name}" to exist and be enabled`,
    () => {
      const found = element(name);
      return found instanceof HTMLButtonElement && !found.disabled;
    },
    timeoutMs,
  );
  (element(name) as HTMLButtonElement).click();
}

/**
 * Click something that is not a button.
 *
 * A `<summary>` is the disclosure control for `<details>`, and `click` above requires
 * an `HTMLButtonElement` — which is right for the controls it drives and is why this
 * is separate rather than a loosened version of it. Clicking a summary is what opens
 * the technical detail behind an error, and it is a real click: the browser does the
 * toggling, not the script.
 */
async function clickAny(name: string, timeoutMs = 10_000): Promise<void> {
  await waitFor(`element "${name}" to exist`, () => element(name) !== null, timeoutMs);
  (element(name) as HTMLElement).click();
}

/**
 * Type into the real composer.
 *
 * React owns the value, so assigning `element.value` would be ignored on the next
 * render. The native setter plus a bubbling `input` event is what a keystroke
 * looks like from React's side.
 */
async function typeInto(name: string, value: string): Promise<void> {
  await waitFor(
    `composer "${name}" to be enabled`,
    () => {
      const found = element(name);
      return found instanceof HTMLTextAreaElement && !found.disabled;
    },
    60_000,
  );
  const field = element(name) as HTMLTextAreaElement;
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  );
  descriptor?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(
    'the composer to hold the typed text',
    () => (element(name) as HTMLTextAreaElement | null)?.value === value,
    10_000,
  );
}

/**
 * Press a key in the real composer and say whether the window cancelled it.
 *
 * `defaultPrevented` is the only part of the keyboard contract a script can observe.
 * A dispatched event is untrusted, so Chromium performs no default action for it and
 * the line break Shift+Enter is supposed to insert never appears however correct the
 * window is — that is a property of the instrument and is reported as one. What the
 * window *does* own is whether it takes the key away from the textarea, and that is
 * what this returns.
 */
async function pressKeyInComposer(
  name: string,
  key: string,
  modifiers: { readonly shiftKey: boolean },
): Promise<boolean> {
  await waitFor(
    `composer "${name}" to exist for a keypress`,
    () => element(name) instanceof HTMLTextAreaElement,
    60_000,
  );
  const field = element(name) as HTMLTextAreaElement;
  field.focus();
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey: modifiers.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  field.dispatchEvent(event);
  return event.defaultPrevented;
}

/**
 * Send what is in the composer, the way a person does it.
 *
 * Enter in the box, because there is no longer a button to click: DSP-65 removed it on
 * Niclas's decision that Enter is the send. This is a stronger check than the click it
 * replaces — every scripted run now exercises the keystroke the window actually depends
 * on, rather than the control beside it.
 *
 * Waits for the composer to hold the text first, so a send is never dispatched at an
 * empty box and then reported as a window that ignored it.
 */
async function sendFromComposer(): Promise<void> {
  await waitFor(
    'the composer to hold text to send',
    () => {
      const found = element('prompt');
      return found instanceof HTMLTextAreaElement && !found.disabled && found.value !== '';
    },
    60_000,
  );
  await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
}

/**
 * Press, move and release across an element, and say how much got selected.
 *
 * The one thing the folding message has to get right and cannot be asked about any
 * other way: a drag ends in a `click` event on the element, so the only difference
 * between selecting a sentence and tapping the box is the distance the pointer
 * travelled. Both are dispatched here, in order, with real coordinates — and the
 * selection is made through a `Range`, because a dispatched pointer event is untrusted
 * and Chromium performs no selection for it. Returns the characters selected, so a
 * trial where nothing was selected reports itself rather than passing.
 */
function dragAcross(name: string): number {
  const target = element(name);
  if (target === null) {
    return 0;
  }
  const box = target.getBoundingClientRect();
  const from = { x: box.left + 12, y: box.top + 10 };
  const to = { x: box.left + box.width - 24, y: box.top + 10 };
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y }),
  );
  const selection = window.getSelection();
  if (selection !== null && target.firstChild !== null) {
    const range = document.createRange();
    range.setStart(target.firstChild, 0);
    range.setEnd(target.firstChild, Math.min(80, target.textContent?.length ?? 0));
    selection.removeAllRanges();
    selection.addRange(range);
  }
  target.dispatchEvent(
    new PointerEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y }),
  );
  target.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: to.x, clientY: to.y }),
  );
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 1, clientX: to.x, clientY: to.y }),
  );
  return window.getSelection()?.toString().length ?? 0;
}

/** The width of an element's text, inside its own padding. */
function textColumnWidth(target: HTMLElement | null): number {
  if (target === null) {
    return 0;
  }
  const style = getComputedStyle(target);
  return (
    target.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  );
}

/**
 * The colour actually behind the conversation.
 *
 * The thread paints no background of its own, so reading its own computed colour
 * answers `rgba(0, 0, 0, 0)` — and comparing a box against transparent black would
 * make any box on any surface look clearly lighter. The first ancestor that paints is
 * the surface a person sees.
 */
function conversationSurface(): string {
  let node: HTMLElement | null = element('transcript');
  while (node !== null) {
    const colour = getComputedStyle(node).backgroundColor;
    if (!/rgba\([^)]*,\s*0\s*\)$/.test(colour)) {
      return colour;
    }
    node = node.parentElement;
  }
  return '';
}

/** Press and release in the same place: the click the box is supposed to answer. */
function clickInside(name: string): void {
  const target = element(name);
  if (target === null) {
    return;
  }
  const box = target.getBoundingClientRect();
  const at = { x: box.left + 20, y: box.top + 12 };
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: at.x, clientY: at.y }),
  );
  target.dispatchEvent(
    new PointerEvent('pointerup', { bubbles: true, clientX: at.x, clientY: at.y }),
  );
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 1, clientX: at.x, clientY: at.y }),
  );
}

/** Click a real checkbox, which is not a button and so not `click` above. */
async function setCheckbox(name: string, checked: boolean): Promise<boolean> {
  await waitFor(
    `checkbox "${name}" to exist and be enabled`,
    () => {
      const found = element(name);
      return found instanceof HTMLInputElement && !found.disabled;
    },
    60_000,
  );
  const box = element(name) as HTMLInputElement;
  if (box.checked !== checked) {
    box.click();
  }
  await waitFor(
    `checkbox "${name}" to read ${String(checked)}`,
    () => (element(name) as HTMLInputElement | null)?.checked === checked,
    10_000,
  );
  return (element(name) as HTMLInputElement).checked;
}

/**
 * Type into a real single-line field.
 *
 * Same reasoning as the composer: React owns the value, so a plain assignment is
 * discarded on the next render. The native setter plus a bubbling `input` event
 * is what a keystroke looks like from React's side, which is the point — the
 * evidence has to be that the window's own field accepted the text.
 */
async function typeIntoField(name: string, value: string): Promise<void> {
  await waitFor(
    `field "${name}" to be enabled`,
    () => {
      const found = element(name);
      return found instanceof HTMLInputElement && !found.disabled;
    },
    60_000,
  );
  const field = element(name) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(
    `the field "${name}" to hold the typed text`,
    () => (element(name) as HTMLInputElement | null)?.value === value,
    10_000,
  );
}

/**
 * How often the answer element is measured while a turn streams.
 *
 * One animation frame, because that is the finest granularity at which the DOM
 * can visibly change: React cannot paint more often than that, so sampling
 * faster measures nothing extra.
 *
 * It was 80 ms, and 80 ms is not enough. On 14 September 2026 a turn delivered
 * 19 `assistant.delta` events totalling 229 characters, and the sampler saw only
 * the placeholder and the finished answer — two lengths, one of them substantive
 * — so the streaming gate rejected a turn that had demonstrably streamed. The
 * rule is unchanged; a sampler too slow to see the phenomenon it is looking for
 * produces a false negative, and that is a defect in the instrument.
 */
const STREAM_SAMPLE_INTERVAL_MS = 16;

interface Sample {
  readonly atMs: number;
  readonly answerChars: number;
  readonly statusText: string;
  readonly toolsFinished: string;
}

interface TurnObservation {
  readonly label: string;
  readonly index: number;
  readonly promptShownInWindow: string;
  readonly samplesWhileStreaming: readonly Sample[];
  readonly distinctAnswerLengths: number;
  readonly distinctSampleTimes: number;
  readonly grewWhileStreaming: boolean;
  /**
   * The gate's own reading of the samples. `distinctAnswerLengths` above counts
   * the `…` placeholder, which every streaming turn produces; this does not.
   */
  readonly streamingVerdict: StreamingGateVerdict;
  readonly finalStatusText: string;
  readonly finalAnswer: string;
  readonly deltaText: string;
  readonly toolText: string;
  readonly tokenText: string;
  readonly cancelClickedAtMs: number | null;
  readonly toolsFinishedAtCancel: string | null;
}

/**
 * Send one prompt through the composer and watch the DOM until the turn ends.
 *
 * The samples are the streaming evidence: the answer element's text length taken
 * repeatedly while the turn is still marked streaming. A single blob would show
 * one length; incremental rendering shows several.
 */
async function runTurn(
  label: string,
  prompt: string,
  index: number,
  turnTimeoutMs: number,
  cancelAfterFirstToolFinished: boolean,
): Promise<TurnObservation> {
  await typeInto('prompt', prompt);
  const startedAt = performance.now();
  await sendFromComposer();

  await waitFor(
    `turn ${label} to start streaming`,
    // The answer element, not the status badge: an ordinary finished turn no longer
    // draws one, and a turn that has appeared always has somewhere for its answer.
    () => element('active-answer') !== null || element(`turn-${String(index)}`) !== null,
    turnTimeoutMs,
  );

  const samples: Sample[] = [];
  let cancelClickedAtMs: number | null = null;
  let toolsFinishedAtCancel: string | null = null;

  while (element('active-answer') !== null) {
    if (performance.now() - startedAt > turnTimeoutMs) {
      throw new Error(
        `turn ${label} was still streaming after ${String(turnTimeoutMs)} ms. ` +
          'This is a timeout, not a verdict: the run may still be going.',
      );
    }
    const sample: Sample = {
      atMs: Math.round(performance.now() - startedAt),
      answerChars: rawTextOf('active-answer').length,
      statusText: textOf('active-turn-status'),
      toolsFinished: textOf('active-tools-finished'),
    };
    const previous = samples[samples.length - 1];
    if (previous === undefined || previous.answerChars !== sample.answerChars) {
      samples.push(sample);
    }
    if (
      cancelAfterFirstToolFinished &&
      cancelClickedAtMs === null &&
      Number.parseInt(sample.toolsFinished, 10) >= 1
    ) {
      // Deliberately after the first finished tool call, not after the first text
      // fragment. Substep 6 cancelled too early to see whether the provider kept
      // working; a finished tool call means work is under way and any further work
      // will be visible on disk.
      toolsFinishedAtCancel = sample.toolsFinished;
      cancelClickedAtMs = Math.round(performance.now() - startedAt);
      await click('cancel');
    }
    await sleep(STREAM_SAMPLE_INTERVAL_MS);
  }

  const finalStatusText = statusOfTurn(index);
  return {
    label,
    index,
    promptShownInWindow: textOf(`turn-${String(index)}-prompt`),
    samplesWhileStreaming: samples,
    distinctAnswerLengths: new Set(samples.map((s) => s.answerChars)).size,
    distinctSampleTimes: new Set(samples.map((s) => s.atMs)).size,
    grewWhileStreaming: samples.some(
      (sample, at) => at > 0 && sample.answerChars > (samples[at - 1]?.answerChars ?? 0),
    ),
    streamingVerdict: checkAnswerGrewWhileStreaming(samples),
    finalStatusText,
    finalAnswer: rawTextOf(`turn-${String(index)}-answer`),
    deltaText: textOf(`turn-${String(index)}-deltas`),
    toolText: textOf(`turn-${String(index)}-tools`),
    tokenText: textOf(`turn-${String(index)}-tokens`),
    cancelClickedAtMs,
    toolsFinishedAtCancel,
  };
}

/** Click "Run the working copy tests" and wait for a result that is not the old one. */
async function runTest(label: string): Promise<Record<string, unknown>> {
  const before = textOf('test-result');
  await click('run-test');
  await waitFor(
    `a new test result for ${label}`,
    () => element('test-exit-code') !== null && textOf('test-result') !== before,
    180_000,
  );
  const stdout = rawTextOf('test-stdout');
  return {
    label,
    exitCodeShown: textOf('test-exit-code'),
    stdoutChars: stdout.length,
    stdoutFirstLine: stdout.split('\n')[0] ?? '',
    // The tail carries Node's own pass/fail summary, so the window is shown to
    // have displayed the outcome and not merely some output.
    stdoutTail: stdout.slice(-320),
    stderrShown: element('test-stderr') !== null,
  };
}

function newNonce(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length] ?? 'X').join('');
}

/**
 * DSP-136: the agent every scripted scenario runs as, named here rather than assumed.
 * The replies come from the presentation adapter whichever agent is named; Cursor is
 * named because the scenarios were written against its behaviour (resume, model list).
 */
const SCENARIO_AGENT = 'cursor';

/**
 * Choose the scenario's agent in *Open a project* when nothing is chosen yet (a fresh
 * user-data folder; the seeded kits name it themselves). Done through the real control,
 * as a person would. Scenarios with no chat window, or that start elsewhere, skip it.
 */
async function nameScenarioAgent(): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10_000) {
    const list = element('open-agent-select');
    if (list instanceof HTMLSelectElement) {
      if (list.value === '') {
        await chooseInSelect('open-agent-select', SCENARIO_AGENT);
      }
      return;
    }
    await sleep(50);
  }
}

export async function runScriptedWorkflow(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  // DSP-149: `model-list` chooses Claude itself and must never choose Cursor. DSP-152:
  // `review-agent-choice` starts from the kit's own choice of Claude, usable or not.
  if (plan.scenario !== 'review-direct' && plan.scenario !== 'model-list' && plan.scenario !== 'model-start' && plan.scenario !== 'model-flow' && plan.scenario !== 'review-agent-choice' && plan.scenario !== 'walk-start' && plan.scenario !== 'analysis-access' && plan.scenario !== 'diff-marks' && plan.scenario !== 'review-flow') {
    await nameScenarioAgent();
  }
  switch (plan.scenario) {
    case 'interactive-chat':
      return runInteractiveChatScenario(plan);
    case 'review-and-test':
      return runReviewAndTestScenario(plan);
    case 'conversation-during-work':
      return runConversationDuringWorkScenario(plan);
    case 'presentation':
      return runPresentationScenario(plan);
    case 'conversation-comes-back':
      return runConversationComesBackScenario(plan);
    case 'errors-read-well':
      return runErrorsReadWellScenario(plan);
    case 'chosen-loop-runs':
      return runChosenLoopScenario(plan);
    case 'chat-loop-files-a-result':
      return runLoopFilesAResultScenario(plan);
    case 'loop-open-choose-run':
      return runOpenChooseRunScenario(plan);
    case 'folders-and-a-tree':
      return runFoldersAndTreeScenario(plan);
    case 'several-working-roots':
      return runSeveralWorkingRootsScenario(plan);
    case 'one-graph-view':
      return runOneGraphViewScenario(plan);
    case 'chat-says-less':
      return runChatSaysLessScenario(plan);
    case 'stop-i-asked-for':
      return runStopIAskedForScenario(plan);
    case 'unsaved-edits-survive-a-switch':
      return runUnsavedEditsSurviveASwitchScenario(plan);
    case 'liveness-and-an-ending':
      return runLivenessAndAnEndingScenario(plan);
    case 'how-the-liveness-looks':
      return runHowTheLivenessLooksScenario(plan);
    case 'workspace-switch':
      return runWorkspaceSwitchScenario(plan);
    case 'resume-choice':
      return runResumeChoiceScenario(plan);
    case 'review-window':
      return runReviewWindowScenario(plan);
    case 'review-discussion':
      return runReviewDiscussionScenario(plan);
    case 'review-hold':
      return runReviewHoldScenario(plan);
    case 'workspace-flow':
      return runWorkspaceFlowScenario(plan);
    case 'model-list':
      return runModelListScenario(plan);
    case 'model-start':
      return runModelStartScenario(plan);
    case 'model-flow':
      return runModelFlowScenario(plan);
    case 'steering':
      return runSteeringScenario(plan);
    case 'editor-uncertain':
      return runEditorUncertainScenario(plan);
    case 'steering-placement':
      return runSteeringPlacementScenario(plan);
    case 'editor-joins-run':
      return runEditorJoinsRunScenario(plan);
    case 'pair-review':
      return runPairReviewScenario(plan);
    case 'code-walks':
      return runCodeWalksScenario(plan);
    case 'review-agent-choice':
      return runReviewAgentChoiceScenario(plan);
    case 'walk-start':
      return runWalkStartScenario(plan);
    case 'analysis-access':
      return runAnalysisAccessScenario(plan);
    case 'diff-marks':
      return runDiffMarksScenario(plan);
    case 'review-flow':
      return runReviewFlowScenario(plan);
    case 'review-direct':
      // Driven by the main process alone: there is no chat window to run this in.
      return finish(CHAT_EXIT.scriptFailed, [], ['review-direct has no chat window and is not run here'], { plan });
    default:
      return runFullWorkflow(plan);
  }
}

/* ------------------------------------------------------------------------- */
/* Errors a person can act on: DSP-64, in the window, with no provider call   */
/* ------------------------------------------------------------------------- */

/**
 * The refusal on screen, read as a person meets it.
 *
 * Driven by pointing `DSPATCH_CHAT_WORKSPACE` at a folder DSpatch did not generate
 * and asking for a sample project. That produces two things at once, which is why
 * this is one scenario rather than two: the refusal **still happens** — the property
 * DSP-61 must not have broken — and it is the error DSP-64 is about, the one Niclas
 * met that was correct and silent about what to do.
 *
 * No provider call. The session is refused before an adapter is created, and the
 * login reading is the presentation adapter's fixed one.
 */
async function runErrorsReadWellScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'One error surface, driven in the real window: the session-start refusal for a ' +
      'directory DSpatch did not generate. No provider call was made. It evidences ' +
      'how an error reads and that the refusal still happens; it says nothing about ' +
      'the provider, and nothing about error surfaces it did not visit.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    // DSP-149: the sample project is a development menu item now, not a start page button.
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor(
      'the refusal to reach the window',
      () => element('session-error') !== null,
      30_000,
    );
    // The refusal happened at all. If a session had opened instead, the guard would
    // be the thing that broke, and that is worth its own sentence in the report.
    const sessionOpened = textOf('session-id') !== '';
    if (sessionOpened) {
      failures.push(
        'a session opened over a directory DSpatch did not generate. The guard is ' +
          'what stands between a run and someone else\u2019s folder; this is not a ' +
          'presentation problem.',
      );
    }

    const detailOpenAtRest = element('session-error-detail')?.hasAttribute('open') ?? false;
    const headlineShown = textOf('session-error-message');
    const nextStepShown = textOf('session-error-next-step');
    const actionOffered = textOf('session-error-action');
    await clickAny('session-error-detail-summary');
    await sleep(120);
    const detailOpenedWhenAsked =
      element('session-error-detail')?.hasAttribute('open') ?? false;
    const detailText = textOf('session-error-detail');

    const plain: PlainErrorObservation = {
      headlineShown,
      nextStepShown,
      detailOpenAtRest,
      detailOpenedWhenAsked,
      detailText,
      // The words the refusal must not have lost. Its own subject, the marker it
      // looked for, and the reason it gives — the three things that make it a
      // refusal rather than a shrug.
      refusalWordsRequired: [
        'Refusing to delete',
        '.dspatch-experiment',
        "may be someone's work",
      ],
      actionOffered,
    };
    observations['plainError'] = { ...plain, sessionOpened };
    record('refusal-on-screen', {
      headlineChars: headlineShown.length,
      nextStepChars: nextStepShown.length,
      detailOpenAtRest,
      detailOpenedWhenAsked,
    });

    const verdict = checkErrorReadsWell(plain);
    if (verdict.failure !== null) {
      failures.push(`error presentation: ${verdict.failure}`);
    }
    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.errorNotActionable,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    observations['documentWhenItFailed'] = {
      sessionError: textOf('session-error'),
      sessionId: textOf('session-id'),
      connection: textOf('connection-kind'),
    };
    return finish(CHAT_EXIT.errorNotActionable, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-70: the graph on screen before Send is the definition that was chosen  */
/* ------------------------------------------------------------------------- */

/**
 * Choose a value in a real `<select>`.
 *
 * Same reasoning as `typeInto`: React owns the value, so assigning `.value` is
 * discarded on the next render. The native setter plus a bubbling `change` is what
 * choosing from the list looks like from React's side.
 */
async function chooseInSelect(name: string, value: string): Promise<void> {
  await waitFor(
    `the list "${name}" to offer ${value}`,
    () => {
      const found = element(name);
      return (
        found instanceof HTMLSelectElement &&
        !found.disabled &&
        [...found.options].some((option) => option.value === value && !option.disabled)
      );
    },
    30_000,
  );
  const list = element(name) as HTMLSelectElement;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  descriptor?.set?.call(list, value);
  list.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(
    `the list "${name}" to hold ${value}`,
    () => (element(name) as HTMLSelectElement | null)?.value === value,
    10_000,
  );
}

/** What the window is showing as the loop standing by, read from the main process. */
async function loopOnScreen(): Promise<Record<string, unknown>> {
  const run = await window.dspatch.currentLoopRun();
  return run === null
    ? { shown: false }
    : {
        shown: true,
        runId: run.runId,
        phase: run.phase ?? 'running',
        graphId: run.graphId,
        graphName: run.graphName,
        graphVersionId: run.graphVersionId,
        graphTextChars: run.graphText.length,
        // A marker planted in the project's own graph, so "this is that file" is
        // read off the bytes on screen rather than inferred from the name.
        graphTextMarker: /"purpose"\s*:\s*"([^"]*)"/.exec(run.graphText)?.[1] ?? '',
        rolesAnnounced: run.roles?.length ?? 0,
        rolesResolved: (run.roles ?? []).filter((role) => role.role !== null).length,
      };
}

/**
 * DSP-70 #1 and #5, in the real window and with no provider call.
 *
 * The question this answers is *which graph is on screen when `Use loop` is ticked*,
 * and that is decided entirely on this machine: `prepareChatLoop` resolves the chosen
 * declaration, reads its graph and announces it. A provider turn would tell us nothing
 * further about it, so none is spent — and DSP-70 #2's *during* value is the same
 * `graphVersionId` the run carries, which `loop-definition.test.ts` holds.
 *
 * `DSPATCH_PROJECT_PATH` points at a throwaway project that declares a loop of its
 * own. So the list has two real definitions from two folders, and the check is that
 * choosing the second puts the second on screen.
 */
/**
 * DSP-79 in the window: the run filed a result, and a second agent was given it.
 *
 * **Why the window, and why now.** Declaring `consumes` on the chat loop made the
 * window's result store load-bearing: a run given nowhere to keep results is refused
 * before it walks. The window's own wiring of that store — `resultsDir` in the
 * chat-loop handler — is reachable from no unit test, so one dropped option would turn
 * every loop run in the product into a refusal with the whole suite still green.
 *
 * **No provider call.** The run walks through `PresentationAdapter`, so its replies are
 * canned and its verdicts mean nothing. What is being checked is what DSpatch filed and
 * what it put in the second step's prompt, and neither depends on a model being good.
 *
 * **The evidence is the main process's, not the document's.** Everything the gate reads
 * comes out of `listRunRecords`, which is the run record the main process wrote to disk
 * and read back. The window's own account of itself could not settle a question about
 * what was filed.
 */
async function runLoopFilesAResultScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. The loop walks through the local presentation adapter, whose ' +
      'replies are canned and whose declared outcome is simply the first one each step ' +
      'offers. This evidences that the window files a result, keeps it in the run ' +
      'record, opens one provider session per agent node and puts the earlier step\u2019s ' +
      'own words into the later step\u2019s prompt. It says nothing about any model, ' +
      'nothing about whether a verdict was right, and nothing about a real turn.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    const projectPath = textOf('project-0-path');
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    record('project-open', { projectPath });

    // --- One mandate, through the loop --------------------------------------
    const ticked = await setCheckbox('use-loop', true);
    const mandate =
      'Read this project and say what it is for. Change nothing, add no dependency ' +
      'and run no commands.';
    await typeInto('prompt', mandate);
    // How many runs the conversation already holds.
    //
    // Not zero, and assuming it was cost this trial a run: a conversation restored from
    // an earlier trial in the same project folder brings its loop runs back with it, so
    // `loop-turn-0` exists before Send is pressed and waiting for it to appear waits for
    // nothing. What is new is the one **after** these.
    const runsBefore = countEntries('loop-turn');
    await sendFromComposer();
    await waitFor(
      'a new loop run to appear in the conversation',
      () => countEntries('loop-turn') > runsBefore,
      60_000,
      100,
    );
    const runIndex = countEntries('loop-turn') - 1;
    // Which loop ran, read from the main process after the run announced itself.
    // DSP-85 moved the chooser into the graph editor and this scenario never leaves
    // the chat, so the old `loop-definition` select it waited on is not there to wait
    // for; and read at the tick rather than here it comes back empty, because
    // `prepareChatLoop` has not answered yet.
    const definition = String((await loopOnScreen())['graphName'] ?? '');
    record('run-started', { ticked, definition, runsBefore, runIndex });

    // The window's own standing is what says the run is over, and `stopped` is the
    // standing a run that reported an *end* has, however it ended.
    //
    // **Not the account.** The first version of this trial waited for
    // `loop-turn-0-account` to be non-empty, and that text exists from the moment the
    // run starts — *"The loop is running. Nothing has come back from the agent yet."* —
    // so it waited 226 ms and then read a record with no ending line. A trial that
    // stops before the thing it measures has happened reports the product's absence as
    // the product's failure, which is worse than no trial.
    await waitFor(
      'the run to report an end',
      () => loopRunEnded(runIndex),
      240_000,
      250,
    );
    const accountOnScreen = textOf(`loop-turn-${String(runIndex)}-account`);
    record('run-ended', {
      badge: textOf(`loop-turn-${String(runIndex)}-status`),
      account: accountOnScreen.slice(0, 200),
    });

    // --- What the main process wrote to disk --------------------------------
    const conversations = await window.dspatch.listConversations();
    const entry =
      conversations.entries.find((each) => each.projectPath === projectPath) ??
      conversations.entries[0];
    if (entry === undefined) {
      failures.push(
        'no saved conversation was found, so the run record on disk could not be read ' +
          'and nothing about what was filed could be established.',
      );
      return finish(CHAT_EXIT.loopFiledNothing, steps, failures, observations);
    }
    // A moment for the main process to close the record. The window is told the run
    // ended by the run's own result; the last line of the file is written on the way
    // out, and reading between the two would report a complete run as interrupted.
    await sleep(750);
    const records = await window.dspatch.listRunRecords(entry.conversationId);
    // Newest by run id, which for a chat-loop run is its start time. The conversation
    // may hold records from earlier trials in the same reused project folder, and the
    // list's order is the store's business rather than a guarantee.
    const kept = [...records].sort((left, right) => left.runId.localeCompare(right.runId)).pop();
    const parsed = kept?.record ?? null;
    const resultsFiled = (parsed?.journal ?? [])
      .filter((line) => line.kind === 'result-filed' && line.nodeId !== undefined)
      .map((line) => ({
        nodeId: String(line.nodeId ?? ''),
        bytes: Number(line.data?.['bytes'] ?? 0),
        digest: String(line.data?.['digest'] ?? ''),
      }));
    const refusal = (parsed?.journal ?? [])
      .filter((line) => line.kind === 'refused')
      .map((line) => line.detail)
      .join(' ');
    const observation = {
      runId: kept?.runId ?? '',
      status: parsed?.ending?.status ?? '',
      resultsFiled,
      steps: (parsed?.replies ?? []).map((reply) => ({
        nodeId: reply.nodeId,
        sessionId: reply.sessionId ?? '',
        prompt: reply.prompt ?? '',
        text: reply.text,
      })),
      refusal,
    };
    // Whole, minus the two long strings, so the record says what was read without
    // carrying two prompts and two replies twice over.
    observations['runRecordOnDisk'] = {
      filePath: kept?.filePath ?? '',
      readError: kept?.error ?? null,
      runId: observation.runId,
      status: observation.status,
      terminal: parsed?.ending?.terminalNodeId ?? '',
      refusal,
      resultsFiled,
      steps: observation.steps.map((step) => ({
        nodeId: step.nodeId,
        sessionId: step.sessionId,
        promptBytes: step.prompt.length,
        replyBytes: step.text.length,
        promptCarriesTheEarlierReply: step.prompt.includes(
          (observation.steps[0]?.text ?? '\u0000').trim(),
        ),
      })),
    };
    observations['accountShownInWindow'] = accountOnScreen;

    /*
     * What the window shows of the message each step was sent (DSP-94, from F5).
     *
     * The record on disk is read a few lines above, so this is the one place where the
     * two can be compared as characters: the file's `prompt` for a step, and the text
     * of the disclosure under that step's reply. A window showing *a* prompt is not the
     * finding — a window showing *this call's* prompt is.
     *
     * The indices are the trail's, not the replies': `handoffTrail` puts a handover
     * between two replies, so the reply entries are at 0, 2, 4 and the loop looks at
     * every position rather than counting answers.
     */
    const promptsOnScreen: unknown[] = [];
    for (let position = 0; position < 16; position += 1) {
      const id = `loop-turn-${String(runIndex)}-reply-${String(position)}-prompt`;
      const disclosure = element(id);
      if (disclosure === null) {
        continue;
      }
      // Closed until it is asked for. A standing block of text in the conversation is
      // what DSP-87 and DSP-90 removed, and this must not be one.
      const openByDefault = disclosure.hasAttribute('open');
      // Then opened as a person opens it, because text inside a closed `details` is in
      // the document and on nobody's screen: height is the part a reading can get wrong.
      disclosure.setAttribute('open', '');
      await sleep(120);
      const box = element(`${id}-text`)?.getBoundingClientRect();
      const shown = rawTextOf(`${id}-text`);
      promptsOnScreen.push({
        at: position,
        openByDefault,
        says: textOf(`${id}-summary`),
        chars: shown.length,
        heightWhenOpened: Math.round(box?.height ?? 0),
        // Character for character against what the main process wrote to disk.
        isARecordedPrompt: observation.steps.some(
          (step) => step.prompt !== '' && step.prompt === shown,
        ),
      });
      disclosure.removeAttribute('open');
    }
    observations['promptShownInWindow'] = {
      note:
        'Each step\u2019s saved message as the conversation offers it: whether the ' +
        'disclosure is there, whether it stands open, what it says it belongs to, and ' +
        'whether its characters are the prompt the run record holds.',
      disclosures: promptsOnScreen,
      stepsInRecord: observation.steps.length,
    };
    // And a picture of one of them open, because "readable" is a claim about a window
    // and the trial above only counts characters and pixels.
    const firstPrompt = element(`loop-turn-${String(runIndex)}-reply-0-prompt`);
    if (firstPrompt !== null) {
      firstPrompt.setAttribute('open', '');
      firstPrompt.scrollIntoView({ block: 'center' });
      await sleep(250);
      await window.dspatch.captureWindow('the-message-this-step-was-sent');
      firstPrompt.removeAttribute('open');
    }
    record('prompts-on-screen', { disclosures: promptsOnScreen.length });

    record('record-read', {
      resultsFiled: resultsFiled.length,
      steps: observation.steps.length,
      sessions: new Set(observation.steps.map((step) => step.sessionId)).size,
    });

    const verdict = checkLoopFiledAndHandedOver(observation);
    observations['gateFailure'] = verdict.failure;
    if (verdict.failure !== null) {
      failures.push(verdict.failure);
    }
    await window.dspatch.captureWindow('after-the-loop-ran');

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.loopFiledNothing,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      sessionId: textOf('session-id'),
      standing: attributeOf('run-standing', 'data-standing'),
      loopTurns: countEntries('loop-turn'),
    };
    return finish(CHAT_EXIT.loopFiledNothing, steps, failures, observations);
  }
}

async function runChosenLoopScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. This evidences which loop the window offers and which graph ' +
      'reaches the screen when one is chosen, before anything is sent. It says nothing ' +
      'about a run, and nothing about the provider.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );

    // --- What the list offers before anything is chosen ----------------------
    const ticked = await setCheckbox('use-loop', true);
    await waitFor('the loop chooser to appear', () => element('loop-definition') !== null, 30_000);

    /*
     * Wait for the window to have finished looking, rather than sampling whatever is
     * there first.
     *
     * The list is read once when the window opens — before any project — and again
     * when a project is opened and when `Use loop` is ticked. So there is a correct
     * intermediate list, DSpatch's own loops alone, that exists for a few hundred
     * milliseconds. Two earlier runs of this trial caught it and reported one
     * definition where there are two, which is the instrument's problem and not the
     * product's. The main process's own answer is the reference: the trial waits
     * until the window is showing that, and fails saying so if it never does.
     */
    const fromMain = await window.dspatch.listLoopDefinitions();
    observations['loopsAccordingToMain'] = fromMain;
    const keysInWindow = (): readonly string[] =>
      [...((element('loop-definition') as HTMLSelectElement | null)?.options ?? [])]
        .map((option) => option.value)
        .filter((value) => value !== '');
    await waitFor(
      `the chooser to show the ${String(fromMain.choices.length)} definitions the main ` +
        'process found',
      () => {
        const shown = keysInWindow();
        return (
          shown.length === fromMain.choices.length &&
          fromMain.choices.every((choice) => shown.includes(choice.key))
        );
      },
      30_000,
    );

    const list = element('loop-definition') as HTMLSelectElement;
    const offered = [...list.options].map((option) => ({
      label: option.textContent ?? '',
      key: option.value,
      selectable: !option.disabled,
    }));
    const defaultKey = list.value;
    observations['loopsOffered'] = offered;
    record('loops-offered', { ticked, count: offered.length, chosen: defaultKey });

    if (offered.length < 2) {
      failures.push(
        'the window offered fewer than two loop definitions, so "choose a different ' +
          'one" could not be tried. Expected DSpatch\u2019s own chat loop and the ' +
          'throwaway project\u2019s own declaration.',
      );
    }

    // --- The loop offered by default, on screen ------------------------------
    await sleep(300);
    const byDefault = await loopOnScreen();
    observations['loopShownByDefault'] = byDefault;
    record('default-on-screen', byDefault);
    if (byDefault['graphId'] !== 'dspatch-chat-loop') {
      failures.push(
        `ticking Use loop put "${String(byDefault['graphId'])}" on screen rather than ` +
          'the simple chat loop, which is what a fresh window offered before DSP-70.',
      );
    }

    // --- A different definition, chosen by hand ------------------------------
    const other = offered.find(
      (option) => option.selectable && option.key !== defaultKey && option.key !== '',
    );
    if (other === undefined) {
      failures.push('there was no second usable definition to choose.');
      return finish(CHAT_EXIT.chosenLoopNotShown, steps, failures, observations);
    }
    await chooseInSelect('loop-definition', other.key);
    await sleep(400);
    const afterChoosing = await loopOnScreen();
    observations['loopShownAfterChoosing'] = { chosenKey: other.key, ...afterChoosing };
    record('chosen-on-screen', afterChoosing);

    if (afterChoosing['graphId'] === byDefault['graphId']) {
      failures.push(
        'choosing a different definition left the same graph on screen. This is the ' +
          'defect DSP-70 exists to close: what runs was never what was chosen.',
      );
    }
    if (afterChoosing['graphVersionId'] === byDefault['graphVersionId']) {
      failures.push('two different definitions reached the screen with one version id.');
    }
    if (afterChoosing['rolesResolved'] === 0) {
      failures.push(
        'the chosen definition announced no resolved role, so its resource root ' +
          'reached nothing — the graph on screen could not be drawn from its own bindings.',
      );
    }

    // --- And back again, because a choice has to be reversible ---------------
    await chooseInSelect('loop-definition', defaultKey);
    await sleep(400);
    const backAgain = await loopOnScreen();
    observations['loopShownAfterChoosingBack'] = backAgain;
    record('back-on-screen', backAgain);
    if (backAgain['graphVersionId'] !== byDefault['graphVersionId']) {
      failures.push('choosing the first definition again did not bring back the same version.');
    }

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.chosenLoopNotShown,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    observations['documentWhenItFailed'] = {
      sessionId: textOf('session-id'),
      connection: textOf('connection-kind'),
      chooserPresent: element('loop-definition') !== null,
    };
    return finish(CHAT_EXIT.chosenLoopNotShown, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-84: opened, chosen and run are one loop                                */
/* ------------------------------------------------------------------------- */

/** Move the window between its two surfaces the way a person does, and wait for it. */
async function goToEditor(): Promise<void> {
  window.location.hash = 'editor';
  await waitFor(
    'the editor to mount and expose its check hook',
    () => window.__dspatchEditorCheck !== undefined,
    60_000,
  );
}

/**
 * The editor's hook **as it is now**, never as it was a moment ago.
 *
 * The editor replaces the whole object whenever the open file changes, because each
 * function in it closes over that file. Holding one across an `openTarget` therefore
 * presses the previous graph's buttons — which is how the first run of this trial
 * reported that choosing did nothing when what had happened was that the trial chose
 * for a file the editor was no longer showing. An instrument fault, and an easy one to
 * mistake for the defect the card is about.
 */
function editorHook(): NonNullable<Window['__dspatchEditorCheck']> {
  const hook = window.__dspatchEditorCheck;
  if (hook === undefined) {
    throw new Error('the editor is not showing a graph, so its check hook is not installed');
  }
  return hook;
}

async function goToChat(): Promise<void> {
  window.location.hash = '';
  await waitFor('the chat composer to be back on screen', () => element('prompt') !== null, 60_000);
}

/**
 * The keys the editor's chooser is offering now, read off the real `<select>`.
 *
 * The editor's, since DSP-85: the chat has no chooser any more, and this one *is* the
 * stored selection rather than a control beside it.
 */
function chooserKeys(): readonly string[] {
  return editorHook()
    .readChooser()
    .chooserKeys.filter((value) => value !== '');
}

/**
 * Wait for a loop run whose id is a run's, not a preview's, and describe it.
 *
 * `prepareChatLoop` announces a stand-by drawing under `ready-…`, and that is the
 * announcement on screen from the moment `Use loop` is ticked. Reading it after Send and
 * calling it the run would be a trial that passes without a run ever having started.
 */
async function startedRunOnScreen(previousRunId: string): Promise<Record<string, unknown>> {
  // `waitFor` takes a synchronous predicate, and the reading is a bridge call, so the
  // last answer is held here and the predicate reads it.
  let latest: Record<string, unknown> | null = null;
  let polling = false;
  await waitFor(
    'the graph view to be showing a started run rather than the stand-by drawing',
    () => {
      if (!polling) {
        polling = true;
        void window.dspatch
          .currentLoopRun()
          .then(async (run) => {
            if (run !== null && !run.runId.startsWith('ready-') && run.runId !== previousRunId) {
              latest = await loopOnScreen();
            }
          })
          .finally(() => {
            polling = false;
          });
      }
      return latest !== null;
    },
    120_000,
    150,
  );
  return latest ?? { shown: false };
}

/**
 * Choosing a loop in the graph editor, and the loop that then runs.
 *
 * **What this measures and why.** DSP-84 made the editor able to choose a loop with an
 * explicit `Use this loop` button, alongside the chat's own dropdown, and Niclas's verdict
 * on trying it was that there were too many ways to say one thing. DSP-85 put the choice
 * in one place: a dropdown in the graph editor, where picking a loop draws it and selects
 * it in a single gesture. So what has to be established is not "does the button work" but
 * three narrower things a defect could hide between.
 *
 * **One gesture does both.** Each round reads the chooser's value *and* the number of
 * nodes on the canvas, so "chose it" and "drew it" are separate readings of one act. Two
 * definitions, because one cannot tell a selection from a constant, and the trial fails if
 * two consecutive rounds run the same graph version.
 *
 * **Both ways in.** Round one reaches a declaration filed outside every open folder by
 * pressing the real **Open loop…** button; round two picks the repository's own loop from
 * the dropdown. One declaration outside every folder is the case that could be drawn and
 * not chosen before DSP-84, and it is the one Niclas met.
 *
 * **What must not move.** A definition that cannot run must leave the selection *and* the
 * canvas where they were, with a short reason. A standalone `.graph.json` opened from the
 * File menu must leave the chosen loop plainly visible in the chooser, because such a file
 * is not a loop and was never chosen as one. And the four controls this card removed must
 * be absent rather than merely unused.
 *
 * **No provider call.** The mandates walk through `PresentationAdapter`, whose replies are
 * canned. Which loop ran is decided entirely on this machine, and the strongest evidence
 * for it — `graphPath` and `graphVersionId` in the record the main process wrote — does not
 * depend on a model having said anything sensible.
 *
 * **What is scripted and what is real.** Only the two file dialogs' *answers*, through
 * `DSPATCH_PICK_FILE`: a native dialog cannot be driven from here. The buttons, the menu
 * item, the handler, the judgement and everything recorded are the ones a person gets.
 */
async function runOpenChooseRunScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. The mandates walk through the local presentation adapter, whose ' +
      'replies are canned and whose declared outcome is the first one each step offers. ' +
      'The only thing scripted about the window is the answer each native file dialog ' +
      'gives, through DSPATCH_PICK_FILE; a dialog cannot be driven from the renderer, and ' +
      'the buttons, the menu item and every handler behind them are the real ones. This ' +
      'evidences that choosing a loop in the editor draws it and selects it together, that ' +
      'the run which follows reads that definition\u2019s own graph, and that a refusal and ' +
      'a standalone graph both leave the selection where it was. It says nothing about any ' +
      'model and nothing about whether a verdict was right.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  const definitions = plan.choosableDefinitions ?? [];
  if (definitions.length < 2) {
    failures.push(
      'the trial was given fewer than two declarations to choose between, so "choose a ' +
        'different one" could not be tried at all. Set DSPATCH_CHOOSE_DEFINITIONS.',
    );
    return finish(CHAT_EXIT.choiceDidNotCarry, steps, failures, observations);
  }

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    const projectPath = textOf('project-0-path');
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    const ticked = await setCheckbox('use-loop', true);
    record('project-open', { projectPath, ticked });

    // --- The four controls this card removed are gone ------------------------
    //
    // Read in the chat and in the editor, by the `data-ev` names they had. Absence is the
    // criterion (#4 and #5), and a control that was merely stopped being used would leave
    // exactly the "too many ways to say the same thing" this card is answering.
    await goToEditor();
    await waitFor(
      "the editor's loop chooser to appear",
      () => element('editor-loop-definition') !== null,
      30_000,
    );
    const removedInEditor = {
      useThisLoop: element('use-this-loop') !== null,
      openNextMandateLoop: element('open-next-mandate-loop') !== null,
      nextMandateChip: element('editor-next-mandate-loop') !== null,
    };
    await goToChat();
    const removedInChat = {
      loopDropdown: element('loop-definition') !== null,
      chooseAFile: element('pick-loop-definition') !== null,
      // DSP-85 deliberately left this one standing and named DSP-87 as its owner.
      // Checked here, with the rest of that card's removals, because this is the
      // scenario that had been reading it.
      nextMandateSentence: element('next-mandate-loop') !== null,
      useLoopTick: element('use-loop') !== null,
    };
    observations['controlsRemoved'] = { ...removedInEditor, ...removedInChat };
    for (const [name, present] of Object.entries(removedInEditor)) {
      if (present) {
        failures.push(`the editor still has "${name}", which DSP-85 #4 removes.`);
      }
    }
    if (removedInChat.loopDropdown || removedInChat.chooseAFile) {
      failures.push(
        'the chat still has a loop chooser or a "Choose a file…" button, which DSP-85 #5 ' +
          'moves into the editor.',
      );
    }
    if (removedInChat.nextMandateSentence) {
      failures.push(
        'the chat still has the sentence under the composer naming the loop the next run ' +
          'would use. DSP-87 removes it: the editor\u2019s chooser shows that permanently, ' +
          'as a control.',
      );
    }
    if (!removedInChat.useLoopTick) {
      failures.push('the chat lost its "Use loop" tick, which DSP-85 #5 keeps exactly as it is.');
    }

    // What the window said before any of this, so "it changed" is a reading rather than
    // an assumption. Read from the editor, which is where the chooser is now.
    await goToEditor();
    await sleep(400);
    const before = editorHook().readChooser();
    observations['beforeChoosing'] = {
      chooserKeys: before.chooserKeys.filter((key) => key !== ''),
      selectedKey: before.chooserValue,
      nodesDrawn: before.nodesDrawn,
      header: before.headerText,
      // DSP-87 removed the sentence that used to be read here; its absence is
      // asserted with the other removals below rather than sampled as a value.
      loopOnScreen: await loopOnScreen(),
    };
    // The editor comes up on the loop that will run, which is the first frame agreeing
    // with the chooser beside it. A fresh window with an empty canvas would be the old
    // "the view shows something other than what runs" with nothing in it.
    if (before.nodesDrawn === 0) {
      failures.push(
        'the editor opened with nothing on the canvas. Since DSP-85 the chosen loop is ' +
          'what a fresh editor window draws, so the dropdown and the drawing agree from ' +
          'the first frame.',
      );
    }

    const rounds: Record<string, unknown>[] = [];
    let previousRunId = '';
    let previousGraphVersion = '';

    for (const definitionPath of definitions) {
      const roundNumber = rounds.length + 1;
      // Every round begins in the editor, because every round ends in the chat having sent
      // a mandate. Leaving this out cost one run: the hook belongs to the editor surface,
      // and reading it from the chat reports that no graph is open.
      await goToEditor();
      // Both readings, because a node count alone cannot tell two graphs of the same size
      // apart and the drawing is half of what one gesture is supposed to do.
      const beforeRound = editorHook().readChooser();
      /*
       * A remounted editor comes up on the loop its own chooser names.
       *
       * This is where the trial earned its keep. Before the fix in `chooseLoop`, round two
       * opened with the chooser correctly showing the standalone declaration chosen in round
       * one and the canvas correctly drawing something else — `defaultChoiceFrom` was given
       * only the discovered rows, so a remembered key from outside every open folder fell
       * through to DSpatch's own chat loop with nothing anywhere saying so. Nothing chose
       * between the rounds, so the header has to be the one the previous round left.
       */
      const headerLastRoundLeft = String(rounds[rounds.length - 1]?.['editorHeaderAfterChoosing'] ?? '');
      if (headerLastRoundLeft !== '' && beforeRound.headerText !== headerLastRoundLeft) {
        failures.push(
          `a remounted editor came up on "${beforeRound.headerText}" while its chooser said ` +
            `"${beforeRound.chooserValue}" — the previous round left "${headerLastRoundLeft}". ` +
            'The dropdown and the drawing have to agree from the first frame, or a hidden loop ' +
            'has replaced what was chosen.',
        );
      }

      // --- Choose it: one gesture that draws it and selects it ---------------
      //
      // Round one presses the real `Open loop…`, whose dialog answers with the first
      // `DSPATCH_PICK_FILE` entry — the declaration filed outside every open folder, which
      // is #3's case. Every later round drives the real `<select>` through `chooseInSelect`,
      // which is #2's: the native value setter and a bubbling `change`, so React's own
      // `onChange` runs and the gesture is a person's rather than a function call.
      if (roundNumber === 1) {
        await click('open-loop-definition');
        await waitFor(
          `Open loop… to have selected and drawn ${definitionPath}`,
          () => editorHook().readChooser().chooserValue === definitionPath,
          30_000,
        );
      } else {
        await chooseInSelect('editor-loop-definition', definitionPath);
      }
      // After the paint, and after the choice has settled: `open` is awaited inside the
      // choice, and reading straight through would report the previous graph's canvas.
      await sleep(600);
      const read = editorHook().readChooser();
      const chose = {
        noteText: textOf('editor-note'),
        headerText: read.headerText,
        chooserValue: read.chooserValue,
        chooserKeys: read.chooserKeys,
        nodesDrawn: read.nodesDrawn,
        choiceError: element('editor-choice-error')?.getAttribute('title') ?? '',
        unsavedWarning: element('editor-unsaved-against-choice')?.getAttribute('title') ?? '',
      };
      record('editor-chose', {
        definitionPath,
        by: roundNumber === 1 ? 'Open loop…' : 'the dropdown',
        note: chose.noteText.slice(0, 240),
        selected: chose.chooserValue,
        nodesDrawn: chose.nodesDrawn,
      });

      // The two halves of one gesture, read apart. `#3` for the listing, `#2` for the
      // drawing: a definition reached by hand has to join the same list, and a choice has
      // to change what is on the canvas.
      if (!chose.chooserKeys.includes(definitionPath)) {
        failures.push(
          `after choosing ${definitionPath} the editor's dropdown did not list it, so it ` +
            'did not join the one list every other definition is in.',
        );
      }
      if (chose.chooserValue !== definitionPath) {
        failures.push(
          `choosing ${definitionPath} left the chooser showing "${chose.chooserValue}". ` +
            'Picking a loop is what selects it, so the control has to be showing it.',
        );
      }
      if (chose.nodesDrawn === 0) {
        failures.push(
          `choosing ${definitionPath} selected it and drew nothing. Choosing and drawing ` +
            'are one act in DSP-85; a selection with an empty canvas is the two coming apart.',
        );
      }
      if (chose.choiceError !== '') {
        failures.push(
          `choosing ${definitionPath} put an error beside the chooser: ` +
            `"${chose.choiceError.slice(0, 200)}".`,
        );
      }
      if (!chose.noteText.includes('next mandate')) {
        failures.push(
          `choosing ${definitionPath} said nothing about the next mandate: ` +
            `"${chose.noteText.slice(0, 160)}".`,
        );
      }
      // One picture per round, of the editor at the moment the choice has been made. The
      // pause is not politeness: `capturePage` hands back the last frame Chromium painted.
      await sleep(400);
      await window.dspatch.captureWindow(`editor-chose-${String(roundNumber)}`);

      await goToChat();
      /*
       * There is no sentence under the composer to wait for any more (DSP-87).
       *
       * This round used to block until `next-mandate-loop` named the declaration it had
       * just chosen, which was the right check while the chat had its own dropdown and
       * the two could disagree. DSP-85 left the editor's chooser as the only way to
       * choose, and DSP-87 removed the sentence, so what is read here instead is the
       * chooser the choice was made in — the same fact, from the control that now
       * holds it, rather than from a paragraph repeating it in another window.
       */
      const sentence = chose.chooserValue;
      // The composer as it stands just before Send, which is where a person decides.
      await sleep(400);
      await window.dspatch.captureWindow(`chat-before-send-${String(roundNumber)}`);

      // --- One mandate, and the graph the run actually announces -------------
      const runsBefore = countEntries('loop-turn');
      await typeInto(
        'prompt',
        'Read this project and say in one sentence what it is for. Change nothing, add ' +
          'no dependency and run no commands.',
      );
      await sendFromComposer();
      await waitFor(
        'a new loop run to appear in the conversation',
        () => countEntries('loop-turn') > runsBefore,
        60_000,
        100,
      );
      const running = await startedRunOnScreen(previousRunId);
      record('run-started', {
        definitionPath,
        runId: running['runId'],
        graphId: running['graphId'],
      });
      await waitFor(
        'the run to report an end',
        () => newestLoopRunEnded(),
        300_000,
        250,
      );
      // The main process writes the last line of the record on its way out; reading
      // between the window's ending and that write reports a complete run as truncated.
      await sleep(900);

      // --- What the main process wrote down about which graph it read --------
      const conversations = await window.dspatch.listConversations();
      const entry =
        conversations.entries.find((each) => each.projectPath === projectPath) ??
        conversations.entries[0];
      const records =
        entry === undefined ? [] : await window.dspatch.listRunRecords(entry.conversationId);
      const kept = [...records]
        .sort((left, right) => left.runId.localeCompare(right.runId))
        .pop();
      const identity = kept?.record?.identity ?? null;

      const round = {
        definitionPath,
        chosenBy: roundNumber === 1 ? 'Open loop…' : 'the dropdown',
        editorHeaderBeforeChoosing: beforeRound.headerText,
        editorHeaderAfterChoosing: chose.headerText,
        editorSelectedKeyBefore: beforeRound.chooserValue,
        editorNodesDrawnBefore: beforeRound.nodesDrawn,
        editorNodesDrawnAfter: chose.nodesDrawn,
        editorNoteAfterChoosing: chose.noteText,
        editorSelectedKey: chose.chooserValue,
        chatSentence: sentence,
        runAnnounced: running,
        runRecord:
          identity === null
            ? null
            : {
                runId: identity.runId,
                graphId: identity.graphId,
                graphPath: identity.graphPath,
                graphVersionId: identity.graphVersionId,
              },
      };
      rounds.push(round);

      if (identity === null) {
        failures.push(
          `no run record was found for the run started with ${definitionPath}, so which ` +
            'graph was actually read could not be established from disk.',
        );
      } else if (identity.graphVersionId !== running['graphVersionId']) {
        failures.push(
          `the graph the view announced and the graph the record says was read have ` +
            `different versions (${String(running['graphVersionId'])} on screen, ` +
            `${identity.graphVersionId} on disk) for ${definitionPath}.`,
        );
      }
      if (previousGraphVersion !== '' && identity?.graphVersionId === previousGraphVersion) {
        failures.push(
          `choosing ${definitionPath} ran the same drawing as the definition before it. ` +
            'That is the defect: what ran was not what was chosen.',
        );
      }
      previousRunId = String(running['runId'] ?? '');
      previousGraphVersion = identity?.graphVersionId ?? '';
    }

    observations['rounds'] = rounds;

    // --- A definition that cannot run says why, briefly, and changes nothing (#8)
    //
    // Three readings, because a quiet refusal that left the old loop selected would look
    // identical to an acceptance: the reason, the selection, and — new in DSP-85 — the
    // canvas. Choosing draws, so a refusal that drew the broken drawing anyway would be
    // the "the view changed graph under him" defect wearing a reason.
    const lastChosen = definitions[definitions.length - 1] ?? '';
    const brokenPath = plan.brokenDefinition ?? '';
    if (brokenPath === '') {
      failures.push(
        'the trial was given no broken declaration, so "a definition that cannot run ' +
          'says why at the point of choosing" was never put to the window. Set ' +
          'DSPATCH_BROKEN_DEFINITION.',
      );
    } else {
      await goToEditor();
      const beforeRefusal = editorHook().readChooser();
      // Through the real `Open loop…`, whose dialog answers with the broken declaration:
      // it is filed outside every open folder and so is not in the dropdown at all, which
      // is exactly how a person would meet it.
      await click('open-loop-definition');
      await waitFor(
        'the chooser to say why the definition was refused',
        () => element('editor-choice-error') !== null,
        30_000,
      );
      await sleep(400);
      const afterRefusal = editorHook().readChooser();
      const reason = element('editor-choice-error')?.getAttribute('title') ?? '';
      observations['brokenDefinition'] = {
        path: brokenPath,
        reason,
        reasonChars: reason.length,
        reasonLines: reason.split('\n').length,
        noteText: textOf('editor-note'),
        nodesDrawnBefore: beforeRefusal.nodesDrawn,
        nodesDrawnAfter: afterRefusal.nodesDrawn,
        chooserBefore: beforeRefusal.chooserValue,
        chooserAfter: afterRefusal.chooserValue,
      };
      record('editor-refused-broken-definition', { path: brokenPath, reasonChars: reason.length });
      await window.dspatch.captureWindow('editor-refused-a-definition');
      if (!reason.includes('still walks')) {
        failures.push(
          'refusing a definition did not name what the next mandate still walks: ' +
            `"${reason.slice(0, 240)}". A refusal a person can mistake for an acceptance is ` +
            'how a run ends up walking a loop nobody chose.',
        );
      }
      // Short at the chooser is a criterion, not a preference: DSP-84's trial put fifteen
      // lines of findings here, and a reason nobody finishes reading is not a reason.
      if (reason.split('\n').length > 4) {
        failures.push(
          `the reason beside the chooser ran to ${String(reason.split('\n').length)} lines. ` +
            'DSP-85 #8 asks for a short one there; the findings belong on the canvas.',
        );
      }
      // And readable without a hover. A chip whose whole content is in a `title` is a reason
      // a person may never see, which is not far from no reason at all.
      if (!textOf('editor-note').includes('still walks')) {
        failures.push(
          'the reason a definition was refused was only in the chooser chip\u2019s hover: the ' +
            `status line said "${textOf('editor-note').slice(0, 160)}".`,
        );
      }
      if (afterRefusal.chooserValue !== lastChosen) {
        failures.push(
          `a refused definition moved the selection to "${afterRefusal.chooserValue}". Nothing ` +
            'may fall back to another loop, and the previous choice has to stay plainly visible.',
        );
      }
      if (afterRefusal.nodesDrawn !== beforeRefusal.nodesDrawn) {
        failures.push(
          `a refused definition changed the canvas from ${String(beforeRefusal.nodesDrawn)} to ` +
            `${String(afterRefusal.nodesDrawn)} nodes. A choice that did not happen must not draw.`,
        );
      }
    }

    // --- An edited drawing says what a run would actually read ---------------
    //
    // A real edit through a real control, because the claim being checked is about what
    // the window says to a person who has typed something and not saved. The chosen
    // definition is re-chosen first so the edit is made to the loop that would run —
    // which is the only case where showing one version and running another would bite.
    const chosenPath = lastChosen;
    await goToEditor();
    // Through the hook rather than the `<select>`, because this is setting the scene and not
    // the thing being measured: the drawing has to be the chosen loop's and freshly loaded,
    // and it is already the selection so a `change` event would be a gesture proving nothing.
    await editorHook().chooseLoop(chosenPath);
    const readBack = await window.dspatch.openLoopGraph({ kind: 'definition', path: chosenPath });
    const firstNodeId =
      readBack.kind === 'read'
        ? String(
            (JSON.parse(readBack.text) as { nodes?: { id?: unknown }[] }).nodes?.[0]?.id ?? '',
          )
        : '';
    if (firstNodeId === '') {
      failures.push(
        `could not read a node out of ${chosenPath} to edit, so the unsaved-edit sentence ` +
          'was never put to the window.',
      );
    } else {
      await editorHook().showNode(firstNodeId, false);
      await typeInto('node-purpose', 'Edited in the window and deliberately not saved.');
      await sleep(300);
      // The standing chip, read with no gesture at all. That is the state that would
      // actually bite — a window sitting there with an edited drawing and a ticked
      // `Use loop` — and with `Use this loop` gone there is no press to read it from.
      const warning = element('editor-unsaved-against-choice')?.getAttribute('title') ?? '';
      observations['unsavedAgainstChoice'] = { nodeEdited: firstNodeId, warning };
      record('editor-edited-without-saving', { nodeEdited: firstNodeId, warning });
      if (!warning.includes('as saved on disk')) {
        failures.push(
          'the editor held unsaved changes to the very loop the next mandate would walk ' +
            `and said "${warning}". Showing one version while running another is the thing ` +
            'this must never do silently.',
        );
      }
    }

    // --- A standalone graph opens from the File menu and chooses nothing (#6) ----
    //
    // The real menu item, pressed by command, with the dialog answering from the second
    // `DSPATCH_PICK_FILE` entry. Then the two readings that matter: the canvas is the graph
    // file, and the chooser is still showing the loop that was chosen. A `.graph.json` has
    // no declaration behind it and so cannot be a loop the next mandate walks — DSP-84
    // established that at the press, and this card had to keep it true of what the chooser
    // displays.
    await goToEditor();
    const beforeMenu = editorHook().readChooser();
    const menuPressed = await window.dspatch.pressMenuItem('open-graph-file');
    await sleep(1_200);
    const afterMenu = editorHook().readChooser();
    observations['graphFromFileMenu'] = {
      menuItemPressed: menuPressed,
      headerBefore: beforeMenu.headerText,
      headerAfter: afterMenu.headerText,
      chooserBefore: beforeMenu.chooserValue,
      chooserAfter: afterMenu.chooserValue,
      noteAfter: textOf('editor-note'),
    };
    record('file-menu-opened-a-graph', {
      pressed: menuPressed,
      chooserAfter: afterMenu.chooserValue,
    });
    if (!menuPressed) {
      failures.push(
        'File → Open Graph File… was not found in the application menu, so the way to edit ' +
          'a standalone graph that DSP-85 #6 keeps was never exercised.',
      );
    }
    if (afterMenu.chooserValue !== lastChosen) {
      failures.push(
        `opening a graph file from the File menu changed the chooser to ` +
          `"${afterMenu.chooserValue}". Such a graph is not a chosen definition and must ` +
          'not displace the one that is.',
      );
    }
    if (afterMenu.headerText === beforeMenu.headerText) {
      failures.push(
        'the editor header did not change after File → Open Graph File…, so the graph was ' +
          'probably never drawn and the reading above proves nothing.',
      );
    }
    await sleep(400);
    await window.dspatch.captureWindow('editor-graph-from-file-menu');

    await sleep(500);
    await window.dspatch.captureWindow('after-open-choose-run');

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.choiceDidNotCarry,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      sessionId: textOf('session-id'),
      // Guarded: the chooser is the editor's now, and a failure on the chat surface has no
      // editor hook to read it from. A failure report that failed to be written is worse
      // than a thin one.
      chooserKeys: window.__dspatchEditorCheck === undefined ? [] : chooserKeys(),
      standing: attributeOf('run-standing', 'data-standing'),
    };
    return finish(CHAT_EXIT.choiceDidNotCarry, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-86: one graph view, before, during and after a run                     */
/* ------------------------------------------------------------------------- */

/** Everything a reading of the view holds, named once so two of them can be compared. */
type ViewReading = ReturnType<NonNullable<Window['__dspatchEditorCheck']>['readView']>;

/**
 * The quantities that must be identical either side of a run, and their differences.
 *
 * Named here rather than written out at each comparison because the list *is* the
 * criterion: "the same layout, graph, zoom, panning and node panel" (#2) is exactly
 * this set, and a criterion spelled out three times drifts into three criteria. The
 * two boxes are compared as whole rectangles, so a grid row appearing or disappearing
 * — which is how the run banner used to announce itself — shows up as a height change
 * rather than having to be looked for by name.
 */
function viewDifferences(before: ViewReading, after: ViewReading): readonly string[] {
  const differences: string[] = [];
  const same = (name: string, left: unknown, right: unknown): void => {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differences.push(`${name}: ${JSON.stringify(left)} became ${JSON.stringify(right)}`);
    }
  };
  same('zoom', before.zoom, after.zoom);
  same('scrollLeft', before.scrollLeft, after.scrollLeft);
  same('scrollTop', before.scrollTop, after.scrollTop);
  same('drawingWidth', before.svgWidth, after.svgWidth);
  same('canvasBox', before.canvasBox, after.canvasBox);
  same('inspectorBox', before.inspectorBox, after.inspectorBox);
  same('paletteBox', before.paletteBox, after.paletteBox);
  same('selectedNode', `${before.selectedKind}:${before.selectedId}`, `${after.selectedKind}:${after.selectedId}`);
  same('nodesDrawn', before.nodesDrawn, after.nodesDrawn);
  same('graphName', before.graphName, after.graphName);
  return differences;
}

/**
 * One graph view, before, during and after a run.
 *
 * **What this measures and why.** Until this card a run *replaced* the graph view: the
 * editor adopted the run's announcement, loaded the run's pinned drawing over whatever
 * the person had open, put a banner above it with **Leave the run view**, swapped the
 * node panel for a list of the run's nodes and a legend, and hung a raw log underneath.
 * Getting back to editing needed a button. Niclas's verdict on trying it was that there
 * should be one view, with the run happening inside it. So what has to be established
 * is not "does a run work" — DSP-79 and DSP-85 evidence that — but that a run *arrives
 * and leaves without disturbing the view*, which is a claim about sameness.
 *
 * **Sameness needs two readings.** `readView` is taken four times: on a deliberately
 * odd view before anything starts, while the run walks, while it is held waiting for
 * the person, and once it has ended. The first and the last are compared field by
 * field through `viewDifferences`. The view is made odd on purpose — a zoom nobody
 * lands on, a scrolled canvas, a selected node — because the failure this guards
 * against is a remount, and a remount lands exactly on the defaults that a default
 * view would compare equal to.
 *
 * **The lock is a separate claim from the view.** During the run the reading has to
 * show editing refused *and* reading still working: the chooser, **Open loop…**,
 * **Save**, the palette and the inspector's fields all disabled, while selecting a
 * node and reading its Markdown role text still answers (#3, #10). Those are opposite
 * signs of the same reading, which is why they are taken from one call.
 *
 * **Waiting for a person is not the run being over** (#4). The loop is put in *wait
 * for me* before the run starts, so it really does stop and ask; the reading taken
 * there must still be locked and must not have unlocked itself.
 *
 * **It does not press Send, and that is deliberate.** Send lives on the chat surface,
 * and in this window the two surfaces are one document behind a hash — so going to the
 * chat to press it would unmount the editor and destroy the very zoom, scroll and
 * selection the trial exists to measure. `startChatLoopRun` is the same main-process
 * handler Send calls, with the same request, and everything downstream of it — the
 * announcement, the lock, the control, the record — is the real thing. What is *not*
 * evidenced here is the composer, which DSP-85's trial walks.
 *
 * **No provider call.** The steps walk through `PresentationAdapter`, whose replies are
 * canned. Nothing in this reading depends on a model having said anything.
 */
async function runOneGraphViewScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call: the steps walk through the local presentation adapter, whose ' +
      'replies are canned. The run is started through startChatLoopRun, the same ' +
      'main-process handler the composer\u2019s Send calls with the same request, because ' +
      'pressing Send means leaving the editor surface and this window has one document ' +
      'for both \u2014 which would unmount the editor and destroy the zoom, scroll and ' +
      'selection being measured. So this evidences what the graph view does while a run ' +
      'arrives, walks, waits and ends. It says nothing about the composer, which DSP-85 ' +
      'walks, and nothing about any model.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    /*
     * `Use loop` is ticked here and never touched again.
     *
     * Which is the whole of #6: the Ready pulse has to come back to the entry step when
     * the run ends *without the person toggling the feature off and on*. The tick being
     * pressed exactly once, before the run, is what makes the pulse at the end evidence
     * of a restoration rather than of a second tick.
     */
    const ticked = await setCheckbox('use-loop', true);
    record('project-open', { ticked });
    if (!ticked) {
      failures.push('`Use loop` could not be ticked, so #6 could not be put to the window.');
    }

    await goToEditor();
    await waitFor(
      "the editor's loop chooser to appear",
      () => element('editor-loop-definition') !== null,
      30_000,
    );
    await waitFor(
      'the chosen loop to be drawn on the canvas',
      () => editorHook().readChooser().nodesDrawn > 0,
      30_000,
    );
    const definitionKey = editorHook().readChooser().chooserValue;

    /*
     * Hold the agent steps, before the run rather than during it.
     *
     * #4 asks that waiting for the person keep the graph locked, and a hold that has to
     * be *caught* mid-run is a race the trial would lose on a fast machine with canned
     * replies. Choosing *wait for me* first makes the hold certain: the run stops at its
     * first work step and stays there until this trial releases it.
     */
    await chooseInSelect('loop-mode', 'interactive');
    await sleep(300);

    // --- The view, made deliberately odd ------------------------------------
    //
    // A zoom of 130%, a scrolled canvas and a selected node. Each is something a remount
    // cannot reproduce, which is what makes "unchanged" worth reading at the end.
    const nodes = [...document.querySelectorAll<SVGGElement>('svg g.node')].map(
      (node) => node.getAttribute('data-node-id') ?? '',
    );
    /*
     * A node with role text on it, found by looking rather than by index.
     *
     * #10 is about the node panel's *Markdown role text* still being readable during a
     * run, so the node the trial reads has to be one that has some. The first walk took
     * the third node in the drawing, which in the chat loop is `done` — a terminal, with
     * no role at all — and duly reported that reading a step's instructions had stopped
     * working. It had not; the trial was reading a step that has none.
     */
    let nodeToSelect = '';
    let panelBefore: Awaited<ReturnType<NonNullable<Window['__dspatchEditorCheck']>['showNode']>> =
      null;
    for (const candidate of nodes) {
      const shown = await editorHook().showNode(candidate, false);
      if (shown !== null && shown.roleChars > 0) {
        nodeToSelect = candidate;
        panelBefore = shown;
        break;
      }
    }
    if (nodeToSelect === '') {
      failures.push(
        'no node in the drawn loop has role text, so "reading what a step is told still ' +
          'works during a run" could not be put to the window at all.',
      );
      return finish(CHAT_EXIT.oneViewDidNotHold, steps, failures, observations);
    }
    // The zoom and the scroll last, because `showNode` scrolls the inspector and a
    // reading taken before the view has settled is a reading of the wrong moment.
    await editorHook().setViewState(1.3, 120, 90);
    await editorHook().showNode(nodeToSelect, false);
    await sleep(300);
    const before = editorHook().readView();
    observations['beforeTheRun'] = before;
    observations['nodePanelBeforeTheRun'] = panelBefore;
    record('view-before', {
      zoom: before.zoom,
      scroll: [before.scrollLeft, before.scrollTop],
      selected: before.selectedId,
      locked: before.locked,
      entryState: before.entryState,
    });
    await window.dspatch.captureWindow('one-view-before-the-run');

    if (before.locked) {
      failures.push('the editor was already locked before any run started.');
    }
    // The stand-by pulse, which is the state the run will displace and the state that
    // has to come back. Read before the run so the two ends are the same measurement.
    if (before.entryState !== 'ready') {
      failures.push(
        `with Use loop ticked and nothing running, the entry step was marked ` +
          `"${before.entryState}" rather than ready. The pulse has to be there before ` +
          'the run for its return afterwards to mean anything.',
      );
    }
    // #1: the removed surfaces, absent before a run as well as during one. A panel that
    // only appears with a run would pass a reading taken here and fail a person.
    observations['removedSurfacesBefore'] = before.gone;

    // --- Start the run, and read the view while it walks --------------------
    const runId = `dsp-one-view-${String(Date.now())}`;
    const finished = window.dspatch.startChatLoopRun({
      runId,
      mandate:
        'Read this project and say in one sentence what it is for. Change nothing, add ' +
        'no dependency and run no commands.',
      definitionKey: definitionKey === '' ? null : definitionKey,
    });
    // Settled so it cannot become an unhandled rejection while the trial reads the view;
    // the value is awaited at the end.
    let outcome: unknown = null;
    let ended = false;
    void finished
      .then((value) => {
        outcome = value;
      })
      .catch((error: unknown) => {
        outcome = { kind: 'threw', error: String(error) };
      })
      .finally(() => {
        ended = true;
      });

    await waitFor(
      'the editor to lock because a run is walking its graph',
      () => editorHook().readView().locked,
      120_000,
      100,
    );
    const during = editorHook().readView();
    // The node panel during the run: selected, readable, Advanced still collapsed and
    // still openable. This is #10, and it is the half of the lock that is easy to get
    // wrong by disabling the panel rather than its fields.
    const panelDuring = await editorHook().showNode(nodeToSelect, false);
    await sleep(200);
    observations['duringTheRun'] = during;
    observations['nodePanelDuringTheRun'] = panelDuring;
    record('view-during', {
      locked: during.locked,
      chooserDisabled: during.chooserDisabled,
      marked: during.marked,
      controlPhase: during.controlPhase,
    });
    await window.dspatch.captureWindow('one-view-during-the-run');

    // #2: nothing about the view moved when the run arrived.
    const movedOnStart = viewDifferences(before, during);
    observations['whatMovedWhenTheRunStarted'] = movedOnStart;
    if (movedOnStart.length > 0) {
      failures.push(
        `starting a run changed the view: ${movedOnStart.join('; ')}. The card's whole ` +
          'claim is that the editor keeps the same layout, graph, zoom, panning and node ' +
          'panel when a run starts.',
      );
    }
    // #3: editing refused, in the three places a person would try it.
    for (const [what, state] of [
      ['the loop chooser', during.chooserDisabled],
      ['Open loop…', during.openLoopDisabled],
      ['the inspector fields', during.inspectorLocked],
      ['Save', during.saveDisabled],
      // Not an edit, and it belongs in this list all the same: a dry run walks the graph
      // and puts its own marks on the nodes the live run is marking. The first walk of
      // this card found it live, in a picture of a locked editor.
      ['Dry-run', during.dryRunDisabled],
      ['Run', during.runDisabled],
    ] as const) {
      if (state !== true) {
        failures.push(`${what} was not locked while a run walked (read ${String(state)}).`);
      }
    }
    if (during.paletteButtonsEnabled > 0) {
      failures.push(
        `${String(during.paletteButtonsEnabled)} palette buttons could still place or ` +
          'connect while a run walked.',
      );
    }
    if (!during.canvasLocked) {
      failures.push('the canvas did not carry the locked marking while a run walked.');
    }
    // #3, the other half: reading still works. A lock that took the panel away would
    // pass every reading above and fail the card.
    if (panelDuring === null || panelDuring.roleChars === 0) {
      failures.push(
        'selecting a node during the run gave no role text, so reading what a step is ' +
          'told stopped working when the graph locked.',
      );
    }
    if (panelDuring !== null && panelDuring.advancedOpen) {
      failures.push('the node panel came up with Advanced already open during the run.');
    }
    if (!during.controlPresent) {
      failures.push('Pause and Continue were not reachable while a run walked.');
    }
    // #1 again, and this is where it counts: the removed surfaces stayed removed with a
    // run on. Every one of them used to appear at exactly this moment.
    observations['removedSurfacesDuring'] = during.gone;
    for (const [what, present] of Object.entries(during.gone)) {
      if (present && what !== 'journal') {
        failures.push(`"${what}" was on screen during the run; DSP-86 #1 removes it.`);
      }
    }
    if (during.gone.journal) {
      failures.push(
        'the run journal was occupying the graph view during the run. DSP-86 #9 keeps it ' +
          'as diagnostics reached from a menu.',
      );
    }

    // --- Waiting for the person is the run going on (#4) --------------------
    await waitFor(
      'the run to stop and wait for the person, as "wait for me" asks it to',
      () => {
        const phase = textOf('loop-control-phase');
        return phase.toLowerCase().includes('wait') || phase.toLowerCase().includes('hold');
      },
      180_000,
      200,
    );
    const whileWaiting = editorHook().readView();
    observations['whileWaitingForThePerson'] = whileWaiting;
    record('view-while-waiting', {
      locked: whileWaiting.locked,
      controlPhase: whileWaiting.controlPhase,
      standing: whileWaiting.standing,
    });
    await window.dspatch.captureWindow('one-view-waiting-for-the-person');
    if (!whileWaiting.locked) {
      failures.push(
        'the graph unlocked while the run was waiting for the person. Waiting is the run ' +
          'going on, and DSP-86 #4 keeps the lock through it.',
      );
    }
    if (ended) {
      failures.push(
        'the run had already ended by the time the hold was read, so "waiting keeps the ' +
          'lock" was never actually put to the window.',
      );
    }
    const movedWhileWaiting = viewDifferences(before, whileWaiting);
    if (movedWhileWaiting.length > 0) {
      failures.push(`waiting for the person changed the view: ${movedWhileWaiting.join('; ')}.`);
    }

    // The journal, asked for from the real menu item, and put away again (#9).
    const journalItemExists = await window.dspatch.pressMenuItem('show-run-journal');
    await sleep(500);
    const withJournal = editorHook().readView();
    await window.dspatch.captureWindow('one-view-journal-from-the-menu');
    await window.dspatch.pressMenuItem('show-run-journal');
    await sleep(400);
    const journalPutAway = editorHook().readView();
    observations['runJournalFromTheMenu'] = {
      menuItemExists: journalItemExists,
      shownWhenAsked: withJournal.gone.journal,
      goneWhenAskedAgain: !journalPutAway.gone.journal,
    };
    if (!journalItemExists) {
      failures.push('there is no "Run journal (diagnostics)" menu item, which DSP-86 #9 asks for.');
    } else if (!withJournal.gone.journal) {
      failures.push('the menu item did not bring the run journal onto the screen.');
    } else if (journalPutAway.gone.journal) {
      failures.push('the run journal could be opened from the menu and not put away again.');
    }

    // --- Let it walk, and read the marks it puts on the drawing (#2) --------
    //
    // Continue first, then *start on their own* for the rest. The other order was the
    // first walk's mistake: changing the mode releases the hold by itself, so by the
    // time Continue was pressed there was nothing held and the button was correctly
    // disabled — a timeout that looked like a missing control.
    await click('loop-continue', 30_000);
    await chooseInSelect('loop-mode', 'autonomous');
    /*
     * The marks, read here rather than at the hold.
     *
     * At the hold nothing has walked yet, so no node carries a mark — which is right,
     * and which the first walk recorded as the run failing to show itself. What #2 asks
     * is that a run *in motion* shows itself on the drawing, so the reading belongs
     * after the release. It is a `waitFor` rather than a sleep because how fast the
     * canned replies arrive is not something to encode as a number.
     */
    // A holder rather than a bare variable: assigning inside the predicate is invisible
    // to the narrowing that follows, and the reading would type as `never` below.
    const seen: { view: ViewReading | null } = { view: null };
    try {
      await waitFor(
        'a node on the drawing to carry a run mark',
        () => {
          if (ended) {
            return true;
          }
          const reading = editorHook().readView();
          if (reading.marked.length > 0) {
            seen.view = reading;
          }
          return seen.view !== null;
        },
        120_000,
        100,
      );
    } catch {
      /* Reported below as the absence it is, rather than as a thrown trial. */
    }
    const walking = seen.view;
    observations['whileWalking'] = walking;
    record('view-while-walking', { marked: walking === null ? [] : walking.marked });
    if (walking === null) {
      failures.push(
        'no node on the drawing ever carried a run mark while the run walked, so the run ' +
          'was not showing itself in the one place this card leaves for it.',
      );
    } else {
      await window.dspatch.captureWindow('one-view-while-walking');
      const movedWhileWalking = viewDifferences(before, walking);
      if (movedWhileWalking.length > 0) {
        failures.push(`the run walking changed the view: ${movedWhileWalking.join('; ')}.`);
      }
    }

    // --- And read the view once it really has ended -------------------------
    await waitFor('the run to finish', () => ended, 300_000, 250);
    // The ending, the stand-by offer that follows it and the paint after both.
    await sleep(1_500);
    const after = editorHook().readView();
    const panelAfter = await editorHook().showNode(nodeToSelect, false);
    observations['afterTheRun'] = after;
    observations['runOutcomeKind'] =
      typeof outcome === 'object' && outcome !== null && 'kind' in outcome
        ? String((outcome as { kind: unknown }).kind)
        : 'unknown';
    record('view-after', {
      locked: after.locked,
      entryState: after.entryState,
      selected: after.selectedId,
      zoom: after.zoom,
    });
    await window.dspatch.captureWindow('one-view-after-the-run');

    // #5: unlocked by itself, with nothing pressed to make it happen.
    if (after.locked) {
      failures.push(
        'the graph was still locked after the run ended. Nothing should have to be pressed ' +
          'to get back to editing \u2014 that is the point of the whole card.',
      );
    }
    for (const [what, state] of [
      ['the loop chooser', after.chooserDisabled],
      ['Open loop…', after.openLoopDisabled],
      ['the inspector fields', after.inspectorLocked],
      ['Dry-run', after.dryRunDisabled],
    ] as const) {
      if (state !== false) {
        failures.push(`${what} was still locked after the run ended (read ${String(state)}).`);
      }
    }
    // #5 again: the same graph and the same view state, which is the reading this whole
    // scenario is built around.
    const movedOnEnd = viewDifferences(before, after);
    observations['whatMovedAcrossTheWholeRun'] = movedOnEnd;
    if (movedOnEnd.length > 0) {
      failures.push(
        `the view is not what it was before the run: ${movedOnEnd.join('; ')}. The card asks ` +
          'for the same graph and the same view state at the end.',
      );
    }
    if (panelAfter === null || panelAfter.roleChars === 0) {
      failures.push('the node panel had no role text after the run ended.');
    }
    // #6: the Ready pulse, back on the entry step, with nothing toggled.
    if (after.entryState !== 'ready') {
      failures.push(
        `after the run the entry step was marked "${after.entryState}" rather than ready. ` +
          'With Use loop still ticked the pulse has to come back on its own; needing the ' +
          'tick switched off and on again is the button this card removes wearing a ' +
          'tick-box.',
      );
    }

    /*
     * --- Unsaved edits are never run quietly (#8) ---------------------------
     *
     * A throwaway copy of the loop, chosen through the real **Open loop…**, because this
     * part *writes a file* and the loop the rest of the trial used is the repository's
     * own. The harness puts the copy under %TEMP% and answers the two dialogs through
     * `DSPATCH_PICK_FILE` and `DSPATCH_SAVE_BEFORE_RUN`.
     *
     * Both answers are put to the window, in the order that makes each one mean
     * something: *Cancel* first, which has to start nothing and leave the file alone, and
     * then *Save and run*, which has to write the drawing and walk what it wrote. Testing
     * only the saving half would leave the more dangerous outcome — a run a person
     * thought they had stopped — unevidenced.
     */
    const scratchDefinition = plan.choosableDefinitions?.[0] ?? '';
    if (scratchDefinition === '') {
      failures.push(
        'the trial was given no throwaway declaration, so the save-or-cancel at the start ' +
          'of a run was never put to the window. Set DSPATCH_CHOOSE_DEFINITIONS.',
      );
    } else {
      await click('open-loop-definition');
      await waitFor(
        `Open loop… to have selected and drawn ${scratchDefinition}`,
        () => editorHook().readChooser().chooserValue === scratchDefinition,
        30_000,
      );
      await sleep(500);
      const scratchEntry = editorHook().readView().entryNodeId;
      const nudged = editorHook().nudgeNode(scratchEntry, 17);
      await sleep(400);
      const dirty = editorHook().readView();
      observations['unsavedBeforeTheSecondRun'] = {
        definition: scratchDefinition,
        nudgedNode: scratchEntry,
        nudged,
        titleLine: dirty.titleLine,
        unsavedChip: dirty.unsavedChip,
      };
      record('editor-made-dirty', { nudged, titleLine: dirty.titleLine.slice(0, 160) });
      if (!dirty.titleLine.includes('unsaved changes')) {
        failures.push(
          'moving a node did not leave the editor holding unsaved changes, so the ' +
            'save-or-cancel had nothing to be asked about.',
        );
      }

      // --- Cancel: nothing starts, and the drawing stays unsaved ------------
      const refusedId = `dsp-one-view-cancel-${String(Date.now())}`;
      const refused = await window.dspatch.startChatLoopRun({
        runId: refusedId,
        mandate: 'Say in one sentence what this project is for.',
        definitionKey: scratchDefinition,
      });
      await sleep(600);
      const afterCancel = editorHook().readView();
      observations['whenTheSaveWasCancelled'] = {
        outcomeKind: refused.kind,
        reason: refused.kind === 'refused' ? refused.reason : '',
        stillUnsaved: afterCancel.titleLine.includes('unsaved changes'),
        stillUnlocked: !afterCancel.locked,
      };
      record('save-or-cancel-cancelled', { outcomeKind: refused.kind });
      await window.dspatch.captureWindow('one-view-unsaved-and-cancelled');
      if (refused.kind !== 'refused') {
        failures.push(
          `cancelling the save at the start of a run gave "${refused.kind}" rather than a ` +
            'refusal. An older version than the one on screen must never be run quietly.',
        );
      } else if (!refused.reason.includes('unsaved')) {
        failures.push(
          `the refusal did not say what was unsaved: "${refused.reason.slice(0, 200)}".`,
        );
      }
      if (!afterCancel.titleLine.includes('unsaved changes')) {
        failures.push('cancelling lost the drawing\u2019s unsaved changes.');
      }
      if (afterCancel.locked) {
        failures.push('a run that was never started left the graph locked.');
      }

      // --- Save and run: the file is written, and what walks is what is drawn
      const savedId = `dsp-one-view-save-${String(Date.now())}`;
      const saved = await window.dspatch.startChatLoopRun({
        runId: savedId,
        mandate: 'Say in one sentence what this project is for.',
        definitionKey: scratchDefinition,
      });
      await sleep(1_500);
      const afterSave = editorHook().readView();
      observations['whenTheSaveWasAccepted'] = {
        outcomeKind: saved.kind,
        stillUnsaved: afterSave.titleLine.includes('unsaved changes'),
        pinnedDrawingChip: afterSave.pinnedDrawingChip,
        locked: afterSave.locked,
        entryState: afterSave.entryState,
      };
      record('save-or-cancel-saved', { outcomeKind: saved.kind });
      await window.dspatch.captureWindow('one-view-saved-and-ran');
      if (saved.kind !== 'finished') {
        failures.push(
          `choosing Save and run gave "${saved.kind}" rather than a finished run` +
            (saved.kind === 'refused' ? `: ${saved.reason.slice(0, 200)}` : '') +
            '.',
        );
      }
      if (afterSave.titleLine.includes('unsaved changes')) {
        failures.push(
          'the editor still reported unsaved changes after DSpatch saved the drawing for ' +
            'it, so the window is telling a person to save something already on disk.',
        );
      }
      /*
       * And no divergence chip, which is the *other* half of "say the truth about the
       * pinned version". Saving first is what makes the bytes that ran and the bytes on
       * screen the same bytes; a chip here would mean they were not.
       */
      if (afterSave.pinnedDrawingChip !== '') {
        failures.push(
          `after Save and run the window said the pinned version was not the drawing on ` +
            `screen ("${afterSave.pinnedDrawingChip}"), which is exactly what saving first ` +
            'is supposed to prevent.',
        );
      }
      if (afterSave.locked) {
        failures.push('the graph was still locked after the saved run ended.');
      }

      /*
       * --- And the truth when the two really are different bytes (#7) ------
       *
       * The run pins its version, and with one view that no longer means the canvas
       * changes under a person — it means the window owes them a word when the drawing
       * they are looking at is not the drawing being walked. Three of the four ways
       * those could drift apart are closed at the source: choosing draws, editing is
       * locked, and starting against unsaved edits asks first. The fourth is still open
       * and is the one a person meets: **File → Open Graph File…**, which draws a
       * standalone `.graph.json` that is not a loop and was never chosen as one.
       *
       * So: hold a run, open such a file into the same view, and read what the window
       * says. It must say it rather than mark the wrong graph — the marks belong to the
       * run's nodes and would land on whatever ids happened to match.
       */
      const standalone = plan.brokenDefinition ?? '';
      if (standalone !== '') {
        await chooseInSelect('loop-mode', 'interactive');
        await sleep(300);
        const heldId = `dsp-one-view-pin-${String(Date.now())}`;
        let heldEnded = false;
        void window.dspatch
          .startChatLoopRun({
            runId: heldId,
            mandate: 'Say in one sentence what this project is for.',
            definitionKey: scratchDefinition,
          })
          .catch(() => {
            /* Reported through the readings below. */
          })
          .finally(() => {
            heldEnded = true;
          });
        await waitFor(
          'the editor to lock for the held run',
          () => editorHook().readView().locked,
          120_000,
          100,
        );
        const beforeTheOtherGraph = editorHook().readView();
        await window.dspatch.pressMenuItem('open-graph-file');
        await waitFor(
          'the standalone graph to be drawn over the same view',
          () => editorHook().readView().graphName !== beforeTheOtherGraph.graphName,
          30_000,
        );
        await sleep(500);
        const diverged = editorHook().readView();
        observations['whenTheDrawingIsNotWhatIsRunning'] = {
          standalone,
          graphNameBefore: beforeTheOtherGraph.graphName,
          graphNameNow: diverged.graphName,
          pinnedDrawingChip: diverged.pinnedDrawingChip,
          marked: diverged.marked,
          stillLocked: diverged.locked,
        };
        record('pinned-version-diverged', { chip: diverged.pinnedDrawingChip });
        await window.dspatch.captureWindow('one-view-pinned-version-differs');
        if (diverged.pinnedDrawingChip === '') {
          failures.push(
            'a graph other than the one being run was drawn in the view and the window ' +
              'said nothing about it. The run pins its version, and the window owes a ' +
              'person the truth when the pinned version is not what is on screen.',
          );
        }
        if (diverged.marked.length > 0) {
          failures.push(
            `the run's marks were on a drawing that is not the run's: ` +
              `${JSON.stringify(diverged.marked)}. Node ids that happen to match are not ` +
              'the same steps.',
          );
        }
        if (!diverged.locked) {
          failures.push('opening another graph during a run unlocked the view.');
        }
        // Let it go, so the trial does not end on a run it is still holding.
        await chooseInSelect('loop-mode', 'autonomous');
        await waitFor('the held run to finish', () => heldEnded, 300_000, 250);
      }
    }

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.oneViewDidNotHold,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      sessionId: textOf('session-id'),
      standing: attributeOf('run-standing', 'data-standing'),
      controlPhase: textOf('loop-control-phase'),
      view: window.__dspatchEditorCheck === undefined ? null : editorHook().readView(),
    };
    return finish(CHAT_EXIT.oneViewDidNotHold, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-80 and DSP-36: liveness on the drawing, and where a run ended          */
/* ------------------------------------------------------------------------- */

/** One node's liveness reading, as the editor's hook reports it. */
type LivenessReading = ReturnType<
  NonNullable<Window['__dspatchEditorCheck']>['readLiveness']
>[number];

/** Every marked node right now, plus what the view says about the run around them. */
function livenessNow(name: string): LivenessState {
  const view = editorHook().readView();
  return {
    name,
    entryNodeId: view.entryNodeId,
    nodes: [...editorHook().readLiveness()],
    // The lock is the run: DSP-86 made `viewIsLocked` exactly "a run is walking this
    // drawing", so this is a reading of whether there is a run rather than a guess.
    runOn: view.locked,
    controlPhase: view.controlPhase,
  };
}

function readingFor(state: LivenessState, nodeId: string): LivenessReading | null {
  return state.nodes.find((node) => node.id === nodeId) ?? null;
}

/** The node the run is in, or `null` when the run is between steps. */
function workingNow(state: LivenessState): LivenessReading | null {
  return state.nodes.find((node) => node.working) ?? null;
}

/**
 * What the graph says a run is doing, and where it says the run ended.
 *
 * **Why these two cards are one walk.** They are two markings on one surface — the node's
 * own rendering — and the states they make interact: the request in DSP-36 is that a
 * finished run's mark and the Ready pulse be readable *at the same time*, which cannot be
 * established by looking at either card alone.
 *
 * **What is measured rather than asserted.** Every state is read through
 * `readLiveness()`, which reports the browser's own count of running animations from
 * `getAnimations()` and each node's two bounding boxes. So *something is moving* is the
 * browser's answer and not a class name the stylesheet and the trial would agree about,
 * and *the glint did not inflate the node* is a measurement in graph units rather than a
 * promise. The pictures are for Niclas; the numbers are what this trial stands on.
 *
 * **The ending, twice, on one drawing's wording.** The last part walks two throwaway
 * copies of one loop whose only difference is a terminal's `ending` attribute, its label
 * left saying *Assignment met* in both. That pair is the whole evidence that the tick comes
 * from the recorded outcome and the graph's declaration rather than from the words: a tick
 * decided by wording would appear on both.
 *
 * **No provider call.** The steps walk through `PresentationAdapter`. Its stream is slowed
 * on purpose so that *no new text arrived* is an interval a sample can fall inside; the
 * fixture's speed decides how long the quiet lasts and nothing about what the window does
 * during it.
 */
async function runLivenessAndAnEndingScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call: the steps walk through the local presentation adapter, whose ' +
      'replies are canned and deliberately slowed. The run is started through ' +
      'startChatLoopRun \u2014 the same main-process handler the composer\u2019s Send calls ' +
      'with the same request \u2014 because pressing Send means leaving the editor surface, ' +
      'which would unmount the graph being measured. It establishes which nodes are drawn ' +
      'as ready, working, held and ended, that those readings differ from one another, and ' +
      'that the ending mark follows the run\u2019s recorded outcome. It says nothing about ' +
      'whether the animation is pleasant to look at, which is Niclas\u2019s to judge, and ' +
      'nothing about any model.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const walk: LivenessState[] = [];
  /**
   * Take a picture, and refuse it if it cannot show its own subject.
   *
   * Report 021's gate, reused. A capture titled *this step is working* proves nothing if
   * the node is scrolled out of the canvas, so the node is measured inside the window
   * before the file is written and the trial fails rather than filing a picture of the
   * wrong thing.
   */
  const capture = async (label: string, subject: LivenessReading | null): Promise<void> => {
    const verdict = checkCaptureCanShowTheNode(
      label,
      subject,
      window.innerWidth,
      window.innerHeight,
    );
    if (verdict.failure !== null) {
      failures.push(verdict.failure);
      return;
    }
    await window.dspatch.captureWindow(label);
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    // Ticked once, here, and never touched again: the Ready pulse coming back at the end
    // has to be a restoration rather than a second tick (DSP-36 #6).
    const ticked = await setCheckbox('use-loop', true);
    if (!ticked) {
      failures.push('`Use loop` could not be ticked, so no loop ever stood by.');
      return finish(CHAT_EXIT.livenessDidNotRead, steps, failures, observations);
    }
    await goToEditor();
    await waitFor(
      'the chosen loop to be drawn on the canvas',
      () => editorHook().readChooser().nodesDrawn > 0,
      30_000,
    );
    const definitionKey = editorHook().readChooser().chooserValue;
    record('project-open', { ticked, definitionKey });

    // --- Ready: the loop is standing by ------------------------------------
    await sleep(600);
    const ready = livenessNow('ready');
    walk.push(ready);
    observations['ready'] = ready;
    record('ready', {
      entryState: readingFor(ready, ready.entryNodeId)?.state ?? '',
      animations: readingFor(ready, ready.entryNodeId)?.animations ?? 0,
      glintsLit: readingFor(ready, ready.entryNodeId)?.glintsLit ?? 0,
    });
    await capture('liveness-1-ready', readingFor(ready, ready.entryNodeId));

    // --- Start the run, and read it while a step is in flight ---------------
    const runId = `dsp-liveness-${String(Date.now())}`;
    let ended = false;
    let outcome: unknown = null;
    void window.dspatch
      .startChatLoopRun({
        runId,
        mandate:
          'Read this project and say in one sentence what it is for. Change nothing, add ' +
          'no dependency and run no commands.',
        definitionKey: definitionKey === '' ? null : definitionKey,
      })
      .then((value) => {
        outcome = value;
      })
      .catch((error: unknown) => {
        outcome = { kind: 'threw', error: String(error) };
      })
      .finally(() => {
        ended = true;
      });

    await waitFor(
      'a node on the drawing to be drawn as working',
      () => ended || workingNow(livenessNow('working')) !== null,
      180_000,
      100,
    );
    const working = livenessNow('working');
    walk.push(working);
    observations['working'] = working;
    const busy = workingNow(working);
    record('working', {
      node: busy?.id ?? '',
      state: busy?.state ?? '',
      glintsLit: busy?.glintsLit ?? 0,
      animations: busy?.animations ?? 0,
      haloOpacity: busy?.haloOpacity ?? 0,
    });
    await capture('liveness-2-working', busy);

    /*
     * --- Working in silence, which is the constraint most likely to be got wrong ---
     *
     * Samples of two things at once: how much reply is on screen, and whether the node is
     * still glinting. The gate looks for a consecutive pair whose reply length is
     * identical — nothing arrived between them — and requires the glint at both ends. One
     * sample cannot establish this; a pair inside a quiet interval can.
     */
    const silence: SilenceSample[] = [];
    for (let index = 0; index < 14; index += 1) {
      const now = livenessNow('silence-sample');
      silence.push({
        replyChars: conversationText().length,
        working: workingNow(now),
        atMs: Math.round(performance.now() - startedAt),
      });
      if (ended) {
        break;
      }
      await sleep(350);
    }
    observations['whileNothingCameBack'] = silence.map((sample) => ({
      atMs: sample.atMs,
      replyChars: sample.replyChars,
      node: sample.working?.id ?? '',
      glintsLit: sample.working?.glintsLit ?? 0,
      animations: sample.working?.animations ?? 0,
    }));
    const silenceVerdict = checkGlintSurvivesSilence(silence);
    if (silenceVerdict.failure !== null) {
      failures.push(silenceVerdict.failure);
    }

    /*
     * --- Zoom and pan while it is still glinting ----------------------------
     *
     * The reading is taken at two zooms and compared in graph units, because a client
     * rectangle grows with the zoom and comparing raw pixels across one would fail a
     * correct implementation. What must not change is the node's own size, body and glint
     * alike.
     */
    const zoomFootprints: GlintFootprint[] = [];
    const busyBeforeZoom = workingNow(livenessNow('before-zoom'));
    // The zoom is *read*, never assumed. The first walk of this trial assumed 1 and duly
    // reported the node changing size: the editor opens at the zoom it was left at, which
    // was 0.85, so it was comparing 143 graph units with 168 and both were correct.
    const zoomBefore = editorHook().readView().zoom;
    if (busyBeforeZoom !== null) {
      zoomFootprints.push({ label: 'before zooming', zoom: zoomBefore, node: busyBeforeZoom });
      await editorHook().setViewState(1.4, 140, 110);
      await sleep(400);
      const zoomed = livenessNow('zoomed');
      const busyZoomed = workingNow(zoomed);
      if (busyZoomed !== null) {
        zoomFootprints.push({ label: 'zoomed to 140% and panned', zoom: 1.4, node: busyZoomed });
      }
      await capture('liveness-3-working-zoomed', busyZoomed);
      observations['zoomedWhileWorking'] = {
        footprints: zoomFootprints,
        scroll: [zoomed.nodes.length, editorHook().readView().scrollLeft],
      };
      const zoomVerdict = checkGlintKeepsTheNodesSize(zoomFootprints);
      if (zoomVerdict.failure !== null) {
        failures.push(zoomVerdict.failure);
      }
      // Back where it was, so every later reading is of the same view as the first.
      await editorHook().setViewState(zoomBefore, 0, 0);
      await sleep(300);
    } else {
      failures.push(
        'the run was no longer in a step by the time the zoom reading was taken, so ' +
          'whether zooming and panning disturb the glint was not established.',
      );
    }

    /*
     * --- Reduced motion, before the run leaves the state ---------------------
     *
     * Asked of the real window through Chromium's own media emulation, because the
     * preference belongs to the operating system and a trial that read the stylesheet
     * would only establish that a rule had been typed.
     */
    const ordinaryMotion = workingNow(livenessNow('ordinary-motion'));
    const emulated = await window.dspatch.emulateReducedMotion(true);
    await sleep(500);
    const reducedState = livenessNow('reduced-motion');
    const reducedMotion = reducedState.nodes.find((node) => node.id === ordinaryMotion?.id) ?? null;
    observations['reducedMotion'] = { emulated, ordinary: ordinaryMotion, reduced: reducedMotion };
    record('reduced-motion', {
      emulated,
      animationsBefore: ordinaryMotion?.animations ?? 0,
      animationsAfter: reducedMotion?.animations ?? 0,
      glintsLitAfter: reducedMotion?.glintsLit ?? 0,
    });
    await capture('liveness-4-reduced-motion', reducedMotion);
    const reducedVerdict = checkReducedMotionIsStill({
      emulated,
      ordinary: ordinaryMotion,
      reduced: reducedMotion,
    });
    if (reducedVerdict.failure !== null) {
      failures.push(reducedVerdict.failure);
    }
    await window.dspatch.emulateReducedMotion(false);
    await sleep(400);

    /*
     * --- Held for the person -----------------------------------------------
     *
     * *Wait for me* is chosen **now** rather than before the run, and that is the whole
     * difference between this walk and DSP-86's. The control holds a step *before it
     * starts*, so choosing the mode first stops the run at its very first step, where no
     * node has been entered and the drawing carries no mark at all — which would have made
     * "the state is still evident at a pause" unreadable for want of any state. Chosen
     * here, the hold lands after the step in flight has produced, and the drawing shows
     * where the run got to with nothing moving on it.
     */
    await chooseInSelect('loop-mode', 'interactive');
    await waitFor(
      'the run to stop and wait for the person',
      () => {
        const phase = textOf('loop-control-phase').toLowerCase();
        return ended || phase.includes('wait') || phase.includes('hold');
      },
      240_000,
      150,
    );
    await sleep(400);
    const held = livenessNow('held');
    walk.push(held);
    observations['heldForThePerson'] = held;
    record('held', {
      controlPhase: held.controlPhase,
      working: held.nodes.filter((node) => node.working).map((node) => node.id),
      marked: held.nodes.map((node) => `${node.id}:${node.state}`),
      runOn: held.runOn,
    });
    await capture('liveness-5-held', held.nodes[0] ?? null);
    if (ended) {
      failures.push(
        'the run finished before it could be held, so the state in which the working ' +
          'animation stops was never put to the window.',
      );
    }

    // --- Released, and working again ---------------------------------------
    await click('loop-continue', 30_000);
    await chooseInSelect('loop-mode', 'autonomous');
    const againHolder: { state: LivenessState | null } = { state: null };
    try {
      await waitFor(
        'a node to be drawn as working again after the hold',
        () => {
          if (ended) {
            return true;
          }
          const now = livenessNow('working-again');
          if (workingNow(now) !== null) {
            againHolder.state = now;
          }
          return againHolder.state !== null;
        },
        240_000,
        100,
      );
    } catch {
      /* Reported below as the absence it is. */
    }
    const workingAgain = againHolder.state ?? livenessNow('working-again');
    walk.push({ ...workingAgain, name: 'working-again' });
    observations['workingAgain'] = workingAgain;
    record('working-again', {
      node: workingNow(workingAgain)?.id ?? '',
      glintsLit: workingNow(workingAgain)?.glintsLit ?? 0,
    });
    await capture('liveness-6-working-again', workingNow(workingAgain));

    // --- The end, and the mark it leaves ------------------------------------
    await waitFor('the run to finish', () => ended, 420_000, 250);
    // The ending, the stand-by offer that follows it, and the paint after both.
    await sleep(2_000);
    const ranStatus =
      typeof outcome === 'object' && outcome !== null && 'kind' in outcome
        ? String((outcome as { kind: unknown }).kind)
        : 'unknown';
    const endedState = livenessNow('ended');
    walk.push(endedState);
    const endedAt = endedState.nodes.find((node) => node.ending !== '') ?? null;
    observations['ended'] = endedState;
    observations['runOutcomeKind'] = ranStatus;
    record('ended', {
      outcomeKind: ranStatus,
      endedAt: endedAt?.id ?? '',
      ending: endedAt?.ending ?? '',
      tick: endedAt?.tick ?? false,
      ring: endedAt?.ring ?? false,
      entryState: readingFor(endedState, endedState.entryNodeId)?.state ?? '',
    });
    await capture('liveness-7-ended', endedAt ?? readingFor(endedState, endedState.entryNodeId));

    /*
     * Ready again, with the ending still on screen.
     *
     * The same reading as `ended` in this build, because the stand-by offer arrives within
     * a couple of hundred milliseconds of the run ending and both are already in the
     * reading above — which is precisely the state the card asks for. It is recorded as its
     * own step so that a future build in which the two came apart would show it here
     * rather than hide it inside one name.
     */
    const readyAgain = livenessNow('ready-again');
    walk.push(readyAgain);
    observations['readyAgain'] = readyAgain;
    const endingAfterwards = readyAgain.nodes.find((node) => node.ending !== '') ?? null;
    record('ready-again', {
      entryState: readingFor(readyAgain, readyAgain.entryNodeId)?.state ?? '',
      entryAnimations: readingFor(readyAgain, readyAgain.entryNodeId)?.animations ?? 0,
      endingStillShown: endingAfterwards?.id ?? '',
    });
    await capture(
      'liveness-8-ready-again-with-the-ending',
      readingFor(readyAgain, readyAgain.entryNodeId),
    );

    const statesVerdict = checkLivenessStates(walk);
    if (statesVerdict.failure !== null) {
      failures.push(statesVerdict.failure);
    }

    // --- A second run clears the mark (#7) ---------------------------------
    let secondEnded = false;
    void window.dspatch
      .startChatLoopRun({
        runId: `dsp-liveness-again-${String(Date.now())}`,
        mandate: 'Say in one sentence what this project is for.',
        definitionKey: definitionKey === '' ? null : definitionKey,
      })
      .catch(() => {
        /* Read through the window below. */
      })
      .finally(() => {
        secondEnded = true;
      });
    const duringSecond: { state: LivenessState | null } = { state: null };
    try {
      await waitFor(
        'the second run to be walking the drawing',
        () => {
          if (secondEnded) {
            return true;
          }
          const now = livenessNow('second-run');
          if (now.runOn && now.nodes.length > 0) {
            duringSecond.state = now;
          }
          return duringSecond.state !== null;
        },
        240_000,
        100,
      );
    } catch {
      /* Reported below. */
    }
    const secondRun = duringSecond.state;
    observations['duringTheSecondRun'] = secondRun;
    const markInSecondRun =
      secondRun === null ? null : (secondRun.nodes.find((node) => node.ending !== '') ?? null);
    record('second-run', {
      reached: secondRun !== null,
      endingStillShown: markInSecondRun?.id ?? '',
    });
    await capture('liveness-9-second-run', secondRun === null ? null : workingNow(secondRun));
    if (secondRun === null) {
      failures.push(
        'a second run never showed itself on the drawing, so whether a new run clears the ' +
          'previous ending mark was not established.',
      );
    }

    /*
     * --- Another drawing must not inherit the mark (#8) ---------------------
     *
     * A different loop is drawn over the same view while the mark from the first run is
     * still remembered. Node ids are not unique between graphs, so a mark bound to an id
     * rather than to the run and its graph would light whichever box happened to share a
     * name.
     */
    await waitFor('the second run to finish', () => secondEnded, 420_000, 250);
    await sleep(1_500);
    const standalone = plan.brokenDefinition ?? '';
    let markOnAnotherDrawing = false;
    if (standalone !== '') {
      const before = editorHook().readView().graphName;
      await window.dspatch.pressMenuItem('open-graph-file');
      try {
        await waitFor(
          'another graph to be drawn in the same view',
          () => editorHook().readView().graphName !== before,
          30_000,
        );
        await sleep(500);
        const other = livenessNow('another-drawing');
        markOnAnotherDrawing = other.nodes.some((node) => node.ending !== '');
        observations['anotherDrawing'] = {
          graphNameBefore: before,
          graphNameNow: editorHook().readView().graphName,
          marked: other.nodes.map((node) => `${node.id}:${node.state}:${node.ending}`),
        };
        /*
         * Captured without the node gate, and this is the one place that is right.
         *
         * The claim here is that **nothing** carries a mark, so there is no subject node to
         * measure and the gate correctly refused this picture when it was given one. The
         * evidence is the reading beside it; the picture is so that Niclas can see the other
         * drawing came up clean.
         */
        await window.dspatch.captureWindow('liveness-10-another-drawing');
      } catch (error) {
        observations['anotherDrawing'] = {
          couldNotOpen: error instanceof Error ? error.message : String(error),
        };
      }
    }

    /*
     * --- The ending marks, and the one reading that proves where they come from ---
     *
     * Two throwaway copies of one loop. The only difference between the files is the
     * `ending` attribute on the terminal both walks arrive at; its label says *Assignment
     * met* in both. So a tick decided by the wording appears twice, and a tick decided by
     * the graph's declaration and the run's recorded outcome appears once.
     *
     * Walked with the real **Dry-run** path, which announces its ending exactly as a live
     * run does, and it answers with the *runner's* status and terminal rather than with the
     * sentence the window wrote about them.
     */
    const endings: EndingObservation[] = [];
    for (const [label, declared] of [
      ['declared success', 'success'],
      ['declared not-success', 'not-success'],
    ] as const) {
      const definition = plan.choosableDefinitions?.[declared === 'success' ? 0 : 1] ?? '';
      if (definition === '') {
        failures.push(
          `the trial was given no throwaway declaration for the "${label}" walk, so the ` +
            'reading that distinguishes a tick from a label was not taken. Set ' +
            'DSPATCH_CHOOSE_DEFINITIONS to two copies.',
        );
        continue;
      }
      const chosen = await editorHook().chooseLoop(definition);
      await sleep(500);
      if (chosen.chooserValue !== definition) {
        failures.push(
          `the ${label} copy could not be chosen in the editor (the chooser holds ` +
            `"${chosen.chooserValue}"), so its ending was never walked.`,
        );
        continue;
      }
      const walked = await editorHook().dryRunOnCanvas();
      await sleep(600);
      const after = livenessNow(`ending-${declared}`);
      const terminal = walked?.terminalNodeId ?? '';
      const node = terminal === '' ? null : readingFor(after, terminal);
      endings.push({
        label,
        terminalNodeId: terminal,
        declared,
        terminalLabel: 'Assignment met',
        status: walked?.status ?? 'unknown',
        node,
        others: after.nodes,
      });
      record(`ending-${declared}`, {
        definition,
        status: walked?.status ?? 'unknown',
        terminal,
        path: walked?.path ?? [],
        tick: node?.tick ?? false,
        ring: node?.ring ?? false,
        ending: node?.ending ?? '',
      });
      await capture(`liveness-11-ending-${declared}`, node);
    }
    observations['endings'] = endings;
    const endingVerdict = checkEndingMarkFollowsTheOutcome(endings);
    if (endingVerdict.failure !== null) {
      failures.push(endingVerdict.failure);
    }

    const lifetime = {
      entryStateAfterwards: readingFor(readyAgain, readyAgain.entryNodeId)?.state ?? '',
      endingStillShown: endingAfterwards !== null,
      endingShownInTheNextRun: markInSecondRun !== null,
      endingShownOnAnotherDrawing: markOnAnotherDrawing,
      terminalNodeId: endedAt?.id ?? '',
    };
    observations['markLifetime'] = lifetime;
    const lifetimeVerdict = checkEndingMarkLastsAsLongAsItIsTrue(lifetime);
    if (lifetimeVerdict.failure !== null) {
      failures.push(lifetimeVerdict.failure);
    }

    return finish(
      failures.length === 0
        ? CHAT_EXIT.ok
        : endingVerdict.failure !== null || lifetimeVerdict.failure !== null
          ? CHAT_EXIT.endingMarkWasWrong
          : CHAT_EXIT.livenessDidNotRead,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      controlPhase: textOf('loop-control-phase'),
      walk,
      liveness: window.__dspatchEditorCheck === undefined ? null : editorHook().readLiveness(),
    };
    return finish(CHAT_EXIT.livenessDidNotRead, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-87: the chat says less, and never calls a reply silence                */
/* ------------------------------------------------------------------------- */

/**
 * The product's own ways of saying nothing has come back, as a person reads them.
 *
 * Searched for in the document as whole phrases rather than matched against one
 * element, because the fault was not in the element anyone would have looked at: the
 * composer's status span, the run's four-paragraph block and a note under the box all
 * said it, from two different sources, and fixing whichever one a script sampled
 * would have left the others.
 *
 * `Waiting for agent activity` is `ACTIVITY_WAIT_LEAD`, which is the one sentence
 * `loop-activity.ts` writes on DSpatch's own behalf; the rest are the send-wait
 * clock's and the run standing's. Kept as literals rather than imported so that a
 * reworded product string is a trial that stops finding the phrase — which is
 * visible in the record — rather than a trial that silently changes its subject.
 */
const SILENCE_PHRASES: readonly string[] = [
  'with nothing back',
  'Nothing back yet',
  'nothing has come back',
  'Nothing has come back',
  'Still nothing back',
  'Waiting for agent activity',
];

/** The four passages the card deletes, by the words a person would recognise. */
const DELETED_PASSAGES: readonly string[] = [
  'Next mandate',
  'Who is working, on what, and what happens next',
  'A loop run is working. Sending adds your message',
  'This wait is longer',
];

/** The whole document as a person sees it, whitespace collapsed. */
function documentText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The same, for the conversation column only. */
function conversationText(): string {
  const thread = document.querySelector<HTMLElement>('[data-ev="transcript"]');
  return (thread?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * What the chat says while a reply is arriving, and what it no longer says at all.
 *
 * **The fault this exists for.** Niclas's window read *281 s with nothing back* under
 * a loop run whose reply was visibly arriving on screen. Each half was a correct
 * sentence about some state; the window was in two states at once, and said both.
 *
 * **Why a unit test could not settle it.** Every function involved returned the right
 * answer for its own inputs. What was wrong was which of two clocks the line beside
 * the composer read — the loop's activity, addressed to a run and a step, or the
 * direct chat's send-wait, which had never been told a loop was running. That is a
 * question about one window at one instant, so the reading has to be taken at one
 * instant: how much reply is drawn, and what the window is saying about silence, in
 * the same sample. {@link checkNeverSilentWhileAnswering} refuses the pair.
 *
 * **Why the stream is slowed.** `DSPATCH_PRESENTATION_DELTA_MS` widens the interval
 * the sampling happens in. The fixture's speed decides how long the state lasts and
 * nothing about what the product does while it lasts — and at the default 45 ms the
 * whole reply lands inside a second, which is the one state where the old wording was
 * not a lie.
 *
 * **Deletion is checked as deletion.** The four passages are searched for across the
 * whole document, throughout, so a passage that is merely unreachable during this
 * trial is not mistaken for one that is gone.
 *
 * **No provider call.** The steps stream through `PresentationAdapter`. This
 * evidences what the window says about activity it is receiving, and nothing about
 * any model.
 */
async function runChatSaysLessScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. The loop walks through the local presentation adapter, whose ' +
      'replies are canned and whose stream is deliberately slowed so that the middle of ' +
      'one is an interval rather than an instant. This evidences what the window says ' +
      'about activity it is receiving, and that four named passages are absent from the ' +
      'document. It says nothing about any model, and the timings here are the ' +
      'fixture\u2019s rather than a provider\u2019s.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  /** Every deleted passage seen at any point, so absence is a claim about the run. */
  const passagesSeen = new Set<string>();
  const noteDeletedProse = (): void => {
    const text = documentText();
    for (const passage of DELETED_PASSAGES) {
      if (text.includes(passage)) {
        passagesSeen.add(passage);
      }
    }
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    const projectPath = textOf('project-0-path');
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    noteDeletedProse();

    // The placeholder as a person meets it, and then again with the tick on: it used
    // to be two different paragraphs, and the longer of the two was the loop's.
    const placeholderPlain =
      (element('prompt') as HTMLTextAreaElement | null)?.placeholder ?? '';
    const ticked = await setCheckbox('use-loop', true);
    await sleep(300);
    const placeholderWithLoop =
      (element('prompt') as HTMLTextAreaElement | null)?.placeholder ?? '';
    noteDeletedProse();
    observations['composer'] = {
      placeholderBeforeTicking: placeholderPlain,
      placeholderWithTheLoopOn: placeholderWithLoop,
      oneTextForBoth: placeholderPlain === placeholderWithLoop,
      routeNoteBeforeSending: textOf('composer-route-note'),
    };
    record('project-open', { projectPath, ticked, placeholder: placeholderWithLoop });
    await window.dspatch.captureWindow('says-less-before-send');

    // --- One run, read while it is answering --------------------------------
    const runsBefore = countEntries('loop-turn');
    await typeInto(
      'prompt',
      'Read this project and say in one sentence what it is for. Change nothing, add no ' +
        'dependency and run no commands.',
    );
    await sendFromComposer();
    await waitFor(
      'a new loop run to appear in the conversation',
      () => countEntries('loop-turn') > runsBefore,
      60_000,
      100,
    );
    const at = `loop-turn-${String(countEntries('loop-turn') - 1)}`;
    record('run-started', { entry: at });

    /**
     * One reading, taken in one synchronous pass.
     *
     * Nothing is awaited between the two halves. A sample that read the reply, waited,
     * and then read the sentence would be reporting two instants as one — and since
     * the fault is precisely that the two disagreed within a frame, that is the
     * difference between evidence and a coincidence.
     */
    const sample = (): StreamingSilenceSample => {
      const text = documentText();
      return {
        atMs: Math.round(performance.now() - startedAt),
        replyCharsShown: rawTextOf(`${at}-live-text`).length,
        toolCallsShown: element(`${at}-live-tools`)?.childElementCount ?? 0,
        silenceSentencesShown: SILENCE_PHRASES.filter((phrase) => text.includes(phrase)),
      };
    };

    const samples: StreamingSilenceSample[] = [];
    /** What the window said, beside the composer and at the step, while it answered. */
    const linesWhileAnswering: Record<string, unknown>[] = [];
    /*
     * A message sent into the run, read where the run is still working.
     *
     * Sent from inside the watch rather than after it, because what is being checked
     * is the acknowledgement's *place*: nothing standing beside the composer for the
     * duration of the run, and a short line on the message itself. After the run
     * ended the same text would be an ordinary chat turn and would establish nothing.
     */
    let messageSentAtMs: number | null = null;
    let routeNoteWhileRunning = '';
    const watchUntil = performance.now() + 240_000;
    while (performance.now() < watchUntil) {
      const reading = sample();
      samples.push(reading);
      noteDeletedProse();
      if (messageSentAtMs === null && reading.replyCharsShown > 0) {
        // The picture that goes with the readings, taken here rather than after the
        // watch: the subject is a reply on screen, and a window photographed once the
        // run had ended would show the one state nobody disputes.
        await window.dspatch.captureWindow('says-less-while-answering');
        await typeInto('prompt', 'One more thing, while you are at it.');
        routeNoteWhileRunning = textOf('composer-route-note');
        await sendFromComposer();
        messageSentAtMs = Math.round(performance.now() - startedAt);
      }
      const line = {
        atMs: reading.atMs,
        replyChars: reading.replyCharsShown,
        besideTheComposer: textOf('active-status'),
        theStepsOwnLine: textOf(`${at}-live-status`),
        runningLine: textOf('running-line'),
      };
      const last = linesWhileAnswering[linesWhileAnswering.length - 1];
      if (
        last === undefined ||
        last['besideTheComposer'] !== line.besideTheComposer ||
        last['theStepsOwnLine'] !== line.theStepsOwnLine
      ) {
        linesWhileAnswering.push(line);
      }
      if (newestLoopRunEnded()) {
        break;
      }
      await sleep(120);
    }
    observations['whileAnswering'] = {
      samplesTaken: samples.length,
      samplesWhereTheReplyGrew: samples.filter(
        (each, index) =>
          index > 0 && each.replyCharsShown > (samples[index - 1]?.replyCharsShown ?? 0),
      ).length,
      widestReplyDrawn: Math.max(0, ...samples.map((each) => each.replyCharsShown)),
      distinctLines: linesWhileAnswering,
      // Every silence sentence seen at any point, with how much reply was on screen
      // at the time. A run that ends quietly may legitimately say one of these; the
      // gate below is about the ones said over a growing reply.
      silenceSightings: samples
        .filter((each) => each.silenceSentencesShown.length > 0)
        .map((each) => ({
          atMs: each.atMs,
          replyChars: each.replyCharsShown,
          said: each.silenceSentencesShown,
        })),
    };

    const silenceGate = checkNeverSilentWhileAnswering(samples);
    observations['silenceGate'] = { failure: silenceGate.failure };

    await waitFor(
      'the run to report an end',
      () => newestLoopRunEnded(),
      240_000,
      250,
    );
    await sleep(600);
    noteDeletedProse();
    await window.dspatch.captureWindow('says-less-after-the-run');

    // --- A message sent into the run, acknowledged where it was sent --------
    //
    // Only the acknowledgement's *shape* is checked here: that nothing stood beside
    // the composer while the run worked, and that the line on the message is one
    // short sentence pair rather than a paragraph. Whether the message reaches a
    // step, and which one, is `conversation-during-work`'s subject.
    const acknowledgement = textOf('instruction-0-account');
    observations['messageIntoARun'] = {
      sentAtMs: messageSentAtMs,
      routeNoteBesideTheComposer: routeNoteWhileRunning,
      acknowledgementOnTheMessage: acknowledgement,
      acknowledgementCharacters: acknowledgement.length,
      badgeOnTheMessage: textOf('instruction-0-status'),
    };
    if (messageSentAtMs === null) {
      failures.push(
        'the trial never sent a message into the working run, so where a run ' +
          'acknowledges one was not observed. This is a fault in the instrument.',
      );
    } else if (routeNoteWhileRunning.trim() !== '') {
      failures.push(
        'a paragraph stood beside the composer while the run worked: ' +
          `\u201C${routeNoteWhileRunning}\u201D. DSP-87 puts the acknowledgement on the ` +
          'message instead.',
      );
    } else if (acknowledgement === '' || acknowledgement.length > 90) {
      failures.push(
        `the message sent into the run was acknowledged in ${String(acknowledgement.length)} ` +
          `characters: \u201C${acknowledgement}\u201D. It has to be short and it has to ` +
          'exist, because it is now the only thing said about that message.',
      );
    }
    noteDeletedProse();

    const proseObservation: DeletedProseObservation = {
      passagesFoundInDocument: [...passagesSeen],
      placeholderShownInWindow: placeholderWithLoop,
      wordsFoundInTheConversation: [
        ...(/\bmandates?\b/i.test(conversationText()) ? ['mandate'] : []),
        ...(/\bwalk(s|ed|ing)?\b/i.test(conversationText()) ? ['walks'] : []),
      ],
    };
    const proseGate = checkDeletedProseIsGone(proseObservation);
    observations['deletedProse'] = { ...proseObservation, failure: proseGate.failure };
    record('prose', {
      passagesStillPresent: proseObservation.passagesFoundInDocument,
      wordsStillPresent: proseObservation.wordsFoundInTheConversation,
    });

    if (silenceGate.failure !== null) {
      failures.push(silenceGate.failure);
      return finish(CHAT_EXIT.silenceClaimedWhileAnswering, steps, failures, observations);
    }
    if (proseGate.failure !== null) {
      failures.push(proseGate.failure);
      return finish(CHAT_EXIT.deletedProseStillOnScreen, steps, failures, observations);
    }
    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      sessionId: textOf('session-id'),
      standing: attributeOf('run-standing', 'data-standing'),
      besideTheComposer: textOf('active-status'),
      passagesSeen: [...passagesSeen],
    };
    return finish(CHAT_EXIT.silenceClaimedWhileAnswering, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-90: a stop the person asked for, explained by nothing                  */
/* ------------------------------------------------------------------------- */

/**
 * Sentences that must not be on screen after a stop somebody asked for.
 *
 * Every one of them was true when it was written, which is why this is a list of
 * strings rather than a rule: none of them is a bug, and all of them are noise to the
 * person who pressed the button. Taken from what the window actually rendered at
 * Niclas's cancellation — the heading, the four paragraphs, the recovery rules and the
 * definition of what reaching a terminal proves.
 */
const STOP_EXPLANATIONS: readonly string[] = [
  'Where this run stands, and what it left behind',
  'Nobody. This run has reported an end.',
  'Nothing. The run is over.',
  'nothing was undone and nothing was replayed',
  'Nothing will be repeated on its own',
  'Completed steps were not replayed',
  'Completed steps are not replayed',
  'Reaching a terminal is not a verdict on the work',
];

/**
 * A run, stopped by the script, read while it stops and after it has stopped.
 *
 * **Why a run and not a forced state.** The claim is about a stop the person asked
 * for *and got*, which is a conjunction of two facts DSpatch only holds together
 * after a real cancel has been requested and a real ending has come back. Forcing the
 * document into that shape would be the script asserting the very thing under test.
 * The run is local — `PresentationAdapter`, no provider — so it costs seconds.
 *
 * **Why the readings are a sequence.** Silence is trivially easy to produce by
 * accident, so the evidence has to show the window doing its job first: saying the
 * stop is unconfirmed while it is unconfirmed, and then stopping saying anything once
 * it is. A single reading after the end could not tell the fix from a deletion too
 * far, and `checkStopSaysNothingExtra` fails a trial that only has one.
 */
async function runStopIAskedForScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. The loop walks through the local presentation adapter, whose ' +
      'replies are canned and whose stream is slowed so that there is a step genuinely ' +
      'working when Cancel is pressed. What this evidences is what the window says ' +
      'between asking for a stop and the run reporting one, and what it says afterwards. ' +
      'It says nothing about any model, and it does not exercise a provider\u2019s own ' +
      'cancellation.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const explanationsSeenAfterTheStop = new Set<string>();

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    await setCheckbox('use-loop', true);
    await sleep(300);

    const runsBefore = countEntries('loop-turn');
    await typeInto(
      'prompt',
      'Read this project and say in one sentence what it is for. Change nothing, add no ' +
        'dependency and run no commands.',
    );
    await sendFromComposer();
    await waitFor(
      'a new loop run to appear in the conversation',
      () => countEntries('loop-turn') > runsBefore,
      60_000,
      100,
    );
    const index = countEntries('loop-turn') - 1;
    const at = `loop-turn-${String(index)}`;

    // A step genuinely working when Cancel is pressed, rather than a run that has
    // already finished: cancelling a settled run would measure this script's timing
    // instead of what the window does with a stop.
    await waitFor(
      'a step to be working, with its reply arriving',
      () => rawTextOf(`${at}-live-text`).length > 0,
      120_000,
      100,
    );
    await window.dspatch.captureWindow('stop-before-asking');
    record('working', {
      badge: textOf(`${at}-status`),
      theStepsOwnLine: textOf(`${at}-live-status`),
      replyChars: rawTextOf(`${at}-live-text`).length,
    });

    await click('cancel');
    const askedAt = performance.now();

    const samples: StopSample[] = [];
    const distinct: StopSample[] = [];
    /**
     * What the window was showing by the time the unconfirmed photograph completed.
     *
     * Recorded because the first run of this trial produced a picture labelled *asked
     * for, not confirmed* that was byte-identical to the one taken after the end:
     * `capturePage` takes longer than this state lasts against the local adapter, so
     * the shutter closed on a run that had already stopped. The DOM readings are the
     * evidence either way, but a picture captioned with a state it does not show is
     * worse than no picture — so the trial says which it got rather than leaving the
     * filename to imply it.
     */
    let stateWhenTheUnconfirmedPhotoClosed: string | null = null;
    let photographed = false;
    const stateNow = (ended: boolean): string =>
      attributeOf('run-standing', 'data-standing') || (ended ? 'stopped' : 'active');
    while (performance.now() - askedAt < 120_000) {
      const ended = loopRunEnded(index);
      const sample: StopSample = {
        atMs: Math.round(performance.now() - startedAt),
        stateShown: stateNow(ended),
        noteShown: textOf('run-standing'),
        runHasReportedAnEnd: ended,
      };
      samples.push(sample);
      const last = distinct[distinct.length - 1];
      if (
        last === undefined ||
        last.stateShown !== sample.stateShown ||
        last.noteShown !== sample.noteShown
      ) {
        distinct.push(sample);
      }
      // The window as it looks while the stop is outstanding, which is the state that
      // keeps a sentence. Taken inside the loop, because this interval ends.
      if (!photographed && sample.stateShown === 'stop-requested') {
        photographed = true;
        await window.dspatch.captureWindow('stop-asked-not-confirmed');
        stateWhenTheUnconfirmedPhotoClosed = stateNow(loopRunEnded(index));
      }
      if (ended) {
        break;
      }
      // Fast, because against the local adapter the interval between asking and the
      // reported end is of the order of a hundred milliseconds. A slower poll would
      // take one reading of it and call that a sequence.
      await sleep(25);
    }
    await sleep(800);

    const text = documentText();
    for (const passage of STOP_EXPLANATIONS) {
      if (text.includes(passage)) {
        explanationsSeenAfterTheStop.add(passage);
      }
    }
    await window.dspatch.captureWindow('stop-confirmed');

    const stopObservation: StopAsAskedObservation = {
      samples: distinct,
      badgeAfterTheStop: textOf(`${at}-status`),
      accountAfterTheStop: textOf(`${at}-account`),
      noteAfterTheStop: textOf('run-standing'),
      explanationsFoundAfterTheStop: [...explanationsSeenAfterTheStop],
      standingDisclosuresInTheWindow: document.querySelectorAll(
        '[data-ev$="-standing-detail"]',
      ).length,
      stopWaitingNoteAfterTheStop: textOf('stop-waiting-note'),
    };
    const stopGate = checkStopSaysNothingExtra(stopObservation);
    observations['stopIAskedFor'] = {
      ...stopObservation,
      readingsTaken: samples.length,
      readingsWhileUnconfirmed: samples.filter((each) => !each.runHasReportedAnEnd).length,
      noteWhileUnconfirmed:
        samples.find((each) => !each.runHasReportedAnEnd && each.noteShown !== '')?.noteShown ??
        '',
      stateWhenTheUnconfirmedPhotoClosed,
      // Everything still under the run once the stop was confirmed, so that "nothing
      // else" is a reading of the entry rather than of the elements this script knows
      // the names of.
      wholeEntryAfterTheStop: textOf(at),
      accountDisclosureStillThere: element(`${at}-account-detail`) !== null,
      failure: stopGate.failure,
    };
    record('stopped', {
      badge: stopObservation.badgeAfterTheStop,
      account: stopObservation.accountAfterTheStop,
      note: stopObservation.noteAfterTheStop,
      states: distinct.map((each) => each.stateShown),
    });

    if (stopGate.failure !== null) {
      failures.push(stopGate.failure);
      return finish(CHAT_EXIT.stopWasExplainedAnyway, steps, failures, observations);
    }
    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      sessionId: textOf('session-id'),
      loopTurns: countEntries('loop-turn'),
      standing: attributeOf('run-standing', 'data-standing'),
      explanationsSeen: [...explanationsSeenAfterTheStop],
    };
    return finish(CHAT_EXIT.stopWasExplainedAnyway, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-88: an unsaved drawing survives a loop being switched under it         */
/* ------------------------------------------------------------------------- */

/**
 * Change the editor's loop chooser the way a person does, and do not wait for it to hold.
 *
 * `chooseInSelect` waits for the control to keep the value it was given, which is right
 * for every other list in the window and is exactly wrong here: half of what this
 * scenario measures is a switch that is *declined*, after which the chooser must go back
 * to the loop that is still selected. Waiting for the new value to stick would turn the
 * correct behaviour into a timeout.
 *
 * The native setter plus a bubbling `change` is what a person's click looks like from
 * React's side, and it is deliberately the real `<select>` rather than the editor's own
 * `chooseLoop` hook: the hook cannot leave a dropdown displaying something that was never
 * adopted, and the dropdown is where that failure lives.
 */
function setChooserTo(value: string): void {
  const list = element('editor-loop-definition');
  if (!(list instanceof HTMLSelectElement)) {
    throw new Error('the editor is not showing its loop chooser');
  }
  // Named rather than left to fail quietly. A `<select>` given a value it has no option
  // for reports an empty value and fires nothing useful, so the first run of this trial
  // timed out waiting for a switch that had never been attempted — an instrument fault
  // that reads exactly like the product ignoring the control.
  if (![...list.options].some((option) => option.value === value)) {
    throw new Error(`the loop chooser is not offering ${value}, so it cannot be picked`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  descriptor?.set?.call(list, value);
  list.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * A graph file as it is on disk, read through the main process and never drawn.
 *
 * `openLoopGraph` only reads — the renderer is what draws — so this is the file system's
 * answer rather than the editor's, which is the point: the editor believing it saved and
 * the bytes having changed are two claims, and DSP-88 turns on the second.
 */
async function graphTextOnDisk(graphPath: string): Promise<string> {
  const outcome = await window.dspatch.openLoopGraph({ kind: 'path', path: graphPath });
  return outcome.kind === 'read' ? outcome.text : `<unreadable: ${outcome.kind}>`;
}

/** Which loop the workspace has actually stored, asked of the main process. */
async function storedChoice(): Promise<string> {
  const listing = await window.dspatch.listLoopDefinitions();
  return listing.choices.find((choice) => choice.preselected)?.key ?? '';
}

/**
 * Unsaved edits survive a loop being switched under them.
 *
 * **What went wrong, and why a dialog appearing is not the reading.** Until this card the
 * editor's dropdown, **Open loop…** and **File → Open Graph File…** each told the person
 * that the drawing had never been written and then drew something else over it. Informing
 * is not preserving. So the question now comes *before* the switch and has three answers,
 * and each of them has two halves that can fail independently: what the window ends up
 * showing, and what ended up on disk. A trial that only established that a question was
 * asked would pass against a Cancel that discarded the drawing anyway.
 *
 * So every round here reads four things together: the chooser's displayed value, the
 * *stored* choice as the main process reports it, the canvas's graph and dirty state, and
 * the bytes of both loops' graph files. The chooser and the stored choice are read
 * separately on purpose — a dropdown left displaying a loop that was never adopted is the
 * obvious way for this fix to lie, and it is invisible to anything that asks the main
 * process what is selected.
 *
 * **The rounds are chained, which is what makes Cancel mean something.** The drawing is
 * edited once, at the start. Round 1 declines a switch from the dropdown; round 2 declines
 * one from the File menu; round 3 then answers **Save** and the file on disk has to change
 * — which is the only way to establish that the edits were still there after two cancels
 * rather than merely that the window still said *unsaved changes*. Round 4 edits the
 * second loop and answers **Discard changes** through **Open loop…**, and that file must
 * be unchanged at the end.
 *
 * **The order also catches a question that is never asked.** The scripted answers are one
 * queue in press order, so a gesture that failed to ask would leave the next gesture
 * consuming the previous answer — and round 3's *save* arriving as a *cancel* fails the
 * trial. That is what makes round 2 evidence about the File menu rather than about a menu
 * item that quietly did nothing.
 *
 * **What is scripted about the window**: the three file dialogs' answers
 * (`DSPATCH_PICK_FILE`) and the four answers to the unsaved-drawing question
 * (`DSPATCH_UNSAVED_DRAWING`). A native dialog cannot be driven from a renderer. The
 * controls, the menu item, the handlers, the writes and the refusals are the real ones.
 *
 * **No provider call, and no run.** Nothing here starts one; the adapter exists so that a
 * session can open.
 */
async function runUnsavedEditsSurviveASwitchScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call and no run: this scenario only switches what is drawn. The four ' +
      'native dialogs are answered through DSPATCH_PICK_FILE and ' +
      'DSPATCH_UNSAVED_DRAWING, because a renderer cannot operate one \u2014 so the ' +
      'dialogs\u2019 own wording is not read here and is covered by loop-choice.test.ts ' +
      'instead. Everything else is the real control, the real handler and the real file. ' +
      'Both loops are throwaway copies under the temporary directory; nothing writes to ' +
      'the working copy. Windows only.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    const loopA = plan.choosableDefinitions?.[0] ?? '';
    const loopB = plan.choosableDefinitions?.[1] ?? '';
    if (loopA === '' || loopB === '') {
      failures.push(
        'the trial was given fewer than two throwaway declarations, so there was nothing ' +
          'to switch between. Set DSPATCH_CHOOSE_DEFINITIONS to two paths.',
      );
      return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
    }

    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );

    await goToEditor();
    await waitFor(
      "the editor's loop chooser to appear",
      () => element('editor-loop-definition') !== null,
      30_000,
    );

    /*
     * --- Both loops introduced, through the real Open loop… -----------------
     *
     * Two presses before anything is measured, and the second one is not redundant. A
     * throwaway loop under the temporary directory is in no folder the window has open, so
     * it is in no list until it has been reached by hand once — and the rounds below drive
     * the real `<select>`, which can only offer what it has. Loop B is opened first and
     * loop A second, so that the drawing about to be edited is A and the dropdown holds
     * both. Both presses happen while nothing is unsaved, so neither asks anything.
     */
    await click('open-loop-definition');
    await waitFor(
      `Open loop… to have selected and drawn ${loopB}`,
      () => editorHook().readChooser().chooserValue === loopB,
      30_000,
    );
    await click('open-loop-definition');
    await waitFor(
      `Open loop… to have selected and drawn ${loopA}`,
      () => editorHook().readChooser().chooserValue === loopA,
      30_000,
    );
    await sleep(400);
    const drawnA = editorHook().readView();
    const graphAPath = drawnA.titleLine;
    const diskAAtStart = await graphTextOnDisk(plan.unsavedGraphPaths?.[0] ?? '');
    const diskBAtStart = await graphTextOnDisk(plan.unsavedGraphPaths?.[1] ?? '');
    observations['bothLoopsOpenedAndLoopAChosen'] = {
      chooser: loopA,
      chooserOffers: editorHook().readChooser().chooserKeys.filter((key) => key !== ''),
      graphName: drawnA.graphName,
      nodesDrawn: drawnA.nodesDrawn,
      titleLine: graphAPath,
      diskACharsAtStart: diskAAtStart.length,
      diskBCharsAtStart: diskBAtStart.length,
    };
    if (diskAAtStart.startsWith('<unreadable') || diskBAtStart.startsWith('<unreadable')) {
      failures.push(
        'one of the two throwaway graph files could not be read, so "what reached the ' +
          'disk" could not be established for any round. Set DSPATCH_UNSAVED_GRAPHS.',
      );
      return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
    }

    // --- One real edit, which every round below is about --------------------
    const nudged = editorHook().nudgeNode(drawnA.entryNodeId, 23);
    await sleep(400);
    const dirtyA = editorHook().readView();
    record('editor-made-dirty', { nudged, titleLine: dirtyA.titleLine.slice(0, 200) });
    if (!nudged || !dirtyA.titleLine.includes('unsaved changes')) {
      failures.push(
        'moving a node did not leave the editor holding unsaved changes, so none of the ' +
          'three answers had anything to be asked about.',
      );
      return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
    }
    await window.dspatch.captureWindow('unsaved-switch-dirty-before-any-question');

    /*
     * --- Round 1: Cancel, from the dropdown --------------------------------
     *
     * The dangerous outcome, so it is first. Five things have to be true afterwards and
     * they are read as five: the drawing is still unsaved, the canvas still shows loop A,
     * the chooser still *displays* loop A, the stored choice is still loop A, and neither
     * file has been written.
     */
    setChooserTo(loopB);
    await waitFor(
      'the window to say that nothing was switched',
      () => editorHook().readView().noteLine.includes('Nothing was switched'),
      30_000,
    );
    await sleep(300);
    const afterCancel = editorHook().readView();
    const cancelReading = {
      chooserDisplays: editorHook().readChooser().chooserValue,
      storedChoice: await storedChoice(),
      graphName: afterCancel.graphName,
      nodesDrawn: afterCancel.nodesDrawn,
      stillUnsaved: afterCancel.titleLine.includes('unsaved changes'),
      noteLine: afterCancel.noteLine,
      diskAUnchanged: (await graphTextOnDisk(plan.unsavedGraphPaths?.[0] ?? '')) === diskAAtStart,
      diskBUnchanged: (await graphTextOnDisk(plan.unsavedGraphPaths?.[1] ?? '')) === diskBAtStart,
    };
    observations['round1Cancel'] = cancelReading;
    record('round1-cancel', { chooserDisplays: cancelReading.chooserDisplays });
    await window.dspatch.captureWindow('unsaved-switch-cancel-kept-the-drawing');
    if (!cancelReading.stillUnsaved) {
      failures.push(
        'Cancel lost the drawing\u2019s unsaved changes. This is the whole of the card: ' +
          'declining a switch has to leave the edits where they were.',
      );
    }
    if (cancelReading.graphName !== dirtyA.graphName) {
      failures.push(
        `Cancel switched the canvas anyway: it drew "${cancelReading.graphName}" over ` +
          `"${dirtyA.graphName}".`,
      );
    }
    if (cancelReading.chooserDisplays !== loopA) {
      failures.push(
        `after Cancel the dropdown was left displaying "${cancelReading.chooserDisplays}", ` +
          'which is a loop that was not adopted. The control has to go back to the choice ' +
          'that still stands.',
      );
    }
    if (cancelReading.storedChoice !== loopA) {
      failures.push(
        `Cancel moved the stored choice to "${cancelReading.storedChoice}". Nothing about ` +
          'the selection may change when the switch was declined.',
      );
    }
    if (!cancelReading.diskAUnchanged || !cancelReading.diskBUnchanged) {
      failures.push('Cancel wrote a file. It must write nothing at all.');
    }

    /*
     * --- Round 2: Cancel, from File → Open Graph File… ---------------------
     *
     * The card left it to the implementer to decide whether this item asks, and it does.
     * The reading is the same shape, plus one thing only this route can be asked: whether
     * the graph the menu picked was handed to the editor at all. `takeGraphToEdit` is the
     * handover, and it has to be empty — a cancelled question must not leave a file queued
     * to be drawn a moment later.
     */
    const menuExists = await window.dspatch.pressMenuItem('open-graph-file');
    await sleep(1200);
    const afterMenuCancel = editorHook().readView();
    const handedOver = await window.dspatch.takeGraphToEdit();
    const menuReading = {
      menuItemExists: menuExists,
      graphName: afterMenuCancel.graphName,
      stillUnsaved: afterMenuCancel.titleLine.includes('unsaved changes'),
      nothingQueuedToDraw: handedOver === null,
      handedOver,
      diskAUnchanged: (await graphTextOnDisk(plan.unsavedGraphPaths?.[0] ?? '')) === diskAAtStart,
    };
    observations['round2CancelFromTheFileMenu'] = menuReading;
    record('round2-file-menu-cancel', menuReading);
    if (!menuExists) {
      failures.push('the Open Graph File… menu item does not exist, so it was never pressed.');
    }
    if (!menuReading.stillUnsaved || menuReading.graphName !== dirtyA.graphName) {
      failures.push(
        'File \u2192 Open Graph File… took the drawing away after the question was ' +
          'declined. It draws over the same canvas as the chooser and has to ask on the ' +
          'same terms.',
      );
    }
    if (!menuReading.nothingQueuedToDraw) {
      failures.push(
        `File \u2192 Open Graph File… queued ${String(handedOver)} to be drawn even though ` +
          'the question was cancelled. Declining has to stop before the handover.',
      );
    }
    if (!menuReading.diskAUnchanged) {
      failures.push('the cancelled File menu round wrote a file.');
    }

    /*
     * --- Round 3: Save, from the dropdown ---------------------------------
     *
     * The chained reading. The edits have now survived two declined switches, and the only
     * way to establish that they are still the *edits* rather than a window still claiming
     * them is to write them and read the bytes back. So loop A's graph file has to differ
     * from what it was before any of this, the editor has to come out clean, and the canvas
     * has to be showing loop B.
     */
    setChooserTo(loopB);
    await waitFor(
      'the chooser to have adopted the second loop',
      () => editorHook().readChooser().chooserValue === loopB,
      30_000,
    );
    await sleep(500);
    const afterSave = editorHook().readView();
    const diskAAfterSave = await graphTextOnDisk(plan.unsavedGraphPaths?.[0] ?? '');
    const saveReading = {
      chooserDisplays: editorHook().readChooser().chooserValue,
      storedChoice: await storedChoice(),
      graphName: afterSave.graphName,
      stillUnsaved: afterSave.titleLine.includes('unsaved changes'),
      noteLine: afterSave.noteLine,
      diskAWasWritten: diskAAfterSave !== diskAAtStart,
      diskAStillParses: !diskAAfterSave.startsWith('<unreadable'),
      diskBUnchanged: (await graphTextOnDisk(plan.unsavedGraphPaths?.[1] ?? '')) === diskBAtStart,
    };
    observations['round3Save'] = saveReading;
    record('round3-save', {
      diskAWasWritten: saveReading.diskAWasWritten,
      graphName: saveReading.graphName,
    });
    await window.dspatch.captureWindow('unsaved-switch-save-then-switched');
    if (!saveReading.diskAWasWritten) {
      failures.push(
        'Save switched without writing the drawing. Either the write did not happen or the ' +
          'edits had already been lost at one of the two cancels above \u2014 and both of ' +
          'those are this card failing.',
      );
    }
    if (!saveReading.diskAStillParses) {
      failures.push('what Save wrote to loop A\u2019s graph cannot be read back as a graph.');
    }
    if (saveReading.graphName === dirtyA.graphName) {
      failures.push(
        'Save wrote the drawing but never switched. Both halves have to happen, in that order.',
      );
    }
    if (saveReading.stillUnsaved) {
      failures.push(
        'the editor still reported unsaved changes after Save. A window claiming edits it ' +
          'no longer has is the same kind of untruth as one hiding edits it does.',
      );
    }
    if (saveReading.storedChoice !== loopB) {
      failures.push(
        `after Save the stored choice was "${saveReading.storedChoice}" rather than the loop ` +
          'that was adopted.',
      );
    }
    if (!saveReading.noteLine.includes('saved')) {
      failures.push(
        `the window did not say the drawing had been saved before the switch: ` +
          `"${saveReading.noteLine.slice(0, 200)}".`,
      );
    }

    /*
     * --- Round 4: Discard changes, through Open loop… ---------------------
     *
     * The second loop is edited and thrown away deliberately, which is the answer the run's
     * own question does not have. Both halves again: the canvas goes back to loop A, and
     * loop B's file is exactly what it was before the window opened. A "discard" that wrote
     * the file would be the most confusing failure of the three.
     */
    const drawnB = editorHook().readView();
    const nudgedB = editorHook().nudgeNode(drawnB.entryNodeId, 31);
    await sleep(400);
    const dirtyB = editorHook().readView();
    if (!nudgedB || !dirtyB.titleLine.includes('unsaved changes')) {
      failures.push('the second loop could not be made dirty, so Discard changes was not put ' +
        'to the window.');
      return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
    }
    await click('open-loop-definition');
    await waitFor(
      'Open loop… to have gone back to the first loop after the drawing was discarded',
      () => editorHook().readChooser().chooserValue === loopA,
      30_000,
    );
    await sleep(500);
    const afterDiscard = editorHook().readView();
    const discardReading = {
      chooserDisplays: editorHook().readChooser().chooserValue,
      storedChoice: await storedChoice(),
      graphName: afterDiscard.graphName,
      stillUnsaved: afterDiscard.titleLine.includes('unsaved changes'),
      noteLine: afterDiscard.noteLine,
      diskBNeverWritten: (await graphTextOnDisk(plan.unsavedGraphPaths?.[1] ?? '')) === diskBAtStart,
    };
    observations['round4Discard'] = discardReading;
    record('round4-discard', discardReading);
    await window.dspatch.captureWindow('unsaved-switch-discarded-and-switched');
    if (!discardReading.diskBNeverWritten) {
      failures.push('Discard changes wrote the file. It must switch without writing.');
    }
    if (discardReading.graphName !== dirtyA.graphName) {
      failures.push(
        `Discard changes did not switch: the canvas shows "${discardReading.graphName}".`,
      );
    }
    if (discardReading.stillUnsaved) {
      failures.push(
        'the editor still reported unsaved changes after the drawing was discarded and ' +
          'replaced.',
      );
    }
    if (!discardReading.noteLine.includes('discard')) {
      failures.push(
        `the window did not say the drawing had been discarded on the person\u2019s ` +
          `say-so: "${discardReading.noteLine.slice(0, 200)}".`,
      );
    }

    if (failures.length > 0) {
      return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
    }
    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['atFailure'] = {
      hash: window.location.hash,
      chooser: element('editor-loop-definition') === null ? 'absent' : 'present',
      noteLine: document.querySelector<HTMLElement>('.editor-note')?.textContent ?? '',
    };
    return finish(CHAT_EXIT.unsavedEditsWereLost, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-71 and DSP-73: folders that exist, a tree that looks, nothing steered  */
/* ------------------------------------------------------------------------- */

interface DrawnTreeRow {
  readonly path: string;
  readonly name: string;
  readonly kind: string;
  readonly depth: number;
  readonly expanded: string;
}

/** Every row the tree is drawing now, read off the DOM rather than off state. */
function drawnTreeRows(): readonly DrawnTreeRow[] {
  return [...document.querySelectorAll<HTMLElement>('.tree-row__label')].map((row) => ({
    path: row.getAttribute('data-path') ?? '',
    name: (row.textContent ?? '').replace(/^[▾▸·]\s*/u, '').trim(),
    kind: row.getAttribute('data-kind') ?? '',
    depth: Number(row.getAttribute('data-depth') ?? '-1'),
    expanded: row.getAttribute('data-expanded') ?? '',
  }));
}

/** Click a real row by the path it carries, which is how a person clicks it. */
async function clickTreeRow(targetPath: string): Promise<void> {
  await waitFor(
    `a tree row for ${targetPath}`,
    () => drawnTreeRows().some((row) => row.path === targetPath),
    30_000,
  );
  const found = [...document.querySelectorAll<HTMLElement>('.tree-row__label')].find(
    (row) => row.getAttribute('data-path') === targetPath,
  );
  found?.click();
}

/** The note a capped or unreadable folder shows, whichever folder it belongs to. */
function treeNotesShown(): readonly string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-ev^="tree-note-"]')].map((note) =>
    (note.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

/**
 * A workspace of folders, a tree beside the chat, and a selection that steers nothing.
 *
 * **No provider call.** Every question here — whether a root appears, what one
 * expansion reads, whether a file opens, whether a saved workspace comes back — is
 * answered on this machine by the presentation adapter and the filesystem.
 *
 * **Native dialogs are not driven and this run does not pretend otherwise.** Open
 * Folder…, Add Folder to Workspace…, Open Workspace… and Save Workspace As… each open
 * a chooser that a renderer cannot operate. What is exercised is the main-process
 * function behind each item, called with a path. The menu items are on screen and
 * logged by `installApplicationMenu`; that they are wired to these functions is read
 * from the source, not from this run.
 *
 * Run the same scenario **twice over one user-data directory** and the second process
 * is the restart: the first saves a workspace, the second should have its folders and
 * its loop definition before anything is opened.
 */
async function runFoldersAndTreeScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call. Native file dialogs were not driven — they cannot be from a ' +
      'renderer — so the File menu items were exercised through the main-process ' +
      'functions behind them, with a path supplied instead of a chooser. What the ' +
      'dialogs themselves do is untested. Nothing here says anything about a run.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    // --- Is this the first process or the restart? ---------------------------
    const atStart = await window.dspatch.workspaceFolders();
    observations['workspaceAtStart'] = atStart;
    if (atStart.folders.length >= 2) {
      return finishReopenedWorkspace(plan, atStart, steps, failures, observations, record);
    }

    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );

    // --- One root, and it is the project ------------------------------------
    await waitFor('the folder sidebar', () => element('sidebar') !== null, 30_000);
    await waitFor('a root in the tree', () => drawnTreeRows().length > 0, 30_000);
    const firstRoot = drawnTreeRows()[0]?.path ?? '';
    record('one-root', { root: firstRoot, rows: drawnTreeRows().length });
    if (firstRoot === '') {
      failures.push('the tree drew no root for the project that was just opened.');
      return finish(CHAT_EXIT.treeDoesNotRead, steps, failures, observations);
    }

    // --- A second folder, added beside it ------------------------------------
    // The harness script creates this beside the project. Adding it through the
    // bridge is the same main-process function the menu item calls.
    const secondFolder = `${firstRoot}-second`;
    const afterAdding = await window.dspatch.addFolderToWorkspace(secondFolder);
    observations['workspaceAfterAdding'] = afterAdding;
    await waitFor(
      'the second folder to appear as a root',
      () => drawnTreeRows().some((row) => row.path === secondFolder && row.depth === 0),
      30_000,
    );
    const roots = drawnTreeRows().filter((row) => row.depth === 0);
    record('two-roots', { roots: roots.map((row) => row.path) });

    // --- One expansion reads one directory -----------------------------------
    await clickTreeRow(secondFolder);
    await waitFor(
      'the second root to draw its children',
      () => drawnTreeRows().some((row) => row.depth === 1),
      30_000,
    );
    const namesUnderRoot = drawnTreeRows()
      .filter((row) => row.depth === 1)
      .map((row) => row.name);
    record('expanded-once', { namesUnderRoot });

    // --- A folder with more entries than the cap -----------------------------
    const manyFolder = `${secondFolder}\\many`;
    const expandStartedAt = performance.now();
    await clickTreeRow(manyFolder);
    await waitFor(
      'the large folder to draw its entries',
      () => drawnTreeRows().some((row) => row.depth === 2),
      120_000,
    );
    const cappedExpansionMs = Math.round(performance.now() - expandStartedAt);
    const cappedRowsDrawn = drawnTreeRows().filter((row) => row.depth === 2).length;
    // Straight from the main process, so "how many are really in there" is not the
    // window's own answer to its own question.
    const manyPage = await window.dspatch.readWorkspaceDirectory(manyFolder);
    const cappedNoteShown =
      treeNotesShown().find((note) => note.includes(String(manyPage.total))) ?? '';
    record('large-folder', {
      cappedRowsDrawn,
      entriesOnDisk: manyPage.total,
      cappedExpansionMs,
      cappedNoteShown,
    });

    // --- A file, read ---------------------------------------------------------
    const textFile = `${secondFolder}\\readme.txt`;
    await clickTreeRow(textFile);
    await waitFor('the reading view', () => element('file-view-text') !== null, 30_000);
    const textFileShown = rawTextOf('file-view-text');

    // --- A binary file, refused ----------------------------------------------
    const binaryFile = `${secondFolder}\\picture.bin`;
    await clickTreeRow(binaryFile);
    await waitFor(
      'the refusal for a binary file',
      () => element('file-view-refusal') !== null,
      30_000,
    );
    const binaryRefusalShown = textOf('file-view-refusal');
    record('reading-view', {
      textChars: textFileShown.length,
      refusalChars: binaryRefusalShown.length,
    });

    const treeVerdict = checkFolderTree({
      rootsShown: roots.map((row) => row.path),
      namesUnderRoot,
      // `nested` is two levels down and `leaf.txt` three. Neither may be on screen
      // after one expansion of the root.
      namesOnlyDeeper: ['nested', 'leaf.txt'],
      cappedNoteShown,
      cappedRowsDrawn,
      cappedEntriesOnDisk: manyPage.total,
      cappedExpansionMs,
      textFileShown,
      textFileMarker: 'MARKER-readable-text',
      binaryRefusalShown,
    });
    observations['folderTree'] = {
      rootsShown: roots.map((row) => row.path),
      namesUnderRoot,
      cappedRowsDrawn,
      cappedEntriesOnDisk: manyPage.total,
      cappedExpansionMs,
      cappedNoteShown,
      textFileFirstLine: textFileShown.split('\n')[0] ?? '',
      binaryRefusalShown,
      verdict: treeVerdict,
    };
    if (treeVerdict.failure !== null) {
      failures.push(`the tree: ${treeVerdict.failure}`);
    }

    // --- Selecting a file steers nothing -------------------------------------
    await setCheckbox('use-loop', true);
    await waitFor('the loop chooser', () => element('loop-definition') !== null, 30_000);
    await sleep(500);
    const definitionBefore = (element('loop-definition') as HTMLSelectElement).value;
    const before = await window.dspatch.workspaceFolders();
    await clickTreeRow(textFile);
    await waitFor('the reading view again', () => element('file-view-text') !== null, 30_000);
    await sleep(500);
    const definitionAfter = (element('loop-definition') as HTMLSelectElement).value;
    const after = await window.dspatch.workspaceFolders();
    const inertVerdict = checkSelectionIsInert({
      definitionBefore,
      definitionAfter,
      workingRootBefore: before.folders.find((folder) => folder.working)?.path ?? '',
      workingRootAfter: after.folders.find((folder) => folder.working)?.path ?? '',
      foldersBefore: before.folders.map((folder) => folder.path),
      foldersAfter: after.folders.map((folder) => folder.path),
      fileSelected: textFile,
    });
    observations['selectionIsInert'] = {
      definitionBefore,
      definitionAfter,
      before,
      after,
      verdict: inertVerdict,
    };
    record('selection-inert', { verdict: inertVerdict.failure ?? 'nothing moved' });
    if (inertVerdict.failure !== null) {
      failures.push(`selection: ${inertVerdict.failure}`);
    }

    // --- Removing a folder removes the link and nothing else ------------------
    const thirdFolder = `${firstRoot}-third`;
    await window.dspatch.addFolderToWorkspace(thirdFolder);
    const afterRemoving = await window.dspatch.removeFolderFromWorkspace(thirdFolder);
    // The main process is the wrong witness for "the files are still there", so the
    // folder is listed again afterwards: a directory that still lists is still there.
    const thirdAfterRemoval = await window.dspatch.readWorkspaceDirectory(thirdFolder);
    observations['removalIsALink'] = {
      foldersAfterRemoval: afterRemoving.folders.map((folder) => folder.path),
      thirdFolderStillListsEntries: thirdAfterRemoval.entries.length,
      thirdFolderProblem: thirdAfterRemoval.problem,
    };
    if (afterRemoving.folders.some((folder) => folder.path === thirdFolder)) {
      failures.push('removing a folder from the workspace left it in the workspace.');
    }
    if (thirdAfterRemoval.entries.length === 0) {
      failures.push(
        `after removing ${thirdFolder} from the workspace its files are gone from disk. ` +
          'Removing a folder removes the link, never the files.',
      );
    }
    record('removal-is-a-link', {
      entriesStillOnDisk: thirdAfterRemoval.entries.length,
    });

    // --- Save the workspace, for the restart to find -------------------------
    const workspaceFile = `${firstRoot}-workspace.json`;
    const saved = await window.dspatch.saveWorkspaceFile(workspaceFile);
    const savedFile = await window.dspatch.readWorkspaceFile(workspaceFile);
    observations['workspaceSaved'] = {
      view: saved,
      fileText: savedFile.kind === 'text' ? savedFile.text : savedFile.reason,
    };
    record('workspace-saved', {
      file: workspaceFile,
      folders: saved.folders.length,
      definition: saved.loopDefinitionKey,
    });
    if (saved.problem !== null) {
      failures.push(`the workspace could not be saved: ${saved.problem}`);
    }

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : verdictExitCode(treeVerdict, inertVerdict),
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    observations['documentWhenItFailed'] = {
      sessionId: textOf('session-id'),
      connection: textOf('connection-kind'),
      sidebarPresent: element('sidebar') !== null,
      rows: drawnTreeRows(),
    };
    return finish(CHAT_EXIT.treeDoesNotRead, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-72: two folders, a definition from a third place, described honestly    */
/* ------------------------------------------------------------------------- */

/**
 * A run given two separate folders and a definition that lives in neither.
 *
 * **No provider turn, and the line is drawn deliberately.** Everything about what a
 * run would be *given* is decided in this process: which folders reach the root list,
 * which definition resolves, what the window says about them, and whether the
 * own-repository guard refuses. What a run *does* with two roots needs the provider,
 * and the prompt's own wording and the per-root measurement are held by
 * `loop-chat.test.ts`, `working-roots.test.ts` and `loop-live.test.ts` instead. So this
 * trial stops short of pressing Send on a run that would walk — and it does press Send
 * on one that must be refused, because a refusal costs nothing and is the only step here
 * that proves the window's folders really became the run's roots.
 *
 * The harness script supplies `DSPATCH_ROOTS_WORKSPACE`: a saved workspace naming the
 * second folder and a `.loop.json` filed outside both. Opening a workspace is how a
 * definition from a third place reaches the chooser without a native dialog, which
 * cannot be driven from a renderer.
 */
async function runSeveralWorkingRootsScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call, so no run walks: this evidences what a run would be given — ' +
      'which folders, in which order, which definition, and what the window says about ' +
      'them — and that the own-repository guard refuses a run naming the offending root. ' +
      'It says nothing about what an agent does with two roots, nothing about whether ' +
      'the provider reads the second folder, and nothing about the per-root measurement ' +
      'after a real turn.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      120_000,
    );
    const workingRoot = (await window.dspatch.workspaceFolders()).folders[0]?.path ?? '';
    record('project-open', { workingRoot });

    // --- The saved workspace: a second folder, and a definition from elsewhere ---
    const workspaceFile = plan.rootsWorkspaceFile ?? '';
    if (workspaceFile === '') {
      failures.push('no workspace file was supplied, so there was no second folder to open.');
      return finish(CHAT_EXIT.workingRootsReadWrong, steps, failures, observations);
    }
    const opened = await window.dspatch.openWorkspaceFile(workspaceFile);
    observations['workspaceOpened'] = opened;
    if (opened.problem !== null) {
      failures.push(`the workspace could not be opened: ${opened.problem}`);
    }
    await waitFor(
      'both folders to be drawn as roots',
      () => drawnTreeRows().filter((row) => row.depth === 0).length >= 2,
      30_000,
    );
    const view = await window.dspatch.workspaceFolders();
    const rootsGiven = view.folders.map((folder) => folder.path);
    const workingFolder = view.folders.find((folder) => folder.working)?.path ?? '';
    record('two-roots', {
      rootsGiven,
      workingFolder,
      definition: view.loopDefinitionKey,
    });

    // --- The definition from the third place, on screen ------------------------
    await setCheckbox('use-loop', true);
    await waitFor('the loop chooser', () => element('loop-definition') !== null, 30_000);
    const outsideKey = view.loopDefinitionKey ?? '';
    await waitFor(
      'the chooser to offer the definition from outside both folders',
      () =>
        [...((element('loop-definition') as HTMLSelectElement | null)?.options ?? [])].some(
          (option) => option.value === outsideKey && !option.disabled,
        ),
      30_000,
    );
    await chooseInSelect('loop-definition', outsideKey);
    await sleep(500);
    const onScreen = await loopOnScreen();
    observations['definitionFromElsewhere'] = { key: outsideKey, ...onScreen };
    record('definition-on-screen', onScreen);

    // The sidebar's note about what these folders are was removed (DSP-125); what it
    // said is in app/README.md, so there is no note on screen to read here any more.

    const verdict = checkWorkingRootsReadHonestly({
      rootsGiven,
      workingRoot: workingFolder,
      definitionChosen: outsideKey,
      graphMarkerOnScreen: String(onScreen['graphTextMarker'] ?? ''),
      graphMarkerExpected: plan.rootsGraphMarker ?? '',
    });
    observations['workingRoots'] = { verdict };
    if (verdict.failure !== null) {
      failures.push(`working roots: ${verdict.failure}`);
    }

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.workingRootsReadWrong,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    observations['documentWhenItFailed'] = {
      sessionId: textOf('session-id'),
      connection: textOf('connection-kind'),
      rows: drawnTreeRows(),
    };
    return finish(CHAT_EXIT.workingRootsReadWrong, steps, failures, observations);
  }
}

function verdictExitCode(tree: GateVerdict, inert: GateVerdict): number {
  return tree.failure !== null
    ? CHAT_EXIT.treeDoesNotRead
    : inert.failure !== null
      ? CHAT_EXIT.selectionSteeredTheWork
      : CHAT_EXIT.scriptFailed;
}

/**
 * The restart half: the same scenario, second process, one user-data directory.
 *
 * Nothing has been opened in this window. If the folders and the loop definition are
 * here before anything is opened, the saved workspace came back.
 */
async function finishReopenedWorkspace(
  plan: ScriptedRunPlan,
  atStart: WorkspaceView,
  steps: unknown[],
  failures: string[],
  observations: Record<string, unknown>,
  record: (name: string, detail: Record<string, unknown>) => void,
): Promise<ScriptedRunReport> {
  observations['limits'] =
    'The restart half of the scenario. No provider call, no project opened and no ' +
    'dialog driven: what is reported is the state a second process started in.';
  const savedFile =
    atStart.filePath === null
      ? null
      : await window.dspatch.readWorkspaceFile(atStart.filePath);
  const savedText = savedFile !== null && savedFile.kind === 'text' ? savedFile.text : '';
  const read = savedText === '' ? null : (JSON.parse(savedText) as Record<string, unknown>);
  const foldersSaved = Array.isArray(read?.['folders'])
    ? (read['folders'] as { path?: unknown }[]).map((entry) => String(entry.path ?? ''))
    : [];

  await waitFor('the folder sidebar', () => element('sidebar') !== null, 30_000);
  const rootsDrawn = drawnTreeRows()
    .filter((row) => row.depth === 0)
    .map((row) => row.path);

  const verdict = checkWorkspaceReopened({
    foldersAtStart: atStart.folders.map((folder) => folder.path),
    foldersSaved,
    definitionAtStart: atStart.loopDefinitionKey ?? '',
    definitionSaved: String(read?.['loopDefinition'] ?? ''),
    savedFileText: savedText,
  });
  observations['workspaceReopened'] = {
    plan,
    atStart,
    rootsDrawn,
    foldersSaved,
    savedFileText: savedText,
    verdict,
  };
  record('workspace-reopened', {
    folders: atStart.folders.length,
    rootsDrawn: rootsDrawn.length,
    definition: atStart.loopDefinitionKey,
  });
  if (verdict.failure !== null) {
    failures.push(`the saved workspace: ${verdict.failure}`);
  }
  if (rootsDrawn.length !== atStart.folders.length) {
    failures.push(
      `the main process reports ${String(atStart.folders.length)} open folders and the ` +
        `window drew ${String(rootsDrawn.length)} roots.`,
    );
  }
  return finish(
    failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.workspaceDidNotComeBack,
    steps,
    failures,
    observations,
  );
}

/* ------------------------------------------------------------------------- */
/* The presentation scenario: §10 trials 13 and 14, and no provider call      */
/* ------------------------------------------------------------------------- */

/** Elements that can actually scroll vertically right now, named for a report. */
function verticalScrollers(): readonly string[] {
  const found: string[] = [];
  for (const element_ of document.querySelectorAll<HTMLElement>('*')) {
    const overflow = getComputedStyle(element_).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') {
      continue;
    }
    if (element_.scrollHeight - element_.clientHeight <= 4) {
      continue;
    }
    // A code block scrolling sideways is allowed; this counts vertical ones.
    found.push(
      element_.getAttribute('data-ev') ??
        `${element_.tagName.toLowerCase()}.${element_.className.split(' ')[0] ?? ''}`,
    );
  }
  return found;
}

function pageScrollRangePx(): number {
  const root = document.documentElement;
  return Math.max(
    root.scrollHeight - root.clientHeight,
    document.body.scrollHeight - document.body.clientHeight,
    0,
  );
}

function transcriptElement(): HTMLElement {
  const found = element('transcript');
  if (found === null) {
    throw new Error('the conversation thread is not in the window');
  }
  return found;
}

function distanceFromBottomPx(): number {
  const thread = transcriptElement();
  return Math.max(thread.scrollHeight - thread.scrollTop - thread.clientHeight, 0);
}

function tagsInside(name: string): readonly string[] {
  const host = element(name);
  if (host === null) {
    return [];
  }
  return [...new Set([...host.querySelectorAll('*')].map((node) => node.tagName))];
}

/** Send one message and wait for its turn to finish, without sampling deltas. */
async function sendAndSettle(index: number, text: string, timeoutMs: number): Promise<void> {
  await typeInto('prompt', text);
  await sendFromComposer();
  await waitFor(
    `turn ${String(index)} to finish`,
    () =>
      element('active-answer') === null && element(`turn-${String(index)}-answer`) !== null,
    timeoutMs,
  );
}

/**
 * How the window reads, tried in the window and paid for by nobody.
 *
 * Every reply here comes from `PresentationAdapter` in the main process, so this
 * scenario makes **no provider call**. That is the point rather than a shortcut:
 * [proportionate verification](../../../docs/DEVELOPMENT_LOOP.md#proportionate-verification)
 * says layout, Markdown and scrolling are tried with saved content or controlled
 * streaming, and controlled streaming is what makes a conversation long enough to
 * scroll back in affordable at all.
 *
 * What it therefore shows nothing about: the provider, real replies, real latency
 * and real tool calls. Its report says so in `limits`, because a green run here
 * would otherwise be quoted as though the whole window had been exercised.
 */
/* ------------------------------------------------------------------------- */
/* The same project, opened again: §10 trial 8, with no provider call         */
/* ------------------------------------------------------------------------- */

/**
 * Does the conversation come back when the project is opened again?
 *
 * **A real folder, not a generated sample, and that is the whole reason this exists.**
 * Every other scenario opens a fresh temp directory, so none of them has ever opened
 * the *same* project twice — which is exactly why a reopened project drawing an empty
 * thread over an intact file was never caught here. Niclas caught it instead.
 *
 * **The restart is across processes, because that is the case Niclas met.** Running this
 * scenario twice over one user-data directory is the whole trial: the first process
 * leaves a conversation behind, and the second has to find it and draw it. Opening the
 * chooser a second time inside one window is deliberately not attempted — it is reached
 * from the application menu, which a renderer script cannot click, and a scripted
 * reopen through some other route would be evidence about that route.
 *
 * So the assertions here are the ones that hold in either process: what came back is in
 * order, holds no message twice, and says it is history. Whether the *particular*
 * messages of the previous run came back is read off the two runs' reports together,
 * since each records the marker it sent and the prompts it found.
 *
 * No provider call: every reply is streamed by the local presentation adapter, which is
 * all that is needed to establish something about a file and a window.
 */
async function runConversationComesBackScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'Every reply in this run was streamed by the local presentation adapter in the ' +
      'main process. No provider call was made, and no provider session was resumed: ' +
      'this evidences that saved messages come back on screen, and says nothing about ' +
      'what a model retains.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  /**
   * How many earlier messages the window says it read back, and from where. The
   * "read back from" line above the thread is gone (DSP-121 flow); where the
   * conversation was read from and how many messages came back are in the
   * diagnostics, which `textContent` reaches whether or not the details are open.
   */
  const historyInWindow = (): {
    readonly storage: {
      readonly file: string;
      readonly savedAt: string;
      readonly messagesRead: string;
    };
    readonly turns: number;
    readonly prompts: readonly string[];
    readonly error: string;
  } => {
    const prompts: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const found = element(`history-turn-${String(index)}-prompt`);
      if (found === null) {
        break;
      }
      prompts.push((found.textContent ?? '').replace(/\s+/g, ' ').trim());
    }
    return {
      storage: {
        file: textOf('diagnostics-conversation-file'),
        savedAt: textOf('diagnostics-saved-at'),
        messagesRead: textOf('diagnostics-messages-read'),
      },
      turns: prompts.length,
      prompts,
      error: textOf('history-error'),
    };
  };

  /** The prompts as compared: trimmed, so whitespace is not mistaken for a difference. */
  const afterOpenPrompts = (prompts: readonly string[]): readonly string[] =>
    prompts.map((prompt) => prompt.trim());

  const openTheProject = async (): Promise<string> => {
    await waitFor(
      'the project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      60_000,
    );
    return textOf('conversation-id');
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );

    // --- The project, and whatever it already has --------------------------
    const firstConversation = await openTheProject();
    const atOpen = historyInWindow();
    record('opened', {
      conversationShownInWindow: firstConversation,
      projectShownInWindow: textOf('project-path'),
      historyTurnsShownInWindow: atOpen.turns,
      historyStorageShownInDiagnostics: atOpen.storage,
      historyErrorShownInWindow: atOpen.error,
      // Non-zero on the second process, which is the restart case and the point.
      startedWithHistory: atOpen.turns > 0,
    });
    if (atOpen.error !== '') {
      failures.push(`the window could not read this project's history: ${atOpen.error}`);
    }

    // What came back, photographed. On a fresh profile this is an empty thread and on
    // the second process it is the conversation, which is the comparison worth having.
    await window.dspatch.captureWindow('history-at-open');

    // Order and uniqueness are checkable in this process whatever it inherited. Both
    // halves of the defect show up here: messages missing, and messages arriving twice.
    if (new Set(afterOpenPrompts(atOpen.prompts)).size !== atOpen.prompts.length) {
      failures.push(
        `a message came back more than once: ${atOpen.prompts.join(' | ')}. A duplicated ` +
          'turn is how a conversation stops being a record of what happened.',
      );
    }
    const restoredOnes = atOpen.prompts.filter((prompt) => / one\.$/.test(prompt)).length;
    const restoredTwos = atOpen.prompts.filter((prompt) => / two\.$/.test(prompt)).length;
    if (atOpen.turns > 0) {
      // Every earlier run of this scenario sent exactly one of each, in that order, so a
      // restored conversation has to hold them in pairs and in sequence.
      const firstOne = atOpen.prompts.findIndex((prompt) => / one\.$/.test(prompt));
      const firstTwo = atOpen.prompts.findIndex((prompt) => / two\.$/.test(prompt));
      if (restoredOnes !== restoredTwos || firstOne === -1 || firstOne > firstTwo) {
        failures.push(
          `the restored conversation is not the conversation that happened: ${String(
            restoredOnes,
          )} first messages and ${String(restoredTwos)} second ones, in this order: ` +
            atOpen.prompts.join(' | '),
        );
      }
      // Where they came from is no longer a line above the thread (Niclas, 24 October
      // 2026: the conversation is shown as itself); it is in the diagnostics, and it
      // must still be said somewhere a person can find it.
      if (atOpen.storage.file === '' || atOpen.storage.messagesRead !== String(atOpen.turns)) {
        failures.push(
          'earlier messages were drawn and the diagnostics do not say where they were read ' +
            `from or how many came back (file "${atOpen.storage.file}", ${atOpen.storage.messagesRead} ` +
            `read back, ${String(atOpen.turns)} drawn).`,
        );
      }
    }

    // --- Two messages, which is what has to survive the restart -------------
    const mark = newNonce();
    const sent = [`First message, ${mark} one.`, `Second message, ${mark} two.`];
    await sendAndSettle(0, sent[0] ?? '', plan.turnTimeoutMs);
    await sendAndSettle(1, sent[1] ?? '', plan.turnTimeoutMs);
    record('sent', {
      marker: mark,
      messages: sent,
      // Enter is the only way to send now, so whether the window follows its own send
      // is worth measuring where nothing else has touched the scroller first.
      distanceFromLatestPx: Math.round(distanceFromBottomPx()),
      // Whatever the window says about the provider session, recorded beside the
      // history so the two can be compared rather than conflated: restored text is not
      // a resumed session, and this is where a window claiming otherwise would show it.
      // The service's statement, from the diagnostics in the details (DSP-121 flow).
      continuityShownInWindow: textOf('diagnostics-statement'),
      saveErrorShownInWindow: textOf('save-error'),
    });
    if (textOf('save-error') !== '') {
      failures.push(`the window reported a failed save: ${textOf('save-error')}`);
    }
    await window.dspatch.captureWindow('after-sending');

    return finish(
      failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.conversationDidNotComeBack,
      steps,
      failures,
      observations,
    );
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

async function runPresentationScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'Every reply in this run was streamed by the local presentation adapter in the ' +
      'main process. No provider call was made, so this evidences what the window ' +
      'does with text and nothing about the provider.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );

    // The chrome, before anything has been sent. Measured here because "the card
    // is gone" is a statement about the window at rest.
    const bar = element('workspace-header');
    const chromeHeightAtRest = bar?.getBoundingClientRect().height ?? 0;
    record('chrome-at-rest', { chromeHeightPx: Math.round(chromeHeightAtRest) });

    // DSP-149: a sample project is a development menu item, not a start page button.
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor(
      'a session to open',
      () => textOf('session-id') !== '' && element('prompt') !== null,
      30_000,
    );

    // --- The first message of a session, which is the case DSP-58 names -------
    const pageScrollTopBeforeFirstSend = document.documentElement.scrollTop;
    await sendAndSettle(0, 'First message, mark-alpha.', plan.turnTimeoutMs);
    const pageScrollTopAfterFirstSend = document.documentElement.scrollTop;
    const distanceAfterFirstSend = distanceFromBottomPx();
    record('first-send', {
      pageScrollTopBeforeFirstSend,
      pageScrollTopAfterFirstSend,
      pageScrollRangePx: pageScrollRangePx(),
      verticalScrollersInWindow: verticalScrollers(),
      transcriptDistanceFromBottomAfterFirstSend: distanceAfterFirstSend,
    });

    // --- Markdown, read off the first reply ---------------------------------
    const replyHost = element('turn-0-answer');
    const elementsInReply = tagsInside('turn-0-answer');
    const visibleText = replyHost?.textContent ?? '';
    const literalsRequired = [
      '### not a heading, **not bold**',
      'rg --glob "*.ts" -n "a && b" | head -5',
      '<script>alert("not a script")</script>',
    ];
    // Counted in the whole document, not only in the reply: an injected element
    // that escaped its container would otherwise be missed by a check for it.
    const scriptOrIframeElements = document.querySelectorAll(
      'script:not([type="module"]), iframe, object, embed',
    ).length;
    const inlineEventHandlerAttributes = [...(replyHost?.querySelectorAll('*') ?? [])].filter(
      (node) => [...node.attributes].some((attribute) => attribute.name.startsWith('on')),
    ).length;
    const linkHrefs = [...(replyHost?.querySelectorAll('a') ?? [])].map(
      (link) => link.getAttribute('href') ?? '',
    );

    // --- The same reply, half way through arriving ---------------------------
    await typeInto('prompt', 'Second message, mark-bravo.');
    await sendFromComposer();
    await waitFor(
      'the second reply to be part way through',
      () => rawTextOf('active-answer').length > 200,
      plan.turnTimeoutMs,
    );
    const visibleTextWhileStreaming = rawTextOf('active-answer');
    const elementsWhileStreaming = tagsInside('active-answer');
    await waitFor(
      'the second reply to finish',
      () => element('active-answer') === null,
      plan.turnTimeoutMs,
    );
    record('markdown', { elementsInReply, elementsWhileStreaming });

    // --- A long message of the user's own ------------------------------------
    // Sent as an ordinary message, because that is how one arrives. What is
    // measured is the box, not the string: how tall it is while clipped, how
    // tall it is whole, how much of it is in the document while it is clipped,
    // and how far the conversation moved under the reader across the two
    // presses. A preview made by cutting the text would pass the first two of
    // those and fail the third, which is why the third is there.
    const longText = [
      'A long message, mark-long, of the kind that used to fill the window.',
      ...Array.from(
        { length: 24 },
        (_unused, line) =>
          `Line ${String(line + 1)}: the whole of this has to stay in the document while ` +
          'the box is short, because a message that cannot be copied whole is a message ' +
          'that was thrown away rather than folded.',
      ),
    ].join('\n');
    await sendAndSettle(2, longText, plan.turnTimeoutMs);
    const longPrompt = element('turn-2-prompt');
    const longScroller = transcriptElement();
    const collapsedHeightPx = longPrompt?.getBoundingClientRect().height ?? 0;
    const charactersInDocumentWhileCollapsed = (longPrompt?.textContent ?? '').length;
    const shortPrompt = element('turn-0-prompt');
    // No buttons: neither of the two that were here, and none put in their place.
    const buttonsWithTheMessage =
      (longPrompt?.parentElement?.querySelectorAll('button').length ?? 0) +
      (longPrompt?.querySelectorAll('button').length ?? 0);
    const shortMessageIsInteractive = attributeOf('turn-0-prompt', 'role') === 'button';
    const fadeAtTheFoot =
      longPrompt !== null &&
      getComputedStyle(longPrompt, '::before').backgroundImage.includes('gradient');
    const collapsedLines =
      longPrompt === null
        ? 0
        : (longPrompt.clientHeight -
            Number.parseFloat(getComputedStyle(longPrompt).paddingTop) -
            Number.parseFloat(getComputedStyle(longPrompt).paddingBottom)) /
          Number.parseFloat(getComputedStyle(longPrompt).lineHeight);
    await window.dspatch.captureWindow('long-message-collapsed');

    // A drag across the text, ending in the click a drag ends in. The fold must not
    // move: selecting a sentence out of a message is not a request to unfold it.
    const charactersSelectedByDragging = dragAcross('turn-2-prompt');
    const heldOpenThroughADragSelection =
      element('turn-2-prompt')?.getAttribute('aria-expanded') === 'false';
    window.getSelection()?.removeAllRanges();

    // A plain click inside, which is the whole affordance now.
    const positionBeforeToggling = longScroller.scrollTop;
    clickInside('turn-2-prompt');
    await sleep(150);
    const openedByClickingInside =
      element('turn-2-prompt')?.getAttribute('aria-expanded') === 'true';
    const expandedHeightPx = element('turn-2-prompt')?.getBoundingClientRect().height ?? 0;
    await window.dspatch.captureWindow('long-message-expanded');

    // And a press outside it, which folds it again.
    (element('transcript') as HTMLElement).dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, clientX: 1, clientY: 1 }),
    );
    await sleep(150);
    const foldedByClickingOutside =
      element('turn-2-prompt')?.getAttribute('aria-expanded') === 'false';
    const readingPositionDriftPx = Math.abs(longScroller.scrollTop - positionBeforeToggling);

    // The keyboard, because the affordance is quiet and must not therefore be
    // mouse-only. No visible button was added to achieve this.
    const box = element('turn-2-prompt') as HTMLElement;
    box.focus();
    const focusedWithoutAButton = document.activeElement === box;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(150);
    const openedByKeyboard =
      focusedWithoutAButton &&
      element('turn-2-prompt')?.getAttribute('aria-expanded') === 'true';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    record('long-message', {
      collapsedHeightPx: Math.round(collapsedHeightPx),
      expandedHeightPx: Math.round(expandedHeightPx),
      collapsedLines: Number(collapsedLines.toFixed(2)),
      charactersTyped: longText.length,
      charactersInDocumentWhileCollapsed,
      readingPositionDriftPx: Math.round(readingPositionDriftPx),
      shortMessageHeightPx: Math.round(shortPrompt?.getBoundingClientRect().height ?? 0),
      shortMessageIsInteractive,
      buttonsWithTheMessage,
      fadeAtTheFoot,
      charactersSelectedByDragging,
      heldOpenThroughADragSelection,
      openedByClickingInside,
      foldedByClickingOutside,
      openedByKeyboard,
    });

    // --- The same window, narrow and wide (DSP-65 #2) ------------------------
    // Resized through the main process, because that is the only side that can
    // resize a window, and read afterwards: the complaint was that the chat follows
    // the window's height and not its width, which is only visible across widths.
    const widths: {
      contentWidthPx: number;
      userMessageWidthPx: number;
      agentReplyWidthPx: number;
      composerWidthPx: number;
      pageOverflowPx: number;
      conversationOverflowPx: number;
    }[] = [];
    for (const [label, asked] of [
      ['narrow', 760],
      ['wide', 1800],
    ] as const) {
      const contentWidthPx = await window.dspatch.setWindowWidth(asked);
      // Two frames plus a moment: a resize re-lays out and the message boxes
      // re-measure themselves afterwards.
      await sleep(400);
      const thread = transcriptElement();
      widths.push({
        contentWidthPx,
        // The box, outer edge to outer edge, against the reply's *text* column: the
        // reply is inset inside the box, so this is the comparison the reference
        // shows — the user's message is the wider element.
        userMessageWidthPx: Math.round(
          element('turn-2-prompt')?.getBoundingClientRect().width ?? 0,
        ),
        agentReplyWidthPx: Math.round(textColumnWidth(element('turn-2-answer'))),
        composerWidthPx: Math.round(element('prompt')?.getBoundingClientRect().width ?? 0),
        pageOverflowPx: Math.round(
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
        conversationOverflowPx: Math.round(thread.scrollWidth - thread.clientWidth),
      });
      await window.dspatch.captureWindow(`width-${label}`);
    }
    await window.dspatch.setWindowWidth(1280);
    await sleep(400);
    record('widths', { widths });

    // --- The mode chooser, and when it is on screen (DSP-65 #3) --------------
    // Beside an idle composer it used to draw a chooser and the sentence "No loop is
    // running…", which is why it read as a second copy of `Use loop`. It is now shown
    // when a loop is running or about to be, and this is where that is checked: a
    // condition on rendering is not covered by the unit tests for the rule.
    const modeChooserAtRest = element('loop-mode') !== null;
    await setCheckbox('use-loop', true);
    await sleep(150);
    const modeChooserWithLoopOn = element('loop-mode') !== null;
    const modeChooserLabel = textOf('loop-control');
    await window.dspatch.captureWindow('loop-mode');
    await setCheckbox('use-loop', false);
    await sleep(150);
    const modeChooserAfterLoopOff = element('loop-mode') !== null;
    record('mode-chooser', {
      modeChooserAtRest,
      modeChooserWithLoopOn,
      modeChooserAfterLoopOff,
      modeChooserLabel,
    });
    if (modeChooserAtRest || modeChooserAfterLoopOff) {
      failures.push(
        'the mode chooser is drawn beside an ordinary composer with no loop running or ' +
          'intended, which is what makes it read as a second copy of Use loop.',
      );
    }
    if (!modeChooserWithLoopOn) {
      failures.push(
        'turning on Use loop did not bring the mode chooser with it, so there is no way ' +
          'to say who starts the next agent or command.',
      );
    }

    // --- A conversation long enough to scroll back in ------------------------
    for (let index = 3; index < 8; index += 1) {
      await sendAndSettle(index, `Message ${String(index)}, mark-${String(index)}.`, plan.turnTimeoutMs);
    }
    const distanceAfterLaterSend = distanceFromBottomPx();

    // --- Reading something earlier while a reply arrives ---------------------
    const thread = transcriptElement();
    thread.scrollTop = 0;
    thread.dispatchEvent(new Event('scroll', { bubbles: false }));
    await sleep(120);
    const chosen = thread.scrollTop;
    const heightBefore = thread.scrollHeight;

    // A reply that is not this person's own send: the window must not pull them
    // down to it. Sent by typing and pressing Send is the only way in, so the
    // position is re-chosen immediately afterwards and then held through the
    // whole of the stream, which is the interval §9.1 is about.
    await typeInto('prompt', 'Ninth message, mark-charlie.');
    await sendFromComposer();
    await waitFor(
      'the ninth reply to start',
      () => element('active-answer') !== null,
      plan.turnTimeoutMs,
    );
    thread.scrollTop = 0;
    thread.dispatchEvent(new Event('scroll', { bubbles: false }));
    let lowest = thread.scrollTop;
    let highest = thread.scrollTop;
    while (element('active-answer') !== null) {
      lowest = Math.min(lowest, thread.scrollTop);
      highest = Math.max(highest, thread.scrollTop);
      await sleep(20);
    }
    const contentGrewWhileReading = thread.scrollHeight > heightBefore;
    const offeredTheWayBack = element('return-to-latest') !== null;
    record('reading-position', { chosen, highest, contentGrewWhileReading, offeredTheWayBack });

    if (offeredTheWayBack) {
      await click('return-to-latest');
      await sleep(150);
    }
    const scroll: ScrollObservation = {
      verticalScrollersInWindow: verticalScrollers(),
      pageScrollRangePx: pageScrollRangePx(),
      pageScrollTopAfterFirstSend,
      transcriptDistanceFromBottomAfterFirstSend: distanceAfterFirstSend,
      transcriptDistanceFromBottomAfterLaterSend: distanceAfterLaterSend,
      readingPositionChosen: chosen,
      readingPositionAfterContentArrived: highest,
      contentGrewWhileReading,
      offeredTheWayBack,
      distanceFromBottomAfterReturning: distanceFromBottomPx(),
    };
    observations['scrolling'] = { ...scroll, pageScrollTopBeforeFirstSend, readingPositionLowestSeen: lowest };

    // --- What the window is made of, while the conversation is still open ----
    // Before the conversation is read back rather than after, and that order is
    // forced: reopening history closes the session, so the thread whose height is
    // being measured would no longer be there. Trial 5 of this run measured that
    // the hard way.
    const promptStyle = element('turn-0-prompt');
    const answerStyle = element('turn-0-answer');
    const detailsView = element('session-details-view');
    const shape: {
      -readonly [K in keyof WindowShapeObservation]: WindowShapeObservation[K];
    } = {
      userMessageBackground:
        promptStyle === null ? '' : getComputedStyle(promptStyle).backgroundColor,
      agentReplyBackground:
        answerStyle === null ? '' : getComputedStyle(answerStyle).backgroundColor,
      conversationBackground: conversationSurface(),
      userMessageBorderWidthPx:
        promptStyle === null
          ? 0
          : Number.parseFloat(getComputedStyle(promptStyle).borderTopWidth),
      chromeHeightPx: Math.round(chromeHeightAtRest),
      conversationHeightPx: Math.round(
        transcriptElement().getBoundingClientRect().height,
      ),
      sessionDetailsExist: detailsView !== null,
      sessionDetailsOpenAtRest: attributeOf('session-details-view', 'data-open') === 'true',
      sessionDetailsOpenedWhenAsked: false,
      detailsFactsFound: {
        'Project folder': textOf('project-folder') !== '',
        'DSpatch session': textOf('dspatch-session') !== '',
        Account: textOf('connection-account') !== '',
        'How this is wired': textOf('adapter-note') !== '',
      },
      projectNameShown: textOf('project-path'),
      modelControlBesideComposer:
        element('model-select') !== null || element('model-name') !== null,
      modelControlSaysWhatItAffects: textOf('model-affects'),
      connectionProblemShownInContext: element('connection-problem')?.textContent ?? null,
      longMessage: {
        charactersTyped: longText.length,
        charactersInDocumentWhileCollapsed,
        collapsedHeightPx,
        expandedHeightPx,
        readingPositionDriftPx,
        collapsedLines,
        fadeAtTheFoot,
        buttonsWithTheMessage,
        openedByClickingInside,
        foldedByClickingOutside,
        heldOpenThroughADragSelection,
        charactersSelectedByDragging,
        openedByKeyboard,
        shortMessageIsInteractive,
      },
      widths,
      // Filled below when the conversation has a finished run in it. `null` here
      // rather than `false`: nothing has been looked at yet.
      runStatusOutlivedItsPlace: null,
    };
    // Through the real menu, because that is the only way in now. A script in the
    // document cannot see a native menu bar, so the main process presses the item
    // and the window is read afterwards — which checks the route a person is told
    // to use rather than a button standing in for it.
    // The conversation as it stands, before anything is opened over it. A
    // picture is the only evidence about a layout that a person can check.
    await window.dspatch.captureWindow('conversation');
    const detailsItemExists = await window.dspatch.pressMenuItem('show-session-details');
    await sleep(150);
    shape.sessionDetailsOpenedWhenAsked =
      detailsItemExists && attributeOf('session-details-view', 'data-open') === 'true';
    await window.dspatch.captureWindow('session-details');
    await window.dspatch.pressMenuItem('hide-session-details');
    await sleep(150);
    // --- A finished run, and the messages sent after it ----------------------
    // Only when this conversation has a loop run in it, which here means a run
    // record read back from disk. The question is not whether the status is
    // right but where it is: a finished run's standing that sits below the
    // newest ordinary message is following the conversation down the page
    // instead of staying with the run it describes.
    const finishedRun = element('loop-turn-0');
    if (finishedRun !== null) {
      const chatTurns = [...document.querySelectorAll<HTMLElement>('[data-ev]')].filter((node) =>
        /^turn-\d+$/.test(node.getAttribute('data-ev') ?? ''),
      );
      const newest = chatTurns[chatTurns.length - 1] ?? null;
      const standings = [...document.querySelectorAll<HTMLElement>('[data-ev="run-standing"]')];
      const below =
        newest === null
          ? []
          : standings.filter(
              (node) =>
                // FOLLOWING: the standing block comes after the newest message.
                (newest.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
            );
      shape.runStatusOutlivedItsPlace = below.length > 0;
      // The run's own entry, where the status now lives, photographed where it is.
      finishedRun.scrollIntoView();
      await sleep(150);
      await window.dspatch.captureWindow('finished-run');
      transcriptElement().scrollTop = transcriptElement().scrollHeight;
      record('finished-run-and-later-messages', {
        chatTurnsAfterTheRun: chatTurns.length,
        standingBlocksInTheWindow: standings.length,
        standingBlocksBelowTheNewestMessage: below.length,
        runAccount: textOf('loop-turn-0-account').slice(0, 160),
        // Was `standingIsBehindADisclosure`. There is no disclosure to be behind any
        // more, so what is worth recording is whether the block is there at all —
        // which, for a run that ended by itself, it should not be (DSP-90).
        standingBlocksAtTheFinishedRun: standings.length,
      });
    }

    observations['windowShape'] = shape;
    record('window-shape', {
      chromeShare:
        shape.chromeHeightPx / (shape.chromeHeightPx + shape.conversationHeightPx),
      detailsOpened: shape.sessionDetailsOpenedWhenAsked,
    });

    // --- The saved conversation, read back -----------------------------------
    // Within this process rather than across a restart, which is a real limit and
    // is stated: it exercises the reading and rendering path, not persistence
    // across a restart, which `conversation-store.test.ts` covers separately.
    // Through the menu, for the reason the details were: *Open a project…* is a
    // menu item and the button that used to do this is gone.
    // DSP-149: saved conversations are in the history view, from the menu.
    await window.dspatch.pressMenuItem('show-history');
    await waitFor('the conversation list', () => element('conversations') !== null, 30_000);
    let elementsAfterReopening: readonly string[] = [];
    if (element('resume-0') !== null) {
      await click('resume-0');
      await waitFor(
        'the saved conversation to be read back',
        () => element('restored-turn-0-answer') !== null,
        60_000,
      );
      elementsAfterReopening = tagsInside('restored-turn-0-answer');
    } else {
      failures.push(
        'no saved conversation was offered, so the reopened-reply half of AC#5 was ' +
          'not exercised. This is the trial failing to set itself up.',
      );
    }
    const markdown: MarkdownObservation = {
      elementsInReply,
      visibleText,
      literalsRequired,
      scriptOrIframeElements,
      inlineEventHandlerAttributes,
      linkHrefs,
      visibleTextWhileStreaming,
      elementsWhileStreaming,
      elementsAfterReopening,
    };
    observations['markdown'] = markdown;

    const gates = [
      ['scrolling', checkConversationScrollsWell(scroll), CHAT_EXIT.conversationJumped],
      ['markdown', checkRepliesRenderMarkdown(markdown), CHAT_EXIT.repliesNotRendered],
      ['window shape', checkWindowGivesTheConversationTheSpace(shape), CHAT_EXIT.chromeInTheWay],
      [
        'the user\u2019s message box',
        checkUserMessageLooksLikeTheReference(shape),
        CHAT_EXIT.messageBoxNotLikeTheReference,
      ],
      ['window width', checkWindowFollowsItsWidth(shape), CHAT_EXIT.widthNotFollowed],
    ] as const;
    let exitCode: number = CHAT_EXIT.ok;
    for (const [name, verdict, code] of gates) {
      if (verdict.failure !== null) {
        failures.push(`${name}: ${verdict.failure}`);
        exitCode = code;
      }
    }
    return finish(exitCode, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    // What the window was showing when the wait gave up. A timeout that says only
    // "this never appeared" cannot distinguish a window that is wrong from a script
    // looking for the wrong name, and this run lost an hour to exactly that.
    observations['controlsPresentAtFailure'] = [...document.querySelectorAll('[data-ev]')]
      .map((node) => node.getAttribute('data-ev'))
      .slice(0, 200);
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/** Run whatever is in the command field and wait for a result that is not the old one. */
async function runCommandField(
  label: string,
  timeoutMs = 300_000,
): Promise<Record<string, unknown>> {
  await click('run-test');
  await waitFor(
    `the command for ${label} to start`,
    () => element('test-pending') !== null || element('test-error') !== null,
    60_000,
  );
  await waitFor(
    `a result for ${label}`,
    () => element('test-pending') === null,
    timeoutMs,
    200,
  );
  const stdout = rawTextOf('test-stdout');
  return {
    label,
    commandShownInWindow: textOf('test-command'),
    cwdShownInWindow: textOf('test-cwd'),
    exitCodeShown: textOf('test-exit-code'),
    snapshotShown: textOf('test-snapshot'),
    freshnessKindShown: textOf('test-freshness-kind'),
    selfModifiedShown: element('test-self-modified') !== null,
    errorShown: textOf('test-error'),
    stdoutChars: stdout.length,
    stdoutTail: stdout.slice(-400),
    stderrShown: element('test-stderr') !== null,
  };
}

/**
 * Click "Check files on disk" and read the diff the window rendered.
 *
 * The wait is for a *new* reading, not for the panel to be populated. Waiting
 * for the panel to exist is what the first version of this did, and on a second
 * call it returned instantly with the previous render still in the document —
 * reporting an old diff as though it were the current one. The snapshot line
 * carries the moment the disk was read, so requiring it to change is the cheap
 * way to be sure the numbers below belong to this click.
 */
async function readDiff(label: string): Promise<Record<string, unknown>> {
  const previousLine = textOf('diff-snapshots');
  await click('read-files');
  await waitFor(
    `a new diff for ${label}`,
    () => element('changed-count') !== null && textOf('diff-snapshots') !== previousLine,
    180_000,
    100,
  );
  const paths: string[] = [];
  const texts: Record<string, string> = {};
  const limitations: Record<string, string> = {};
  const preexistingDirty: string[] = [];
  for (let index = 0; index < 64; index += 1) {
    const relPath = textOf(`diff-${String(index)}-path`);
    if (relPath === '') {
      break;
    }
    paths.push(relPath);
    const text = rawTextOf(`diff-${String(index)}-text`);
    if (text !== '') {
      texts[relPath] = text;
    }
    const limitation = textOf(`diff-${String(index)}-limitation`);
    if (limitation !== '') {
      limitations[relPath] = limitation;
    }
    if (element(`diff-${String(index)}-preexisting`) !== null) {
      preexistingDirty.push(relPath);
    }
  }
  return {
    label,
    snapshotLineShownInWindow: textOf('diff-snapshots'),
    coverageNoteShownInWindow: textOf('diff-coverage'),
    changedCountShown: textOf('changed-count'),
    addedCountShown: textOf('added-count'),
    withoutTextShown: textOf('diff-without-text'),
    pathsShownInWindow: paths,
    diffTexts: texts,
    limitations,
    preexistingDirty,
  };
}

/**
 * The diff and build/test scenario, over a throwaway repository.
 *
 * It is built around the two claims that are easy to assert and hard to
 * evidence. The diff has to come from the bytes on disk rather than from what
 * the agent said it did, so the script plants content through the **command
 * field** — DSpatch running a shell command, with no agent involved and nothing
 * reported in the conversation — and then requires that content to appear in the
 * diff, byte for byte. And a passing result must stop applying once the code
 * moves, so the script gets a green result on screen, asks the agent for one
 * more small edit, and requires the window to mark the green result stale
 * without being asked.
 *
 * Two billed turns. The rest costs nothing.
 */
async function runReviewAndTestScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = { plan };
  const startedAt = performance.now();

  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection panel to reach a decided state',
      connectionDecided,
      120_000,
    );
    const connectionKind = textOf('connection-kind');
    const accountShown = textOf('connection-account');
    const connectionGate = checkConnectionNamesAnAccount({
      connectionKind,
      accountCharacters: accountShown.length,
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountSaysUnknown: accountShown.startsWith('unknown'),
    });
    observations['connection'] = {
      kindShownInWindow: connectionKind,
      accountShownInWindow: accountShown === '' ? 'nothing' : '[not recorded]',
      accountLooksLikeAnAddress: accountShown.includes('@'),
      gateFailure: connectionGate.failure,
    };
    if (connectionGate.failure !== null) {
      failures.push(connectionGate.failure);
      return finish(CHAT_EXIT.notConnected, steps, failures, observations);
    }

    // --- Open the throwaway repository -------------------------------------
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      180_000,
    );
    const suggestedCommand = textOf('test-command');
    observations['session'] = {
      sessionIdShownInWindow: textOf('session-id'),
      workspaceShownInWindow: textOf('workspace-path'),
      baselineShownInWindow: textOf('baseline-id'),
      dirtyCountShownInWindow: textOf('project-dirty-count'),
      // The command field is filled in from the project rather than from a
      // constant. `npm test` here means it was read out of package.json.
      suggestedCommandShownInWindow: suggestedCommand,
      suggestedCwdShownInWindow: textOf('test-cwd'),
    };
    record('session', { baseline: textOf('baseline-id'), suggested: suggestedCommand });

    // --- The command and the working directory are edited in the window -----
    if (plan.nodePath === null) {
      failures.push(
        'the main process found no node executable, so the scenario cannot type a ' +
          'runnable command into the field. This is a missing prerequisite, not a ' +
          'verdict on the window.',
      );
      return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
    }
    const node = plan.nodePath.includes(' ') ? `"${plan.nodePath}"` : plan.nodePath;
    const testCommand = `${node} --test test/format.test.ts`;
    const workspace = textOf('workspace-path');
    await typeIntoField('test-command-input', testCommand);
    await typeIntoField('test-cwd-input', workspace);
    observations['editedCommand'] = {
      typed: testCommand,
      commandShownInWindow: textOf('test-command'),
      cwdShownInWindow: textOf('test-cwd'),
    };
    if (textOf('test-command') !== testCommand) {
      failures.push('the command field did not accept typed text');
      return finish(CHAT_EXIT.limitationNotShown, steps, failures, observations);
    }

    // --- A command that fails ------------------------------------------------
    const failing = await runCommandField('before the change');
    observations['runBeforeChange'] = failing;
    record('run-before', failing);
    if (failing['exitCodeShown'] !== '1') {
      failures.push(
        'the command did not fail before the change, so a pass afterwards would ' +
          `prove nothing: exit code shown was "${String(failing['exitCodeShown'])}"`,
      );
      return finish(CHAT_EXIT.testEvidenceMissing, steps, failures, observations);
    }

    // --- The agent makes the change -----------------------------------------
    const turn1 = await runTurn(
      'change-request',
      'In this repository, `src/duration.ts` exports `formatDuration`, which ' +
        'currently handles seconds only. Complete it so that the existing tests ' +
        'pass. The tests in `test/format.test.ts` are the specification — read ' +
        'them. Edit `src/duration.ts` and nothing else: do not modify any test ' +
        'file, do not add dependencies, and do not run any commands. Reply with ' +
        'the single word DONE when the file is saved.',
      0,
      plan.turnTimeoutMs,
      false,
    );
    observations['turn1ChangeRequest'] = turn1;
    record('turn-1', { status: turn1.finalStatusText, tools: turn1.toolText });

    // --- The failing result must already have stopped applying ---------------
    await waitFor(
      'the earlier result to be marked stale after the code changed',
      () => textOf('test-freshness-kind') === 'stale',
      120_000,
      500,
    );
    observations['stalenessAfterChange'] = {
      kindShownInWindow: textOf('test-freshness-kind'),
      headlineShownInWindow: textOf('test-freshness'),
      exitCodeStillShown: textOf('test-exit-code'),
    };
    record('stale-after-change', { kind: textOf('test-freshness-kind') });

    // --- The diff -------------------------------------------------------------
    const diff1 = await readDiff('after the change');
    observations['diffAfterChange'] = diff1;
    record('diff-1', { paths: diff1['pathsShownInWindow'] });
    const texts1 = diff1['diffTexts'] as Record<string, string>;
    const durationDiff = texts1['src/duration.ts'] ?? '';
    const diffOk =
      durationDiff.includes('--- a/src/duration.ts') &&
      durationDiff.includes('+++ b/src/duration.ts') &&
      durationDiff.includes('@@') &&
      /^-/m.test(durationDiff) &&
      /^\+/m.test(durationDiff) &&
      String(diff1['snapshotLineShownInWindow']).includes('snap-');
    if (!diffOk) {
      failures.push(
        'the window did not show a unified diff of src/duration.ts bound to two ' +
          'named snapshots after the agent changed it',
      );
      return finish(CHAT_EXIT.diffMissing, steps, failures, observations);
    }

    // --- The same command, now passing --------------------------------------
    const passing = await runCommandField('after the change');
    observations['runAfterChange'] = passing;
    record('run-after', passing);
    if (passing['exitCodeShown'] !== '0' || passing['freshnessKindShown'] !== 'current') {
      failures.push(
        'the window did not show a passing, current result after the change: exit ' +
          `code "${String(passing['exitCodeShown'])}", freshness ` +
          `"${String(passing['freshnessKindShown'])}"`,
      );
      return finish(CHAT_EXIT.testEvidenceMissing, steps, failures, observations);
    }

    // --- Content planted behind the agent's back -----------------------------
    // `tools/plant.js` is part of the repository and is run through the command
    // field, so DSpatch executes it and the agent neither performs nor reports
    // it. Whatever the diff says about these files can only have come from the
    // bytes on disk.
    await typeIntoField('test-command-input', `${node} tools/plant.js`);
    const planted = await runCommandField('planting content behind the agent');
    observations['plantRun'] = planted;
    record('plant', planted);

    // --- Restore the passing result so it is the one that has to go stale ----
    await typeIntoField('test-command-input', testCommand);
    const passingAgain = await runCommandField('green result to be invalidated');
    observations['runGreenBeforeInvalidation'] = passingAgain;
    if (passingAgain['exitCodeShown'] !== '0') {
      failures.push(
        'could not get a passing result on screen before testing staleness: exit ' +
          `code "${String(passingAgain['exitCodeShown'])}"`,
      );
      return finish(CHAT_EXIT.testEvidenceMissing, steps, failures, observations);
    }

    // --- The green result must not survive the next change -------------------
    const turn2 = await runTurn(
      'second-change',
      'Append one single-line comment to the very end of `src/duration.ts`, ' +
        'exactly: // reviewed. Change nothing else, add no dependency and run no ' +
        'command. Reply with the single word DONE when the file is saved.',
      1,
      plan.turnTimeoutMs,
      false,
    );
    observations['turn2SecondChange'] = turn2;
    record('turn-2', { status: turn2.finalStatusText });

    let stalenessObserved = true;
    try {
      await waitFor(
        'the passing result to be marked stale once the code changed again',
        () => textOf('test-freshness-kind') === 'stale',
        120_000,
        500,
      );
    } catch {
      stalenessObserved = false;
    }
    observations['stalenessOfGreenResult'] = {
      kindShownInWindow: textOf('test-freshness-kind'),
      headlineShownInWindow: textOf('test-freshness'),
      // Still 0. The result was not cleared or rewritten: it is the same green
      // result, now carrying the statement that it does not describe this code.
      exitCodeStillShown: textOf('test-exit-code'),
      snapshotStillShown: textOf('test-snapshot'),
      observed: stalenessObserved,
    };
    record('stale-green', {
      kind: textOf('test-freshness-kind'),
      exitCode: textOf('test-exit-code'),
    });
    if (!stalenessObserved || textOf('test-exit-code') !== '0') {
      failures.push(
        'a passing result stayed current after the code changed underneath it, ' +
          'which is exactly the defect AC#8 names',
      );
      return finish(CHAT_EXIT.stalenessNotShown, steps, failures, observations);
    }

    // --- The diff again, with the planted content ----------------------------
    const diff2 = await readDiff('with planted content');
    observations['diffWithPlantedContent'] = diff2;
    record('diff-2', { paths: diff2['pathsShownInWindow'] });
    const paths2 = diff2['pathsShownInWindow'] as string[];
    const texts2 = diff2['diffTexts'] as Record<string, string>;
    const limitations2 = diff2['limitations'] as Record<string, string>;

    const plantedText = texts2['scratch/planted.txt'] ?? '';
    if (
      !plantedText.includes('+planted by the command field, not by the agent') ||
      !plantedText.includes('--- /dev/null')
    ) {
      failures.push(
        'the diff did not show the exact bytes planted through the command field, ' +
          'so it is not established that the diff reads the disk',
      );
      return finish(CHAT_EXIT.plantedBytesMissing, steps, failures, observations);
    }

    const binaryLimitation = limitations2['scratch/planted.bin'] ?? '';
    if (
      !paths2.includes('scratch/planted.bin') ||
      !binaryLimitation.includes('binary')
    ) {
      failures.push(
        'a binary file was changed and the window either omitted it or did not say ' +
          'why it has no diff text',
      );
      return finish(CHAT_EXIT.limitationNotShown, steps, failures, observations);
    }

    // README.md already carried the user's uncommitted edit when the session
    // opened, and the plant script appended to it. The diff must show only what
    // changed since the baseline, and must still mark the file as carrying the
    // user's earlier work — the two halves of AC#6 seen in one row.
    const readmeDiff = texts2['README.md'] ?? '';
    const preexisting = diff2['preexistingDirty'] as string[];
    observations['preexistingInDiff'] = {
      markedInWindow: preexisting,
      readmeDiff,
      readmeShowsOnlyTheNewLine:
        readmeDiff.includes('+appended by the command field') &&
        !readmeDiff.includes('+Edited by hand before DSpatch opened this project.'),
    };
    if (
      !preexisting.includes('README.md') ||
      !readmeDiff.includes('+appended by the command field')
    ) {
      failures.push(
        'a file that already carried uncommitted work was changed again, and the ' +
          'window did not both show the new lines and mark the earlier work',
      );
      return finish(CHAT_EXIT.diffMissing, steps, failures, observations);
    }

    if (paths2.some((relPath) => relPath.startsWith('ignored/'))) {
      failures.push(
        'a git-ignored file appeared in the diff, so the coverage note does not ' +
          'describe what the baseline actually covers',
      );
      return finish(CHAT_EXIT.ignoredFileLeaked, steps, failures, observations);
    }
    observations['ignoredCoverage'] = {
      ignoredFileAbsentFromDiff: true,
      coverageNoteShownInWindow: diff2['coverageNoteShownInWindow'],
      // The repository's plant script also wrote `ignored/planted.txt`. It is
      // absent above, and the note is what tells the reader that absence here
      // does not mean the file is unchanged.
      noteMentionsIgnored: String(diff2['coverageNoteShownInWindow']).includes('ignored'),
    };

    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * The smaller scenario: open a project that already exists, then two turns.
 *
 * This is what evidences DSP-2's interactive surface. It opens the project
 * through the real project list rather than generating one, because the point is
 * that a session can be opened over a working copy DSpatch did not create. It
 * costs two turns instead of four, and it deliberately asks for work that needs
 * no tool, so the answer is text and nothing on disk is touched.
 *
 * What it cannot show: the superseded-run guard, which needs two concurrent runs
 * and is covered by `tests/turn-routing.test.ts` instead, and anything about how
 * the window looks.
 */
async function runInteractiveChatScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = { plan };
  const startedAt = performance.now();

  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    await waitFor(
      'the connection panel to reach a decided state',
      connectionDecided,
      120_000,
    );
    const connectionKind = textOf('connection-kind');
    const accountShown = textOf('connection-account');
    const connectionGate = checkConnectionNamesAnAccount({
      connectionKind,
      accountCharacters: accountShown.length,
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountSaysUnknown: accountShown.startsWith('unknown'),
    });
    observations['connection'] = {
      kindShownInWindow: connectionKind,
      // Presence, not the value: the address is exactly what a secrets check
      // looks for, and the fact that matters is that the window named an account.
      accountShownInWindow: accountShown === '' ? 'nothing' : '[not recorded]',
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountCharacters: accountShown.length,
      accountSaysUnknown: accountShown.startsWith('unknown'),
      modelsShownInWindow: textOf('connection-models'),
      rendererSourceShownInWindow: textOf('renderer-source'),
      gateFailure: connectionGate.failure,
    };
    record('connection', { kind: connectionKind, gatePassed: connectionGate.failure === null });
    if (connectionGate.failure !== null) {
      failures.push(connectionGate.failure);
      return finish(CHAT_EXIT.notConnected, steps, failures, observations);
    }

    // --- The project list, and a session over a project DSpatch did not create
    await waitFor(
      'a project to be offered in the window',
      () => element('project-0-path') !== null,
      60_000,
    );
    observations['projectOffered'] = {
      pathShownInWindow: textOf('project-0-path'),
      rowNote: textOf('projects').slice(0, 600),
    };
    await click('open-project-0');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      180_000,
    );

    const sessionObservation = {
      sessionIdShownInWindow: textOf('session-id'),
      workspaceShownInWindow: textOf('workspace-path'),
      projectNameShownInWindow: textOf('project-path'),
      gitShownInWindow: textOf('project-git'),
      gitHeadShownInWindow: textOf('project-git-head'),
      dirtyCountShownInWindow: textOf('project-dirty-count'),
      dirtyListShownInWindow: textOf('dirty-at-start'),
      baselineShownInWindow: textOf('baseline-id'),
      contextSummaryShownInWindow: textOf('context-summary'),
      contextFilesSentShownInWindow: textOf('context-files-sent'),
      contextStatementShownInWindow: textOf('context-statement'),
      activityShownInWindow: textOf('activity'),
      testCommandShownInWindow: textOf('test-command'),
    };
    observations['session'] = sessionObservation;
    record('session', {
      id: sessionObservation.sessionIdShownInWindow,
      dirty: sessionObservation.dirtyCountShownInWindow,
    });
    if (
      !sessionObservation.baselineShownInWindow.startsWith('snap-') ||
      sessionObservation.workspaceShownInWindow === ''
    ) {
      failures.push(
        'the window opened a session but did not show an identified baseline ' +
          'snapshot and a working copy path',
      );
      return finish(CHAT_EXIT.sessionFailed, steps, failures, observations);
    }

    // --- Streaming, with no tool involved ---------------------------------
    const nonce = newNonce();
    observations['nonce'] = nonce;
    const turn1 = await runTurn(
      'streaming',
      `Remember this token exactly: ${nonce}. Then, without using any tool and ` +
        'without reading or changing any file, count from one to twenty in English ' +
        'words, one word per line.',
      0,
      plan.turnTimeoutMs,
      false,
    );
    observations['turn1Streaming'] = turn1;
    record('turn-1', {
      status: turn1.finalStatusText,
      substantiveLengths: turn1.streamingVerdict.distinctSubstantiveAnswerLengths,
    });
    if (turn1.finalStatusText !== 'finished') {
      failures.push(`the first turn ended as "${turn1.finalStatusText}"`);
      return finish(CHAT_EXIT.streamingNotDemonstrated, steps, failures, observations);
    }
    if (turn1.streamingVerdict.failure !== null) {
      failures.push(turn1.streamingVerdict.failure);
      return finish(CHAT_EXIT.streamingNotDemonstrated, steps, failures, observations);
    }

    // --- A follow-up in the same session -----------------------------------
    const turn2 = await runTurn(
      'follow-up',
      'What was the token I asked you to remember? Reply with the token only.',
      1,
      plan.turnTimeoutMs,
      false,
    );
    const recalled = turn2.finalAnswer.includes(nonce);
    observations['turn2FollowUp'] = { ...turn2, nonceRecalled: recalled };
    record('turn-2', { status: turn2.finalStatusText, nonceRecalled: recalled });
    if (turn2.finalStatusText !== 'finished' || !recalled) {
      failures.push(
        'the follow-up did not return the token planted in the first turn, so a ' +
          'shared session is not established. Reusing a session id proves nothing.',
      );
      return finish(CHAT_EXIT.followUpNotProven, steps, failures, observations);
    }

    observations['afterTwoTurns'] = {
      activityShownInWindow: textOf('activity'),
      contextSummaryShownInWindow: textOf('context-summary'),
      lateEventsPanelPresent: element('dropped-late-events') !== null,
      lateEventsShownInWindow: textOf('dropped-late-events'),
      unresolvedRunsPanelPresent: element('unresolved-runs') !== null,
    };
    record('after-two-turns', { activity: textOf('activity') });

    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* §10 trials 4, 10 and 11: the conversation while work is going on           */
/* ------------------------------------------------------------------------- */

/**
 * How long a single step of the chat loop may take before this is a timeout.
 *
 * The drawing allows 15 minutes for the work step and 20 for the check, so a wait
 * shorter than that would report a run behaving exactly as designed as a failure.
 */
const LOOP_STEP_TIMEOUT_MS = 900_000;

/**
 * How long after a step starts before a message is sent into the run.
 *
 * The queue is drained where the step's prompt is built, and the runner records
 * `node-entered` immediately before calling the executor — with no await between
 * them — so by the time the sentence *"X" is the current step* has crossed IPC,
 * been rendered and been read here, that step's prompt is already built. A few
 * seconds is about the render and the read, not about racing the drain, and the
 * gate treats a delivery to the step that was already running as a failure rather
 * than quietly accepting it.
 *
 * It was ten seconds, and ten was too long rather than too short. A work step on a
 * fast model finished about thirteen seconds in, which left the message roughly
 * three seconds as *received* before the next step took it — and the first run of
 * this scenario read that state 800 ms after sending, so on the second run it read
 * the delivered sentence and the gate rejected a window that had done nothing
 * wrong. The reading below is now sampled; this is shorter so the state it samples
 * lasts long enough to be worth sampling.
 */
const AFTER_STEP_STARTED_MS = 4_000;

/** How often the standing block is read while a stop is outstanding. */
const STANDING_SAMPLE_MS = 25;

/** Long enough for a render and a refused send to have happened, if they were going to. */
const SETTLE_MS = 800;

function countEntries(prefix: string): number {
  let count = 0;
  while (element(`${prefix}-${String(count)}`) !== null) {
    count += 1;
  }
  return count;
}

/** The label inside the first pair of curly quotes, which is how the window names a step. */
function quotedName(sentence: string): string {
  return /\u201C([^\u201D]+)\u201D/.exec(sentence)?.[1]?.trim() ?? '';
}

interface LoopEntryReading {
  readonly mandate: string;
  readonly handovers: readonly string[];
  readonly replyAuthorLines: readonly string[];
  readonly replyTexts: readonly string[];
  readonly badge: string;
  readonly account: string;
}

/**
 * One loop run as the thread shows it.
 *
 * Everything is read through `textInThread`, so a value here is one that appeared in
 * the conversation column and not merely somewhere in the window.
 */
function readLoopEntry(index: number): LoopEntryReading {
  const at = `loop-turn-${String(index)}`;
  const handovers: string[] = [];
  const replyAuthorLines: string[] = [];
  const replyTexts: string[] = [];
  for (let item = 0; item < 32; item += 1) {
    const handover = textInThread(`${at}-handoff-${String(item)}`);
    if (handover !== '') {
      handovers.push(handover);
    }
    const who = textInThread(`${at}-reply-${String(item)}-who`);
    if (who !== '') {
      replyAuthorLines.push(who);
      // Collected even when empty, so a blank block attributed to an agent reaches
      // the gate instead of being skipped by the reader that was meant to find it.
      replyTexts.push(textInThread(`${at}-reply-${String(item)}`));
    }
  }
  return {
    mandate: textInThread(`${at}-mandate`),
    handovers,
    replyAuthorLines,
    replyTexts,
    badge: textOf(`${at}-status`),
    account: textOf(`${at}-account`),
  };
}

/**
 * The conversation scenario: a run, two messages into it, and an interruption.
 *
 * It exists because the three scenarios above predate every part of the conversation
 * behaviour. None of them starts a loop run, so none of them can see a handover in
 * the thread, a message that joins a run instead of starting a second one, or a stop
 * that has been asked for and not yet observed — the sentences are all in unit tests
 * and none of them had been seen in a window.
 *
 * Three billed provider turns, and they are the three the trials need: the work step
 * and the check step of one run, which is what produces a handover and lets a message
 * be given to a step that had not started; and the work step of a second run, cut
 * short. Nothing here is a judgement of the interface.
 *
 * What it cannot provoke: a genuinely **empty** provider reply. There is no way to
 * ask a model for silence on demand, so §10 trial 11's empty reply is covered by the
 * unit tests that feed the reducer one, and this drives the interrupted call — the
 * half of that trial that can be provoked — instead. If a step does happen to answer
 * with nothing, the entry's own sentence says so and this records it.
 */
async function runConversationDuringWorkScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = { plan };
  const startedAt = performance.now();
  /** Every standing the window was seen in, in the order they first appeared. */
  const standingsSeen: string[] = [];

  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  /**
   * The state the window is showing the run in, from wherever it shows it.
   *
   * `run-standing` used to answer this for every state, `active` included. DSP-87
   * removed its working case and DSP-90 removed all the rest except the two with
   * something to act on, so it is now the narrowest of the three sources rather than
   * the widest: a working run is shown by the live step, and a run that ended without
   * incident is shown by its badge. That live element exists only while a step is open,
   * which is why reading `active` off its presence is an observation rather than the
   * script deciding for itself what the window must be doing.
   */
  const liveStepStatus = (): string =>
    (
      document.querySelector<HTMLElement>('[data-ev$="-live-status"]')?.textContent ?? ''
    )
      .replace(/\s+/g, ' ')
      .trim();

  /*
   * Three sources, in order of how much each one knows.
   *
   * The attribute first, because it is the only one that can tell `stop-requested`
   * and `unknown` apart. Then the badge, because a run that ended with nothing to act
   * on draws no standing element at all (DSP-90) and would otherwise read as no state
   * rather than as stopped. Then the live step, which is how a working run shows
   * itself since DSP-87.
   */
  const runStateShown = (): string => {
    const standing = attributeOf('run-standing', 'data-standing');
    if (standing !== '') {
      return standing;
    }
    if (newestLoopRunEnded()) {
      return 'stopped';
    }
    return liveStepStatus() === '' ? '' : 'active';
  };

  /**
   * The state the window is showing, and the one line it says about it.
   *
   * The four sentences this used to read — `standing-who`, `standing-what`,
   * `standing-waiting`, `standing-next` — no longer exist (DSP-90). `note` is the
   * whole of what the block can say now, and it is empty for every state that has
   * nothing actionable, which includes the stop a person asked for and got.
   *
   * `standing` is still read separately, from the attribute, because the state has to
   * stay observable after its prose has gone: the six-way distinction §9 asks for is
   * what the window branches on, not what it writes out.
   */
  const readStanding = (): {
    readonly standing: string;
    readonly activityKnownAttribute: string;
    readonly note: string;
  } => {
    const standing = runStateShown();
    if (standing !== '' && !standingsSeen.includes(standing)) {
      standingsSeen.push(standing);
    }
    return {
      standing,
      activityKnownAttribute: attributeOf('run-standing', 'data-activity-known'),
      note: textOf('run-standing'),
    };
  };

  /**
   * Wait for the run on screen to be working a named step, and say which.
   *
   * The name comes from the live log's newest line, `Entered agent “…”`, because
   * that is where the window writes the step's **label** — the same string the
   * delivered message is later reported against, which is what makes the gate's
   * comparison of the two meaningful. The live step's own who-line names the node
   * id, and comparing an id with a label would pass or fail on whether a drawing
   * happened to use the same text for both.
   */
  const workingStepName = (): string => {
    const lines = [...document.querySelectorAll<HTMLElement>('[data-ev="loop-log"] li')];
    const newest = lines[lines.length - 1]?.textContent ?? '';
    return quotedName(newest.replace(/\s+/g, ' ').trim());
  };

  const waitForNamedStep = async (label: string): Promise<string> => {
    await waitFor(
      `the window to name the step ${label} is on`,
      () => {
        readStanding();
        return runStateShown() === 'active' && workingStepName() !== '';
      },
      LOOP_STEP_TIMEOUT_MS,
      200,
    );
    return workingStepName();
  };

  try {
    // --- The connection, by the same gate as every other scenario ------------
    await waitFor(
      'the connection panel to reach a decided state',
      connectionDecided,
      120_000,
    );
    const connectionKind = textOf('connection-kind');
    const accountShown = textOf('connection-account');
    const connectionGate = checkConnectionNamesAnAccount({
      connectionKind,
      accountCharacters: accountShown.length,
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountSaysUnknown: accountShown.startsWith('unknown'),
    });
    observations['connection'] = {
      kindShownInWindow: connectionKind,
      accountShownInWindow: accountShown === '' ? 'nothing' : '[not recorded]',
      accountLooksLikeAnAddress: accountShown.includes('@'),
      modelsShownInWindow: textOf('connection-models'),
      rendererSourceShownInWindow: textOf('renderer-source'),
      gateFailure: connectionGate.failure,
    };
    if (connectionGate.failure !== null) {
      failures.push(connectionGate.failure);
      return finish(CHAT_EXIT.notConnected, steps, failures, observations);
    }

    // --- A generated throwaway working copy ---------------------------------
    // Deliberately the generated one rather than whatever the project list happens
    // to offer: a loop run writes files and runs commands in the project it is
    // given, and this scenario must never be pointed at somebody's own work by a
    // remembered entry in a list.
    // DSP-149: a sample project is a development menu item, not a start page button.
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      180_000,
    );
    const workspace = textOf('workspace-path');
    observations['session'] = {
      sessionIdShownInWindow: textOf('session-id'),
      workspaceShownInWindow: workspace,
      baselineShownInWindow: textOf('baseline-id'),
      projectNameShownInWindow: textOf('project-path'),
      generated: true,
    };
    record('session', { workspace, baseline: textOf('baseline-id') });
    if (!textOf('baseline-id').startsWith('snap-') || workspace === '') {
      failures.push(
        'the window opened a session but did not show an identified baseline snapshot ' +
          'and a working copy path',
      );
      return finish(CHAT_EXIT.sessionFailed, steps, failures, observations);
    }

    // --- Trial 10, first half: Enter sends and Shift+Enter does not ----------
    const nonce = newNonce();
    observations['nonce'] = nonce;
    const shiftText = `first line of a message that is not finished (${nonce})`;
    await typeInto('prompt', shiftText);
    const entriesBeforeShiftEnter =
      countEntries('loop-turn') + countEntries('instruction') + countEntries('turn');
    const shiftPrevented = await pressKeyInComposer('prompt', 'Enter', { shiftKey: true });
    await sleep(SETTLE_MS);
    const entriesAfterShiftEnter =
      countEntries('loop-turn') + countEntries('instruction') + countEntries('turn');
    const textAfterShiftEnter = (element('prompt') as HTMLTextAreaElement | null)?.value ?? '';
    record('shift-enter', {
      sentSomething: entriesAfterShiftEnter !== entriesBeforeShiftEnter,
      defaultPrevented: shiftPrevented,
    });

    // --- The mandate, sent with Enter ---------------------------------------
    const mandate =
      `Create a file named NOTES.md in the top folder of this project, containing ` +
      `exactly one line: "checked by DSpatch, token ${nonce}". Change nothing else, ` +
      `add no dependency and run no commands. That is the whole assignment.`;
    const useLoopOn = await setCheckbox('use-loop', true);
    observations['useLoopToggle'] = {
      checked: useLoopOn,
      bindingNoteShownInWindow: textOf('composer-route-note'),
    };
    await typeInto('prompt', mandate);
    const enterPrevented = await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
    let loopRunStarted = true;
    try {
      await waitFor(
        'the loop run to appear in the conversation after Enter',
        () => element('loop-turn-0') !== null,
        60_000,
        100,
      );
    } catch {
      loopRunStarted = false;
    }
    const keyGate = checkComposerKeysBehave({
      shiftEnterSentSomething: entriesAfterShiftEnter !== entriesBeforeShiftEnter,
      shiftEnterDefaultPrevented: shiftPrevented,
      shiftEnterTextPreserved: textAfterShiftEnter === shiftText,
      enterSentSomething: loopRunStarted,
      enterDefaultPrevented: enterPrevented,
    });
    observations['composerKeys'] = {
      shiftEnterSentSomething: entriesAfterShiftEnter !== entriesBeforeShiftEnter,
      shiftEnterDefaultPrevented: shiftPrevented,
      shiftEnterTextPreserved: textAfterShiftEnter === shiftText,
      textLeftInTheBoxAfterShiftEnter: textAfterShiftEnter,
      enterSentSomething: loopRunStarted,
      enterDefaultPrevented: enterPrevented,
      // Stated rather than left to be discovered: a dispatched key is untrusted, so
      // the browser inserts nothing for it however correct the window is. What is
      // measured is that the window did not take the key away from the textarea.
      lineBreakItselfNotObservable:
        'A scripted keypress is untrusted, so Chromium performs no default action ' +
        'for it and the inserted line break cannot be observed this way. The window ' +
        'leaving the key alone is the half the window owns.',
      gateFailure: keyGate.failure,
    };
    record('enter-sends', { loopRunStarted, gatePassed: keyGate.failure === null });
    if (keyGate.failure !== null) {
      failures.push(keyGate.failure);
      return finish(CHAT_EXIT.keysDoNotBehave, steps, failures, observations);
    }
    if (!loopRunStarted) {
      failures.push('no loop run appeared in the conversation, so nothing could be sent into one');
      return finish(CHAT_EXIT.loopRunNeverStarted, steps, failures, observations);
    }

    // --- Trial 4: a message while the first step is working -----------------
    const firstStep = await waitForNamedStep('the first run');
    const standingWhileWorking = readStanding();
    observations['standingWhileWorking'] = { ...standingWhileWorking, stepNamed: firstStep };
    record('first-step', { step: firstStep, standing: standingWhileWorking.standing });
    await sleep(AFTER_STEP_STARTED_MS);

    // A token of its own, and deliberately not the one in the mandate. The first run
    // of this scenario asked for the mandate's token back, which every step can see
    // in its own task — so an agent repeating it established nothing. This one
    // appears nowhere except in this message, so a reply containing it is the
    // receiving agent's own corroboration of what the window claims.
    const messageToken = newNonce();
    observations['messageToken'] = messageToken;
    const messageA =
      `While you are working: when the work is checked, please repeat the token ` +
      `${messageToken} in that reply, so I can see that this message reached the step ` +
      `that read it.`;
    await typeInto('prompt', messageA);
    const routeNote = textOf('composer-route-note');
    const loopEntriesBefore = countEntries('loop-turn');
    await sendFromComposer();
    // The **first** thing the window said about this message, sampled rather than read
    // once. The state being sampled lasts only until the next step starts, which on a
    // fast model is a few seconds, and a reader too slow to see the phenomenon it is
    // looking for produces a false negative — the same defect the streaming sampler
    // had, and this one was measured the same way: the second run of this scenario
    // read the delivered sentence 800 ms after sending and rejected a correct window.
    // If the first sample already claims a step has it, the gate rejects that, which
    // is the finding it should be.
    let pendingBadge = '';
    let pendingSentence = '';
    await waitFor(
      'the message to appear in the conversation with an account of where it has got to',
      () => {
        if (element('instruction-0') === null) {
          return false;
        }
        const account = textOf('instruction-0-account');
        if (account === '') {
          return false;
        }
        if (pendingSentence === '') {
          pendingSentence = account;
          pendingBadge = textOf('instruction-0-status');
        }
        return true;
      },
      60_000,
      25,
    );
    const loopEntriesAfter = countEntries('loop-turn');
    observations['messageDuringWork'] = {
      routeNoteShownInWindow: routeNote,
      textShownInThread: textInThread('instruction-0-text'),
      badgeShownInWindow: pendingBadge,
      sentenceShownInWindow: pendingSentence,
      loopEntriesBefore,
      loopEntriesAfter,
      standingWithAMessageWaiting: readStanding(),
      composerEmptiedAfterSending:
        ((element('prompt') as HTMLTextAreaElement | null)?.value ?? '') === '',
    };
    record('message-a', {
      loopEntriesBefore,
      loopEntriesAfter,
      badge: pendingBadge,
    });

    // --- It is given to a step that had not started -------------------------
    await waitFor(
      'the window to say which step was given the message',
      () => textOf('instruction-0-account').includes('Given to'),
      LOOP_STEP_TIMEOUT_MS,
      250,
    );
    const deliveredBadge = textOf('instruction-0-status');
    const deliveredSentence = textOf('instruction-0-account');
    const secondStep = workingStepName();
    observations['messageDelivered'] = {
      badgeShownInWindow: deliveredBadge,
      sentenceShownInWindow: deliveredSentence,
      stepNamedInTheSentence: quotedName(deliveredSentence),
      stepTheWindowSaysIsCurrent: secondStep,
      standingWhenDelivered: readStanding(),
    };
    record('message-a-delivered', { sentence: deliveredSentence });

    // --- A second message, which the run will end before anyone takes -------
    const messageB =
      'And one last thing: if any step is still given this message, write the word ' +
      'LATE somewhere in its reply.';
    await typeInto('prompt', messageB);
    await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
    await waitFor(
      'the second message to appear in the conversation',
      () => element('instruction-1') !== null,
      60_000,
      100,
    );
    observations['secondMessage'] = {
      textShownInThread: textInThread('instruction-1-text'),
      badgeWhileWaiting: textOf('instruction-1-status'),
      sentenceWhileWaiting: textOf('instruction-1-account'),
    };
    record('message-b', { badge: textOf('instruction-1-status') });

    // --- The run ends -------------------------------------------------------
    await waitFor(
      'the first run to report an end',
      () => {
        readStanding();
        return loopRunEnded(0);
      },
      LOOP_STEP_TIMEOUT_MS,
      250,
    );
    await sleep(SETTLE_MS);
    const firstRun = readLoopEntry(0);
    const undeliveredBadge = textOf('instruction-1-status');
    const undeliveredSentence = textOf('instruction-1-account');
    observations['firstRun'] = {
      ...firstRun,
      standingAfterTheEnd: readStanding(),
      // The message's own token, which is in no mandate and no role. A reply
      // containing it is the receiving agent corroborating the delivery the window
      // claims; the mandate's token would have proved nothing, since every step is
      // shown the mandate.
      aLaterReplyRepeatedTheMessageToken: firstRun.replyTexts.some(
        (text, at) => at > 0 && text.includes(messageToken),
      ),
      anyReplyRepeatedTheMessageToken: firstRun.replyTexts.some((text) =>
        text.includes(messageToken),
      ),
      // A step that answered with nothing would be named in the account sentence.
      accountNamesASilentStep: firstRun.account.includes('said nothing at all'),
    };
    observations['secondMessageAfterTheEnd'] = {
      badgeShownInWindow: undeliveredBadge,
      sentenceShownInWindow: undeliveredSentence,
    };
    record('first-run-ended', {
      badge: firstRun.badge,
      replies: firstRun.replyAuthorLines.length,
      handovers: firstRun.handovers.length,
    });

    const userMessagesInThread = [
      textInThread('loop-turn-0-mandate'),
      textInThread('instruction-0-text'),
      textInThread('instruction-1-text'),
    ];
    const threadGate = checkOneThreadWithHandover({
      userMessagesSent: [mandate, messageA, messageB],
      userMessagesShownInThread: userMessagesInThread,
      replyAuthorLinesShownInThread: firstRun.replyAuthorLines,
      handoverSentencesShownInThread: firstRun.handovers,
      replyTextsShownInThread: firstRun.replyTexts,
    });
    observations['threadGate'] = {
      userMessagesShownInThread: userMessagesInThread,
      failure: threadGate.failure,
    };

    const messageGate = checkMessageJoinedTheRun({
      routeNoteShownInWindow: routeNote,
      loopEntriesBeforeSending: loopEntriesBefore,
      loopEntriesAfterSending: loopEntriesAfter,
      stepRunningWhenSent: firstStep,
      pendingBadgeShownInWindow: pendingBadge,
      pendingSentenceShownInWindow: pendingSentence,
      deliveredBadgeShownInWindow: deliveredBadge,
      deliveredSentenceShownInWindow: deliveredSentence,
      undeliveredBadgeShownInWindow: undeliveredBadge,
      undeliveredSentenceShownInWindow: undeliveredSentence,
    });
    observations['messageGate'] = { failure: messageGate.failure };

    // --- What the loop actually did on disk, as corroboration ---------------
    // No provider turn. The agent's account of what it wrote and DSpatch's own
    // comparison of the folder are different kinds of evidence, so both are kept.
    try {
      const diff = await readDiff('after the first run');
      observations['filesAfterTheFirstRun'] = diff;
    } catch (error) {
      observations['filesAfterTheFirstRun'] = {
        note: 'the file check did not report',
        error: error instanceof Error ? error.message : String(error),
      };
    }

    if (threadGate.failure !== null) {
      failures.push(threadGate.failure);
      return finish(CHAT_EXIT.threadIsNotOneConversation, steps, failures, observations);
    }
    if (messageGate.failure !== null) {
      failures.push(messageGate.failure);
      return finish(CHAT_EXIT.messageDidNotJoinTheRun, steps, failures, observations);
    }

    // --- Trial 11: an interrupted call --------------------------------------
    const secondMandate =
      'Read the source files in this project one at a time. After each file, append ' +
      'one line naming it to a file called READING.md. Work through every file ' +
      'before you answer.';
    await typeInto('prompt', secondMandate);
    await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
    await waitFor(
      'the second run to appear in the conversation',
      () => element('loop-turn-1') !== null,
      60_000,
      100,
    );
    const interruptedStep = await waitForNamedStep('the second run');
    // Long enough that the provider call is genuinely out and the step is doing
    // something, short enough that the walk cannot have finished: cancelling a run
    // that had already ended would measure the timing of this script rather than
    // what the window does with an interruption.
    await sleep(AFTER_STEP_STARTED_MS);
    const standingBeforeCancel = readStanding();
    await click('cancel');

    /** Everything the standing block said between the click and the reported end. */
    const stoppingSamples: unknown[] = [];
    let noteWhileStopping = standingBeforeCancel.note;
    let sawStopRequested = false;
    const cancelledAt = performance.now();
    while (performance.now() - cancelledAt < LOOP_STEP_TIMEOUT_MS) {
      const sample = readStanding();
      const last = stoppingSamples[stoppingSamples.length - 1] as
        | { readonly standing: string }
        | undefined;
      if (last === undefined || last.standing !== sample.standing) {
        stoppingSamples.push({
          atMs: Math.round(performance.now() - cancelledAt),
          standing: sample.standing,
          activityKnownAttribute: sample.activityKnownAttribute,
          note: sample.note,
        });
      }
      if (!sawStopRequested && (sample.standing === 'stop-requested' || sample.standing === 'unknown')) {
        sawStopRequested = true;
        noteWhileStopping = sample.note;
      }
      if (sample.standing === 'stopped') {
        break;
      }
      await sleep(STANDING_SAMPLE_MS);
    }
    await sleep(SETTLE_MS);
    const interrupted = readLoopEntry(1);
    const firstRunAfterwards = readLoopEntry(0);
    const standingAfterTheEnd = readStanding();
    observations['interruptedRun'] = {
      stepItWasOn: interruptedStep,
      standingBeforeCancel,
      stoppingSamples,
      sawStopRequested,
      standingAfterTheEnd,
      entry: interrupted,
      stopWaitingNoteShownInWindow: textOf('stop-waiting-note'),
      earlierRunStillInTheThread: {
        mandate: firstRunAfterwards.mandate,
        replies: firstRunAfterwards.replyAuthorLines.length,
        handovers: firstRunAfterwards.handovers,
        badge: firstRunAfterwards.badge,
      },
      messagesStillInTheThread: [
        textInThread('instruction-0-account'),
        textInThread('instruction-1-account'),
      ],
      standingsSeen: [...standingsSeen],
    };
    record('interrupted', {
      standing: standingAfterTheEnd.standing,
      badge: interrupted.badge,
      standingsSeen: [...standingsSeen],
    });

    const interruptionGate = checkInterruptedRunKeepsItsWork({
      standingsSeen,
      noteWhileStopping,
      noteAfterTheEnd: standingAfterTheEnd.note,
      // Counted across the whole document rather than at this run, because the claim
      // is that no disclosure holds the removed prose anywhere (DSP-90).
      standingDisclosuresInTheWindow: document.querySelectorAll(
        '[data-ev$="-standing-detail"]',
      ).length,
      badgeShownInWindow: interrupted.badge,
      accountShownInWindow: interrupted.account,
      mandateShownInWindow: interrupted.mandate,
      mandateAsSent: secondMandate,
      earlierMandateShownInWindow: firstRunAfterwards.mandate,
      earlierMandateAsSent: mandate,
      earlierRepliesStillShown: firstRunAfterwards.replyAuthorLines.length,
    });
    observations['interruptionGate'] = { failure: interruptionGate.failure };
    if (interruptionGate.failure !== null) {
      failures.push(interruptionGate.failure);
      return finish(CHAT_EXIT.interruptionLostTheWork, steps, failures, observations);
    }

    return finish(CHAT_EXIT.ok, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    observations['standingsSeenWhenTheScriptFailed'] = [...standingsSeen];
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

async function runFullWorkflow(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = { plan };
  const startedAt = performance.now();
  let exitCode: number = CHAT_EXIT.ok;

  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };

  try {
    // --- 1. Connection status, as the window shows it ------------------------
    await waitFor(
      'the connection panel to reach a decided state',
      connectionDecided,
      120_000,
    );
    const connectionKind = textOf('connection-kind');
    const accountShown = textOf('connection-account');
    // Shape only, and derived here so the address never reaches the gate, the
    // record or a failure message.
    const connectionGate = checkConnectionNamesAnAccount({
      connectionKind,
      accountCharacters: accountShown.length,
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountSaysUnknown: accountShown.startsWith('unknown'),
    });
    observations['connection'] = {
      kindShownInWindow: connectionKind,
      // Presence, not the value. The account address is exactly what a secrets
      // check looks for, and `probe-cursor.ts` already established the convention:
      // the fact that matters is that the window named an account, not which one.
      accountShownInWindow: accountShown === '' ? 'nothing' : '[not recorded]',
      accountLooksLikeAnAddress: accountShown.includes('@'),
      accountCharacters: accountShown.length,
      accountSaysUnknown: accountShown.startsWith('unknown'),
      modelsShownInWindow: textOf('connection-models'),
      rendererSourceShownInWindow: textOf('renderer-source'),
      gateFailure: connectionGate.failure,
    };
    record('connection', {
      kind: connectionKind,
      accountShown: accountShown !== '',
      gatePassed: connectionGate.failure === null,
    });
    if (connectionGate.failure !== null) {
      failures.push(connectionGate.failure);
      return finish(CHAT_EXIT.notConnected, steps, failures, observations);
    }

    // --- 2. A session over a freshly generated working copy ------------------
    // DSP-149: a sample project is a development menu item, not a start page button.
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor(
      'a session id in the window',
      () => textOf('session-id').startsWith('dsp-session-'),
      180_000,
    );
    observations['session'] = {
      sessionIdShownInWindow: textOf('session-id'),
      workspaceShownInWindow: textOf('workspace-path'),
    };
    record('session', { id: textOf('session-id') });

    // --- 3. The test before any change: it must fail, or the change proves
    // nothing afterwards.
    const testBefore = await runTest('before the change');
    observations['testBefore'] = testBefore;
    record('test-before', testBefore);

    // --- 4. Streaming ------------------------------------------------------
    const nonce = newNonce();
    observations['nonce'] = nonce;
    const turn1 = await runTurn(
      'streaming',
      `Remember this token exactly: ${nonce}. Then, without using any tool, count ` +
        'from one to twenty in English words, one word per line.',
      0,
      plan.turnTimeoutMs,
      false,
    );
    observations['turn1Streaming'] = turn1;
    record('turn-1', {
      status: turn1.finalStatusText,
      distinctAnswerLengths: turn1.distinctAnswerLengths,
      substantiveLengths: turn1.streamingVerdict.distinctSubstantiveAnswerLengths,
    });
    if (turn1.finalStatusText !== 'finished') {
      failures.push(`the first turn ended as "${turn1.finalStatusText}"`);
      return finish(CHAT_EXIT.streamingNotDemonstrated, steps, failures, observations);
    }
    if (turn1.streamingVerdict.failure !== null) {
      failures.push(turn1.streamingVerdict.failure);
      return finish(CHAT_EXIT.streamingNotDemonstrated, steps, failures, observations);
    }

    // --- 5. A follow-up in the same session ---------------------------------
    const turn2 = await runTurn(
      'follow-up',
      'What was the token I asked you to remember? Reply with the token only.',
      1,
      plan.turnTimeoutMs,
      false,
    );
    const recalled = turn2.finalAnswer.includes(nonce);
    observations['turn2FollowUp'] = { ...turn2, nonceRecalled: recalled };
    record('turn-2', { status: turn2.finalStatusText, nonceRecalled: recalled });
    if (turn2.finalStatusText !== 'finished' || !recalled) {
      failures.push(
        'the follow-up did not return the token planted in the first turn, so a ' +
          'shared session is not established. Reusing a session id proves nothing.',
      );
      return finish(CHAT_EXIT.followUpNotProven, steps, failures, observations);
    }

    // --- 6. A change request that has to touch the disk ---------------------
    const turn3 = await runTurn(
      'change-request',
      CHANGE_REQUEST,
      2,
      plan.turnTimeoutMs,
      false,
    );
    observations['turn3ChangeRequest'] = turn3;
    record('turn-3', { status: turn3.finalStatusText, tools: turn3.toolText });

    await click('read-files');
    await waitFor(
      'the file check to report',
      () => element('changed-count') !== null,
      120_000,
    );
    const changesText = rawTextOf('changes');
    const changedCount = Number.parseInt(textOf('changed-count'), 10);
    observations['workspaceChanges'] = {
      changedCountShownInWindow: textOf('changed-count'),
      addedCountShownInWindow: textOf('added-count'),
      mentionsTargetFile: changesText.includes('src/duration.ts'),
      panelText: changesText.replace(/\s+/g, ' ').trim(),
    };
    record('files', { changedCount, mentionsTarget: changesText.includes('src/duration.ts') });
    if (
      !Number.isFinite(changedCount) ||
      changedCount < 1 ||
      !changesText.includes('src/duration.ts')
    ) {
      failures.push(
        'the window did not show src/duration.ts as changed on disk after the ' +
          'change request',
      );
      return finish(CHAT_EXIT.fileNotChanged, steps, failures, observations);
    }

    // --- 7. The test again, with its output and exit code in the window -----
    const testAfter = await runTest('after the change');
    observations['testAfter'] = testAfter;
    record('test-after', testAfter);
    if (
      testBefore['exitCodeShown'] !== '1' ||
      testAfter['exitCodeShown'] !== '0' ||
      Number(testAfter['stdoutChars']) === 0
    ) {
      failures.push(
        'the window did not show a failing test before the change and a passing one ' +
          `after it: before="${String(testBefore['exitCodeShown'])}" ` +
          `after="${String(testAfter['exitCodeShown'])}"`,
      );
      return finish(CHAT_EXIT.testEvidenceMissing, steps, failures, observations);
    }

    // --- 8. Cancel during streaming, after the first finished tool call -----
    const turn4 = await runTurn(
      'cancelled',
      CANCEL_PROMPT,
      3,
      plan.turnTimeoutMs,
      true,
    );
    observations['turn4Cancelled'] = turn4;
    record('turn-4', {
      status: turn4.finalStatusText,
      cancelClickedAtMs: turn4.cancelClickedAtMs,
      toolsFinishedAtCancel: turn4.toolsFinishedAtCancel,
    });
    if (turn4.cancelClickedAtMs === null) {
      failures.push(
        'no tool call finished before the turn ended, so Cancel was never clicked ' +
          'during streaming. The discriminator was not exercised.',
      );
      return finish(CHAT_EXIT.cancelNotDemonstrated, steps, failures, observations);
    }
    if (turn4.finalStatusText !== 'cancelled') {
      failures.push(
        `Cancel was clicked during streaming but the window reported the turn as ` +
          `"${turn4.finalStatusText}" rather than cancelled`,
      );
      return finish(CHAT_EXIT.cancelNotDemonstrated, steps, failures, observations);
    }

    // --- 9. What happened after the cancellation ---------------------------
    // The watch itself is 90 s (see CANCEL_WATCH_MS), so the timeout has to leave
    // room for it. Too short a timeout here would turn a working watch into a
    // script failure.
    await waitFor(
      'the cancellation watch to finish',
      () => !textOf('cancel-verdict').startsWith('still watching'),
      180_000,
      1_000,
    );
    observations['afterCancel'] = {
      verdictShownInWindow: textOf('cancel-verdict'),
      watchedShownInWindow: textOf('cancel-watched'),
    };
    record('after-cancel', { verdict: textOf('cancel-verdict') });

    exitCode = CHAT_EXIT.ok;
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    exitCode = CHAT_EXIT.scriptFailed;
  }

  return finish(exitCode, steps, failures, observations);
}

/* ------------------------------------------------------------------------- */
/* DSP-80, second pass: how the light is distributed, on one forced node      */
/* ------------------------------------------------------------------------- */

/**
 * The corner in a line of samples, as the largest turn between neighbours.
 *
 * `turnDeg` is each sample's heading relative to the first, so a straight side is a run of
 * equal values and a corner is where they climb. Finding it by measurement rather than by
 * arithmetic on `nodeCornerRadius` is deliberate: the arithmetic would have to agree with
 * the browser's own idea of where the arc begins on a path it flattened itself, and the
 * whole point of the frame is to be sampled where the outline really turns.
 */
interface OutlineSample {
  readonly offsetFromLead: number;
  readonly turnDeg: number;
}

function corneringAt(samples: readonly OutlineSample[]): OutlineSample | null {
  let best: OutlineSample | null = null;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1] as OutlineSample;
    const current = samples[index] as OutlineSample;
    const turn = Math.abs(current.turnDeg - previous.turnDeg);
    if (best === null || turn > best.turnDeg) {
      best = { offsetFromLead: current.offsetFromLead, turnDeg: turn };
    }
  }
  return best;
}

/**
 * The longest run of samples the outline does not turn on, as a stretch of the outline.
 *
 * Found rather than reasoned about, and the first attempt shows why. Taking the corner and
 * adding half the outline to it looked like a sound way to land on a straight side and put
 * the frame *inside another corner*: a rectangle's corners are close to fifty units apart
 * in pairs, so on this shape "half a lap from a corner" is another corner. A run of samples
 * whose neighbours do not turn cannot make that mistake.
 *
 * Returned as the two path positions the run spans. The samples go *backwards* along the
 * outline, so `to` is the higher of the two positions and is the end a glint's leading edge
 * should be placed near: its tail then trails down toward `from` and stays inside the run.
 */
function longestStraightRun(
  samples: readonly OutlineSample[],
  scanFrom: number,
): { from: number; to: number; units: number } | null {
  const positionOf = (sample: OutlineSample): number =>
    (((scanFrom - sample.offsetFromLead) % 100) + 100) % 100;
  let best: { from: number; to: number; units: number } | null = null;
  let runStart = 0;
  for (let index = 1; index <= samples.length; index += 1) {
    const previous = samples[index - 1] as OutlineSample;
    const current = index === samples.length ? null : (samples[index] as OutlineSample);
    const turns = current !== null && Math.abs(current.turnDeg - previous.turnDeg) > 2;
    if (turns || current === null) {
      const units = previous.offsetFromLead - (samples[runStart] as OutlineSample).offsetFromLead;
      if (best === null || units > best.units) {
        best = {
          from: positionOf(previous),
          to: positionOf(samples[runStart] as OutlineSample),
          units: Math.round(units * 100) / 100,
        };
      }
      runStart = index;
    }
  }
  return best;
}

/**
 * How the glint and the pulse are drawn, read off two forced nodes and nothing else.
 *
 * **Why there is no run in it.** Niclas's instruction, and his reasoning: this pass changes
 * the distribution of light and no state rule, so a walk of a loop could not break anything
 * it might have proved. The previous version of this reading cost a session, a project and
 * minutes of canned replies to arrive at a node in the `active` state. `showLivenessForLook`
 * sends the same two announcements real callers send through the same `receiveRunEvent`, so
 * the drawing is the drawing a run produces, and the whole scenario takes seconds.
 *
 * **What it can and cannot establish.** Two things about this change genuinely need a
 * rendered window: whether the gradient's pieces can be seen as pieces — above all where
 * they cross a corner — and what reduced motion leaves behind. Everything else about the
 * ramp is arithmetic and is checked in `loop-liveness.test.ts`, where it can be stated
 * exactly instead of read off a screen.
 *
 * **Why the frames are frozen.** A moving glint is wherever it happens to be when the
 * shutter opens, which makes *this is the corner* unassertable. `freezeGlintAt` holds the
 * animation at the computed phase that puts the leading edge on a chosen point, so the two
 * captures below are a straight side and a corner by construction and the sample
 * coordinates handed out with them are still true when the picture is read.
 *
 * **Why the pixels are read elsewhere.** A renderer cannot see what it painted. The window
 * hands out screen coordinates along the outline, each labelled with its distance behind the
 * leading edge, and the harness that captured the frame samples the PNG. The gates here
 * check that the frame is worth sampling at all: enough points, a legible scale, and the
 * outline really turning in the frame that claims to cross a corner.
 */
async function runHowTheLivenessLooksScenario(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call, no run and no project. One graph is opened straight from a path ' +
      'and two states are forced through the same announcements a real caller sends, ' +
      'because this pass changes how the glint and the pulse are drawn and not when they ' +
      'are used. It establishes the pulse\u2019s range, its rhythm and its distance from ' +
      'the node\u2019s words; that reduced motion leaves a still marking; and where on a ' +
      'frozen outline to sample the glint, including across a corner. The pixel profile ' +
      'itself is read by the harness from the captured frames. It says nothing about ' +
      'whether the result is pleasant to look at, which is Niclas\u2019s to judge, and ' +
      'nothing about the state rules, which it does not touch.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  let exitCode: number = CHAT_EXIT.ok;

  try {
    const graphPath = plan.lookGraphPath;
    if (graphPath === undefined) {
      failures.push('no graph was named for the reading, so nothing was drawn to read.');
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    await goToEditor();
    const opened = await editorHook().openTarget({ kind: 'path', path: graphPath });
    record('graph-open', { ...opened, graphPath });
    if (opened.nodesDrawn === 0) {
      failures.push(`nothing was drawn from ${graphPath}, so there was nothing to read.`);
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }

    /*
     * --- The working node, at the zoom the gradient can be read at -----------
     *
     * The editor's own maximum. At the zoom it opens at, the finest pieces of the ramp are
     * under two screen pixels — which is a fact worth having and is asserted in the unit
     * tests, but it also makes a pixel profile taken there a reading of the screen's
     * resolution rather than of the light. `checkGlintFrameIsWorthReading` refuses a frame
     * sampled too small rather than letting one be reported as evidence.
     */
    await editorHook().setViewState(1.6, 0, 0);
    const forcedWorking = await editorHook().showLivenessForLook('working');

    if (forcedWorking === null) {
      failures.push('no node could be put into the working state, so the glint never ran.');
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    const workingId = forcedWorking.nodeId;
    /*
     * Into the middle of the drawing area, and the whole of it inside.
     *
     * At this zoom the canvas opens with the node in a corner and most of it behind the
     * inspector panel, which is how the first attempt came back with a profile of two bright
     * samples and thirteen units of dark — the reading of a glint that is too short, except
     * that what was too short was the visible node.
     */
    const placed = editorHook().centreNodeInCanvas(workingId);
    await sleep(120);
    record('centred', { nodeId: workingId, ...(placed ?? {}) });
    if (
      placed === null ||
      placed.nodeLeft < placed.canvasLeft + 8 ||
      placed.nodeRight > placed.canvasRight - 8 ||
      placed.nodeTop < placed.canvasTop + 8 ||
      placed.nodeBottom > placed.canvasBottom - 8
    ) {
      failures.push(
        'the working node could not be brought fully inside the drawing area at the zoom ' +
          'the gradient has to be read at, so any profile taken from it would be partly a ' +
          'reading of whatever is beside the canvas.',
      );
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    const insideTheCanvas = (x: number, y: number): boolean =>
      // Six pixels of margin, because the reader searches across the stroke and not only
      // along its centre line.
      x >= placed.canvasLeft + 6 &&
      x <= placed.canvasRight - 6 &&
      y >= placed.canvasTop + 6 &&
      y <= placed.canvasBottom - 6;
    const lit =
      editorHook()
        .readLiveness()
        .find((node) => node.id === workingId) ?? null;
    observations['workingNode'] = lit;
    record('forced-working', {
      nodeId: workingId,
      state: lit?.state ?? '',
      working: lit?.working ?? false,
      glintsLit: lit?.glintsLit ?? 0,
      animations: lit?.animations ?? 0,
    });
    if (lit === null || !lit.working || lit.glintsLit < 2) {
      failures.push(
        `the node forced into the working state was drawn with ${String(
          lit?.glintsLit ?? 0,
        )} lit pieces of gradient and working=${String(lit?.working ?? false)}. There is ` +
          'nothing to read the light off.',
      );
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }

    /*
     * --- Where the outline turns --------------------------------------------
     *
     * One scan of the whole perimeter to find a corner, then two frames: one with the
     * glint's bright end on a straight side, one with it two units past the corner so that
     * the leading edge, the peak and the near tail all lie across the turn. Two units
     * because that is where the gradient is steepest, and a gradient assembled from pieces
     * held apart by their phase would come apart there first.
     */
    const scan = await editorHook().freezeGlintAt(workingId, 0, 99.75, 0, 0.25);
    const corner = scan === null ? null : corneringAt(scan.samples);
    const straight = scan === null ? null : longestStraightRun(scan.samples, 0);
    if (scan === null || corner === null || straight === null) {
      failures.push('the glint could not be held still, so no frame of it could be read.');
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    const cornerAt = ((0 - corner.offsetFromLead) % 100 + 100) % 100;
    record('found-a-corner', {
      cornerAt: Math.round(cornerAt * 100) / 100,
      turnDeg: Math.round(corner.turnDeg * 10) / 10,
      straightRun: straight,
      screenPixelsPerUnit: scan.screenPixelsPerUnit,
    });
    // 17.5 units of glint, 2.5 sampled in front of the leading edge, and a unit of margin
    // at each end. The first attempt allowed only one unit in front and the frame's leading
    // samples fell inside the next corner.
    if (straight.units < 22) {
      failures.push(
        `the longest stretch of outline that does not turn is ${String(straight.units)} units, ` +
          'and the glint is 15 of them. There is nowhere on this node to read the gradient ' +
          'away from a corner, so the two frames cannot be compared.',
      );
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }

    const frames: unknown[] = [];
    for (const [label, leadAt, acrossACorner] of [
      // Far enough inside the upper end of that stretch that the 2.5 units sampled *in
      // front* of the leading edge are inside it too; the tail trails backwards along the
      // outline, toward the run's other end, and is shorter than the stretch.
      ['straight', (straight.to - 3.5 + 100) % 100, false],
      // Two units past the corner, so the leading edge, the peak and the near tail all lie
      // across the turn. That is where the light changes fastest and where a gradient made
      // of pieces held apart by their phase would come apart first.
      ['corner', (cornerAt + 2) % 100, true],
    ] as const) {
      const frozen = await editorHook().freezeGlintAt(workingId, leadAt, 17.5, 2.5, 0.15);
      if (frozen === null) {
        failures.push(`the glint could not be held still for the "${label}" frame.`);
        continue;
      }
      await window.dspatch.captureWindow(`liveness-look-glint-${label}`);
      /*
       * The same frame with the glint moved half a lap away, and it is what makes the
       * reading possible at all.
       *
       * The first attempt measured each sample against the page behind the node and found
       * the whole outline lit: of course it did — an active node's border is a bright green
       * stroke on that exact path, with the halo over it, so the glint was being measured on
       * top of a floor that is already most of the signal. Differencing two frames of a
       * window in which *nothing else moves* leaves precisely the glint: same border, same
       * halo, same label, same background, one object in a different place. Half a lap is
       * more than twice the glint's length, so nothing of it reaches the sampled span.
       */
      const reference = await editorHook().freezeGlintAt(
        workingId,
        (leadAt + 50) % 100,
        17.5,
        2.5,
        0.15,
      );
      await window.dspatch.captureWindow(`liveness-look-glint-${label}-ref`);
      if (reference === null) {
        failures.push(`no reference frame could be taken for "${label}".`);
        continue;
      }
      const first = frozen.samples[0];
      const last = frozen.samples[frozen.samples.length - 1];
      const turn =
        first === undefined || last === undefined ? 0 : last.turnDeg - first.turnDeg;
      const frame = {
        label,
        leadAt: Math.round(leadAt * 100) / 100,
        acrossACorner,
        turnAcrossSpanDeg: Math.round(turn * 10) / 10,
        screenPixelsPerUnit: frozen.screenPixelsPerUnit,
        frozenAtMs: frozen.frozenAtMs,
        devicePixelRatio: frozen.devicePixelRatio,
        viewportWidth: frozen.viewportWidth,
        viewportHeight: frozen.viewportHeight,
        capture: `liveness-look-glint-${label}`,
        reference: `liveness-look-glint-${label}-ref`,
        samples: frozen.samples,
      };
      frames.push(frame);
      const verdict = checkGlintFrameIsWorthReading({
        label,
        leadAt,
        turnAcrossSpanDeg: frame.turnAcrossSpanDeg,
        screenPixelsPerUnit: frozen.screenPixelsPerUnit,
        samples: frozen.samples.length,
        samplesOffTheCanvas: frozen.samples.filter(
          (sample) => !insideTheCanvas(sample.x, sample.y),
        ).length,
        acrossACorner,
      });
      if (verdict.failure !== null) {
        failures.push(verdict.failure);
      }
      record(`glint-frame-${label}`, {
        leadAt: frame.leadAt,
        turnAcrossSpanDeg: frame.turnAcrossSpanDeg,
        samples: frozen.samples.length,
      });
    }
    observations['glintFrames'] = frames;

    /*
     * --- Reduced motion, on the node that is working ------------------------
     *
     * Emulated through the main process, because a media query cannot be set from a
     * document. Read before and after: a reading taken only afterwards could not tell a
     * preference being honoured from a node that was never animating.
     *
     * The frames above left everything on this node paused, so it is started again first.
     * Without that, both readings would be of a still node and the gate would pass whatever
     * the stylesheet did with the preference — which is the shape of the fault the
     * stylesheet actually had, and it would have been a poor way to miss it twice.
     */
    const resumed = editorHook().resumeLivenessMotion(workingId);
    await sleep(120);
    const ordinaryMotion =
      editorHook()
        .readLiveness()
        .find((node) => node.id === workingId) ?? null;
    if (ordinaryMotion === null || ordinaryMotion.animations === 0) {
      failures.push(
        `the working node's ${String(resumed)} animations did not start again after the ` +
          'frames were frozen, so what reduced motion does was read on a node that was ' +
          'already still. That reading would have passed whatever the stylesheet did.',
      );
    }
    const emulated = await window.dspatch.emulateReducedMotion(true);
    await sleep(400);
    const reducedMotion =
      editorHook()
        .readLiveness()
        .find((node) => node.id === workingId) ?? null;
    observations['reducedMotion'] = { emulated, ordinary: ordinaryMotion, reduced: reducedMotion };
    record('reduced-motion', {
      emulated,
      resumed,
      animationsBefore: ordinaryMotion?.animations ?? 0,
      animationsAfter: reducedMotion?.animations ?? 0,
      glintsLitAfter: reducedMotion?.glintsLit ?? 0,
      haloOpacityAfter: reducedMotion?.haloOpacity ?? 0,
    });
    await window.dspatch.captureWindow('liveness-look-reduced-motion');
    const reducedVerdict = checkReducedMotionIsStill({
      emulated,
      ordinary: ordinaryMotion,
      reduced: reducedMotion,
    });
    if (reducedVerdict.failure !== null) {
      failures.push(reducedVerdict.failure);
    }
    await window.dspatch.emulateReducedMotion(false);
    await sleep(300);

    /*
     * --- The ready node's pulse ---------------------------------------------
     *
     * A second reading rather than a second node, and that is the state rule rather than a
     * limit of the trial: Ready means a loop chosen and nothing run yet, so it cannot be on
     * the drawing at the same moment as a run in flight. The pulse is read at both of its
     * extremes and a picture is taken at each, so the difference Niclas asked to be widened
     * is on record as two numbers and two frames.
     */
    const forcedReady = await editorHook().showLivenessForLook('ready');
    if (forcedReady === null) {
      failures.push('the entry step could not be put into the ready state.');
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    await sleep(200);
    const readyId = forcedReady.nodeId;
    const readyNode =
      editorHook()
        .readLiveness()
        .find((node) => node.id === readyId) ?? null;
    const weakest = editorHook().readPulseExtremes(readyId, 0);
    await window.dspatch.captureWindow('liveness-look-pulse-weakest');
    const strongest = editorHook().readPulseExtremes(readyId, 0.5);
    await window.dspatch.captureWindow('liveness-look-pulse-strongest');
    if (weakest === null || strongest === null) {
      failures.push('the pulse could not be read on the ready node.');
      return finish(CHAT_EXIT.theLightIsWrong, steps, failures, observations);
    }
    const pulse = { label: 'ready', ...strongest };
    observations['pulse'] = {
      ...pulse,
      readyState: readyNode?.state ?? '',
      // Both readings are of the same stylesheet, so they must agree. If they did not, one
      // of them was taken while something else was still changing the opacity.
      agreedBetweenReadings:
        weakest.haloPeak === strongest.haloPeak && weakest.haloTrough === strongest.haloTrough,
      rangeBefore: PULSE_RANGE_BEFORE,
      rangeNow: Math.round((strongest.haloPeak - strongest.haloTrough) * 1000) / 1000,
    };
    record('pulse', {
      nodeId: readyId,
      state: readyNode?.state ?? '',
      haloTrough: strongest.haloTrough,
      haloPeak: strongest.haloPeak,
      haloDurationMs: strongest.haloDurationMs,
      labelClearanceUnits: strongest.labelClearanceUnits,
    });
    const pulseVerdict = checkPulseCarriesFurther(pulse);
    if (pulseVerdict.failure !== null) {
      failures.push(pulseVerdict.failure);
    }
    if (readyNode === null || readyNode.state !== 'ready') {
      failures.push(
        `the entry step was marked "${readyNode?.state ?? 'nothing at all'}" rather than ` +
          'ready, so the pulse that was measured is not the Ready pulse.',
      );
    }

    if (failures.length > 0) {
      exitCode = CHAT_EXIT.theLightIsWrong;
    }
  } catch (error) {
    failures.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    exitCode = CHAT_EXIT.scriptFailed;
  }

  return finish(exitCode, steps, failures, observations);
}

/* ------------------------------------------------------------------------- */
/* Saved conversations switched between, and a restart: DSP-4 WS-1           */
/* ------------------------------------------------------------------------- */

/**
 * Saved conversations switched between in one window, and read back after a restart.
 *
 * Over the kit `scripts/seed-switch-kit.mjs` writes: A (3 messages, a passing test),
 * B (1 message, a reviewed diff of `src/greet.js`, a failing test), X and X-sub (each
 * one command attempt left running under the same ID, `dsp-attempt-0001`). Phase
 * `first` opens A, B and A again, reads X and X-sub back, and acknowledges both
 * attempts through the command gate in X-sub; phase `again` is a second process over
 * the same user data and checks that each conversation came back as its own.
 *
 * No provider call: the presentation adapter lets a session open and nothing is sent
 * to it. The saved test verdict and the reviewed diff are read in the restored
 * conversation panel, because the live panels draw only what this session did — see
 * `limits` in the record. Every reading is what the DOM showed; the main process
 * records what the files held, apart from this.
 */
async function runWorkspaceSwitchScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.switchPhase ?? 'first';
  const [projectA, projectB, projectX, projectXSub] = plan.switchProjects ?? [];
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'No provider call was made. Sessions were opened on the local presentation ' +
      'adapter, which resumes any session it is asked to, so the continuity statement ' +
      'is recorded and not judged: what a real provider does with a seeded session is ' +
      'not evidenced here. Nothing was sent, so no turn of this run’s own was saved. ' +
      'The saved test verdicts and the reviewed diff were read in the restored ' +
      'conversation panel ("Read this back"); the live test panel after opening a ' +
      'project showed only what this session ran. The save-error lines were recorded ' +
      'and not provoked: the window has no scripted seam that makes a file unwritable, ' +
      'and none was built.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  // Each expectation group has a code of its own; the lowest failed one is the exit.
  const failed = new Set<number>();
  const expect = (code: number, ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
      failed.add(code);
    }
  };
  const samePath = (left: string, right: string): boolean =>
    left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase();
  const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();

  /** The index of the row whose `<prefix>-<n><suffix>` element names `target`. */
  const rowOf = (prefix: string, suffix: string, target: string): number | null => {
    for (let index = 0; index < 50; index += 1) {
      const found = element(`${prefix}-${String(index)}${suffix}`);
      if (found === null) {
        return null;
      }
      if (samePath(clean(found.textContent), target)) {
        return index;
      }
    }
    return null;
  };
  const promptsUnder = (prefix: string): string[] => {
    const prompts: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const found = element(`${prefix}-${String(index)}-prompt`);
      if (found === null) {
        break;
      }
      prompts.push(clean(found.textContent));
    }
    return prompts;
  };
  const otherSaveErrors = (): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-ev="save-error-other"]')].map((node) =>
      clean(node.textContent),
    );
  const attemptRows = (): Record<string, string>[] => {
    const rows: Record<string, string>[] = [];
    for (let index = 0; index < 50; index += 1) {
      if (element(`attempt-${String(index)}`) === null) {
        break;
      }
      const at = `attempt-${String(index)}`;
      rows.push({
        id: textOf(`${at}-id`),
        state: textOf(`${at}-state`),
        // The head names the kind ("command: …" or "message: …") beside the badge.
        head: clean(element(at)?.querySelector('.attempt__head')?.textContent ?? null),
        reason: textOf(`${at}-reason`),
        alsoNamed: textOf(`${at}-also-named`),
        actionNote: textOf(`${at}-action-note`),
        action: textOf(`${at}-action`),
      });
    }
    return rows;
  };
  const diffPathsInside = (name: string): string[] => {
    const container = element(name);
    if (container === null) {
      return [];
    }
    return [...container.querySelectorAll<HTMLElement>('[data-ev]')]
      .filter((node) => /^diff-\d+-path$/.test(node.getAttribute('data-ev') ?? ''))
      .map((node) => clean(node.textContent));
  };

  /**
   * The chooser with Recent and the saved conversations, which is on screen while no
   * project is open and otherwise behind File → Open another project. The menu bar is
   * native, so the item is pressed through the scripted-run seam, as a person presses it.
   */
  const showChooser = async (why: string): Promise<void> => {
    if (element('projects') !== null) {
      return;
    }
    const pressed = await window.dspatch.pressMenuItem('change-project');
    record('pressed Open another project', { why, menuItemExisted: pressed });
    await waitFor(`the project chooser (${why})`, () => element('projects') !== null, 10_000);
  };

  /** Open a seeded project from Recent and read what the window drew for it. */
  const openProject = async (label: string, target: string): Promise<Record<string, unknown>> => {
    await showChooser(`to open ${label}`);
    await waitFor(
      `${label} to be offered in Recent`,
      () => rowOf('project', '-path', target) !== null,
      60_000,
    );
    const previousSession = textOf('session-id');
    await click(`open-project-${String(rowOf('project', '-path', target) ?? 0)}`);
    await waitFor(
      `a session over ${label}`,
      () =>
        textOf('session-id').startsWith('dsp-session-') &&
        textOf('session-id') !== previousSession &&
        samePath(attributeOf('project-path', 'title'), target),
      60_000,
    );
    // The save status is polled every 3 s: a line that was going to appear has had time to.
    await sleep(3_500);
    const prompts = promptsUnder('history-turn');
    const reading = {
      label,
      conversationShownInWindow: textOf('conversation-id'),
      sessionShownInWindow: textOf('session-id'),
      projectShownInWindow: attributeOf('project-path', 'title'),
      historyTurnsShownInWindow: prompts.length,
      historyPromptsShownInWindow: prompts,
      historyErrorShownInWindow: textOf('history-error'),
      // The service's statement, from the diagnostics in the details (DSP-121 flow).
      continuityShownInWindow: textOf('diagnostics-statement'),
      liveTestStatusShownInWindow: textOf('test-status'),
      liveTestResultShownInWindow: textOf('test-result'),
      saveErrorShownInWindow: textOf('save-error'),
      otherSaveErrorsShownInWindow: otherSaveErrors(),
    };
    record(`opened ${label}`, reading);
    return reading;
  };

  /** "Read this back" on a saved conversation, and what the restored panel drew. */
  const readBack = async (label: string, target: string): Promise<Record<string, unknown>> => {
    // DSP-149: saved conversations are in the history view, from the menu.
    if (element('history') === null) {
      await window.dspatch.pressMenuItem('show-history');
      await waitFor(`the history view (to read ${label} back)`, () => element('history') !== null, 10_000);
    }
    await waitFor(
      `${label} to be listed among the saved conversations`,
      () => rowOf('conversation-project', '', target) !== null,
      60_000,
    );
    const previousRestored = textOf('restored-id');
    await click(`resume-${String(rowOf('conversation-project', '', target) ?? 0)}`);
    await waitFor(
      `${label} to be read back`,
      () =>
        element('restored') !== null &&
        textOf('restored-id') !== previousRestored &&
        samePath(textOf('restored-project'), target),
      60_000,
    );
    // The execution-state rows are re-read after the restore; give that one poll.
    await sleep(1_000);
    const prompts = promptsUnder('restored-turn');
    const reading = {
      label,
      conversationShownInWindow: textOf('restored-id'),
      projectShownInWindow: textOf('restored-project'),
      messagesShownInWindow: prompts.length,
      promptsShownInWindow: prompts,
      testPresentedShownInWindow: textOf('restored-test-presented'),
      testStatusShownInWindow: textOf('restored-test-status'),
      diffNoteShownInWindow: textOf('restored-diff-note'),
      diffPathsShownInWindow: diffPathsInside('restored'),
      errorShownInWindow: textOf('restored-error'),
      statementShownInWindow: textOf('restored-statement'),
      attemptRowsShownInWindow: attemptRows(),
    };
    record(`read back ${label}`, reading);
    return reading;
  };

  /** Type the command and read the gate, without running anything. */
  const typeCommand = async (): Promise<Record<string, unknown>> => {
    const command =
      plan.nodePath === null ? 'node -e "process.exit(0)"' : `"${plan.nodePath}" -e "process.exit(0)"`;
    await typeIntoField('test-command-input', command);
    // The gate is drawn from the run state, which is re-read as the session opens.
    await sleep(1_500);
    // The gate's sentence, apart from the button under it, which names the same attempts.
    const gate = clean(element('run-needs-acknowledgement')?.querySelector('p')?.textContent ?? null);
    const reading = {
      commandTyped: command,
      gateShownInWindow: gate,
      qualifiedLabelsInGate: gate.split('dsp-attempt-0001 (conversation ').length - 1,
      runAnywayShownInWindow: textOf('run-anyway'),
      runItDisabled: (element('run-test') as HTMLButtonElement | null)?.disabled ?? null,
      unresolvedShownInWindow: textOf('unresolved-attempts'),
      attemptRowsShownInWindow: attemptRows(),
    };
    record('typed the command', reading);
    return reading;
  };

  const promptsOf = (reading: Record<string, unknown>, key: string): string[] =>
    Array.isArray(reading[key]) ? (reading[key] as string[]) : [];

  try {
    if (
      projectA === undefined ||
      projectB === undefined ||
      projectX === undefined ||
      projectXSub === undefined
    ) {
      throw new Error(
        'DSPATCH_CHAT_SWITCH_PROJECTS must name the seeded projects A, B, X and X-sub, ' +
          'separated by ";". The seed script prints them.',
      );
    }
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor('the Recent list', () => element('project-0-path') !== null, 60_000);
    const recent: string[] = [];
    for (let index = 0; index < 50; index += 1) {
      const found = element(`project-${String(index)}-path`);
      if (found === null) {
        break;
      }
      recent.push(clean(found.textContent));
    }
    record('recent', { recentShownInWindow: recent });
    for (const [name, target] of [
      ['A', projectA],
      ['B', projectB],
      ['X', projectX],
      ['X-sub', projectXSub],
    ] as const) {
      expect(
        CHAT_EXIT.switchHistoryWrong,
        recent.some((entry) => samePath(entry, target)),
        `${name} (${target}) is not in the Recent list: ${recent.join(' | ')}`,
      );
    }

    if (phase === 'first') {
      // --- A, then B, then A again ------------------------------------------
      const a1 = await openProject('A', projectA);
      expect(
        CHAT_EXIT.switchHistoryWrong,
        a1['historyTurnsShownInWindow'] === 3,
        `A opened with ${String(a1['historyTurnsShownInWindow'])} earlier messages, not 3`,
      );
      await window.dspatch.captureWindow('first-a-opened');

      // --- One message in A, answered by the local adapter: this run's own turn -----
      // The one thing the seeded files cannot show is a turn of this run surviving a
      // switch and a restart (WS-1 #7 "open A and send", #10). No provider: the
      // presentation adapter answers it.
      const sentInA = `Switch check ${newNonce()}: reply with anything.`;
      await sendAndSettle(0, sentInA, plan.turnTimeoutMs);
      await sleep(3_500);
      const afterSend = {
        sentPrompt: sentInA,
        turnStatusShownInWindow: statusOfTurn(0),
        continuityShownInWindow: textOf('diagnostics-statement'),
        saveErrorShownInWindow: textOf('save-error'),
        otherSaveErrorsShownInWindow: otherSaveErrors(),
      };
      record('sent in A', afterSend);
      expect(
        CHAT_EXIT.switchHistoryWrong,
        afterSend.saveErrorShownInWindow === '' && afterSend.otherSaveErrorsShownInWindow.length === 0,
        `a save failed after the message in A: ${afterSend.saveErrorShownInWindow} ${afterSend.otherSaveErrorsShownInWindow.join(' | ')}`,
      );
      const aPrompts = [...promptsOf(a1, 'historyPromptsShownInWindow'), sentInA];

      const b1 = await openProject('B', projectB);
      expect(
        CHAT_EXIT.switchHistoryWrong,
        b1['historyTurnsShownInWindow'] === 1,
        `B opened with ${String(b1['historyTurnsShownInWindow'])} earlier messages, not 1`,
      );
      expect(
        CHAT_EXIT.switchHistoryWrong,
        !promptsOf(b1, 'historyPromptsShownInWindow').some((prompt) => aPrompts.includes(prompt)),
        'a message of A was drawn in B',
      );

      const bRead = await readBack('B', projectB);
      expect(
        CHAT_EXIT.switchHistoryWrong,
        bRead['messagesShownInWindow'] === 1 && bRead['testPresentedShownInWindow'] === 'failed',
        `B read back as ${String(bRead['messagesShownInWindow'])} messages and test "${String(
          bRead['testPresentedShownInWindow'],
        )}", not 1 and "failed"`,
      );
      expect(
        CHAT_EXIT.switchDiffWrong,
        promptsOf(bRead, 'diffPathsShownInWindow').includes('src/greet.js'),
        `B's reviewed diff does not name src/greet.js: ${promptsOf(bRead, 'diffPathsShownInWindow').join(', ')}`,
      );
      await window.dspatch.captureWindow('first-b-read-back');

      const a2 = await openProject('A again', projectA);
      // The three seeded prompts in order, and this run's own message last.
      expect(
        CHAT_EXIT.switchHistoryWrong,
        a2['historyTurnsShownInWindow'] === 4 &&
          JSON.stringify(promptsOf(a2, 'historyPromptsShownInWindow')) === JSON.stringify(aPrompts),
        `A reopened with ${String(a2['historyTurnsShownInWindow'])} earlier messages, not the ` +
          `seeded 3 plus the one sent: ${promptsOf(a2, 'historyPromptsShownInWindow').join(' | ')}`,
      );
      expect(
        CHAT_EXIT.switchHistoryWrong,
        !/failed/i.test(String(a2['liveTestStatusShownInWindow'])),
        `A reopened showing a failed test: ${String(a2['liveTestStatusShownInWindow'])}`,
      );
      const aDiff = await readDiff('A again');
      expect(
        CHAT_EXIT.switchDiffWrong,
        !promptsOf(aDiff, 'pathsShownInWindow').includes('src/greet.js'),
        `A's diff names B's file: ${promptsOf(aDiff, 'pathsShownInWindow').join(', ')}`,
      );
      const aRead = await readBack('A again', projectA);
      expect(
        CHAT_EXIT.switchHistoryWrong,
        aRead['messagesShownInWindow'] === 4 &&
          promptsOf(aRead, 'promptsShownInWindow').at(-1) === sentInA &&
          aRead['testPresentedShownInWindow'] === 'passed',
        `A read back as ${String(aRead['messagesShownInWindow'])} messages and test "${String(
          aRead['testPresentedShownInWindow'],
        )}", not 4 (the sent one last) and "passed"`,
      );
      expect(
        CHAT_EXIT.switchDiffWrong,
        !promptsOf(aRead, 'diffPathsShownInWindow').includes('src/greet.js'),
        `A's saved diff names B's file: ${promptsOf(aRead, 'diffPathsShownInWindow').join(', ')}`,
      );

      // --- X and X-sub: one ID, two conversations -----------------------------
      const xRead = await readBack('X', projectX);
      const xSubRead = await readBack('X-sub', projectXSub);
      const rows = attemptRows().filter((row) => row.id === 'dsp-attempt-0001');
      expect(
        CHAT_EXIT.switchSharedIdWrong,
        rows.length === 2,
        `${String(rows.length)} rows carry dsp-attempt-0001 after reading X and X-sub back, not 2`,
      );
      for (const row of rows) {
        expect(
          CHAT_EXIT.switchSharedIdWrong,
          /outcome unknown/i.test(row['state'] ?? ''),
          `a dsp-attempt-0001 row reads "${row['state'] ?? ''}", not "outcome unknown"`,
        );
        expect(
          CHAT_EXIT.switchSharedIdWrong,
          /last saved record of this conversation shows this as still going/.test(row['reason'] ?? ''),
          `a dsp-attempt-0001 row does not carry the restart text: ${row['reason'] ?? ''}`,
        );
        if ((row['alsoNamed'] ?? '') !== '') {
          expect(
            CHAT_EXIT.switchSharedIdWrong,
            /dsp-attempt-0001 \(conversation dsp-conv-/.test(row['alsoNamed'] ?? ''),
            `the "also named" note does not qualify the other attempt: ${row['alsoNamed'] ?? ''}`,
          );
        }
      }
      record('shared id', {
        xConversation: xRead['conversationShownInWindow'],
        xSubConversation: xSubRead['conversationShownInWindow'],
        rowsShownInWindow: rows,
      });
      await window.dspatch.captureWindow('first-shared-id');

      // --- The command gate in X-sub, and Run again -----------------------------
      const xSub = await openProject('X-sub', projectXSub);
      const gate = await typeCommand();
      expect(
        CHAT_EXIT.switchSharedIdWrong,
        gate['qualifiedLabelsInGate'] === 2,
        `the gate names ${String(gate['qualifiedLabelsInGate'])} qualified attempts, not 2: ${String(
          gate['gateShownInWindow'],
        )}`,
      );
      for (const id of [xRead['conversationShownInWindow'], xSubRead['conversationShownInWindow']]) {
        expect(
          CHAT_EXIT.switchSharedIdWrong,
          String(gate['gateShownInWindow']).includes(`(conversation ${String(id)})`),
          `the gate does not name ${String(id)}: ${String(gate['gateShownInWindow'])}`,
        );
      }
      expect(
        CHAT_EXIT.switchSharedIdWrong,
        gate['runItDisabled'] === true,
        'the plain Run it button is enabled while two attempts have no known outcome',
      );
      expect(
        CHAT_EXIT.switchSharedIdWrong,
        String(gate['runAnywayShownInWindow']).startsWith('Run again, leaving all 2 unresolved'),
        `the acknowledging button reads "${String(gate['runAnywayShownInWindow'])}"`,
      );
      await window.dspatch.captureWindow('first-gate');

      await click('run-anyway');
      await waitFor(
        'the acknowledged command to start',
        () => element('test-pending') !== null || element('test-status') !== null,
        30_000,
      );
      await waitFor('the acknowledged command to end', () => element('test-pending') === null, 120_000, 200);
      // One more poll of the save status, so a failed save of either file is on screen.
      await sleep(3_500);
      const afterRun = {
        testStatusShownInWindow: textOf('test-status'),
        testStatusKindShownInWindow: textOf('test-status-kind'),
        testVerdictShownInWindow: textOf('test-verdict'),
        testErrorShownInWindow: textOf('test-error'),
        gateShownInWindow: textOf('run-needs-acknowledgement'),
        saveErrorShownInWindow: textOf('save-error'),
        otherSaveErrorsShownInWindow: otherSaveErrors(),
        attemptRowsShownInWindow: attemptRows(),
        sessionShownInWindow: xSub['sessionShownInWindow'],
      };
      record('ran again', afterRun);
      expect(
        CHAT_EXIT.switchRunAgainFailed,
        afterRun.testStatusKindShownInWindow === 'passed',
        `the acknowledged command did not pass: "${afterRun.testStatusShownInWindow}" ${afterRun.testErrorShownInWindow}`,
      );
      expect(
        CHAT_EXIT.switchRunAgainFailed,
        afterRun.saveErrorShownInWindow === '' && afterRun.otherSaveErrorsShownInWindow.length === 0,
        `a save failed: ${afterRun.saveErrorShownInWindow} ${afterRun.otherSaveErrorsShownInWindow.join(' | ')}`,
      );
      await window.dspatch.captureWindow('first-after-run');
    } else {
      // --- The restart: the same user data, a second process ---------------------
      // Phase first sent one message in A, so A is the seeded three plus that one.
      const a = await openProject('A', projectA);
      expect(
        CHAT_EXIT.switchRestartWrong,
        a['historyTurnsShownInWindow'] === 4,
        `after the restart A opened with ${String(a['historyTurnsShownInWindow'])} earlier messages, not 4`,
      );
      const aRead = await readBack('A', projectA);
      expect(
        CHAT_EXIT.switchRestartWrong,
        aRead['messagesShownInWindow'] === 4 && aRead['testPresentedShownInWindow'] === 'passed',
        `after the restart A read back as ${String(aRead['messagesShownInWindow'])} messages and test "${String(
          aRead['testPresentedShownInWindow'],
        )}", not 4 and "passed"`,
      );
      await window.dspatch.captureWindow('again-a-read-back');

      await openProject('X-sub', projectXSub);
      const gate = await typeCommand();
      expect(
        CHAT_EXIT.switchRestartWrong,
        gate['gateShownInWindow'] === '' && gate['runItDisabled'] === false,
        `after the restart X-sub still gates the command: "${String(gate['gateShownInWindow'])}" (Run it disabled=${String(
          gate['runItDisabled'],
        )})`,
      );
      await window.dspatch.captureWindow('again-x-sub-gate');
      // The acknowledged run of phase first, as the file has it: a passed command and a
      // completed command attempt beside the acknowledged one (WS-1 #8, #12).
      const xSubRead = await readBack('X-sub', projectXSub);
      const completedCommands = (
        xSubRead['attemptRowsShownInWindow'] as Record<string, string>[]
      ).filter((row) => /^completed$/i.test(row['state'] ?? '') && /command:/.test(row['head'] ?? ''));
      expect(
        CHAT_EXIT.switchRestartWrong,
        xSubRead['testPresentedShownInWindow'] === 'passed' && completedCommands.length >= 1,
        `after the restart X-sub read back with test "${String(
          xSubRead['testPresentedShownInWindow'],
        )}" and ${String(completedCommands.length)} completed command attempt rows, not "passed" and at least 1`,
      );
      await window.dspatch.captureWindow('again-x-sub-read-back');

      const b = await openProject('B', projectB);
      expect(
        CHAT_EXIT.switchRestartWrong,
        b['historyTurnsShownInWindow'] === 1,
        `after the restart B opened with ${String(b['historyTurnsShownInWindow'])} earlier messages, not 1`,
      );
      const bRead = await readBack('B', projectB);
      expect(
        CHAT_EXIT.switchRestartWrong,
        bRead['messagesShownInWindow'] === 1 &&
          bRead['testPresentedShownInWindow'] === 'failed' &&
          promptsOf(bRead, 'diffPathsShownInWindow').includes('src/greet.js'),
        `after the restart B read back as ${String(bRead['messagesShownInWindow'])} messages, test "${String(
          bRead['testPresentedShownInWindow'],
        )}", diff ${promptsOf(bRead, 'diffPathsShownInWindow').join(', ')}`,
      );
      await window.dspatch.captureWindow('again-b-read-back');
    }

    const code =
      failures.length === 0
        ? CHAT_EXIT.ok
        : failed.size === 0
          ? CHAT_EXIT.scriptFailed
          : Math.min(...failed);
    return finish(code, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* The refused or failed resume, and the way forward: DSP-121                 */
/* ------------------------------------------------------------------------- */

/**
 * The refused or failed resume state, through the real panel (DSP-121).
 *
 * Over the same kit as `workspace-switch`, opening project A, whose stored session the
 * presentation adapter has been told to refuse or fail (`DSPATCH_CHAT_RESUME`). What
 * is read is what the window drew: the compact panel by the composer with its heading,
 * its one line and exactly the offered buttons; the conversation itself, with no
 * introduction above it; the history scrolled with a draft kept and the way forward
 * still in view, and Enter holding the draft back with a note that names that way;
 * the diagnostics in the session details, reached only through the panel's *Details*
 * entry, copied and closed again; *Try again*; and a new session with its summary
 * kept (`failed`) or removed (`refused`), and one message. The main process records,
 * beside this, what the conversation file held, what reached the adapter and what was
 * copied at each of those moments, and judges it (`resumeChoiceChecks`).
 *
 * **Everything refused or failed here is simulated by the presentation adapter.**
 * No provider is asked anything. The run shows what the window does with a refusal
 * or a failure, and nothing about whether any provider would give one.
 *
 * Hold mode (`resumeHold`): the open and the reading at rest, then the hand-over check
 * and the report - before any click, focus change, width change or disclosure, so the
 * window a person is handed is the window a person would meet. Niclas found the
 * details open in a handed-over window on 24 October 2026; the cause was this
 * scenario, which used to open them, focus a help summary and narrow the window
 * before it returned.
 */
async function runResumeChoiceScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const mode = plan.resumeMode ?? 'ok';
  const hold = plan.resumeHold === true;
  const projectA = plan.switchProjects?.[0];
  // Read before anything else, so "the window at its normal width" means the width it
  // opened at rather than whatever a step left behind.
  const widthAtStart = window.outerWidth;
  const observations: Record<string, unknown> = {
    plan,
    mode,
    hold,
    widthAtStart,
    limits:
      'SIMULATED. The refusal or failure shown was the presentation adapter\'s own answer, ' +
      'chosen by DSPATCH_CHAT_RESUME; no provider was asked anything, and nothing here says ' +
      'what any provider would do with this session. The one message sent after choosing a ' +
      'new session was answered by the same local adapter. What is evidenced is the window\'s ' +
      'behaviour in these states and, in the main process\'s half of the record, what the ' +
      'conversation file held, what reached the adapter and what was copied at each step.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const failed = new Set<number>();
  const expect = (code: number, ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
      failed.add(code);
    }
  };
  const samePath = (left: string, right: string): boolean =>
    left.replace(/[\\/]+$/, '').toLowerCase() === right.replace(/[\\/]+$/, '').toLowerCase();
  const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
  const rowOf = (target: string): number | null => {
    for (let index = 0; index < 50; index += 1) {
      const found = element(`project-${String(index)}-path`);
      if (found === null) {
        return null;
      }
      if (samePath(clean(found.textContent), target)) {
        return index;
      }
    }
    return null;
  };
  const historyPrompts = (): string[] => {
    const prompts: string[] = [];
    for (let index = 0; index < 200; index += 1) {
      const found = element(`history-turn-${String(index)}-prompt`);
      if (found === null) {
        break;
      }
      prompts.push(clean(found.textContent));
    }
    return prompts;
  };
  /** The choice buttons inside the panel, by label, in document order. */
  const panelButtonLabels = (): string[] =>
    [
      ...(element('continuity-choices')?.querySelectorAll<HTMLButtonElement>(
        'button[data-ev^="continuity-choice-"]',
      ) ?? []),
    ].map((button) => clean(button.textContent));
  const composerText = (): string => (element('prompt') as HTMLTextAreaElement | null)?.value ?? '';
  const detailsViewOpen = (): boolean => attributeOf('session-details-view', 'data-open') === 'true';
  const focusName = (): string | null => {
    const active = document.activeElement;
    return active === null ? null : (active.getAttribute('data-ev') ?? active.tagName.toLowerCase());
  };
  /** Whether an element has a box inside the viewport, horizontally and vertically. */
  const visibleInViewport = (name: string): boolean => {
    const found = element(name);
    if (found === null) {
      return false;
    }
    const box = found.getBoundingClientRect();
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.left >= 0 &&
      box.right <= window.innerWidth &&
      box.top >= 0 &&
      box.bottom <= window.innerHeight
    );
  };
  /** The diagnostics as the view draws them: one `Label: value` per drawn line. */
  const diagnosticsShown = (): string =>
    [...(element('diagnostics-lines')?.querySelectorAll('p') ?? [])]
      .map((line) => line.textContent ?? '')
      .join('\n');
  const capture = async (label: string): Promise<void> => {
    await window.dspatch.captureWindow(`${mode}-${label}`);
  };

  /** The window's reading of the state: the panel, the composer, the thread, the details. */
  const readState = (label: string): Record<string, unknown> => {
    const panel = element('continuity-choices');
    const reading = {
      label,
      panelShown: panel !== null,
      panelHeading: textOf('continuity-heading'),
      panelBody: textOf('continuity-body'),
      panelButtonLabels: panelButtonLabels(),
      detailsEntry: textOf('continuity-details'),
      newSessionNote: textOf('continuity-new-session-note'),
      simulationLine: textOf('continuity-simulated'),
      runningCommandNote: textOf('continuity-running-command-note'),
      openDisclosuresInPanel: panel?.querySelectorAll('details[open]').length ?? 0,
      newSessionBlockShown: element('new-session-block') !== null,
      composerStatus: textOf('active-status'),
      routeNote: textOf('composer-route-note'),
      composerText: composerText(),
      detailsViewOpen: detailsViewOpen(),
      diagnosticsExpanded: detailsOpen('diagnostics'),
      // The history introduction and the reading mode, which are gone: neither may be
      // anywhere in the document, drawn or hidden.
      historyIntroShown:
        element('history-mark') !== null ||
        /This is what was written down/.test(document.body.textContent ?? ''),
      readHistoryAnywhere: /Read history/.test(document.body.textContent ?? ''),
      historyTurns: historyPrompts().length,
      providerSessionFact: textOf('provider-session-id'),
      sessionShown: textOf('session-id'),
      conversationShown: textOf('conversation-id'),
      diagnosticsStatement: textOf('diagnostics-statement'),
      actionErrorShown: element('action-error') !== null,
    };
    record(label, reading);
    return reading;
  };

  const expectedBody =
    mode === 'failed'
      ? 'This may be temporary. Your saved conversation is still available. Try again, or start a new session.'
      : 'The session was not found. Your saved conversation is still available. Try again, or start a new session.';

  /** The compact state at rest, as Niclas's decisions of 24 October 2026 describe it. */
  const expectAtRest = (reading: Record<string, unknown>, where: string): void => {
    const is = (ok: boolean, message: string): void => {
      expect(CHAT_EXIT.resumeStateNotShown, ok, `${where}: ${message}`);
    };
    const labels = reading['panelButtonLabels'] as string[];
    is(reading['panelShown'] === true, 'the panel was not shown');
    is(reading['panelHeading'] === 'Could not resume the agent session.', `the heading reads "${String(reading['panelHeading'])}"`);
    is(reading['panelBody'] === expectedBody, `the body reads "${String(reading['panelBody'])}", not "${expectedBody}"`);
    is(
      !/no longer|missing|disappeared|existed/i.test(String(reading['panelBody'])),
      `the body claims the session existed or disappeared: "${String(reading['panelBody'])}"`,
    );
    is(labels.join('|') === 'Try again|Start new Cursor session', `the buttons read "${labels.join('|')}"`);
    is(reading['readHistoryAnywhere'] === false, '"Read history" is still somewhere in the window');
    is(
      reading['newSessionNote'] ===
        'A new session starts without the earlier conversation. You can send a summary with your next message.',
      `the line under the buttons reads "${String(reading['newSessionNote'])}"`,
    );
    is(reading['detailsEntry'] === 'Details', `the Details entry reads "${String(reading['detailsEntry'])}"`);
    is(reading['simulationLine'] === 'Test mode — no provider calls', `the test-mode label reads "${String(reading['simulationLine'])}"`);
    is(reading['runningCommandNote'] === '', `a running-command line with nothing running: "${String(reading['runningCommandNote'])}"`);
    is(reading['openDisclosuresInPanel'] === 0, 'a disclosure in the panel was open');
    is(reading['newSessionBlockShown'] === false, 'a new-session block was shown with no session open');
    is(reading['detailsViewOpen'] === false, 'the session details were open');
    is(reading['historyIntroShown'] === false, 'the history introduction is still in the window');
    is(reading['historyTurns'] === 3, `${String(reading['historyTurns'])} seeded messages on screen, not 3`);
    is(reading['composerStatus'] === 'No agent session — history only', `the composer status reads "${String(reading['composerStatus'])}"`);
    is(
      String(reading['providerSessionFact']).endsWith('(on record, not open)'),
      `the Provider session fact reads "${String(reading['providerSessionFact'])}"`,
    );
  };

  /**
   * The window as it is handed to a person in hold mode, judged before anything is
   * driven: the panel with its actions; the details closed and the diagnostics not
   * visible; no disclosure open in the panel, the new-session block or the help;
   * focus in none of them; the window at the width it opened at.
   */
  const checkHandOver = (): void => {
    const active = document.activeElement;
    const holds = (name: string): boolean => {
      const host = element(name);
      return host !== null && active !== null && host.contains(active);
    };
    const help = ['model-affects-summary'].map(
      (name) => element(name)?.closest('details') ?? null,
    );
    const reading = {
      panelShown: element('continuity-choices') !== null,
      actions: panelButtonLabels(),
      detailsEntry: textOf('continuity-details'),
      detailsViewOpen: attributeOf('session-details-view', 'data-open'),
      diagnosticsVisible: element('diagnostics')?.checkVisibility() ?? false,
      openDisclosuresInPanel: element('continuity-choices')?.querySelectorAll('details[open]').length ?? 0,
      openDisclosuresInNewSessionBlock:
        element('new-session-block')?.querySelectorAll('details[open]').length ?? 0,
      helpDisclosuresOpen: help.map((details) => details?.open ?? null),
      activeElement: focusName(),
      focusInPanel: holds('continuity-choices'),
      focusInHelp: help.some((details) => details !== null && active !== null && details.contains(active)),
      focusInDetailsView: holds('session-details-view'),
      outerWidth: window.outerWidth,
      widthAtStart,
      innerWidth: window.innerWidth,
    };
    const atRest =
      reading.panelShown &&
      reading.actions.join('|') === 'Try again|Start new Cursor session' &&
      reading.detailsEntry === 'Details' &&
      reading.detailsViewOpen === 'false' &&
      !reading.diagnosticsVisible &&
      reading.openDisclosuresInPanel === 0 &&
      reading.openDisclosuresInNewSessionBlock === 0 &&
      reading.helpDisclosuresOpen.every((open) => open !== true) &&
      !reading.focusInPanel &&
      !reading.focusInHelp &&
      !reading.focusInDetailsView &&
      reading.outerWidth === widthAtStart;
    record('handOver', { ...reading, atRest });
    observations['handOver'] = { ...reading, atRest };
    expect(
      CHAT_EXIT.resumeStateNotShown,
      atRest,
      `the window handed over is not at rest: ${JSON.stringify(reading)}`,
    );
  };

  /**
   * Narrow the window to 700 px and judge it: no horizontal overflow of the document,
   * and every named control inside the viewport. The thread's own overflow is
   * recorded and not judged - it is the transcript's layout, not this panel's. The
   * width is put back afterwards.
   */
  /** Each child's class and rendered height, in order: where a column's height goes. */
  const heightsOf = (
    parent: Element | null,
  ): readonly { readonly part: string; readonly heightPx: number }[] | null =>
    parent === null
      ? null
      : Array.from(parent.children).map((child) => ({
          part: child.getAttribute('data-ev') ?? (child.className === '' ? child.tagName : String(child.className)),
          heightPx: Math.round(child.getBoundingClientRect().height),
        }));

  const narrowCheck = async (label: string, names: readonly string[]): Promise<void> => {
    const widthBefore = window.outerWidth;
    const contentWidthPx = await window.dspatch.setWindowWidth(700);
    await sleep(600);
    const thread = element('transcript');
    const visible: Record<string, boolean> = {};
    // Where each control ends, against the window's height: `body` does not scroll, so
    // a control below `innerHeight` is cut off rather than reachable.
    const bottomsPx: Record<string, number | null> = {};
    for (const name of names) {
      visible[name] = visibleInViewport(name);
      const found = element(name);
      bottomsPx[name] = found === null ? null : Math.round(found.getBoundingClientRect().bottom);
    }
    // Vertical overflow inside the conversation panel: when the controls under the
    // thread need more height than the window has, the thread is squeezed past its own
    // minimum and is drawn over the composer. Its bottom must stay above the box's top.
    const composerBox = element('prompt');
    const threadOverlapsComposerPx =
      thread === null || composerBox === null
        ? null
        : Math.round(thread.getBoundingClientRect().bottom - composerBox.getBoundingClientRect().top);
    const reading = {
      contentWidthPx,
      innerWidthPx: window.innerWidth,
      innerHeightPx: window.innerHeight,
      scrollWidthPx: document.documentElement.scrollWidth,
      conversationOverflowPx:
        thread === null ? null : Math.round(thread.scrollWidth - thread.clientWidth),
      threadHeightPx: thread === null ? null : Math.round(thread.clientHeight),
      threadOverlapsComposerPx,
      visible,
      bottomsPx,
      // Where the conversation panel's height goes, so an overlap can be traced to
      // the part that took the space rather than guessed at (run 20261026-200000).
      panelPartsPx: heightsOf(thread?.closest('.panel--conversation') ?? null),
      composerPartsPx: heightsOf(composerBox?.closest('.composer') ?? null),
    };
    record(`narrow window: ${label}`, reading);
    expect(
      CHAT_EXIT.resumeStateNotShown,
      threadOverlapsComposerPx !== null && threadOverlapsComposerPx <= 0,
      `${label} at ${String(reading.innerWidthPx)} px: the thread is drawn over the composer by ${String(threadOverlapsComposerPx)} px`,
    );
    expect(
      CHAT_EXIT.resumeStateNotShown,
      reading.scrollWidthPx <= reading.innerWidthPx,
      `${label} at ${String(reading.innerWidthPx)} px: the document overflows to ${String(reading.scrollWidthPx)} px`,
    );
    expect(
      CHAT_EXIT.resumeStateNotShown,
      names.every((name) => visible[name] === true),
      `${label} at ${String(reading.innerWidthPx)} px: not everything is inside the viewport: ${JSON.stringify(visible)}`,
    );
    await capture(`${label}-narrow`);
    await window.dspatch.setWindowWidth(widthBefore);
    await sleep(400);
  };

  /**
   * Wait for a session start the window asked for to end. The buttons are disabled
   * only while the start is in flight, and a start over the presentation adapter can
   * be shorter than one poll, so a busy state that was never seen is recorded rather
   * than failed: the main process's record counts the attempts.
   */
  const waitForStartToSettle = async (why: string): Promise<boolean> => {
    let sawBusy = false;
    try {
      await waitFor(
        `the session start (${why}) to begin`,
        () => {
          const button = element('continuity-choice-try-again');
          return button instanceof HTMLButtonElement && button.disabled;
        },
        3_000,
        16,
      );
      sawBusy = true;
    } catch {
      sawBusy = false;
    }
    await sleep(sawBusy ? 0 : 2_000);
    await waitFor(
      `the session start (${why}) to end`,
      () => {
        const button = element('continuity-choice-try-again');
        return !(button instanceof HTMLButtonElement) || !button.disabled;
      },
      60_000,
    );
    // The save status and the run state are polled; give them one round.
    await sleep(1_200);
    return sawBusy;
  };

  /**
   * The help disclosure beside the composer (the model's), closed at rest, then opened
   * and closed again with its text intact (it went behind <details> in DSP-121's UX
   * pass, and no other runnable scenario opens it). The sidebar's folder help it was
   * checked beside is gone (DSP-125). A dispatched KeyboardEvent has no
   * default action in the page, so Enter on the summary is dispatched and recorded but
   * the open itself is `summary.click()`; focus is recorded as the keyboard evidence the
   * page can give. Never in hold mode: it moves focus and opens disclosures.
   */
  const checkHelpDisclosures = async (): Promise<void> => {
    const helpDisclosures: Record<string, unknown> = {};
    const pairs = [['model', 'model-affects-summary', 'model-affects']] as const;
    for (const [label, summaryName, textName] of pairs) {
      const summary = element(summaryName);
      const details = summary?.closest('details') ?? null;
      const text = element(textName);
      // `checkVisibility()`, not `offsetParent`: Chromium skips a closed <details>'
      // content through content-visibility, so the text keeps an offsetParent while
      // nobody can see it. The box size is the second reading.
      const visible = (): boolean =>
        text !== null && text.checkVisibility() && text.getBoundingClientRect().height > 0;
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        details !== null && !details.open && !visible(),
        `help disclosure "${label}" was not closed at rest (open=${String(details?.open)})`,
      );
      if (!(summary instanceof HTMLElement) || details === null) {
        helpDisclosures[label] = { present: false };
        continue;
      }
      summary.focus();
      const tookFocus = document.activeElement === summary;
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      summary.dispatchEvent(enter);
      await sleep(100);
      const openedByKey = details.open;
      if (!openedByKey) {
        summary.click();
      }
      await sleep(200);
      const openText = clean(text?.textContent ?? null);
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        details.open && visible() && openText !== '',
        `help disclosure "${label}" did not open with its text visible (open=${String(details.open)})`,
      );
      summary.click();
      await sleep(200);
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        !details.open && (text === null || !text.checkVisibility()),
        `help disclosure "${label}" did not close again (open=${String(details.open)})`,
      );
      helpDisclosures[label] = {
        summaryText: clean(summary.textContent),
        tookFocus,
        enterIntercepted: enter.defaultPrevented,
        openedBy: openedByKey ? 'keyboard' : 'click',
        detailText: openText,
        closedAgain: !details.open,
      };
    }
    // Leave focus where a person's click elsewhere would leave it.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    record('help disclosures', helpDisclosures);
  };

  /**
   * Read the history with a draft in the box (refused phase): the thread really
   * scrolls, the way forward stays in the viewport at its top, the draft is untouched,
   * and Enter holds it back with a note naming that way - nothing reaches the main
   * process, which the main process checks on its own record. If three seeded
   * messages do not overflow the thread at the normal width, the window is narrowed
   * to 700 px for this step, which is said in the record; the seed is not changed.
   */
  const readScrollAndDraft = async (): Promise<string> => {
    const draft = `Draft kept while reading ${newNonce()}`;
    await typeInto('prompt', draft);
    const thread = element('transcript');
    if (thread === null) {
      throw new Error('there is no conversation thread to scroll');
    }
    const widthBefore = window.outerWidth;
    const atNormalWidth = { scrollHeightPx: thread.scrollHeight, clientHeightPx: thread.clientHeight };
    const narrowed = thread.scrollHeight <= thread.clientHeight;
    if (narrowed) {
      await window.dspatch.setWindowWidth(700);
      await sleep(600);
    }
    const overflow = { scrollHeightPx: thread.scrollHeight, clientHeightPx: thread.clientHeight };
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      overflow.scrollHeightPx > overflow.clientHeightPx,
      `the conversation does not scroll even at 700 px (${JSON.stringify(overflow)}), so reading back could not be tried`,
    );
    // From the latest message, where the window put the reader, to the very top.
    thread.scrollTop = thread.scrollHeight;
    thread.dispatchEvent(new Event('scroll'));
    await sleep(300);
    const scrollTopBefore = thread.scrollTop;
    thread.scrollTop = 0;
    thread.dispatchEvent(new Event('scroll'));
    await sleep(400);
    const atTop = {
      scrollTopBefore,
      scrollTopAfter: thread.scrollTop,
      firstMessageInView: visibleInViewport('history-turn-0-prompt'),
      tryAgainInView: visibleInViewport('continuity-choice-try-again'),
      newSessionInView: visibleInViewport('continuity-choice-new-session'),
      detailsEntryInView: visibleInViewport('continuity-details'),
      draftKept: composerText() === draft,
    };
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      scrollTopBefore > 0 && atTop.scrollTopAfter === 0 && atTop.firstMessageInView,
      `the conversation did not actually scroll to its first message: ${JSON.stringify(atTop)}`,
    );
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      atTop.tryAgainInView && atTop.newSessionInView && atTop.detailsEntryInView,
      `scrolled to the top, the way forward left the viewport: ${JSON.stringify(atTop)}`,
    );
    expect(CHAT_EXIT.resumeChoiceWrong, atTop.draftKept, 'the draft changed while the history was read');
    await capture('scrolled-top');
    // Enter with no agent session: the text stays, the note says what to do instead.
    const enterTaken = await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
    await sleep(1_000);
    const afterEnter = {
      enterTakenFromTextarea: enterTaken,
      draftKept: composerText() === draft,
      routeNote: textOf('composer-route-note'),
      turnAppeared: element('turn-0') !== null || element('active-answer') !== null,
      actionError: textOf('action-error-message'),
      wayForwardInView:
        visibleInViewport('continuity-choice-try-again') && visibleInViewport('continuity-choice-new-session'),
    };
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      afterEnter.draftKept && !afterEnter.turnAppeared && afterEnter.actionError === '',
      `Enter with no agent session did not just hold the draft: ${JSON.stringify(afterEnter)}`,
    );
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      afterEnter.routeNote === 'Try again or start a new session to send.' && afterEnter.wayForwardInView,
      `the note under the box does not name the way forward: "${afterEnter.routeNote}"`,
    );
    await capture('enter-held');
    thread.scrollTop = thread.scrollHeight;
    thread.dispatchEvent(new Event('scroll'));
    await sleep(300);
    if (narrowed) {
      await window.dspatch.setWindowWidth(widthBefore);
      await sleep(400);
    }
    record('read, scroll and draft', { draft, atNormalWidth, narrowedForTheScroll: narrowed, overflow, atTop, afterEnter });
    return draft;
  };

  /**
   * The diagnostics (refused and failed phases): closed until *Details* is clicked;
   * then the session details open at the diagnostics, expanded, with focus there and
   * every service text in them; *Copy diagnostic info* copies exactly what is shown
   * (the main process compares) and focus stays on the button; the view's own *Back
   * to the conversation* closes it and gives focus back to the entry.
   */
  const checkDiagnostics = async (atRest: Record<string, unknown>): Promise<void> => {
    expect(
      CHAT_EXIT.resumeStateNotShown,
      !detailsViewOpen() && !(element('diagnostics')?.checkVisibility() ?? false),
      'the diagnostics were open before Details was clicked',
    );
    // Focused first, as a person's click focuses it, so giving focus back is checkable.
    element('continuity-details')?.focus();
    await click('continuity-details');
    await waitFor('the session details to open', () => detailsViewOpen(), 10_000);
    await sleep(400);
    const section = element('diagnostics');
    const opened = {
      detailsViewOpen: detailsViewOpen(),
      diagnosticsExpanded: detailsOpen('diagnostics'),
      diagnosticsVisible: section?.checkVisibility() ?? false,
      summaryInView: visibleInViewport('diagnostics-summary'),
      wayBackInView: visibleInViewport('details-back'),
      focus: focusName(),
      focusInDiagnostics: section !== null && section.contains(document.activeElement),
      conversationHidden: !(element('continuity-choices')?.checkVisibility() ?? false),
      statement: textOf('diagnostics-statement'),
      failureDetail: textOf('diagnostics-failure-detail'),
      providerCode: textOf('diagnostics-provider-code'),
      attemptedSession: textOf('diagnostics-attempted-session'),
      adapter: textOf('diagnostics-adapter'),
      conversationFile: textOf('diagnostics-conversation-file'),
      savedAt: textOf('diagnostics-saved-at'),
      messagesRead: textOf('diagnostics-messages-read'),
      simulated: textOf('diagnostics-simulated'),
    };
    record('diagnostics opened', opened);
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      opened.detailsViewOpen && opened.diagnosticsExpanded && opened.diagnosticsVisible && opened.summaryInView,
      `Details did not open the session details at the diagnostics: ${JSON.stringify(opened)}`,
    );
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      opened.wayBackInView,
      'opened at the diagnostics, the details do not show their way back to the conversation',
    );
    expect(CHAT_EXIT.resumeChoiceWrong, opened.focusInDiagnostics, `focus did not move to the diagnostics: ${String(opened.focus)}`);
    const wording =
      mode === 'failed'
        ? [/the attempt failed/, /This may be temporary/]
        : [/provider answered that it does not have that session/, /No new session was opened and nothing was sent/];
    for (const pattern of wording) {
      expect(CHAT_EXIT.resumeStateNotShown, pattern.test(opened.statement), `the diagnostics' statement does not say ${String(pattern)}: "${opened.statement}"`);
    }
    expect(CHAT_EXIT.resumeStateNotShown, /simulated/i.test(opened.failureDetail), `the failure detail does not say simulated: "${opened.failureDetail}"`);
    expect(
      CHAT_EXIT.resumeStateNotShown,
      mode === 'failed' ? opened.providerCode === '' : opened.providerCode === 'agent_not_found',
      `the provider code reads "${opened.providerCode}"`,
    );
    expect(
      CHAT_EXIT.resumeStateNotShown,
      opened.attemptedSession.startsWith('dsp-session-') && opened.attemptedSession === atRest['sessionShown'],
      `the attempted session reads "${opened.attemptedSession}", the session shown "${String(atRest['sessionShown'])}"`,
    );
    expect(CHAT_EXIT.resumeStateNotShown, opened.adapter === 'presentation-local', `the adapter reads "${opened.adapter}"`);
    expect(
      CHAT_EXIT.resumeStateNotShown,
      opened.conversationFile.endsWith(`${String(atRest['conversationShown'])}.json`) && opened.savedAt !== '' && opened.messagesRead === '3',
      `the storage metadata reads "${opened.conversationFile}", saved "${opened.savedAt}", ${opened.messagesRead} messages`,
    );
    expect(
      CHAT_EXIT.resumeStateNotShown,
      opened.simulated ===
        'Presentation mode: this refusal or failure is simulated by the presentation adapter on this machine; no provider was asked anything.',
      `the simulation sentence reads "${opened.simulated}"`,
    );
    await capture('details');
    // Copy, as a person does it: focus on the button, then the click.
    const shownAtCopy = diagnosticsShown();
    observations['diagnosticsShownAtCopy'] = shownAtCopy;
    element('diagnostics-copy')?.focus();
    await click('diagnostics-copy');
    await waitFor('the copy to be confirmed', () => textOf('diagnostics-copied') !== '', 10_000);
    const copied = {
      note: textOf('diagnostics-copied'),
      focusStayed: focusName() === 'diagnostics-copy',
      linesShown: shownAtCopy.split('\n').length,
      charactersShown: shownAtCopy.length,
    };
    record('diagnostics copied', copied);
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      copied.note === 'Copied' && copied.focusStayed,
      `Copy diagnostic info did not confirm in place: ${JSON.stringify(copied)}`,
    );
    // Closed with the view's own control.
    await click('details-back');
    await waitFor('the session details to close', () => !detailsViewOpen(), 10_000);
    await sleep(400);
    const closed = {
      detailsViewOpen: detailsViewOpen(),
      panelShown: element('continuity-choices') !== null,
      tryAgainInView: visibleInViewport('continuity-choice-try-again'),
      newSessionInView: visibleInViewport('continuity-choice-new-session'),
      focus: focusName(),
    };
    record('diagnostics closed', closed);
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      !closed.detailsViewOpen && closed.panelShown && closed.tryAgainInView && closed.newSessionInView,
      `closing the details did not bring back the conversation with the panel and its actions: ${JSON.stringify(closed)}`,
    );
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      closed.focus === 'continuity-details',
      `focus did not come back to the Details entry: ${String(closed.focus)}`,
    );
    await capture('details-closed');
    if (mode === 'refused') {
      // And with Escape from inside the details, the keyboard's way back.
      element('continuity-details')?.focus();
      await click('continuity-details');
      await waitFor('the session details to open again', () => detailsViewOpen(), 10_000);
      await sleep(300);
      const target = document.activeElement ?? document.body;
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      target.dispatchEvent(escape);
      let closedByEscape = true;
      try {
        await waitFor('Escape to close the session details', () => !detailsViewOpen(), 5_000);
      } catch {
        closedByEscape = false;
      }
      await sleep(300);
      record('diagnostics closed with Escape', {
        pressedOn: target instanceof HTMLElement ? (target.getAttribute('data-ev') ?? target.tagName) : null,
        closedByEscape,
        focus: focusName(),
      });
      expect(CHAT_EXIT.resumeChoiceWrong, closedByEscape, 'Escape inside the session details did not close them');
    }
  };

  /**
   * *Start new session* (refused and failed phases): the explanation and the summary
   * stand where the panel was, outside the thread; the summary is closed until clicked
   * and is read in full from the disclosure; nothing is sent, which the main process
   * checks along with the stored session being replaced only now. Returns the summary
   * exactly as the disclosure showed it.
   */
  const startNewSession = async (): Promise<string> => {
    await click('continuity-choice-new-session');
    await waitFor('the new-session block', () => element('new-session-block') !== null, 60_000);
    await sleep(1_200);
    const block = element('new-session-block');
    const fresh = {
      panelShown: element('continuity-choices') !== null,
      heading: textOf('new-session-heading'),
      line: textOf('new-session-summary-line'),
      toggle: textOf('new-session-summary-toggle'),
      summaryOpenAtFirst: detailsOpen('new-session-summary'),
      removeButton: textOf('new-session-remove-summary'),
      outsideTheThread: block !== null && !(element('transcript')?.contains(block) ?? true),
      providerSessionFact: textOf('provider-session-id'),
      composerStatus: textOf('active-status'),
      routeNote: textOf('composer-route-note'),
      detailsViewOpen: detailsViewOpen(),
      turnAppeared: element('turn-0') !== null,
    };
    record('new session', fresh);
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      !fresh.panelShown &&
        fresh.heading === 'New session. The agent does not have the earlier conversation.' &&
        fresh.line === 'This summary will be sent with your next message.' &&
        /^Summary \(\d+ characters\)$/.test(fresh.toggle) &&
        !fresh.summaryOpenAtFirst &&
        fresh.removeButton === 'Remove summary' &&
        fresh.outsideTheThread,
      `the new session was not explained where it was chosen: ${JSON.stringify(fresh)}`,
    );
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      !fresh.providerSessionFact.endsWith('(on record, not open)') &&
        fresh.composerStatus !== 'No agent session — history only' &&
        fresh.routeNote === '' &&
        !fresh.detailsViewOpen &&
        !fresh.turnAppeared,
      `after Start new session the window does not read as a session open with nothing sent: ${JSON.stringify(fresh)}`,
    );
    await capture('new-session');
    await narrowCheck('new-session', ['new-session-summary-toggle', 'new-session-remove-summary']);
    await clickAny('new-session-summary-toggle');
    await sleep(300);
    const summaryShown = element('new-session-summary-text')?.textContent ?? '';
    const declared = Number(/\((\d+) characters\)/.exec(fresh.toggle)?.[1] ?? '-1');
    record('summary opened', {
      open: detailsOpen('new-session-summary'),
      characters: summaryShown.length,
      declaredCharacters: declared,
      head: summaryShown.slice(0, 160),
    });
    expect(
      CHAT_EXIT.resumeChoiceWrong,
      detailsOpen('new-session-summary') &&
        summaryShown.startsWith('=== DSpatch: a record of the earlier conversation ===') &&
        summaryShown.length === declared,
      `the summary did not open in full: ${String(summaryShown.length)} characters shown, ${String(declared)} declared`,
    );
    await capture('summary-open');
    // The block at its tallest, in a narrow window (DSP-121 review S4): with the
    // summary open, Remove summary must still be inside the viewport and nothing may
    // overflow sideways.
    await narrowCheck('summary-open', ['new-session-remove-summary', 'new-session-summary-toggle']);
    return summaryShown;
  };

  /**
   * The `ok` phase (DSP-124): A is resumed, and the kit was seeded with
   * `--unknown-turn`, so A holds an agent turn whose outcome is unknown. Enter is held
   * back by that gate; one press of *Send anyway* sends the draft. Judged here on what
   * the window showed - one answered turn carrying the draft, the box emptied only
   * after it, the gate gone, no second turn - and by the main process on what reached
   * it: one send with that attempt acknowledged, the adapter receiving the draft
   * alone, and the attempt still unresolved in the file but acknowledged.
   */
  const sendAnywayPhase = async (): Promise<void> => {
    await waitFor(
      'the Send anyway control for the outcome-unknown turn (seed the kit with --unknown-turn)',
      () => element('send-anyway') !== null,
      30_000,
    );
    await sleep(800);
    const offered = {
      gateText: clean(textOf('send-needs-acknowledgement')),
      buttonLabel: clean(textOf('send-anyway')),
      providerSessionFact: textOf('provider-session-id'),
      composerStatus: textOf('active-status'),
      panelShown: element('continuity-choices') !== null,
      historyTurns: historyPrompts().length,
    };
    record('send anyway offered', offered);
    const named = /^Send anyway, leaving (dsp-attempt-\d+) unresolved$/.exec(offered.buttonLabel)?.[1] ?? null;
    observations['sendAnywayAttemptNamed'] = named;
    expect(
      CHAT_EXIT.sendAnywayWrong,
      named !== null && !offered.panelShown && !offered.providerSessionFact.endsWith('(on record, not open)'),
      `Send anyway was not offered for one attempt in a resumed session: ${JSON.stringify(offered)}`,
    );
    const draft = `Sent anyway ${newNonce()}: reply with anything.`;
    observations['messageSentAnyway'] = draft;
    await typeInto('prompt', draft);
    // Enter without the explicit choice: the gate holds, the draft stays.
    const enterTaken = await pressKeyInComposer('prompt', 'Enter', { shiftKey: false });
    await sleep(1_000);
    const afterEnter = {
      enterTakenFromTextarea: enterTaken,
      draftKept: composerText() === draft,
      turnAppeared: element('turn-0') !== null,
      routeNote: clean(textOf('composer-route-note')),
      actionError: textOf('action-error-message'),
      gateStillShown: element('send-anyway') !== null,
    };
    record('enter without the choice', afterEnter);
    expect(
      CHAT_EXIT.sendAnywayWrong,
      afterEnter.draftKept &&
        !afterEnter.turnAppeared &&
        afterEnter.actionError === '' &&
        afterEnter.gateStillShown &&
        named !== null &&
        afterEnter.routeNote.includes(named),
      `Enter without the explicit choice did not just hold the draft back at the gate: ${JSON.stringify(afterEnter)}`,
    );
    await capture('send-anyway-gate');
    // One press of the real button.
    const button = element('send-anyway');
    const enabledAtPress = button instanceof HTMLButtonElement && !button.disabled;
    if (button instanceof HTMLButtonElement) {
      button.click();
    }
    let answered = true;
    try {
      await waitFor(
        'the message sent anyway to be answered',
        () => statusOfTurn(0) === 'finished' && textOf('turn-0-answer') !== '',
        20_000,
      );
    } catch {
      answered = false;
    }
    await sleep(1_500);
    const after = {
      enabledAtPress,
      answered,
      status: statusOfTurn(0),
      prompt: clean(element('turn-0-prompt')?.textContent ?? null),
      composerText: composerText(),
      composerNote: clean(textOf('composer-note')),
      routeNote: clean(textOf('composer-route-note')),
      actionError: textOf('action-error-message'),
      gateStillShown: element('send-needs-acknowledgement') !== null,
      secondTurn: element('turn-1') !== null,
    };
    record('send anyway pressed once', after);
    expect(
      CHAT_EXIT.sendAnywayWrong,
      enabledAtPress && answered && after.prompt === draft && after.composerText === '',
      `one press of Send anyway did not send the draft and empty the box: ${JSON.stringify(after)}`,
    );
    expect(
      CHAT_EXIT.sendAnywayWrong,
      !after.gateStillShown && !after.secondTurn && after.composerNote === '' && after.actionError === '',
      `after Send anyway the gate, a second turn or a note was still there: ${JSON.stringify(after)}`,
    );
    await capture('sent-anyway');
  };

  try {
    if (mode === 'ok' && hold) {
      throw new Error('Hold mode is for the refused and failed states; the ok phase is the Send anyway check.');
    }
    if (projectA === undefined) {
      throw new Error(
        'DSPATCH_CHAT_SWITCH_PROJECTS must name the seeded project A (its first entry). ' +
          'The seed script prints it.',
      );
    }
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );
    await waitFor('the Recent list', () => element('project-0-path') !== null, 60_000);
    await waitFor(`A to be offered in Recent`, () => rowOf(projectA) !== null, 60_000);

    // --- Open A: the resume is refused or fails, simulated --------------------------
    await click(`open-project-${String(rowOf(projectA) ?? 0)}`);
    await waitFor(
      'a session over A',
      () =>
        textOf('session-id').startsWith('dsp-session-') &&
        samePath(attributeOf('project-path', 'title'), projectA),
      60_000,
    );
    await sleep(1_500);

    if (mode === 'ok') {
      // --- DSP-124: resumed, with an outcome-unknown turn; Send anyway, once ---------
      await sendAnywayPhase();
      const okCode =
        failures.length === 0 ? CHAT_EXIT.ok : failed.size === 0 ? CHAT_EXIT.scriptFailed : Math.min(...failed);
      return finish(okCode, steps, failures, observations);
    }

    // --- At rest, as a person meets it: read, judged and photographed, nothing touched
    const atRest = readState('at rest');
    expectAtRest(atRest, 'at rest');
    await capture('at-rest');

    if (hold) {
      // The hand-over: judged and recorded right after the reading at rest, before any
      // click, focus change, width change or disclosure. Nothing further is driven.
      checkHandOver();
      record('hold', {
        note: 'Hold mode: nothing further is driven. The window stays open at rest with the real panel.',
      });
      const holdCode =
        failures.length === 0 ? CHAT_EXIT.ok : failed.size === 0 ? CHAT_EXIT.scriptFailed : Math.min(...failed);
      return finish(holdCode, steps, failures, observations);
    }

    await checkHelpDisclosures();
    await narrowCheck('at-rest', ['continuity-choice-try-again', 'continuity-choice-new-session', 'continuity-details']);

    if (mode === 'refused-once') {
      // --- Try again succeeds: resumed, no panel, nothing sent ------------------------
      await click('continuity-choice-try-again');
      await waitFor('the panel to go after the resume', () => element('continuity-choices') === null, 60_000);
      await sleep(1_500);
      const resumed = readState('try again, resumed');
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        resumed['panelShown'] === false &&
          resumed['newSessionBlockShown'] === false &&
          /was resumed by the presentation-local adapter/.test(String(resumed['diagnosticsStatement'])) &&
          !String(resumed['providerSessionFact']).endsWith('(on record, not open)') &&
          resumed['composerStatus'] !== 'No agent session — history only' &&
          resumed['detailsViewOpen'] === false,
        `after Try again the window did not read as resumed: ${JSON.stringify(resumed)}`,
      );
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        resumed['sessionShown'] === atRest['sessionShown'] &&
          resumed['conversationShown'] === atRest['conversationShown'] &&
          resumed['historyTurns'] === 3,
        'the resumed session is not the same conversation with its three messages',
      );
      await capture('resumed');
    } else {
      // --- refused: read the history with a draft, Enter held back -------------------
      const draft = mode === 'refused' ? await readScrollAndDraft() : null;

      // --- refused and failed: the diagnostics, opened only by Details ---------------
      await checkDiagnostics(atRest);

      // --- Try again: refused or failed again, the same compact state -----------------
      await click('continuity-choice-try-again');
      const retrySawBusy = await waitForStartToSettle('try again');
      const retried = readState('try again');
      record('try again settled', { busyStateObserved: retrySawBusy });
      expectAtRest(retried, 'after Try again');
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        retried['sessionShown'] === atRest['sessionShown'] &&
          retried['conversationShown'] === atRest['conversationShown'] &&
          retried['historyTurns'] === 3 &&
          (draft === null || retried['composerText'] === draft),
        'Try again changed the session on screen, the conversation, the history or the draft',
      );
      await capture('tried-again');

      // --- A new session: explained where it is chosen, with its summary -----------
      const summaryShown = await startNewSession();
      let message: string;
      if (mode === 'refused') {
        // Removed: only the message goes.
        await click('new-session-remove-summary');
        await waitFor(
          'the summary to read as removed',
          () => element('new-session-summary-removed') !== null,
          30_000,
        );
        const removedLine = textOf('new-session-summary-removed');
        expect(
          CHAT_EXIT.resumeChoiceWrong,
          removedLine === 'Summary removed. Only your message will be sent.' &&
            element('new-session-summary-text') === null,
          `removing the summary did not say so: "${removedLine}"`,
        );
        await capture('summary-removed');
        // The draft, kept through the reading, the details and Try again, is the message.
        message = draft ?? '';
        observations['messageSentInNewSession'] = message;
        await sendFromComposer();
        await waitFor(
          'the message to be answered',
          () => element('active-answer') === null && element('turn-0-answer') !== null,
          plan.turnTimeoutMs,
        );
      } else {
        // Kept: it goes in front of the message, as shown.
        observations['summaryShownBeforeSend'] = summaryShown;
        message = `Sent with the summary ${newNonce()}: reply with anything.`;
        observations['messageSentInNewSession'] = message;
        await sendAndSettle(0, message, plan.turnTimeoutMs);
      }
      await sleep(1_500);
      const answered = {
        status: statusOfTurn(0),
        answered: textOf('turn-0-answer') !== '',
        prompt: element('turn-0-prompt')?.textContent ?? '',
        blockShown: element('new-session-block') !== null,
        // What the sent turn says went with it: its marker's sentence (the summary
        // line of the disclosure the turn draws for `resentContext`) and the exact
        // text inside it.
        resentMarker: clean(element('turn-0-resent')?.querySelector('summary')?.textContent ?? null),
        resentWithTurn: element('turn-0-resent-text')?.textContent ?? null,
        historyTurns: historyPrompts().length,
        composerText: composerText(),
        panelShown: element('continuity-choices') !== null,
      };
      // For the main process, which compares it with the summary the disclosure
      // showed and with the message saved in the conversation file.
      observations['resentShownWithTurn'] = answered.resentWithTurn;
      record('one message sent in the new session', {
        ...answered,
        resentMarker: answered.resentMarker.slice(0, 160),
        resentWithTurn:
          answered.resentWithTurn === null ? null : `${String(answered.resentWithTurn.length)} characters`,
      });
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        answered.status === 'finished' && answered.answered && answered.composerText === '',
        `the message was not answered: turn status "${answered.status}"`,
      );
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        !answered.blockShown && !answered.panelShown && answered.historyTurns === 3,
        'the new-session block, the panel or the history did not read as expected after the send',
      );
      // The turn says what went with it: the summary kept, word for word, behind its
      // marker; nothing after the summary was removed.
      expect(
        CHAT_EXIT.resumeChoiceWrong,
        mode === 'refused'
          ? element('turn-0-resent') === null && answered.resentWithTurn === null
          : element('turn-0-resent') !== null &&
              answered.resentMarker ===
                `Sent in a new session with a summary of the earlier conversation (${String(summaryShown.length)} characters).` &&
              answered.resentWithTurn === summaryShown,
        mode === 'refused'
          ? 'the sent turn shows a summary marker after the summary was removed'
          : `the sent turn does not show the summary the disclosure showed behind its marker: marker "${answered.resentMarker.slice(0, 120)}", ${
              answered.resentWithTurn === null ? 'no text' : `${String(answered.resentWithTurn.length)} characters`
            } against ${String(summaryShown.length)}`,
      );
      await capture('answered');
    }

    const code =
      failures.length === 0
        ? CHAT_EXIT.ok
        : failed.size === 0
          ? CHAT_EXIT.scriptFailed
          : Math.min(...failed);
    return finish(code, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-126: review opened from the chat as a separate window                  */
/* ------------------------------------------------------------------------- */

/** One review window as the main process reads it: its own facts and its view's. */
interface ReviewWindowSeen {
  readonly webContentsId: number;
  readonly title: string;
  readonly focusCount: number;
  readonly startFolder: string | null;
  readonly identity: { readonly repository: string; readonly base: string; readonly target: string; readonly definitionPath: string } | null;
  readonly identityLabel: string | null;
  readonly recordPosition: { readonly stepId?: string | null } | null;
  readonly view: {
    readonly kind: string;
    readonly emptyText: string;
    readonly chooseNote: string | null;
    readonly identity: string;
    readonly title: string;
    readonly repository: string | null;
    readonly base: string | null;
    readonly target: string | null;
    readonly position: { readonly stepId: string | null } | null;
    readonly stepIds: readonly string[];
    readonly hasChatBridge: boolean;
    readonly hasReviewBridge: boolean;
    readonly overflowX: boolean;
  } | null;
}

interface ReviewMainReading {
  readonly reviewWindows: readonly ReviewWindowSeen[];
  readonly chat: { readonly sessionId: string | null; readonly conversationId: string | null; readonly workspacePath: string | null };
  readonly loops: { readonly current: unknown; readonly loopRunFiles: readonly string[] };
  readonly recentReviews: unknown;
}

/**
 * DSP-126 #1-#5 and #7, through both windows with no provider call.
 *
 * The chat's own controls are operated here; the review windows are another renderer,
 * so the main process reads and drives them on request (`reviewWindowCheck`) and logs
 * every answer in its half of the record. The definition the review chooser opens is
 * the scripted file pick (`DSPATCH_PICK_FILE`), the one thing a script cannot click.
 */
async function runReviewWindowScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const [projectOne, projectTwo] = plan.switchProjects ?? [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'No provider call was made; review calls no agent at all, and the chat sent nothing. ' +
      'The review definition was chosen by the scripted file pick, not a native dialog. ' +
      'The review windows were read and driven by the main process through a hook in their ' +
      'view; the chat window was operated through its own controls. The refusal of a review ' +
      'request from the chat window is the review IPC guard called with the chat window\'s ' +
      'sender: the chat window has no review bridge to send one with.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const failed = new Set<number>();
  const expect = (code: number, ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
      failed.add(code);
    }
  };
  const samePath = (left: string | null | undefined, right: string | null | undefined): boolean =>
    (left ?? '').replace(/[\\/]+$/, '').toLowerCase() === (right ?? '').replace(/[\\/]+$/, '').toLowerCase();
  const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
  const rowOf = (target: string): number | null => {
    for (let index = 0; index < 50; index += 1) {
      const found = element(`project-${String(index)}-path`);
      if (found === null) {
        return null;
      }
      if (samePath(clean(found.textContent), target)) {
        return index;
      }
    }
    return null;
  };
  const composerText = (): string => (element('prompt') as HTMLTextAreaElement | null)?.value ?? '';
  const button = (name: string): { exists: boolean; disabled: boolean | null } => {
    const found = element(name);
    return { exists: found !== null, disabled: found instanceof HTMLButtonElement ? found.disabled : null };
  };
  /** What the chat window shows of its own work: the things review must not touch. */
  const chatState = (): Record<string, unknown> => ({
    project: textOf('project-path'),
    session: textOf('session-id'),
    conversation: textOf('conversation-id'),
    draft: composerText(),
    editorNote: element('editor-window-note') === null ? null : textOf('editor-window-note'),
    editAgentLoops: button('edit-agent-loops'),
    openReview: button('open-review'),
    turns: countEntries('turn'),
  });
  const read = async (label: string): Promise<ReviewMainReading> => {
    const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
    record(`main reading: ${label}`, { main: answer.detail });
    return answer.detail as ReviewMainReading;
  };
  /** Read until the review windows satisfy `predicate`, or fail naming what never happened. */
  const readUntil = async (
    label: string,
    predicate: (reading: ReviewMainReading) => boolean,
    timeoutMs = 30_000,
  ): Promise<ReviewMainReading> => {
    const until = performance.now() + timeoutMs;
    for (;;) {
      const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
      const reading = answer.detail as ReviewMainReading;
      if (predicate(reading)) {
        record(`main reading: ${label}`, { main: reading });
        return reading;
      }
      if (performance.now() > until) {
        record(`main reading: ${label} (timed out)`, { main: reading });
        throw new Error(`timed out waiting for: ${label}. This is a timeout, not a verdict.`);
      }
      await sleep(250);
    }
  };
  const settled = (entry: ReviewWindowSeen): boolean => entry.view !== null && entry.view.kind !== 'opening';
  const openProject = async (label: string, target: string): Promise<void> => {
    if (element('projects') === null) {
      await window.dspatch.pressMenuItem('change-project');
      await waitFor(`the project chooser (to open ${label})`, () => element('projects') !== null, 10_000);
    }
    await waitFor(`${label} to be offered in Recent`, () => rowOf(target) !== null, 60_000);
    await click(`open-project-${String(rowOf(target) ?? 0)}`);
    // By the folder, not the session id: the presentation adapter numbers its sessions
    // afresh for each project, so two projects can show the same id.
    await waitFor(
      `a session over ${label}`,
      () =>
        textOf('session-id').startsWith('dsp-session-') &&
        samePath(attributeOf('project-path', 'title'), target) &&
        element('projects') === null,
      60_000,
    );
  };
  const pressOpenReview = async (label: string): Promise<string | null> => {
    const before = textOf('review-window-note');
    await click('open-review');
    // The note is drawn only when the window was focused or could not be opened.
    await sleep(800);
    const note = element('review-window-note') === null ? null : textOf('review-window-note');
    record(`pressed Open review: ${label}`, { noteBefore: before, note });
    return note;
  };

  try {
    if (projectOne === undefined || projectTwo === undefined) {
      throw new Error('the scenario needs two projects in DSPATCH_CHAT_SWITCH_PROJECTS (P1;P2)');
    }
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );

    // --- P1 open, a draft in the box: the work review must leave alone ----------------
    await openProject('P1', projectOne);
    const draft = 'A draft that must survive review opening and closing — DSP-126.';
    await typeInto('prompt', draft);
    const chatBefore = chatState();
    record('chat before review', chatBefore);
    const mainBefore = await read('before review');
    expect(CHAT_EXIT.reviewBoundaryWrong, (window as { dspatchReview?: unknown }).dspatchReview === undefined, 'the chat window has a review bridge (window.dspatchReview)');
    expect(CHAT_EXIT.reviewWindowWrong, mainBefore.reviewWindows.length === 0, 'a review window existed before Open review was pressed');

    // --- (b) Open review: a diff window over P1's one repository, nothing opened ---------
    // DSP-150: review starts by choosing a revision pair; a walk opens from there.
    const first = await openDiffFromChat();
    const firstLog = await untilPair(first.id, 'P1\'s log', (reading) => reading.pair?.phase === 'log');
    record('pressed Open review: first', { note: first.note, heading: firstLog.pair?.heading ?? null });
    expect(CHAT_EXIT.reviewWindowWrong, first.note === null, `the first Open review drew a note: ${String(first.note)}`);
    expect(CHAT_EXIT.reviewWindowWrong, (await read('with the diff window open')).reviewWindows.length === 0, 'a walk opened before anything was chosen');

    // --- (a) asked again while it is choosing: the same window, brought to the front -----
    const secondNote = await pressOpenReview('second, same project');
    const diffRows = (await pairWindows()).filter((row) => row.view === 'diff');
    expect(CHAT_EXIT.reviewWindowWrong, diffRows.length === 1, `a second press made ${String(diffRows.length)} diff windows`);
    expect(CHAT_EXIT.reviewWindowWrong, (secondNote ?? '').includes('brought to the front'), `the repeated press did not say it focused the window: ${String(secondNote)}`);

    // --- Choose the pair, then the walk file, in the review windows ----------------------
    await choosePairInDiff(first.id);
    await openWalkFromDiff(first.id, false);
    const chosen = await readUntil('the chosen review open', (reading) => reading.reviewWindows.length === 1 && reading.reviewWindows[0]?.view?.kind === 'opened');
    const shown = chosen.reviewWindows[0];
    const reviewId = shown?.webContentsId ?? -1;

    // --- (g) the boundary, from both sides ------------------------------------------
    expect(CHAT_EXIT.reviewBoundaryWrong, shown?.view?.hasChatBridge === false, 'the review window has the chat bridge (window.dspatch)');
    expect(CHAT_EXIT.reviewBoundaryWrong, shown?.view?.hasReviewBridge === true, 'the review window has no review bridge');
    const refusal = await window.dspatch.reviewWindowCheck({ action: 'refuse-chat-sender' });
    record('review IPC asked with the chat window as sender', { answer: refusal.detail });
    expect(CHAT_EXIT.reviewBoundaryWrong, refusal.ok, `the review IPC guard did not refuse the chat window: ${JSON.stringify(refusal.detail)}`);
    const label = shown?.identityLabel ?? '';
    expect(CHAT_EXIT.reviewWindowWrong, /^repo · [0-9a-f]{7}→[0-9a-f]{7}$/.test(shown?.view?.identity ?? ''), `the header identity reads "${shown?.view?.identity ?? ''}"`);
    expect(CHAT_EXIT.reviewWindowWrong, shown?.view?.identity === label && label !== '', 'the header identity differs from the main process\'s');
    expect(CHAT_EXIT.reviewWindowWrong, (shown?.title ?? '').endsWith(label), `the window title does not carry the identity: "${shown?.title ?? ''}"`);
    expect(CHAT_EXIT.reviewWindowWrong, samePath(shown?.identity?.repository, projectOne), 'the review is not of P1\'s repository');
    expect(
      CHAT_EXIT.reviewWindowWrong,
      shown?.view?.base === shown?.identity?.base && shown?.view?.target === shown?.identity?.target,
      'the view and the main process name different revisions',
    );
    const pictures: Record<string, unknown> = {};
    pictures['normal'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: reviewId, label: 'review-normal', width: null })).detail;
    pictures['narrow'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: reviewId, label: 'review-narrow', width: 1000 })).detail;
    record('review window pictures', pictures);
    const narrowView = (pictures['narrow'] as { view?: { overflowX?: boolean } } | undefined)?.view;
    expect(CHAT_EXIT.reviewWindowWrong, narrowView?.overflowX === false, 'the review window overflows horizontally at 1000 px');

    // --- (e) a move, then a close inside the save delay, then reopen from the chat ---
    const steps0 = shown?.view?.stepIds ?? [];
    const middle = steps0[1];
    const last = steps0[steps0.length - 1];
    if (middle === undefined || last === undefined || middle === last) {
      throw new Error(`the walk needs at least two steps to move between: ${JSON.stringify(steps0)}`);
    }
    await window.dspatch.reviewWindowCheck({ action: 'go-to-step', webContentsId: reviewId, stepId: middle, closeAfter: false });
    const savedMiddle = await readUntil(
      `the record saved at ${middle}`,
      (reading) => reading.reviewWindows[0]?.recordPosition?.stepId === middle,
      10_000,
    );
    record('the record before the close', { recordPosition: savedMiddle.reviewWindows[0]?.recordPosition ?? null });
    const closing = await window.dspatch.reviewWindowCheck({ action: 'go-to-step', webContentsId: reviewId, stepId: last, closeAfter: true });
    record('moved and closed at once', { answer: closing.detail });
    const closeTiming = closing.detail as { closeAskedAfterMs?: number; closedAfterMs?: number };
    expect(CHAT_EXIT.reviewPositionLost, closing.ok, `the move before the close did not happen: ${JSON.stringify(closing.detail)}`);
    expect(CHAT_EXIT.reviewPositionLost, (closeTiming.closeAskedAfterMs ?? 9_999) < 250, `the close was asked ${String(closeTiming.closeAskedAfterMs)} ms after the move, not inside the 250 ms save delay`);
    const afterClose = await read('after the review window closed');
    expect(CHAT_EXIT.reviewWindowWrong, afterClose.reviewWindows.length === 0, 'the review window was still open after its close');
    const chatAfterClose = chatState();
    record('chat after review closed', chatAfterClose);

    // DSP-150: reopened the decided way - the pair chosen again in the log, Code walks lists the walk.
    const reopenDiff = await openDiffFromChat();
    const reopenNote = reopenDiff.note;
    await choosePairInDiff(reopenDiff.id);
    await openWalkFromDiff(reopenDiff.id, true);
    const reopened = await readUntil('the last review reopened', (reading) => reading.reviewWindows.length === 1 && reading.reviewWindows.every(settled));
    const back = reopened.reviewWindows[0];
    expect(CHAT_EXIT.reviewWindowWrong, reopenNote === null, `reopening drew a note: ${String(reopenNote)}`);
    expect(CHAT_EXIT.reviewWindowWrong, back?.view?.kind === 'opened' && back.identityLabel === label, `the last review did not open directly with its identity: ${String(back?.view?.kind)} ${String(back?.identityLabel)}`);
    expect(CHAT_EXIT.reviewPositionLost, back?.view?.position?.stepId === last, `the reopened review is at ${String(back?.view?.position?.stepId)}, not ${last}`);
    expect(CHAT_EXIT.reviewPositionLost, back?.recordPosition?.stepId === last, `the record holds ${String(back?.recordPosition?.stepId)}, not ${last}`);

    // --- (c) the chat, unchanged by review opening and closing ------------------------
    const chatNow = chatState();
    record('chat with review reopened', chatNow);
    for (const [when, state] of [['after the close', chatAfterClose], ['with review reopened', chatNow]] as const) {
      expect(CHAT_EXIT.reviewTouchedTheChat, JSON.stringify(state) === JSON.stringify(chatBefore), `the chat changed ${when}: ${JSON.stringify(state)} against ${JSON.stringify(chatBefore)}`);
    }
    expect(
      CHAT_EXIT.reviewTouchedTheChat,
      reopened.chat.sessionId === mainBefore.chat.sessionId && reopened.chat.conversationId === mainBefore.chat.conversationId,
      'the chat service\'s session or conversation changed while review opened and closed',
    );

    // --- (d) the chat moves to P2; the P1 review stays what it was ---------------------
    await openProject('P2', projectTwo);
    const switched = await read('after the chat switched to P2');
    const kept = switched.reviewWindows.find((entry) => entry.webContentsId === back?.webContentsId);
    expect(CHAT_EXIT.reviewIdentityLost, kept !== undefined, 'the P1 review window went away when the chat switched project');
    expect(
      CHAT_EXIT.reviewIdentityLost,
      kept?.view?.identity === label && kept.view.base === back?.view?.base && kept.view.target === back?.view?.target && samePath(kept.identity?.repository, projectOne),
      `the P1 review window changed identity after the switch: ${JSON.stringify(kept?.view)}`,
    );
    expect(CHAT_EXIT.reviewIdentityLost, samePath(switched.chat.workspacePath, projectTwo), 'the chat did not move to P2');
    const fromTwoDiff = await openDiffFromChat();
    const fromTwo = fromTwoDiff.note;
    const twoLog = await untilPair(fromTwoDiff.id, 'P2\'s log', (reading) => reading.pair?.phase === 'log' && reading.text.includes('target commit'));
    const two = await read('with P2\'s diff window open');
    const stillOne = two.reviewWindows.find((entry) => entry.webContentsId === back?.webContentsId);
    expect(CHAT_EXIT.reviewIdentityLost, fromTwo === null, `Open review from P2 drew a note: ${String(fromTwo)}`);
    expect(CHAT_EXIT.reviewIdentityLost, twoLog.pair?.heading === 'other', `the window opened from P2 is not over P2's repository: ${String(twoLog.pair?.heading)}`);
    expect(
      CHAT_EXIT.reviewIdentityLost,
      JSON.stringify(stillOne?.view) === JSON.stringify(kept?.view) && stillOne?.focusCount === kept?.focusCount,
      'the P1 review window changed when review was opened from P2',
    );
    record('P2 diff picture', (await window.dspatch.pairWindowCheck({ action: 'capture', id: fromTwoDiff.id, label: 'review-p2-log' })).detail as Record<string, unknown>);
    await closeDiffWindows();

    // --- Close both the ordinary way; (h) nothing about loops moved --------------------
    for (const entry of two.reviewWindows) {
      await window.dspatch.reviewWindowCheck({ action: 'close', webContentsId: entry.webContentsId });
    }
    await closeDiffWindows();
    const end = await read('after both review windows closed');
    expect(CHAT_EXIT.reviewWindowWrong, end.reviewWindows.length === 0, 'a review window was left open');
    expect(CHAT_EXIT.reviewTouchedLoops, end.loops.current === null && mainBefore.loops.current === null, 'a loop run was announced during the scenario');
    expect(
      CHAT_EXIT.reviewTouchedLoops,
      JSON.stringify(end.loops.loopRunFiles) === JSON.stringify(mainBefore.loops.loopRunFiles),
      'the loop-run records changed during the scenario',
    );
    observations['recentReviews'] = end.recentReviews;
    await window.dspatch.captureWindow('chat-at-end');

    const code = failures.length === 0 ? CHAT_EXIT.ok : failed.size === 0 ? CHAT_EXIT.scriptFailed : Math.min(...failed);
    return finish(code, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    // Never leave a review window behind for nothing to close.
    try {
      const left = await window.dspatch.reviewWindowCheck({ action: 'read' });
      for (const entry of (left.detail as ReviewMainReading).reviewWindows) {
        await window.dspatch.reviewWindowCheck({ action: 'close', webContentsId: entry.webContentsId });
      }
    } catch {
      // The exit closes them in any case.
    }
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * The hand-over window (`start-review.cmd`): open P1 from Recent, read the state at rest
 * and stop. Nothing is typed, sent or opened; the window is the person's from here.
 */
async function runReviewHoldScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const [projectOne] = plan.switchProjects ?? [];
  const observations: Record<string, unknown> = {
    plan,
    limits: 'SIMULATED: every chat and review answer is a presentation adapter\'s; no provider is asked anything. The script only opened P1.',
  };
  const samePath = (left: string | null | undefined, right: string | null | undefined): boolean =>
    (left ?? '').replace(/[\\/]+$/, '').toLowerCase() === (right ?? '').replace(/[\\/]+$/, '').toLowerCase();
  try {
    if (projectOne === undefined) {
      throw new Error('the hand-over needs P1 in DSPATCH_CHAT_SWITCH_PROJECTS');
    }
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    if (element('projects') === null) {
      await window.dspatch.pressMenuItem('change-project');
      await waitFor('the project chooser', () => element('projects') !== null, 10_000);
    }
    const rowOf = (): number | null => {
      for (let index = 0; index < 50; index += 1) {
        const found = element(`project-${String(index)}-path`);
        if (found === null) {
          return null;
        }
        if (samePath((found.textContent ?? '').replace(/\s+/g, ' ').trim(), projectOne)) {
          return index;
        }
      }
      return null;
    };
    await waitFor('P1 to be offered in Recent', () => rowOf() !== null, 60_000);
    await click(`open-project-${String(rowOf() ?? 0)}`);
    await waitFor(
      'a session over P1',
      () => textOf('session-id').startsWith('dsp-session-') && samePath(attributeOf('project-path', 'title'), projectOne) && element('projects') === null,
      60_000,
    );
    const reading = (await window.dspatch.reviewWindowCheck({ action: 'read' })).detail as {
      readonly reviewWindows: readonly unknown[];
      readonly chat: { readonly workspacePath: string | null };
      readonly recentReviews: unknown;
      readonly adapterSent: { readonly chat: readonly string[] | null; readonly review: readonly string[] | null };
    };
    steps.push({ step: 'at rest', project: textOf('project-path'), session: textOf('session-id'), turns: countEntries('turn'), main: reading });
    observations['atRest'] = {
      p1Open: samePath(reading.chat.workspacePath, projectOne),
      chatSent: reading.adapterSent.chat?.length ?? null,
      reviewSent: reading.adapterSent.review?.length ?? null,
      reviewWindows: reading.reviewWindows.length,
      recentReviews: reading.recentReviews,
    };
    if (!samePath(reading.chat.workspacePath, projectOne)) failures.push('P1 is not the open project');
    if ((reading.adapterSent.chat?.length ?? -1) !== 0 || (reading.adapterSent.review?.length ?? -1) !== 0) failures.push('something was sent');
    if (reading.reviewWindows.length !== 0) failures.push('a review window was opened by the script');
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-127: the discussion about the code, in the review window               */
/* ------------------------------------------------------------------------- */

/** The discussion panel as the main process reads it from a review window. */
interface DiscussionSeen {
  readonly shown: boolean;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly subject: string;
    readonly text: string;
    readonly questionId: string | null;
    readonly sentPrompt: string | null;
  }[];
  readonly status: {
    readonly turn: { readonly answerId: string | null; readonly stopping: boolean } | null;
    readonly unresolved: readonly { readonly attemptId: string; readonly state: string }[];
    readonly needsAcknowledgement: readonly string[];
  } | null;
  readonly composer: string;
  readonly subjectLine: string;
  readonly statusLine: string;
  readonly error: string;
  readonly errorLine: string;
  readonly contextOpen: number;
}

interface DiscussionMainReading extends ReviewMainReading {
  readonly adapterSent: { readonly chat: readonly string[] | null; readonly review: readonly string[] | null };
  readonly discussionFiles: readonly { readonly file: string; readonly draft?: unknown }[];
}

/**
 * DSP-127 through both windows, with presentation adapters only. The review window is
 * read and operated by the main process through the discussion panel's own controls;
 * the chat window through its own. Every answer, every failure and every slow start is
 * SIMULATED by the presentation adapter.
 */
async function runReviewDiscussionScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const [projectOne, projectTwo] = plan.switchProjects ?? [];
  const SLOW = '[simulate: slow start]';
  const FAILS = '[simulate: send fails]';
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'SIMULATED: every answer is the presentation adapter\'s canned reply, the send failure and the slow ' +
      'start are its own markers (DSPATCH_REVIEW_PRESENTATION_SEND=markers, read for the review adapters only), ' +
      'and no provider was asked anything. The review windows were read and operated by the main process ' +
      'through the discussion panel\'s controls; the definitions were chosen by the scripted file pick.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const failed = new Set<number>();
  const expect = (code: number, ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
      failed.add(code);
    }
  };
  const samePath = (left: string | null | undefined, right: string | null | undefined): boolean =>
    (left ?? '').replace(/[\\/]+$/, '').toLowerCase() === (right ?? '').replace(/[\\/]+$/, '').toLowerCase();
  const clean = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim();
  const rowOf = (target: string): number | null => {
    for (let index = 0; index < 50; index += 1) {
      const found = element(`project-${String(index)}-path`);
      if (found === null) {
        return null;
      }
      if (samePath(clean(found.textContent), target)) {
        return index;
      }
    }
    return null;
  };
  const composerText = (): string => (element('prompt') as HTMLTextAreaElement | null)?.value ?? '';
  const chatState = (): Record<string, unknown> => ({
    project: textOf('project-path'),
    session: textOf('session-id'),
    conversation: textOf('conversation-id'),
    draft: composerText(),
    turns: countEntries('turn'),
  });
  const read = async (label: string): Promise<DiscussionMainReading> => {
    const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
    record(`main reading: ${label}`, { main: answer.detail });
    return answer.detail as DiscussionMainReading;
  };
  const readUntil = async (
    label: string,
    predicate: (reading: DiscussionMainReading) => boolean,
    timeoutMs = 30_000,
  ): Promise<DiscussionMainReading> => {
    const until = performance.now() + timeoutMs;
    for (;;) {
      const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
      const reading = answer.detail as DiscussionMainReading;
      if (predicate(reading)) {
        record(`main reading: ${label}`, { main: reading });
        return reading;
      }
      if (performance.now() > until) {
        record(`main reading: ${label} (timed out)`, { main: reading });
        throw new Error(`timed out waiting for: ${label}. This is a timeout, not a verdict.`);
      }
      await sleep(200);
    }
  };
  const settled = (entry: ReviewWindowSeen): boolean => entry.view !== null && entry.view.kind !== 'opening';
  const windowOf = (reading: DiscussionMainReading, id: number): ReviewWindowSeen | undefined =>
    reading.reviewWindows.find((entry) => entry.webContentsId === id);
  const discussionOf = (reading: DiscussionMainReading, id: number): DiscussionSeen | null =>
    ((windowOf(reading, id) as unknown as { discussion?: DiscussionSeen | null } | undefined)?.discussion ?? null);
  const questionsOf = (seen: DiscussionSeen | null): DiscussionSeen['messages'] =>
    (seen?.messages ?? []).filter((message) => message.role === 'question');
  const answerOf = (seen: DiscussionSeen | null, index: number): DiscussionSeen['messages'][number] | undefined => {
    const question = questionsOf(seen)[index];
    return question === undefined ? undefined : seen?.messages.find((message) => message.role === 'answer' && message.questionId === question.id);
  };
  const reviewSent = (reading: DiscussionMainReading): number => reading.adapterSent.review?.length ?? -1;
  const chatSent = (reading: DiscussionMainReading): number => reading.adapterSent.chat?.length ?? -1;
  const operate = async (
    id: number,
    op: 'read' | 'type' | 'enter' | 'stop' | 'send-anyway' | 'go-to' | 'tab',
    extra: { text?: string; times?: number; index?: number; tab?: 'step' | 'discussion' } = {},
  ): Promise<boolean> => {
    const answer = await window.dspatch.reviewWindowCheck({ action: 'discussion', webContentsId: id, op, ...extra });
    record(`discussion ${op}`, { webContentsId: id, ...extra, ok: answer.ok });
    return answer.ok;
  };
  const openProject = async (label: string, target: string): Promise<void> => {
    if (element('projects') === null) {
      await window.dspatch.pressMenuItem('change-project');
      await waitFor(`the project chooser (to open ${label})`, () => element('projects') !== null, 10_000);
    }
    await waitFor(`${label} to be offered in Recent`, () => rowOf(target) !== null, 60_000);
    await click(`open-project-${String(rowOf(target) ?? 0)}`);
    await waitFor(
      `a session over ${label}`,
      () =>
        textOf('session-id').startsWith('dsp-session-') &&
        samePath(attributeOf('project-path', 'title'), target) &&
        element('projects') === null,
      60_000,
    );
  };
  /** Type a question into the review composer and press Enter `times` times. */
  const ask = async (id: number, text: string, times = 1): Promise<void> => {
    await operate(id, 'type', { text });
    await sleep(100);
    await operate(id, 'enter', { times });
  };
  const streaming = (id: number, index: number) => (reading: DiscussionMainReading): boolean => {
    const answer = answerOf(discussionOf(reading, id), index);
    return answer !== undefined && answer.status === 'streaming' && answer.text.length > 0;
  };
  const answered = (id: number, index: number) => (reading: DiscussionMainReading): boolean => {
    const seen = discussionOf(reading, id);
    return answerOf(seen, index)?.status === 'done' && seen?.status?.turn === null;
  };

  try {
    if (projectOne === undefined || projectTwo === undefined) {
      throw new Error('the scenario needs two projects in DSPATCH_CHAT_SWITCH_PROJECTS (P1;P2)');
    }
    await waitFor(
      'the connection to reach a decided state',
      connectionDecided,
      60_000,
    );

    // --- The main chat on P1 with a draft; review opened on the fixture -----------------
    await openProject('P1', projectOne);
    await typeInto('prompt', 'A chat draft that review must leave alone — DSP-127.');
    const chatBefore = chatState();
    record('chat before review', chatBefore);
    const main0 = await read('before review');
    const chatSent0 = chatSent(main0);
    expect(CHAT_EXIT.reviewDiscussionSentWrong, reviewSent(main0) === 0, 'the review adapters were sent something before review opened');

    // DSP-150: Open review opens a diff window; the walk opens from its Code walks.
    const firstDiff = await openDiffFromChat();
    expect(CHAT_EXIT.reviewWindowWrong, firstDiff.note === null, 'the first Open review drew a note');
    await choosePairInDiff(firstDiff.id);
    await openWalkFromDiff(firstDiff.id, false);
    const chooser = (await readUntil('the walk window', (reading) => reading.reviewWindows.length === 1 && reading.reviewWindows.every(settled))).reviewWindows[0];
    const id = chooser?.webContentsId ?? -1;
    const opened = await readUntil('the review open', (reading) => windowOf(reading, id)?.view?.kind === 'opened');
    const stepIds = windowOf(opened, id)?.view?.stepIds ?? [];
    const [stepA, stepB] = stepIds;
    if (stepA === undefined || stepB === undefined) {
      throw new Error(`the walk needs two steps: ${JSON.stringify(stepIds)}`);
    }

    // --- DSP-126 S1: one window per walk. Opening the same walk again focuses it ------------
    // DSP-150: walks are opened from the diff review's Code walks, over the same pair.
    const againDiff = await openDiffFromChat();
    await choosePairInDiff(againDiff.id);
    await openWalkFromDiff(againDiff.id, true);
    const focusedReading = await read('after opening the same walk again');
    expect(CHAT_EXIT.reviewWindowWrong, focusedReading.reviewWindows.length === 1, `opening the same walk again made ${String(focusedReading.reviewWindows.length)} windows`);
    expect(CHAT_EXIT.reviewWindowWrong, windowOf(focusedReading, id)?.focusCount === 1, `the opened review's focus count is ${String(windowOf(focusedReading, id)?.focusCount)}, not 1`);

    // --- Nothing is sent on open or navigation ----------------------------------------------
    await operate(id, 'tab', { tab: 'discussion' });
    await window.dspatch.reviewWindowCheck({ action: 'go-to-step', webContentsId: id, stepId: stepB, closeAfter: false });
    await window.dspatch.reviewWindowCheck({ action: 'go-to-step', webContentsId: id, stepId: stepA, closeAfter: false });
    const navigated = await readUntil('the discussion shown at the first step', (reading) => discussionOf(reading, id)?.shown === true && windowOf(reading, id)?.view?.position?.stepId === stepA);
    expect(CHAT_EXIT.reviewDiscussionSentWrong, reviewSent(navigated) === 0, `opening and moving around sent ${String(reviewSent(navigated))} prompts`);
    expect(CHAT_EXIT.reviewDiscussionLooksWrong, (discussionOf(navigated, id)?.subjectLine ?? '').startsWith('Walk 1 › b becomes 20 › '), `the subject line at the first step reads "${discussionOf(navigated, id)?.subjectLine ?? ''}"`);

    // --- Q1 on A, slow stream; the window moves to B mid-answer -----------------------------
    await ask(id, 'What does this change do? mark-a');
    await readUntil('the first answer streaming', streaming(id, 0));
    await window.dspatch.reviewWindowCheck({ action: 'go-to-step', webContentsId: id, stepId: stepB, closeAfter: false });
    const q1 = await readUntil('the first answer finished', answered(id, 0), 60_000);
    const seen1 = discussionOf(q1, id);
    const question1 = questionsOf(seen1)[0];
    const answer1 = answerOf(seen1, 0);
    expect(CHAT_EXIT.reviewDiscussionMisplaced, answer1 !== undefined && answer1.questionId === question1?.id && answer1.subject === question1.subject, 'the first answer is not on its question with its subject');
    expect(CHAT_EXIT.reviewDiscussionMisplaced, (question1?.subject ?? '').includes('b becomes 20'), `the first question's subject is "${question1?.subject ?? ''}"`);
    expect(CHAT_EXIT.reviewDiscussionMisplaced, (seen1?.subjectLine ?? '').includes('d is added'), `after the move the next subject is "${seen1?.subjectLine ?? ''}"`);
    expect(CHAT_EXIT.reviewDiscussionMisplaced, (answer1?.text ?? '').includes('What I did for mark-a'), 'the first answer is not the reply to the first question');
    const prompt1 = question1?.sentPrompt ?? '';
    expect(CHAT_EXIT.reviewDiscussionSentWrong, prompt1.includes('2 | export const b = 20;') && !prompt1.includes('WORKING TREE ONLY'), 'the sent prompt does not carry the target blob, or carries the working tree');
    expect(CHAT_EXIT.reviewDiscussionSentWrong, q1.adapterSent.review?.[0] === prompt1 && reviewSent(q1) === 1, 'the adapter was sent something other than the frozen prompt');

    // Go to point brings the window back to A.
    await operate(id, 'go-to', { index: 0 });
    await readUntil('Go to point at A', (reading) => windowOf(reading, id)?.view?.position?.stepId === stepA, 10_000);

    // --- Q2: Stop once its run exists -------------------------------------------------------
    await ask(id, 'Second question, stopped while it answers. mark-b');
    await readUntil('the second answer streaming', streaming(id, 1));
    await operate(id, 'stop');
    const q2 = await readUntil('the second answer stopped', (reading) => {
      const seen = discussionOf(reading, id);
      return answerOf(seen, 1)?.status === 'cancelled' && seen?.status?.turn === null && seen.status.unresolved.length === 0;
    });
    record('second answer stopped', { status: discussionOf(q2, id)?.status ?? null });

    // --- Q3: Stop before its run exists -----------------------------------------------------
    await ask(id, `Third question, stopped before its run exists. mark-c ${SLOW}`);
    await readUntil('the third question waiting on the provider', (reading) => questionsOf(discussionOf(reading, id)).length === 3 && discussionOf(reading, id)?.status?.turn !== null, 5_000);
    await operate(id, 'stop');
    const abandoned = await read('right after Stop before the run');
    const abandonedSeen = discussionOf(abandoned, id);
    expect(CHAT_EXIT.reviewDiscussionStopWrong, abandonedSeen?.status?.turn === null && (abandonedSeen.status.unresolved.some((attempt) => attempt.state === 'outcome-unknown')), `Stop before the run did not leave an unknown outcome: ${JSON.stringify(abandonedSeen?.status)}`);
    expect(CHAT_EXIT.reviewDiscussionStopWrong, questionsOf(abandonedSeen)[2]?.status === 'unknown', `the third question reads ${String(questionsOf(abandonedSeen)[2]?.status)}, not unknown`);
    const q3 = await readUntil('the late run cancelled and confirmed', (reading) => {
      const seen = discussionOf(reading, id);
      return seen?.status?.unresolved.length === 0 && answerOf(seen, 2)?.status === 'cancelled';
    }, 15_000);
    record('third question after its late run was stopped', { status: discussionOf(q3, id)?.status ?? null });
    expect(CHAT_EXIT.reviewDiscussionStopWrong, questionsOf(discussionOf(q3, id))[2]?.status === 'sent', `after the confirmed late cancel the third question reads ${String(questionsOf(discussionOf(q3, id))[2]?.status)}, not sent`);

    // --- Q4: a simulated send failure for the review adapter alone -------------------------
    const failingText = `Fourth question, refused by the simulated adapter. mark-d ${FAILS}`;
    await ask(id, failingText);
    const q4 = await readUntil('the refusal shown', (reading) => (discussionOf(reading, id)?.error ?? '') !== '');
    const seen4 = discussionOf(q4, id);
    expect(CHAT_EXIT.reviewDiscussionStopWrong, (seen4?.error ?? '').includes('simulated send failure'), `the error reads "${seen4?.error ?? ''}"`);
    expect(
      CHAT_EXIT.reviewDiscussionLooksWrong,
      (seen4?.errorLine ?? '').startsWith('Presentation adapter: simulated send failure') && !(seen4?.errorLine ?? '').includes('PresentationSendFailed'),
      `the error line shows "${seen4?.errorLine ?? ''}"`,
    );
    expect(CHAT_EXIT.reviewDiscussionStopWrong, seen4?.composer === failingText, 'the question text was not kept after the failure');
    expect(CHAT_EXIT.reviewDiscussionStopWrong, questionsOf(seen4)[3]?.status === 'failed', 'the failed question is not marked failed');
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, chatSent(q4) === chatSent0, 'the chat adapter was sent something by the review failure');
    await operate(id, 'type', { text: '' });

    // --- The chat untouched so far ----------------------------------------------------------
    const chatNow = chatState();
    record('chat before its own sends', chatNow);
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, JSON.stringify(chatNow) === JSON.stringify(chatBefore), `the chat changed while review discussed: ${JSON.stringify(chatNow)} against ${JSON.stringify(chatBefore)}`);

    // --- Q5 while the main chat sends -------------------------------------------------------
    await ask(id, 'Fifth question, answered while the chat sends. mark-e');
    await readUntil('the fifth answer streaming', streaming(id, 4));
    const turnsBefore = countEntries('turn');
    await typeInto('prompt', 'A chat message sent while a review answer arrives.');
    await sendFromComposer();
    await waitFor('the chat turn to finish', () => countEntries('turn') > turnsBefore && element('active-answer') === null, 60_000);
    const q5 = await readUntil('the fifth answer finished', answered(id, 4), 60_000);
    const answer5 = answerOf(discussionOf(q5, id), 4);
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, (answer5?.text ?? '').includes('What I did for mark-e') && !(answer5?.text ?? '').includes('A chat message'), 'the fifth review answer is not its own');
    const thread = element('transcript')?.textContent ?? '';
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, !thread.includes('mark-e') && !thread.includes('Fifth question'), 'review text appeared in the chat');
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, chatSent(q5) === chatSent0 + 1, `the chat adapter was sent ${String(chatSent(q5) - chatSent0)} prompts, not 1`);

    // --- Q6 while the main chat sends and cancels -------------------------------------------
    await ask(id, 'Sixth question, answered while the chat cancels. mark-f');
    await readUntil('the sixth answer streaming', streaming(id, 5));
    await typeInto('prompt', 'A chat message cancelled while a review answer arrives.');
    await sendFromComposer();
    await waitFor('the chat answer to start', () => element('active-answer') !== null, 30_000);
    await click('cancel');
    await waitFor('the chat turn to end', () => element('active-answer') === null, 60_000);
    const q6 = await readUntil('the sixth answer finished', answered(id, 5), 60_000);
    const seen6 = discussionOf(q6, id);
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, (answerOf(seen6, 5)?.text ?? '').includes('Finally, this must be text') && seen6?.status?.unresolved.length === 0, 'the review answer did not finish whole beside the chat\'s cancel');

    // --- Q7: Enter three times sends once ---------------------------------------------------
    const sentBefore = reviewSent(q6);
    await ask(id, 'Seventh question, Enter pressed three times. mark-g', 3);
    const q7 = await readUntil('the seventh answer finished', answered(id, 6), 60_000);
    expect(CHAT_EXIT.reviewDiscussionSentWrong, reviewSent(q7) === sentBefore + 1 && questionsOf(discussionOf(q7, id)).length === 7, `three Enters sent ${String(reviewSent(q7) - sentBefore)} prompts`);

    // --- Pictures: shown and hidden, at 1400 px and about 1000 px -----------------------------
    const pictures: Record<string, unknown> = {};
    pictures['shown'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: id, label: 'discussion-shown', width: 1400 })).detail;
    pictures['shown-narrow'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: id, label: 'discussion-shown-narrow', width: 1000 })).detail;
    const atRest = await read('the discussion at rest');
    expect(CHAT_EXIT.reviewDiscussionLooksWrong, discussionOf(atRest, id)?.contextOpen === 0, 'a Context disclosure is open at rest');
    await operate(id, 'tab', { tab: 'step' });
    await sleep(300);
    pictures['hidden'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: id, label: 'discussion-hidden', width: 1400 })).detail;
    pictures['hidden-narrow'] = (await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: id, label: 'discussion-hidden-narrow', width: 1000 })).detail;
    record('discussion pictures', pictures);
    for (const [name, picture] of Object.entries(pictures)) {
      const view = (picture as { view?: { overflowX?: boolean } } | undefined)?.view;
      expect(CHAT_EXIT.reviewDiscussionLooksWrong, view?.overflowX === false, `the review window overflows horizontally (${name})`);
    }
    const hidden = await read('the discussion hidden');
    expect(CHAT_EXIT.reviewDiscussionLooksWrong, discussionOf(hidden, id)?.shown === false, 'the Step tab did not hide the discussion');
    await operate(id, 'tab', { tab: 'discussion' });

    // --- The draft across a close, and the thread back without a send ----------------------
    const draft = 'A review draft kept across a close. mark-h';
    await operate(id, 'type', { text: draft });
    await sleep(900);
    const sentBeforeClose = reviewSent(await read('before the close'));
    await window.dspatch.reviewWindowCheck({ action: 'close', webContentsId: id });
    const reopenDiff = await openDiffFromChat();
    expect(CHAT_EXIT.reviewWindowWrong, reopenDiff.note === null, 'reopening drew a note');
    await choosePairInDiff(reopenDiff.id);
    await openWalkFromDiff(reopenDiff.id, true);
    const reopened = await readUntil('the review reopened', (reading) => reading.reviewWindows.length === 1 && reading.reviewWindows.every((entry) => entry.view?.kind === 'opened') && discussionOf(reading, reading.reviewWindows[0]?.webContentsId ?? -1) !== null);
    const id2 = reopened.reviewWindows[0]?.webContentsId ?? -1;
    await operate(id2, 'tab', { tab: 'discussion' });
    const back = await readUntil('the thread and draft back', (reading) => questionsOf(discussionOf(reading, id2)).length === 7 && discussionOf(reading, id2)?.composer === draft, 10_000);
    expect(CHAT_EXIT.reviewDiscussionSentWrong, reviewSent(back) === sentBeforeClose, 'reopening sent something');

    // --- Two review windows keep their own drafts --------------------------------------------
    // DSP-150: a walk belongs to its repository and revision pair, so the second walk over
    // P1's pair is opened from P1's diff review; it used to come from P2's chooser.
    const twoDiff = await openDiffFromChat();
    expect(CHAT_EXIT.reviewWindowWrong, twoDiff.note === null, 'Open review for the second walk drew a note');
    await choosePairInDiff(twoDiff.id);
    await openWalkFromDiff(twoDiff.id, false);
    const two = await readUntil('a second review window', (reading) => reading.reviewWindows.length === 2 && reading.reviewWindows.every(settled));
    const otherId = two.reviewWindows.find((entry) => entry.webContentsId !== id2)?.webContentsId ?? -1;
    await readUntil('the second review open', (reading) => windowOf(reading, otherId)?.view?.kind === 'opened' && discussionOf(reading, otherId) !== null);
    await operate(otherId, 'tab', { tab: 'discussion' });
    const secondDraft = 'A draft in the second review window. mark-i';
    await operate(otherId, 'type', { text: secondDraft });
    await sleep(900);
    const drafts = await read('two windows, two drafts');
    expect(CHAT_EXIT.reviewDiscussionDraftLost, discussionOf(drafts, id2)?.composer === draft && discussionOf(drafts, otherId)?.composer === secondDraft, 'the two review windows do not keep their own drafts');
    expect(CHAT_EXIT.reviewDiscussionDraftLost, questionsOf(discussionOf(drafts, otherId)).length === 0, 'the second review shows the first review\'s thread');
    const storedDrafts = drafts.discussionFiles.map((entry) => entry.draft).sort();
    expect(CHAT_EXIT.reviewDiscussionDraftLost, JSON.stringify(storedDrafts) === JSON.stringify([draft, secondDraft].sort()), `the stored drafts are ${JSON.stringify(storedDrafts)}`);

    // --- Close everything; what each adapter was sent ----------------------------------------
    for (const entry of drafts.reviewWindows) {
      await window.dspatch.reviewWindowCheck({ action: 'close', webContentsId: entry.webContentsId });
    }
    const end = await read('after all review windows closed');
    expect(CHAT_EXIT.reviewWindowWrong, end.reviewWindows.length === 0, 'a review window was left open');
    expect(CHAT_EXIT.reviewDiscussionSentWrong, reviewSent(end) === 7, `the review adapters were sent ${String(reviewSent(end))} prompts for seven questions`);
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, chatSent(end) === chatSent0 + 2, `the chat adapter was sent ${String(chatSent(end) - chatSent0)} prompts for two chat messages`);
    expect(CHAT_EXIT.reviewDiscussionTouchedChat, (end.adapterSent.chat ?? []).every((text) => !text.includes('mark-')), 'a review question reached the chat adapter');
    expect(CHAT_EXIT.reviewTouchedLoops, end.loops.current === null && JSON.stringify(end.loops.loopRunFiles) === JSON.stringify(main0.loops.loopRunFiles), 'a loop run was announced or the loop-run records changed');
    observations['discussionFiles'] = end.discussionFiles;
    await window.dspatch.captureWindow('chat-at-end');

    const code = failures.length === 0 ? CHAT_EXIT.ok : failed.size === 0 ? CHAT_EXIT.scriptFailed : Math.min(...failed);
    return finish(code, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    try {
      const left = await window.dspatch.reviewWindowCheck({ action: 'read' });
      for (const entry of (left.detail as ReviewMainReading).reviewWindows) {
        await window.dspatch.reviewWindowCheck({ action: 'close', webContentsId: entry.webContentsId });
      }
    } catch {
      // The exit closes them in any case.
    }
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-149: start page, a conversation, a workspace of several folders       */
/* ------------------------------------------------------------------------- */

/** Words from the old start page that must not be on the new one, anywhere on it. */
const OLD_START_PAGE_WORDS = [
  'Saved conversations',
  'Read this back',
  'Export a copy',
  'Show the file',
  'Forget',
  'opened before',
  'generated sample',
  'sample project',
  'snapshot',
  'DSPATCH_PROJECT_PATH',
  'git repository',
  'format version',
  'dsp-session',
];

/** The whole start page as text, including whatever is below the visible area. */
function startPageText(): string {
  return (element('start-page')?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Screenshots of the start page: normal, narrow and low, each scrolled to its end too. */
async function captureStartPage(label: string, record: (name: string, detail: Record<string, unknown>) => void): Promise<void> {
  const sizes: readonly (readonly [string, number, number])[] = [
    ['normal', 1440, 940],
    ['narrow', 720, 940],
    ['low', 1280, 560],
  ];
  for (const [name, width, height] of sizes) {
    const contentWidth = await window.dspatch.setWindowWidth(width, height);
    await sleep(400);
    const page = element('start-page');
    if (page !== null) {
      page.scrollTop = 0;
    }
    await sleep(120);
    await window.dspatch.captureWindow(`${label}-${name}`);
    const scrollRange = page === null ? 0 : page.scrollHeight - page.clientHeight;
    if (page !== null && scrollRange > 0) {
      page.scrollTop = scrollRange;
      await sleep(150);
      await window.dspatch.captureWindow(`${label}-${name}-scrolled`);
      page.scrollTop = 0;
    }
    record(`start page captured (${label}, ${name})`, {
      contentWidth,
      innerHeight: window.innerHeight,
      scrollRangePx: scrollRange,
      documentScrolls: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    });
  }
  await window.dspatch.setWindowWidth(1440, 940);
  await sleep(300);
}

/**
 * The connected flow, in two processes over one isolated user-data folder.
 *
 * `first`: the start page (empty Recent), a conversation with no workspace, a workspace
 * of two folders created by the chat's own tools and opened with the conversation
 * carried in, the agent's folders read back, a third folder added from the menu's path.
 *
 * `again` (a restart): Recent with the workspace and seeded long entries, a new
 * conversation carried into the existing workspace as a chat of its own, the folders
 * after the restart, the history view, and Remove from recent.
 *
 * SIMULATED: every reply and every tool call comes from the presentation adapter, which
 * calls the session's real DSpatch tools when a prompt names them. No provider is
 * called. The host, the store, the conversation files and the window are the real ones.
 */
async function runWorkspaceFlowScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const root = plan.flowRoot ?? '';
  const sep = root.includes('\\') ? '\\' : '/';
  const alpha = `${root}${sep}alpha`;
  const beta = `${root}${sep}beta`;
  const gamma = `${root}${sep}gamma`;
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider: the presentation adapter answered every message and made the tool ' +
      'calls a prompt named, through the session’s own DSpatch tools. No model chose those calls. ' +
      'The host process, the stores, the conversation files and the window are real.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const lower = (text: string): string => text.toLowerCase();
  const historyTurns = (): number => document.querySelectorAll('[data-ev^="history-turn-"][data-ended]').length;
  const answerOf = (index: number): string => textOf(`turn-${String(index)}-answer`);

  try {
    await waitFor('the start page', () => element('start-page') !== null, 60_000);
    const text = startPageText();
    const leftovers = OLD_START_PAGE_WORDS.filter((word) => lower(text).includes(lower(word)));
    expect(leftovers.length === 0, `the start page still says: ${leftovers.join(', ')}`);
    for (const gone of ['conversations', 'diagnostics', 'sample-projects', 'projects']) {
      expect(element(gone) === null, `the start page has the old "${gone}" panel`);
    }
    expect(element('open-project') !== null && element('remote-session') !== null, 'both entrances are on the start page');
    // The Remote Session form: only the tunnel's local end, and a refusal in a sentence (DSP-111).
    await click('remote-session');
    await waitFor('the Remote Session form', () => element('remote-form') !== null, 5_000);
    await typeIntoField('remote-address', '10.0.0.5:22');
    await typeIntoField('remote-token', 'not-a-token');
    await click('remote-connect');
    await waitFor('the refusal', () => (element('remote-form')?.textContent ?? '').includes('SSH tunnel: a port'), 5_000);
    await window.dspatch.captureWindow('remote-form');
    record('Remote Session form', { refused: true });
    await click('remote-cancel');
    await waitFor('the entrances again', () => element('open-project') !== null, 5_000);
    record('start page read', { text, leftovers, recentRows: document.querySelectorAll('[data-ev^="open-project-"]').length });
    await captureStartPage(phase === 'first' ? 'start-empty' : 'start-recent', record);

    if (phase === 'first') {
      // 1. A conversation with no workspace.
      await typeInto('start-prompt', 'I want to work on the agent integration across two projects.');
      await click('start-send');
      await waitFor('the first reply', () => element('active-answer') === null && element('turn-0-answer') !== null, 60_000);
      expect(element('no-workspace') !== null, 'the conversation shows that it has no workspace yet');
      record('conversation with no workspace', { answer: answerOf(0) });
      await window.dspatch.captureWindow('loose-conversation');

      // 2. A workspace of two folders, created through the chat's tools.
      const find = JSON.stringify({ names: ['alpha', 'beta'], under: root });
      const create = JSON.stringify({ name: 'Agentintegration', folders: [alpha, beta] });
      await sendAndSettle(1, `Create it from alpha and beta. [[tool find_folders ${find}]] [[tool create_workspace ${create}]]`, 60_000);
      record('tool calls answered', { answer: answerOf(1) });
      expect(/Created the workspace "Agentintegration"/.test(answerOf(1)), 'create_workspace did not report the workspace');
      await waitFor('the workspace to open with the conversation', () => textOf('workspace-name') === 'Agentintegration', 30_000);
      const carried = historyTurns();
      expect(carried >= 2, `the conversation did not come with it (${String(carried)} earlier turns shown)`);
      expect(element('no-workspace') === null, 'the window still says there is no workspace');
      record('workspace opened with the conversation', {
        historyTurns: carried,
        rootsShown: document.querySelectorAll('.tree-row--root').length,
        continuity: textOf('continuity-statement'),
      });
      await window.dspatch.captureWindow('workspace-opened');

      // The context goes with it in the background: no panel, no summary, no extra message.
      const visible = document.body.innerText;
      for (const word of ['The agent does not have the earlier conversation', 'This summary will be sent', 'Remove summary']) {
        expect(!visible.includes(word), `the conversation still shows "${word}"`);
      }
      expect(element('new-session-block') === null || element('new-session-block')?.offsetParent === null, 'the new-session panel is on screen');

      // 3. The same conversation continues, with both folders and its earlier context;
      // the working indicator and Stop are there while the agent works.
      await typeInto('prompt', 'Go on with what I asked. [[context]] [[folders]]');
      await sendFromComposer();
      await waitFor('the working indicator', () => element('working-indicator') !== null, 10_000);
      expect(element('cancel') !== null, 'there is no Stop button while the agent works');
      expect(!document.body.innerText.includes('streaming…'), 'a "streaming…" label is in the conversation');
      await window.dspatch.captureWindow('working');
      await waitFor('turn 0 to finish', () => element('active-answer') === null && element('turn-0-answer') !== null, 60_000);
      expect(element('working-indicator') === null, 'the working indicator stayed after the turn');
      const carriedMessages = Number(/Earlier conversation received: yes, (\d+) earlier messages/.exec(answerOf(0))?.[1] ?? '0');
      expect(carriedMessages >= 2, `the earlier conversation did not reach the agent (${String(carriedMessages)} messages)`);
      expect(lower(answerOf(0)).includes(lower(alpha)) && lower(answerOf(0)).includes(lower(beta)), 'the session was not given both folders');
      expect(!document.body.innerText.includes('How this turn arrived'), '"How this turn arrived" is in the conversation');
      record('both folders and the context given', { answer: answerOf(0), carriedMessages });

      // Session details hold the turn facts and the carried context instead.
      await window.dspatch.pressMenuItem('show-session-details');
      await waitFor('the turn facts in Session details', () => element('turn-facts') !== null, 10_000);
      await window.dspatch.captureWindow('session-details-turns');
      await window.dspatch.pressMenuItem('hide-session-details');

      // The model: chosen in the window, it is the id the next turn reaches the adapter with.
      await chooseInSelect('model-select', 'claude-sonnet-4-5');
      await sleep(300);
      await sendAndSettle(1, 'Which model? [[model]]', 60_000);
      expect(answerOf(1).includes('Model requested by this turn: claude-sonnet-4-5'), 'the chosen model did not reach the adapter');
      // A model this account is not offered is refused, with a reason, and nothing is replaced.
      await window.dspatch.setRequestedModel('model-that-is-not-offered');
      await typeInto('prompt', 'This must not go. [[model]]');
      await sendFromComposer();
      await waitFor('the refusal', () => textOf('action-error').length > 0, 15_000);
      expect(/is not one .* offers this account/.test(textOf('action-error')), `the refusal does not explain itself: ${textOf('action-error')}`);
      expect(element('turn-2-answer') === null, 'a message went with an unoffered model');
      record('unoffered model refused', { refusal: textOf('action-error') });
      await window.dspatch.setRequestedModel('claude-sonnet-4-5');
      await typeInto('prompt', '');

      // 4. A third folder, through the same function as File > Add Folder to Workspace.
      await window.dspatch.addFolderToWorkspace(gamma);
      await waitFor('three folders in the sidebar', () => document.querySelectorAll('.tree-row--root').length === 3, 20_000);
      await sendAndSettle(2, 'And now? [[folders]]', 60_000);
      expect(lower(answerOf(2)).includes(lower(gamma)), 'the added folder did not reach the session');
      record('third folder given', { answer: answerOf(2) });
      await window.dspatch.captureWindow('workspace-three-folders');
      observations['conversations'] = (await window.dspatch.listConversations()).entries.map((entry) => ({
        id: entry.conversationId,
        project: entry.projectPath,
        messages: entry.messageCount,
      }));
    } else {
      // 1. After the restart: the workspace in Recent, one entry, with its folders; the
      // model chosen before the restart is still chosen.
      const models = await window.dspatch.listModels('cursor');
      expect(models.chosen === 'claude-sonnet-4-5', `the model choice did not survive the restart (${models.chosen})`);
      const names = [...document.querySelectorAll('[data-ev^="open-project-"]')].map((node) => node.textContent ?? '');
      expect(names.includes('Agentintegration'), 'the workspace is not in Recent after a restart');
      const before = (await window.dspatch.listConversations()).entries.map((entry) => entry.conversationId);

      // 2. A new conversation, then the existing workspace: a chat of its own there.
      await typeInto('start-prompt', 'One more idea before I open the workspace.');
      await click('start-send');
      await waitFor('the reply', () => element('active-answer') === null && element('turn-0-answer') !== null, 60_000);
      await click('loose-recent');
      await waitFor('Recent projects', () => element('projects') !== null, 10_000);
      const row = [...document.querySelectorAll('[data-ev^="open-project-"]')].findIndex((node) => node.textContent === 'Agentintegration');
      expect(row >= 0, 'Agentintegration is not in the Recent dialog');
      await click(`open-project-${String(Math.max(row, 0))}`);
      await waitFor('the workspace to open', () => textOf('workspace-name') === 'Agentintegration', 30_000);
      const chats = document.querySelectorAll('[data-ev^="workspace-chat-"]').length;
      expect(chats >= 2, `the earlier chat is not kept beside the new one (${String(chats)} chats)`);
      expect(historyTurns() === 1, `the new chat shows ${String(historyTurns())} earlier turns; it should show only its own`);
      record('existing workspace opened with a new chat', { chats, historyTurns: historyTurns() });

      // 3. Name, folders and history after the restart.
      await sendAndSettle(0, 'Which folders? [[folders]]', 60_000);
      for (const folder of [alpha, beta, gamma]) {
        expect(lower(answerOf(0)).includes(lower(folder)), `${folder} is not given after the restart`);
      }
      await window.dspatch.captureWindow('workspace-after-restart');
      const after = (await window.dspatch.listConversations()).entries.map((entry) => entry.conversationId);
      expect(before.every((id) => after.includes(id)), 'an earlier conversation is missing');

      // 4. The history view reaches every conversation.
      await window.dspatch.pressMenuItem('show-history');
      await waitFor('the history view', () => element('history') !== null && element('conversations') !== null, 10_000);
      const listed = document.querySelectorAll('[data-ev^="conversation-project-"]').length;
      expect(listed >= after.length, 'the history view does not list every conversation');
      await window.dspatch.captureWindow('history');
      await click('history-close');
      record('history', { listed, conversations: after.length });

      // 5. Remove from recent: the entry only.
      await window.dspatch.pressMenuItem('change-project');
      await waitFor('Recent projects', () => element('projects') !== null, 10_000);
      const rowsBefore = document.querySelectorAll('[data-ev^="open-project-"]').length;
      const target = [...document.querySelectorAll('[data-ev^="open-project-"]')].findIndex((node) => node.textContent !== 'Agentintegration');
      if (target >= 0) {
        const path = textOf(`project-${String(target)}-path`);
        await click(`project-menu-${String(target)}`);
        await click(`remove-from-recent-${String(target)}`);
        await waitFor('the entry to leave the list', () => document.querySelectorAll('[data-ev^="open-project-"]').length === rowsBefore - 1, 10_000);
        record('removed from recent', { path, rowsBefore });
      }
      await click('dialog-close');
    }
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-149: the real model list, through the host and the dropdown            */
/* ------------------------------------------------------------------------- */

/**
 * The model dropdown against the provider's real SDK: Claude is chosen, the start page's
 * dropdown fills from the host's lookup (Claude Code's own `supportedModels()`), a model
 * is chosen and the choice is kept. **No message is sent**, so no model turn runs; the
 * lookup does start Claude Code and use the existing login. Cursor is never chosen.
 */
async function runModelListScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'REAL SDK: the list comes from the installed Claude Agent SDK through the project host. ' +
      'No message was sent and no model turn ran. Which model a reply uses is not observed here.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  try {
    await waitFor('the start page', () => element('start-page') !== null, 60_000);
    await chooseInSelect('open-agent-select', 'claude');
    await waitFor(
      'the model list to be read',
      () => {
        const select = element('model-select');
        return (select instanceof HTMLSelectElement && !select.disabled) || element('model-list-error') !== null;
      },
      90_000,
    );
    const error = textOf('model-list-error-detail');
    const options = [...((element('model-select') as HTMLSelectElement | null)?.options ?? [])].map((option) => ({
      value: option.value,
      label: option.textContent ?? '',
    }));
    record('model list on the start page', { error, options });
    observations['options'] = options;
    if (error !== '' || options.length < 2) {
      failures.push(`the dropdown did not get the real list: ${error === '' ? `${String(options.length)} options` : error}`);
    }
    await window.dspatch.captureWindow('model-list');
    const pick = options.find((option) => option.value === 'sonnet') ?? options[1];
    if (pick !== undefined) {
      await chooseInSelect('model-select', pick.value);
      await sleep(500);
      const kept = await window.dspatch.listModels('claude');
      record('model chosen', { picked: pick.value, kept: kept.chosen, source: kept.source });
      if (kept.chosen !== pick.value) {
        failures.push(`the choice was not kept (${kept.chosen})`);
      }
      await window.dspatch.captureWindow('model-chosen');
    }
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * DSP-149: the start page's model choice after an ordinary start with Claude saved as
 * the agent. Touches nothing: it records what the dropdown shows, twice a second, until
 * it settles or a minute has passed, and photographs it.
 */
async function runModelStartScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const startedAt = performance.now();
  const readings: unknown[] = [];
  const read = (): Record<string, unknown> => {
    const select = element('model-select') as HTMLSelectElement | null;
    return {
      atMs: Math.round(performance.now() - startedAt),
      present: select !== null,
      disabled: select?.disabled ?? null,
      value: select?.value ?? null,
      shown: select === null ? null : (select.selectedOptions[0]?.textContent ?? ''),
      options: select?.options.length ?? 0,
      agent: (element('open-agent-select') as HTMLSelectElement | null)?.value ?? null,
      error: textOf('model-list-error-detail'),
      title: select?.closest('label')?.getAttribute('title') ?? null,
    };
  };
  try {
    await waitFor('the start page', () => element('start-page') !== null, 60_000);
    for (let index = 0; index < 120; index += 1) {
      const reading = read();
      readings.push(reading);
      if (reading['present'] === true && reading['disabled'] === false && Number(reading['options']) > 1) {
        break;
      }
      await sleep(500);
    }
    await window.dspatch.captureWindow('model-start');
    const last = read();
    steps.push({ step: 'settled', ...last });
    // What a real click on the dropdown reaches: the topmost element at points across it.
    const select = element('model-select');
    if (select !== null) {
      const box = select.getBoundingClientRect();
      const hits = [0.1, 0.5, 0.9].map((fraction) => {
        const x = box.left + box.width * fraction;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          fraction,
          x: Math.round(x),
          y: Math.round(y),
          reachesTheSelect: hit !== null && (hit === select || select.contains(hit) || hit.contains(select) === false && hit.closest('label') === select.closest('label')),
          hit: hit === null ? null : `${hit.tagName.toLowerCase()}.${hit.className}`,
        };
      });
      steps.push({ step: 'hit test', windowWidth: window.innerWidth, hits });
      if (hits.some((entry) => !entry.reachesTheSelect)) {
        failures.push(`a click on part of the model dropdown reaches something else: ${JSON.stringify(hits)}`);
      }
    }
    if (last['disabled'] !== false || Number(last['options']) <= 1) {
      failures.push(`the model choice did not become usable: ${JSON.stringify(last)}`);
    }
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, { plan, readings });
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, { plan, readings });
  }
}

/**
 * DSP-149: the model choice through the real app, against the real Claude SDK, in four
 * processes over one isolated user-data folder (`flowPhase`):
 *
 * - `first`: Claude saved as the agent, no model chosen. The start page shows the model
 *   the provider's default resolves to, by name; a click reaches the dropdown; another
 *   model is chosen.
 * - `again`: after a restart the chosen model is shown and is what the host asks for.
 * - `retry`: the first lookup fails (SIMULATED, DSPATCH_FAIL_MODEL_LIST_ONCE); the saved
 *   choice stays shown, Try again reads the real list.
 * - `switch`: no agent saved; Claude is chosen actively and its list arrives.
 *
 * No message is sent anywhere, so no model turn runs; Cursor is never chosen.
 */
async function runModelFlowScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const select = (): HTMLSelectElement | null => element('model-select') as HTMLSelectElement | null;
  const state = (): Record<string, unknown> => ({
    state: select()?.dataset['state'] ?? null,
    disabled: select()?.disabled ?? null,
    value: select()?.value ?? null,
    shown: select()?.selectedOptions[0]?.textContent ?? null,
    options: select()?.options.length ?? 0,
  });
  const ready = (): boolean => select()?.dataset['state'] === 'ready' && select()?.disabled === false;
  const reachable = (): boolean => {
    const target = select();
    if (target === null) {
      return false;
    }
    const box = target.getBoundingClientRect();
    return [0.1, 0.5, 0.9].every((fraction) => {
      const hit = document.elementFromPoint(box.left + box.width * fraction, box.top + box.height / 2);
      return hit === target || (hit !== null && target.contains(hit));
    });
  };
  const loadingSeen = (): boolean => select()?.selectedOptions[0]?.textContent === 'Loading models…';
  try {
    await waitFor('the start page', () => element('start-page') !== null, 60_000);
    let sawLoading = loadingSeen();
    if (phase === 'switch') {
      await chooseInSelect('open-agent-select', 'claude');
      sawLoading = sawLoading || loadingSeen();
    }
    if (phase === 'retry') {
      await waitFor('the failed lookup', () => element('model-list-error') !== null, 60_000);
      record('lookup failed', { ...state(), why: textOf('model-list-error-detail') });
      expect(select()?.selectedOptions[0]?.textContent === 'sonnet', 'the saved choice is not shown while the list is missing');
      await window.dspatch.captureWindow('model-retry-failed');
      await click('model-list-retry');
    }
    const until = performance.now() + 90_000;
    while (!ready() && performance.now() < until) {
      sawLoading = sawLoading || loadingSeen();
      await sleep(100);
    }
    record('dropdown', { ...state(), sawLoading, reachable: reachable(), shownNever: "Provider's default" });
    expect(ready(), `the dropdown did not become usable: ${JSON.stringify(state())}`);
    expect(reachable(), 'a click on the dropdown does not reach it');
    expect(!(select()?.selectedOptions[0]?.textContent ?? '').includes("Provider's default"), 'it shows "Provider\'s default"');
    expect((select()?.options.length ?? 0) > 3, 'the list is not the provider\'s');
    if (phase === 'first' || phase === 'switch') {
      expect(/ · default$/.test(select()?.selectedOptions[0]?.textContent ?? ''), 'with no choice, the default model is not shown by name');
    }
    if (phase === 'again' || phase === 'retry') {
      expect(select()?.value === 'sonnet', `the choice made before was not kept (${select()?.value ?? 'none'})`);
    }
    await window.dspatch.captureWindow(`model-${phase}`);
    if (phase === 'first') {
      await chooseInSelect('model-select', 'sonnet');
      await sleep(400);
      const kept = await window.dspatch.listModels('claude');
      record('chosen', { kept: kept.chosen });
      expect(kept.chosen === 'sonnet', 'the choice did not reach the host');
      await window.dspatch.captureWindow('model-first-chosen');
    }
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, { plan, phase });
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, { plan, phase });
  }
}

function finish(
  exitCode: number,
  steps: readonly unknown[],
  failures: readonly string[],
  observations: Readonly<Record<string, unknown>>,
): ScriptedRunReport {
  return {
    passed: exitCode === CHAT_EXIT.ok && failures.length === 0,
    exitCode,
    steps,
    failures,
    observations,
  };
}

/* ------------------------------------------------------------------------- */
/* DSP-147: steering the running work, the composer, and the lock with Run    */
/* ------------------------------------------------------------------------- */

/**
 * Steering through the real window, host and loop, against the presentation adapter's
 * SIMULATED steering (shaped like the Claude adapter's: accepted at once, delivered when
 * the turn folds it in at its next step; `[[steer-late]]` answers as a turn that had just
 * ended). Every press is a real click on a control or Enter in the box.
 *
 * In order: a chat turn steered by the Steering button and by Enter, one turn and one
 * run; Run refused while the agent works; a message and a loop start refused while the
 * person's command runs, with the draft kept; a loop start that clears only what was
 * sent; steering into the working loop step, with Pause between; the later step briefed
 * with it; a second run where the step has ended as the message arrives, so the next
 * step takes it; and Stop. What it cannot show is when a real model reads a message.
 */
async function runSteeringScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'SIMULATED provider, SIMULATED steering and a SIMULATED unconfirmed stop (presentation ' +
      'adapter). The window, the host, the loop runner, the lock, the attempt ledger, the ' +
      'stores and the run records are real. When a real model reads a steering message, and ' +
      'how a real Claude Code process behaves after a stop, are not shown here.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const box = (): string => (element('prompt') as HTMLTextAreaElement | null)?.value ?? '';
  const entries = (): HTMLElement[] => [
    ...document.querySelectorAll<HTMLElement>('[data-ev^="instruction-"][data-state]'),
  ];
  const entryWith = (text: string): HTMLElement | null =>
    entries().find((entry) => (entry.textContent ?? '').includes(text)) ?? null;
  const stateOf = (text: string): string => entryWith(text)?.dataset['state'] ?? 'absent';
  /** The line under a message in the conversation, or '' when there is none. */
  const lineUnder = (text: string): string =>
    entryWith(text)?.querySelector('[data-ev$="-account"]')?.textContent ?? '';
  const quietUnder = (text: string): boolean =>
    entryWith(text)?.querySelector('.turn__meta--quiet') !== null &&
    entryWith(text)?.querySelector('.turn__meta--quiet') !== undefined;
  /** The full account, as Session details holds it. */
  const detailsFor = (text: string): string =>
    [...document.querySelectorAll<HTMLElement>('[data-ev="steering-facts"] li')]
      .find((row) => (row.textContent ?? '').includes(text))
      ?.textContent ?? '';
  const withDetails = async <T,>(read: () => T): Promise<T> => {
    await window.dspatch.pressMenuItem('show-session-details');
    await sleep(300);
    const value = read();
    await clickAny('details-back', 5_000).catch(() => undefined);
    await sleep(200);
    return value;
  };
  const chatWorking = (): boolean =>
    element('active-answer') !== null && rawTextOf('active-answer').length > 0;
  const chatSettled = (index: number) => (): boolean =>
    element('active-answer') === null && element(`turn-${String(index)}-answer`) !== null;
  const turnsShown = (): number => countEntries('turn');

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor(
      'a session to open',
      () => textOf('session-id') !== '' && element('prompt') !== null,
      30_000,
    );
    const workspace = textOf('test-cwd');

    // --- 1. A chat turn, steered by the button and by Enter ---------------------
    await typeInto('prompt', '[[slow]] Look at the build, mark-chat.');
    await sendFromComposer();
    await waitFor('the chat turn to be working', chatWorking, 30_000, 25);
    expect(box() === '', `the sent message stayed in the box: "${box()}"`);
    expect(element('steer') !== null, 'no Steering button while the agent works');
    await typeInto('prompt', 'Change nothing yet; investigate first.');
    await click('steer');
    await waitFor('the steering entry', () => entryWith('Change nothing yet') !== null, 10_000, 10);
    const quietWhileWaiting = quietUnder('Change nothing yet') || stateOf('Change nothing yet') === 'delivered';
    expect(box() === '', 'the steering message stayed in the box after it was accepted');
    await typeInto('prompt', 'Also look at the second folder.');
    await sendFromComposer();
    await waitFor(
      'the second steering entry',
      () => entryWith('Also look at the second folder') !== null,
      10_000,
      25,
    );
    await waitFor('the chat turn to end', chatSettled(0), 60_000);
    await waitFor(
      'both to be delivered',
      () =>
        stateOf('Change nothing yet') === 'delivered' &&
        stateOf('Also look at the second folder') === 'delivered',
      10_000,
      25,
    );
    const chatAnswer = textOf('turn-0-answer');
    const firstDetails = await withDetails(() => detailsFor('Change nothing yet'));
    record('chat turn steered', {
      quietWhileWaiting,
      lineUnderDelivered: lineUnder('Change nothing yet'),
      details: firstDetails,
      turns: turnsShown(),
    });
    expect(quietWhileWaiting, 'a waiting message was not shown quietly');
    expect(lineUnder('Change nothing yet') === '', 'a delivered message still has a status line under it');
    expect(firstDetails.startsWith('Change nothing yet') && firstDetails.includes('Delivered.'), `Session details do not hold the account: ${firstDetails}`);
    expect(!/read|applied|while it worked/i.test(firstDetails), `the account claims more than the receipt: ${firstDetails}`);
    expect(chatAnswer.includes('Steering taken into this turn: Change nothing yet'), 'the turn did not take the first message in');
    expect(turnsShown() === 1, 'steering started a second turn');
    expect(element('steer') === null, 'the Steering button stayed after the work ended');
    await window.dspatch.captureWindow('steering-chat-delivered');

    // --- 2. Run while the agent works is refused ------------------------------------
    await typeIntoField('test-command-input', 'node --version');
    await typeInto('prompt', '[[slow]] A second task, mark-lock.');
    await sendFromComposer();
    await waitFor('the second turn to be working', chatWorking, 30_000, 25);
    await click('run-test');
    await waitFor('the Run refusal', () => textOf('test-error').includes('agent is working in this folder'), 10_000, 25);
    record('run refused while the agent works', { error: textOf('test-error').slice(0, 160) });
    await waitFor('the second turn to end', chatSettled(1), 60_000);

    // --- 3. A message and a loop start are refused while the person's command runs ---
    await typeIntoField('test-command-input', 'node -e "setTimeout(() => {}, 7000)"');
    await click('run-test');
    await waitFor('the command to be running', () => element('test-pending') !== null, 10_000, 25);
    await typeInto('prompt', 'Fix it now.');
    await sendFromComposer();
    await waitFor(
      'the composer to say why it holds the message',
      () => textOf('composer-note').includes('running a command') || textOf('composer-route-note').includes('running a command'),
      10_000,
      25,
    );
    expect(box() === 'Fix it now.', `the held message did not stay in the box: "${box()}"`);
    let hostSend = 'sent';
    try {
      await window.dspatch.sendPrompt('Fix it now.');
    } catch (error) {
      hostSend = error instanceof Error ? error.message : String(error);
    }
    const hostLoop = await window.dspatch.startChatLoopRun({ runId: 'chat-loop-lock-check', mandate: 'Fix it now.', definitionKey: null });
    record('agent work refused while the command runs', { hostSend: hostSend.slice(-160), hostLoop });
    expect(hostSend.includes('Your command is running in this folder'), `the host sent beside the command: ${hostSend}`);
    expect(hostLoop.kind === 'refused' && hostLoop.reason.includes('loop was not started'), `the host started a loop beside the command: ${JSON.stringify(hostLoop)}`);
    await waitFor('the command to end', () => element('test-pending') === null, 30_000);

    // --- 4. An accepted loop start clears only what was sent --------------------------
    await setCheckbox('use-loop', true);
    await sleep(300);
    const mandate = '[[slow]] Read the project and report what it is for, mark-loop.';
    const typedAfter = 'A thought typed while starting.';
    await typeInto('prompt', mandate);
    const loopTurnsBefore = countEntries('loop-turn');
    await sendFromComposer();
    await typeInto('prompt', `${mandate}\n${typedAfter}`);
    await waitFor('the start to be accepted', () => box() === typedAfter, 30_000, 25);
    record('loop start accepted', { box: box() });
    await typeInto('prompt', '');
    const at = `loop-turn-${String(loopTurnsBefore)}`;
    await waitFor('a loop step to be working', () => element(`${at}-live-status`) !== null, 60_000, 25);
    await sleep(400);

    // --- 5. Steering into the working step, with Pause pressed meanwhile --------------
    await typeInto('prompt', 'Ta även hänsyn till den andra mappen.');
    await click('steer');
    await waitFor('the loop steering entry', () => entryWith('Ta även hänsyn') !== null, 10_000, 25);
    await click('loop-pause');
    await waitFor('the loop steering to be delivered', () => stateOf('Ta även hänsyn') === 'delivered', 30_000, 25);
    expect(lineUnder('Ta även hänsyn') === '', 'a delivered loop message still has a status line under it');
    await window.dspatch.captureWindow('steering-loop-delivered');
    await waitFor(
      'the run to be paused before its next step',
      () => (element('loop-control')?.className ?? '').includes('loop-control--paused'),
      60_000,
      50,
    );
    const pausedReplies = countEntries(`${at}-reply`);
    await sleep(1_500);
    expect(countEntries(`${at}-reply`) === pausedReplies, 'the run went on to its next step while paused');
    await click('loop-continue');
    await waitFor('the loop run to end', () => loopRunEnded(loopTurnsBefore), 180_000, 100);
    const loopDetails = await withDetails(() => detailsFor('Ta även hänsyn'));
    record('loop step steered', { details: loopDetails, repliesWhilePaused: pausedReplies });
    expect(loopDetails.includes('Delivered to “Do what was asked”.'), `Session details do not hold the loop account: ${loopDetails}`);
    expect(countEntries('loop-turn') === loopTurnsBefore + 1, 'steering started another loop run');

    // --- 6. The later step was briefed with the message --------------------------------
    const conversations = await window.dspatch.listConversations();
    const newest = [...conversations.entries].sort((a, b) => (a.savedAtUtc < b.savedAtUtc ? 1 : -1))[0];
    const conversationId = newest?.conversationId ?? '';
    const records = conversationId === '' ? [] : await window.dspatch.listRunRecords(conversationId);
    const run = records.find((entry) => (entry.record?.identity?.mandate ?? '').includes('mark-loop'));
    const replies = run?.record?.replies ?? [];
    const steered = 'Ta även hänsyn till den andra mappen.';
    const briefed = replies.filter((reply) => (reply.prompt ?? '').includes(steered));
    const endingNote = run?.record?.ending?.note ?? '';
    record('later steps briefed', { steps: replies.map((reply) => reply.nodeId), briefed: briefed.map((reply) => reply.nodeId) });
    expect(briefed.length >= 1 && briefed.every((reply) => (reply.prompt ?? '').includes('Earlier in this run')), 'no later step was briefed with the steering');
    expect(!(replies[0]?.prompt ?? '').includes(steered), 'the steered step was also given it in its prompt');
    expect(endingNote.includes('Steering sent while steps worked') && !endingNote.includes('while it worked)'), `the run record's steering note: ${endingNote.slice(-200)}`);
    const graphPath = run?.record?.identity?.graphPath ?? '';

    // --- 7. A message as the step ends goes to the next step; then Stop ------------------
    const lateBefore = countEntries('loop-turn');
    await typeInto('prompt', '[[slow]] [[steer-late]] Once more, mark-late.');
    await sendFromComposer();
    const late = `loop-turn-${String(lateBefore)}`;
    await waitFor('a step of the second run to be working', () => element(`${late}-live-status`) !== null, 60_000, 25);
    await typeInto('prompt', 'Check the tests too.');
    await sendFromComposer();
    await waitFor('the message to wait for the next step', () => lineUnder('Check the tests too.').includes('next step'), 10_000, 25);
    expect(quietUnder('Check the tests too.'), 'the waiting line is not quiet');
    record('step ended as the message came', { line: lineUnder('Check the tests too.') });
    await waitFor('the next step to take it', () => stateOf('Check the tests too.') === 'delivered', 120_000, 50);
    await click('cancel');
    await waitFor('the second run to stop', () => loopRunEnded(lateBefore), 60_000, 50);
    const lateDetails = await withDetails(() => detailsFor('Check the tests too.'));
    record('taken by the next step, then stopped', { details: lateDetails, badge: textOf(`${late}-status`) });
    expect(/when that step started/.test(lateDetails), `not handed to the next step: ${lateDetails}`);

    // --- 8. An unconfirmed stop of a chat turn, then overlapping work ------------------
    await setCheckbox('use-loop', false);
    await sleep(300);
    const turnsBefore = turnsShown();
    await typeInto('prompt', '[[slow]] [[cancel-unconfirmed]] Refactor it, mark-unconfirmed.');
    await sendFromComposer();
    await waitFor('the turn to be working', chatWorking, 30_000, 25);
    await click('cancel');
    await waitFor('the turn to end', chatSettled(turnsBefore), 30_000, 25);
    await sleep(500);
    await typeIntoField('test-command-input', 'node --version');
    await waitFor('Run to name the agent work it waits for', () => element('run-needs-agent-acknowledgement') !== null, 10_000, 25);
    const runDisabled = (element('run-test') as HTMLButtonElement | null)?.disabled === true;
    const hostLoopAfter = await window.dspatch.startChatLoopRun({ runId: 'chat-loop-uncertain-check', mandate: 'x', definitionKey: null });
    record('unconfirmed chat stop holds back overlapping work', {
      runNote: textOf('run-needs-agent-acknowledgement').slice(0, 200),
      runDisabled,
      hostLoopAfter,
    });
    expect(runDisabled, 'Run stayed available beside agent work with no confirmed end');
    expect(hostLoopAfter.kind === 'refused' && hostLoopAfter.reason.includes('not been named'), `a loop started beside the unconfirmed stop: ${JSON.stringify(hostLoopAfter)}`);
    await window.dspatch.captureWindow('steering-unconfirmed-held');

    // The existing way on: name it, explicitly, and run the command.
    await click('run-anyway-agent');
    await waitFor('the command to run once named', () => element('test-exit-code') !== null && element('test-pending') === null, 30_000, 50);
    record('named and run', { exitCode: textOf('test-exit-code') });
    expect(element('run-needs-agent-acknowledgement') === null, 'the note stayed after the attempt was named');

    // --- 9. An unconfirmed stop of a loop step, then overlapping work ----------------
    await setCheckbox('use-loop', true);
    await sleep(300);
    const stepBefore = countEntries('loop-turn');
    await typeInto('prompt', '[[slow]] [[cancel-unconfirmed]] Walk it, mark-loop-unconfirmed.');
    await sendFromComposer();
    const unconfirmedRun = `loop-turn-${String(stepBefore)}`;
    await waitFor('a step to be working', () => element(`${unconfirmedRun}-live-status`) !== null, 60_000, 25);
    await sleep(400);
    await click('cancel');
    await waitFor('the run to end', () => loopRunEnded(stepBefore), 60_000, 50);
    await sleep(800);
    await waitFor('Run to name the stopped step', () => element('run-needs-agent-acknowledgement') !== null, 10_000, 50);
    const stateAfterLoop = await window.dspatch.getRunState();
    const recorded = stateAfterLoop.unresolved.filter((attempt) => attempt.label.includes('mark-loop-unconfirmed') || attempt.label.startsWith('loop run'));
    record('unconfirmed loop stop holds back overlapping work', {
      labels: recorded.map((attempt) => `${attempt.label}: ${attempt.state}`),
      runNote: textOf('run-needs-agent-acknowledgement').slice(0, 200),
    });
    expect(recorded.some((attempt) => attempt.state === 'outcome-unknown'), 'the stopped step was not recorded with an unknown outcome');
    await click('run-anyway-agent');
    await waitFor('the command to run once named', () => element('run-needs-agent-acknowledgement') === null && element('test-pending') === null, 30_000, 50);

    // --- 10. The graph editor's run: isolated, and overlapped by a command -------------
    // The editor's Run has a live binding only for the duration drawings; this is one of them.
    const ownRoot = plan.ownRepositoryPath ?? '';
    const rootSep = ownRoot.includes('\\') ? '\\' : '/';
    const durationGraph =
      ownRoot === '' ? '' : [ownRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json'].join(rootSep);
    void graphPath;
    const opened = durationGraph === '' ? null : await window.dspatch.openLoopGraph({ kind: 'path', path: durationGraph });
    const graphText = opened?.kind === 'read' ? opened.text : '';
    expect(graphText !== '', 'could not read the loop graph for an editor run');
    // A command running in the sample project, which does not contain the editor's folder.
    await typeIntoField('test-command-input', 'node -e "setTimeout(() => {}, 6000)"');
    await typeIntoField('test-cwd-input', workspace);
    await click('run-test');
    await waitFor('the command to be running', () => element('test-pending') !== null, 10_000, 25);
    // Started, seen walking, then stopped: the simulated provider never completes the
    // duration task, so this run would otherwise rework until its budget ran out.
    const isolatedRun = window.dspatch.startEditorLoopRun({ runId: `editor-isolated-${String(Date.now())}`, text: graphText });
    let walking: unknown = null;
    const walkDeadline = performance.now() + 20_000;
    while (walking === null && performance.now() < walkDeadline) {
      walking = await window.dspatch.currentLoopRun();
      if (walking === null) {
        await sleep(100);
      }
    }
    await window.dspatch.cancelEditorLoopRun();
    const isolated = await isolatedRun;
    await waitFor('the command to end', () => element('test-pending') === null, 30_000, 50);
    // A command running in the temp folder that holds the editor's own run folders.
    const sep = workspace.includes('\\') ? '\\' : '/';
    const tempRoot = workspace.split(sep).slice(0, -2).join(sep);
    await typeIntoField('test-cwd-input', tempRoot);
    await click('run-test');
    await waitFor('the command to be running', () => element('test-pending') !== null, 10_000, 25);
    const overlapped = await window.dspatch.startEditorLoopRun({ runId: `editor-overlap-${String(Date.now())}`, text: graphText });
    await waitFor('the command to end', () => element('test-pending') === null, 30_000, 50);
    record('graph editor runs', {
      tempRoot,
      isolated: isolated.kind,
      overlapped: overlapped.kind === 'failed' ? overlapped.note.slice(0, 200) : overlapped.kind,
    });
    expect(
      walking !== null && (isolated.kind === 'cancelled' || isolated.kind === 'finished'),
      `the isolated editor run did not run beside a command elsewhere: ${JSON.stringify(isolated).slice(0, 300)}`,
    );
    expect(overlapped.kind === 'failed' && overlapped.note.includes('Your command is running in this folder'), `the editor ran inside a folder a command was running in: ${JSON.stringify(overlapped).slice(0, 300)}`);

    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    observations['atFailure'] = {
      box: box(),
      entries: entries().map((entry) => ({ state: entry.dataset['state'], text: entry.textContent })),
      actionError: textOf('action-error'),
      testError: textOf('test-error'),
      runNote: textOf('run-needs-agent-acknowledgement'),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-147: a graph editor run stopped without a confirmed end, across a restart */
/* ------------------------------------------------------------------------- */

/**
 * Three processes over one isolated user-data folder (`flowPhase`), SIMULATED provider:
 *
 * - `first`: an editor run is stopped with a confirmed end; Run in its folder is not held.
 * - `again`: with `DSPATCH_PRESENTATION_UNCONFIRMED_STOP=1`, an editor run is stopped and
 *   the end is not confirmed; Run in its folder is refused. The folder is logged.
 * - `retry`: after a restart, with that folder as `flowRoot`: Run in an unrelated folder
 *   runs; a chat opened on the folder holds its message back; Run there is refused and
 *   "Run anyway" names it; the message then goes without asking again.
 *
 * The editor runs are started over the bridge (`startEditorLoopRun`), as the editor's Run
 * button does; everything else is a real click, Enter or menu item.
 */
async function runEditorUncertainScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider and SIMULATED unconfirmed stop. The window, host, loop runner, ' +
      'attempt ledgers, the uncertain-work file and the restart are real.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const runCommand = async (cwd: string): Promise<{ exit: string; error: string }> => {
    await typeIntoField('test-command-input', 'node --version');
    await typeIntoField('test-cwd-input', cwd);
    const before = textOf('test-result');
    await click('run-test');
    await waitFor(
      'Run to answer',
      () =>
        element('test-pending') === null &&
        (textOf('test-error') !== '' || (element('test-exit-code') !== null && textOf('test-result') !== before)),
      30_000,
      50,
    );
    return { exit: textOf('test-exit-code'), error: textOf('test-error') };
  };
  const editorRun = async (): Promise<string> => {
    const ownRoot = plan.ownRepositoryPath ?? '';
    const sep = ownRoot.includes('\\') ? '\\' : '/';
    const opened = await window.dspatch.openLoopGraph({
      kind: 'path',
      path: [ownRoot, 'docs', 'loop', 'graphs', 'dspatch-live-duration.graph.json'].join(sep),
    });
    if (opened.kind !== 'read') {
      throw new Error('could not read the duration graph');
    }
    const running = window.dspatch.startEditorLoopRun({ runId: `editor-${phase}-${String(Date.now())}`, text: opened.text });
    let walking: unknown = null;
    const deadline = performance.now() + 20_000;
    while (walking === null && performance.now() < deadline) {
      walking = await window.dspatch.currentLoopRun();
      if (walking === null) {
        await sleep(100);
      }
    }
    await sleep(500);
    await window.dspatch.cancelEditorLoopRun();
    const outcome = await running;
    const note = outcome.kind === 'cancelled' || outcome.kind === 'finished' ? outcome.workspaceNote : JSON.stringify(outcome);
    const folder = /workspace (.+) \((left on disk|deleted)\)/.exec(note)?.[1] ?? '';
    record('editor run stopped', { kind: outcome.kind, folder });
    expect(outcome.kind === 'cancelled' && folder !== '', `the editor run did not stop as asked: ${note.slice(0, 200)}`);
    return folder;
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor('a session to open', () => textOf('session-id') !== '' && element('prompt') !== null, 30_000);
    const sample = textOf('test-cwd');

    if (phase === 'first' || phase === 'again') {
      const folder = await editorRun();
      await sleep(500);
      const after = await runCommand(folder);
      record('Run in the editor run\'s folder', { folder, ...after, error: after.error.slice(0, 160) });
      if (phase === 'first') {
        expect(after.exit === '0' && after.error === '', 'a confirmed stop left Run held back');
      } else {
        expect(after.error.includes('no confirmed end'), `Run went beside an unconfirmed stop: ${after.error.slice(0, 160)}`);
        observations['uncertainFolder'] = folder;
      }
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    // retry: after the restart.
    const folder = plan.flowRoot ?? '';
    expect(folder !== '', 'no folder from the earlier phase');
    const unrelated = await runCommand(sample);
    record('Run in an unrelated folder', { ...unrelated, error: unrelated.error.slice(0, 160) });
    expect(unrelated.exit === '0' && unrelated.error === '', 'an unrelated folder was held back');

    // A chat over the folder: the message waits to be named.
    await window.dspatch.pressMenuItem('open-project');
    await waitFor('the folder to open', () => textOf('test-cwd').toLowerCase() === folder.toLowerCase(), 30_000, 100);
    await typeInto('prompt', 'Go on with the work.');
    await sendFromComposer();
    await waitFor('the message to be held', () => element('send-needs-acknowledgement') !== null, 10_000, 50);
    expect((element('prompt') as HTMLTextAreaElement | null)?.value === 'Go on with the work.', 'the held message left the box');
    record('message held after the restart', { note: textOf('send-needs-acknowledgement').slice(0, 200) });
    await window.dspatch.captureWindow('editor-uncertain-held');

    // Run there: held back before it is pressed, and offered to be named.
    await typeIntoField('test-command-input', 'node --version');
    await waitFor('Run to offer naming it', () => element('run-anyway-agent') !== null, 10_000, 50);
    expect((element('run-test') as HTMLButtonElement | null)?.disabled === true, 'Run stayed available beside the unconfirmed stop');
    record('Run held after the restart', { note: textOf('run-needs-agent-acknowledgement').slice(0, 200) });
    const offered = textOf('run-anyway-agent');
    await click('run-anyway-agent');
    await waitFor('the named command to run', () => element('test-pending') === null && textOf('test-exit-code') === '0' && element('run-anyway-agent') === null, 30_000, 50);
    record('named with Run anyway', { offered });

    // Named once: the held message now goes without asking again.
    await waitFor('the message gate to lift', () => element('send-needs-acknowledgement') === null, 10_000, 50);
    await sendFromComposer();
    await waitFor('the message to be answered', () => element('active-answer') === null && element('turn-0-answer') !== null, 30_000, 50);
    record('message sent once named', { answered: textOf('turn-0-answer').slice(0, 80) });
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    observations['atFailure'] = {
      testError: textOf('test-error'),
      actionError: textOf('action-error'),
      cwd: textOf('test-cwd'),
      routeNote: textOf('composer-route-note'),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-147: where a steering message sits, live and after a restart          */
/* ------------------------------------------------------------------------- */

/**
 * Two processes over one isolated user-data folder (`flowPhase`), SIMULATED provider
 * and SIMULATED steering (folded into the working turn at its next chunk):
 *
 * - `first`: a chat turn steered with Enter and with the Steering button; a loop step
 *   steered with Enter. Each message is drawn inside the work it was sent into, after the
 *   text that had been shown and before what came after; it reaches the step that was
 *   working, while it still works; later steps are briefed with it.
 * - `again`: after a restart, the project reopened from the start page: the same
 *   messages are in the same places, each once.
 *
 * What it cannot show is when a real model reads a message.
 */
async function runSteeringPlacementScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider and SIMULATED steering (presentation adapter). The window, host, ' +
      'loop runner, conversation file, run record and the restart are real.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const CHAT_ENTER = 'Only the parser, please.';
  const CHAT_BUTTON = 'And leave the lexer alone.';
  const LOOP_ENTER = 'Ta hänsyn till README också.';
  const entriesWith = (text: string): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('[data-state][data-placement]')].filter((entry) =>
      (entry.textContent ?? '').includes(text),
    );
  const entryWith = (text: string): HTMLElement | null => entriesWith(text)[0] ?? null;
  const follows = (first: Element | null, second: Element | null): boolean =>
    first !== null &&
    second !== null &&
    (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  /** The message sits between a stretch of the answer and the rest of it. */
  const between = (entry: Element | null, before: string, after: string): boolean =>
    follows(element(before), entry) && follows(entry, element(after));
  const lineUnder = (text: string): string =>
    entryWith(text)?.querySelector('[data-ev$="-account"]')?.textContent ?? '';
  const replyNames = (at: string): string[] =>
    [...document.querySelectorAll<HTMLElement>(`[data-ev^="${at}-reply-"][data-ev$="-who"]`)].map((who) =>
      (who.dataset['ev'] ?? '').replace(/-who$/, ''),
    );

  try {
    if (phase === 'again') {
      // The sample project from the first phase, opened as a person opens a folder.
      await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
      await window.dspatch.pressMenuItem('open-project');
      // The folder opens on a new chat; the earlier one is in the sidebar's list.
      const earlier = (): HTMLButtonElement | null =>
        [...document.querySelectorAll<HTMLButtonElement>('[data-ev^="workspace-chat-"]')].find(
          (row) => row.getAttribute('aria-current') !== 'true' && !row.disabled,
        ) ?? null;
      await waitFor('the earlier chat to be listed', () => earlier() !== null, 60_000, 100);
      earlier()?.click();
      // Read back first, as a file: the chat's messages in place before anything is opened.
      await waitFor('the saved chat to be read', () => entryWith(CHAT_ENTER) !== null, 60_000, 100);
      const panelEntry = entryWith(CHAT_ENTER);
      const panelAt = (panelEntry?.dataset['ev'] ?? '').replace(/-steering-\d+$/, '');
      record('read from the file', { entry: panelEntry?.dataset['ev'] ?? null });
      expect(
        panelAt !== '' && between(panelEntry, `${panelAt}-answer`, `${panelAt}-answer-after-0`),
        'the saved chat does not show the message between the answer it interrupted and what followed',
      );
      // Then continued: the project opens again, with its history and its loop runs.
      await click('restored-continue');
      await waitFor('the conversation to be read back', () => element('loop-turn-0') !== null, 60_000, 100);
      await sleep(800);
      // In the conversation itself; the restored-conversation panel beside it is the file.
      const inThread = (text: string): HTMLElement[] =>
        entriesWith(text).filter((entry) => element('transcript')?.contains(entry) === true);
      const chatEntry = inThread(CHAT_ENTER)[0] ?? null;
      const chatAt = (chatEntry?.dataset['ev'] ?? '').replace(/-steering-\d+$/, '');
      const loopEntry = inThread(LOOP_ENTER)[0] ?? null;
      const loopReply = loopEntry?.previousElementSibling?.getAttribute('data-ev') ?? '';
      const read = {
        chatEntry: chatEntry?.dataset['ev'] ?? null,
        counts: [CHAT_ENTER, CHAT_BUTTON, LOOP_ENTER].map((text) => inThread(text).length),
        loopEntry: loopEntry?.dataset['ev'] ?? null,
        loopReply,
        loopNext: loopEntry?.nextElementSibling?.getAttribute('data-ev') ?? null,
      };
      record('read back after the restart', read);
      expect(read.counts.every((count) => count === 1), `a message is missing or drawn twice: ${JSON.stringify(read.counts)}`);
      expect(
        chatAt !== '' && between(chatEntry, `${chatAt}-answer`, `${chatAt}-answer-after-0`),
        'the chat message is not back between the answer it interrupted and what followed',
      );
      expect(follows(chatEntry, inThread(CHAT_BUTTON)[0] ?? null), 'the two chat messages are not back in the order they were sent');
      expect(
        /-reply-\d+$/.test(loopReply) && read.loopNext === `${loopReply}-after-0`,
        'the loop message is not back inside the reply of the step it was sent to',
      );
      expect(lineUnder(LOOP_ENTER) === '' && lineUnder(CHAT_ENTER) === '', 'a delivered message read back has a status line under it');
      await window.dspatch.captureWindow('steering-placement-read-back');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor('a session to open', () => textOf('session-id') !== '' && element('prompt') !== null, 30_000);
    observations['workspace'] = textOf('test-cwd');

    // --- A chat turn: Enter, then the Steering button --------------------------------
    await typeInto('prompt', '[[slow]] Look at the build, mark-place-chat.');
    await sendFromComposer();
    await waitFor('the turn to be writing', () => rawTextOf('active-answer').replace('…', '').trim().length > 20, 30_000, 25);
    const shownAtEnter = rawTextOf('active-answer').trim();
    await typeInto('prompt', CHAT_ENTER);
    await sendFromComposer();
    await waitFor('the message in the turn', () => entryWith(CHAT_ENTER) !== null, 10_000, 10);
    const chatEntry = entryWith(CHAT_ENTER);
    const shownBefore = rawTextOf('active-answer').trim();
    expect(
      chatEntry?.dataset['placement'] === 'inline' && chatEntry.closest('[data-ev="turn-0"]') !== null,
      'the Enter message is not inside the turn it was sent into',
    );
    expect(
      shownBefore.startsWith(shownAtEnter.slice(0, Math.max(0, shownAtEnter.length - 1))),
      'text shown before the message did not stay before it',
    );
    await waitFor('the turn to write on after it', () => rawTextOf('active-answer-after-0').trim() !== '', 30_000, 25);
    await typeInto('prompt', CHAT_BUTTON);
    await click('steer');
    await waitFor('the second message in the turn', () => entryWith(CHAT_BUTTON) !== null, 10_000, 10);
    await waitFor('the turn to end', () => element('active-answer') === null && element('turn-0-answer') !== null, 60_000, 50);
    await waitFor(
      'both delivered',
      () => entryWith(CHAT_ENTER)?.dataset['state'] === 'delivered' && entryWith(CHAT_BUTTON)?.dataset['state'] === 'delivered',
      10_000,
      25,
    );
    const chatPlaced = {
      shownAtEnter: shownAtEnter.length,
      before: rawTextOf('turn-0-answer').trim().slice(-40),
      after: rawTextOf('turn-0-answer-after-0').trim().slice(0, 60),
      lineUnder: lineUnder(CHAT_ENTER),
      byTime: document.querySelectorAll('[data-placement="by-time"]').length,
    };
    record('chat turn steered by Enter and by the button', chatPlaced);
    expect(between(entryWith(CHAT_ENTER), 'turn-0-answer', 'turn-0-answer-after-0'), 'the Enter message is not between the answer shown and what followed');
    expect(
      follows(entryWith(CHAT_ENTER), entryWith(CHAT_BUTTON)) && entryWith(CHAT_BUTTON)?.closest('[data-ev="turn-0"]') !== null,
      'the button message is not in the turn, after the first',
    );
    expect(chatPlaced.lineUnder === '' && lineUnder(CHAT_BUTTON) === '', 'a delivered message keeps a status line');
    expect(chatPlaced.byTime === 0, 'a message was drawn apart from the turn it was sent into');
    await window.dspatch.captureWindow('steering-placement-chat');

    // --- A loop step: Enter while it works ---------------------------------------------
    await setCheckbox('use-loop', true);
    await sleep(300);
    const runsBefore = countEntries('loop-turn');
    const at = `loop-turn-${String(runsBefore)}`;
    await typeInto('prompt', '[[slow]] Report what the project is for, mark-place-loop.');
    await sendFromComposer();
    await waitFor('a step to be writing', () => rawTextOf(`${at}-live-text`).trim().length > 20, 60_000, 25);
    const workingStep = textOf(`${at}-live-who`);
    const repliesAtSend = replyNames(at).length;
    await typeInto('prompt', LOOP_ENTER);
    await sendFromComposer();
    await waitFor('the message in the working step', () => entryWith(LOOP_ENTER) !== null, 10_000, 10);
    const quietWhileWaiting =
      entryWith(LOOP_ENTER)?.querySelector('.turn__meta--quiet') !== null ||
      entryWith(LOOP_ENTER)?.dataset['state'] === 'delivered';
    expect(entryWith(LOOP_ENTER)?.closest(`[data-ev="${at}-live"]`) !== null, 'the loop message is not inside the step that was working');
    expect(quietWhileWaiting, 'the waiting loop message is not shown quietly');
    await waitFor('the loop message to be delivered', () => entryWith(LOOP_ENTER)?.dataset['state'] === 'delivered', 30_000, 25);
    const deliveredTo = {
      workingStep,
      stillWorking: textOf(`${at}-live-who`),
      repliesAtSend,
      repliesAtDelivery: replyNames(at).length,
    };
    expect(
      deliveredTo.stillWorking === workingStep && deliveredTo.repliesAtDelivery === repliesAtSend,
      `not delivered to the step that was working: ${JSON.stringify(deliveredTo)}`,
    );
    await waitFor('the step to write on after it', () => rawTextOf(`${at}-live-text-after-0`).trim() !== '', 30_000, 25);
    expect(lineUnder(LOOP_ENTER) === '', 'the delivered loop message keeps a status line');
    await window.dspatch.captureWindow('steering-placement-loop-live');
    await waitFor('the loop run to end', () => loopRunEnded(runsBefore), 180_000, 100);
    const settled = entryWith(LOOP_ENTER);
    const reply = settled?.previousElementSibling?.getAttribute('data-ev') ?? '';
    const placedInReply =
      /-reply-\d+$/.test(reply) && settled?.nextElementSibling?.getAttribute('data-ev') === `${reply}-after-0`;
    record('loop step steered by Enter', { ...deliveredTo, quietWhileWaiting, reply, placedInReply, count: entriesWith(LOOP_ENTER).length });
    expect(placedInReply, 'the loop message is not inside the reply of the step it was sent to once the run ended');
    expect(entriesWith(LOOP_ENTER).length === 1, 'the loop message is drawn twice');

    // --- Later steps are briefed with it ------------------------------------------------
    const conversations = await window.dspatch.listConversations();
    const newest = [...conversations.entries].sort((a, b) => (a.savedAtUtc < b.savedAtUtc ? 1 : -1))[0];
    const records = await window.dspatch.listRunRecords(newest?.conversationId ?? '');
    const run = records.find((entry) => (entry.record?.identity?.mandate ?? '').includes('mark-place-loop'));
    const replies = run?.record?.replies ?? [];
    const briefed = replies.filter((entry) => (entry.prompt ?? '').includes(LOOP_ENTER));
    const recordedMessages = run?.record?.ending?.messages ?? [];
    record('later steps briefed', {
      steps: replies.map((entry) => entry.nodeId),
      briefed: briefed.map((entry) => entry.nodeId),
      recorded: recordedMessages.map((message) => ({
        outcome: message.outcome,
        anchor: message.anchor,
        during: message.delivery?.during ?? false,
      })),
    });
    expect(
      briefed.length >= 1 && !(replies[0]?.prompt ?? '').includes(LOOP_ENTER),
      'later steps were not briefed with the message, or the steered step was also given it in its prompt',
    );
    expect(
      recordedMessages.length === 1 && recordedMessages[0]?.outcome === 'delivered' && recordedMessages[0]?.anchor !== null,
      'the run record does not keep the message with its place',
    );
    await window.dspatch.captureWindow('steering-placement-loop-ended');
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    observations['atFailure'] = {
      entries: [...document.querySelectorAll<HTMLElement>('[data-state][data-placement]')].map((entry) => ({
        ev: entry.dataset['ev'],
        state: entry.dataset['state'],
        placement: entry.dataset['placement'],
        text: (entry.textContent ?? '').slice(0, 80),
      })),
      actionError: textOf('action-error'),
      composerNote: textOf('composer-note'),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-28 follow-up: the loop editor opened while a chat loop is walking      */
/* ------------------------------------------------------------------------- */

/** One node of the editor's drawing as `readLiveness` reads it. */
interface EditorNodeReading {
  readonly id: string;
  readonly state: string;
  readonly working: boolean;
  readonly animations: number;
}

/** What the client read of the loop editor's own window, or `null` when none is open. */
async function readEditorWindow(): Promise<{ drawn: string[]; nodes: EditorNodeReading[] } | null> {
  const answer = await window.dspatch.editorWindowCheck({ action: 'read' });
  if (!answer.ok) {
    return null;
  }
  const detail = answer.detail as {
    hooked: boolean;
    drawn: string[];
    liveness: EditorNodeReading[] | null;
  };
  if (!detail.hooked || detail.drawn.length === 0 || detail.liveness === null) {
    return null;
  }
  return { drawn: detail.drawn, nodes: detail.liveness };
}

/** The host's own account of the run: which run, how far, and which step is active. */
async function hostRunReading(): Promise<{
  runId: string;
  phase: string;
  ended: boolean;
  entries: number;
  active: string[];
  nodes: string[];
} | null> {
  const view = await window.dspatch.currentLoopRunView();
  if (view === null) {
    return null;
  }
  let nodes: string[] = [];
  try {
    nodes = ((JSON.parse(view.run.graphText) as { nodes?: { id: string }[] }).nodes ?? []).map((node) => node.id);
  } catch {
    nodes = [];
  }
  return {
    runId: view.run.runId,
    phase: view.run.phase ?? 'running',
    ended: view.ended,
    entries: view.entries.length,
    active: [...nodeRunStates(view)].filter(([, state]) => state === 'active').map(([id]) => id).sort(),
    nodes: nodes.sort(),
  };
}

/** Poll an async reading until it satisfies `done`, and give back the last reading. */
async function pollUntil<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const until = performance.now() + timeoutMs;
  let value = await read();
  while (!done(value) && performance.now() < until) {
    await sleep(100);
    value = await read();
  }
  return value;
}

function activeIn(reading: { nodes: EditorNodeReading[] } | null): string[] {
  return (reading?.nodes ?? []).filter((node) => node.state === 'active').map((node) => node.id).sort();
}

function lookedActive(reading: { nodes: EditorNodeReading[] } | null): EditorNodeReading[] {
  return (reading?.nodes ?? []).filter((node) => node.state === 'active' || node.working);
}

/**
 * The loop editor opened while a chat loop is walking (DSP-28 follow-up).
 *
 * Niclas started a loop from the chat with the editor closed, opened the editor, and saw
 * no motion on the drawing. A window opening mid-step asked the host which run was walking
 * and was told the drawing but not how far the run had got, so no node was active until the
 * next step began. This opens the real editor window with the chat's own button in the
 * middle of a step and reads it through the client, beside the host's own account.
 *
 * SIMULATED provider (presentation adapter, `[[very-slow]]` pacing). The window, host,
 * runner and the editor's second window are real.
 */
async function runEditorJoinsRunScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'SIMULATED provider (presentation adapter). The chat window, the loop editor window, ' +
      'the host and the runner are real; the editor window is read by the client through ' +
      "the editor's own check hook.",
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const same = (left: readonly string[], right: readonly string[]): boolean =>
    JSON.stringify(left) === JSON.stringify(right);

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await window.dspatch.pressMenuItem('new-sample-project');
    await waitFor('a session to open', () => textOf('session-id') !== '' && element('prompt') !== null, 30_000);
    await setCheckbox('use-loop', true);
    await sleep(300);

    // --- 1. The loop starts from the chat, with the editor closed ----------------------
    const runsBefore = countEntries('loop-turn');
    const at = `loop-turn-${String(runsBefore)}`;
    expect((await readEditorWindow()) === null, 'an editor window was open before the run started');
    await typeInto('prompt', '[[very-slow]] Report what the project is for, mark-join.');
    await sendFromComposer();
    await waitFor('a step to be writing', () => rawTextOf(`${at}-live-text`).trim().length > 20, 60_000, 50);
    const before = await hostRunReading();
    record('run started, editor closed', { host: before });
    expect(before !== null && before.active.length === 1, `the host has no single active step: ${JSON.stringify(before)}`);

    // --- 2. Open the editor in the middle of the step ----------------------------------
    await click('edit-agent-loops');
    const joined = await pollUntil(readEditorWindow, (reading) => activeIn(reading).length > 0, 10_000);
    const hostAtJoin = await hostRunReading();
    const joinedActive = activeIn(joined);
    const stillSameStep =
      before !== null && hostAtJoin !== null && hostAtJoin.runId === before.runId && hostAtJoin.entries === before.entries;
    record('editor opened mid-step', { editor: joined, host: hostAtJoin, stillSameStep });
    expect(joined !== null, 'the editor window did not draw a graph');
    expect(
      stillSameStep,
      'the step changed before the editor was read, so this reading cannot tell the opening read from a later event',
    );
    expect(
      hostAtJoin !== null && same(joinedActive, hostAtJoin.active),
      `the editor did not show the step the host says is active: editor ${JSON.stringify(joinedActive)}, host ${JSON.stringify(hostAtJoin?.active)}`,
    );
    expect(
      hostAtJoin !== null && same([...(joined?.drawn ?? [])].sort(), hostAtJoin.nodes),
      "the editor did not draw the run's graph",
    );
    const working = (joined?.nodes ?? []).find((node) => node.state === 'active');
    expect(working?.working === true && (working?.animations ?? 0) > 0, `the active step does not move: ${JSON.stringify(working)}`);
    await window.dspatch.captureWindow('editor-joins-run-chat');

    // --- 3. The next step --------------------------------------------------------------
    const firstActive = hostAtJoin?.active ?? [];
    const moved = await pollUntil(
      hostRunReading,
      (host) => host === null || host.ended || (host.active.length > 0 && !same(host.active, firstActive)),
      120_000,
    );
    const followed = await pollUntil(
      readEditorWindow,
      (reading) => moved !== null && same(activeIn(reading), moved.active),
      5_000,
    );
    record('next step', { host: moved, editor: followed });
    expect(
      moved !== null && !moved.ended && moved.active.length > 0 && same(activeIn(followed), moved.active),
      `the editor did not follow the run to its next step: editor ${JSON.stringify(activeIn(followed))}, host ${JSON.stringify(moved?.active)}`,
    );

    // --- 4. Close and reopen during the run --------------------------------------------
    const runIdAtClose = moved?.runId ?? '';
    await window.dspatch.editorWindowCheck({ action: 'close' });
    const afterClose = await hostRunReading();
    expect(
      afterClose !== null && afterClose.runId === runIdAtClose && !afterClose.ended,
      'closing the editor touched the run',
    );
    await click('edit-agent-loops');
    const reopened = await pollUntil(readEditorWindow, (reading) => activeIn(reading).length > 0, 10_000);
    const hostAtReopen = await hostRunReading();
    record('editor reopened during the run', { editor: reopened, host: hostAtReopen });
    expect(
      hostAtReopen !== null && hostAtReopen.runId === runIdAtClose && same(activeIn(reopened), hostAtReopen.active),
      `the reopened editor did not show the active step: editor ${JSON.stringify(activeIn(reopened))}, host ${JSON.stringify(hostAtReopen?.active)}`,
    );
    const reopenedWorking = (reopened?.nodes ?? []).find((node) => node.state === 'active');
    expect((reopenedWorking?.animations ?? 0) > 0, 'the active step does not move in the reopened editor');

    // --- 5a. An ended run is not shown as active ---------------------------------------
    await waitFor('the loop run to end', () => loopRunEnded(runsBefore), 300_000, 100);
    const endedOpen = await pollUntil(readEditorWindow, (reading) => lookedActive(reading).length === 0, 5_000);
    await window.dspatch.editorWindowCheck({ action: 'close' });
    await click('edit-agent-loops');
    const endedReopened = await pollUntil(readEditorWindow, (reading) => reading !== null, 10_000);
    await sleep(500);
    const endedSettled = await readEditorWindow();
    record('run ended', { open: endedOpen, reopened: endedSettled, host: await hostRunReading() });
    expect(endedReopened !== null, 'the editor did not draw after the run ended');
    expect(lookedActive(endedOpen).length === 0, `the open editor still shows the ended run as active: ${JSON.stringify(lookedActive(endedOpen))}`);
    expect(
      lookedActive(endedSettled).length === 0,
      `the editor reopened after the end shows the run as active: ${JSON.stringify(lookedActive(endedSettled))}`,
    );

    // --- 5b. A stopped run is not shown as active --------------------------------------
    const stopAt = `loop-turn-${String(runsBefore + 1)}`;
    await typeInto('prompt', '[[very-slow]] Report what the project is for, mark-join-stop.');
    await sendFromComposer();
    await waitFor('the second run to be writing', () => rawTextOf(`${stopAt}-live-text`).trim().length > 20, 60_000, 50);
    const stopping = await pollUntil(readEditorWindow, (reading) => activeIn(reading).length > 0, 10_000);
    expect(activeIn(stopping).length > 0, 'the open editor did not take up the second run');
    await click('cancel');
    await waitFor('the stopped run to end', () => loopRunEnded(runsBefore + 1), 120_000, 100);
    const stopped = await pollUntil(readEditorWindow, (reading) => lookedActive(reading).length === 0, 5_000);
    await window.dspatch.editorWindowCheck({ action: 'close' });
    await click('edit-agent-loops');
    await pollUntil(readEditorWindow, (reading) => reading !== null, 10_000);
    await sleep(500);
    const stoppedReopened = await readEditorWindow();
    record('run stopped', { open: stopped, reopened: stoppedReopened, host: await hostRunReading() });
    expect(lookedActive(stopped).length === 0, `the open editor still shows the stopped run as active: ${JSON.stringify(lookedActive(stopped))}`);
    expect(
      lookedActive(stoppedReopened).length === 0,
      `the editor reopened after the stop shows the run as active: ${JSON.stringify(lookedActive(stoppedReopened))}`,
    );

    // Opening, closing and reopening started nothing.
    const runs = countEntries('loop-turn');
    record('runs', { before: runsBefore, after: runs });
    expect(runs === runsBefore + 2, `opening the editor changed how many runs there were: ${String(runs - runsBefore)} instead of 2`);
    await window.dspatch.editorWindowCheck({ action: 'close' });
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    observations['atFailure'] = {
      editor: await readEditorWindow().catch(() => null),
      host: await hostRunReading().catch(() => null),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-150: review a chosen revision pair, its diff and a walk beside it      */
/* ------------------------------------------------------------------------- */

interface PairWindowRow {
  readonly id: number;
  readonly view: 'walk' | 'diff' | 'explanation';
  readonly pairKey: string | null;
  readonly title: string;
  readonly focused: boolean;
  /** An explanation window: the walk window it belongs to, and where it is. */
  readonly walkId?: number;
  readonly bounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

interface PairFileReading {
  readonly key: string;
  readonly path: string;
  readonly status: string;
  readonly binary: boolean;
  readonly total: number;
  readonly handled: number;
  readonly manual: number;
  readonly exempted: number;
  readonly percent: number;
  readonly done: boolean;
  readonly shown: string;
  readonly checkbox: boolean;
}

interface PairReading {
  readonly phase: string;
  readonly repositories?: readonly string[];
  readonly heading?: string;
  readonly chosen?: number;
  readonly commits?: number;
  readonly key?: string;
  readonly fileKey?: string | null;
  readonly layout?: string;
  readonly files?: readonly PairFileReading[];
  readonly strips?: readonly { side: string; line: number; status: string; label: string }[];
  readonly diffNote?: string;
  readonly walksNote?: string;
  readonly targetShown?: boolean;
  readonly words?: readonly { side: string; line?: number; text: string }[];
  readonly wholeLines?: readonly string[];
  readonly signs?: string;
}

interface PairWindowReading {
  readonly pair: PairReading | null;
  readonly walk: { readonly kind: string; readonly position: { readonly stepId: string | null } | null } | null;
  readonly decisions: readonly string[];
  readonly showInDiff: boolean;
  readonly text: string;
}

async function pairWindows(): Promise<readonly PairWindowRow[]> {
  const answer = await window.dspatch.pairWindowCheck({ action: 'windows' });
  return answer.ok ? (answer.detail as PairWindowRow[]) : [];
}

async function readPairWindow(id: number): Promise<PairWindowReading | null> {
  const answer = await window.dspatch.pairWindowCheck({ action: 'read', id });
  return answer.ok ? (answer.detail as PairWindowReading) : null;
}

async function inPairWindow(id: number, selector: string, shift = false): Promise<void> {
  const answer = await window.dspatch.pairWindowCheck({ action: 'click', id, selector, shift });
  if (!answer.ok || answer.detail !== true) {
    throw new Error(`could not click ${selector} in review window ${String(id)}: ${JSON.stringify(answer.detail)}`);
  }
  await sleep(150);
}

/** Poll a review window until `done` holds, and give back the last reading. */
async function untilPair(id: number, what: string, done: (reading: PairWindowReading) => boolean, timeoutMs = 20_000): Promise<PairWindowReading> {
  const until = performance.now() + timeoutMs;
  let last: PairWindowReading | null = null;
  while (performance.now() < until) {
    last = await readPairWindow(id);
    if (last !== null && done(last)) {
      return last;
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${what}; last reading: ${JSON.stringify(last?.pair ?? last?.text ?? null).slice(0, 600)}`);
}

/**
 * The way into review lists the ongoing reviews first when there are any (Niclas's trial
 * feedback, 29 October 2026). A scenario that chooses a repository and two commits goes on
 * with *Start a new review*, as a person starting another review would.
 */
async function pastOngoing(id: number): Promise<void> {
  const first = await untilPair(id, 'the way into review', (reading) => ['ongoing', 'repositories', 'log', 'review', 'message'].includes(reading.pair?.phase ?? ''));
  if (first.pair?.phase === 'ongoing') {
    const pressed = await window.dspatch.pairWindowCheck({ action: 'press', id, selector: '[data-ev="pair-new-review"]' });
    if (!pressed.ok) {
      throw new Error(`could not start a new review: ${JSON.stringify(pressed.detail)}`);
    }
    await untilPair(id, 'the repository list or the log', (reading) => reading.pair?.phase === 'repositories' || reading.pair?.phase === 'log');
  }
}

async function untilWindow(what: string, find: (rows: readonly PairWindowRow[]) => PairWindowRow | undefined, timeoutMs = 20_000): Promise<PairWindowRow> {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    const found = find(await pairWindows());
    if (found !== undefined) {
      return found;
    }
    await sleep(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/**
 * Explain this from the diff, answered in the review's panel (Niclas's decision of 30 October
 * 2026): the panel's window, and its reading once the answer to the last question is done.
 * The diff keeps no explanation of its own.
 */
async function explainedInPanel(what: string, timeoutMs = 60_000): Promise<{ readonly panelId: number; readonly reading: PairWindowReading }> {
  const panel = await untilWindow('the review panel', (rows) => rows.find((row) => row.view === ('panel' as string)), timeoutMs);
  type Message = { readonly role: string; readonly status: string };
  const reading = await untilPair(
    panel.id,
    what,
    (entry) => {
      const messages = ((entry as unknown as { discussion?: { messages?: readonly Message[] } | null }).discussion?.messages ?? []);
      const last = messages.at(-1);
      return last?.role === 'answer' && last.status === 'done';
    },
    timeoutMs,
  );
  return { panelId: panel.id, reading };
}

function fileReading(reading: PairWindowReading, path: string): PairFileReading | undefined {
  return reading.pair?.files?.find((file) => file.path === path);
}

function stripOf(reading: PairWindowReading, side: string, line: number): { status: string; label: string } | undefined {
  return reading.pair?.strips?.find((strip) => strip.side === side && strip.line === line);
}

function stripSelector(side: string, line: number): string {
  return `.rv-pair-diff [data-strip][data-side="${side}"][data-line="${String(line)}"]`;
}

/**
 * DSP-150, in the real windows: a workspace with two Git repositories and a folder
 * without Git, the review opened from the chat with a real click, a repository and a
 * revision pair chosen in the log, Files changed, both diff layouts, marks made and
 * withdrawn, a binary and a deleted file, a walk window beside the diff that shares its
 * status but not its place, reopening, and (phase `again`) a restart.
 *
 * No provider is contacted: review of a diff needs none, and nothing here sends.
 */
async function runPairReviewScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'No provider call. The chat window is operated through its controls; the review windows are ' +
      'operated by the client dispatching clicks and keys to their elements and read through their ' +
      'check hooks. The repository is a local fixture (tests/support/pair-fixture.ts).',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const capture = async (id: number, label: string): Promise<void> => {
    // A capture taken at once can return the frame before the last change was painted.
    await sleep(500);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    await click('open-project-0');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);

    // --- Open review from the chat ---------------------------------------------------
    await click('open-review');
    const diff = await untilWindow('a diff review window', (rows) => rows.find((row) => row.view === 'diff'));
    await pastOngoing(diff.id);

    const repos = await untilPair(diff.id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
    record('repositories', { repositories: repos.pair?.repositories });
    expect(
      JSON.stringify(repos.pair?.repositories) === JSON.stringify(['app', 'lib']),
      `the repository list is not app and lib, once each: ${JSON.stringify(repos.pair?.repositories)}`,
    );

    if (phase === 'again') {
      // --- The loop editor is a way in too ----------------------------------------------
      await window.dspatch.pairWindowCheck({ action: 'close', id: diff.id });
      await click('edit-agent-loops');
      const pressed = await (async () => {
        const until = performance.now() + 30_000;
        while (performance.now() < until) {
          const answer = await window.dspatch.editorWindowCheck({ action: 'click', selector: '[data-ev="editor-open-review"]' });
          if (answer.ok) {
            return true;
          }
          await sleep(300);
        }
        return false;
      })();
      expect(pressed, 'the loop editor has no way into review');
      const fromEditor = await untilWindow('a diff window opened from the loop editor', (rows) => rows.find((row) => row.view === 'diff' && row.id !== diff.id));
      await pastOngoing(fromEditor.id);

      const editorRepos = await untilPair(fromEditor.id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
      record('opened from the loop editor', { repositories: editorRepos.pair?.repositories });
      expect(JSON.stringify(editorRepos.pair?.repositories) === JSON.stringify(['app', 'lib']), 'review from the loop editor does not list the workspace repositories');
      await window.dspatch.editorWindowCheck({ action: 'close' });

      // --- After a restart: nothing is chosen; the same pair chosen again comes back as it was ---
      const diffAgain = fromEditor;
      await inPairWindow(diffAgain.id, '[data-ev="pair-repo-0"]');
      const offered = await untilPair(diffAgain.id, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
      record('log after restart', { chosen: offered.pair?.chosen, picked: offered.text.slice(0, 120) });
      expect(offered.pair?.chosen === 0 && offered.text.includes('Click two commits to compare'), 'the log after the restart has commits chosen before anyone clicked');
      await inPairWindow(diffAgain.id, '[data-ev="pair-commit-1"]');
      await inPairWindow(diffAgain.id, '[data-ev="pair-commit-0"]');
      await inPairWindow(diffAgain.id, '[data-ev="pair-open"]');
      const back = await untilPair(diffAgain.id, 'the review back', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
      record('after restart', { fileKey: back.pair?.fileKey, layout: back.pair?.layout, files: back.pair?.files });
      expect(back.pair?.layout === 'unified', `the layout did not come back: ${String(back.pair?.layout)}`);
      expect((back.pair?.fileKey ?? '').includes('src/keep.ts'), `the file did not come back: ${String(back.pair?.fileKey)}`);
      const keep = fileReading(back, 'src/keep.ts');
      expect(keep?.done === true && keep.checkbox, 'keep.ts is not done after the restart');
      expect(fileReading(back, 'assets/logo.bin')?.done === true, 'the binary file decision did not survive the restart');
      expect(stripOf(back, 'target', 8)?.status === 'manual' && stripOf(back, 'base', 3)?.status === 'exempt', 'the strip did not come back as it was');

      // A pair with no walk: the diff review works and says so briefly.
      await inPairWindow(diffAgain.id, '[data-ev="pair-change-revisions"]');
      await inPairWindow(diffAgain.id, '[data-ev="pair-back-to-repositories"]');
      await pastOngoing(diffAgain.id);

      await untilPair(diffAgain.id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
      await inPairWindow(diffAgain.id, '[data-ev="pair-repo-1"]');
      await untilPair(diffAgain.id, 'the lib log', (reading) => reading.text.includes('Bump the library'));
      await inPairWindow(diffAgain.id, '[data-ev="pair-commit-1"]');
      await inPairWindow(diffAgain.id, '[data-ev="pair-commit-0"]');
      await inPairWindow(diffAgain.id, '[data-ev="pair-open"]');
      await untilPair(diffAgain.id, 'the lib review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) === 1);
      const none = await untilPair(diffAgain.id, 'Code walks to settle', (reading) => (reading.pair as { walkCount?: number | null } | undefined)?.walkCount !== null);
      const button = (none.pair as { codeWalks?: { enabled: boolean; tip: string } } | undefined)?.codeWalks;
      record('no walks', { codeWalks: button, files: none.pair?.files });
      expect(button?.enabled === false && button.tip === 'No code walks yet', `Code walks is not dimmed with its reason: ${JSON.stringify(button)}`);
      await inPairWindow(diffAgain.id, '[data-ev="pair-walks"]');
      await sleep(400);
      expect(!(await pairWindows()).some((row) => row.view === 'walk' && row.id !== diffAgain.id && row.pairKey === none.pair?.key), 'a dimmed Code walks opened a window');
      await inPairWindow(diffAgain.id, '[data-ev="pair-file-0"]');
      const lib = await untilPair(diffAgain.id, 'the lib diff', (reading) => (reading.pair?.strips?.length ?? 0) === 2);
      expect(fileReading(lib, 'index.ts')?.percent === 0, 'a pair without walks does not review normally');
      await capture(diffAgain.id, 'no-walks');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    // --- Choose the repository and the revision pair ---------------------------------
    await inPairWindow(diff.id, '[data-ev="pair-repo-0"]');
    await untilPair(diff.id, 'the log', (reading) => reading.text.includes('Rework the app'));
    await inPairWindow(diff.id, '[data-ev="pair-commit-1"]');
    let picked = await readPairWindow(diff.id);
    expect((picked?.text ?? '').includes('click a second commit') && !(picked?.text ?? '').includes('From'), 'the first click gave the commit a role');
    await inPairWindow(diff.id, '[data-ev="pair-commit-0"]');
    picked = await untilPair(diff.id, 'From and To', (reading) => (reading.pair as { direction?: string } | undefined)?.direction === 'ordered');
    const fromFirst = (picked?.text ?? '').indexOf('Start the app');
    const toFirst = (picked?.text ?? '').indexOf('Rework the app');
    expect(fromFirst >= 0 && toFirst > fromFirst, 'From and To are not shown as chosen');
    await inPairWindow(diff.id, '[data-ev="pair-swap"]');
    const swapped = await readPairWindow(diff.id);
    expect((swapped?.text ?? '').includes('Reversed'), 'a reversed direction is not pointed out');
    await inPairWindow(diff.id, '[data-ev="pair-swap"]');
    await capture(diff.id, 'log');
    await inPairWindow(diff.id, '[data-ev="pair-open"]');

    // --- Files changed ---------------------------------------------------------------
    const files = await untilPair(diff.id, 'Files changed', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    record('files changed', { files: files.pair?.files });
    expect(files.pair?.files?.length === 7, `Files changed does not list the seven changes: ${String(files.pair?.files?.length)}`);
    expect(fileReading(files, 'src/keep.ts')?.shown === '0%', 'keep.ts does not start at 0%');
    expect(fileReading(files, 'assets/logo.bin')?.shown === '–' && fileReading(files, 'assets/logo.bin')?.done === false, 'a binary file reads as done or counted');
    expect((files.pair?.files ?? []).every((file) => !file.checkbox), 'a file is done before anything was marked');
    await capture(diff.id, 'files-changed');

    // --- One file, side by side ------------------------------------------------------
    const keepIndex = (files.pair?.files ?? []).findIndex((file) => file.path === 'src/keep.ts');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(keepIndex)}"]`);
    let keep = await untilPair(diff.id, 'the keep.ts diff', (reading) => (reading.pair?.strips?.length ?? 0) === 5);
    expect(keep.pair?.layout === 'split', 'the diff does not start side by side');
    expect(
      JSON.stringify((keep.pair?.strips ?? []).map((strip) => `${strip.side}${String(strip.line)}`).sort()) ===
        JSON.stringify(['base10', 'base3', 'target3', 'target8', 'target9'].sort()),
      `the strip is not on exactly the changed lines: ${JSON.stringify(keep.pair?.strips)}`,
    );
    expect((keep.pair?.strips ?? []).every((strip) => strip.status === 'none' && strip.label.includes('Not yet handled')), 'an unmarked line has a status');

    // Mark two added lines with a click and a Shift-click on the strip.
    await inPairWindow(diff.id, stripSelector('target', 8));
    await inPairWindow(diff.id, stripSelector('target', 9), true);
    await inPairWindow(diff.id, '[data-ev="pair-mark-manual"]');
    keep = await untilPair(diff.id, 'the mark', (reading) => stripOf(reading, 'target', 9)?.status === 'manual');
    record('marked 8-9', { strips: keep.pair?.strips, keep: fileReading(keep, 'src/keep.ts') });
    expect(stripOf(keep, 'target', 8)?.label.includes('Reviewed by you') === true, 'the strip has no status text for a reviewed line');
    expect(fileReading(keep, 'src/keep.ts')?.percent === 40, `two of five lines is not 40%: ${String(fileReading(keep, 'src/keep.ts')?.percent)}`);
    await capture(diff.id, 'split-marked');

    // Unified: the same marks on the same lines.
    await inPairWindow(diff.id, '[data-ev="pair-layout-unified"]');
    keep = await untilPair(diff.id, 'the unified diff', (reading) => reading.pair?.layout === 'unified' && (reading.pair.strips?.length ?? 0) === 5);
    expect(stripOf(keep, 'target', 8)?.status === 'manual' && stripOf(keep, 'target', 9)?.status === 'manual', 'the marks are not in the unified diff');

    // Withdraw one by keyboard: focus its strip, Enter selects, then Clear mark.
    await window.dspatch.pairWindowCheck({ action: 'key', id: diff.id, selector: stripSelector('target', 9), key: 'Enter' });
    await sleep(150);
    await inPairWindow(diff.id, '[data-ev="pair-mark-clear"]');
    keep = await untilPair(diff.id, 'the withdrawal', (reading) => stripOf(reading, 'target', 9)?.status === 'none');
    expect(fileReading(keep, 'src/keep.ts')?.percent === 20, 'withdrawing did not lower the percentage');

    // Exempt the two deleted lines, review the rest: done, with exemptions visible.
    for (const [side, line, action] of [
      ['base', 3, 'pair-mark-exempt'],
      ['base', 10, 'pair-mark-exempt'],
      ['target', 3, 'pair-mark-manual'],
      ['target', 9, 'pair-mark-manual'],
    ] as const) {
      await inPairWindow(diff.id, stripSelector(side, line));
      await inPairWindow(diff.id, `[data-ev="${action}"]`);
      await untilPair(diff.id, `${side} ${String(line)} marked`, (reading) => stripOf(reading, side, line)?.status !== 'none');
    }
    keep = await untilPair(diff.id, 'keep.ts done', (reading) => fileReading(reading, 'src/keep.ts')?.done === true);
    const keepFile = fileReading(keep, 'src/keep.ts');
    record('keep.ts done', { keep: keepFile, strips: keep.pair?.strips });
    expect(keepFile?.manual === 3 && keepFile.exempted === 2, `reviewed and exempted are not kept apart: ${JSON.stringify(keepFile)}`);
    expect(stripOf(keep, 'base', 3)?.status === 'exempt' && (stripOf(keep, 'base', 3)?.label ?? '').includes('Exempted'), 'an exempted deleted line has no exempt strip');
    await capture(diff.id, 'unified-done');

    // --- A binary file and a deleted file --------------------------------------------
    await inPairWindow(diff.id, '[data-ev="pair-files"]');
    const listed = await untilPair(diff.id, 'Files changed again', (reading) => reading.pair?.fileKey === null);
    expect(fileReading(listed, 'src/keep.ts')?.checkbox === true, 'Files changed shows no checkbox for a done file');
    const goneIndex = (listed.pair?.files ?? []).findIndex((file) => file.path === 'docs/gone.md');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(goneIndex)}"]`);
    const gone = await untilPair(diff.id, 'the deleted file', (reading) => (reading.pair?.strips?.length ?? 0) === 3);
    expect((gone.pair?.strips ?? []).every((strip) => strip.side === 'base'), 'a deleted file shows lines that are not deletions');
    await inPairWindow(diff.id, '[data-ev="pair-files"]');
    await untilPair(diff.id, 'Files changed', (reading) => reading.pair?.fileKey === null);
    const logoIndex = (listed.pair?.files ?? []).findIndex((file) => file.path === 'assets/logo.bin');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(logoIndex)}"]`);
    const logo = await untilPair(diff.id, 'the binary file', (reading) => (reading.pair?.diffNote ?? '') !== '');
    expect((logo.pair?.diffNote ?? '').startsWith('Binary file'), `a binary file is not explained: ${String(logo.pair?.diffNote)}`);
    expect(fileReading(logo, 'assets/logo.bin')?.done === false, 'a binary file is done with nothing decided');
    await inPairWindow(diff.id, '[data-ev="pair-file-manual"]');
    await untilPair(diff.id, 'the binary decision', (reading) => fileReading(reading, 'assets/logo.bin')?.done === true);
    const renamedIndex = (listed.pair?.files ?? []).findIndex((file) => file.path === 'src/new-name.ts');
    await inPairWindow(diff.id, '[data-ev="pair-files"]');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(renamedIndex)}"]`);
    const renamed = await untilPair(diff.id, 'the pure rename', (reading) => (reading.pair?.diffNote ?? '') !== '');
    expect((renamed.pair?.diffNote ?? '').startsWith('Renamed without changes'), `a pure rename is not explained: ${String(renamed.pair?.diffNote)}`);

    // Small changes inside long, wrapping lines: the changed characters are marked, in both
    // layouts, as Gerrit marks them (a common trailing "e" of line → range stays light).
    const afterIndex = (listed.pair?.files ?? []).findIndex((file) => file.path === 'src/after.ts');
    await inPairWindow(diff.id, '[data-ev="pair-files"]');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(afterIndex)}"]`);
    for (const layout of ['split', 'unified'] as const) {
      await inPairWindow(diff.id, `[data-ev="pair-layout-${layout}"]`);
      const words = await untilPair(diff.id, `the changed words, ${layout}`, (reading) => reading.pair?.layout === layout && (reading.pair.words?.length ?? 0) > 0);
      const marked = (words.pair?.words ?? []).map((word) => `${word.side}:${word.text}`).sort();
      record(`changed words, ${layout}`, { marked, signs: words.pair?.signs });
      expect(
        JSON.stringify(marked) === JSON.stringify(['base:5', 'base:lin', 'target:five', 'target:rang']),
        `the changed words are not marked in the ${layout} diff: ${JSON.stringify(marked)}`,
      );
      expect((words.pair?.signs ?? '').replace(/\s/g, '') === '−−++' || (words.pair?.signs ?? '').replace(/\s/g, '').split('').sort().join('') === '++−−', `the − and + column is wrong in the ${layout} diff: ${String(words.pair?.signs)}`);
      await capture(diff.id, `words-${layout}`);
    }
    // keep.ts: the edited line has its changed characters; pure additions and the deletion
    // have nothing to compare with and are strong throughout instead.
    const keepAgain = (listed.pair?.files ?? []).findIndex((file) => file.path === 'src/keep.ts');
    await inPairWindow(diff.id, '[data-ev="pair-files"]');
    await inPairWindow(diff.id, `[data-ev="pair-file-${String(keepAgain)}"]`);
    const keepWords = await untilPair(diff.id, 'keep.ts words', (reading) => (reading.pair?.words?.length ?? 0) > 0);
    const keepMarked = (keepWords.pair?.words ?? []).map((word) => `${word.side}:${word.text}`).sort();
    expect(JSON.stringify(keepMarked) === JSON.stringify(['target:0']), `3 → 30 is not marked as the added 0, or pure additions carry marks: ${JSON.stringify(keepMarked)}`);
    const keepWhole = [...new Set(keepWords.pair?.wholeLines ?? [])].sort();
    expect(JSON.stringify(keepWhole) === JSON.stringify(['base:10', 'target:8', 'target:9']), `the pure additions and the deletion are not strong throughout: ${JSON.stringify(keepWhole)}`);
    await capture(diff.id, 'keep-unified-marked');
    await inPairWindow(diff.id, '[data-ev="pair-layout-split"]');
    await untilPair(diff.id, 'keep.ts side by side', (reading) => reading.pair?.layout === 'split');
    // A selected line and keyboard focus on a strip of a red row, for the picture.
    await inPairWindow(diff.id, stripSelector('target', 3));
    await window.dspatch.pairWindowCheck({ action: 'key', id: diff.id, selector: stripSelector('base', 10), key: 'Shift' });
    await capture(diff.id, 'keep-split-selected');
    await inPairWindow(diff.id, stripSelector('target', 3));
    await capture(diff.id, 'keep-split-marked');
    await inPairWindow(diff.id, '[data-ev="pair-layout-unified"]');

    // --- A walk beside the diff ------------------------------------------------------
    await untilPair(diff.id, 'Code walks to be offered', (reading) => ((reading.pair as { walkCount?: number | null } | undefined)?.walkCount ?? 0) > 0);
    await inPairWindow(diff.id, '[data-ev="pair-walks"]');
    const walk = await untilWindow('a walk window', (rows) => rows.find((row) => row.view === 'walk'));
    const walkReading = await untilPair(walk.id, 'the walk to open and join the pair', (reading) => reading.walk?.kind === 'opened' && reading.showInDiff, 30_000);
    const walkRows = await pairWindows();
    expect(walkRows.find((row) => row.id === walk.id)?.pairKey === walkRows.find((row) => row.id === diff.id)?.pairKey, 'the walk is not over the same pair as the diff');
    expect(walkRows.some((row) => row.id === diff.id), 'opening the walk closed the diff');

    // Independent navigation: a step change in the walk does not move the diff.
    const diffBefore = await readPairWindow(diff.id);
    await window.dspatch.pairWindowCheck({ action: 'go-to-step', id: walk.id, stepId: 'W1.2' });
    await sleep(600);
    const diffAfterStep = await readPairWindow(diff.id);
    record('walk step changed', { before: diffBefore?.pair?.fileKey, after: diffAfterStep?.pair?.fileKey, walk: walkReading.walk?.position });
    expect(diffAfterStep?.pair?.fileKey === diffBefore?.pair?.fileKey, 'a step in the walk moved the diff');

    // Shared status: the walk reads the marks made in the diff, without counting them twice.
    await inPairWindow(walk.id, '[data-ev="walk-review-section"]');
    const walkSees = await untilPair(walk.id, 'the walk to show the diff marks', (reading) => reading.decisions.length > 0);
    record('walk decisions', { decisions: walkSees.decisions });
    expect(walkSees.decisions.some((text) => /accepted|godkänd/i.test(text)), `the walk does not see the marks made in the diff: ${JSON.stringify(walkSees.decisions)}`);
    expect(fileReading((await readPairWindow(diff.id)) as PairWindowReading, 'src/keep.ts')?.manual === 3, 'the walk opening changed the count');

    // `Show in diff`: the explicit way a walk moves the diff.
    await inPairWindow(walk.id, '[data-ev="walk-show-in-diff"]');
    const shown = await untilPair(diff.id, 'the diff to show the walk place', (reading) => reading.pair?.targetShown === true);
    expect((shown.pair?.fileKey ?? '').includes('src/keep.ts'), 'Show in diff did not open the file the walk is at');

    // A mark withdrawn in the walk reaches the diff.
    await inPairWindow(walk.id, '.rv-decision-actions button');
    const fromWalk = await untilPair(diff.id, 'the diff to see the walk withdrawal', (reading) => fileReading(reading, 'src/keep.ts')?.done === false);
    record('withdrawn in the walk', { keep: fileReading(fromWalk, 'src/keep.ts'), strips: fromWalk.pair?.strips });
    // Mark the lines again in the diff, which the walk then sees.
    await inPairWindow(diff.id, '[data-ev="pair-file-manual"]');
    await untilPair(diff.id, 'keep.ts done again', (reading) => fileReading(reading, 'src/keep.ts')?.done === true);
    await capture(walk.id, 'walk');
    await capture(diff.id, 'shown-in-diff');

    // --- Close the diff and open it again: the walk keeps going, the diff comes back --
    await window.dspatch.pairWindowCheck({ action: 'close', id: diff.id });
    await click('open-review');
    const reopened = await untilWindow('the diff window again', (rows) => rows.find((row) => row.view === 'diff' && row.id !== diff.id));
    await pastOngoing(reopened.id);

    await untilPair(reopened.id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
    await inPairWindow(reopened.id, '[data-ev="pair-repo-0"]');
    // Nothing is chosen when the log opens again; the person chooses the same pair.
    const emptyLog = await untilPair(reopened.id, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
    record('log reopened', { chosen: emptyLog.pair?.chosen });
    expect(emptyLog.pair?.chosen === 0 && emptyLog.text.includes('Click two commits to compare'), 'the reopened log has commits chosen before anyone clicked');
    await inPairWindow(reopened.id, '[data-ev="pair-commit-1"]');
    await inPairWindow(reopened.id, '[data-ev="pair-commit-0"]');
    await inPairWindow(reopened.id, '[data-ev="pair-open"]');
    const again = await untilPair(reopened.id, 'the reopened review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    record('reopened', { fileKey: again.pair?.fileKey, layout: again.pair?.layout, keep: fileReading(again, 'src/keep.ts') });
    expect(again.pair?.layout === 'unified' && (again.pair.fileKey ?? '').includes('src/keep.ts'), 'the reopened diff did not come back where it was');
    expect(fileReading(again, 'src/keep.ts')?.done === true, 'the marks did not survive reopening the diff');

    // Change revisions: the log again starts empty, and the same pair chosen again keeps its marks.
    await inPairWindow(reopened.id, '[data-ev="pair-change-revisions"]');
    const changeLog = await untilPair(reopened.id, 'the log from Change revisions', (reading) => reading.pair?.phase === 'log' && (reading.pair.commits ?? 0) === 2);
    record('log from Change revisions', { chosen: changeLog.pair?.chosen });
    expect(changeLog.pair?.chosen === 0, 'Change revisions opens the log with commits already chosen');
    await capture(reopened.id, 'log-empty');
    await inPairWindow(reopened.id, '[data-ev="pair-commit-1"]');
    await inPairWindow(reopened.id, '[data-ev="pair-commit-0"]');
    await inPairWindow(reopened.id, '[data-ev="pair-open"]');
    const samePair = await untilPair(reopened.id, 'the same pair again', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    expect(fileReading(samePair, 'src/keep.ts')?.done === true, 'choosing the same pair again lost its marks');
    // A late window still hears the other: a withdrawal in the walk reaches the new diff.
    await inPairWindow(walk.id, '.rv-decision-actions button');
    await untilPair(reopened.id, 'the reopened diff to hear the walk', (reading) => fileReading(reading, 'src/keep.ts')?.done === false);
    await inPairWindow(reopened.id, '[data-ev="pair-file-manual"]');
    await untilPair(reopened.id, 'keep.ts done for the restart', (reading) => fileReading(reading, 'src/keep.ts')?.done === true);
    const strips = await untilPair(reopened.id, 'the strips for the restart', (reading) => stripOf(reading, 'base', 3)?.status === 'manual');
    // Leave keep.ts as the restart phase expects it: base 3 exempted again.
    void strips;
    await inPairWindow(reopened.id, stripSelector('base', 3));
    await inPairWindow(reopened.id, '[data-ev="pair-mark-exempt"]');
    await untilPair(reopened.id, 'base 3 exempted', (reading) => stripOf(reading, 'base', 3)?.status === 'exempt');
    await sleep(600);
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = {
      windows: rows,
      readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * DSP-150: from the chat to a walk. *Open review* opens a diff window; the scenario
 * chooses the pair in its log (the only two commits of the review fixture, From the
 * older), and opens the review.
 */
async function openDiffFromChat(): Promise<{ readonly id: number; readonly note: string | null }> {
  const before = new Set((await pairWindows()).map((row) => row.id));
  await click('open-review');
  await sleep(800);
  const note = element('review-window-note') === null ? null : textOf('review-window-note');
  const diff = await untilWindow('a new diff window', (rows) => rows.find((row) => row.view === 'diff' && !before.has(row.id)));
  return { id: diff.id, note };
}

async function choosePairInDiff(id: number): Promise<PairWindowReading> {
  // Since 29 October 2026 (e73d66b) the log no longer says "click a commit"; whether Open can
  // be pressed says whether the two commits still have to be chosen.
  const log = await untilPair(id, 'the log', (reading) => reading.pair?.phase === 'log' && ((reading.pair as { commits?: number } | undefined)?.commits ?? 0) > 1);
  if ((log.pair as { openEnabled?: boolean } | undefined)?.openEnabled !== true) {
    await inPairWindow(id, '[data-ev="pair-commit-1"]');
    await inPairWindow(id, '[data-ev="pair-commit-0"]');
  }
  await inPairWindow(id, '[data-ev="pair-open"]');
  return untilPair(id, 'the diff review', (reading) => reading.pair?.phase === 'review');
}

/**
 * Open a walk over the diff window's pair through *Code walks*: the first walk listed
 * when `listed`, otherwise the walk file the scripted pick names. The diff window is
 * closed afterwards, so the walk scenarios go on with the windows they had before.
 */
async function openWalkFromDiff(id: number, listed: boolean): Promise<void> {
  void listed;
  await untilPair(id, 'Code walks to be offered', (reading) => ((reading.pair as { walkCount?: number | null } | undefined)?.walkCount ?? 0) > 0);
  await inPairWindow(id, '[data-ev="pair-walks"]');
  await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'));
  await sleep(500);
  await window.dspatch.pairWindowCheck({ action: 'close', id });
  // Closing the diff window hands the focus to whichever window is next; a person would
  // be looking at the walk they just opened, so it is brought back to the front.
  const walks = (await pairWindows()).filter((row) => row.view === 'walk');
  const newest = walks.at(-1);
  if (newest !== undefined) {
    await window.dspatch.pairWindowCheck({ action: 'focus', id: newest.id });
  }
}

async function closeDiffWindows(): Promise<void> {
  for (const row of await pairWindows()) {
    if (row.view === 'diff') {
      await window.dspatch.pairWindowCheck({ action: 'close', id: row.id });
    }
  }
}

/* ------------------------------------------------------------------------- */
/* DSP-152: agent-generated code walks, deepening and delegated review        */
/* ------------------------------------------------------------------------- */

interface JobReading {
  readonly id: string;
  readonly kind: 'walks' | 'review';
  readonly state: string;
  readonly provider?: string;
  readonly model?: string;
  readonly note: string;
  readonly detail?: string;
  readonly scope: string | null;
  readonly approved: readonly { readonly start: number; readonly end: number; readonly path: string }[];
  readonly findings: number;
  readonly insufficient: boolean;
  readonly definitionPath: string | null;
  readonly uncovered: number;
}

function jobsOf(reading: PairWindowReading | null): readonly JobReading[] {
  return ((reading?.pair as { jobs?: JobReading[] } | null)?.jobs ?? []);
}

function lastJob(reading: PairWindowReading | null, kind: 'walks' | 'review', scope?: string): JobReading | undefined {
  return [...jobsOf(reading)].reverse().find((job) => job.kind === kind && (scope === undefined || (job.scope ?? '').includes(scope)));
}

const settledJob = (job: JobReading | undefined): boolean => job !== undefined && job.state !== 'running' && job.state !== 'cancelling';

/** How many prompts the review adapters were sent, from the host's record of them. */
async function reviewPromptsSent(): Promise<readonly string[]> {
  const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
  const reading = answer.detail as { adapterSent?: { review?: readonly string[] } };
  return reading.adapterSent?.review ?? [];
}

/**
 * DSP-152 in the real windows, with the SIMULATED presentation provider: prepare code
 * walks for a chosen pair (with one repair round), open a generated walk, deepen a step
 * and a selected sentence, delegate lines, a file with too little material and a walk,
 * stop a delegated review, and read it all back after reopening and (phase `again`) a
 * restart without any agent call being repeated.
 *
 * Simulated answers prove the flow, not what a real model writes or how well it explains.
 */
async function runCodeWalksScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase ?? 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider (presentation adapter with DSPATCH_REVIEW_SIM=bad-ref-first). The windows, the host, ' +
      'its job records, git and the review discussion are real. Simulated answers prove the flow, not the ' +
      'quality of a real model\'s walks or explanations.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(500);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  const openApp = async (id: number): Promise<PairWindowReading> => {
    await pastOngoing(id);

    await untilPair(id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
    await inPairWindow(id, '[data-ev="pair-repo-0"]');
    await untilPair(id, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
    await inPairWindow(id, '[data-ev="pair-commit-1"]');
    await inPairWindow(id, '[data-ev="pair-commit-0"]');
    await inPairWindow(id, '[data-ev="pair-open"]');
    return untilPair(id, 'the diff review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
  };
  /** Open a file of the review from Files changed, whatever the window shows now. */
  const showFile = async (id: number, filePath: string): Promise<void> => {
    await inPairWindow(id, '[data-ev="pair-files"]').catch(() => undefined);
    const list = await untilPair(id, 'Files changed', (reading) => reading.pair?.fileKey === null && (reading.pair.files?.length ?? 0) > 0);
    const index = (list.pair?.files ?? []).findIndex((file) => file.path === filePath);
    await inPairWindow(id, `[data-ev="pair-file-${String(index)}"]`);
  };
  const delegate = async (id: number, starter: string, scopeWord: string): Promise<JobReading> => {
    await inPairWindow(id, starter);
    await untilPair(id, 'the agent picker', (reading) => reading.text.includes('Agent') && reading.text.includes('Model'), 15_000);
    await inPairWindow(id, '[data-ev="pair-delegate-agent-start"], [data-ev="pair-delegate-all-agent-start"]');
    const done = await untilPair(id, `the delegated review of ${scopeWord}`, (reading) => settledJob(lastJob(reading, 'review', scopeWord)), 60_000);
    return lastJob(done, 'review', scopeWord) as JobReading;
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    await click('open-project-0');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    await click('open-review');
    const diff = await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'));
    const opened = await openApp(diff.id);

    if (phase === 'again') {
      // --- After a restart: everything read back, nothing asked again -------------------
      const sentBefore = (await reviewPromptsSent()).length;
      const jobs = jobsOf(opened);
      const interrupted = jobs.find((job) => (job.scope ?? '').includes('src/after.ts'));
      record('after restart', { jobs: jobs.map((job) => `${job.kind}:${job.state}:${job.scope ?? ''}`), sentBefore });
      expect(jobs.some((job) => job.kind === 'walks' && job.state === 'done'), 'the prepared walks are not in the record after a restart');
      expect(jobs.some((job) => job.kind === 'review' && job.state === 'done' && job.findings > 0), 'the delegated review and its findings are not back after a restart');
      expect(interrupted?.state === 'unknown', `a review interrupted by closing DSpatch is not unknown: ${String(interrupted?.state)}`);
      expect((interrupted?.approved.length ?? 0) === 0, 'an interrupted review approved something');
      await showFile(diff.id, 'src/keep.ts');
      const keep = await untilPair(diff.id, 'keep.ts with its agent review', (reading) => (reading.pair?.strips?.length ?? 0) === 5 && ((reading.pair as { agentReviewsShown?: number }).agentReviewsShown ?? 0) > 0);
      expect(stripOf(keep, 'target', 8)?.status === 'agent', 'the agent approval is not drawn after a restart');
      await untilPair(diff.id, 'Code walks to be offered', (reading) => ((reading.pair as { walkCount?: number | null } | undefined)?.walkCount ?? 0) > 0);
      await inPairWindow(diff.id, '[data-ev="pair-walks"]');
      const walk = await untilWindow('the generated walk', (rows) => rows.find((row) => row.view === 'walk'));
      const walkBack = await untilPair(walk.id, 'the walk with its deepenings', (reading) => reading.walk?.kind === 'opened' && (reading as { deepenings?: unknown[] }).deepenings !== undefined && ((reading as { deepenings?: unknown[] }).deepenings?.length ?? 0) > 0, 30_000);
      record('walk after restart', { deepenings: (walkBack as { deepenings?: unknown[] }).deepenings });
      await sleep(1500);
      const sentAfter = (await reviewPromptsSent()).length;
      expect(sentAfter === sentBefore, `reopening after a restart sent ${String(sentAfter - sentBefore)} prompt(s) to the agent`);
      await capture(walk.id, 'walk-after-restart');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    // --- 1. Prepare code walks with a chosen agent and model ------------------------------
    await inPairWindow(diff.id, '[data-ev="pair-prepare-walks"]');
    await untilPair(diff.id, 'the agent picker', (reading) => reading.text.includes('Agent') && reading.text.includes('Model'), 15_000);
    await capture(diff.id, 'prepare-picker');
    await inPairWindow(diff.id, '[data-ev="pair-walks-agent-start"]');
    const running = await untilPair(diff.id, 'the preparation to run', (reading) => lastJob(reading, 'walks') !== undefined);
    record('preparing', { job: lastJob(running, 'walks') });
    const prepared = await untilPair(diff.id, 'the walks prepared', (reading) => settledJob(lastJob(reading, 'walks')), 90_000);
    const walksJob = lastJob(prepared, 'walks');
    record('prepared', { job: walksJob });
    expect(walksJob?.state === 'done', `the preparation did not finish: ${String(walksJob?.state)} ${String(walksJob?.note)}`);
    expect((walksJob?.uncovered ?? 0) > 0 && (walksJob?.note ?? '').includes('in none of them'), 'the changed lines no walk covers are not shown');
    const sentAfterPrepare = await reviewPromptsSent();
    expect(sentAfterPrepare.filter((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: prepare-walks')).length === 1, 'the preparation was sent more than once');
    expect(sentAfterPrepare.filter((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: repair-walks')).length === 1, 'a bad reference did not get exactly one repair round');
    expect(!sentAfterPrepare.some((prompt) => prompt.includes('WORKING TREE ONLY')), 'the agent was given working-copy content');
    await capture(diff.id, 'prepared');

    // --- 2. The generated walk opens by itself, once --------------------------------------------
    const walk = await untilWindow('the generated walk window', (rows) => rows.find((row) => row.view === 'walk'));
    const walkOpen = await untilPair(walk.id, 'the generated walk', (reading) => reading.walk?.kind === 'opened', 30_000);
    expect(walkOpen.text.includes('A walk is not a review') || walkOpen.text.includes('SIMULATED'), 'the generated walk does not show its provenance or text');
    await capture(walk.id, 'walk-normal');
    await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: walk.id, label: 'walk-narrow', width: 1000 });
    const narrow = (await readPairWindow(walk.id)) as unknown as { rightWidth?: number; codeWidth?: number; overflowX?: boolean };
    record('walk layout', { normal: { right: (walkOpen as unknown as { rightWidth?: number }).rightWidth, code: (walkOpen as unknown as { codeWidth?: number }).codeWidth }, narrow });
    expect(narrow.overflowX === false && (narrow.codeWidth ?? 0) > 200, 'the walk window does not leave the code usable in a smaller window');

    // The explanation column, docked in the walk window: dragged wider with the keyboard, and kept.
    await window.dspatch.pairWindowCheck({ action: 'resize', id: walk.id, width: 1800, height: 950 });
    await inPairWindow(walk.id, '[data-ev="panel-dock-walk"]');
    await sleep(600);
    const before = (await readPairWindow(walk.id)) as unknown as { rightWidth?: number };
    await window.dspatch.pairWindowCheck({ action: 'key', id: walk.id, selector: '[data-ev="walk-divider"]', key: 'ArrowLeft' });
    await sleep(400);
    const widened = (await readPairWindow(walk.id)) as unknown as { rightWidth?: number };
    record('divider', { before: before.rightWidth, after: widened.rightWidth });
    expect((widened.rightWidth ?? 0) > (before.rightWidth ?? 0), 'the divider did not widen the explanation');
    await inPairWindow(walk.id, '[data-ev="panel-own-window"]');

    // --- 3. Deepen the step, and a selected sentence -------------------------------------------
    await inPairWindow(walk.id, '[data-ev="step-tell-more"]');
    const more = await untilPair(walk.id, 'Tell me more answered', (reading) => ((reading as { deepenings?: { state: string }[] }).deepenings ?? []).some((entry) => entry.state === 'done'), 60_000);
    record('tell me more', { deepenings: (more as { deepenings?: unknown }).deepenings });
    // A real drag over the explanation (30 October 2026: the walk window reads mouse selections).
    const dragged = await window.dspatch.pairWindowCheck({ action: 'drag', id: walk.id, from: { selector: '.rv-step-panel .rv-explanation', offset: 0 }, to: { selector: '.rv-step-panel .rv-explanation', offset: 24 } });
    const chosen = { detail: (dragged.detail as { selected?: string } | null)?.selected ?? '' };
    record('selected', { text: chosen.detail });
    await inPairWindow(walk.id, '[data-ev="step-explain-this"]');
    const explained = await untilPair(walk.id, 'Explain this answered', (reading) => ((reading as { deepenings?: { state: string }[] }).deepenings ?? []).filter((entry) => entry.state === 'done').length === 2, 60_000);
    const deepenings = (explained as { deepenings?: { text: string }[] }).deepenings ?? [];
    expect(deepenings.some((entry) => entry.text.startsWith('Explain this') && entry.text.includes(String(chosen.detail).slice(0, 10))), 'Explain this did not carry the selected text');
    const prompts = await reviewPromptsSent();
    const deepenPrompt = prompts.find((prompt) => prompt.includes('Tell me more about this step'));
    expect(deepenPrompt !== undefined && deepenPrompt.includes('Target revision') && deepenPrompt.includes('Step:'), 'the deepening was not sent with the revisions and its step');
    await inPairWindow(walk.id, '[data-ev="step-continue-discussion"]');
    const thread = await untilPair(walk.id, 'the discussion with the deepening', (reading) => reading.text.includes('Tell me more about this step'));
    expect(thread.text.includes('Explain this, in the context of this step'), 'the deepenings are not in the discussion to continue from');
    await inPairWindow(walk.id, '[data-ev="right-tab-step"]');
    await capture(walk.id, 'deepened');

    // --- 4. Delegate lines from the diff: an approval and a finding -----------------------------
    await window.dspatch.pairWindowCheck({ action: 'focus', id: diff.id });
    await showFile(diff.id, 'src/keep.ts');
    await untilPair(diff.id, 'keep.ts', (reading) => (reading.pair?.strips?.length ?? 0) === 5);
    await inPairWindow(diff.id, stripSelector('target', 8));
    await inPairWindow(diff.id, stripSelector('target', 9), true);
    const lines = await delegate(diff.id, '[data-ev="pair-delegate-selection"]', 'src/keep.ts lines 8–9');
    record('delegated lines', { job: lines });
    expect(lines.state === 'done' && lines.approved.length === 1 && lines.approved[0]?.start === 8 && lines.approved[0]?.end === 8, `the delegated lines did not approve exactly line 8: ${JSON.stringify(lines)}`);
    expect(lines.findings === 1, 'the finding on line 9 is not recorded');
    const keep = await untilPair(diff.id, 'the agent strip', (reading) => stripOf(reading, 'target', 8)?.status === 'agent');
    expect(stripOf(keep, 'target', 9)?.status === 'none', 'a line with a problem was marked as reviewed');
    expect(((keep.pair as { findingsShown?: string[] }).findingsShown ?? []).some((text) => text.includes('Problem')), 'the finding is not shown at the file');
    expect((fileReading(keep, 'src/keep.ts')?.percent ?? 0) === 20, `one delegated approval of five lines is not 20%: ${String(fileReading(keep, 'src/keep.ts')?.percent)}`);
    await capture(diff.id, 'delegated-lines');

    // --- 5. A file with too little material: nothing approved ---------------------------------
    await showFile(diff.id, 'docs/gone.md');
    await untilPair(diff.id, 'the deleted file', (reading) => (reading.pair?.strips?.length ?? 0) === 3);
    const gone = await delegate(diff.id, '[data-ev="pair-delegate-file"]', 'docs/gone.md');
    record('delegated insufficient', { job: gone });
    expect(gone.insufficient && gone.approved.length === 0, 'an insufficient review approved something');

    // --- 6. A delegated walk, seen in the diff ---------------------------------------------------
    await window.dspatch.pairWindowCheck({ action: 'focus', id: walk.id });
    // The first code walk: the preparation puts a reading of the removed document before it.
    // The step the walk was on is returned to afterwards, where its deepenings were asked.
    const stepBeforeDelegation = (await readPairWindow(walk.id))?.walk?.position?.stepId ?? null;
    await window.dspatch.pairWindowCheck({ action: 'go-to-step', id: walk.id, stepId: 'W1.1' });
    await sleep(400);
    await inPairWindow(walk.id, '[data-ev="walk-delegate"]');
    await untilPair(walk.id, 'the walk agent picker', (reading) => reading.text.includes('Delegate this walk'), 15_000);
    await inPairWindow(walk.id, '[data-ev="walk-delegate-agent-start"]');
    const walkDelegated = await untilPair(walk.id, 'the walk review', (reading) => {
      const state = (reading as { walkJob?: string | null }).walkJob;
      return state === 'done' || state === 'failed' || state === 'unknown';
    }, 60_000);
    record('delegated walk', { state: (walkDelegated as { walkJob?: unknown }).walkJob, text: (walkDelegated as { walkJobText?: unknown }).walkJobText });
    const afterWalk = await untilPair(diff.id, 'the walk review in the diff', (reading) => settledJob(lastJob(reading, 'review', 'walk W1')));
    expect(lastJob(afterWalk, 'review', 'walk W1')?.state === 'done', 'the delegated walk did not reach the diff window');
    if (stepBeforeDelegation !== null) {
      await window.dspatch.pairWindowCheck({ action: 'go-to-step', id: walk.id, stepId: stepBeforeDelegation });
    }

    // --- 7. Stop a delegated review: nothing approved --------------------------------------------
    await window.dspatch.pairWindowCheck({ action: 'focus', id: diff.id });
    await showFile(diff.id, 'src/added.ts');
    await untilPair(diff.id, 'added.ts', (reading) => (reading.pair?.strips?.length ?? 0) === 2);
    await inPairWindow(diff.id, '[data-ev="pair-delegate-file"]');
    await untilPair(diff.id, 'the agent picker', (reading) => reading.text.includes('Model'), 15_000);
    await inPairWindow(diff.id, '[data-ev="pair-delegate-agent-start"]');
    await untilPair(diff.id, 'the review running', (reading) => lastJob(reading, 'review', 'src/added.ts')?.state === 'running');
    await inPairWindow(diff.id, '[data-ev="agent-job-review-stop"]');
    const stopped = await untilPair(diff.id, 'the review stopped', (reading) => settledJob(lastJob(reading, 'review', 'src/added.ts')), 60_000);
    const stoppedJob = lastJob(stopped, 'review', 'src/added.ts');
    record('stopped review', { job: stoppedJob });
    expect((stoppedJob?.state === 'cancelled' || stoppedJob?.state === 'unknown') && stoppedJob.approved.length === 0, `a stopped review is not recorded as stopped without approvals: ${JSON.stringify(stoppedJob)}`);

    // --- 8. Close and reopen: read back, nothing asked again ----------------------------------
    const sentBeforeReopen = (await reviewPromptsSent()).length;
    await window.dspatch.pairWindowCheck({ action: 'close', id: walk.id });
    await window.dspatch.pairWindowCheck({ action: 'close', id: diff.id });
    await click('open-review');
    const again = await untilWindow('the diff window again', (rows) => rows.find((row) => row.view === 'diff' && row.id !== diff.id));
    await openApp(again.id);
    await showFile(again.id, 'src/keep.ts');
    const reread = await untilPair(again.id, 'the agent review read back', (reading) => ((reading.pair as { agentReviewsShown?: number }).agentReviewsShown ?? 0) > 0);
    await sleep(1000);
    const sentAfterReopen = (await reviewPromptsSent()).length;
    record('reopened', { jobs: jobsOf(reread).length, sentBeforeReopen, sentAfterReopen });
    expect(sentAfterReopen === sentBeforeReopen, `reopening sent ${String(sentAfterReopen - sentBeforeReopen)} prompt(s) to the agent`);
    expect(jobsOf(reread).length === jobsOf(stopped).length, 'reopening changed the recorded agent work');

    // --- 9. A review still running when DSpatch closes: phase `again` must find it unknown -----
    await showFile(again.id, 'src/after.ts');
    await untilPair(again.id, 'after.ts', (reading) => (reading.pair?.strips?.length ?? 0) > 0);
    await inPairWindow(again.id, '[data-ev="pair-delegate-file"]');
    await untilPair(again.id, 'the agent picker', (reading) => reading.text.includes('Model'), 15_000);
    await inPairWindow(again.id, '[data-ev="pair-delegate-agent-start"]');
    await untilPair(again.id, 'the last review running', (reading) => lastJob(reading, 'review', 'src/after.ts')?.state === 'running');
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (caught) {
    failures.push(caught instanceof Error ? caught.message : String(caught));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = {
      windows: rows,
      readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))),
    };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

interface PickerReading {
  readonly ev: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly modelReading: string | null;
  readonly options: readonly string[] | null;
  readonly startDisabled: boolean | null;
  readonly note: string;
  readonly text: string;
}

function pickerOf(reading: PairWindowReading | null, ev: string): PickerReading | undefined {
  return ((reading as { pickers?: PickerReading[] } | null)?.pickers ?? []).find((picker) => picker.ev === ev);
}

/** The agents the review adapters were built for, and each session's agent and model, from the host. */
async function reviewAdapterRecord(): Promise<{
  readonly built: readonly string[];
  readonly starts: readonly { readonly provider: string; readonly modelRequested: string }[];
  readonly sendModels: readonly string[];
}> {
  const answer = await window.dspatch.reviewWindowCheck({ action: 'read' });
  const sent = (answer.detail as { adapterSent?: { reviewBuilt?: string[] | null; reviewStarts?: { provider: string; modelRequested: string }[] | null; reviewSendModels?: string[] | null } }).adapterSent;
  return { built: sent?.reviewBuilt ?? [], starts: sent?.reviewStarts ?? [], sendModels: sent?.reviewSendModels ?? [] };
}

/**
 * DSP-152, after Niclas's first live trial: the agent and model of a review's agent work.
 * The kit's person chose Claude with an explicit model in the chat (the kit is seeded so);
 * the presentation adapter answers in place of every provider (SIMULATED).
 *
 * Phases, each in a fresh kit:
 * - `chat`: review opened from the chat; the picker shows Claude and that model and walks
 *   are prepared with them; then the model is changed with the keyboard in a delegation,
 *   which is what the next job gets, and what the picker offers after.
 * - `editor`: the same from the loop editor, a delegation first and walks after a change.
 * - `unavailable`: the `first` phase's kit launched again without Claude, the chat on
 *   Cursor; the review's own choice (Claude) cannot be used, so the picker says so and
 *   offers a choice instead of taking Cursor, and nothing is built or started.
 * - `start-fails`: the session start is refused (a SIMULATED provider error); the window
 *   shows a short note, keeps the raw text under Details, approves nothing and tries no
 *   other agent.
 * - `history`: Niclas's second live trial. The kit's chat chose Claude with `opus`, and the
 *   review of the same revision pair already holds a failed Cursor job copied from a real
 *   record (written before the fix, raw text inside its note). Reopening shows that job as
 *   an earlier attempt with its own agent, model and time and the raw text under Details;
 *   choosing anew hides it; the start runs Claude/`opus`.
 *
 * In every phase the review adapters are built only for Claude: Cursor is never built.
 * The review windows are pressed with real input events (`press`, `press-key`).
 */
async function runReviewAgentChoiceScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  // `first` (the default) is the chat's way in.
  const phase = plan.flowPhase === undefined || plan.flowPhase === 'first' ? 'chat' : plan.flowPhase;
  const chosenModel = phase === 'history' ? 'opus' : 'claude-sonnet-4-5';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider: the presentation adapter answers for every agent and lists a fixed set of models. ' +
      'The windows, the host, its job records and the provider factory are real; no provider was contacted.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const press = async (id: number, selector: string): Promise<void> => {
    const answer = await window.dspatch.pairWindowCheck({ action: 'press', id, selector });
    if (!answer.ok) {
      throw new Error(`could not press ${selector}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(200);
  };
  const pressKey = async (id: number, selector: string, key: string): Promise<void> => {
    const answer = await window.dspatch.pairWindowCheck({ action: 'press-key', id, selector, key });
    if (!answer.ok) {
      throw new Error(`could not press ${key} on ${selector}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(250);
  };
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(300);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  const openPair = async (id: number): Promise<PairWindowReading> => {
    await pastOngoing(id);

    await untilPair(id, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
    await press(id, '[data-ev="pair-repo-0"]');
    await untilPair(id, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
    await press(id, '[data-ev="pair-commit-1"]');
    await press(id, '[data-ev="pair-commit-0"]');
    await press(id, '[data-ev="pair-open"]');
    return untilPair(id, 'the diff review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
  };
  /** A picker that has read its agents and, with an agent chosen, that agent's models. */
  const pickerReady =
    (ev: string) =>
    (reading: PairWindowReading): boolean => {
      const picker = pickerOf(reading, ev);
      return picker !== undefined && picker.modelReading === null && !picker.text.startsWith('Reading the agents') && (picker.provider === '' || picker.options !== null || picker.model !== null);
    };
  const runJob = async (id: number, starter: string, kind: 'walks' | 'review'): Promise<JobReading | undefined> => {
    const before = jobsOf(await readPairWindow(id)).length;
    await press(id, starter);
    const done = await untilPair(id, `the ${kind} job`, (reading) => jobsOf(reading).length > before && settledJob(lastJob(reading, kind)), 60_000);
    return lastJob(done, kind);
  };
  const expectChoice = (picker: PickerReading | undefined, model: string, where: string): void => {
    record(`picker ${where}`, { picker });
    expect(picker?.provider === 'claude', `${where}: the picker shows ${String(picker?.provider)}, not Claude`);
    expect(picker?.model === model, `${where}: the picker shows the model ${String(picker?.model)}, not ${model}`);
    expect(picker?.startDisabled === false, `${where}: the picker cannot start with the choice it shows`);
  };
  const expectJob = async (job: JobReading | undefined, model: string, where: string): Promise<void> => {
    const adapter = await reviewAdapterRecord();
    const lastStart = adapter.starts.at(-1);
    record(`job ${where}`, { job, lastStart, built: adapter.built });
    expect(job?.provider === 'claude' && job.model === model, `${where}: the job ran with ${String(job?.provider)} ${String(job?.model)}, not Claude ${model}`);
    expect(lastStart?.provider === 'claude' && lastStart.modelRequested === model, `${where}: the adapter's session was opened for ${JSON.stringify(lastStart)}, not Claude ${model}`);
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    if (phase === 'unavailable') {
      await chooseInSelect('open-agent-select', 'cursor');
    }
    await click('open-project-0');

    if (phase === 'unavailable') {
      // The kit of the `first` phase, launched again without Claude: the review chose
      // Claude there, and the chat here runs with Cursor, chosen explicitly. The review's
      // own choice cannot be used, so the picker must say so rather than take Cursor.
      await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
      await click('open-review');
      const diff = await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'));
      await openPair(diff.id);
      await press(diff.id, '[data-ev="pair-prepare-walks"]');
      // Since the analysis access (DSP-152) Cursor does no analysis work either, so neither
      // agent can be used: the picker says why for both and offers no start at all.
      const shown = await untilPair(diff.id, 'the picker', (reading) => (pickerOf(reading, 'pair-walks-agent')?.text ?? '').startsWith('No agent can be used here'), 20_000);
      const picker = pickerOf(shown, 'pair-walks-agent');
      record('picker unavailable', { picker });
      expect(picker?.provider === null && picker.startDisabled === null, `an agent was offered or a start drawn: ${JSON.stringify(picker)}`);
      expect((picker?.text ?? '').includes('Claude') && (picker?.text ?? '').includes('Cursor cannot be limited to reading'), `the picker does not say why neither agent can be used: ${String(picker?.text)}`);
      await capture(diff.id, 'picker-unavailable');
      const adapter = await reviewAdapterRecord();
      record('adapters', adapter);
      expect(adapter.built.length === 0 && adapter.starts.length === 0, `an adapter was built or a session started: ${JSON.stringify(adapter)}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    if (phase === 'editor') {
      await click('edit-agent-loops');
      const pressed = await (async () => {
        const until = performance.now() + 30_000;
        while (performance.now() < until) {
          const answer = await window.dspatch.editorWindowCheck({ action: 'click', selector: '[data-ev="editor-open-review"]' });
          if (answer.ok) {
            return true;
          }
          await sleep(300);
        }
        return false;
      })();
      expect(pressed, 'the loop editor has no way into review');
    } else {
      await click('open-review');
    }
    const diffId = (await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'))).id;
    await openPair(diffId);

    if (phase === 'history') {
      // --- The stored Cursor failure, read back: an earlier attempt, not this choice -----------
      const reopened = await untilPair(diffId, 'the earlier job read back', (reading) => lastJob(reading, 'walks') !== undefined);
      const earlier = lastJob(reopened, 'walks');
      const shown = (reopened as { visibleText?: string } | null)?.visibleText ?? '';
      const earlierDetails = (reopened as { jobDetails?: { open: boolean; text: string }[] } | null)?.jobDetails ?? [];
      record('earlier job', { earlier, earlierDetails, lines: shown.split('\n').filter((line) => line.includes('attempt')) });
      expect(earlier?.provider === 'cursor' && earlier.model === 'claude-haiku-4-5' && earlier.state === 'failed', `the stored job was not read back as it was: ${JSON.stringify(earlier)}`);
      expect(shown.includes('Last attempt (Cursor · claude-haiku-4-5 ·'), 'the stored failure is not shown as an earlier attempt with its own agent and model');
      expect(!shown.includes('UnknownAgentError'), "the stored failure's raw text shows in the normal view");
      expect(
        earlierDetails.length === 1 && earlierDetails[0]?.open === false && earlierDetails[0].text.includes('plan_required') && earlierDetails[0].text.includes('job-56bdb702'),
        'the raw text is not kept under Details with its job',
      );
      await capture(diffId, 'history-earlier');

      // --- Choosing anew: the earlier attempt is not drawn as the outcome of this choice ------
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      const choosing = await untilPair(diffId, 'the picker', pickerReady('pair-walks-agent'));
      expectChoice(pickerOf(choosing, 'pair-walks-agent'), chosenModel, 'over a stored Cursor failure');
      const choosingText = (choosing as { visibleText?: string } | null)?.visibleText ?? '';
      expect(!choosingText.includes('could not be asked') && !choosingText.includes('Last attempt'), 'the stored failure is drawn beside the new choice');
      const beforeStart = await reviewAdapterRecord();
      record('adapters before the start', beforeStart);
      expect(beforeStart.built.length === 0 && beforeStart.starts.length === 0, `an adapter was built before the start: ${JSON.stringify(beforeStart)}`);
      await capture(diffId, 'history-choosing');

      // --- The start: Claude/opus, and nothing else ---------------------------------------
      const job = await runJob(diffId, '[data-ev="pair-walks-agent-start"]', 'walks');
      expect(job?.state === 'done', `the walks did not finish: ${String(job?.state)} ${String(job?.note)}`);
      await expectJob(job, chosenModel, 'the start over a stored failure');
      const after = await readPairWindow(diffId);
      const afterText = (after as { visibleText?: string } | null)?.visibleText ?? '';
      record('after the start', { jobs: jobsOf(after), lines: afterText.split('\n').filter((line) => line.includes('Claude') || line.includes('Cursor')) });
      expect(jobsOf(after).length === 2 && jobsOf(after)[0]?.provider === 'cursor', 'the stored job was not kept beside the new one');
      expect(afterText.includes('Claude · opus ·') && !afterText.includes('Cursor'), 'the line does not show the new job alone');
      const adapter = await reviewAdapterRecord();
      record('adapters', adapter);
      expect(JSON.stringify(adapter.built) === JSON.stringify(['claude']), `the review built an adapter for another agent: ${JSON.stringify(adapter.built)}`);
      await capture(diffId, 'history-after');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'start-fails') {
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      expectChoice(pickerOf(await untilPair(diffId, 'the picker', pickerReady('pair-walks-agent')), 'pair-walks-agent'), chosenModel, 'before a failing start');
      const job = await runJob(diffId, '[data-ev="pair-walks-agent-start"]', 'walks');
      await sleep(1500);
      const after = await readPairWindow(diffId);
      const details = (after as { jobDetails?: { open: boolean; text: string }[] } | null)?.jobDetails ?? [];
      record('failed start', { job, details });
      expect(job?.state === 'failed', `a refused start is not recorded as failed: ${String(job?.state)}`);
      expect(job?.note === `Claude could not start a session with ${chosenModel}. Nothing was sent, and nothing was approved.`, `the note is not the short one: ${String(job?.note)}`);
      expect((job?.detail ?? '').includes('plan_required'), "the provider's own text is not kept as detail");
      expect(details.length === 1 && details[0]?.open === false && details[0].text.includes('plan_required'), 'the raw text is not folded under Details');
      // What is drawn, not what the DOM holds: a closed Details keeps its text unrendered.
      const shownText = (after as { visibleText?: string } | null)?.visibleText ?? '';
      expect(!shownText.includes('UnknownAgentError'), 'the raw SDK text shows in the normal view');
      expect(jobsOf(after).length === 1, 'the failed start was tried again on its own');
      const adapter = await reviewAdapterRecord();
      record('adapters', adapter);
      expect(JSON.stringify(adapter.built) === JSON.stringify(['claude']), `another agent was built after the failure: ${JSON.stringify(adapter.built)}`);
      expect(adapter.starts.length === 1, `the start was tried ${String(adapter.starts.length)} times`);
      expect(((after?.pair as { agentReviewsShown?: number } | null)?.agentReviewsShown ?? 0) === 0, 'a failed start shows an agent review');
      await press(diffId, '[data-ev="agent-job-walks-detail"] summary');
      await capture(diffId, 'start-failed');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    const fromEditor = phase === 'editor';
    const firstStarter = fromEditor ? '[data-ev="pair-delegate-all"]' : '[data-ev="pair-prepare-walks"]';
    const firstPicker = fromEditor ? 'pair-delegate-all-agent' : 'pair-walks-agent';
    const firstKind = fromEditor ? 'review' : 'walks';
    const secondStarter = fromEditor ? '[data-ev="pair-prepare-walks"]' : '[data-ev="pair-delegate-all"]';
    const secondPicker = fromEditor ? 'pair-walks-agent' : 'pair-delegate-all-agent';
    const secondKind = fromEditor ? 'walks' : 'review';

    // --- 1. The opener's agent and model, shown and used -----------------------------------
    await press(diffId, firstStarter);
    const first = await untilPair(diffId, 'the first picker', pickerReady(firstPicker));
    expectChoice(pickerOf(first, firstPicker), chosenModel, `opened from the ${phase}`);
    await capture(diffId, 'picker-inherited');
    const firstJob = await runJob(diffId, `[data-ev="${firstPicker}-start"]`, firstKind);
    expect(firstJob?.state === 'done', `the first job did not finish: ${String(firstJob?.state)} ${String(firstJob?.note)}`);
    await expectJob(firstJob, chosenModel, `the first job (${firstKind})`);

    // --- 2. The model changed in the review with the keyboard; the next job gets it ---------
    await press(diffId, secondStarter);
    const second = await untilPair(diffId, 'the second picker', pickerReady(secondPicker));
    expectChoice(pickerOf(second, secondPicker), chosenModel, "the review's own choice");
    const options = pickerOf(second, secondPicker)?.options ?? [];
    const target = options[options.indexOf(chosenModel) - 1];
    await pressKey(diffId, `[data-ev="${secondPicker}-model"]`, 'Up');
    const changed = await readPairWindow(diffId);
    record('model changed', { picker: pickerOf(changed, secondPicker), target });
    expect(target !== undefined && pickerOf(changed, secondPicker)?.model === target, `the keyboard did not change the model to ${String(target)}: ${String(pickerOf(changed, secondPicker)?.model)}`);
    expect(pickerOf(changed, secondPicker)?.provider === 'claude', 'changing the model changed the agent');
    await capture(diffId, 'picker-changed');
    const secondJob = await runJob(diffId, `[data-ev="${secondPicker}-start"]`, secondKind);
    expect(secondJob?.state === 'done', `the second job did not finish: ${String(secondJob?.state)} ${String(secondJob?.note)}`);
    await expectJob(secondJob, target ?? '', `the second job (${secondKind})`);

    // --- 3. The change stays the review's choice -------------------------------------------
    await press(diffId, firstStarter);
    const third = await untilPair(diffId, 'the picker again', pickerReady(firstPicker));
    expectChoice(pickerOf(third, firstPicker), target ?? '', 'after the change');

    const adapter = await reviewAdapterRecord();
    record('adapters', adapter);
    expect(adapter.built.length > 0 && adapter.built.every((provider) => provider === 'claude'), `the review built an adapter for another agent: ${JSON.stringify(adapter.built)}`);
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * DSP-152, after Niclas's second live trial: *Prepare code walks* did not start, and the
 * window showed an earlier Cursor failure. This follows the person's whole way with real
 * input (`sendInputEvent`, the main window included): open the project and the review from
 * the main window, choose the revisions, open the preparation, wait for the agent's model
 * list (shaped like a Claude account's and arriving after a while, SIMULATED), start, and
 * open the walk that comes back. Nothing is set by the script: provider, model and form
 * state are what the windows show.
 *
 * Phases, each in a fresh kit whose chat chose Claude:
 * - `first` (`history`): with `opus`, over Niclas's stored review of the same pair (one
 *   failed Cursor job, copied from his record).
 * - `clean`: with `opus`, no earlier job; the model is changed with the keyboard first.
 * - `blocked`: with a model the account's list does not offer; the picker must say so and
 *   not start; once a model is chosen with the keyboard, the host fails the request
 *   (SIMULATED), and the window must say so.
 * - `inherit`: no model was chosen, so the chat runs on Claude's default. The picker starts
 *   from Claude and, once the slow list arrives, the model it marks as the default. The
 *   empty chat says nothing, and DSpatch's own repository opens afterwards.
 * - `inherit-switch`: as `inherit`, with the agent changed while the list is read: the late
 *   list chooses nothing for the agent the person changed to.
 * - `inherit-copilot`: as `inherit` for a chat on Copilot's default, with Copilot's own
 *   `copilot-default` row in the list (`DSPATCH_PRESENTATION_MODELS=copilot`).
 */
async function runWalkStartScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase === undefined || plan.flowPhase === 'first' ? 'history' : plan.flowPhase;
  const inherited = phase === 'inherit-copilot' ? 'copilot' : 'claude';
  const inheritedModel = phase === 'inherit-copilot' ? 'copilot-default' : 'opus';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider: the presentation adapter answers for every agent, its model list is shaped like a Claude ' +
      "account's and arrives after 1.5 s. The windows, real input, IPC, the host, its job records, the provider factory, " +
      'walk validation, saving and opening are the product\'s own; no provider was contacted.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const MAIN = 0;
  const tryPress = async (id: number, selector: string): Promise<{ readonly ok: boolean; readonly detail: unknown }> => {
    const answer = await window.dspatch.pairWindowCheck({ action: 'press', id, selector });
    await sleep(250);
    return answer;
  };
  const press = async (id: number, selector: string): Promise<void> => {
    const answer = await tryPress(id, selector);
    if (!answer.ok) {
      throw new Error(`could not press ${selector}: ${JSON.stringify(answer.detail)}`);
    }
  };
  const pressKey = async (id: number, selector: string, key: string): Promise<void> => {
    const answer = await window.dspatch.pairWindowCheck({ action: 'press-key', id, selector, key });
    if (!answer.ok) {
      throw new Error(`could not press ${key} on ${selector}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(300);
  };
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(300);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  const shown = (reading: PairWindowReading | null): string => (reading as { visibleText?: string } | null)?.visibleText ?? '';
  const picker = (reading: PairWindowReading | null): PickerReading | undefined => pickerOf(reading, 'pair-walks-agent');

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    // --- The main window, as a person uses it ---------------------------------------------------
    await press(MAIN, '[data-ev="open-project-0"]');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    const removedTexts = (): boolean => /Nothing sent yet|Waiting for your message/.test(document.body.innerText);
    if (phase === 'inherit') {
      record('the empty chat', { status: textOf('active-status'), prompt: element('prompt') !== null });
      expect(!removedTexts(), 'the empty chat still shows a removed text');
      await capture(MAIN, 'empty-chat');
    }
    await press(MAIN, '[data-ev="open-review"]');
    const diffId = (await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'))).id;
    await pastOngoing(diffId);

    await untilPair(diffId, 'the repository list', (reading) => reading.pair?.phase === 'repositories');
    await press(diffId, '[data-ev="pair-repo-0"]');
    await untilPair(diffId, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
    await press(diffId, '[data-ev="pair-commit-1"]');
    await press(diffId, '[data-ev="pair-commit-0"]');
    await press(diffId, '[data-ev="pair-open"]');
    const opened = await untilPair(diffId, 'the diff review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    const earlier = jobsOf(opened);
    record('review opened', { jobs: earlier.map((job) => ({ id: job.id, provider: job.provider, model: job.model, state: job.state })) });
    if (phase === 'history') {
      expect(earlier.length === 1 && earlier[0]?.provider === 'cursor' && earlier[0].state === 'failed', `the stored Cursor job was not read back: ${JSON.stringify(earlier)}`);
    } else {
      expect(earlier.length === 0, 'a fresh review has agent jobs');
    }

    // --- The preparation opened: the inherited choice, then the account's list -----------------
    await press(diffId, '[data-ev="pair-prepare-walks"]');
    const early = await untilPair(diffId, 'the picker', (reading) => picker(reading) !== undefined && !(picker(reading)?.text ?? '').startsWith('Reading the agents'), 20_000);
    record('picker before the list', { picker: picker(early) });
    if (phase !== 'blocked') {
      // The account's list is slow here (SIMULATED, DSPATCH_PRESENTATION_LIST_MS), and the
      // chat may have read it within the minute it is reused: read or not, the inherited
      // choice is shown from the start and is still the choice when the list arrives.
      expect(picker(early)?.provider === inherited, `the picker did not show the inherited choice: ${JSON.stringify(picker(early))}`);
    }
    if (phase === 'inherit-switch') {
      // The person changes the agent while Claude's list is read. Nothing chooses for them.
      await pressKey(diffId, '[data-ev="pair-walks-agent-provider"]', 'Down');
      const changed = await untilPair(diffId, "the other agent's models", (reading) => picker(reading)?.modelReading === null, 30_000);
      await sleep(2_000);
      const after = picker(await readPairWindow(diffId));
      record('agent changed while the list was read', { picker: after });
      expect(picker(changed)?.provider !== 'claude' && after?.provider === picker(changed)?.provider, `the late list changed the agent: ${JSON.stringify(after)}`);
      expect(after?.model === '' || after?.model === null, `a model was chosen for the person: ${JSON.stringify(after)}`);
      expect(after?.startDisabled === true, 'the start can be pressed with no model chosen');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }
    const listed = await untilPair(diffId, "the agent's models", (reading) => picker(reading)?.modelReading === null && picker(reading)?.options !== null, 30_000);
    const choice = picker(listed);
    record('picker with the list', { picker: choice, visible: shown(listed).slice(0, 600) });
    expect(choice?.provider === inherited, `the picker shows ${String(choice?.provider)}, not the inherited ${inherited}`);
    expect(!(choice?.options ?? []).includes('default'), "the provider's `default` alias is offered as a model of its own");
    // One way to start, and it is the picker's: the header control is not a second "Prepare code walks".
    const header = await tryPress(diffId, '[data-ev="pair-prepare-walks"]');
    record('the header control while choosing', { header });
    expect(!header.ok, `the header's Prepare code walks can still be pressed while the picker is open (${JSON.stringify(header.detail)}), and a press there starts nothing`);
    expect(!shown(listed).includes('could not be asked') && !shown(listed).includes('Last attempt'), 'an earlier failure is drawn beside the new choice');
    await capture(diffId, 'choosing');

    if (phase === 'blocked') {
      // --- A model the list does not offer: said, and no start -----------------------------
      const blockedNote = choice?.note ?? '';
      expect(choice?.startDisabled === true, 'the picker can start with a model the account does not offer');
      expect(blockedNote.includes('claude-opus-4-1'), `the picker does not say why it cannot start: "${blockedNote}"`);
      const refused = await tryPress(diffId, '[data-ev="pair-walks-agent-start"]');
      record('start pressed while blocked', { refused });
      expect(!refused.ok, 'a press on a start that cannot start was taken');
      await capture(diffId, 'blocked');
      // --- A model chosen with the keyboard; the host then fails the request (SIMULATED) -------
      await pressKey(diffId, '[data-ev="pair-walks-agent-model"]', 'Down');
      const chosen = picker(await readPairWindow(diffId));
      record('model chosen', { picker: chosen });
      expect(chosen?.startDisabled === false && (chosen.model ?? '') !== '', `choosing a model did not make the start possible: ${JSON.stringify(chosen)}`);
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      const failed = await untilPair(diffId, 'a reason for the failed start', (reading) => shown(reading).includes('could not be started'), 15_000);
      record('failed start', { visible: shown(failed).slice(0, 600), jobs: jobsOf(failed).length });
      expect(shown(failed).includes('SIMULATED (DSPATCH_REVIEW_SIM=start-throws)'), 'the reason the start failed is not shown');
      expect(jobsOf(failed).length === 0, 'a failed request left a job');
      const adapter = await reviewAdapterRecord();
      record('adapters', adapter);
      expect(adapter.built.length === 0 && adapter.starts.length === 0, `an adapter was built for a failed request: ${JSON.stringify(adapter)}`);
      await capture(diffId, 'start-failed');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    expect(choice?.model === inheritedModel && choice.startDisabled === false, `the inherited ${inherited}/${inheritedModel} cannot be started: ${JSON.stringify(choice)}`);
    let model = inheritedModel;
    if (phase === 'clean') {
      // An explicit change with the keyboard, after the list arrived.
      await pressKey(diffId, '[data-ev="pair-walks-agent-model"]', 'Down');
      const changed = picker(await readPairWindow(diffId));
      record('model changed', { picker: changed });
      expect(changed?.provider === 'claude' && changed.model === 'sonnet' && changed.startDisabled === false, `the keyboard did not choose sonnet: ${JSON.stringify(changed)}`);
      model = changed?.model ?? '';
    }

    // --- Start: a job, a session with the choice, a valid walk ---------------------------------
    await press(diffId, '[data-ev="pair-walks-agent-start"]');
    const done = await untilPair(diffId, 'the walks job', (reading) => jobsOf(reading).length > earlier.length && settledJob(lastJob(reading, 'walks')), 60_000);
    const job = lastJob(done, 'walks');
    const adapter = await reviewAdapterRecord();
    record('walks job', { job, adapter, visible: shown(done).slice(0, 400) });
    expect(job?.state === 'done' && job.provider === inherited && job.model === model, `the walks job did not finish with ${inherited}/${model}: ${JSON.stringify(job)}`);
    expect(adapter.starts.at(-1)?.provider === inherited && adapter.starts.at(-1)?.modelRequested === model, `the adapter's session was not ${inherited}/${model}: ${JSON.stringify(adapter.starts)}`);
    expect(adapter.built.every((provider) => provider === inherited), `an adapter was built for another agent: ${JSON.stringify(adapter.built)}`);
    expect(job?.definitionPath !== null && job?.definitionPath !== undefined, 'the walks were not saved');
    await capture(diffId, 'prepared');

    // --- The walk that came back opens by itself ---------------------------------------------
    const walk = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'));
    const walkOpen = await untilPair(walk.id, 'the walk', (reading) => reading.walk?.kind === 'opened', 30_000);
    record('walk opened', { walk: walkOpen.walk, visible: shown(walkOpen).slice(0, 300) });
    expect(walkOpen.walk?.kind === 'opened', 'the prepared walk did not open');
    await capture(walk.id, 'walk');
    if (phase === 'inherit') {
      // DSpatch's own repository opens like any other project (simulated provider, nothing sent).
      const own = plan.ownRepositoryPath ?? '';
      expect(own !== '', 'DSpatch\u2019s own repository was not found from where this runs');
      const opened = await window.dspatch.startChatSession({ kind: 'folder', path: own });
      record('own repository', { opened: opened.workspacePath });
      expect(opened.workspacePath === own, `DSpatch's own repository did not open: ${JSON.stringify(opened)}`);
      await waitFor('the opened repository in the window', () => element('prompt') !== null, 30_000);
      expect(!removedTexts(), 'the empty chat over the own repository shows a removed text');
      // A login happens outside DSpatch: past the minute a list is reused, the next asking
      // reads the provider again (the host's log names both readings).
      await sleep(61_000);
      const reread = await window.dspatch.listModels('claude');
      record('model list read again', { models: reread.models.map((row) => row.id), error: reread.error });
      expect(reread.error === null && reread.models.length > 0, `the list was not read again: ${JSON.stringify(reread)}`);
    }
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = { windows: rows, readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))) };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * DSP-152: the analysis agent examines the code itself. A kit whose repository (`shop`,
 * `tests/support/analysis-fixture.ts`) changes `total()` to call `findDiscount()`, defined
 * in a file the change does not touch, 61 lines down, where it can return null; the
 * working copy says something else (edited, staged and untracked). Real mouse and keyboard
 * from the main window on; the kit's chat chose Claude with `opus`.
 *
 * The provider is SIMULATED (presentation adapter), but its reading is not: it reads the
 * revision folder the host wrote, from disk, and reports each read as a tool call. So what
 * this shows is the product's path: the host writes the two commits, the job runs in that
 * folder, the answers are checked against Git and recorded with what was read, and the
 * windows show them. What a real model reads and writes is for the live trial.
 *
 * Phases, in one kit:
 * - `first`: prepare walks with Claude/opus; a walk step points at the unchanged definition
 *   (outside the diff); open the walk and go to that place; ask the agent a question about
 *   the step (typed); deepen the step in the discussion, whose context now holds the
 *   answer; delegate `src/checkout.ts` (a problem at the unchecked call, a note in the
 *   unchanged file, the problem line not approved); delegate `README.md` (not enough to
 *   judge, nothing approved); delegate again and stop it (nothing approved).
 * - `again`: DSpatch restarted: jobs, the walk and the step's answer are back and open,
 *   though the revision folder is gone; nothing is sent.
 *
 * The runner checks what the window cannot: the working copy before and after, the commits
 * against the jobs' records, and that no revision folder is left.
 */
async function runAnalysisAccessScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase = plan.flowPhase === 'again' ? 'again' : 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider (presentation adapter): its answers are fixed rules over what it reads, and it reads the ' +
      'revision folder the host wrote, from disk, reporting each read as a tool call. The windows, real input, IPC, ' +
      'the host, the revision folder, the job records, validation against Git, saving and opening are the product\'s own.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const MAIN = 0;
  const press = async (id: number, selector: string): Promise<void> => {
    const answer = await window.dspatch.pairWindowCheck({ action: 'press', id, selector });
    if (!answer.ok) {
      throw new Error(`could not press ${selector}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(250);
  };
  const type = async (id: number, selector: string, text: string): Promise<void> => {
    await press(id, selector);
    const answer = await window.dspatch.pairWindowCheck({ action: 'type', id, selector, text });
    if (!answer.ok) {
      throw new Error(`could not type into ${selector}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(250);
  };
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(300);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  const shown = (reading: PairWindowReading | null): string => (reading as { visibleText?: string } | null)?.visibleText ?? '';
  type Investigation = { readonly state: string; readonly text: string; readonly references: readonly string[]; readonly details: string };
  const investigations = (reading: PairWindowReading | null): readonly Investigation[] => (reading as { investigations?: Investigation[] } | null)?.investigations ?? [];
  type Analysed = JobReading & {
    readonly material: { readonly base: string; readonly target: string; readonly files: number; readonly skippedCount: number } | null;
    readonly investigation: { readonly reads: readonly string[]; readonly searches: readonly string[]; readonly refused: number } | null;
    readonly findingPlaces: readonly { readonly severity: string; readonly location: { readonly path: string; readonly start: number; readonly end: number } | null }[];
  };
  const analysed = (job: JobReading | undefined): Analysed | undefined => job as Analysed | undefined;
  const pickerReady = async (id: number, ev: string): Promise<void> => {
    await untilPair(id, `the ${ev} picker with the account's models`, (reading) => {
      const picker = pickerOf(reading, ev);
      return picker !== undefined && picker.modelReading === null && picker.options !== null && picker.provider === 'claude' && picker.startDisabled === false;
    }, 20_000);
  };
  const openReview = async (): Promise<{ readonly diffId: number; readonly opened: PairWindowReading }> => {
    await press(MAIN, '[data-ev="open-review"]');
    const diffId = (await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'))).id;
    // One repository in the workspace: the window goes straight to its log.
    await pastOngoing(diffId);
    const first = await untilPair(diffId, 'the repository list or the log', (reading) => reading.pair?.phase === 'repositories' || reading.pair?.phase === 'log');
    if (first.pair?.phase === 'repositories') {
      await press(diffId, '[data-ev="pair-repo-0"]');
    }
    await untilPair(diffId, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
    await press(diffId, '[data-ev="pair-commit-1"]');
    await press(diffId, '[data-ev="pair-commit-0"]');
    await press(diffId, '[data-ev="pair-open"]');
    const opened = await untilPair(diffId, 'the diff review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    return { diffId, opened };
  };
  const openWalkAtDefinition = async (diffId: number): Promise<{ readonly walkId: number; readonly reading: PairWindowReading }> => {
    await untilPair(diffId, 'Code walks to be offered', (reading) => ((reading.pair as { walkCount?: number | null } | undefined)?.walkCount ?? 0) > 0, 15_000);
    await press(diffId, '[data-ev="pair-walks"]');
    const walkRow = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'));
    await untilPair(walkRow.id, 'the walk', (reading) => reading.walk?.kind === 'opened', 30_000);
    // Forward through the walk, as a person would, until the place at the definition is on the strip.
    const dot = 'button.rv-strip-dot[aria-label*="Where findDiscount is defined"]';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const here = await window.dspatch.pairWindowCheck({ action: 'press', id: walkRow.id, selector: dot });
      if (here.ok) {
        break;
      }
      await press(walkRow.id, 'button.rv-nav-next');
    }
    const reading = await untilPair(walkRow.id, 'the place at the definition', (entry) => shown(entry).includes('export function findDiscount'), 15_000);
    return { walkId: walkRow.id, reading };
  };
  const delegateFile = async (diffId: number, filePath: string, stop: boolean): Promise<Analysed | undefined> => {
    await press(diffId, '[data-ev="pair-files"]').catch(() => undefined);
    const list = await untilPair(diffId, 'Files changed', (reading) => reading.pair?.fileKey === null && (reading.pair.files?.length ?? 0) > 0);
    const index = (list.pair?.files ?? []).findIndex((file) => file.path === filePath);
    await press(diffId, `[data-ev="pair-file-${String(index)}"]`);
    const before = jobsOf(await readPairWindow(diffId)).length;
    await press(diffId, '[data-ev="pair-delegate-file"]');
    await pickerReady(diffId, 'pair-delegate-agent');
    await press(diffId, '[data-ev="pair-delegate-agent-start"]');
    if (stop) {
      await untilPair(diffId, 'the review running', (reading) => jobsOf(reading).length > before && lastJob(reading, 'review')?.state === 'running', 10_000);
      await press(diffId, '[data-ev="agent-job-review-stop"]');
    }
    const done = await untilPair(diffId, `the delegated review of ${filePath}`, (reading) => jobsOf(reading).length > before && settledJob(lastJob(reading, 'review', filePath)), 60_000);
    return analysed(lastJob(done, 'review', filePath));
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    await press(MAIN, '[data-ev="open-project-0"]');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    const { diffId, opened } = await openReview();
    const earlier = jobsOf(opened);
    record('review opened', { jobs: earlier.map((job) => ({ id: job.id, kind: job.kind, state: job.state })) });

    if (phase === 'again') {
      // --- After a restart: everything back, nothing sent ----------------------------------
      const sentBefore = (await reviewPromptsSent()).length;
      expect(earlier.some((job) => job.kind === 'walks' && job.state === 'done'), 'the prepared walks are not back');
      const reviews = earlier.filter((job) => job.kind === 'review');
      expect(reviews.some((job) => job.state === 'done' && job.findings > 0), 'the delegated review with findings is not back');
      expect(reviews.every((job) => job.state !== 'running' && job.state !== 'cancelling'), 'a review is still shown running after the restart');
      const { walkId, reading } = await openWalkAtDefinition(diffId);
      record('walk reopened', { walk: reading.walk, investigations: investigations(reading) });
      // Since 30 October 2026 the question was asked in the discussion: it comes back there.
      await press(walkId, '[data-ev="right-tab-discussion"]');
      type StoredAnswer = { readonly role: string; readonly text: string; readonly references: readonly string[] };
      const kept = await untilPair(walkId, 'the answer in the discussion', (entry) =>
        ((entry as unknown as { discussion?: { messages?: readonly StoredAnswer[] } | null }).discussion?.messages ?? []).some((message) => message.role === 'answer' && message.text.includes('findDiscount') && message.references.includes('target:src/pricing.ts:61-66')),
      ).catch(() => null);
      expect(kept !== null, "the question's answer and its reference are not back in the discussion");
      await capture(walkId, 'again-walk');
      const sentAfter = (await reviewPromptsSent()).length;
      expect(sentAfter === sentBefore, `reopening sent ${String(sentAfter - sentBefore)} prompt(s)`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    expect(earlier.length === 0, 'a fresh kit has agent jobs');

    // --- 1. Prepare code walks with Claude/opus ----------------------------------------------
    await press(diffId, '[data-ev="pair-prepare-walks"]');
    await pickerReady(diffId, 'pair-walks-agent');
    const choice = pickerOf(await readPairWindow(diffId), 'pair-walks-agent');
    expect(choice?.provider === 'claude' && choice.model === 'opus', `the picker does not offer the inherited Claude/opus: ${JSON.stringify(choice)}`);
    await press(diffId, '[data-ev="pair-walks-agent-start"]');
    const prepared = await untilPair(diffId, 'the walks job', (reading) => settledJob(lastJob(reading, 'walks')), 60_000);
    const walksJob = analysed(lastJob(prepared, 'walks'));
    const adapter = await reviewAdapterRecord();
    record('walks job', { job: walksJob, adapter });
    expect(walksJob?.state === 'done' && walksJob.provider === 'claude' && walksJob.model === 'opus', `the walks were not prepared with Claude/opus: ${JSON.stringify(walksJob)}`);
    expect(adapter.starts.at(-1)?.provider === 'claude' && adapter.starts.at(-1)?.modelRequested === 'opus', `the session was not Claude/opus: ${JSON.stringify(adapter.starts)}`);
    expect(adapter.built.every((provider) => provider === 'claude'), `an adapter was built for another agent: ${JSON.stringify(adapter.built)}`);
    expect((walksJob?.investigation?.reads ?? []).includes('target/src/pricing.ts'), `the agent did not read the unchanged definition: ${JSON.stringify(walksJob?.investigation)}`);
    expect((walksJob?.material?.files ?? 0) > 0 && walksJob?.material?.skippedCount === 0, `what the agent could read is not recorded: ${JSON.stringify(walksJob?.material)}`);
    await capture(diffId, 'prepared');

    // --- 2. The walk: a step points at the unchanged definition -----------------------------
    const { walkId, reading: atDefinition } = await openWalkAtDefinition(diffId);
    const walkIdentity = atDefinition.walk as { base?: string; target?: string } | null;
    record('walk at the definition', { walk: atDefinition.walk, visible: shown(atDefinition).slice(0, 600) });
    expect(walksJob?.material?.base === walkIdentity?.base && walksJob?.material?.target === walkIdentity?.target, `the job's revisions are not the walk's: ${JSON.stringify({ material: walksJob?.material, walk: walkIdentity })}`);
    expect(shown(atDefinition).includes('src/pricing.ts lines 61'), 'the step does not explain the dependency at its lines');
    await capture(walkId, 'walk-definition');

    // --- 3. A question about the step, in the ordinary question field, answered from the code ---
    // Since Niclas's decision of 30 October 2026 the discussion reads the code itself; there is
    // no separate "Look into the code" any more.
    const sentBeforeQuestion = (await reviewPromptsSent()).length;
    await press(walkId, '[data-ev="right-tab-discussion"]');
    await type(walkId, '[data-ev="discussion-composer"]', 'Where does the discount percentage come from?');
    await window.dspatch.pairWindowCheck({ action: 'press-key', id: walkId, selector: '[data-ev="discussion-composer"]', key: 'Enter' });
    type DiscussionAnswerReading = { readonly role: string; readonly status: string; readonly text: string; readonly references: readonly string[]; readonly reads: readonly string[] };
    const answersIn = (reading: PairWindowReading | null): readonly DiscussionAnswerReading[] =>
      ((reading as unknown as { discussion?: { messages?: readonly DiscussionAnswerReading[] } | null } | null)?.discussion?.messages ?? []).filter((message) => message.role === 'answer');
    const answered = await untilPair(walkId, 'the answer in the discussion', (reading) => (answersIn(reading).at(-1)?.references.length ?? 0) > 0, 60_000);
    const answer = answersIn(answered).at(-1);
    record('step question', { answer });
    expect(answer?.status === 'done' && answer.text.includes('findDiscount') && answer.text.includes('Where does the discount percentage come from?'), `the question was not answered from the code: ${JSON.stringify(answer)}`);
    expect((answer?.references ?? []).includes('target:src/pricing.ts:61-66'), `the answer does not point at the definition: ${JSON.stringify(answer?.references)}`);
    expect((answer?.reads ?? []).some((read) => read.includes('target/src/pricing.ts')), `the agent did not read the definition: ${JSON.stringify(answer?.reads)}`);
    expect(!shown(answered).includes('Read target/'), 'the reads are drawn in the view');
    await capture(walkId, 'step-question');
    await press(walkId, '[data-ev="right-tab-step"]');

    // --- 4. Deepen the step in the discussion: its context holds the code and the answer ----
    await press(walkId, '[data-ev="step-tell-more"]');
    await untilPair(walkId, 'the deepening', (reading) => ((reading as { deepenings?: { state: string }[] }).deepenings ?? []).some((entry) => entry.state === 'done'), 30_000);
    const prompts = await reviewPromptsSent();
    const deepening = prompts.slice(sentBeforeQuestion).find((prompt) => prompt.includes('Tell me more about this step') || prompt.includes('Berätta mer om det här steget')) ?? '';
    record('deepening context', { sections: deepening.split('\n').filter((line) => line.startsWith('## ') || line.startsWith('What the agent found')) });
    // The deepening reads the code too, in the same session as the question before it.
    expect(deepening.startsWith('DSPATCH-REVIEW-TASK: review-question'), 'the deepening could not read the code');
    expect(deepening.includes('export function findDiscount'), "the deepening's context does not hold the step's code");
    expect(!deepening.includes('WORKING COPY ONLY'), 'the working copy reached the discussion');

    // --- 5. Delegated review of src/checkout.ts: a finding in unchanged code -----------------
    const checkout = await delegateFile(diffId, 'src/checkout.ts', false);
    record('delegated checkout', { job: checkout });
    expect(checkout?.state === 'done' && checkout.provider === 'claude', `the delegated review did not finish with Claude: ${JSON.stringify(checkout)}`);
    const problem = checkout?.findingPlaces.find((finding) => finding.severity === 'problem');
    expect(problem?.location?.path === 'src/checkout.ts' && problem.location.start === 4, `the unchecked call is not a problem at line 4: ${JSON.stringify(checkout?.findingPlaces)}`);
    expect((checkout?.findingPlaces ?? []).some((finding) => finding.location?.path === 'src/pricing.ts' && finding.location.start === 61), 'no finding points at the unchanged definition');
    expect(
      !(checkout?.approved ?? []).some((range) => (range as { side?: string }).side === 'target' && range.path === 'src/checkout.ts' && range.start <= 4 && range.end >= 4),
      `the problem line was approved: ${JSON.stringify(checkout?.approved)}`,
    );
    expect((checkout?.approved ?? []).length > 0, 'nothing was approved where nothing was wrong');
    expect((checkout?.investigation?.reads ?? []).includes('target/src/pricing.ts'), 'the reviewer did not read the definition');
    await capture(diffId, 'delegated-checkout');

    // --- 6. README.md: not enough to judge, nothing approved ---------------------------------
    const readme = await delegateFile(diffId, 'README.md', false);
    record('delegated readme', { job: readme });
    expect(readme?.state === 'done' && readme.insufficient && (readme.approved ?? []).length === 0, `README was not "not enough to judge" with nothing approved: ${JSON.stringify(readme)}`);

    // --- 7. Stopped: nothing approved ---------------------------------------------------------
    const stopped = await delegateFile(diffId, 'src/checkout.ts', true);
    record('stopped', { job: stopped });
    expect(stopped?.state === 'cancelled' || stopped?.state === 'unknown', `the stopped review ended as ${String(stopped?.state)}`);
    expect((stopped?.approved ?? []).length === 0, 'a stopped review approved lines');
    await capture(diffId, 'stopped');

    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = { windows: rows, readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))) };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * The review flow after Niclas's first real trial (29 October 2026), in the real windows,
 * over `tests/support/flow-fixture.ts` (`shop`) and a clone of MiniDAWLab-spike01 read at
 * b87f042 → 8c7d41b, the pair of his trial. Real mouse, keyboard, wheel and drags through
 * `sendInputEvent`; the agent is the SIMULATED presentation adapter.
 *
 * `first`: the full-width file list, a file and back with the list where it was, progress
 * with mixed status and an open finding beside a check, Code walks dimmed, a preparation
 * that opens the walk window once, walks and readings in it, independent navigation with
 * shared status, the left column dragged and kept, Show more, long Markdown lines wrapped
 * in both windows with marks, a selection explained and a line marked.
 * `again` (restart): both reviews listed as ongoing and resumed without any agent work, the
 * walks back at their place, and one review ended.
 * `panel-copilot`: Copilot and a model chosen in the Discussion panel, a question from its
 * own window and one, with another model, docked in the diff (use
 * `DSPATCH_PRESENTATION_MODELS=copilot`).
 */
async function runReviewFlowScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const phase =
    plan.flowPhase === 'again' || plan.flowPhase === 'direction' || plan.flowPhase === 'columns' || plan.flowPhase === 'insight' || plan.flowPhase === 'insight-again' || plan.flowPhase === 'selection' || plan.flowPhase === 'context' || plan.flowPhase === 'context-walk' || plan.flowPhase === 'panel' || plan.flowPhase === 'panel-copilot' || plan.flowPhase === 'remote' || plan.flowPhase === 'remote-again' || plan.flowPhase === 'remote-restart'
      ? plan.flowPhase
      : 'first';
  const observations: Record<string, unknown> = {
    plan,
    phase,
    limits:
      'SIMULATED provider (presentation adapter): fixed walks, readings, reviews and explanations over what it reads in the ' +
      'revision folder. The clicks, keys, wheel and drags are real input; windows, IPC, the host and its records are the product.',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const MAIN = 0;
  const check = async (request: PairWindowCheckRequest, what: string): Promise<unknown> => {
    const answer = await window.dspatch.pairWindowCheck(request);
    if (!answer.ok) {
      throw new Error(`could not ${what}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(250);
    return answer.detail;
  };
  const press = (id: number, selector: string): Promise<unknown> => check({ action: 'press', id, selector }, `press ${selector}`);
  const pressKey = (id: number, selector: string, key: string): Promise<unknown> => check({ action: 'press-key', id, selector, key }, `press ${key} on ${selector}`);
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(350);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  type FileRow = { readonly key: string; readonly path: string; readonly percent: number; readonly done: boolean; readonly manual: number; readonly agent: number; readonly exempted: number; readonly total: number; readonly handled: number };
  type Job = { readonly id: string; readonly kind: string; readonly state: string; readonly definitionPath: string | null; readonly findings: number; readonly scope: string | null };
  type Diff = {
    readonly phase?: string;
    readonly key?: string;
    readonly fileKey: string | null;
    readonly layout: string;
    readonly files: readonly FileRow[];
    readonly fileRows: readonly string[];
    readonly listShown: boolean;
    readonly sidebarShown: boolean;
    readonly listScrollTop: number;
    readonly listScrollSaved: number;
    readonly walkCount: number | null;
    readonly codeWalks: { readonly enabled: boolean; readonly tip: string } | null;
    readonly strips: readonly { readonly side: string; readonly line: number; readonly status: string }[];
    readonly words: readonly { readonly side: string; readonly line: number; readonly text: string }[];
    readonly wholeLines: readonly string[];
    readonly explanations: readonly { readonly state: string }[];
    readonly highlighted: number;
    readonly explainOffered: boolean;
    readonly textSelection: string;
    readonly diffOverflowX: boolean;
    readonly longLines: readonly { readonly side: string; readonly line: number; readonly length: number; readonly height: number }[];
    readonly jobs: readonly Job[];
    readonly ongoing?: readonly string[];
    readonly repositories?: readonly string[];
    readonly walksNote: string;
  };
  type WalkView = {
    readonly leftWidth: number;
    readonly leftOverflowX: boolean;
    readonly heading: string;
    readonly items: readonly { readonly id: string; readonly title: string; readonly reading: boolean; readonly purpose: string; readonly purposeHeight: number; readonly open: boolean; readonly steps: number }[];
    readonly overview: string;
    readonly overviewMore: string | null;
    readonly attention: string;
    readonly treeOpen: boolean;
    readonly wrapChecked: boolean | null;
    readonly activePane: { readonly wrap: string; readonly scrollLeft: number; readonly scrollWidth: number; readonly clientWidth: number; readonly path: string; readonly focusRows: readonly { readonly line: string; readonly height: number; readonly numbers: string }[] } | null;
    readonly position: { readonly walkId: string | null; readonly stepId: string | null } | null;
    readonly chooseOffered: boolean;
  };
  const diffOf = (reading: PairWindowReading | null): Diff => (reading?.pair ?? {}) as unknown as Diff;
  const walkOf = (reading: PairWindowReading | null): WalkView | null => ((reading as unknown as { walkView?: WalkView | null } | null)?.walkView ?? null);
  const visibleOf = (reading: PairWindowReading | null): string => ((reading as unknown as { visibleText?: string } | null)?.visibleText ?? '');
  const walkWindows = async (): Promise<readonly PairWindowRow[]> => (await pairWindows()).filter((row) => row.view === 'walk');
  const fileIndex = (reading: PairWindowReading, path: string): number => diffOf(reading).files.findIndex((file) => file.path === path);
  const rowOf = (reading: PairWindowReading, path: string): string => diffOf(reading).fileRows[fileIndex(reading, path)] ?? '';
  const strip = (side: 'base' | 'target', line: number): string => `.rv-pair-diff td.rv-pair-strip[data-side="${side}"][data-line="${String(line)}"]`;
  const cell = (side: 'base' | 'target', line: number): string => `.rv-pair-diff td[data-code-side="${side}"][data-code-line="${String(line)}"]`;
  // Niclas's trial pair, forwards: 8c7d41b is the ancestor (he first reviewed it backwards, newer as From).
  const DAL = { name: 'MiniDAWLab-spike01', base: '8c7d41b7dde19bd5568c2b79fd0bd929b6a9b30e', target: 'b87f0422450e1458c14fc0ce179d22a66c7a66e9' };
  const DAL_FILE = 'docs/PORTABLE_INSTRUMENTS_AND_PROXIES.md';

  const startReview = async (diffId: number, repository: string, pair: { readonly base: string; readonly target: string } | null, indexes: readonly [number, number] = [1, 0]): Promise<PairWindowReading> => {
    await pastOngoing(diffId);
    const at = await untilPair(diffId, 'the repositories or the log', (reading) => diffOf(reading).phase === 'repositories' || diffOf(reading).phase === 'log');
    if (diffOf(at).phase === 'repositories') {
      const index = (diffOf(at).repositories ?? []).findIndex((name) => name.trim() === repository);
      if (index < 0) {
        throw new Error(`${repository} is not offered: ${JSON.stringify(diffOf(at).repositories)}`);
      }
      await press(diffId, `[data-ev="pair-repo-${String(index)}"]`);
    }
    await untilPair(diffId, `the log of ${repository}`, (reading) => diffOf(reading).phase === 'log' && ((reading.pair as { commits?: number } | undefined)?.commits ?? 0) > 1);
    await press(diffId, pair === null ? `[data-ev="pair-commit-${String(indexes[0])}"]` : `[data-hash="${pair.base}"]`);
    await press(diffId, pair === null ? `[data-ev="pair-commit-${String(indexes[1])}"]` : `[data-hash="${pair.target}"]`);
    await press(diffId, '[data-ev="pair-open"]');
    return untilPair(diffId, `the review of ${repository}`, (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 60_000);
  };
  const openFile = async (diffId: number, path: string): Promise<PairWindowReading> => {
    const list = await untilPair(diffId, 'Files changed', (reading) => diffOf(reading).listShown);
    const index = fileIndex(list, path);
    if (index < 0) {
      throw new Error(`${path} is not in the change`);
    }
    await press(diffId, `[data-ev="pair-file-${String(index)}"]`);
    return untilPair(diffId, path, (reading) => diffOf(reading).fileKey !== null && diffOf(reading).strips.length > 0);
  };
  const backToFiles = async (diffId: number): Promise<PairWindowReading> => {
    await press(diffId, '[data-ev="pair-files"]');
    return untilPair(diffId, 'Files changed again', (reading) => diffOf(reading).listShown);
  };
  /** The file open in the diff, from the list or from another file; as it is when it is open already. */
  const openFileHere = async (diffId: number, path: string): Promise<PairWindowReading> => {
    const now = await readPairWindow(diffId);
    if (now !== null && !diffOf(now).listShown) {
      const open = diffOf(now).files.find((file) => diffOf(now).fileKey !== null && file.path === path);
      if (open !== undefined && (diffOf(now) as unknown as { context?: { away?: string } | null }).context?.away === '' && (now.text ?? '').includes(path)) {
        return now;
      }
      await backToFiles(diffId);
    }
    return openFile(diffId, path);
  };
  const markLine = async (diffId: number, side: 'base' | 'target', line: number, op: 'manual' | 'exempt'): Promise<void> => {
    await pressKey(diffId, strip(side, line), 'Enter');
    await press(diffId, `[data-ev="pair-mark-${op}"]`);
    await untilPair(diffId, `${side} ${String(line)} ${op}`, (reading) => diffOf(reading).strips.some((entry) => entry.side === side && entry.line === line && entry.status === op));
  };

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    await press(MAIN, '[data-ev="open-project-0"]');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    await press(MAIN, '[data-ev="open-review"]');
    const diffId = (await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'))).id;

    if (phase === 'context') {
      // --- Reading around a change in the diff, references and questions (30 October 2026) ---
      type Ctx = {
        readonly cells: readonly string[];
        readonly gaps: readonly { readonly id: string; readonly text: string }[];
        readonly whole: boolean;
        readonly firstVisible: { readonly side: string; readonly line: number; readonly offset: number } | null;
        readonly tops: readonly (readonly [string, number])[];
        readonly scrollTop: number;
        readonly scrollHeight: number;
        readonly clientHeight: number;
        readonly away: string;
        readonly refLines: readonly number[];
        readonly quote: string;
        readonly askOpen: boolean;
        readonly askOffered: boolean;
        readonly quoteMark: readonly string[];
        readonly activity: readonly string[];
        readonly focused: string;
      };
      type QuoteSeen = { readonly kind: string; readonly segments?: readonly { readonly side: string; readonly path: string; readonly start: number; readonly end: number; readonly from: number; readonly to: number; readonly text: string }[] };
      type Msg = { readonly id: string; readonly role: string; readonly status: string; readonly text: string; readonly questionId: string | null; readonly references: readonly string[]; readonly quote: QuoteSeen | null; readonly simplifies: string | null };
      const FILE = 'src/domain/sessionRouting.ts';
      const ctxOf = (reading: PairWindowReading | null): Ctx => {
        const found = (diffOf(reading) as unknown as { context?: Ctx | null }).context;
        if (found === undefined || found === null) {
          throw new Error('the diff window shows no code');
        }
        return found;
      };
      const messagesOf = (reading: PairWindowReading | null): readonly Msg[] => ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []);
      const questionsOf = (reading: PairWindowReading | null): readonly Msg[] => messagesOf(reading).filter((message) => message.role === 'question');
      const answersOf = (reading: PairWindowReading | null): readonly Msg[] => messagesOf(reading).filter((message) => message.role === 'answer');
      const statusRows = (reading: PairWindowReading | null): string => JSON.stringify(diffOf(reading).files.map((file) => [file.path, file.total, file.handled, file.manual, file.agent, file.exempted, file.done]));
      const linesOf = (cells: readonly string[]): { readonly t: number[]; readonly b: number[] } => ({
        t: cells.flatMap((entry) => (entry.startsWith('t') ? [Number(entry.slice(1).split('=')[0])] : [])),
        b: cells.flatMap((entry) => (entry.startsWith('b') ? [Number(entry.slice(1))] : entry.includes('=b') ? [Number(entry.split('=b')[1])] : [])),
      });
      const increasing = (values: readonly number[]): boolean => values.every((value, index) => index === 0 || value > (values[index - 1] as number));
      const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);
      const topOf = (ctx: Ctx, cell: string): number | null => ctx.tops.find(([key]) => key === cell)?.[1] ?? null;
      const scrollUntil = async (what: string, done: (ctx: Ctx) => boolean, step = 240, towards: number | null = null): Promise<Ctx> => {
        for (let turn = 0; turn < 60; turn += 1) {
          const now = ctxOf(await readPairWindow(diffId));
          if (done(now)) {
            return now;
          }
          const first = Number((now.tops.find(([key]) => key.startsWith('t'))?.[0] ?? 't0').slice(1));
          const delta = towards === null ? step : towards < first + 4 ? -120 : 120;
          await check({ action: 'wheel', id: diffId, selector: '.rv-pair-diff', deltaY: delta }, `scroll towards ${what}`);
        }
        throw new Error(`scrolling never reached ${what}`);
      };
      const cellAt = (side: 'base' | 'target', line: number): string => `.rv-pair-diff td[data-code-side="${side}"][data-code-line="${String(line)}"]`;
      // Turn the wheel towards a To line until it is in view below the top, as a reader scrolls.
      const scrollToLine = async (line: number): Promise<Ctx> =>
        scrollUntil(`line ${String(line)}`, (ctx) => topOf(ctx, `t${String(line)}`) !== null && (topOf(ctx, `t${String(line)}`) ?? 0) > 80 && (topOf(ctx, `t${String(line)}`) ?? 0) < ctx.clientHeight - 80, 0, line);

      const review = await startReview(diffId, 'routing', null, [2, 1]);
      await check({ action: 'resize', id: diffId, width: 1400, height: 900 }, 'size the diff window');
      const before = statusRows(review);
      const opened = await openFile(diffId, FILE);
      const compact = ctxOf(opened);
      const lines0 = linesOf(compact.cells);
      record('compact diff', { gaps: compact.gaps, layout: diffOf(opened).layout, t: lines0.t.length, b: lines0.b.length });
      // 1. Ten unchanged lines around every change from the start; the rest folded with its actions.
      for (const [around, after] of [[42, 44], [201, 204], [383, 384]] as const) {
        expect(range(around - 10, around - 1).every((line) => lines0.t.includes(line)), `the ten lines above To ${String(around)} are not shown`);
        expect(range(after, after + 9).every((line) => lines0.t.includes(line)), `the ten lines below the change at To ${String(around)} are not shown`);
      }
      expect(!lines0.t.includes(31) && !lines0.t.includes(100), 'lines far from any change are not folded');
      expect(increasing(lines0.t) && increasing(lines0.b), 'a line is drawn twice or out of order');
      expect(compact.gaps.length === 4, `expected four folded runs: ${JSON.stringify(compact.gaps)}`);
      const between = compact.gaps[1];
      expect(between !== undefined && /↓ Show 20 more lines/.test(between.text) && /↑ Show 20 more lines/.test(between.text) && /Show all \d+/.test(between.text), `a run between two changes does not offer more from either side: ${JSON.stringify(between)}`);
      expect(/↑ Show 20 more lines/.test(compact.gaps[0]?.text ?? '') && !/↓/.test(compact.gaps[0]?.text ?? ''), 'the first run offers more downwards, where there is no change above it');
      await capture(diffId, 'context-compact');

      // 2. Reading the second change, with the run above it in sight: more lines above it.
      const reading2 = await scrollUntil('the second change', (ctx) => {
        const top = topOf(ctx, 't201');
        return top !== null && top > 320 && top < ctx.clientHeight - 120;
      });
      const gapId = between?.id ?? '';
      const top201 = topOf(reading2, 't201');
      const countBefore = Number(/⋯ (\d+)/.exec(between?.text ?? '')?.[1] ?? '0');
      await press(diffId, `tr[data-gap="${gapId}"] [data-ev="gap-up"]`);
      const up = ctxOf(await readPairWindow(diffId));
      const upGap = up.gaps.find((gap) => gap.id === gapId);
      record('more lines above the change being read', { top201Before: top201, top201After: topOf(up, 't201'), gap: upGap });
      expect(top201 !== null && Math.abs((topOf(up, 't201') ?? -999) - top201) <= 2, `opening lines above moved what was read: ${String(top201)} → ${String(topOf(up, 't201'))}`);
      expect(Number(/⋯ (\d+)/.exec(upGap?.text ?? '')?.[1] ?? '0') === countBefore - 20, `the run did not shrink by 20: ${JSON.stringify(upGap)}`);
      expect(range(171, 200).every((line) => linesOf(up.cells).t.includes(line)), 'the twenty lines above the second change are not shown');
      // 3. More from the first change, downwards, with the end of the first change in view: what is read stays where it is.
      const firstBefore = (await scrollToLine(50)).firstVisible;
      await press(diffId, `tr[data-gap="${gapId}"] [data-ev="gap-down"]`);
      const down = ctxOf(await readPairWindow(diffId));
      record('more lines below the first change', { firstBefore, firstAfter: down.firstVisible, top201: topOf(down, 't201') });
      expect(firstBefore !== null && down.firstVisible?.line === firstBefore.line && Math.abs((down.firstVisible?.offset ?? 0) - firstBefore.offset) <= 2, 'opening lines downwards moved the first line in view');
      // 4. All of it: the lines meet without a gap or a line twice; the change read stays.
      const top201b = topOf(down, 't201');
      await press(diffId, `tr[data-gap="${gapId}"] [data-ev="gap-all"]`);
      const all = ctxOf(await readPairWindow(diffId));
      const allLines = linesOf(all.cells);
      record('the run between the changes shown whole', { gaps: all.gaps.map((gap) => gap.id), top201: [top201b, topOf(all, 't201')] });
      expect(!all.gaps.some((gap) => gap.id === gapId), 'the run is still folded');
      expect(range(44, 200).every((line) => allLines.t.filter((value) => value === line).length === 1), 'the lines between the changes are not each shown once');
      expect(increasing(allLines.t) && increasing(allLines.b), 'a line is drawn twice where the opened lines met');
      expect(top201b === null || Math.abs((topOf(all, 't201') ?? -999) - top201b) <= 2, 'showing all of the run moved the change being read');
      await capture(diffId, 'context-opened');

      // 5. The whole file, the changes still marked; then the compact diff again, as it was.
      const spotBefore = all.firstVisible;
      await press(diffId, '[data-ev="pair-whole-file"]');
      const whole = ctxOf(await readPairWindow(diffId));
      const wholeLines = linesOf(whole.cells);
      record('the whole file', { gaps: whole.gaps.length, t: wholeLines.t.length, b: wholeLines.b.length, first: [spotBefore, whole.firstVisible] });
      expect(whole.whole && whole.gaps.length === 0, 'the whole file still has folds');
      expect(JSON.stringify(wholeLines.t) === JSON.stringify(range(1, 427)), 'the whole file at To is not every line once, in order');
      expect(JSON.stringify(wholeLines.b) === JSON.stringify(range(1, 428)), 'the whole file at From is not every line once, in order');
      expect(spotBefore !== null && whole.firstVisible?.line === spotBefore.line && Math.abs((whole.firstVisible?.offset ?? 0) - spotBefore.offset) <= 2, 'showing the whole file moved what was read');
      expect(diffOf(await readPairWindow(diffId)).strips.length > 0, 'the changes lost their marks in the whole file');
      await capture(diffId, 'context-whole-file');
      await press(diffId, '[data-ev="pair-whole-file"]');
      const again = ctxOf(await readPairWindow(diffId));
      expect(!again.whole && JSON.stringify(again.gaps) === JSON.stringify(all.gaps), `back to the compact diff, the runs are not as they were opened: ${JSON.stringify(again.gaps)}`);

      // 6. Unified: the same line where it was, and the same runs opened.
      const splitSpot = again.firstVisible;
      await press(diffId, '[data-ev="pair-layout-unified"]');
      const unified = ctxOf(await readPairWindow(diffId));
      const unifiedFirst = unified.cells.find((entry) => splitSpot !== null && (entry === `b${String(splitSpot.line)}` || entry.endsWith(`=b${String(splitSpot.line)}`) || entry === `t${String(splitSpot.line)}`));
      record('unified', { splitSpot, unifiedFirst: unified.firstVisible, gaps: unified.gaps });
      expect(JSON.stringify(unified.gaps.map((gap) => gap.text)) === JSON.stringify(again.gaps.map((gap) => gap.text)), 'the opened runs are not the same in the unified layout');
      expect(unifiedFirst !== undefined && unified.firstVisible !== null && splitSpot !== null && Math.abs(unified.firstVisible.offset - splitSpot.offset) <= 3, `the unified layout does not show the same place: ${JSON.stringify([splitSpot, unified.firstVisible])}`);
      expect(increasing(linesOf(unified.cells).t) && increasing(linesOf(unified.cells).b), 'the unified layout draws a line twice');
      await capture(diffId, 'context-unified');

      // 7. Away to the list of files and back: the same place, the same runs.
      await backToFiles(diffId);
      await openFile(diffId, FILE);
      await sleep(400);
      const returned = ctxOf(await readPairWindow(diffId));
      record('back from the list', { before: unified.firstVisible, after: returned.firstVisible });
      expect(JSON.stringify(returned.gaps) === JSON.stringify(unified.gaps), 'the opened runs were not kept on the way back to the file');
      expect(returned.firstVisible?.line === unified.firstVisible?.line && Math.abs((returned.firstVisible?.offset ?? 0) - (unified.firstVisible?.offset ?? 0)) <= 3, `the file did not come back where it was read: ${JSON.stringify([unified.firstVisible, returned.firstVisible])}`);
      await press(diffId, '[data-ev="pair-layout-split"]');

      // 8. Part of an opened unchanged line, before any walk: Ask… opens the review's panel in its
      // own window, with the selection quoted and the cursor in its question (30 October 2026).
      const chipOf = (reading: PairWindowReading | null): string => (reading as unknown as { quoteChipText?: string } | null)?.quoteChipText ?? '';
      const activityOf = (reading: PairWindowReading | null): readonly string[] => (reading as unknown as { activityLines?: readonly string[] } | null)?.activityLines ?? [];
      const focusedOf = (reading: PairWindowReading | null): string => (reading as unknown as { focusedEv?: string | null } | null)?.focusedEv ?? '';
      const panelsNow = async (): Promise<readonly PairWindowRow[]> => (await pairWindows()).filter((row) => row.view === ('panel' as string));
      const promptsBefore = (await reviewPromptsSent()).length;
      await scrollToLine(185);
      const picked = (await check({ action: 'drag', id: diffId, from: { selector: cellAt('target', 185), offset: 8 }, to: { selector: cellAt('target', 185), offset: 13 } }, 'select part of line 185')) as { selected?: string };
      const offered = ctxOf(await untilPair(diffId, 'Ask beside the selection', (reading) => ctxOf(reading).askOffered));
      expect((await panelsNow()).length === 0, 'selecting code opened a window');
      await press(diffId, '[data-ev="ask-this"]');
      const panelId = (await untilWindow('the review panel', (rows) => rows.find((row) => row.view === ('panel' as string)), 30_000)).id;
      const asking = await untilPair(panelId, 'the panel with the quote', (reading) => chipOf(reading).includes('share') && focusedOf(reading) === 'discussion-composer', 20_000);
      const diffNow = await readPairWindow(diffId);
      record('asking before any walk', { selected: picked.selected, offered: offered.askOffered, chip: chipOf(asking), diffMark: ctxOf(diffNow).quoteMark, walks: (await walkWindows()).length, prompts: (await reviewPromptsSent()).length - promptsBefore });
      expect(picked.selected === 'share', `the selection is not the word: ${String(picked.selected)}`);
      expect(ctxOf(diffNow).quoteMark.join('') === 'share', `the selection is not kept marked in the diff: ${JSON.stringify(ctxOf(diffNow).quoteMark)}`);
      expect(!(diffNow?.text ?? '').includes('Enter sends, Shift+Enter'), 'the diff window has a chat of its own');
      expect((await walkWindows()).length === 0, 'asking opened a walk window');
      expect((await reviewPromptsSent()).length === promptsBefore, 'showing the discussion sent something');
      await capture(panelId, 'context-chat-before-walks');
      await capture(diffId, 'context-diff-without-chat');
      // While an answer comes: what the line under the question said, in order, without repeats.
      const answered = async (count: number, what: string): Promise<{ readonly reading: PairWindowReading; readonly said: readonly string[] }> => {
        const said: string[] = [];
        for (const until = performance.now() + 60_000; performance.now() < until; ) {
          const reading = await readPairWindow(panelId);
          for (const line of activityOf(reading)) {
            if (line !== '' && said.at(-1) !== line) {
              said.push(line);
            }
          }
          const answer = answersOf(reading)[count - 1];
          if (reading !== null && answer !== undefined && answer.status === 'done' && activityOf(reading).length === 0) {
            // The references are checked just after the end.
            await sleep(400);
            return { reading: (await readPairWindow(panelId)) ?? reading, said };
          }
          await sleep(120);
        }
        throw new Error(`${what} did not come`);
      };
      // A new selection in the diff replaces the quote in the panel, with nothing pressed but the mouse.
      await check({ action: 'drag', id: diffId, from: { selector: cellAt('target', 186), offset: 2 }, to: { selector: cellAt('target', 186), offset: 8 } }, 'select part of line 186');
      const RETURN = 'return';
      await untilPair(panelId, 'the new quote in the panel', (reading) => chipOf(reading).includes(`“${RETURN}`) && chipOf(reading).includes('186'));
      expect(ctxOf(await readPairWindow(diffId)).quoteMark.join('') === RETURN, 'the diff does not mark the new selection');
      // Straight into the panel's field, and Enter sends.
      await press(panelId, '[data-ev="discussion-composer"]');
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'Why is this value capped here?' }, 'type the question');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      const own = await answered(1, 'the own question');
      const ownQuestion = questionsOf(own.reading)[0];
      record('own question', { question: ownQuestion, said: own.said, prompts: (await reviewPromptsSent()).length - promptsBefore });
      expect(ownQuestion?.text === 'Why is this value capped here?', `the question was not asked as written: ${JSON.stringify(ownQuestion?.text)}`);
      expect(
        JSON.stringify(ownQuestion?.quote?.segments?.map((segment) => [segment.side, segment.path, segment.start, segment.end, segment.from, segment.to, segment.text])) === JSON.stringify([['target', FILE, 186, 186, 2, 8, RETURN]]),
        `the question was not about exactly the selection: ${JSON.stringify(ownQuestion?.quote)}`,
      );
      expect((await reviewPromptsSent()).length === promptsBefore + 1, 'the question was sent more or less than once');
      const ownPrompt = (await reviewPromptsSent()).at(-1) ?? '';
      expect(ownPrompt.includes('Why is this value capped here?') && ownPrompt.includes(`\`\`\`\n${RETURN}\n\`\`\``) && ownPrompt.includes(FILE), 'the adapter was not given the selection and the question exactly');
      // A short answer can be written within the line's own pause; Writing is checked on Explain this below.
      expect(own.said.length > 1 && !own.said.some((line) => /%|\d+ (?:s|sec|seconds)\b/.test(line)), `the activity line did not say what happened: ${JSON.stringify(own.said)}`);
      expect(chipOf(own.reading) === '' && ctxOf(await readPairWindow(diffId)).quoteMark.length === 0, 'the quote stayed for the next question');

      // 9. The changed line that calls into another file: Explain this with Ctrl+Shift+E in the diff.
      await scrollToLine(42);
      const call = (await check({ action: 'drag', id: diffId, from: { selector: cellAt('target', 42), offset: 16 }, to: { selector: cellAt('target', 42), offset: 27 } }, 'select the called function')) as { selected?: string };
      await check({ action: 'chord', id: diffId, key: 'E', modifiers: ['control', 'shift'] }, 'press Ctrl+Shift+E');
      const explained = await answered(2, 'Explain this');
      const explainedQuestion = questionsOf(explained.reading)[1];
      const explainedAnswer = answersOf(explained.reading)[1];
      record('Explain this on the call', { selected: call.selected, question: explainedQuestion?.text, quote: explainedQuestion?.quote, refs: explainedAnswer?.references, said: explained.said, prompts: (await reviewPromptsSent()).length - promptsBefore });
      expect(call.selected === 'lookupRoute' && (explainedQuestion?.text ?? '').startsWith('Explain this') && explainedQuestion?.quote?.segments?.[0]?.text === 'lookupRoute', `Explain this was not about the selected call: ${JSON.stringify(explainedQuestion)}`);
      expect((await reviewPromptsSent()).length === promptsBefore + 2, 'Explain this was sent more or less than once');
      const tableRef = explainedAnswer?.references.find((ref) => ref.startsWith('target:src/domain/routeTable.ts:'));
      expect(tableRef !== undefined, `the answer does not point at lookupRoute's definition: ${JSON.stringify(explainedAnswer?.references)}`);
      expect(explained.said.some((line) => line.startsWith('Reading ')) && explained.said.some((line) => line.startsWith('Searching the code')), `the activity line did not follow the agent: ${JSON.stringify(explained.said)}`);
      // The line is sampled here: a short state can fall between two readings, so Writing is looked for over both answers.
      expect([...own.said, ...explained.said].some((line) => line.startsWith('Writing')), `the activity line never said the answer was being written: ${JSON.stringify([own.said, explained.said])}`);

      // 11. The definition the call reaches, opened from the answer in the panel: with no walk
      // window, it opens in the diff window as a place of its own; then a further one, and back.
      const diffSpot = ctxOf(await readPairWindow(diffId)).firstVisible;
      await press(panelId, `.rv-answer:has([data-ref="${tableRef ?? ''}"]) [data-ev="answer-show-code"]`);
      await press(panelId, `[data-ev="answer-ref"][data-ref="${tableRef ?? ''}"]`);
      const away1 = ctxOf(await untilPair(diffId, 'the definition opened', (reading) => ctxOf(reading).away.includes('routeTable.ts'), 15_000));
      const away1Lines = linesOf(away1.cells).t;
      record('reference opened before any walk', { away: away1.away, refLines: away1.refLines, lines: [away1Lines[0], away1Lines.at(-1)], walks: (await walkWindows()).length });
      expect(/routeTable\.ts/.test(away1.away) && /src\/domain\//.test(away1.away) && /To · [0-9a-f]{7}/.test(away1.away) && /Back to sessionRouting\.ts/.test(away1.away), `the opened code does not say what and where it is: ${away1.away}`);
      expect(away1.refLines.includes(222), `the reference's lines are not marked: ${JSON.stringify(away1.refLines)}`);
      expect((await walkWindows()).length === 0, 'following a reference opened a walk window');
      await capture(diffId, 'context-reference');
      await check({ action: 'wheel', id: diffId, selector: '.rv-pair-diff', deltaY: 120 }, 'scroll a little in the definition');
      const pickedLane = (await check({ action: 'drag', id: diffId, from: { selector: cellAt('target', 223), offset: 32 }, to: { selector: cellAt('target', 223), offset: 45 } }, 'select normaliseLane')) as { selected?: string };
      await check({ action: 'chord', id: diffId, key: 'E', modifiers: ['control', 'shift'] }, 'Ctrl+Shift+E in the definition');
      const further = await answered(3, 'the explanation in the unchanged file');
      const furtherQuestion = questionsOf(further.reading)[2];
      const laneRef = answersOf(further.reading)[2]?.references.find((ref) => ref.startsWith('target:src/domain/lanes.ts'));
      record('explained in the unchanged file', { selected: pickedLane.selected, quote: furtherQuestion?.quote, laneRef });
      expect(furtherQuestion?.quote?.segments?.[0]?.path === 'src/domain/routeTable.ts' && furtherQuestion.quote.segments[0].text === 'normaliseLane', `the question in the unchanged file was not about its selection: ${JSON.stringify(furtherQuestion?.quote)}`);
      expect(laneRef !== undefined, 'the answer does not point at normaliseLane');
      const scrollAt1 = ctxOf(await readPairWindow(diffId)).scrollTop;
      await press(panelId, `.rv-answer:has([data-ref="${laneRef ?? ''}"]) [data-ev="answer-show-code"]`);
      await press(panelId, `[data-ev="answer-ref"][data-ref="${laneRef ?? ''}"]`);
      const away2 = ctxOf(await untilPair(diffId, 'the further reference', (reading) => ctxOf(reading).away.includes('lanes.ts'), 15_000));
      record('further reference', { away: away2.away });
      expect(/Back to routeTable\.ts:22\d/.test(away2.away), `the way back does not name the reference before: ${away2.away}`);
      await press(diffId, '[data-ev="away-back"]');
      const back1 = ctxOf(await untilPair(diffId, 'back at the definition', (reading) => ctxOf(reading).away.includes('routeTable.ts')));
      record('back at the first reference', { scrollBefore: scrollAt1, scrollAfter: back1.scrollTop });
      expect(Math.abs(back1.scrollTop - scrollAt1) <= 2, `the definition did not come back as it was left: ${JSON.stringify([scrollAt1, back1.scrollTop])}`);
      await press(diffId, '[data-ev="away-back"]');
      const back0 = ctxOf(await untilPair(diffId, 'back in the diff', (reading) => ctxOf(reading).away === '' && ctxOf(reading).gaps.length > 0));
      record('back in the diff', { before: diffSpot, after: back0.firstVisible });
      expect(diffSpot !== null && back0.firstVisible?.line === diffSpot.line && Math.abs((back0.firstVisible?.offset ?? 0) - diffSpot.offset) <= 3, `the diff did not come back where it was read: ${JSON.stringify([diffSpot, back0.firstVisible])}`);

      // 12. Explain more simply for one answer: that answer's own question and selection.
      await press(panelId, '[data-ev="discussion-q-2"] [data-ev="answer-simpler"]');
      const simpler = await answered(4, 'Explain more simply');
      const simplerQuestion = questionsOf(simpler.reading)[3];
      const simplerPrompt = (await reviewPromptsSent()).at(-1) ?? '';
      record('explained more simply', { question: simplerQuestion?.text, simplifies: simplerQuestion?.simplifies });
      expect(simplerQuestion?.simplifies === answersOf(simpler.reading)[2]?.id, `Explain more simply was not about that answer: ${JSON.stringify(simplerQuestion)}`);
      expect(simplerPrompt.includes('## The answer to explain more simply') && simplerPrompt.includes('normaliseLane'), "the simpler explanation was not given its answer's question and selection");

      // 10. Unified: one selection over the removed and the added line keeps each part's revision.
      await press(diffId, '[data-ev="pair-layout-unified"]');
      await scrollToLine(43);
      await check({ action: 'drag', id: diffId, from: { selector: cellAt('base', 42), offset: 2 }, to: { selector: cellAt('target', 43), offset: 13 } }, 'select across both revisions');
      await untilPair(diffId, 'Explain this in the unified layout', (reading) => diffOf(reading).explainOffered);
      await press(diffId, '[data-ev="explain-this"]');
      const across = await answered(5, 'the selection across revisions');
      const acrossQuote = questionsOf(across.reading)[4]?.quote;
      record('unified selection across revisions', { quote: acrossQuote });
      expect(JSON.stringify(acrossQuote?.segments?.map((segment) => [segment.side, segment.start])) === JSON.stringify([['base', 42], ['target', 42]]), `the parts lost their revisions: ${JSON.stringify(acrossQuote)}`);
      await press(diffId, '[data-ev="pair-layout-split"]');

      // 13. Stop while the agent works: the line goes, the end is said, nothing is approved.
      await scrollToLine(47);
      await check({ action: 'drag', id: diffId, from: { selector: cellAt('target', 47), offset: 2 }, to: { selector: cellAt('target', 47), offset: 7 } }, 'select for a stopped question');
      await check({ action: 'chord', id: diffId, key: 'E', modifiers: ['control', 'shift'] }, 'Ctrl+Shift+E to stop');
      await untilPair(panelId, 'the answer on its way', (reading) => activityOf(reading).length > 0);
      await press(panelId, '[data-ev="discussion-stop"]');
      const stopped = await untilPair(panelId, 'the stopped answer', (reading) => ['cancelled', 'unknown'].includes(answersOf(reading)[5]?.status ?? '') && activityOf(reading).length === 0, 30_000);
      record('stopped', { status: answersOf(stopped)[5]?.status, panels: (await panelsNow()).length });
      expect(answersOf(stopped)[5]?.status === 'cancelled', `stopping did not end it cleanly: ${String(answersOf(stopped)[5]?.status)}`);
      expect((await panelsNow()).length === 1, 'more than one discussion window for the review');
      await capture(panelId, 'context-chat');

      // 14. A large file whole: drawn, and the window still answers.
      await backToFiles(diffId);
      await openFile(diffId, 'src/generated/catalog.ts');
      const pressedAt = performance.now();
      await press(diffId, '[data-ev="pair-whole-file"]');
      const large = ctxOf(await untilPair(diffId, 'the large file whole', (reading) => ctxOf(reading).cells.length >= 9998, 30_000));
      const drawnMs = Math.round(performance.now() - pressedAt);
      const answerAt = performance.now();
      await check({ action: 'wheel', id: diffId, selector: '.rv-pair-diff', deltaY: 3000 }, 'scroll the large file');
      const scrolled = ctxOf(await readPairWindow(diffId));
      const answerMs = Math.round(performance.now() - answerAt);
      record('a large file whole', { cells: large.cells.length, drawnMs, answerMs, scrollTop: scrolled.scrollTop });
      expect(drawnMs < 8000 && answerMs < 3000 && scrolled.scrollTop > 0, `showing ${String(large.cells.length / 2)} lines took ${String(drawnMs)} ms, or the window stopped answering (${String(answerMs)} ms)`);
      await capture(diffId, 'context-large-file');

      const after = statusRows(await readPairWindow(diffId));
      record('review status', { before, after });
      expect(before === after, `reading, opening and asking changed the review status: ${before} → ${after}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'context-walk') {
      // --- The same in the walk window: a reference, a further one, and back (30 October 2026) ---
      type Msg = { readonly role: string; readonly status: string; readonly text: string; readonly references: readonly string[] };
      type Away = { readonly scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number; readonly firstLine: string; readonly marked: readonly number[]; readonly rows: number; readonly scope: string };
      type First = { readonly row: number; readonly offset: number; readonly wrap: string; readonly scrollWidth: number; readonly clientWidth: number } | null;
      type WalkMore = {
        readonly awayBar: string;
        readonly awayPane: Away | null;
        readonly stageScroll: readonly string[];
        readonly discussionActivity: readonly string[];
        readonly quoteChip: string;
        readonly quoteOffer: readonly string[];
        readonly position: { readonly stepId: string | null } | null;
        readonly paneBoxes: readonly string[];
        readonly dividers: readonly number[];
        readonly activeFirst: First;
        readonly removed: { readonly placeHeading: boolean; readonly highlightWalk: boolean; readonly details: boolean };
      };
      const moreOf = (reading: PairWindowReading | null): WalkMore =>
        ((reading as unknown as { walkView?: WalkMore } | null)?.walkView ?? {
          awayBar: '',
          awayPane: null,
          stageScroll: [],
          discussionActivity: [],
          quoteChip: '',
          quoteOffer: [],
          position: null,
          paneBoxes: [],
          dividers: [],
          activeFirst: null,
          removed: { placeHeading: true, highlightWalk: true, details: true },
        });
      type QuoteSeen = { readonly segments?: readonly { readonly side: string; readonly path: string; readonly start: number; readonly from: number; readonly to: number; readonly text: string }[] };
      type Asked = { readonly role: string; readonly text: string; readonly quote: QuoteSeen | null };
      const askedOf = (reading: PairWindowReading | null): readonly Asked[] =>
        ((reading as unknown as { discussion?: { messages?: readonly Asked[] } | null } | null)?.discussion?.messages ?? []).filter((message) => message.role === 'question');
      const answersOf = (reading: PairWindowReading | null): readonly Msg[] =>
        ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []).filter((message) => message.role === 'answer');
      const statusRows = (reading: PairWindowReading | null): string => JSON.stringify(diffOf(reading).files.map((file) => [file.path, file.handled, file.done]));
      const review = await startReview(diffId, 'routing', null, [2, 1]);
      const before = statusRows(review);
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      const walkRow = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'), 120_000);
      const walkId = walkRow.id;
      await check({ action: 'resize', id: walkId, width: 1500, height: 900 }, 'size the walk window');
      await untilPair(walkId, 'a step', (reading) => moreOf(reading).position?.stepId != null, 30_000);
      // Read a little way into the step first: that is where the walk is to come back to.
      await check({ action: 'wheel', id: walkId, selector: '.rv-walk-stage', deltaY: 300 }, 'scroll the walk');
      const stageBefore = moreOf(await readPairWindow(walkId)).stageScroll;

      // What is gone (30 October 2026): the place's own heading, the whole-walk highlight,
      // Details, and the choice of what counts as handled.
      const plain = moreOf(await readPairWindow(walkId));
      const diffText = (await readPairWindow(diffId))?.text ?? '';
      record('what is gone', { walk: plain.removed, countsAsHandled: diffText.includes('Counts as handled') });
      expect(!plain.removed.placeHeading && !plain.removed.highlightWalk && !plain.removed.details, `something meant to be gone is still there: ${JSON.stringify(plain.removed)}`);
      expect(!diffText.includes('Counts as handled'), 'the diff window still offers a choice of what counts as handled');
      await capture(walkId, 'walk-compact');

      // Wrap lines breaks lines within each pane's width: nothing moves, the line read stays.
      const wrapRound = async (label: string): Promise<{ readonly widthsKept: boolean; readonly firstKept: boolean; readonly fits: boolean }> => {
        const before = moreOf(await readPairWindow(walkId));
        const seen: { boxes: readonly string[]; dividers: readonly number[]; first: First }[] = [];
        for (let turn = 0; turn < 4; turn += 1) {
          await press(walkId, '[data-ev="walk-wrap"]');
          await sleep(300);
          const now = moreOf(await readPairWindow(walkId));
          seen.push({ boxes: now.paneBoxes, dividers: now.dividers, first: now.activeFirst });
          if (turn === 0) {
            await capture(walkId, `walk-wrap-on-${label}`);
          }
        }
        const widthsKept = seen.every((entry) => JSON.stringify(entry.boxes) === JSON.stringify(before.paneBoxes) && JSON.stringify(entry.dividers) === JSON.stringify(before.dividers));
        const firstKept = seen.every((entry) => entry.first?.row === before.activeFirst?.row && Math.abs((entry.first?.offset ?? 0) - (before.activeFirst?.offset ?? 0)) <= 2);
        const wrapped = seen[0]?.first;
        const fits = wrapped !== null && wrapped !== undefined && wrapped.wrap === '1' && wrapped.scrollWidth <= wrapped.clientWidth + 1;
        record(`Wrap lines, ${label}`, { before: { boxes: before.paneBoxes, dividers: before.dividers, first: before.activeFirst }, seen });
        return { widthsKept, firstKept, fits };
      };
      // Into the long call line of the change, as a reader would be.
      await check({ action: 'wheel', id: walkId, selector: '.rv-pane-active .rv-pane-lines', deltaY: 60 }, 'scroll the active pane a little');
      const roundOne = await wrapRound('as opened');
      expect(roundOne.widthsKept, 'Wrap lines changed the panes or the dividers');
      expect(roundOne.firstKept, 'Wrap lines moved the line being read');
      expect(roundOne.fits, 'wrapped lines still need a sideways scroll');
      await check({ action: 'resize', id: walkId, width: 1180, height: 860 }, 'make the walk window narrower');
      await sleep(500);
      const roundTwo = await wrapRound('after resizing');
      expect(roundTwo.widthsKept, 'after resizing, Wrap lines changed the panes or the dividers');
      expect(roundTwo.firstKept, 'after resizing, Wrap lines moved the line being read');
      await check({ action: 'resize', id: walkId, width: 1500, height: 900 }, 'size the walk window again');
      await sleep(400);

      // The review's panel, shown from the walk window (30 October 2026): its own window, where
      // the discussion is asked, answered and followed.
      await press(walkId, '[data-ev="walk-discussion"]');
      const panelId = (await untilWindow('the review panel', (rows) => rows.find((row) => row.view === ('panel' as string)), 20_000)).id;
      const chipOf = (reading: PairWindowReading | null): string => (reading as unknown as { quoteChipText?: string } | null)?.quoteChipText ?? '';
      const activityOf = (reading: PairWindowReading | null): readonly string[] => (reading as unknown as { activityLines?: readonly string[] } | null)?.activityLines ?? [];
      // Asking, and what the line says while the answer comes; collected until the answer is checked.
      const answered = async (count: number, what: string): Promise<{ readonly reading: PairWindowReading; readonly said: readonly string[] }> => {
        const said: string[] = [];
        for (const until = performance.now() + 60_000; performance.now() < until; ) {
          const reading = await readPairWindow(panelId);
          for (const line of activityOf(reading)) {
            if (said.at(-1) !== line) {
              said.push(line);
            }
          }
          const answer = answersOf(reading)[count - 1];
          if (answer?.status === 'done' && answer.references.length > 0 && activityOf(reading).length === 0) {
            return { reading: reading as PairWindowReading, said };
          }
          await sleep(120);
        }
        throw new Error(`${what} did not come`);
      };
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'What does `lookupRoute` do?' }, 'type the question');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      const first = await answered(1, 'the answer about lookupRoute');
      const tableRef = answersOf(first.reading)[0]?.references.find((ref) => ref.startsWith('target:src/domain/routeTable.ts'));
      record('asked in the discussion', { said: first.said, refs: answersOf(first.reading)[0]?.references });
      expect(first.said[0] === 'Waiting for the agent…' && first.said.some((line) => line.startsWith('Searching the code') || line.startsWith('Reading ')) && first.said.some((line) => line.startsWith('Writing')), `the line did not say what the agent did: ${JSON.stringify(first.said)}`);
      expect(tableRef !== undefined, `no reference to lookupRoute's definition: ${JSON.stringify(answersOf(first.reading)[0]?.references)}`);
      // One discussion for the review (30 October 2026): code selected in the diff, the question
      // written straight into the review's discussion, which is already open.
      const promptsOne = (await reviewPromptsSent()).length;
      await openFileHere(diffId, 'src/domain/sessionRouting.ts');
      const diffCell = (line: number): string => `.rv-pair-diff td[data-code-side="target"][data-code-line="${String(line)}"]`;
      await check({ action: 'drag', id: diffId, from: { selector: diffCell(42), offset: 16 }, to: { selector: diffCell(42), offset: 27 } }, 'select the call in the diff');
      const quoted = await untilPair(panelId, 'the quote in the discussion', (reading) => chipOf(reading).includes('lookupRoute'), 10_000);
      record('selected in the diff, shown in the discussion', { chip: chipOf(quoted) });
      await capture(panelId, 'one-discussion-quote');
      await press(panelId, '[data-ev="discussion-composer"]');
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'Where does this come from?' }, 'type in the discussion');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      const shared = await answered(2, 'the answer to the question from the diff');
      const walkAsked = askedOf(shared.reading);
      const diffAfter = await readPairWindow(diffId);
      const panelCount = (await pairWindows()).filter((row) => row.view === ('panel' as string)).length;
      record('one discussion', {
        asked: walkAsked.map((entry) => [entry.text, entry.quote?.segments?.map((segment) => `${segment.side}:${segment.path}:${String(segment.start)}:${segment.text}`)]),
        panels: panelCount,
        prompts: (await reviewPromptsSent()).length - promptsOne,
      });
      expect(walkAsked.at(-1)?.text === 'Where does this come from?' && walkAsked.at(-1)?.quote?.segments?.[0]?.path === 'src/domain/sessionRouting.ts' && walkAsked.at(-1)?.quote?.segments?.[0]?.text === 'lookupRoute' && walkAsked.at(-1)?.quote?.segments?.[0]?.side === 'target', `the question did not carry the diff's selection: ${JSON.stringify(walkAsked.at(-1))}`);
      expect(panelCount === 1 && !(diffAfter?.text ?? '').includes('Enter sends, Shift+Enter') && !((await readPairWindow(walkId))?.text ?? '').includes('Enter sends, Shift+Enter'), "a further chat opened besides the review's one discussion");
      expect((await reviewPromptsSent()).length === promptsOne + 1, `the question was sent ${String((await reviewPromptsSent()).length - promptsOne)} times`);
      await press(panelId, `.rv-answer:has([data-ref="${tableRef ?? ''}"]) [data-ev="answer-show-code"]`);
      await press(panelId, `[data-ev="answer-ref"][data-ref="${tableRef ?? ''}"]`);
      const opened = await untilPair(walkId, 'the definition opened', (reading) => moreOf(reading).awayBar.includes('routeTable.ts') && (moreOf(reading).awayPane?.rows ?? 0) > 0, 15_000);
      const pane = moreOf(opened).awayPane;
      record('reference in the walk window', { bar: moreOf(opened).awayBar, pane });
      expect((pane?.marked ?? []).includes(222) && (pane?.marked ?? []).every((line) => line >= 222 && line <= 228), `the reference's lines are not marked as such: ${JSON.stringify(pane?.marked)}`);
      const marked = pane?.marked ?? [];
      expect((pane?.rows ?? 0) >= marked.length + 20, `the code around the reference is not shown at once: ${String(pane?.rows)} rows`);
      await capture(walkId, 'walk-reference');
      // The whole file, and a scroll in it, as a reader looks around.
      await press(walkId, '.rv-code > .rv-code-pane .rv-code-bar .rv-seg button:last-child');
      await untilPair(walkId, 'the whole definition file', (reading) => (moreOf(reading).awayPane?.rows ?? 0) > 300, 10_000);
      await check({ action: 'wheel', id: walkId, selector: '.rv-code > .rv-code-pane .rv-lines', deltaY: 160 }, 'scroll a little in the definition');
      // Select the call it makes, and ask about it with Explain this; the answer leads on.
      const picked = (await check({ action: 'drag', id: walkId, from: { selector: '.rv-code > .rv-code-pane [data-sel-line="223"] .rv-text', offset: 32 }, to: { selector: '.rv-code > .rv-code-pane [data-sel-line="223"] .rv-text', offset: 45 } }, 'select normaliseLane')) as { selected?: string };
      await untilPair(walkId, 'Explain this beside the selection', (reading) => moreOf(reading).quoteOffer.includes('walk-explain-this'), 5_000);
      await press(walkId, '[data-ev="walk-explain-this"]');
      const second = await answered(3, 'the answer about normaliseLane');
      const laneRef = answersOf(second.reading)[2]?.references.find((ref) => ref.startsWith('target:src/domain/lanes.ts'));
      record('explained in the definition', { selected: picked.selected, said: second.said, refs: answersOf(second.reading)[2]?.references });
      expect(picked.selected === 'normaliseLane' && laneRef !== undefined, `Explain this in the reference did not lead to normaliseLane: ${JSON.stringify([picked.selected, answersOf(second.reading)[2]?.references])}`);
      expect(second.said.length > 0, 'no line said what the agent did');
      const leftAt = moreOf(await readPairWindow(walkId)).awayPane;
      await press(panelId, `.rv-answer:has([data-ref="${laneRef ?? ''}"]) [data-ev="answer-show-code"]`);
      await press(panelId, `[data-ev="answer-ref"][data-ref="${laneRef ?? ''}"]`);
      const further = await untilPair(walkId, 'the further reference', (reading) => moreOf(reading).awayBar.includes('lanes.ts'), 15_000);
      record('further reference', { bar: moreOf(further).awayBar });
      expect(new RegExp(`Back to routeTable[.]ts:${String(marked[0])}–${String(marked.at(-1))}`).test(moreOf(further).awayBar), `the way back does not name the reference before: ${moreOf(further).awayBar}`);
      await press(walkId, '[data-ev="away-back"]');
      const back1 = await untilPair(walkId, 'back at the definition', (reading) => moreOf(reading).awayBar.includes('routeTable.ts'), 10_000);
      await sleep(300);
      const backPane = moreOf(await readPairWindow(walkId)).awayPane;
      record('back at the definition', { leftAt, backPane, bar: moreOf(back1).awayBar });
      expect(leftAt !== null && backPane !== null && Math.abs(backPane.scrollTop - leftAt.scrollTop) <= 2 && backPane.firstLine === leftAt.firstLine && leftAt.scrollTop > 0 && backPane.scope === leftAt.scope && backPane.rows === leftAt.rows, `the definition did not come back where it was read: ${JSON.stringify([leftAt, backPane])}`);
      await press(walkId, '[data-ev="away-back"]');
      const back0 = await untilPair(walkId, 'back in the walk', (reading) => moreOf(reading).awayBar === '', 10_000);
      record('back in the walk', { stageBefore, stageAfter: moreOf(back0).stageScroll });
      expect(JSON.stringify(moreOf(back0).stageScroll) === JSON.stringify(stageBefore), `the walk did not come back as it was: ${JSON.stringify([stageBefore, moreOf(back0).stageScroll])}`);
      await capture(walkId, 'walk-back');
      const after = statusRows(await readPairWindow(diffId));
      expect(before === after, `asking and following references changed the review status: ${before} → ${after}`);
      // Reviewed by the one rule: a line the person marks, then the rest delegated to the agent.
      await openFileHere(diffId, 'src/domain/sessionRouting.ts');
      await markLine(diffId, 'base', 42, 'manual');
      const manualOnly = diffOf(await readPairWindow(diffId)).files.find((file) => file.path === 'src/domain/sessionRouting.ts');
      await press(diffId, '[data-ev="pair-delegate-file"]');
      await untilPair(diffId, 'the delegation picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      await press(diffId, '[data-ev="pair-delegate-agent-start"]');
      const delegated = await untilPair(diffId, 'the delegated review', (reading) => diffOf(reading).jobs.some((job) => job.kind === 'review' && job.state !== 'running' && job.state !== 'cancelling'), 60_000);
      const job = diffOf(delegated).jobs.find((entry) => entry.kind === 'review');
      const mixed = diffOf(delegated).files.find((file) => file.path === 'src/domain/sessionRouting.ts');
      await backToFiles(diffId);
      const rows = diffOf(await readPairWindow(diffId)).fileRows;
      record('reviewed by the one rule', { manualOnly, job, mixed, rows });
      expect(manualOnly?.handled === 1 && manualOnly.manual === 1, `the person's review did not count: ${JSON.stringify(manualOnly)}`);
      expect(job?.state === 'done' && (mixed?.agent ?? 0) > 0 && mixed?.handled === (mixed?.manual ?? 0) + (mixed?.agent ?? 0) + (mixed?.exempted ?? 0), `a delegated approval did not count beside the person's: ${JSON.stringify(mixed)}`);
      expect(rows.some((row) => row.includes('sessionRouting.ts') && /Claude|Agent/.test(row)), `who reviewed is not said: ${JSON.stringify(rows)}`);
      await capture(diffId, 'reviewed-by-rule');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'remote' || phase === 'remote-again' || phase === 'remote-restart') {
      // --- A remote session (DSP-111): a host in a process of its own, a real connection, cut for real ---
      type Msg = { readonly id: string; readonly role: string; readonly status: string; readonly text: string };
      const FILE = 'src/domain/sessionRouting.ts';
      const cellAt = (line: number): string => `.rv-pair-diff td[data-code-side="target"][data-code-line="${String(line)}"]`;
      const msgsOf = (reading: PairWindowReading | null): readonly Msg[] => ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []);
      const asked = (reading: PairWindowReading | null): readonly Msg[] => msgsOf(reading).filter((message) => message.role === 'question');
      const answers = (reading: PairWindowReading | null): readonly Msg[] => msgsOf(reading).filter((message) => message.role === 'answer');
      const link = async (): Promise<{ readonly phase: string; readonly note: string; readonly machine: string }> => (await window.dspatch.pairWindowCheck({ action: 'host-link' })).detail as never;
      const untilLink = async (wanted: string, ms = 20_000): Promise<{ readonly phase: string; readonly note: string }> => {
        for (const until = performance.now() + ms; performance.now() < until; ) {
          const now = await link();
          if (now.phase === wanted) {
            return now;
          }
          await sleep(100);
        }
        throw new Error(`the connection never read ${wanted}: ${JSON.stringify(await link())}`);
      };
      const trial = (what: string): Promise<unknown> => check({ action: 'trial', path: what }, `ask the trial for ${what}`);
      const promptsAt = async (): Promise<number> => (await reviewPromptsSent()).length;
      const askInPanel = async (panelId: number, text: string): Promise<void> => {
        await press(panelId, '[data-ev="right-tab-discussion"]');
        await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text }, 'type a question');
        await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      };
      const answerCame = async (panelId: number, count: number, what: string, ms = 60_000): Promise<PairWindowReading> =>
        untilPair(panelId, what, (reading) => answers(reading)[count - 1]?.status === 'done', ms);
      const panelRow = (rows: readonly PairWindowRow[]): PairWindowRow | undefined => rows.find((row) => row.view === ('panel' as string));

      const connected = await untilLink('connected');
      record('connected', connected);
      await capture(diffId, 'remote-connected');
      // The host was restarted under a running answer, and this window was reloaded: this is the
      // scenario's second part. Nothing is resent, and what was running does not read as done.
      if (phase === 'remote-restart' && connected.note.includes('restarted')) {
        await sleep(3_000);
        const panelId = (await untilWindow('the review panel again', panelRow, 20_000)).id;
        await press(panelId, '[data-ev="right-tab-discussion"]');
        const saved = await untilPair(panelId, 'the saved history', (reading) => asked(reading).length >= 2, 20_000);
        const last = msgsOf(saved).at(-1);
        record('after the host restarted', { questions: asked(saved).map((entry) => entry.text), answers: answers(saved).map((entry) => entry.status), last: last?.status, prompts: await promptsAt() });
        expect((await promptsAt()) === 0, 'the new host sent something');
        expect(!(last?.role === 'answer' && last.status === 'done' && asked(saved).at(-1)?.text.startsWith('One more') === true), 'a question lost with the host read as answered');
        await capture(diffId, 'remote-host-restarted');
        await capture(panelId, 'remote-host-restarted-panel');
        return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
      }
      await startReview(diffId, 'routing', null, [2, 1]);
      await check({ action: 'resize', id: diffId, width: 1400, height: 900 }, 'size the diff window');
      await openFileHere(diffId, FILE);

      if (phase === 'remote') {
        const prompts0 = await promptsAt();
        await check({ action: 'drag', id: diffId, from: { selector: cellAt(191), offset: 8 }, to: { selector: cellAt(191), offset: 13 } }, 'select part of line 191');
        await untilPair(diffId, 'Ask beside the selection', (reading) => (diffOf(reading) as unknown as { context?: { askOffered?: boolean } }).context?.askOffered === true);
        await press(diffId, '[data-ev="ask-this"]');
        const panelId = (await untilWindow('the review panel', panelRow, 20_000)).id;

        // 7. Stop a question: the agent's turn ends as stopped, and that is what it says.
        await askInPanel(panelId, 'Why is this capped?');
        await untilPair(panelId, 'the answer on its way', (reading) => ((reading as unknown as { activityLines?: readonly string[] }).activityLines ?? []).length > 0 || (reading.text ?? '').includes('Stop'), 20_000);
        await press(panelId, '[data-ev="discussion-stop"]');
        const stopped = await untilPair(panelId, 'the stop', (reading) => !(reading.text ?? '').includes('Stopping') && (answers(reading)[0]?.status ?? 'answering') !== 'answering', 30_000);
        record('a question stopped', { answer: answers(stopped)[0]?.status, prompts: (await promptsAt()) - prompts0 });
        expect(answers(stopped)[0]?.status !== 'done', 'a stopped question read as answered');

        // 8a. The connection cut while an answer streams: the window says so, nothing is sent,
        // the host goes on, and the answer is there afterwards, once.
        const promptsBefore = await promptsAt();
        await askInPanel(panelId, 'What does the cap protect?');
        await untilPair(panelId, 'the second answer on its way', (reading) => asked(reading).length === 2 && (reading.text ?? '').includes('Stop'), 20_000);
        await trial('/cut');
        const lost = await untilLink('reconnecting');
        await sleep(600);
        const whileDown = await readPairWindow(diffId);
        record('cut during an answer', { link: lost, line: (whileDown?.text ?? '').includes('Disconnected') });
        expect((whileDown?.text ?? '').includes('Disconnected'), 'the window does not say the connection is lost');
        await capture(diffId, 'remote-disconnected');
        const pressed = await window.dspatch.pairWindowCheck({ action: 'press', id: panelId, selector: '[data-ev="right-tab-discussion"]' });
        record('the window still answers', { ok: pressed.ok });
        await sleep(4_000);
        await trial('/mend');
        await untilLink('connected');
        const recovered = await answerCame(panelId, 2, 'the answer finished while away');
        record('reconnected', { questions: asked(recovered).length, answers: answers(recovered).map((entry) => entry.status), prompts: (await promptsAt()) - promptsBefore });
        expect(asked(recovered).length === 2, 'the question appeared twice');
        expect((await promptsAt()) === promptsBefore + 1, 'the question was sent again');

        // 8b. Walks prepared, the connection cut during the job: one job, finished on the host.
        await press(diffId, '[data-ev="pair-prepare-walks"]');
        await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
        await press(diffId, '[data-ev="pair-walks-agent-start"]');
        await untilPair(diffId, 'the job running', (reading) => (reading.text ?? '').includes('Stop'), 20_000);
        await sleep(600);
        await trial('/cut');
        await untilLink('reconnecting');
        await sleep(5_000);
        await trial('/mend');
        await untilLink('connected');
        const walkRow = await untilWindow('the walk window after the job', (rows) => rows.find((row) => row.view === 'walk'), 120_000);
        await capture(walkRow.id, 'remote-walk');
        const walkPrompts = await promptsAt();
        record('a job across a cut', { prompts: walkPrompts - promptsBefore });
        expect(walkPrompts - promptsBefore <= 3, `the job was started again: ${String(walkPrompts - promptsBefore)} prompts`);
        // The chooser browses the host: the same call Open Project makes.
        const picking = window.dspatch.pickProjectFolder();
        let page: string | null = null;
        for (const until = performance.now() + 15_000; performance.now() < until && (page === null || page === ''); ) {
          page = (await window.dspatch.pairWindowCheck({ action: 'browser-text' })).detail as string | null;
          await sleep(200);
        }
        record('the host chooser', { lines: (page ?? '').split('\n').length, opensOn: (page ?? '').slice(0, 120) });
        expect((page ?? '').includes('Choose this folder'), `the chooser did not open: ${String(page)}`);
        await press(-1, '[data-ev="host-browser-choose"]');
        const picked = await picking;
        record('chosen on the host', picked);
        expect(picked.kind === 'chosen', `nothing was chosen: ${JSON.stringify(picked)}`);
        return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
      }

      if (phase === 'remote-again') {
        // 9. A new client process on the same host: the saved review and answers, nothing sent.
        const prompts0 = await promptsAt();
        await press(diffId, '[data-ev="pair-discussion"]');
        const panelId = (await untilWindow('the review panel', panelRow, 20_000)).id;
        await press(panelId, '[data-ev="right-tab-discussion"]');
        const history = await untilPair(panelId, 'the history', (reading) => asked(reading).length >= 2, 20_000);
        record('reopened', { questions: asked(history).map((entry) => entry.text), answers: answers(history).map((entry) => entry.status), prompts: (await promptsAt()) - prompts0 });
        expect((await promptsAt()) === prompts0, 'reopening sent something');
        await capture(panelId, 'remote-reopened');
        return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
      }

      // 10. The host restarted under a running answer: unknown, not finished; saved work is there.
      await press(diffId, '[data-ev="pair-discussion"]');
      const panelId = (await untilWindow('the review panel', panelRow, 20_000)).id;
      const before = await untilPair(panelId, 'the history', (reading) => asked(reading).length >= 2, 20_000);
      await askInPanel(panelId, 'One more, while the host goes away');
      await untilPair(panelId, 'the answer on its way', (reading) => asked(reading).length === asked(before).length + 1 && (reading.text ?? '').includes('Stop'), 20_000);
      // The reload that follows ends this run of the script; the part above takes over.
      await trial('/restart-host');
      await sleep(60_000);
      throw new Error('the windows were not reloaded after the host restarted');
    }

    if (phase === 'panel-copilot') {
      // --- Copilot chosen and used in the Discussion panel, in its own window and docked (SIMULATED) ---
      type Msg = { readonly role: string; readonly status: string; readonly text: string };
      type Discussion = { readonly messages?: readonly Msg[]; readonly agentChosen?: string; readonly modelChosen?: string };
      type Row = PairWindowRow & { readonly panel?: { readonly place: string; readonly frameVisible: boolean; readonly viewVisible: boolean; readonly viewWidth: number } | null };
      const FILE = 'src/domain/sessionRouting.ts';
      const discussionOf = (reading: PairWindowReading | null): Discussion => (reading as unknown as { discussion?: Discussion | null } | null)?.discussion ?? {};
      const answersOf = (reading: PairWindowReading | null): readonly Msg[] => (discussionOf(reading).messages ?? []).filter((message) => message.role === 'answer');
      const cellAt = (line: number): string => `.rv-pair-diff td[data-code-side="target"][data-code-line="${String(line)}"]`;
      const ask = async (panelId: number, question: string, count: number): Promise<PairWindowReading> => {
        await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: question }, 'type the question');
        await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
        return untilPair(panelId, `answer ${String(count)}`, (reading) => answersOf(reading)[count - 1]?.status === 'done', 60_000);
      };

      await startReview(diffId, 'routing', null, [2, 1]);
      await openFile(diffId, FILE);
      await check({ action: 'drag', id: diffId, from: { selector: cellAt(191), offset: 8 }, to: { selector: cellAt(191), offset: 13 } }, 'select part of line 191');
      await untilPair(diffId, 'Ask beside the selection', (reading) => (diffOf(reading) as unknown as { context?: { askOffered?: boolean } }).context?.askOffered === true);
      await press(diffId, '[data-ev="ask-this"]');
      const panelId = (await untilWindow('the review panel', (rows) => (rows as readonly Row[]).find((row) => row.view === ('panel' as string) && row.panel?.place === 'window' && row.panel.frameVisible))).id;

      // 1. The opener was Claude; Copilot is chosen with the keyboard, then a model.
      const opened = await untilPair(panelId, 'the inherited agent', (reading) => discussionOf(reading).agentChosen === 'claude', 20_000);
      record('panel opened', { agent: discussionOf(opened).agentChosen, model: discussionOf(opened).modelChosen });
      for (let tries = 0; tries < 3 && discussionOf(await readPairWindow(panelId)).agentChosen !== 'copilot'; tries += 1) {
        await pressKey(panelId, '[data-ev="discussion-agent-select"]', 'Down');
      }
      await untilPair(panelId, "Copilot's models", (reading) => discussionOf(reading).agentChosen === 'copilot' && discussionOf(reading).modelChosen === 'copilot-default', 20_000);
      await pressKey(panelId, '[data-ev="model-select"]', 'Down');
      await pressKey(panelId, '[data-ev="model-select"]', 'Down');
      const chosen = await untilPair(panelId, 'the chosen model', (reading) => discussionOf(reading).modelChosen === 'sonnet', 10_000);
      record('Copilot and a model chosen', { agent: discussionOf(chosen).agentChosen, model: discussionOf(chosen).modelChosen });
      await capture(panelId, 'copilot-own-window');

      // 2. In its own window: the question reaches Copilot's session with that model.
      const prompts0 = (await reviewPromptsSent()).length;
      const first = await ask(panelId, 'Why is this capped?', 1);
      const sent = await reviewPromptsSent();
      const prompt = sent.at(-1) ?? '';
      const firstAdapter = await reviewAdapterRecord();
      record('own window', { prompt: prompt.slice(0, 1500), adapter: firstAdapter, answer: answersOf(first)[0]?.text });
      expect(sent.length === prompts0 + 1, 'the question was not sent once');
      expect(firstAdapter.starts.at(-1)?.provider === 'copilot' && firstAdapter.starts.at(-1)?.modelRequested === 'sonnet', `Copilot's session did not get sonnet: ${JSON.stringify(firstAdapter.starts)}`);
      expect(firstAdapter.built.at(-1) === 'copilot' && !firstAdapter.built.includes('cursor'), `the wrong adapter was built: ${JSON.stringify(firstAdapter.built)}`);
      expect(prompt.includes('Why is this capped?') && prompt.includes(FILE) && prompt.includes('share'), 'the prompt lacks the question, its file or the selection');
      expect(firstAdapter.sendModels.at(-1) === 'sonnet', `the question was not sent with sonnet: ${JSON.stringify(firstAdapter.sendModels)}`);

      // 3. Docked in the diff: another model, the same discussion.
      await press(panelId, '[data-ev="panel-dock-diff"]');
      await untilWindow('the panel docked', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'diff' && row.panel.viewVisible === true && row.panel.viewWidth > 0), 10_000);
      await pressKey(panelId, '[data-ev="model-select"]', 'Down');
      const docked = await untilPair(panelId, 'the model changed while docked', (reading) => discussionOf(reading).modelChosen === 'haiku', 10_000);
      await sleep(800);
      await capture(panelId, 'copilot-docked-panel');
      await check({ action: 'screen', id: diffId, label: 'copilot-docked-screen' }, 'see the docked panel');
      const second = await ask(panelId, 'And when docked?', 2);
      const secondPrompt = (await reviewPromptsSent()).at(-1) ?? '';
      const secondAdapter = await reviewAdapterRecord();
      record('docked', { agent: discussionOf(docked).agentChosen, adapter: secondAdapter, answer: answersOf(second)[1]?.text, messages: (discussionOf(second).messages ?? []).length });
      expect(discussionOf(docked).agentChosen === 'copilot', 'docking changed the agent');
      expect((await reviewPromptsSent()).length === prompts0 + 2, 'the docked question was not sent once');
      expect(secondPrompt.includes('And when docked?'), 'the docked prompt lacks the question');
      expect(JSON.stringify(secondAdapter.sendModels) === JSON.stringify(['sonnet', 'haiku']), `the docked question was not sent with haiku: ${JSON.stringify(secondAdapter.sendModels)}`);
      expect((answersOf(second)[1]?.text ?? '').includes('And when docked?'), `the docked answer is not to the docked question: ${JSON.stringify(answersOf(second)[1])}`);
      expect((discussionOf(second).messages ?? []).length === 4, 'the docked answer is not in the same discussion');
      expect(secondAdapter.built.every((provider) => provider !== 'cursor'), 'a Cursor adapter was built');
      await press(panelId, '[data-ev="panel-own-window"]');
      await untilWindow('the panel in its own window', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'window' && row.panel.frameVisible), 10_000);
      const kept = await readPairWindow(panelId);
      expect((discussionOf(kept).messages ?? []).length === 4, 'the discussion was lost moving back');
      await capture(panelId, 'copilot-back-own-window');
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'panel') {
      // --- The review's panel: its own window, docked, moved, hidden, and one per review (30 October 2026) ---
      type Seg = { readonly side: string; readonly path: string; readonly start: number; readonly from: number; readonly to: number; readonly text: string };
      type Msg = { readonly id: string; readonly role: string; readonly status: string; readonly text: string; readonly quote: { readonly segments?: readonly Seg[] } | null };
      type Row = PairWindowRow & { readonly panel?: { readonly place: string; readonly visible: boolean; readonly frameVisible: boolean; readonly viewVisible: boolean; readonly viewWidth: number } | null };
      const FILE = 'src/domain/sessionRouting.ts';
      const msgsOf = (reading: PairWindowReading | null): readonly Msg[] => ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []);
      const asked = (reading: PairWindowReading | null): readonly Msg[] => msgsOf(reading).filter((message) => message.role === 'question');
      const answers = (reading: PairWindowReading | null): readonly Msg[] => msgsOf(reading).filter((message) => message.role === 'answer');
      const chipOf = (reading: PairWindowReading | null): string => (reading as unknown as { quoteChipText?: string } | null)?.quoteChipText ?? '';
      const activityOf = (reading: PairWindowReading | null): readonly string[] => (reading as unknown as { activityLines?: readonly string[] } | null)?.activityLines ?? [];
      const focusedOf = (reading: PairWindowReading | null): string => (reading as unknown as { focusedEv?: string | null } | null)?.focusedEv ?? '';
      const composerOf = (reading: PairWindowReading | null): string => (reading as unknown as { discussion?: { composer?: string } | null } | null)?.discussion?.composer ?? '';
      const panels = async (): Promise<readonly Row[]> => (await pairWindows()).filter((row) => row.view === ('panel' as string)) as readonly Row[];
      const cellAt = (line: number): string => `.rv-pair-diff td[data-code-side="target"][data-code-line="${String(line)}"]`;
      const answered = async (panelId: number, count: number, what: string): Promise<PairWindowReading> => {
        for (const until = performance.now() + 60_000; performance.now() < until; ) {
          const reading = await readPairWindow(panelId);
          const answer = answers(reading)[count - 1];
          if (reading !== null && answer !== undefined && answer.status === 'done' && activityOf(reading).length === 0) {
            await sleep(400);
            return (await readPairWindow(panelId)) ?? reading;
          }
          await sleep(150);
        }
        throw new Error(`${what} did not come`);
      };
      const promptsAt = async (): Promise<number> => (await reviewPromptsSent()).length;

      // 1. No walk: select code in the diff; Ask… opens the panel in its own window, quoted.
      const review = await startReview(diffId, 'routing', null, [2, 1]);
      await check({ action: 'resize', id: diffId, width: 1400, height: 900 }, 'size the diff window');
      const before = JSON.stringify(diffOf(review).files.map((file) => [file.path, file.handled]));
      await openFile(diffId, FILE);
      const prompts0 = await promptsAt();
      await check({ action: 'drag', id: diffId, from: { selector: cellAt(191), offset: 8 }, to: { selector: cellAt(191), offset: 13 } }, 'select part of line 191');
      await untilPair(diffId, 'Ask beside the selection', (reading) => (diffOf(reading) as unknown as { context?: { askOffered?: boolean } }).context?.askOffered === true);
      const notYet = await panels();
      record('a selection alone', { panels: notYet.length });
      expect(notYet.length === 0, 'selecting code opened a window');
      await press(diffId, '[data-ev="ask-this"]');
      const panelRow = await untilWindow('the review panel', (rows) => (rows as readonly Row[]).find((row) => row.view === ('panel' as string) && row.panel?.visible === true), 20_000);
      const panelId = panelRow.id;
      const opened = await untilPair(panelId, 'the panel with the quote and the cursor', (reading) => chipOf(reading).includes('share') && focusedOf(reading) === 'discussion-composer', 20_000).catch(async (error: unknown) => {
        const seen = await readPairWindow(panelId);
        record('panel focus problem', { focused: focusedOf(seen) });
        throw error;
      });
      const openedRow = (await panels())[0];
      record('Ask… before any walk', { panel: openedRow?.panel, chip: chipOf(opened), focused: focusedOf(opened), tabs: (opened?.text ?? '').includes('Step') });
      expect(openedRow?.panel?.place === 'window' && openedRow.panel.frameVisible, `the panel did not open in its own window: ${JSON.stringify(openedRow?.panel)}`);
      expect((await promptsAt()) === prompts0, 'opening the panel sent something');
      await capture(panelId, 'panel-own-window');
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'Why is this capped?' }, 'type the question');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      const first = await answered(panelId, 1, 'the first answer');
      expect(asked(first)[0]?.quote?.segments?.[0]?.text === 'share' && asked(first)[0]?.quote?.segments?.[0]?.start === 191, `the first question lost its selection: ${JSON.stringify(asked(first)[0]?.quote)}`);
      expect((await promptsAt()) === prompts0 + 1, 'the first question was not sent once');

      // 2. Explain this in the diff: one call, into the same panel.
      await check({ action: 'drag', id: diffId, from: { selector: cellAt(42), offset: 16 }, to: { selector: cellAt(42), offset: 27 } }, 'select the call');
      await check({ action: 'chord', id: diffId, key: 'E', modifiers: ['control', 'shift'] }, 'Ctrl+Shift+E');
      const explained = await answered(panelId, 2, 'Explain this');
      record('Explain this', { question: asked(explained)[1]?.text, prompts: (await promptsAt()) - prompts0, panels: (await panels()).length });
      expect((asked(explained)[1]?.text ?? '').startsWith('Explain this') && asked(explained)[1]?.quote?.segments?.[0]?.text === 'lookupRoute', 'Explain this did not ask about the selection');
      expect((await promptsAt()) === prompts0 + 2 && (await panels()).length === 1, 'Explain this sent more than once, or opened a second panel');

      // 3. With the panel open: select other code and write straight into it.
      await check({ action: 'drag', id: diffId, from: { selector: cellAt(192), offset: 2 }, to: { selector: cellAt(192), offset: 8 } }, 'select part of line 192');
      await untilPair(panelId, 'the new quote', (reading) => chipOf(reading).includes('return'));
      await press(panelId, '[data-ev="discussion-composer"]');
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'And this?' }, 'type straight in');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      const direct = await answered(panelId, 3, 'the direct question');
      expect(asked(direct)[2]?.quote?.segments?.[0]?.text === 'return' && asked(direct)[2]?.quote?.segments?.[0]?.path === FILE, `the direct question lost its selection: ${JSON.stringify(asked(direct)[2]?.quote)}`);

      // 3b. Niclas's trial: no walk, docked in the diff, hidden, and back by Discussion and by Ask….
      const drawn = (rows: readonly PairWindowRow[]): PairWindowRow | undefined => (rows as readonly Row[]).find((row) => row.panel?.visible === true && row.panel.viewVisible === true && row.panel.viewWidth > 0);
      await press(panelId, '[data-ev="panel-dock-diff"]');
      await untilWindow('the panel drawn in the diff', drawn, 10_000);
      await press(panelId, '[data-ev="panel-hide"]');
      await untilWindow('the panel hidden', (rows) => (rows as readonly Row[]).find((row) => row.panel?.visible === false), 10_000);
      await press(diffId, '[data-ev="pair-discussion"]');
      const byDiscussion = await untilWindow('the panel back by Discussion', drawn, 10_000);
      await press(panelId, '[data-ev="panel-hide"]');
      await untilWindow('the panel hidden again', (rows) => (rows as readonly Row[]).find((row) => row.panel?.visible === false), 10_000);
      await check({ action: 'drag', id: diffId, from: { selector: cellAt(191), offset: 8 }, to: { selector: cellAt(191), offset: 13 } }, 'select while hidden');
      await untilPair(diffId, 'Ask beside the selection', (reading) => (diffOf(reading) as unknown as { context?: { askOffered?: boolean } }).context?.askOffered === true);
      await press(diffId, '[data-ev="ask-this"]');
      const byAsk = await untilWindow('the panel back by Ask', drawn, 10_000);
      record('hidden with no walk', { byDiscussion: (byDiscussion as Row).panel, byAsk: (byAsk as Row).panel });
      await press(panelId, '[data-ev="discussion-quote-clear"]');
      await press(panelId, '[data-ev="panel-own-window"]');
      await untilWindow('the panel in its own window', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'window' && row.panel.frameVisible), 10_000);

      // 3c. Niclas's trial: docked, then Change revisions. The panel stays as it was, docked
      // beside the commit log; hidden there or before, it comes back docked.
      await press(panelId, '[data-ev="panel-dock-diff"]');
      await untilWindow('the panel docked', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'diff' && row.panel.viewVisible === true), 10_000);
      await press(diffId, '[data-ev="pair-change-revisions"]');
      await untilPair(diffId, 'the commit log', (reading) => diffOf(reading).phase === 'log');
      const dockedInLog = (rows: readonly PairWindowRow[]): PairWindowRow | undefined => (rows as readonly Row[]).find((row) => row.panel?.place === 'diff' && row.panel.frameVisible === false && row.panel.visible && row.panel.viewVisible === true && row.panel.viewWidth > 0);
      await untilWindow('the panel still docked beside the commit log', dockedInLog, 10_000);
      await check({ action: 'screen', id: diffId, label: 'panel-docked-log-screen' }, 'see the commit log with the panel docked');
      await press(panelId, '[data-ev="panel-hide"]');
      await untilPair(diffId, 'Show discussion in the commit log', (reading) => (reading.text ?? '').includes('Show discussion'), 10_000);
      await capture(diffId, 'panel-hidden-commit-log');
      await press(diffId, '[data-ev="pair-left-discussion"]');
      await untilWindow('the panel back docked, shown from the commit log', dockedInLog, 10_000);
      // Hidden first, then Change revisions (what Niclas did): still docked when it is shown.
      await press(diffId, '[data-ev="pair-back-review"]');
      await untilPair(diffId, 'back in the review', (reading) => diffOf(reading).phase === 'review', 20_000);
      await untilWindow('the panel docked in the review', dockedInLog, 10_000);
      await press(panelId, '[data-ev="panel-hide"]');
      await untilPair(diffId, 'Show discussion in the review', (reading) => (reading.text ?? '').includes('Show discussion'), 10_000);
      await press(diffId, '[data-ev="pair-change-revisions"]');
      await untilPair(diffId, 'the commit log again', (reading) => diffOf(reading).phase === 'log');
      await press(diffId, '[data-ev="pair-left-discussion"]');
      await untilWindow('hidden before leaving, shown docked', dockedInLog, 10_000);
      await press(diffId, '[data-ev="pair-back-review"]');
      const backInReview = await untilPair(diffId, 'back in the review', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 20_000);
      const backDocked = await untilWindow('the panel docked again', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'diff' && row.panel.viewVisible === true && row.panel.viewWidth > 0), 10_000);
      record('Change revisions and back', { panel: (backDocked as Row).panel, questions: asked(await readPairWindow(panelId)).length, prompts: (await promptsAt()) - prompts0 });
      expect(JSON.stringify(diffOf(backInReview).files.map((file) => [file.path, file.handled])) === before, 'going to the commit log and back changed the review');
      await press(panelId, '[data-ev="panel-own-window"]');
      await untilWindow('the panel in its own window', (rows) => (rows as readonly Row[]).find((row) => row.panel?.place === 'window' && row.panel.frameVisible), 10_000);
      await openFileHere(diffId, FILE);

      // 4. Walks prepared later: the same history, and Step now in the same panel.
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      const walkRow = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'), 120_000);
      const walkId = walkRow.id;
      const withWalk = await untilPair(panelId, 'the panel over the walk', (reading) => (reading.text ?? '').includes('Step') && asked(reading).length === 3, 30_000);
      record('walks prepared', { questions: asked(withWalk).length, panels: (await panels()).length, walkHasPanel: ((await readPairWindow(walkId))?.text ?? '').includes('Ask about this code') });
      expect((await panels()).length === 1, 'preparing walks made a second panel');
      expect(!((await readPairWindow(walkId))?.text ?? '').includes('Enter sends, Shift+Enter'), 'the walk window has a chat of its own');

      // 5. A draft, docked in the diff, moved to the walk while an answer comes, and out again.
      await press(panelId, '[data-ev="right-tab-discussion"]');
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: 'A draft that moves' }, 'type a draft');
      const typed = await readPairWindow(panelId);
      record('a draft before the move', { draft: composerOf(typed), questions: asked(typed).map((entry) => entry.text) });
      await press(panelId, '[data-ev="panel-dock-diff"]');
      const inDiff = (await panels())[0];
      const diffRoom = await untilPair(diffId, 'room for the panel', (reading) => (reading.text ?? '') !== '' && ((reading as unknown as { pair?: { panelRoom?: boolean } }).pair?.panelRoom === true), 10_000).catch(() => null);
      const draftInDiff = composerOf(await readPairWindow(panelId));
      record('docked in the diff', { panel: inDiff?.panel, room: diffRoom !== null, draft: draftInDiff });
      expect(inDiff?.panel?.place === 'diff' && inDiff.panel.frameVisible === false, `the panel did not dock in the diff: ${JSON.stringify(inDiff?.panel)}`);
      expect(draftInDiff === 'A draft that moves', `the draft did not move with the panel: ${draftInDiff}`);
      await capture(diffId, 'panel-docked-diff-room');
      await check({ action: 'screen', id: diffId, label: 'panel-docked-diff-screen' }, 'see the diff with the panel docked');
      await capture(panelId, 'panel-docked-diff');
      // Hidden while docked, and back from the diff: where it was, with the draft (Niclas's trial, 30 October 2026).
      await untilWindow('the docked panel drawn', (rows) => (rows as readonly Row[]).find((row) => row.panel?.viewVisible === true && row.panel.viewWidth > 0), 10_000);
      await press(panelId, '[data-ev="panel-hide"]');
      await untilWindow('the panel hidden', (rows) => (rows as readonly Row[]).find((row) => row.panel?.visible === false && row.panel.viewVisible === false), 10_000);
      await press(diffId, '[data-ev="pair-discussion"]');
      const dockedAgain = await untilWindow('the docked panel shown again', (rows) => (rows as readonly Row[]).find((row) => row.panel?.visible === true && row.panel.viewVisible === true && row.panel.viewWidth > 0), 10_000);
      record('hidden while docked, shown again', { panel: (dockedAgain as Row).panel, draft: composerOf(await readPairWindow(panelId)) });
      expect((dockedAgain as Row).panel?.place === 'diff' && composerOf(await readPairWindow(panelId)) === 'A draft that moves', 'the docked panel did not come back as it was');
      // Hidden, both code windows say how to show it, and the walk's button brings the history back: nothing is sent.
      const promptsHidden = await promptsAt();
      const questionsHidden = asked(await readPairWindow(panelId)).length;
      await press(panelId, '[data-ev="panel-hide"]');
      await untilPair(diffId, 'Show discussion in the diff', (reading) => (reading.text ?? '').includes('Show discussion'), 10_000);
      await untilPair(walkId, 'Show discussion in the walk', (reading) => (reading.text ?? '').includes('Show discussion'), 10_000);
      await capture(diffId, 'panel-hidden-diff');
      await capture(walkId, 'panel-hidden-walk');
      await press(walkId, '[data-ev="walk-discussion"]');
      await untilWindow('the panel back from the walk', (rows) => (rows as readonly Row[]).find((row) => row.panel?.visible === true && row.panel.viewVisible === true), 10_000);
      await untilPair(diffId, 'Discussion again in the diff', (reading) => !(reading.text ?? '').includes('Show discussion'), 10_000);
      const backFromWalk = await readPairWindow(panelId);
      record('shown from the walk', { questions: asked(backFromWalk).length, prompts: (await promptsAt()) - promptsHidden });
      expect(asked(backFromWalk).length === questionsHidden && (await promptsAt()) === promptsHidden, 'showing the discussion sent something, or lost a question');
      // An answer on its way while the panel moves.
      await check({ action: 'type', id: panelId, selector: '[data-ev="discussion-composer"]', text: ' — sent' }, 'finish the draft');
      await pressKey(panelId, '[data-ev="discussion-composer"]', 'Enter');
      await untilPair(panelId, 'an answer on its way', (reading) => activityOf(reading).length > 0, 15_000);
      await press(panelId, '[data-ev="panel-dock-walk"]');
      const inWalk = (await panels())[0];
      const moved = await answered(panelId, 4, 'the answer that moved');
      record('moved to the walk while answering', { panel: inWalk?.panel, answer: answers(moved)[3]?.status, prompts: (await promptsAt()) - prompts0, questions: asked(moved).map((entry) => entry.text) });
      expect(inWalk?.panel?.place === 'walk', `the panel did not move to the walk: ${JSON.stringify(inWalk?.panel)}`);
      // Four questions, the walks' preparation the one other call: nothing sent twice.
      expect(answers(moved)[3]?.status === 'done' && asked(moved).length === 4 && (await promptsAt()) === prompts0 + 5, 'the answer did not arrive once after the move');
      await capture(walkId, 'panel-docked-walk-room');
      await press(panelId, '[data-ev="panel-own-window"]');
      const own = (await panels())[0];
      expect(own?.panel?.place === 'window' && own.panel.frameVisible, `the panel did not go back to its own window: ${JSON.stringify(own?.panel)}`);

      // 6. Closed and opened again: hidden, nothing sent again, all there.
      const promptsBeforeClose = await promptsAt();
      await check({ action: 'close', id: panelId }, 'close the panel window');
      const hidden = (await panels())[0];
      await press(diffId, '[data-ev="pair-discussion"]');
      const back = await untilPair(panelId, 'the panel again', (reading) => asked(reading).length === 4, 15_000);
      const shownAgain = (await panels())[0];
      record('closed and opened again', { hidden: hidden?.panel, shown: shownAgain?.panel, questions: asked(back).length, prompts: (await promptsAt()) - promptsBeforeClose });
      expect(hidden?.panel?.visible === false && hidden.panel.frameVisible === false, 'closing the panel window did not hide it');
      expect(shownAgain?.panel?.visible === true && (await promptsAt()) === promptsBeforeClose, 'opening it again lost something or sent something');

      // 7. Docked in the walk window, which then closes: the panel goes to its own window, whole.
      await press(panelId, '[data-ev="panel-dock-walk"]');
      await check({ action: 'close', id: walkId }, 'close the walk window');
      const afterWalk = await untilWindow('the panel in its own window again', (rows) => (rows as readonly Row[]).find((row) => row.view === ('panel' as string) && row.panel?.place === 'window' && row.panel.frameVisible === true), 10_000);
      const kept = await readPairWindow(afterWalk.id);
      record('the walk window closed under the panel', { questions: asked(kept).length });
      expect(asked(kept).length === 4, 'the panel lost its history when the walk window closed');

      // 8. A second review of the same repository: its own panel, nothing shared.
      await press(MAIN, '[data-ev="open-review"]');
      const secondDiff = (await untilWindow('a second diff window', (rows) => rows.find((row) => row.view === 'diff' && row.id !== diffId))).id;
      await startReview(secondDiff, 'routing', null, [1, 0]);
      await openFile(secondDiff, 'src/domain/lanes.ts');
      const laneCell = (line: number): string => `.rv-pair-diff td[data-code-side="target"][data-code-line="${String(line)}"]`;
      await check({ action: 'drag', id: secondDiff, from: { selector: laneCell(195), offset: 9 }, to: { selector: laneCell(195), offset: 13 } }, 'select in the second review');
      await untilPair(secondDiff, 'Ask in the second review', (reading) => (diffOf(reading) as unknown as { context?: { askOffered?: boolean } }).context?.askOffered === true);
      await press(secondDiff, '[data-ev="ask-this"]');
      let secondPanel: Row | undefined;
      for (const until = performance.now() + 20_000; secondPanel === undefined && performance.now() < until; ) {
        secondPanel = (await panels()).find((row) => row.id !== panelId);
        await sleep(200);
      }
      const two = secondPanel ?? null;
      const secondReading = secondPanel === undefined ? null : await untilPair(secondPanel.id, 'the second panel loaded', (reading) => chipOf(reading) !== '', 15_000).catch(() => null);
      const firstNow = await readPairWindow(panelId);
      record('two reviews', { panels: (await panels()).map((row) => [row.id, row.pairKey]), secondQuestions: asked(secondReading).length, secondChip: chipOf(secondReading), firstChip: chipOf(firstNow), opened: two !== null });
      expect(secondPanel !== undefined && secondPanel.pairKey !== panelRow.pairKey, 'the second review did not get a panel of its own');
      expect(asked(secondReading).length === 0 && chipOf(firstNow) === '' && chipOf(secondReading).includes('lane'), 'the two reviews share history or quotes');
      await capture(secondPanel?.id ?? panelId, 'panel-second-review');

      const after = JSON.stringify(diffOf(await readPairWindow(diffId)).files.map((file) => [file.path, file.handled]));
      expect(before === after, `the panel changed the review status: ${before} → ${after}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'selection') {
      // --- Selecting text in the walk window to ask about it (Niclas's trial, 30 October 2026) ---
      type Sel = { readonly quoteOffer: readonly string[]; readonly quoteChip: string; readonly windowSelection: string; readonly paneRows: readonly string[]; readonly position: { readonly stepId: string | null } | null };
      const selOf = (reading: PairWindowReading | null): Sel => ((reading as unknown as { walkView?: Sel } | null)?.walkView ?? { quoteOffer: [], quoteChip: '', windowSelection: '', paneRows: [], position: null });
      const stepAt = (reading: PairWindowReading | null): string | null => selOf(reading).position?.stepId ?? null;
      type Msg = { readonly role: string; readonly status: string; readonly text: string };
      const answers = (reading: PairWindowReading | null): readonly Msg[] => ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []).filter((message) => message.role === 'answer');
      const selected = (prompt: string): string => /## What the person selected\n[\s\S]*?(?=\n## )/.exec(prompt)?.[0] ?? '';
      const lastPrompt = async (count: number): Promise<string> => {
        const until = performance.now() + 30_000;
        while (performance.now() < until) {
          const sent = await reviewPromptsSent();
          if (sent.length >= count) {
            return sent[count - 1] ?? '';
          }
          await sleep(200);
        }
        throw new Error(`prompt ${String(count)} never reached the adapter`);
      };
      const row = (side: 'base' | 'target', line: number): string => `.rv-pane-active [data-sel-side="${side}"][data-sel-line="${String(line)}"] .rv-text`;
      const drag = async (walkId: number, from: { readonly selector: string; readonly offset: number }, to: { readonly selector: string; readonly offset: number }): Promise<string> => {
        const detail = (await check({ action: 'drag', id: walkId, from, to }, `select from ${from.selector}`)) as { selected?: string };
        return detail.selected ?? '';
      };
      // Step through the walks until the active pane shows a row; the steps' numbers are the preparation's.
      const showRow = async (walkId: number, wanted: string, button: 'next' | 'previous'): Promise<void> => {
        for (let move = 0; move < 10 && !selOf(await readPairWindow(walkId)).paneRows.includes(wanted); move += 1) {
          await press(walkId, `button.rv-nav-${button}`);
        }
        expect(selOf(await readPairWindow(walkId)).paneRows.includes(wanted), `no step shows ${wanted}`);
      };
      const settledAnswers = async (walkId: number, count: number, what: string): Promise<PairWindowReading> =>
        untilPair(walkId, what, (reading) => answers(reading).length >= count && answers(reading)[count - 1]?.status === 'done', 60_000);

      const review = await startReview(diffId, 'insight', null);
      const statusBefore = JSON.stringify(diffOf(review).files.map((file) => [file.path, file.handled]));
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      const walkId = (await untilWindow('the walk window', (rows) => rows.find((entry) => entry.view === 'walk'), 90_000)).id;
      await check({ action: 'resize', id: walkId, width: 1500, height: 900 }, 'size the walk window');
      await untilPair(walkId, 'the walks', (reading) => stepAt(reading) !== null, 30_000);
      await showRow(walkId, 'target:src/save.ts:3', 'next');
      let prompts = (await reviewPromptsSent()).length;



      // 1–2. Only the variable `workspace` (line 3, characters 43–51, To), then Explain this.
      const line3 = 'export function saveProject(name: string, workspace: EditorWorkspace | null): string {';
      const at = line3.indexOf('workspace');
      const picked = await drag(walkId, { selector: row('target', 3), offset: at }, { selector: row('target', 3), offset: at + 'workspace'.length });
      const offered = await untilPair(walkId, 'Explain this beside the selection', (reading) => selOf(reading).quoteOffer.includes('walk-explain-this'), 5_000).catch(() => null);
      record('variable selected', { picked, offer: selOf(offered).quoteOffer });
      expect(picked === 'workspace' && offered !== null, `selecting the variable did not offer Explain this: ${JSON.stringify({ picked, offer: selOf(offered).quoteOffer })}`);
      await capture(walkId, 'selection-offer');
      await press(walkId, '[data-ev="walk-explain-this"]');
      prompts += 1;
      const explained = selected(await lastPrompt(prompts));
      const variableAnswer = await settledAnswers(walkId, 1, 'the explanation of the variable');
      record('Explain this reached the adapter', { selection: explained, answer: answers(variableAnswer)[0]?.text.slice(0, 300) });
      expect(explained.includes('Selected code, src/save.ts line 3, characters 43–51 · target (To) @') && /\n(`{3,})\nworkspace\n\1/.test(explained), `the adapter did not get exactly the variable: ${explained}`);
      expect((answers(variableAnswer)[0]?.text ?? '').includes('declared as `EditorWorkspace`') && (answers(variableAnswer)[0]?.text ?? '').includes('src/workspace.ts'), 'the answer did not go from the variable to its type');
      await capture(walkId, 'selection-explained');

      // 3. Select again, click into the question field, write a question: the selection goes along.
      const typeAt = line3.indexOf('EditorWorkspace');
      await drag(walkId, { selector: row('target', 3), offset: typeAt }, { selector: row('target', 3), offset: typeAt + 'EditorWorkspace'.length });
      await press(walkId, '[data-ev="right-tab-discussion"]');
      await press(walkId, '[data-ev="discussion-composer"]');
      const focused = await readPairWindow(walkId);
      record('after the focus moved', { chip: selOf(focused).quoteChip, windowSelection: selOf(focused).windowSelection });
      expect(selOf(focused).quoteChip.includes('EditorWorkspace') && selOf(focused).quoteChip.includes('save.ts:3 (To)'), `the quote is not shown at the field after the focus moved: ${selOf(focused).quoteChip}`);
      await capture(walkId, 'selection-chip');
      await check({ action: 'type', id: walkId, selector: '[data-ev="discussion-composer"]', text: 'Vad har jag markerat nu?' }, 'type a question');
      await pressKey(walkId, '[data-ev="discussion-composer"]', 'Enter');
      prompts += 1;
      const asked = await lastPrompt(prompts);
      record('own question reached the adapter', { selection: selected(asked) });
      expect(/\n(`{3,})\nEditorWorkspace\n\1/.test(selected(asked)) && asked.includes('Vad har jag markerat nu?'), `the question did not carry exactly the selection: ${selected(asked)}`);
      await settledAnswers(walkId, 2, 'the answer to the own question');

      // 4a. Several lines (4 and 5), with Ctrl+Shift+E.
      await press(walkId, '[data-ev="right-tab-step"]');
      const twoLines = (await check({ action: 'drag', id: walkId, from: { selector: row('target', 4), offset: 16 }, to: { selector: row('target', 5), offset: 20 } }, 'select two lines')) as unknown;
      record('two lines selected', { drag: twoLines, offer: selOf(await readPairWindow(walkId)).quoteOffer, rows: selOf(await readPairWindow(walkId)).paneRows });
      await capture(walkId, 'selection-two-lines');
      await check({ action: 'chord', id: walkId, key: 'E', modifiers: ['control', 'shift'] }, 'press Ctrl+Shift+E');
      prompts += 1;
      const lines = selected(await lastPrompt(prompts));
      record('two lines', { selection: lines });
      expect(lines.includes('src/save.ts lines 4–5, characters 17–20 (of the first and last line) · target (To)'), `two selected lines did not reach the adapter as one run: ${lines}`);
      await settledAnswers(walkId, 3, 'the answer about two lines');

      // 4b. The other revision: a removed line at From in load.ts (W1.1), from the context menu.
      await press(walkId, '[data-ev="right-tab-discussion"]');
      // A sent question takes its quote with it (30 October 2026): a new selection, not sent, before the move.
      const notSent = await drag(walkId, { selector: row('target', 4), offset: 16 }, { selector: row('target', 4), offset: 20 });
      record('selected, not sent', { selected: notSent, rows: selOf(await readPairWindow(walkId)).paneRows });
      await untilPair(walkId, 'the new quote', (reading) => selOf(reading).quoteChip !== '', 10_000);
      const chipBefore = selOf(await readPairWindow(walkId)).quoteChip;
      await showRow(walkId, 'base:src/load.ts:2', 'previous');
      const moved = await readPairWindow(walkId);
      record('after moving to W1.1', { before: chipBefore, after: selOf(moved).quoteChip });
      expect(chipBefore !== '' && selOf(moved).quoteChip === '', 'a selection from the last step went along to the next');
      const removed = '  return text.slice(8);';
      await drag(walkId, { selector: row('base', 2), offset: removed.indexOf('text.slice') }, { selector: row('base', 2), offset: removed.indexOf('text.slice') + 'text.slice'.length });
      await check({ action: 'right-click', id: walkId, at: { selector: row('base', 2), offset: removed.indexOf('slice') } }, 'open the context menu');
      const menu = await untilPair(walkId, 'the context menu', (reading) => selOf(reading).quoteOffer.includes('walk-ask-about-this'), 5_000).catch(() => null);
      expect(menu !== null, 'the context menu does not offer the selection');
      await press(walkId, '[data-ev="walk-explain-this"]');
      prompts += 1;
      const fromSide = selected(await lastPrompt(prompts));
      record('removed line at From', { selection: fromSide });
      expect(fromSide.includes('src/load.ts line 2, characters 10–19 · base (From) @') && /\n(`{3,})\ntext\.slice\n\1/.test(fromSide), `a selection at From did not reach the adapter at From: ${fromSide}`);
      await settledAnswers(walkId, 4, 'the answer about the From line');

      // 4c. Across a wrapped line: the long line at the end of save.ts, wrapped.
      await showRow(walkId, 'target:src/save.ts:8', 'next');
      await press(walkId, '[data-ev="walk-wrap"]');
      const longLine = row('target', 8);
      const wrapped = await drag(walkId, { selector: longLine, offset: 30 }, { selector: longLine, offset: 190 });
      await press(walkId, '[data-ev="walk-explain-this"]');
      prompts += 1;
      const acrossWrap = selected(await lastPrompt(prompts));
      record('across a wrap', { selected: wrapped.length, selection: acrossWrap.slice(0, 200) });
      expect(wrapped.length === 160 && acrossWrap.includes('src/save.ts line 8, characters 31–190 · target (To)'), `a selection across a wrap did not reach the adapter whole: ${acrossWrap.slice(0, 300)}`);
      await capture(walkId, 'selection-wrapped');
      await settledAnswers(walkId, 5, 'the answer about the wrapped line');

      // 5. Text of the explanation: quoted with its passage, with no place in the code.
      await press(walkId, '[data-ev="right-tab-step"]');
      await drag(walkId, { selector: '.rv-step-panel [data-quote-source="explanation"]', offset: 0 }, { selector: '.rv-step-panel [data-quote-source="explanation"]', offset: 20 });
      await press(walkId, '[data-ev="walk-explain-this"]');
      prompts += 1;
      const prose = selected(await lastPrompt(prompts));
      record('explanation text', { selection: prose });
      expect(prose.includes('(not code; it has no place in the code)') && !prose.includes('Selected code,'), `selected explanation text was given a place in the code: ${prose}`);
      await settledAnswers(walkId, 6, 'the answer about the explanation text');

      // 5b. Text of an answer in the discussion: quoted as an answer, with no place either.
      await press(walkId, '[data-ev="right-tab-discussion"]');
      const answerText = '.rv-discussion [data-quote-source="answer"]';
      await drag(walkId, { selector: answerText, offset: 0 }, { selector: answerText, offset: 18 });
      await press(walkId, '[data-ev="walk-explain-this"]');
      prompts += 1;
      const fromAnswer = selected(await lastPrompt(prompts));
      record('answer text', { selection: fromAnswer });
      expect(fromAnswer.includes('Selected text from an earlier answer in this discussion (not code; it has no place in the code)') && !fromAnswer.includes('Selected code,'), `selected answer text was not quoted as such: ${fromAnswer}`);
      await settledAnswers(walkId, 7, 'the answer about the answer text');

      // 6. A removed quote does not go along: the next question has no selection.
      await drag(walkId, { selector: row('target', 8), offset: 0 }, { selector: row('target', 8), offset: 12 });
      await press(walkId, '[data-ev="right-tab-discussion"]');
      expect(selOf(await readPairWindow(walkId)).quoteChip !== '', 'the quote is not shown before it is removed');
      await press(walkId, '[data-ev="discussion-quote-clear"]');
      await check({ action: 'type', id: walkId, selector: '[data-ev="discussion-composer"]', text: 'And without a selection?' }, 'type a question');
      await pressKey(walkId, '[data-ev="discussion-composer"]', 'Enter');
      prompts += 1;
      const plain = await lastPrompt(prompts);
      record('after the quote was removed', { hasSelection: selected(plain) !== '' });
      expect(selected(plain) === '', 'a removed quote still went along with the next question');
      await settledAnswers(walkId, 8, 'the answer without a selection');

      const statusAfter = JSON.stringify(diffOf(await readPairWindow(diffId)).files.map((file) => [file.path, file.handled]));
      record('status', { before: statusBefore, after: statusAfter });
      expect(statusBefore === statusAfter, `selecting and asking changed the review status: ${statusBefore} → ${statusAfter}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'insight' || phase === 'insight-again') {
      // --- Asking about code the walk does not show; points worth checking (30 October 2026) ---
      type Msg = { readonly role: string; readonly status: string; readonly text: string; readonly codeAccess: boolean; readonly toolPolicy: string | null; readonly references: readonly string[]; readonly insufficient: boolean; readonly reads: readonly string[]; readonly envelopeSubject: { readonly checkId?: string } | null };
      type Answer = { readonly text: string; readonly refs: readonly string[]; readonly tables: readonly { readonly rows: number; readonly cells: number; readonly boxWidth: number; readonly columnWidth: number; readonly boxOverflow: boolean; readonly rawPipes: boolean }[] };
      type Insight = {
        readonly leftOrder: readonly string[];
        readonly checks: readonly { readonly id: string; readonly text: string; readonly height: number }[];
        readonly checkPanel: { readonly id: string; readonly title: string; readonly reasoning: string; readonly places: number; readonly back: string; readonly exchanges: readonly { readonly state: string; readonly text: string }[] } | null;
        readonly answers: readonly Answer[];
        readonly away: string;
        readonly position: { readonly stepId: string | null } | null;
      };
      const insightOf = (reading: PairWindowReading | null): Insight | null => ((reading as unknown as { walkView?: Insight | null } | null)?.walkView ?? null);
      const messagesOf = (reading: PairWindowReading | null): readonly Msg[] => ((reading as unknown as { discussion?: { messages?: readonly Msg[] } | null } | null)?.discussion?.messages ?? []);
      const answersOf = (reading: PairWindowReading | null): readonly Msg[] => messagesOf(reading).filter((message) => message.role === 'answer');
      const stepOf = (reading: PairWindowReading | null): string | null => insightOf(reading)?.position?.stepId ?? null;
      const statusRows = (reading: PairWindowReading | null): string => JSON.stringify(diffOf(reading).files.map((file) => [file.path, file.handled, file.done]));

      if (phase === 'insight-again') {
        // After a restart: what was asked and answered, and the points, are back without a call.
        const list = await untilPair(diffId, 'the ongoing reviews', (reading) => diffOf(reading).phase === 'ongoing');
        const index = (diffOf(list).ongoing ?? []).findIndex((row) => row.startsWith('insight'));
        await press(diffId, `[data-ev="pair-ongoing-open-${String(index)}"]`);
        const review = await untilPair(diffId, 'the insight review', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 60_000);
        record('status after restart', { rows: statusRows(review) });
        await press(diffId, '[data-ev="pair-walks"]');
        const walkRow = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'), 30_000);
        await press(walkRow.id, '[data-ev="right-tab-discussion"]');
        const back = await untilPair(walkRow.id, 'the discussion as it was', (reading) => answersOf(reading).length >= 3, 30_000);
        record('discussion after restart', { answers: answersOf(back).map((answer) => ({ refs: answer.references, insufficient: answer.insufficient })), checks: insightOf(back)?.checks.map((check) => check.id) });
        expect(answersOf(back).some((answer) => answer.references.some((ref) => ref.startsWith('target:src/workspace.ts'))), 'the checked references are not back after the restart');
        expect(answersOf(back).some((answer) => answer.insufficient && answer.references.length === 0), 'the answer that found nothing is not back as it was');
        expect((insightOf(back)?.answers ?? []).some((answer) => answer.tables.length > 0), 'the table is not drawn after the restart');
        expect((insightOf(back)?.checks.length ?? 0) === 2, 'the points worth checking are not back');
        await press(walkRow.id, '[data-ev="check-C1"]');
        const panel = await untilPair(walkRow.id, 'the point with what was asked about it', (reading) => insightOf(reading)?.checkPanel?.id === 'C1');
        record('point after restart', { panel: insightOf(panel)?.checkPanel });
        expect((insightOf(panel)?.checkPanel?.exchanges.length ?? 0) > 0, 'what was asked from the point is not back');
        expect(!/handled":[1-9]/.test(statusRows(review)), `reopening changed the review status: ${statusRows(review)}`);
        await capture(walkRow.id, 'insight-again');
        const sent = await reviewPromptsSent();
        record('prompts after restart', { sent: sent.length });
        expect(sent.length === 0, `prompts were sent after the restart: ${String(sent.length)}`);
        return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
      }

      const review = await startReview(diffId, 'insight', null);
      const before = statusRows(review);
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      const promptsBefore = (await reviewPromptsSent()).length;
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      // What the agent is doing, said under the spinner while it works (30 October 2026).
      const said = new Set<string>();
      let walkRow: PairWindowRow | undefined;
      for (const until = performance.now() + 90_000; walkRow === undefined && performance.now() < until; ) {
        for (const shown of (await readPairWindow(diffId) as unknown as { activities?: readonly string[] } | null)?.activities ?? []) {
          if (shown.startsWith('Writing walk ') && ![...said].some((line) => line.startsWith('Writing walk '))) {
            await capture(diffId, 'walks-activity');
          }
          said.add(shown.slice(0, 80));
        }
        walkRow = (await pairWindows()).find((row) => row.view === 'walk');
        await sleep(150);
      }
      if (walkRow === undefined) {
        throw new Error('the walk window did not open');
      }
      record('walks: what the line said while the agent worked', { said: [...said] });
      expect([...said].some((line) => line.startsWith('Writing walk ')), `the line under the spinner never said which walk was being written: ${JSON.stringify([...said])}`);
      await check({ action: 'resize', id: walkRow.id, width: 1500, height: 900 }, 'size the walk window');
      // The walks come without the points; they are asked for on their own.
      const bare = await untilPair(walkRow.id, 'the walks without points', (reading) => stepOf(reading) !== null && visibleOf(reading).includes('Find what is worth checking'), 30_000);
      const walksPrompt = (await reviewPromptsSent()).slice(promptsBefore).find((prompt) => prompt.includes('prepare-walks')) ?? '';
      record('walks alone', { checks: insightOf(bare)?.checks.length, asksForChecks: walksPrompt.includes('"checks"') });
      expect((insightOf(bare)?.checks.length ?? 0) === 0 && !walksPrompt.includes('"checks"') && !walksPrompt.includes('## Worth checking'), 'the walks were still asked for or shown with points worth checking');
      await capture(walkRow.id, 'walks-without-points');
      await press(walkRow.id, '[data-ev="walk-find-checks"]');
      await untilPair(walkRow.id, 'the agent picker for the points', (reading) => visibleOf(reading).includes('Find what is worth checking') && (reading.text ?? '').includes('Model'), 15_000);
      await press(walkRow.id, '[data-ev="walk-checks-agent-start"]');
      const pointsSaid = await untilPair(walkRow.id, 'what the agent is doing for the points', (reading) => ((reading as unknown as { activities?: readonly string[] }).activities ?? []).length > 0 || (insightOf(reading)?.checks.length ?? 0) > 0, 60_000);
      record('points: what the line said', { said: (pointsSaid as unknown as { activities?: readonly string[] }).activities ?? [] });
      if (((pointsSaid as unknown as { activities?: readonly string[] }).activities ?? []).length > 0) {
        await capture(walkRow.id, 'points-activity');
      }
      const walk = await untilPair(walkRow.id, 'the walks and the points', (reading) => (insightOf(reading)?.checks.length ?? 0) > 0, 60_000);
      const checksPrompt = (await reviewPromptsSent()).find((prompt) => prompt.includes('worth-checking')) ?? '';
      expect(checksPrompt.includes('## The walks the person has') && checksPrompt.includes('W2.1'), 'the points were not asked with the walks as written');
      record('left column', { order: insightOf(walk)?.leftOrder, checks: insightOf(walk)?.checks });
      expect(JSON.stringify(insightOf(walk)?.leftOrder) === JSON.stringify(['walk-about', 'walks-heading', 'walk-attention', 'walk-files']), `the left column is not About, walks, Worth checking: ${JSON.stringify(insightOf(walk)?.leftOrder)}`);
      expect((insightOf(walk)?.checks ?? []).every((entry) => entry.height < 90), 'a point worth checking is a wall of text in the list');
      await capture(walkRow.id, 'insight-walks-and-points');

      // From another step: a point linked to a step goes there, and back returns.
      for (let move = 0; move < 6 && stepOf(await readPairWindow(walkRow.id)) !== 'W2.1'; move += 1) {
        await press(walkRow.id, 'button.rv-nav-next');
      }
      const from = stepOf(await readPairWindow(walkRow.id));
      await press(walkRow.id, '[data-ev="check-C1"]');
      const linked = await untilPair(walkRow.id, 'the linked point at its step', (reading) => insightOf(reading)?.checkPanel?.id === 'C1');
      record('linked point', { from, at: stepOf(linked), panel: insightOf(linked)?.checkPanel });
      expect(from === 'W2.1' && stepOf(linked) === 'W1.1', `the point did not go to its step: ${String(from)} → ${String(stepOf(linked))}`);
      expect((insightOf(linked)?.checkPanel?.places ?? 0) > 0 && (insightOf(linked)?.checkPanel?.reasoning ?? '') !== '' && (insightOf(linked)?.checkPanel?.back ?? '').includes('W2.1'), 'the point does not show its reasoning, its code and the way back');
      await capture(walkRow.id, 'insight-point-linked');
      await press(walkRow.id, '[data-ev="check-back"]');
      const returned = await untilPair(walkRow.id, 'back where it was', (reading) => insightOf(reading)?.checkPanel === null);
      expect(stepOf(returned) === 'W2.1', `back did not return to W2.1: ${String(stepOf(returned))}`);
      await press(walkRow.id, '[data-ev="check-C2"]');
      const toured = await untilPair(walkRow.id, 'the point with its own tour', (reading) => insightOf(reading)?.checkPanel?.id === 'C2');
      record('point with its own tour', { at: stepOf(toured), panel: insightOf(toured)?.checkPanel });
      expect(stepOf(toured) === 'C2.1', `the point without a step did not get its own tour: ${String(stepOf(toured))}`);
      await capture(walkRow.id, 'insight-point-tour');
      await press(walkRow.id, '[data-ev="check-back"]');
      expect(stepOf(await untilPair(walkRow.id, 'back again', (reading) => insightOf(reading)?.checkPanel === null)) === 'W2.1', 'back from the tour did not return');

      // The ordinary question field: a type the step's code does not define.
      const ask = async (question: string, count: number): Promise<PairWindowReading> => {
        await check({ action: 'type', id: walkRow.id, selector: '[data-ev="discussion-composer"]', text: question }, `type "${question}"`);
        await pressKey(walkRow.id, '[data-ev="discussion-composer"]', 'Enter');
        return untilPair(walkRow.id, `the answer to "${question}"`, (reading) => answersOf(reading).length >= count && answersOf(reading)[count - 1]?.status === 'done' && (answersOf(reading)[count - 1]?.references !== undefined), 60_000);
      };
      await press(walkRow.id, '[data-ev="right-tab-discussion"]');
      const first = await ask('What is `EditorWorkspace`?', 1);
      // The check of references lands just after the end.
      const checked = await untilPair(walkRow.id, 'the checked references', (reading) => (answersOf(reading)[0]?.references.length ?? 0) > 0 || (answersOf(reading)[0]?.text ?? '').includes('could not'), 15_000);
      const question = messagesOf(first).find((message) => message.role === 'question');
      const answer = answersOf(checked)[0];
      record('definition asked about', { question: { codeAccess: question?.codeAccess, policy: question?.toolPolicy }, answer, drawn: insightOf(checked)?.answers });
      expect(question?.codeAccess === true && (question.toolPolicy ?? '').includes('Read'), 'the ordinary question could not read the code');
      const baseRef = answer?.references.find((ref) => ref.startsWith('base:src/workspace.ts'));
      const targetRef = answer?.references.find((ref) => ref.startsWith('target:src/workspace.ts'));
      expect(baseRef !== undefined && targetRef !== undefined && baseRef.split(':')[2] !== targetRef.split(':')[2], `the definition at each revision is not referenced apart: ${JSON.stringify(answer?.references)}`);
      expect((answer?.reads ?? []).some((read) => read.includes('target/src/workspace.ts')) && (answer?.reads ?? []).some((read) => read.includes('base/src/workspace.ts')), `the agent did not read the definition at both revisions: ${JSON.stringify(answer?.reads)}`);
      expect(!(answer?.text ?? '').includes('dspatch-references'), 'the references block is shown as text');
      await capture(walkRow.id, 'insight-definition-answer');
      const stepBefore = stepOf(await readPairWindow(walkRow.id));
      await press(walkRow.id, `.rv-answer:has([data-ref="${targetRef ?? ''}"]) [data-ev="answer-show-code"]`);
      await press(walkRow.id, `[data-ev="answer-ref"][data-ref="${targetRef ?? ''}"]`);
      const opened = await untilPair(walkRow.id, 'the definition opened', (reading) => visibleOf(reading).includes('lane: string'), 15_000).catch(() => null);
      const bar = (opened as unknown as { walkView?: { awayBar?: string } } | null)?.walkView?.awayBar ?? '';
      record('reference opened', { away: insightOf(opened)?.away, shows: visibleOf(opened).includes('lane: string'), bar });
      expect(opened !== null, 'the To reference did not open the To definition (with its three fields)');
      expect(bar.includes('workspace.ts') && bar.includes('src/') && bar.includes('To · ') && /lines? \d/.test(bar) && bar.includes(`Back to ${stepBefore ?? ''}`), `the opened code does not say where it is, or the way back: ${bar}`);
      await capture(walkRow.id, 'insight-reference-opened');
      await press(walkRow.id, '[data-ev="away-back"]');
      const returnedTo = await untilPair(walkRow.id, 'back where the reference was opened', (reading) => insightOf(reading)?.away === '' || insightOf(reading)?.away === undefined, 10_000).catch(() => null);
      record('back from the reference', { step: stepOf(returnedTo), before: stepBefore });
      expect(returnedTo !== null && stepOf(returnedTo) === stepBefore, 'Back did not return to where the reference was opened');

      // A follow-up with a table, in the same session.
      const second = await ask('Compare `EditorWorkspace` in From and To in a table', 2);
      const drawn = insightOf(await untilPair(walkRow.id, 'the table drawn', (reading) => (insightOf(reading)?.answers ?? []).some((entry) => entry.tables.length > 0), 15_000));
      const table = drawn?.answers.flatMap((entry) => entry.tables)[0];
      record('table', { table, text: answersOf(second)[1]?.text.slice(0, 300) });
      expect(table !== undefined && table.rows === 3 && !table.rawPipes && table.boxWidth <= table.columnWidth, `the table is not drawn as a table inside the column: ${JSON.stringify(table)}`);
      expect((answersOf(second)[1]?.text ?? '').includes('1 question(s) before'), 'the follow-up was not asked in the same session');
      await capture(walkRow.id, 'insight-table');

      // A name defined nowhere: said so, with no reference made up.
      const third = await ask('What is `UndoJournal`?', 3);
      const missing = answersOf(await untilPair(walkRow.id, 'the missing definition answer', (reading) => answersOf(reading)[2]?.insufficient === true, 15_000).catch(() => third))[2];
      record('missing definition', { missing });
      expect(missing?.references.length === 0 && missing.insufficient && missing.text.includes('could not find'), `a missing definition was not said plainly: ${JSON.stringify(missing)}`);

      // From the point: Tell me more, with the point's context; and the step's own Explain more simply.
      await press(walkRow.id, '[data-ev="right-tab-step"]');
      await press(walkRow.id, '[data-ev="check-C1"]');
      await untilPair(walkRow.id, 'the point open', (reading) => insightOf(reading)?.checkPanel?.id === 'C1');
      await press(walkRow.id, '[data-ev="check-tell-more"]');
      const more = await untilPair(walkRow.id, 'the point\'s answer', (reading) => (insightOf(reading)?.checkPanel?.exchanges ?? []).some((entry) => entry.state === 'done'), 60_000);
      const pointQuestion = messagesOf(more).filter((message) => message.role === 'question').at(-1);
      record('point deepened', { exchanges: insightOf(more)?.checkPanel?.exchanges, subject: pointQuestion?.envelopeSubject });
      expect(pointQuestion?.envelopeSubject?.checkId === 'C1' && pointQuestion.codeAccess, 'Tell me more from the point was not asked with the point and the code');
      expect((insightOf(more)?.checkPanel?.exchanges.at(-1)?.text ?? '').includes('3 question(s) before'), 'the point\'s question was not asked in the same session');
      await press(walkRow.id, '[data-ev="step-explain-simpler"]');
      await untilPair(walkRow.id, 'the step\'s simpler explanation', (reading) => answersOf(reading).length >= 5 && answersOf(reading)[4]?.status === 'done', 60_000);
      await capture(walkRow.id, 'insight-point-deepened');

      // Nothing of it decided anything in the review.
      await sleep(1500);
      const after = statusRows(await readPairWindow(diffId));
      record('status', { before, after });
      expect(before === after, `asking and opening points changed the review status: ${before} → ${after}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'direction') {
      // --- Choosing two commits in any order: Git's ancestry decides From (decision of 29 October 2026) ---
      type LogRead = {
        readonly phase?: string;
        readonly direction: string | null;
        readonly from: string | null;
        readonly to: string | null;
        readonly reversed: boolean;
        readonly directionAsked: string | null;
        readonly openEnabled: boolean;
        readonly log: readonly { readonly hash: string; readonly subject: string; readonly role: string | null }[];
      };
      const logOf = (reading: PairWindowReading | null): LogRead => (reading?.pair ?? { log: [] }) as unknown as LogRead;
      const settled = (what: string): Promise<PairWindowReading> =>
        untilPair(diffId, what, (reading) => logOf(reading).direction === 'ordered' || logOf(reading).direction === 'choose');
      const at = (hash: string): string => `[data-hash="${hash}"]`;
      const brief = (reading: PairWindowReading | null): Record<string, unknown> => {
        const read = logOf(reading);
        return { direction: read.direction, from: read.from, to: read.to, reversed: read.reversed, asked: read.directionAsked, open: read.openEnabled };
      };
      const chooseHistory = async (): Promise<PairWindowReading> => {
        await pastOngoing(diffId);
        const shown = await untilPair(diffId, 'the repositories', (reading) => diffOf(reading).phase === 'repositories');
        await press(diffId, `[data-ev="pair-repo-${String((diffOf(shown).repositories ?? []).findIndex((name) => name.trim() === 'history'))}"]`);
        return untilPair(diffId, 'the history log', (reading) => logOf(reading).phase === 'log' && logOf(reading).log.length === 4);
      };

      const log = await chooseHistory();
      const hashOf = (start: string): string => logOf(log).log.find((commit) => commit.subject.startsWith(start))?.hash ?? '';
      const root = hashOf('Start the notes');
      const ahead = hashOf('Add a second note');
      const side = hashOf('Add a note on a branch');
      const merge = hashOf('Merge the branch');
      const short7 = (hash: string): string => hash.slice(0, 7);
      record('log', { order: logOf(log).log.map((commit) => commit.subject), nothingChosen: logOf(log).log.every((commit) => commit.role === null) });
      expect([root, ahead, side, merge].every((hash) => hash.length === 40), 'the fixture commits are not all in the log');
      expect(logOf(log).log.every((commit) => commit.role === null) && logOf(log).direction === 'none', 'the log opened with a commit chosen');

      // The descendant first. `ahead` is dated nineteen years before `root`, its parent.
      await press(diffId, at(ahead));
      const one = await readPairWindow(diffId);
      record('one chosen', { ...brief(one), role: logOf(one).log.find((commit) => commit.hash === ahead)?.role });
      expect(logOf(one).from === null && logOf(one).log.find((commit) => commit.hash === ahead)?.role === 'Chosen', 'the first click made the commit From');
      await capture(diffId, 'direction-one-chosen');
      await press(diffId, at(root));
      const newestFirst = await settled('the order, descendant clicked first');
      record('descendant clicked first', brief(newestFirst));
      expect(logOf(newestFirst).from === short7(root) && logOf(newestFirst).to === short7(ahead), `the descendant clicked first did not give From the ancestor: ${JSON.stringify(brief(newestFirst))}`);
      await capture(diffId, 'direction-ordered');
      // Both chosen commits clicked again: nothing chosen. Then the ancestor first.
      await press(diffId, at(root));
      await press(diffId, at(ahead));
      expect(logOf(await readPairWindow(diffId)).log.every((commit) => commit.role === null), 'clicking a chosen commit did not unchoose it');
      await press(diffId, at(root));
      await press(diffId, at(ahead));
      const oldestFirst = await settled('the order, ancestor clicked first');
      record('ancestor clicked first', brief(oldestFirst));
      expect(logOf(oldestFirst).from === short7(root) && logOf(oldestFirst).to === short7(ahead), `the ancestor clicked first did not give the same From and To: ${JSON.stringify(brief(oldestFirst))}`);

      // Reverse direction: kept as chosen, never turned back.
      await press(diffId, '[data-ev="pair-swap"]');
      await sleep(2000);
      const reversed = await readPairWindow(diffId);
      record('reversed', brief(reversed));
      expect(logOf(reversed).from === short7(ahead) && logOf(reversed).to === short7(root) && logOf(reversed).reversed, `Reverse direction did not hold: ${JSON.stringify(brief(reversed))}`);
      await capture(diffId, 'direction-reversed');

      // Two commits on separate branches: the person chooses before the review opens.
      await press(diffId, at(side));
      await press(diffId, at(ahead));
      const branches = await settled('the separate branches');
      record('separate branches', brief(branches));
      expect(logOf(branches).direction === 'choose' && !logOf(branches).openEnabled && (logOf(branches).directionAsked ?? '').includes('separate branches'), `separate branches did not ask for the direction: ${JSON.stringify(brief(branches))}`);
      await capture(diffId, 'direction-branches');
      await press(diffId, '[data-ev="pair-direction-1"]');
      const chosen = await readPairWindow(diffId);
      record('direction chosen', brief(chosen));
      expect(logOf(chosen).from === short7(ahead) && logOf(chosen).to === short7(side) && logOf(chosen).openEnabled, `the chosen direction is not shown: ${JSON.stringify(brief(chosen))}`);

      // A late answer about an earlier choice (each answer held back by DSPATCH_PAIR_DIRECTION_DELAY_MS).
      await press(diffId, at(root));
      await press(diffId, at(ahead));
      await press(diffId, at(ahead));
      await press(diffId, at(merge));
      const seen: Record<string, unknown>[] = [];
      const lateUntil = performance.now() + 4000;
      while (performance.now() < lateUntil) {
        const reading = await readPairWindow(diffId);
        seen.push({ atMs: Math.round(performance.now() - startedAt), ...brief(reading) });
        if (logOf(reading).direction === 'ordered') {
          break;
        }
        await sleep(100);
      }
      const final = await settled('the newer choice');
      record('late answer', { seen: seen.slice(-6), states: seen.length, final: brief(final) });
      expect(!seen.some((entry) => entry['from'] === short7(root) && entry['to'] === short7(ahead)), 'the late answer about root and ahead was drawn over the newer choice');
      expect(logOf(final).from === short7(root) && logOf(final).to === short7(merge), `the newer choice is not what is shown: ${JSON.stringify(brief(final))}`);

      // Review changes pressed before Git has answered: it waits and opens the decided pair.
      await press(diffId, at(ahead));
      await press(diffId, at(root));
      const pressedEarly = await readPairWindow(diffId);
      await press(diffId, '[data-ev="pair-open"]');
      const opened = await untilPair(diffId, 'the review from an early press', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 30_000);
      record('opened while deciding', { before: brief(pressedEarly), files: diffOf(opened).files.map((file) => file.path) });
      expect(logOf(pressedEarly).direction === 'deciding', `Review changes was not pressed while deciding: ${JSON.stringify(brief(pressedEarly))}`);
      expect(diffOf(opened).files.length === 1 && diffOf(opened).files[0]?.path === 'notes.txt', 'the review opened from an early press is not root → ahead');
      // A review is kept once its position is saved, a quarter second after it opens.
      await sleep(800);

      // The reversed pair is a review of its own; reopening either changes nothing about it.
      await press(diffId, '[data-ev="pair-all-reviews"]');
      await untilPair(diffId, 'the ongoing reviews', (reading) => diffOf(reading).phase === 'ongoing');
      await chooseHistory();
      await press(diffId, at(root));
      await press(diffId, at(ahead));
      await settled('root and ahead again');
      await press(diffId, '[data-ev="pair-swap"]');
      await press(diffId, '[data-ev="pair-open"]');
      await untilPair(diffId, 'the reversed review', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 30_000);
      await sleep(800);
      await press(diffId, '[data-ev="pair-all-reviews"]');
      const two = await untilPair(diffId, 'two reviews of history', (reading) => diffOf(reading).phase === 'ongoing' && (diffOf(reading).ongoing ?? []).filter((row) => row.startsWith('history')).length === 2);
      const rows = (diffOf(two).ongoing ?? []).filter((row) => row.startsWith('history'));
      record('two directed reviews', { rows });
      // A row reads `history <From> <subject> → <To> <subject> …`.
      const directed = (from: string, to: string) => (row: string): boolean => row.startsWith(`history ${short7(from)} `) && row.includes(`→ ${short7(to)} `);
      const forward = directed(root, ahead);
      const backward = directed(ahead, root);
      expect(rows.some(forward) && rows.some(backward), `the two directions are not two reviews: ${JSON.stringify(rows)}`);
      await capture(diffId, 'direction-two-reviews');
      await press(diffId, `[data-ev="pair-ongoing-open-${String((diffOf(two).ongoing ?? []).findIndex(backward))}"]`);
      await untilPair(diffId, 'the reversed review resumed', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 30_000);
      await press(diffId, '[data-ev="pair-all-reviews"]');
      const again = await untilPair(diffId, 'the reviews after resuming', (reading) => diffOf(reading).phase === 'ongoing');
      const rowsAgain = (diffOf(again).ongoing ?? []).filter((row) => row.startsWith('history'));
      record('after resuming the reversed review', { rows: rowsAgain });
      expect(rowsAgain.length === 2 && rowsAgain.some(backward) && rowsAgain.some(forward), `resuming changed a review's direction: ${JSON.stringify(rowsAgain)}`);
      const sentHere = await reviewPromptsSent();
      expect(sentHere.length === 0, `prompts were sent while choosing commits: ${String(sentHere.length)}`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'columns') {
      // --- The diff's column widths on Niclas's file (e15b426 → 9993113), measured as drawn ---
      type Cell = { readonly kind: string; readonly width: number };
      type Columns = {
        readonly diff: { readonly layout: string; readonly width: number; readonly startsWithFold: boolean; readonly cells: readonly Cell[] } | null;
        readonly walk: readonly { readonly digits: number; readonly pane: number; readonly gutter: number; readonly numbers: number; readonly mark: number; readonly code: number }[];
      };
      const columnsOf = (reading: PairWindowReading | null): Columns => (reading as unknown as { columns: Columns } | null)?.columns ?? { diff: null, walk: [] };
      const PAIR = { base: 'e15b426a69ba308c4200cdd592ef5946461c5cfc', target: '9993113fe45cba9fd90e8696845afb6e7979e759' };
      const FILE = 'src/app/MidiEditorPresenter.h';
      const measured: Record<string, unknown> = {};
      const metaOf = (cells: readonly Cell[]): number[] => cells.filter((entry) => entry.kind !== 'rv-pair-code').map((entry) => entry.width);
      const measure = async (label: string, layout: 'split' | 'unified'): Promise<Columns['diff']> => {
        await press(diffId, `[data-ev="pair-layout-${layout}"]`);
        const reading = await untilPair(diffId, `${layout} drawn`, (read) => diffOf(read).layout === layout && (columnsOf(read).diff?.cells.length ?? 0) > 0);
        const diff = columnsOf(reading).diff;
        measured[label] = diff;
        const codes = (diff?.cells ?? []).filter((entry) => entry.kind === 'rv-pair-code').map((entry) => entry.width);
        const meta = metaOf(diff?.cells ?? []);
        const width = diff?.width ?? 0;
        expect(codes.length === (layout === 'split' ? 2 : 1), `${label}: not the code columns expected: ${JSON.stringify(diff)}`);
        expect(meta.every((entry) => entry <= 48), `${label}: a strip, number or sign column is wide: ${JSON.stringify(diff?.cells)}`);
        // The code takes exactly what the fixed columns leave, shared equally side by side.
        const rest = (width - meta.reduce((sum, entry) => sum + entry, 0)) / codes.length;
        expect(codes.every((entry) => Math.abs(entry - rest) <= 2), `${label}: the code does not take the rest: ${JSON.stringify(diff)}`);
        await capture(diffId, `columns-${label}`);
        return diff;
      };

      // The newer commit clicked first, as in Niclas's trial, on the real repository's clone.
      await pastOngoing(diffId);
      const shown = await untilPair(diffId, 'the repositories', (reading) => diffOf(reading).phase === 'repositories');
      await press(diffId, `[data-ev="pair-repo-${String((diffOf(shown).repositories ?? []).findIndex((name) => name.trim() === DAL.name))}"]`);
      await untilPair(diffId, 'the MiniDAWLab log', (reading) => diffOf(reading).phase === 'log' && ((reading.pair as { commits?: number } | undefined)?.commits ?? 0) > 13);
      await press(diffId, `[data-hash="${PAIR.target}"]`);
      await press(diffId, `[data-hash="${PAIR.base}"]`);
      const order = await untilPair(diffId, 'the MiniDAWLab order', (reading) => (reading.pair as { direction?: string } | undefined)?.direction === 'ordered');
      const fromTo = order.pair as unknown as { from: string; to: string };
      record('newer clicked first on MiniDAWLab', { from: fromTo.from, to: fromTo.to });
      expect(fromTo.from === 'e15b426' && fromTo.to === '9993113', `MiniDAWLab's pair is not e15b426 → 9993113: ${JSON.stringify(fromTo)}`);
      await press(diffId, '[data-ev="pair-open"]');
      await untilPair(diffId, 'the MiniDAWLab review', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 60_000);

      const size = async (width: number, height: number): Promise<unknown> => check({ action: 'resize', id: diffId, width, height }, `resize to ${String(width)}×${String(height)}`);
      measured['normal size'] = await size(1280, 820);
      const file = await openFile(diffId, FILE);
      const normalSplit = await measure('normal-split', 'split');
      expect(normalSplit?.startsWithFold === true, 'the file does not start with a fold, the case that broke the widths');
      await measure('normal-unified', 'unified');
      measured['wide size'] = await size(2200, 1150);
      const wideSplit = await measure('wide-split', 'split');
      expect(JSON.stringify(metaOf(wideSplit?.cells ?? [])) === JSON.stringify(metaOf(normalSplit?.cells ?? [])), 'the metadata columns grew with the window');
      await measure('wide-unified', 'unified');
      // With the explanation panel beside the diff.
      await press(diffId, '[data-ev="pair-layout-split"]');
      const line = diffOf(file).strips.find((entry) => entry.side === 'target')?.line ?? 0;
      await check({ action: 'drag', id: diffId, from: { selector: cell('target', line), offset: 2 }, to: { selector: cell('target', line), offset: 24 } }, 'select code');
      await untilPair(diffId, 'Explain this', (reading) => diffOf(reading).explainOffered);
      await press(diffId, '[data-ev="explain-this"]');
      await explainedInPanel('the explanation');
      await measure('wide-split-explained', 'split');
      await measure('wide-unified-explained', 'unified');
      await size(1280, 820);
      await measure('normal-unified-explained', 'unified');
      await measure('normal-split-explained', 'split');
      // A file past a thousand lines: four-digit numbers.
      await backToFiles(diffId);
      await openFile(diffId, 'src/app/ProjectIoCoordinator.cpp');
      const four = await measure('normal-split-four-digits', 'split');
      expect(metaOf(four?.cells ?? []).some((entry, index) => index % 3 === 1 && entry > (metaOf(normalSplit?.cells ?? [])[1] ?? 0)), 'the number column does not widen for four digits');

      // The walk window's gutter on the same pair.
      await press(diffId, '[data-ev="pair-prepare-walks"]');
      await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
      await press(diffId, '[data-ev="pair-walks-agent-start"]');
      const walkRow = await untilWindow('the walk window', (rows) => rows.find((row) => row.view === 'walk'), 90_000);
      await check({ action: 'resize', id: walkRow.id, width: 1600, height: 900 }, 'size the walk window');
      const walk = await untilPair(walkRow.id, 'the walk panes', (reading) => columnsOf(reading).walk.length > 0 && columnsOf(reading).walk.every((pane) => pane.gutter > 0), 30_000);
      measured['walk'] = columnsOf(walk).walk;
      // Two columns of digits with their gap and padding, and a mark of one character.
      expect(columnsOf(walk).walk.every((pane) => pane.digits > 0 && pane.numbers <= pane.digits * 2 * 7 + 22 && pane.mark <= 24 && pane.gutter <= pane.numbers + pane.mark + 1), `the walk gutter is wider than its digits need: ${JSON.stringify(columnsOf(walk).walk)}`);
      await capture(walkRow.id, 'columns-walk');
      await press(walkRow.id, '[data-ev="walk-wrap"]');
      const walkWrapped = await readPairWindow(walkRow.id);
      measured['walk wrapped'] = columnsOf(walkWrapped).walk;
      await capture(walkRow.id, 'columns-walk-wrapped');
      record('columns', measured);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    if (phase === 'again') {
      // --- After a restart: both reviews ongoing, resumed without any agent work -----------
      const list = await untilPair(diffId, 'the ongoing reviews', (reading) => diffOf(reading).phase === 'ongoing');
      const ongoing = diffOf(list).ongoing ?? [];
      record('ongoing after restart', { ongoing });
      expect(ongoing.length === 2 && ongoing.some((row) => row.startsWith('shop')) && ongoing.some((row) => row.startsWith(DAL.name)), `both reviews are not listed: ${JSON.stringify(ongoing)}`);
      expect(ongoing.every((row) => /% handled · \d+ of \d+ files? done/.test(row)), `a review is listed without its progress: ${JSON.stringify(ongoing)}`);
      await sleep(1500);
      expect((await walkWindows()).length === 0, 'a walk window opened by itself after the restart');
      await capture(diffId, 'again-ongoing');
      // The MiniDAWLab review: its file, marks and explanation, and its readings at their place.
      await press(diffId, `[data-ev="pair-ongoing-open-${String(ongoing.findIndex((row) => row.startsWith(DAL.name)))}"]`);
      const dal = await untilPair(diffId, 'the MiniDAWLab review where it was left', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).fileKey !== null && diffOf(reading).strips.length > 0, 60_000);
      record('MiniDAWLab resumed', { fileKey: diffOf(dal).fileKey, manual: diffOf(dal).strips.filter((entry) => entry.status === 'manual').length });
      expect(diffOf(dal).strips.some((entry) => entry.status === 'manual'), 'the line marked before the restart is not marked');
      // The explanation asked before the restart is in the review's discussion (30 October 2026).
      await press(diffId, '[data-ev="pair-discussion"]');
      const resumedPanel = await explainedInPanel('the explanation after the restart', 30_000);
      expect(resumedPanel.reading !== null, 'the explanation is not back after the restart');
      await check({ action: 'close', id: resumedPanel.panelId }, 'hide the discussion');
      expect(diffOf(dal).codeWalks?.enabled === true, 'Code walks is not offered for a review with readings');
      await capture(diffId, 'again-dal-resumed');
      await press(diffId, '[data-ev="pair-walks"]');
      const dalWalkRow = await untilWindow('the readings window', (rows) => rows.find((row) => row.view === 'walk'));
      const dalWalk = await untilPair(dalWalkRow.id, 'the readings', (reading) => walkOf(reading)?.position?.stepId != null, 30_000);
      record('readings resumed', { position: walkOf(dalWalk)?.position, heading: walkOf(dalWalk)?.heading });
      expect(walkOf(dalWalk)?.heading === 'Readings', `the MiniDAWLab walks are not headed Readings: ${String(walkOf(dalWalk)?.heading)}`);
      // The shop review: its file list with mixed status and the open finding, and its walk at R2.1.
      await press(diffId, '[data-ev="pair-all-reviews"]');
      const back = await untilPair(diffId, 'the ongoing reviews again', (reading) => diffOf(reading).phase === 'ongoing');
      await press(diffId, `[data-ev="pair-ongoing-open-${String((diffOf(back).ongoing ?? []).findIndex((row) => row.startsWith('shop')))}"]`);
      const shop = await untilPair(diffId, 'the shop review', (reading) => diffOf(reading).phase === 'review' && diffOf(reading).files.length > 0, 60_000);
      if (diffOf(shop).fileKey !== null) {
        await backToFiles(diffId);
      }
      const shopList = await untilPair(diffId, 'the shop file list', (reading) => diffOf(reading).listShown && diffOf(reading).fileRows.length > 0);
      const item02 = rowOf(shopList, 'data/item-02.json');
      record('shop resumed', { item02, cart: rowOf(shopList, 'src/cart.ts'), guide: rowOf(shopList, 'docs/guide.md') });
      expect(/open finding/.test(item02) && /You/.test(item02) && /Claude · opus/.test(item02), `the mixed status or the finding is gone after the restart: ${item02}`);
      await press(diffId, '[data-ev="pair-walks"]');
      const shopWalkRow = await untilWindow('Code walks to open the shop walks', (rows) => rows.find((row) => row.view === 'walk' && row.id !== dalWalkRow.id), 15_000);
      const shopWalk = await untilPair(shopWalkRow.id, 'the shop walks', (reading) => walkOf(reading)?.position?.stepId != null, 30_000);
      record('shop walks resumed', { position: walkOf(shopWalk)?.position, leftWidth: walkOf(shopWalk)?.leftWidth });
      expect(walkOf(shopWalk)?.position?.stepId === 'R2.1', `the shop walks are not back at R2.1: ${JSON.stringify(walkOf(shopWalk)?.position)}`);
      expect(Math.abs((walkOf(shopWalk)?.leftWidth ?? 0) - 420) <= 2, `the left column's width was not kept: ${String(walkOf(shopWalk)?.leftWidth)}`);
      await capture(shopWalkRow.id, 'again-shop-walks');
      // Ending the MiniDAWLab review: off the list, nothing approved.
      await press(diffId, '[data-ev="pair-all-reviews"]');
      const before = await untilPair(diffId, 'the ongoing reviews to end one', (reading) => diffOf(reading).phase === 'ongoing');
      await press(diffId, `[data-ev="pair-ongoing-end-${String((diffOf(before).ongoing ?? []).findIndex((row) => row.startsWith(DAL.name)))}"]`);
      const after = await untilPair(diffId, 'the list after ending', (reading) => diffOf(reading).phase === 'ongoing' && (diffOf(reading).ongoing ?? []).length === 1);
      record('ended', { ongoing: diffOf(after).ongoing });
      expect((diffOf(after).ongoing ?? [])[0]?.startsWith('shop') === true, 'the wrong review was ended');
      await capture(diffId, 'again-ended');
      const sent = await reviewPromptsSent();
      record('prompts', { sent: sent.length });
      expect(sent.length === 0, `resuming sent ${String(sent.length)} prompt(s) to an agent`);
      return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
    }

    // --- 1. Files changed over the whole width -----------------------------------------------
    const opened = await startReview(diffId, 'shop', null);
    record('files', { rows: diffOf(opened).fileRows.length, listShown: diffOf(opened).listShown, sidebar: diffOf(opened).sidebarShown });
    expect(diffOf(opened).listShown && !diffOf(opened).sidebarShown && diffOf(opened).fileKey === null, 'the review does not start with the full-width file list');
    expect(diffOf(opened).fileRows.length === 30, `not every changed file is listed: ${String(diffOf(opened).fileRows.length)}`);
    const longRow = rowOf(opened, 'src/features/portable-instruments/proxies/PortableInstrumentProxyRegistryConfigurationDefaults.ts');
    expect(longRow.includes('PortableInstrumentProxyRegistryConfigurationDefaults.ts') && longRow.includes('src/features/portable-instruments/proxies/'), `the long path is not readable: ${longRow}`);
    await capture(diffId, 'files-full-width');

    // --- 2. Code walks dimmed while there is none -----------------------------------------------
    const dimmed = await untilPair(diffId, 'Code walks to settle', (reading) => diffOf(reading).walkCount !== null);
    expect(diffOf(dimmed).codeWalks?.enabled === false && diffOf(dimmed).codeWalks?.tip === 'No code walks yet', `Code walks is not dimmed with its reason: ${JSON.stringify(diffOf(dimmed).codeWalks)}`);
    await pressKey(diffId, '[data-ev="pair-walks"]', 'Shift');
    await capture(diffId, 'code-walks-dimmed-focus');
    await press(diffId, '[data-ev="pair-walks"]');
    await sleep(600);
    expect((await walkWindows()).length === 0, 'a dimmed Code walks opened a window');

    // --- 3. A file and back, with the list where it was ----------------------------------------
    await check({ action: 'wheel', id: diffId, selector: '.rv-pair-filelist', deltaY: 500 }, 'scroll the file list');
    const scrolled = await readPairWindow(diffId);
    record('list scrolled', { top: diffOf(scrolled).listScrollTop });
    expect(diffOf(scrolled).listScrollTop > 0, 'the wheel did not scroll the file list');
    const cartFile = await openFile(diffId, 'src/cart.ts');
    expect(!diffOf(cartFile).sidebarShown && !diffOf(cartFile).listShown, 'the diff of a file is drawn beside a file list');
    await capture(diffId, 'file-diff-up-arrow');
    const saved = diffOf(cartFile).listScrollSaved;
    const returned = await backToFiles(diffId);
    record('back to the list', { saved, top: diffOf(returned).listScrollTop });
    expect(saved > 0 && Math.abs(diffOf(returned).listScrollTop - saved) <= 1, `the list did not come back where it was: ${String(saved)} → ${String(diffOf(returned).listScrollTop)}`);

    // --- 4. Progress and who handled it --------------------------------------------------------
    await openFile(diffId, 'src/cart.ts');
    await press(diffId, '[data-ev="pair-file-manual"]');
    await untilPair(diffId, 'cart.ts reviewed', (reading) => diffOf(reading).files.find((file) => file.path === 'src/cart.ts')?.done === true);
    await backToFiles(diffId);
    await openFile(diffId, 'docs/guide.md');
    await markLine(diffId, 'target', 3, 'manual');
    await markLine(diffId, 'base', 3, 'exempt');
    await backToFiles(diffId);
    await openFile(diffId, 'data/item-02.json');
    await press(diffId, '[data-ev="pair-delegate-file"]');
    await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
    await press(diffId, '[data-ev="pair-delegate-agent-start"]');
    const delegated = await untilPair(diffId, 'the delegated review', (reading) => diffOf(reading).jobs.some((job) => job.kind === 'review' && job.state === 'done'), 60_000);
    const problemLine = diffOf(delegated).strips.find((entry) => entry.side === 'target' && entry.status === 'none');
    if (problemLine !== undefined) {
      await markLine(diffId, 'target', problemLine.line, 'manual');
    }
    const status = await backToFiles(diffId);
    const rows = { cart: rowOf(status, 'src/cart.ts'), guide: rowOf(status, 'docs/guide.md'), item02: rowOf(status, 'data/item-02.json') };
    record('status', rows);
    expect(diffOf(status).files.find((file) => file.path === 'src/cart.ts')?.done === true, 'cart.ts is not done after Mark all reviewed');
    expect(/You: 1 · exempted: 1/.test(rows.guide) && /50%/.test(rows.guide), `the guide's mixed status is not shown: ${rows.guide}`);
    expect(diffOf(status).files.find((file) => file.path === 'data/item-02.json')?.done === true && /You: \d+ · Claude · opus: \d+/.test(rows.item02) && /1 open finding/.test(rows.item02), `a finished file with mixed review hides its finding: ${rows.item02}`);
    await capture(diffId, 'files-progress-mixed');

    // --- 5. Prepare code walks: the walk window opens once ----------------------------------------
    await press(diffId, '[data-ev="pair-prepare-walks"]');
    await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
    expect(!(visibleOf(await readPairWindow(diffId))).includes('The agent reads the two commits'), 'the long explanation is still drawn beside the picker');
    await press(diffId, '[data-ev="pair-walks-agent-start"]');
    const walkRow = await untilWindow('the walk window to open by itself', (rows) => rows.find((row) => row.view === 'walk'), 90_000);
    await sleep(2500);
    const walkCountAfter = (await walkWindows()).length;
    record('walk window opened', { windows: walkCountAfter });
    expect(walkCountAfter === 1, `the preparation opened ${String(walkCountAfter)} walk windows`);
    const afterPrep = await readPairWindow(diffId);
    expect(diffOf(afterPrep).codeWalks?.enabled === true, 'Code walks is not offered once walks exist');
    expect(!visibleOf(afterPrep).includes('Show the walks') && !visibleOf(afterPrep).includes('Open a walk file') && !visibleOf(afterPrep).includes('Prepared by'), 'the old walk list or its notes are still in the diff window');
    expect(!/job-[0-9a-f]{8}/.test(visibleOf(afterPrep)) && !visibleOf(afterPrep).includes('Details'), 'job ids or Details are in the review flow');

    // --- 6. Walks and readings in the walk window --------------------------------------------------
    const walk = await untilPair(walkRow.id, 'the walks', (reading) => (walkOf(reading)?.items.length ?? 0) > 0, 30_000);
    const view = walkOf(walk);
    record('walk window', { heading: view?.heading, items: view?.items, overview: view?.overview, attention: view?.attention, leftWidth: view?.leftWidth, tree: view?.treeOpen });
    expect(view?.heading === 'Walks and readings', `the list is not headed for walks and readings: ${String(view?.heading)}`);
    expect((view?.items ?? []).filter((item) => item.reading).map((item) => item.id).join(',') === 'R1,R2', `the guide's two changes are not two readings: ${JSON.stringify(view?.items)}`);
    expect((view?.items ?? []).every((item) => item.title !== '' && item.purpose !== '' && item.purposeHeight <= 44), 'an item lacks a short description, or its introduction is long');
    expect(view?.treeOpen === false && view.leftOverflowX === false, 'the file tree is in the way or the left column scrolls sideways');
    expect(view?.chooseOffered === false, 'the walk window still offers a file chooser');
    expect(view?.overviewMore === 'Show more' && (view?.attention ?? '').includes('in no walk'), `Show more or the points worth checking are missing: ${JSON.stringify({ more: view?.overviewMore, attention: view?.attention })}`);
    await capture(walkRow.id, 'walks-and-readings');
    await press(walkRow.id, '[data-ev="walk-overview-more"]');
    const more = walkOf(await readPairWindow(walkRow.id));
    expect(more?.overviewMore === 'Show less' && (more?.overview.length ?? 0) > (view?.overview.length ?? 0) && (more?.overview ?? '').includes('background'), `Show more showed nothing more: ${JSON.stringify(more?.overview)}`);
    await capture(walkRow.id, 'about-show-more');
    await press(walkRow.id, '[data-ev="walk-overview-more"]');
    expect(walkOf(await readPairWindow(walkRow.id))?.overviewMore === 'Show more', 'Show less did not fold the background');

    // A code walk follows the call: the button calls checkout, defined in cart.ts.
    const button = (view?.items ?? []).find((item) => item.title.includes('checkout-button.ts'));
    if (button !== undefined) {
      await check({ action: 'go-to-step', id: walkRow.id, stepId: `${button.id}.1` }, 'go to the button step');
      await press(walkRow.id, 'button.rv-nav-next');
      const called = await untilPair(walkRow.id, 'the place the call leads to', (reading) => (walkOf(reading)?.activePane?.path ?? '').endsWith('src/cart.ts'));
      record('call followed', { pane: walkOf(called)?.activePane?.path, from: visibleOf(called).includes('The call of checkout') });
      expect(visibleOf(called).includes('The call of checkout'), 'the place is not shown as reached from the call');
      await capture(walkRow.id, 'code-walk-call');
    } else {
      expect(false, 'no code walk over the button');
    }

    // --- 7. Independent navigation, shared status -------------------------------------------------
    const diffBefore = diffOf(await readPairWindow(diffId)).fileKey;
    await press(walkRow.id, '[data-ev="walk-head-R1"]');
    await check({ action: 'go-to-step', id: walkRow.id, stepId: 'R1.1' }, 'go to the first reading');
    await sleep(600);
    expect(diffOf(await readPairWindow(diffId)).fileKey === diffBefore, 'a step in the walk moved the diff window');
    const walkBefore = walkOf(await readPairWindow(walkRow.id))?.position?.stepId;
    await openFile(diffId, 'src/app/checkout-button.ts');
    await sleep(400);
    expect(walkOf(await readPairWindow(walkRow.id))?.position?.stepId === walkBefore, 'opening a file in the diff moved the walk');
    await press(walkRow.id, '.rv-tabs .rv-tab:nth-child(2)');
    const accepted = (reading: PairWindowReading | null): number => (visibleOf(reading).match(/Accepted by you/g) ?? []).length;
    const acceptedBefore = accepted(await untilPair(walkRow.id, 'the coverage tab', (reading) => visibleOf(reading).includes('Accepted by you')));
    await press(diffId, '[data-ev="pair-file-manual"]');
    const shared = await untilPair(walkRow.id, 'the walk window to show the mark made in the diff', (reading) => accepted(reading) > acceptedBefore, 15_000).catch(() => null);
    record('shared status', { before: acceptedBefore, after: accepted(shared) });
    expect(shared !== null, 'a mark made in the diff window is not shown in the walk window');
    await capture(walkRow.id, 'shared-status');
    await press(walkRow.id, '.rv-tabs .rv-tab:nth-child(1)');

    // --- 8. The left column: dragged, moved with the keys, kept -----------------------------------
    const widthBefore = walkOf(await readPairWindow(walkRow.id))?.leftWidth ?? 0;
    await check({ action: 'pointer-drag', id: walkRow.id, selector: '[data-ev="walk-nav-divider"]', dx: 120 }, 'drag the left divider');
    const dragged = walkOf(await readPairWindow(walkRow.id))?.leftWidth ?? 0;
    await pressKey(walkRow.id, '[data-ev="walk-nav-divider"]', 'Left');
    await sleep(300);
    const keyed = walkOf(await readPairWindow(walkRow.id))?.leftWidth ?? 0;
    record('left column', { before: widthBefore, dragged, keyed });
    expect(Math.abs(dragged - widthBefore - 120) <= 3 && Math.abs(keyed - dragged + 40) <= 3, `the left column did not follow the mouse and the keys: ${String(widthBefore)} → ${String(dragged)} → ${String(keyed)}`);
    await press(walkRow.id, '[data-ev="walk-files"]');
    const tree = walkOf(await readPairWindow(walkRow.id));
    expect(tree?.treeOpen === true && tree.leftOverflowX === false, 'the opened file tree makes the left column scroll sideways');
    await capture(walkRow.id, 'left-column-wider-files');
    await press(walkRow.id, '[data-ev="walk-files"]');
    await window.dspatch.reviewWindowCheck({ action: 'capture', webContentsId: walkRow.id, label: 'walk-narrow-window', width: 1000 });
    await check({ action: 'go-to-step', id: walkRow.id, stepId: 'R2.1' }, 'leave the walks at R2.1');

    // --- 9. Long Markdown lines: MiniDAWLab-spike01 at the pair of the trial ----------------------
    await press(diffId, '[data-ev="pair-all-reviews"]');
    await untilPair(diffId, 'the ongoing reviews', (reading) => diffOf(reading).phase === 'ongoing');
    await capture(diffId, 'ongoing-one');
    await press(diffId, '[data-ev="pair-new-review"]');
    const dal = await startReview(diffId, DAL.name, DAL);
    expect(diffOf(dal).files.length === 1 && diffOf(dal).files[0]?.path === DAL_FILE, `the trial's pair is not one Markdown file: ${JSON.stringify(diffOf(dal).files.map((file) => file.path))}`);
    const dalSplit = await openFile(diffId, DAL_FILE);
    const long = diffOf(dalSplit).longLines.filter((entry) => entry.side === 'target').sort((a, b) => b.length - a.length)[0];
    record('long lines', { count: diffOf(dalSplit).longLines.length, longest: long, overflow: diffOf(dalSplit).diffOverflowX, words: diffOf(dalSplit).words.length, whole: diffOf(dalSplit).wholeLines.length });
    expect(long !== undefined && long.height > 40, 'a long line does not wrap in the diff');
    expect(!diffOf(dalSplit).diffOverflowX, 'the diff scrolls sideways for long lines');
    expect(diffOf(dalSplit).words.length + diffOf(dalSplit).wholeLines.length > 0, 'the wrapped diff has no change marks');
    await capture(diffId, 'dal-split-wrapped');
    if (long !== undefined) {
      const selected = (await check({ action: 'drag', id: diffId, from: { selector: cell('target', long.line), offset: 20 }, to: { selector: cell('target', long.line), offset: 140 } }, 'select in a long line')) as { selected?: string };
      await untilPair(diffId, 'Explain this beside the selection', (reading) => diffOf(reading).explainOffered);
      record('selected in a wrapped line', { selected: (selected.selected ?? '').slice(0, 80), length: (selected.selected ?? '').length });
      expect((selected.selected ?? '').length === 120, `the selection in a wrapped line is not the 120 characters dragged over: ${String((selected.selected ?? '').length)}`);
      await press(diffId, '[data-ev="explain-this"]');
      const explained = await explainedInPanel('the explanation');
      await capture(explained.panelId, 'dal-explained-wrapped');
      await markLine(diffId, 'target', long.line, 'manual');
      await capture(diffId, 'dal-line-marked');
    }
    await press(diffId, '[data-ev="pair-layout-unified"]');
    await untilPair(diffId, 'unified', (reading) => diffOf(reading).layout === 'unified');
    expect(!diffOf(await readPairWindow(diffId)).diffOverflowX, 'the unified diff scrolls sideways for long lines');
    await capture(diffId, 'dal-unified-wrapped');
    await press(diffId, '[data-ev="pair-layout-split"]');

    // Readings for a documentation change, with the long lines wrapped in the walk window.
    await press(diffId, '[data-ev="pair-prepare-walks"]');
    await untilPair(diffId, 'the agent picker', (reading) => (reading.text ?? '').includes('Model'), 15_000);
    await press(diffId, '[data-ev="pair-walks-agent-start"]');
    const dalWalkRow = await untilWindow('the readings window', (rows) => rows.find((row) => row.view === 'walk' && row.id !== walkRow.id), 90_000);
    const readings = await untilPair(dalWalkRow.id, 'the readings with a pane', (reading) => walkOf(reading)?.activePane != null && (walkOf(reading)?.activePane?.focusRows.length ?? 0) > 0, 30_000);
    const pane = walkOf(readings)?.activePane;
    record('readings', { heading: walkOf(readings)?.heading, items: walkOf(readings)?.items.map((item) => `${item.id}:${item.title}`), pane });
    expect(walkOf(readings)?.heading === 'Readings' && (walkOf(readings)?.items ?? []).every((item) => item.reading), 'a documentation change did not get readings');
    expect(pane?.wrap === '1' && pane.scrollLeft === 0 && pane.scrollWidth <= pane.clientWidth + 2, `the Markdown pane does not wrap by default: ${JSON.stringify(pane)}`);
    expect(walkOf(readings)?.wrapChecked === true, 'Wrap lines does not show as on for Markdown');
    await capture(dalWalkRow.id, 'dal-reading-wrapped');
    // Through the readings to a place with a long line: wrapped rows keep their own numbers.
    let tall = pane?.focusRows.find((row) => row.height > 19) ?? null;
    for (let step = 0; step < 12 && tall === null; step += 1) {
      await press(dalWalkRow.id, 'button.rv-nav-next');
      tall = walkOf(await readPairWindow(dalWalkRow.id))?.activePane?.focusRows.find((row) => row.height > 19) ?? null;
    }
    record('wrapped row', { tall });
    expect(tall !== null && tall.numbers.includes(tall.line), `no wrapped row with its own line number: ${JSON.stringify(tall)}`);
    await capture(dalWalkRow.id, 'dal-reading-long-line');
    await press(dalWalkRow.id, '[data-ev="walk-wrap"]');
    const unwrapped = walkOf(await readPairWindow(dalWalkRow.id))?.activePane;
    expect(unwrapped?.wrap === '0' && unwrapped.scrollWidth > unwrapped.clientWidth, `Wrap lines off did not unwrap: ${JSON.stringify(unwrapped)}`);
    await capture(dalWalkRow.id, 'dal-reading-unwrapped');
    await press(dalWalkRow.id, '[data-ev="walk-wrap"]');
    expect(walkOf(await readPairWindow(dalWalkRow.id))?.activePane?.wrap === '1', 'Wrap lines did not come back on');

    // One walk window per review: Code walks of the shop review brings its own window forward.
    await press(diffId, '[data-ev="pair-all-reviews"]');
    const both = await untilPair(diffId, 'two ongoing reviews', (reading) => diffOf(reading).phase === 'ongoing' && (diffOf(reading).ongoing ?? []).length === 2);
    await press(diffId, `[data-ev="pair-ongoing-open-${String((diffOf(both).ongoing ?? []).findIndex((row) => row.startsWith('shop')))}"]`);
    await untilPair(diffId, 'the shop review', (reading) => diffOf(reading).phase === 'review', 30_000);
    await press(diffId, '[data-ev="pair-walks"]');
    await sleep(800);
    const windowsNow = await walkWindows();
    record('one walk window per review', { windows: windowsNow.map((row) => row.title) });
    expect(windowsNow.length === 2, `Code walks made another walk window: ${String(windowsNow.length)}`);
    const sent = await reviewPromptsSent();
    record('prompts', { preparations: sent.filter((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: prepare-walks')).length, all: sent.length });
    expect(sent.filter((prompt) => prompt.startsWith('DSPATCH-REVIEW-TASK: prepare-walks')).length === 2, 'a preparation was sent more or fewer times than pressed');
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = { windows: rows, readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))) };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}

/**
 * The diff's change marks (DSP-150 follow-up, Gerrit v3.14.4 behaviour) in the real window,
 * over `tests/support/marks-fixture.ts`. Each file is drawn side by side and unified; both
 * layouts must mark the same characters and the same whole lines, and the marks must not
 * move when the window's code column narrows. A selection over marked code is explained
 * (SIMULATED provider) and a line is marked as reviewed, to show the marks with the
 * selection, the explanation's highlight and the review strip.
 */
async function runDiffMarksScenario(plan: ScriptedRunPlan): Promise<ScriptedRunReport> {
  const steps: unknown[] = [];
  const failures: string[] = [];
  const observations: Record<string, unknown> = {
    plan,
    limits:
      'The marks are computed by the product from the commits in an isolated repository; no Gerrit was run, and no ' +
      'model was asked for them. The one explanation is the SIMULATED provider (presentation adapter).',
  };
  const startedAt = performance.now();
  const record = (name: string, detail: Record<string, unknown>): void => {
    steps.push({ step: name, atMs: Math.round(performance.now() - startedAt), ...detail });
  };
  const expect = (ok: boolean, message: string): void => {
    if (!ok) {
      failures.push(message);
    }
  };
  const MAIN = 0;
  const check = async (request: PairWindowCheckRequest, what: string): Promise<unknown> => {
    const answer = await window.dspatch.pairWindowCheck(request);
    if (!answer.ok) {
      throw new Error(`could not ${what}: ${JSON.stringify(answer.detail)}`);
    }
    await sleep(250);
    return answer.detail;
  };
  const press = (id: number, selector: string): Promise<unknown> => check({ action: 'press', id, selector }, `press ${selector}`);
  const capture = async (id: number, label: string): Promise<void> => {
    await sleep(300);
    await window.dspatch.pairWindowCheck({ action: 'capture', id, label });
  };
  type Diff = {
    readonly words: readonly { readonly side: string; readonly line: number; readonly text: string }[];
    readonly wholeLines: readonly string[];
    readonly strips: readonly { readonly side: string; readonly line: number; readonly status: string }[];
    readonly explanations: readonly { readonly state: string; readonly selection: unknown }[];
    readonly highlighted: number;
    readonly textSelection: string;
    readonly explainOffered: boolean;
    readonly explainPanel: { readonly open: boolean } | null;
    readonly layout: string;
  };
  const diffOf = (reading: PairWindowReading | null): Diff => (reading?.pair ?? {}) as unknown as Diff;
  // The marks of the file shown, independent of the order a layout draws them in.
  const marksKey = (reading: PairWindowReading | null): string => {
    const words = new Map<string, string[]>();
    for (const word of diffOf(reading).words) {
      const key = `${word.side}:${String(word.line)}`;
      words.set(key, [...(words.get(key) ?? []), word.text]);
    }
    return JSON.stringify({
      words: [...words.entries()].sort(([a], [b]) => a.localeCompare(b)),
      whole: [...new Set(diffOf(reading).wholeLines)].sort(),
    });
  };
  const wordsOn = (reading: PairWindowReading | null, side: string, line: number): string[] =>
    diffOf(reading).words.filter((word) => word.side === side && word.line === line).map((word) => word.text);
  const wholeOf = (reading: PairWindowReading | null): string => JSON.stringify([...new Set(diffOf(reading).wholeLines)].sort());
  const stripsKey = (reading: PairWindowReading | null): string =>
    JSON.stringify([...new Set(diffOf(reading).strips.map((strip) => `${strip.side}:${String(strip.line)}:${strip.status}`))].sort());
  const cell = (side: 'base' | 'target', line: number): string => `.rv-pair-diff td[data-code-side="${side}"][data-code-line="${String(line)}"]`;

  const openReview = async (): Promise<number> => {
    await press(MAIN, '[data-ev="open-review"]');
    const diffId = (await untilWindow('a diff window', (rows) => rows.find((row) => row.view === 'diff'))).id;
    await pastOngoing(diffId);
    const first = await untilPair(diffId, 'the repository list or the log', (reading) => reading.pair?.phase === 'repositories' || reading.pair?.phase === 'log' || reading.pair?.phase === 'review');
    if (first.pair?.phase === 'repositories') {
      await press(diffId, '[data-ev="pair-repo-0"]');
    }
    if (first.pair?.phase !== 'review') {
      await untilPair(diffId, 'the log', (reading) => (reading.pair?.commits ?? 0) === 2);
      await press(diffId, '[data-ev="pair-commit-1"]');
      await press(diffId, '[data-ev="pair-commit-0"]');
      await press(diffId, '[data-ev="pair-open"]');
    }
    await untilPair(diffId, 'the diff review', (reading) => reading.pair?.phase === 'review' && (reading.pair.files?.length ?? 0) > 0);
    return diffId;
  };
  const show = async (diffId: number, path: string, layout: 'split' | 'unified'): Promise<PairWindowReading> => {
    const list = await readPairWindow(diffId);
    const index = (list?.pair?.files ?? []).findIndex((file) => file.path === path);
    if (index < 0) {
      throw new Error(`${path} is not in the change`);
    }
    if ((list?.pair?.fileKey ?? null) !== null) {
      // Back to the list of files, where each is offered by its place.
      await press(diffId, '[data-ev="pair-files"]');
      await untilPair(diffId, 'the list of files', (reading) => (reading.pair?.fileKey ?? null) === null);
    }
    await press(diffId, `[data-ev="pair-file-${String(index)}"]`);
    await press(diffId, `[data-ev="pair-layout-${layout}"]`);
    await sleep(400);
    return untilPair(diffId, `${path} ${layout}`, (reading) => diffOf(reading).layout === layout && diffOf(reading).words.length + diffOf(reading).wholeLines.length > 0);
  };
  const shotName = (path: string, layout: string): string => `${path.replace(/[/.]/g, '-')}-${layout}`;

  try {
    await waitFor('the connection to reach a decided state', connectionDecided, 60_000);
    await waitFor('a project to be offered in the window', () => element('project-0-path') !== null, 60_000);
    await press(MAIN, '[data-ev="open-project-0"]');
    await waitFor('a session in the window', () => textOf('session-id') !== '' && element('prompt') !== null, 60_000);
    const diffId = await openReview();

    // 1. Each file in both layouts: the same marks from the same change.
    const byFile: Record<string, PairWindowReading> = {};
    for (const path of ['src/checkout.ts', 'src/datasets.py', 'docs/notes.md']) {
      const split = await show(diffId, path, 'split');
      await capture(diffId, shotName(path, 'split'));
      const unified = await show(diffId, path, 'unified');
      await capture(diffId, shotName(path, 'unified'));
      record(path, { split: JSON.parse(marksKey(split)) as unknown, unified: JSON.parse(marksKey(unified)) as unknown });
      expect(marksKey(split) === marksKey(unified), `${path}: the layouts mark different characters or lines`);
      byFile[path] = split;
    }
    const checkout = byFile['src/checkout.ts'] ?? null;
    const datasets = byFile['src/datasets.py'] ?? null;
    const notes = byFile['docs/notes.md'] ?? null;
    // A one-character change: that character, on one side.
    expect(JSON.stringify(wordsOn(checkout, 'target', 1)) === '["0"]' && wordsOn(checkout, 'base', 1).length === 0, `3 → 30 is not marked as the added 0: ${JSON.stringify(wordsOn(checkout, 'target', 1))}`);
    // Three removed lines replaced by one: compared as one block, what did not survive is strong.
    expect(
      wordsOn(checkout, 'base', 4).length > 0 && wordsOn(checkout, 'base', 5).length > 0 && wordsOn(checkout, 'base', 6).length > 0 && wordsOn(checkout, 'target', 4).length > 0,
      'the three removed lines are not compared with the line that replaced them',
    );
    // A rewritten line is marked, not left to its line colour.
    expect(wordsOn(checkout, 'target', 8).join('') === '`${value.toFixed(2)} in total`', `the rewritten line is not marked: ${JSON.stringify(wordsOn(checkout, 'target', 8))}`);
    // Indentation only: the removed spaces are marked.
    expect(JSON.stringify(wordsOn(checkout, 'base', 14)) === '["  "]', `the removed indentation is not marked: ${JSON.stringify(wordsOn(checkout, 'base', 14))}`);
    // Nothing on the other side: strong throughout.
    expect(wholeOf(checkout) === '["base:16","base:17","base:18"]', `the removed function is not strong throughout: ${wholeOf(checkout)}`);
    const addedLines = [...Array.from({ length: 11 }, (_, index) => `target:${String(17 + index)}`), 'target:32'].sort();
    expect(wholeOf(datasets) === JSON.stringify(addedLines), `the added lines are not strong throughout: ${wholeOf(datasets)}`);
    expect(JSON.stringify(wordsOn(datasets, 'target', 3)) === '["Any, Dict, "]' && wordsOn(datasets, 'base', 1).length === 0, `the kept import is not marked as Gerrit marks it: ${JSON.stringify(wordsOn(datasets, 'target', 3))}`);
    expect(wordsOn(notes, 'target', 3).some((word) => word.includes('chosen')) && wordsOn(notes, 'target', 3).includes('delegate'), `the words changed in the long line are not marked: ${JSON.stringify(wordsOn(notes, 'target', 3))}`);

    // 2. Select marked code, explain it, and narrow the code column with the panel.
    const wide = await show(diffId, 'src/checkout.ts', 'split');
    const stripsBefore = stripsKey(wide);
    const drag = (await check(
      { action: 'drag', id: diffId, from: { selector: cell('target', 4), offset: 9 }, to: { selector: cell('target', 4), offset: 29 } },
      'select text with the mouse',
    )) as { selected?: string };
    const offered = await untilPair(diffId, 'Explain this beside the selection', (entry) => diffOf(entry).explainOffered);
    expect(drag.selected === 'sorted(load(amount))' && diffOf(offered).textSelection === 'sorted(load(amount))', `the mouse did not select sorted(load(amount)): "${drag.selected ?? ''}"`);
    await capture(diffId, 'selected-over-marks');
    await press(diffId, '[data-ev="explain-this"]');
    const answered = await explainedInPanel('the explanation');
    const explained = await readPairWindow(diffId);
    if (explained === null) {
      throw new Error('the diff window is gone');
    }
    record('explained', { panel: answered.panelId });
    expect(marksKey(explained) === marksKey(wide), 'the marks changed when the code was explained');
    expect(stripsKey(explained) === stripsBefore, 'explaining changed a review mark');
    await capture(answered.panelId, 'explained-over-marks');
    const notesNarrow = await show(diffId, 'docs/notes.md', 'split');
    expect(marksKey(notesNarrow) === marksKey(notes), 'the long line is marked differently after an explanation');
    await capture(diffId, 'notes-narrow');

    // 3. A line selected and marked as reviewed: the strip beside the marks.
    await show(diffId, 'src/checkout.ts', 'split');
    await check({ action: 'press-key', id: diffId, selector: '.rv-pair-diff td.rv-pair-strip[data-side="target"][data-line="1"]', key: 'Enter' }, 'select line 1 for review');
    await capture(diffId, 'line-selected');
    await press(diffId, '[data-ev="pair-mark-manual"]');
    const marked = await untilPair(diffId, 'the line marked as reviewed', (entry) => diffOf(entry).strips.some((strip) => strip.side === 'target' && strip.line === 1 && strip.status === 'manual'));
    expect(marksKey(marked) === marksKey(wide), 'marking a line changed the change marks');
    await capture(diffId, 'line-marked');
    const unifiedMarked = await show(diffId, 'src/checkout.ts', 'unified');
    expect(marksKey(unifiedMarked) === marksKey(wide), 'unified marks differ after a review mark');
    await capture(diffId, 'line-marked-unified');
    return finish(failures.length === 0 ? CHAT_EXIT.ok : CHAT_EXIT.scriptFailed, steps, failures, observations);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    const rows = await pairWindows().catch(() => []);
    observations['atFailure'] = { windows: rows, readings: await Promise.all(rows.map((row) => readPairWindow(row.id).catch(() => null))) };
    return finish(CHAT_EXIT.scriptFailed, steps, failures, observations);
  }
}
