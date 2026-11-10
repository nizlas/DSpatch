/**
 * DSP-189: code walks prepared by a planner, a writer and a reviewer, as agent nodes of a DSpatch
 * loop graph walked by the run engine. This module holds what both the host's executor and the
 * tests build and read: the three prompts, the answer readers, the step ids, and the summary a
 * job keeps of such a run.
 *
 * The graph (`docs/loop/graphs/dspatch-walk-loop.graph.json`) decides the steps and the routes;
 * the roles in `docs/loop/roles/review/` decide the method; the engine (`runLoopGraph`) decides
 * the execution. Nothing here routes: the executor returns a node's declared outcome, and the
 * drawing says where it leads. The pedagogy is docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md
 * (version 1.2), through the same shared explanation task and profile readers every step
 * explanation uses (`presentation-profiles.ts`, instruction version 7).
 */

import type { ResolvedRole } from './loop-graph';
import {
  DEEPENING_RULES,
  DETAILS_MARKER,
  EXPLANATION_TASK,
  PRESENTATION_INSTRUCTION_VERSION,
  PROFILES,
  SAME_FACTS_RULES,
  WALK_READING_RULES,
  type PublicProfile,
} from './presentation-profiles';
import {
  FORM_RULES,
  PATH_RULES,
  PLACE_RULES,
  WRITING_RULES,
  changeSection,
  folderSection,
  readWalksAnswer,
  type AnalysisMaterial,
  type ProposedStep,
  type ProposedWalks,
} from './review-agent';
import type { AgentMaterial } from './review-pair';
import { splitDetails } from './review-discussion';
import { TASK_HEADER } from './review-task';
import type { WalkFinding, WalkReview, WalkVerdict } from './walk-method';

export const WALK_LOOP_GRAPH_ID = 'dspatch-walk-loop';
export const WALK_LOOP_GRAPH_REL = 'docs/loop/graphs/dspatch-walk-loop.graph.json';

export * from './walk-method';

/** The outcome names the engine counts as a correction round, and the failure a spent bound routes as. */
export const WALK_LOOP_REWORK_OUTCOMES = ['rework-plan', 'rework-text'] as const;
export const WALK_LOOP_LIMIT_FAILURE = 'limit-reached';

/** The node ids the executor knows. The drawing names them; the executor acts on nothing else. */
export const WALK_LOOP_NODES = { plan: 'plan', write: 'write', review: 'review' } as const;

export const WALK_LOOP_TASKS = { plan: 'plan-walks', write: 'write-step', review: 'review-walks' } as const;

/**
 * How the writer names places (DSP-192): its text is read beside the step's places, which
 * already name files and lines, and the walk's reading rules ask for functions, types and
 * values in the prose. The folder section's default sentence would contradict them.
 */
const WRITER_PLACE_NAMING =
  'The places shown beside your text already name files and lines: in the prose name functions, types and values, and name a place by repository path (without `base/` or `target/`, with the side, "base" for From and "target" for To, and 1-based lines at that side) only when you point at code outside this step\'s places.';

// --- Step ids ---------------------------------------------------------------------------------------

/** A step of a proposal with the id the stored definition will give it (`definitionFrom`'s scheme). */
export interface PlannedStepRef {
  readonly walkIndex: number;
  readonly stepIndex: number;
  readonly walkId: string;
  readonly stepId: string;
  readonly step: ProposedStep;
}

/** Every step of the proposal in reading order, with the ids walks and readings get, numbered apart. */
export function stepRefsOf(walks: ProposedWalks): readonly PlannedStepRef[] {
  const refs: PlannedStepRef[] = [];
  walks.walks.forEach((walk, walkIndex) => {
    const ordinal = walks.walks.slice(0, walkIndex + 1).filter((other) => other.kind === walk.kind).length;
    const walkId = `${walk.kind === 'reading' ? 'R' : 'W'}${String(ordinal)}`;
    walk.steps.forEach((step, stepIndex) => {
      refs.push({ walkIndex, stepIndex, walkId, stepId: `${walkId}.${String(stepIndex + 1)}`, step });
    });
  });
  return refs;
}

