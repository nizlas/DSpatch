/**
 * Agent work over a revision pair (DSP-152): preparing code walks, reviewing a part the
 * person explicitly delegated, and answering a question about one step by looking into
 * the code. The host runs it and owns its resources; windows start it, watch it through
 * the pair's record and may stop it.
 *
 * **Analysis with the provider's own tools.** The agent examines the code itself, as the
 * plan (section 6) decided: the host writes the two commits to a folder of their own
 * (`RevisionSnapshots`), the session runs there, and the adapter is built from the shared
 * factory for the `analysis` purpose, whose Claude policy (`ANALYSIS_PERMISSIONS`) offers
 * only Claude Code's Read, Glob and Grep, inside that folder, and whose Copilot policy
 * (`COPILOT_ANALYSIS_POLICY`) offers the runtime's view, glob and grep likewise. A job refuses
 * an adapter that does not hold exactly its policy. Cursor is refused for this work: DSpatch has no
 * read-only Cursor policy (`CURSOR_ANALYSIS_REFUSAL`). The prompt opens with the change and
 * its diff for orientation only. The review discussion is separate and stays tool-free.
 *
 * **DSpatch checks what comes back**, against Git at the two commits, never against the
 * folder: every walk place and answer reference must exist at its commit, approvals must lie
 * inside the delegated scope among the lines reported as reviewed, and a part the agent
 * could not read is not approved. What the agent read is recorded with the job, for Details.
 *
 * **Outcomes are recorded, never assumed.** A job is written as running before anything is
 * sent. It ends as done or failed from what the provider reported, as cancelled only on a
 * confirmed end, and as unknown when that cannot be established — including a job that was
 * running when DSpatch stopped, which is never started again. Closing a window does not
 * touch a job; reopening reads the record.
 */

import { PRESENTATION_INSTRUCTION_VERSION, PROFILE_PROMPT_NAMES, isPublicProfile, type PublicProfile } from '../shared/presentation-profiles';

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { ANALYSIS_PERMISSIONS } from '../adapter/claude-agent-sdk-adapter';
import { COPILOT_ANALYSIS_POLICY } from '../adapter/copilot-sdk-adapter';
import type { AgentEvent, Unsubscribe } from '../adapter/types';
import type { ChatAdapter } from '../main/chat-service';
import {
  CHECKS_FILE_FORMAT,
  answerJson,
  checkDefinition,
  checksFileOf,
  checksPrompt,
  crowdedStepProblems,
  definitionFrom,
  repeatedStepProblems,
  discussionFolderSection,
  followUpWords,
  linesAround,
  readSelection,
  readChecksAnswer,
  readReviewAnswer,
  readStepAnswer,
  readWalksAnswer,
  repairPrompt,
  reviewInstruction,
  reviewPrompt,
  selectionPrompt,
  stepQuestionPrompt,
  uncoveredBy,
  walkPlaceProblems,
  walksPrompt,
  withCheckedChecks,
  withCheckedContext,
  withCheckedFindings,
  withCheckedStandaloneChecks,
  withoutInvalidPlaces,
  withContextCommits,
  type AnalysisMaterial,
  type ContextReader,
  type ExplainTurn,
  type ProposedWalks,
} from '../shared/review-agent';
import {
  openerChoiceFrom,
  changedLinesOf,
  generationOfJob,
  isPairError,
  lineKey,
  type AgentInvestigation,
  type AgentJob,
  type AgentMaterial,
  type AgentReview,
  type CodeSelection,
  type DelegationScope,
  type ExplainFollowUp,
  type LineRange,
  type PairAnswer,
  type PairRecord,
  type ReviewAgentChoice,
  type ReviewAgents,
  type StepQuestion,
  toolActivity,
} from '../shared/review-pair';
import type { HeldRevisions } from '../main/review-discussion-service';
import type { RevisionPairIdentity } from '../shared/review-pair';
import type { ReviewPairs } from './review-pairs';
import type { RevisionSnapshots, SnapshotManifest } from './revision-snapshots';
import { contextReaderOf, type ContextRepository, type ContextSnapshot } from './context-repositories';

export type AgentProvider = 'cursor' | 'claude' | 'copilot';

/** What DSpatch itself says while nothing else is reported: it asked, and nothing is running. */
const WAITING = 'Waiting for the agent…';

/** How often what the agent is doing is written to the record, at most. */
const ACTIVITY_MS = 900;

/** How long after its last tool ended the line goes on naming that tool. */
const TOOL_DONE_MS = 3_000;

/**
 * Which part of its answer the agent is writing, read from the answer so far: the fields
 * of the JSON it was asked for, in the order it writes them. Nothing is guessed beyond that.
 */
export function writingNow(kind: AgentJob['kind'], text: string): string {
  if (kind === 'walks') {
    const walks = text.match(/"kind"\s*:\s*"(?:walk|reading)"/g)?.length ?? 0;
    const steps = text.match(/"places"\s*:/g)?.length ?? 0;
    if (walks > 0) {
      return `Writing walk ${String(walks)} · ${String(steps)} step(s) so far`;
    }
    return /"summary"\s*:/.test(text) ? 'Writing the summary of the change' : 'Writing its answer';
  }
  if (kind === 'checks') {
    const points = text.match(/"reasoning"\s*:/g)?.length ?? 0;
    return points > 0 ? `Writing point ${String(points)} worth checking` : 'Writing its answer';
  }
  if (kind === 'review') {
    const findings = text.match(/"severity"\s*:/g)?.length ?? 0;
    if (findings > 0) {
      return `Writing finding ${String(findings)}`;
    }
    return /"(?:summary|assessment)"\s*:/.test(text) ? 'Writing its review' : 'Writing its answer';
  }
  return 'Writing the explanation';
}

/** What a window asks for. Checked here before anything is written or sent. */
export interface AgentJobRequest {
  readonly kind: 'walks' | 'review' | 'explain' | 'checks';
  readonly provider: AgentProvider;
  readonly model: string;
  readonly scope?: DelegationScope;
  /** For `explain`: the step, by its walk definition and ids, and the person's question. */
  readonly question?: { readonly definitionPath: string; readonly walkId: string; readonly stepId: string; readonly question: string };
  /** For `checks`: the walk definition whose change is looked over. */
  readonly definitionPath?: string;
}

export interface ReviewAgentJobsOptions {
  /** `userData/reviews`: generated walks under `generated/`. */
  readonly recordsDir: string;
  /** The shared factory, bound to the analysis purpose. */
  readonly createAdapter: (provider: AgentProvider) => ChatAdapter;
  /** The revisions written as files for the agent to read; held while a job runs. */
  readonly snapshots: RevisionSnapshots;
  readonly availability: (provider: AgentProvider) => { readonly choosable: boolean; readonly reason: string | null };
  readonly pairs: ReviewPairs;
  /** The review language, for what the agent writes. */
  readonly language: () => Promise<'sv' | 'en'>;
  readonly log: (message: string) => void;
  /** Test override for how long a cancelled run is given to report its end. */
  readonly cancelConfirmMs?: number;
  /**
   * DSP-175: the workspace's other repositories a review may read as context, and the record
   * of what was given. Without it, no context is given.
   */
  readonly contexts?: {
    current(key: string, pair: RevisionPairIdentity): Promise<readonly ContextRepository[]>;
    given(key: string, pair: RevisionPairIdentity, holder: string, context: readonly ContextSnapshot[]): void;
  };
}

