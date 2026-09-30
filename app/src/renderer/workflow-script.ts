import type { ScriptedRunPlan, ScriptedRunReport } from '../shared/bridge';
import type { WorkspaceView } from '../shared/workspace-folders';
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

export async function runScriptedWorkflow(
  plan: ScriptedRunPlan,
): Promise<ScriptedRunReport> {
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
    await waitFor(
      'the connection to reach a decided state',
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
      60_000,
    );

    await click('new-session');
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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

    // --- What the window says these folders are, and what it keeps behind a click ---
    // Read closed first: "the detail is one gesture away" is only true if the gesture is
    // needed, so the disclosure's own state is part of the observation rather than
    // something the trial opens on its way past.
    const detailClosedAtFirst = !detailsOpen('workspace-roots');
    const headlineOnScreen = textOf('workspace-roots-note');
    clickInside('workspace-roots-note');
    await sleep(200);
    const detailOpensOnClick = detailsOpen('workspace-roots');
    const detailOnScreen = textOf('workspace-roots-detail');
    // Closed again, so the window is left in the state a person meets — which is also
    // the state the screenshot should show, since drawing the paragraph unasked is the
    // thing this shape was applied to fix. It closing again is worth recording too: a
    // disclosure that only opens is a paragraph with an extra click in front of it.
    clickInside('workspace-roots-note');
    await sleep(200);
    const detailClosesAgain = !detailsOpen('workspace-roots');
    observations['rootsNote'] = {
      fromMain: view.rootsNote,
      onScreen: { headline: headlineOnScreen, detail: detailOnScreen },
      detailClosedAtFirst,
      detailOpensOnClick,
      detailClosesAgain,
    };
    record('roots-note', {
      headlineChars: headlineOnScreen.length,
      detailChars: detailOnScreen.length,
      detailClosedAtFirst,
      detailOpensOnClick,
      detailClosesAgain,
    });
    if (!detailClosesAgain) {
      failures.push('the folder note\u2019s detail could be opened and not closed again.');
    }

    // --- Send, with DSpatch's own folder among the roots ------------------------
    // Refused before any adapter exists, so this costs nothing. It is also the only
    // step here that can show the window's folders becoming the run's roots: the
    // working copy is an ordinary sample project, so a refusal naming DSpatch can only
    // come from the folder that was added.
    const ownRepository = plan.ownRepositoryPath ?? '';
    let refusal = '';
    if (ownRepository === '') {
      failures.push('DSpatch\u2019s own folder was not supplied, so the guard was not tried.');
    } else {
      await window.dspatch.addFolderToWorkspace(ownRepository);
      const outcome = await window.dspatch.startChatLoopRun({
        runId: `roots-refusal-${newNonce()}`,
        mandate: 'This run must be refused before anything is started.',
        definitionKey: outsideKey,
      });
      refusal =
        outcome.kind === 'refused'
          ? outcome.reason
          : outcome.kind === 'failed'
            ? `(failed rather than refused) ${outcome.note}`
            : '(the run was accepted, which is the defect)';
      observations['refusalWithOwnRepository'] = { outcomeKind: outcome.kind, reason: refusal };
      record('own-repository-refused', { outcomeKind: outcome.kind });
      if (outcome.kind !== 'refused') {
        failures.push(
          'a run with DSpatch\u2019s own working copy among its roots was not refused. ' +
            `The outcome was "${outcome.kind}".`,
        );
      }
      // Put the workspace back, so the window is left as the trial found it.
      await window.dspatch.removeFolderFromWorkspace(ownRepository);
    }

    const verdict = checkWorkingRootsReadHonestly({
      rootsGiven,
      workingRoot: workingFolder,
      noteFromMain: view.rootsNote ?? { headline: '', detail: '' },
      noteOnScreen: { headline: headlineOnScreen, detail: detailOnScreen },
      detailClosedAtFirst,
      detailOpensOnClick,
      definitionChosen: outsideKey,
      graphMarkerOnScreen: String(onScreen['graphTextMarker'] ?? ''),
      graphMarkerExpected: plan.rootsGraphMarker ?? '',
      refusalForOwnRepository: refusalAsRead(refusal),
      ownRepository,
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
      note: textOf('workspace-roots-note'),
      rows: drawnTreeRows(),
    };
    return finish(CHAT_EXIT.workingRootsReadWrong, steps, failures, observations);
  }
}

/**
 * The refusal as the gate reads it.
 *
 * Anything that was not a refusal becomes the empty string, which the gate reports as
 * "not refused". The parenthesised forms above are for the observations, where knowing
 * *how* it failed to refuse is worth keeping.
 */
function refusalAsRead(refusal: string): string {
  return refusal.startsWith('(') ? '' : refusal;
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

  /** How many earlier messages the window says it read back, and from where. */
  const historyInWindow = (): {
    readonly mark: string;
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
      mark: textOf('history-mark'),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
      60_000,
    );

    // --- The project, and whatever it already has --------------------------
    const firstConversation = await openTheProject();
    const atOpen = historyInWindow();
    record('opened', {
      conversationShownInWindow: firstConversation,
      projectShownInWindow: textOf('project-path'),
      historyTurnsShownInWindow: atOpen.turns,
      historyMarkShownInWindow: atOpen.mark,
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
      if (atOpen.mark === '') {
        failures.push(
          'earlier messages were drawn with nothing saying where they came from, so the ' +
            'window shows restored text without saying it is history read from a file.',
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
      continuityShownInWindow: textOf('session-continuity'),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
      60_000,
    );

    // The chrome, before anything has been sent. Measured here because "the card
    // is gone" is a statement about the window at rest.
    const bar = element('workspace-header');
    const chromeHeightAtRest = bar?.getBoundingClientRect().height ?? 0;
    record('chrome-at-rest', { chromeHeightPx: Math.round(chromeHeightAtRest) });

    await click('new-session');
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
    await window.dspatch.pressMenuItem('change-project');
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
    await click('new-session');
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
      () => ['connected', 'not-connected', 'error'].includes(textOf('connection-kind')),
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
    await click('new-session');
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
