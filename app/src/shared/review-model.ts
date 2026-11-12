/**
 * The review surface's model: a prepared walk definition, the real diff of a fixed
 * revision pair, and the reviewer's own record — kept as three separate things.
 *
 * Review stands alone (VISION §3.3): a repository and two identified revisions are
 * the whole input. Nothing here knows about tasks, loops, the graph editor or an
 * agent run. The walks are prepared material read from a file (VISION §3.4 "prepared
 * walks can test whether the interaction helps before automatic generation is
 * integrated"); nothing in this module or the view generates or adapts them.
 *
 * Three kinds of state are never merged, because merging them is how a review starts
 * to lie (REVIEW_COVERAGE_AND_CODE_WALKS.md §3, TASK_MANAGEMENT §11):
 *
 * - **planned**: what a walk's references cover. A property of the material.
 * - **shown / walked through**: what the reviewer has had on screen in a walk, and
 *   what they have explicitly marked as walked through. Neither is a judgement.
 * - **decided**: an explicit human decision about an identified scope at the
 *   reviewed revision pair, with its provenance. Only this is a review outcome.
 *
 * Pure functions only, so the main process, the renderer and the tests share one
 * reading of the same data.
 */

import { isProfile, type PresentationProfile } from './presentation-profiles';

// --- The prepared definition ---------------------------------------------------

/**
 * Version 2 gives every step its places — one precise focus each, with the wider
 * context needed to understand it — and every human-readable text in both display
 * languages. Version 1 files are still read, as one place per walk reference.
 */
export const REVIEW_DEFINITION_FORMAT = 'dspatch-review/2';
export const REVIEW_DEFINITION_FORMAT_V1 = 'dspatch-review/1';

/** The two display languages. Code names, source code and repository documents stay English. */
export type Lang = 'sv' | 'en';
export const LANGS: readonly Lang[] = ['sv', 'en'];

/** A prepared text in each display language. */
export type LocalText = Readonly<Record<Lang, string>>;

/** Which revision a reference reads. Removed code exists only on `base`. */
export type RevisionSide = 'base' | 'target';

/**
 * What a reference is for. Only `walk` references count as planned coverage of
 * changed lines; `evidence` points at tests or logs the step relies on, `context`
 * at code worth reading that the walk does not claim to cover.
 */
export type ReferenceRole = 'walk' | 'evidence' | 'context';

/**
 * How a statement in a step is supported. The view words each in plain language and
 * never upgrades one.
 */
export type EvidenceLabel = 'analysis' | 'test-simulated' | 'test-real-substitute' | 'not-observed';

export const EVIDENCE_LABELS: readonly EvidenceLabel[] = [
  'analysis',
  'test-simulated',
  'test-real-substitute',
  'not-observed',
];

export interface CodeReference {
  /** Unique within its step; names the reference in validation and in "opened" marks. */
  readonly id: string;
  readonly path: string;
  readonly side: RevisionSide;
  /** 1-based, inclusive. */
  readonly start: number;
  readonly end: number;
  readonly role: ReferenceRole;
  /**
   * Text that must occur somewhere in the range at that revision. Checked when the
   * review opens, so a reference that points at the wrong lines is reported rather
   * than highlighted with confidence.
   */
  readonly anchor?: string;
  readonly note?: LocalText;
}

/**
 * One code location a step explains. `focus` is exactly the lines the explanation is
 * about; `context` is the wider code needed to understand them, shown neutrally.
 * Whether the focus is a change is read from the real diff, never declared.
 */
export interface Place {
  readonly id: string;
  readonly label: LocalText;
  readonly focus: CodeReference;
  readonly context: readonly CodeReference[];
  /**
   * The code unit the focus lies in — function, method, declaration or type — found
   * when the material was prepared (for TypeScript by parsing it). The default view.
   */
  readonly unit: PlaceUnit | null;
  /** Where the walk arrives from: the call or read that leads here. */
  readonly from: PlaceLink | null;
}

export type UnitKind = 'function' | 'method' | 'constructor' | 'declaration' | 'type' | 'class' | 'member' | 'block';

export interface PlaceUnit {
  readonly ref: CodeReference;
  readonly kind: UnitKind;
  readonly name: string;
  /**
   * The same unit at the other side of the diff, when it is there: a rewritten function
   * is shown with all of its old and its new lines, wherever the diff puts them.
   */
  readonly counterpart: CodeReference | null;
}

export interface PlaceLink {
  readonly ref: CodeReference;
  readonly label: LocalText;
}

const UNIT_KINDS: readonly UnitKind[] = ['function', 'method', 'constructor', 'declaration', 'type', 'class', 'member', 'block'];

export interface StepEvidence {
  readonly label: EvidenceLabel;
  readonly text: LocalText;
}

export interface WalkStep {
  readonly id: string;
  readonly title: LocalText;
  /** What the step is about, in one or two sentences. */
  readonly summary: LocalText;
  /** What happens or changes. Markdown, rendered by the existing safe component. */
  readonly body: LocalText;
  /** Why it matters. */
  readonly why: LocalText;
  /** DSP-181: the deepening behind Show more, when the generator wrote one. Absent in older definitions. */
  readonly details?: LocalText;
  /**
   * DSP-185: why the step shows several places together, as the justified exception to one
   * place per step. Absent in older definitions and in steps that show one place.
   */
  readonly together?: LocalText;
  /** DSP-185: what is new to see at a place an earlier step showed. Absent in older definitions. */
  readonly revisit?: LocalText;
  readonly places: readonly Place[];
  readonly evidence: readonly StepEvidence[];
  readonly evidenceRefs: readonly CodeReference[];
  /** Every reference of the step — focus, context and evidence — for validation and coverage. */
  readonly refs: readonly CodeReference[];
  /**
   * DSP-175: places in other repositories of the review's workspace, read as context at the
   * commit the analysis recorded. Kept apart from `places` and `refs` on purpose: they are
   * never stations, never covered, never marked and never approved. Absent when there are none.
   */
  readonly contextPlaces?: readonly ContextPlace[];
}

/**
 * A walk place in another repository of the workspace (DSP-175), stored under a step's
 * `contextPlaces`, never under `places`: `{"id", "label", "focus": {"kind": "context",
 * "repository", "commit", "path", "start", "end", "role": "context", "anchor"?, "note"?}}`.
 * It opens from Git at `commit` through the review's context record (`readContextFile`),
 * which also says how that commit was chosen and whether it is established.
 */
export interface ContextPlace {
  readonly id: string;
  readonly label: LocalText;
  readonly focus: {
    readonly kind: 'context';
    /** The context repository's name in the review: its folder under `context/`. */
    readonly repository: string;
    /** The full commit the analysis read it at. */
    readonly commit: string;
    readonly path: string;
    readonly start: number;
    readonly end: number;
    readonly anchor?: string;
    readonly note?: LocalText;
  };
}

/**
 * The form of a walk (Niclas's trial feedback, 29 October 2026). A `walk` follows an
 * execution path from a concrete entry point; a `reading` takes one coherent change of
 * text — documentation, prose — in its context, where following execution means nothing.
 * A definition without the field has walks only. A `check` is never in `walks`: it is the
 * own tour of a point worth checking that no walk step fits ({@link CheckPoint.tour}).
 */
export type WalkKind = 'walk' | 'reading' | 'check';

export interface Walk {
  readonly id: string;
  readonly kind: WalkKind;
  readonly title: LocalText;
  /** What the walk is for. */
  readonly purpose: LocalText;
  readonly question: LocalText;
  readonly steps: readonly WalkStep[];
}

/**
 * What a point worth checking is (Niclas's decision of 30 October 2026): a question to look
 * into, an uncertainty the preparation could not settle, or a finding the code shows. Opening
 * or discussing one decides nothing about it.
 */
export type CheckKind = 'question' | 'uncertainty' | 'finding';

export const CHECK_KINDS: readonly CheckKind[] = ['question', 'uncertainty', 'finding'];

/**
 * A point worth checking, as an entry into the code: a short title, at most one sentence
 * more, and the reasoning with its places, shown when it is opened. It goes to the walk step
 * it belongs to when the preparation named one that exists, else to its own tour.
 */
export interface CheckPoint {
  readonly id: string;
  readonly kind: CheckKind;
  readonly title: LocalText;
  readonly detail: LocalText;
  /** Markdown: why it is worth checking, shown at the code. */
  readonly reasoning: LocalText;
  /** The step it belongs to, when one fits: an existing step id of `walks`. */
  readonly stepId: string | null;
  /** Its own tour through its places, when no step fits. Never counted as walk coverage. */
  readonly tour: Walk | null;
  /** Where in the code it is, as context references. */
  readonly places: readonly CodeReference[];
}

export interface ReviewDefinition {
  readonly format: string;
  readonly title: LocalText;
  /** Repository path, absolute or relative to the definition file. */
  readonly repository: string;
  readonly base: string;
  readonly target: string;
  /** How the prepared text was written. Information, not a control. */
  readonly teachingMode: string;
  /**
   * DSP-181: the presentation profile the step explanations were written in, with the
   * instruction version, when the walks were prepared in one. Absent in older definitions,
   * whose prepared text is the legacy Original.
   */
  readonly presentation?: { readonly profile: PresentationProfile; readonly version: number };
  /** Where the material came from and its limits. */
  readonly provenance: LocalText;
  /** What the change as a whole is for: the sum of the walks. Markdown. */
  readonly overview: LocalText;
  /** The same in a few sentences, shown first; the overview opens on request. Empty when not given. */
  readonly overviewSummary: LocalText;
  /**
   * What deserves the reviewer's attention across the change — contradictions, open
   * questions, risks — as a short Markdown list shown with the summary. Empty when not given.
   */
  readonly attention: LocalText;
  /** Languages every text is written in. A version 1 file has none: its text is shown as written. */
  readonly languages: readonly Lang[];
  readonly walks: readonly Walk[];
  /**
   * Points worth checking with their links into the code (30 October 2026). Empty in a
   * definition written before: its `attention` text is shown as it is, with no links made up.
   */
  readonly checks: readonly CheckPoint[];
}

/**
 * Where the points asked for on their own are kept: beside the walks' definition, so the
 * definition, and with it the review's record of it, stays as it was written.
 */
export function checksFileOf(definitionPath: string): string {
  return definitionPath.replace(/\.review\.json$/i, '') + '.checks.json';
}

/** The format of that file. */
export const CHECKS_FILE_FORMAT = 'dspatch-checks/1';

/** The walks, then the points' own tours: every step a position can name. */
export function stepsWalks(definition: ReviewDefinition): readonly Walk[] {
  return [...definition.walks, ...definition.checks.flatMap((check) => (check.tour === null ? [] : [check.tour]))];
}

export interface DefinitionProblem {
  readonly where: string;
  readonly problem: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(record: Record<string, unknown>, key: string, where: string, problems: DefinitionProblem[]): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push({ where, problem: `"${key}" must be a non-empty string.` });
    return '';
  }
  return value;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/**
 * A text field: `{ "sv": …, "en": … }` in version 2, a plain string in version 1.
 * A missing language is reported and filled from the other, so the view never shows
 * a blank where a text belongs.
 */
function localText(
  record: Record<string, unknown>,
  key: string,
  where: string,
  problems: DefinitionProblem[],
  options: { readonly required: boolean; readonly bilingual: boolean },
): LocalText {
  const value = record[key];
  if (value === undefined && !options.required) {
    return { sv: '', en: '' };
  }
  if (typeof value === 'string') {
    if (options.bilingual && value.trim() !== '') {
      problems.push({ where, problem: `"${key}" must give both "sv" and "en".` });
    }
    if (value.trim() === '' && options.required) {
      problems.push({ where, problem: `"${key}" must not be empty.` });
    }
    return { sv: value, en: value };
  }
  if (!isRecord(value)) {
    if (options.required) {
      problems.push({ where, problem: `"${key}" must be ${options.bilingual ? 'an object with "sv" and "en"' : 'a string'}.` });
    }
    return { sv: '', en: '' };
  }
  const sv = typeof value['sv'] === 'string' ? value['sv'] : '';
  const en = typeof value['en'] === 'string' ? value['en'] : '';
  for (const [lang, text] of [
    ['sv', sv],
    ['en', en],
  ] as const) {
    if (text.trim() === '' && (options.required || sv !== '' || en !== '')) {
      problems.push({ where, problem: `"${key}" has no "${lang}" text.` });
    }
  }
  return { sv: sv === '' ? en : sv, en: en === '' ? sv : en };
}

