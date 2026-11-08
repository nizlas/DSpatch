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
  recommendationFrom,
  type AgentFinding,
  type AgentGap,
  type AgentMaterial,
  type AnswerReference,
  type ChangedLine,
  type ContextRange,
  type ContextReference,
  type CodeSelection,
  type ExplainFollowUp,
  type SelectedCodeKind,
  type SelectionSegment,
  type DelegationResult,
  type DelegationScope,
  type LineRange,
  type LineSide,
  type PairFile,
  type Recommendation,
  type RevisionPairIdentity,
  type StepAnswer,
  type StepQuestion,
} from './review-pair';

import { GROUNDING_RULES } from './presentation-profiles';
import { TASK_HEADER } from './review-task';

export { TASK_HEADER };

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
  /**
   * The workspace's other repositories, written beside the revisions as read-only context
   * (DSP-175). Absent or empty when there are none. Only described; nothing of them is sent.
   */
  readonly context?: readonly ContextMaterial[];
  /** Context repositories that could not be written, and why. */
  readonly contextUnavailable?: readonly { readonly name: string; readonly reason: string }[];
}

/**
 * Another repository of the workspace as the agent can read it (DSP-175): its folder name,
 * the commit written and how that commit was chosen, and whether the working copy differs.
 */
export interface ContextMaterial {
  readonly name: string;
  readonly commit: string;
  readonly how: 'submodule' | 'dependency' | 'path-dependency' | 'head';
  /** Whether the commit is established as what the reviewed build uses. */
  readonly established: boolean;
  readonly note: string;
  /** Counts only: the working copy's content is never read. */
  readonly workingCopy: { readonly head: string | null; readonly changed: number; readonly untracked: number };
  readonly files: number;
  readonly skippedCount: number;
}

/**
 * Reads a context repository's file at the commit recorded for it, for checking a context
 * reference: `null` for a repository that is not context here; `lines: null` when the file
 * does not exist there or is not text.
 */
export interface ContextReader {
  readonly names: ReadonlySet<string>;
  readonly read: (repository: string, path: string) => Promise<{ readonly commit: string; readonly lines: readonly string[] | null } | null>;
}

/** What the agent is told about the workspace's other repositories, or nothing when there are none. */
function contextSection(material: AnalysisMaterial): string[] {
  const context = material.context ?? [];
  const unavailable = material.contextUnavailable ?? [];
  if (context.length === 0 && unavailable.length === 0) {
    return [];
  }
  const short = (commit: string | null): string => (commit === null ? 'none' : commit.slice(0, 12));
  return [
    '',
    '## Other repositories of the workspace (read-only context)',
    'The person\'s workspace also holds the repositories below. They are not under review. Read them with the same tools under `context/<name>/` only when the question or the change needs code from them, for example a library function a changed line calls; nothing of them is in this prompt. Each was written from its repository\'s commits at the commit named; nothing comes from a working copy.',
    ...context.map((entry) => {
      const differs = entry.workingCopy.changed > 0 || entry.workingCopy.untracked > 0 || entry.workingCopy.head !== entry.commit;
      return (
        `- \`context/${entry.name}/\`: repository ${entry.name} at commit ${entry.commit}. ${entry.note}` +
        (differs
          ? ` Its working copy differs from this commit (checked out: ${short(entry.workingCopy.head)}; ${String(entry.workingCopy.changed)} changed and ${String(entry.workingCopy.untracked)} untracked file(s)); those are not here.`
          : '') +
        (entry.skippedCount > 0 ? ` ${String(entry.skippedCount)} of its files could not be written.` : '')
      );
    }),
    ...unavailable.map((entry) => `- ${entry.name} could not be given as context: ${entry.reason}`),
    'Where the version the reviewed build uses is not established, keep apart what this context code shows and what holds for the reviewed build, and say which you mean.',
    'To point at context code, name its repository instead of a side: {"label": "What this place shows", "repository": "<name>", "path": "src/file.ts", "start": 3, "end": 9}, with the path inside that repository and 1-based lines at the commit named. DSpatch checks it at that commit. Context is never reviewed, approved or covered: approved and reviewed lines and points worth checking stay in base/ and target/; an answer\'s references, a finding and a walk step\'s places may point at context code this way. A walk step that shows context code also keeps at least one place in base/ or target/: the changed or calling code the context explains.',
  ];
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
  lines.push(...contextSection(material));
  return lines.join('\n');
}

/**
 * What a review discussion that can read the code is told about the folder (Niclas's
 * decision of 30 October 2026): the analysis folder section and the changed files, without
 * the diff, which the question's own context already orients.
 */
export function discussionFolderSection(material: AnalysisMaterial, folder: AgentMaterial): string {
  return [
    folderSection(material, folder),
    '',
    '## Changed files',
    ...material.files.map((file) =>
      file.status === 'renamed' || file.status === 'copied'
        ? `- ${file.status} ${file.oldPath ?? ''} → ${file.newPath ?? ''}${file.binary ? ' (binary)' : ''}`
        : `- ${file.status} ${shownPath(file)}${file.binary ? ' (binary)' : ''}`,
    ),
  ].join('\n');
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
  'Emphasise sparingly with **bold**: only the central connection or consequence.',
  'Prefer plain words to advanced ones, but keep the real names of classes, methods, files and objects.',
  "Keep apart what the code is meant to do, your own conclusions, and test results that were actually observed. You have observed no test run here: you can read code, not run it.",
  'No fixed length and no template of mandatory headings: be as short as understanding allows.',
  'Do not narrate your investigation ("I read…", "Then I searched…"). Give the explanation, and point at the code it rests on.',
  // DSP-181: the grounding every explanation in the review has, the presentation profiles' included,
  // so an alternative presentation rests on prepared text that already names what matters.
  ...GROUNDING_RULES.slice(0, 4),
] as const;

/**
 * An answer's short part and its details (Niclas's decision of 30 October 2026): the
 * explanation is read first, and the details are shown under *Show more* from what was
 * written, without asking again.
 */
