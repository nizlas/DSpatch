/**
 * What the agent is asked, and how its answer is read, when it prepares code walks or
 * reviews a delegated part of a revision pair (DSP-152).
 *
 * The requirements are Niclas's original plan, docs/plans/DSpatch-code-walks-plan-original.md.
 * Its writing rules (section 2) are the instruction the walks are written to, and its rule
 * that nothing here is an approval by itself (sections 1 and 5) is what the validation of
 * a delegated review enforces.
 *
 * Pure: the host builds the material from the two commits, writes the revisions to a folder
 * the agent reads with its own tools, and runs the agent; this module writes the prompt and
 * checks the answer. Nothing here reads a working copy.
 */

import {
  changedLinesOf,
  lineKey,
  rangesOf,
  shownPath,
  type AgentFinding,
  type AgentMaterial,
  type AnswerReference,
  type ChangedLine,
  type CodeSelection,
  type ExplainFollowUp,
  type SelectedCodeKind,
  type SelectionSegment,
  type DelegationResult,
  type DelegationScope,
  type LineRange,
  type LineSide,
  type PairFile,
  type RevisionPairIdentity,
  type StepAnswer,
  type StepQuestion,
} from './review-pair';

/** The header every task prompt starts with, so a simulated agent can tell them apart. */
export const TASK_HEADER = 'DSPATCH-REVIEW-TASK:';

/**
 * What the agent is told about the pair at the start (DSP-152): what the change is, its
 * changed lines, and the diff for orientation. Built by the host from the two commits.
 *
 * Orientation only. The agent reads the two revisions themselves with its provider's own
 * tools, in the folder the host wrote them to (`base/`, `target/`), so it can read whole
 * files, follow callers and definitions and look at unchanged code and tests. The size
 * bound below limits only this opening diff, never what the agent can read.
 */
export interface AnalysisMaterial {
  readonly pair: RevisionPairIdentity;
  readonly repositoryName: string;
  readonly baseSubject: string;
  readonly targetSubject: string;
  readonly files: readonly PairFile[];
  /** The unified diff between the commits, whole files' diffs only, up to the bound. */
  readonly diff: string;
  /** Files whose diff is not in `diff` for size; their text is in the folder like every other. */
  readonly diffLeftOut: readonly string[];
}

/** The size of the opening diff; beyond it a file's diff is named, not shown. */
export const ORIENTATION_DIFF_CHARS = 60_000;

/** The changed lines of every file, as ranges the agent must cover and may name. */
export function changedRangesOf(files: readonly PairFile[]): readonly LineRange[] {
  return rangesOf(files.flatMap((file) => changedLinesOf(file)));
}

/** The folder section: where the revisions are, what the agent can do there, and what is missing. */
function folderSection(material: AnalysisMaterial, folder: AgentMaterial): string {
  const lines = [
    '## The code, and how to read it',
    'Your working folder holds the two revisions as files, written by DSpatch from the repository\'s commits:',
    `- \`base/\` is From, commit ${material.pair.base}`,
    `- \`target/\` is To, commit ${material.pair.target}`,
    'Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.',
    'Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.',
    'In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.',
  ];
  if (folder.skippedCount > 0) {
    lines.push(
      '',
      `${String(folder.skippedCount)} file(s) of the commits could not be written to the folder, so you cannot read them${folder.skipped.length < folder.skippedCount ? ' (the first are named)' : ''}:`,
      ...folder.skipped.map((entry) => `- ${entry.side}/${entry.path}: ${entry.reason}`),
      'If one of them matters for what you are asked, say so; do not assume what it contains.',
    );
  }
  return lines.join('\n');
}

function changeSection(material: AnalysisMaterial): string {
  const changed = changedRangesOf(material.files).map((range) => ({
    path: range.path,
    side: range.side,
    start: range.start,
    end: range.end,
  }));
  return [
    `## The change`,
    `Repository: ${material.repositoryName}`,
    `From: ${material.pair.base} (${material.baseSubject})`,
    `To: ${material.pair.target} (${material.targetSubject})`,
    'Line numbers are 1-based; "base" is From and "target" is To.',
    '',
    '## Changed lines (machine-readable)',
    '```json',
    JSON.stringify(changed),
    '```',
    '',
    '## Changed files',
    ...material.files.map((file) =>
      file.status === 'renamed' || file.status === 'copied'
        ? `- ${file.status} ${file.oldPath ?? ''} → ${file.newPath ?? ''}${file.binary ? ' (binary)' : ''}`
        : `- ${file.status} ${shownPath(file)}${file.binary ? ' (binary)' : ''}`,
    ),
    '',
    '## Diff (orientation)',
    '```diff',
    material.diff,
    '```',
    ...(material.diffLeftOut.length === 0
      ? []
      : ['', `The diff of these files is not shown here for size; read them in the folder: ${material.diffLeftOut.join(', ')}.`]),
  ].join('\n');
}

