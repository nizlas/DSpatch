import type { AttemptKind, AttemptState, AttemptStep, StoredAttempt } from './bridge';
import type { CodeLocation, EvidenceLabel, FileChangeStatus, Lang, ReviewNote, RevisionSide } from './review-model';

/**
 * A discussion about the code under review (DSP-127): what is asked, what the model
 * is given, and what is kept.
 *
 * Pure: no `fs`, no provider, no Electron. The main process builds the context
 * envelope from the review definition, the reviewer's record and the code read from
 * git at the fixed revisions; this module turns an envelope into the exact text that
 * is sent, and words it for the window.
 *
 * The envelope is the one place where repository bytes become model context. Nothing
 * filters it today; a future content-exclusion check belongs where it is built
 * (`ReviewService.envelopeFor`), before this module ever sees the text.
 */

// --- What DSpatch tells the model -----------------------------------------------

/**
 * DSpatch's own instruction for a review discussion. The only one: it is sent first
 * in every prompt, shown verbatim in every message's Context, and named in the
 * README. Changing it changes what every review question tells the model.
 */
export const REVIEW_DISCUSSION_INSTRUCTION =
  'You are helping a person review a code change. Explain and review the code supplied below, ' +
  'as it is at the revision named. You cannot change code, run commands or read anything ' +
  'beyond what is supplied here. When the supplied context is not enough to answer, say so ' +
  'and say what is missing, rather than guessing.';

/**
 * What DSpatch knows about context the provider may add on its own account. Shown in
 * every Context beside the instruction, because it is part of what the model may see
 * and DSpatch cannot see it.
 */
export const PROVIDER_ADDED_CONTEXT_LINE = 'provider-added context (user-level rules and hooks): unknown';

// --- What a question is about ---------------------------------------------------

/** What the person was looking at when they asked. Validated in main against the definition. */
export type DiscussionSubject =
  | { readonly kind: 'point'; readonly walkId: string; readonly stepId: string; readonly placeIndex: number }
  | { readonly kind: 'away'; readonly location: CodeLocation }
  | { readonly kind: 'review' };

/** What the window sends to have an envelope built: the subject, and a selection if any. */
export interface DiscussionRequest {
  readonly subject: DiscussionSubject;
  /** Lines the person has selected in the code, if any. */
  readonly selection: CodeLocation | null;
  /** The display language the explanation is taken in; the service's preference when absent. */
  readonly language?: Lang;
}

// --- The context envelope -------------------------------------------------------

/** Why a range of code is in the envelope. */
export type EnvelopeRangeRole = 'focus' | 'unit' | 'counterpart' | 'context' | 'location' | 'selection';

/** One range of code, read from git at the commit named by `sha`. Never the working tree. */
export interface EnvelopeRange {
  readonly role: EnvelopeRangeRole;
  readonly path: string;
  readonly side: RevisionSide;
  /** The full commit the lines were read at. */
  readonly sha: string;
  /** 1-based, inclusive: what was asked for. */
  readonly start: number;
  readonly end: number;
  /** The lines that were read, `start` first. Fewer than asked when the file is shorter or the range was bounded. */
  readonly lines: readonly string[];
  /** Lines asked for but left out by {@link ENVELOPE_LIMITS.rangeLines}. */
  readonly omittedLines: number;
  /** Why no lines could be read, when none could: missing at that revision, binary, or a read error. */
  readonly problem: string | null;
}

export interface EnvelopeEvidence {
  readonly label: EvidenceLabel;
  /** The label in the display language, as the window words it. */
  readonly labelText: string;
  readonly text: string;
}

/** The prepared explanation of a point, in the display language. */
export interface EnvelopeExplanation {
  readonly walkNumber: number;
  readonly walkTitle: string;
  readonly stepTitle: string;
  readonly summary: string;
  readonly body: string;
  readonly why: string;
  readonly placeLabel: string;
  readonly evidence: readonly EnvelopeEvidence[];
}

/** The review as a whole, for a question that is not about one point. */
export interface EnvelopeOverview {
  readonly summary: string;
  readonly walkTitles: readonly string[];
  readonly changedFiles: readonly { readonly path: string; readonly status: FileChangeStatus }[];
}

export interface EnvelopeNote {
  readonly kind: ReviewNote['kind'];
  readonly status: ReviewNote['status'];
  readonly text: string;
  readonly resolution: string;
  readonly location: CodeLocation | null;
  readonly stepId: string | null;
}