export const DETAILS_RULES = [
  '"answer" is the short part and stands on its own: the concept and the details that matter most, enough to understand it without reading further. Any uncertainty that changes the answer belongs there.',
  '"details" is the deepening only, for when the person asks for more: complementary mechanics, special cases, longer evidence, more code references, in the same manner as the short part. Leave it empty when there is nothing to add, and do not repeat the short part in it.',
  'When the person explicitly asks for details, give them: the short part still answers first.',
] as const;

/**
 * How the form follows the content (Niclas's trial feedback, 29 October 2026): a code walk
 * follows execution, a reading takes a coherent change of text in its context. The agent
 * chooses per part, and a commit may get both.
 */
export const FORM_RULES = [
  'Choose the form of each item from what changed. A change can get code walks, readings, or both.',
  'A **code walk** ("kind": "walk") follows a relevant execution path from a concrete entry point or event: a button press, a request, a call, a test. Go through calls, conditions and data roughly as the program runs. Include unchanged code where it is needed to understand the change. Show the relevant steps, not every call.',
  'At each hop of a code walk, say briefly how the step is connected to the one before (what calls it, what data it receives). When a place is reached from a call or reference you show elsewhere, give the call or reference as the `from` field of that place.',
  'A code walk describes code you read. You did not run it: never say a flow was executed, observed or verified unless a test result in the material shows it.',
  'A **reading** ("kind": "reading") is for documentation and other text where following execution means nothing. It takes one coherent change of text in its context: what changes, and what it means.',
  'One reading per coherent change, not one per paragraph or diff block. Independent changes of text are separate readings.',
  'A reading jumps to another place only when there is a real connection: a definition, a reference, or a contradiction.',
  'Never invent a direction or a call chain to fit the walk form, and do not add steps only to touch every changed line. Changed lines no item covers are shown to the person as not covered; that is better than an empty step.',
] as const;