/**
 * The writing rules of the plan (section 2), as the agent is told them. The plan governs;
 * this is its instruction, not a template.
 */
export const WRITING_RULES = [
  'Write so that a developer who did not write this change understands it.',
  'Each step says what happens, why it happens or is needed, and what is worth noticing in the code. Give the needed context before the details.',
  'Use concrete language and say who does what: the user, DSpatch, the provider, or a named component.',
  'Explain cause and effect. Do not write that something "appears" or "happens" without saying why.',
  'Keep the relevant class names, methods and established terms such as inheritance and subclass. Explain them when needed instead of replacing them with vague simplifications.',
  'Use short paragraphs. Use bullets for alternative cases and numbering for an actual order.',
  'Emphasise sparingly: only the central connection or consequence.',
  "Keep apart what the code is meant to do, your own conclusions, and test results that were actually observed. You have observed no test run here: you can read code, not run it.",
  'No fixed length and no template of mandatory headings: be as short as understanding allows.',
  'Do not narrate your investigation ("I read…", "Then I searched…"). Give the explanation, and point at the code it rests on.',
] as const;

/** Ask for code walks over the pair. */
export function walksPrompt(material: AnalysisMaterial, folder: AgentMaterial, language: 'sv' | 'en'): string {
  return [
    `${TASK_HEADER} prepare-walks`,
    '',
    'You prepare code walks that help a person understand and review a change. You examine the code yourself with your reading tools, then answer.',
    '',
    '## What to produce',
    'Propose walks around behaviours or questions the change touches, for example "What happens when the user cancels?", not a file-by-file listing.',
    'Each walk has a short description of what the person will understand and why it is relevant, and steps with concrete code references, across files where the behaviour goes.',
    'A step may point at unchanged code when it is needed to understand the change: the definition a changed line calls, a caller, the test that exercises it, the configuration that switches it on. Point at it where it is, at the side it is read from.',
    'Together the walks should cover every changed line, including error handling, tests, configuration and removed behaviour. A line no walk covers is shown to the person as not covered; do not invent coverage.',
    'A walk is not a review and approves nothing.',
    '',
    `## How to write (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    '',
    '## Answer format',
    'When you have examined what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        overview: 'Two or three sentences: what the change as a whole does and why.',
        walks: [
          {
            title: 'A behaviour or question',
            question: 'The question the walk answers',
            purpose: 'What the person will understand, and why it matters (one or two sentences).',
            steps: [
              {
                title: 'Short step title',
                summary: 'One or two sentences: what happens here.',
                body: 'The explanation in Markdown: what happens, why, what to notice in the code.',
                why: 'Optional: the consequence, if it needs saying apart from the body.',
                places: [{ label: 'What this place is', path: 'src/file.ts', side: 'target', start: 10, end: 14, anchor: 'a short exact text from those lines' }],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    '```',
    'Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side. "anchor", when given, is text that occurs on those lines. DSpatch checks every place against the commit.',
    '',
    folderSection(material, folder),
    '',
    changeSection(material),
  ].join('\n');
}

/** Ask once more, naming what was wrong. One round only; the host does not loop. */
export function repairPrompt(problems: readonly string[]): string {
  return [
    `${TASK_HEADER} repair-walks`,
    '',
    'DSpatch checked your walks against the two commits and found these problems:',
    ...problems.slice(0, 40).map((problem) => `- ${problem}`),
    '',
    'Check the places in the folder if you need to, then answer again with the complete corrected JSON object in a ```json fence, in the same format. Keep every place that was right.',
  ].join('\n');
}