export interface EnvelopeIdentity {
  readonly title: string;
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly repository: string;
  readonly base: { readonly sha: string; readonly subject: string };
  readonly target: { readonly sha: string; readonly subject: string };
}

/**
 * Everything a question is sent with, frozen when it is sent and stored on the
 * question. An answer belongs to the question it was asked with, never to wherever
 * the window happens to be when it arrives.
 */
export interface ContextEnvelope {
  readonly version: 1;
  readonly identity: EnvelopeIdentity;
  readonly language: Lang;
  readonly subject: DiscussionSubject;
  readonly selection: CodeLocation | null;
  /** Point subjects only. */
  readonly explanation: EnvelopeExplanation | null;
  /** Whole-review subjects only. */
  readonly overview: EnvelopeOverview | null;
  readonly ranges: readonly EnvelopeRange[];
  readonly notes: readonly EnvelopeNote[];
  /** {@link PROVIDER_ADDED_CONTEXT_LINE}: what the provider adds is not visible to DSpatch. */
  readonly providerContext: string;
  readonly builtAt: string;
}

/** The answer to an envelope request: an envelope, or a plain reason it was refused. */
export type EnvelopeOutcome =
  | { readonly kind: 'built'; readonly envelope: ContextEnvelope }
  | { readonly kind: 'refused'; readonly error: string };

/**
 * Bounds on what goes to the model. Every cut is stated in the text sent, never
 * silent: a model told less than it thinks it has been told answers with confidence
 * about code it has not seen.
 */
export const ENVELOPE_LIMITS = {
  /** Lines kept per range when the envelope is built. */
  rangeLines: 400,
  /** Characters per range in the prompt. */
  rangeChars: 16_000,
  /** Characters for all code together; later ranges are named but left out. */
  codeChars: 48_000,
  /** Characters for each explanation text (summary, body, why). */
  explanationChars: 6_000,
  /** Characters for the notes together. */
  notesChars: 4_000,
  /** Changed files listed for a whole-review question. */
  changedFiles: 200,
  /** Characters for the recap of earlier questions. */
  recapChars: 8_000,
  /** Characters of the question itself. */
  questionChars: 16_000,
} as const;

/** What a cut says, in the text sent. */
export function truncatedMarker(shown: number, total: number, unit: string): string {
  return `[truncated: ${String(shown)} of ${String(total)} ${unit} shown]`;
}

function clip(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n${truncatedMarker(max, text.length, 'characters')}`;
}

// --- The one-line subject -------------------------------------------------------

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function lineSpan(start: number, end: number): string {
  return start === end ? String(start) : `${String(start)}–${String(end)}`;
}

function shaFor(envelope: ContextEnvelope, side: RevisionSide): string {
  return side === 'base' ? envelope.identity.base.sha : envelope.identity.target.sha;
}

function locationText(envelope: ContextEnvelope, location: CodeLocation): string {
  return `${location.path} ${lineSpan(location.start, location.end)} @${shortSha(shaFor(envelope, location.side))}`;
}

function selectionText(envelope: ContextEnvelope, near: CodeLocation | null): string {
  const selection = envelope.selection;
  if (selection === null) {
    return '';
  }
  if (near !== null && near.path === selection.path && near.side === selection.side) {
    return ` (+ selection ${lineSpan(selection.start, selection.end)})`;
  }
  return ` (+ selection ${locationText(envelope, selection)})`;
}

/**
 * The compact one-liner shown above the composer and on each question, e.g.
 * `Walk 2 › Cancel path › adapter.cancel · src/main/x.ts 120–148 @def5678 (+ selection 130–134)`.
 */
export function subjectLine(envelope: ContextEnvelope): string {
  const subject = envelope.subject;
  if (subject.kind === 'point') {
    const explanation = envelope.explanation;
    const focus = envelope.ranges.find((range) => range.role === 'focus') ?? null;
    const where = explanation === null
      ? `${subject.walkId} › ${subject.stepId}`
      : `Walk ${String(explanation.walkNumber)} › ${explanation.stepTitle} › ${explanation.placeLabel}`;
    return focus === null ? `${where}${selectionText(envelope, null)}` : `${where} · ${locationText(envelope, focus)}${selectionText(envelope, focus)}`;
  }
  if (subject.kind === 'away') {
    return `${locationText(envelope, subject.location)}${selectionText(envelope, subject.location)}`;
  }
  return `the review as a whole${selectionText(envelope, null)}`;
}

// --- The text sent ---------------------------------------------------------------

function folderName(repository: string): string {
  const name = repository.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return name === '' ? repository : name;
}

/** A fence longer than any backtick run in the code, so the code cannot close it. */
function fenceFor(text: string): string {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

function rangeHeading(range: EnvelopeRange): string {
  return `### ${range.role} · ${range.path} lines ${lineSpan(range.start, range.end)} · ${range.side} @ ${range.sha}`;
}