/** Ask for code walks and readings over the pair. */
export function walksPrompt(material: AnalysisMaterial, folder: AgentMaterial, language: 'sv' | 'en'): string {
  return [
    `${TASK_HEADER} prepare-walks`,
    '',
    'You prepare code walks and readings that help a person understand and review a change. You examine the code yourself with your reading tools, then answer.',
    '',
    '## What to produce',
    'Items around behaviours, questions or coherent changes the change touches, for example "What happens when the user cancels?", not a file-by-file listing.',
    'Each item has a plain title and a purpose: one short sentence on what it helps the person understand. Its steps have concrete code references, across files where the behaviour goes.',
    'A step may point at unchanged code when it is needed to understand the change: the definition a changed line calls, a caller, the test that exercises it, the configuration that switches it on. Point at it where it is, at the side it is read from.',
    'Error handling, tests, configuration and removed behaviour may need items of their own.',
    'An item is not a review and approves nothing.',
    '',
    '## Code walks and readings',
    ...FORM_RULES.map((rule) => `- ${rule}`),
    '',
    '## About the change',
    '- "summary": two or three short sentences a person reads first: what the change does and why.',
    '- "background": only when there is more worth knowing (context, history, consequences), in short Markdown paragraphs. Leave it empty rather than repeating the summary.',
    '',
    `## How to write (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    '',
    '## Answer format',
    'When you have examined what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        summary: 'Two or three short sentences: what the change does and why.',
        background: 'Optional: more context, in short Markdown paragraphs. Empty when the summary says it.',
        walks: [
          {
            kind: 'walk',
            title: 'A behaviour or question',
            question: 'The question the item answers',
            purpose: 'One short sentence: what the person will understand.',
            steps: [
              {
                title: 'Short step title',
                summary: 'One or two sentences: what happens here.',
                body: 'The explanation in Markdown: what happens, why, what to notice in the code. Short paragraphs, bullets where they help.',
                why: 'Optional: the consequence, if it needs saying apart from the body.',
                places: [
                  {
                    label: 'What this place is',
                    path: 'src/file.ts',
                    side: 'target',
                    start: 10,
                    end: 14,
                    anchor: 'a short exact text from those lines',
                    from: { label: 'Optional: the call that leads here', path: 'src/caller.ts', side: 'target', start: 40, end: 40 },
                  },
                ],
              },
            ],
          },
          { kind: 'reading', title: 'A coherent change of text', question: 'What changes in it, and what it means', purpose: 'One short sentence.', steps: ['…'] },
        ],
      },
      null,
      2,
    ),
    '```',
    'Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side; so does "from" when given. "anchor", when given, is text that occurs on those lines. DSpatch checks every place against the commit.',
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

/**
 * What is worth checking, asked for on its own (Niclas's decision of 30 October 2026): the
 * walks come first and faster, and the person asks for these points when they want them,
 * perhaps after walking the change. The walks as written go along, so a point can name the
 * step that shows its context and leave out what a walk already explains.
 */
export const CHECK_RULES = [
  'Give the few things worth a reviewer\'s attention across the change as "checks", each an entry into the code. Leave the list empty when there are none; do not repeat what a walk already explains.',
  '"kind": "question" for something the reviewer should look into, "uncertainty" for something you could not settle from the code, "finding" for something the code you read shows.',
  '"title": a short question or statement understood at a glance, for example "Can restoring lock the track in piano mode?". No file names or line numbers in it.',
  '"detail": at most one short sentence more. Optional.',
  '"reasoning": why it is worth checking, in short Markdown paragraphs, naming the classes, functions and conditions involved. Keep apart what the code shows and what you could not establish.',
  '"places": where it is in the code, as references with a label. Every place must exist at its side.',
  '"step": the id of the walk step below (for example "W1.2") that shows exactly the context of this check. Leave it out when no step fits: DSpatch then gives the check its own tour through its places. Never link a step only because it is in the same file.',
  '"evidence": what the point rests on: the code you read, a test, a document. Keep apart what the code shows and what you could not establish.',
  '"recommendation": what to do about it, as for a review finding: "kind" is "change", "test", "measure", "ask-author", "investigate" or "keep" (keep the code as it is; say why in the rationale), with "action" in a sentence, a short "rationale", what remains "uncertainty", and a concrete "nextStep" when more needs to be established. Recommend a code change only when what you read shows one is needed; when the evidence is missing, recommend the test, measurement or investigation that would settle it. The person decides; accepting a recommendation starts nothing.',
] as const;

/** One walk step as the checks prompt shows it: its id, title, summary and places. */
export interface WalkStepOutline {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly places: readonly LineRange[];
}

/** Ask what is worth checking in a change whose walks have been written. */
export function checksPrompt(
  material: AnalysisMaterial,
  folder: AgentMaterial,
  walks: readonly { readonly id: string; readonly title: string; readonly steps: readonly WalkStepOutline[] }[],
  language: 'sv' | 'en',
): string {
  const where = (range: LineRange): string => `${range.path} ${range.side === 'base' ? 'From' : 'To'} ${String(range.start)}–${String(range.end)}`;
  return [
    `${TASK_HEADER} worth-checking`,
    '',
    'A person reviewing this change has its code walks and readings, listed below, and asks what is worth checking beyond them. You examine the code yourself with your reading tools, then answer. A point decides nothing: it is not a review and approves nothing.',
    '',
    '## The walks the person has',
    ...walks.flatMap((walk) => [
      `### ${walk.id}: ${walk.title}`,
      ...walk.steps.map((step) => `- ${step.id} ${step.title}${step.summary === '' ? '' : ` — ${step.summary}`} (${step.places.map(where).join('; ')})`),
    ]),
    '',
    '## Worth checking',
    ...CHECK_RULES.map((rule) => `- ${rule}`),
    '',
    `## How to write (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    '',
    '## Answer format',
    'When you have examined what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        checks: [
          {
            kind: 'question',
            title: 'Can restoring lock the track in piano mode?',
            detail: 'Optional: one short sentence.',
            reasoning: 'Why it is worth checking, in short Markdown paragraphs.',
            places: [{ label: 'What this place shows', path: 'src/file.ts', side: 'target', start: 20, end: 26 }],
            step: 'W1.2',
            evidence: 'What it rests on: the code read, a test, a document.',
            recommendation: { kind: 'investigate', action: 'The recommended action in a sentence', rationale: 'Why, briefly', uncertainty: 'What is still uncertain', nextStep: 'A concrete next step' },
          },
        ],
      },
      null,
      2,
    ),
    '```',
    'Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side; DSpatch checks every place against the commit.',
    '',
    folderSection(material, folder),
    '',
    changeSection(material),
  ].join('\n');
}

/** Ask for a review of a delegated part, under an explicit mandate for exactly that part. */
export function reviewPrompt(material: AnalysisMaterial, folder: AgentMaterial, scope: DelegationScope, language: 'sv' | 'en'): string {
  return [reviewInstruction(scope, language), '', folderSection(material, folder), '', changeSection(material)].join('\n');
}

/**
 * What DSpatch tells the agent about a delegated review: the mandate and the answer format.
 * Recorded with the job and readable in the result (DSP-158), so that an instruction added
 * here is never only in the code. The folder and change sections hold no instruction of the
 * review's own, and the opening diff is too large to keep with every job.
 */
export function reviewInstruction(scope: DelegationScope, language: 'sv' | 'en'): string {
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
    'Approval means the reviewed lines are acceptable as far as you can tell from the code you read; it is not a guarantee of correctness, and you have run nothing. Do not write fixes; describe problems.',
    'For every finding, question and gap, say what you observed and what it rests on (the code you read, a test, a document), and recommend what to do about it: a code change, a test, a measurement, a question to the author, further investigation, or keeping the code as it is with the reason. Recommend a code change only when what you read shows one is needed; when the evidence is missing, recommend the test, measurement or investigation that would settle it, with a concrete next step. Give a short rationale and what remains uncertain. The person decides; accepting your recommendation starts nothing.',
    'A gap is something you could not establish (not a defect). When it belongs to one of your findings, name that finding\'s title in "finding".',
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
        summary: 'One or two plain sentences: what you approved, and what remains or needs attention.',
        assessment: 'What you reviewed and your judgement, in a few sentences, with what it rests on.',
        reviewed: [{ path: 'src/file.ts', side: 'target', start: 10, end: 14 }],
        approved: [{ path: 'src/file.ts', side: 'target', start: 10, end: 12 }],
        findings: [
          {
            severity: 'problem',
            title: 'A short heading',
            text: 'What is wrong and what it leads to, in one or two sentences',
            details: 'Longer reasoning, only when it is needed',
            evidence: 'What the observation rests on: the code you read, a test, a document',
            recommendation: {
              kind: 'change',
              action: 'The recommended action in one sentence',
              rationale: 'Why, briefly',
              uncertainty: 'What is still uncertain, or an empty string',
              nextStep: 'A concrete next step when more investigation is needed, or an empty string',
            },
            path: 'src/file.ts',
            side: 'target',
            start: 13,
            end: 13,
          },
        ],
        gaps: [
          {
            text: 'What you could not establish from the code you read',
            evidence: 'What you looked at',
            finding: 'The title of the finding it belongs to, or omit',
            recommendation: { kind: 'test', action: 'How it could be established', rationale: 'Why', uncertainty: '', nextStep: 'The first concrete step' },
            path: 'src/file.ts',
            side: 'target',
            start: 20,
            end: 24,
          },
        ],
        insufficient: false,
      },
      null,
      2,
    ),
    '```',
    'severity is "problem", "question" or "note". recommendation.kind is "change", "test", "measure", "ask-author", "investigate" or "keep" (keep the code as it is; say why in the rationale). A gap\'s place is optional. A line with a problem is not approved. Do not narrate your investigation; give the judgement and what it rests on.',
    'The same problem in several places is one finding per place, each with the same title.',
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
    ...DETAILS_RULES.map((rule) => `- ${rule}`),
    'If the code you could read does not settle the question, say what is missing and set "insufficient": true.',
    '',
    'Answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        answer: 'The answer in Markdown.',
        details: 'More detail in Markdown, or an empty string.',
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
  // A file outside the change, reached through a reference: there every line is unchanged.
  const outside = raw['fileKey'].startsWith('outside:') ? raw['fileKey'].slice('outside:'.length) : null;
  const file: PairFile | undefined =
    outside !== null && outside !== '' && !files.some((entry) => entry.oldPath === outside || entry.newPath === outside)
      ? { key: raw['fileKey'], status: 'modified', oldPath: outside, newPath: outside, similarity: null, binary: false, hunks: [], added: 0, deleted: 0 }
      : files.find((entry) => entry.key === raw['fileKey']);
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
export function followUpWords(followUp: Pick<ExplainFollowUp, 'action' | 'question'>, answered?: string): string {
  if (followUp.action === 'simpler' && answered !== undefined) {
    return `Explain your last answer more simply (it answered: "${answered}"): fewer concepts at once and plainer words, with the same names and caveats. Add no detail it did not need and do not make it longer; take another way in, such as one concrete case or the effect seen from the caller.`;
  }
  return followUp.action === 'more'
    ? 'Tell me more about this code: the mechanism, how the code connects, and the details that matter. Do not repeat what was already explained.'
    : followUp.action === 'simpler'
      ? 'Explain this code more simply: fewer concepts at once and plainer words, with the same names and caveats. Add no detail that is not needed; take a concrete way in, such as one case or the effect seen from the caller.'
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
  /** For explaining one answer more simply: the question that answer answered. */
  answered?: string,
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
    followUp === null ? 'Explain the selected code.' : followUpWords(followUp, answered),
    '',
    `## How to answer (language: ${language === 'sv' ? 'Swedish' : 'English'})`,
    followUp === null
      ? 'Start with what the selected code does and why it is relevant in this change. Then give the context needed to understand it, such as what it depends on and what depends on it, in short paragraphs.'
      : 'Answer what is asked now, for this selection, building on the earlier answers without repeating them.',
    'Keep the revisions apart: say which revision each statement is about. Never describe removed code as what the code does now, or added code as what it did before. When the selection holds both, say what was replaced by what.',
    ...WRITING_RULES.map((rule) => `- ${rule}`),
    ...DETAILS_RULES.map((rule) => `- ${rule}`),
    'If the code you could read does not settle it, say what is missing and set "insufficient": true.',
    '',
    'Answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(
      {
        answer: 'The explanation in Markdown.',
        details: 'More detail in Markdown, or an empty string.',
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
  // A place that names a repository is context (DSP-175): never a place in the reviewed revisions.
  if (!isObject(raw) || isContextEntry(raw)) {
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
  /** Where a code walk reaches this place from: the call or reference that leads here. */
  readonly from?: { readonly label: string; readonly range: LineRange };
}

/**
 * A place in another repository of the workspace, read as context (DSP-175). Its commit is
 * the one the analysis recorded for that repository, filled in by {@link withContextCommits}
 * once {@link walkPlaceProblems} found it there; until then it is what the agent named, or
 * empty. Never a place in the reviewed revisions: never covered, marked or approved.
 */
export interface ProposedContextPlace {
  readonly label: string;
  readonly range: ContextRange;
  readonly anchor: string | null;
  readonly note: string;
}

export interface ProposedStep {
  readonly title: string;
  readonly summary: string;
  readonly body: string;
  readonly why: string;
  readonly places: readonly ProposedPlace[];
  /** DSP-175: places in context repositories, apart from `places`. Absent when there are none. */
  readonly contextPlaces?: readonly ProposedContextPlace[];
}

export interface ProposedWalk {
  /** A code walk follows execution; a reading takes a coherent change of text. */
  readonly kind: 'walk' | 'reading';
  readonly title: string;
  readonly question: string;
  readonly purpose: string;
  readonly steps: readonly ProposedStep[];
}

/** A point worth checking, as proposed: its step by index into the proposal, if any. */
export interface ProposedCheck {
  readonly kind: 'question' | 'uncertainty' | 'finding';
  readonly title: string;
  readonly detail: string;
  readonly reasoning: string;
  readonly places: readonly { readonly label: string; readonly range: LineRange }[];
  readonly step: { readonly walk: number; readonly step: number } | null;
  /** What it rests on (DSP-175); `''` when the agent said nothing. */
  readonly evidence?: string;
  /** What the agent recommends (DSP-175); absent when it gave none: none is made up. */
  readonly recommendation?: Recommendation;
}

export interface ProposedWalks {
  /** What the person reads first about the change. */
  readonly overview: string;
  /** More context, shown on request; empty when there is none beyond the summary. */
  readonly background: string;
  /** Contradictions, open questions and risks as plain sentences: an answer in the older form only. */
  readonly attention: readonly string[];
  /** Points worth checking with their places and steps (30 October 2026). */
  readonly checks: readonly ProposedCheck[];
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
      const contextPlaces: ProposedContextPlace[] = [];
      (Array.isArray(stepRaw['places']) ? stepRaw['places'] : []).forEach((placeRaw: unknown, placeIndex) => {
        // DSP-175: a place that names a repository is context, kept apart from the reviewed places.
        if (isObject(placeRaw) && isContextEntry(placeRaw)) {
          const pending = pendingContextPlace(placeRaw);
          if (pending === null) {
            problems.push(`${stepWhere}, place ${String(placeIndex + 1)} names a repository but not a path inside it and 1-based lines.`);
          } else {
            contextPlaces.push(pending);
          }
          return;
        }
        const range = rangeOf(placeRaw);
        if (range === null || !isObject(placeRaw)) {
          problems.push(`${stepWhere}, place ${String(placeIndex + 1)} does not name a path, a side and 1-based lines.`);
          return;
        }
        const fromRaw = placeRaw['from'];
        const fromRange = isObject(fromRaw) ? rangeOf(fromRaw) : null;
        if (isObject(fromRaw) && fromRange === null) {
          problems.push(`${stepWhere}, place ${String(placeIndex + 1)}: "from" does not name a path, a side and 1-based lines.`);
        }
        places.push({
          label: text(placeRaw['label']) || `${range.path}:${String(range.start)}`,
          range,
          anchor: text(placeRaw['anchor']) || null,
          note: text(placeRaw['note']),
          ...(fromRange === null || !isObject(fromRaw) ? {} : { from: { label: text(fromRaw['label']) || `${fromRange.path}:${String(fromRange.start)}`, range: fromRange } }),
        });
      });
      const title = text(stepRaw['title']);
      const body = text(stepRaw['body']);
      if (title === '' || body === '') {
        problems.push(`${stepWhere} has no title or no body.`);
      }
      if (places.length === 0) {
        problems.push(
          contextPlaces.length === 0
            ? `${stepWhere} has no usable place.`
            : `${stepWhere} has only places in context repositories; a step also needs a place in base/ or target/.`,
        );
      }
      steps.push({ title, summary: text(stepRaw['summary']), body, why: text(stepRaw['why']), places, ...(contextPlaces.length === 0 ? {} : { contextPlaces }) });
    });
    if (steps.length === 0) {
      problems.push(`${where} has no steps.`);
    }
    walks.push({
      kind: walkRaw['kind'] === 'reading' ? 'reading' : 'walk',
      title: text(walkRaw['title']),
      question: text(walkRaw['question']),
      purpose: text(walkRaw['purpose']),
      steps,
    });
  });
  // `summary` since the trial feedback of 29 October 2026; `overview` before it.
  const attentionRaw = raw['attention'];
  const attention = (Array.isArray(attentionRaw) ? attentionRaw : typeof attentionRaw === 'string' ? [attentionRaw] : [])
    .map((entry: unknown) => text(entry).replace(/^\s*[-*]\s+/, ''))
    .filter((entry) => entry !== '');
  // Checks in an answer of the older form, written with the walks, by index into them.
  const checks: ProposedCheck[] = checksOf(raw['checks'], problems).map(({ stepRaw, ...check }) => {
    const step =
      isObject(stepRaw) && Number.isInteger(stepRaw['walk']) && Number.isInteger(stepRaw['step'])
        ? { walk: stepRaw['walk'] as number, step: stepRaw['step'] as number }
        : null;
    // An index outside the proposal links nothing; it is not guessed at.
    return { ...check, step: step !== null && walks[step.walk]?.steps[step.step] !== undefined ? step : null };
  });
  return {
    walks: { overview: text(raw['summary']) || text(raw['overview']), background: text(raw['background']), attention, checks, walks },
    problems,
  };
}