/** Ask for a review of a delegated part, under an explicit mandate for exactly that part. */
export function reviewPrompt(material: AnalysisMaterial, folder: AgentMaterial, scope: DelegationScope, language: 'sv' | 'en'): string {
  return [
    `${TASK_HEADER} delegated-review`,
    '',
    'The person has delegated the review of one part of a change to you. You examine the code yourself with your reading tools, then answer.',
    '',
    '## Your mandate',
    `Scope: ${scope.label}`,
    'You may approve changed lines inside the scope that you actually reviewed and judge to be correct. Nothing outside the scope, and nothing you did not review.',
    'Judge the lines in their context: read what they call and what calls them, the types and data they use, and the tests that cover them, at both revisions where behaviour changed. A finding may point at unchanged code when that is where the problem shows.',
    'Report what you reviewed, your assessment and what it rests on, every problem you found, and what remains uncertain. Name anything you needed but could not read.',
    'If what you could read is not enough to judge the scope, say so with "insufficient": true and approve nothing.',
    'Approval means the reviewed lines are acceptable as far as you can tell from the code you read; it is not a guarantee of correctness, and you have run nothing. Do not propose fixes as changes; describe problems.',
    '',
    '## The scope (machine-readable)',
    '```json',
    JSON.stringify(scope.ranges.map((range) => ({ path: range.path, side: range.side, start: range.start, end: range.end }))),
    '```',
    '',
    `## Answer format (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    'When you have examined what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        assessment: 'What you reviewed and your judgement, in a few sentences, with what it rests on.',
        reviewed: [{ path: 'src/file.ts', side: 'target', start: 10, end: 14 }],
        approved: [{ path: 'src/file.ts', side: 'target', start: 10, end: 12 }],
        findings: [{ severity: 'problem', text: 'What is wrong and why', path: 'src/file.ts', side: 'target', start: 13, end: 13 }],
        uncertainties: ['What you could not establish from the code you read'],
        insufficient: false,
      },
      null,
      2,
    ),
    '```',
    'severity is "problem", "question" or "note". A line with a problem is not approved. Do not narrate your investigation; give the judgement and what it rests on.',
    '',
    folderSection(material, folder),
    '',
    changeSection(material),
  ].join('\n');
}

/** A step as the host read it from its walk definition, for a question about it. */
export interface StepContext {
  readonly walkTitle: string;
  readonly stepTitle: string;
  readonly summary: string;
  readonly body: string;
}

/** Ask a question about one step, which the agent answers by examining the code. */
export function stepQuestionPrompt(
  material: AnalysisMaterial,
  folder: AgentMaterial,
  question: StepQuestion,
  step: StepContext,
  language: 'sv' | 'en',
): string {
  return [
    `${TASK_HEADER} step-question`,
    '',
    'A person reading a code walk asks a question about one step. Examine the code with your reading tools as far as the question needs, then answer.',
    '',
    '## The step',
    `Walk: ${step.walkTitle}`,
    `Step: ${step.stepTitle}`,
    ...(step.summary === '' ? [] : ['', 'Summary:', step.summary]),
    ...(step.body === '' ? [] : ['', 'The explanation the person has read:', step.body]),
    '',
    '## The code the step points at (machine-readable)',
    '```json',
    JSON.stringify(question.places.map((range) => ({ path: range.path, side: range.side, start: range.start, end: range.end }))),
    '```',
    '',
    '## The question',
    question.question,
    '',
    `## How to answer (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    'Answer this question, for this step. Start with the short answer, then the cause and effect behind it, with the context needed before the details. Do not rewrite the whole walk or change its level.',
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    'If the code you could read does not settle the question, say what is missing and set "insufficient": true.',
    '',
    'Answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        answer: 'The answer in Markdown.',
        references: [{ label: 'What this place shows', path: 'src/file.ts', side: 'target', start: 10, end: 14 }],
        insufficient: false,
      },
      null,
      2,
    ),
    '```',
    'Every reference names a path, a side and 1-based lines at that side; DSpatch checks each against the commit.',
    '',
    folderSection(material, folder),
    '',
    changeSection(material),
  ].join('\n');
}
/** The bounds of a selection the agent is asked to explain; beyond them it is refused. */
export const SELECTION_LIMITS = { segments: 40, lines: 400, characters: 20_000 } as const;

/** How many lines around each selected run the prompt shows, before and after. */
const AROUND_LINES = 6;

/**
 * A selection a window sent, checked against the commits (DSP-152). The host reads every
 * line from Git at the side it names and decides itself whether it is removed, added or
 * unchanged; a run of lines of more than one kind is split. The text the window saw must be
 * the commits' text at those places, or the selection is refused: the agent is never asked
 * about text the person did not select.
 */