interface Live {
  /** The review's id (DSP-186): every result is written back to this review and no other. */
  readonly key: string;
  readonly jobId: string;
  /** The review was deleted while this ran: nothing of it is written anywhere (DSP-186). */
  dropped: boolean;
  adapter: ChatAdapter | null;
  sessionId: string | null;
  unsubscribe: Unsubscribe | null;
  runId: string | null;
  text: string;
  cancelRequested: boolean;
  /** The revision folder, once written: what tool subjects are shown relative to. */
  folder: string | null;
  /** The context repositories written with it, read at their recorded commits (DSP-175). */
  context: ContextReader | null;
  readonly reads: Set<string>;
  readonly searches: string[];
  refused: number;
  readonly refusedCalls: string[];
  /** Each tool call's name and subject, until its result says whether it ran. */
  readonly calls: Map<string, { readonly name: string; readonly subject: string | null }>;
  /** What the agent is doing now, and what of it the record shows; written at most about once a second. */
  activity: string;
  activityShown: string;
  activityTimer: ReturnType<typeof setTimeout> | null;
  /** Set while the last tool has ended and nothing newer is reported. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  readonly kind: AgentJob['kind'];
  finished: ((status: 'finished' | 'failed' | 'cancelled' | 'unconfirmed', error: string | null) => void) | null;
}

/** An explanation of selected code, checked against the commits before its job is registered. */
export interface PreparedExplanation {
  readonly selection: CodeSelection;
  readonly followUp: ExplainFollowUp | null;
  /** The person's own question about the selection, asked as the first question. */
  readonly asked?: string;
}

const CANCEL_CONFIRM_MS = 15_000;

/** How many reads and searches a job records for its Details. */
const INVESTIGATION_LIMIT = 200;

/** How many left-out files a job names (all are counted). */
const SKIPPED_NAMED = 50;

/** What the agent could read, as the job records it. */
function materialOf(manifest: SnapshotManifest): AgentMaterial {
  const skipped = [
    ...manifest.base.skipped.map((entry) => ({ side: 'base' as const, ...entry })),
    ...manifest.target.skipped.map((entry) => ({ side: 'target' as const, ...entry })),
  ];
  return {
    base: manifest.base.commit,
    target: manifest.target.commit,
    files: manifest.base.files + manifest.target.files,
    skipped: skipped.slice(0, SKIPPED_NAMED),
    skippedCount: skipped.length,
  };
}

/** The material with the context repositories the snapshot holds (DSP-175): described, not sent. */
function withContext(material: AnalysisMaterial, manifest: SnapshotManifest): AnalysisMaterial {
  if (manifest.context.length === 0 && manifest.contextUnavailable.length === 0) {
    return material;
  }
  return {
    ...material,
    context: manifest.context.map(({ repository: _repository, ...entry }) => entry),
    contextUnavailable: manifest.contextUnavailable,
  };
}

/** The repository paths the diff names on each side: never left out of the folder for size. */
function changedPaths(material: AnalysisMaterial): { readonly base: Set<string>; readonly target: Set<string> } {
  return {
    base: new Set(material.files.flatMap((file) => (file.oldPath === null ? [] : [file.oldPath]))),
    target: new Set(material.files.flatMap((file) => (file.newPath === null ? [] : [file.newPath]))),
  };
}

/** DSP-185: what is said of steps that still show several places with no reason after the repair round. */
export function crowdedNote(count: number): string {
  return `${String(count)} step(s) show several places without saying why seeing them together helps, even when asked once to split them; they were kept as written, so no place or covered line was lost.`;
}

/** DSP-185: what is said of steps that still repeat an earlier place with no purpose after the repair round. */
export function repeatedNote(count: number): string {
  return `${String(count)} step(s) show a place an earlier step already showed without saying what is new there; they were kept as written.`;
}

function providerName(provider: AgentProvider): string {
  return provider === 'claude' ? 'Claude' : provider === 'copilot' ? 'Copilot' : 'Cursor';
}

/** A job with nothing said about what it is doing now. */
function withoutActivity(job: AgentJob): AgentJob {
  const { activity: _activity, ...rest } = job;
  return rest;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function questionRequestFrom(raw: unknown): { definitionPath: string; walkId: string; stepId: string; question: string } | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const text = (key: string, limit: number): string => (typeof value[key] === 'string' ? (value[key] as string).trim().slice(0, limit) : '');
  const request = { definitionPath: text('definitionPath', 4000), walkId: text('walkId', 200), stepId: text('stepId', 200), question: text('question', 4000) };
  return request.definitionPath === '' || request.walkId === '' || request.stepId === '' || request.question === '' ? null : request;
}

function scopeFrom(raw: unknown): DelegationScope | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const kind = value['kind'];
  if (kind !== 'lines' && kind !== 'file' && kind !== 'walk') {
    return null;
  }
  const ranges: LineRange[] = [];
  for (const entry of Array.isArray(value['ranges']) ? value['ranges'] : []) {
    if (typeof entry !== 'object' || entry === null) {
      return null;
    }
    const range = entry as Record<string, unknown>;
    if (
      (range['side'] !== 'base' && range['side'] !== 'target') ||
      typeof range['path'] !== 'string' ||
      !Number.isInteger(range['start']) ||
      !Number.isInteger(range['end']) ||
      (range['start'] as number) < 1 ||
      (range['end'] as number) < (range['start'] as number)
    ) {
      return null;
    }
    ranges.push({ kind: 'lines', side: range['side'], path: range['path'], start: range['start'] as number, end: range['end'] as number });
  }
  if (ranges.length === 0) {
    return null;
  }
  return { kind, label: typeof value['label'] === 'string' ? value['label'].slice(0, 200) : '', ranges };
}

export class ReviewAgentJobs {
  private readonly options: ReviewAgentJobsOptions;

  private readonly live = new Map<string, Live>();

  constructor(options: ReviewAgentJobsOptions) {
    this.options = options;
  }

  /**
   * A job the record says is running but this host is not running: DSpatch stopped
   * before it ended. It becomes unknown and is not started again.
   */
  reconcile(key: string): void {
    const state = this.options.pairs.state(key);
    if (isPairError(state) || !state.jobs.some((job) => (job.state === 'running' || job.state === 'cancelling') && !this.live.has(job.id))) {
      return;
    }
    this.options.pairs.update(key, (record) => ({
      ...record,
      jobs: record.jobs.map((job) =>
        (job.state === 'running' || job.state === 'cancelling') && !this.live.has(job.id)
          ? {
              ...withoutActivity(job),
              state: 'unknown',
              endedAt: new Date().toISOString(),
              note: 'DSpatch stopped before this finished, so how far it got is unknown. Nothing was approved, and nothing was started again.',
            }
          : job,
      ),
    }));
  }

  /**
   * The agents a window can choose from, and the choice it starts from: the one made in
   * this review (stored with the pair), else the opener's (the chat or loop editor that
   * opened the window), else none. Nothing here picks a provider or a model of its own,
   * and nothing is constructed or asked: an unusable choice is shown with its reason.
   */
  agents(key: unknown, opener: unknown): PairAnswer<ReviewAgents> {
    if (typeof key !== 'string') {
      return { error: 'That review is not open.' };
    }
    const record = this.options.pairs.state(key);
    if (isPairError(record)) {
      return record;
    }
    const options = (['claude', 'copilot', 'cursor'] as const).map((provider) => ({ provider, ...this.options.availability(provider) }));
    const fromReview = record.agent;
    const fromOpener = openerChoiceFrom(opener);
    const chosen: { readonly choice: ReviewAgentChoice; readonly from: 'review' | 'opener' } | null =
      fromReview !== null ? { choice: fromReview, from: 'review' } : fromOpener !== null ? { choice: fromOpener, from: 'opener' } : null;
    if (chosen === null) {
      return { options, current: null };
    }
    const availability = this.options.availability(chosen.choice.provider);
    return {
      options,
      current: { ...chosen.choice, from: chosen.from, choosable: availability.choosable, reason: availability.reason },
    };
  }

