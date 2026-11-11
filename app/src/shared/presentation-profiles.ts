/**
 * DSP-176, DSP-181, DSP-184, DSP-188: the presentation policy for the review agent's explanations.
 *
 * Everything DSpatch tells the agent about explaining a step is here, in one place, derived from
 * docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md (the reference Niclas adopted on 9 November 2026)
 * at its level of abstraction, so that it is easy to read, compare and iterate on. The
 * instructions are not shown in the review's reading flow (Niclas's decision of 9 November 2026,
 * DSP-184): the person chooses a profile and reads the explanation. They stay explicit and
 * inspectable (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md, section 1) through this file, their one
 * definition, and through every stored step explanation, which keeps the exact prompt it was
 * sent with and the instruction version (`<key>.explanations.json`).
 *
 * Three parts, kept apart as the reference's section 6 asks:
 * - the **shared task** ({@link EXPLANATION_TASK}): what every explanation of a step does, whatever
 *   the profile: read the code it rests on, say what the reader needs to understand and judge the
 *   step, add understanding beyond the lines, and let the scope follow the code and the reader.
 *   No sentence count, no identifier count and no required form: DSP-188 withdrew the length
 *   guideline of DSP-181 and DSP-184 and the lists of what a text must contain;
 * - the **profile's addition** ({@link ProfileDefinition.reader}): whom the explanation helps and
 *   what support that reader needs. Essentials orients an experienced developer; Standard makes
 *   the central mechanism understandable for a developer new to this code; Teacher builds the
 *   concepts and reasoning a reader unfamiliar with the language, library or mechanism needs;
 * - the **technical contract**: the one marker line the window splits on ({@link DETAILS_MARKER},
 *   {@link SHORT_PART_RULE}, {@link DETAILS_PART_RULE}), what goes after it ({@link DEEPENING_RULES}),
 *   the walk's outline and how an explanation reads beside the walk ({@link WALK_READING_RULES}),
 *   and the references block.
 *
 * A profile changes which of the relevant material is selected and at what level it is explained
 * ({@link SAME_FACTS_RULES}, reference version 1.1, DSP-192): never how carefully the code is read,
 * what is true of it, the review's findings or what is approved; the prepared text is material,
 * not a list of what must be said. The same
 * parts reach walk generation ({@link walkExplanationSection}), a profile's explanation,
 * regeneration, Tell me more, Explain more simply and Explain this ({@link presentationPromptSection}).
 * The discussion carries no profile: a profile changes the step's explanation, not the
 * conversation (DSP-184). **Original** is an older walk's prepared explanation: kept and viewable,
 * never asked for.
 *
 * The ids are stable and never shown: the names the person reads come from the window's own
 * words in its language (`review-i18n.ts`); prompts use the English names.
 */

export type PresentationProfile = 'original' | 'essens' | 'standard' | 'pedagog';
/** The profiles the person can choose. */
export type PublicProfile = Exclude<PresentationProfile, 'original'>;

export const PUBLIC_PROFILES: readonly PublicProfile[] = ['essens', 'standard', 'pedagog'];
/** Every id a stored record may carry, the legacy one included. */
export const PRESENTATION_PROFILES: readonly PresentationProfile[] = ['original', ...PUBLIC_PROFILES];
export const DEFAULT_PROFILE: PublicProfile = 'standard';
/** The prepared explanation of an older walk, as the walk generator wrote it. */
export const LEGACY_PROFILE: PresentationProfile = 'original';
/**
 * Raised when profile instructions change in meaning; stored with every step explanation and walk.
 * 8 (DSP-192, 10 November 2026): the profiles select at different levels; the prepared text is
 * material, not a content list; Standard's reader unchanged.
 * 9 (DSP-194, 10 November 2026): Essentials says what a mechanism achieves rather than the
 * operations that achieve it; a profile explanation of a step gets an answer format without the
 * review question's content rules; the writer reads the planner's brief as orientation written
 * for every profile. Standard's and Teacher's readers unchanged.
 * 10 (DSP-195, 10 November 2026): the shared task names what an explanation may cover and leaves the
 * choice and level to the profile; a profiled walk prompt and the loop writer no longer get the
 * writing rules' reader and content rules (only their form rules), and the one-call schema describes
 * its fields without a content list; the loop reviewer's place check asks for the reader's level.
 * 11 (DSP-197, 11 November 2026): profile fit is judged explicitly for both over- and under-density:
 * the short part stays readable for the chosen profile, secondary detail moves behind Show more, and
 * reviewer criteria may reject a text that is too verbose or too dense for that profile's reader.
 * 12 (DSP-199, 11 November 2026): Niclas's decision that Essentials is extremely short: its first
 * part aims at about two natural sentences, correct but not comprehensive, with depth after the
 * marker. Essentials replaces the shared scope rule, the walk's transition rules and the Show more
 * contract with its own (ProfileDefinition.own); in a one-call walk its summary is a few words and
 * its why is empty, and the loop's writer and reviewer get the same definition. Standard and
 * Teacher are unchanged.
 */