/** What identifies a planned step across two plans: its places, not its position. */
export function stepSignature(step: ProposedStep): string {
  return JSON.stringify({
    title: step.title.trim(),
    places: step.places.map((place) => [place.range.path, place.range.side, place.range.start, place.range.end]),
    context: (step.contextPlaces ?? []).map((place) => [place.range.repository, place.range.path, place.range.start, place.range.end]),
    together: step.together ?? '',
    revisit: step.revisit ?? '',
  });
}

// --- The plan -----------------------------------------------------------------------------------------

/** The planner's answer: the proposal as `readWalksAnswer` reads it, plus the brief each step carries for the writer. */
export interface WalkPlan {
  readonly walks: ProposedWalks;
  /** By step id. A step the planner gave no brief is absent. */
  readonly briefs: ReadonlyMap<string, string>;
}

export function readPlanAnswer(raw: unknown): { readonly plan: WalkPlan | null; readonly problems: readonly string[] } {
  // The planner writes no body: the reader's "no title or no body" is about the title here, so
  // each step is read with its summary standing in for the body the writer will write.
  const withBodies =
    typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['walks'])
      ? {
          ...(raw as Record<string, unknown>),
          walks: ((raw as Record<string, unknown>)['walks'] as unknown[]).map((walk) =>
            typeof walk === 'object' && walk !== null && Array.isArray((walk as Record<string, unknown>)['steps'])
              ? {
                  ...(walk as Record<string, unknown>),
                  steps: ((walk as Record<string, unknown>)['steps'] as unknown[]).map((step) =>
                    typeof step === 'object' && step !== null && typeof (step as Record<string, unknown>)['body'] !== 'string'
                      ? { ...(step as Record<string, unknown>), body: String((step as Record<string, unknown>)['summary'] ?? (step as Record<string, unknown>)['title'] ?? '(to be written)') || '(to be written)' }
                      : step,
                  ),
                }
              : walk,
          ),
        }
      : raw;
  const parsed = readWalksAnswer(withBodies);
  if (parsed.walks === null) {
    return { plan: null, problems: parsed.problems };
  }
  const briefs = new Map<string, string>();
  const rawWalks = typeof raw === 'object' && raw !== null && Array.isArray((raw as Record<string, unknown>)['walks']) ? ((raw as Record<string, unknown>)['walks'] as unknown[]) : [];
  for (const ref of stepRefsOf(parsed.walks)) {
    const rawWalk = rawWalks[ref.walkIndex];
    const rawSteps = typeof rawWalk === 'object' && rawWalk !== null && Array.isArray((rawWalk as Record<string, unknown>)['steps']) ? ((rawWalk as Record<string, unknown>)['steps'] as unknown[]) : [];
    const rawStep = rawSteps[ref.stepIndex];
    const brief = typeof rawStep === 'object' && rawStep !== null ? (rawStep as Record<string, unknown>)['brief'] : undefined;
    if (typeof brief === 'string' && brief.trim() !== '') {
      briefs.set(ref.stepId, brief.trim());
    }
  }
  return { plan: { walks: parsed.walks, briefs }, problems: parsed.problems };
}

/** The plan with the texts the writer wrote, as the stored definition will carry them. */
export function withTexts(walks: ProposedWalks, texts: ReadonlyMap<string, StepText>): ProposedWalks {
  const refs = stepRefsOf(walks);
  return {
    ...walks,
    walks: walks.walks.map((walk, walkIndex) => ({
      ...walk,
      steps: walk.steps.map((step, stepIndex) => {
        const ref = refs.find((entry) => entry.walkIndex === walkIndex && entry.stepIndex === stepIndex);
        const text = ref === undefined ? undefined : texts.get(ref.stepId);
        return text === undefined ? step : { ...step, body: text.body, details: text.details };
      }),
    })),
  };
}

// --- The writer's text ----------------------------------------------------------------------------

export interface StepText {
  readonly body: string;
  /** `''` when the writer added no deepening. */
  readonly details: string;
}

