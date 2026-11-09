import type { AttemptKind, AttemptState, AttemptStep, ModelListing, StoredAttempt } from './bridge';
import {
  DETAILS_MARKER,
  DETAILS_PART_RULE,
  SHORT_PART_RULE,
  isProfile,
  presentationFrom,
  presentationPromptSection,
  type PresentationProfile,
  type PresentationRequest,
  type PresentationSection,
} from './presentation-profiles';

export { DETAILS_MARKER };
import { TASK_HEADER } from './review-task';
import type { StepExplanationEvent, StepExplanationInput, StepExplanationOutcome, StepExplanationsView } from './step-explanations';
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
 * A place an answer rests on, after DSpatch checked it against its commit: the shape of
 * `AnswerReference` in `review-pair.ts`, spelt here so the discussion needs nothing of it.
 */
export interface CheckedReference {
  readonly label: string;
  readonly range: { readonly kind: 'lines'; readonly side: RevisionSide; readonly path: string; readonly start: number; readonly end: number };
}

/**
 * A place in another repository of the workspace an answer rests on, checked at the commit
 * recorded for it (DSP-175): the shape of `ContextReference` in `review-pair.ts`. Context is
 * never reviewed, approved or covered; it opens with `readContextFile`.
 */
export interface CheckedContextReference {
  readonly label: string;
  readonly range: { readonly kind: 'context'; readonly repository: string; readonly commit: string; readonly path: string; readonly start: number; readonly end: number };
}

/**
 * The instruction when the agent can read the two revisions (Niclas's decision of 30 October
 * 2026): a question in the discussion may need code the envelope does not hold, and the
 * agent looks it up with the read-only analysis access rather than guessing. Sent first
 * instead of {@link REVIEW_DISCUSSION_INSTRUCTION}, and shown verbatim in the Context.
 */
export const REVIEW_DISCUSSION_CODE_INSTRUCTION =
  'You are helping a person review a code change. Explain and review the code as it is at the revisions named. ' +
  'You can read both revisions as files with your Read, Glob and Grep tools; you cannot change code, run commands ' +
  'or reach anything else. When the question is about a type, function or term in the code, find and read its real ' +
  'definition at the revision that matters, and the uses that show its role here, before you answer. If you cannot ' +
  'find or read it, say so briefly and say what you looked for: never describe a definition you have not read.';

/** The fence the code an answer rests on is written in, at its end; DSpatch checks it and shows it as links. */
export const REFERENCES_FENCE = 'dspatch-references';

/**
 * What the agent is told about its answer when it can read the code. The references go in
 * one fenced block at the end so the answer streams as readable text.
 */
export const CODE_ANSWER_RULES = [
  'Give the cause and effect behind the answer with real names and concrete connections.',
  'Use short paragraphs. Use a list for alternatives and a table only when comparing several things side by side truly helps.',
  'Keep apart what the code shows and what is still uncertain. Name what you could not read or find.',
  'Do not narrate your search ("I read…", "Then I searched…"); give the explanation.',
  'Base and target can differ: say which revision a definition or line is from when it matters.',
  `End with the code your answer rests on, as one block fenced with \`\`\`${REFERENCES_FENCE}, holding a JSON object: ` +
    '{"references": [{"label": "What this place shows", "path": "src/file.ts", "side": "target", "start": 10, "end": 14}], "insufficient": false}. ' +
    'A path is the repository path without base/ or target/; "side" is "base" for From and "target" for To; lines are 1-based at that side. ' +
    'DSpatch checks every reference against its commit and shows it as a link. Set "insufficient": true when the code you could read does not settle the question.',
] as const;

/*
 * Where an answer's short part ends and its details begin: {@link DETAILS_MARKER}, defined with
 * the presentation policy (presentation-profiles.ts) and re-exported above, so the discussion's
 * answer format, the profiles and the walk generator share one wording of the contract (DSP-181).
 */

/**
 * How every answer in the discussion is shaped, with or without code access: a quick
 * question about a type or a function is understood from the short part alone. The first two
 * rules are the policy's own words, so a prompt with a presentation section says them once.
 */