function parseReference(
  raw: unknown,
  id: string,
  where: string,
  problems: DefinitionProblem[],
  roleDefault: ReferenceRole,
  bilingual: boolean,
): CodeReference | null {
  if (!isRecord(raw)) {
    problems.push({ where, problem: 'A reference must be an object.' });
    return null;
  }
  const path = str(raw, 'path', where, problems);
  const side = raw['side'] ?? 'target';
  const role = raw['role'] ?? roleDefault;
  const start = raw['start'];
  const end = raw['end'] ?? raw['start'];
  let ok = true;
  if (side !== 'base' && side !== 'target') {
    problems.push({ where, problem: '"side" must be "base" or "target".' });
    ok = false;
  }
  if (role !== 'walk' && role !== 'evidence' && role !== 'context') {
    problems.push({ where, problem: '"role" must be "walk", "evidence" or "context".' });
    ok = false;
  }
  if (!positiveInt(start) || !positiveInt(end) || end < start) {
    problems.push({ where, problem: '"start" and "end" must be 1-based lines with start ≤ end.' });
    ok = false;
  }
  if (path.includes('\\') || path.startsWith('/')) {
    problems.push({ where, problem: 'Paths are repository-relative with forward slashes.' });
  }
  if (!ok || path === '') {
    return null;
  }
  const note = raw['note'] === undefined ? undefined : localText(raw, 'note', where, problems, { required: false, bilingual });
  return {
    id,
    path,
    side: side as RevisionSide,
    start: start as number,
    end: end as number,
    role: role as ReferenceRole,
    ...(typeof raw['anchor'] === 'string' ? { anchor: raw['anchor'] } : {}),
    ...(note === undefined ? {} : { note }),
  };
}

function parseEvidence(raw: unknown, where: string, problems: DefinitionProblem[], bilingual: boolean): StepEvidence[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push({ where, problem: '"evidence" must be an array when present.' });
    return [];
  }
  const out: StepEvidence[] = [];
  raw.forEach((entry: unknown, index) => {
    const entryWhere = `${where}[${String(index)}]`;
    if (!isRecord(entry)) {
      problems.push({ where: entryWhere, problem: 'Evidence must be an object.' });
      return;
    }
    const label = entry['label'];
    if (!EVIDENCE_LABELS.includes(label as EvidenceLabel)) {
      problems.push({ where: entryWhere, problem: `"label" must be one of ${EVIDENCE_LABELS.join(', ')}.` });
      return;
    }
    out.push({ label: label as EvidenceLabel, text: localText(entry, 'text', entryWhere, problems, { required: true, bilingual }) });
  });
  return out;
}

/**
 * Read a definition, reporting every structural problem rather than the first.
 * Returns `null` only when the shape is too broken to show anything.
 */
export function parseReviewDefinition(raw: unknown): {
  readonly definition: ReviewDefinition | null;
  readonly problems: readonly DefinitionProblem[];
} {
  const problems: DefinitionProblem[] = [];
  if (!isRecord(raw)) {
    return { definition: null, problems: [{ where: 'file', problem: 'The file is not a JSON object.' }] };
  }
  const format = raw['format'];
  const v2 = format === REVIEW_DEFINITION_FORMAT;
  if (!v2 && format !== REVIEW_DEFINITION_FORMAT_V1) {
    problems.push({
      where: 'file',
      problem: `"format" must be "${REVIEW_DEFINITION_FORMAT}" or "${REVIEW_DEFINITION_FORMAT_V1}", found ${JSON.stringify(format)}.`,
    });
  }
  const text = (record: Record<string, unknown>, key: string, where: string, required = true): LocalText =>
    localText(record, key, where, problems, { required, bilingual: v2 });
  const title = text(raw, 'title', 'file');
  const repository = str(raw, 'repository', 'file', problems);
  const base = str(raw, 'base', 'file', problems);
  const target = str(raw, 'target', 'file', problems);
  for (const [key, value] of [
    ['base', base],
    ['target', target],
  ] as const) {
    if (value !== '' && !/^[0-9a-f]{40}$/i.test(value)) {
      problems.push({
        where: 'file',
        problem: `"${key}" is "${value}", not a full commit SHA. It was resolved when the review opened, but a branch or short name can move; name the commit in full.`,
      });
    }
  }
  const teachingMode = typeof raw['teachingMode'] === 'string' ? raw['teachingMode'] : '';
  // DSP-181: the profile the explanations were written in; anything else is read as none.
  const presentationRaw = raw['presentation'];
  const presentation =
    isRecord(presentationRaw) && isProfile(presentationRaw['profile']) && typeof presentationRaw['version'] === 'number' && Number.isInteger(presentationRaw['version'])
      ? { profile: presentationRaw['profile'], version: presentationRaw['version'] }
      : null;
  const provenance = text(raw, 'provenance', 'file', false);
  const overview = text(raw, 'overview', 'file', false);
  const overviewSummary = text(raw, 'overviewSummary', 'file', false);
  const attention = text(raw, 'attention', 'file', false);
  const walksRaw = raw['walks'];
  const walks: Walk[] = [];
  const seenIds = new Set<string>();
  const unique = (id: string, where: string): void => {
    if (seenIds.has(id)) {
      problems.push({ where, problem: `Duplicate id "${id}".` });
    }
    seenIds.add(id);
  };
  if (!Array.isArray(walksRaw)) {
    problems.push({ where: 'file', problem: '"walks" must be an array.' });
  } else {
    walksRaw.forEach((walkRaw: unknown, walkIndex) => {
      const where = `walks[${String(walkIndex)}]`;
      if (!isRecord(walkRaw)) {
        problems.push({ where, problem: 'A walk must be an object.' });
        return;
      }
      const id = str(walkRaw, 'id', where, problems);
      unique(id, where);
      const steps: WalkStep[] = [];
      const stepsRaw = walkRaw['steps'];
      if (!Array.isArray(stepsRaw) || stepsRaw.length === 0) {
        problems.push({ where, problem: '"steps" must be a non-empty array.' });
      } else {
        stepsRaw.forEach((stepRaw: unknown, stepIndex) => {
          const stepWhere = `${id || where}.steps[${String(stepIndex)}]`;
          if (!isRecord(stepRaw)) {
            problems.push({ where: stepWhere, problem: 'A step must be an object.' });
            return;
          }
          const stepId = str(stepRaw, 'id', stepWhere, problems);
          unique(stepId, stepWhere);
          const step = v2 ? parseStepV2(stepRaw, stepId, stepWhere, problems) : parseStepV1(stepRaw, stepId, stepWhere, problems);
          if (step !== null) {
            steps.push(step);
          }
        });
      }
      const kind = walkRaw['kind'];
      if (kind !== undefined && kind !== 'walk' && kind !== 'reading') {
        problems.push({ where, problem: '"kind" must be "walk" or "reading" when present (a check tour belongs to its check).' });
      }
      walks.push({
        id,
        kind: kind === 'reading' ? 'reading' : 'walk',
        title: text(walkRaw, 'title', where),
        purpose: text(walkRaw, 'purpose', where, false),
        question: text(walkRaw, 'question', where),
        steps,
      });
    });
  }
  // Points worth checking: their step must exist, their own tour is read like a walk.
  const stepIds = new Set(walks.flatMap((walk) => walk.steps.map((step) => step.id)));
  const checks: CheckPoint[] = [];
  const checksRaw = raw['checks'];
  if (checksRaw !== undefined && !Array.isArray(checksRaw)) {
    problems.push({ where: 'file', problem: '"checks" must be an array when present.' });
  } else if (Array.isArray(checksRaw) && v2) {
    checksRaw.forEach((checkRaw: unknown, checkIndex) => {
      const where = `checks[${String(checkIndex)}]`;
      if (!isRecord(checkRaw)) {
        problems.push({ where, problem: 'A check must be an object.' });
        return;
      }
      const id = str(checkRaw, 'id', where, problems);
      unique(id, where);
      const kind = checkRaw['kind'];
      if (!CHECK_KINDS.includes(kind as CheckKind)) {
        problems.push({ where, problem: `"kind" must be one of ${CHECK_KINDS.join(', ')}.` });
      }
      const stepRaw = checkRaw['stepId'];
      let stepId: string | null = null;
      if (typeof stepRaw === 'string' && stepIds.has(stepRaw)) {
        stepId = stepRaw;
      } else if (stepRaw !== undefined && stepRaw !== null) {
        problems.push({ where, problem: `"stepId" ${JSON.stringify(stepRaw)} is not a step of this review.` });
      }
      const places: CodeReference[] = [];
      const placesRaw = checkRaw['places'];
      if (Array.isArray(placesRaw)) {
        placesRaw.forEach((entry: unknown, placeIndex) => {
          const ref = parseReference(entry, `${id}.place${String(placeIndex + 1)}`, `${where}.places[${String(placeIndex)}]`, problems, 'context', true);
          if (ref !== null) {
            places.push({ ...ref, role: 'context' });
          }
        });
      }
      let tour: Walk | null = null;
      const tourRaw = checkRaw['tour'];
      if (isRecord(tourRaw) && Array.isArray(tourRaw['steps'])) {
        const tourSteps: WalkStep[] = [];
        tourRaw['steps'].forEach((stepEntry: unknown, tourIndex) => {
          const stepWhere = `${where}.tour.steps[${String(tourIndex)}]`;
          if (!isRecord(stepEntry)) {
            problems.push({ where: stepWhere, problem: 'A step must be an object.' });
            return;
          }
          const tourStepId = str(stepEntry, 'id', stepWhere, problems);
          unique(tourStepId, stepWhere);
          const step = parseStepV2(stepEntry, tourStepId, stepWhere, problems);
          if (step !== null) {
            // A tour shows where a point is; it never covers a change.
            const asContext = (ref: CodeReference): CodeReference => ({ ...ref, role: 'context' });
            tourSteps.push({
              ...step,
              places: step.places.map((place) => ({ ...place, focus: asContext(place.focus) })),
              refs: step.refs.map(asContext),
            });
          }
        });
        if (tourSteps.length > 0) {
          tour = { id, kind: 'check', title: text(checkRaw, 'title', where), purpose: { sv: '', en: '' }, question: text(checkRaw, 'title', where), steps: tourSteps };
        }
      } else if (tourRaw !== undefined) {
        problems.push({ where, problem: '"tour" must be an object with steps when present.' });
      }
      checks.push({
        id,
        kind: CHECK_KINDS.includes(kind as CheckKind) ? (kind as CheckKind) : 'question',
        title: text(checkRaw, 'title', where),
        detail: text(checkRaw, 'detail', where, false),
        reasoning: text(checkRaw, 'reasoning', where, false),
        stepId,
        tour,
        places,
      });
    });
  }
  return {
    definition: {
      format: typeof format === 'string' ? format : '',
      title,
      repository,
      base,
      target,
      teachingMode,
      ...(presentation === null ? {} : { presentation }),
      provenance,
      overview,
      overviewSummary,
      attention,
      languages: v2 ? LANGS : [],
      walks,
      checks,
    },
    problems,
  };
}

const CONTEXT_FOCUS_COMMIT = /^[0-9a-f]{40}$/;

/**
 * A step's context places (DSP-175), each checked for shape only; whether it exists at its
 * commit is for the reader of the context record. A malformed one is reported and left out.
 */