/** The writer's answer for one step: the first part, and what it put after the marker line. */
export function readStepText(text: string): StepText | null {
  const cleaned = text.replace(/^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n\s*```\s*$/i, '$1').trim();
  if (cleaned === '') {
    return null;
  }
  const split = splitDetails(cleaned);
  return { body: split.short.trim(), details: (split.details ?? '').trim() };
}

// --- The reviewer's answer ------------------------------------------------------------------------

/**
 * The reviewer's JSON, checked: a finding names existing steps or none; a verdict is one of the
 * three. On the final assessment `rework` is read as `objections`, since no round follows.
 */
export function readReviewAnswer(raw: unknown, stepIds: ReadonlySet<string>, final: boolean): { readonly review: WalkReview | null; readonly problems: readonly string[] } {
  if (typeof raw !== 'object' || raw === null) {
    return { review: null, problems: ['The answer was not one JSON object in a ```json fence.'] };
  }
  const value = raw as Record<string, unknown>;
  const problems: string[] = [];
  const text = (entry: unknown): string => (typeof entry === 'string' ? entry.trim() : '');
  const findings: WalkFinding[] = [];
  (Array.isArray(value['findings']) ? value['findings'] : []).forEach((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) {
      problems.push(`finding ${String(index + 1)} is not an object.`);
      return;
    }
    const finding = entry as Record<string, unknown>;
    const kind = finding['kind'] === 'structure' ? 'structure' : finding['kind'] === 'explanation' ? 'explanation' : null;
    if (kind === null) {
      problems.push(`finding ${String(index + 1)} has no kind ("structure" or "explanation").`);
      return;
    }
    const steps = (Array.isArray(finding['steps']) ? finding['steps'] : []).map(text).filter((id) => id !== '');
    const unknown = steps.filter((id) => !stepIds.has(id));
    if (unknown.length > 0) {
      problems.push(`finding ${String(index + 1)} names steps that do not exist: ${unknown.join(', ')}.`);
      return;
    }
    const problem = text(finding['problem']);
    if (problem === '') {
      problems.push(`finding ${String(index + 1)} says no problem.`);
      return;
    }
    findings.push({ kind, steps, problem, why: text(finding['why']), evidence: text(finding['evidence']), reference: text(finding['reference']) });
  });
  const verdictRaw = text(value['verdict']);
  let verdict: WalkVerdict;
  if (verdictRaw === 'accept' || verdictRaw === 'accepted') {
    verdict = 'accept';
  } else if (verdictRaw === 'rework' || verdictRaw === 'objections') {
    verdict = final ? 'objections' : verdictRaw === 'objections' ? 'objections' : 'rework';
  } else if (findings.length === 0) {
    verdict = 'accept';
  } else {
    verdict = final ? 'objections' : 'rework';
  }
  if (verdict === 'rework' && findings.length === 0) {
    // Nothing concrete to act on is not a correction round.
    verdict = 'accept';
  }
  return { review: { assessment: text(value['assessment']), verdict, findings }, problems };
}

/** The node outcome the reviewer's answer declares, as the drawing names them. */
export function reviewOutcomeOf(review: WalkReview): 'accepted' | 'rework-plan' | 'rework-text' | 'objections' {
  if (review.verdict === 'accept') {
    return 'accepted';
  }
  if (review.verdict === 'objections') {
    return 'objections';
  }
  return review.findings.some((finding) => finding.kind === 'structure') ? 'rework-plan' : 'rework-text';
}

// --- Prompts ----------------------------------------------------------------------------------------

function roleSection(role: ResolvedRole): string[] {
  return [`## Your role: ${role.id}`, ...(role.summary === undefined ? [] : [role.summary, '']), (role.instructions ?? '').trim()];
}

function languageLine(language: 'sv' | 'en'): string {
  return `Write in ${language === 'sv' ? 'Swedish' : 'English'}.`;
}