export const PRESENTATION_INSTRUCTION_VERSION = 12;

/** The English names, as prompts say them; the window shows the names of its own language. */
export const PROFILE_PROMPT_NAMES: Readonly<Record<PresentationProfile, string>> = {
  original: 'Original',
  essens: 'Essentials',
  standard: 'Standard',
  pedagog: 'Teacher',
};

/** Whether a stored or sent value names a profile, the legacy one included. */
export function isProfile(value: unknown): value is PresentationProfile {
  return value === 'original' || value === 'essens' || value === 'standard' || value === 'pedagog';
}

/** Whether a value names a profile the person can choose. */
export function isPublicProfile(value: unknown): value is PublicProfile {
  return value === 'essens' || value === 'standard' || value === 'pedagog';
}

/**
 * The profile a stored choice means now: Essentials and Teacher are kept; anything else, the
 * legacy Original among it, is no choice, so the default stands. Nothing stored is rewritten.
 */
export function effectiveProfile(stored: unknown): PublicProfile {
  return isPublicProfile(stored) ? stored : DEFAULT_PROFILE;
}

// --- The details contract ---------------------------------------------------------------------

/**
 * Where an answer's short part ends and its details begin (Niclas's decision of 30 October
 * 2026): the window shows the short part and offers the rest under *Show more*, from what
 * was written, without asking again. Not shown; an answer without it is shown whole.
 */
export const DETAILS_MARKER = '<!-- dspatch:details -->';

/** The one wording of what the short part is, for every answer in the review. */
export const SHORT_PART_RULE =
  'Answer first, in a short part that stands on its own: enough to understand the point without reading further. An uncertainty or risk that changes the answer is said in this part, briefly; its evidence and explanation can go after the marker.';

/** The one wording of what goes after the marker, for every answer in the review. */
export const DETAILS_PART_RULE =
  `When there is real depth to add (complementary mechanics, special cases, longer evidence, more code references), put it after the short part, below a line holding only ${DETAILS_MARKER}. ` +
  'The person opens it with Show more. Do not repeat the short part there, do not write "Show more" yourself, leave the line out when there is nothing to add, and do not pad either part.';

/// --- The shared task and the profiles -------------------------------------------------------------

/**
 * The boundary every presentation keeps (DSP-176, DSP-181): the facts of the code and the
 * review's decisions are not the profile's to change.
 */
export const SAME_FACTS_RULES = [
  'A profile changes which of the relevant material is selected and at what level it is explained, not what is true of the code or what the review has decided: state nothing the code does not support, treat a new observation of yours as an observation rather than a verified fact, and change no decision of the review. The review\'s findings stay in the review\'s state; an explanation need not restate them.',
  'The prepared explanation and earlier answers given to you are material, not a list of what must be said: the code decides what is true, and the profile decides what this reader needs to understand it. Present this step; do not start a new broad review and do not retell the whole discussion. An important objection may be summarised in one line that points to its thread.',
] as const;

/**
 * The one task every explanation of a step has, whatever the profile and whichever path asks
 * for it (DSP-188; docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md, sections 1 to 3). Said once per
 * prompt. The profile adds to it and does not replace it, and nothing here prescribes a length,
 * a form or a list of things to mention.
 */
