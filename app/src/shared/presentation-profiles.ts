/**
 * DSP-176, DSP-181, DSP-184: the presentation policy for the review agent's explanations.
 *
 * Everything DSpatch tells the agent about *how to present* a step's explanation is here, in
 * one place, so that it is easy to read, compare and iterate on. The instructions are not shown
 * in the review's reading flow (Niclas's decision of 9 November 2026, DSP-184): the person
 * chooses a profile and reads the explanation. That is a placement in the window: the
 * instructions stay explicit and inspectable (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md, section 1)
 * through this file, their one definition, and through every stored step explanation, which
 * keeps the exact prompt it was sent with and the instruction version (`<key>.explanations.json`).
 *
 * A profile changes presentation only. It never changes how carefully the code is read, which
 * facts are stated, the findings, their recommendations or what is approved.
 *
 * One policy, three public profiles (Niclas's decisions of 8 and 9 November 2026):
 * - the **grounding** every base text has, whatever the profile ({@link GROUNDING_RULES});
 * - the **details contract**: what goes before and after the one marker line the window splits
 *   on ({@link DETAILS_MARKER}, {@link SHORT_PART_RULE}, {@link DETAILS_PART_RULE}), reused by the
 *   discussion's answer format and by the walk generator, so a prompt holds one wording of it;
 * - the **profiles**: Essentials says what the code does and the most important consequence;
 *   Standard adds how and why the relevant parts connect, for a developer who knows programming
 *   but not this code; Teacher builds the needed concepts and explains the reasoning, with
 *   examples where they help. Length is a guideline, never a quota ({@link LENGTH_GUIDELINE_RULES});
 * - the **walk-relative writing rules** ({@link WALK_WRITING_RULES}): an explanation is read
 *   beside the walk's code, in the walk's order;
 * - **Original** is an older walk's prepared explanation: kept and viewable, never asked for.
 *
 * The same rules reach walk generation ({@link walkExplanationSection}), a profile's
 * explanation, regeneration, Tell me more, Explain more simply and Explain this
 * ({@link presentationPromptSection}). The discussion carries no profile: a profile changes
 * the step's explanation, not the conversation (DSP-184).
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
/** Raised when profile instructions change in meaning; stored with every step explanation and walk. */
export const PRESENTATION_INSTRUCTION_VERSION = 6;

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

// --- The shared policy --------------------------------------------------------------------------

/**
 * What every base text rests on, whatever the profile: the same facts and the same scope. The
 * profile chooses what to say of them and how, never which they are.
 */
export const SAME_FACTS_RULES = [
  'This changes how the step is presented, not what is said about the code. Keep every fact, risk, uncertainty, finding and recommendation the code supports; add none the code does not support, and do not change what is reviewed or approved.',
  'The code decides. Where the prepared explanation says more than the code supports (for example that a call wakes a worker when the code only sends a notification that may be lost), follow the code and say plainly what it does; that correction is part of presenting the step, not a new review.',
  'Read the code again when you need to; do not present what you have not read.',
] as const;

/**
 * What a base text (the short part) holds in every profile (DSP-181). Brevity selects among
 * these; it never replaces them with vaguer words.
 */
export const GROUNDING_RULES = [
  'When you name a function, setting, type or other part, use its real name; explain a term rather than replacing it with a vague word such as "the other mechanism" or "one of the options".',
  'Say what changes and its most important consequence.',
  'State a default value explicitly when it is decisive for what the step does.',
  'Keep the conditions, fallback behaviour and uncertainties that are decisive for a correct understanding.',
  'Present this step; do not start a new broad review. Do not retell the whole discussion or every finding of the review: an important objection may be summarised in one line that points to its thread. A new observation of yours is an observation, not a verified fact, and it changes no decision of the review.',
] as const;

/**
 * DSP-184 (Niclas's correction of 9 November 2026): every profile adds understanding beyond
 * what the code and its comments already say, rather than retelling them in prose, and keeps
 * what the code shows apart from an interpretation of why it is written so. Ends with the
 * self-check every text is held to.
 */
