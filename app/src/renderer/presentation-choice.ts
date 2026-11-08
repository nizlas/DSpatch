/**
 * DSP-176, DSP-181: the presentation profile the person reads in, and what the discussion holds for it.
 *
 * The choice is the person's, per walk and per computer: kept in the windows' own storage so
 * the walk window and its panel stay in sync. The last chosen profile is also kept as the
 * default for newly opened walks. Without an earlier public choice the default is Standard; a
 * saved Essentials or Teacher is kept; a saved Original is the legacy presentation and no
 * longer a choice, so the default stands (nothing stored is rewritten).
 *
 * The explanations themselves are in the review's discussion record: an alternative is the
 * answer to a `present` deepening of one step, asked in one profile from one version of the
 * step (its content hash). What is shown is chosen from that record, so an answer that arrives
 * late, after the person moved on, is kept and shown only where it belongs.
 */
import { useCallback, useEffect, useState } from 'react';

import { effectiveProfile, isPublicProfile, type PresentationProfile, type PublicProfile } from '../shared/presentation-profiles';
import type { DiscussionMessage } from '../shared/review-discussion';

const DEFAULT_STORAGE_KEY = 'dspatch.review.presentationProfile.default';
const WALK_STORAGE_PREFIX = 'dspatch.review.presentationProfile.walk:';

function stored(key: string): PublicProfile | null {
  try {
    const value = window.localStorage.getItem(key);
    return isPublicProfile(value) ? value : null;
  } catch {
    return null;
  }
}

/** The walk's own choice, then the review state's, then the computer's last choice, then the default. */
export function chosenProfile(walkChoice: unknown, stateChoice: unknown, defaultChoice: unknown): PublicProfile {
  return isPublicProfile(walkChoice) ? walkChoice : isPublicProfile(stateChoice) ? stateChoice : effectiveProfile(defaultChoice);
}

function read(scope: string, fallback: PresentationProfile | null): PublicProfile {
  return chosenProfile(stored(`${WALK_STORAGE_PREFIX}${scope}`), fallback, stored(DEFAULT_STORAGE_KEY));
}

/** The chosen profile of one walk, shared by windows through storage. */
export function usePresentationProfile(scope: string, fallback: PresentationProfile | null): readonly [PublicProfile, (profile: PublicProfile) => void] {
  const scopedKey = `${WALK_STORAGE_PREFIX}${scope}`;
  const [profile, setState] = useState<PublicProfile>(() => read(scope, fallback));
  useEffect(() => {
    setState(read(scope, fallback));
  }, [scope, fallback]);
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === scopedKey || event.key === DEFAULT_STORAGE_KEY) {
        setState(read(scope, fallback));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [scopedKey, scope, fallback]);
  const choose = useCallback((next: PublicProfile) => {
    setState(next);
    try {
      window.localStorage.setItem(DEFAULT_STORAGE_KEY, next);
      window.localStorage.setItem(scopedKey, next);
    } catch {
      // Not kept past this window; the choice still holds here.
    }
  }, [scopedKey]);
  return [profile, choose] as const;
}

export interface Exchange {
  readonly question: DiscussionMessage;
  readonly answer: DiscussionMessage | null;
}

function answerOf(messages: readonly DiscussionMessage[], question: DiscussionMessage): DiscussionMessage | null {
  return messages.find((message) => message.role === 'answer' && message.questionId === question.id) ?? null;
}

/** A question asked from this step's own actions (not from a point worth checking). */
function atStep(message: DiscussionMessage, stepId: string): boolean {
  const subject = message.envelope?.subject;
  return message.role === 'question' && message.deepen !== undefined && subject?.kind === 'point' && subject.stepId === stepId && subject.checkId === undefined;
}

/** The profile a deepening was asked in; one asked before profiles is Original's. */
export function profileOf(question: DiscussionMessage): PresentationProfile {
  return question.deepen?.profile ?? question.presentation?.profile ?? 'original';
}

/**
 * The alternative explanation of a step in a profile, from this version of the step: the
 * latest asked, with its answer. A finished one is preferred to a later attempt that failed,
 * so a failed retry never hides what was there. Original is the prepared explanation itself
 * and has none.
 */
export function alternativeFor(messages: readonly DiscussionMessage[], stepId: string, basis: string, profile: PresentationProfile): { readonly done: Exchange | null; readonly latest: Exchange | null } {
  if (profile === 'original') {
    return { done: null, latest: null };
  }
  const asked = messages
    .filter((message) => atStep(message, stepId) && message.deepen?.action === 'present' && message.deepen.profile === profile && message.deepen.basis === basis)
    .map((question) => ({ question, answer: answerOf(messages, question) }));
  const done = [...asked].reverse().find((entry) => entry.answer?.status === 'done' && entry.answer.text.trim() !== '') ?? null;
  return { done, latest: asked.at(-1) ?? null };
}

/**
 * The step's deepenings that belong to the explanation shown: asked in this profile, from this
 * version of the step (or, in Original, from before versions were recorded). The alternative
 * itself is shown as the explanation, not among them.
 */
export function deepeningsOf(messages: readonly DiscussionMessage[], stepId: string, basis: string, profile: PresentationProfile): readonly Exchange[] {
  return messages
    .filter(
      (message) =>
        atStep(message, stepId) &&
        message.deepen?.action !== 'present' &&
        profileOf(message) === profile &&
        (message.deepen?.basis === undefined ? profile === 'original' : message.deepen.basis === basis),
    )
    .map((question) => ({ question, answer: answerOf(messages, question) }));
}

/**
 * The finished answers the person has seen at this step in this profile, oldest first: the
 * alternative, then each deepening's answer. What Explain more simply builds on, and what a
 * follow-up question or Tell me more follows (the last of them).
 */
export function shownChain(messages: readonly DiscussionMessage[], stepId: string, basis: string, profile: PresentationProfile): readonly string[] {
  const alternative = alternativeFor(messages, stepId, basis, profile).done?.answer?.id;
  const deepened = deepeningsOf(messages, stepId, basis, profile)
    .filter((entry) => entry.answer?.status === 'done')
    .map((entry) => entry.answer?.id ?? '')
    .filter((id) => id !== '');
  return [...(alternative === undefined ? [] : [alternative]), ...deepened].slice(-6);
}

/**
 * The computer's last chosen profile, which a newly prepared walk's explanations are written in
 * (DSP-181), kept in sync between the review's windows through storage.
 */
export function useDefaultProfile(): readonly [PublicProfile, (profile: PublicProfile) => void] {
  const [profile, setState] = useState<PublicProfile>(() => effectiveProfile(stored(DEFAULT_STORAGE_KEY)));
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === DEFAULT_STORAGE_KEY) {
        setState(effectiveProfile(stored(DEFAULT_STORAGE_KEY)));
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const choose = useCallback((next: PublicProfile) => {
    setState(next);
    try {
      window.localStorage.setItem(DEFAULT_STORAGE_KEY, next);
    } catch {
      // Not kept past this window; the choice still holds here.
    }
  }, []);
  return [profile, choose] as const;
}

/**
 * Whether the step needs an alternative asked for in the profile the person reads in (DSP-181):
 * not when the walk's own explanations are written in that profile, and not when one is there
 * or on its way. Opening a walk in its own profile therefore asks for nothing.
 */
export function wantsAlternative(walkProfile: PresentationProfile | null, profile: PublicProfile, hasDone: boolean, pending: boolean): boolean {
  return walkProfile !== profile && !hasDone && !pending;
}