function rangeBlock(range: EnvelopeRange, budget: number): { text: string; used: number } {
  if (range.problem !== null) {
    const text = `${rangeHeading(range)}\n(not supplied: ${range.problem})`;
    return { text, used: text.length };
  }
  const numbered = range.lines.map((line, index) => `${String(range.start + index)} | ${line}`).join('\n');
  const max = Math.min(ENVELOPE_LIMITS.rangeChars, budget);
  let body = numbered.length <= max ? numbered : numbered.slice(0, max);
  const notes: string[] = [];
  if (numbered.length > max) {
    notes.push(truncatedMarker(max, numbered.length, 'characters'));
  }
  if (range.omittedLines > 0) {
    notes.push(truncatedMarker(range.lines.length, range.lines.length + range.omittedLines, 'lines'));
  }
  const fence = fenceFor(body);
  body = `${rangeHeading(range)}\n${fence}\n${body}\n${fence}${notes.length === 0 ? '' : `\n${notes.join('\n')}`}`;
  return { text: body, used: Math.min(numbered.length, max) };
}

function noteLine(note: EnvelopeNote): string {
  const where = note.location === null
    ? note.stepId === null ? '' : ` (step ${note.stepId})`
    : ` (${note.location.path} ${lineSpan(note.location.start, note.location.end)}, ${note.location.side})`;
  const resolution = note.resolution.trim() === '' ? '' : ` Resolution: ${note.resolution.trim()}`;
  return `- [${note.kind}, ${note.status}]${where} ${note.text.trim()}${resolution}`;
}

/**
 * The exact text sent for a question: DSpatch's instruction, the review's identity
 * and revisions, the subject, the prepared explanation, the code with path, side and
 * commit, the reviewer's notes, a recap of earlier questions, and the question.
 * Stored on the question before it is sent and shown in its Context.
 */
export function buildEnvelopePrompt(envelope: ContextEnvelope, question: string, recap: string | null): string {
  const parts: string[] = [];
  const identity = envelope.identity;
  parts.push(REVIEW_DISCUSSION_INSTRUCTION);
  parts.push(
    [
      '## Review',
      `Title: ${identity.title}`,
      `Repository: ${folderName(identity.repository)}`,
      `Base revision: ${identity.base.sha} (${identity.base.subject})`,
      `Target revision: ${identity.target.sha} (${identity.target.subject})`,
      'The code below is read from these commits, not from any working copy.',
    ].join('\n'),
  );
  parts.push(`## Subject\n${subjectLine(envelope)}`);

  const explanation = envelope.explanation;
  if (explanation !== null) {
    const lines = [
      '## Prepared explanation',
      `Walk ${String(explanation.walkNumber)}: ${explanation.walkTitle}`,
      `Step: ${explanation.stepTitle}`,
      `Place: ${explanation.placeLabel}`,
    ];
    if (explanation.summary.trim() !== '') {
      lines.push('', 'Summary:', clip(explanation.summary.trim(), ENVELOPE_LIMITS.explanationChars));
    }
    if (explanation.body.trim() !== '') {
      lines.push('', 'What happens:', clip(explanation.body.trim(), ENVELOPE_LIMITS.explanationChars));
    }
    if (explanation.why.trim() !== '') {
      lines.push('', 'Why it matters:', clip(explanation.why.trim(), ENVELOPE_LIMITS.explanationChars));
    }
    if (explanation.evidence.length > 0) {
      lines.push('', 'How the statements are supported:');
      for (const entry of explanation.evidence) {
        lines.push(`- ${entry.labelText}: ${clip(entry.text.trim(), ENVELOPE_LIMITS.explanationChars)}`);
      }
    }
    parts.push(lines.join('\n'));
  }

  const overview = envelope.overview;
  if (overview !== null) {
    const lines = ['## The review as a whole'];
    if (overview.summary.trim() !== '') {
      lines.push('Summary:', clip(overview.summary.trim(), ENVELOPE_LIMITS.explanationChars), '');
    }
    lines.push('Walks:');
    overview.walkTitles.forEach((title, index) => lines.push(`${String(index + 1)}. ${title}`));
    lines.push('', 'Changed files:');
    const shown = overview.changedFiles.slice(0, ENVELOPE_LIMITS.changedFiles);
    for (const file of shown) {
      lines.push(`- ${file.status} ${file.path}`);
    }
    if (shown.length < overview.changedFiles.length) {
      lines.push(truncatedMarker(shown.length, overview.changedFiles.length, 'files'));
    }
    parts.push(lines.join('\n'));
  }

  if (envelope.ranges.length === 0) {
    parts.push('## Code\nNo code is supplied with this question.');
  } else {
    const blocks = ['## Code'];
    let budget: number = ENVELOPE_LIMITS.codeChars;
    const left: EnvelopeRange[] = [];
    for (const range of envelope.ranges) {
      if (budget <= 0) {
        left.push(range);
        continue;
      }
      const block = rangeBlock(range, budget);
      blocks.push(block.text);
      budget -= block.used;
    }
    if (left.length > 0) {
      blocks.push(
        `${truncatedMarker(envelope.ranges.length - left.length, envelope.ranges.length, 'code ranges')} Left out:\n` +
          left.map((range) => `- ${range.role} · ${range.path} lines ${lineSpan(range.start, range.end)} · ${range.side}`).join('\n'),
      );
    }
    parts.push(blocks.join('\n\n'));
  }

  if (envelope.notes.length > 0) {
    parts.push(`## The reviewer's notes\n${clip(envelope.notes.map(noteLine).join('\n'), ENVELOPE_LIMITS.notesChars)}`);
  }
  if (recap !== null && recap.trim() !== '') {
    parts.push(`## Earlier in this discussion\n${clip(recap.trim(), ENVELOPE_LIMITS.recapChars)}`);
  }
  parts.push(`## Question\n${clip(question.trim(), ENVELOPE_LIMITS.questionChars)}`);
  return `${parts.join('\n\n')}\n`;
}

