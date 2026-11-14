/**
 * DSP-209 S1: a context snapshot of a conversation, for the entry step of a loop run.
 *
 * Until now a loop run started from the chat was given the composer text and nothing
 * else, so "implement that" reached the entry agent without the conversation that said
 * what "that" was. This module builds the missing piece: an identifiable account of the
 * conversation, assembled by DSpatch itself from its own record (mission decision 1). No
 * agent summarises anything, so nothing an agent guessed can be promoted to a decision
 * on the way.
 *
 * The rules it keeps (ADAPTIVE_EXECUTION_AND_SHARED_CONTEXT §Context, the content
 * exclusion contract §2, the same rule as the DSP-121 recap in `buildResendContext`):
 *
 * - The person's messages appear verbatim and in order, each attributed to the person,
 *   under a generous bound. A decision and its later correction are therefore both
 *   there, in the order they were said.
 * - The agent's answers appear only as clipped excerpts, labelled as the agent's words
 *   and not decisions. They are never under a heading that calls them a decision or
 *   an instruction.
 * - Every cut says exactly what was left out (message numbers, characters) and where
 *   the original is: the conversation id and its message numbers.
 * - Project instruction files are named, never read. No file contents and no diff text
 *   are taken in at all: the inputs carry only paths and names, so the snapshot cannot
 *   contain what it was never given.
 *
 * Pure: no file system, no git, no clock, no Node built-ins, so the renderer may use it
 * as well. Nothing calls it from the host or the loop yet; that is S2.
 */

import type { StoredMessage } from './bridge';

/** What the builder reads of a saved message. A `StoredMessage` is one. */
export type SnapshotMessage = Pick<StoredMessage, 'ordinal' | 'prompt' | 'answer' | 'resentContext'>;

/** An earlier loop run started from the same conversation, as S2 maps it from the run record. */
export interface EarlierRunSummary {
  readonly runId: string;
  /** The mandate the run was started with, as the person wrote it. */
  readonly mandate: string;
  /** How the run ended or where it stands: the record's own word, such as `finished` or `interrupted`. */
  readonly ending: string;
  /** The terminal it reached, by its label or id. `null` when it reached none. */
  readonly terminal: string | null;
  /** Steps the run skipped, with the reason it recorded. Absent when the record has none. */
  readonly skippedSteps?: readonly { readonly step: string; readonly reason: string }[];
  /** The step the run was handed over to interactive work from. Absent when it was not. */
  readonly handedOverFrom?: string;
}

/** The repository as it stood when the run started. Names only, never contents. */
export interface SnapshotRepositoryState {
  /** The commit HEAD points at, or `null` when there is none (an empty repository) or it is unknown. */
  readonly head: string | null;
  /** The branch checked out, or `null` when HEAD is detached or it is unknown. */
  readonly branch: string | null;
  /** Paths with uncommitted changes, relative to the repository root. */
  readonly uncommittedPaths: readonly string[];
}

export interface ContextSnapshotLimits {
  /** Characters kept of one of the person's messages. Generous: these are the assignment. */
  readonly maxPersonMessageChars: number;
  /** Characters kept of the person's messages together; the oldest whole messages go first. */
  readonly maxPersonTotalChars: number;
  /** How many of the agent's most recent answers are excerpted. */
  readonly maxAgentExcerpts: number;
  /** Characters kept of one agent answer. */
  readonly maxAgentExcerptChars: number;
  /** How many of the most recent earlier runs are listed. */
  readonly maxEarlierRuns: number;
  /** Characters kept of an earlier run's mandate. */
  readonly maxEarlierMandateChars: number;
  /** How many uncommitted paths are named. */
  readonly maxUncommittedPaths: number;
  /** Characters kept of this run's mandate. */
  readonly maxMandateChars: number;
}

export const CONTEXT_SNAPSHOT_LIMITS: ContextSnapshotLimits = {
  maxPersonMessageChars: 8_000,
  maxPersonTotalChars: 60_000,
  maxAgentExcerpts: 6,
  maxAgentExcerptChars: 600,
  maxEarlierRuns: 10,
  maxEarlierMandateChars: 1_000,
  maxUncommittedPaths: 100,
  maxMandateChars: 8_000,
};

