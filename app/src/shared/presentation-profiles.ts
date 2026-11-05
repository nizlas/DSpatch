/**
 * DSP-176: presentation profiles for the review agent's explanations.
 *
 * Everything DSpatch tells the agent about *how to present* an explanation is here, in one
 * place, so that it is easy to read, compare and iterate on, and so that the window can show
 * the person exactly what a profile asks for (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md, section 2:
 * an instruction DSpatch adds is visible, not built into the code).
 *
 * A profile changes presentation only. It never changes how carefully the code is read, which
 * facts are stated, the findings, their recommendations or what is approved: every request
 * still goes through the review's own discussion, with the same envelope, code, tools and
 * read-only policy as Tell me more and Explain more simply.
 *
 * - Original is today's presentation: the walk's prepared explanation and today's deepening
 *   questions, sent exactly as before. Only Explain more simply has new rules, in every profile.
 * - Essens and Pedagog ask, on an explicit action, for an alternative explanation of one step,
 *   kept beside the prepared one and never replacing it.
 */

export type PresentationProfile = 'original' | 'essens' | 'pedagog';

export const PRESENTATION_PROFILES: readonly PresentationProfile[] = ['original', 'essens', 'pedagog'];

export interface ProfileDefinition {
  readonly id: PresentationProfile;
  /** The name shown in the window. */
  readonly name: string;
  /** One sentence saying what the profile gives, shown with the choice. */
  readonly description: string;
  /** What the first presentation does; empty for Original, which asks for none. */
  readonly first: readonly string[];
  /** What goes under Show more. */
  readonly more: readonly string[];
}

/** Rules every alternative presentation follows, whatever its profile. */
export const PRESENTATION_COMMON_RULES = [
  'This changes how the step is presented, not what is said about the code. Keep every fact, risk, uncertainty, finding and recommendation the prepared explanation and the code support; add none the code does not support, and do not change what is reviewed or approved.',
  'Read the code again when you need to; do not present what you have not read. Keep the class, method and file names; explain a term rather than replacing it with a vague word.',
  'Start with what the reader needs to understand the point of the step. Do not repeat the heading or the lead in the list that follows; one statement is made once.',
  'Write short paragraphs and group what belongs together. Put a technical detail where it helps the reasoning, not as a list of everything you read.',
  'Do not cut an important fact, risk or uncertainty to keep the text short; there is no word limit, only the rule that the first part is what a normal walk-through needs.',
  'Then the line that starts Show more, as the answer format below says, and after it real depth that the first part does not have, not the first part again. Keep it easy to read too: paragraphs, short lists, and small code excerpts where they help.',
  'Name the code you rest on with references, as for any answer, so the person can open it.',
] as const;

export const PROFILES: Readonly<Record<PresentationProfile, ProfileDefinition>> = {
  original: {
    id: 'original',
    name: 'Original',
    description: 'The walk’s prepared explanation, as today. Tell me more and Explain more simply work as before.',
    first: [],
    more: [],
  },
  essens: {
    id: 'essens',
    name: 'Essens',
    description: 'What changes, why, and what you need to understand or check. Show more gives the mechanism, special cases and more references.',
    first: [
      'Answer three things, in this order, each briefly: What changes? Why? What does the reader need to understand or check here?',
      'Enough for a normal review of this step without being chatty: no background the reader does not need for the point, no restating of the code line by line.',
      'Necessary details, important risks and uncertainties stay in the first part; they are not moved under Show more to make it shorter.',
    ],
    more: ['Under Show more: the mechanism step by step, special cases and edge conditions, how it connects to the code around it, and further code references.'],
  },
  pedagog: {
    id: 'pedagog',
    name: 'Pedagog',
    description: 'A simple mental model first, with a short concrete example when it helps. Show more adds detail in the same plain language.',
    first: [
      'Begin with a simple mental model of what this code does: what it is for and how its parts relate, in plain words, before any mechanism.',
      'Use one short concrete example when it helps understanding: a real input and what happens to it, true to the code’s actual behaviour. An analogy only when it holds for the code.',
      'Introduce few concepts at a time; explain a necessary technical term the first time it appears.',
    ],
    more: ['Under Show more: the details, in the same plain language and building on the same mental model and example: how it works, special cases, and the code references.'],
  },
};

/**
 * Explain more simply (DSP-176), in every profile. Repeated presses build on what was shown
 * and try another way in; they do not grow longer, and they end with a short question rather
 * than "it cannot be simpler".
 */
export const SIMPLER_RULES = [
  'Explain the same thing more simply for the same person. Reduce the number of concepts they must hold at once.',
  'Start with what the code achieves; explain how only where it is needed.',
  'Use plain words. Keep the class, method and file names and explain a necessary technical term rather than avoiding it.',
  'When it helps, use one concrete example or an analogy that is true to what the code actually does.',
  'Keep the important reservations and uncertainties; simpler is not less true.',
  'Do not add detail the earlier explanation did not need, and do not make this answer longer than the explanation it simplifies.',
  'Do not repeat the earlier explanation with a few words changed: take another way in.',
] as const;

/** Added when the person has asked for a simpler explanation before, in this chain. */
export const SIMPLER_AGAIN_RULES = [
  'The explanations already shown are below. They did not make it clear enough. Try a different teaching approach from all of them — for example a concrete case instead of an abstract description, or the effect seen from the caller — not the same approach in other words.',
  'If you judge that yet another angle is unlikely to help, do not say that it cannot be explained more simply. Instead give your best short explanation and end with one short question asking which concept or connection is unclear, naming two or three candidates from the explanation.',
] as const;