function placeLine(place: ProposedStep['places'][number]): string {
  const range = place.range;
  const from = place.from === undefined ? '' : ` — reached from ${place.from.label} (${place.from.range.path} ${place.from.range.side} ${String(place.from.range.start)}–${String(place.from.range.end)})`;
  return `${place.label}: ${range.path} (${range.side === 'base' ? 'From' : 'To'}) lines ${String(range.start)}–${String(range.end)}${from}`;
}

/** A place in a context repository (DSP-175), shown beside the step's reviewed places; never covered or approved. */
function contextPlaceLine(place: NonNullable<ProposedStep['contextPlaces']>[number]): string {
  const range = place.range;
  return `${place.label}: context repository ${range.repository}, ${range.path} lines ${String(range.start)}–${String(range.end)}${range.commit === '' ? ' at the commit this review recorded for it' : ` at ${range.commit.slice(0, 12)}`}`;
}

/** Every place a step shows, reviewed places first and context places after them. */
function placeLines(step: ProposedStep): string[] {
  return [...step.places.map((place) => `- ${placeLine(place)}`), ...(step.contextPlaces ?? []).map((place) => `- ${contextPlaceLine(place)}`)];
}

/** The plan as the writer and the reviewer see it: ids, titles, places and briefs, no texts. */
export function planOutline(plan: WalkPlan, options: { readonly briefs: boolean }): string[] {
  const lines: string[] = [];
  const refs = stepRefsOf(plan.walks);
  plan.walks.walks.forEach((walk, walkIndex) => {
    const walkId = refs.find((ref) => ref.walkIndex === walkIndex)?.walkId ?? `W${String(walkIndex + 1)}`;
    lines.push(`### ${walkId} (${walk.kind}): ${walk.title}`, `Purpose: ${walk.purpose}`, ...(walk.question === '' ? [] : [`Question: ${walk.question}`]));
    for (const ref of refs.filter((entry) => entry.walkIndex === walkIndex)) {
      lines.push(`- ${ref.stepId} ${ref.step.title}${ref.step.summary === '' ? '' : ` — ${ref.step.summary}`}`);
      for (const line of placeLines(ref.step)) {
        lines.push(`  ${line}`);
      }
      if (ref.step.together !== undefined) {
        lines.push(`  - Together: ${ref.step.together}`);
      }
      if (ref.step.revisit !== undefined) {
        lines.push(`  - Revisit: ${ref.step.revisit}`);
      }
      const brief = plan.briefs.get(ref.stepId);
      if (options.briefs && brief !== undefined) {
        lines.push(`  - Brief: ${brief}`);
      }
    }
    lines.push('');
  });
  return lines;
}

const PLAN_ANSWER_EXAMPLE = {
  summary: 'A short paragraph: what the change does and why.',
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
          summary: 'A short line: what happens here.',
          brief: 'For the writer: what this step must make comprehensible, how it is reached and what the reader takes to the next step.',
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
          together: 'Only for a step with several places: one short sentence on why seeing them side by side helps. Leave it out otherwise.',
          revisit: 'Only for a step that shows a place an earlier step of the walk already showed: what is new to see there now. Leave it out otherwise.',
        },
      ],
    },
    { kind: 'reading', title: 'A coherent change of text', question: 'What changes in it, and what it means', purpose: 'One short sentence.', steps: ['…'] },
  ],
};

export interface PlanPromptInput {
  readonly role: ResolvedRole;
  readonly material: AnalysisMaterial;
  readonly folder: AgentMaterial;
  readonly language: 'sv' | 'en';
  /** On a revisit: the reviewer's findings about the structure, and the plan they are about. */
  readonly rework: { readonly findings: readonly WalkFinding[]; readonly earlierPlan: string } | null;
}