/** The points of an answer as proposed, each with what it said about its step, unread. */
function checksOf(checksRaw: unknown, problems: string[]): (Omit<ProposedCheck, 'step'> & { readonly stepRaw: unknown })[] {
  const checks: (Omit<ProposedCheck, 'step'> & { readonly stepRaw: unknown })[] = [];
  for (const [checkIndex, checkRaw] of (Array.isArray(checksRaw) ? checksRaw : []).entries()) {
    const where = `check ${String(checkIndex + 1)}`;
    if (!isObject(checkRaw) || text(checkRaw['title']) === '') {
      problems.push(`${where} has no title.`);
      continue;
    }
    const kind = checkRaw['kind'];
    const places: { label: string; range: LineRange }[] = [];
    for (const placeRaw of Array.isArray(checkRaw['places']) ? checkRaw['places'] : []) {
      const range = rangeOf(placeRaw);
      if (range === null || !isObject(placeRaw)) {
        problems.push(`${where} has a place without a path, a side and lines.`);
        continue;
      }
      places.push({ label: text(placeRaw['label']) || `${range.path}:${String(range.start)}`, range });
    }
    const recommendation = recommendationFrom(checkRaw['recommendation']);
    const evidence = text(checkRaw['evidence']);
    checks.push({
      kind: kind === 'uncertainty' || kind === 'finding' ? kind : 'question',
      title: text(checkRaw['title']),
      detail: text(checkRaw['detail']),
      reasoning: text(checkRaw['reasoning']),
      places,
      stepRaw: checkRaw['step'],
      ...(evidence === '' ? {} : { evidence }),
      ...(recommendation === null ? {} : { recommendation }),
    });
  }
  return checks;
}