function parseContextPlaces(raw: unknown, stepId: string, problems: DefinitionProblem[]): ContextPlace[] {
  if (raw === undefined) {
    return [];
  }
  if (!Array.isArray(raw)) {
    problems.push({ where: stepId, problem: '"contextPlaces" must be an array when present.' });
    return [];
  }
  const out: ContextPlace[] = [];
  raw.forEach((entry: unknown, index) => {
    const where = `${stepId}.contextPlaces[${String(index)}]`;
    const focus = isRecord(entry) ? entry['focus'] : null;
    if (!isRecord(entry) || !isRecord(focus)) {
      problems.push({ where, problem: 'A context place must be an object with a "focus".' });
      return;
    }
    const { repository, commit, path, start, end } = focus;
    if (
      typeof entry['id'] !== 'string' ||
      entry['id'] === '' ||
      typeof repository !== 'string' ||
      repository === '' ||
      typeof commit !== 'string' ||
      !CONTEXT_FOCUS_COMMIT.test(commit) ||
      typeof path !== 'string' ||
      path === '' ||
      path.includes('\\') ||
      path.startsWith('/') ||
      path.split('/').includes('..') ||
      !positiveInt(start) ||
      !positiveInt(end) ||
      end < start
    ) {
      problems.push({ where, problem: 'A context place names an id, a repository, a full commit, a repository-relative path and 1-based lines.' });
      return;
    }
    const note = focus['note'] === undefined ? undefined : localText(focus, 'note', where, problems, { required: false, bilingual: true });
    out.push({
      id: entry['id'],
      label: localText(entry, 'label', where, problems, { required: true, bilingual: true }),
      focus: {
        kind: 'context',
        repository,
        commit,
        path,
        start,
        end,
        ...(typeof focus['anchor'] === 'string' ? { anchor: focus['anchor'] } : {}),
        ...(note === undefined ? {} : { note }),
      },
    });
  });
  return out;
}

function parseStepV2(raw: Record<string, unknown>, stepId: string, where: string, problems: DefinitionProblem[]): WalkStep | null {
  const text = (key: string, required = true): LocalText =>
    localText(raw, key, where, problems, { required, bilingual: true });
  const places: Place[] = [];
  const placesRaw = raw['places'];
  const refIds = new Set<string>();
  const refId = (id: string, refWhere: string): string => {
    if (refIds.has(id)) {
      problems.push({ where: refWhere, problem: `Duplicate reference id "${id}".` });
    }
    refIds.add(id);
    return id;
  };
  if (!Array.isArray(placesRaw) || placesRaw.length === 0) {
    problems.push({ where, problem: '"places" must be a non-empty array.' });
  } else {
    placesRaw.forEach((placeRaw: unknown, index) => {
      const placeWhere = `${stepId}.places[${String(index)}]`;
      if (!isRecord(placeRaw)) {
        problems.push({ where: placeWhere, problem: 'A place must be an object.' });
        return;
      }
      const placeId = str(placeRaw, 'id', placeWhere, problems);
      const focus = parseReference(placeRaw['focus'], refId(placeId, placeWhere), `${placeWhere}.focus`, problems, 'walk', true);
      const contextRaw = placeRaw['context'];
      const context: CodeReference[] = [];
      if (contextRaw !== undefined && !Array.isArray(contextRaw)) {
        problems.push({ where: placeWhere, problem: '"context" must be an array when present.' });
      } else if (Array.isArray(contextRaw)) {
        contextRaw.forEach((entry: unknown, contextIndex) => {
          const contextId = refId(`${placeId}.context${String(contextIndex + 1)}`, placeWhere);
          // Context is shown on request and never counts as covered by the walk.
          const ref = parseReference(entry, contextId, `${placeWhere}.context[${String(contextIndex)}]`, problems, 'context', true);
          if (ref !== null) {
            context.push(ref);
          }
        });
      }
      let unit: PlaceUnit | null = null;
      const unitRaw = placeRaw['unit'];
      if (isRecord(unitRaw)) {
        const unitRef = parseReference(unitRaw, refId(`${placeId}.unit`, placeWhere), `${placeWhere}.unit`, problems, 'context', true);
        const kind = unitRaw['kind'];
        if (!UNIT_KINDS.includes(kind as UnitKind)) {
          problems.push({ where: `${placeWhere}.unit`, problem: `"kind" must be one of ${UNIT_KINDS.join(', ')}.` });
        } else if (unitRef !== null) {
          let counterpart: CodeReference | null = null;
          const counterpartRaw = unitRaw['counterpart'];
          if (isRecord(counterpartRaw)) {
            const counterpartWhere = `${placeWhere}.unit.counterpart`;
            const ref = parseReference(counterpartRaw, refId(`${placeId}.unit.counterpart`, placeWhere), counterpartWhere, problems, 'context', true);
            if (ref !== null && (ref.side === unitRef.side || ref.path !== unitRef.path)) {
              problems.push({ where: counterpartWhere, problem: 'A counterpart is the same file at the other side.' });
            } else if (ref !== null) {
              counterpart = { ...ref, role: 'context' };
            }
          } else if (counterpartRaw !== undefined) {
            problems.push({ where: `${placeWhere}.unit`, problem: '"counterpart" must be an object when present.' });
          }
          unit = { ref: { ...unitRef, role: 'context' }, kind: kind as UnitKind, name: typeof unitRaw['name'] === 'string' ? unitRaw['name'] : '', counterpart };
        }
      } else if (unitRaw !== undefined) {
        problems.push({ where: placeWhere, problem: '"unit" must be an object when present.' });
      }
      let from: PlaceLink | null = null;
      const fromRaw = placeRaw['from'];
      if (isRecord(fromRaw)) {
        const fromRef = parseReference(fromRaw, refId(`${placeId}.from`, placeWhere), `${placeWhere}.from`, problems, 'context', true);
        if (fromRef !== null) {
          from = { ref: { ...fromRef, role: 'context' }, label: localText(fromRaw, 'label', `${placeWhere}.from`, problems, { required: true, bilingual: true }) };
        }
      } else if (fromRaw !== undefined) {
        problems.push({ where: placeWhere, problem: '"from" must be an object when present.' });
      }
      if (focus !== null && placeId !== '') {
        places.push({
          id: placeId,
          label: localText(placeRaw, 'label', placeWhere, problems, { required: true, bilingual: true }),
          focus,
          context,
          unit,
          from,
        });
      }
    });
  }
  const contextPlaces = parseContextPlaces(raw['contextPlaces'], stepId, problems);
  const evidenceRefs: CodeReference[] = [];
  const evidenceRefsRaw = raw['evidenceRefs'];
  if (Array.isArray(evidenceRefsRaw)) {
    evidenceRefsRaw.forEach((entry: unknown, index) => {
      const ref = parseReference(entry, refId(`e${String(index + 1)}`, where), `${stepId}.evidenceRefs[${String(index)}]`, problems, 'evidence', true);
      if (ref !== null) {
        evidenceRefs.push(ref);
      }
    });
  }
  return {
    id: stepId,
    title: text('title'),
    summary: text('summary'),
    body: text('body'),
    why: text('why', false),
    ...((): { details?: LocalText } => {
      const details = text('details', false);
      return details.sv === '' && details.en === '' ? {} : { details };
    })(),
    ...((): { together?: LocalText } => {
      const together = text('together', false);
      return together.sv === '' && together.en === '' ? {} : { together };
    })(),
    ...((): { revisit?: LocalText } => {
      const revisit = text('revisit', false);
      return revisit.sv === '' && revisit.en === '' ? {} : { revisit };
    })(),
    places,
    evidence: parseEvidence(raw['evidence'], `${stepId}.evidence`, problems, true),
    evidenceRefs,
    refs: [
      ...places.flatMap((place) => [
        place.focus,
        ...place.context,
        ...(place.unit === null ? [] : [place.unit.ref]),
        ...(place.unit?.counterpart == null ? [] : [place.unit.counterpart]),
        ...(place.from === null ? [] : [place.from.ref]),
      ]),
      ...evidenceRefs,
    ],
    // DSP-175: never part of `places` or `refs`, so nothing counts them as covered.
    ...(contextPlaces.length === 0 ? {} : { contextPlaces }),
  };
}

/** A version 1 step: each walk or context reference becomes a place; text is shown as written. */
function parseStepV1(raw: Record<string, unknown>, stepId: string, where: string, problems: DefinitionProblem[]): WalkStep | null {
  const plain = (key: string, required = true): LocalText =>
    localText(raw, key, where, problems, { required, bilingual: false });
  const places: Place[] = [];
  const evidenceRefs: CodeReference[] = [];
  const refsRaw = raw['refs'];
  if (!Array.isArray(refsRaw) || refsRaw.length === 0) {
    problems.push({ where, problem: '"refs" must be a non-empty array.' });
  } else {
    refsRaw.forEach((entry: unknown, index) => {
      const id = `r${String(index + 1)}`;
      const ref = parseReference(entry, id, `${stepId}.refs[${String(index)}]`, problems, 'walk', false);
      if (ref === null) {
        return;
      }
      if (ref.role === 'evidence') {
        evidenceRefs.push(ref);
      } else {
        const label = ref.note ?? { sv: `${ref.path}:${String(ref.start)}`, en: `${ref.path}:${String(ref.start)}` };
        places.push({ id, label, focus: ref, context: [], unit: null, from: null });
      }
    });
  }
  const evidence: StepEvidence[] = [];
  const claimsRaw = raw['claims'];
  if (Array.isArray(claimsRaw)) {
    claimsRaw.forEach((claim: unknown, index) => {
      const claimWhere = `${stepId}.claims[${String(index)}]`;
      if (!isRecord(claim)) {
        problems.push({ where: claimWhere, problem: 'A claim must be an object.' });
        return;
      }
      if (!EVIDENCE_LABELS.includes(claim['label'] as EvidenceLabel)) {
        problems.push({ where: claimWhere, problem: `"label" must be one of ${EVIDENCE_LABELS.join(', ')}.` });
        return;
      }
      evidence.push({ label: claim['label'] as EvidenceLabel, text: localText(claim, 'text', claimWhere, problems, { required: true, bilingual: false }) });
    });
  } else if (claimsRaw !== undefined) {
    problems.push({ where, problem: '"claims" must be an array when present.' });
  }
  return {
    id: stepId,
    title: plain('title'),
    summary: { sv: '', en: '' },
    body: plain('text'),
    why: { sv: '', en: '' },
    places,
    evidence,
    evidenceRefs,
    refs: [...places.map((place) => place.focus), ...evidenceRefs],
  };
}

/**
 * Check one reference against the file it names at its revision. `lines` is the
 * file's content split into lines, or `null` when the file does not exist there.
 */
export function checkReference(ref: CodeReference, lines: readonly string[] | null): string | null {
  if (lines === null) {
    return `${ref.path} does not exist at ${ref.side}.`;
  }
  if (ref.end > lines.length) {
    return `${ref.path} has ${String(lines.length)} lines at ${ref.side}; the reference ends at ${String(ref.end)}.`;
  }
  if (ref.anchor !== undefined) {
    const range = lines.slice(ref.start - 1, ref.end);
    if (!range.some((line) => line.includes(ref.anchor ?? ''))) {
      return `"${ref.anchor}" does not occur in ${ref.path}:${String(ref.start)}–${String(ref.end)} at ${ref.side}.`;
    }
  }
  return null;
}

// --- The real diff ---------------------------------------------------------------

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'type-changed';

/** One hunk of `git diff -U0`: the exact changed lines, nothing else. */
export interface DiffHunk {
  /** Stable for the fixed revision pair: diff order across the whole change, from 1. */
  readonly id: string;
  readonly path: string;
  readonly baseStart: number;
  readonly baseCount: number;
  readonly targetStart: number;
  readonly targetCount: number;
}

export interface DiffFile {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly binary: boolean;
  readonly hunks: readonly DiffHunk[];
  readonly added: number;
  readonly deleted: number;
}

