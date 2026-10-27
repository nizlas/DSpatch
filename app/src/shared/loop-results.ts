/**
 * What a step leaves behind, and how a later step is given it.
 *
 * DSP-74 and DSP-75. Almost nothing here is new vocabulary: `archive`,
 * `report.writtenBy`, `archivePlacement()`, `StepContext.archive`,
 * a reference returned by a step, and the runId/occurrence/callId binding were all already
 * in the format and the run model, and the dry-run executor already printed what a
 * real run would file. What was missing was a run that actually filed it, a way for a
 * graph to say a result is **required**, and any way at all to say which later step
 * receives it.
 *
 * Three rules hold this module together.
 *
 * **One body, stored once.** A {@link RecordedResult} has exactly one `body`, and
 * every other form of it is a reference. For a file, the runner either wrote those
 * bytes or read them back from the path, so the stored and the shown copy are the same
 * string and cannot drift; `digest` is taken from that string once. Nothing here
 * summarises a body, and nothing serialises one twice.
 *
 * **Presence and provenance, never quality.** The checks below ask whether a result
 * exists and whether it belongs to this run and this visit. They never open it to
 * decide whether the work is any good, because that is the appointed agent's job or
 * the person's, and a runner that started grading reports would be a runner nobody
 * could predict.
 *
 * **A visit, not a node.** A loop comes back around. Every result carries the run, the
 * node, the 1-based visit and the call id it was produced under, and
 * {@link resultHandedOver} resolves a handover against all three — so a second Verifier
 * receives the second Implementer's report and never the first, and an arrival that
 * delivers the result of the step it came from gets that step's visit rather than
 * whichever happens to be newest.
 */

import type { LoopGraph, LoopNode, ResultForm } from './loop-graph';

/**
 * Who chose the outcome a step's result is filed under.
 *
 * DSP-103 #5. A step that names its verdict and a step that names nothing both ended up
 * recorded as *this node produced this outcome*, in the same shape, so a reader of the
 * record — and a later step handed the result — could not tell a verdict from Maestro
 * reading an absence. They are different claims: one is the step's, the other is the
 * engine's, and only the first is evidence of anything.
 *
 * **An absent field is `unknown`, and the first version of this had it backwards** (#8).
 * It read an absent `source` as `step-declared`, so every result written before the field
 * existed claimed to be the step's own verdict. The record cannot support that: a run of
 * the older build could equally have taken the engine's fallback, and the absence says
 * only that nobody wrote it down. A record with no provenance is a record with no
 * provenance, and saying so is the honest reading. Nothing here opens a stored reply to
 * work out which it was — that would be the free-prose reading this whole area refuses —
 * and nothing rewrites an old record to fill the gap (#10).
 *
 * **Not every producer is an agent** (#9). A gate's verdict comes from a command and a
 * router's branch from the node's own configuration; filing either as `step-declared`
 * would describe an agent declaring something where no agent was asked.
 *
 * **It says nothing about whether the work was any good**, which is the line this whole
 * module holds: `engine-fallback` does not mean the step failed, or that its report is
 * thin, only that the name on its result was not in its reply.
 */
export type OutcomeSource =
  /** Nobody recorded it. What an absence means, and what this build never writes. */
  | 'unknown'
  /** The step's reply named it, in the whole-line form the prompt asked for. */
  | 'step-declared'
  /** The reply named nothing and the node's `whenUndeclared` says where that goes. */
  | 'engine-fallback'
  /** A gate step's own result: what running its command, or having none, established. */
  | 'gate-verdict'
  /** A router node's branch, read off its configuration without anybody being asked. */
  | 'router-branch'
  /** An executor with no provider, standing in for whatever the step would have said. */
  | 'dry-run'
  /**
   * DSP-139, generalised by DSP-145. The step declared an outcome that would end the run
   * in success, and no command recorded in this run had completed on the working folders
   * as the step left them (in every folder), while the run had changed files - or DSpatch
   * could not observe the folders at all. The node's own `whenUndeclared` outcome replaced
   * the declared one, because a result about one version of the code is not evidence
   * about another. See {@link describeApprovalRule}.
   */
  | 'verification-stale';