/** A point asked for on its own: its step is a step id of the walks, or none. */
export type ProposedStandaloneCheck = Omit<ProposedCheck, 'step'> & { readonly stepId: string | null };

/**
 * The points an answer to {@link checksPrompt} proposes. A step id that is not one of the
 * walks' links nothing: the point gets its own tour instead, and nothing is guessed.
 */
export function readChecksAnswer(raw: unknown, stepIds: ReadonlySet<string>): { readonly checks: readonly ProposedStandaloneCheck[] | null; readonly problems: readonly string[] } {
  if (!isObject(raw) || !Array.isArray(raw['checks'])) {
    return { checks: null, problems: ['The answer was not one JSON object with "checks" in a ```json fence.'] };
  }
  const problems: string[] = [];
  const checks = checksOf(raw['checks'], problems).map(({ stepRaw, ...check }) => {
    const stepId = typeof stepRaw === 'string' && stepIds.has(stepRaw.trim()) ? stepRaw.trim() : null;
    return { ...check, stepId };
  });
  return { checks, problems };
}

/** The places of points asked for on their own, checked against the commits like any other. */
export async function withCheckedStandaloneChecks(
  checks: readonly ProposedStandaloneCheck[],
  read: LineReader,
): Promise<{ readonly checks: readonly ProposedStandaloneCheck[]; readonly left: number }> {
  const checked = await withCheckedChecks({ overview: '', background: '', attention: [], walks: [], checks: checks.map((check) => ({ ...check, step: null })) }, read);
  return { checks: checked.walks.checks.map((check, index) => ({ ...check, stepId: checks[index]?.stepId ?? null })), left: checked.left };
}

/**
 * The checks with every place that does not exist at its commit left out, and how many
 * were. A check keeps its text without places; no place is made up for it.
 */
