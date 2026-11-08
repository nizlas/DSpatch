/**
 * DSP-176, DSP-181: the presentation policy for the review agent's explanations.
 *
 * Everything DSpatch tells the agent about *how to present* an explanation is here, in one
 * place, so that it is easy to read, compare and iterate on, and so that the window can show
 * the person exactly what a profile asks for (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md, section 2:
 * an instruction DSpatch adds is visible, not built into the code).
 *
 * A profile changes presentation only. It never changes how carefully the code is read, which
 * facts are stated, the findings, their recommendations or what is approved: every request
 * still goes through the review's own discussion, with the same envelope, code, tools and
 * read-only policy.
 *
 * One policy, three public profiles (Niclas's decision of 8 November 2026):
 * - the **grounding** every base text has, whatever the profile ({@link GROUNDING_RULES});
 * - the **details contract**: what goes before and after the one marker line the window splits
 *   on ({@link DETAILS_MARKER}, {@link SHORT_PART_RULE}, {@link DETAILS_PART_RULE}), reused by the
 *   discussion's answer format and by the walk generator, so a prompt holds one wording of it;
 *   - the **profiles**: Essentials selects the core, Standard explains how the central parts
 *   connect, Teacher builds the prerequisite knowledge first; length is a guideline, never a
 *   quota ({@link LENGTH_GUIDELINE_RULES}).
 * - **Original** is the walk's prepared explanation: a legacy presentation, kept and viewable,
 *   never asked for again and hidden from the ordinary chooser.
 *
 * The ids are stable and never shown: the names and descriptions the person reads come from
 * the window's own words in its language (`review-i18n.ts`); prompts use the English names.
 */

export type PresentationProfile = 'original' | 'essens' | 'standard' | 'pedagog';
/** The profiles the person can choose. */
export type PublicProfile = Exclude<PresentationProfile, 'original'>;

export const PUBLIC_PROFILES: readonly PublicProfile[] = ['essens', 'standard', 'pedagog'];
/** Every id a stored record may carry, the legacy one included. */
export const PRESENTATION_PROFILES: readonly PresentationProfile[] = ['original', ...PUBLIC_PROFILES];
export const DEFAULT_PROFILE: PublicProfile = 'standard';
/** The prepared explanation, as the walk generator wrote it: shown while an alternative is on its way and on request. */
export const LEGACY_PROFILE: PresentationProfile = 'original';
/** Raised when profile instructions change in meaning; stored on new alternatives. */
export const PRESENTATION_INSTRUCTION_VERSION = 3;

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
  'Answer first, in a short part that stands on its own: enough to understand the point without reading further. Any uncertainty that changes the answer belongs in this part.';

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
  'This changes how the step is presented, not what is said about the code. Keep every fact, risk, uncertainty, finding and recommendation the prepared explanation and the code support; add none the code does not support, and do not change what is reviewed or approved.',
  'Read the code again when you need to; do not present what you have not read.',
] as const;

/**
 * What a base text (the short part) holds in every profile (DSP-181). Brevity selects among
 * these; it never replaces them with vaguer words.
 */
export const GROUNDING_RULES = [
  'Name the concrete functions, settings, types or other parts that are central to the step, with their real names; explain a term rather than replacing it with a vague word such as "the other mechanism" or "one of the options".',
  'Say what changes and its most important consequence.',
  'State the relevant default values explicitly.',
  'Keep the conditions, fallback behaviour and uncertainties that are decisive for a correct understanding.',
  'Present this step; do not start a new broad review. Do not retell the whole discussion or every finding of the review: an important objection may be summarised in one line that points to its thread. A new observation of yours is an observation, not a verified fact, and it changes no decision of the review.',
] as const;

/**
 * Length is a guideline for a normal step, said once with what it is not, so that no profile
 * pads or truncates to hit a number (DSP-181).
 */
export const LENGTH_GUIDELINE_RULES = [
  'The length given for this profile is the order of magnitude for a normal step, not a count to hit, not a cap, not an order between profiles and not a reason to fill out a simple explanation. A simple change is explained briefly in every profile; a complex or wide change may take more room when the material calls for it. Every sentence must add understanding. Do not press many clauses into very long sentences.',
] as const;

/** The form of the details, in every profile. */
export const DEEPENING_RULES = [
  'After the marker line: the deepening only, in the same manner as the first part, readable even when long: short paragraphs, lists where they help, small code excerpts where they carry the point.',
  'Name the code you rest on with references, as for any answer, so the person can open it.',
] as const;

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
}

