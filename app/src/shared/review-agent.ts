/**
 * What the agent is asked, and how its answer is read, when it prepares code walks or
 * reviews a delegated part of a revision pair (DSP-152).
 *
 * The requirements are Niclas's original plan, docs/plans/DSpatch-code-walks-plan-original.md.
 * Its writing rules (section 2) are the instruction the walks are written to, and its rule
 * that nothing here is an approval by itself (sections 1 and 5) is what the validation of
 * a delegated review enforces.
 *
 * Pure: the host builds the material from the two commits and runs the agent; this module
 * writes the prompt and checks the answer. Nothing here reads a working copy.
 */

import {
  changedLinesOf,
  lineKey,
  rangesOf,
  shownPath,
  type AgentFinding,
  type ChangedLine,
  type DelegationResult,
  type DelegationScope,
  type LineRange,
  type LineSide,
  type PairFile,
  type RevisionPairIdentity,
} from './review-pair';

/** The header every task prompt starts with, so a simulated agent can tell them apart. */
export const TASK_HEADER = 'DSPATCH-REVIEW-TASK:';

/** One changed file as the agent is given it: its diff facts and the text at both commits. */
export interface MaterialFile {
  readonly file: PairFile;
  /** The file at From, or `null` when it does not exist there or is not text. */
  readonly baseText: string | null;
  /** The file at To, or `null` when it does not exist there or is not text. */
  readonly targetText: string | null;
  /** Only the changed regions and their surroundings were included, to bound the size. */
  readonly excerpted: boolean;
}

/** Everything the agent is given about the pair. Built by the host, at the two commits only. */
export interface AnalysisMaterial {
  readonly pair: RevisionPairIdentity;
  readonly repositoryName: string;
  readonly baseSubject: string;
  readonly targetSubject: string;
  readonly files: readonly MaterialFile[];
  /** Files left out entirely because the material reached its size bound. */
  readonly omitted: readonly string[];
}

/** The size the material is held to; beyond it, files are excerpted, then left out. */
export const MATERIAL_CHAR_BUDGET = 180_000;

/** Lines of unchanged code kept around a change in an excerpted file. */
export const EXCERPT_CONTEXT = 25;

function numbered(text: string, keep: ((line: number) => boolean) | null): string {
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const out: string[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    const number = index + 1;
    if (keep !== null && !keep(number)) {
      skipped = true;
      return;
    }
    if (skipped) {
      out.push('     …');
      skipped = false;
    }
    out.push(`${String(number).padStart(5)} | ${line}`);
  });
  if (skipped) {
    out.push('     …');
  }
  return out.join('\n');
}

function nearChange(file: PairFile, side: LineSide): (line: number) => boolean {
  const spans = file.hunks.map((hunk) =>
    side === 'base'
      ? [hunk.baseStart - EXCERPT_CONTEXT, hunk.baseStart + hunk.baseCount + EXCERPT_CONTEXT]
      : [hunk.targetStart - EXCERPT_CONTEXT, hunk.targetStart + hunk.targetCount + EXCERPT_CONTEXT],
  );
  return (line) => spans.some(([from, to]) => line >= (from as number) && line <= (to as number));
}

/** The changed lines of every file, as ranges the agent must cover and may name. */
export function changedRangesOf(files: readonly PairFile[]): readonly LineRange[] {
  return rangesOf(files.flatMap((file) => changedLinesOf(file)));
}

function describeFile(entry: MaterialFile): string {
  const file = entry.file;
  const head =
    file.status === 'renamed' || file.status === 'copied'
      ? `${file.status} ${file.oldPath ?? ''} → ${file.newPath ?? ''}`
      : `${file.status} ${shownPath(file)}`;
  const parts = [`### ${head}${file.binary ? ' (binary, no text)' : ''}${entry.excerpted ? ' (excerpt around the changes)' : ''}`];
  if (entry.baseText !== null && file.oldPath !== null && file.status !== 'added') {
    parts.push(`From (${file.oldPath}):\n\`\`\`\n${numbered(entry.baseText, entry.excerpted ? nearChange(file, 'base') : null)}\n\`\`\``);
  }
  if (entry.targetText !== null && file.newPath !== null && file.status !== 'deleted') {
    parts.push(`To (${file.newPath}):\n\`\`\`\n${numbered(entry.targetText, entry.excerpted ? nearChange(file, 'target') : null)}\n\`\`\``);
  }
  return parts.join('\n\n');
}