export const EXPLANATORY_VALUE_RULES = [
  'Add understanding beyond what can be read directly in the code and its comments. Do not retell each statement, condition or comment in prose.',
  'Do not invent intentions to make the text sound explanatory. Keep apart what the code shows and an interpretation of why it is written so, and mark an interpretation as one.',
  'Before you answer, ask: what does this help the reader understand that is not already plain from the code or its comments? If the answer is only "the same details, said in sentences", rewrite it.',
] as const;

/**
 * DSP-185 (Niclas's quality correction of 9 November 2026): code is not treated because it is
 * shown or named; every central mechanism is explained at the profile's level, from code that
 * was read, and what cannot be established is said apart from the general concepts. Said in
 * every generation path: walk generation, present, regenerate, more, simpler and explain.
 */
export const MECHANISM_RULES = [
  'Code is not explained because it is in the step or because its function is named. Cover every central mechanism the step shows: what state it touches and what protects it, who owns what and for how long, what is handed on and how the receiver learns of it, and what has actually happened when the code returns as opposed to what has only been requested or reused. Where the code makes "the work" trivial, or different from what its names suggest, say what the work actually consists of.',
  'Cover them at this profile\'s level. Essentials: its short part names the central mechanism and its consequence within its two sentences, and the explanation of the mechanisms goes after the marker. Standard: explain how the mechanisms connect and what follows from that. Teacher: build the concepts each mechanism rests on, then apply them to this code. A mechanism that matters is never left out of the explanation as a whole; a shorter profile says less about it in its short part, not less truly.',
  'What you must investigate and what the reader needs to see are different. Read widely; put in the text what is needed to understand this step, not every path you read.',
  'Before you write, read what the explanation depends on at the review\'s revision where you can read the code: the types involved, the callers, the other code that reads or writes the same state, and the code that waits for or carries out what this code requests. Do not infer the architecture from names.',
  'When relevant code really is not available to you, still explain the general concepts the reader needs, and say plainly what cannot be established about this implementation. Missing code is neither a reason to invent a connection nor a reason to leave a concept out.',
] as const;

/**
 * Length is a guideline for a normal step, said once with what it is not, so that no profile
 * pads or truncates to hit a number (DSP-181).
 */
export const LENGTH_GUIDELINE_RULES = [
  'The length given for this profile is the order of magnitude for a normal step, not a count to hit, not a cap and not a reason to fill out a simple explanation. A simple change is explained briefly in every profile; a complex or wide change may take more room when the material calls for it. Every sentence must add understanding. Do not press the content of many sentences into a few long ones: a shorter profile says less, at a higher level, not the same in denser sentences.',
] as const;

/** The form of the details, in every profile. */
export const DEEPENING_RULES = [
  'After the marker line: the deepening only, in the same manner as the first part, readable even when long: short paragraphs, lists where they help, small code excerpts where they carry the point.',
  'Name the code you rest on with references, as for any answer, so the person can open it.',
  'Write it at this profile\'s level, in its reasoning and with the prerequisites its reader needs, as its Show more line says. The same relevant facts may appear in every profile; do not make the content different only to differ.',
] as const;

/**
 * DSP-184: an explanation is read beside the walk's code, in the walk's order. Said in walk
 * generation and in every step explanation, with the walk's outline when the window sends it.
 */
export const WALK_WRITING_RULES = [
  'The walk shows the code of each step beside its explanation. In the prose, do not write file names, paths or line numbers for code the walk shows; name the functions, types, variables and settings instead. The references block, when one is asked for, still names files and lines.',
  'Write relative to the walk: say "here" for the code of this step, and "in the next step", "in a later step" or "as we saw earlier" only where the walk\'s order makes it true.',
  'Explain this step. Read and understand what later steps show where this step depends on it. A short orientation of what happens later is allowed and often needed (for example that a later step shows who picks the request up): normally one sentence and a reference to that step, also under Show more, and more only where this step\'s own argument depends on it; do not repeat that step\'s explanation here.',
  'Write only from what the reader can see: do not refer to the prepared explanation, the instructions or other text given to you but not shown to the reader (no "the prepared summary says"); where the code contradicts it, simply say what the code does.',
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
  /** What the profile selects and how it explains: the rules of the first part. */
  readonly manner: readonly string[];
  /** The order of magnitude for a normal step, read with {@link LENGTH_GUIDELINE_RULES}. */
  readonly guideline: string;
  /** How this profile explains more simply. */
  readonly simpler: readonly string[];
  /** What this profile's Show more (the part after the marker) adds, in its own manner and depth. */
  readonly details: string;
}