/** The outcome a result was filed under, and whose it is. */
export interface ProducedOutcome {
  readonly name: string;
  /**
   * Absent only on a record written before provenance was recorded, where it means
   * **not recorded**. Every outcome this build produces states one, so an absence is a
   * record from somewhere that did not. Read it through {@link outcomeProvenance} rather
   * than defaulting it here, which is where the mistake #8 corrects was made.
   */
  readonly source?: OutcomeSource;
}

/**
 * The provenance of a filed outcome, which is `unknown` where the record does not say.
 *
 * One reader, so that no caller can quietly pick a friendlier default: the honest answer
 * for a record written before this field is that nobody recorded who chose the name.
 */
export function outcomeProvenance(outcome: ProducedOutcome): OutcomeSource {
  return outcome.source ?? 'unknown';
}

/**
 * A result a step left, bound to the visit that left it.
 *
 * `runId`, `nodeId`, `occurrence` and `callId` are the binding, and all four are
 * carried rather than derived so that a record read back from disk can be checked
 * against the run it claims to belong to instead of trusted.
 */
export interface RecordedResult {
  readonly runId: string;
  readonly nodeId: string;
  /** 1-based visit. The second visit to a node leaves a second, separate result. */
  readonly occurrence: number;
  readonly callId: number;
  /** Never `none`: a result that exists has a form it exists in. */
  readonly form: Exclude<ResultForm, 'none'>;
  /**
   * How the rest of the run names this result.
   *
   * The path for a file; `run:<run-id>/<node>#<visit>` for one the record holds.
   *
   * This is what `StepExecution.archiveRef` was always described as — *a reference to
   * what it produced* — and that field is gone, because it was a reference an executor
   * could assert and nothing could check. **There is one reference to a result and the
   * runner produces it**, from having filed or found the body itself.
   */
  readonly ref: string;
  /** Where the body is, or `null` when the run record is where it is. */
  readonly path: string | null;
  /** sha-256 of `body`, taken once, by whoever held the bytes. */
  readonly digest: string;
  readonly bytes: number;
  /** The whole body. Never a summary, and never rewritten. */
  readonly body: string;
  /**
   * The outcome the producing step ended on, and whose it was. See {@link OutcomeSource}.
   *
   * Absent where the step produced no outcome at all — a plain success, which is the
   * whole contract of a node that declares none — so this never turns "nothing to branch
   * on" into a name nobody wrote.
   */
  readonly outcome?: ProducedOutcome;
  /** The node the graph holds responsible, which is not always the node that worked. */
  readonly filedBy: string;
  /**
   * True when the runner wrote the file because the producing node could not.
   *
   * The 15 September 2026 mistake, in one boolean: a read-only role asked to write its
   * own report could write neither it nor the work. A graph says so with
   * `report.writtenBy`, and this is the runner having acted on it.
   */
  readonly filedByTheRunner: boolean;
}

/** What the store found or wrote, or why it could not. */
export type ResultWrite =
  | { readonly ok: true; readonly digest: string; readonly bytes: number }
  | { readonly ok: false; readonly why: string };

export interface StoredBody {
  readonly body: string;
  readonly digest: string;
  readonly bytes: number;
}

/**
 * Where a run's results are kept.
 *
 * Injected for exactly the reason {@link import('./loop-run').StepExecutor} is: the
 * walk touches no filesystem, so a dry run cannot reach one by accident rather than by
 * promise. The implementation DSpatch ships writes files under a run-scoped directory
 * it owns — never under a definition's `resourceRoot`, and never by default into a
 * working root, because a standalone definition whose results landed in the project it
 * was reading would be the collapse the resource-root work exists to undo, arriving
 * through the back door.
 *
 * Synchronous because both real implementations are: a file, and a map in memory.
 */
export interface ResultStore {
  /** Write `body` at `path`, creating whatever it needs to. */
  put(path: string, body: string): ResultWrite;
  /** What is at `path`, or `null` when nothing is. */
  get(path: string): StoredBody | null;
  /**
   * Where `path` actually is, in the words someone outside DSpatch would need.
   *
   * A graph's `archive.path` is relative to wherever the run keeps its results, and a
   * step asked to file its own report cannot act on a relative path it has no anchor
   * for. This is that anchor, and it is the store's to give because the store is the
   * only thing that knows it.
   */
  locate(path: string): string;
  /** sha-256 of a body that is never written anywhere, so a stored result has one too. */
  digest(body: string): string;
}

