import fs from 'node:fs';
import path from 'node:path';

import { Cursor } from '@cursor/sdk';

import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import type { AgentEvent, SessionHandle, UsageReading } from '../adapter/types';

/**
 * Scripted connection probe for DSP-1 substep 4, in the same spirit as
 * `DSPATCH_SMOKE`: it reports what it actually observed and exits with a code, so
 * the evidence is reproducible rather than narrated.
 *
 * It runs in the **main process** while a renderer window is alive, and makes
 * real, billed provider calls: one session, two turns, tiny prompts.
 *
 * Two claims need more than a happy-path log, and the probe is built around them:
 *
 *  - **Streaming.** One final blob proves nothing. The probe stamps every text
 *    chunk with its arrival time relative to `send`, and fails unless at least
 *    two chunks arrived at distinct times.
 *  - **Same session.** Reusing a session ID proves only that an ID was reused.
 *    Turn one plants a random nonce; turn two asks for it back. The probe fails
 *    unless the second answer contains it.
 */

/** Exit codes. Distinct causes get distinct codes; 0–4 belong to the smoke test. */
export const PROBE_EXIT = {
  ok: 0,
  misconfigured: 10,
  notAuthenticated: 11,
  startSessionFailed: 12,
  firstTurnFailed: 13,
  streamingNotDemonstrated: 14,
  secondTurnFailed: 15,
  continuityNotProven: 16,
  usageReadFailed: 17,
  timedOut: 18,
  unexpectedError: 19,
} as const;

const DEFAULT_MODEL = 'claude-haiku-4-5';
const TURN_TIMEOUT_MS = 120_000;
/** Cursor documents cost as eventually consistent, so read usage twice. */
const USAGE_SECOND_READ_DELAY_MS = 20_000;

interface ChunkRecord {
  readonly index: number;
  /** Milliseconds after the `send` call, at one decimal place. */
  readonly atMsAfterSend: number;
  readonly length: number;
  readonly text: string;
}

interface TurnRecord {
  readonly label: string;
  readonly promptChars: number;
  /** Learned from the first `run.started` event, not from `send`'s return. */
  dspatchRunId: string;
  readonly chunks: ChunkRecord[];
  chunkCount: number;
  firstChunkMsAfterSend: number | null;
  lastChunkMsAfterSend: number | null;
  sendResolvedMsAfterSend: number | null;
  finishedMsAfterSend: number | null;
  terminalStatus: string | null;
  errorMessage: string | null;
  providerCode: string | null;
  answer: string;
  finalAssistantMessage: string | null;
  eventTypeCounts: Record<string, number>;
  /**
   * Usage seen on the provider's message stream during this turn, kept verbatim.
   *
   * This is a separate source from `agent.getUsage()` and it matters: the
   * account-level usage API can refuse while the stream still reports tokens.
   */
  readonly usageEvents: Array<{
    atMsAfterSend: number;
    readings: readonly UsageReading[];
    providerEventVerbatim: unknown;
  }>;
}

function log(message: string): void {
  process.stdout.write(`[dspatch:probe] ${message}\n`);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Redact known-sensitive field names before the record is saved.
 *
 * Step 1 found that the SDK's local agent store writes `blobEncryptionKey` in
 * clear text. The probe never reads that store's contents, but a saved log must
 * not be one provider change away from carrying a key, so the scrub runs anyway.
 *
 * This is an **exact field-name denylist on purpose.** A substring match on
 * "key" or "token" would also hide `apiKeyExpiresAtMs` and `totalTokens`, and a
 * value-shape heuristic would hide the session and agent IDs, which are the
 * evidence. Redacting the wrong things is not extra safety; it destroys the
 * record while feeling safe.
 */
const REDACT_KEY =
  /^(?:blobEncryptionKey|apiKey|api_key|apikey|accessToken|access_token|refreshToken|refresh_token|idToken|id_token|authorization|auth_token|password|passwd|secret|clientSecret|client_secret|token|bearer|credentials|cookie|sessionToken|session_token|privateKey|private_key)$/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 12) {
    return '[omitted: nesting deeper than 12]';
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrub(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACT_KEY.test(key) ? '[redacted]' : scrub(item, depth + 1);
    }
    return out;
  }
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new ProbeFailure(
      PROBE_EXIT.misconfigured,
      `${name} is not set. The probe needs an explicit value; it guesses nothing.`,
    );
  }
  return value;
}

