/**
 * Orchestration for a live loop run, for the window and the command line. Separate from
 * `loop-live.ts` so tests can exercise the executor with a fake adapter.
 *
 * Provider-neutral (DSP-138): the caller names the run's provider and hands over the
 * factory that builds its adapter. Nothing here constructs a provider adapter or imports
 * one, so the product's run path cannot reach Cursor unless Cursor was chosen. The
 * command line's Cursor construction is in `loop-live-cli.ts`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProviderId } from '../adapter/types';
import { generateExperimentRepo } from './experiment-repo';
import {
  createLiveExecutor,
  DEFAULT_LIVE_MODEL,
  emptyInspection,
  formatLiveInspection,
  readLiveUsage,
  DEFAULT_GATE_COMMAND_TIMEOUT_MS,
  runConfiguredProjectTest,
  writeInspectionJson,
  type LiveAgentReply,
  type LiveCommandRecord,
  type LiveExecutorOptions,
  type LiveInspection,
  type LivePromptStep,
  type LoopStepAdapter,
  type SteerableStep,
} from './loop-live';
import type { WorkingCopyClaim } from './working-copy-lock';
import type { StepActivity } from '../shared/loop-activity';
import { chatPromptFor, describeChosenLoopBinding } from '../shared/loop-chat';
import {
  describeLiveBinding,
  editorLiveBindingFor,
  LIVE_DURATION_GRAPH_ID,
} from '../shared/loop-editor-run';
import {
  formatRunJournal,
  journalToJsonl,
  runLoopGraph,
  type RunControlPort,
  type RunJournalEntry,
  type RunResult,
  type StepNote,
} from '../shared/loop-run';
import {
  writeReachOf,
  type LoopGraph,
  type LoopNode,
} from '../shared/loop-graph';
import { createFileRoleResolver } from './loop-graph-roles';
import { createFileResultStore } from './loop-result-store';
import {
  describeUnobservedOutside,
  workingRootsFrom,
  type WorkingRoot,
} from '../shared/working-roots';

export const LIVE_GRAPH_REL = 'docs/loop/graphs/dspatch-live-duration.graph.json';
export { LIVE_DURATION_GRAPH_ID, describeLiveBinding };

export type LiveBindingKind = 'editor-duration' | 'chat-loop';

export interface LiveCliOptions {
  readonly graphPath: string;
  readonly runId: string;
  readonly repoRoot: string;
  readonly outDir: string | null;
  readonly modelRequested: string;
  readonly workspacePath?: string;
  /**
   * Every folder this run works with, the working directory first (DSP-72).
   *
   * Left out, the run has one root: `workspacePath`, or the generated experiment
   * repository. The CLI leaves it out and is unchanged. The chat window supplies it
   * from the folders a person opened, and then each root reaches the provider and is
   * measured. A root's `path` must be one this function would have accepted on its
   * own — the own-repository guard is applied to every one of them below.
   */
  readonly workingRoots?: readonly WorkingRoot[];
  readonly keepWorkspace: boolean;
  /**
   * Where this run's results are filed (DSP-74).
   *
   * A directory DSpatch owns, per run — never a working root and never the
   * definition's resource root, so a definition cannot write its reports into the
   * project it is reading. Left out, the run has no store: a graph that requires no
   * result is unaffected, and one that does is refused before it starts rather than
   * walking to a terminal with its requirements unchecked.
   */
  readonly resultsDir?: string;
  readonly abortSignal?: AbortSignal;
  readonly onJournalEntry?: (entry: RunJournalEntry) => void;
  /**
   * Which live binding to apply. Editor Run walks only the drawings listed in
   * `EDITOR_LIVE_BINDINGS`, in a generated experiment repository. Chat Use loop
   * walks dspatch-chat-loop on the project already open.
   */
  readonly bindingKind?: LiveBindingKind;
  readonly promptFor?: (node: LoopNode, step: LivePromptStep) => string;
  /** Handed straight to the executor's gate branch, `note` and all. See {@link LiveExecutorOptions}. */
  readonly runProjectTest?: (
    workspacePath: string,
    note: StepNote,
  ) => Promise<LiveCommandRecord>;
  /** Each agent node's own words, as they happen. The chat binding shows them. */
  readonly onAgentReply?: (reply: LiveAgentReply) => void;
  /**
   * What the provider reports while a step is still working.
   *
   * Passed straight to the executor. The CLI leaves it out and behaves exactly as
   * before; the window wires it, which is what turns a loop step from an opaque call
   * into something a person can watch.
   */
  readonly onStepActivity?: (activity: StepActivity) => void;
  /**
   * Each gate command as it settles, so a caller can write it to the run record
   * while the run is still walking. Reading `inspection.commands` afterwards works
   * only for a run that reaches "afterwards".
   */
  readonly onCommand?: (command: LiveCommandRecord) => void;
  /**
   * DSP-147: take the working-copy lock for the folders this run gives its agents, once
   * they are known and before anything starts; released when the run has ended. A
   * refusal rejects the run with its reason.
   */
  readonly claimWorkingRoots?: (paths: readonly string[]) => WorkingCopyClaim;
  /** DSP-147: see {@link LiveExecutorOptions.onSteerableStep}. */
  readonly onSteerableStep?: (step: SteerableStep | null) => void;
  /**
   * Who decides that the next work step starts (DSP-29, DSP-30). Left out — as the
   * CLI leaves it out — the run is autonomous and never waits.
   */
  readonly control?: RunControlPort;
  /**
   * The provider this run's agent steps go through (DSP-138). Required, with no
   * default: the window resolves it from the explicit agent choice (`prepareLoopRun`),
   * and the command line names Cursor. Every step session is opened for it and checked
   * against it, and the inspection carries it.
   */
  readonly provider: ProviderId;
  /**
   * Which adapter the run's agent steps go through. Required since DSP-138: the run
   * module builds no adapter of its own, so nothing here can fall back to Cursor.
   *
   * The window passes the shared factory's adapter for the chosen provider and purpose
   * `'loop'`, which in presentation mode is the presentation adapter - so a window can
   * walk a run on this machine with no provider call, which is the only way to check in
   * the window the things the window alone decides.
   *
   * A factory rather than an instance, because `driveLive` owns the adapter's lifetime:
   * it disposes what it made, and handing it something to dispose that a caller still
   * held would be a second owner of one resource.
   */
  readonly createAdapter: () => LoopStepAdapter;
}