export const EXPLANATION_TASK = [
  'Explain this code to a person reviewing the change, who reads your text beside the code itself: what this reader needs in order to understand the step and judge the change. Which of what the code does here, why it matters for the change, how it connects to what the reader has seen and will see, and what decides the outcome (a condition, a risk, work only requested or reused) this reader needs, and at what level, the reader\'s profile decides.',
  'Read the code you rest on before you write: callers, types, the other code that reads or writes the same state, and what waits for or carries out what this code asks. Do not infer the architecture from names, and do not present what you have not read. The code decides, also where the prepared explanation or an earlier answer says more than the code supports; then say plainly what the code does.',
  'Add understanding beyond what the lines and their comments already say: do not retell statements in prose, and keep what the code shows apart from an interpretation of why it is written so. Be exact about guarantees: a lock protects only the accesses under it, a notification is not a completed hand-over, a private method is not proof that nothing else calls it. When a part cannot be read, explain the general concept and say what cannot be established about this implementation.',
  'Let the scope follow the code and the reader: a simple step is said in a few words in every profile, and a step where several mechanisms interact takes the room understanding needs. There is no length to hit and no required form; use a paragraph, a list or a small code excerpt where it helps, and let every sentence add understanding. Keep the first part readable for this reader: when the main point is already clear, move secondary detail to the part after the marker rather than crowding the first part. Point at the code you rest on with references, so the person can open it.',
] as const;

/** What comes after the marker line, in every profile: the technical contract of Show more. */
export const DEEPENING_RULES = [
  'After the marker line comes the deepening only: relevant continued explanation for the same reader at the same level (for Essentials the mechanics an experienced developer may want next, for Teacher the next layer of a concept or its consequences), the special cases that change the outcome, longer evidence and more references, readable even when long. It is not an inventory of what the first part left out. It continues the first part rather than restating it: nothing said above the line is said again below it, also not in other words or under a heading of its own, and the comparison with the earlier revision is made once. Leave the line out when there is nothing to add.',
] as const;

/**
 * DSP-184, DSP-188: an explanation is read beside the walk's code, in the walk's order, and the
 * walk's transitions are made comprehensible (the reference's section 1). Said in walk
 * generation and in every step explanation, with the walk's outline when the window sends it.
 */
export const WALK_READING_RULES = [
  'The walk shows the code of each step beside its explanation: in the prose, name functions, types, variables and settings rather than file names, paths or line numbers; the references block, when one is asked for, still names files and lines.',
  'Write relative to the walk: "here" for this step\'s code, and "in the next step", "in a later step" or "as we saw earlier" only where the walk\'s order makes it true. A short orientation about what a later step shows is often needed, normally one sentence with a reference to that step; do not repeat that step\'s explanation here. What an earlier step established is recalled in a line with a reference to that step, not derived again: this step adds what is new here.',
  'Make a transition comprehensible where it would otherwise be unclear: what this step is reached from and what the caller needs from it; on a return, where the caller continues and what is now known; for an alternative outcome, that the walk is back at the branch point and which condition applies now; for a worker or a callback, what starts or triggers it and which execution context is being followed. When the teaching order differs from the execution order, say so. What follows from the language\'s or the library\'s rules, such as a specified order or a type, is stated as a fact; what depends on timing, scheduling or callers outside the change is stated as what the code allows, never as something observed to run.',
  'Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown (no "the prepared summary says"); where the code contradicts it, simply say what the code does.',
] as const;

/**
 * DSP-185: how an explanation points at another step of the walk: by its id in the references
 * block, so the person is taken to that step and its explanation rather than to file and lines.
 * Said only when the outline carries the steps' ids.
 */
export const STEP_REFERENCE_RULE =
  'When a references block is asked for and you point the reader at another step of this walk or of another walk of this review, put an entry with only its id in the references block, for example {"label": "Where the option is declared", "step": "W1.2"}, instead of naming its file and lines; use the ids in brackets above. Use file and line references for code no step shows.';

export interface ProfileDefinition {
  readonly id: PresentationProfile;
  /** The name prompts use; the window shows its own language's name. */
  readonly promptName: string;
  /**
   * Whom the explanation helps and what support that reader needs: the profile's whole addition
   * to the shared task (docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md, section 4).
   */
  readonly reader: readonly string[];
  /** How this profile explains more simply. */
  readonly simpler: readonly string[];
  /**
   * DSP-199: shared rules this profile replaces with its own, so that one definition holds for the
   * profile instead of a shared rule beside it asking for the opposite. `scope` replaces the last
   * line of {@link EXPLANATION_TASK}, `deepening` the {@link DEEPENING_RULES}, `walkDetails` the
   * {@link WALK_DETAILS_RULE}, `walkReading` the {@link WALK_READING_RULES}. Absent for Standard
   * and Teacher, whose prompts stay as they were.
   */
  readonly own?: {
    readonly scope: string;
    readonly deepening: string;
    readonly walkDetails: string;
    readonly walkReading: readonly string[];
    /** How a one-call walk's fields are written in this profile, said where the section names them. */
    readonly walkFields: string;
  };
}