// --- Messages and the recap ------------------------------------------------------

export type DiscussionRole = 'question' | 'answer';

/**
 * Where a message is. A question is `sent` once it has gone to the provider; an
 * answer `streaming` until it ends. `unknown` is an outcome nobody saw, kept as
 * itself rather than read as either an ending or still going.
 */
export type DiscussionStatus = 'sending' | 'sent' | 'streaming' | 'done' | 'cancelled' | 'failed' | 'unknown';

export const DISCUSSION_STATUSES: readonly DiscussionStatus[] = ['sending', 'sent', 'streaming', 'done', 'cancelled', 'failed', 'unknown'];

export interface DiscussionMessage {
  readonly id: string;
  readonly role: DiscussionRole;
  readonly text: string;
  readonly at: string;
  /** The subject line frozen when the question was asked; an answer carries its question's. */
  readonly subject: string;
  /** For an answer: the question it answers. */
  readonly questionId?: string;
  /** For a question: the envelope it was sent with. */
  readonly envelope?: ContextEnvelope;
  /** For a question: the exact text sent. */
  readonly sentPrompt?: string;
  readonly dspatchRunId?: string;
  readonly status: DiscussionStatus;
  /** A plain account of a failure, when there was one. */
  readonly error?: string;
  /** For a question: the model DSpatch asked for. The model actually used may differ. */
  readonly model?: string;
  /**
   * DSP-132 (format 2): the agent the question went to, and the DSpatch session it was
   * sent in. Absent on a question from format 1, which was always Cursor.
   */
  readonly provider?: DiscussionProvider;
  readonly dspatchSessionId?: string;
  /** DSP-132: the tool policy the agent was given for this question, as one line. */
  readonly toolPolicy?: string;
}

/**
 * The agents a review discussion can use (DSP-132). The same values as the main
 * chat's `StoredSessionProvider`, spelt here so the review module needs nothing of the
 * chat's.
 */
export type DiscussionProvider = 'cursor' | 'claude';

/** How a question from format 1, which stored no agent, is named in its Context. */
export const RECORDED_BEFORE_PROVIDER_LINE = 'Cursor (recorded before the provider was stored)';

export interface RecapLimits {
  /** Characters for the whole recap. */
  readonly totalChars: number;
  /** Characters per question or answer. */
  readonly entryChars: number;
  /** Most exchanges included. */
  readonly exchanges: number;
}