/** `git diff --name-status -z` output, as path and status letter. */
export function parseNameStatus(text: string): readonly { path: string; status: FileChangeStatus }[] {
  const parts = text.split('\0').filter((part) => part !== '');
  const out: { path: string; status: FileChangeStatus }[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2) {
    const letter = (parts[index] ?? '').charAt(0);
    const path = parts[index + 1] ?? '';
    const status: FileChangeStatus | null =
      letter === 'A' ? 'added' : letter === 'M' ? 'modified' : letter === 'D' ? 'deleted' : letter === 'T' ? 'type-changed' : null;
    if (status === null) {
      throw new Error(`Unexpected name-status "${parts[index] ?? ''}" for ${path}; renames and copies are not detected here.`);
    }
    out.push({ path, status });
  }
  return out;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPathPrefix(raw: string, prefix: 'a/' | 'b/'): string | null {
  // git appends a tab to a ---/+++ path containing a space.
  const trimmed = raw.replace(/\t$/, '');
  if (trimmed === '/dev/null') {
    return null;
  }
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

/**
 * Combine `--name-status` (the authority on which files changed) with `-U0` output
 * (the hunks). Every listed file must have a section, in the same order, and every
 * section must name the file it is matched to — a mismatch throws instead of
 * producing a diff that silently lacks a file.
 */
export function parseDiff(
  nameStatus: readonly { path: string; status: FileChangeStatus }[],
  unifiedZero: string,
): readonly DiffFile[] {
  const sections = unifiedZero.split(/^diff --git /m).slice(1);
  if (sections.length !== nameStatus.length) {
    throw new Error(
      `git listed ${String(nameStatus.length)} changed files but the diff has ${String(sections.length)} sections.`,
    );
  }
  let hunkNumber = 0;
  return nameStatus.map((entry, index) => {
    const section = sections[index] ?? '';
    const lines = section.split('\n');
    let binary = false;
    const hunks: DiffHunk[] = [];
    let added = 0;
    let deleted = 0;
    // File headers come before the first hunk. After it, a line that starts with
    // `--- ` is a deleted line whose text begins with `-- `, not a header.
    let inHunks = false;
    for (const line of lines) {
      if (!inHunks && line.startsWith('Binary files ')) {
        binary = true;
      } else if (!inHunks && line.startsWith('--- ')) {
        const named = stripPathPrefix(line.slice(4), 'a/');
        if (named !== null && named !== entry.path) {
          throw new Error(`Diff section ${String(index + 1)} names ${named}, expected ${entry.path}.`);
        }
      } else if (!inHunks && line.startsWith('+++ ')) {
        const named = stripPathPrefix(line.slice(4), 'b/');
        if (named !== null && named !== entry.path) {
          throw new Error(`Diff section ${String(index + 1)} names ${named}, expected ${entry.path}.`);
        }
      } else {
        const match = HUNK_HEADER.exec(line);
        if (match !== null) {
          inHunks = true;
          hunkNumber += 1;
          const baseCount = match[2] === undefined ? 1 : Number(match[2]);
          const targetCount = match[4] === undefined ? 1 : Number(match[4]);
          hunks.push({
            id: `H${String(hunkNumber)}`,
            path: entry.path,
            baseStart: Number(match[1]),
            baseCount,
            targetStart: Number(match[3]),
            targetCount,
          });
          added += targetCount;
          deleted += baseCount;
        }
      }
    }
    return { path: entry.path, status: entry.status, binary, hunks, added, deleted };
  });
}

/** Split file content into lines without their terminators. A final newline adds no line. */
export function splitLines(text: string): string[] {
  if (text === '') {
    return [];
  }
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export interface DiffRow {
  readonly kind: 'context' | 'deleted' | 'added';
  readonly baseLine: number | null;
  readonly targetLine: number | null;
  readonly text: string;
  readonly hunkId: string | null;
}

/**
 * Every line of both versions in diff order: unchanged lines once, with both line
 * numbers; deleted then added lines at each hunk. The view decides what to collapse;
 * this never drops a line. Throws if the hunks and the contents disagree, because a
 * diff drawn from inconsistent inputs would show the wrong code with confidence.
 */
export function buildDiffRows(
  baseLines: readonly string[],
  targetLines: readonly string[],
  hunks: readonly DiffHunk[],
): DiffRow[] {
  const rows: DiffRow[] = [];
  let b = 1;
  let t = 1;
  const context = (untilBase: number, untilTarget: number): void => {
    if (untilBase - b !== untilTarget - t) {
      throw new Error(
        `Hunks do not match the file contents: ${String(untilBase - b)} base and ${String(untilTarget - t)} target context lines.`,
      );
    }
    while (b < untilBase) {
      rows.push({ kind: 'context', baseLine: b, targetLine: t, text: targetLines[t - 1] ?? '', hunkId: null });
      b += 1;
      t += 1;
    }
  };
  for (const hunk of hunks) {
    // With a count of 0, git's start is the line *after which* the change happens.
    const baseFirst = hunk.baseCount === 0 ? hunk.baseStart + 1 : hunk.baseStart;
    const targetFirst = hunk.targetCount === 0 ? hunk.targetStart + 1 : hunk.targetStart;
    context(baseFirst, targetFirst);
    for (let index = 0; index < hunk.baseCount; index += 1) {
      rows.push({ kind: 'deleted', baseLine: b, targetLine: null, text: baseLines[b - 1] ?? '', hunkId: hunk.id });
      b += 1;
    }
    for (let index = 0; index < hunk.targetCount; index += 1) {
      rows.push({ kind: 'added', baseLine: null, targetLine: t, text: targetLines[t - 1] ?? '', hunkId: hunk.id });
      t += 1;
    }
  }
  context(baseLines.length + 1, targetLines.length + 1);
  return rows;
}

/**
 * The rows a reference covers, and whether any of them is a change.
 *
 * A `target` reference covers the rows with those new line numbers. Old lines come
 * with it only where the reference lies on the new lines that replaced them — the
 * first lines of a hunk, as many as it removed — or where they were removed
 * strictly inside it. A `base` reference is the mirror image. So a one-line focus
 * on a replaced line shows its before and its after; a focus deep inside a large
 * added block shows only that part of it; and a focus on unchanged code covers only
 * that code — no before/after pair is made up where none exists.
 */
export function referenceRows(
  rows: readonly DiffRow[],
  ref: { readonly side: RevisionSide; readonly start: number; readonly end: number },
): { readonly indexes: readonly number[]; readonly changed: boolean } {
  const own = (row: DiffRow): number | null => (ref.side === 'target' ? row.targetLine : row.baseLine);
  const inside = (line: number | null): boolean => line !== null && ref.start <= line && line <= ref.end;

  // Each hunk's rows on this side and on the other.
  const hunks = new Map<string, { ownRows: number[]; otherRows: number[]; firstOwn: number | null }>();
  rows.forEach((row, index) => {
    if (row.hunkId === null) {
      return;
    }
    const entry = hunks.get(row.hunkId) ?? { ownRows: [], otherRows: [], firstOwn: null };
    if (own(row) !== null) {
      entry.ownRows.push(index);
      entry.firstOwn ??= own(row);
    } else {
      entry.otherRows.push(index);
    }
    hunks.set(row.hunkId, entry);
  });

  const included = new Set<number>();
  rows.forEach((row, index) => {
    if (inside(own(row))) {
      included.add(index);
    }
  });
  for (const entry of hunks.values()) {
    if (entry.otherRows.length === 0) {
      continue;
    }
    if (entry.firstOwn !== null) {
      // A replacement: the old lines sit opposite the first new lines.
      const span = Math.min(entry.otherRows.length, entry.ownRows.length);
      if (ref.start <= entry.firstOwn + span - 1 && entry.firstOwn <= ref.end) {
        entry.otherRows.forEach((index) => included.add(index));
      }
      continue;
    }
    // Lines removed (or added) with nothing in their place on this side: inside the
    // reference only if the neighbouring lines that do exist here are both inside.
    const first = entry.otherRows[0] ?? 0;
    const last = entry.otherRows[entry.otherRows.length - 1] ?? 0;
    let before: number | null = null;
    for (let back = first - 1; back >= 0 && before === null; back -= 1) {
      before = own(rows[back] as DiffRow);
    }
    let after: number | null = null;
    for (let next = last + 1; next < rows.length && after === null; next += 1) {
      after = own(rows[next] as DiffRow);
    }
    if (before !== null && after !== null && ref.start <= before && after <= ref.end) {
      entry.otherRows.forEach((index) => included.add(index));
    }
  }
  const indexes = [...included].sort((a, b) => a - b);
  return { indexes, changed: indexes.some((index) => rows[index]?.kind !== 'context') };
}

// --- The reviewer's record ------------------------------------------------------

export interface RevisionPair {
  readonly base: string;
  readonly target: string;
}

export interface CodeLocation {
  readonly path: string;
  readonly side: RevisionSide;
  readonly start: number;
  readonly end: number;
}

/** Who made a decision. Only `human` is produced by this increment. */
export type DecisionProvenance =
  | { readonly kind: 'human' }
  /** Reserved for delegated agent review under an explicit mandate. Never simulated. */
  | { readonly kind: 'agent-delegated'; readonly adapterId: string; readonly mandate: string };

/** Changed lines on one side of a file, 1-based and inclusive. */
export interface DecisionRange {
  readonly side: RevisionSide;
  readonly start: number;
  readonly end: number;
}

/**
 * What a decision is about.
 *
 * `lines` is exact: the changed lines it names and no others (DSP-201). A walk's Accept,
 * Exempt and Withdraw use it, with the changed lines of the place's marking. `hunk` and
 * `file` are whole changes, as a walk recorded them before DSP-201; they are read as they
 * were saved, never narrowed to a marking shown now.
 */
export type DecisionScope =
  | { readonly kind: 'hunk'; readonly path: string; readonly hunkId: string }
  | { readonly kind: 'file'; readonly path: string; readonly hunkIds: readonly string[] }
  | { readonly kind: 'lines'; readonly path: string; readonly ranges: readonly DecisionRange[] };

/**
 * Where a decision was made (DSP-201): at a walk's place; in the walk window over a location
 * opened outside the walk's places (`opened`); in the diff window; or as the person's keeping
 * of an earlier decision whose intended scope was not known. Absent on decisions recorded
 * before it was kept.
 */
export type DecisionOrigin =
  | { readonly kind: 'walk'; readonly stepId: string; readonly placeId: string }
  | { readonly kind: 'opened' }
  | { readonly kind: 'diff' }
  | { readonly kind: 'kept'; readonly of: string };

export interface ReviewDecision {
  readonly id: string;
  readonly scope: DecisionScope;
  /** `withdrawn` returns the scope to remaining; the history keeps the earlier entry. */
  readonly outcome: 'accepted' | 'exempted' | 'withdrawn';
  readonly reason: string;
  readonly by: DecisionProvenance;
  readonly at: string;
  readonly revisions: RevisionPair;
  readonly origin?: DecisionOrigin;
}

/**
 * Whether a value is a decision scope: a whole hunk or file as recorded before DSP-201, or
 * exact lines — at least one range, each on a side, 1-based, start not after end.
 */
export function isDecisionScope(value: unknown): value is DecisionScope {
  if (!isRecord(value) || typeof value['path'] !== 'string' || value['path'] === '') {
    return false;
  }
  switch (value['kind']) {
    case 'hunk':
      return typeof value['hunkId'] === 'string';
    case 'file':
      return Array.isArray(value['hunkIds']) && value['hunkIds'].every((id) => typeof id === 'string');
    case 'lines':
      return (
        Array.isArray(value['ranges']) &&
        value['ranges'].length > 0 &&
        value['ranges'].every(
          (range: unknown) =>
            isRecord(range) &&
            (range['side'] === 'base' || range['side'] === 'target') &&
            Number.isInteger(range['start']) &&
            Number.isInteger(range['end']) &&
            (range['start'] as number) >= 1 &&
            (range['start'] as number) <= (range['end'] as number),
        )
      );
    default:
      return false;
  }
}

/** Whether a value is a decision origin as {@link DecisionOrigin} defines it. */
export function isDecisionOrigin(value: unknown): value is DecisionOrigin {
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value).sort().join(',');
  const text = (field: string): boolean => typeof value[field] === 'string' && value[field] !== '' && (value[field] as string).length <= 200;
  switch (value['kind']) {
    case 'walk':
      return keys === 'kind,placeId,stepId' && text('stepId') && text('placeId');
    case 'opened':
    case 'diff':
      return keys === 'kind';
    case 'kept':
      return keys === 'kind,of' && text('of');
    default:
      return false;
  }
}

export interface ReviewNote {
  readonly id: string;
  readonly kind: 'question' | 'finding';
  readonly text: string;
  readonly location: CodeLocation | null;
  readonly stepId: string | null;
  readonly status: 'open' | 'resolved';
  readonly resolution: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: RevisionPair;
}

/** Where the reviewer is. `away` keeps the walk position to return to. */
export interface ReviewPosition {
  readonly walkId: string | null;
  readonly stepId: string | null;
  readonly refIndex: number;
  readonly away: CodeLocation | null;
  readonly codeMode: 'diff' | 'file';
}

export interface ReviewState {
  readonly version: 1;
  readonly revisions: RevisionPair;
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly position: ReviewPosition;
  /** Step id → when it was first opened. Being shown is not being reviewed. */
  readonly shownSteps: Readonly<Record<string, string>>;
  /**
   * `stepId@placeId` → when that place was first on screen. Coverage counts these,
   * so a step's second place is not "opened" until it has been. Keys from an older
   * definition (`stepId#index`) are kept in the record but match nothing.
   */
  readonly shownRefs: Readonly<Record<string, string>>;
  /** How the reviewer has arranged the view. Never affects progress or decisions. */
  readonly ui: ReviewUi;
  /**
   * Hashes of earlier walk definitions this record was used with, oldest first.
   * Kept so a change of the prepared walks stays visible after the first notice.
   */
  readonly previousDefinitionHashes: readonly string[];
  /** Step id → when the reviewer marked it walked through. Not an acceptance. */
  readonly walkedSteps: Readonly<Record<string, string>>;
  /**
   * Step id → a hash of the step's texts and places under the definition this record
   * was last used with. When the walks change, a mark is carried only for a step whose
   * hash is the same: the same id is not enough.
   */
  readonly stepHashes: Readonly<Record<string, string>>;
  /** Marks set aside when the walks changed, oldest first. History, not current progress. */
  readonly markHistory: readonly MarkHistoryEntry[];
  readonly decisions: readonly ReviewDecision[];
  readonly notes: readonly ReviewNote[];
  readonly savedAt: string;
}

export interface MarkHistoryEntry {
  /** The definition the marks were made under. */
  readonly definitionHash: string;
  readonly movedAt: string;
  readonly shownSteps: Readonly<Record<string, string>>;
  readonly shownRefs: Readonly<Record<string, string>>;
  readonly walkedSteps: Readonly<Record<string, string>>;
}

export interface ReviewUi {
  /** Walks expanded in the walk list. */
  readonly openWalks: readonly string[];
  /** The light purple overview of every place in the current walk. */
  readonly highlightWalk: boolean;
  /** How much code a place shows: the change, its unit (default), or the whole file. */
  readonly level?: CodeLevel;
  /**
   * Whether long lines wrap in the code panes, chosen apart for Markdown and for other
   * files. Absent: Markdown wraps, code does not ({@link wrapsLines}).
   */
  readonly wrap?: { readonly markdown: boolean; readonly code: boolean };
  /** The presentation profile chosen for this walk; a stored Original is read as the default now (DSP-181). */
  readonly presentationProfile?: PresentationProfile;
}

/** Markdown and plain prose, where a line is a paragraph rather than a statement. */
export function isProsePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt|rst|adoc)$/i.test(path);
}