export const PROFILES: Readonly<Record<PresentationProfile, ProfileDefinition>> = {
  original: {
    id: 'original',
    promptName: 'Original',
    reader: [],
    simpler: [],
  },
  essens: {
    id: 'essens',
    promptName: 'Essentials',
    reader: [
      // DSP-199 (Niclas's decision, 11 November 2026; the reference's version 1.3, section 4).
      `The reader is an experienced developer who sees the code beside your text and can always open Show more. Extreme brevity is the primary goal: the first part aims at about two natural sentences on what this step accomplishes and its central role or relationship in the flow. Adapt to the size of the code only where you must; a very large piece of code can need more, but the first part still gives only the main picture, and two long sentences that pack in a walkthrough do not meet it. Leave out the calls, flags, fields, mechanisms, every condition and the failure paths: the reader sees them in the code, and what is worth reading of them goes after the marker. Choosing what to leave out is the job. What the first part says must be correct, not comprehensive: make an overreaching claim precise rather than adding reservations.`,
    ],
    simpler: ['Plainer language and less jargon: the same point, said more directly.'],
    own: {
      scope: 'There is no required form, and the Essentials reader sets the size of the first part. Point at the code you rest on with references, so the person can open it.',
      deepening: 'After the marker line comes the deepening only, when there is something worth reading for this reader: a coherent continuation of the main picture, with the mechanics, conditions or special cases that matter and the evidence and references for them. It is not an inventory of everything you read, and nothing said above the line is said again below it. Leave the line out when there is nothing worth adding.',
      walkDetails: '"details" is the deepening the person opens with Show more, only when there is something worth reading: a coherent continuation of the main picture, not an inventory of what you read and not a repetition of "body". Leave it empty when there is nothing worth adding.',
      walkReading: [
        'The walk shows the code of each step beside its explanation: in the prose, name functions, types, variables and settings rather than file names, paths or line numbers; the references block, when one is asked for, still names files and lines.',
        `Place this step in the walk only as far as its role needs: "here" for this step's code, and "in the next step", "in a later step" or "as we saw earlier" only where the walk's order makes it true. Do not preview or recall other steps beyond a phrase, and make a transition explicit only where the step's role would otherwise be misread; more of the course can go after the marker. What depends on timing, scheduling or callers outside the change is said as what the code allows, never as something observed to run.`,
        'Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown (no "the prepared summary says"); where the code contradicts it, simply say what the code does.',
      ],
      walkFields: `For each step, "body" is the first part the person reads and "details" its deepening behind Show more. In Essentials, "summary" is only a few words naming the step, since the body is the summary, and "why" stays empty.`,
    },
  },
  standard: {
    id: 'standard',
    promptName: 'Standard',
    reader: [
      'The reader knows programming but not this code: make the central mechanism understandable, how the parts work together and why their relationship matters, from a natural entry point into what makes the behaviour understandable rather than the parts in source order. Place a project-specific name the first time it matters, and explain a language detail where the reader needs it to interpret the code; you need not teach every concept, nor add facts to be longer. Keep the first part compact enough that the mechanism stays in view: examples or side mechanics that do not change that understanding belong after the marker.',
    ],
    simpler: ['Break the difficult connection into its parts and explain the concepts that are needed to follow it, one at a time.'],
  },
  pedagog: {
    id: 'pedagog',
    promptName: 'Teacher',
    reader: [
      'The reader can program but may not know this language, library or mechanism: build the understanding the reasoning presupposes, what the concepts mean here, why the mechanism is needed and how the parts work together, and tie it to what the code does here, with a concrete example or comparison where it makes the reasoning easier to follow. Choose the concepts and intermediate steps this step actually needs: do not inventory every line or teach every term, and do not add facts to be longer than Standard. Use what the walk has established: a short reminder with a reference in a later step, not the same foundation derived again. State what a primitive guarantees before an argument rests on it, and name a fault for what it is: unsynchronised concurrent access with a writer is a data race, not a stale value. A local explanation beats a detached lesson, and the text may take the room understanding needs.',
    ],
    simpler: ['Try a simpler way in: a concrete case, a better analogy, or the effect as seen from the caller, before the mechanism.'],
  },
};

/** DSP-199: the shared task as this profile gets it, with its own scope rule where it has one. */
export function explanationTaskFor(profile: ProfileDefinition): readonly string[] {
  return profile.own === undefined ? EXPLANATION_TASK : [...EXPLANATION_TASK.slice(0, 3), profile.own.scope];
}