export const DEFAULT_RECAP_LIMITS: RecapLimits = { totalChars: ENVELOPE_LIMITS.recapChars, entryChars: 1_500, exchanges: 6 };

/**
 * Earlier questions and their answers, for a new provider session after the review
 * was reopened: the newest finished exchanges that fit, oldest first, with what was
 * left out stated. Empty when there is nothing earlier.
 */
export function recapFor(messages: readonly DiscussionMessage[], limits: RecapLimits = DEFAULT_RECAP_LIMITS): string {
  const exchanges: { question: DiscussionMessage; answer: DiscussionMessage }[] = [];
  for (const question of messages) {
    if (question.role !== 'question') {
      continue;
    }
    const answer = messages.find((message) => message.role === 'answer' && message.questionId === question.id && message.status === 'done');
    if (answer !== undefined && answer.text.trim() !== '') {
      exchanges.push({ question, answer });
    }
  }
  if (exchanges.length === 0) {
    return '';
  }
  const entries: string[] = [];
  let used = 0;
  for (let index = exchanges.length - 1; index >= 0 && entries.length < limits.exchanges; index -= 1) {
    const exchange = exchanges[index];
    if (exchange === undefined) {
      continue;
    }
    const entry =
      `Q (${exchange.question.subject}): ${clip(exchange.question.text.trim(), limits.entryChars)}\n` +
      `A: ${clip(exchange.answer.text.trim(), limits.entryChars)}`;
    if (used + entry.length > limits.totalChars) {
      break;
    }
    entries.unshift(entry);
    used += entry.length;
  }
  const omitted = exchanges.length - entries.length;
  const lead = omitted > 0 ? `${truncatedMarker(entries.length, exchanges.length, 'earlier exchanges')}\n\n` : '';
  return `${lead}${entries.join('\n\n')}`;
}

// --- The stored discussion -------------------------------------------------------

/**
 * 2 (DSP-132): the record names the discussion's agent (`provider`), and each question
 * its agent and session. A format 1 file is read as it is and not rewritten on read; it
 * becomes format 2 at the next real write (a changed draft, a choice of agent or a
 * question). A DSpatch that knows only format 1 then reads it as newer and leaves it.
 */
export const REVIEW_DISCUSSION_FORMAT_VERSION = 2;

/** Which review a discussion belongs to: the same identity as the reviewer's record. */
export interface DiscussionIdentity {
  readonly key: string;
  readonly repository: string;
  readonly base: string;
  readonly target: string;
  readonly definitionPath: string;
}

/**
 * The review window a discussion request comes from, as the client's window registry
 * knows it (DSP-111). The discussion itself runs in the project host; the window is
 * named by its renderer's id, which is where the discussion's events go back to.
 */
export interface DiscussionTarget {
  /** The window's renderer, which hears the discussion's events. */
  readonly targetId: number;
  /** The review it shows. */
  readonly identity: DiscussionIdentity;
  /** DSP-132: the main window's agent when it opened this review; `null` when standalone. */
  readonly defaultProvider: DiscussionProvider | null;
  /** The window's session on the review host, for the discussion's context. */
  readonly sessionId: string;
}

/**
 * The discussion as written to `<recordKey>.discussion.json` beside the reviewer's
 * record, by the main process only.
 */
export interface DiscussionRecord {
  readonly version: typeof REVIEW_DISCUSSION_FORMAT_VERSION;
  readonly identity: DiscussionIdentity;
  readonly messages: readonly DiscussionMessage[];
  /** The attempt ledger's `persistable()`. */
  readonly attempts: readonly StoredAttempt[];
  readonly draft: string;
  readonly savedAt: string;
  /** DSP-132: the agent chosen for this discussion; absent until one is chosen. */
  readonly provider?: DiscussionProvider;
}

export function emptyDiscussionRecord(identity: DiscussionIdentity): DiscussionRecord {
  return { version: REVIEW_DISCUSSION_FORMAT_VERSION, identity, messages: [], attempts: [], draft: '', savedAt: '' };
}

/**
 * What reading a stored discussion gave. `newer` and `unusable` are never rewritten:
 * a newer DSpatch wrote the first, and the second may be the only copy of someone's
 * discussion.
 */
export type DiscussionAdoption =
  /** `fromVersion`: the format the file was in (1 or 2), so a format 1 file is named as such. */
  | { readonly kind: 'adopted'; readonly record: DiscussionRecord; readonly fromVersion: number }
  | { readonly kind: 'newer'; readonly version: number; readonly problem: string }
  | { readonly kind: 'unusable'; readonly problem: string };