/** Whether a file's long lines wrap in the code panes, by the reviewer's choice or the default. */
export function wrapsLines(ui: Pick<ReviewUi, 'wrap'>, path: string): boolean {
  const prose = isProsePath(path);
  return ui.wrap === undefined ? prose : prose ? ui.wrap.markdown : ui.wrap.code;
}

export type CodeLevel = 'change' | 'unit' | 'file';

export const DEFAULT_UI: ReviewUi = { openWalks: [], highlightWalk: false };

/** The key of an "opened" mark for a place. */
export function placeKey(stepId: string, placeId: string): string {
  return `${stepId}@${placeId}`;
}

export function emptyReviewState(revisions: RevisionPair, definitionPath: string, definitionHash: string): ReviewState {
  return {
    version: 1,
    revisions,
    definitionPath,
    definitionHash,
    position: { walkId: null, stepId: null, refIndex: 0, away: null, codeMode: 'diff' },
    shownSteps: {},
    shownRefs: {},
    ui: DEFAULT_UI,
    previousDefinitionHashes: [],
    walkedSteps: {},
    stepHashes: {},
    markHistory: [],
    decisions: [],
    notes: [],
    savedAt: '',
  };
}

/**
 * Accept a stored state only for the same revision pair. A record about other code
 * is not silently applied to this code (VISION §3, "Earlier approval must not
 * automatically apply to later code").
 */
export function adoptStoredState(raw: unknown, revisions: RevisionPair): ReviewState | null {
  if (!isRecord(raw) || raw['version'] !== 1) {
    return null;
  }
  const stored = raw['revisions'];
  if (!isRecord(stored) || stored['base'] !== revisions.base || stored['target'] !== revisions.target) {
    return null;
  }
  const position = raw['position'];
  const stringMap = (value: unknown): value is Record<string, string> =>
    isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
  if (
    !isRecord(position) ||
    (position['stepId'] !== null && typeof position['stepId'] !== 'string') ||
    typeof position['refIndex'] !== 'number' ||
    (position['codeMode'] !== 'diff' && position['codeMode'] !== 'file') ||
    !stringMap(raw['shownSteps']) ||
    !stringMap(raw['walkedSteps']) ||
    (raw['shownRefs'] !== undefined && !stringMap(raw['shownRefs'])) ||
    (raw['ui'] !== undefined && !isUi(raw['ui'])) ||
    (raw['previousDefinitionHashes'] !== undefined &&
      !(Array.isArray(raw['previousDefinitionHashes']) && raw['previousDefinitionHashes'].every((entry) => typeof entry === 'string'))) ||
    (raw['stepHashes'] !== undefined && !stringMap(raw['stepHashes'])) ||
    (raw['markHistory'] !== undefined && !(Array.isArray(raw['markHistory']) && raw['markHistory'].every(isMarkHistoryEntry))) ||
    !Array.isArray(raw['decisions']) ||
    !Array.isArray(raw['notes']) ||
    typeof raw['definitionHash'] !== 'string'
  ) {
    return null;
  }
  return {
    ...(raw as unknown as ReviewState),
    shownRefs: (raw['shownRefs'] as Record<string, string> | undefined) ?? {},
    ui: (raw['ui'] as ReviewUi | undefined) ?? DEFAULT_UI,
    previousDefinitionHashes: (raw['previousDefinitionHashes'] as string[] | undefined) ?? [],
    stepHashes: (raw['stepHashes'] as Record<string, string> | undefined) ?? {},
    markHistory: (raw['markHistory'] as MarkHistoryEntry[] | undefined) ?? [],
  };
}

function isUi(value: unknown): value is ReviewUi {
  return (
    isRecord(value) &&
    Array.isArray(value['openWalks']) &&
    value['openWalks'].every((entry) => typeof entry === 'string') &&
    typeof value['highlightWalk'] === 'boolean' &&
    (value['level'] === undefined || value['level'] === 'change' || value['level'] === 'unit' || value['level'] === 'file') &&
    (value['presentationProfile'] === undefined || isProfile(value['presentationProfile'])) &&
    (value['wrap'] === undefined ||
      (isRecord(value['wrap']) && typeof value['wrap']['markdown'] === 'boolean' && typeof value['wrap']['code'] === 'boolean'))
  );
}

function isStringMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isMarkHistoryEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['definitionHash'] === 'string' &&
    typeof entry['movedAt'] === 'string' &&
    isStringMap(entry['shownSteps']) &&
    isStringMap(entry['shownRefs']) &&
    isStringMap(entry['walkedSteps'])
  );
}

/** A short, stable hash of a string (FNV-1a, two seeds). A change detector, not a secret. */
function contentHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Everything a step says and shows: all its texts, and its places' focus, context, unit and link. */
export function stepContentHash(step: WalkStep): string {
  return contentHash(
    JSON.stringify({
      title: step.title,
      summary: step.summary,
      body: step.body,
      why: step.why,
      ...(step.details === undefined ? {} : { details: step.details }),
      // Only where there is one, so steps without it keep their hash (DSP-185).
      ...(step.together === undefined ? {} : { together: step.together }),
      ...(step.revisit === undefined ? {} : { revisit: step.revisit }),
      evidence: step.evidence,
      evidenceRefs: step.evidenceRefs,
      places: step.places.map((place) => ({
        id: place.id,
        label: place.label,
        focus: place.focus,
        context: place.context,
        // A counterpart counts only where there is one, so steps without one keep their hash.
        unit:
          place.unit === null
            ? null
            : { ref: place.unit.ref, kind: place.unit.kind, name: place.unit.name, ...(place.unit.counterpart === null ? {} : { counterpart: place.unit.counterpart }) },
        from: place.from === null ? null : { ref: place.from.ref, label: place.from.label },
      })),
      // Only where there are any, so steps without them keep their hash (DSP-175).
      ...(step.contextPlaces === undefined || step.contextPlaces.length === 0 ? {} : { contextPlaces: step.contextPlaces }),
    }),
  );
}

export function stepHashesOf(definition: ReviewDefinition): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const walk of definition.walks) {
    for (const step of walk.steps) {
      hashes[step.id] = stepContentHash(step);
    }
  }
  return hashes;
}

/**
 * The record under a changed definition. A step's opened and walked marks are carried
 * only when its content hash is unchanged; every other mark is set aside as history.
 * Opened is registered again when the step is opened under the new walks; walked
 * needs the reviewer's own mark again. Notes and decisions are not touched.
 */
export function carryStepMarks(
  definition: ReviewDefinition,
  stored: ReviewState,
  definitionHash: string,
  movedAt: string,
): { readonly state: ReviewState; readonly carried: number; readonly moved: number } {
  const hashes = stepHashesOf(definition);
  const places = new Set(
    definition.walks.flatMap((walk) => walk.steps.flatMap((step) => step.places.map((place) => placeKey(step.id, place.id)))),
  );
  const unchanged = (stepId: string): boolean => stored.stepHashes[stepId] !== undefined && stored.stepHashes[stepId] === hashes[stepId];
  const split = <T>(entries: Readonly<Record<string, T>>, keep: (key: string) => boolean): [Record<string, T>, Record<string, T>] => {
    const kept: Record<string, T> = {};
    const moved: Record<string, T> = {};
    for (const [key, value] of Object.entries(entries)) {
      (keep(key) ? kept : moved)[key] = value;
    }
    return [kept, moved];
  };
  const [shownSteps, movedShownSteps] = split(stored.shownSteps, unchanged);
  const [walkedSteps, movedWalkedSteps] = split(stored.walkedSteps, unchanged);
  const [shownRefs, movedShownRefs] = split(stored.shownRefs, (key) => places.has(key) && unchanged(key.slice(0, key.indexOf('@'))));
  const movedIds = new Set([...Object.keys(movedShownSteps), ...Object.keys(movedWalkedSteps)]);
  const carriedIds = new Set([...Object.keys(shownSteps), ...Object.keys(walkedSteps)]);
  const entry: MarkHistoryEntry = {
    definitionHash: stored.definitionHash,
    movedAt,
    shownSteps: movedShownSteps,
    shownRefs: movedShownRefs,
    walkedSteps: movedWalkedSteps,
  };
  const anythingMoved = movedIds.size > 0 || Object.keys(movedShownRefs).length > 0;
  return {
    state: {
      ...stored,
      definitionHash,
      previousDefinitionHashes: [...stored.previousDefinitionHashes, stored.definitionHash],
      shownSteps,
      shownRefs,
      walkedSteps,
      stepHashes: hashes,
      markHistory: anythingMoved ? [...stored.markHistory, entry] : stored.markHistory,
    },
    carried: carriedIds.size,
    moved: movedIds.size,
  };
}

/** "Opened" marks that name no place of this definition: kept, but not counted. */
export function staleOpenedMarks(definition: ReviewDefinition, state: ReviewState): number {
  const known = new Set(
    definition.walks.flatMap((walk) => walk.steps.flatMap((step) => step.places.map((place) => placeKey(step.id, place.id)))),
  );
  return Object.keys(state.shownRefs).filter((key) => !known.has(key)).length;
}