export interface LiveCliDelivery {
  readonly result: RunResult;
  readonly inspection: LiveInspection;
  readonly workspacePath: string;
  readonly workspaceKept: boolean;
  readonly journalText: string;
  readonly generated: boolean;
}

export function defaultLiveModel(): string {
  return process.env['DSPATCH_LIVE_MODEL'] ?? DEFAULT_LIVE_MODEL;
}

/**
 * Live-run a graph the caller already holds — the editor's canvas, or a file
 * the CLI has just loaded. The binding check is the same either way: a drawing
 * with no live prompt is refused rather than given the duration prompt.
 */
export function runLiveGraph(graph: LoopGraph, options: Omit<LiveCliOptions, 'graphPath'>): Promise<LiveCliDelivery> {
  const bindingKind = options.bindingKind ?? 'editor-duration';
  const binding =
    bindingKind === 'chat-loop' ? describeChosenLoopBinding(graph) : describeLiveBinding(graph);
  if (!binding.ready) {
    return Promise.reject(new Error(binding.reason));
  }

  let workspacePath: string;
  let generated = false;
  if (bindingKind === 'chat-loop') {
    if (options.workspacePath === undefined) {
      return Promise.reject(
        new Error('Use loop needs the project already open in chat. Nothing was started.'),
      );
    }
    workspacePath = path.resolve(options.workspacePath);
  } else if (options.workspacePath !== undefined) {
    workspacePath = path.resolve(options.workspacePath);
  } else {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-live-${options.runId}-`));
    workspacePath = path.join(parent, 'duration-repo');
    generateExperimentRepo(workspacePath, options.repoRoot);
    generated = true;
  }

  // The roots, with the working copy first whatever order the caller listed them in.
  // Built here rather than trusted from the caller so that `cwd` and the record's
  // primary are one decision: the provider scopes its local agent store by `cwd`, which
  // makes which root is primary part of the resume key.
  const roots = workingRootsFrom(
    [workspacePath, ...(options.workingRoots ?? []).map((root) => root.path)],
    workspacePath,
    process.platform === 'win32',
  );

  // DSP-147: the folders the run will actually give its agents, offered to the caller's
  // working-copy lock. A folder of its own is not proof of isolation: a workspace that
  // contains it (the temp folder, or a whole drive) overlaps it all the same.
  let releaseClaim: (() => void) | null = null;
  if (options.claimWorkingRoots !== undefined) {
    const claim = options.claimWorkingRoots(roots.map((root) => root.path));
    if (!claim.ok) {
      if (generated) {
        // Best effort: on Windows the fresh repository can still be held open briefly, and
        // a leftover folder in the temp directory must not hide why the run was refused.
        try {
          fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch {
          // Left in the temp folder.
        }
      }
      return Promise.reject(new Error(claim.reason));
    }
    releaseClaim = claim.release;
  }

  return driveLive(graph, workspacePath, roots, generated, withEditorBinding(graph, bindingKind, options)).finally(
    () => {
      releaseClaim?.();
    },
  );
}

/**
 * The editor binding's own prompts and gate command, where it has them (DSP-139).
 *
 * The duration fixture keeps the executor's defaults: its one hardcoded prompt and
 * `runNodeProjectTest`. A drawing bound with `drawing-purposes` gets the chat loop's
 * brief built from its own purposes and role files, with the drawing's top-level purpose
 * as the run's mandate (review I1), and its gate runs the binding's command through
 * `runConfiguredProjectTest` in the run's working folder. A caller that passes its own
 * `promptFor` or `runProjectTest` keeps it: that is how a test injects a slow command.
 */
function withEditorBinding(
  graph: LoopGraph,
  bindingKind: LiveBindingKind,
  options: Omit<LiveCliOptions, 'graphPath'>,
): Omit<LiveCliOptions, 'graphPath'> {
  const binding = bindingKind === 'editor-duration' ? editorLiveBindingFor(graph.id) : null;
  if (binding === null || binding.prompts !== 'drawing-purposes') {
    return options;
  }
  const resolveRole = createFileRoleResolver(options.repoRoot);
  return {
    ...options,
    promptFor:
      options.promptFor ??
      ((node, step) => {
        const resolved = node.role === undefined ? null : resolveRole(node.role);
        return chatPromptFor(node, {
          entryId: graph.entry,
          mandate: graph.purpose,
          mandateFrom: 'drawing',
          step,
          role:
            resolved === null
              ? null
              : {
                  id: resolved.id,
                  sourcePath: resolved.sourcePath,
                  instructions: resolved.instructions ?? null,
                },
        });
      }),
    runProjectTest:
      options.runProjectTest ??
      // The walk's own signal (DSP-145): Cancel stops the gate's command and its children.
      ((workspacePath) =>
        runConfiguredProjectTest(
          binding.gateCommand,
          workspacePath,
          DEFAULT_GATE_COMMAND_TIMEOUT_MS,
          options.abortSignal,
        )),
  };
}

/**
 * Whether this run reads the project's bytes for its snapshots, and why.
 *
 * DSP-91 #7, decided here because this is where both halves are to hand: the drawing, and
 * the resolver that can reach its roles. `writeReachOf` asks the only question the format
 * can answer about writing — which steps require `no-file-writes`, and whether anything on
 * this path actually applies that — and a drawing where no step could write gets no project
 * hashing at all.
 *
 * DSP-96 part 2 added the second half of that question, and it matters here: on the path
 * this function is on, `no-file-writes` is a sentence in a role file, so no drawing with an
 * agent step skips today. The decision stays a property of the drawing and the target, and
 * never of the words in the mandate.
 *
 * The resolver is the same `createFileRoleResolver` the caller already built to validate
 * the graph and build the prompts, so this costs a cache lookup per node rather than a
 * second pass over the role files.
 */
function snapshotDecisionFor(
  graph: LoopGraph,
  repoRoot: string,
): { readonly hashWorkingRoots: boolean; readonly reason: string } {
  const reach = writeReachOf(graph, createFileRoleResolver(repoRoot));
  return { hashWorkingRoots: reach.mayWrite, reason: reach.reason };
}

async function driveLive(
  graph: LoopGraph,
  workspacePath: string,
  roots: readonly WorkingRoot[],
  generated: boolean,
  options: Omit<LiveCliOptions, 'graphPath'>,
): Promise<LiveCliDelivery> {
  const inspection = emptyInspection(workspacePath, options.modelRequested, roots, options.provider);
  // Before the walk, so the note the record carries and the behaviour the executor takes are
  // the same decision rather than two that could disagree.
  const snapshots = snapshotDecisionFor(graph, options.repoRoot);
  if (!snapshots.hashWorkingRoots) {
    inspection.rootsNote = describeUnobservedOutside(roots, snapshots.reason);
  }
  // Where results land, and the reason it is not derived from anything the graph says.
  // The caller names it because the caller is the side that knows which folders belong
  // to DSpatch and which belong to the person: `userData/loop-runs/<run>/results` for
  // the window, the run's own output folder for the CLI. A run given neither files
  // nothing, which the walk turns into a refusal for a graph that requires a result.
  const resultsDir =
    options.resultsDir ??
    (options.outDir === null || options.outDir === '' ? null : path.join(path.resolve(options.outDir), 'results'));
  // Built here and nowhere else, so this function is the adapter's one owner and
  // disposes it once, in the `finally` below. Which provider, and with which tools, the
  // caller decided (`provider-adapters.ts`, purpose `'loop'`).
  const adapter = options.createAdapter();
  /**
   * What the provider says it used, from an adapter that is willing to say.
   *
   * `modelReported` is not on {@link AgentAdapter} — it is Cursor's own reading of what
   * its runtime actually chose, which not every transport has. `null` is **not
   * established**, never "the requested model": an adapter that does not report one has
   * not reported the requested one.
   */
  const modelReportedBy = (sessionId: string): string | null => {
    const reader = (adapter as unknown as { modelReported?: (id: string) => string | null })
      .modelReported;
    return typeof reader === 'function' ? (reader.call(adapter, sessionId) ?? null) : null;
  };
  let workspaceKept = options.keepWorkspace || !generated;

  try {
    const result = await runLoopGraph(graph, {
      runId: options.runId,
      dryRun: false,
      routeLimitAs: 'limit-reached',
      // The walk's own cancel check (DSP-37). The executor below gets the same signal
      // and still needs it — only the executor can cancel a provider turn already in
      // flight — but only the walk can refuse to *enter* the next node, which is what
      // stops a gate spawning the project's build command after Cancel was pressed.
      ...(options.abortSignal === undefined ? {} : { signal: options.abortSignal }),
      ...(options.control === undefined ? {} : { control: options.control }),
      ...(options.onJournalEntry === undefined ? {} : { onJournalEntry: options.onJournalEntry }),
      ...(resultsDir === null ? {} : { resultStore: createFileResultStore(resultsDir) }),
      executor: createLiveExecutor({
        workspacePath,
        workingRoots: roots,
        adapter,
        provider: options.provider,
        modelRequested: options.modelRequested,
        modelReported: modelReportedBy,
        abortSignal: options.abortSignal,
        inspection,
        hashWorkingRoots: snapshots.hashWorkingRoots,
        ...(options.promptFor === undefined ? {} : { promptFor: options.promptFor }),
        ...(options.runProjectTest === undefined ? {} : { runProjectTest: options.runProjectTest }),
        ...(options.onAgentReply === undefined ? {} : { onAgentReply: options.onAgentReply }),
        ...(options.onStepActivity === undefined
          ? {}
          : { onStepActivity: options.onStepActivity }),
        ...(options.onCommand === undefined ? {} : { onCommand: options.onCommand }),
        ...(options.onSteerableStep === undefined ? {} : { onSteerableStep: options.onSteerableStep }),
      }),
    });

    // Every session, not the first one. With one session per agent node (DSP-79) a run
    // that read usage from `inspection.sessionId` alone would report the first step's
    // cost as the run's — and the run's cost is the one the person is being charged.
    // `readLiveUsage` appends, so the readings accumulate across sessions the way they
    // accumulated across turns before.
    for (const session of inspection.sessions) {
      await readLiveUsage(adapter, session.dspatchSessionId, inspection);
      inspection.modelReported =
        modelReportedBy(session.dspatchSessionId) ?? inspection.modelReported;
    }

    const journalText = `${formatRunJournal(result)}\n${formatLiveInspection(inspection)}`;
    if (options.outDir !== null && options.outDir !== '') {
      const outDir = path.resolve(options.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'run-live.txt'), journalText, 'utf8');
      fs.writeFileSync(path.join(outDir, 'run-live.jsonl'), journalToJsonl(result), 'utf8');
      writeInspectionJson(path.join(outDir, 'live-inspect.json'), inspection);
    }

    return { result, inspection, workspacePath, workspaceKept, journalText, generated };
  } finally {
    await adapter.dispose();
    if (generated && !options.keepWorkspace) {
      try {
        fs.rmSync(path.dirname(workspacePath), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
        workspaceKept = false;
      } catch {
        workspaceKept = true;
      }
    }
  }
}
