/**
 * Agent work over a revision pair (DSP-152): preparing code walks, and reviewing a part the
 * person explicitly delegated. The host runs it; windows start it, watch it through the
 * pair's record and may stop it.
 *
 * **The same agent connection as the review discussion.** Each job builds its adapter from
 * the shared factory for the `review` purpose and refuses one that does not hold the
 * review's own policy, exactly as `ReviewDiscussionService.ensureSession` does: no tools,
 * no files, no commands. The material is supplied in the prompt by the host, read from
 * the two commits (`ReviewPairs.material`), so the agent sees exactly the revisions under
 * review and nothing of a working copy, and cannot change anything. Decided within the
 * DSP-152 mandate (29 October 2026): this keeps the tool-free review policy as it is
 * rather than giving review agents file tools, and works the same for Claude and Cursor.
 *
 * **Outcomes are recorded, never assumed.** A job is written as running before anything is
 * sent. It ends as done or failed from what the provider reported, as cancelled only on a
 * confirmed end, and as unknown when that cannot be established — including a job that was
 * running when DSpatch stopped, which is never started again. Closing a window does not
 * touch a job; reopening reads the record.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { REVIEW_PERMISSIONS } from '../adapter/claude-agent-sdk-adapter';
import type { AgentEvent, Unsubscribe } from '../adapter/types';
import type { ChatAdapter } from '../main/chat-service';
import {
  answerJson,
  definitionFrom,
  readReviewAnswer,
  readWalksAnswer,
  repairPrompt,
  reviewPrompt,
  uncoveredBy,
  walkPlaceProblems,
  walksPrompt,
  withoutInvalidPlaces,
  type ProposedWalks,
} from '../shared/review-agent';
import {
  agentChoiceFrom,
  changedLinesOf,
  isPairError,
  lineKey,
  type AgentJob,
  type AgentReview,
  type DelegationScope,
  type LineRange,
  type PairAnswer,
  type PairRecord,
  type ReviewAgentChoice,
  type ReviewAgents,
} from '../shared/review-pair';
import type { ReviewPairs } from './review-pairs';

export type AgentProvider = 'cursor' | 'claude';

/** What a window asks for. Checked here before anything is written or sent. */
export interface AgentJobRequest {
  readonly kind: 'walks' | 'review';
  readonly provider: AgentProvider;
  readonly model: string;
  readonly scope?: DelegationScope;
}

export interface ReviewAgentJobsOptions {
  /** `userData/reviews`: generated walks under `generated/`, the agent's empty folder under `agent-cwd/`. */
  readonly recordsDir: string;
  /** The shared factory, bound to the review purpose. */
  readonly createAdapter: (provider: AgentProvider) => ChatAdapter;
  readonly availability: (provider: AgentProvider) => { readonly choosable: boolean; readonly reason: string | null };
  readonly pairs: ReviewPairs;
  /** The review language, for what the agent writes. */
  readonly language: () => Promise<'sv' | 'en'>;
  readonly log: (message: string) => void;
  /** Test override for how long a cancelled run is given to report its end. */
  readonly cancelConfirmMs?: number;
}

interface Live {
  readonly key: string;
  readonly jobId: string;
  adapter: ChatAdapter | null;
  sessionId: string | null;
  unsubscribe: Unsubscribe | null;
  runId: string | null;
  text: string;
  cancelRequested: boolean;
  finished: ((status: 'finished' | 'failed' | 'cancelled' | 'unconfirmed', error: string | null) => void) | null;
}

const CANCEL_CONFIRM_MS = 15_000;

