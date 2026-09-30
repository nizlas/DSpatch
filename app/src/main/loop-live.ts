/**
 * A live StepExecutor: agent nodes go through the existing provider adapter;
 * every other kind does not.
 *
 * This is the other half of `loop-run.ts`. The runner stays free of Node and
 * provider imports, and `createDryRunExecutor` still closes over nothing that
 * can call Cursor. A `--live` path constructs *this* executor. It is not a
 * flag the dry-run executor inspects.
 *
 * Three properties:
 *
 * **The deadline is owned here.** `StepContext.deadlineAt` is not advisory.
 * The executor races the provider turn against it, cancels, and returns
 * `step-timed-out`. A hung `send` cannot hold the runner â€” that was gap 8.4.
 *
 * **Cancel leaves the files.** Nothing here deletes, reverts or replays. A
 * completed step is remembered and returned again if the runner asked twice.
 *
 * **A chat-loop check is an agent.** The duration fixture still has a roleless
 * gate that this executor starts as a command; that drawing is not the chat
 * loop. An agent step reports a named verdict. Snapshots stay as corroboration.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { AgentAdapter } from '../adapter/agent-adapter';
import type {
  AgentEvent,
  DspatchSessionId,
  SessionHandle,
  UsageReading,
} from '../adapter/types';
import {
  describeContainingRefusal,
  describeRefusal,
  describeUndecidableContainment,
  findOwnRepository,
  ownRepositoryInside,
  ownRepositoryRoot,
} from './own-repository';
import {
  diffSnapshots,
  snapshotTree,
  type ChangedFile,
  type FileEntry,
  type TreeDiff,
  type TreeSnapshot,
} from './experiment-repo';
import { snapshotIdFor } from './workspace-baseline';
import type { LoopNode, StepLimits } from '../shared/loop-graph';
import {
  carriesRunChange,
  declaredFailureFrom,
  declaredFailureLineFrom,
  declaredOutcomeFrom,
  describeRunChange,
  describeSnapshotChange,
  emptyReplyOutcome,
  notVerifiedOutcome,
  NOT_VERIFIED_OUTCOME,
  type RunChangeAccount,
  undeclaredReadableOutcome,
} from '../shared/loop-chat';
import { describeToolActivity, type StepActivity } from '../shared/loop-activity';
import { describeReceivedResults, RESULT_STORAGE_NOTE } from '../shared/loop-results';
import {
  describeUnobservedOutside,
  primaryRootOf,
  providerRootPathsFor,
  workingRootsFrom,
  type WorkingRoot,
} from '../shared/working-roots';
import type { CommandNotStarted } from '../shared/loop-record';
import type {
  StepContext,
  StepExecution,
  StepExecutor,
  StepNote,
  StepProduct,
} from '../shared/loop-run';
import { explainUnstartableCommand } from './command-start';
import { checkRunRequest, describeShell } from './test-command';

/** The prompt DSP-1 already measured against this generated repository. */
export const LIVE_DURATION_PROMPT =
  'In this repository, `src/duration.ts` exports `formatDuration`, which currently ' +
  'handles seconds only. Complete it so that the existing tests pass. The tests in ' +
  '`test/duration.test.ts` are the specification â€” read them. ' +
  'Edit `src/duration.ts` and nothing else: do not modify any test file, do not add ' +
  'dependencies, and do not run any commands. Reply with the single word DONE when ' +
  'the file is saved. If the premise is wrong, reply SPEC_ERROR and a sentence. ' +
  'If you cannot do the work, reply BLOCKED and a sentence.';

/** Cheapest model this account has already been seen to accept for a writing turn. */
export const DEFAULT_LIVE_MODEL = 'composer-2';

/** When a node has no `maxMinutes`, still refuse to wait forever. */
export const FALLBACK_DEADLINE_MS = 20 * 60_000;

export interface LiveCommandRecord {
  readonly command: string;
  /**
   * The command line as a person would type it, without the shell prefix `command` carries.
   *
   * DSP-45 #4 asks the record to show the command *exactly as it ran*, and `command` does
   * that â€” it is `cmd.exe /d /s /c cmake --build build`, which is literally what was
   * started. What it does not show is the line itself, which is the part a person reads,
   * compares with their field and retypes in a terminal. Both, rather than a choice
   * between them.
   *
   * Optional and `null` for a command spawned without a shell, where there is no prefix to
   * separate and the two would be the same string.
   */
  readonly line?: string | null;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  /**
   * When the command was **started**, not when anybody heard about it.
   *
   * Carried on the record rather than taken from the clock by whoever writes it
   * down. Both callers used to supply their own "now": `main.ts` at the moment the
   * command settled, and `closeChatLoopRecord` at the moment the record was closed,
   * which is later still â€” so `RecordedCommand.startedAtUtc` was a start time in
   * name only and `durationMs` could not recover the real one from either. DSP-27
   * is about to draw a timeline from this field.
   */
  readonly startedAtUtc: string;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * Why no process ran, or `null` when one did.
   *
   * Its own field rather than an exit code, because an exit code is a statement
   * about the project's tests and this is a statement about DSpatch. The first
   * real chat-loop run reported "tests failed" for a C++ project it had never
   * tested, because "there was nothing to run" arrived here as `exitCode: 1`.
   *
   * A kind and a message rather than a bare sentence, because DSP-26 #2 needs
   * "there was nothing configured to run" and "there was a command and it could
   * not be started" told apart, and two booleans that have to agree eventually
   * disagree. `null` still means a process ran, so a fixture or a caller that
   * writes `notRun: null` keeps its old meaning exactly.
   */
  readonly notRun: CommandNotStarted | null;
}

export interface LiveSnapshotRef {
  readonly snapshotId: string;
  readonly takenAtUtc: string;
  readonly fileCount: number;
  readonly files: readonly FileEntry[];
}

/**
 * What one working root of a run changed.
 *
 * DSP-72 #3. The run-level `changedFiles` below still answers the question it always
 * answered â€” what changed in the working directory â€” and this answers the one a second
 * root makes askable: *which* folder changed. Separate rather than a replacement,
 * because `loop-record.ts`'s format and everything that reads it are unchanged by this
 * card, and a per-root list is a report about a run, not a new kind of record line.
 */
export interface LiveRootInspection {
  readonly name: string;
  readonly path: string;
  readonly primary: boolean;
  snapshotBefore: LiveSnapshotRef | null;
  snapshotAfter: LiveSnapshotRef | null;
  changedFiles: readonly ChangedFile[];
  addedFiles: readonly FileEntry[];
  removedFiles: readonly FileEntry[];
}

export interface LiveInspection {
  workspacePath: string;
  /**
   * Every root this run worked with, the working directory first.
   *
   * A single-root run has exactly one entry, whose path is `workspacePath`, so this is
   * never empty for a run that started and never disagrees with the field above.
   */
  roots: LiveRootInspection[];
  /** {@link describeUnobservedOutside} for {@link roots}, written once the run ends. */
  rootsNote: string;
  modelRequested: string;
  modelReported: string | null;
  snapshotBefore: LiveSnapshotRef | null;
  snapshotAfter: LiveSnapshotRef | null;
  changedFiles: readonly ChangedFile[];
  addedFiles: readonly FileEntry[];
  removedFiles: readonly FileEntry[];
  commands: LiveCommandRecord[];
  usageReadings: UsageReading[];
  usageError: string | null;
  cost: 'unknown' | number;
  cancelled: boolean;
  replayedSteps: string[];
  /**
   * The run's **first** session, kept because everything written before DSP-79 means
   * this when it says "the session": a one-agent-node run has exactly one entry in
   * {@link sessions} and this is it, so those readers are unchanged. For a run with
   * several agent nodes it is the first node's, and it is not the whole answer â€”
   * {@link sessions} is.
   */
  sessionId: string | null;
  providerSessionId: string | null;
  /** Every session this run opened, in the order the nodes were first reached. */
  sessions: LiveSessionRef[];
}

/**
 * One provider session this run opened, and the node it belongs to.
 *
 * DSP-79. A run used to have one session and `LiveInspection` had one field for it,
 * which was the whole reason there was no handover: every node's prompt went into the
 * same conversation, so "the next step" was the same agent asked another question.
 * There is one of these per agent node the run reached.
 */
export interface LiveSessionRef {
  /** The node whose session this is. One session per agent node, not per visit. */
  readonly nodeId: string;
  readonly dspatchSessionId: string;
  readonly providerSessionId: string;
  readonly openedAtUtc: string;
  /** How many visits to the node sent a prompt into it. 1 unless a rework edge came back. */
  turns: number;
  /**
   * What this session reported costing, in cents, or `null` for **not established**.
   *
   * Per session rather than per run, because that is the granularity the provider
   * answers at and because a run now has several. `null` is never zero: the adapter's
   * `usageReporting` capability is `unknown` and a session that reported nothing has
   * not reported nought.
   */
  costCents: number | null;
}

/**
 * The run's cost, as the sum of what its sessions reported.
 *
 * `'unknown'` while no session has reported anything â€” which is the common case, and
 * is not zero. A run where one session reported and another did not sums what there
 * is; the per-session lines in {@link formatLiveInspection} are where a reader sees
 * that the total is partial.
 *
 * It exists because DSP-79 turned one session into several. Taking the first or the
 * last session's figure and calling it the run's would be a wrong number rather than a
 * missing one, and a wrong number about money is the worse of the two.
 */
export function recomputeRunCost(inspection: LiveInspection): void {
  let total: number | null = null;
  for (const session of inspection.sessions) {
    if (session.costCents !== null) {
      total = (total ?? 0) + session.costCents;
    }
  }
  if (total !== null) {
    inspection.cost = total;
  }
}

/** The first cents reading with a value, or `null` when none of them established one. */
function centsIn(readings: readonly UsageReading[]): number | null {
  for (const reading of readings) {
    if (reading.unit === 'cents' && reading.value !== null) {
      return reading.value;
    }
  }
  return null;
}

/**
 * What an agent node said, on its way out of the executor.
 *
 * `waitForTurn` has always collected this text and used it only to classify the
 * step. The chat binding shows it to the person who typed the mandate, so it
 * leaves here whole and unclassified: the caller decides what to do with it, and
 * an executor that summarised it would be deciding for the window.
 */