/**
 * The latest whole-change decision for each hunk, from `hunk` and `file` scopes: how a walk
 * decided before DSP-201. Exact decisions are read line by line with {@link currentLineDecisions}.
 */
export function currentHunkDecisions(
  decisions: readonly ReviewDecision[],
): ReadonlyMap<string, ReviewDecision> {
  const current = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    const ids = decision.scope.kind === 'hunk' ? [decision.scope.hunkId] : decision.scope.kind === 'file' ? decision.scope.hunkIds : [];
    for (const id of ids) {
      if (decision.outcome === 'withdrawn') {
        current.delete(id);
      } else {
        current.set(id, decision);
      }
    }
  }
  return current;
}

/** The key of one changed line: its side, path and number. */
export function changedLineKey(path: string, side: RevisionSide, line: number): string {
  return `${side}\0${path}\0${String(line)}`;
}

/** A hunk's changed lines as ranges: its removed lines on `base`, its added lines on `target`. */
export function hunkLocations(hunk: DiffHunk): CodeLocation[] {
  const locations: CodeLocation[] = [];
  if (hunk.baseCount > 0) {
    locations.push({ path: hunk.path, side: 'base', start: hunk.baseStart, end: hunk.baseStart + hunk.baseCount - 1 });
  }
  if (hunk.targetCount > 0) {
    locations.push({ path: hunk.path, side: 'target', start: hunk.targetStart, end: hunk.targetStart + hunk.targetCount - 1 });
  }
  return locations;
}

/**
 * The lines a decision's scope names, as ranges. A whole-hunk or file scope names every
 * changed line of its hunks, as it was recorded; an exact scope only its own ranges.
 */
export function scopeLocations(scope: DecisionScope, hunks: ReadonlyMap<string, DiffHunk>): CodeLocation[] {
  if (scope.kind === 'lines') {
    return scope.ranges.map((range) => ({ path: scope.path, ...range }));
  }
  const ids = scope.kind === 'hunk' ? [scope.hunkId] : scope.hunkIds;
  return ids.flatMap((id) => {
    const hunk = hunks.get(id);
    return hunk === undefined ? [] : hunkLocations(hunk);
  });
}

function hunksById(files: readonly DiffFile[]): Map<string, DiffHunk> {
  return new Map(files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, hunk] as const)));
}

/**
 * The decision that holds for each line, keyed by {@link changedLineKey}: the latest entry
 * whose scope names the line, a withdrawal returning it to remaining. A line named by several
 * decisions holds one of them, so overlapping decisions never count a line twice.
 */
export function currentLineDecisions(
  decisions: readonly ReviewDecision[],
  files: readonly DiffFile[],
): ReadonlyMap<string, ReviewDecision> {
  const hunks = hunksById(files);
  const current = new Map<string, ReviewDecision>();
  for (const decision of decisions) {
    for (const location of scopeLocations(decision.scope, hunks)) {
      for (let line = location.start; line <= location.end; line += 1) {
        const key = changedLineKey(location.path, location.side, line);
        if (decision.outcome === 'withdrawn') {
          current.delete(key);
        } else {
          current.set(key, decision);
        }
      }
    }
  }
  return current;
}

/** The changed lines a walk's marking covers, as one exact decision scope. */
export interface MarkedLines {
  readonly path: string;
  readonly ranges: readonly DecisionRange[];
  /** How many changed lines the ranges hold. */
  readonly lines: number;
}

/**
 * The changed rows of a place (DSP-201, DSP-202): of the rows {@link referenceRows} gives for
 * the focus, the added and removed ones. This is the one definition a walk marks, flashes on
 * arrival and decides about. Unchanged rows inside the reference are not among them, and
 * nothing shown around it (context, *Show more*, the whole file, scrolling, another place)
 * is: the rows come from the reference alone.
 *
 * Removed rows come with a place at To exactly as `referenceRows` pairs them: the old lines a
 * replacement put the new ones in place of, where the place lies on those new lines, and lines
 * removed strictly inside it. Other removals of the same hunk are not the place's. A place at
 * From is the mirror image.
 */
export function markedChangedRows(
  rows: readonly DiffRow[],
  focus: { readonly side: RevisionSide; readonly start: number; readonly end: number },
): readonly number[] {
  return referenceRows(rows, focus).indexes.filter((index) => rows[index]?.kind === 'added' || rows[index]?.kind === 'deleted');
}

/** A place's changed rows as one exact decision scope: removed lines on `base`, added on `target`. */
export function markedChangedLines(
  rows: readonly DiffRow[],
  focus: { readonly path: string; readonly side: RevisionSide; readonly start: number; readonly end: number },
): MarkedLines {
  const base: number[] = [];
  const target: number[] = [];
  for (const index of markedChangedRows(rows, focus)) {
    const row = rows[index];
    if (row?.kind === 'deleted' && row.baseLine !== null) {
      base.push(row.baseLine);
    } else if (row?.kind === 'added' && row.targetLine !== null) {
      target.push(row.targetLine);
    }
  }
  const ranges: DecisionRange[] = [];
  for (const [side, lines] of [['base', base], ['target', target]] as const) {
    for (const line of [...lines].sort((a, b) => a - b)) {
      const last = ranges.at(-1);
      if (last !== undefined && last.side === side && last.end + 1 >= line) {
        ranges[ranges.length - 1] = { ...last, end: Math.max(last.end, line) };
      } else {
        ranges.push({ side, start: line, end: line });
      }
    }
  }
  return { path: focus.path, ranges, lines: base.length + target.length };
}

/**
 * The rows of a file's diff without its text: the kinds and line numbers {@link buildDiffRows}
 * gives, built from the hunks alone. Which rows a reference covers depends on nothing else, so
 * {@link markedChangedLines} over these rows is the same as over the file's own. Unchanged lines
 * run on past the last hunk at least to `needBase` and `needTarget`, the furthest lines asked about.
 */
export function diffSkeletonRows(hunks: readonly DiffHunk[], needBase: number, needTarget: number): DiffRow[] {
  let base = 1;
  let target = 1;
  for (const hunk of hunks) {
    base = (hunk.baseCount === 0 ? hunk.baseStart + 1 : hunk.baseStart) + hunk.baseCount;
    target = (hunk.targetCount === 0 ? hunk.targetStart + 1 : hunk.targetStart) + hunk.targetCount;
  }
  const after = Math.max(needBase - base + 2, needTarget - target + 2, 1);
  return buildDiffRows(new Array<string>(base - 1 + after).fill(''), new Array<string>(target - 1 + after).fill(''), hunks);
}

/**
 * The changed lines a walk's places cover (DSP-203): the union of every place's
 * {@link markedChangedLines}, the lines its Accept decides about, merged per file and side so a
 * line two places share counts once. Context places, references, callers and other walks are
 * not among them; a place in a file the diff does not change covers nothing.
 */
export function walkChangedLines(walk: Pick<Walk, 'steps'>, files: readonly DiffFile[]): CodeLocation[] {
  const byFile = new Map(files.map((file) => [file.path, file] as const));
  const lines = new Map<string, Set<number>>();
  for (const step of walk.steps) {
    for (const place of step.places) {
      const file = byFile.get(place.focus.path);
      if (file === undefined || file.binary) {
        continue;
      }
      const rows = diffSkeletonRows(file.hunks, place.focus.side === 'base' ? place.focus.end : 0, place.focus.side === 'target' ? place.focus.end : 0);
      for (const range of markedChangedLines(rows, place.focus).ranges) {
        const key = `${range.side}\0${place.focus.path}`;
        const set = lines.get(key) ?? new Set<number>();
        for (let line = range.start; line <= range.end; line += 1) {
          set.add(line);
        }
        lines.set(key, set);
      }
    }
  }
  const out: CodeLocation[] = [];
  for (const [key, set] of [...lines].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [side, path] = key.split('\0') as [RevisionSide, string];
    for (const line of [...set].sort((a, b) => a - b)) {
      const last = out.at(-1);
      if (last !== undefined && last.path === path && last.side === side && last.end + 1 === line) {
        out[out.length - 1] = { ...last, end: line };
      } else {
        out.push({ path, side, start: line, end: line });
      }
    }
  }
  return out;
}

/** The lines of `locations` on which nothing holds: no decision of the person's and no accepted delegated assessment. */
export function undecidedLines(locations: readonly CodeLocation[], holds: HoldsAt): CodeLocation[] {
  const out: CodeLocation[] = [];
  for (const location of locations) {
    for (let line = location.start; line <= location.end; line += 1) {
      if (holds(location.path, location.side, line) !== null) {
        continue;
      }
      const last = out.at(-1);
      if (last !== undefined && last.path === location.path && last.side === location.side && last.end + 1 === line) {
        out[out.length - 1] = { ...last, end: line };
      } else {
        out.push({ path: location.path, side: location.side, start: line, end: line });
      }
    }
  }
  return out;
}

/** How many lines a set of ranges holds. */
export function lineCount(locations: readonly { readonly start: number; readonly end: number }[]): number {
  return locations.reduce((total, location) => total + location.end - location.start + 1, 0);
}

/** A decision as it holds for a line, whichever record keeps it (the walk's own or the pair's). */
export interface HeldDecision {
  readonly id: string;
  readonly outcome: 'accepted' | 'exempted';
  readonly by: DecisionProvenance;
  readonly at: string;
  readonly reason: string;
  /** The lines it was recorded over. */
  readonly over: readonly CodeLocation[];
  /**
   * Recorded over a whole change, or without saying where it was made, before a walk's
   * Accept followed its marking (DSP-201): whether it was meant for all of `over` is not known.
   */
  readonly scopeUncertain: boolean;
}

/** A walk decision as a held decision: an exact scope is certain, a whole hunk or file is not. */
export function heldOf(decision: ReviewDecision, files: readonly DiffFile[]): HeldDecision | null {
  if (decision.outcome === 'withdrawn') {
    return null;
  }
  return {
    id: decision.id,
    outcome: decision.outcome,
    by: decision.by,
    at: decision.at,
    reason: decision.reason,
    over: scopeLocations(decision.scope, hunksById(files)),
    scopeUncertain: decision.scope.kind !== 'lines',
  };
}

/** What holds over a place's marked lines, for the walk's Review section. */
export interface PlaceDecisionView {
  readonly marked: MarkedLines;
  readonly accepted: number;
  readonly exempted: number;
  readonly remaining: number;
  /**
   * Each decision holding on a marked line, once, in line order: on how many lines here,
   * and on how many changed lines outside the marking it still holds.
   */
  readonly held: readonly { readonly decision: HeldDecision; readonly here: number; readonly beyond: number }[];
}

export type HoldsAt = (path: string, side: RevisionSide, line: number) => HeldDecision | null;

/** The lines of `over` where `decision` still holds, as ranges. */
export function stillHeld(decision: HeldDecision, holds: HoldsAt): CodeLocation[] {
  const out: CodeLocation[] = [];
  for (const location of decision.over) {
    for (let line = location.start; line <= location.end; line += 1) {
      if (holds(location.path, location.side, line)?.id !== decision.id) {
        continue;
      }
      const last = out.at(-1);
      if (last !== undefined && last.path === location.path && last.side === location.side && last.end + 1 === line) {
        out[out.length - 1] = { ...last, end: line };
      } else {
        out.push({ path: location.path, side: location.side, start: line, end: line });
      }
    }
  }
  return out;
}