export async function readSelection(raw: unknown, files: readonly PairFile[], read: LineReader): Promise<CodeSelection | { readonly error: string }> {
  const again = 'Select the code again.';
  if (!isObject(raw) || typeof raw['fileKey'] !== 'string' || !Array.isArray(raw['segments']) || typeof raw['text'] !== 'string') {
    return { error: 'No code was selected.' };
  }
  const file = files.find((entry) => entry.key === raw['fileKey']);
  if (file === undefined) {
    return { error: `The selected file is not part of this change. ${again}` };
  }
  if (raw['segments'].length === 0) {
    return { error: 'No code was selected.' };
  }
  if (raw['segments'].length > SELECTION_LIMITS.segments) {
    return { error: 'The selection is too large to explain at once. Select less.' };
  }
  const changed = new Set(changedLinesOf(file).map(lineKey));
  const kindOf = (side: LineSide, filePath: string, line: number): SelectedCodeKind =>
    changed.has(lineKey({ side, path: filePath, line })) ? (side === 'base' ? 'removed' : 'added') : 'unchanged';
  const segments: SelectionSegment[] = [];
  let lineCount = 0;
  for (const entry of raw['segments'] as unknown[]) {
    const range = rangeOf(entry);
    if (range === null || !isObject(entry) || !Number.isInteger(entry['from']) || !Number.isInteger(entry['to'])) {
      return { error: `The selection does not name its lines. ${again}` };
    }
    const expected = range.side === 'base' ? file.oldPath : file.newPath;
    if (expected === null || range.path !== expected) {
      return { error: `The selection names ${range.path}, which is not this file at ${range.side === 'base' ? 'From' : 'To'}. ${again}` };
    }
    lineCount += range.end - range.start + 1;
    if (lineCount > SELECTION_LIMITS.lines) {
      return { error: `The selection is longer than ${String(SELECTION_LIMITS.lines)} lines. Select less.` };
    }
    const lines = await read(range.side, range.path);
    if (lines === null || range.end > lines.length) {
      return { error: `${range.path} has no line ${String(range.end)} at ${range.side === 'base' ? 'From' : 'To'}. ${again}` };
    }
    const from = entry['from'] as number;
    const to = entry['to'] as number;
    const first = lines[range.start - 1] ?? '';
    const last = lines[range.end - 1] ?? '';
    if (from < 0 || from > first.length || to < 0 || to > last.length || (range.start === range.end && to < from)) {
      return { error: `The selection's characters are not on those lines. ${again}` };
    }
    // Runs of one kind: removed, added and unchanged lines are never one segment.
    let runStart = range.start;
    for (let line = range.start; line <= range.end; line += 1) {
      const kind = kindOf(range.side, range.path, line);
      if (line < range.end && kindOf(range.side, range.path, line + 1) === kind) {
        continue;
      }
      const runFrom = runStart === range.start ? from : 0;
      const runTo = line === range.end ? to : (lines[line - 1] ?? '').length;
      const picked = lines.slice(runStart - 1, line).map((value, index, all) => {
        const lead = index === 0 ? runFrom : 0;
        return index === all.length - 1 ? value.slice(lead, runTo) : value.slice(lead);
      });
      segments.push({ side: range.side, path: range.path, start: runStart, end: line, from: runFrom, to: runTo, kind, text: picked.join('\n') });
      runStart = line + 1;
    }
  }
  const joined = segments.map((segment) => segment.text).join('\n');
  if (joined.length > SELECTION_LIMITS.characters) {
    return { error: `The selection is longer than ${String(SELECTION_LIMITS.characters)} characters. Select less.` };
  }
  if (joined.trim() === '') {
    return { error: 'Only blank space was selected.' };
  }
  // What the window saw must be what the commits hold there (split runs joined alike).
  if (raw['text'].replace(/\r/g, '') !== joined) {
    return { error: `The selected text is not what the commits hold at that place. ${again}` };
  }
  return { fileKey: file.key, layout: raw['layout'] === 'unified' ? 'unified' : 'split', segments };
}

/** The lines around a segment at its side, numbered, the selected ones marked with `>`. */
export function linesAround(segment: Pick<SelectionSegment, 'start' | 'end'>, lines: readonly string[]): string {
  const first = Math.max(1, segment.start - AROUND_LINES);
  const last = Math.min(lines.length, segment.end + AROUND_LINES);
  const width = String(last).length;
  const out: string[] = [];
  for (let line = first; line <= last; line += 1) {
    const mark = line >= segment.start && line <= segment.end ? '>' : ' ';
    out.push(`${mark} ${String(line).padStart(width)} | ${lines[line - 1] ?? ''}`);
  }
  return out.join('\n');
}

/** An earlier question and answer about the same selection, for a follow-up's context. */
export interface ExplainTurn {
  readonly asked: string;
  readonly answer: string;
}

/** What a follow-up asks, in the words of the plan's step deepenings, said of the code. */
export function followUpWords(followUp: Pick<ExplainFollowUp, 'action' | 'question'>): string {
  return followUp.action === 'more'
    ? 'Tell me more about this code: the mechanism, how the code connects, and the details that matter. Do not repeat what was already explained.'
    : followUp.action === 'simpler'
      ? 'Explain this code more simply: more background, a clearer cause and effect, or a concrete example. Keep the class and method names.'
      : followUp.question;
}

