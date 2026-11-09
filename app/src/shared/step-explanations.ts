/**
 * DSP-184: a walk step's explanations, apart from the review's discussion.
 *
 * Niclas's decision of 9 November 2026: a profile switch, a regeneration, Tell me more,
 * Explain more simply and Explain this from Step update only the step's explanation in Step.
 * They create no discussion entries and use no discussion turn. Each profile has its own saved
 * explanations and its own history per review, walk, step and step version; switching back
 * shows what is there without a call, and the walk's own text can always be returned to.
 *
 * This module is the shape of that store and the rules for reading it, shared by the service
 * that writes it (`step-explanation-channel.ts`) and the window that shows it. It is kept as
 * `<key>.explanations.json` beside the discussion's `<key>.discussion.json`, with the same
 * identity key, so it follows the review wherever the discussion does.
 */
import { PROFILE_PROMPT_NAMES, isPublicProfile, type PresentationProfile, type PublicProfile } from './presentation-profiles';
import type { CheckedContextReference, CheckedReference, DiscussionIdentity, DiscussionProvider } from './review-discussion';

/** What asked for an explanation. */
export type ExplanationAction = 'present' | 'regenerate' | 'more' | 'simpler' | 'explain';

export const EXPLANATION_ACTIONS: readonly ExplanationAction[] = ['present', 'regenerate', 'more', 'simpler', 'explain'];

/** Where an explanation is. `unknown`: nobody saw how it ended; it is never repeated on its own. */
export type ExplanationStatus = 'sending' | 'streaming' | 'done' | 'failed' | 'cancelled' | 'unknown';

/** Which step explanation history an entry belongs to. */
export interface ExplanationSlot {
  readonly walkId: string;
  readonly stepId: string;
  /** The step's content hash: a changed step reuses nothing. */
  readonly basis: string;
  readonly profile: PublicProfile;
}

/** One stored explanation of a step in a profile. */
export interface StepExplanation extends ExplanationSlot {
  readonly id: string;
  readonly action: ExplanationAction;
  /** The entry it builds on; `null` for the walk's own text (or nothing, for a first explanation). */
  readonly parent: string | null;
  /** Explain this: the selected text. */
  readonly selection?: string;
  /** The answer as shown: its short part, the marker and its details; the references block taken off. */
  readonly text: string;
  readonly references?: readonly CheckedReference[];
  readonly contextReferences?: readonly CheckedContextReference[];
  readonly adjustments?: readonly string[];
  readonly insufficient?: boolean;
  readonly status: ExplanationStatus;
  readonly error?: string;
  readonly at: string;
  readonly finishedAt?: string;
  /** The exact prompt sent: internal, for troubleshooting and caching; never sent to a window. */
  readonly prompt?: string;
  /** The profile-instruction version it was written under. */
  readonly instructionVersion: number;
  readonly language: 'sv' | 'en';
  readonly provider?: DiscussionProvider;
  readonly model?: string;
  readonly dspatchSessionId?: string;
  readonly dspatchRunId?: string;
  readonly codeAccess?: boolean;
  /** What triggered it: the window on arrival at a step, or the person. */
  readonly trigger: 'auto' | 'person';
}

export const STEP_EXPLANATIONS_FORMAT_VERSION = 1;

export interface StepExplanationRecord {
  readonly version: typeof STEP_EXPLANATIONS_FORMAT_VERSION;
  readonly identity: DiscussionIdentity;
  readonly entries: readonly StepExplanation[];
  readonly savedAt: string;
}

export type StepExplanationAdoption =
  | { readonly kind: 'adopted'; readonly record: StepExplanationRecord }
  | { readonly kind: 'newer'; readonly problem: string }
  | { readonly kind: 'unusable'; readonly problem: string };