/** The size of a body in the bytes it is stored as, without a Node Buffer to hand. */
export function bodyBytes(body: string): number {
  return new TextEncoder().encode(body).length;
}

/** A result store backed by a map, for a test and for a run with nothing on disk. */
export function createMemoryResultStore(
  digestOf: (body: string) => string,
): ResultStore & { readonly written: ReadonlyMap<string, string> } {
  const written = new Map<string, string>();
  return {
    written,
    put(path: string, body: string): ResultWrite {
      written.set(path, body);
      return { ok: true, digest: digestOf(body), bytes: bodyBytes(body) };
    },
    get(path: string): StoredBody | null {
      const body = written.get(path);
      return body === undefined ? null : { body, digest: digestOf(body), bytes: bodyBytes(body) };
    },
    locate: (path: string) => `memory:${path}`,
    digest: digestOf,
  };
}

/** The reference for a result the run record itself holds. */
export function storedResultRef(runId: string, nodeId: string, occurrence: number): string {
  return `run:${runId}/${nodeId}#${String(occurrence)}`;
}

/** Which result a step is to be handed: the run, the node, and optionally the exact visit. */
export interface ResultBinding {
  readonly runId: string;
  readonly nodeId: string;
  /**
   * The visit whose result is wanted, when the caller knows it.
   *
   * Left out, the most recent completed visit is taken, which is what a node's standing
   * `consumes` means. Supplied, nothing else will do: an arriving edge knows exactly
   * which visit of its own source produced the outcome that routed the run here, and
   * "the latest" is only accidentally the same answer.
   */
  readonly occurrence?: number;
}

/**
 * The result a step is handed, bound to a run, a node and a visit — or `null`.
 *
 * `null` is not an empty input and must never be passed on as one — the caller turns it
 * into a fault. A step handed an empty report would go on to produce work about nothing,
 * which is the expensive shape of this mistake.
 *
 * **All three parts of the binding are checked, and none of them used to be.** This was
 * `latestResultOf(results, nodeId)`: no run, no visit, and "latest" decided by scanning
 * for the highest `occurrence`. It gave the right answer for every run anybody had walked,
 * which is exactly what makes it the kind of helper that looks right until a node is
 * visited three times — the correctness rested on the caller only ever passing one run's
 * results in the order they were produced, and on the caller never needing a particular
 * visit. DSP-100 gave it a caller that needs one: an arrival that delivers the result of
 * the step it came from means *that* visit's result, not whichever is newest by the time
 * the lookup runs.
 *
 * Ties on `occurrence` are broken by `callId`, which only increases within a run, so
 * "most recent" is a fact about the walk rather than about the order of the array.
 */
export function resultHandedOver(
  results: readonly RecordedResult[],
  binding: ResultBinding,
): RecordedResult | null {
  let found: RecordedResult | null = null;
  for (const result of results) {
    if (result.runId !== binding.runId || result.nodeId !== binding.nodeId) {
      continue;
    }
    if (binding.occurrence !== undefined && result.occurrence !== binding.occurrence) {
      continue;
    }
    if (
      found === null ||
      result.occurrence > found.occurrence ||
      (result.occurrence === found.occurrence && result.callId > found.callId)
    ) {
      found = result;
    }
  }
  return found;
}

/** A result of this run, this node and this visit, for anyone reading the record back. */
export function resultOfVisit(
  results: readonly RecordedResult[],
  nodeId: string,
  occurrence: number,
): RecordedResult | null {
  return (
    results.find((result) => result.nodeId === nodeId && result.occurrence === occurrence) ?? null
  );
}

/**
 * The received results, as a step is told about them.
 *
 * **A file is named, not quoted.** Where there is a path the step is pointed at it,
 * because the file is the canonical body and pasting it here would make a second copy
 * that can disagree with the first. Where the run record is the only place the body
 * lives there is nothing to point at, so the body itself travels.
 *
 * Returns the empty string when nothing was received, so a caller can append it
 * unconditionally and a step that consumes nothing is sent exactly what it was sent
 * before this existed.
 */