const KIND_WORDS: Record<SelectedCodeKind, (side: LineSide) => string> = {
  removed: () => 'REMOVED: this code is only in From (base). It does not exist in To; it is behaviour the change takes away or replaces.',
  added: () => 'ADDED: this code is only in To (target). It did not exist in From; it is behaviour the change brings.',
  unchanged: (side) =>
    `UNCHANGED: the same in From and To, selected at ${side === 'base' ? 'From (base)' : 'To (target)'}. The change does not touch it, but may change how it is reached or what it works on.`,
};

/**
 * Ask for an explanation of code the person selected in the diff (DSP-152), or a follow-up
 * on one. The selection is given exactly, part by part, with its side and kind and the
 * lines around it; the agent reads further in the revision folder as the explanation needs.
 */
export function selectionPrompt(
  material: AnalysisMaterial,
  folder: AgentMaterial,
  selection: CodeSelection,
  around: readonly string[],
  thread: readonly ExplainTurn[],
  followUp: ExplainFollowUp | null,
  language: 'sv' | 'en',
): string {
  const commit = (side: LineSide): string => (side === 'base' ? `From (base, commit ${material.pair.base})` : `To (target, commit ${material.pair.target})`);
  return [
    `${TASK_HEADER} explain-selection`,
    '',
    'A person reviewing this change selected code in the diff and asks you to explain it. Examine the code with your reading tools as far as the explanation needs (what the selected code calls, what calls it, the data and types it uses, and how it differs between the revisions), then answer. Explaining approves nothing and is not a review.',
    '',
    '## The selected code',
    `${String(selection.segments.length)} part(s), in the order they appear in the diff. Each part is on one side of the diff; keep the sides apart.`,
    ...selection.segments.flatMap((segment, index) => [
      '',
      `### Part ${String(index + 1)}: ${segment.path} at ${commit(segment.side)}`,
      KIND_WORDS[segment.kind](segment.side),
      `Lines ${String(segment.start)}–${String(segment.end)}${segment.start === segment.end ? `, characters ${String(segment.from + 1)}–${String(segment.to)}` : ''} at that side.`,
      'Selected text, exactly:',
      '```',
      segment.text,
      '```',
      'The lines around it at that side (selected lines marked >):',
      '```',
      around[index] ?? '',
      '```',
    ]),
    '',
    '## The selection (machine-readable)',
    '```json',
    JSON.stringify(selection.segments.map((segment) => ({ path: segment.path, side: segment.side, start: segment.start, end: segment.end, kind: segment.kind }))),
    '```',
    ...(thread.length === 0
      ? []
      : [
          '',
          '## Earlier in this explanation',
          'The person has already read these answers about the same selection:',
          ...thread.flatMap((turn, index) => ['', `### ${String(index + 1)}. Asked: ${turn.asked}`, turn.answer]),
        ]),
    '',
    '## What the person asks now',
    followUp === null ? 'Explain the selected code.' : followUpWords(followUp),
    '',
    `## How to answer (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    followUp === null
      ? 'Start with what the selected code does and why it is relevant in this change. Then give the context needed to understand it, such as what it depends on and what depends on it, in short paragraphs.'
      : 'Answer what is asked now, for this selection, building on the earlier answers without repeating them.',
    'Keep the revisions apart: say which revision each statement is about. Never describe removed code as what the code does now, or added code as what it did before. When the selection holds both, say what was replaced by what.',
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    'If the code you could read does not settle it, say what is missing and set "insufficient": true.',
    '',
    'Answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        answer: 'The explanation in Markdown.',
        references: [{ label: 'What this place shows', path: 'src/file.ts', side: 'target', start: 10, end: 14 }],
        insufficient: false,
      },
      null,
      2,
    ),
    '```',
    'Every reference names a path, a side and 1-based lines at that side; DSpatch checks each against the commit.',
    '',
    folderSection(material, folder),
    '',
    changeSection(material),
  ].join('\n');
}

// --- Reading answers ----------------------------------------------------------------------

/** The JSON object of an answer: a ```json fence, or the whole text when it is one object. */
export function answerJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  const body = (fence?.[1] ?? text).trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    const first = body.indexOf('{');
    const last = body.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function rangeOf(raw: unknown): LineRange | null {
  if (!isObject(raw)) {
    return null;
  }
  const side = raw['side'];
  const start = raw['start'];
  const end = raw['end'] ?? raw['start'];
  if ((side !== 'base' && side !== 'target') || typeof raw['path'] !== 'string' || raw['path'] === '') {
    return null;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) {
    return null;
  }
  return { kind: 'lines', side, path: raw['path'], start: start as number, end: end as number };
}