export async function withCheckedChecks(walks: ProposedWalks, read: LineReader): Promise<{ readonly walks: ProposedWalks; readonly left: number }> {
  let left = 0;
  const checks: ProposedCheck[] = [];
  for (const check of walks.checks) {
    const places: { label: string; range: LineRange }[] = [];
    for (const place of check.places) {
      if ((await placeProblem({ label: place.label, range: place.range, anchor: null, note: '' }, read)) === null) {
        places.push(place);
      } else {
        left += 1;
      }
    }
    checks.push({ ...check, places });
  }
  return { walks: { ...walks, checks }, left };
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
export async function walkPlaceProblems(walks: ProposedWalks, read: LineReader, context: ContextReader | null = null): Promise<Map<string, string>> {
  const problems = new Map<string, string>();
  for (const [walkIndex, walk] of walks.walks.entries()) {
    for (const [stepIndex, step] of walk.steps.entries()) {
      // DSP-175: context places, checked at the commit the analysis recorded; keyed apart (`.c<n>`).
      for (const [placeIndex, place] of (step.contextPlaces ?? []).entries()) {
        const problem = await contextPlaceProblem(place, context);
        if (problem !== null) {
          problems.set(
            `${String(walkIndex)}.${String(stepIndex)}.c${String(placeIndex)}`,
            `walk ${String(walkIndex + 1)}, step ${String(stepIndex + 1)}, context place ${String(placeIndex + 1)}: ${problem}`,
          );
        }
      }
      for (const [placeIndex, place] of step.places.entries()) {
        const problem =
          (await placeProblem(place, read)) ??
          (place.from === undefined ? null : await placeProblem({ label: place.from.label, range: place.from.range, anchor: null, note: '' }, read).then((found) => (found === null ? null : `"from" ${found}`)));
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
  // Where each kept step ends up, so a check's link follows its step, or is dropped with it.
  const moved = new Map<string, { walk: number; step: number }>();
  const kept: ProposedWalk[] = [];
  walks.walks.forEach((walk, walkIndex) => {
    const steps: ProposedStep[] = [];
    walk.steps.forEach((step, stepIndex) => {
      const places = step.places.filter((_, placeIndex) => !invalid.has(`${String(walkIndex)}.${String(stepIndex)}.${String(placeIndex)}`));
      const contextPlaces = (step.contextPlaces ?? []).filter((_, placeIndex) => !invalid.has(`${String(walkIndex)}.${String(stepIndex)}.c${String(placeIndex)}`));
      // A step stands on its places in the reviewed revisions; context only accompanies them.
      if (places.length > 0 && step.title !== '' && step.body !== '') {
        moved.set(`${String(walkIndex)}.${String(stepIndex)}`, { walk: kept.length, step: steps.length });
        const { contextPlaces: _left, ...rest } = step;
        steps.push({ ...rest, places, ...(contextPlaces.length === 0 ? {} : { contextPlaces }) });
      }
    });
    if (steps.length > 0) {
      kept.push({ ...walk, steps });
    }
  });
  return {
    ...walks,
    walks: kept,
    checks: walks.checks.map((check) => ({ ...check, step: check.step === null ? null : (moved.get(`${String(check.step.walk)}.${String(check.step.step)}`) ?? null) })),
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

/** One point worth checking as the definition format (`dspatch-review/2`) has it. */
export function checkDefinition(check: ProposedStandaloneCheck, id: string): Record<string, unknown> {
  const places = check.places.map((place) => ({ path: place.range.path, side: place.range.side, start: place.range.start, end: place.range.end, role: 'context', note: lang2(place.label) }));
  return {
    id,
    kind: check.kind,
    title: lang2(check.title),
    ...(check.detail === '' ? {} : { detail: lang2(check.detail) }),
    ...(check.reasoning === '' ? {} : { reasoning: lang2(check.reasoning) }),
    ...(check.stepId === null ? {} : { stepId: check.stepId }),
    // DSP-175: kept as the agent wrote them; the thread reads them, the walk format ignores them.
    ...(check.evidence === undefined || check.evidence === '' ? {} : { evidence: lang2(check.evidence) }),
    ...(check.recommendation === undefined ? {} : { recommendation: { ...check.recommendation } }),
    places,
    // No step fits and there is code to show: a tour of its own, one place after another.
    ...(check.stepId !== null || check.places.length === 0
      ? {}
      : {
          tour: {
            steps: [
              {
                id: `${id}.1`,
                title: lang2(check.title),
                summary: lang2(check.detail || check.title),
                body: lang2(check.reasoning || check.title),
                places: check.places.map((place, placeIndex) => ({
                  id: `P${String(placeIndex + 1)}`,
                  label: lang2(place.label),
                  focus: { path: place.range.path, side: place.range.side, start: place.range.start, end: place.range.end, role: 'context' },
                })),
              },
            ],
          },
        }),
  };
}

export { CHECKS_FILE_FORMAT, checksFileOf } from './review-model';

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
    // The summary first; the background only on request, so Show more appears only when
    // there is more (in Niclas's trial both fields held the same text).
    overviewSummary: lang2(walks.overview),
    overview: lang2(walks.background === '' ? walks.overview : `${walks.overview}\n\n${walks.background}`),
    // The titles as text too, for anything that reads only `attention`; the checks carry the links.
    ...(walks.attention.length === 0 && walks.checks.length === 0
      ? {}
      : { attention: lang2([...walks.attention, ...walks.checks.map((check) => check.title)].map((entry) => `- ${entry}`).join('\n')) }),
    checks: walks.checks.map((check, checkIndex) => {
      const linked = check.step === null ? undefined : walks.walks[check.step.walk];
      const ordinal = linked === undefined || check.step === null ? 0 : walks.walks.slice(0, check.step.walk + 1).filter((other) => other.kind === linked.kind).length;
      const stepId = linked === undefined || check.step === null ? null : `${linked.kind === 'reading' ? 'R' : 'W'}${String(ordinal)}.${String(check.step.step + 1)}`;
      return checkDefinition({ ...check, stepId }, `C${String(checkIndex + 1)}`);
    }),
    walks: walks.walks.map((walk, walkIndex) => {
      // Walks and readings are numbered apart: W1, W2 … and R1, R2 … are identifiers.
      const ordinal = walks.walks.slice(0, walkIndex + 1).filter((other) => other.kind === walk.kind).length;
      const walkId = `${walk.kind === 'reading' ? 'R' : 'W'}${String(ordinal)}`;
      const fallback = `${walk.kind === 'reading' ? 'Reading' : 'Walk'} ${String(ordinal)}`;
      return {
        id: walkId,
        kind: walk.kind,
        title: lang2(walk.title || fallback),
        purpose: lang2(walk.purpose),
        question: lang2(walk.question || walk.title || fallback),
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
            ...(place.from === undefined
              ? {}
              : {
                  from: {
                    label: lang2(place.from.label),
                    path: place.from.range.path,
                    side: place.from.range.side,
                    start: place.from.range.start,
                    end: place.from.range.end,
                  },
                }),
          })),
          // DSP-175: apart from `places`, so nothing that reads places counts them as covered.
          ...((step.contextPlaces ?? []).length === 0
            ? {}
            : {
                contextPlaces: (step.contextPlaces ?? []).map((place, placeIndex) => ({
                  id: `K${String(placeIndex + 1)}`,
                  label: lang2(place.label),
                  focus: {
                    kind: 'context',
                    repository: place.range.repository,
                    commit: place.range.commit,
                    path: place.range.path,
                    start: place.range.start,
                    end: place.range.end,
                    role: 'context',
                    ...(place.anchor === null ? {} : { anchor: place.anchor }),
                    ...(place.note === '' ? {} : { note: lang2(place.note) }),
                  },
                })),
              }),
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
    text: text(finding['text']) || text(finding['title']),
    location: rangeOf(finding),
    ...pendingContextLocation(finding),
    ...(text(finding['title']) === '' ? {} : { title: text(finding['title']) }),
    ...(text(finding['details']) === '' ? {} : { details: text(finding['details']) }),
    ...(text(finding['evidence']) === '' ? {} : { evidence: text(finding['evidence']) }),
    ...((): Partial<AgentFinding> => {
      const recommendation = recommendationFrom(finding['recommendation']);
      return recommendation === null ? {} : { recommendation };
    })(),
  })).filter((finding) => finding.text !== '');
  // DSP-175: gaps with what they rest on and a recommendation. An answer of the older form,
  // with plain `uncertainties`, is read as before and its sentences are the gaps.
  const gaps: AgentGap[] = (Array.isArray(raw['gaps']) ? raw['gaps'] : []).filter(isObject).flatMap((gap): AgentGap[] => {
    const said = text(gap['text']);
    if (said === '') {
      return [];
    }
    const recommendation = recommendationFrom(gap['recommendation']);
    return [
      {
        text: said,
        location: rangeOf(gap),
        ...(text(gap['evidence']) === '' ? {} : { evidence: text(gap['evidence']) }),
        ...(text(gap['finding']) === '' ? {} : { finding: text(gap['finding']) }),
        ...(recommendation === null ? {} : { recommendation }),
      },
    ];
  });
  const uncertainties = [
    ...(Array.isArray(raw['uncertainties']) ? raw['uncertainties'] : []).map(text).filter((entry) => entry !== ''),
    ...gaps.map((gap) => gap.text),
  ];
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
  const summary = text(raw['summary']);
  return {
    assessment,
    ...(summary === '' ? {} : { summary }),
    reviewed: rangesOf(reviewed),
    approved: rangesOf(approvedLines),
    findings,
    uncertainties,
    ...(gaps.length > 0 || Array.isArray(raw['gaps']) ? { gaps: [...gaps, ...uncertainties.filter((entry) => !gaps.some((gap) => gap.text === entry)).map((entry) => ({ text: entry, location: null }))] } : {}),
    insufficient,
    adjustments,
  };
}

// --- A step question -------------------------------------------------------------------------

/**
 * The answer to a step question, with every reference checked against its commit: one that
 * does not exist there is left out and named in `adjustments`, never shown as a link.
 */
export async function readStepAnswer(raw: unknown, read: LineReader, context: ContextReader | null = null): Promise<StepAnswer | { readonly error: string }> {
  if (!isObject(raw)) {
    return { error: 'The agent did not answer with one JSON object.' };
  }
  const answer = text(raw['answer']);
  const adjustments: string[] = [];
  const references: AnswerReference[] = [];
  const contextReferences: ContextReference[] = [];
  for (const entry of Array.isArray(raw['references']) ? raw['references'] : []) {
    if (isObject(entry) && isContextEntry(entry)) {
      const checked = await checkedContextRange(entry, context);
      if ('problem' in checked) {
        adjustments.push(`A context reference was left out: ${checked.problem}`);
      } else {
        contextReferences.push({ label: text(entry['label']) || `${checked.repository}/${checked.path}:${String(checked.start)}`, range: checked });
      }
      continue;
    }
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
  const details = text(raw['details']);
  return { answer, ...(details === '' ? {} : { details }), references, ...(contextReferences.length === 0 ? {} : { contextReferences }), insufficient, adjustments };
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
      // DSP-175: the named place is kept as missing, so the thread can say where it was said
      // to be; it is never marked in the code.
      findings.push({ ...finding, location: null, missing: { range: finding.location, reason: problem } });
      adjustments.push(`A finding's place was removed: ${problem}`);
    }
  }
  if (result.gaps === undefined) {
    return { ...result, findings, adjustments };
  }
  const gaps: AgentGap[] = [];
  for (const gap of result.gaps) {
    const problem = gap.location === null ? null : await placeProblem({ label: '', range: gap.location, anchor: null, note: '' }, read);
    if (problem === null) {
      gaps.push(gap);
    } else {
      gaps.push({ ...gap, location: null });
      adjustments.push(`A gap's place was removed: ${problem}`);
    }
  }
  return { ...result, findings, gaps, adjustments };
}

// --- Context from the workspace's other repositories (DSP-175) ------------------------------

/** An entry that names a repository: a place in context, never in the reviewed revisions. */
function isContextEntry(raw: Record<string, unknown>): boolean {
  return typeof raw['repository'] === 'string' && raw['repository'].trim() !== '';
}

/**
 * A context place as the agent wrote it, checked at the commit recorded for its repository:
 * the place with that commit, or why it was left out.
 */
async function checkedContextRange(raw: Record<string, unknown>, context: ContextReader | null): Promise<ContextRange | { readonly problem: string }> {
  const repository = text(raw['repository']);
  const filePath = typeof raw['path'] === 'string' ? raw['path'] : '';
  const start = raw['start'];
  const end = raw['end'] ?? raw['start'];
  if (filePath === '' || !Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) {
    return { problem: `a place in ${repository} did not name a path and lines.` };
  }
  const at = `${repository}: ${filePath} lines ${String(start)}–${String(end)}`;
  const found = context === null ? null : await context.read(repository, filePath);
  if (found === null) {
    return { problem: `${at}: ${repository} is not a context repository of this review.` };
  }
  if (found.lines === null) {
    return { problem: `${at}: the file does not exist at ${found.commit.slice(0, 7)}.` };
  }
  if ((end as number) > found.lines.length) {
    return { problem: `${at}: the file has ${String(found.lines.length)} lines at ${found.commit.slice(0, 7)}.` };
  }
  return { kind: 'context', repository, commit: found.commit, path: filePath, start: start as number, end: end as number };
}

/** A walk's context place as the agent wrote it, before it is checked; `null` when it names no path and lines. */
function pendingContextPlace(raw: Record<string, unknown>): ProposedContextPlace | null {
  const repository = text(raw['repository']);
  const filePath = typeof raw['path'] === 'string' ? raw['path'] : '';
  const start = raw['start'];
  const end = raw['end'] ?? raw['start'];
  if (filePath === '' || !Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 1 || (end as number) < (start as number)) {
    return null;
  }
  return {
    label: text(raw['label']) || `${repository}/${filePath}:${String(start)}`,
    // A commit the agent named is kept only to be compared with the recorded one.
    range: { kind: 'context', repository, commit: text(raw['commit']), path: filePath, start: start as number, end: end as number },
    anchor: text(raw['anchor']) || null,
    note: text(raw['note']),
  };
}

/**
 * Why a walk's context place cannot be shown (DSP-175), or `null` when it can: its repository
 * must be context of this analysis, the file and lines must exist at the commit recorded for
 * it, a commit the agent named must be that commit, and an anchor must occur on the lines.
 */
async function contextPlaceProblem(place: ProposedContextPlace, context: ContextReader | null): Promise<string | null> {
  const checked = await checkedContextRange({ ...place.range }, context);
  if ('problem' in checked) {
    return checked.problem;
  }
  const at = `${place.range.repository}: ${place.range.path} lines ${String(place.range.start)}–${String(place.range.end)}`;
  const asked = place.range.commit.toLowerCase();
  if (asked !== '' && !(asked.length >= 7 && checked.commit.startsWith(asked))) {
    return `${at}: it names commit ${asked.slice(0, 12)}, but this review read ${place.range.repository} at ${checked.commit.slice(0, 12)}; only that commit is shown.`;
  }
  if (place.anchor !== null) {
    const found = await context?.read(place.range.repository, place.range.path);
    const shown = (found?.lines ?? []).slice(place.range.start - 1, place.range.end).join('\n');
    if (!shown.includes(place.anchor)) {
      return `${at}: the anchor "${place.anchor.slice(0, 60)}" does not occur on those lines.`;
    }
  }
  return null;
}

/**
 * The proposal with every context place given the commit the analysis recorded for its
 * repository (DSP-175). Run after {@link withoutInvalidPlaces}, so every place left exists
 * there; one whose repository is somehow not context any more is left out.
 */
export async function withContextCommits(walks: ProposedWalks, context: ContextReader | null): Promise<ProposedWalks> {
  const out: ProposedWalk[] = [];
  for (const walk of walks.walks) {
    const steps: ProposedStep[] = [];
    for (const step of walk.steps) {
      if (step.contextPlaces === undefined) {
        steps.push(step);
        continue;
      }
      const contextPlaces: ProposedContextPlace[] = [];
      for (const place of step.contextPlaces) {
        const checked = await checkedContextRange({ ...place.range }, context);
        if (!('problem' in checked)) {
          contextPlaces.push({ ...place, range: checked });
        }
      }
      const { contextPlaces: _before, ...rest } = step;
      steps.push({ ...rest, ...(contextPlaces.length === 0 ? {} : { contextPlaces }) });
    }
    out.push({ ...walk, steps });
  }
  return { ...walks, walks: out };
}

/**
 * A finding's context place as the agent wrote it, before it is checked: its commit is
 * empty until {@link withCheckedContext} fills it in or leaves the place out.
 */
function pendingContextLocation(raw: Record<string, unknown>): { readonly contextLocation?: ContextRange } {
  if (!isContextEntry(raw)) {
    return {};
  }
  const start = raw['start'];
  const end = raw['end'] ?? raw['start'];
  return {
    contextLocation: {
      kind: 'context',
      repository: text(raw['repository']),
      commit: '',
      path: typeof raw['path'] === 'string' ? raw['path'] : '',
      start: Number.isInteger(start) ? (start as number) : 0,
      end: Number.isInteger(end) ? (end as number) : 0,
    },
  };
}

/**
 * A delegated review's context places checked at their recorded commits (DSP-175): a
 * finding's context place that does not exist there is removed and named in `adjustments`;
 * reviewed or approved lines the answer put in a context repository are named as left out.
 * Context never adds to `reviewed` or `approved`: {@link readReviewAnswer} reads those from
 * the reviewed revisions only.
 */
export async function withCheckedContext(result: DelegationResult, raw: unknown, context: ContextReader | null): Promise<DelegationResult> {
  const adjustments = [...result.adjustments];
  const findings: AgentFinding[] = [];
  for (const finding of result.findings) {
    if (finding.contextLocation === undefined) {
      findings.push(finding);
      continue;
    }
    const { contextLocation, ...rest } = finding;
    const checked = await checkedContextRange({ ...contextLocation }, context);
    if ('problem' in checked) {
      findings.push(rest);
      adjustments.push(`A finding's context place was removed: ${checked.problem}`);
    } else {
      findings.push({ ...rest, contextLocation: checked });
    }
  }
  const named = isObject(raw)
    ? (['reviewed', 'approved'] as const).filter((key) => (Array.isArray(raw[key]) ? raw[key] : []).some((entry: unknown) => isObject(entry) && isContextEntry(entry)))
    : [];
  if (named.length > 0) {
    adjustments.push(`Lines in context repositories were named as ${named.join(' and ')}; context is never reviewed or approved, so they were left out.`);
  }
  return { ...result, findings, adjustments };
}