export function describeReceivedResults(received: readonly RecordedResult[]): string {
  if (received.length === 0) {
    return '';
  }
  const parts = received.map((result) => {
    const who =
      `"${result.nodeId}"` +
      (result.occurrence === 1 ? '' : ` (visit ${String(result.occurrence)})`);
    const named = describeProducedOutcome(result.outcome);
    return result.path === null
      ? `${who} left this result, which is held in the run record and is reproduced here whole.${named}\n\n${result.body}`
      : `${who} left its result at ${result.path}. Read that file; it is the result itself, not a copy of it.${named}`;
  });
  const anyFile = received.some((result) => result.path !== null);
  // What this material *is*, said where it arrives (DSP-96 part 3). The message already
  // states which text governs where two disagree; this is the other half of that — the
  // step reading a handover has to know it is reading somebody's account of their own
  // work and not a reissued assignment. Still nothing about its quality: this module
  // does not open a body to judge one, and that refusal is what keeps the two apart.
  return (
    `\n\n---\n\nThis step has been given ${
      received.length === 1 ? 'the result of an earlier step' : `${String(received.length)} earlier results`
    } in this run. ${receivedKind(received)}, not a restatement of the assignment.\n\n${parts.join('\n\n')}\n${
      anyFile ? `\n${RESULT_STORAGE_NOTE}\n` : ''
    }`
  );
}

/**
 * What the handed-over material is, in one clause.
 *
 * DSP-139: a gate's result is not anybody's account. It is DSpatch's record of a
 * command it ran itself, and calling it "that step's account of its own work" would
 * tell the checking agent to weigh a measured exit code like a claim. A handover with
 * no gate result is worded exactly as it was before.
 */
function receivedKind(received: readonly RecordedResult[]): string {
  const gates = received.filter(
    (result) => result.outcome !== undefined && outcomeProvenance(result.outcome) === 'gate-verdict',
  );
  if (gates.length === 0) {
    return received.length === 1
      ? 'It is that step’s account of its own work'
      : 'Each is that step’s account of its own work';
  }
  // A gate that ran no command files the verdict `not-verified` and nothing else does
  // (`NOT_VERIFIED_OUTCOME` in loop-chat.ts; a test holds the two equal). Saying it "ran"
  // a command there would be the claim this card exists to stop (review R-1 I2).
  const ranNone = gates.filter((result) => result.outcome?.name === GATE_RAN_NO_COMMAND_OUTCOME).length;
  const clause =
    ranNone === 0
      ? 'DSpatch’s record of a command it ran itself'
      : ranNone === gates.length
        ? 'DSpatch’s record that it ran no command'
        : 'DSpatch’s record of a command it ran itself, or of running none';
  if (gates.length === received.length) {
    return received.length === 1 ? `It is ${clause}` : `Each is ${clause}`;
  }
  return `A gate’s result is ${clause}, and each other one is that step’s account of its own work`;
}

/** The verdict a gate files when it started no command. Equal to `NOT_VERIFIED_OUTCOME`. */
export const GATE_RAN_NO_COMMAND_OUTCOME = 'not-verified';

/**
 * The command a gate ran, as the body of its result (DSP-139).
 *
 * Structural rather than `LiveCommandRecord`, which lives in the main process: this
 * module is shared, and only the fields the body names are needed.
 */
export interface GateCommandFacts {
  /** What was started, shell prefix included. */
  readonly command: string;
  /** The line as configured, without the shell prefix, where there is one. */
  readonly line?: string | null;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly startedAtUtc: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly notRun: { readonly kind: string; readonly message: string } | null;
}

/** How much of each output stream a gate's result carries, counted from the end. */
export const GATE_OUTPUT_TAIL_CHARS = 4000;

function outputSection(name: string, text: string): string {
  if (text.trim() === '') {
    return `${name}: no output was reported.`;
  }
  if (text.length <= GATE_OUTPUT_TAIL_CHARS) {
    return `${name} (all ${String(text.length)} characters):\n${text}`;
  }
  const left = text.length - GATE_OUTPUT_TAIL_CHARS;
  return (
    `${name} (the last ${String(GATE_OUTPUT_TAIL_CHARS)} of ${String(text.length)} characters; ` +
    `the first ${String(left)} are left out here and kept whole in the run’s command ` +
    `record):\n${text.slice(left)}`
  );
}