export interface LiveAgentReply {
  readonly nodeId: string;
  /** 1-based visit count, so a re-entered node is a separate reply. */
  readonly occurrence: number;
  /** May be empty: a turn cancelled before the model finished carries no message. */
  readonly text: string;
  /** The run's own terminal status, or `null` if it never reported one. */
  readonly terminalStatus: string | null;
  /**
   * What the agent was actually sent, whole.
   *
   * DSP-46 #1's second half. The reply has always travelled out of here; what the agent
   * was *told* did not, so a record could show an answer with no way to know what it was
   * an answer to â€” and with the role text now in the prompt, that is the only place the
   * role's arrival can be checked after the fact rather than asserted. Never summarised,
   * for the same reason `text` is not.
   */
  readonly prompt: string;
  /**
   * The role the drawing named for this node, as a reference rather than its prose.
   *
   * The prose is in `prompt`. This is the identity, so a reader can see that the step
   * ran as `project-work` from `docs/loop/roles/project-work.role.md` without reading
   * the prompt to find out. `null` for a node that names no role.
   */
  readonly role: { readonly id: string; readonly sourcePath: string } | null;
  /**
   * The provider session this step ran in.
   *
   * DSP-79 #1 asks for two consecutive agent nodes using two different sessions to be
   * *observable in the record*, and this is where a reader sees it: two replies, two
   * session ids. Without it a run where every step shared one conversation and a run
   * where each step is its own agent produce byte-identical records.
   */
  readonly sessionId: string;
}

/** Which step of which run is being briefed, for a prompt builder that writes one. */
export interface LivePromptStep {
  readonly runId: string;
  /** 1-based visit to this node. */
  readonly occurrence: number;
  /** The journal's sequence number for this call â€” the handoff's call-id. */
  readonly callId: number;
  /**
   * True when this step's agent is new to the run.
   *
   * `false` only on a revisit to the same node, which continues that node's own
   * session. A brief that repeated the whole mandate to an agent that wrote it an hour
   * ago would be noise; one that omitted it from a fresh agent would be a handover
   * that passed nothing.
   */
  readonly freshSession: boolean;
  /**
   * The route the run took to reach this step, or `null` at the entry (DSP-100).
   *
   * Passed straight through from {@link StepContext.arrivedBy} and shaped to match
   * `ChatStepIdentity.arrivedBy`, so the one caller that builds a chat prompt hands its
   * whole `step` over without unpacking it.
   */
  readonly arrivedBy: {
    readonly edgeId: string;
    readonly from: string;
    readonly label: string | null;
  } | null;
  /**
   * Which trailing sections the executor is going to append to whatever the builder
   * returns, so the builder's own text can stop promising ones that never arrive.
   *
   * See `ChatStepIdentity.attachments` in `loop-chat.ts` for DSP-91 #5 and the run it cost.
   */
  readonly attachments: {
    readonly receivedResults: boolean;
    readonly requiredResult: boolean;
    /** Whether the run's own account of what it changed is appended (DSP-99). */
    readonly runChange: boolean;
  };
}

export interface LiveExecutorOptions {
  readonly workspacePath: string;
  /**
   * Every root this run works with, the working directory first.
   *
   * Left out, the run has one root and {@link workspacePath} is it â€” which is what
   * every caller written before DSP-72 means and what the CLI still means. Supplied,
   * the roots reach the provider as `cwd` plus `dirs` and each one is snapshotted, so
   * a change in the second folder is measured rather than invisible.
   */
  readonly workingRoots?: readonly WorkingRoot[];
  readonly adapter: AgentAdapter;
  readonly modelRequested: string;
  /** Cursor reports a used model separately from the request. Optional on the interface. */
  readonly modelReported?: (sessionId: DspatchSessionId) => string | null;
  readonly now?: () => number;
  /**
   * Run the project's check for a gate.
   *
   * `note` is the gate step's own line into the run journal (DSP-51). A caller that
   * has to ask a person before it may start anything uses it to say so while the
   * asking is happening; a caller that just runs a command ignores it.
   */
  readonly runProjectTest?: (
    workspacePath: string,
    note: StepNote,
  ) => Promise<LiveCommandRecord>;
  readonly abortSignal?: AbortSignal;
  readonly inspection: LiveInspection;
  /**
   * Whether to read the working roots' file content for the before/after snapshots.
   *
   * DSP-91 #7. `true` â€” the default, and what every caller written before this card means â€”
   * is the behaviour the product has always had: the full bytes of every file under every
   * root, hashed, before and after every step. `false` is for a run whose drawing contains
   * no step that could write there, which {@link import('../shared/loop-graph').writeReachOf}
   * decides from the graph rather than from anything a person typed.
   *
   * The caller passes the reason as well, because a record that skipped the measurement must
   * say so: see {@link LiveInspection.rootsNote}.
   */
  readonly hashWorkingRoots?: boolean;
  readonly fallbackDeadlineMs?: number;
  /**
   * The step's own prompt, built by the caller.
   *
   * `step` arrived with DSP-79 and is what lets a caller write a *brief* rather than a
   * next turn in a conversation: with one session per agent node, the receiving agent
   * has no shared history, so the identity of the run and the step is something it has
   * to be told. A caller written before this takes `node` alone and is unchanged.
   */
  readonly promptFor?: (node: LoopNode, step: LivePromptStep) => string;
  /**
   * Called once per agent step whose provider turn was awaited, before the step's
   * product is decided. Not called when the adapter threw during the send: there
   * was no turn to report, and the fault's own detail is what says so.
   */
  readonly onAgentReply?: (reply: LiveAgentReply) => void;
  /**
   * Each thing the provider reports **while** an agent step is working.
   *
   * Separate from `onAgentReply`, which fires once the turn is over. This is the one
   * that makes a step legible as it happens, and the distinction is the point: a
   * caller wiring only the first gets exactly the behaviour this increment replaces.
   *
   * The executor supplies the step's address and the adapter's event; deciding what
   * a `tool_call` *means* is the window's business and is done in
   * `shared/loop-activity.ts`, which both the graph view and the chat read.
   */
  readonly onStepActivity?: (activity: StepActivity) => void;
  /**
   * Called with each gate command the moment it settles, so a caller can write it
   * to the run record while the run is still walking rather than reading
   * `inspection.commands` after it has ended. DSP-25 #4: a run that is interrupted
   * must still have recorded the commands it had already run.
   */
  readonly onCommand?: (command: LiveCommandRecord) => void;
}

function snapshotRef(snapshot: TreeSnapshot): LiveSnapshotRef {
  return {
    snapshotId: snapshotIdFor(snapshot),
    takenAtUtc: snapshot.takenAtUtc,
    fileCount: snapshot.files.length,
    files: snapshot.files,
  };
}

/**
 * Record what a step changed, and what the **run** has changed so far.
 *
 * Two different questions, and until a chat loop had a second agent node they had the same
 * answer, so one field answered both. DSP-45 adds `choose-check` after `work`, and that
 * exposed the conflation as a real defect: this function used to write the *step's* diff
 * straight into the inspection, so a second agent step that correctly changed nothing
 * overwrote the first step's measurement with three empty lists. The run record's changed,
 * added and removed files, the paths DSP-48 names in the ending sentence, and
 * `recordedSnapshotsFrom` all read those lists â€” so a run that really did change files
 * would have reported changing none, with the reason visible nowhere.
 *
 * The returned diff is the **step's**, because that is what decides the step's branch and
 * what its own sentence describes: *the project before this step and after it*. The
 * inspection's lists are the **run's**, from its first snapshot to the newest, because that
 * is what a person reading the record afterwards is asking about.
 *
 * `snapshotBefore` is written once and never overwritten, which it relied on being true
 * before and now needs to be: it is the run's origin, and diffing from anything later
 * would lose the first step's work again by a different route.
 */
function applyDiff(inspection: LiveInspection, before: TreeSnapshot, after: TreeSnapshot): TreeDiff {
  const stepDiff = diffSnapshots(before, after);
  if (inspection.snapshotBefore === null) {
    inspection.snapshotBefore = snapshotRef(before);
  }
  inspection.snapshotAfter = snapshotRef(after);
  const origin = inspection.snapshotBefore;
  const runDiff = diffSnapshots(
    { root: after.root, takenAtUtc: origin.takenAtUtc, files: origin.files },
    after,
  );
  inspection.changedFiles = runDiff.changed;
  inspection.addedFiles = runDiff.added;
  inspection.removedFiles = runDiff.removed;
  return stepDiff;
}

/**
 * A run's inspection before it has walked anything.
 *
 * `roots` defaults to the one root `workspacePath` names, so every caller written
 * before DSP-72 â€” the CLI, the editor's run, every test with a fake adapter â€” describes
 * exactly the run it described before, as a list of one.
 */
/**
 * Every root's tree, keyed by the root's path.
 *
 * One walk per root, taken at the same moment, which is what makes a per-root diff a
 * comparison rather than a collection of separately-timed observations. The cost is
 * linear in the number of roots a person opened, and a run with one root walks one
 * tree exactly as it did before DSP-72.
 */
function snapshotEveryRoot(
  inspection: LiveInspection,
  hashProject: boolean,
): ReadonlyMap<string, TreeSnapshot> {
  const snapshots = new Map<string, TreeSnapshot>();
  const walk = (root: string): TreeSnapshot =>
    // DSP-91 #7. An empty tree rather than a skipped step, so every caller below keeps
    // working and the per-root diffs come out empty instead of absent. `rootsNote` on the
    // inspection is where a reader is told nothing was measured; an empty list of files
    // must never be read here as a measurement that found nothing.
    hashProject ? snapshotTree(root) : { root, takenAtUtc: new Date().toISOString(), files: [] };
  for (const root of inspection.roots) {
    snapshots.set(root.path, walk(root.path));
  }
  if (!snapshots.has(inspection.workspacePath)) {
    // A run whose roots somehow do not include its own working copy still has to
    // measure the working copy: that is the snapshot every existing record line and
    // every step's sentence is about.
    snapshots.set(inspection.workspacePath, walk(inspection.workspacePath));
  }
  return snapshots;
}