/** A place in a proposed step. */
export interface ProposedPlace {
  readonly label: string;
  readonly range: LineRange;
  readonly anchor: string | null;
  readonly note: string;
}

export interface ProposedStep {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly why: string;
  readonly places: readonly ProposedPlace[];
}

export interface ProposedWalk {
  readonly title: string;
  readonly question: string;
  readonly purpose: string;
  readonly steps: readonly ProposedStep[];
}

export interface ProposedWalks {
  readonly overview: string;
  readonly walks: readonly ProposedWalk[];
}

/** The walks an answer proposes, with every structural problem named. */
export function readWalksAnswer(raw: unknown): { readonly walks: ProposedWalks | null; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (!isObject(raw)) {
    return { walks: null, problems: ['The answer was not one JSON object in a ```json fence.'] };
  }
  const walksRaw = Array.isArray(raw['walks']) ? raw['walks'] : [];
  if (walksRaw.length === 0) {
    problems.push('"walks" is missing or empty.');
  }
  const walks: ProposedWalk[] = [];
  walksRaw.forEach((walkRaw: unknown, walkIndex) => {
    const where = `walk ${String(walkIndex + 1)}`;
    if (!isObject(walkRaw)) {
      problems.push(`${where} is not an object.`);
      return;
    }
    const steps: ProposedStep[] = [];
    (Array.isArray(walkRaw['steps']) ? walkRaw['steps'] : []).forEach((stepRaw: unknown, stepIndex) => {
      const stepWhere = `${where}, step ${String(stepIndex + 1)}`;
      if (!isObject(stepRaw)) {
        problems.push(`${stepWhere} is not an object.`);
        return;
      }
      const places: ProposedPlace[] = [];
      (Array.isArray(stepRaw['places']) ? stepRaw['places'] : []).forEach((placeRaw: unknown, placeIndex) => {
        const range = rangeOf(placeRaw);
        if (range === null || !isObject(placeRaw)) {
          problems.push(`${stepWhere}, place ${String(placeIndex + 1)} does not name a path, a side and 1-based lines.`);
          return;
        }
        places.push({
          label: text(placeRaw['label']) || `${range.path}:${String(range.start)}`,
          range,
          anchor: text(placeRaw['anchor']) || null,
          note: text(placeRaw['note']),
        });
      });
      const title = text(stepRaw['title']);
      const body = text(stepRaw['body']);
      if (title === '' || body === '') {
        problems.push(`${stepWhere} has no title or no body.`);
      }
      if (places.length === 0) {
        problems.push(`${stepWhere} has no usable place.`);
      }
      steps.push({ title, summary: text(stepRaw['summary']), body, why: text(stepRaw['why']), places });
    });
    if (steps.length === 0) {
      problems.push(`${where} has no steps.`);
    }
    walks.push({ title: text(walkRaw['title']), question: text(walkRaw['question']), purpose: text(walkRaw['purpose']), steps });
  });
  return { walks: { overview: text(raw['overview']), walks }, problems };
}

/** Reads a file at one side, for checking references: its lines, or `null` when it does not exist there. */
export type LineReader = (side: LineSide, path: string) => Promise<readonly string[] | null>;

/** Why a place cannot be shown, or `null` when it can. */
export async function placeProblem(place: ProposedPlace, read: LineReader): Promise<string | null> {
  const lines = await read(place.range.side, place.range.path);
  const at = `${place.range.path} (${place.range.side === 'base' ? 'From' : 'To'}) lines ${String(place.range.start)}–${String(place.range.end)}`;
  if (lines === null) {
    return `${at}: the file does not exist at that commit.`;
  }
  if (place.range.end > lines.length) {
    return `${at}: the file has ${String(lines.length)} lines at that commit.`;
  }
  if (place.anchor !== null) {
    const shown = lines.slice(place.range.start - 1, place.range.end).join('\n');
    if (!shown.includes(place.anchor)) {
      return `${at}: the anchor "${place.anchor.slice(0, 60)}" does not occur on those lines.`;
    }
  }
  return null;
}

/** Every place problem of a proposal, keyed by walk/step/place, for the repair round. */
export async function walkPlaceProblems(walks: ProposedWalks, read: LineReader): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  for (const [walkIndex, walk] of walks.walks.entries()) {
    for (const [stepIndex, step] of walk.steps.entries()) {
      for (const [placeIndex, place] of step.places.entries()) {
        const problem = await placeProblem(place, read);
        if (problem !== null) {
          problems.set(`${String(walkIndex)}.${String(stepIndex)}.${String(placeIndex)}`, `walk ${String(walkIndex + 1)}, step ${String(stepIndex + 1)}, place ${String(placeIndex + 1)}: ${problem}`);
        }
      }
    }
  }
  return problems;
}