export interface ContextSnapshotInput {
  readonly conversationId: string;
  readonly messages: readonly SnapshotMessage[];
  /** Oldest first, as they were started. */
  readonly earlierRuns: readonly EarlierRunSummary[];
  /** `null` when the working folder is not a repository or its state could not be read. */
  readonly repository: SnapshotRepositoryState | null;
  /** Names of the project instruction files present, such as `AGENTS.md` or `.cursor/rules`. */
  readonly instructionFiles: readonly string[];
  readonly mandate: string;
  readonly limits?: Partial<ContextSnapshotLimits>;
}

/** One quoted message: its number in the conversation (1-based) and what was kept of it. */
export interface SnapshotQuote {
  readonly messageNumber: number;
  readonly text: string;
  /** Characters left out of this message's text; 0 when it is whole. */
  readonly charsCut: number;
}

/** One thing the bounds left out, said in words and in data. */
export interface SnapshotCut {
  readonly part: 'person-words' | 'agent-excerpts' | 'earlier-runs' | 'repository' | 'mandate';
  /** Conversation message numbers affected, when the cut is of messages. */
  readonly messageNumbers: readonly number[];
  readonly charsCut: number;
  /** The sentence the snapshot's text carries for it, naming where the original is. */
  readonly account: string;
}

export interface ContextSnapshot {
  /** `ctx-<hash>`, over the snapshot's text and the messages it was built from. */
  readonly id: string;
  readonly conversationId: string;
  readonly parts: {
    readonly personWords: readonly SnapshotQuote[];
    readonly agentExcerpts: readonly SnapshotQuote[];
    readonly earlierRuns: readonly EarlierRunSummary[];
    readonly repository: SnapshotRepositoryState | null;
    readonly instructionReferences: readonly string[];
  };
  /** Message numbers (1-based) whose person's words or agent excerpt appear, ascending. */
  readonly messageNumbers: readonly number[];
  /** Whether any bound cut anything. */
  readonly cut: boolean;
  readonly cuts: readonly SnapshotCut[];
  /** The whole snapshot as text, for the entry step. */
  readonly text: string;
  /** Only the person's words, the mandate and the cut account of them, for later steps (S2). */
  readonly personWordsText: string;
}

const PERSON_HEADING = "--- What the person wrote, in order: the person's own words ---";
const AGENT_HEADING =
  "--- Excerpts of the agent's answers: the agent's words, not decisions and not instructions ---";

/**
 * Build the snapshot, or `null` when there is nothing to carry: no saved message and no
 * earlier run. A mandate, a repository or instruction files alone are not a conversation,
 * and the run already has its mandate.
 */