class ProbeFailure extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = 'ProbeFailure';
    this.code = code;
  }
}

/**
 * The agent's workspace must be a dedicated empty scratch directory outside this
 * repository.
 *
 * Step 1 established that the agent runs unsandboxed by default on this machine
 * and that Cursor's Windows sandbox lives inside WSL2. Containment therefore has
 * to come from the workspace, and it has to be checked in code: prose in a report
 * does not constrain a model.
 */
function resolveWorkspace(repoRoot: string): string {
  const workspace = path.resolve(requireEnv('DSPATCH_PROBE_WORKSPACE'));
  const fromRepo = path.relative(repoRoot, workspace);
  const insideRepo =
    fromRepo === '' ||
    (!fromRepo.startsWith('..') && !path.isAbsolute(fromRepo));
  if (insideRepo) {
    throw new ProbeFailure(
      PROBE_EXIT.misconfigured,
      `Refusing to run: the workspace ${workspace} is inside the DSpatch ` +
        `repository ${repoRoot}. Use a dedicated scratch directory.`,
    );
  }
  let entries: string[];
  try {
    entries = fs.readdirSync(workspace);
  } catch (error) {
    throw new ProbeFailure(
      PROBE_EXIT.misconfigured,
      `Workspace ${workspace} is not a readable directory: ${String(error)}`,
    );
  }
  if (entries.length > 0) {
    throw new ProbeFailure(
      PROBE_EXIT.misconfigured,
      `Workspace ${workspace} is not empty (${String(entries.length)} entries). ` +
        'The probe only uses a directory it can be sure it owns.',
    );
  }
  return workspace;
}

function newNonce(): string {
  // Deliberately not a UUID: the agent has to reproduce it exactly, and a short
  // uppercase group is easy to compare and hard to produce by accident.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let nonce = '';
  for (let index = 0; index < 10; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'X';
  }
  return nonce;
}

export interface ProbeOutcome {
  readonly exitCode: number;
  readonly record: Record<string, unknown>;
}