/** The planner's call: the walks, their steps and places, and a brief per step; no explanation texts. */
export function planPrompt(input: PlanPromptInput): string {
  return [
    `${TASK_HEADER} ${WALK_LOOP_TASKS.plan}`,
    '',
    ...roleSection(input.role),
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
    '## One place per step',
    ...PLACE_RULES.map((rule) => `- ${rule}`),
    '',
    '## A coherent path',
    ...PATH_RULES.map((rule) => `- ${rule}`),
    '',
    '## For the writer',
    'A writer explains each step in a call of its own, with this whole plan and the code. You write no explanation: each step carries a "brief" for the writer, one to three sentences on what the step must make comprehensible, how it is reached (a call, a return, back at a branch point, a worker or callback and the context followed) and what the reader takes to the next step. A step\'s "summary" is the one line the person reads in the overview.',
    '',
    '## About the change',
    '- "summary": a short paragraph a person reads first: what the change does and why.',
    '- "background": only when there is more worth knowing (context, history, consequences), in short Markdown paragraphs. Leave it empty rather than repeating the summary.',
    `- ${languageLine(input.language)}`,
    ...(input.rework === null
      ? []
      : [
          '',
          '## The reviewer\'s findings about the structure',
          'A reviewer read the finished walks against the code and found these shortcomings in the structure. Change only what they concern: keep every other walk, step and place as it was, with its title and places, so its explanation can be kept. A step you change, add or remove will be written again.',
          ...input.rework.findings.map((finding) => `- ${finding.steps.length === 0 ? 'The walks' : finding.steps.join(', ')}: ${finding.problem}${finding.why === '' ? '' : ` (${finding.why})`}${finding.evidence === '' ? '' : ` Evidence: ${finding.evidence}`}`),
          '',
          '## Your earlier plan',
          '```json',
          input.rework.earlierPlan,
          '```',
        ]),
    '',
    '## Answer format',
    'When you have examined what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(PLAN_ANSWER_EXAMPLE, null, 2),
    '```',
    'Every place names a path, a side ("base" for From, "target" for To) and 1-based lines that exist at that side; so does "from" when given. "anchor", when given, is text that occurs on those lines. DSpatch checks every place against the commit. Write no "body" and no "details": the writer writes them.',
    '',
    folderSection(input.material, input.folder),
    '',
    changeSection(input.material),
  ].join('\n');
}

export interface WriteStepPromptInput {
  readonly role: ResolvedRole;
  readonly plan: WalkPlan;
  readonly stepId: string;
  readonly profile: PublicProfile;
  readonly language: 'sv' | 'en';
  readonly material: AnalysisMaterial;
  readonly folder: AgentMaterial;
  /** True for the writer's first turn in its session: the role, the plan and the task go with it. */
  readonly fresh: boolean;
  /** On a correction: the reviewer's findings about this step, and the text they are about. */
  readonly rework: { readonly findings: readonly WalkFinding[]; readonly earlierText: string } | null;
}