/** A follow-up question asked after an explanation in a profile, or after a simpler one. */
export const FOLLOW_UP_RULES = [
  'The question follows the explanation below, which the person has just read. Answer it at the same level of explanation: keep its terms, its mental model and its examples, and add the information the question asks for.',
  'Do not switch to a dense technical account because the question asks for more; more detail can still be plain. Keep it as short as the question allows.',
] as const;

/** Whether a stored or sent value names a profile. */
export function isProfile(value: unknown): value is PresentationProfile {
  return value === 'original' || value === 'essens' || value === 'pedagog';
}

/** What a question asks of the presentation, as the window sends it and the discussion keeps it. */
export interface PresentationRequest {
  readonly profile: PresentationProfile;
  /**
   * The answers whose explanations the person has seen in this chain, oldest first: for Explain
   * more simply, what to build on; for a follow-up, the last is the one it follows.
   */
  readonly shown?: readonly string[];
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
  return { profile: value['profile'], ...(shown.length === 0 ? {} : { shown }) };
}

/** What the prompt's presentation section is built from, the texts resolved by the discussion. */
export interface PresentationSection {
  readonly profile: PresentationProfile;
  /** `present`: an alternative explanation of the step; `simpler`: Explain more simply; `follow`: a follow-up. */
  readonly mode: 'present' | 'simpler' | 'follow';
  /** The explanations already shown, oldest first, each with what it was. */
  readonly shown: readonly { readonly label: string; readonly text: string }[];
}

/** The limit on each earlier explanation quoted into a prompt. */
const SHOWN_CHARS = 4_000;

function clipped(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= SHOWN_CHARS ? trimmed : `${trimmed.slice(0, SHOWN_CHARS)}\n[… cut at ${String(SHOWN_CHARS)} characters]`;
}

/**
 * The prompt's section on presentation, or `null` when there is nothing to add: Original adds
 * nothing to an ordinary question or to Tell me more, so today's prompts stay as they were.
 */
export function presentationPromptSection(section: PresentationSection): string | null {
  const profile = PROFILES[section.profile];
  const lines: string[] = [];
  if (section.mode === 'present') {
    if (section.profile === 'original') {
      return null;
    }
    lines.push(`## How to present (${profile.name})`, `Present this step again for a reader who chose ${profile.name}: ${profile.description}`, '');
    lines.push(...[...profile.first, ...PRESENTATION_COMMON_RULES, ...profile.more].map((rule) => `- ${rule}`));
    return lines.join('\n');
  }
  if (section.mode === 'simpler') {
    const round = section.shown.length;
    lines.push(`## Explaining more simply (attempt ${String(Math.max(1, round))})`, ...SIMPLER_RULES.map((rule) => `- ${rule}`));
    if (round > 1) {
      lines.push(...SIMPLER_AGAIN_RULES.map((rule) => `- ${rule}`));
    }
    if (section.profile !== 'original') {
      lines.push(`- The person reads in the ${profile.name} profile: ${profile.description}`);
    }
    for (const [index, entry] of section.shown.entries()) {
      lines.push('', `### Shown ${String(index + 1)}: ${entry.label}`, clipped(entry.text));
    }
    return lines.join('\n');
  }
  // A follow-up: Original with nothing shown asks as today.
  if (section.profile === 'original' && section.shown.length === 0) {
    return null;
  }
  lines.push('## The explanation this question follows', ...FOLLOW_UP_RULES.map((rule) => `- ${rule}`));
  if (section.profile !== 'original') {
    lines.push(`- The person reads in the ${profile.name} profile: ${profile.description}`);
  }
  const simplerRounds = section.shown.filter((entry) => entry.label.startsWith('Explain more simply')).length;
  if (simplerRounds > 0) {
    lines.push(`- They asked for it more simply ${String(simplerRounds)} time(s); stay at that simpler level.`);
  }
  const last = section.shown.at(-1);
  if (last !== undefined) {
    lines.push('', `### ${last.label}`, clipped(last.text));
  }
  return lines.join('\n');
}

/** Everything a profile asks for, as the window shows it under "What it asks for". */
export function profileInstructionText(profile: PresentationProfile): string {
  const definition = PROFILES[profile];
  if (profile === 'original') {
    return [
      `${definition.name}: ${definition.description}`,
      '',
      'Nothing is added to the prepared explanation or to the questions. Explain more simply follows these rules in every profile:',
      ...SIMPLER_RULES.map((rule) => `- ${rule}`),
      'Pressed again:',
      ...SIMPLER_AGAIN_RULES.map((rule) => `- ${rule}`),
    ].join('\n');
  }
  return [
    `${definition.name}: ${definition.description}`,
    '',
    'The first presentation:',
    ...definition.first.map((rule) => `- ${rule}`),
    '',
    'For every alternative presentation:',
    ...PRESENTATION_COMMON_RULES.map((rule) => `- ${rule}`),
    '',
    ...definition.more.map((rule) => `- ${rule}`),
    '',
    'A follow-up question:',
    ...FOLLOW_UP_RULES.map((rule) => `- ${rule}`),
  ].join('\n');
}
