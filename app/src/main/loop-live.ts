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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { AgentAdapter } from '../adapter/agent-adapter';
import type {
  AgentCommandRecord,
  AgentEvent,
  DspatchSessionId,
  ProviderId,
  RunEnd,
  SessionHandle,
  SteerUpdate,
  UsageReading,
} from '../adapter/types';
import {
  diffSnapshots,
  snapshotTree,
  type ChangedFile,
  type FileEntry,
  type TreeDiff,
  type TreeSnapshot,
} from './experiment-repo';
import { snapshotIdFor } from './workspace-baseline';
import { undeclaredOutcomeOf, type LoopNode, type StepLimits } from '../shared/loop-graph';
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
import type { CommandNotStarted } from '../shared/loop-record';
import {
  describeApprovalRule,
  describeRecordedCommands,
  successRoutesOf,
  type CommandEvidenceEntry,
} from '../shared/loop-results';
import {
  describeGateEvidenceRule,
  describeGateResult,
  describeReceivedResults,
  RESULT_STORAGE_NOTE,
  type GateEvidenceStanding,
} from '../shared/loop-results';
import {
  describeUnobservedOutside,
  providerRootPathsFor,
  workingRootsFrom,
  type WorkingRoot,
} from '../shared/working-roots';
import type {
  StepContext,
  StepExecution,
  StepExecutor,
  StepNote,
  StepProduct,
} from '../shared/loop-run';
import {
  DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  finishCommand,
  runWorkspaceCommand,
  toLiveCommandRecord,
  type LiveCommandRecord,
} from './workspace-command';

// Moved to `workspace-command.ts` (DSP-145) and re-exported, so every existing caller
// and test keeps its import.
export {
  commandNotRun,
  DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  describeBound,
  describeStoppedCommand,
  gateCommandSpawnOptions,
  killCommandTree,
  type GateCommandKillDeps,
} from './workspace-command';

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

export type { LiveCommandRecord } from './workspace-command';

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
  /**
   * The provider this run's agent steps were opened for (DSP-138). `null` means **not
   * recorded** - an inspection built by a caller that named none - and is never read
   * as Cursor.
   */
  provider: ProviderId | null;
  /**
   * DSP-145: every working folder's identity (one id over all of them) as the latest
   * step left them, in the same terms as a command's `afterRunSnapshotId`. `null` or
   * absent where not observed - never "unchanged".
   */
  finalSnapshotId?: string | null;
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
  /** The provider the adapter says holds this session, from its handle (DSP-138). */
  readonly provider: ProviderId;
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
   * DSP-147: how the adapter said the step's run ended locally (`RunEnd`), or `null` when
   * it said nothing. `unconfirmed` means the step's local work may still be going.
   */
  readonly terminalEnd?: RunEnd | null;
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

/**
 * What a loop run uses of a provider adapter, and nothing else (DSP-138).
 *
 * A `Pick` rather than the whole {@link AgentAdapter}, so the shared factory's
 * `ChatAdapter` - Cursor's, Claude's or the presentation adapter - can be handed over
 * without widening either interface. `resume`, approvals and model lists are not used:
 * a loop step never resumes a session.
 */
export type LoopStepAdapter = Pick<
  AgentAdapter,
  'startSession' | 'subscribe' | 'send' | 'cancel' | 'readUsage' | 'dispose' | 'steer'
>;

/**
 * DSP-147: the agent step that is working, offered for steering while its turn runs.
 * `steer` is the step's adapter's own (`AgentAdapter.steer`) bound to the step's session;
 * absent when the adapter has none.
 */
export interface SteerableStep {
  readonly nodeId: string;
  readonly occurrence: number;
  readonly steer?: (text: string, onUpdate?: (update: SteerUpdate) => void) => Promise<SteerUpdate>;
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
  readonly adapter: LoopStepAdapter;
  /**
   * The provider every agent step's session is opened for, and checked against
   * (DSP-138). `runLiveGraph` always names the run's provider; there is no default.
   * Left out - only by a caller that drives the executor directly, such as its own tests
   * with a fake adapter - the session config names no provider, both real adapters refuse
   * it, and the handle is not compared.
   */
  readonly provider?: ProviderId;
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
  /**
   * DSP-147: called with the agent step whose turn is being sent and run, and with
   * `null` once that turn has ended, so a caller can steer the step that is working.
   * Never called for a gate or a human node.
   */
  readonly onSteerableStep?: (step: SteerableStep | null) => void;
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
 * Each root's snapshot id, keyed by the root's path (DSP-139).
 *
 * Every root and the working copy, so the stale rule compares every folder a run works
 * in rather than only the first one (review I5).
 */
function snapshotIdsOf(snapshots: ReadonlyMap<string, TreeSnapshot>): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  for (const [root, snapshot] of snapshots) {
    ids.set(root, snapshotIdFor(snapshot));
  }
  return ids;
}