const ATTEMPT_KINDS: readonly AttemptKind[] = ['agent-turn', 'command'];
const ATTEMPT_STATES: readonly AttemptState[] = ['waiting', 'running', 'cancel-requested', 'stopped-confirmed', 'outcome-unknown', 'completed', 'failed'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function adoptAttempts(value: unknown): StoredAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attempts: StoredAttempt[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const attemptId = entry['attemptId'];
    const kind = entry['kind'];
    const state = entry['state'];
    // An attempt in a state the ledger does not know could never be settled; it is left out.
    if (typeof attemptId !== 'string' || attemptId === '' || !ATTEMPT_KINDS.includes(kind as AttemptKind) || !ATTEMPT_STATES.includes(state as AttemptState)) {
      continue;
    }
    const history: AttemptStep[] = Array.isArray(entry['history'])
      ? entry['history'].filter(isRecord).map((step) => ({
          atUtc: stringOr(step['atUtc'], ''),
          state: ATTEMPT_STATES.includes(step['state'] as AttemptState) ? (step['state'] as AttemptState) : (state as AttemptState),
          note: stringOr(step['note'], ''),
          applied: step['applied'] !== false,
        }))
      : [];
    attempts.push({
      attemptId,
      kind: kind as AttemptKind,
      label: stringOr(entry['label'], attemptId),
      state: state as AttemptState,
      stateReason: stringOr(entry['stateReason'], 'Read back without a recorded reason.'),
      requestedAtUtc: stringOr(entry['requestedAtUtc'], ''),
      endedAtUtc: stringOrNull(entry['endedAtUtc']),
      providerRunId: stringOrNull(entry['providerRunId']),
      localPid: typeof entry['localPid'] === 'number' && Number.isFinite(entry['localPid']) ? entry['localPid'] : null,
      cancelRequestedAtUtc: stringOrNull(entry['cancelRequestedAtUtc']),
      acknowledgedAtUtc: stringOrNull(entry['acknowledgedAtUtc']),
      history,
    });
  }
  return attempts;
}

function adoptMessages(value: unknown): DiscussionMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages: DiscussionMessage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry['id'];
    const role = entry['role'];
    if (typeof id !== 'string' || id === '' || (role !== 'question' && role !== 'answer')) {
      continue;
    }
    const status = DISCUSSION_STATUSES.includes(entry['status'] as DiscussionStatus) ? (entry['status'] as DiscussionStatus) : 'unknown';
    const message: {
      -readonly [K in keyof DiscussionMessage]: DiscussionMessage[K];
    } = {
      id,
      role,
      text: stringOr(entry['text'], ''),
      at: stringOr(entry['at'], ''),
      subject: stringOr(entry['subject'], ''),
      // A turn that was going when the file was written has an outcome nobody saw.
      status: status === 'sending' || status === 'streaming' ? 'unknown' : status,
    };
    if (typeof entry['questionId'] === 'string') {
      message.questionId = entry['questionId'];
    }
    if (isRecord(entry['envelope']) && entry['envelope']['version'] === 1) {
      // Written by this module and only read back for display and "go to point"; kept as stored.
      message.envelope = entry['envelope'] as unknown as ContextEnvelope;
    }
    if (typeof entry['sentPrompt'] === 'string') {
      message.sentPrompt = entry['sentPrompt'];
    }
    if (typeof entry['dspatchRunId'] === 'string') {
      message.dspatchRunId = entry['dspatchRunId'];
    }
    if (typeof entry['error'] === 'string') {
      message.error = entry['error'];
    }
    if (typeof entry['model'] === 'string') {
      message.model = entry['model'];
    }
    if (entry['provider'] === 'cursor' || entry['provider'] === 'claude') {
      message.provider = entry['provider'];
    }
    if (typeof entry['dspatchSessionId'] === 'string') {
      message.dspatchSessionId = entry['dspatchSessionId'];
    }
    if (typeof entry['toolPolicy'] === 'string') {
      message.toolPolicy = entry['toolPolicy'];
    }
    messages.push(message);
  }
  return messages;
}

/**
 * Read a stored discussion defensively. A newer format is refused, not guessed at;
 * a file for another review, or one that is not a discussion at all, is unusable.
 * Within a version 1 file, entries that cannot be read are left out and the rest kept.
 */