export async function runCursorProbe(repoRoot: string): Promise<ProbeOutcome> {
  const record: Record<string, unknown> = {
    probe: 'DSP-1 substep 4 — real connection and streaming',
    startedAtUtc: new Date().toISOString(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
  };
  const adapter = new CursorSdkAdapter({ toolPolicy: 'text-only' });
  let exitCode: number = PROBE_EXIT.unexpectedError;

  try {
    exitCode = await runProbeBody(adapter, repoRoot, record);
  } catch (error) {
    if (error instanceof ProbeFailure) {
      exitCode = error.code;
      record['failure'] = { code: error.code, message: error.message };
      log(`FAIL (${String(error.code)}): ${error.message}`);
    } else {
      exitCode = PROBE_EXIT.unexpectedError;
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      record['failure'] = { code: exitCode, message };
      log(`FAIL (${String(exitCode)}): unexpected error: ${message}`);
    }
  } finally {
    await adapter.dispose();
    log('adapter disposed');
    record['exitCode'] = exitCode;
    record['finishedAtUtc'] = new Date().toISOString();
    writeRecord(record);
  }

  return { exitCode, record: record };
}

function writeRecord(record: Record<string, unknown>): void {
  const target = process.env['DSPATCH_PROBE_LOG'];
  if (target === undefined || target.trim() === '') {
    return;
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(scrub(record), null, 2)}\n`, 'utf8');
    log(`record written: ${target}`);
  } catch (error) {
    log(`could not write record to ${target}: ${String(error)}`);
  }
}

async function runProbeBody(
  adapter: CursorSdkAdapter,
  repoRoot: string,
  record: Record<string, unknown>,
): Promise<number> {
  // --- 1. Authentication, without ever touching the credential itself. -------
  // `Cursor.auth.status()` is documented never to return the key. The probe does
  // not read, copy or hash the credential store, and passes no apiKey anywhere.
  const authStatus = await Cursor.auth.status();
  record['auth'] = {
    status: authStatus.status,
    backendUrl: authStatus.status === 'logged-in' ? authStatus.backendUrl : null,
    // The account address is an identifier the repository's secrets check looks
    // for. Presence is the fact that matters here.
    emailPresent:
      authStatus.status === 'logged-in' && authStatus.email !== undefined,
    apiKeyExpiresAtMs:
      authStatus.status === 'logged-in'
        ? authStatus.apiKeyExpiresAtMs ?? null
        : null,
    apiKeyExpiresAtUtc:
      authStatus.status === 'logged-in' && authStatus.apiKeyExpiresAtMs !== undefined
        ? new Date(authStatus.apiKeyExpiresAtMs).toISOString()
        : null,
    cursorApiKeyEnvSet: Object.prototype.hasOwnProperty.call(
      process.env,
      'CURSOR_API_KEY',
    ),
    credentialSource:
      "SDK's own store; the adapter passes no apiKey and sets no environment variable",
  };
  if (authStatus.status !== 'logged-in') {
    throw new ProbeFailure(
      PROBE_EXIT.notAuthenticated,
      'Cursor reports no stored login. The probe does not log in: that needs Niclas.',
    );
  }
  log(
    `auth: logged-in backend=${authStatus.backendUrl} ` +
      `CURSOR_API_KEY set=${String(Object.prototype.hasOwnProperty.call(process.env, 'CURSOR_API_KEY'))}`,
  );

  // --- 2. Containment: a dedicated empty scratch workspace outside the repo. --
  const workspacePath = resolveWorkspace(repoRoot);
  const localStateRoot = CursorSdkAdapter.localStateRootFor(workspacePath);
  const stateRootFromRepo = path.relative(repoRoot, localStateRoot);
  record['containment'] = {
    workspacePath,
    workspaceWasEmpty: true,
    repoRoot,
    localStateRoot,
    localStateRootInsideRepo:
      !stateRootFromRepo.startsWith('..') && !path.isAbsolute(stateRootFromRepo),
    toolPolicy: 'text-only (tools: [] — the model can only answer with text)',
  };
  log(`workspace: ${workspacePath}`);
  log(`local agent state root: ${localStateRoot}`);

  // --- 3. Model selection, named explicitly. --------------------------------
  const modelRequested = process.env['DSPATCH_PROBE_MODEL'] ?? DEFAULT_MODEL;
  const models = await adapter.listModels();
  const modelAvailable = models.some((model) => model.id === modelRequested);
  record['models'] = {
    count: models.length,
    modelRequested,
    modelAvailable,
  };
  log(`models: ${String(models.length)} available, requested=${modelRequested}`);
  if (!modelAvailable) {
    throw new ProbeFailure(
      PROBE_EXIT.misconfigured,
      `Model "${modelRequested}" is not in the account's list of ` +
        `${String(models.length)} models. Naming a model that is not there would ` +
        'make the record unreproducible.',
    );
  }

  // --- 4. One session. ------------------------------------------------------
  let handle: SessionHandle;
  try {
    handle = await adapter.startSession({
      provider: 'cursor',
      modelRequested,
      workspacePath,
    });
  } catch (error) {
    throw new ProbeFailure(
      PROBE_EXIT.startSessionFailed,
      `startSession failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  record['session'] = {
    dspatchSessionId: handle.dspatchSessionId,
    providerSessionId: handle.providerSessionId,
    provider: handle.provider,
    createdAt: handle.createdAt,
    note:
      "providerSessionId is Cursor's agent ID, derived from the DSpatch session " +
      "ID. Cursor requires the format 'agent-<uuid>' for local agents.",
  };
  record['capabilities'] = adapter.capabilities();
  log(
    `session started dspatchSessionId=${handle.dspatchSessionId} ` +
      `providerSessionId=${handle.providerSessionId}`,
  );

  // --- 5. Subscribe before the first send. ----------------------------------
  const turns: TurnRecord[] = [];
  let current: TurnRecord | null = null;
  let sendStartedAt = 0;
  let resolveTurn: ((value: void) => void) | null = null;

  const unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
    onEvent(event);
  });

  function onEvent(event: AgentEvent): void {
    const turn = current;
    if (turn === null) {
      return;
    }
    // Do not wait for `send` to return the run ID. `run.started` is emitted
    // while `send` is still pending, and it is unknown beforehand whether the
    // provider resolves `send` early or at turn end — filtering on a run ID that
    // is not assigned yet would silently drop the whole stream.
    if (turn.dspatchRunId === '') {
      turn.dspatchRunId = event.dspatchRunId;
    }
    if (event.dspatchRunId !== turn.dspatchRunId) {
      return;
    }
    turn.eventTypeCounts[event.type] = (turn.eventTypeCounts[event.type] ?? 0) + 1;
    const atMs = round(performance.now() - sendStartedAt);
    if (event.type === 'assistant.delta') {
      turn.chunkCount += 1;
      if (turn.firstChunkMsAfterSend === null) {
        turn.firstChunkMsAfterSend = atMs;
      }
      turn.lastChunkMsAfterSend = atMs;
      turn.answer += event.text;
      turn.chunks.push({
        index: turn.chunkCount,
        atMsAfterSend: atMs,
        length: event.text.length,
        text: event.text,
      });
      return;
    }
    if (event.type === 'assistant.message') {
      turn.finalAssistantMessage = event.text;
      return;
    }
    if (event.type === 'usage') {
      turn.usageEvents.push({
        atMsAfterSend: atMs,
        readings: event.readings,
        providerEventVerbatim: event.rawProviderEvent,
      });
      return;
    }
    if (event.type === 'run.finished') {
      turn.finishedMsAfterSend = atMs;
      turn.terminalStatus = event.status;
      if (event.error !== undefined) {
        turn.errorMessage = event.error.message;
        turn.providerCode = event.error.providerCode ?? null;
      }
      const resolve = resolveTurn;
      resolveTurn = null;
      if (resolve !== null) {
        resolve();
      }
    }
  }

  async function runTurn(label: string, prompt: string): Promise<TurnRecord> {
    const turn: TurnRecord = {
      label,
      promptChars: prompt.length,
      dspatchRunId: '',
      chunks: [],
      chunkCount: 0,
      firstChunkMsAfterSend: null,
      lastChunkMsAfterSend: null,
      sendResolvedMsAfterSend: null,
      finishedMsAfterSend: null,
      terminalStatus: null,
      errorMessage: null,
      providerCode: null,
      answer: '',
      finalAssistantMessage: null,
      eventTypeCounts: {},
      usageEvents: [],
    };
    const finished = new Promise<void>((resolve) => {
      resolveTurn = resolve;
    });
    turns.push(turn);
    current = turn;
    sendStartedAt = performance.now();
    log(`${label}: sending (${String(prompt.length)} chars)`);
    const reference = await adapter.send(handle.dspatchSessionId, prompt);
    turn.sendResolvedMsAfterSend = round(performance.now() - sendStartedAt);
    if (reference.dspatchRunId !== turn.dspatchRunId) {
      throw new ProbeFailure(
        PROBE_EXIT.unexpectedError,
        `${label}: send returned run ${reference.dspatchRunId} but events carried ` +
          `${turn.dspatchRunId === '' ? '(none)' : turn.dspatchRunId}.`,
      );
    }
    await Promise.race([
      finished,
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          reject(
            new ProbeFailure(
              PROBE_EXIT.timedOut,
              `${label} did not finish within ${String(TURN_TIMEOUT_MS)} ms. ` +
                `chunks=${String(turn.chunkCount)}`,
            ),
          );
        }, TURN_TIMEOUT_MS).unref?.();
      }),
    ]);
    log(
      `${label}: status=${String(turn.terminalStatus)} chunks=${String(turn.chunkCount)} ` +
        `first=${String(turn.firstChunkMsAfterSend)}ms last=${String(turn.lastChunkMsAfterSend)}ms ` +
        `sendResolved=${String(turn.sendResolvedMsAfterSend)}ms ` +
        `finished=${String(turn.finishedMsAfterSend)}ms`,
    );
    // Attach after every turn, not once at the end. The first billed run failed
    // on a later step and the whole streaming record went with it.
    record['turns'] = turns;
    record['providerMessageTypes'] = adapter.providerMessageTypes(
      handle.dspatchSessionId,
    );
    record['streamPumpFinished'] = adapter.streamPumpFinished(
      handle.dspatchSessionId,
    );
    record['modelReported'] = adapter.modelReported(handle.dspatchSessionId);
    // Cursor delivers the same text twice, as `onDelta` text fragments and as
    // `assistant` messages. If the adapter's accumulation is right these agree
    // exactly, so the comparison is worth machine-checking rather than assuming.
    record['assistantMessageVsDeltas'] = turns.map((entry) => ({
      label: entry.label,
      deltaChars: entry.answer.length,
      messageChars: entry.finalAssistantMessage?.length ?? null,
      identical: entry.finalAssistantMessage === entry.answer,
    }));
    return turn;
  }

  try {
    // --- 6. Turn one: plant the nonce, and ask for enough output that a real
    // stream has to arrive in pieces. A single short sentence could legitimately
    // come back as one chunk and would make the streaming check meaningless.
    const nonce = newNonce();
    record['nonce'] = nonce;
    const firstTurn = await runTurn(
      'turn-1',
      `Remember this token exactly: ${nonce}. ` +
        'Then, without using any tool, count from one to twelve in English words, ' +
        'one word per line.',
    );
    if (firstTurn.terminalStatus !== 'finished') {
      throw new ProbeFailure(
        PROBE_EXIT.firstTurnFailed,
        `turn-1 ended as ${String(firstTurn.terminalStatus)}: ` +
          `${firstTurn.errorMessage ?? 'no error message'} ` +
          `(providerCode=${firstTurn.providerCode ?? 'none'})`,
      );
    }

    // --- 7. Streaming, checked as streaming. --------------------------------
    const distinctTimes = new Set(
      firstTurn.chunks.map((chunk) => chunk.atMsAfterSend),
    ).size;
    record['streaming'] = {
      chunkCount: firstTurn.chunkCount,
      distinctArrivalTimes: distinctTimes,
      firstChunkMsAfterSend: firstTurn.firstChunkMsAfterSend,
      lastChunkMsAfterSend: firstTurn.lastChunkMsAfterSend,
      spreadMs:
        firstTurn.firstChunkMsAfterSend !== null &&
        firstTurn.lastChunkMsAfterSend !== null
          ? round(
              firstTurn.lastChunkMsAfterSend - firstTurn.firstChunkMsAfterSend,
            )
          : null,
      criterion:
        'at least 2 chunks arriving at 2 or more distinct times, relative to send',
    };
    if (firstTurn.chunkCount < 2 || distinctTimes < 2) {
      throw new ProbeFailure(
        PROBE_EXIT.streamingNotDemonstrated,
        `Streaming not demonstrated: ${String(firstTurn.chunkCount)} chunk(s) at ` +
          `${String(distinctTimes)} distinct time(s). A single blob is not a stream.`,
      );
    }
    log(
      `streaming: ${String(firstTurn.chunkCount)} chunks, ` +
        `${String(distinctTimes)} distinct arrival times`,
    );

    // --- 8. Turn two in the same session, proven by context continuity. -----
    const secondTurn = await runTurn(
      'turn-2',
      'What was the token I asked you to remember? Reply with the token only.',
    );
    if (secondTurn.terminalStatus !== 'finished') {
      throw new ProbeFailure(
        PROBE_EXIT.secondTurnFailed,
        `turn-2 ended as ${String(secondTurn.terminalStatus)}: ` +
          `${secondTurn.errorMessage ?? 'no error message'} ` +
          `(providerCode=${secondTurn.providerCode ?? 'none'})`,
      );
    }
    const continuityProven = secondTurn.answer.includes(nonce);
    record['continuity'] = {
      claim:
        'the follow-up ran in the same session, shown by the agent recalling a ' +
        'nonce that appeared only in turn one',
      nonce,
      secondAnswerContainsNonce: continuityProven,
      sameProviderSessionId: handle.providerSessionId,
      distinctRunIds: [firstTurn.dspatchRunId, secondTurn.dspatchRunId],
      modelReported: adapter.modelReported(handle.dspatchSessionId),
    };
    if (!continuityProven) {
      throw new ProbeFailure(
        PROBE_EXIT.continuityNotProven,
        'turn-2 did not return the nonce from turn-1, so a shared session is not ' +
          'established. Reusing a session ID alone proves nothing.',
      );
    }
    log('continuity: turn-2 returned the nonce planted in turn-1');

    record['approvals'] = {
      requestEventsObserved: adapter.pendingApprovals(handle.dspatchSessionId)
        .length,
      note:
        'Cursor has no programmatic approval response on the SDK transport, so ' +
        'respondToApproval throws. The mapping exists to make {type:"request"} ' +
        'observable, not to answer it.',
    };
    record['localState'] = describeLocalState(localStateRoot, workspacePath);

    // --- 9. Usage, read twice because cost is eventually consistent. --------
    //
    // A provider refusal here is **recorded, not fatal**. Cursor can decline the
    // account-level usage API while the message stream still reports tokens, and
    // an unavailable reading is an AC#4 observation in its own right. Aborting
    // would throw away the reading that does exist. Exit code 17 is kept for the
    // usage step failing in some way other than the provider answering "no".
    const firstRead = await readUsageOnce(adapter, handle.dspatchSessionId);
    log(
      `usage read 1: ${String(firstRead.normalisedReadings.length)} readings` +
        (firstRead.error === null ? '' : ` (refused: ${firstRead.error.message})`),
    );

    // Not unref'd: this wait must actually happen, and an unref'd timer would let
    // the process exit first if nothing else were holding the loop open.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, USAGE_SECOND_READ_DELAY_MS);
    });

    const secondRead = await readUsageOnce(adapter, handle.dspatchSessionId);
    log(
      `usage read 2 after ${String(USAGE_SECOND_READ_DELAY_MS)} ms: ` +
        `${String(secondRead.normalisedReadings.length)} readings` +
        (secondRead.error === null ? '' : ` (refused: ${secondRead.error.message})`),
    );

    record['usage'] = {
      note:
        'value null means unknown, never 0. Cursor documents cost as ' +
        'server-derived and eventually consistent, so an absent number can mean ' +
        'either "not landed yet" or "not available at all".',
      intervalMsBetweenReads: USAGE_SECOND_READ_DELAY_MS,
      accountLevelApi: {
        method: 'agent.getUsage()',
        firstRead,
        secondRead,
      },
      streamLevelReadings: {
        method: 'SDKUsageMessage on run.stream()',
        [firstTurn.dspatchRunId]: await adapter.readUsage({
          of: 'run',
          dspatchRunId: firstTurn.dspatchRunId,
        }),
        [secondTurn.dspatchRunId]: await adapter.readUsage({
          of: 'run',
          dspatchRunId: secondTurn.dspatchRunId,
        }),
      },
    };

    // --- 10. Re-read the on-disk footprint now that both turns are done. ----
    record['localState'] = describeLocalState(localStateRoot, workspacePath);
    return PROBE_EXIT.ok;
  } finally {
    unsubscribe();
    current = null;
  }
}

interface UsageReadRecord {
  readonly observedAtUtc: string;
  readonly providerResponseVerbatim: unknown;
  readonly normalisedReadings: readonly UsageReading[];
  readonly error: { message: string; providerCode: string | null } | null;
}

async function readUsageOnce(
  adapter: CursorSdkAdapter,
  dspatchSessionId: string,
): Promise<UsageReadRecord> {
  try {
    const normalisedReadings = await adapter.readUsage({
      of: 'session',
      dspatchSessionId,
    });
    const providerResponseVerbatim = await adapter.readUsageRaw(dspatchSessionId);
    return {
      observedAtUtc: new Date().toISOString(),
      providerResponseVerbatim: providerResponseVerbatim ?? null,
      normalisedReadings,
      error: null,
    };
  } catch (error) {
    const providerCode =
      typeof error === 'object' && error !== null && 'providerCode' in error
        ? ((error as { providerCode?: unknown }).providerCode ?? null)
        : null;
    return {
      observedAtUtc: new Date().toISOString(),
      providerResponseVerbatim: null,
      normalisedReadings: [],
      error: {
        message: error instanceof Error ? error.message : String(error),
        providerCode: typeof providerCode === 'string' ? providerCode : null,
      },
    };
  }
}

/**
 * Describe the SDK's on-disk footprint by listing names and sizes only.
 *
 * The store's contents are deliberately not read: step 1 established that
 * `blobEncryptionKey` is written there in clear text, and a saved log must not
 * carry it even though it is a cache key rather than a credential.
 */
function describeLocalState(
  localStateRoot: string,
  workspacePath: string,
): Record<string, unknown> {
  return {
    localStateRoot,
    exists: fs.existsSync(localStateRoot),
    entries: listShallow(localStateRoot),
    workspaceEntriesAfterRun: listShallow(workspacePath),
    note:
      'names and sizes only. File contents are not read: the store writes ' +
      'blobEncryptionKey in clear text.',
  };
}

function listShallow(dir: string): unknown {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .map((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return { name: entry.name, kind: 'dir', entries: listShallow(full) };
        }
        let size: number | null = null;
        try {
          size = fs.statSync(full).size;
        } catch {
          size = null;
        }
        return { name: entry.name, kind: 'file', bytes: size };
      });
  } catch (error) {
    return `[unreadable: ${String(error)}]`;
  }
}