export const ANSWER_SHAPE_RULES = [
  SHORT_PART_RULE,
  DETAILS_PART_RULE,
  'When the person explicitly asks for details or a full account, give them: the short part still answers first, and the details follow below the line.',
  'Keep established class names and terms. Use short paragraphs, bullets where they help, and bold sparingly.',
] as const;

/**
 * An answer's short part and its details, split at {@link DETAILS_MARKER}. A marker still
 * arriving is cut off, so it never flickers into view; details that are empty are none. A
 * line that is only "Show more" or "Visa mer" (a heading or bold allowed) is read as the
 * marker too (DSP-181): a model that writes the control's name instead of the marker still
 * gets its deepening behind the control rather than in front of it.
 */
export function splitDetails(text: string): { readonly short: string; readonly details: string | null } {
  const found = /^[ \t]*(?:<!--\s*dspatch:details\s*-->|(?:#{1,6}\s*)?(?:\*\*)?(?:Show more|Visa mer):?(?:\*\*)?:?)[ \t]*$/im.exec(text);
  if (found === null) {
    return { short: text.replace(/\n[ \t]*<!--(?![\s\S]*-->)[^\n]*$/, '').trimEnd(), details: null };
  }
  const short = text.slice(0, found.index).trimEnd();
  const details = text.slice(found.index + found[0].length).trim();
  if (short === '') {
    return { short: details, details: null };
  }
  return { short, details: details === '' ? null : details };
}

/**
 * An answer as written, split at its references block: the text to show, and the block's
 * JSON when it is there. A block still arriving is cut off too, so it never flickers into view.
 */
export function splitCodeAnswer(text: string): { readonly shown: string; readonly block: unknown } {
  const opener = new RegExp(`\\n?\`\`\`\\s*${REFERENCES_FENCE}[^\\n]*\\n?`);
  const found = opener.exec(text);
  if (found === null) {
    return { shown: text, block: null };
  }
  const shown = text.slice(0, found.index).trimEnd();
  const rest = text.slice(found.index + found[0].length);
  const close = rest.indexOf('```');
  const body = (close < 0 ? rest : rest.slice(0, close)).trim();
  if (close < 0) {
    return { shown, block: null };
  }
  try {
    return { shown, block: JSON.parse(body) as unknown };
  } catch {
    return { shown, block: null };
  }
}

/**
 * What DSpatch knows about context the provider may add on its own account. Shown in
 * every Context beside the instruction, because it is part of what the model may see
 * and DSpatch cannot see it.
 */
export const PROVIDER_ADDED_CONTEXT_LINE = 'provider-added context (user-level rules and hooks): unknown';

// --- What a question is about ---------------------------------------------------

/** What the person was looking at when they asked. Validated in main against the definition. */
export type DiscussionSubject =
  /** `checkId`: asked from a point worth checking that is shown at this step (its reasoning goes along). */
  | { readonly kind: 'point'; readonly walkId: string; readonly stepId: string; readonly placeIndex: number; readonly checkId?: string }
  | { readonly kind: 'away'; readonly location: CodeLocation }
  | { readonly kind: 'review' }
  /** DSP-175: asked in a review thread; its question and answer stay in that thread. */
  | { readonly kind: 'thread'; readonly threadId: string };

/** The thread a question was asked in, as it stood when it was sent (DSP-175). */
export interface EnvelopeThread {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly title: string;
  readonly explanation: string;
  readonly evidence: string;
  readonly recommendation: string;
  readonly gaps: readonly string[];
  /** The person's comments in it, oldest first. */
  readonly comments: readonly string[];
}

/**
 * One run of selected code in the walk window, as the window read it: a side, a path, the
 * lines, and the 0-based characters where it starts on `start` and ends on `end` (just after).
 * The text is checked against the commit before anything is sent.
 */
export interface QuoteSegment {
  readonly side: RevisionSide;
  readonly path: string;
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
}

/**
 * What the person selected with the mouse (or keyboard) to ask about (30 October 2026): code
 * in a code pane, with where it is, or text of an explanation or an answer, which has no place
 * in the code and is never given one. Apart from selecting lines for review: it decides nothing.
 */
export type SelectionQuote =
  | { readonly kind: 'code'; readonly text: string; readonly segments: readonly QuoteSegment[] }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly source: 'explanation' | 'answer' | 'thread';
      readonly context: string;
      /**
       * Where the passage is from, kept with the question (DSP-175): the answer's question
       * id and the walk step, when the selection was in one, and a short label naming it.
       */
      readonly origin?: QuoteOrigin;
    };

/** The message or step a quoted passage of text comes from. */
export interface QuoteOrigin {
  readonly label: string;
  readonly messageId?: string;
  readonly stepId?: string;
}

/** A stored or sent origin, bounded; `undefined` when there is none. */
export function quoteOriginFrom(raw: unknown): QuoteOrigin | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const label = typeof value['label'] === 'string' ? value['label'].trim().slice(0, 200) : '';
  if (label === '') {
    return undefined;
  }
  const id = (key: string): string | undefined => (typeof value[key] === 'string' && /^[\w.:-]{1,120}$/.test(value[key]) ? value[key] : undefined);
  const messageId = id('messageId');
  const stepId = id('stepId');
  return { label, ...(messageId === undefined ? {} : { messageId }), ...(stepId === undefined ? {} : { stepId }) };
}