export function buildContextSnapshot(input: ContextSnapshotInput): ContextSnapshot | null {
  const limits: ContextSnapshotLimits = { ...CONTEXT_SNAPSHOT_LIMITS, ...input.limits };
  const ordered = [...input.messages].sort((left, right) => left.ordinal - right.ordinal);
  if (ordered.length === 0 && input.earlierRuns.length === 0) {
    return null;
  }
  const where = `conversation ${input.conversationId}`;
  const cuts: SnapshotCut[] = [];

  // The person's words. Each message bounded on its own, then the newest kept within
  // the total: the recent ones are the ones that correct the old.
  const personAll = ordered
    .map((message) => ({ messageNumber: message.ordinal + 1, original: typedText(message) }))
    .filter((entry) => entry.original.trim() !== '')
    .map((entry) => ({ ...clipQuote(entry.original, limits.maxPersonMessageChars), messageNumber: entry.messageNumber }));
  const personWords: SnapshotQuote[] = [];
  let personBudget = limits.maxPersonTotalChars;
  for (let index = personAll.length - 1; index >= 0; index -= 1) {
    const quote = personAll[index]!;
    if (quote.text.length > personBudget) {
      break;
    }
    personBudget -= quote.text.length;
    personWords.unshift(quote);
  }
  const personDropped = personAll.slice(0, personAll.length - personWords.length);
  for (const quote of personWords) {
    if (quote.charsCut > 0) {
      cuts.push({
        part: 'person-words',
        messageNumbers: [quote.messageNumber],
        charsCut: quote.charsCut,
        account:
          `The person's message ${String(quote.messageNumber)}: the last ${String(quote.charsCut)} characters ` +
          `are cut (${String(quote.text.length)} of ${String(quote.text.length + quote.charsCut)} kept). ` +
          `The whole message is message ${String(quote.messageNumber)} of ${where}.`,
      });
    }
  }
  if (personDropped.length > 0) {
    const numbers = personDropped.map((quote) => quote.messageNumber);
    const chars = personDropped.reduce((sum, quote) => sum + quote.text.length + quote.charsCut, 0);
    cuts.push({
      part: 'person-words',
      messageNumbers: numbers,
      charsCut: chars,
      account:
        `The person's ${plural(numbers.length, 'message', 'messages')} ${numberList(numbers)} ` +
        `(${String(chars)} characters) ${numbers.length === 1 ? 'is' : 'are'} left out, because the ` +
        `person's words together exceed ${String(limits.maxPersonTotalChars)} characters and the most ` +
        `recent are kept. The originals are ${plural(numbers.length, 'message', 'messages')} ` +
        `${numberList(numbers)} of ${where}.`,
    });
  }

  // The agent's answers: excerpts of the most recent few, the rest named.
  const answered = ordered.filter((message) => message.answer.trim() !== '');
  const excerpted = answered.slice(-limits.maxAgentExcerpts);
  const notExcerpted = answered.slice(0, answered.length - excerpted.length);
  const agentExcerpts: SnapshotQuote[] = excerpted.map((message) => ({
    ...clipQuote(message.answer, limits.maxAgentExcerptChars),
    messageNumber: message.ordinal + 1,
  }));
  const agentClipped = agentExcerpts.filter((quote) => quote.charsCut > 0);
  if (agentClipped.length > 0) {
    const numbers = agentClipped.map((quote) => quote.messageNumber);
    const chars = agentClipped.reduce((sum, quote) => sum + quote.charsCut, 0);
    cuts.push({
      part: 'agent-excerpts',
      messageNumbers: numbers,
      charsCut: chars,
      account:
        `The agent's ${plural(numbers.length, 'answer', 'answers')} to ${plural(numbers.length, 'message', 'messages')} ` +
        `${numberList(numbers)} ${numbers.length === 1 ? 'is' : 'are'} cut to ` +
        `${String(limits.maxAgentExcerptChars)} characters each (${String(chars)} characters left out in all). ` +
        `The whole answers are in ${plural(numbers.length, 'message', 'messages')} ${numberList(numbers)} of ${where}.`,
    });
  }
  if (notExcerpted.length > 0) {
    const numbers = notExcerpted.map((message) => message.ordinal + 1);
    const chars = notExcerpted.reduce((sum, message) => sum + message.answer.trim().length, 0);
    cuts.push({
      part: 'agent-excerpts',
      messageNumbers: numbers,
      charsCut: chars,
      account:
        `The agent's ${plural(numbers.length, 'answer', 'answers')} to ${plural(numbers.length, 'message', 'messages')} ` +
        `${numberList(numbers)} (${String(chars)} characters) ${numbers.length === 1 ? 'is' : 'are'} left out; ` +
        `only the most recent ${String(excerpted.length)} are excerpted. The originals are in ` +
        `${plural(numbers.length, 'message', 'messages')} ${numberList(numbers)} of ${where}.`,
    });
  }

  // Earlier runs: the most recent few, mandates bounded.
  const runsShown = input.earlierRuns.slice(-limits.maxEarlierRuns);
  const runsDropped = input.earlierRuns.slice(0, input.earlierRuns.length - runsShown.length);
  if (runsDropped.length > 0) {
    cuts.push({
      part: 'earlier-runs',
      messageNumbers: [],
      charsCut: 0,
      account:
        `${plural(runsDropped.length, 'earlier run is', 'earlier runs are')} left out, oldest first: ` +
        `${runsDropped.map((run) => run.runId).join(', ')}. Their run records hold them.`,
    });
  }
  const earlierRuns: EarlierRunSummary[] = runsShown.map((run) => {
    const mandate = clipQuote(run.mandate, limits.maxEarlierMandateChars);
    if (mandate.charsCut > 0) {
      cuts.push({
        part: 'earlier-runs',
        messageNumbers: [],
        charsCut: mandate.charsCut,
        account:
          `The mandate of earlier run ${run.runId}: the last ${String(mandate.charsCut)} characters are cut. ` +
          'Its run record holds the whole mandate.',
      });
    }
    return { ...run, mandate: mandate.text };
  });

  // The repository: names only.
  let repository: SnapshotRepositoryState | null = null;
  if (input.repository !== null) {
    const paths = input.repository.uncommittedPaths;
    const kept = paths.slice(0, limits.maxUncommittedPaths);
    if (kept.length < paths.length) {
      cuts.push({
        part: 'repository',
        messageNumbers: [],
        charsCut: 0,
        account:
          `${String(paths.length - kept.length)} of ${String(paths.length)} uncommitted paths are not named here; ` +
          '`git status` in the working copy lists them all.',
      });
    }
    repository = { head: input.repository.head, branch: input.repository.branch, uncommittedPaths: kept };
  }

  const mandate = clipQuote(input.mandate, limits.maxMandateChars);
  if (mandate.charsCut > 0) {
    cuts.push({
      part: 'mandate',
      messageNumbers: [],
      charsCut: mandate.charsCut,
      account:
        `This run's mandate: the last ${String(mandate.charsCut)} characters are cut. ` +
        "The run's own record holds the whole mandate.",
    });
  }

  const instructionReferences = [...input.instructionFiles];
  const messageNumbers = [
    ...new Set([...personWords, ...agentExcerpts].map((quote) => quote.messageNumber)),
  ].sort((left, right) => left - right);

  const body = renderBody({
    where,
    mandate: mandate.text,
    personWords,
    agentExcerpts,
    earlierRuns,
    repository,
    instructionReferences,
    cuts,
    totalMessages: ordered.length,
  });
  const id = `ctx-${contentHash(`${body}\n${sourceFingerprint(input.conversationId, ordered)}`)}`;
  const text = [
    `=== DSpatch: context from the conversation this run was started from (${id}) ===`,
    '',
    ...body.full,
    '',
    `=== end of DSpatch's context ${id} ===`,
  ].join('\n');
  const personWordsText = [
    `=== DSpatch: the person's words from the conversation this run was started from (${id}) ===`,
    '',
    ...body.personOnly,
    '',
    `=== end of DSpatch's context ${id} ===`,
  ].join('\n');

  return {
    id,
    conversationId: input.conversationId,
    parts: { personWords, agentExcerpts, earlierRuns, repository, instructionReferences },
    messageNumbers,
    cut: cuts.length > 0,
    cuts,
    text,
    personWordsText,
  };
}