/** The working copy's tree out of a set of per-root snapshots. */
function workingCopyIn(
  inspection: LiveInspection,
  snapshots: ReadonlyMap<string, TreeSnapshot>,
): TreeSnapshot {
  return (
    snapshots.get(inspection.workspacePath) ?? {
      root: inspection.workspacePath,
      takenAtUtc: new Date().toISOString(),
      files: [],
    }
  );
}

/**
 * Record what each root has changed since the run's first look at it.
 *
 * Per root, the same two questions `applyDiff` asks of the working copy: the origin is
 * written once and never overwritten, and the lists are the run's rather than the
 * step's. A root that a step did not touch keeps three empty lists, which is a
 * measurement and is the negative half of DSP-72 #3.
 */
function applyRootDiffs(
  inspection: LiveInspection,
  before: ReadonlyMap<string, TreeSnapshot>,
  after: ReadonlyMap<string, TreeSnapshot>,
): void {
  for (const root of inspection.roots) {
    const first = before.get(root.path);
    const latest = after.get(root.path);
    if (first === undefined || latest === undefined) {
      continue;
    }
    if (root.snapshotBefore === null) {
      root.snapshotBefore = snapshotRef(first);
    }
    root.snapshotAfter = snapshotRef(latest);
    const origin = root.snapshotBefore;
    const diff = diffSnapshots(
      { root: latest.root, takenAtUtc: origin.takenAtUtc, files: origin.files },
      latest,
    );
    root.changedFiles = diff.changed;
    root.addedFiles = diff.added;
    root.removedFiles = diff.removed;
  }
}

export function emptyInspection(
  workspacePath: string,
  modelRequested: string,
  roots: readonly WorkingRoot[] = workingRootsFrom(
    [workspacePath],
    workspacePath,
    process.platform === 'win32',
  ),
): LiveInspection {
  return {
    workspacePath,
    roots: roots.map((root) => ({
      name: root.name,
      path: root.path,
      primary: root.primary,
      snapshotBefore: null,
      snapshotAfter: null,
      changedFiles: [],
      addedFiles: [],
      removedFiles: [],
    })),
    rootsNote: describeUnobservedOutside(roots),
    modelRequested,
    modelReported: null,
    snapshotBefore: null,
    snapshotAfter: null,
    changedFiles: [],
    addedFiles: [],
    removedFiles: [],
    commands: [],
    usageReadings: [],
    usageError: null,
    cost: 'unknown',
    cancelled: false,
    replayedSteps: [],
    sessionId: null,
    providerSessionId: null,
    sessions: [],
  };
}

/**
 * The session id for one agent node of one run.
 *
 * Derived rather than generated, for the reason the adapter's `providerAgentIdFor`
 * is deterministic: the provider's agent id is a digest of this string, so a
 * reproducible session id is what makes a node's own agent findable again after the
 * process that opened it has gone. Readable on purpose â€” a person reading a record or
 * Cursor's own local store should be able to see which run and which step an agent
 * belonged to without a lookup table.
 *
 * Filename-safe, because {@link SessionConfig} says a provider may use it as a
 * directory name, and never starting `bc-`, which Cursor reads as a cloud run.
 */
export function stepSessionId(runId: string, nodeId: string): DspatchSessionId {
  const safe = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '-');
  return `dsp-session-${safe(runId)}--${safe(nodeId)}`;
}

/**
 * Refuse a live workspace that is, contains, or sits inside DSpatch.
 *
 * The own-repository guard exists because DSP-1 measured that an agent is not
 * confined to the folder it is given. A live writing run against DSpatch itself
 * is the ordinary mistake this increment must not make.
 */
export function refuseLiveWorkspace(workspacePath: string, appPath: string): string | null {
  const resolved = path.resolve(workspacePath);
  const found = findOwnRepository(resolved);
  if (found.kind !== 'unrelated') {
    return describeRefusal(resolved, found);
  }
  const ownRoot = ownRepositoryRoot(appPath);
  const contains = ownRepositoryInside(resolved, ownRoot);
  if (contains.kind === 'contains') {
    return describeContainingRefusal(resolved, contains);
  }
  if (contains.kind === 'undecidable') {
    return describeUndecidableContainment(resolved, contains);
  }
  return null;
}

/** A root a run may not work in, and the guard's own reason for refusing it. */
export interface RefusedRoot {
  readonly root: WorkingRoot;
  readonly reason: string;
}

/**
 * Refuse a run whose roots include DSpatch's own working copy, naming the root.
 *
 * **The run is refused, not the root.** DSP-71 left this decision open, and the answer
 * follows from why the guard exists at all: it is here because DSP-1 measured that the
 * agent is *not* confined to the folders it is given. Quietly dropping the offending
 * root and starting anyway would leave the agent free to reach that folder regardless,
 * so a refusal that only removed it from the list would refuse nothing while reading as
 * though it had protected something. It would also silently change the assignment â€” a
 * person who asked to port code from A into B and got a run over B alone has been given
 * a different job with no opportunity to disagree.
 *
 * **And the refusal names the root.** With five folders open, "this workspace contains
 * DSpatch" sends a person to look through five folders for the one that does. Every
 * offending root is named â€” the guard is checked against all of them rather than
 * stopping at the first â€” because finding one and fixing it, only to meet the same
 * message about the next, is the same walk twice.
 */
export function refuseLiveWorkingRoots(
  roots: readonly WorkingRoot[],
  appPath: string,
): { readonly refused: readonly RefusedRoot[]; readonly message: string } | null {
  const refused: RefusedRoot[] = [];
  for (const root of roots) {
    const reason = refuseLiveWorkspace(root.path, appPath);
    if (reason !== null) {
      refused.push({ root, reason });
    }
  }
  if (refused.length === 0) {
    return null;
  }
  const primary = primaryRootOf(roots);
  const opening =
    refused.length === 1
      ? `The working folder "${refused[0]?.root.name ?? ''}" cannot be worked in by a run, ` +
        `so nothing was started.`
      : `${String(refused.length)} of this run's ${String(roots.length)} working folders ` +
        `cannot be worked in, so nothing was started.`;
  const named = refused
    .map(
      (entry) =>
        `\u2022 ${entry.root.name}${entry.root.primary ? ' (the working directory)' : ''} \u2014 ` +
        `${entry.root.path}\n  ${entry.reason}`,
    )
    .join('\n\n');
  const remedy =
    roots.length === refused.length
      ? 'Open different folders, or run DSpatch from a copy of itself, and try again.'
      : `The other ${String(roots.length - refused.length)} ` +
        `${roots.length - refused.length === 1 ? 'folder is' : 'folders are'} fine. ` +
        'Remove the ones named above from the workspace and send again. DSpatch does not ' +
        'drop them for you: a run over fewer folders than you asked for is a different ' +
        'assignment, and it is yours to make.';
  return {
    refused,
    message: `${opening}\n\n${named}\n\n${remedy}${
      primary === null ? '' : `\n\nThe working directory would have been ${primary.path}.`
    }`,
  };
}

/**
 * How long a gate command may run before DSpatch stops it and says so.
 *
 * A bound rather than a guess at how long a build takes: fifteen minutes is longer
 * than any build or suite this product has been pointed at, and the point of the
 * number is that there is one. Before there was, a command that never returned
 * held the run open with no ending and no record of why â€” the same user-visible
 * failure as the hung gate W2 closed, reached by a different route and not closed
 * by W2's fix.
 */
export const DEFAULT_GATE_COMMAND_TIMEOUT_MS = 15 * 60_000;

/**
 * A bound in the largest unit that does not round it away.
 *
 * `Math.round(ms / 60_000)` was the whole of this, and below thirty seconds it
 * produced *"still running after 0 minutes"* â€” a sentence saying the command ran for
 * no time at all. Harmless at today's fifteen-minute default and not reachable from
 * the UI, but the plan is for this bound to become a per-node budget owned by the
 * graph editor, and the first person to draw a 45-second gate budget would read it.
 */
