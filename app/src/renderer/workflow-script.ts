import type { ScriptedRunPlan, ScriptedRunReport } from '../shared/bridge';
import {
  checkAnswerGrewWhileStreaming,
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
  type MarkdownObservation,
  type PlainErrorObservation,
  type ScrollObservation,
  type WindowShapeObservation,
  type StandingSentences,
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
        standingIsBehindADisclosure: element('loop-turn-0-standing-detail') !== null,
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

  const readStanding = (): {
    readonly standing: string;
    readonly activityKnownAttribute: string;
    readonly sentences: StandingSentences;
  } => {
    const standing = attributeOf('run-standing', 'data-standing');
    if (standing !== '' && !standingsSeen.includes(standing)) {
      standingsSeen.push(standing);
    }
    return {
      standing,
      activityKnownAttribute: attributeOf('run-standing', 'data-activity-known'),
      sentences: {
        whoIsWorking: textOf('standing-who'),
        onWhat: textOf('standing-what'),
        waitingFor: textOf('standing-waiting'),
        whatHappensNext: textOf('standing-next'),
      },
    };
  };

  /** Wait for the run on screen to be walking a named step, and say which. */
  const waitForNamedStep = async (label: string): Promise<string> => {
    await waitFor(
      `the window to name the step ${label} is on`,
      () => {
        readStanding();
        return (
          attributeOf('run-standing', 'data-standing') === 'active' &&
          quotedName(textOf('standing-who')) !== ''
        );
      },
      LOOP_STEP_TIMEOUT_MS,
      200,
    );
    return quotedName(textOf('standing-who'));
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
    const secondStep = quotedName(textOf('standing-who'));
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
        return attributeOf('run-standing', 'data-standing') === 'stopped';
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
    let whileStopping: StandingSentences = standingBeforeCancel.sentences;
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
          sentences: sample.sentences,
        });
      }
      if (!sawStopRequested && (sample.standing === 'stop-requested' || sample.standing === 'unknown')) {
        sawStopRequested = true;
        whileStopping = sample.sentences;
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
      whileStopping,
      afterTheEnd: standingAfterTheEnd.sentences,
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