/**
 * The body a gate files as its result, which is what a later step is handed.
 *
 * DSP-139. Everything a checking step needs to judge a test result without taking
 * anybody's word for it: which run, which gate and visit, the command as configured and
 * as started, the folder, the exit code or signal, when and how long, the verdict, which
 * snapshot of the working folders it ran against and which it left, and the output,
 * bounded from the end because the end is where a test runner says what failed. A
 * stream with nothing in it says so (INTERACTION_MODEL §5): an empty section would read
 * as if the output had been left out.
 */
export function describeGateResult(input: {
  readonly runId: string;
  readonly nodeId: string;
  readonly occurrence: number;
  readonly verdict: string;
  readonly command: GateCommandFacts;
  /** The snapshot the command ran against, or `null` where DSpatch did not observe it. */
  readonly testedSnapshotId: string | null;
  /** The snapshot after the command, or `null` where DSpatch did not observe it. */
  readonly afterSnapshotId: string | null;
  /** A sentence about the command changing what it measured, or empty. */
  readonly selfModified: string;
}): string {
  const { command } = input;
  const ran = command.notRun === null;
  const exit =
    command.signal === null
      ? `Exit code: ${command.exitCode === null ? 'none reported' : String(command.exitCode)}`
      : `Ended by signal ${command.signal}` +
        (command.exitCode === null ? '' : `, exit code ${String(command.exitCode)}`);
  const lines = [
    ran
      ? 'DSpatch ran this command itself. No agent ran it and no agent reported it.'
      : 'DSpatch started no command for this gate, so nothing was tested. No agent was asked.',
    '',
    `Run: ${input.runId}`,
    `Gate: "${input.nodeId}", visit ${String(input.occurrence)}`,
    `Command as configured: ${command.line ?? command.command}`,
    ...(ran ? [`Command as started: ${command.command}`] : []),
    `Working folder: ${command.cwd}`,
    ...(ran
      ? [`Started: ${command.startedAtUtc}, finished after ${String(command.durationMs)} ms`, exit]
      : [`Not run: ${command.notRun?.message ?? ''}`]),
    `Verdict: "${input.verdict}"${ran ? ' (pass is exit code 0, anything else is fail)' : ''}`,
    // When the snapshot was taken, said rather than implied (review R-1 I3): it is the
    // run's observation at the end of the step before the gate, and nothing DSpatch does
    // between that and starting the command writes to the folders.
    ran
      ? `Tested snapshot: ${
          input.testedSnapshotId === null
            ? 'not observed — DSpatch did not read the working folders before the command ran'
            : `${input.testedSnapshotId} (as DSpatch observed the working folders when the ` +
              `step before this gate ended; nothing DSpatch does between then and starting the ` +
              `command writes to them)`
        }`
      : 'Tested snapshot: none — no command ran',
    `Snapshot after the command: ${input.afterSnapshotId ?? 'not observed'}`,
    ...(input.selfModified.trim() === '' ? [] : [input.selfModified.trim()]),
    '',
    outputSection('Standard output', command.stdout),
    '',
    outputSection('Standard error', command.stderr),
  ];
  return lines.join('\n');
}

/** One gate result a step was handed, as the rule below needs it. */
export interface GateEvidenceStanding {
  readonly nodeId: string;
  readonly occurrence: number;
  /** The working copy's tested snapshot, or `null` where it was not observed. */
  readonly testedSnapshotId: string | null;
  /** Why the result does not describe the working folders now, or `null` where it does. */
  readonly staleBecause: string | null;
}

/**
 * The rule a step handed a gate's result works under, said to that step (DSP-139, A3).
 *
 * Every instruction DSpatch adds to a step is to be visible (AGENT_BEHAVIOUR §1), and
 * this one changes the step's recorded outcome, so it is stated in the message whenever
 * a gate result is handed over and not only when it bites. Empty when none was.
 */
