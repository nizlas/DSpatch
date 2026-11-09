/**
 * One review discussion per repository and revision pair (Niclas's decision of 30 October
 * 2026): questions from the diff, from a code walk and from an opened reference go to the
 * same conversation, with the same history, draft, agent and model.
 *
 * This module gives that discussion what only the pair can give it: the context a question
 * from the diff window is sent with, read from the two commits (a walk window builds its own
 * from its review, as before), and, when the pair's discussion is first opened, the history
 * it starts from: the discussions held earlier over walks of the same pair and the
 * explanations asked for in the diff. Those records are read, never changed or removed.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { EnvelopeSource } from '../main/review-discussion-service';
import {
  DETAILS_MARKER,
  PROVIDER_ADDED_CONTEXT_LINE,
  adoptDiscussionRecord,
  type ContextEnvelope,
  type DiscussionIdentity,
  type DiscussionMessage,
  type DiscussionStatus,
  type DiscussionSubject,
  type EnvelopeOutcome,
  type EnvelopeRange,
  type EnvelopeRangeRole,
  type EnvelopeThread,
} from '../shared/review-discussion';
import { KIND_WORDS, RECOMMENDATION_WORDS, STATUS_WORDS, reviewThreadsOf, type ReviewThread } from '../shared/review-threads';
import { checkedQuote, envelopeRange, type RevisionReader } from '../shared/review-envelope-read';
import type { CodeLocation, FileChangeStatus, Lang, RevisionSide } from '../shared/review-model';
import { isLegacyReviewId, segmentWords, shownPath, type AgentJob, type OpenPair, type PairFile, type RevisionPairIdentity } from '../shared/review-pair';
import type { ReviewPairs } from './review-pairs';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function locationOf(value: unknown): CodeLocation | null {
  if (!isObject(value)) {
    return null;
  }
  const { side, path: filePath, start, end } = value;
  if ((side !== 'base' && side !== 'target') || typeof filePath !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)) {
    return null;
  }
  if ((start as number) < 1 || (end as number) < (start as number)) {
    return null;
  }
  return { side, path: filePath, start: start as number, end: end as number };
}

function changeStatus(file: PairFile): FileChangeStatus {
  return file.status === 'added' || file.status === 'deleted' || file.status === 'type-changed' ? file.status : 'modified';
}

function identityOf(open: OpenPair): ContextEnvelope['identity'] {
  return {
    title: `${open.repositoryName} ${open.pair.base.slice(0, 7)}→${open.pair.target.slice(0, 7)}`,
    definitionPath: '',
    definitionHash: '',
    repository: open.pair.repository,
    base: { sha: open.pair.base, subject: open.base.subject },
    target: { sha: open.pair.target, subject: open.target.subject },
  };
}

/** A thread as a question in it is sent with: what the person sees in it, as it stands. */
export function envelopeThreadOf(thread: ReviewThread): EnvelopeThread {
  const recommendation = thread.recommendation;
  return {
    id: thread.id,
    kind: KIND_WORDS[thread.kind],
    status: STATUS_WORDS[thread.status],
    title: thread.title,
    explanation: [thread.explanation, thread.details].filter((entry) => entry.trim() !== '').join('\n\n'),
    evidence: thread.evidence,
    recommendation:
      recommendation === null
        ? ''
        : [`${RECOMMENDATION_WORDS[recommendation.kind]}: ${recommendation.action}`, recommendation.rationale && `Why: ${recommendation.rationale}`, recommendation.uncertainty && `Uncertain: ${recommendation.uncertainty}`, recommendation.nextStep && `Next step: ${recommendation.nextStep}`]
            .filter((entry) => entry !== '')
            .join('\n'),
    gaps: thread.gaps.map((gap) => gap.text),
    comments: thread.events.filter((event) => event.text.trim() !== '').map((event) => (event.kind === 'comment' ? event.text : `${event.kind}: ${event.text}`)),
  };
}

/**
 * What a question from the diff window is sent with: the code location asked about, or the
 * change as a whole, the selection checked against Git, and ranges read at the two commits.
 * Never the working copy, and never text the window sends in place of the commits'.
 */