/** The proposal with every invalid place left out, and steps and walks left empty by it. */
export function withoutInvalidPlaces(walks: ProposedWalks, invalid: ReadonlyMap<string, string>): ProposedWalks {
  return {
    overview: walks.overview,
    walks: walks.walks
      .map((walk, walkIndex) => ({
        ...walk,
        steps: walk.steps
          .map((step, stepIndex) => ({
            ...step,
            places: step.places.filter((_, placeIndex) => !invalid.has(`${String(walkIndex)}.${String(stepIndex)}.${String(placeIndex)}`)),
          }))
          .filter((step) => step.places.length > 0 && step.title !== '' && step.body !== ''),
      }))
      .filter((walk) => walk.steps.length > 0),
  };
}

/** The changed lines no walk's places cover. Shared lines count once. */
export function uncoveredBy(walks: ProposedWalks, files: readonly PairFile[]): readonly LineRange[] {
  const covered = new Set<string>();
  for (const walk of walks.walks) {
    for (const step of walk.steps) {
      for (const place of step.places) {
        for (let line = place.range.start; line <= place.range.end; line += 1) {
          covered.add(lineKey({ side: place.range.side, path: place.range.path, line }));
        }
      }
    }
  }
  const missing: ChangedLine[] = files.flatMap((file) => changedLinesOf(file)).filter((line) => !covered.has(lineKey(line)));
  return rangesOf(missing);
}

const lang2 = (value: string): { sv: string; en: string } => ({ sv: value, en: value });

/**
 * The proposal as a review definition (`dspatch-review/2`), so the existing walk window
 * shows it. The text is in the review's language; it is stored under both keys because the
 * format asks for both and the window picks by language.
 */
export function definitionFrom(
  walks: ProposedWalks,
  pair: RevisionPairIdentity,
  heading: string,
  provenance: string,
): Record<string, unknown> {
  return {
    format: 'dspatch-review/2',
    title: lang2(heading),
    repository: pair.repository,
    base: pair.base,
    target: pair.target,
    teachingMode: 'Generated',
    provenance: lang2(provenance),
    overviewSummary: lang2(walks.overview),
    overview: lang2(walks.overview),
    walks: walks.walks.map((walk, walkIndex) => {
      const walkId = `W${String(walkIndex + 1)}`;
      return {
        id: walkId,
        title: lang2(walk.title || `Walk ${String(walkIndex + 1)}`),
        purpose: lang2(walk.purpose),
        question: lang2(walk.question || walk.title || `Walk ${String(walkIndex + 1)}`),
        steps: walk.steps.map((step, stepIndex) => ({
          id: `${walkId}.${String(stepIndex + 1)}`,
          title: lang2(step.title),
          summary: lang2(step.summary || step.title),
          body: lang2(step.body),
          ...(step.why === '' ? {} : { why: lang2(step.why) }),
          places: step.places.map((place, placeIndex) => ({
            id: `P${String(placeIndex + 1)}`,
            label: lang2(place.label),
            focus: {
              path: place.range.path,
              side: place.range.side,
              start: place.range.start,
              end: place.range.end,
              role: 'walk',
              ...(place.anchor === null ? {} : { anchor: place.anchor }),
              ...(place.note === '' ? {} : { note: lang2(place.note) }),
            },
          })),
        })),
      };
    }),
  };
}

// --- A delegated review ----------------------------------------------------------------------

function inside(range: LineRange, line: Pick<ChangedLine, 'side' | 'path' | 'line'>): boolean {
  return range.side === line.side && range.path === line.path && line.line >= range.start && line.line <= range.end;
}

/**
 * What a delegated review's answer establishes, checked against the scope and the changed
 * lines. Nothing outside the scope is approved, nothing not reviewed is approved, a line
 * with a problem is not approved, and an insufficient review approves nothing. Every
 * change DSpatch makes to the answer is named in `adjustments`.
 */