/** Bounds on a quote: longer is refused, not cut silently. */
export const QUOTE_LIMITS = { characters: 20_000, segments: 40, contextChars: 1_500 } as const;

/**
 * A selection to ask about as a window sends it to be shared with the review's other
 * windows, or `null` when it is not one. Only its shape is checked here; the commits check
 * the text when a question is sent with it.
 */
export function quoteFrom(raw: unknown): SelectionQuote | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const text = value['text'];
  if (typeof text !== 'string' || text.trim() === '' || text.length > QUOTE_LIMITS.characters) {
    return null;
  }
  if (value['kind'] === 'text') {
    const origin = quoteOriginFrom(value['origin']);
    return {
      kind: 'text',
      text,
      source: value['source'] === 'answer' ? 'answer' : value['source'] === 'thread' ? 'thread' : 'explanation',
      context: typeof value['context'] === 'string' ? value['context'].slice(0, QUOTE_LIMITS.contextChars) : '',
      ...(origin === undefined ? {} : { origin }),
    };
  }
  const segments = value['segments'];
  if (value['kind'] !== 'code' || !Array.isArray(segments) || segments.length === 0 || segments.length > QUOTE_LIMITS.segments) {
    return null;
  }
  const read: QuoteSegment[] = [];
  for (const entry of segments as unknown[]) {
    const segment = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {};
    const { side, path, start, end, from, to } = segment;
    if ((side !== 'base' && side !== 'target') || typeof path !== 'string' || ![start, end, from, to].every((number) => Number.isInteger(number) && (number as number) >= 0)) {
      return null;
    }
    read.push({ side, path, start: start as number, end: end as number, from: from as number, to: to as number });
  }
  return { kind: 'code', text, segments: read };
}

/** What the window sends to have an envelope built: the subject, and a selection if any. */
export interface DiscussionRequest {
  readonly subject: DiscussionSubject;
  /** Lines the person has selected in the code, if any. */
  readonly selection: CodeLocation | null;
  /** Text the person has selected to ask about, if any: what the question is about. */
  readonly quote?: SelectionQuote | null;
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
  /**
   * DSP-152: what the agent found when it looked into the code for this step (the step's
   * finished code questions), so a question in the discussion builds on it. Read by the host
   * from the pair's record; absent when there is none.
   */
  readonly analysis?: readonly { readonly question: string; readonly answer: string }[];
  /** A point worth checking the question was asked from: its title, kind and reasoning. */
  readonly check?: { readonly id: string; readonly kind: string; readonly title: string; readonly reasoning: string };
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

/** A selected quote as sent: code checked against its commit (with the commit named), or text as it was. */
export type EnvelopeQuote =
  | { readonly kind: 'code'; readonly segments: readonly (QuoteSegment & { readonly sha: string; readonly text: string })[] }
  | { readonly kind: 'text'; readonly text: string; readonly source: 'explanation' | 'answer' | 'thread'; readonly context: string; readonly origin?: QuoteOrigin };

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
  /** What the person selected to ask about; the rest of the envelope is background to it. */
  readonly quote?: EnvelopeQuote | null;
  /** Thread subjects only (DSP-175). */
  readonly thread?: EnvelopeThread | null;
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
  const quote = envelope.quote ?? null;
  if (quote === null) {
    return placeLine(envelope);
  }
  const text = (quote.kind === 'code' ? quote.segments.map((segment) => segment.text).join(' ') : quote.text).replace(/\s+/g, ' ').trim();
  return `${placeLine(envelope)} · selected “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”`;
}