export function adoptDiscussionRecord(raw: unknown, expected: DiscussionIdentity): DiscussionAdoption {
  if (!isRecord(raw)) {
    return { kind: 'unusable', problem: 'The stored discussion is not a JSON object.' };
  }
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'unusable', problem: 'The stored discussion has no format version this build recognises.' };
  }
  if (version > REVIEW_DISCUSSION_FORMAT_VERSION) {
    return {
      kind: 'newer',
      version,
      problem:
        `The stored discussion is format version ${String(version)}, newer than this DSpatch understands ` +
        `(${String(REVIEW_DISCUSSION_FORMAT_VERSION)}). It is left as it is and not rewritten.`,
    };
  }
  const identity = raw['identity'];
  if (
    !isRecord(identity) ||
    identity['key'] !== expected.key ||
    identity['base'] !== expected.base ||
    identity['target'] !== expected.target
  ) {
    return { kind: 'unusable', problem: 'The stored discussion belongs to another review.' };
  }
  const provider = raw['provider'];
  return {
    kind: 'adopted',
    fromVersion: version,
    record: {
      version: REVIEW_DISCUSSION_FORMAT_VERSION,
      identity: expected,
      messages: adoptMessages(raw['messages']),
      attempts: adoptAttempts(raw['attempts']),
      draft: stringOr(raw['draft'], ''),
      savedAt: stringOr(raw['savedAt'], ''),
      ...(provider === 'cursor' || provider === 'claude' ? { provider } : {}),
    },
  };
}

// --- Errors in the normal view ---------------------------------------------------------

/**
 * An error as the discussion's one line shows it: without the error class in front
 * (`PresentationSendFailed: …`, `TypeError: …`). The whole `name: message` stays the
 * detail. Only a leading `Error:` or a class-like name of two or more capitalised parts
 * is taken off, so an ordinary sentence that starts with a word and a colon is kept.
 */
export function withoutErrorClass(message: string): string {
  return message.replace(/^(?:Error|(?:[A-Z][a-z0-9]+){2,}): /, '');
}

// --- IPC ---------------------------------------------------------------------------

export const REVIEW_DISCUSSION_CHANNELS = {
  send: 'dspatch:review-discussion-send',
  cancel: 'dspatch:review-discussion-cancel',
  load: 'dspatch:review-discussion-load',
  acknowledge: 'dspatch:review-discussion-acknowledge',
  draft: 'dspatch:review-discussion-draft',
  event: 'dspatch:review-discussion-event',
  /** DSP-132: choose the discussion's agent. Records the choice; builds nothing. */
  chooseAgent: 'dspatch:review-discussion-choose-agent',
  /** DSP-132: leave the recap out of (or back in) the next new session's first question. */
  recap: 'dspatch:review-discussion-recap',
} as const;

/** One agent as the discussion offers it (DSP-132). */
export interface DiscussionAgentOption {
  readonly provider: DiscussionProvider;
  readonly choosable: boolean;
  /** Why it cannot be chosen; `null` when it can. */
  readonly reason: string | null;
}

/**
 * The discussion's agent (DSP-132): which one is chosen, whether it can be used, what
 * it is given, and what the next question carries after a switch.
 */
export interface DiscussionAgentView {
  /** The chosen agent, or `null` when none is (a standalone review with nothing stored). */
  readonly provider: DiscussionProvider | null;
  /** Why the chosen agent cannot be used in this launch; `null` when it can (or none is chosen). */
  readonly unavailable: string | null;
  readonly options: readonly DiscussionAgentOption[];
  /** The tool policy the chosen agent is given here, as one line; `null` with none chosen. */
  readonly policy: string | null;
  /**
   * After a switch, until the next question goes: the next question starts a new
   * session with this agent and carries the code context and this recap, unless left out.
   */
  readonly switchNotice: {
    readonly provider: DiscussionProvider;
    readonly exchanges: number;
    readonly recap: string;
    readonly leftOut: boolean;
  } | null;
}

export type DiscussionChooseOutcome =
  | { readonly kind: 'chosen'; readonly status: DiscussionStatusView }
  | { readonly kind: 'refused'; readonly error: string };

/** The answer being waited for, if any. One at a time per review discussion. */
export interface DiscussionTurnView {
  readonly questionId: string;
  /** Set once the provider has started a run and the answer exists. */
  readonly answerId: string | null;
  readonly attemptId: string;
  readonly dspatchRunId: string | null;
  /** Stop was pressed and no end has been confirmed yet. */
  readonly stopping: boolean;
}