/** The writer's call for one step. The first turn carries the brief; later turns name the step. */
export function writeStepPrompt(input: WriteStepPromptInput): string {
  const profile = PROFILES[input.profile];
  const refs = stepRefsOf(input.plan.walks);
  const index = refs.findIndex((ref) => ref.stepId === input.stepId);
  const ref = refs[index];
  if (ref === undefined) {
    throw new Error(`No step ${input.stepId} in the plan.`);
  }
  const walk = input.plan.walks.walks[ref.walkIndex];
  const before = refs[index - 1];
  const after = refs[index + 1];
  const neighbour = (other: PlannedStepRef | undefined, word: string): string[] =>
    other === undefined || other.walkIndex !== ref.walkIndex ? [] : [`${word}: ${other.stepId} ${other.step.title}${other.step.summary === '' ? '' : ` — ${other.step.summary}`}`];
  const brief = input.plan.briefs.get(input.stepId);
  const stepSection = [
    `## This step: ${input.stepId} ${ref.step.title}`,
    `Walk ${ref.walkId} (${walk?.kind ?? 'walk'}): ${walk?.title ?? ''}. ${walk?.purpose ?? ''}`,
    ...(ref.step.summary === '' ? [] : [`Summary: ${ref.step.summary}`]),
    ...placeLines(ref.step),
    'The places above are shown beside your text; name functions, types and values in the prose, not these paths and lines.',
    ...(ref.step.together === undefined ? [] : [`Together: ${ref.step.together}`]),
    ...(ref.step.revisit === undefined ? [] : [`Revisit: ${ref.step.revisit}`]),
    // DSP-194: the planner writes the brief for every profile; it is orientation, and the profile selects from it.
    ...(brief === undefined ? [] : [`The planner's brief, written for every profile: ${brief}`]),
    ...neighbour(before, 'The step before'),
    ...neighbour(after, 'The step after'),
  ];
  const reworkSection =
    input.rework === null
      ? []
      : [
          '',
          '## The reviewer\'s findings about this step',
          'Write this step again, acting on each finding; keep what was right. The reviewer read the code: check each claim against it yourself.',
          ...input.rework.findings.map((finding) => `- ${finding.problem}${finding.why === '' ? '' : ` (${finding.why})`}${finding.evidence === '' ? '' : ` Evidence: ${finding.evidence}`}`),
          '',
          '## Your earlier text',
          input.rework.earlierText,
        ];
  if (!input.fresh) {
    return [`${TASK_HEADER} ${WALK_LOOP_TASKS.write}`, '', ...stepSection, ...reworkSection, '', 'Answer with the explanation of this step only, as before.'].join('\n');
  }
  return [
    `${TASK_HEADER} ${WALK_LOOP_TASKS.write}`,
    '',
    ...roleSection(input.role),
    '',
    '## The walks',
    'The plan below is the whole of what the person will read, in this order. You write one step per call, beside its code; the plan tells you what came before and what comes after.',
    '',
    ...planOutline(input.plan, { briefs: true }),
    `## How to explain the step (${profile.promptName})`,
    `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`,
    'Every explanation:',
    ...EXPLANATION_TASK.map((rule) => `- ${rule}`),
    ...SAME_FACTS_RULES.map((rule) => `- ${rule}`),
    '',
    `${profile.promptName}:`,
    ...profile.reader.map((rule) => `- ${rule}`),
    '',
    'Every step is read beside its code, in the walk\'s order:',
    ...WALK_READING_RULES.map((rule) => `- ${rule}`),
    '',
    `## How to write (${languageLine(input.language)})`,
    ...WRITING_RULES.filter((rule) => !rule.startsWith('No fixed length')).map((rule) => `- ${rule}`),
    '',
    '## Answer format',
    `Answer with the explanation of the step only, in Markdown: no JSON, no heading with the step\'s title or id, no restatement of the places. First the part the person reads at once. When there is real depth to add, put it after a line holding only ${DETAILS_MARKER}; the person opens it with Show more.`,
    ...DEEPENING_RULES.map((rule) => `- ${rule}`),
    '',
    folderSection(input.material, input.folder, WRITER_PLACE_NAMING),
    '',
    ...stepSection,
    ...reworkSection,
  ].join('\n');
}

export interface ReviewPromptInput {
  readonly role: ResolvedRole;
  readonly plan: WalkPlan;
  readonly texts: ReadonlyMap<string, StepText>;
  readonly profile: PublicProfile;
  readonly language: 'sv' | 'en';
  readonly material: AnalysisMaterial;
  readonly folder: AgentMaterial;
  /** True on the assessment after the correction round: no further round follows. */
  readonly final: boolean;
  /** On the final assessment: what the reviewer found the first time, so it can say what changed. */
  readonly earlier: WalkReview | null;
  readonly fresh: boolean;
}

const REVIEW_ANSWER_EXAMPLE = {
  assessment: 'A short paragraph: whether the reader can follow the course and understand what the walks show, and what decides your verdict.',
  verdict: 'accept | rework',
  findings: [
    {
      kind: 'structure | explanation',
      steps: ['W1.2'],
      problem: 'What falls short, concretely.',
      why: 'Why it matters to the reader of this profile.',
      evidence: 'What in the code shows it (names and lines).',
      reference: 'Optional: the section of the reference that applies, when it helps.',
    },
  ],
};