export function describeGateEvidenceRule(
  standings: readonly GateEvidenceStanding[],
  whenUndeclared: string | null,
): string {
  if (standings.length === 0) {
    return '';
  }
  const each = standings.map((standing) => {
    const who =
      `"${standing.nodeId}"` +
      (standing.occurrence === 1 ? '' : ` (visit ${String(standing.occurrence)})`);
    const tested =
      standing.testedSnapshotId === null
        ? `The command result from ${who} describes code DSpatch did not observe, so which ` +
          `version of the code it tested is not established.`
        : `The command result from ${who} describes snapshot ${standing.testedSnapshotId} of ` +
          `the working folders and no other version of the code. DSpatch took that snapshot ` +
          `when the step before the command ended.`;
    return standing.staleBecause === null
      ? `${tested} The working folders are still that snapshot as this step starts.`
      : `${tested} ${standing.staleBecause} It does not describe the code you are checking.`;
  });
  const consequence =
    whenUndeclared === null
      ? 'this step names no outcome for a result nobody established, so the run stops with a ' +
        'runtime fault instead of taking your verdict'
      : `DSpatch records this step’s outcome as "${whenUndeclared}" in place of any verdict ` +
        'that would end the run in success, unless a command completed on the code as you ' +
        'leave it (a declared failure still stands)';
  const staleNow = standings.some((standing) => standing.staleBecause !== null);
  const rule = staleNow
    ? `Because of that, ${consequence}: a test result about one version of the code is not ` +
      `evidence about another. Judge from what you can establish yourself, and say what you ` +
      `could not.`
    : `If the working folders are not that snapshot when this step ends — because you or ` +
      `anything else changed a file — or DSpatch cannot observe them, ${consequence}: a ` +
      `test result about one version of the code is not evidence about another. Changing a ` +
      `file in this step makes the command result out of date.`;
  return `\n\n---\n\nWhich code the command result describes.\n\n${each.join('\n\n')}\n\n${rule}\n`;
}

/**
 * The outcome a received result was filed under, told to the step that reads it.
 *
 * DSP-103 #5's second half. The first half is that the record can tell the two apart;
 * this is the step being told, because a step that treats *the engine routed here because
 * nothing was declared* as *the earlier step decided this* is reasoning from a verdict
 * nobody gave. It names no quality, and it is empty where the step produced no outcome at
 * all — so a handover from a node that declares none is worded exactly as it was before
 * this existed.
 *
 * **Every value gets its own sentence, and that is #8's other half.** This used to be one
 * comparison against `step-declared` with everything else falling into the engine's
 * sentence, so an unrecorded provenance would have been read out to the next step as
 * *that step named no result* — a definite claim about a record that makes none. The
 * unknown case says it is unknown and warns the reader off the verdict reading, rather
 * than hedging in words a reader skims as "declared".
 */
function describeProducedOutcome(outcome: ProducedOutcome | undefined): string {
  if (outcome === undefined) {
    return '';
  }
  const named = `"${outcome.name}"`;
  switch (outcomeProvenance(outcome)) {
    case 'step-declared':
      return ` That step named its own result for this run: ${named}.`;
    case 'engine-fallback':
      return (
        ` That step named no result. ${named} is what its node says a missing ` +
        `declaration is routed as, so it is DSpatch reading an absence and not that ` +
        `step\u2019s verdict on its own work — which may well have been done. What it ` +
        `actually said is in the result itself.`
      );
    case 'gate-verdict':
      return (
        ` That step is a gate: ${named} is what running its own check established, not ` +
        `anybody\u2019s account of the work.`
      );
    case 'router-branch':
      return (
        ` That step is a router: ${named} is the branch its node is configured to take. ` +
        `Nobody was asked and nothing was read into anything.`
      );
    case 'dry-run':
      return (
        ` ${named} came from a dry run standing in for that step, so no agent and no ` +
        `command produced it. It is not a verdict on anything.`
      );
    case 'verification-stale':
      return (
        ` ${named} is not that step’s own verdict. It was handed a command result ` +
        `about code that was no longer, or could not be shown to be, the code in the ` +
        `working folders, so DSpatch recorded the outcome its node names for a result ` +
        `nobody established. What it actually said is in the result itself.`
      );
    case 'unknown':
      return (
        ` It is filed under ${named} and the record does not say who chose that name: it ` +
        `was written before DSpatch recorded the difference, so whether the step declared ` +
        `${named} or the run selected it for a reply that declared nothing is not known. ` +
        `Do not read it as that step\u2019s verdict.`
      );
  }
}