export function pairEnvelopeSource(pairs: ReviewPairs, key: string): EnvelopeSource {
  return {
    envelopeFor: async (request: unknown): Promise<EnvelopeOutcome> => {
      const open = pairs.opened(key);
      if (open === null) {
        return { kind: 'refused', error: 'This revision pair is not open, so nothing was sent.' };
      }
      const raw = isObject(request) ? request : {};
      const language: Lang = raw['language'] === 'sv' ? 'sv' : 'en';
      const read: RevisionReader = async (side, filePath) => {
        const lines = await pairs.linesAt(key, side, filePath);
        return lines === null ? { kind: 'missing' } : { kind: 'text', lines };
      };
      const shaOf = (side: RevisionSide): string => (side === 'base' ? open.pair.base : open.pair.target);
      const subjectRaw = isObject(raw['subject']) ? raw['subject'] : {};
      const ranges: { role: EnvelopeRangeRole; location: CodeLocation }[] = [];
      let subject: DiscussionSubject;
      let overview: ContextEnvelope['overview'] = null;
      let thread: EnvelopeThread | null = null;
      if (subjectRaw['kind'] === 'away') {
        const location = locationOf(subjectRaw['location']);
        if (location === null) {
          return { kind: 'refused', error: 'The code location asked about is not a valid location in this change.' };
        }
        subject = { kind: 'away', location };
        ranges.push({ role: 'location', location });
      } else if (subjectRaw['kind'] === 'review') {
        subject = { kind: 'review' };
        overview = { summary: '', walkTitles: [], changedFiles: open.files.map((file) => ({ path: shownPath(file), status: changeStatus(file) })) };
      } else if (subjectRaw['kind'] === 'thread' && typeof subjectRaw['threadId'] === 'string') {
        // DSP-175: a question in a review thread goes with the thread as it stands and the
        // code at its checked places; the answer is kept in that thread.
        const found = reviewThreadsOf(pairs.storedRecord(key, open.pair)).find((entry) => entry.id === subjectRaw['threadId']);
        if (found === undefined) {
          return { kind: 'refused', error: 'That thread is not in this review, so nothing was sent.' };
        }
        subject = { kind: 'thread', threadId: found.id };
        thread = envelopeThreadOf(found);
        for (const anchor of found.anchors.slice(0, 4)) {
          ranges.push({ role: 'location', location: { side: anchor.side, path: anchor.path, start: anchor.start, end: anchor.end } });
        }
      } else {
        return { kind: 'refused', error: 'A question from the diff is about a code location or the change as a whole.' };
      }
      const selection = raw['selection'] === null || raw['selection'] === undefined ? null : locationOf(raw['selection']);
      if (selection !== null) {
        ranges.push({ role: 'selection', location: selection });
      }
      const quote = await checkedQuote(raw['quote'] ?? null, read, shaOf);
      if (quote !== null && 'error' in quote) {
        return { kind: 'refused', error: quote.error };
      }
      const read_: EnvelopeRange[] = [];
      for (const { role, location } of ranges) {
        read_.push(await envelopeRange(read, shaOf, role, location));
      }
      return {
        kind: 'built',
        envelope: {
          version: 1,
          identity: identityOf(open),
          language,
          subject,
          selection,
          explanation: null,
          overview,
          ranges: read_,
          quote,
          ...(thread === null ? {} : { thread }),
          notes: [],
          providerContext: PROVIDER_ADDED_CONTEXT_LINE,
          builtAt: new Date().toISOString(),
        },
      };
    },
  };
}

const FOLLOW_UP_ASKED: Record<'more' | 'simpler' | 'question', string> = { more: 'Tell me more', simpler: 'Explain more simply', question: '' };

function jobStatus(job: AgentJob): DiscussionStatus {
  return job.state === 'done' ? 'done' : job.state === 'cancelled' ? 'cancelled' : job.state === 'failed' ? 'failed' : 'unknown';
}

/** An explanation asked for in the diff before the discussion was one, as a question and its answer. */
function explanationMessages(job: AgentJob, pair: RevisionPairIdentity, roots: ReadonlyMap<string, AgentJob>): DiscussionMessage[] {
  const selection = job.selection ?? (job.followUp === undefined ? undefined : roots.get(job.followUp.root)?.selection);
  if (selection === undefined) {
    return [];
  }
  const first = selection.segments[0];
  const subjectLine = first === undefined ? 'selected code' : segmentWords(first);
  const asked =
    job.followUp === undefined
      ? (job.asked ?? 'Explain this')
      : job.followUp.action === 'question'
        ? job.followUp.question
        : FOLLOW_UP_ASKED[job.followUp.action];
  const location: CodeLocation | null = first === undefined ? null : { side: first.side, path: first.path, start: first.start, end: first.end };
  const envelope: ContextEnvelope = {
    version: 1,
    identity: { title: '', definitionPath: '', definitionHash: '', repository: pair.repository, base: { sha: pair.base, subject: '' }, target: { sha: pair.target, subject: '' } },
    language: 'en',
    subject: location === null ? { kind: 'review' } : { kind: 'away', location },
    selection: null,
    explanation: null,
    overview: null,
    ranges: [],
    quote: {
      kind: 'code',
      segments: selection.segments.map((segment) => ({
        side: segment.side,
        path: segment.path,
        start: segment.start,
        end: segment.end,
        from: segment.from,
        to: segment.to,
        sha: segment.side === 'base' ? pair.base : pair.target,
        text: segment.text,
      })),
    },
    notes: [],
    providerContext: PROVIDER_ADDED_CONTEXT_LINE,
    builtAt: job.startedAt,
  };
  const questionId = `explain-${job.id}`;
  const question: DiscussionMessage = {
    id: questionId,
    role: 'question',
    text: asked,
    at: job.startedAt,
    subject: subjectLine,
    envelope,
    status: 'sent',
    provider: job.provider,
    model: job.model,
    codeAccess: true,
  };
  const answerText = job.answer === undefined ? '' : (job.answer.details ?? '').trim() === '' ? job.answer.answer : `${job.answer.answer}\n\n${DETAILS_MARKER}\n\n${job.answer.details ?? ''}`;
  const answer: DiscussionMessage = {
    id: `${questionId}-answer`,
    role: 'answer',
    questionId,
    text: answerText,
    at: job.endedAt ?? job.startedAt,
    subject: subjectLine,
    status: jobStatus(job),
    provider: job.provider,
    model: job.model,
    ...(job.answer === undefined ? {} : { references: job.answer.references, adjustments: job.answer.adjustments }),
    ...(job.answer?.insufficient === true ? { insufficient: true } : {}),
    ...(job.state === 'done' ? {} : { error: job.note }),
  };
  return [question, answer];
}