/** The roots whose snapshot differs between two readings, or is missing from one. */
function differingRoots(
  tested: ReadonlyMap<string, string>,
  now: ReadonlyMap<string, string>,
): readonly string[] {
  const roots = new Set([...tested.keys(), ...now.keys()]);
  return [...roots].filter((root) => tested.get(root) !== now.get(root));
}

/**
 * One identity for every working folder's snapshot (DSP-145): the folder's own id where
 * there is one folder, a digest over every folder's path and id otherwise. `null` where
 * nothing was observed.
 */
export function combinedSnapshotId(ids: ReadonlyMap<string, string> | null): string | null {
  if (ids === null || ids.size === 0) {
    return null;
  }
  if (ids.size === 1) {
    return [...ids.values()][0] ?? null;
  }
  const hash = createHash('sha256');
  for (const [root, id] of [...ids].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${root}\u0000${id}\u0000`);
  }
  return `roots-${hash.digest('hex').slice(0, 32)}`;
}

/** A command this run recorded, with what the approval rule needs of it (DSP-145). */
interface RecordedStepCommand {
  readonly record: LiveCommandRecord;
  /** It ran to an exit of its own: not refused, not unstartable, not stopped. */
  readonly completed: boolean;
  /** Every folder's id just after it ended, or `null` where not observed. */
  readonly after: ReadonlyMap<string, string> | null;
}

/** What a provider-reported command's record says about its own origin (DSP-145, B5). */
export const PROVIDER_REPORTED_NOTE =
  'Run by the provider with its own shell tool, not by DSpatch: DSpatch did not start or ' +
  'stop it and knows only what the provider reported. DSpatch took its snapshots when it ' +
  'observed the provider\'s start and finish events, so they approximate the code the ' +
  'command saw. The provider does not report a working directory; the session\'s folder ' +
  'is shown.';

/**
 * DSP-146: the same for a command whose start and end the adapter observed at the
 * provider's own hooks (Claude's PreToolUse, PostToolUse and PostToolUseFailure).
 */
export const HOOK_REPORTED_NOTE =
  "Run by the agent with the provider's own shell tool, not by DSpatch: DSpatch did not " +
  'start or stop it and records what the provider reported through its hooks. DSpatch took ' +
  'its snapshots inside those hooks, which the provider runs just before the command starts ' +
  'and as it reports the end.';

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function folderChange(
  before: ReadonlyMap<string, string> | null,
  after: ReadonlyMap<string, string> | null,
): boolean | null {
  return before === null || after === null ? null : differingRoots(before, after).length > 0;
}

/**
 * An agent's command, from the adapter's record of it (`command.finished`): DSpatch's own
 * for its former command tool, or (DSP-146) what the provider's hooks reported.
 */
function agentCommandEntry(
  record: AgentCommandRecord,
  nodeId: string,
  occurrence: number,
  before: ReadonlyMap<string, string> | null,
  after: ReadonlyMap<string, string> | null,
): RecordedStepCommand {
  const notRun: CommandNotStarted | null =
    record.ending === 'exited'
      ? null
      : {
          kind:
            record.ending === 'could-not-start'
              ? 'could-not-start'
              : record.ending === 'refused'
                ? 'no-command-configured'
                : 'did-not-finish',
          message: record.endingMessage ?? `The command ended as "${record.ending}".`,
        };
  return {
    record: {
      command: record.requestedBy === 'provider-reported' ? record.line : `${record.shell} ${record.line}`,
      line: record.line,
      cwd: record.cwd,
      exitCode: record.exitCode,
      signal: record.signal,
      durationMs: record.durationMs,
      startedAtUtc: record.startedAtUtc,
      stdout: record.stdout,
      stderr: record.stderr,
      notRun,
      requestedBy: record.requestedBy,
      nodeId,
      occurrence,
      testedSnapshotId: combinedSnapshotId(before),
      afterRunSnapshotId: combinedSnapshotId(after),
      changedWhileRunning: folderChange(before, after),
      ending: record.ending,
      ...(record.requestedBy === 'provider-reported' ? { originNote: HOOK_REPORTED_NOTE } : {}),
    },
    completed: record.ending === 'exited',
    after,
  };
}

/** A command the provider reported running with its own shell tool (DSP-145, B5). */
function providerReportedEntry(
  event: Extract<AgentEvent, { type: 'tool.finished' }>,
  nodeId: string,
  occurrence: number,
  cwd: string,
  started: { readonly ids: ReadonlyMap<string, string> | null; readonly atUtc: string } | undefined,
  after: ReadonlyMap<string, string> | null,
): RecordedStepCommand {
  const raw = recordOf(event.rawProviderEvent);
  const args = recordOf(raw['args']);
  const value = recordOf(recordOf(raw['result'])['value']);
  const line =
    typeof args['command'] === 'string' ? args['command'] : '(a shell command the provider did not describe)';
  const exitCode = typeof value['exitCode'] === 'number' ? value['exitCode'] : null;
  const startedAtUtc = started?.atUtc ?? event.at;
  const took =
    typeof value['executionTime'] === 'number'
      ? value['executionTime']
      : Math.max(0, Date.parse(event.at) - Date.parse(startedAtUtc));
  const before = started?.ids ?? null;
  return {
    record: {
      command: line,
      line,
      cwd,
      exitCode,
      signal: null,
      durationMs: Number.isFinite(took) ? took : 0,
      startedAtUtc,
      stdout: typeof value['stdout'] === 'string' ? value['stdout'] : '',
      stderr: typeof value['stderr'] === 'string' ? value['stderr'] : '',
      notRun:
        exitCode !== null
          ? null
          : {
              kind: 'did-not-finish',
              message:
                `The provider reported this command${event.status === 'error' ? ' as failed' : ''} ` +
                'without an exit code, so how it ended is not established.',
            },
      requestedBy: 'provider-reported',
      nodeId,
      occurrence,
      testedSnapshotId: combinedSnapshotId(before),
      afterRunSnapshotId: combinedSnapshotId(after),
      changedWhileRunning: folderChange(before, after),
      originNote: PROVIDER_REPORTED_NOTE,
    },
    completed: exitCode !== null,
    after,
  };
}

/** How a recorded command ended, in the words a later step reads. */
function endedInWords(record: LiveCommandRecord): string {
  if (record.notRun === null) {
    return `exit code ${record.exitCode === null ? 'none' : String(record.exitCode)}` +
      (record.signal === null ? '' : ` (signal ${record.signal})`);
  }
  switch (record.notRun.kind) {
    case 'could-not-start':
      return 'could not start';
    case 'no-command-configured':
      return 'not run (DSpatch declined it)';
    case 'did-not-finish':
      return record.requestedBy === 'provider-reported'
        ? 'no exit code reported'
        : 'stopped before it finished';
  }
}

/** How long a timed-out step waits for a running command's record (DSP-145, B2). */
export const COMMAND_RECORD_WAIT_MS = 15_000;

/**
 * What DSpatch knows about which code a gate's command ran against (DSP-139).
 *
 * `tested` is `null` where that was not observed: a run that does not hash its working
 * folders gets the same fixed id for every empty tree, so comparing ids there would call
 * any change "unchanged" (review A1). Unobserved is unknown, and unknown is stale.
 */
interface GateEvidence {
  readonly testedSnapshotId: string | null;
  readonly tested: ReadonlyMap<string, string> | null;
  /** Why this result can never describe the working folders, or `null`. */
  readonly unusable: string | null;
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
  provider: ProviderId | null = null,
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
    provider,
    finalSnapshotId: null,
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
export function runConfiguredProjectTest(
  command: string,
  cwd: string,
  timeoutMs: number | null = DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  /** DSP-145: the walk's own stop; aborting stops the command and its children. */
  signal?: AbortSignal,
): Promise<LiveCommandRecord> {
  // The shared runner (DSP-145), with no output bound and no snapshots: the gate's
  // executor takes its own, and the record keeps exactly the shape it always had.
  return runWorkspaceCommand({
    line: command,
    cwd,
    requestedBy: 'gate',
    timeoutMs,
    ...(signal === undefined ? {} : { signal }),
    maxOutputChars: null,
  }).then(toLiveCommandRecord);
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
  readonly terminalEnd: () => RunEnd | null;
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
  adapter: Pick<AgentAdapter, 'subscribe'>,
  sessionId: DspatchSessionId,
  onActivity?: (event: AgentEvent) => void,
): TurnWait {
  let assistantText = '';
  let terminalStatus: string | null = null;
  let terminalEnd: RunEnd | null = null;
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
      event.type === 'command.started' ||
      event.type === 'command.finished' ||
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
      terminalEnd = event.end ?? null;
      terminalError = event.error?.message ?? null;
      unsubscribe();
      resolveFinished?.();
    }
  });

  return {
    finished,
    assistantText: () => assistantText,
    terminalStatus: () => terminalStatus,
    terminalEnd: () => terminalEnd,
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
  /**
   * Which code each gate visit's command ran against, keyed `node#visit` (DSP-139).
   *
   * A step handed a gate's result is held to it: the result counts only for the code it
   * tested. Kept by the executor because only the executor saw the snapshots; the result
   * the runner hands over carries the node and the visit, which is the key.
   */
  const gateEvidence = new Map<string, GateEvidence>();
  /**
   * Why a gate's result does not describe the working folders as they are now, or `null`
   * where it does. `now` is `null` where this run does not read file content, and that
   * is never "unchanged" (review A1). Every root is compared (review I5).
   */
  const staleBecause = (
    evidence: GateEvidence,
    now: ReadonlyMap<string, string> | null,
  ): string | null => {
    if (evidence.unusable !== null) {
      return evidence.unusable;
    }
    if (now === null) {
      return (
        'DSpatch is not reading the working folders’ content in this run, so it cannot ' +
        'tell whether they are still that code.'
      );
    }
    if (evidence.tested === null) {
      return 'Which code the command ran against is not established.';
    }
    const differing = differingRoots(evidence.tested, now);
    if (differing.length === 0) {
      return null;
    }
    const working = now.get(inspection.workspacePath) ?? 'not observed';
    return differing.length === 1 && differing[0] === inspection.workspacePath
      ? `The working folder is now snapshot ${working}.`
      : `These working folders have changed since: ${differing.join(', ')}. The working ` +
          `folder is now snapshot ${working}.`;
  };

  /**
   * Every command this run recorded, in order (DSP-145, DSP-146): gates', and the agents'
   * own shell commands as the provider reported them. Kept here because the
   * approval rule and the check's evidence compare their after-run snapshots with the
   * working folders, and only the executor took those snapshots.
   */
  const runCommands: RecordedStepCommand[] = [];
  const takeCommand = (entry: RecordedStepCommand): void => {
    runCommands.push(entry);
    inspection.commands.push(entry.record);
    options.onCommand?.(entry.record);
  };
  /** The run's first look at every folder, or `null` where any was not observed. */
  const originIds = (): ReadonlyMap<string, string> | null => {
    const ids = new Map<string, string>();
    const first = inspection.snapshotBefore;
    if (first === null) {
      return null;
    }
    ids.set(inspection.workspacePath, first.snapshotId);
    for (const root of inspection.roots) {
      if (root.snapshotBefore === null) {
        return null;
      }
      ids.set(root.path, root.snapshotBefore.snapshotId);
    }
    return ids;
  };
  /**
   * Why a success verdict does not stand, or `null` where it does (DSP-145; DSP-139's
   * gate rule, generalised; review B3). It stands when a command recorded in this run
   * completed on exactly these working folders - every folder - or when the run has
   * changed no file. Unobserved is never unchanged.
   */
  const approvalShortfall = (endIds: ReadonlyMap<string, string> | null): string | null => {
    if (endIds === null) {
      return (
        'DSpatch is not reading the working folders’ content in this run, so it cannot tell ' +
        'which code any command ran on, or whether the run changed anything.'
      );
    }
    const origin = originIds();
    if (origin !== null && differingRoots(origin, endIds).length === 0) {
      return null;
    }
    if (
      runCommands.some(
        (entry) => entry.completed && entry.after !== null && differingRoots(entry.after, endIds).length === 0,
      )
    ) {
      return null;
    }
    const completed = runCommands.filter((entry) => entry.completed);
    const last = completed[completed.length - 1];
    if (last === undefined) {
      return (
        'No command completed in this run - none was run, or none ran to an exit of its own - ' +
        'and the run has changed files.'
      );
    }
    const changed = last.after === null ? [] : differingRoots(last.after, endIds);
    return (
      `The last command that completed, ${last.record.line ?? last.record.command} ` +
      `("${last.record.nodeId ?? 'a step'}"${(last.record.occurrence ?? 1) === 1 ? '' : ` visit ${String(last.record.occurrence)}`}), ` +
      `left the working folders at ${last.record.afterRunSnapshotId ?? 'a state DSpatch did not observe'}; ` +
      `they are now ${combinedSnapshotId(endIds) ?? 'not observed'}` +
      (changed.length > 1 || (changed.length === 1 && changed[0] !== inspection.workspacePath)
        ? ` (changed: ${changed.join(', ')}).`
        : '.')
    );
  };
  const evidenceEntry = (
    entry: RecordedStepCommand,
    now: ReadonlyMap<string, string> | null,
  ): CommandEvidenceEntry => ({
    nodeId: entry.record.nodeId ?? '(unknown step)',
    occurrence: entry.record.occurrence ?? 1,
    requestedBy: entry.record.requestedBy ?? 'gate',
    line: entry.record.line ?? entry.record.command,
    cwd: entry.record.cwd,
    ended: endedInWords(entry.record),
    durationMs: entry.record.durationMs,
    afterRunSnapshotId: entry.record.afterRunSnapshotId ?? null,
    standing:
      now === null || entry.after === null
        ? 'not-observed'
        : differingRoots(entry.after, now).length === 0
          ? 'current'
          : 'stale',
    changedWhileRunning: entry.record.changedWhileRunning ?? null,
    stdout: entry.record.stdout,
    stderr: entry.record.stderr,
  });

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
      // The state the command ran against, before it is overwritten below.
      //
      // DSP-45 #5. Not a second snapshot taken for this: the run's `snapshotAfter` at the
      // moment the gate is entered *is* the tree the command was handed, because the step
      // before the gate ended by recording it and nothing between them writes. Comparing
      // it with the tree afterwards is the only way to say *your check changed the thing
      // it was checking*, which for a CMake project is the difference between "the tests
      // pass" and "the build directory this was measured from no longer exists".
      const ranAgainst = inspection.snapshotAfter;
      // Every root's tested snapshot too, read before `applyRootDiffs` below overwrites
      // them. `null` where any of them, or the working copy, was never observed, or where
      // this run does not read file content at all (review A1, I5).
      const testedIds: ReadonlyMap<string, string> | null = (() => {
        if (!hashRoots || ranAgainst === null) {
          return null;
        }
        const ids = new Map<string, string>([[inspection.workspacePath, ranAgainst.snapshotId]]);
        for (const root of inspection.roots) {
          if (root.snapshotAfter === null) {
            return null;
          }
          ids.set(root.path, root.snapshotAfter.snapshotId);
        }
        return ids;
      })();
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
      // What a later step handed this result may treat it as evidence about (DSP-139).
      // Compared against what the command ran against, not what it left (review A2).
      const afterIds = snapshotIdsOf(afterByRoot);
      gateEvidence.set(`${node.id}#${String(context.occurrence)}`, {
        testedSnapshotId: testedIds === null ? null : (ranAgainst?.snapshotId ?? null),
        tested: testedIds,
        unusable:
          command.notRun !== null
            ? 'No command ran, so it tested no code.'
            : !hashRoots
              ? 'DSpatch is not reading the working folders’ content in this run, so which ' +
                'code the command ran against is not established.'
              : testedIds === null
                ? 'DSpatch had not observed the working folders before the command ran, so which ' +
                  'code it tested is not established.'
                : differingRoots(testedIds, afterIds).length > 0
                  ? 'The command changed the working folders while it ran, so what it measured ' +
                    'is not what it left behind.'
                  : null,
      });
      // DSP-145: the gate's record, with who asked and the code it ran on and left, in the
      // same terms as an agent's commands, so one rule reads them all.
      takeCommand({
        record: {
          ...command,
          requestedBy: 'gate',
          nodeId: node.id,
          occurrence: context.occurrence,
          testedSnapshotId: combinedSnapshotId(testedIds),
          afterRunSnapshotId: hashRoots ? combinedSnapshotId(afterIds) : null,
          changedWhileRunning:
            command.notRun !== null ? null : folderChange(testedIds, hashRoots ? afterIds : null),
        },
        completed: command.notRun === null,
        after: hashRoots ? afterIds : null,
      });
      inspection.finalSnapshotId = hashRoots ? combinedSnapshotId(afterIds) : null;
      const selfModified =
        changedWhileChecking === true
          ? ` This command changed the working copy while it ran (${ranAgainst?.snapshotId ?? 'unknown'} ` +
            `â†’ ${snapshotIdFor(after)}), so what it measured is not what it left behind. ` +
            `That is an observation and not a judgement: many builds write into their own ` +
            `tree. It matters because the result below describes the state before those ` +
            `writes.`
          : '';
      const gateResultBody = (verdict: string): string | undefined =>
        node.produces === undefined || node.produces.form === 'none'
          ? undefined
          : describeGateResult({
              runId: context.runId,
              nodeId: node.id,
              occurrence: context.occurrence,
              verdict,
              command,
              testedSnapshotId: testedIds === null ? null : (ranAgainst?.snapshotId ?? null),
              afterSnapshotId: hashRoots ? snapshotIdFor(after) : null,
              selfModified,
            });
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
        const notVerifiedBody = gateResultBody(notVerified);
        return remember(context, {
          product: { kind: 'outcome', outcome: notVerified, source: 'gate-verdict' },
          ...(notVerifiedBody === undefined ? {} : { resultBody: notVerifiedBody }),
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
      // The command's own record as the gate's result, for a gate that declares one
      // (DSP-139), so a later step is handed what ran and not anybody's account of it.
      const verdictBody = gateResultBody(passed ? 'pass' : 'fail');
      return remember(context, {
        // A gate's own verdict, from an exit code (DSP-103 #9). Recorded as the gate's so
        // that a step handed this result is not told an agent declared "pass".
        product: { kind: 'outcome', outcome: passed ? 'pass' : 'fail', source: 'gate-verdict' },
        ...(verdictBody === undefined ? {} : { resultBody: verdictBody }),
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
      const runProvider = options.provider;
      session = await options.adapter.startSession({
        // The run's provider (DSP-138), never a default. Left out, the config names
        // none and a real adapter refuses it at start - see `LiveExecutorOptions.provider`.
        provider: runProvider as ProviderId,
        dspatchSessionId: stepSessionId(context.runId, node.id),
        modelRequested: options.modelRequested,
        workspacePath: options.workspacePath,
        // Every root of the run, working directory first. One root produces the same
        // single-folder session as before; the adapter omits `dirs` for it, because the
        // provider treats a merged list of one as no list.
        workspacePaths: providerRootPathsFor(rootsOfRun),
      });
      // A session is bound to the run's provider. An adapter that answers for another
      // is a fault on this step - thrown, so the walk records it here and goes no
      // further - and the session is never used, let alone resumed elsewhere.
      if (runProvider !== undefined && session.provider !== runProvider) {
        throw new Error(
          `The adapter opened "${node.id}" for ${session.provider}, but this run is bound to ` +
            `${runProvider}. Nothing was sent to it.`,
        );
      }
      sessions.set(node.id, session);
      sessionRef = {
        nodeId: node.id,
        dspatchSessionId: session.dspatchSessionId,
        provider: session.provider,
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
    // DSP-145, DSP-146: the commands this step's agent ran with the provider's own shell
    // tool - from the adapter's `command.*` events (Claude's hooks) or the provider's
    // `shell` tool events (Cursor) - with every folder's snapshot taken when the start and
    // the end were observed.
    const commandStarts = new Map<
      string,
      { readonly ids: ReadonlyMap<string, string> | null; readonly atUtc: string }
    >();
    const idsNow = (): ReadonlyMap<string, string> | null =>
      hashRoots ? snapshotIdsOf(snapshotEveryRoot(inspection, true)) : null;
    const observeCommand = (event: AgentEvent): void => {
      if (event.type === 'command.started') {
        commandStarts.set(event.commandId, { ids: idsNow(), atUtc: event.at });
        return;
      }
      if (event.type === 'command.finished') {
        const started = commandStarts.get(event.command.commandId);
        commandStarts.delete(event.command.commandId);
        takeCommand(agentCommandEntry(event.command, node.id, context.occurrence, started?.ids ?? null, idsNow()));
        return;
      }
      if (event.type === 'tool.started' && event.name === 'shell') {
        commandStarts.set(`shell:${event.toolCallId}`, { ids: idsNow(), atUtc: event.at });
        return;
      }
      if (event.type === 'tool.finished' && event.name === 'shell') {
        const key = `shell:${event.toolCallId}`;
        const started = commandStarts.get(key);
        commandStarts.delete(key);
        takeCommand(
          providerReportedEntry(event, node.id, context.occurrence, options.workspacePath, started, idsNow()),
        );
      }
    };
    const commandRunning = (): boolean => [...commandStarts.keys()].some((key) => !key.startsWith('shell:'));
    const turn = waitForTurn(options.adapter, openSession.dspatchSessionId, (event) => {
      observeCommand(event);
      if (event.type === 'command.started' || event.type === 'command.finished') {
        return;
      }
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
    // DSP-139. A gate's result counts only for the code its command ran against. Which
    // code that was, and the rule this step works under because of it, are stated beside
    // the result whenever one is handed over (review A3), not only when the rule bites.
    const handedGates = context.received
      .filter((result) => result.outcome?.source === 'gate-verdict')
      .map((result) => ({
        nodeId: result.nodeId,
        occurrence: result.occurrence,
        evidence: gateEvidence.get(`${result.nodeId}#${String(result.occurrence)}`) ?? {
          testedSnapshotId: null,
          tested: null,
          unusable: 'DSpatch has no record in this run of which code that command ran against.',
        },
      }));
    const startIds = hashRoots ? snapshotIdsOf(beforeByRoot) : null;
    const staleAtStart = handedGates.map((gate) => staleBecause(gate.evidence, startIds));
    const evidenceStandings: GateEvidenceStanding[] = handedGates.map((gate, index) => ({
      nodeId: gate.nodeId,
      occurrence: gate.occurrence,
      testedSnapshotId: gate.evidence.testedSnapshotId,
      staleBecause: staleAtStart[index] ?? null,
    }));
    const evidenceText = describeGateEvidenceRule(evidenceStandings, undeclaredOutcomeOf(node));
    // DSP-145: for a step whose verdict can end the run in success, the commands this run
    // recorded with their standing now, and the rule its verdict is held to.
    const routes = successRoutesOf(context.graph, node);
    const commandsText =
      routes.length === 0
        ? ''
        : describeRecordedCommands(runCommands.map((entry) => evidenceEntry(entry, startIds)));
    const approvalText = describeApprovalRule(routes, undeclaredOutcomeOf(node));
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
      evidenceText +
      changeText +
      commandsText +
      approvalText +
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
      // DSP-147: offered before the send, so a message typed as the step starts reaches
      // it if its runtime already has a running turn, and otherwise the adapter says so.
      const steer = options.adapter.steer?.bind(options.adapter);
      options.onSteerableStep?.({
        nodeId: node.id,
        occurrence: context.occurrence,
        ...(steer === undefined
          ? {}
          : {
              steer: (text: string, onUpdate?: (update: SteerUpdate) => void) =>
                steer(openSession.dspatchSessionId, text, onUpdate),
            }),
      });
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
      // R3: the working folders as this step left them, on every path out of it.
      inspection.finalSnapshotId = hashRoots ? combinedSnapshotId(snapshotIdsOf(afterByRoot)) : null;
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
      options.onSteerableStep?.(null);
    }
    if (timedOut && commandRunning()) {
      // DSP-145 (B2): the adapter stops a running command on cancel and sends its record
      // before the run's end. Wait for that end, bounded, so the record is this step's.
      let recordTimer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        turn.finished,
        new Promise<void>((resolve) => {
          recordTimer = setTimeout(resolve, COMMAND_RECORD_WAIT_MS);
          recordTimer.unref?.();
        }),
      ]);
      if (recordTimer !== null) {
        clearTimeout(recordTimer);
      }
    }

    const afterByRoot = snapshotEveryRoot(inspection, hashRoots);
    // R3: the working folders as this step left them, on every path out of it.
    inspection.finalSnapshotId = hashRoots ? combinedSnapshotId(snapshotIdsOf(afterByRoot)) : null;
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
      terminalEnd: turn.terminalEnd(),
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
    // DSP-145, the rule stated in `approvalText` (DSP-139's gate rule, generalised): a
    // verdict that would end the run in success stands only on a command completed on
    // these working folders, or on a run that changed nothing. Otherwise the node's own
    // `whenUndeclared` is recorded instead; a declared failure, or a verdict that leads
    // anywhere else, stands.
    const endIds = hashRoots ? snapshotIdsOf(afterByRoot) : null;
    inspection.finalSnapshotId = combinedSnapshotId(endIds);
    let product: StepProduct = declared.product;
    let staleNote = '';
    const declaredProduct = product;
    const leadsToSuccess =
      declaredProduct.kind === 'outcome'
        ? routes.some((route) => route.outcome === declaredProduct.outcome)
        : declaredProduct.kind === 'success' &&
          (context.graph.edges ?? []).some(
            (edge) =>
              edge.from === node.id &&
              edge.when.on === 'success' &&
              context.graph.nodes.some(
                (target) => target.id === edge.to && target.kind === 'terminal' && target.ending === 'success',
              ),
          );
    const shortfall = leadsToSuccess ? approvalShortfall(endIds) : null;
    if (shortfall !== null && (product.kind === 'outcome' || product.kind === 'success')) {
      // R1: a whenUndeclared that itself ends the run in success cannot stand in for a
      // result nobody established; it is treated as no fallback at all.
      const declaredFallback = undeclaredOutcomeOf(node);
      const fallbackIsSuccess =
        declaredFallback !== null && routes.some((route) => route.outcome === declaredFallback);
      const fallback = fallbackIsSuccess ? null : declaredFallback;
      const handedStale = [...staleAtStart, ...handedGates.map((gate) => staleBecause(gate.evidence, endIds))]
        .filter((reason): reason is string => reason !== null);
      const seen =
        `The command results recorded in this run do not describe the working folders as this ` +
        `step left them: ${shortfall}` +
        (handedStale.length === 0 ? '' : ` ${[...new Set(handedStale)].join(' ')}`);
      const said = product.kind === 'outcome' ? `"${product.outcome}"` : 'plain success';
      if (fallback === null) {
        product = {
          kind: 'runtime-fault',
          fault: 'no-outcome-delivered',
          detail:
            `${seen} "${node.id}" declared ${said}, and ` +
            (fallbackIsSuccess
              ? `this node's outcome for a result nobody established ("whenUndeclared": ` +
                `"${String(declaredFallback)}") itself ends the run in success, so it cannot stand ` +
                `in for that result; there is nothing honest to route on and the run stops here. `
              : `this node names no outcome for a result nobody established ("whenUndeclared"), ` +
                `so there is nothing honest to route on and the run stops here. `) +
            `Anything changed is still in the working copy.`,
        };
        staleNote = fallbackIsSuccess
          ? ` ${seen} No outcome recorded: the node's whenUndeclared is itself a success route.`
          : ` ${seen} No outcome recorded: the node has no whenUndeclared.`;
      } else if (product.kind === 'outcome' && product.outcome === fallback) {
        staleNote = ` ${seen} The step itself declared "${fallback}", which stands.`;
      } else {
        product = { kind: 'outcome', outcome: fallback, source: 'verification-stale' };
        staleNote =
          ` ${seen} DSpatch recorded "${fallback}" (this node's whenUndeclared) instead of ` +
          `${said}, because a result about one version of the code is not evidence about ` +
          `another, and a completed command shows only that it ran on that code.`;
      }
    }
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
      product,
      ...(resultBody === undefined ? {} : { resultBody }),
      summary:
        `One provider turn. Requested ${options.modelRequested}, reported ` +
        `${inspection.modelReported ?? 'unknown'}. Snapshot ${snapshotIdFor(before)} â†’ ` +
        `${snapshotIdFor(after)}. Changed: ${changed.length > 0 ? changed.join(', ') : 'none'}.` +
        (declared.why === null ? '' : ` ${declared.why}`) +
        ` ${corroboration}` +
        staleNote +
        sessionNote,
      providerTurns: 1,
    });
  };
}

export async function readLiveUsage(
  adapter: Pick<AgentAdapter, 'readUsage'>,
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
          .map((command) => {
            // DSP-145: who asked for it, so a gate's command, one DSpatch ran for an agent
            // and one the provider merely reported are not read as the same thing.
            const origin =
              command.requestedBy === 'agent-tool'
                ? "[agent via DSpatch's former command tool] "
                : command.requestedBy === 'provider-reported'
                  ? '[reported by provider] '
                  : command.requestedBy === 'gate'
                    ? '[gate] '
                    : '';
            return command.notRun === null
              ? `${origin}${command.command}  exit=${String(command.exitCode)}  ${String(command.durationMs)}ms`
              : `${origin}(${command.notRun.kind}: ${command.notRun.message})`;
          })
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
    `agent       ${inspection.provider ?? '(not recorded)'}`,
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
                `${entry.nodeId}  ${entry.dspatchSessionId}  ${entry.provider} session ${entry.providerSessionId}  ` +
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