/** DSP-199: what comes after the marker line, as this profile gets it. */
export function deepeningRulesFor(profile: ProfileDefinition): readonly string[] {
  return profile.own === undefined ? DEEPENING_RULES : [profile.own.deepening];
}

/** DSP-199: how an explanation reads beside the walk, as this profile gets it. */
export function walkReadingRulesFor(profile: ProfileDefinition | null): readonly string[] {
  return profile?.own === undefined ? WALK_READING_RULES : profile.own.walkReading;
}

/**
 * Explain more simply (DSP-176, DSP-181), in every profile: fewer concepts at once, not more
 * detail. Repeated presses build on what was shown and try another way in; they do not grow
 * longer, and they end with a short question rather than "it cannot be simpler".
 */
export const SIMPLER_RULES = [
  'Explain the same thing more simply for the same person: reduce the number of concepts they must hold at once. Simpler means less conceptual complexity, not more detail.',
  'Start with what the code achieves; explain how only where it is needed.',
  'Use plain words. Keep the class, method and file names and explain a necessary technical term rather than avoiding it.',
  'Keep the important reservations and uncertainties; simpler is not less true.',
  'Do not add detail the earlier explanation did not need, and do not make this answer longer than the explanation it simplifies.',
  'Do not repeat the earlier explanation with a few words changed: take another way in.',
] as const;

/** Added when the person has asked for a simpler explanation before, in this chain. */
export const SIMPLER_AGAIN_RULES = [
  'The explanations already shown are below. They did not make it clear enough. Try a different teaching approach from all of them — for example a concrete case instead of an abstract description, or the effect seen from the caller — not the same approach in other words.',
  'If you judge that yet another angle is unlikely to help, do not say that it cannot be explained more simply. Instead give your best short explanation and end with one short, directed question asking which concept or connection is unclear, naming two or three candidates from the explanation.',
] as const;

/** Tell me more after an explanation in a profile: deeper from what was shown, not the base again. */
export const MORE_RULES = [
  'The person has read the explanation below and asks for more. Go deeper from it: the mechanism behind what it says, the connections it names, the special cases and the evidence. Do not restart with the same base explanation and do not repeat it.',
  'Keep the manner and the level the explanation established; more can still be readable.',
] as const;

/** DSP-184: Regenerate: a new explanation in the same profile, not a copy of the one shown. */
export const REGENERATE_RULES = [
  'The person asked for a new explanation of this step in this profile. The one they had is below, as material: write a new one from the code, following the rules above and choosing again what this reader needs. Do not copy its sentences or its structure, and state nothing the code does not support.',
] as const;

/** DSP-184: Explain this, on a selection inside the step's explanation or its code. */
export const EXPLAIN_SELECTION_RULES = [
  'The person selected the text quoted under "Selected" above while reading this step and asks what it means. Explain exactly that, in the context of this step and of the explanation below, in the manner of the profile.',
  'Do not explain the whole step again.',
] as const;

/** What a request from a window may ask of a discussion question about the presentation (legacy records). */
export interface PresentationRequest {
  readonly profile: PresentationProfile;
  /** The answers whose explanations the person had seen, oldest first. */
  readonly shown?: readonly string[];
  /** The profile-instruction version used when this request was asked. */
  readonly version?: number;
}

/** A presentation request from a stored record, or `null` when there is none or it is malformed. */
export function presentationFrom(raw: unknown): PresentationRequest | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (!isProfile(value['profile'])) {
    return null;
  }
  const shown = Array.isArray(value['shown']) ? value['shown'].filter((id): id is string => typeof id === 'string' && /^[\w.:-]{1,80}$/.test(id)).slice(-6) : [];
  const version = typeof value['version'] === 'number' && Number.isInteger(value['version']) && value['version'] > 0 ? value['version'] : undefined;
  return { profile: value['profile'], ...(shown.length === 0 ? {} : { shown }), ...(version === undefined ? {} : { version }) };
}

/**
 * DSP-184: the walk a step belongs to, as the window knows it: its steps in order, the code
 * each covers, and which step is being explained. Sent with every step explanation.
 */
export interface WalkOutline {
  readonly walkTitle: string;
  /** `id`: the step's id (`W1.3`), so an explanation can point at another step by it (DSP-185). */
  readonly steps: readonly { readonly id?: string; readonly title: string; readonly places: readonly string[] }[];
  /** The index of the step being explained in {@link steps}. */
  readonly current: number;
  /**
   * DSP-185: the review's other walks, by title and step ids, so an explanation can point at a
   * step there instead of explaining it again. Absent when there are none or none were sent.
   */
  readonly otherWalks?: readonly { readonly title: string; readonly steps: readonly { readonly id: string; readonly title: string }[] }[];
}