const STATUSES: readonly ExplanationStatus[] = ['sending', 'streaming', 'done', 'failed', 'cancelled', 'unknown'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** One stored entry, or `null` when it is not one. Unknown fields are dropped, nothing is invented. */
function adoptEntry(raw: unknown): StepExplanation | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = str(raw['id']);
  const walkId = str(raw['walkId']);
  const stepId = str(raw['stepId']);
  const basis = str(raw['basis']);
  const profile = raw['profile'];
  const action = raw['action'];
  const status = raw['status'];
  if (id === undefined || walkId === undefined || stepId === undefined || basis === undefined || !isPublicProfile(profile)) {
    return null;
  }
  if (!EXPLANATION_ACTIONS.includes(action as ExplanationAction) || !STATUSES.includes(status as ExplanationStatus)) {
    return null;
  }
  const parent = raw['parent'] === null ? null : (str(raw['parent']) ?? null);
  const optional = <K extends keyof StepExplanation>(key: K, value: StepExplanation[K] | undefined): Partial<StepExplanation> => (value === undefined ? {} : ({ [key]: value } as Partial<StepExplanation>));
  return {
    id,
    walkId,
    stepId,
    basis,
    profile,
    action: action as ExplanationAction,
    parent,
    text: str(raw['text']) ?? '',
    status: status as ExplanationStatus,
    at: str(raw['at']) ?? '',
    instructionVersion: typeof raw['instructionVersion'] === 'number' ? raw['instructionVersion'] : 0,
    language: raw['language'] === 'sv' ? 'sv' : 'en',
    trigger: raw['trigger'] === 'auto' ? 'auto' : 'person',
    ...optional('selection', str(raw['selection'])),
    ...optional('references', Array.isArray(raw['references']) ? (raw['references'] as CheckedReference[]) : undefined),
    ...optional('contextReferences', Array.isArray(raw['contextReferences']) ? (raw['contextReferences'] as CheckedContextReference[]) : undefined),
    ...optional('adjustments', Array.isArray(raw['adjustments']) ? raw['adjustments'].filter((entry): entry is string => typeof entry === 'string') : undefined),
    ...optional('insufficient', raw['insufficient'] === true ? true : undefined),
    ...optional('error', str(raw['error'])),
    ...optional('finishedAt', str(raw['finishedAt'])),
    ...optional('prompt', str(raw['prompt'])),
    ...optional('provider', raw['provider'] === 'cursor' || raw['provider'] === 'claude' || raw['provider'] === 'copilot' ? raw['provider'] : undefined),
    ...optional('model', str(raw['model'])),
    ...optional('dspatchSessionId', str(raw['dspatchSessionId'])),
    ...optional('dspatchRunId', str(raw['dspatchRunId'])),
    ...optional('codeAccess', raw['codeAccess'] === true ? true : undefined),
  };
}

/** A stored record, read for this review; a newer format is left alone, an unreadable one kept aside. */
export function adoptStepExplanations(raw: unknown, identity: DiscussionIdentity): StepExplanationAdoption {
  if (!isRecord(raw)) {
    return { kind: 'unusable', problem: 'it is not a JSON object' };
  }
  const version = raw['version'];
  if (typeof version !== 'number') {
    return { kind: 'unusable', problem: 'it has no format version' };
  }
  if (version > STEP_EXPLANATIONS_FORMAT_VERSION) {
    return { kind: 'newer', problem: `The stored step explanations are format ${String(version)}, newer than this DSpatch reads (${String(STEP_EXPLANATIONS_FORMAT_VERSION)}); they are shown as nothing and not written over.` };
  }
  const entries = Array.isArray(raw['entries']) ? raw['entries'].map(adoptEntry).filter((entry): entry is StepExplanation => entry !== null) : [];
  return { kind: 'adopted', record: { version: STEP_EXPLANATIONS_FORMAT_VERSION, identity, entries, savedAt: str(raw['savedAt']) ?? '' } };
}

/** The slot's key, for maps. */
export function slotKey(slot: ExplanationSlot): string {
  return `${slot.walkId}\u0000${slot.stepId}\u0000${slot.basis}\u0000${slot.profile}`;
}

export function inSlot(entry: ExplanationSlot, slot: ExplanationSlot): boolean {
  return entry.walkId === slot.walkId && entry.stepId === slot.stepId && entry.basis === slot.basis && entry.profile === slot.profile;
}

/** Whether an entry is still on its way. */
export function isPending(entry: StepExplanation): boolean {
  return entry.status === 'sending' || entry.status === 'streaming';
}

/** The id the history uses for the walk's own text. */
export const WALK_TEXT = 'walk';

/**
 * A slot's history as the window reads it: the walk's own text first, then every finished
 * explanation, oldest first. What is shown is the latest unless the person went back.
 */
export interface ExplanationHistory {
  /** `WALK_TEXT` for the walk's own text, else entry ids; finished entries only. */
  readonly items: readonly string[];
  /** The finished entries, by id. */
  readonly entries: ReadonlyMap<string, StepExplanation>;
  /** The latest entry asked for and still on its way, if any. */
  readonly pending: StepExplanation | null;
  /** The latest entry, when it ended without an explanation and nothing was asked after it. */
  readonly failed: StepExplanation | null;
  /** Whether any explanation of this slot finished. */
  readonly hasDone: boolean;
}