export const PROFILES: Readonly<Record<PresentationProfile, ProfileDefinition>> = {
  original: {
    id: 'original',
    promptName: 'Original',
    manner: [],
    guideline: '',
    simpler: [],
  },
  essens: {
    id: 'essens',
    promptName: 'Essentials',
    manner: [
      'Select the core and put it precisely: what changes, the behaviour that matters most, and what the reader needs to understand or check here.',
      'Keep the concrete names, the relevant defaults and the most important behaviour.',
      'Leave out mechanical intermediate steps and side details that are not needed to understand the change; they belong after the marker if anywhere.',
      'A short lead sentence and a few short bullet points are welcome; no headings for their own sake.',
    ],
    guideline: 'About two sentences, or the same said as a few short bullet points, for a normal step.',
    simpler: [
      'Plainer language and less jargon, still concrete: the same names, the same point, said more directly.',
    ],
  },
  standard: {
    id: 'standard',
    promptName: 'Standard',
    manner: [
      'Give a straight technical explanation for a developer of ordinary experience who did not write this change.',
      'Explain how the central parts connect and the mechanism that makes the change understandable: what calls what, what data moves, what decides the outcome.',
      'Do not assume detailed knowledge of this project: say what a project-specific name is the first time it matters.',
    ],
    guideline: 'About five sentences for a normal step.',
    simpler: [
      'Break the difficult connection into its parts and explain the concepts that are needed to follow it, one at a time.',
    ],
  },
  pedagog: {
    id: 'pedagog',
    promptName: 'Teacher',
    manner: [
      'Teach the prerequisite knowledge the reader needs for this step first, briefly: the tool, pattern or concept that would otherwise make the text hard to follow. For a build system, for example, that may be the difference between declaring a build setting, reading it while configuring and using the result at run time.',
      'Build the reasoning step by step, and use one concrete example or an analogy when it actually helps and holds for the code.',
      'Then connect it to the concrete code: the real names, what changes there, and its consequence.',
      'No general lessons that this step does not need.',
    ],
    guideline: 'About ten sentences for a normal step, some building the prerequisite knowledge and some making it concrete through an example.',
    simpler: [
      'Try a simpler way in: a concrete case, a better analogy, or the effect as seen from the caller, before the mechanism.',
    ],
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

/** A follow-up question asked after an explanation in a profile, or after a simpler one. */
export const FOLLOW_UP_RULES = [
  'The question follows the explanation below, which the person has just read. Answer it at the same level of explanation: keep its terms, its mental model and its examples, and add the information the question asks for.',
  'Do not switch to a dense technical account because the question asks for more; more detail can still be plain. Keep it as short as the question allows.',
] as const;

/** What a question asks of the presentation, as the window sends it and the discussion keeps it. */
export interface PresentationRequest {
  readonly profile: PresentationProfile;
  /**
   * The answers whose explanations the person has seen in this chain, oldest first: for Explain
   * more simply, what to build on; for a follow-up or Tell me more, the last is the one it follows.
   */
  readonly shown?: readonly string[];
  /** The profile-instruction version used when this request was asked. */
  readonly version?: number;
}

/** A presentation request from a window, or `null` when there is none or it is malformed. */
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

/** What the prompt's presentation section is built from, the texts resolved by the discussion. */
export interface PresentationSection {
  readonly profile: PresentationProfile;
  /**
   * `present`: an alternative explanation of the step; `more`: Tell me more; `simpler`: Explain
   * more simply; `follow`: a question of the person's own.
   */
  readonly mode: 'present' | 'more' | 'simpler' | 'follow';
  /** The explanations already shown, oldest first, each with what it was. */
  readonly shown: readonly { readonly label: string; readonly text: string }[];
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
  return profile.id === 'original' ? [] : [`- The reader's profile: ${profile.promptName}. Its manner: ${profile.manner.join(' ')}`];
}

/**
 * The prompt's section on presentation, or `null` when there is nothing to add: Original is the
 * prepared explanation and is never asked for; a plain question in Original with nothing shown
 * is asked as before the profiles.
 */
export function presentationPromptSection(section: PresentationSection): string | null {
  const profile = PROFILES[section.profile];
  const lines: string[] = [];
  if (section.mode === 'present') {
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
      'The first part, in every profile:',
      ...bullets(GROUNDING_RULES),
      '',
      `${profile.promptName}:`,
      ...bullets(profile.manner),
      `- Length: ${profile.guideline}`,
      ...bullets(LENGTH_GUIDELINE_RULES),
      '',
      'After the marker:',
      ...bullets(DEEPENING_RULES),
    );
    return lines.join('\n');
  }
  if (section.mode === 'simpler') {
    const round = section.shown.length;
    lines.push(`## Explaining more simply (attempt ${String(Math.max(1, round))}${profile.id === 'original' ? '' : `, ${profile.promptName}`})`, ...bullets(SIMPLER_RULES));
    if (round > 1) {
      lines.push(...bullets(SIMPLER_AGAIN_RULES));
    }
    if (profile.id !== 'original') {
      lines.push(`- In ${profile.promptName}: ${profile.simpler.join(' ')}`, ...readerLine(profile));
    }
    for (const [index, entry] of section.shown.entries()) {
      lines.push('', `### Shown ${String(index + 1)}: ${entry.label}`, clipped(entry.text));
    }
    return lines.join('\n');
  }
  const last = section.shown.at(-1);
  if (section.mode === 'more') {
    if (last === undefined) {
      // Nothing of this profile was shown: Tell me more deepens the prepared explanation, as before the profiles.
      return profile.id === 'original' ? null : [`## The reader's profile (${profile.promptName})`, ...readerLine(profile)].join('\n');
    }
    lines.push(`## Going deeper (${profile.promptName})`, ...bullets(MORE_RULES), ...readerLine(profile), '', `### ${last.label}`, clipped(last.text));
    return lines.join('\n');
  }
  // A follow-up: Original with nothing shown asks as today.
  if (last === undefined) {
    return profile.id === 'original' ? null : [`## The reader's profile (${profile.promptName})`, ...readerLine(profile)].join('\n');
  }
  lines.push(`## The explanation this question follows (${profile.promptName})`, ...bullets(FOLLOW_UP_RULES), ...readerLine(profile));
  const simplerRounds = section.shown.filter((entry) => entry.label.startsWith('Explain more simply')).length;
  if (simplerRounds > 0) {
    lines.push(`- They asked for it more simply ${String(simplerRounds)} time(s); stay at that simpler level.`);
  }
  lines.push('', `### ${last.label}`, clipped(last.text));
  return lines.join('\n');
}

/** Everything a profile asks for, as the window shows it under "What it asks for". */
export function profileInstructionText(profile: PresentationProfile): string {
  const definition = PROFILES[profile];
  const head = [`${definition.promptName}`, `Instruction version: ${String(PRESENTATION_INSTRUCTION_VERSION)}`, ''];
  if (profile === 'original') {
    return [
      ...head,
      'The prepared explanation of the walk, as its generator wrote it. Nothing is added to it; it is kept for comparison and is not asked for again.',
      '',
      'Explain more simply, in every profile:',
      ...bullets(SIMPLER_RULES),
      'Pressed again:',
      ...bullets(SIMPLER_AGAIN_RULES),
    ].join('\n');
  }
  return [
    ...head,
    'Every profile:',
    ...bullets(SAME_FACTS_RULES),
    ...bullets(GROUNDING_RULES),
    '',
    `${definition.promptName}:`,
    ...bullets(definition.manner),
    `- Length: ${definition.guideline}`,
    ...bullets(LENGTH_GUIDELINE_RULES),
    '',
    'After the marker (Show more):',
    `- ${SHORT_PART_RULE}`,
    `- ${DETAILS_PART_RULE}`,
    ...bullets(DEEPENING_RULES),
    '',
    'Tell me more:',
    ...bullets(MORE_RULES),
    '',
    'Explain more simply:',
    ...bullets(SIMPLER_RULES),
    `- In ${definition.promptName}: ${definition.simpler.join(' ')}`,
    'Pressed again:',
    ...bullets(SIMPLER_AGAIN_RULES),
    '',
    'A follow-up question:',
    ...bullets(FOLLOW_UP_RULES),
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
    ...bullets(GROUNDING_RULES),
    '',
    `${definition.promptName}:`,
    ...bullets(definition.manner),
    `- Length: ${definition.guideline}`,
    ...bullets(LENGTH_GUIDELINE_RULES),
    '',
    `- ${WALK_DETAILS_RULE}`,
  ].join('\n');
}