/** Bounds on an outline as sent: a walk is short, and a forged one cannot grow a prompt. */
export const OUTLINE_LIMITS = { steps: 40, places: 8, chars: 160, otherWalks: 12 } as const;

const STEP_ID = /^[A-Za-z][A-Za-z0-9_-]{0,15}\.\d{1,4}$/;

/**
 * DSP-185: the outline of a walk as the window sends it with a step explanation: the walk's
 * steps with their ids, titles and code, and the review's other walks by title and step ids.
 * One builder for the window and for anything that must build the same prompt.
 */
export function walkOutlineOf(
  walks: readonly { readonly id: string; readonly title: { readonly sv: string; readonly en: string }; readonly steps: readonly { readonly id: string; readonly title: { readonly sv: string; readonly en: string }; readonly places: readonly { readonly focus: { readonly path: string; readonly side: 'base' | 'target'; readonly start: number; readonly end: number } }[] }[] }[],
  walkId: string,
  stepId: string,
  lang: 'sv' | 'en',
): WalkOutline | null {
  const walk = walks.find((entry) => entry.id === walkId);
  if (walk === undefined) {
    return null;
  }
  const lines = (focus: { readonly start: number; readonly end: number }): string => (focus.start === focus.end ? String(focus.start) : `${String(focus.start)}–${String(focus.end)}`);
  const others = walks.filter((entry) => entry.id !== walkId);
  return {
    walkTitle: walk.title[lang],
    steps: walk.steps.map((entry) => ({
      id: entry.id,
      title: entry.title[lang],
      places: entry.places.map((at) => `${at.focus.path} ${lines(at.focus)} (${at.focus.side === 'base' ? 'From' : 'To'})`),
    })),
    current: Math.max(0, walk.steps.findIndex((entry) => entry.id === stepId)),
    ...(others.length === 0 ? {} : { otherWalks: others.map((other) => ({ title: other.title[lang], steps: other.steps.map((entry) => ({ id: entry.id, title: entry.title[lang] })) })) }),
  };
}

const clipLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** An outline from a window, bounded, or `null` when there is none or it is malformed. */
export function outlineFrom(raw: unknown): WalkOutline | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const steps = Array.isArray(value['steps']) ? value['steps'] : null;
  const current = value['current'];
  if (steps === null || steps.length === 0 || typeof current !== 'number' || !Number.isInteger(current) || current < 0 || current >= Math.min(steps.length, OUTLINE_LIMITS.steps)) {
    return null;
  }
  const read = steps.slice(0, OUTLINE_LIMITS.steps).map((entry) => {
    const step = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const places = Array.isArray(step['places']) ? step['places'].filter((place): place is string => typeof place === 'string').slice(0, OUTLINE_LIMITS.places) : [];
    const id = typeof step['id'] === 'string' && STEP_ID.test(step['id']) ? step['id'] : undefined;
    return {
      ...(id === undefined ? {} : { id }),
      title: clipLine(typeof step['title'] === 'string' ? step['title'] : '', OUTLINE_LIMITS.chars),
      places: places.map((place) => clipLine(place, OUTLINE_LIMITS.chars)),
    };
  });
  const otherWalks = (Array.isArray(value['otherWalks']) ? value['otherWalks'] : []).slice(0, OUTLINE_LIMITS.otherWalks).flatMap((entry) => {
    const other = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const steps = (Array.isArray(other['steps']) ? other['steps'] : []).slice(0, OUTLINE_LIMITS.steps).flatMap((stepRaw) => {
      const step = (typeof stepRaw === 'object' && stepRaw !== null ? stepRaw : {}) as Record<string, unknown>;
      return typeof step['id'] === 'string' && STEP_ID.test(step['id']) ? [{ id: step['id'], title: clipLine(typeof step['title'] === 'string' ? step['title'] : '', OUTLINE_LIMITS.chars) }] : [];
    });
    return steps.length === 0 ? [] : [{ title: clipLine(typeof other['title'] === 'string' ? other['title'] : '', OUTLINE_LIMITS.chars), steps }];
  });
  return { walkTitle: clipLine(typeof value['walkTitle'] === 'string' ? value['walkTitle'] : '', OUTLINE_LIMITS.chars), steps: read, current, ...(otherWalks.length === 0 ? {} : { otherWalks }) };
}