function materialSection(material: AnalysisMaterial): string {
  const changed = changedRangesOf(material.files.map((entry) => entry.file)).map((range) => ({
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
    'Everything below is read from these two commits, never from a working copy. Line numbers are 1-based; "base" is From and "target" is To.',
    '',
    '## Changed lines (machine-readable)',
    '```json',
    JSON.stringify(changed),
    '```',
    '',
    '## Files',
    ...material.files.map(describeFile),
    ...(material.omitted.length === 0
      ? []
      : ['', `Left out for size, with no text supplied: ${material.omitted.join(', ')}. Say so if a walk would need them.`]),
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
  "Keep apart what the code is meant to do, your own conclusions, and test results that were actually observed. You have observed no test run here.",
  'No fixed length and no template of mandatory headings: be as short as understanding allows.',
] as const;

/** Ask for code walks over the pair. */
export function walksPrompt(material: AnalysisMaterial, language: 'sv' | 'en'): string {
  return [
    `${TASK_HEADER} prepare-walks`,
    '',
    'You prepare code walks that help a person understand and review a change. You cannot change code, run commands or read anything beyond what is supplied here.',
    '',
    '## What to produce',
    'Propose walks around behaviours or questions the change touches, for example "What happens when the user cancels?", not a file-by-file listing.',
    'Each walk has a short description of what the person will understand and why it is relevant, and steps with concrete code references, across files where the behaviour goes.',
    'Together the walks should cover every changed line, including error handling, tests, configuration and removed behaviour. A line no walk covers is shown to the person as not covered; do not invent coverage.',
    'A walk is not a review and approves nothing.',
    '',
    `## How to write (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    '',
    '## Answer format',
    'Answer with one JSON object in a ```json fence and nothing else:',
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
    'Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side. "anchor", when given, is text that occurs on those lines.',
    '',
    materialSection(material),
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
    'Answer again with the complete corrected JSON object in a ```json fence, in the same format. Keep every place that was right.',
  ].join('\n');
}

/** Ask for a review of a delegated part, under an explicit mandate for exactly that part. */
export function reviewPrompt(material: AnalysisMaterial, scope: DelegationScope, language: 'sv' | 'en'): string {
  return [
    `${TASK_HEADER} delegated-review`,
    '',
    'The person has delegated the review of one part of a change to you. You cannot change code, run commands or read anything beyond what is supplied here.',
    '',
    '## Your mandate',
    `Scope: ${scope.label}`,
    'You may approve changed lines inside the scope that you actually reviewed and judge to be correct. Nothing outside the scope, and nothing you did not review.',
    'Report what you reviewed, your assessment and what it rests on, every problem you found, and what remains uncertain.',
    'If the material is not enough to judge the scope, say so with "insufficient": true and approve nothing.',
    'Approval means the reviewed lines are acceptable as far as you can tell from this material; it is not a guarantee of correctness. Do not propose fixes as changes; describe problems.',
    '',
    '## The scope (machine-readable)',
    '```json',
    JSON.stringify(scope.ranges.map((range) => ({ path: range.path, side: range.side, start: range.start, end: range.end }))),
    '```',
    '',
    `## Answer format (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    'Answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        assessment: 'What you reviewed and your judgement, in a few sentences, with what it rests on.',
        reviewed: [{ path: 'src/file.ts', side: 'target', start: 10, end: 14 }],
        approved: [{ path: 'src/file.ts', side: 'target', start: 10, end: 12 }],
        findings: [{ severity: 'problem', text: 'What is wrong and why', path: 'src/file.ts', side: 'target', start: 13, end: 13 }],
        uncertainties: ['What you could not establish from the material'],
        insufficient: false,
      },
      null,
      2,
    ),
    '```',
    'severity is "problem", "question" or "note". A line with a problem is not approved.',
    '',
    materialSection(material),
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