export const PROFILES: Readonly<Record<PresentationProfile, ProfileDefinition>> = {
  original: {
    id: 'original',
    promptName: 'Original',
    manner: [],
    guideline: '',
    simpler: [],
    details: '',
  },
  essens: {
    id: 'essens',
    promptName: 'Essentials',
    manner: [
      'Give the purpose of the code and its most important events, at a level above the individual statements.',
      'Include the conditions that are decisive, summarised so they are understood rather than listed.',
      'Name concrete identifiers only where they help the reader connect the explanation to the code.',
      'Leave out mechanical details (indexes, loop bounds, every single call) unless they are decisive; any further detail that is needed goes after the marker.',
      'Of the uncertainties and risks, keep in the short part only the one that decides how the code must be judged, in a clause; the others go after the marker. State that risk precisely, what goes wrong and when, without overstating it; its details go after the marker.',
      'The short part is two plain, natural sentences: not packed sentences held together with colons, and not lists of identifiers. Name at most one or two identifiers, and only where they help the reader find the code.',
      'Lead with the purpose and the outcome in short, plain sentences; give a surprising risk its own sentence rather than a clause in a long one.',
    ],
    guideline: 'About two sentences for a normal step.',
    simpler: ['Plainer language and less jargon: the same point, said more directly.'],
    details: 'the key mechanism, briefly: how it works and why it matters here, not a full account.',
  },
  standard: {
    id: 'standard',
    promptName: 'Standard',
    manner: [
      'Write for a developer who knows programming but not this code. Say what the code is for and the consequences that matter, and develop the connections: why the conditions exist and how the parts work together.',
      'Open with the connection that matters, not with a list of the parts in the order the code names them.',
      'Not a line-by-line account. Go into detail only where the code is hard to read, the behaviour is surprising or a consequence is easy to miss, and then make exactly that clear.',
      'Place a project-specific name briefly the first time it matters. Do not teach general programming concepts.',
      'Mechanics the reader can see line by line get at most a clause. Leave out general good-practice remarks that are not a risk or a decision in this code.',
    ],
    guideline: 'About four to six sentences for a normal step.',
    simpler: ['Break the difficult connection into its parts and explain the concepts that are needed to follow it, one at a time.'],
    details: 'the connections and consequences developed further: how the mechanisms interact, the special cases that change the outcome, and what follows for the code that depends on this. Do not restate what the short part already said.',
  },
  pedagog: {
    id: 'pedagog',
    promptName: 'Teacher',
    manner: [
      'Build the concepts the reader needs for this step first: the tool, pattern or idea that would otherwise make the step hard to follow, briefly and only those this step needs.',
      'Find those concepts by what a reviewer must understand to judge this code. Investigate widely, but write only what the reader needs to understand how the parts work together and why they are needed; this is not an inventory to fill in. Ask of the code: which shared state it touches, which other paths or threads take the same lock or touch the same state (read them all, setup and teardown included, and mention those that matter for understanding this step), what protects the state and for how long (a scoped lock\'s extent where it matters); which operations must happen together and why; who owns each object, how long it lives, and what that ownership does and does not guarantee (shared ownership keeps an object alive; it does not make its contents safe to use concurrently); where a request or data is handed to another part, how that part learns of it and what it does then; and what is true when the code returns — an object reused, a request made, or the work actually done.',
      'Describe a concurrency fault precisely: unsynchronised concurrent access to a container or other shared structure, where one side writes, is a data race, undefined behaviour that can corrupt the structure, not merely a duplicate or a stale value.',
      'Explain those concepts as they apply here, in connected reasoning about purpose and interplay: not a line-by-line paraphrase, and not a general lesson on the language.',
      'Explain the reasoning step by step: why the code is shaped this way and what would go wrong otherwise.',
      'Use a concrete example, or an analogy that holds for the code, where it actually helps.',
      'Then connect it to the concrete code: the real names, what changes there, and its consequence.',
      'Define every concept term the first time it appears in the text shown. When an argument depends on what a primitive guarantees (for example what a wait releases and takes back, or which waiting threads a notification reaches), state that guarantee before using it.',
      'Include a special case only when it changes what the reader should conclude.',
    ],
    guideline: 'No fixed length: often around ten sentences for a simple step, and as much as building the needed concepts and the reasoning takes when several mechanisms interact. The short part may be as long as understanding the step needs; longer evidence, special cases and further references go after the marker. Do not shorten it to resemble the other profiles.',
    simpler: ['Try a simpler way in: a concrete case, a better analogy, or the effect as seen from the caller, before the mechanism.'],
    details: 'the evidence in the code, the special cases, and the remaining concepts the short part did not need to build.',
  },
};

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
  'The person asked for a new explanation of this step in this profile. The one they had is below: write a new one from the code and the prepared explanation, following the rules above. Do not copy its sentences or its structure; keep its facts.',
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
export function walkOutlineSection(outline: WalkOutline | null): string {
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
  lines.push(...bullets(WALK_WRITING_RULES));
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

/** The line that names the reader's profile to the agent, in every mode but `present`. */
function readerLine(profile: ProfileDefinition): string[] {
  return profile.id === 'original' ? [] : [`- The reader's profile: ${profile.promptName}. Its manner: ${profile.manner.join(' ')}`, ...bullets(EXPLANATORY_VALUE_RULES), ...bullets(MECHANISM_RULES)];
}

/** The rules of a base text in a profile: the same for walk generation, an explanation and a regeneration. */
function baseTextRules(profile: ProfileDefinition): string[] {
  return [
    'The first part, in every profile:',
    ...bullets(GROUNDING_RULES),
    ...bullets(EXPLANATORY_VALUE_RULES),
    ...bullets(MECHANISM_RULES),
    '',
    `${profile.promptName}:`,
    ...bullets(profile.manner),
    `- Length: ${profile.guideline}`,
    ...bullets(LENGTH_GUIDELINE_RULES),
    ...(profile.details === '' ? [] : [`- Show more in ${profile.promptName}: ${profile.details}`]),
  ];
}

/**
 * The prompt's section on presentation for a step explanation (DSP-184), or `null` when there
 * is nothing to add: Original is an older walk's prepared explanation and is never asked for.
 */
export function presentationPromptSection(section: PresentationSection): string | null {
  const profile = PROFILES[section.profile];
  const walk = section.walk === undefined ? [] : ['', walkOutlineSection(section.walk)];
  const lines: string[] = [];
  const last = section.shown.at(-1);
  if (section.mode === 'present' || section.mode === 'regenerate') {
    if (section.profile === 'original') {
      return null;
    }
    lines.push(
      `## How to present (${profile.promptName})`,
      `Present this step for a reader who chose ${profile.promptName}. The first part is the short part the answer format below describes; the deepening goes after the marker line it names.`,
      `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`,
      '',
      ...bullets(SAME_FACTS_RULES),
      '',
      ...baseTextRules(profile),
      '',
      'After the marker:',
      ...bullets(DEEPENING_RULES),
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
  '"details" is the deepening the person opens with Show more, for a step with real depth to add: complementary mechanics, special cases, longer evidence, more code references, in the same manner as the explanation. Leave it empty when there is nothing to add, and do not repeat the explanation in it.';

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
    `The person reads the walks in the ${definition.promptName} profile. Write each step's "summary", "body", "why" and "details" for that reader. This section decides how the steps are explained, nothing else: which walks, readings, steps and places you produce, their titles, questions and purposes, and the change's own summary and background follow the sections above and stay concise, whatever the profile.`,
    `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`,
    '',
    "Every step's explanation:",
    ...baseTextRules(definition).slice(1),
    '',
    'Every step is read beside its code, in the walk\'s order:',
    ...bullets(WALK_WRITING_RULES),
    '',
    `- ${WALK_DETAILS_RULE}`,
  ].join('\n');
}