export function describeBound(ms: number): string {
  if (ms < 1000) {
    // Not "0 seconds", and not rounded up to one either: the number is smaller than
    // the smallest unit worth printing, so say that instead of naming a duration.
    return 'less than a second';
  }
  if (ms < 60_000) {
    const seconds = Math.round(ms / 1000);
    return `${String(seconds)} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) {
    return `${String(minutes)} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = ms / 3_600_000;
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded)} hour${rounded === 1 ? '' : 's'}`;
}

/**
 * What DSpatch says about a command it stopped for outrunning its bound.
 *
 * **It says what it asked for, not what it achieved.** The previous wording was
 * *"so DSpatch stopped it"*, unconditionally, and the Verifier of this run measured
 * what that costs: it made a descendant survive â€” a hanging child that had spawned a
 * launcher which exited, the shape of every tool that starts a daemon or a compile
 * server and returns â€” and confirmed with `Get-Process` that the process was still
 * alive and still ticking a heartbeat file *after* DSpatch had written that sentence.
 * In the case where the tree really died, the message was byte-identical. A statement
 * that is the same whether or not it is true is not evidence, and this product's whole
 * argument is that its records are.
 *
 * `killCommandTree` cannot justify the old claim either: it spawns `taskkill` and
 * never reads its exit code, deliberately, because a kill that failed must not stop
 * the run from reporting the fact the person actually needs. So the honest sentence
 * is the one the gate's own outer backstop forty lines below already writes â€” the
 * command *may still be running: check for it before starting another run* â€” and this
 * is that sentence, with the reason it may still be running named.
 *
 * Containing the tree properly (a Windows Job Object) is DSP-34 and is not this.
 */
export function describeStoppedCommand(input: {
  readonly timeoutMs: number;
  readonly stdout: string;
  readonly stderr: string;
}): string {
  const silent = input.stdout.trim() === '' && input.stderr.trim() === '';
  return (
    `The command was still running after ${describeBound(input.timeoutMs)}, so DSpatch asked ` +
    `the operating system to stop it and the children it could find. Whether every process is ` +
    `gone is not something DSpatch can see: one started through an intermediate that has ` +
    `already exited is not reached, so the command may still be running â€” check for it before ` +
    `starting another run. Nothing is known about whether your project builds or its tests ` +
    `pass â€” this is not a test failure and not a pass. ` +
    (silent
      ? 'It printed nothing at all before it was stopped, which on Windows is what a command ' +
        'waiting on a hidden dialog looks like: check that the Command field holds something ' +
        'the shell runs rather than something Windows opens.'
      : 'What it printed before it was stopped is kept below.')
  );
}

export function runNodeProjectTest(workspacePath: string): Promise<LiveCommandRecord> {
  const args = ['--test', 'test/duration.test.ts'];
  const startedAt = Date.now();
  const child = spawn(process.execPath, args, {
    cwd: workspacePath,
    windowsHide: true,
    env: process.env,
  });
  return finishCommand(
    child,
    `${process.execPath} ${args.join(' ')}`,
    workspacePath,
    startedAt,
    null,
    DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  );
}

/**
 * Gate command for a chat-loop run: exactly what the window's two fields held
 * when Send was pressed.
 *
 * **Not the suggestion.** `suggestBuildCommand` seeds the Command and Working
 * directory fields when a project opens, and the note beside them says nothing is
 * configured anywhere else. A gate that re-derived the suggestion instead runs
 * something the window never showed and the user cannot change â€” which is what
 * the first real chat-loop run did, on a C++/CMake project whose build is
 * `.\scripts\build-windows.ps1`. The working directory travels with the command
 * because a relative command means nothing without it, and because the window
 * presents them as one setting.
 *
 * `checkRunRequest` is the same rule the Run button applies to the same two
 * fields, so one field cannot be usable in one place and refused in the other. A
 * request that fails it starts no process and returns `notRun`. There is no
 * fallback to the suggestion: falling back would reintroduce the defect, and the
 * empty field is precisely the case where there is no suggestion to fall back to.
 */
/**
 * A command record for a command that never started, because DSpatch declined to start it.
 *
 * `no-command-configured` rather than `could-not-start`, and the distinction is the whole
 * point of the kind existing: nothing broke, nothing half-happened, and no process was
 * spawned. DSP-44 routes exactly this kind as a gate verdict the graph can carry, so a run
 * that declined to run something ends at a step saying nothing was checked instead of
 * asking a person to reconcile a machine that is working correctly.
 *
 * Exported because DSP-45 adds a second reason to arrive here â€” a proposed command the
 * user has not confirmed â€” and two functions building this shape separately would
 * eventually build it differently.
 */
export function commandNotRun(
  command: string,
  cwd: string,
  message: string,
): LiveCommandRecord {
  const line = command.trim();
  return {
    command: line,
    line: line === '' ? null : line,
    cwd: cwd.trim(),
    // No process, so no exit code. Inventing one here is precisely the defect that told
    // Niclas his C++ tests had failed.
    exitCode: null,
    signal: null,
    durationMs: 0,
    startedAtUtc: new Date().toISOString(),
    stdout: '',
    stderr: '',
    notRun: { kind: 'no-command-configured', message },
  };
}

export function runConfiguredProjectTest(
  command: string,
  cwd: string,
  timeoutMs: number | null = DEFAULT_GATE_COMMAND_TIMEOUT_MS,
): Promise<LiveCommandRecord> {
  const line = command.trim();
  const check = checkRunRequest(command, cwd);
  if (!check.ok) {
    return Promise.resolve(
      commandNotRun(
        command,
        cwd,
        check.message ?? 'DSpatch could not use the command field, and gave no reason.',
      ),
    );
  }
  const resolvedCwd = path.resolve(cwd.trim());
  const startedAt = Date.now();
  const child = spawn(line, {
    cwd: resolvedCwd,
    shell: true,
    windowsHide: true,
    env: process.env,
  });
  return finishCommand(child, `${describeShell()} ${line}`, resolvedCwd, startedAt, line, timeoutMs);
}

/**
 * Stop a command that outran its bound, and take its children with it.
 *
 * `taskkill /T /F` rather than `child.kill()` on Windows, because the gate spawns
 * through `cmd.exe`: killing the shell leaves whatever it started running, and the
 * whole reason this function exists is a case where the shell had handed the work
 * to something else. Best effort â€” a kill that fails must not stop the run from
 * reporting that the command did not finish, which is the fact the person needs.
 */
function killCommandTree(child: ReturnType<typeof spawn>): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {
        // Nothing to do: the record already says the command did not finish.
      });
    } else {
      // Not a process group: the child was not spawned detached, so this reaches
      // `sh` and may leave what `sh` started. Named rather than implied, and
      // unmeasured â€” nothing here has been run on Linux.
      child.kill('SIGKILL');
    }
  } catch {
    // Same. A process that could not be killed is reported, not hidden.
  }
}

/**
 * Wait for a spawned command, and survive one that never starts.
 *
 * **The `error` listener is not decoration.** Until it was added this function
 * listened for `close` alone. The Verifier of run `20260917-182500-gate18`
 * measured what that costs: a working directory that does not exist at spawn time
 * makes Node emit `error` even with `shell: true`, because it cannot start
 * `cmd.exe` in a missing directory â€” and with nothing listening that became an
 * **uncaught exception in the Electron main process** while this promise never
 * settled, so the gate never returned and the whole run hung. A run that cannot
 * start its command has to report that it cannot start its command.
 *
 * Both listeners stay registered and a settled flag decides, rather than one
 * listener being removed by the other: `error` and `close` can both fire, and the
 * first honest answer is the one to keep.
 */
function finishCommand(
  child: ReturnType<typeof spawn>,
  command: string,
  cwd: string,
  startedAt: number,
  /**
   * The user's own line, without the shell prefix `command` carries for display.
   *
   * Separate because `command` reads `cmd.exe /d /s /c npm test`, whose first word
   * always exists â€” resolving *that* would answer a question nobody asked and
   * would quietly turn the check below into a no-op. `null` for a command spawned
   * without a shell, where a missing executable already arrives as `error`.
   */
  rawLine: string | null,
  /**
   * How long the command may run, or `null` for no bound.
   *
   * Owned here rather than raced by the caller, because the caller holds a promise
   * and this function holds the child: only this side can stop the process. A race
   * upstream would report the timeout honestly and leave the command running.
   */
  timeoutMs: number | null,
): Promise<LiveCommandRecord> {
  const startedAtUtc = new Date(startedAt).toISOString();
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = (partial: LiveCommandRecord): void => {
      // The user's own line, added on every path out of this function rather than at each
      // of the four `settle` calls, so a record cannot be written without it by someone
      // adding a fifth.
      const record: LiveCommandRecord = { ...partial, line: rawLine };
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      resolve(record);
    };
    if (timeoutMs !== null) {
      timer = setTimeout(() => {
        killCommandTree(child);
        settle({
          command,
          cwd,
          // A stopped command has no exit code of its own. `signal` is left null
          // because on Windows there is none: `taskkill /T /F` ends the tree with
          // an ordinary exit code, so DSpatch's own record of having *asked* for the
          // stop is the only evidence there is â€” the same reason `evaluateTestVerdict`
          // checks `killedByDspatch` first, and the reason the message below claims
          // the request rather than the result.
          exitCode: null,
          signal: null,
          durationMs: Date.now() - startedAt,
          startedAtUtc,
          stdout,
          stderr,
          notRun: {
            kind: 'did-not-finish',
            message: describeStoppedCommand({ timeoutMs, stdout, stderr }),
          },
        });
      }, timeoutMs);
      timer.unref?.();
    }
    child.on('error', (error: Error) => {
      settle({
        command,
        cwd,
        // Not a fabricated code. There was no process, so there is no exit code,
        // and `null` is the only true value â€” inventing one here is precisely the
        // defect that told Niclas his C++ tests had failed.
        exitCode: null,
        signal: null,
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout,
        stderr,
        notRun: {
          kind: 'could-not-start',
          message:
            `DSpatch could not start the command in ${cwd}: ${error.message} The most ` +
            `common cause is that the working directory no longer exists. Nothing ran, ` +
            `so nothing about your project was checked.`,
        },
      });
    });
    child.on('close', (code, signal) => {
      // Consulted only after a non-zero exit, and never allowed to stop a command
      // from running. See `command-start.ts` for why this is the only honest and
      // locale-safe way to tell a mistyped command from a failing test suite.
      const unstartable =
        rawLine === null
          ? null
          : explainUnstartableCommand({ line: rawLine, cwd, exitCode: code, stderr });
      settle({
        command,
        cwd,
        exitCode: code,
        signal: signal === null ? null : String(signal),
        durationMs: Date.now() - startedAt,
        startedAtUtc,
        stdout,
        stderr,
        notRun: unstartable === null ? null : { kind: 'could-not-start', message: unstartable },
      });
    });
  });
}

/**
 * The reply, read for a named verdict and nothing else.
 *
 * A first-line SPEC_ERROR / BLOCKED still wins. Then a whole-line
 * `RESULT: <name>` naming one of the failures the node declares. Then a whole-line
 * `RESULT: <name>` that the node declared as an outcome. Missing or contradictory names
 * take the outcome the node's own `whenUndeclared` names, and plain success where the
 * node declares no outcomes at all â€” which is what leaves the duration fixture on its
 * success edge.
 *
 * **What the node states, not how it spelled anything (DSP-103).** Until 30 September
 * 2026 the fallback was the literal `unclear`, failing that the literal
 * `could-not-check`, so a drawing earned the graceful route by choosing a word. It now
 * comes from one declared field, and a node that states none stops the run exactly as a
 * node with neither spelling already did. The outcome this path produces is marked
 * `engine-fallback`, because it is DSpatch routing on an absence rather than the step's
 * own verdict, and the record and the next step are both told so.
 *
 * **A failure is read before a verdict, and that order is DSP-91 D3.** The 21 September
 * coordinator refused its assignment in prose and closed with `RESULT: BLOCKED`. Nothing
 * read it: the opening of the first line was prose, the node declared no outcomes, and the
 * fall-through was plain `success` â€” so the run took the success edge and handed a refusal
 * to the implementer as its brief, which is where "I should build a demonstration" came
 * from. A step that says it could not do the work must not be able to be read as having
 * done it.
 *
 * **Exported for DSP-104**, which is about the prompt describing this reader and getting
 * it wrong: a node with no outcomes was told an invented name could not be routed, and
 * the last line below reads it as plain success. The two halves of that card — what the
 * message says and what this does — are only worth asserting together, and the parts
 * this composes (`declaredOutcomeFrom`, `undeclaredReadableOutcome`) each give the right
 * answer already. The composition is the claim.
 */
export function productFromAssistantText(
  node: Pick<LoopNode, 'outcomes' | 'whenUndeclared' | 'declaredFailures'>,
  text: string,
): { readonly product: StepProduct; readonly why: string | null } {
  const declared = node.outcomes ?? [];
  const declaredFailures = node.declaredFailures ?? [];
  // Before every other reading, because every other reading of an empty string
  // returns "nothing declared", and the last of them used to mean success. DSP-57
  // #1: silence is never a successful result. `emptyReplyOutcome` takes the
  // drawing's own name for an unestablished result where there is one, and returns
  // null where there is none â€” and a step that delivered no outcome is a runtime
  // fault rather than a step that quietly passed.
  if (text.trim() === '') {
    const empty = emptyReplyOutcome(node);
    if (empty !== null) {
      return {
        product: { kind: 'outcome', outcome: empty.outcome, source: 'engine-fallback' },
        why: empty.why,
      };
    }
    return {
      product: {
        kind: 'runtime-fault',
        fault: 'no-outcome-delivered',
        detail:
          'The step finished its provider turn and wrote nothing at all. An empty reply ' +
          'is not a result and is not a success, and this step names no outcome for a ' +
          'result it could not establish, so there is nothing to route on. Anything the ' +
          'agent changed is still in the working copy, unchecked. Nothing was repeated.',
      },
      why: null,
    };
  }
  // Unconditional, as it has always been. A node whose graph draws no route for the word
  // stops the run with nothing to route on, which is the honest ending for a step that
  // said it was blocked; gating this on the declaration would turn that into a success.
  const failure = declaredFailureFrom(text);
  if (failure !== null) {
    return { product: { kind: 'declared-failure', failure }, why: null };
  }
  const failureLine = declaredFailureLineFrom(text, declaredFailures);
  if (failureLine !== null) {
    return {
      product: { kind: 'declared-failure', failure: failureLine },
      why:
        `The step declared RESULT: ${failureLine}, which this node draws as a failure rather ` +
        `than a verdict on the work. The run routes it as that failure and not as success.`,
    };
  }
  const named = declaredOutcomeFrom(text, declared);
  if (named !== null) {
    // Stated rather than left to a default (DSP-103 #9). This is the one path where an
    // agent really did name its own verdict, and it is the only path entitled to say so.
    return {
      product: { kind: 'outcome', outcome: named.outcome, source: 'step-declared' },
      why: named.why,
    };
  }
  const fallback = undeclaredReadableOutcome(node);
  if (fallback !== null) {
    return {
      product: { kind: 'outcome', outcome: fallback.outcome, source: 'engine-fallback' },
      why: fallback.why,
    };
  }
  return { product: { kind: 'success' }, why: null };
}

function remainingMs(
  deadlineAt: number | null,
  now: () => number,
  fallbackMs: number,
): number {
  if (deadlineAt === null) {
    return fallbackMs;
  }
  return Math.max(0, deadlineAt - now());
}

interface TurnWait {
  readonly finished: Promise<void>;
  readonly assistantText: () => string;
  readonly terminalStatus: () => string | null;
  readonly terminalError: () => string | null;
  readonly runId: () => string;
  readonly readings: () => UsageReading[];
}

/**
 * Follow one provider turn.
 *
 * **It used to handle three event types.** `assistant.message`, `usage` and
 * `run.finished` â€” nothing else â€” so a loop step collected one finished message and
 * forwarded it once, while the direct chat path streamed the whole time because
 * `chat-service.ts` handles the delta events. That is the whole of why a loop run
 * looked like an opaque call: the adapter was emitting `assistant.delta`,
 * `tool.started`, `tool.finished` and `approval.requested` into a listener that
 * dropped them on the floor.
 *
 * `onActivity` is where they go now. It is a hook rather than more fields on
 * `TurnWait` because these arrive *during* the turn and everything else here is read
 * *after* it; a getter for them would be a getter nobody could call in time.
 *
 * **`reasoning.delta` is deliberately absent.** It carries the model's private
 * thinking, and the assignment asks for available commentary and activity, not that.
 * Its absence here is the enforcement.
 */
function waitForTurn(
  adapter: AgentAdapter,
  sessionId: DspatchSessionId,
  onActivity?: (event: AgentEvent) => void,
): TurnWait {
  let assistantText = '';
  let terminalStatus: string | null = null;
  let terminalError: string | null = null;
  let runId = '';
  const readings: UsageReading[] = [];
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const unsubscribe = adapter.subscribe(sessionId, (event: AgentEvent) => {
    if (runId === '') {
      runId = event.dspatchRunId;
    }
    if (event.dspatchRunId !== runId) {
      return;
    }
    if (
      event.type === 'assistant.delta' ||
      event.type === 'tool.started' ||
      event.type === 'tool.finished' ||
      event.type === 'approval.requested'
    ) {
      onActivity?.(event);
    }
    if (event.type === 'assistant.message') {
      assistantText += event.text;
    }
    if (event.type === 'usage') {
      readings.push(...event.readings);
    }
    if (event.type === 'run.finished') {
      terminalStatus = event.status;
      terminalError = event.error?.message ?? null;
      unsubscribe();
      resolveFinished?.();
    }
  });

  return {
    finished,
    assistantText: () => assistantText,
    terminalStatus: () => terminalStatus,
    terminalError: () => terminalError,
    runId: () => runId,
    readings: () => readings,
  };
}

/**
 * What this step has to leave behind, told to the step.
 *
 * Only where the step is the one who files it. Where the graph names another node as
 * the writer the runner files the reply itself, and telling the agent to write a file
 * it is not responsible for is how you get two copies of one report â€” which is the
 * thing this whole card is trying not to build.
 *
 * The empty string where the graph asks for nothing, so a prompt is byte-identical to
 * what it was before this existed.
 */
export function describeRequiredResult(
  node: LoopNode,
  placement: StepContext['archive'],
): string {
  const produces = node.produces;
  if (produces === undefined || produces.form !== 'markdown-file' || placement === null) {
    return '';
  }
  if (placement.writtenByAnotherNode || placement.location === null) {
    return '';
  }
  return (
    `\n\n---\n\nThis step must leave its result as a Markdown file at ` +
    `${placement.location}. ${RESULT_STORAGE_NOTE} Write the file before you reply${
      produces.required
        ? '; the run checks that it is there and stops if it is not'
        : ''
    }. Write it once: what is in that file is the result, and it is what anyone reading ` +
    `this run afterwards will be shown.${produces.note === undefined ? '' : ` ${produces.note}`}\n`
  );
}

/**
 * Every path this run has moved, qualified by root where there is more than one root.
 *
 * Read off the per-root lists rather than the run-level ones, because a run may have
 * several roots and the run-level lists are the **working copy's**: a step that read code
 * in one folder and wrote it into another would otherwise be reported to the judging step
 * as having changed nothing. Both sets of lists are written by the same two functions from
 * the same pair of snapshots, so this is the same computation and not a second one — for a
 * single-root run it is the run-level lists, path for path.
 */
function runChangePathsOf(inspection: LiveInspection): readonly string[] {
  const relPaths = (root: LiveRootInspection): readonly string[] => [
    ...root.changedFiles.map((file) => file.relPath),
    ...root.addedFiles.map((file) => file.relPath),
    ...root.removedFiles.map((file) => file.relPath),
  ];
  if (inspection.roots.length === 0) {
    return [
      ...inspection.changedFiles.map((file) => file.relPath),
      ...inspection.addedFiles.map((file) => file.relPath),
      ...inspection.removedFiles.map((file) => file.relPath),
    ];
  }
  const several = inspection.roots.length > 1;
  return inspection.roots.flatMap((root) =>
    relPaths(root).map((rel) => (several ? `${root.name}/${rel}` : rel)),
  );
}

/**
 * What this run has changed so far, taken from the measurement the journal is written
 * from (DSP-99 #1).
 *
 * **The `hashedWorkingRoots` argument comes first for the reason the whole card exists.**
 * With the hashing skipped, `snapshotEveryRoot` builds empty trees, so both snapshot
 * identities are present and all three file lists are empty — and every test of "did
 * anything change" would read that as *nothing changed*. It is not: nothing was looked at.
 * Asking that question before touching the lists is what keeps an absence of measurement
 * from being rendered as a measurement, which would be a worse failure than the one
 * DSP-99 fixes, because it would sound authoritative.
 *
 * The second `not-measured` case is an ordinary early step: the origin snapshot exists
 * from the moment the first agent step begins, but there is no "after" until one has
 * finished, and a comparison needs two.
 */
export function runChangeAccountOf(
  inspection: LiveInspection,
  hashedWorkingRoots: boolean,
): RunChangeAccount {
  if (!hashedWorkingRoots) {
    // The run's own sentence for it, rather than a second wording of the same fact. It is
    // written by `describeUnobservedOutside` for the record, and the record's reader and
    // the step's reader are owed the same account.
    return { kind: 'not-measured', why: inspection.rootsNote };
  }
  const before = inspection.snapshotBefore;
  const after = inspection.snapshotAfter;
  if (before === null || after === null) {
    return {
      kind: 'not-measured',
      why:
        'No step of this run has finished yet, so there is no pair of snapshots to compare ' +
        'and nothing has been measured either way.',
    };
  }
  return {
    kind: 'measured',
    snapshotBefore: before.snapshotId,
    snapshotAfter: after.snapshotId,
    // When each walk actually happened, carried on the snapshot since long before this
    // card: `snapshotTree` stamps it at the moment it reads the tree, and `snapshotRef`
    // keeps it. So the step is told two real instants rather than "since the run started",
    // and neither of them is invented here or taken from the clock as the prompt is built.
    observedFromUtc: before.takenAtUtc,
    observedToUtc: after.takenAtUtc,
    paths: runChangePathsOf(inspection),
  };
}

function describeLimits(limits: StepLimits): string {
  const parts: string[] = [];
  if (limits.maxMinutes !== undefined) {
    parts.push(`${String(limits.maxMinutes)} minutes`);
  }
  if (limits.maxCalls !== undefined) {
    parts.push(`${String(limits.maxCalls)} calls`);
  }
  return parts.length === 0 ? 'the executor fallback deadline' : parts.join(', ');
}

/**
 * A live executor. Agent nodes call the injected adapter; nothing else does.
 */
export function createLiveExecutor(options: LiveExecutorOptions): StepExecutor {
  const now = options.now ?? (() => Date.now());
  // Defaulting to true keeps every caller written before DSP-91 byte-for-byte what it was.
  const hashRoots = options.hashWorkingRoots ?? true;
  const fallbackMs = options.fallbackDeadlineMs ?? FALLBACK_DEADLINE_MS;
  const completed = new Map<string, StepExecution>();
  const inspection = options.inspection;
  // The roots as a value, resolved once. The inspection already carries them for the
  // record's sake; taking the option when it is given and the inspection otherwise
  // means a caller cannot hand the provider one list and the record another.
  const rootsOfRun: readonly WorkingRoot[] =
    options.workingRoots ??
    (inspection.roots.length > 0
      ? inspection.roots.map((root) => ({
          name: root.name,
          path: root.path,
          primary: root.primary,
        }))
      : workingRootsFrom([options.workspacePath], options.workspacePath, process.platform === 'win32'));
  /**
   * One provider session per agent node, opened the first time the node is reached.
   *
   * **This is the handover, and it is the whole of DSP-79's first half.** Before it,
   * one session was opened for the run and every node's prompt was sent into it, so
   * the drawing's second step was the first agent asked another question: a handover
   * that passed nothing and one that worked would have produced identical records.
   * Each node's agent now knows only what its own brief told it.
   *
   * **Keyed by node, not by visit.** A rework edge that comes back to a node continues
   * that node's own conversation, which is what a rework round is â€” the same
   * implementer, told what the review said. Keying by visit would send the second
   * attempt to an agent that had never made the first.
   *
   * Sessions coexist idle for the length of the run. Measured on this machine with no
   * provider turn (probe `logs/016-implementer/probe-sessions.ts`): three local
   * sessions created in one process, three distinct provider agents, no child process,
   * about 1.2 MB of RSS each after the SDK is loaded, and each still addressable after
   * the others existed. That is the planner's restated assumption 2 â€” coexist idle and
   * resumable, not run at once â€” and it holds.
   */
  const sessions = new Map<string, SessionHandle>();

  const remember = (context: StepContext, execution: StepExecution): StepExecution => {
    completed.set(`${context.node.id}:${String(context.occurrence)}`, execution);
    return execution;
  };

  return async (context: StepContext): Promise<StepExecution> => {
    const key = `${context.node.id}:${String(context.occurrence)}`;
    const previous = completed.get(key);
    if (previous !== undefined) {
      inspection.replayedSteps.push(key);
      return previous;
    }

    const { node } = context;

    if (node.kind === 'human') {
      return remember(context, {
        product: {
          kind: 'awaiting-human',
          question: node.purpose ?? `"${node.id}" needs a person before the run can continue.`,
        },
        summary: 'No provider turn: this is a human step. Files and history were left as they are.',
        providerTurns: 0,
      });
    }

    if (node.kind === 'router') {
      const first = node.outcomes?.[0];
      return remember(context, {
        // `router-branch`, not `step-declared` (DSP-103 #9): no agent was asked and no
        // reply was read, so the branch is the drawing's own and the record says that.
        product:
          first === undefined
            ? { kind: 'success' }
            : { kind: 'outcome', outcome: first, source: 'router-branch' },
        summary:
          first === undefined
            ? 'No provider turn: a router with no declared outcome finished on success.'
            : `No provider turn: the router took its first declared outcome, "${first}".`,
        providerTurns: 0,
      });
    }

    if (node.kind === 'gate') {
      const runTest = options.runProjectTest ?? runNodeProjectTest;
      // Raced against the step's own deadline, the way the agent branch below
      // races the provider turn. This branch used to be a bare `await runTest(â€¦)`
      // with nothing beside it, so `StepContext.deadlineAt` â€” which the graph
      // declares and the runner computes â€” was simply not enforced for a gate: the
      // runner never regained control to check it. A command that did not return
      // held the run open with no ending, no output and no window.
      //
      // The inner bound in `runConfiguredProjectTest` is the one that stops the
      // process; this is the backstop that stops the *run* from waiting on any
      // injected `runTest` that never settles, including one with no bound of its
      // own. Both are needed: only the spawner can kill, and only the executor can
      // decline to wait.
      const gateWaitMs = remainingMs(context.deadlineAt, now, fallbackMs);
      const abandoned = Symbol('gate-command-did-not-finish');
      let gateTimer: ReturnType<typeof setTimeout> | null = null;
      const raced = await Promise.race([
        runTest(options.workspacePath, context.note),
        new Promise<typeof abandoned>((resolve) => {
          gateTimer = setTimeout(() => resolve(abandoned), gateWaitMs);
          gateTimer.unref?.();
        }),
      ]);
      if (gateTimer !== null) {
        clearTimeout(gateTimer);
      }
      const command: LiveCommandRecord =
        raced === abandoned
          ? {
              command: `(the gate "${node.id}" command)`,
              cwd: options.workspacePath,
              exitCode: null,
              signal: null,
              durationMs: gateWaitMs,
              startedAtUtc: new Date(now() - gateWaitMs).toISOString(),
              stdout: '',
              stderr: '',
              notRun: {
                kind: 'did-not-finish',
                message:
                  `The gate's command had not come back against ${describeLimits(context.limits)}, ` +
                  `so DSpatch stopped waiting for it. Nothing is known about whether your ` +
                  `project builds or its tests pass. The command may still be running: check ` +
                  `for it before starting another run.`,
              },
            }
          : raced;
      inspection.commands.push(command);
      options.onCommand?.(command);
      // The state the command ran against, before it is overwritten below.
      //
      // DSP-45 #5. Not a second snapshot taken for this: the run's `snapshotAfter` at the
      // moment the gate is entered *is* the tree the command was handed, because the step
      // before the gate ended by recording it and nothing between them writes. Comparing
      // it with the tree afterwards is the only way to say *your check changed the thing
      // it was checking*, which for a CMake project is the difference between "the tests
      // pass" and "the build directory this was measured from no longer exists".
      const ranAgainst = inspection.snapshotAfter;
      const afterByRoot = snapshotEveryRoot(inspection, hashRoots);
      const after = workingCopyIn(inspection, afterByRoot);
      // A gate's command can write into any root â€” a build in one, a generated file in
      // another â€” so the per-root lists are updated here too. Each root diffs from the
      // origin it already holds; a root first seen at a gate takes the current tree as
      // its origin, which is what the run-level fields two lines below do as well.
      applyRootDiffs(inspection, afterByRoot, afterByRoot);
      if (inspection.snapshotBefore === null) {
        inspection.snapshotBefore = snapshotRef(after);
      }
      inspection.snapshotAfter = snapshotRef(after);
      // `null` where either identity is missing, and `null` means *not established*. A
      // gate that could not hash one side of the comparison must not report "unchanged",
      // which is the one reading that would let a self-modifying check pass unremarked.
      const changedWhileChecking: boolean | null =
        ranAgainst === null || command.notRun !== null
          ? null
          : ranAgainst.snapshotId !== snapshotIdFor(after);
      const selfModified =
        changedWhileChecking === true
          ? ` This command changed the working copy while it ran (${ranAgainst?.snapshotId ?? 'unknown'} ` +
            `â†’ ${snapshotIdFor(after)}), so what it measured is not what it left behind. ` +
            `That is an observation and not a judgement: many builds write into their own ` +
            `tree. It matters because the result below describes the state before those ` +
            `writes.`
          : '';
      // A gate that started no process has produced no verdict on the project, so
      // it may not return `pass` or `fail`. What it returns instead depends on
      // *why*, and DSP-44 moves exactly one of the three reasons.
      //
      // **"There was nothing to run" is a verdict, and the graph may route it.**
      // A project whose check nobody has worked out is an ordinary state, not a
      // broken machine, and `stop-and-reconcile` is what a person does when
      // something might have half-happened. Nothing half-happened: no process
      // started. Asking for reconciliation here teaches people that DSpatch's
      // reconciliation messages can be ignored, which is expensive for the ones
      // that matter.
      //
      // **The other two stay faults**, because in those something really did break
      // and the step's real outcome is genuinely unknown: a command that could not
      // be started may have started nothing or may have started something the
      // shell then lost, and one that did not finish may still be running.
      //
      // Gated on the node's own declaration rather than applied to every gate, so a
      // graph that draws no `not-verified` edge â€” `dspatch-live-duration`, and every
      // graph written before today â€” still stops rather than silently walking on
      // from a check that did not happen.
      const notVerified =
        command.notRun?.kind === 'no-command-configured'
          ? notVerifiedOutcome(node.outcomes ?? [])
          : null;
      if (command.notRun !== null && notVerified !== null) {
        return remember(context, {
          product: { kind: 'outcome', outcome: notVerified, source: 'gate-verdict' },
          summary:
            `No provider turn and no command: ${command.notRun.message} This is the gate's ` +
            `"${notVerified}" verdict, not a pass and not a failure â€” nothing is known about ` +
            `whether the project builds or its tests pass, and anything the agent changed is ` +
            `still in the working copy, unchecked. Snapshot ${snapshotIdFor(after)}. Files ` +
            `were left as they are.`,
          providerTurns: 0,
        });
      }
      if (command.notRun !== null) {
        // Two states, not one. "Nothing was configured to run" is a gap in what the
        // user told DSpatch; "there was a command and it would not start" is a fault
        // in the machinery or the environment. Both mean the project was not tested,
        // and merging them would put the reader to work finding out which.
        const opening =
          command.notRun.kind === 'could-not-start'
            ? `The gate "${node.id}" could not start the command it was given, so this run ` +
              `says nothing about whether the project builds or its tests pass â€” it is not ` +
              `a test failure.`
            : command.notRun.kind === 'did-not-finish'
              ? `The gate "${node.id}" started its command and it did not finish, so this run ` +
                `says nothing about whether the project builds or its tests pass â€” it is ` +
                `neither a pass nor a test failure.`
              : // Reachable only on a graph that declares no `not-verified` outcome for
                // this gate, since one that does took the branch above. Saying so is
                // the useful half: the reader's next question is why an ordinary state
                // stopped the run, and the answer is in the drawing rather than in the
                // project.
                `The gate "${node.id}" ran no command, so this run says nothing about whether ` +
                `the project builds or its tests pass â€” it is not a test failure. This ` +
                `drawing gives "${node.id}" no "${NOT_VERIFIED_OUTCOME}" outcome to route ` +
                `that through, so the run stops here instead of ending at a step that says ` +
                `nothing was checked.`;
        return remember(context, {
          product: {
            kind: 'runtime-fault',
            // A command stopped for outrunning its bound is a spent bound, not a
            // missing answer, and the runner words the two differently.
            fault: command.notRun.kind === 'did-not-finish' ? 'step-timed-out' : 'no-outcome-delivered',
            detail:
              `${opening} ${command.notRun.message} Anything the agent changed is still in ` +
              `the working copy, unchecked.`,
          },
          summary:
            `No provider turn and no command: ${command.notRun.message} Snapshot ` +
            `${snapshotIdFor(after)}. Files were left as they are.`,
          providerTurns: 0,
        });
      }
      const passed = command.exitCode === 0;
      return remember(context, {
        // A gate's own verdict, from an exit code (DSP-103 #9). Recorded as the gate's so
        // that a step handed this result is not told an agent declared "pass".
        product: { kind: 'outcome', outcome: passed ? 'pass' : 'fail', source: 'gate-verdict' },
        summary:
          `No provider turn. Ran ${command.command} in ${command.cwd}; exit ` +
          `${String(command.exitCode)}. Snapshot ${snapshotIdFor(after)}.${selfModified}`,
        providerTurns: 0,
      });
    }

    if (node.kind === 'terminal') {
      return remember(context, {
        product: { kind: 'success' },
        summary: 'No provider turn: a terminal is the runner stopping, not work.',
        providerTurns: 0,
      });
    }

    if (node.kind === 'external') {
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail: `This increment does not run external nodes. "${node.id}" was not called.`,
        },
        summary: 'No provider turn: an external node is out of this call.',
        providerTurns: 0,
      });
    }

    // Agent: the only kind that may reach the adapter.
    const reusedSession = sessions.has(node.id);
    const waitMs = remainingMs(context.deadlineAt, now, fallbackMs);
    if (waitMs === 0 || options.abortSignal?.aborted === true) {
      inspection.cancelled = true;
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: options.abortSignal?.aborted === true ? 'no-outcome-delivered' : 'step-timed-out',
          detail:
            options.abortSignal?.aborted === true
              ? `The operator cancelled before "${node.id}" started. Files were left as they are.`
              : `"${node.id}" had no time left against ${describeLimits(context.limits)} before it started.`,
        },
        summary: 'The agent was not started. Nothing was replayed.',
        providerTurns: 0,
      });
    }

    let session = sessions.get(node.id);
    let sessionRef = inspection.sessions.find((entry) => entry.nodeId === node.id);
    if (session === undefined) {
      session = await options.adapter.startSession({
        provider: 'cursor',
        dspatchSessionId: stepSessionId(context.runId, node.id),
        modelRequested: options.modelRequested,
        workspacePath: options.workspacePath,
        // Every root of the run, working directory first. One root produces the same
        // single-folder session as before; the adapter omits `dirs` for it, because the
        // provider treats a merged list of one as no list.
        workspacePaths: providerRootPathsFor(rootsOfRun),
      });
      sessions.set(node.id, session);
      sessionRef = {
        nodeId: node.id,
        dspatchSessionId: session.dspatchSessionId,
        providerSessionId: session.providerSessionId,
        openedAtUtc: new Date(now()).toISOString(),
        turns: 0,
        costCents: null,
      };
      inspection.sessions.push(sessionRef);
      if (inspection.sessionId === null) {
        inspection.sessionId = session.dspatchSessionId;
        inspection.providerSessionId = session.providerSessionId;
      }
    }
    if (sessionRef !== undefined) {
      sessionRef.turns += 1;
    }
    const openSession = session;

    const beforeByRoot = snapshotEveryRoot(inspection, hashRoots);
    const before = workingCopyIn(inspection, beforeByRoot);
    if (inspection.snapshotBefore === null) {
      inspection.snapshotBefore = snapshotRef(before);
    }

    // Who the activity below belongs to. Carried once here rather than rebuilt at
    // each emission, so the graph view, the chat and the step they are both about
    // cannot end up with three different ideas of which step is speaking.
    const address = {
      runId: context.runId,
      nodeId: node.id,
      occurrence: context.occurrence,
    };
    const emit = options.onStepActivity;
    const turn = waitForTurn(options.adapter, openSession.dspatchSessionId, (event) => {
      if (emit === undefined) {
        return;
      }
      if (event.type === 'assistant.delta') {
        if (event.text !== '') {
          emit({ ...address, atUtc: event.at, kind: 'reply-text', text: event.text });
        }
        return;
      }
      if (event.type === 'tool.started') {
        emit({
          ...address,
          atUtc: event.at,
          kind: 'tool-started',
          callId: event.toolCallId,
          name: event.name,
          summary: describeToolActivity(event.name, 'started', event.rawProviderEvent).summary,
        });
        return;
      }
      if (event.type === 'tool.finished') {
        const described = describeToolActivity(event.name, event.status, event.rawProviderEvent);
        emit({
          ...address,
          atUtc: event.at,
          kind: 'tool-finished',
          callId: event.toolCallId,
          name: event.name,
          status: event.status,
          summary: described.summary,
          detail: described.detail,
        });
        return;
      }
      if (event.type === 'approval.requested') {
        emit({
          ...address,
          atUtc: event.at,
          kind: 'awaiting-approval',
          summary: event.request.summary,
        });
      }
    });
    // What the graph says this step receives, and what it must leave (DSP-74, DSP-75).
    //
    // Appended to whatever the caller's prompt builder produced rather than folded into
    // it, so the one place a handover is described stays one place: the chat binding,
    // the editor's Run and the CLI all get the same sentences for the same graph, and a
    // caller that has never heard of results is not asked to learn.
    //
    // A received file is **named, not quoted**. The file is the canonical body, and
    // pasting it into the prompt would make a second copy that can disagree with it â€”
    // the exact failure this card is about, one layer up.
    //
    // Every trailing section is built **before** the head, so what the head promises and
    // what the message carries are one decision rather than two rules that have to agree
    // (DSP-91 #5). A predicate beside each section could drift from it; an empty string
    // cannot.
    //
    // The run's own account of what it changed is the third of them (DSP-99), and it sits
    // next to the received results deliberately: the pair is an agent's claim about its
    // work beside DSpatch's measurement of the folders, which is what makes a
    // disagreement between them visible to the step that has to judge the work. The
    // figures have existed since the first snapshot — they are the journal's "Changed:"
    // line — and until now they reached nobody's prompt, so on 22 September a reviewer
    // read `git status`, found two inventory files two earlier runs had left uncommitted
    // in the same folder, and reported them as this run's delivery.
    const receivedText = describeReceivedResults(context.received);
    const requiredText = describeRequiredResult(node, context.archive);
    // What this step was **actually** handed, not what its node declares (DSP-100). An
    // arriving edge can now decide the handover, so a step that receives an account of
    // somebody's work by way of the edge is owed the run's measurement beside it for the
    // same reason a `consumes` step is, and a step handed nothing on this route is not.
    const changeText = carriesRunChange(
      node,
      context.received.map((result) => result.nodeId),
    )
      ? describeRunChange(runChangeAccountOf(inspection, hashRoots))
      : '';
    const arrival = context.arrivedBy ?? null;
    const prompt =
      (options.promptFor ?? (() => LIVE_DURATION_PROMPT))(node, {
        runId: context.runId,
        occurrence: context.occurrence,
        callId: context.callId,
        freshSession: !reusedSession,
        arrivedBy:
          arrival === null
            ? null
            : { edgeId: arrival.edgeId, from: arrival.from, label: arrival.label },
        attachments: {
          receivedResults: receivedText !== '',
          requiredResult: requiredText !== '',
          runChange: changeText !== '',
        },
      }) +
      receivedText +
      changeText +
      requiredText;
    // Announced before `send`, because the interval this increment exists for is the
    // one *before* the first provider event â€” the few seconds, or minutes, where a
    // step is genuinely running and nothing has come back. Without an opened step
    // there is nothing for the status line to be about, and "nothing has started" and
    // "something started and has said nothing" would read identically.
    emit?.({
      ...address,
      atUtc: new Date(now()).toISOString(),
      kind: 'step-started',
      roleId: node.role?.id ?? null,
      roleSourcePath: node.role?.source.path ?? null,
    });

    let timedOut = false;
    let aborted = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = (): void => {
      aborted = true;
      void options.adapter.cancel(openSession.dspatchSessionId).catch(() => {
        // Cancel is best-effort. The files stay either way.
      });
    };
    options.abortSignal?.addEventListener('abort', onAbort, { once: true });

    try {
      await options.adapter.send(openSession.dspatchSessionId, prompt);
      await Promise.race([
        turn.finished,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            timedOut = true;
            void options.adapter.cancel(openSession.dspatchSessionId).catch(() => {
              // Same as operator cancel: leave the files, do not wait forever.
            });
            resolve();
          }, waitMs);
        }),
      ]);
    } catch (error) {
      const afterByRoot = snapshotEveryRoot(inspection, hashRoots);
      const after = workingCopyIn(inspection, afterByRoot);
      applyDiff(inspection, before, after);
      applyRootDiffs(inspection, beforeByRoot, afterByRoot);
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'executor-threw',
          detail: `The adapter failed during "${node.id}": ${
            error instanceof Error ? error.message : String(error)
          }.`,
        },
        summary: `Provider contact failed. Snapshot after: ${snapshotIdFor(after)}. Files were not reset.`,
        providerTurns: 1,
      });
    } finally {
      if (timer !== null) {
        clearTimeout(timer);
      }
      options.abortSignal?.removeEventListener('abort', onAbort);
    }

    const afterByRoot = snapshotEveryRoot(inspection, hashRoots);
    const after = workingCopyIn(inspection, afterByRoot);
    const diff = applyDiff(inspection, before, after);
    // Every root, not only the working copy. A step that read code in one root and
    // wrote it into another changed nothing measurable in `diff` above, and that is
    // precisely the assignment DSP-72 exists for.
    applyRootDiffs(inspection, beforeByRoot, afterByRoot);
    // Before the branches below, so that a cancelled, timed-out or faulted turn
    // still hands over whatever the agent had said. Its own account of what it did
    // to the project is most useful precisely when the run did not end cleanly.
    options.onAgentReply?.({
      nodeId: node.id,
      occurrence: context.occurrence,
      text: turn.assistantText(),
      terminalStatus: turn.terminalStatus(),
      prompt,
      role:
        node.role === undefined
          ? null
          : { id: node.role.id, sourcePath: node.role.source.path },
      sessionId: openSession.dspatchSessionId,
    });
    inspection.modelReported = options.modelReported?.(openSession.dspatchSessionId) ?? inspection.modelReported;
    const turnReadings = turn.readings();
    inspection.usageReadings.push(...turnReadings);
    // Against this step's own session. A reading that arrived during one node's turn
    // is that node's, and summing it into the run happens in one place.
    if (sessionRef !== undefined) {
      const cents = centsIn(turnReadings);
      if (cents !== null) {
        sessionRef.costCents = cents;
      }
    }
    recomputeRunCost(inspection);

    if (timedOut || aborted) {
      inspection.cancelled = true;
      const changed = diff.changed.map((file) => file.relPath).join(', ') || 'none';
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: timedOut ? 'step-timed-out' : 'no-outcome-delivered',
          detail: timedOut
            ? `"${node.id}" outran ${describeLimits(context.limits)} and was cancelled. ` +
              `Changed files left as they are: ${changed}. The step was not replayed.`
            : `The operator cancelled "${node.id}". Changed files left as they are: ${changed}. ` +
              `The step was not replayed.`,
        },
        summary:
          `Cancelled. Snapshot before ${snapshotIdFor(before)}, after ${snapshotIdFor(after)}. ` +
          `Files were not reset.`,
        providerTurns: 1,
      });
    }

    const status = turn.terminalStatus();
    if (status === 'error' || status === null) {
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail:
            `"${node.id}" ended without a usable outcome` +
            (turn.terminalError() === null ? '.' : `: ${turn.terminalError()}`),
        },
        summary: `No routable product. Snapshot after ${snapshotIdFor(after)}. Files were not reset.`,
        providerTurns: 1,
      });
    }

    if (status === 'cancelled') {
      inspection.cancelled = true;
      return remember(context, {
        product: {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail: `"${node.id}" was cancelled by the provider. Files were left as they are.`,
        },
        summary: `Cancelled. Snapshot after ${snapshotIdFor(after)}.`,
        providerTurns: 1,
      });
    }

    const declared = productFromAssistantText(node, turn.assistantText());
    const corroboration = describeSnapshotChange({
      changedFiles: diff.changed.length,
      addedFiles: diff.added.length,
      removedFiles: diff.removed.length,
      paths: [
        ...diff.changed.map((file) => file.relPath),
        ...diff.added.map((file) => file.relPath),
        ...diff.removed.map((file) => file.relPath),
      ],
    });
    // Which agent this was, said in the step's own line rather than left to be worked
    // out from two session ids. The old sentence here â€” *"reused the provider session
    // already open for this run; it is not an independent judge of earlier steps"* â€”
    // was true of every step after the first, and it is the sentence this card exists
    // to stop being true. The reused case has not disappeared, it has narrowed: a node
    // revisited on a rework edge continues its **own** conversation, which is what a
    // rework round is.
    const sessionNote = reusedSession
      ? ` This step continued "${node.id}"'s own session (${openSession.dspatchSessionId}), ` +
        `visit ${String(context.occurrence)}, so it still has what it did on its earlier ` +
        `visits to this node and nothing from any other node.`
      : ` This step ran in its own session (${openSession.dspatchSessionId}), opened for ` +
        `"${node.id}". It was given the brief above and has no history of the run's other ` +
        `steps, so anything it needed had to be in that brief.`;
    const changed = diff.changed.map((file) => `${file.relPath} ${file.beforeSha256.slice(0, 16)}â†’${file.afterSha256.slice(0, 16)}`);
    // The reply, whole, as the body of this step's result â€” handed over once, and only
    // where the runner is the one filing it.
    //
    // It is the same string `onAgentReply` above carries to the window, so the result
    // that is stored and the result that is shown are the same characters rather than
    // two renderings that have to be kept in step by hand. For a node that files its
    // own Markdown file the runner reads that file instead, and nothing is sent from
    // here: there the file is the body, and a second body offered beside it is exactly
    // the disagreement worth making impossible.
    const filesItsOwn =
      node.produces?.form === 'markdown-file' && context.archive?.writtenByAnotherNode !== true;
    const resultBody =
      node.produces === undefined || node.produces.form === 'none' || filesItsOwn
        ? undefined
        : turn.assistantText();
    return remember(context, {
      product: declared.product,
      ...(resultBody === undefined ? {} : { resultBody }),
      summary:
        `One provider turn. Requested ${options.modelRequested}, reported ` +
        `${inspection.modelReported ?? 'unknown'}. Snapshot ${snapshotIdFor(before)} â†’ ` +
        `${snapshotIdFor(after)}. Changed: ${changed.length > 0 ? changed.join(', ') : 'none'}.` +
        (declared.why === null ? '' : ` ${declared.why}`) +
        ` ${corroboration}` +
        sessionNote,
      providerTurns: 1,
    });
  };
}