/**
 * The history a review's discussion starts from, the first time it is opened: every
 * explanation asked for in the diff of this review, and, for a review recorded before
 * review ids only, every discussion kept earlier over a walk of the same pair, in the order
 * they happened. A review started since begins with nothing of any other review (DSP-186).
 * Each question keeps its own envelope, quote and revisions. Nothing is sent and nothing is
 * approved; the earlier records stay as they are.
 */
export function earlierDiscussion(
  recordsDir: string,
  identity: DiscussionIdentity,
  samePair: (other: { readonly repository: string; readonly base: string; readonly target: string }) => boolean,
  pairs: ReviewPairs,
): readonly DiscussionMessage[] {
  const messages: DiscussionMessage[] = [];
  // DSP-186 review: a legacy review of this pair was deleted. What was discussed before then is
  // not gathered again into a later review of the pair; the files themselves are left as they are.
  const deletedAt = pairs.legacyDeletedAt(identity.key);
  let names: string[] = [];
  try {
    // Discussions of reviews with ids are each their own review's, never gathered into another.
    names = isLegacyReviewId(identity.key)
      ? fs.readdirSync(recordsDir).filter((name) => name.endsWith('.discussion.json') && name !== `${identity.key}.discussion.json` && !name.startsWith('r-'))
      : [];
  } catch {
    names = [];
  }
  for (const name of names) {
    let raw: unknown = null;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(recordsDir, name), 'utf8'));
    } catch {
      continue;
    }
    const stored = isObject(raw) && isObject(raw['identity']) ? raw['identity'] : null;
    if (
      stored === null ||
      typeof stored['key'] !== 'string' ||
      typeof stored['repository'] !== 'string' ||
      stored['base'] !== identity.base ||
      stored['target'] !== identity.target ||
      !samePair({ repository: stored['repository'], base: identity.base, target: identity.target })
    ) {
      continue;
    }
    const adopted = adoptDiscussionRecord(raw, {
      key: stored['key'],
      repository: stored['repository'],
      base: identity.base,
      target: identity.target,
      definitionPath: typeof stored['definitionPath'] === 'string' ? stored['definitionPath'] : '',
    });
    if (adopted.kind !== 'adopted') {
      continue;
    }
    for (const message of adopted.record.messages) {
      if (deletedAt !== null && message.at <= deletedAt) {
        continue;
      }
      // A turn that had not ended there has no outcome known here.
      const status: DiscussionStatus = message.status === 'sending' || message.status === 'streaming' || message.status === 'sent' ? (message.role === 'question' ? 'sent' : 'unknown') : message.status;
      messages.push({ ...message, status });
    }
  }
  const pair: RevisionPairIdentity = { repository: identity.repository, base: identity.base, target: identity.target };
  const jobs = pairs.storedRecord(identity.key, pair).jobs.filter((job) => job.kind === 'explain' && (job.selection !== undefined || job.followUp !== undefined));
  const roots = new Map(jobs.filter((job) => job.followUp === undefined).map((job) => [job.id, job]));
  for (const job of jobs) {
    messages.push(...explanationMessages(job, pair, roots));
  }
  const seen = new Set<string>();
  return messages
    .filter((message) => (seen.has(message.id) ? false : (seen.add(message.id), true)))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.role === 'question' && b.role === 'answer' ? -1 : 0));
}