export function placeDecisionView(marked: MarkedLines, holds: HoldsAt): PlaceDecisionView {
  let accepted = 0;
  let exempted = 0;
  const here = new Map<string, { decision: HeldDecision; here: number }>();
  const inside = new Set<string>();
  for (const range of marked.ranges) {
    for (let line = range.start; line <= range.end; line += 1) {
      inside.add(changedLineKey(marked.path, range.side, line));
      const decision = holds(marked.path, range.side, line);
      if (decision === null) {
        continue;
      }
      if (decision.outcome === 'accepted') {
        accepted += 1;
      } else {
        exempted += 1;
      }
      const entry = here.get(decision.id) ?? { decision, here: 0 };
      entry.here += 1;
      here.set(decision.id, entry);
    }
  }
  const held = [...here.values()].map((entry) => ({
    ...entry,
    beyond: stillHeld(entry.decision, holds)
      .flatMap((location) => Array.from({ length: location.end - location.start + 1 }, (_, offset) => changedLineKey(location.path, location.side, location.start + offset)))
      .filter((key) => !inside.has(key)).length,
  }));
  return { marked, accepted, exempted, remaining: marked.lines - accepted - exempted, held };
}

// --- Coverage ----------------------------------------------------------------------

export type PlanState = 'full' | 'partial' | 'none';

export interface HunkCoverage {
  readonly hunk: DiffHunk;
  /** Changed lines in the hunk: deletions plus additions. */
  readonly lines: number;
  readonly planned: PlanState;
  readonly plannedBy: readonly string[];
  readonly shown: PlanState;
  readonly walked: PlanState;
  /** The one decision holding on every changed line of the hunk, or `null` when none or several do. */
  readonly decision: ReviewDecision | null;
  /** Changed lines of the hunk an accepting or exempting decision holds on (DSP-201: exact lines, not the hunk). */
  readonly acceptedLines: number;
  readonly exemptedLines: number;
  readonly openFindings: number;
  readonly openQuestions: number;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * How far a set of walk references covers one hunk.
 *
 * A hunk with added lines is covered by `target` references over those lines; its
 * deleted lines are shown in the same place and follow it. A pure deletion is
 * covered by a `base` reference over the removed lines, or by a `target` reference
 * that spans the point where they were removed. `full` means every added line (or
 * the deletion) is inside a reference; `partial` means some of it.
 */
export function hunkPlanState(hunk: DiffHunk, refs: readonly CodeReference[]): PlanState {
  const own = refs.filter((ref) => ref.path === hunk.path && ref.role === 'walk');
  if (hunk.targetCount > 0) {
    let covered = 0;
    for (let line = hunk.targetStart; line < hunk.targetStart + hunk.targetCount; line += 1) {
      if (own.some((ref) => ref.side === 'target' && ref.start <= line && line <= ref.end)) {
        covered += 1;
      }
    }
    if (covered === 0) {
      // Deleted lines of a mixed hunk named directly on the base side still count.
      const baseHit = own.some(
        (ref) =>
          ref.side === 'base' &&
          hunk.baseCount > 0 &&
          overlaps(ref.start, ref.end, hunk.baseStart, hunk.baseStart + hunk.baseCount - 1),
      );
      return baseHit ? 'partial' : 'none';
    }
    return covered === hunk.targetCount ? 'full' : 'partial';
  }
  // Pure deletion.
  const baseEnd = hunk.baseStart + hunk.baseCount - 1;
  let covered = 0;
  for (let line = hunk.baseStart; line <= baseEnd; line += 1) {
    if (own.some((ref) => ref.side === 'base' && ref.start <= line && line <= ref.end)) {
      covered += 1;
    }
  }
  const spanned = own.some(
    (ref) => ref.side === 'target' && ref.start <= hunk.targetStart && hunk.targetStart + 1 <= ref.end,
  );
  if (spanned || covered === hunk.baseCount) {
    return 'full';
  }
  return covered > 0 ? 'partial' : 'none';
}

export interface CoverageSummary {
  readonly hunks: readonly HunkCoverage[];
  readonly totalLines: number;
  readonly plannedLines: { readonly full: number; readonly partialHunks: number };
  readonly shownLines: { readonly full: number; readonly partialHunks: number };
  readonly walkedLines: { readonly full: number; readonly partialHunks: number };
  readonly acceptedLines: number;
  readonly exemptedLines: number;
  readonly remainingLines: number;
  readonly openFindings: number;
  readonly openQuestions: number;
}

function stepRefs(definition: ReviewDefinition, stepIds: ReadonlySet<string> | null): CodeReference[] {
  const refs: CodeReference[] = [];
  for (const walk of definition.walks) {
    for (const step of walk.steps) {
      if (stepIds === null || stepIds.has(step.id)) {
        refs.push(...step.refs);
      }
    }
  }
  return refs;
}

/**
 * The focus of every place that has been on screen. Context is not counted: it is
 * shown only when the reviewer asks for it.
 */
function shownReferences(definition: ReviewDefinition, shown: Readonly<Record<string, string>>): CodeReference[] {
  const refs: CodeReference[] = [];
  for (const walk of definition.walks) {
    for (const step of walk.steps) {
      for (const place of step.places) {
        if (shown[placeKey(step.id, place.id)] !== undefined) {
          refs.push(place.focus);
        }
      }
    }
  }
  return refs;
}

function noteTouchesHunk(note: ReviewNote, hunk: DiffHunk): boolean {
  const location = note.location;
  if (location === null || location.path !== hunk.path) {
    return false;
  }
  if (location.side === 'target') {
    return hunk.targetCount > 0
      ? overlaps(location.start, location.end, hunk.targetStart, hunk.targetStart + hunk.targetCount - 1)
      : overlaps(location.start, location.end, hunk.targetStart, hunk.targetStart + 1);
  }
  return hunk.baseCount > 0 && overlaps(location.start, location.end, hunk.baseStart, hunk.baseStart + hunk.baseCount - 1);
}

/**
 * Coverage of every hunk, from the definition (planned), the reviewer's progress
 * (shown, walked) and their record (decisions, notes). Lines are the diff's changed
 * lines; a line in several walks counts once.
 */
export function computeCoverage(
  definition: ReviewDefinition,
  files: readonly DiffFile[],
  state: ReviewState,
): CoverageSummary {
  const allRefs = stepRefs(definition, null);
  const shownRefs = shownReferences(definition, state.shownRefs);
  const walkedRefs = stepRefs(definition, new Set(Object.keys(state.walkedSteps)));
  const decisions = currentLineDecisions(state.decisions, files);
  const hunks: HunkCoverage[] = [];
  for (const file of files) {
    for (const hunk of file.hunks) {
      const plannedBy: string[] = [];
      for (const walk of definition.walks) {
        for (const step of walk.steps) {
          if (hunkPlanState(hunk, step.refs) !== 'none') {
            plannedBy.push(step.id);
          }
        }
      }
      const notes = state.notes.filter((note) => note.status === 'open' && noteTouchesHunk(note, hunk));
      const held = hunkLocations(hunk).flatMap((location) =>
        Array.from({ length: location.end - location.start + 1 }, (_, offset) => decisions.get(changedLineKey(location.path, location.side, location.start + offset)) ?? null),
      );
      const first = held[0] ?? null;
      hunks.push({
        hunk,
        lines: hunk.baseCount + hunk.targetCount,
        planned: hunkPlanState(hunk, allRefs),
        plannedBy,
        shown: hunkPlanState(hunk, shownRefs),
        walked: hunkPlanState(hunk, walkedRefs),
        decision: first !== null && held.every((entry) => entry === first) ? first : null,
        acceptedLines: held.filter((entry) => entry?.outcome === 'accepted').length,
        exemptedLines: held.filter((entry) => entry?.outcome === 'exempted').length,
        openFindings: notes.filter((note) => note.kind === 'finding').length,
        openQuestions: notes.filter((note) => note.kind === 'question').length,
      });
    }
  }
  const sum = (pick: (entry: HunkCoverage) => PlanState): { full: number; partialHunks: number } => ({
    full: hunks.filter((entry) => pick(entry) === 'full').reduce((total, entry) => total + entry.lines, 0),
    partialHunks: hunks.filter((entry) => pick(entry) === 'partial').length,
  });
  const decided = (outcome: 'accepted' | 'exempted'): number =>
    hunks.reduce((total, entry) => total + (outcome === 'accepted' ? entry.acceptedLines : entry.exemptedLines), 0);
  const totalLines = hunks.reduce((total, entry) => total + entry.lines, 0);
  const acceptedLines = decided('accepted');
  const exemptedLines = decided('exempted');
  return {
    hunks,
    totalLines,
    plannedLines: sum((entry) => entry.planned),
    shownLines: sum((entry) => entry.shown),
    walkedLines: sum((entry) => entry.walked),
    acceptedLines,
    exemptedLines,
    remainingLines: totalLines - acceptedLines - exemptedLines,
    openFindings: state.notes.filter((note) => note.status === 'open' && note.kind === 'finding').length,
    openQuestions: state.notes.filter((note) => note.status === 'open' && note.kind === 'question').length,
  };
}

// --- Syntax highlighting -------------------------------------------------------------

export type TokenKind = 'plain' | 'keyword' | 'string' | 'comment' | 'number';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

const KEYWORDS = new Set(
  (
    'abstract as async await break case catch class const continue debugger declare default delete do else ' +
    'enum export extends false finally for from function get if implements import in instanceof interface ' +
    'keyof let new null of private protected public readonly return satisfies set static super switch this ' +
    'throw true try type typeof undefined unknown var void while yield never number string boolean'
  ).split(' '),
);

const HIGHLIGHTED = /\.(?:[cm]?[jt]sx?)$/i;

export function isHighlighted(path: string): boolean {
  return HIGHLIGHTED.test(path);
}

/**
 * A small lexer for TypeScript and JavaScript: comments, strings, numbers and
 * keywords, with block comments and template strings carried across lines. It is
 * a reading aid, not a parser — regular expressions and nested template
 * expressions are not understood — and a file it does not recognise is shown plain.
 */
export function highlightLines(lines: readonly string[], path: string): Token[][] {
  if (!isHighlighted(path)) {
    return lines.map((line) => [{ kind: 'plain', text: line }]);
  }
  let carry: 'block-comment' | 'template' | null = null;
  return lines.map((line) => {
    const tokens: Token[] = [];
    const push = (kind: TokenKind, text: string): void => {
      if (text === '') {
        return;
      }
      const last = tokens[tokens.length - 1];
      if (last !== undefined && last.kind === kind) {
        tokens[tokens.length - 1] = { kind, text: last.text + text };
      } else {
        tokens.push({ kind, text });
      }
    };
    let index = 0;
    if (carry === 'block-comment') {
      const close = line.indexOf('*/');
      if (close === -1) {
        push('comment', line);
        return tokens;
      }
      push('comment', line.slice(0, close + 2));
      index = close + 2;
      carry = null;
    } else if (carry === 'template') {
      const close = findClosingQuote(line, 0, '`');
      if (close === -1) {
        push('string', line);
        return tokens;
      }
      push('string', line.slice(0, close + 1));
      index = close + 1;
      carry = null;
    }
    while (index < line.length) {
      const rest = line.slice(index);
      const char = line.charAt(index);
      if (rest.startsWith('//')) {
        push('comment', rest);
        break;
      }
      if (rest.startsWith('/*')) {
        const close = line.indexOf('*/', index + 2);
        if (close === -1) {
          push('comment', rest);
          carry = 'block-comment';
          break;
        }
        push('comment', line.slice(index, close + 2));
        index = close + 2;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        const close = findClosingQuote(line, index + 1, char);
        if (close === -1) {
          push('string', rest);
          if (char === '`') {
            carry = 'template';
          }
          break;
        }
        push('string', line.slice(index, close + 1));
        index = close + 1;
        continue;
      }
      const number = /^(?:0[xXbBoO][\da-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)n?/.exec(rest);
      if (number !== null && !/[\w$]/.test(line.charAt(index - 1))) {
        push('number', number[0]);
        index += number[0].length;
        continue;
      }
      const word = /^[A-Za-z_$][\w$]*/.exec(rest);
      if (word !== null) {
        push(KEYWORDS.has(word[0]) ? 'keyword' : 'plain', word[0]);
        index += word[0].length;
        continue;
      }
      push('plain', char);
      index += 1;
    }
    return tokens;
  });
}

function findClosingQuote(line: string, from: number, quote: string): number {
  for (let index = from; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (char === '\\') {
      index += 1;
    } else if (char === quote) {
      return index;
    }
  }
  return -1;
}

// --- The bridge between the main process and the view ------------------------------

/**
 * The review surface's IPC channels. `review-preload.ts` repeats them as literals
 * because the sandboxed preload cannot load this module; a test compares the two.
 * The main process answers them only for windows it opened as review windows.
 */
export const REVIEW_CHANNELS = {
  initial: 'dspatch:review-initial',
  choose: 'dspatch:review-choose',
  reread: 'dspatch:review-reread',
  readFile: 'dspatch:review-read-file',
  listFiles: 'dspatch:review-list-files',
  search: 'dspatch:review-search',
  saveState: 'dspatch:review-save-state',
  getPreferences: 'dspatch:review-get-preferences',
  setPreferences: 'dspatch:review-set-preferences',
} as const;

/** The reviewer's own preferences, across reviews. */
export interface ReviewPreferences {
  readonly language: Lang;
  /** DSP-152: the width of the walk window's explanation column, as the reviewer left it, in pixels. */
  readonly explanationWidth?: number;
  /** The width of the walk window's left column (walks, About the change, files), in pixels. */
  readonly navigationWidth?: number;
  /** The walk window's explanation in a window of its own (30 October 2026); docked when absent. */
  readonly explanationDetached?: true;
  /** Where that window was last left, in screen coordinates; checked against the screens when it opens. */
  readonly explanationBounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /**
   * Where the review's panel was last put (30 October 2026): docked in the diff window or the
   * walk window. Absent: its own window, the default; also when that window is not open.
   */
  readonly discussionPlace?: 'diff' | 'walk';
}

export const DEFAULT_PREFERENCES: ReviewPreferences = { language: 'en' };

/** The widths the explanation column may be given. */
export const EXPLANATION_WIDTH = { min: 300, max: 1100, initial: 520 } as const;

/** The widths the left column may be given (Niclas's trial feedback, 29 October 2026). */
export const NAVIGATION_WIDTH = { min: 220, max: 720, initial: 340 } as const;

export function adoptPreferences(raw: unknown): ReviewPreferences {
  if (!isRecord(raw) || (raw['language'] !== 'sv' && raw['language'] !== 'en')) {
    return DEFAULT_PREFERENCES;
  }
  const within = (value: unknown, bounds: { readonly min: number; readonly max: number }): value is number =>
    Number.isInteger(value) && (value as number) >= bounds.min && (value as number) <= bounds.max;
  const width = raw['explanationWidth'];
  const navigation = raw['navigationWidth'];
  return {
    language: raw['language'],
    ...(within(width, EXPLANATION_WIDTH) ? { explanationWidth: width } : {}),
    ...(within(navigation, NAVIGATION_WIDTH) ? { navigationWidth: navigation } : {}),
    ...(raw['explanationDetached'] === true ? { explanationDetached: true as const } : {}),
    ...(raw['discussionPlace'] === 'diff' || raw['discussionPlace'] === 'walk' ? { discussionPlace: raw['discussionPlace'] } : {}),
    ...(boundsOf(raw['explanationBounds']) === null ? {} : { explanationBounds: boundsOf(raw['explanationBounds']) as NonNullable<ReviewPreferences['explanationBounds']> }),
  };
}

/** The preference fields, in the order `adoptPreferences` writes them. */
const PREFERENCE_FIELDS = ['language', 'explanationWidth', 'navigationWidth', 'explanationDetached', 'discussionPlace', 'explanationBounds'] as const;

/**
 * DSP-200: the fields of `raw` the preferences do not take as sent: an unknown field, a known one
 * with a value that is not valid, or a missing language. Empty when every field is taken as it
 * is, whatever the order of its keys; an object is not compared by its JSON text, whose order is
 * that of the keys.
 */
export function refusedPreferenceFields(raw: unknown): string[] {
  if (!isRecord(raw)) {
    return ['(not an object)'];
  }
  const adopted: Record<string, unknown> = { ...adoptPreferences(raw) };
  const fields = [...new Set([...Object.keys(raw), ...Object.keys(adopted)])];
  return fields.filter((field) => sortedJson(raw[field]) !== sortedJson(adopted[field]));
}

/**
 * The same fields in the order `adoptPreferences` writes them, nothing dropped and nothing
 * checked: what a window sends is then taken by a host that still compares JSON text (0.1.15 to
 * 0.1.22, DSP-200) as well as by one that does not. An unknown field stays, last, to be refused.
 */
export function inPreferenceOrder(preferences: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const ordered: Record<string, unknown> = {};
  for (const field of [...PREFERENCE_FIELDS, ...Object.keys(preferences)]) {
    if (field in preferences && !(field in ordered)) {
      ordered[field] = preferences[field];
    }
  }
  return ordered;
}

/** JSON text with every object's keys sorted, so that two equal values give the same text. */
function sortedJson(value: unknown): string | undefined {
  const sorted = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sorted)
      : isRecord(item)
        ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, sorted(item[key])]))
        : item;
  return JSON.stringify(sorted(value));
}