export async function readLiveUsage(
  adapter: AgentAdapter,
  sessionId: DspatchSessionId,
  inspection: LiveInspection,
): Promise<void> {
  try {
    const readings = await adapter.readUsage({ of: 'session', dspatchSessionId: sessionId });
    inspection.usageReadings.push(...readings);
    const cents = centsIn(readings);
    const session = inspection.sessions.find((entry) => entry.dspatchSessionId === sessionId);
    if (cents !== null) {
      if (session === undefined) {
        inspection.cost = cents;
      } else {
        session.costCents = cents;
      }
    }
    recomputeRunCost(inspection);
  } catch (error) {
    inspection.usageError =
      error instanceof Error
        ? error.message
        : String(error);
    // Only when nothing has been established. One session's usage call failing must
    // not erase what the others reported â€” that would turn a partial figure into a
    // missing one, and `usageError` beside the sum is what says it is partial.
    recomputeRunCost(inspection);
    if (inspection.sessions.every((session) => session.costCents === null)) {
      inspection.cost = 'unknown';
    }
  }
}

export function formatLiveInspection(inspection: LiveInspection): string {
  const changed =
    inspection.changedFiles.length === 0
      ? '(none)'
      : inspection.changedFiles
          .map(
            (file) =>
              `${file.relPath} ${file.beforeSha256.slice(0, 16)}â†’${file.afterSha256.slice(0, 16)} ` +
              `(${String(file.beforeBytes)}â†’${String(file.afterBytes)} bytes)`,
          )
          .join('\n            ');
  const commands =
    inspection.commands.length === 0
      ? '(none)'
      : inspection.commands
          .map((command) =>
            command.notRun === null
              ? `${command.command}  exit=${String(command.exitCode)}  ${String(command.durationMs)}ms`
              : `(${command.notRun.kind}: ${command.notRun.message})`,
          )
          .join('\n            ');
  // One block per root, and the run-level lines below still describe the working copy.
  // A run with one root prints one root line and reads as it always did.
  const roots = inspection.roots.map((root) => {
    const counts =
      `changed=${String(root.changedFiles.length)} ` +
      `added=${String(root.addedFiles.length)} removed=${String(root.removedFiles.length)}`;
    return (
      `${root.name}${root.primary ? ' (working directory)' : ''}  ${root.path}\n` +
      `            ${counts}  snap ${root.snapshotBefore?.snapshotId ?? '(none)'}` +
      `\u2192${root.snapshotAfter?.snapshotId ?? '(none)'}`
    );
  });
  return [
    `workspace   ${inspection.workspacePath}`,
    `roots       ${roots.length === 0 ? '(none)' : roots.join('\n            ')}`,
    `outside     ${inspection.rootsNote}`,
    `model req   ${inspection.modelRequested}`,
    `model used  ${inspection.modelReported ?? 'unknown (not reported)'}`,
    // One line per agent node, because "the session" is no longer a thing a run has
    // one of. A run with a single agent node prints one line and reads as it did.
    `sessions    ${
      inspection.sessions.length === 0
        ? '(none)'
        : inspection.sessions
            .map(
              (entry) =>
                `${entry.nodeId}  ${entry.dspatchSessionId}  provider ${entry.providerSessionId}  ` +
                `${String(entry.turns)} turn${entry.turns === 1 ? '' : 's'}  ` +
                `cost ${entry.costCents === null ? 'unknown (not zero)' : `${String(entry.costCents)} cents`}`,
            )
            .join('\n            ')
    }`,
    `session     ${inspection.sessionId ?? '(none)'} (the first; see sessions above)`,
    `provider    ${inspection.providerSessionId ?? '(none)'}`,
    `snap before ${inspection.snapshotBefore?.snapshotId ?? '(none)'}  files=${String(inspection.snapshotBefore?.fileCount ?? 0)}`,
    `snap after  ${inspection.snapshotAfter?.snapshotId ?? '(none)'}  files=${String(inspection.snapshotAfter?.fileCount ?? 0)}`,
    `changed     ${changed}`,
    `commands    ${commands}`,
    `cost        ${inspection.cost === 'unknown' ? 'unknown (not zero)' : `${String(inspection.cost)} cents`}`,
    `usage err   ${inspection.usageError ?? '(none)'}`,
    `cancelled   ${inspection.cancelled ? 'yes â€” files left as they were; no replay' : 'no'}`,
    '',
  ].join('\n');
}

export function writeInspectionJson(filePath: string, inspection: LiveInspection): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const serialisable = {
    ...inspection,
    snapshotBefore: inspection.snapshotBefore,
    snapshotAfter: inspection.snapshotAfter,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(serialisable, null, 2)}\n`, 'utf8');
}