/**
 * The person's own typed text of a message. A recap DSpatch resent is stored apart in
 * `resentContext` and the prompt is the typed text alone; should a prompt ever begin
 * with that recap, the recap is taken off, because it is DSpatch talking, not the person.
 */
function typedText(message: SnapshotMessage): string {
  const recap = message.resentContext;
  if (recap !== null && recap !== '' && message.prompt.startsWith(recap)) {
    return message.prompt.slice(recap.length).replace(/^\s+/, '');
  }
  return message.prompt;
}

function clipQuote(original: string, limit: number): { readonly text: string; readonly charsCut: number } {
  const trimmed = original.trim();
  if (trimmed.length <= limit) {
    return { text: trimmed, charsCut: 0 };
  }
  return { text: trimmed.slice(0, limit), charsCut: trimmed.length - limit };
}

/**
 * Quoted text, every line behind a bar, so that nothing inside a message can look like
 * one of the snapshot's own headings and lift an agent's words under another label.
 */
function quoted(text: string): string[] {
  return text.split(/\r?\n/).map((line) => `| ${line}`);
}

function renderBody(parts: {
  readonly where: string;
  readonly mandate: string;
  readonly personWords: readonly SnapshotQuote[];
  readonly agentExcerpts: readonly SnapshotQuote[];
  readonly earlierRuns: readonly EarlierRunSummary[];
  readonly repository: SnapshotRepositoryState | null;
  readonly instructionReferences: readonly string[];
  readonly cuts: readonly SnapshotCut[];
  readonly totalMessages: number;
}): { readonly full: string[]; readonly personOnly: string[] } {
  const about = [
    `DSpatch assembled this itself from its own record of ${parts.where} ` +
      `(${String(parts.totalMessages)} saved ${parts.totalMessages === 1 ? 'message' : 'messages'}); ` +
      'no agent summarised or reworded it.',
    "What it holds: the person's own messages, verbatim and in order; short excerpts of the " +
      "agent's answers; earlier loop runs started from this conversation; the repository's " +
      'state when this run started; the names of the project instruction files present.',
    'What it does not hold: file contents, diff text, tool calls, or anything the agent worked ' +
      'out without writing it down. Read the project itself for what is there now.',
    "The person's words are the assignment. Where the person later corrects something they said, " +
      'both messages are here in order, and the later one is the more recent word. The agent\'s ' +
      'excerpts are its earlier account and may have been wrong or overruled.',
  ];

  const mandate = ["--- This run's mandate, as the person wrote it ---", ...quoted(parts.mandate)];

  const person: string[] = [PERSON_HEADING];
  if (parts.personWords.length === 0) {
    person.push('[No message from the person is included.]');
  }
  for (const quote of parts.personWords) {
    person.push(
      '',
      `Message ${String(quote.messageNumber)}, the person wrote${quote.charsCut > 0 ? ' (cut, see below)' : ''}:`,
      ...quoted(quote.text),
    );
  }

  const agent: string[] = [AGENT_HEADING];
  if (parts.agentExcerpts.length === 0) {
    agent.push('[No answer from the agent is included.]');
  }
  for (const quote of parts.agentExcerpts) {
    agent.push(
      '',
      `Message ${String(quote.messageNumber)}, the agent answered${quote.charsCut > 0 ? ' (excerpt, cut)' : ''}:`,
      ...quoted(quote.text),
    );
  }

  const runs: string[] = ['--- Earlier loop runs started from this conversation ---'];
  if (parts.earlierRuns.length === 0) {
    runs.push('None.');
  }
  for (const run of parts.earlierRuns) {
    runs.push(
      '',
      `Run ${run.runId}: ${run.terminal === null ? `ended as ${run.ending}, at no terminal` : `ended as ${run.ending}, at "${run.terminal}"`}.`,
    );
    if (run.skippedSteps !== undefined && run.skippedSteps.length > 0) {
      runs.push(`Skipped steps: ${run.skippedSteps.map((step) => `${step.step} (${step.reason})`).join('; ')}.`);
    }
    if (run.handedOverFrom !== undefined) {
      runs.push(`Handed over to interactive work from step ${run.handedOverFrom}.`);
    }
    runs.push('Its mandate:', ...quoted(run.mandate));
  }

  const repo: string[] = ['--- The repository when this run started ---'];
  if (parts.repository === null) {
    repo.push('Not known: DSpatch did not read a repository state for this run.');
  } else {
    const r = parts.repository;
    repo.push(
      `HEAD: ${r.head ?? 'none'}. Branch: ${r.branch ?? 'none (detached or unknown)'}.`,
      r.uncommittedPaths.length === 0
        ? 'Uncommitted changes: none named.'
        : `Uncommitted changes in: ${r.uncommittedPaths.join(', ')}.`,
    );
  }

  const instructions: string[] = [
    '--- Project instruction files present: names only, their contents are not included ---',
    ...(parts.instructionReferences.length === 0
      ? ['None found.']
      : parts.instructionReferences.map((name) => `- ${name}`)),
  ];

  const cutLines = (relevant: readonly SnapshotCut[]): string[] => [
    '--- What was cut ---',
    ...(relevant.length === 0
      ? ['Nothing: every part above is whole.']
      : relevant.map((cut) => `- ${cut.account}`)),
  ];

  const full = [
    ...about,
    '',
    ...mandate,
    '',
    ...person,
    '',
    ...agent,
    '',
    ...runs,
    '',
    ...repo,
    '',
    ...instructions,
    '',
    ...cutLines(parts.cuts),
  ];
  const personOnly = [
    `DSpatch took this from its own record of ${parts.where}: the person's own messages, ` +
      "verbatim and in order. The agent's answers, file contents and diff text are not in it.",
    '',
    ...mandate,
    '',
    ...person,
    '',
    ...cutLines(parts.cuts.filter((cut) => cut.part === 'person-words' || cut.part === 'mandate')),
  ];
  return { full, personOnly };
}

/** What the snapshot was built from, so that a changed message changes the id even where it was cut. */
function sourceFingerprint(conversationId: string, ordered: readonly SnapshotMessage[]): string {
  return contentHash(
    JSON.stringify([conversationId, ordered.map((message) => [message.ordinal, message.prompt, message.answer])]),
  );
}

/** A short, stable hash of a string (two 32-bit FNV-1a lanes). An identity, not a secret. */
function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

function numberList(numbers: readonly number[]): string {
  return numbers.map(String).join(', ');
}