function providerName(provider: AgentProvider): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
              ...job,
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
    const options = (['claude', 'cursor'] as const).map((provider) => ({ provider, ...this.options.availability(provider) }));
    const fromReview = record.agent;
    const fromOpener = agentChoiceFrom(opener);
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

  /** Start a job from an explicit request. Refused, with a reason, before anything is written if it cannot run. */
  start(key: unknown, raw: unknown): PairAnswer<AgentJob> {
    if (typeof key !== 'string') {
      return { error: 'That review is not open.' };
    }
    const request = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
    const kind = request['kind'];
    const provider = request['provider'];
    const model = typeof request['model'] === 'string' ? request['model'].trim() : '';
    if (kind !== 'walks' && kind !== 'review') {
      return { error: 'Unknown kind of agent work.' };
    }
    if (provider !== 'cursor' && provider !== 'claude') {
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
    let scope: DelegationScope | null = null;
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
      note: kind === 'walks' ? 'Preparing code walks.' : `Reviewing ${scope?.label ?? 'the delegated part'}.`,
      detail: '',
      scope,
      result: null,
      definitionPath: null,
      uncovered: [],
    };
    // Written before anything is sent: a job that never reached the disk could not be
    // reconciled after a restart. The agent and model it was started with become the
    // review's choice: the next job starts from them, whatever window opens it.
    const written = this.options.pairs.update(key, (current) => ({ ...current, agent: { provider, model }, jobs: [...current.jobs, job] }));
    if (isPairError(written)) {
      return written;
    }
    const live: Live = { key, jobId: job.id, adapter: null, sessionId: null, unsubscribe: null, runId: null, text: '', cancelRequested: false, finished: null };
    this.live.set(job.id, live);
    void this.run(live, job).finally(() => {
      this.live.delete(job.id);
    });
    return job;
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
    const written = this.options.pairs.update(live.key, (record) => ({
      ...record,
      jobs: record.jobs.map((job) => (job.id === live.jobId ? { ...job, ...change } : job)),
    }));
    return isPairError(written) ? null : written;
  }

  /** The job's final state, once: a later attempt to end it again changes nothing. */
  private finish(live: Live, state: AgentJob['state'], note: string, extra: Partial<AgentJob> = {}): void {
    const current = this.options.pairs.state(live.key);
    const job = isPairError(current) ? undefined : current.jobs.find((entry) => entry.id === live.jobId);
    if (job === undefined || (job.state !== 'running' && job.state !== 'cancelling')) {
      return;
    }
    this.setJob(live, { ...extra, state, note, endedAt: new Date().toISOString() });
    this.options.log(`review agent ${live.jobId}: ${state} - ${note}`);
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

  private async closeSession(live: Live): Promise<void> {
    live.unsubscribe?.();
    live.unsubscribe = null;
    const adapter = live.adapter;
    live.adapter = null;
    if (adapter !== null) {
      await adapter.dispose().catch(() => undefined);
    }
  }

  private async openSession(live: Live, provider: AgentProvider, model: string): Promise<void> {
    const workspacePath = path.join(this.options.recordsDir, 'agent-cwd', live.key);
    fs.mkdirSync(workspacePath, { recursive: true });
    const adapter = this.options.createAdapter(provider);
    // The review's own policy, or nothing is sent (as the discussion: fails closed).
    const policy = adapter.permissionPolicy?.();
    if ((adapter.id === 'claude-agent-sdk' && policy === undefined) || (policy !== undefined && !isDeepStrictEqual(policy, REVIEW_PERMISSIONS))) {
      await adapter.dispose().catch(() => undefined);
      throw new Error('The adapter built for review does not hold the review policy, so it was not used. Nothing was sent.');
    }
    live.adapter = adapter;
    const handle = await adapter.startSession({ provider, modelRequested: model, workspacePath });
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
    if (event.type === 'assistant.delta') {
      live.text += event.text;
    } else if (event.type === 'assistant.message') {
      live.text = event.text;
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
    try {
      const material = await this.options.pairs.material(live.key);
      if (isPairError(material)) {
        this.finish(live, 'failed', material.error);
        return;
      }
      const language = await this.options.language();
      try {
        await this.openSession(live, job.provider, job.model);
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
        await this.prepareWalks(live, job, walksPrompt(material, language));
      } else if (job.scope !== null) {
        await this.review(live, job, job.scope, reviewPrompt(material, job.scope, language));
      }
    } catch (error) {
      this.finish(live, 'failed', 'The agent could not be asked. Nothing was approved.', { detail: describe(error) });
    } finally {
      await this.closeSession(live);
    }
  }

  private async prepareWalks(live: Live, job: AgentJob, prompt: string): Promise<void> {
    const first = await this.turn(live, prompt);
    if (this.endedEarly(live, first)) {
      return;
    }
    const read = (side: 'base' | 'target', filePath: string): Promise<readonly string[] | null> =>
      this.options.pairs.linesAt(live.key, side, filePath);
    let parsed = readWalksAnswer(answerJson(first.text));
    let invalid = parsed.walks === null ? new Map<string, string>() : await walkPlaceProblems(parsed.walks, read);
    // One repair round, naming what was wrong. Never a loop.
    if (parsed.walks === null || parsed.problems.length > 0 || invalid.size > 0) {
      const second = await this.turn(live, repairPrompt([...parsed.problems, ...invalid.values()]));
      if (this.endedEarly(live, second)) {
        return;
      }
      const again = readWalksAnswer(answerJson(second.text));
      if (again.walks !== null) {
        parsed = again;
        invalid = await walkPlaceProblems(again.walks, read);
      }
    }
    if (parsed.walks === null) {
      this.finish(live, 'failed', 'The agent did not answer with walks DSpatch could read, even when asked again.');
      return;
    }
    const walks: ProposedWalks = withoutInvalidPlaces(parsed.walks, invalid);
    if (walks.walks.length === 0) {
      this.finish(live, 'failed', 'None of the proposed walks had a place that exists at these commits, so none was kept.');
      return;
    }
    const opened = this.options.pairs.opened(live.key);
    const files = opened?.files ?? [];
    const uncovered = uncoveredBy(walks, files);
    const stepCount = walks.walks.reduce((total, walk) => total + walk.steps.length, 0);
    const definitionPath = path.join(this.options.recordsDir, 'generated', live.key, `${job.id}.review.json`);
    const generatedAt = new Date().toISOString();
    const heading = `Code walks · ${opened?.repositoryName ?? ''} ${opened?.pair.base.slice(0, 7) ?? ''}→${opened?.pair.target.slice(0, 7) ?? ''}`;
    const provenance =
      `Prepared by ${providerName(job.provider)} (${job.model}) on ${generatedAt} from the two commits. ` +
      'DSpatch checked that every place exists at its commit; it did not check the explanations. A walk is not a review and approves nothing.' +
      (invalid.size > 0 ? ` ${String(invalid.size)} place(s) that did not exist at their commit were left out.` : '');
    fs.mkdirSync(path.dirname(definitionPath), { recursive: true });
    fs.writeFileSync(definitionPath, `${JSON.stringify(definitionFrom(walks, opened?.pair ?? { repository: '', base: '', target: '' }, heading, provenance), null, 2)}\n`, 'utf8');
    const uncoveredLines = uncovered.reduce((total, range) => total + range.end - range.start + 1, 0);
    this.finish(
      live,
      'done',
      `${String(walks.walks.length)} walk(s), ${String(stepCount)} step(s).` +
        (uncoveredLines === 0 ? ' Every changed line is in a walk.' : ` ${String(uncoveredLines)} changed line(s) are in no walk.`) +
        (invalid.size > 0 ? ` ${String(invalid.size)} place(s) were left out because they do not exist at their commit.` : ''),
      { definitionPath, uncovered },
    );
  }

  private async review(live: Live, job: AgentJob, scope: DelegationScope, prompt: string): Promise<void> {
    const answer = await this.turn(live, prompt);
    if (this.endedEarly(live, answer)) {
      return;
    }
    const files = this.options.pairs.opened(live.key)?.files ?? [];
    const result = readReviewAnswer(answerJson(answer.text), scope, files);
    if ('error' in result) {
      this.finish(live, 'failed', `${result.error} Nothing was approved.`);
      return;
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
    const current = this.options.pairs.state(live.key);
    const stillRunning = !isPairError(current) && current.jobs.some((entry) => entry.id === live.jobId && (entry.state === 'running' || entry.state === 'cancelling'));
    if (!stillRunning || live.cancelRequested) {
      this.endedEarly(live, { status: 'finished', error: null });
      return;
    }
    const endedAt = new Date().toISOString();
    this.options.pairs.update(live.key, (record) => ({
      ...record,
      agentReviews: [...record.agentReviews, ...reviews],
      jobs: record.jobs.map((entry) => (entry.id === live.jobId ? { ...entry, state: 'done', note, result, endedAt } : entry)),
    }));
    this.options.log(`review agent ${live.jobId}: done - ${note}`);
  }
}
