/**
 * DSP-176, DSP-181: the presentation profile the person reads in, and what the discussion holds for it.
 *
 * The choice is the person's, per walk and per computer: kept in the windows' own storage so
 * the walk window and its panel stay in sync. The last chosen profile is also kept as the
 * default for newly opened walks. Without an earlier public choice the default is Standard; a
 * saved Essentials or Teacher is kept; a saved Original is the legacy presentation and no
 * longer a choice, so the default stands (nothing stored is rewritten).
 *
 * DSP-184: the explanations themselves are the step explanations' own store, apart from the
 * discussion ({@link useStepExplanations}); what a step shows is chosen from it per review, walk,
 * step, step version and profile, so an answer that arrives late, after the person moved on, is
 * kept and shown only where it belongs.
 */
import { useCallback, useEffect, useState } from 'react';

import { effectiveProfile, isPublicProfile, type PresentationProfile, type PublicProfile } from '../shared/presentation-profiles';
import type { StepExplanation } from '../shared/step-explanations';

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
  // Before any walk exists (an empty scope) the choice is the computer's alone: the one the next
  // preparation writes its explanations in, and the one the picker beside the agent shows.
  if (scope === '') {
    return effectiveProfile(stored(DEFAULT_STORAGE_KEY));
  }
  return chosenProfile(stored(`${WALK_STORAGE_PREFIX}${scope}`), fallback, stored(DEFAULT_STORAGE_KEY));
}

/**
 * The chosen profile of one walk, shared by windows through storage. With an empty scope (no walk
 * yet) it is the computer's choice, which the next preparation uses (DSP-181).
 */
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
      if (scope !== '') {
        window.localStorage.setItem(scopedKey, next);
      }
    } catch {
      // Not kept past this window; the choice still holds here.
    }
  }, [scope, scopedKey]);
  return [profile, choose] as const;
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

/** The review's step explanations as a window holds them, and the one being written. */
export interface StepExplanationsState {
  readonly entries: readonly StepExplanation[];
  readonly busy: { readonly entryId: string; readonly activity?: string } | null;
}

/** Merge an entry into a list, replacing an earlier copy of it. */
export function withEntry(entries: readonly StepExplanation[], entry: StepExplanation): readonly StepExplanation[] {
  const at = entries.findIndex((candidate) => candidate.id === entry.id);
  if (at < 0) {
    return [...entries, entry];
  }
  const next = [...entries];
  next[at] = entry;
  return next;
}

/**
 * DSP-184: the review's step explanations, read on open and kept current from the events every
 * window of the review hears. Reading asks the provider for nothing.
 */
export function useStepExplanations(scope: string): StepExplanationsState {
  const [state, setState] = useState<StepExplanationsState>({ entries: [], busy: null });
  useEffect(() => {
    const bridge = window.dspatchReviewDiscussion;
    if (bridge === undefined) {
      return;
    }
    let live = true;
    void bridge
      .load(null)
      .then((outcome) => {
        if (live && outcome.kind === 'loaded' && outcome.explanations !== undefined) {
          const view = outcome.explanations;
          setState((before) => ({ entries: view.entries.reduce(withEntry, before.entries), busy: view.busy }));
        }
      })
      .catch(() => undefined);
    const off = bridge.onEvent((event) => {
      if (event.kind === 'explanation') {
        setState((before) => ({ ...before, entries: withEntry(before.entries, event.entry) }));
      } else if (event.kind === 'explanation-delta') {
        setState((before) => ({
          ...before,
          entries: before.entries.map((entry) => (entry.id === event.entryId ? { ...entry, text: entry.text + event.text } : entry)),
        }));
      } else if (event.kind === 'explanation-busy') {
        setState((before) => ({ ...before, busy: event.busy }));
      }
    });
    return () => {
      live = false;
      off();
    };
  }, [scope]);
  return state;
}