/** One attempt that has not reached a confirmed end, as the window shows it. */
export interface DiscussionAttemptView {
  readonly attemptId: string;
  readonly label: string;
  readonly state: AttemptState;
  readonly reason: string;
  readonly acknowledged: boolean;
}

/** Where the discussion stands: what is running, and what has to be seen before the next question. */
export interface DiscussionStatusView {
  readonly turn: DiscussionTurnView | null;
  readonly unresolved: readonly DiscussionAttemptView[];
  /** Attempts the person must acknowledge before the next question is sent. Empty when nothing blocks. */
  readonly needsAcknowledgement: readonly string[];
  /** Why the discussion cannot be written, when it cannot (a newer format on disk). */
  readonly readOnly: string | null;
  /** DSP-132: the discussion's agent. */
  readonly agent: DiscussionAgentView;
}

/** What the service tells the window(s) showing its review, on {@link REVIEW_DISCUSSION_CHANNELS.event}. */
export type ReviewDiscussionEvent =
  /** A message was added or changed: the whole message, replacing any earlier copy. */
  | { readonly kind: 'message'; readonly message: DiscussionMessage }
  /** More text for an answer that is arriving. */
  | { readonly kind: 'delta'; readonly messageId: string; readonly text: string }
  | { readonly kind: 'status'; readonly status: DiscussionStatusView; readonly note?: string };

/** What the window sends with a question. The envelope is built in main from the subject. */
export interface DiscussionSendInput {
  readonly question: string;
  readonly subject: DiscussionSubject;
  readonly selection: CodeLocation | null;
  readonly language?: Lang;
}

export type DiscussionSendOutcome =
  | { readonly kind: 'sent'; readonly questionId: string; readonly dspatchRunId: string }
  /** Nothing was sent and nothing recorded: the person's text stays where it is. */
  | { readonly kind: 'refused'; readonly error: string; readonly acknowledgeable?: readonly string[] }
  /** The question was recorded and the provider refused it. */
  | { readonly kind: 'failed'; readonly error: string; readonly questionId: string };

export interface DiscussionCancelOutcome {
  readonly kind: 'cancel-requested' | 'abandoned' | 'nothing' | 'failed';
  readonly note: string;
}

export type DiscussionLoadOutcome =
  | {
      readonly kind: 'loaded';
      readonly messages: readonly DiscussionMessage[];
      readonly draft: string;
      readonly status: DiscussionStatusView;
      /** The subject line for the request given, when one was given and could be built. */
      readonly subjectLine: string | null;
      /** Something the person should know about the stored discussion, if anything. */
      readonly note: string | null;
    }
  | { readonly kind: 'refused'; readonly error: string };

/** The review window's discussion bridge (`window.dspatchReviewDiscussion`). */
export interface ReviewDiscussionBridge {
  load(request: DiscussionRequest | null): Promise<DiscussionLoadOutcome>;
  send(input: DiscussionSendInput): Promise<DiscussionSendOutcome>;
  cancel(): Promise<DiscussionCancelOutcome>;
  acknowledge(attemptIds: readonly string[]): Promise<DiscussionStatusView>;
  saveDraft(text: string): Promise<{ readonly saved: boolean; readonly error?: string }>;
  /** DSP-132: choose the agent. Creates no adapter and no session. */
  chooseAgent(provider: DiscussionProvider): Promise<DiscussionChooseOutcome>;
  /** DSP-132: leave the recap out of the next new session's first question, or put it back. */
  setRecapLeftOut(leftOut: boolean): Promise<DiscussionStatusView>;
  onEvent(listener: (event: ReviewDiscussionEvent) => void): () => void;
}

// --- Words the envelope uses ------------------------------------------------------

/** The evidence labels as the review window words them, so the model reads what the person reads. */
export const EVIDENCE_LABEL_TEXT: Readonly<Record<Lang, Readonly<Record<EvidenceLabel, string>>>> = {
  sv: {
    analysis: 'Läst ur koden',
    'test-simulated': 'Visat i ett automatiskt test med ersatta delar',
    'test-real-substitute': 'Visat i ett test med en riktig ersättningsprocess',
    'not-observed': 'Inte observerat',
  },
  en: {
    analysis: 'Read from the code',
    'test-simulated': 'Shown by an automated test with substituted parts',
    'test-real-substitute': 'Shown by a test with a real stand-in process',
    'not-observed': 'Not observed',
  },
};
