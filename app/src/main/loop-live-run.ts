/**
 * CLI orchestration for a live loop run. Separate from `loop-live.ts` so tests
 * can exercise the executor with a fake adapter without constructing Cursor.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CursorSdkAdapter } from '../adapter/cursor-sdk-adapter';
import { generateExperimentRepo } from './experiment-repo';
import {
  createLiveExecutor,
  DEFAULT_LIVE_MODEL,
  emptyInspection,
  formatLiveInspection,
  readLiveUsage,
  refuseLiveWorkspace,
  writeInspectionJson,
  type LiveAgentReply,
  type LiveCommandRecord,
  type LiveExecutorOptions,
  type LiveInspection,
} from './loop-live';
import type { StepActivity } from '../shared/loop-activity';
import { describeChatLoopBinding } from '../shared/loop-chat';
import {
  describeLiveBinding,
  FORBIDDEN_LIVE_GRAPH_ID,
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
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import type { LoopGraph, LoopNode } from '../shared/loop-graph';
import { createFileRoleResolver } from './loop-graph-roles';

export const LIVE_GRAPH_REL = 'docs/loop/graphs/dspatch-live-duration.graph.json';
export { FORBIDDEN_LIVE_GRAPH_ID, LIVE_DURATION_GRAPH_ID, describeLiveBinding };

export type LiveBindingKind = 'editor-duration' | 'chat-loop';

export interface LiveCliOptions {
  readonly graphPath: string;
  readonly runId: string;
  readonly repoRoot: string;
  readonly outDir: string | null;
  readonly modelRequested: string;
  readonly workspacePath?: string;
  readonly keepWorkspace: boolean;
  readonly abortSignal?: AbortSignal;
  readonly onJournalEntry?: (entry: RunJournalEntry) => void;
  /**
   * Which live binding to apply. Editor Run stays duration-only. Chat Use loop
   * walks dspatch-chat-loop on the project already open.
   */
  readonly bindingKind?: LiveBindingKind;
  readonly promptFor?: (node: LoopNode) => string;
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
   * Who decides that the next work step starts (DSP-29, DSP-30). Left out — as the
   * CLI leaves it out — the run is autonomous and never waits.
   */
  readonly control?: RunControlPort;
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

export function runLiveLoop(options: LiveCliOptions): Promise<LiveCliDelivery> {
  const graphText = fs.readFileSync(options.graphPath, 'utf8');
  const loaded = loadLoopGraph(graphText, {
    resolveRole: createFileRoleResolver(options.repoRoot),
    connectedTargets: ['cursor'],
  });
  if (!loaded.ok) {
    throw new Error(
      `${options.graphPath} does not validate, so it was not run:\n\n${formatFindings(loaded.findings)}`,
    );
  }
  return runLiveGraph(loaded.graph, options);
}

/**
 * Live-run a graph the caller already holds — the editor's canvas, or a file
 * the CLI has just loaded. The binding check is the same either way: a drawing
 * with no live prompt is refused rather than given the duration prompt.
 */
export function runLiveGraph(graph: LoopGraph, options: Omit<LiveCliOptions, 'graphPath'>): Promise<LiveCliDelivery> {
  const bindingKind = options.bindingKind ?? 'editor-duration';
  const binding =
    bindingKind === 'chat-loop' ? describeChatLoopBinding(graph) : describeLiveBinding(graph);
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

  const appPath = path.join(options.repoRoot, 'app');
  const refusal = refuseLiveWorkspace(workspacePath, appPath);
  if (refusal !== null) {
    return Promise.reject(new Error(refusal));
  }

  return driveLive(graph, workspacePath, generated, options);
}

async function driveLive(
  graph: LoopGraph,
  workspacePath: string,
  generated: boolean,
  options: Omit<LiveCliOptions, 'graphPath'>,
): Promise<LiveCliDelivery> {
  const inspection = emptyInspection(workspacePath, options.modelRequested);
  const adapter = new CursorSdkAdapter({ toolPolicy: 'provider-default' });
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
      executor: createLiveExecutor({
        workspacePath,
        adapter,
        modelRequested: options.modelRequested,
        modelReported: (sessionId) => adapter.modelReported(sessionId),
        abortSignal: options.abortSignal,
        inspection,
        ...(options.promptFor === undefined ? {} : { promptFor: options.promptFor }),
        ...(options.runProjectTest === undefined ? {} : { runProjectTest: options.runProjectTest }),
        ...(options.onAgentReply === undefined ? {} : { onAgentReply: options.onAgentReply }),
        ...(options.onStepActivity === undefined
          ? {}
          : { onStepActivity: options.onStepActivity }),
        ...(options.onCommand === undefined ? {} : { onCommand: options.onCommand }),
      }),
    });

    if (inspection.sessionId !== null) {
      await readLiveUsage(adapter, inspection.sessionId, inspection);
      inspection.modelReported = adapter.modelReported(inspection.sessionId) ?? inspection.modelReported;
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