/**
 * Where the run's results live, said to the agent that is sent to one.
 *
 * DSP-91 #2. The 21 September verifier's prompt ended by telling it to read
 * `C:\Users\nicla\AppData\Roaming\DSpatch\loop-runs\<run>\results\reports\002-implementer.md`
 * — a correct path, in the same message whose role text says *"Stay inside the project you
 * were given"*. The engine was sending an agent outside the folders the run had named and
 * saying nothing about it, so the instruction and the boundary contradicted each other with
 * no way to tell which won.
 *
 * The three things DSP-91 asks to be kept apart are the loop definition's resources, the
 * task's working folders and the run's result storage. This is the third one, named as
 * DSpatch's own rather than left to look like part of somebody's repository.
 *
 * Exported so `describeRequiredResult` — which names the same storage from the writing side
 * — says it in the same words.
 */
export const RESULT_STORAGE_NOTE =
  'That path is inside DSpatch\u2019s own storage for this run. It is not in the folders ' +
  'you are working in and not in anybody\u2019s repository, so reading and writing there ' +
  'is part of this step and is not work on the project.';

// --- When a success verdict stands (DSP-145) ------------------------------------------

/** An outcome of a node whose edge ends the run at a terminal with `ending: success`. */
export interface SuccessRoute {
  readonly outcome: string;
  readonly terminal: string;
}

/**
 * The outcomes of `node` that lead straight to a success terminal. The approval rule
 * applies to these and to nothing else: an outcome that leads to another step, or to
 * an ending that is not a success, is left as the step declared it.
 */
export function successRoutesOf(
  graph: Pick<LoopGraph, 'nodes' | 'edges'>,
  node: Pick<LoopNode, 'id'>,
): readonly SuccessRoute[] {
  const routes: SuccessRoute[] = [];
  // Read defensively: a hand-built context in a test may carry a partial graph.
  for (const edge of graph.edges ?? []) {
    if (edge.from !== node.id || edge.when.on !== 'outcome') {
      continue;
    }
    const target = (graph.nodes ?? []).find((candidate) => candidate.id === edge.to);
    if (target?.kind === 'terminal' && target.ending === 'success') {
      routes.push({ outcome: edge.when.outcome, terminal: target.id });
    }
  }
  return routes;
}

/**
 * The rule a step whose verdict can end the run in success works under, said to that
 * step (DSP-145; DSP-139 for gate results, generalised). Every instruction DSpatch adds
 * is visible, and this one can change the step's recorded outcome, so it is sent
 * whenever it applies and not only when it bites. Empty when the step has no such route.
 */
export function describeApprovalRule(
  routes: readonly SuccessRoute[],
  whenUndeclared: string | null,
): string {
  if (routes.length === 0) {
    return '';
  }
  const declared = routes
    .map((route) => `"${route.outcome}" ends this run in success ("${route.terminal}")`)
    .join('; ');
  // R1: a fallback that itself ends the run in success is no fallback.
  const fallback =
    whenUndeclared !== null && routes.some((route) => route.outcome === whenUndeclared)
      ? null
      : whenUndeclared;
  const otherwise =
    fallback === null
      ? 'Otherwise this step names no outcome for a result nobody established, so the run ' +
        'stops with a runtime fault instead of taking your verdict.'
      : `Otherwise DSpatch records "${fallback}" (this step’s outcome for a result ` +
        'nobody established) instead, and the run does not end in success. A declared failure, ' +
        'or a verdict that leads anywhere else, stands as you declare it.';
  return (
    `\n\n---\n\nWhen DSpatch lets a success verdict stand.\n\n` +
    `Declaring ${declared}. DSpatch lets that stand only if a command recorded in this run ` +
    `completed on the code exactly as the working folders are when this step ends - in every ` +
    `working folder - or if this run has changed no file at all. A command counts whether an ` +
    `agent ran it through DSpatch’s command tool, the provider reported running it, or a gate ` +
    `ran it; one that could not start, was refused, or was stopped does not, and neither does ` +
    `a folder DSpatch could not observe. A completed command shows that it ran on this code, ` +
    `not that its result was good: judging the result is yours. ${otherwise} Changing a file ` +
    `after the last command makes every earlier result out of date, so run the check again ` +
    `after your last change.\n`
  );
}