/** A window's place and size as saved: whole numbers, a usable size, and nothing else. */
function boundsOf(raw: unknown): ReviewPreferences['explanationBounds'] | null {
  if (!isRecord(raw)) {
    return null;
  }
  const { x, y, width, height } = raw;
  const whole = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
  if (!whole(x, -100_000, 100_000) || !whole(y, -100_000, 100_000) || !whole(width, 200, 20_000) || !whole(height, 200, 20_000) || Object.keys(raw).length !== 4) {
    return null;
  }
  return { x, y, width, height };
}

/** Validate a renderer-supplied revision side and repository path before git sees them. */
export function checkFileRequest(side: unknown, filePath: unknown): string | null {
  if (side !== 'base' && side !== 'target') {
    return 'The revision side must be "base" or "target".';
  }
  if (
    typeof filePath !== 'string' ||
    filePath === '' ||
    filePath.includes('\0') ||
    filePath.includes('\\') ||
    filePath.startsWith('/')
  ) {
    return 'A repository-relative file path with forward slashes is required.';
  }
  return null;
}

/**
 * What the main process accepts as a record to save: the open revision pair, and
 * decisions and notes only from a person at that pair. Agent provenance is
 * reserved for delegated review, which this increment does not have.
 */
export function checkStateForSave(state: unknown, revisions: RevisionPair): string | null {
  if (adoptStoredState(state, revisions) === null) {
    return 'The record does not have the expected shape for the open revision pair.';
  }
  const record = state as ReviewState;
  for (const decision of record.decisions) {
    if (decision.by.kind !== 'human') {
      return 'Only decisions made by a person can be recorded here; delegated agent review is not available.';
    }
    if (decision.revisions.base !== revisions.base || decision.revisions.target !== revisions.target) {
      return 'A decision names a different revision pair than the open review.';
    }
    if (!isDecisionScope(decision.scope) || !['accepted', 'exempted', 'withdrawn'].includes(decision.outcome)) {
      return 'A decision does not name a change or exact lines it can hold.';
    }
    if (decision.origin !== undefined && !isDecisionOrigin(decision.origin)) {
      return 'A decision names where it was made in a form this version does not know.';
    }
  }
  for (const note of record.notes) {
    if (note.revisions.base !== revisions.base || note.revisions.target !== revisions.target) {
      return 'A note names a different revision pair than the open review.';
    }
  }
  return null;
}

export interface ReviewCommit {
  readonly sha: string;
  readonly subject: string;
}

/** Everything the view needs to open a review, read once from git and the definition. */
export interface ReviewBundle {
  readonly definitionPath: string;
  readonly definitionHash: string;
  readonly repository: string;
  readonly base: ReviewCommit;
  readonly target: ReviewCommit;
  /** Whether `base` is `target`'s first parent: the diff is then exactly one commit. */
  readonly singleCommit: boolean;
  readonly definition: ReviewDefinition;
  readonly definitionProblems: readonly DefinitionProblem[];
  /** One entry per reference that failed validation; such references are shown as invalid. */
  readonly referenceProblems: readonly { readonly stepId: string; readonly refId: string; readonly problem: string }[];
  readonly files: readonly DiffFile[];
  readonly state: ReviewState;
  /** Something the reviewer must know about their stored record, if anything. */
  readonly stateNotice: ReviewStateNotice | null;
}

/** What happened to a stored record when the review opened. The view words it. */
export type ReviewStateNotice =
  | { readonly kind: 'unusable'; readonly keptAs: string }
  | {
      readonly kind: 'definition-changed';
      /** Steps whose marks were carried because their content is unchanged. */
      readonly carriedStepMarks: number;
      /** Steps whose marks were set aside as history because the step changed. */
      readonly movedStepMarks: number;
    };

export type ReviewOpenOutcome =
  | { readonly kind: 'opened'; readonly bundle: ReviewBundle }
  | {
      readonly kind: 'none';
      readonly note: string;
      /**
       * The folder the window was opened for, when there was one: where the file
       * chooser starts and what the empty view names. Never the review's repository;
       * that is the one the chosen definition names.
       */
      readonly repository?: string | null;
      /** Why the last review opened for that folder could not be opened again, if it could not. */
      readonly problem?: string;
    }
  | {
      readonly kind: 'failed';
      /** The plain message the window shows. */
      readonly error: string;
      /** The technical text behind it (git's own words), shown in a closed Details. */
      readonly detail?: string;
    };

/**
 * What the main application hands the review module, and all it hands it.
 *
 * `repository` is the folder the person is working in, used only as the file
 * chooser's start folder and to find the last review opened for it. `definitionPath`
 * names a review definition to open directly. Review reads nothing else of the
 * caller: no chat, session, loop or window state.
 */
export interface ReviewWindowInput {
  readonly repository: string | null;
  readonly definitionPath: string | null;
  /**
   * Whether opening this definition makes it the last review for its repository.
   * `true` when omitted. *Open example review* (DSP-129) passes `false`: the bundled
   * example is not the person's own review, and must not become what *Open review*
   * reopens for a project in the DSpatch clone.
   */
  readonly remember?: boolean;
  /**
   * DSP-132: the agent of the main window that opened review, the default for a **new**
   * review discussion. Absent (standalone, example, direct) means none: the discussion
   * then asks for an explicit choice. A discussion's stored agent always wins.
   */
  readonly defaultProvider?: 'cursor' | 'claude' | 'copilot' | null;
  /**
   * DSP-152: the model the opening chat or loop editor uses with `defaultProvider`, the
   * starting choice for the review's agent work. `''` or absent means none was chosen.
   */
  readonly defaultModel?: string;
}

/** How opening a review window went, for the note beside the button that asked. */
export interface ReviewWindowOutcome {
  readonly kind: 'opened' | 'focused' | 'failed';
  readonly note: string;
}

/**
 * The short identity of an open review: `repo-name · abc1234→def5678`.
 *
 * Shown in the review header and the window title, so a review window left open while
 * the chat moves to another project still says which repository and revisions it is.
 */
export function reviewIdentityLabel(repository: string, base: string, target: string): string {
  const name = repository.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? repository;
  return `${name === '' ? repository : name} · ${base.slice(0, 7)}→${target.slice(0, 7)}`;
}

export type ReviewFileOutcome =
  | { readonly kind: 'text'; readonly lines: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'binary' }
  | { readonly kind: 'failed'; readonly error: string };

export interface ReviewSearchHit {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface ReviewBridge {
  initial(): Promise<ReviewOpenOutcome>;
  choose(): Promise<ReviewOpenOutcome>;
  /** The open review read again, as it is now on disk (30 October 2026: points worth checking added beside it). */
  reread(): Promise<ReviewOpenOutcome>;
  readFile(side: RevisionSide, path: string): Promise<ReviewFileOutcome>;
  listFiles(side: RevisionSide): Promise<readonly string[]>;
  search(side: RevisionSide, query: string): Promise<{ readonly hits: readonly ReviewSearchHit[]; readonly truncated: boolean; readonly error?: string }>;
  saveState(state: ReviewState): Promise<{ readonly saved: boolean; readonly at: string; readonly error?: string }>;
  getPreferences(): Promise<ReviewPreferences>;
  setPreferences(preferences: ReviewPreferences): Promise<{ readonly saved: boolean; readonly error?: string }>;
}
