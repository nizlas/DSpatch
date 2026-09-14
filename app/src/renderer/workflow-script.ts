import type { ScriptedRunPlan, ScriptedRunReport } from '../shared/bridge';
import {
  checkAnswerGrewWhileStreaming,
  checkConnectionNamesAnAccount,
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

function rawTextOf(name: string): string {
  return element(name)?.textContent ?? '';
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
  await click('send');

  await waitFor(
    `turn ${label} to start streaming`,
    () => element('active-answer') !== null || element(`turn-${String(index)}-status`) !== null,
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
    await sleep(80);
  }

  const finalStatusText = textOf(`turn-${String(index)}-status`);
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