/** One command DSpatch recorded in this run, as a later step is told about it. */
export interface CommandEvidenceEntry {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly requestedBy: 'agent-tool' | 'gate' | 'provider-reported';
  readonly line: string;
  readonly cwd: string;
  /** How it ended, in words: `exit code 1`, or why it has none. */
  readonly ended: string;
  readonly durationMs: number;
  readonly afterRunSnapshotId: string | null;
  /** Against the working folders as this step started. `not-observed` is never current. */
  readonly standing: 'current' | 'stale' | 'not-observed';
  readonly changedWhileRunning: boolean | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** How much of each stream one entry carries into a message. */
export const COMMAND_EVIDENCE_TAIL_CHARS = 2_000;

/** The most entries one message lists; earlier ones are counted, not dropped silently. */
export const COMMAND_EVIDENCE_MAX_ENTRIES = 20;

function evidenceTail(label: string, text: string): string {
  const trimmed = text.trimEnd();
  if (trimmed === '') {
    return `   ${label}: (nothing reported)`;
  }
  const cut = trimmed.length > COMMAND_EVIDENCE_TAIL_CHARS;
  const kept = cut ? trimmed.slice(trimmed.length - COMMAND_EVIDENCE_TAIL_CHARS) : trimmed;
  return (
    `   ${label}${cut ? ` (the last ${String(COMMAND_EVIDENCE_TAIL_CHARS)} characters)` : ''}:\n` +
    kept
      .split('\n')
      .map((line) => `     ${line}`)
      .join('\n')
  );
}

const ORIGIN: Record<CommandEvidenceEntry['requestedBy'], string> = {
  'agent-tool': 'DSpatch ran it at an agent’s request, through its command tool',
  gate: 'DSpatch ran it for a gate step',
  'provider-reported':
    'the provider reported running it with its own tool; DSpatch did not start it, saw only ' +
    'the provider’s report, and took its snapshots when it saw the start and finish events, so ' +
    'they approximate the code the command saw',
};

/**
 * The commands DSpatch recorded in this run, for a step that judges the work (DSP-145).
 * DSpatch's own records, with their standing against the working folders as the step
 * starts. Empty when the run has recorded none.
 */
export function describeRecordedCommands(entries: readonly CommandEvidenceEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  const shown = entries.slice(-COMMAND_EVIDENCE_MAX_ENTRIES);
  const omitted = entries.length - shown.length;
  const each = shown.map((entry, index) => {
    const standing =
      entry.standing === 'current'
        ? 'current - every working folder is still as it was when this command ended'
        : entry.standing === 'stale'
          ? 'stale - the working folders have changed since this command ended, so its result ' +
            'describes older code'
          : 'not observed - DSpatch could not compare it with the working folders, which is ' +
            'never the same as unchanged';
    return [
      `${String(omitted + index + 1)}. ${entry.line}`,
      `   Step: "${entry.nodeId}"${entry.occurrence === 1 ? '' : ` visit ${String(entry.occurrence)}`}; ${ORIGIN[entry.requestedBy]}.`,
      `   Folder: ${entry.cwd}`,
      `   Ended: ${entry.ended} after ${(entry.durationMs / 1000).toFixed(1)} s`,
      `   After-run snapshot: ${entry.afterRunSnapshotId ?? 'not observed'} (${standing})`,
      ...(entry.changedWhileRunning === true
        ? ['   It changed files while it ran, so what it measured is not what it left behind.']
        : []),
      evidenceTail('Standard output', entry.stdout),
      evidenceTail('Standard error', entry.stderr),
    ].join('\n');
  });
  return (
    `\n\n---\n\nCommands DSpatch recorded in this run.\n\n` +
    `These are DSpatch’s own records of commands, not anybody’s account of them. Each is ` +
    `compared with the working folders as this step starts. They are evidence for you to ` +
    `weigh, not a verdict: run the checks you need yourself as well.` +
    (omitted === 0 ? '' : ` ${String(omitted)} earlier command${omitted === 1 ? ' is' : 's are'} not listed.`) +
    `\n\n${each.join('\n\n')}\n`
  );
}