/** The reviewer's call over the finished walks: the texts as the person will read them, judged against the code. */
export function reviewPrompt(input: ReviewPromptInput): string {
  const profile = PROFILES[input.profile];
  const refs = stepRefsOf(input.plan.walks);
  const walksAsRead: string[] = [];
  input.plan.walks.walks.forEach((walk, walkIndex) => {
    const walkId = refs.find((ref) => ref.walkIndex === walkIndex)?.walkId ?? `W${String(walkIndex + 1)}`;
    walksAsRead.push(`### ${walkId} (${walk.kind}): ${walk.title}`, `Purpose: ${walk.purpose}`, '');
    for (const ref of refs.filter((entry) => entry.walkIndex === walkIndex)) {
      const text = input.texts.get(ref.stepId);
      walksAsRead.push(`#### ${ref.stepId} ${ref.step.title}`, ...placeLines(ref.step), '', text?.body ?? '(no explanation was written)');
      if (text !== undefined && text.details !== '') {
        walksAsRead.push('', 'Show more:', text.details);
      }
      walksAsRead.push('');
    }
  });
  const example = input.final ? { ...REVIEW_ANSWER_EXAMPLE, verdict: 'accept | objections' } : REVIEW_ANSWER_EXAMPLE;
  return [
    `${TASK_HEADER} ${WALK_LOOP_TASKS.review}`,
    '',
    ...(input.fresh ? [...roleSection(input.role), ''] : []),
    `## The reader (${profile.promptName})`,
    ...profile.reader.map((rule) => `- ${rule}`),
    '',
    '## What to judge',
    '- Can the reader follow the course: at each step, how it is reached and what the caller needs, what a return brings back, that an alternative outcome is back at the branch point, what starts a worker or callback and which context is followed, and when the teaching order differs from the execution order?',
    '- Is every code place a step shows explained there, at this reader\'s level: what it does here, why it matters for the change, and what decides the outcome? Naming a function or showing its lines is not explaining it.',
    '- Is what the text claims true of the code? Read the code behind each step with your tools before you judge; a confident sentence is not evidence.',
    '- Does the text give this reader the help the profile is for: for Essentials an accurate main picture at a higher level of abstraction, chosen rather than compressed; for Standard the mechanism made understandable; for Teacher the concepts and intermediate reasoning built where this step needs them? Do not ask Essentials for the mechanics it left out unless their absence makes the main picture misleading, and do not ask Teacher for more detail to make the text longer; an omission that misleads is a finding in any profile. Length and density are not the measure.',
    '- Is the part after Show more a deepening that continues the first part, not a repetition of it?',
    '- Is an important new implementation walked rather than left behind a function name, and are alternatives presented as alternatives, never as one run?',
    'Report only shortcomings that matter to the reader\'s understanding, each concrete: the steps it concerns, what falls short, why it matters, and what in the code shows it. A finding about which walks, steps or places exist is "structure" and goes to the planner; one about a step\'s text is "explanation" and goes to the writer. A statement about the code that is not true is a shortcoming whatever its size, since the person checks the code through these texts: name it as a finding with the correct reading, even when the rest of the step is right. Different good explanations are acceptable: accept without changes when nothing false and nothing significant falls short, and never ask for a change on a matter of style or preference.',
    ...(input.final
      ? [
          '',
          '## The final assessment',
          'This is the assessment after the one correction round: no further correction follows. Judge the walks as they are now, say what was put right and what still falls short, and give the verdict "accept" when the walks now serve the reader or "objections" when something significant still does, with the remaining shortcomings as findings.',
          ...(input.earlier === null ? [] : ['', 'What you found the first time:', ...input.earlier.findings.map((finding) => `- ${finding.steps.join(', ') || 'the walks'}: ${finding.problem}`)]),
        ]
      : []),
    '',
    '## The walks as the person will read them',
    ...walksAsRead,
    '## Answer format',
    'When you have checked what you need, answer with one JSON object in a ```json fence and nothing else:',
    '```json',
    JSON.stringify(example, null, 2),
    '```',
    `"findings" is empty when you accept. ${languageLine(input.language)}`,
    ...(input.fresh ? ['', folderSection(input.material, input.folder)] : []),
  ].join('\n');
}