  /**
   * Start a job from an explicit request. Refused, with a reason, before anything is
   * written if it cannot run. Each request and its outcome is logged with the job id, the
   * agent and model and the review's key, never with prompt content.
   */
  start(key: unknown, raw: unknown, prepared: PreparedExplanation | null = null): PairAnswer<AgentJob> {
    const request = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const word = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 80) : String(value));
    this.options.log(`job request: ${word(request['kind'])} with ${word(request['provider'])}/${word(request['model'])} for review ${word(key).slice(0, 12)}`);
    const answer = this.startChecked(key, raw, prepared);
    this.options.log(isPairError(answer) ? `job refused: ${answer.error}` : `job ${answer.id} registered (${answer.kind}, ${answer.provider}/${answer.model})`);
    return answer;
  }

  /**
   * Any request from a window. An explanation of selected code (DSP-152), or a follow-up on
   * one, is first checked against the commits: the host reads the selected lines from Git,
   * decides which are removed, added or unchanged, and refuses a selection whose text is not
   * what the commits hold there. A follow-up takes its selection from the explanation it
   * follows, never from the window. Everything else is {@link start} as it was.
   */
  async request(key: unknown, raw: unknown): Promise<PairAnswer<AgentJob>> {
    const request = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    if (request['kind'] !== 'explain' || (request['selection'] === undefined && request['followUp'] === undefined)) {
      return this.start(key, raw);
    }
    const prepared = await this.prepareExplanation(key, request);
    if (isPairError(prepared)) {
      this.options.log(`job refused: explanation of selected code - ${prepared.error}`);
      return prepared;
    }
    return this.start(key, raw, prepared);
  }

  private async prepareExplanation(key: unknown, request: Record<string, unknown>): Promise<PairAnswer<PreparedExplanation>> {
    if (typeof key !== 'string') {
      return { error: 'That review is not open.' };
    }
    const record = this.options.pairs.state(key);
    const opened = this.options.pairs.opened(key);
    if (isPairError(record) || opened === null) {
      return isPairError(record) ? record : { error: 'That review is not open.' };
    }
    const asked = request['followUp'];
    if (asked !== undefined) {
      const value = typeof asked === 'object' && asked !== null ? (asked as Record<string, unknown>) : {};
      const root = record.jobs.find((job) => job.id === value['root']);
      if (root === undefined || root.kind !== 'explain' || root.selection === undefined || root.followUp !== undefined) {
        return { error: 'The explanation this follows is not in this review.' };
      }
      const action = value['action'];
      if (action !== 'more' && action !== 'simpler' && action !== 'question') {
        return { error: 'Unknown kind of follow-up.' };
      }
      const question = typeof value['question'] === 'string' ? value['question'].trim().slice(0, 4000) : '';
      if (action === 'question' && question === '') {
        return { error: 'Write your question first.' };
      }
      // Explain one answer more simply: an answer of this very explanation, done.
      const of = action === 'simpler' && typeof value['of'] === 'string' ? value['of'] : null;
      if (of !== null && !record.jobs.some((job) => job.id === of && (job.id === root.id || job.followUp?.root === root.id) && job.state === 'done')) {
        return { error: 'The answer to explain more simply is not in this explanation.' };
      }
      return { selection: root.selection, followUp: { root: root.id, action, question: action === 'question' ? question : '', ...(of === null ? {} : { of }) } };
    }
    const selection = await readSelection(request['selection'], opened.files, (side, filePath) => this.options.pairs.linesAt(key, side, filePath));
    if (isPairError(selection)) {
      return selection;
    }
    const ask = typeof request['ask'] === 'string' ? request['ask'].trim().slice(0, 4000) : '';
    if (request['ask'] !== undefined && ask === '') {
      return { error: 'Write your question first.' };
    }
    return { selection, followUp: null, ...(ask === '' ? {} : { asked: ask }) };
  }

  private startChecked(key: unknown, raw: unknown, prepared: PreparedExplanation | null): PairAnswer<AgentJob> {
    if (typeof key !== 'string') {
      return { error: 'That review is not open.' };
    }
    const request = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const kind = request['kind'];
    const provider = request['provider'];
    const model = typeof request['model'] === 'string' ? request['model'].trim() : '';
    if (kind !== 'walks' && kind !== 'review' && kind !== 'explain' && kind !== 'checks') {
      return { error: 'Unknown kind of agent work.' };
    }
    if (provider !== 'cursor' && provider !== 'claude' && provider !== 'copilot') {
      return { error: 'Choose an agent first.' };
    }
    if (model === '' || model.length > 200) {
      return { error: 'Choose a model first.' };
    }
    const availability = this.options.availability(provider);
    if (!availability.choosable) {
      return { error: `${availability.reason ?? `${providerName(provider)} cannot be used here.`} Nothing was started.` };
    }
    const record = this.options.pairs.state(key);
    if (isPairError(record)) {
      return record;
    }
    this.reconcile(key);
    // DSP-181, walks: the profile the step explanations are written in, when the window named one.
    const presentationRaw = request['presentation'];
    const asked = typeof presentationRaw === 'object' && presentationRaw !== null ? (presentationRaw as Record<string, unknown>)['profile'] : undefined;
    const explanationsIn: PublicProfile | null = kind === 'walks' && isPublicProfile(asked) ? asked : null;
    let scope: DelegationScope | null = null;
    let question: StepQuestion | null = null;
    if (kind === 'explain' && prepared === null && (request['selection'] !== undefined || request['followUp'] !== undefined)) {
      // Only `request` checks a selection against the commits; one that skipped it is refused.
      return { error: 'The selection was not checked, so nothing was started.' };
    }
    if (kind === 'explain' && prepared === null) {
      const asked = questionRequestFrom(request['question']);
      if (asked === null) {
        return { error: 'Write a question about this step first.' };
      }
      const step = this.options.pairs.stepOf(key, asked.definitionPath, asked.walkId, asked.stepId);
      if (isPairError(step)) {
        return step;
      }
      question = { ...asked, stepTitle: step.stepTitle.en, places: step.places };
    }
    // What is worth checking is asked over walks of this very pair, read here from their file.
    let checksOver: string | null = null;
    if (kind === 'checks') {
      const named = request['definitionPath'];
      const outline = this.options.pairs.walksOf(key, named, 'en');
      if (isPairError(outline)) {
        return outline;
      }
      checksOver = path.resolve(named as string);
    }
    if (kind === 'review') {
      scope = scopeFrom(request['scope']);
      if (scope === null) {
        return { error: 'Choose what to delegate: lines, a file or a walk.' };
      }
      const opened = this.options.pairs.opened(key);
      const changed = new Set((opened?.files ?? []).flatMap((file) => changedLinesOf(file)).map(lineKey));
      const inScope = scope.ranges.some((range) => {
        for (let line = range.start; line <= range.end; line += 1) {
          if (changed.has(lineKey({ side: range.side, path: range.path, line }))) {
            return true;
          }
        }
        return false;
      });
      if (!inScope) {
        return { error: 'The delegated part has no changed lines, so there is nothing to review.' };
      }
    }
    const running = this.options.pairs.state(key);
    if (!isPairError(running) && running.jobs.some((job) => job.kind === kind && (job.state === 'running' || job.state === 'cancelling'))) {
      return {
        error:
          kind === 'walks'
            ? 'Code walks are already being prepared for this change. Wait for them, or stop that first.'
            : kind === 'checks'
              ? 'The agent is already looking for what is worth checking. Wait for it, or stop it first.'
              : kind === 'explain'
              ? 'The agent is already looking into a question about this change. Wait for it, or stop it first.'
              : 'A delegated review is already running for this change. Wait for it, or stop it first.',
      };
    }
    const job: AgentJob = {
      id: `job-${randomUUID()}`,
      kind,
      state: 'running',
      provider,
      model,
      startedAt: new Date().toISOString(),
      endedAt: null,
      note:
        kind === 'walks'
          ? 'Preparing code walks.'
          : kind === 'checks'
            ? 'Looking for what is worth checking.'
            : kind === 'explain'
            ? prepared === null
              ? 'Looking into the code.'
              : prepared.asked !== undefined
                ? 'Answering your question about the selected code.'
                : 'Explaining the selected code.'
            : `Reviewing ${scope?.label ?? 'the delegated part'}.`,
      detail: '',
      scope,
      result: null,
      definitionPath: checksOver,
      uncovered: [],
      ...(explanationsIn === null ? {} : { presentation: { profile: explanationsIn, version: PRESENTATION_INSTRUCTION_VERSION } }),
      ...(question === null ? {} : { question }),
      ...(prepared === null ? {} : { selection: prepared.selection }),
      ...(prepared?.followUp == null ? {} : { followUp: prepared.followUp }),
      ...(prepared?.asked === undefined ? {} : { asked: prepared.asked }),
    };
    // Written before anything is sent: a job that never reached the disk could not be
    // reconciled after a restart. The agent and model it was started with become the
    // review's choice: the next job starts from them, whatever window opens it.
    // DSP-186: a walk preparation is what the review's walks are prepared with from now on.
    const written = this.options.pairs.update(key, (current) => ({
      ...current,
      agent: { provider, model },
      jobs: [...current.jobs, job],
      ...(kind === 'walks' ? { generation: generationOfJob(job) } : {}),
    }));
    if (isPairError(written)) {
      return written;
    }
    const live: Live = {
      key,
      jobId: job.id,
      dropped: false,
      adapter: null,
      sessionId: null,
      unsubscribe: null,
      runId: null,
      text: '',
      cancelRequested: false,
      finished: null,
      folder: null,
      context: null,
      reads: new Set(),
      searches: [],
      refused: 0,
      refusedCalls: [],
      calls: new Map(),
      activity: '',
      activityShown: '',
      activityTimer: null,
      idleTimer: null,
      kind,
    };
    this.live.set(job.id, live);
    void this.run(live, job).finally(() => {
      this.live.delete(job.id);
    });
    return job;
  }

  /** Whether agent work runs here now (DSP-161). */
  working(): boolean {
    return this.live.size > 0;
  }

  /** Stop a running job. It counts as cancelled only when the provider reports the end. */
  async cancel(key: unknown, jobId: unknown): Promise<PairAnswer<{ readonly note: string }>> {
    const live = typeof jobId === 'string' ? this.live.get(jobId) : undefined;
    if (live === undefined || live.key !== key) {
      return { error: 'That agent work is not running.' };
    }
    if (live.cancelRequested) {
      return { note: 'Already asked to stop.' };
    }
    live.cancelRequested = true;
    this.setJob(live, { state: 'cancelling', note: 'Asked to stop. It counts as stopped only when the provider reports an end.' });
    if (live.adapter !== null && live.sessionId !== null && live.runId !== null) {
      try {
        await live.adapter.cancel(live.sessionId);
      } catch (error) {
        this.finish(live, 'unknown', `The request to stop failed (${describe(error)}), so whether it is still running is unknown. Nothing was approved.`);
        return { note: 'The request to stop failed.' };
      }
      this.armCancelConfirmation(live);
    }
    // Before a run exists, the run loop sees `cancelRequested` and stops it as soon as it can.
    return { note: 'Asked to stop.' };
  }

  /**
   * A review is being deleted (DSP-186): its running work is asked to stop and its sessions
   * closed, and nothing any of it answers later is written: no record, no walks, no points.
   */
  async forgetReview(key: string): Promise<void> {
    for (const live of [...this.live.values()].filter((entry) => entry.key === key)) {
      live.dropped = true;
      live.cancelRequested = true;
      this.quiet(live);
      if (live.adapter !== null && live.sessionId !== null && live.runId !== null) {
        await live.adapter.cancel(live.sessionId).catch(() => undefined);
      }
      await this.closeSession(live);
    }
  }

  /**
   * Whether a job's results may still be written: its review exists and holds this job as
   * running. Checked before every write of a result, the walk and points files included, so a
   * late answer never makes a deleted review appear again and never lands in another.
   */
  private accepts(live: Live): boolean {
    if (live.dropped || !this.options.pairs.holds(live.key)) {
      return false;
    }
    const current = this.options.pairs.state(live.key);
    return !isPairError(current) && current.jobs.some((job) => job.id === live.jobId && (job.state === 'running' || job.state === 'cancelling'));
  }

  /** Quit: anything still running is recorded as unknown; adapters are closed. */
  async dispose(): Promise<void> {
    for (const live of [...this.live.values()]) {
      this.finish(live, 'unknown', 'DSpatch closed before this finished, so how far it got is unknown. Nothing was approved.');
      await this.closeSession(live);
    }
    this.live.clear();
  }

  // --- Inside ------------------------------------------------------------------------------

  private setJob(live: Live, change: Partial<AgentJob>): PairRecord | null {
    if (live.dropped || !this.options.pairs.holds(live.key) || !this.holdsJob(live)) {
      return null;
    }
    const written = this.options.pairs.update(live.key, (record) => ({
      ...record,
      jobs: record.jobs.map((job) => {
        if (job.id !== live.jobId) {
          return job;
        }
        const next = { ...job, ...change };
        // What it is doing is said only while it does it: not while it is being stopped.
        return next.state === 'running' ? next : withoutActivity(next);
      }),
    }));
    return isPairError(written) ? null : written;
  }

  /** Whether the review's record has this job at all. */
  private holdsJob(live: Live): boolean {
    const current = this.options.pairs.state(live.key);
    return !isPairError(current) && current.jobs.some((job) => job.id === live.jobId);
  }

  /**
   * What the agent is doing now, said in the window under the spinner (Niclas's request of
   * 30 October 2026). Only what it reports or what DSpatch itself does: no guessed stages,
   * no estimate of what is left, and (as since the trial of 29 October) no counts of reads
   * or tool calls; those stay in the job's Details. Written at most about once a second.
   */
  private setActivity(live: Live, activity: string): void {
    this.clearIdle(live);
    live.activity = activity;
    if (live.activityTimer !== null) {
      return;
    }
    const tell = (): void => {
      if (live.activity === live.activityShown) {
        return;
      }
      const current = this.options.pairs.state(live.key);
      const running = !isPairError(current) && current.jobs.some((job) => job.id === live.jobId && job.state === 'running');
      if (running) {
        live.activityShown = live.activity;
        this.setJob(live, { activity: live.activity });
      }
    };
    // The first is said at once (30 October 2026): the wait is what the person sees first.
    if (live.activityShown === '') {
      tell();
      return;
    }
    live.activityTimer = setTimeout(() => {
      live.activityTimer = null;
      tell();
    }, ACTIVITY_MS);
  }

  private clearIdle(live: Live): void {
    if (live.idleTimer !== null) {
      clearTimeout(live.idleTimer);
      live.idleTimer = null;
    }
  }

  /** Nothing more is said about what it is doing: the job is ending. */
  private quiet(live: Live): void {
    this.clearIdle(live);
    if (live.activityTimer !== null) {
      clearTimeout(live.activityTimer);
      live.activityTimer = null;
    }
  }

  /** The job's final state, once: a later attempt to end it again changes nothing. */
  private finish(live: Live, state: AgentJob['state'], note: string, extra: Partial<AgentJob> = {}): void {
    const current = this.options.pairs.state(live.key);
    const job = isPairError(current) ? undefined : current.jobs.find((entry) => entry.id === live.jobId);
    if (job === undefined || (job.state !== 'running' && job.state !== 'cancelling')) {
      return;
    }
    this.quiet(live);
    this.setJob(live, { ...extra, ...this.investigationOf(live), state, note, endedAt: new Date().toISOString() });
    this.options.log(`review agent ${live.jobId}: ${state} - ${note}`);
  }

  /** What the agent looked at, for the job's Details; nothing when no folder was written. */
  private investigationOf(live: Live): { investigation?: AgentInvestigation } {
    if (live.folder === null) {
      return {};
    }
    return { investigation: { reads: [...live.reads], searches: [...live.searches], refused: live.refused, refusedCalls: [...live.refusedCalls] } };
  }

  /** A tool subject as a place in the revision folder (`target/src/a.ts`), or as reported. */
  private relative(live: Live, subject: string): string {
    const folder = live.folder;
    if (folder === null) {
      return subject;
    }
    const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);
    let out = subject;
    for (const spelling of [folder + path.sep, folder.replace(/\\/g, '/') + '/', folder]) {
      let at = fold(out).indexOf(fold(spelling));
      while (at >= 0) {
        out = out.slice(0, at) + out.slice(at + spelling.length);
        at = fold(out).indexOf(fold(spelling));
      }
    }
    return out.replace(/\\/g, '/');
  }

  private armCancelConfirmation(live: Live): void {
    const declared = live.adapter?.cancelEndBoundMs;
    const configured = this.options.cancelConfirmMs ?? CANCEL_CONFIRM_MS;
    const ms = declared === undefined || !Number.isFinite(declared) ? configured : Math.max(configured, declared + 1_000);
    const timer = setTimeout(() => {
      if (live.finished !== null) {
        live.finished('unconfirmed', null);
      }
    }, ms);
    timer.unref?.();
  }

  /**
   * The two revisions as files for a review discussion's session (Niclas's decision of 30
   * October 2026): the same folder a job reads, held under `holder` until released, the same
   * prompt section, and the same check of references against Git at the two commits.
   */
  async holdForDiscussion(review: string, pair: RevisionPairIdentity, holder: string): Promise<HeldRevisions> {
    // DSP-186: the discussion's own review, by its id; never another review of the same pair.
    const opened = this.options.pairs.opened(review) ?? (await this.options.pairs.openForWalk(pair, undefined, review));
    if (isPairError(opened)) {
      throw new Error(opened.error);
    }
    const key = opened.key;
    const material = await this.options.pairs.material(key);
    if (isPairError(material)) {
      throw new Error(material.error);
    }
    const snapshot = await this.options.snapshots.acquire(key, opened.pair, changedPaths(material), holder, await this.contextFor(key, opened.pair));
    this.options.contexts?.given(key, opened.pair, holder, snapshot.manifest.context);
    const context = contextReaderOf(snapshot.manifest.context);
    let released = false;
    return {
      folder: snapshot.folder,
      section: discussionFolderSection(withContext(material, snapshot.manifest), materialOf(snapshot.manifest)),
      check: (raw) => readStepAnswer(raw, (side, filePath) => this.options.pairs.linesAt(key, side, filePath), context),
      release: () => {
        if (!released) {
          released = true;
          this.options.snapshots.release(key, holder);
        }
      },
    };
  }

  /** The context repositories to write for a review now; none when they cannot be listed. */
  private async contextFor(key: string, pair: RevisionPairIdentity): Promise<readonly ContextRepository[]> {
    if (this.options.contexts === undefined) {
      return [];
    }
    try {
      return await this.options.contexts.current(key, pair);
    } catch (error) {
      this.options.log(`context for review ${key.slice(0, 12)} not given: ${describe(error)}`);
      return [];
    }
  }

  private async closeSession(live: Live): Promise<void> {
    live.unsubscribe?.();
    live.unsubscribe = null;
    const adapter = live.adapter;
    live.adapter = null;
    if (adapter !== null) {
      await adapter.dispose().catch(() => undefined);
    }
  }

  private async openSession(live: Live, provider: AgentProvider, model: string, workspacePath: string): Promise<void> {
    const adapter = this.options.createAdapter(provider);
    // The analysis policy exactly, or nothing is sent (fails closed, as the discussion does).
    const policy = adapter.permissionPolicy?.();
    const copilotPolicy = adapter.copilotPolicy?.();
    const copilotWrong = (adapter.id === 'copilot-sdk' && copilotPolicy === undefined) || (copilotPolicy !== undefined && !isDeepStrictEqual(copilotPolicy, COPILOT_ANALYSIS_POLICY));
    if (copilotWrong || (adapter.id === 'claude-agent-sdk' && policy === undefined) || (policy !== undefined && !isDeepStrictEqual(policy, ANALYSIS_PERMISSIONS))) {
      await adapter.dispose().catch(() => undefined);
      throw new Error('The adapter built for analysis does not hold the read-only analysis policy, so it was not used. Nothing was sent.');
    }
    live.adapter = adapter;
    // The default row names no model for Claude; Copilot's adapter has its own value for it.
    const handle = await adapter.startSession({ provider, modelRequested: model === 'default' ? '' : model, workspacePath });
    live.sessionId = handle.dspatchSessionId;
    live.unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
      this.onEvent(live, event);
    });
  }

  private onEvent(live: Live, event: AgentEvent): void {
    if (event.dspatchSessionId !== live.sessionId) {
      return;
    }
    if (event.type === 'run.started') {
      live.runId = event.dspatchRunId;
      return;
    }
    if (live.runId !== null && event.dspatchRunId !== live.runId) {
      return;
    }
    if (event.type === 'tool.started') {
      // Counted as read or searched only once its result says it ran.
      const subject = event.subject === undefined ? null : this.relative(live, event.subject);
      live.calls.set(event.toolCallId, { name: event.name, subject });
      const activity = toolActivity(event.name, subject);
      if (activity !== null) {
        this.setActivity(live, activity);
      }
    } else if (event.type === 'tool.finished') {
      const call = live.calls.get(event.toolCallId) ?? { name: event.name, subject: null };
      live.calls.delete(event.toolCallId);
      if (event.status === 'error') {
        live.refused += 1;
        if (live.refusedCalls.length < INVESTIGATION_LIMIT) {
          live.refusedCalls.push(call.subject === null ? call.name : `${call.name} ${call.subject}`);
        }
      } else if (call.subject !== null) {
        if (call.name === 'Read') {
          if (live.reads.size < INVESTIGATION_LIMIT) {
            live.reads.add(call.subject);
          }
        } else if (live.searches.length < INVESTIGATION_LIMIT) {
          live.searches.push(`${call.name} ${call.subject}`);
        }
      }
      // Its last tool has ended and nothing else is reported: before long "Reading a.ts"
      // is no longer true (DSP-158). Not at once, or a run of quick reads would read as waiting.
      if (live.calls.size === 0) {
        this.clearIdle(live);
        live.idleTimer = setTimeout(() => {
          live.idleTimer = null;
          this.setActivity(live, WAITING);
        }, TOOL_DONE_MS);
      }
    } else if (event.type === 'assistant.delta') {
      live.text += event.text;
      this.setActivity(live, writingNow(live.kind, live.text));
    } else if (event.type === 'assistant.message') {
      live.text = event.text;
      if (event.text !== '') {
        this.setActivity(live, writingNow(live.kind, live.text));
      }
    } else if (event.type === 'run.finished') {
      const status =
        event.status === 'finished' ? 'finished' : event.status === 'cancelled' ? (event.end === 'unconfirmed' ? 'unconfirmed' : 'cancelled') : 'failed';
      live.finished?.(status, event.error?.message ?? null);
    }
  }

  /** One turn: send, and wait for the provider's own end. */
  private async turn(live: Live, prompt: string): Promise<{ readonly status: 'finished' | 'failed' | 'cancelled' | 'unconfirmed'; readonly text: string; readonly error: string | null }> {
    const adapter = live.adapter;
    const sessionId = live.sessionId;
    if (adapter === null || sessionId === null) {
      return { status: 'failed', text: '', error: 'No session.' };
    }
    live.text = '';
    live.runId = null;
    this.setActivity(live, WAITING);
    const ended = new Promise<{ status: 'finished' | 'failed' | 'cancelled' | 'unconfirmed'; error: string | null }>((resolve) => {
      live.finished = (status, error) => {
        live.finished = null;
        resolve({ status, error });
      };
    });
    const reference = await adapter.send(sessionId, prompt);
    live.runId = live.runId ?? reference.dspatchRunId;
    if (live.cancelRequested) {
      // Stop was pressed while the send was on its way: the run is asked to stop at once.
      await adapter.cancel(sessionId).catch(() => undefined);
      this.armCancelConfirmation(live);
    }
    const end = await ended;
    return { status: end.status, text: live.text, error: end.error };
  }

  /** The end of a turn that did not finish normally, recorded truthfully. Returns true when the job is over. */
  private endedEarly(live: Live, outcome: { status: string; error: string | null }): boolean {
    if (live.cancelRequested) {
      if (outcome.status === 'cancelled') {
        this.finish(live, 'cancelled', 'Stopped. Nothing from it was used, and nothing was approved.');
      } else if (outcome.status === 'finished') {
        this.finish(live, 'cancelled', 'Stopped. The answer arrived after you stopped it and was not used; nothing was approved.');
      } else {
        this.finish(live, 'unknown', 'No confirmed end arrived after the request to stop, so how far it got is unknown. Nothing was approved.');
      }
      return true;
    }
    if (outcome.status === 'finished') {
      return false;
    }
    if (outcome.status === 'unconfirmed') {
      this.finish(live, 'unknown', 'The provider reported an end it could not confirm, so the outcome is unknown. Nothing was approved.');
    } else {
      this.finish(live, 'failed', 'The agent did not finish. Nothing was approved.', { detail: outcome.error ?? 'The provider reported a failure without a reason.' });
    }
    return true;
  }

  private async run(live: Live, job: AgentJob): Promise<void> {
    let held = false;
    try {
      const plain = await this.options.pairs.material(live.key);
      const opened = this.options.pairs.opened(live.key);
      if (isPairError(plain) || opened === null) {
        this.finish(live, 'failed', isPairError(plain) ? plain.error : 'That review is not open.');
        return;
      }
      let material: AnalysisMaterial = plain;
      const language = await this.options.language();
      // The two commits as files the agent reads, held until the session is closed.
      held = true;
      let folder: AgentMaterial;
      try {
        const snapshot = await this.options.snapshots.acquire(live.key, opened.pair, changedPaths(material), live.jobId, await this.contextFor(live.key, opened.pair));
        live.folder = snapshot.folder;
        folder = materialOf(snapshot.manifest);
        // DSP-175: the workspace's other repositories, described to the agent and recorded.
        material = withContext(material, snapshot.manifest);
        live.context = contextReaderOf(snapshot.manifest.context);
        if (this.accepts(live)) {
          this.options.contexts?.given(live.key, opened.pair, live.jobId, snapshot.manifest.context);
        }
      } catch (error) {
        this.finish(live, 'failed', 'The two revisions could not be prepared for the agent to read, so nothing was sent. Nothing was approved.', { detail: describe(error) });
        return;
      }
      // What the agent can read is on record before anything is sent.
      this.setJob(live, { material: folder });
      if (live.cancelRequested) {
        this.finish(live, 'cancelled', 'Stopped before anything was sent.');
        return;
      }
      try {
        await this.openSession(live, job.provider, job.model, live.folder);
        this.options.log(`review agent ${live.jobId}: session opened with ${job.provider}/${job.model} in the revision folder (${String(folder.files)} files, ${String(folder.skippedCount)} left out)`);
      } catch (error) {
        // No other agent or model is tried: what was chosen is what was asked for.
        this.finish(live, 'failed', `${providerName(job.provider)} could not start a session with ${job.model}. Nothing was sent, and nothing was approved.`, { detail: describe(error) });
        return;
      }
      if (live.cancelRequested) {
        this.finish(live, 'cancelled', 'Stopped before anything was sent.');
        return;
      }
      if (job.kind === 'walks') {
        await this.prepareWalks(live, job, walksPrompt(material, folder, language, isPublicProfile(job.presentation?.profile) ? job.presentation.profile : null), folder);
      } else if (job.kind === 'checks' && job.definitionPath !== null) {
        const outline = this.options.pairs.walksOf(live.key, job.definitionPath, language);
        if (isPairError(outline)) {
          this.finish(live, 'failed', `${outline.error} Nothing was sent.`);
          return;
        }
        await this.findChecks(live, job.definitionPath, checksPrompt(material, folder, outline, language), new Set(outline.flatMap((walk) => walk.steps.map((step) => step.id))));
      } else if (job.kind === 'explain' && job.selection !== undefined) {
        await this.explain(live, await this.selectionPromptFor(live.key, job, job.selection, material, folder, language));
      } else if (job.kind === 'explain' && job.question !== undefined) {
        const step = this.options.pairs.stepOf(live.key, job.question.definitionPath, job.question.walkId, job.question.stepId);
        if (isPairError(step)) {
          this.finish(live, 'failed', `${step.error} Nothing was sent.`);
          return;
        }
        const context = { walkTitle: step.walkTitle[language], stepTitle: step.stepTitle[language], summary: step.summary[language], body: step.body[language] };
        await this.explain(live, stepQuestionPrompt(material, folder, job.question, context, language));
      } else if (job.scope !== null) {
        // On record before it is sent, as the material is: what the agent was told.
        this.setJob(live, { instruction: reviewInstruction(job.scope, language) });
        await this.review(live, job, job.scope, reviewPrompt(material, folder, job.scope, language), folder);
      }
    } catch (error) {
      this.finish(live, 'failed', 'The agent could not be asked. Nothing was approved.', { detail: describe(error) });
    } finally {
      await this.closeSession(live);
      if (held) {
        // Only once the session is closed: nothing can read the folder after this.
        this.options.snapshots.release(live.key, live.jobId);
      }
    }
  }

  /** The line reader every result is checked with: Git at the pair's commits, not the folder. */
  private reader(live: Live): (side: 'base' | 'target', filePath: string) => Promise<readonly string[] | null> {
    return (side, filePath) => this.options.pairs.linesAt(live.key, side, filePath);
  }

  /**
   * The prompt for an explanation of selected code: the selection with the lines around each
   * part, read from Git at its side, and, for a follow-up, what was asked and answered
   * about the same selection before, in order.
   */
  private async selectionPromptFor(
    key: string,
    job: AgentJob,
    selection: CodeSelection,
    material: AnalysisMaterial,
    folder: AgentMaterial,
    language: 'sv' | 'en',
  ): Promise<string> {
    const around: string[] = [];
    for (const segment of selection.segments) {
      const lines = await this.options.pairs.linesAt(key, segment.side, segment.path);
      around.push(lines === null ? '' : linesAround(segment, lines));
    }
    const thread: ExplainTurn[] = [];
    const root = job.followUp?.root ?? null;
    const record = this.options.pairs.state(key);
    // Explain one answer more simply: the thread up to that answer, and the question it answered.
    const of = job.followUp?.of ?? null;
    let answered: string | undefined;
    if (root !== null && !isPairError(record)) {
      for (const entry of record.jobs) {
        const inThread = entry.id === root || entry.followUp?.root === root;
        if (!inThread || entry.id === job.id || entry.state !== 'done' || entry.answer === undefined) {
          continue;
        }
        const asked = entry.followUp === undefined ? (entry.asked ?? 'Explain the selected code.') : followUpWords(entry.followUp);
        thread.push({ asked, answer: entry.answer.answer });
        if (entry.id === of) {
          answered = asked;
          break;
        }
      }
    }
    // The person's own first question about the selection is asked as a question.
    const now = job.followUp ?? (job.asked === undefined ? null : { root: job.id, action: 'question' as const, question: job.asked });
    return selectionPrompt(material, folder, selection, around, thread.slice(-6), now, language, answered);
  }

  private async explain(live: Live, prompt: string): Promise<void> {
    const reply = await this.turn(live, prompt);
    if (this.endedEarly(live, reply)) {
      return;
    }
    const answer = await readStepAnswer(answerJson(reply.text), this.reader(live), live.context);
    if ('error' in answer) {
      this.finish(live, 'failed', `${answer.error} Nothing was changed.`);
      return;
    }
    if (live.cancelRequested) {
      this.endedEarly(live, { status: 'finished', error: null });
      return;
    }
    const left = answer.adjustments.length;
    this.finish(
      live,
      'done',
      (answer.insufficient
        ? 'The agent could not settle the question from the code it read.'
        : `Answered, pointing at ${String(answer.references.length)} place(s) in the code` +
          ((answer.contextReferences?.length ?? 0) > 0 ? ` and ${String(answer.contextReferences?.length ?? 0)} in other repositories of the workspace, read as context.` : '.')) +
        (left > 0 ? ` DSpatch left out ${String(left)} thing(s) it could not check.` : ''),
      { answer },
    );
  }

  private async prepareWalks(live: Live, job: AgentJob, prompt: string, folder: AgentMaterial): Promise<void> {
    const first = await this.turn(live, prompt);
    if (this.endedEarly(live, first)) {
      return;
    }
    const read = this.reader(live);
    this.setActivity(live, 'Checking every place against the commits');
    let parsed = readWalksAnswer(answerJson(first.text));
    let invalid = parsed.walks === null ? new Map<string, string>() : await walkPlaceProblems(parsed.walks, read, live.context);
    // DSP-185: a step with several places and no reason why they belong together goes into the same round.
    const crowded = parsed.walks === null ? new Map<string, string>() : new Map([...crowdedStepProblems(parsed.walks), ...[...repeatedStepProblems(parsed.walks)].map(([at, problem]) => [`r${at}`, problem] as const)]);
    // One repair round, naming what was wrong. Never a loop.
    if (parsed.walks === null || parsed.problems.length > 0 || invalid.size > 0 || crowded.size > 0) {
      this.setActivity(live, `Asking the agent to correct ${String(parsed.problems.length + invalid.size + crowded.size)} problem(s) DSpatch found`);
      const second = await this.turn(live, repairPrompt([...parsed.problems, ...invalid.values(), ...crowded.values()]));
      if (this.endedEarly(live, second)) {
        return;
      }
      const again = readWalksAnswer(answerJson(second.text));
      if (again.walks !== null) {
        parsed = again;
        invalid = await walkPlaceProblems(again.walks, read, live.context);
      }
    }
    if (parsed.walks === null) {
      this.finish(live, 'failed', 'The agent did not answer with walks DSpatch could read, even when asked again.');
      return;
    }
    // The points worth checking keep only the places that exist; their text stays.
    // DSP-175: context places carry the commit this analysis recorded for their repository.
    const checked = await withCheckedChecks(await withContextCommits(withoutInvalidPlaces(parsed.walks, invalid), live.context), read);
    const walks: ProposedWalks = checked.walks;
    if (walks.walks.length === 0) {
      this.finish(live, 'failed', 'None of the proposed walks had a place that exists at these commits, so none was kept.');
      return;
    }
    // DSP-185: still crowded after the one round: kept as written (no place or coverage is lost), and said.
    const stillCrowded = crowdedStepProblems(walks).size;
    const stillRepeated = repeatedStepProblems(walks).size;
    const opened = this.options.pairs.opened(live.key);
    const files = opened?.files ?? [];
    const uncovered = uncoveredBy(walks, files);
    const stepCount = walks.walks.reduce((total, walk) => total + walk.steps.length, 0);
    const definitionPath = path.join(this.options.recordsDir, 'generated', live.key, `${job.id}.review.json`);
    const generatedAt = new Date().toISOString();
    const readings = walks.walks.filter((walk) => walk.kind === 'reading').length;
    const forms = readings === 0 ? 'Code walks' : readings === walks.walks.length ? 'Readings' : 'Code walks and readings';
    const heading = `${forms} · ${opened?.repositoryName ?? ''} ${opened?.pair.base.slice(0, 7) ?? ''}→${opened?.pair.target.slice(0, 7) ?? ''}`;
    // The first sentence names the preparation where several are offered; the rest is for Details.
    const provenance =
      `Prepared by ${providerName(job.provider)} (${job.model}) on ${generatedAt.slice(0, 16).replace('T', ' ')} UTC. ` +
      'It read the two commits with its own read-only tools. DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing.' +
      (job.presentation === undefined ? '' : ` The step explanations are written in the ${PROFILE_PROMPT_NAMES[job.presentation.profile]} profile (instruction version ${String(job.presentation.version)}).`) +
      (invalid.size + checked.left > 0 ? ` ${String(invalid.size + checked.left)} place(s) that did not exist at their commit were left out.` : '') +
      (stillCrowded > 0 ? ` ${crowdedNote(stillCrowded)}` : '') +
      (stillRepeated > 0 ? ` ${repeatedNote(stillRepeated)}` : '') +
      (folder.skippedCount > 0 ? ` ${String(folder.skippedCount)} file(s) of the commits could not be given to the agent to read.` : '');
    if (!this.accepts(live)) {
      // DSP-186: the review was deleted, or the job is no longer its; the answer is dropped unwritten.
      this.options.log(`review agent ${live.jobId}: its review is gone or the job no longer runs there; the walks were not written`);
      return;
    }
    fs.mkdirSync(path.dirname(definitionPath), { recursive: true });
    fs.writeFileSync(definitionPath, `${JSON.stringify(definitionFrom(walks, opened?.pair ?? { repository: '', base: '', target: '' }, heading, provenance, job.presentation ?? null), null, 2)}\n`, 'utf8');
    // DSP-175: points written with the walks are review threads too (an answer of the older form).
    this.options.pairs.adoptChecks(live.key, definitionPath, live.jobId);
    const uncoveredLines = uncovered.reduce((total, range) => total + range.end - range.start + 1, 0);
    const contextPlaces = walks.walks.reduce((total, walk) => total + walk.steps.reduce((sum, step) => sum + (step.contextPlaces?.length ?? 0), 0), 0);
    this.finish(
      live,
      'done',
      `${String(walks.walks.length - readings)} walk(s) and ${String(readings)} reading(s), ${String(stepCount)} step(s).` +
        (uncoveredLines === 0 ? ' Every changed line is in one of them.' : ` ${String(uncoveredLines)} changed line(s) are in none of them.`) +
        (contextPlaces > 0 ? ` ${String(contextPlaces)} place(s) show code from other repositories of the workspace, read as context; they cover nothing.` : '') +
        (invalid.size > 0 ? ` ${String(invalid.size)} place(s) were left out because they do not exist at their commit.` : '') +
        (stillCrowded > 0 ? ` ${crowdedNote(stillCrowded)}` : '') +
        (stillRepeated > 0 ? ` ${repeatedNote(stillRepeated)}` : '') +
        (folder.skippedCount > 0 ? ` ${String(folder.skippedCount)} file(s) could not be given to the agent to read.` : ''),
      { definitionPath, uncovered },
    );
  }

  /**
   * What is worth checking over walks already written (30 October 2026): every place checked
   * against its commit, kept beside the walks' definition so the definition stays as written.
   * A point with no place left keeps its text; none is made up.
   */
  private async findChecks(live: Live, definitionPath: string, prompt: string, stepIds: ReadonlySet<string>): Promise<void> {
    const reply = await this.turn(live, prompt);
    if (this.endedEarly(live, reply)) {
      return;
    }
    this.setActivity(live, 'Checking every place against the commits');
    const parsed = readChecksAnswer(answerJson(reply.text), stepIds);
    if (parsed.checks === null) {
      this.finish(live, 'failed', 'The agent did not answer with points DSpatch could read. Nothing was changed.');
      return;
    }
    const checked = await withCheckedStandaloneChecks(parsed.checks, this.reader(live));
    if (live.cancelRequested) {
      this.endedEarly(live, { status: 'finished', error: null });
      return;
    }
    if (!this.accepts(live)) {
      this.options.log(`review agent ${live.jobId}: its review is gone or the job no longer runs there; the points were not written`);
      return;
    }
    const file = checksFileOf(definitionPath);
    fs.writeFileSync(
      file,
      `${JSON.stringify({ format: CHECKS_FILE_FORMAT, checks: checked.checks.map((check, index) => checkDefinition(check, `C${String(index + 1)}`)) }, null, 2)}\n`,
      'utf8',
    );
    // DSP-175: the points are review threads from now on, read back by the host from the file just written.
    this.options.pairs.adoptChecks(live.key, definitionPath, live.jobId);
    const count = (kind: string): number => checked.checks.filter((check) => check.kind === kind).length;
    const left = checked.left + parsed.problems.length;
    this.finish(
      live,
      'done',
      (checked.checks.length === 0
        ? 'The agent found nothing worth checking beyond the walks.'
        : `${String(checked.checks.length)} point(s) worth checking: ${String(count('question'))} question(s), ${String(count('uncertainty'))} uncertaint${count('uncertainty') === 1 ? 'y' : 'ies'}, ${String(count('finding'))} finding(s).`) +
        (left > 0 ? ` ${String(left)} place(s) or point(s) DSpatch could not check were left out.` : ''),
    );
  }

  private async review(live: Live, job: AgentJob, scope: DelegationScope, prompt: string, folder: AgentMaterial): Promise<void> {
    const answer = await this.turn(live, prompt);
    if (this.endedEarly(live, answer)) {
      return;
    }
    const files = this.options.pairs.opened(live.key)?.files ?? [];
    const read = readReviewAnswer(answerJson(answer.text), scope, files);
    if ('error' in read) {
      this.finish(live, 'failed', `${read.error} Nothing was approved.`);
      return;
    }
    // DSP-175: a finding may point at context code, checked at its recorded commit; context adds nothing to what is approved.
    let result = await withCheckedContext(await withCheckedFindings(read, this.reader(live)), answerJson(answer.text), live.context);
    // A file the agent could not read is not approved, whatever the answer says. When more
    // files were left out than are named, none can be told apart, so nothing is approved.
    const unreadable = new Set(folder.skipped.map((entry) => `${entry.side}:${entry.path}`));
    const unnamed = folder.skippedCount > folder.skipped.length;
    const blocked = result.approved.filter((range) => unnamed || unreadable.has(`${range.side}:${range.path}`));
    if (blocked.length > 0) {
      result = {
        ...result,
        approved: result.approved.filter((range) => !blocked.includes(range)),
        adjustments: [...result.adjustments, 'Lines in files the agent could not read were not approved.'],
      };
    }
    const recordedAt = new Date().toISOString();
    const reviews: AgentReview[] = result.approved.map((range) => ({
      id: `agent-${randomUUID()}`,
      scope: range,
      reviewer: `${providerName(job.provider)} · ${job.model}`,
      recordedAt,
      summary: result.assessment,
      jobId: job.id,
    }));
    const approvedLines = result.approved.reduce((total, range) => total + range.end - range.start + 1, 0);
    const problems = result.findings.filter((finding) => finding.severity === 'problem').length;
    const note = result.insufficient
      ? 'The agent found the material not enough to judge this part, so nothing was approved.'
      : `${String(approvedLines)} line(s) approved by the agent` +
        (problems > 0 ? `, ${String(problems)} problem(s) found` : '') +
        (result.uncertainties.length > 0 ? `, ${String(result.uncertainties.length)} uncertaint${result.uncertainties.length === 1 ? 'y' : 'ies'}` : '') +
        '.';
    // The approvals and the job's result are written together: a result without its
    // approvals, or approvals without the result that grounds them, never exist.
    if (!this.accepts(live) || live.cancelRequested) {
      this.endedEarly(live, { status: 'finished', error: null });
      return;
    }
    const endedAt = new Date().toISOString();
    const investigation = this.investigationOf(live);
    this.quiet(live);
    this.options.pairs.update(live.key, (record) => ({
      ...record,
      agentReviews: [...record.agentReviews, ...reviews],
      jobs: record.jobs.map((entry) => (entry.id === live.jobId ? { ...withoutActivity(entry), ...investigation, state: 'done', note, result, endedAt } : entry)),
    }));
    this.options.log(`review agent ${live.jobId}: done - ${note}`);
  }
}