/** The walk's outline and the walk-relative rules, as a prompt section. */
/** The walk's outline and its reading rules; the profile's own rules where it has them (DSP-199). */
export function walkOutlineSection(outline: WalkOutline | null, profile: PresentationProfile | null = null): string {
  const lines = ['## Where this step is in the walk'];
  if (outline !== null) {
    lines.push(`Walk: ${outline.walkTitle === '' ? '(untitled)' : outline.walkTitle}`);
    outline.steps.forEach((step, index) => {
      const code = step.places.length === 0 ? '' : ` (code: ${step.places.join('; ')})`;
      const id = step.id === undefined ? '' : `[${step.id}] `;
      lines.push(`${String(index + 1)}. ${id}${step.title === '' ? '(untitled)' : step.title}${code}${index === outline.current ? '  <- this step' : ''}`);
    });
    lines.push('');
    if ((outline.otherWalks ?? []).length > 0) {
      lines.push('Other walks of this review:');
      for (const other of outline.otherWalks ?? []) {
        lines.push(`- ${other.title === '' ? '(untitled)' : other.title}: ${other.steps.map((step) => `[${step.id}] ${step.title}`).join('; ')}`);
      }
      lines.push('');
    }
  }
  lines.push(...bullets(walkReadingRulesFor(profile === null ? null : PROFILES[profile])));
  if (outline !== null && outline.steps.some((step) => step.id !== undefined)) {
    lines.push(`- ${STEP_REFERENCE_RULE}`);
  }
  return lines.join('\n');
}

/** What the prompt's presentation section is built from, the texts resolved by the service. */
export interface PresentationSection {
  readonly profile: PresentationProfile;
  /**
   * `present`: the step explained in a profile; `regenerate`: a new one in the same profile;
   * `more`: Tell me more; `simpler`: Explain more simply; `explain`: Explain this on a selection.
   */
  readonly mode: 'present' | 'regenerate' | 'more' | 'simpler' | 'explain';
  /** The explanations already shown, oldest first, each with what it was. */
  readonly shown: readonly { readonly label: string; readonly text: string }[];
  /** DSP-184: the walk the step belongs to; the writing rules are said with or without it. */
  readonly walk?: WalkOutline | null;
}

/** The limit on each earlier explanation quoted into a prompt. */
const SHOWN_CHARS = 4_000;

function clipped(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= SHOWN_CHARS ? trimmed : `${trimmed.slice(0, SHOWN_CHARS)}\n[… cut at ${String(SHOWN_CHARS)} characters]`;
}

const bullets = (rules: readonly string[]): string[] => rules.map((rule) => `- ${rule}`);

/** The reader's profile and the shared task, for a deepening, a simplification or a selection. */
function readerLine(profile: ProfileDefinition): string[] {
  return profile.id === 'original' ? bullets(EXPLANATION_TASK) : [`- The reader's profile: ${profile.promptName}. ${profile.reader.join(' ')}`, ...bullets(explanationTaskFor(profile))];
}

/** The task, the boundary and the profile's addition: the same for walk generation, an explanation and a regeneration. */
function baseTextRules(profile: ProfileDefinition, withBoundary: boolean): string[] {
  return ['Every explanation:', ...bullets(explanationTaskFor(profile)), ...(withBoundary ? bullets(SAME_FACTS_RULES) : []), '', `${profile.promptName}:`, ...bullets(profile.reader)];
}

/**
 * The prompt's section on presentation for a step explanation (DSP-184), or `null` when there
 * is nothing to add: Original is an older walk's prepared explanation and is never asked for.
 */