export function readReviewAnswer(raw: unknown, scope: DelegationScope, files: readonly PairFile[]): DelegationResult | { readonly error: string } {
  if (!isObject(raw)) {
    return { error: 'The agent did not answer with one JSON object, so nothing was recorded as reviewed.' };
  }
  const adjustments: string[] = [];
  const scopeLines = files
    .flatMap((file) => changedLinesOf(file))
    .filter((line) => scope.ranges.some((range) => inside(range, line)));
  const inScope = (ranges: readonly LineRange[], what: string): ChangedLine[] => {
    const lines = scopeLines.filter((line) => ranges.some((range) => inside(range, line)));
    const named = ranges.reduce((total, range) => total + (range.end - range.start + 1), 0);
    if (named > lines.length) {
      adjustments.push(`Some ${what} lines were outside the delegated scope or were not changed lines; they were left out.`);
    }
    return lines;
  };
  const read = (key: string): LineRange[] => (Array.isArray(raw[key]) ? raw[key] : []).map(rangeOf).filter((range): range is LineRange => range !== null);
  const reviewed = inScope(read('reviewed'), 'reviewed');
  const findings: AgentFinding[] = (Array.isArray(raw['findings']) ? raw['findings'] : []).filter(isObject).map((finding): AgentFinding => ({
    severity: finding['severity'] === 'problem' ? 'problem' : finding['severity'] === 'question' ? 'question' : 'note',
    text: text(finding['text']),
    location: rangeOf(finding),
  })).filter((finding) => finding.text !== '');
  const uncertainties = (Array.isArray(raw['uncertainties']) ? raw['uncertainties'] : []).map(text).filter((entry) => entry !== '');
  const assessment = text(raw['assessment']);
  let insufficient = raw['insufficient'] === true;
  if (!insufficient && reviewed.length === 0) {
    insufficient = true;
    adjustments.push('The answer named no reviewed lines inside the scope, so it is recorded as insufficient and approves nothing.');
  }
  if (!insufficient && assessment === '') {
    insufficient = true;
    adjustments.push('The answer gave no assessment, so it is recorded as insufficient and approves nothing.');
  }
  let approvedLines: ChangedLine[] = [];
  if (!insufficient) {
    const approved = inScope(read('approved'), 'approved');
    const reviewedKeys = new Set(reviewed.map(lineKey));
    const unreviewed = approved.filter((line) => !reviewedKeys.has(lineKey(line)));
    if (unreviewed.length > 0) {
      adjustments.push(`${String(unreviewed.length)} approved line(s) were not among the reviewed lines; they were not approved.`);
    }
    const problems = findings.filter((finding) => finding.severity === 'problem' && finding.location !== null);
    const withProblem = approved.filter((line) => problems.some((finding) => finding.location !== null && inside(finding.location, line)));
    if (withProblem.length > 0) {
      adjustments.push(`${String(withProblem.length)} line(s) with a reported problem were not approved.`);
    }
    approvedLines = approved.filter((line) => reviewedKeys.has(lineKey(line)) && !withProblem.includes(line));
  }
  return {
    assessment,
    reviewed: rangesOf(reviewed),
    approved: rangesOf(approvedLines),
    findings,
    uncertainties,
    insufficient,
    adjustments,
  };
}

// --- A step question -------------------------------------------------------------------------

/**
 * The answer to a step question, with every reference checked against its commit: one that
 * does not exist there is left out and named in `adjustments`, never shown as a link.
 */
export async function readStepAnswer(raw: unknown, read: LineReader): Promise<StepAnswer | { readonly error: string }> {
  if (!isObject(raw)) {
    return { error: 'The agent did not answer with one JSON object.' };
  }
  const answer = text(raw['answer']);
  const adjustments: string[] = [];
  const references: AnswerReference[] = [];
  for (const entry of Array.isArray(raw['references']) ? raw['references'] : []) {
    const range = rangeOf(entry);
    if (range === null || !isObject(entry)) {
      adjustments.push('A reference that did not name a path, a side and lines was left out.');
      continue;
    }
    const problem = await placeProblem({ label: '', range, anchor: null, note: '' }, read);
    if (problem !== null) {
      adjustments.push(`A reference was left out: ${problem}`);
      continue;
    }
    references.push({ label: text(entry['label']) || `${range.path}:${String(range.start)}`, range });
  }
  let insufficient = raw['insufficient'] === true;
  if (answer === '') {
    insufficient = true;
    adjustments.push('The answer had no text.');
  }
  return { answer, references, insufficient, adjustments };
}

/**
 * A delegated review's findings with their places checked against the commits: a finding
 * whose place does not exist keeps its text, loses the place, and is named in `adjustments`.
 */
export async function withCheckedFindings(result: DelegationResult, read: LineReader): Promise<DelegationResult> {
  const adjustments = [...result.adjustments];
  const findings: AgentFinding[] = [];
  for (const finding of result.findings) {
    if (finding.location === null) {
      findings.push(finding);
      continue;
    }
    const problem = await placeProblem({ label: '', range: finding.location, anchor: null, note: '' }, read);
    if (problem === null) {
      findings.push(finding);
    } else {
      findings.push({ ...finding, location: null });
      adjustments.push(`A finding's place was removed: ${problem}`);
    }
  }
  return { ...result, findings, adjustments };
}