function placeLine(envelope: ContextEnvelope): string {
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
  if (subject.kind === 'thread') {
    return `the review thread “${envelope.thread?.title ?? subject.threadId}”${selectionText(envelope, null)}`;
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

/** Where a quoted run of code is, in words: path, lines, characters, side and commit. */
function quoteWhere(segment: QuoteSegment & { readonly sha: string }): string {
  const lines = segment.start === segment.end ? `line ${String(segment.start)}` : `lines ${String(segment.start)}–${String(segment.end)}`;
  return `${segment.path} ${lines}, characters ${String(segment.from + 1)}–${String(segment.to)}${segment.start === segment.end ? '' : ' (of the first and last line)'} · ${segment.side === 'base' ? 'base (From)' : 'target (To)'} @ ${segment.sha}`;
}

/**
 * The selection the question is about, first and exactly. Code says where it is; text from
 * an explanation or an answer says it has no place in the code, so none is made up for it.
 */
function quoteSection(quote: EnvelopeQuote): string {
  const lines = ['## What the person selected', 'The question is about exactly this selection. The code and explanation further down, and the conversation, are background to it.'];
  if (quote.kind === 'code') {
    for (const segment of quote.segments) {
      const fence = fenceFor(segment.text);
      lines.push('', `Selected code, ${quoteWhere(segment)}:`, fence, segment.text, fence);
    }
  } else {
    const fence = fenceFor(quote.text);
    lines.push(
      '',
      `Selected text from ${quote.source === 'answer' ? 'an earlier answer in this discussion' : quote.source === 'thread' ? 'the review thread' : 'the explanation of the step'} (not code; it has no place in the code):`,
      fence,
      quote.text,
      fence,
    );
    if (quote.origin !== undefined) {
      lines.push('', `It is from ${quote.origin.label}.`);
    }
    if (quote.context.trim() !== '' && quote.context.trim() !== quote.text.trim()) {
      lines.push('', 'The passage it is from:', clip(quote.context.trim(), QUOTE_LIMITS.contextChars));
    }
  }
  return lines.join('\n');
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
/**
 * The revisions as files, when the agent can read them: what the folder holds and what it
 * cannot read, written by the host (`folderSection` of the analysis prompts).
 */
export interface CodeAccessSection {
  readonly folder: string;
}

/**
 * An earlier answer the person asks to have explained more simply (30 October 2026): its
 * question and its text as written, sent with the envelope that question was asked with.
 */
export interface SimplifySection {
  readonly question: string;
  readonly answer: string;
  /**
   * DSP-176: the explanations this chain of Explain more simply showed before the answer, oldest
   * first, and the profile the person reads in. Absent on the first press in Original.
   */
  readonly earlier?: readonly { readonly label: string; readonly text: string }[];
  readonly profile?: PresentationProfile;
}

/** The rules of Explain more simply are in `presentation-profiles.ts` (DSP-176), with the profiles'. */

export function buildEnvelopePrompt(
  envelope: ContextEnvelope,
  question: string,
  recap: string | null,
  code: CodeAccessSection | null = null,
  simplify: SimplifySection | null = null,
  presentation: PresentationSection | null = null,
  /** DSP-184: the step explanation the person is reading, as a context section. */
  reading: string | null = null,
): string {
  const parts: string[] = [];
  const identity = envelope.identity;
  if (code !== null) {
    // The analysis tasks' header, so the turn is recognisable as one that reads code.
    parts.push(`${TASK_HEADER} review-question`);
  }
  parts.push(code === null ? REVIEW_DISCUSSION_INSTRUCTION : REVIEW_DISCUSSION_CODE_INSTRUCTION);
  parts.push(
    [
      '## Review',
      `Title: ${identity.title}`,
      `Repository: ${folderName(identity.repository)}`,
      `Base revision: ${identity.base.sha} (${identity.base.subject})`,
      `Target revision: ${identity.target.sha} (${identity.target.subject})`,
      'The code below is read from these commits, not from any working copy.',
      // DSP-181: the answer's language, as the walk, step and selection prompts already say it.
      `Language: ${envelope.language === 'sv' ? 'Swedish' : 'English'}. The person reads the review in it; answer in it, and keep code names, identifiers and quoted code as they are.`,
    ].join('\n'),
  );
  parts.push(`## Subject\n${subjectLine(envelope)}`);
  const quote = envelope.quote ?? null;
  if (quote !== null) {
    parts.push(quoteSection(quote));
  }

  const thread = envelope.thread ?? null;
  if (thread !== null) {
    const lines = [
      '## The review thread asked in',
      'The person asks inside this thread from a delegated review. Answer about it; your answer is kept in the thread. Its status is the person\'s decision; do not change it or act on it.',
      `${thread.kind}: ${thread.title} (status: ${thread.status})`,
    ];
    if (thread.explanation.trim() !== '') {
      lines.push('', 'What was observed:', clip(thread.explanation.trim(), ENVELOPE_LIMITS.explanationChars));
    }
    if (thread.evidence.trim() !== '') {
      lines.push('', 'What it rests on:', clip(thread.evidence.trim(), ENVELOPE_LIMITS.explanationChars));
    }
    lines.push('', 'Recommendation:', thread.recommendation.trim() === '' ? 'none was recorded' : clip(thread.recommendation.trim(), ENVELOPE_LIMITS.explanationChars));
    for (const gap of thread.gaps) {
      lines.push(`- Not established: ${clip(gap.trim(), 600)}`);
    }
    for (const comment of thread.comments) {
      lines.push(`- The person commented: ${clip(comment.trim(), 600)}`);
    }
    parts.push(lines.join('\n'));
  }

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
    for (const entry of explanation.analysis ?? []) {
      lines.push(
        '',
        `What the agent found in the code for this step, asked "${clip(entry.question.trim(), 300)}":`,
        clip(entry.answer.trim(), ENVELOPE_LIMITS.explanationChars),
      );
    }
    if (explanation.check !== undefined) {
      lines.push(
        '',
        `The person asks from a point worth checking (${explanation.check.kind}): ${explanation.check.title}`,
        clip(explanation.check.reasoning.trim(), ENVELOPE_LIMITS.explanationChars),
      );
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
  if (simplify !== null) {
    // DSP-176: the rules of Explain more simply, and the explanations this chain showed before.
    const shown = [...(simplify.earlier ?? []), { label: 'The answer to explain more simply', text: simplify.answer }];
    // The answer itself is the last of the explanations shown, quoted once, below the rules.
    parts.push(['## The answer to explain more simply', `The person asked: ${clip(simplify.question.trim(), ENVELOPE_LIMITS.questionChars)}`].join('\n'));
    const rules = presentationPromptSection({ profile: simplify.profile ?? 'original', mode: 'simpler', shown });
    if (rules !== null) {
      parts.push(rules);
    }
  }
  if (presentation !== null) {
    const section = presentationPromptSection(presentation);
    if (section !== null) {
      parts.push(section);
    }
  }
  if (reading !== null) {
    parts.push(reading);
  }
  parts.push(`## Question\n${clip(question.trim(), ENVELOPE_LIMITS.questionChars)}`);
  parts.push(['## How to answer', ...[...ANSWER_SHAPE_RULES, ...(code === null ? [] : CODE_ANSWER_RULES)].map((rule) => `- ${rule}`)].join('\n'));
  if (code !== null) {
    parts.push(code.folder);
  }
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
  /**
   * For a question: DSpatch's instruction as it was sent first in it (30 October 2026). Older
   * questions have none; their sent text holds what applied then.
   */
  readonly instruction?: string;
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
  /** For a question: the agent could read the two revisions with read-only tools (30 October 2026). */
  readonly codeAccess?: boolean;
  /** For an answer with code access: the references DSpatch checked against their commits. */
  readonly references?: readonly CheckedReference[];
  /** DSP-175: places in other repositories of the workspace, read as context and checked at their recorded commit. */
  readonly contextReferences?: readonly CheckedContextReference[];
  /** For an answer with code access: the agent said the code it could read does not settle it. */
  readonly insufficient?: boolean;
  /** For an answer with code access: what DSpatch left out of it, in plain words. */
  readonly adjustments?: readonly string[];
  /** For an answer with code access: the files it read, relative to the revision folder. Kept, not shown. */
  readonly reads?: readonly string[];
  /**
   * DSP-152: a question asked from a walk step's own actions (Tell me more, Explain more
   * simply, Explain this). It is an ordinary question in the discussion; this says which
   * action asked it, so the step can show its answer as a deepening beside it.
   */
  readonly deepen?: DeepenRequest;
  /** For a question: it asks for this earlier answer to be explained more simply (30 October 2026). */
  readonly simplifies?: string;
  /**
   * DSP-176: for a question, the presentation profile it was asked in and the answers it built
   * on (Explain more simply) or followed (a follow-up). Absent before profiles: Original.
   */
  readonly presentation?: PresentationRequest;
  /** DSP-184: the question carried the step explanation the person was reading, as hidden context. */
  readonly readingContext?: true;
}

/** Which deepening a question is, and the selected text for Explain this. */
export interface DeepenRequest {
  /** DSP-176: `present` asks for the step presented again in a profile, kept beside the prepared one. */
  readonly action: 'more' | 'simpler' | 'explain' | 'present';
  readonly text?: string;
  /** DSP-176: the profile it was asked in; absent before profiles, which is Original. */
  readonly profile?: PresentationProfile;
  /** DSP-176: the step's material it was asked from (its content hash), so a changed step does not reuse it. */
  readonly basis?: string;
}

/** A deepening request from a window, or `null` when there is none or it is malformed. */
export function deepenFrom(raw: unknown): DeepenRequest | null {
  if (!isRecord(raw)) {
    return null;
  }
  const action = raw['action'];
  if (action !== 'more' && action !== 'simpler' && action !== 'explain' && action !== 'present') {
    return null;
  }
  const text = typeof raw['text'] === 'string' ? raw['text'].slice(0, 2000) : undefined;
  const profile = isProfile(raw['profile']) ? raw['profile'] : undefined;
  const basis = typeof raw['basis'] === 'string' && /^[\w.:-]{1,128}$/.test(raw['basis']) ? raw['basis'] : undefined;
  if (action === 'present' && (profile === undefined || profile === 'original' || basis === undefined)) {
    return null;
  }
  return {
    action,
    ...(text === undefined || text.trim() === '' ? {} : { text }),
    ...(profile === undefined ? {} : { profile }),
    ...(basis === undefined ? {} : { basis }),
  };
}

/**
 * DSP-184: whether a stored question is, with certainty, an automatic profile explanation of a
 * step asked through the discussion before the step explanations had their own channel: only a
 * question with a `present` deepening. Its answer goes with it. Nothing else is guessed at, and
 * nothing stored is rewritten or deleted.
 */
export function isAutomaticProfileEntry(message: DiscussionMessage): boolean {
  return message.role === 'question' && message.deepen?.action === 'present';
}

/**
 * The agents a review discussion can use (DSP-132). The same values as the main
 * chat's `StoredSessionProvider`, spelt here so the review module needs nothing of the
 * chat's.
 */
export type DiscussionProvider = 'cursor' | 'claude' | 'copilot';

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
    // DSP-184: an automatic profile explanation from before the step explanations had their own
    // channel is the step's, not the conversation's: it is kept in the record and left out here.
    if (question.role !== 'question' || isAutomaticProfileEntry(question)) {
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

/** A stored reference: written by the service after its check, read back for display only. */
function isStoredContextReference(value: unknown): value is CheckedContextReference {
  if (!isRecord(value) || typeof value['label'] !== 'string' || !isRecord(value['range'])) {
    return false;
  }
  const range = value['range'];
  return (
    range['kind'] === 'context' &&
    typeof range['repository'] === 'string' &&
    typeof range['commit'] === 'string' &&
    /^[0-9a-f]{40}$/.test(range['commit']) &&
    typeof range['path'] === 'string' &&
    Number.isInteger(range['start']) &&
    Number.isInteger(range['end'])
  );
}

function isStoredReference(value: unknown): value is CheckedReference {
  if (!isRecord(value) || typeof value['label'] !== 'string' || !isRecord(value['range'])) {
    return false;
  }
  const range = value['range'];
  return (
    (range['side'] === 'base' || range['side'] === 'target') &&
    typeof range['path'] === 'string' &&
    Number.isInteger(range['start']) &&
    Number.isInteger(range['end'])
  );
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
    if (typeof entry['instruction'] === 'string') {
      message.instruction = entry['instruction'];
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
    if (entry['provider'] === 'cursor' || entry['provider'] === 'claude' || entry['provider'] === 'copilot') {
      message.provider = entry['provider'];
    }
    if (typeof entry['dspatchSessionId'] === 'string') {
      message.dspatchSessionId = entry['dspatchSessionId'];
    }
    if (typeof entry['toolPolicy'] === 'string') {
      message.toolPolicy = entry['toolPolicy'];
    }
    const deepen = deepenFrom(entry['deepen']);
    if (deepen !== null) {
      message.deepen = deepen;
    }
    if (typeof entry['simplifies'] === 'string') {
      message.simplifies = entry['simplifies'];
    }
    const presentation = presentationFrom(entry['presentation']);
    if (presentation !== null) {
      message.presentation = presentation;
    }
    if (entry['readingContext'] === true) {
      message.readingContext = true;
    }
    if (entry['codeAccess'] === true) {
      message.codeAccess = true;
    }
    if (Array.isArray(entry['references'])) {
      message.references = entry['references'].filter(isStoredReference);
    }
    if (Array.isArray(entry['contextReferences'])) {
      const context = entry['contextReferences'].filter(isStoredContextReference);
      if (context.length > 0) {
        message.contextReferences = context;
      }
    }
    if (entry['insufficient'] === true) {
      message.insufficient = true;
    }
    if (Array.isArray(entry['adjustments'])) {
      message.adjustments = entry['adjustments'].filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(entry['reads'])) {
      message.reads = entry['reads'].filter((item): item is string => typeof item === 'string');
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
      ...(provider === 'cursor' || provider === 'claude' || provider === 'copilot' ? { provider } : {}),
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
  /** What the next question is about, shared by every window of the review (30 October 2026). */
  quote: 'dspatch:review-discussion-quote',
  event: 'dspatch:review-discussion-event',
  /** DSP-132: choose the discussion's agent. Records the choice; builds nothing. */
  chooseAgent: 'dspatch:review-discussion-choose-agent',
  /** DSP-132: leave the recap out of (or back in) the next new session's first question. */
  recap: 'dspatch:review-discussion-recap',
  /** DSP-149: the agent's models, and choosing one; the same choice as the chat's. */
  listModels: 'dspatch:review-discussion-list-models',
  chooseModel: 'dspatch:review-discussion-choose-model',
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
  /**
   * What the agent is doing now, from what the provider reports (30 October 2026): waiting,
   * the file it reads, a search, writing. Absent when nothing more specific is known.
   */
  readonly activity?: string;
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
  | { readonly kind: 'status'; readonly status: DiscussionStatusView; readonly note?: string }
  /** What the agent answering this question is doing now; never stored. */
  | { readonly kind: 'activity'; readonly questionId: string; readonly activity: string }
  /**
   * What the next question is about, chosen in another window of the same review (30 October
   * 2026): one discussion per revision pair, one selection to ask about. `null` when it was let go.
   */
  | { readonly kind: 'quote'; readonly quote: SelectionQuote | null }
  /** The draft as another window of the same review has it now. */
  | { readonly kind: 'draft'; readonly text: string }
  /**
   * Show the review's panel (30 October 2026): the discussion, with the cursor in its question
   * unless `quiet`; or, with `tab` `'step'`, the step, quietly.
   */
  | { readonly kind: 'show'; readonly quiet?: true; readonly tab?: 'step' }
  /** DSP-184: the step explanations' own events, on the same channel to the same windows. */
  | StepExplanationEvent;

/** What the window sends with a question. The envelope is built in main from the subject. */
export interface DiscussionSendInput {
  readonly question: string;
  readonly subject: DiscussionSubject;
  readonly selection: CodeLocation | null;
  /** What the person selected to ask about; checked before it is sent. */
  readonly quote?: SelectionQuote | null;
  readonly language?: Lang;
  /** DSP-152: asked from a walk step's own deepening action. */
  readonly deepen?: DeepenRequest;
  /**
   * Explain this earlier answer more simply (30 October 2026). The question goes with the
   * envelope the answer's own question was sent with, not with what the window shows now.
   */
  readonly simplify?: { readonly answerId: string };
  /**
   * DSP-176, legacy: older windows sent the profile. DSP-184: it is ignored; a profile changes
   * the step's explanation, not the conversation.
   */
  readonly presentation?: PresentationRequest;
  /**
   * DSP-184: the step explanation the person is reading in Step, for a question about the
   * current step: sent as hidden context, never shown as a discussion entry.
   */
  readonly reading?: { readonly text: string } | null;
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
      /** What the next question is about, as any window of the review last chose it. */
      readonly quote?: SelectionQuote | null;
      readonly status: DiscussionStatusView;
      /** The subject line for the request given, when one was given and could be built. */
      readonly subjectLine: string | null;
      /** Something the person should know about the stored discussion, if anything. */
      readonly note: string | null;
      /** DSP-184: the review's step explanations, kept apart from the discussion. */
      readonly explanations?: StepExplanationsView;
    }
  | { readonly kind: 'refused'; readonly error: string };

/** The review window's discussion bridge (`window.dspatchReviewDiscussion`). */
export interface ReviewDiscussionBridge {
  load(request: DiscussionRequest | null): Promise<DiscussionLoadOutcome>;
  send(input: DiscussionSendInput): Promise<DiscussionSendOutcome>;
  cancel(): Promise<DiscussionCancelOutcome>;
  acknowledge(attemptIds: readonly string[]): Promise<DiscussionStatusView>;
  saveDraft(text: string): Promise<{ readonly saved: boolean; readonly error?: string }>;
  /** What the next question is about, for every window of the review; `null` lets it go. */
  setQuote(quote: SelectionQuote | null): Promise<void>;
  /** DSP-132: choose the agent. Creates no adapter and no session. */
  chooseAgent(provider: DiscussionProvider): Promise<DiscussionChooseOutcome>;
  /** DSP-132: leave the recap out of the next new session's first question, or put it back. */
  setRecapLeftOut(leftOut: boolean): Promise<DiscussionStatusView>;
  /** DSP-149: the models this agent offers, from its SDK, and the one chosen. */
  listModels(provider: DiscussionProvider): Promise<ModelListing>;
  /** DSP-149: choose this agent's model; the chat and the discussion share the choice. */
  chooseModel(provider: DiscussionProvider, modelId: string): Promise<string>;
  onEvent(listener: (event: ReviewDiscussionEvent) => void): () => void;
  /**
   * DSP-184: ask for a step explanation, in the step explanations' own channel. It travels on
   * the discussion's request path and never becomes a discussion entry.
   */
  explain?(input: StepExplanationInput): Promise<StepExplanationOutcome>;
  /** DSP-184: stop the step explanation being written. */
  stopExplanation?(): Promise<DiscussionCancelOutcome>;
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