export function presentationPromptSection(section: PresentationSection): string | null {
  const profile = PROFILES[section.profile];
  const walk = section.walk === undefined ? [] : ['', walkOutlineSection(section.walk, section.profile)];
  const lines: string[] = [];
  const last = section.shown.at(-1);
  if (section.mode === 'present' || section.mode === 'regenerate') {
    if (section.profile === 'original') {
      return null;
    }
    lines.push(
      `## How to present (${profile.promptName})`,
      `Explain this step for a reader who chose ${profile.promptName}. The first part is what this reader reads at once; the deepening goes after the marker line the answer format below names.`,
      `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`,
      '',
      ...baseTextRules(profile, true),
      '',
      'After the marker:',
      ...bullets(deepeningRulesFor(profile)),
      ...walk,
    );
    if (section.mode === 'regenerate' && last !== undefined) {
      lines.push('', '## Regenerating', ...bullets(REGENERATE_RULES), '', `### ${last.label}`, clipped(last.text));
    }
    return lines.join('\n');
  }
  if (section.mode === 'simpler') {
    const round = section.shown.length;
    lines.push(
      `## Explaining more simply (attempt ${String(Math.max(1, round))}${profile.id === 'original' ? '' : `, ${profile.promptName}`})`,
      ...(profile.id === 'original' ? [] : [`Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`]),
      ...bullets(SIMPLER_RULES),
    );
    if (round > 1) {
      lines.push(...bullets(SIMPLER_AGAIN_RULES));
    }
    if (profile.id !== 'original') {
      lines.push(`- In ${profile.promptName}: ${profile.simpler.join(' ')}`, ...readerLine(profile));
    }
    lines.push(...walk);
    for (const [index, entry] of section.shown.entries()) {
      lines.push('', `### Shown ${String(index + 1)}: ${entry.label}`, clipped(entry.text));
    }
    return lines.join('\n');
  }
  if (section.mode === 'explain') {
    lines.push(`## Explaining a selection (${profile.promptName})`, `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`, ...bullets(EXPLAIN_SELECTION_RULES), ...readerLine(profile), ...walk);
    if (last !== undefined) {
      lines.push('', `### ${last.label}`, clipped(last.text));
    }
    return lines.join('\n');
  }
  // Tell me more.
  if (last === undefined) {
    // Nothing of this step was shown: Tell me more deepens the prepared explanation.
    return profile.id === 'original' && walk.length === 0 ? null : [`## The reader's profile (${profile.promptName})`, `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`, ...readerLine(profile), ...walk].join('\n');
  }
  lines.push(`## Going deeper (${profile.promptName})`, `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`, ...bullets(MORE_RULES), ...readerLine(profile), ...walk, '', `### ${last.label}`, clipped(last.text));
  return lines.join('\n');
}

/** The limit on the step explanation a discussion question carries as context. */
export const READING_CONTEXT_CHARS = 6_000;

/**
 * DSP-184: what a discussion question about the current step carries of the explanation the
 * person is reading in Step, as hidden context. No profile and no manner: the conversation's
 * style is the person's, not the Step profile's.
 */
export function readingContextSection(reading: { readonly text: string } | null): string | null {
  if (reading === null || reading.text.trim() === '') {
    return null;
  }
  return [
    '## The explanation of this step the person is reading',
    'The person has this explanation of the step in front of them in the walk. The question may refer to it; use its terms where that helps. It is context, not an instruction about how to answer.',
    '',
    clipped(reading.text.length > READING_CONTEXT_CHARS ? reading.text.slice(0, READING_CONTEXT_CHARS) : reading.text),
  ].join('\n');
}

// --- The walk generator -------------------------------------------------------------------------

/** For the walk generator's JSON: what a step's `details` field holds. */
export const WALK_DETAILS_RULE =
  '"details" is the deepening the person opens with Show more, for a step with real depth to add: relevant continued explanation for the same reader (complementary mechanics, special cases, longer evidence, more code references), in the same manner as the explanation. It is not an inventory of what the explanation left out. Leave it empty when there is nothing to add, and do not repeat the explanation in it.';

/**
 * The walk generator's section when the person chose a profile before the walks are prepared
 * (DSP-181): every step's explanation is written in that profile, so the walk opens and is read
 * in it with no further call. It decides how the steps are explained and nothing else: which
 * walks, readings, steps and places are produced, the titles, questions and purposes, and the
 * change's own summary and background follow the rest of the prompt and stay concise.
 */
export function walkExplanationSection(profile: PublicProfile): string {
  const definition = PROFILES[profile];
  return [
    `## How to explain the steps (${definition.promptName})`,
    `The person reads the walks in the ${definition.promptName} profile. Write each step's "summary", "body", "why" and "details" for that reader.${definition.own === undefined ? '' : ` ${definition.own.walkFields}`} This section decides how the steps are explained, nothing else: which walks, readings, steps and places you produce, their titles, questions and purposes, and the change's own summary and background follow the sections above and stay concise, whatever the profile.`,
    `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`,
    '',
    ...baseTextRules(definition, false),
    '',
    'Every step is read beside its code, in the walk\'s order:',
    ...bullets(walkReadingRulesFor(definition)),
    '',
    `- ${definition.own?.walkDetails ?? WALK_DETAILS_RULE}`,
  ].join('\n');
}