export function historyOf(entries: readonly StepExplanation[], slot: ExplanationSlot): ExplanationHistory {
  const own = entries.filter((entry) => inSlot(entry, slot));
  const done = own.filter((entry) => entry.status === 'done' && entry.text.trim() !== '');
  const latest = own.at(-1) ?? null;
  const pending = latest !== null && isPending(latest) ? latest : null;
  const failed = latest !== null && !isPending(latest) && latest.status !== 'done' ? latest : null;
  return {
    items: [WALK_TEXT, ...done.map((entry) => entry.id)],
    entries: new Map(done.map((entry) => [entry.id, entry])),
    pending,
    failed,
    hasDone: done.length > 0,
  };
}

/**
 * What is shown: the item the person went back or forward to, while it is still in the
 * history; otherwise the latest. `chosen` is the window's own navigation, never stored.
 */
export function shownItem(history: ExplanationHistory, chosen: string | undefined): string {
  if (chosen !== undefined && history.items.includes(chosen)) {
    return chosen;
  }
  return history.items.at(-1) ?? WALK_TEXT;
}

/**
 * The finished explanations an action builds on, oldest first, following the parent links
 * from `from`: what Explain more simply builds on and what Tell me more goes deeper into.
 */
export function chainTo(entries: readonly StepExplanation[], from: string | null, limit = 6): readonly StepExplanation[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chain: StepExplanation[] = [];
  let at = from === null ? undefined : byId.get(from);
  while (at !== undefined && chain.length < limit) {
    if (at.status === 'done') {
      chain.unshift(at);
    }
    at = at.parent === null ? undefined : byId.get(at.parent);
  }
  return chain;
}

/** How an earlier explanation is named to the agent: by the action that asked for it. */
export function explanationLabel(entry: StepExplanation): string {
  switch (entry.action) {
    case 'present':
      return `The ${PROFILE_PROMPT_NAMES[entry.profile]} explanation of the step`;
    case 'regenerate':
      return `The regenerated ${PROFILE_PROMPT_NAMES[entry.profile]} explanation of the step`;
    case 'more':
      return 'Tell me more';
    case 'simpler':
      return 'Explain more simply';
    case 'explain':
      return `Explain this: “${(entry.selection ?? '').replace(/\s+/g, ' ').slice(0, 80)}”`;
  }
}

/**
 * Whether the window should ask for a profile's explanation on its own (DSP-181, kept): not
 * when the walk's own explanations are written in the profile, not when one is there or on its
 * way, and not after an attempt ended without one: a failure waits for the person's Try again,
 * so a provider that keeps failing is never asked again and again on its own.
 */
export function wantsExplanation(walkProfile: PresentationProfile | null, profile: PublicProfile, history: ExplanationHistory): boolean {
  return walkProfile !== profile && !history.hasDone && history.pending === null && history.failed === null;
}

/** A step explanation as a window receives it: without the prompt, which stays internal. */
export function forWindow(entry: StepExplanation): StepExplanation {
  const { prompt: _prompt, ...rest } = entry;
  return rest;
}

/** What a window sends to ask for a step explanation. */
export interface StepExplanationInput extends ExplanationSlot {
  readonly action: ExplanationAction;
  readonly parent: string | null;
  readonly selection?: string;
  readonly trigger: 'auto' | 'person';
  readonly language: 'sv' | 'en';
  /** The step's walk, for the walk-relative rules. */
  readonly outline?: unknown;
  /** Explain this on code: the selection as a quote, checked by the envelope like any other. */
  readonly quote?: unknown;
}

/** What the explanation channel tells the windows, on the discussion's event channel. */
export type StepExplanationEvent =
  | { readonly kind: 'explanation'; readonly entry: StepExplanation }
  | { readonly kind: 'explanation-delta'; readonly entryId: string; readonly text: string }
  | { readonly kind: 'explanation-busy'; readonly busy: { readonly entryId: string; readonly activity?: string } | null };

export type StepExplanationOutcome =
  | { readonly kind: 'sent'; readonly entryId: string }
  | { readonly kind: 'refused'; readonly error: string; readonly busy?: true }
  | { readonly kind: 'failed'; readonly error: string; readonly entryId: string };

/** What a window reads on open: every entry, without prompts, and whether one is on its way. */
export interface StepExplanationsView {
  readonly entries: readonly StepExplanation[];
  readonly busy: { readonly entryId: string; readonly activity?: string } | null;
  readonly note: string | null;
}
