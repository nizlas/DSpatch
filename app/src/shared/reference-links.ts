/**
 * DSP-185: where a reference in an explanation or an answer leads.
 *
 * Niclas's decision of 9 November 2026: a reference to code the walk shows leads first to that
 * walk step and its explanation; a necessary reference outside the walk opens the right file at
 * the right lines, marked; an unresolvable reference says so instead of jumping to a guess.
 *
 * Resolution is structural only: a checked reference's path, side and lines against the walk's
 * places (their focus), and an explicit step reference's id against the walk's step ids. No text
 * is matched and nothing is guessed. Shared by Step explanations and Discussion answers, which
 * render references through one component (`DiscussionAnswer.tsx`).
 */
import type { CodeLocation, RevisionSide, Walk } from './review-model';

/** What a reference resolves to. */
export type ReferenceTarget =
  /** Code a walk step shows: go to that step and place. */
  | {
      readonly kind: 'step';
      readonly walkId: string;
      readonly stepId: string;
      readonly placeIndex: number;
      readonly stepTitle: { readonly sv: string; readonly en: string };
      /** The reference is to the step being read. */
      readonly here: boolean;
    }
  /** Code in a file the review's diff changes: open it there, the lines marked. */
  | { readonly kind: 'diff'; readonly location: CodeLocation }
  /** Code in a file the diff does not change: open the file at the revision, the lines marked. */
  | { readonly kind: 'unchanged'; readonly location: CodeLocation }
  /** Nothing to go to: shown as text, with why. */
  | { readonly kind: 'unresolved'; readonly reason: string };

/** The walk and the diff a reference is resolved against. */
export interface ReferenceScope {
  /** The walks of the open review, in order; points' own tours are not part of it. */
  readonly walks: readonly Walk[];
  /** The paths the review's diff changes (at To; a removed file by its From path). */
  readonly changedPaths: ReadonlySet<string>;
  /** The step being read, if any: a reference to it says "here". */
  readonly currentStepId: string | null;
}

function overlap(a: { readonly start: number; readonly end: number }, b: { readonly start: number; readonly end: number }): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1);
}

/**
 * A checked line reference: the walk step whose place's focus contains it (the narrowest such
 * place, the step being read first among equals, then walk order); else the place it overlaps
 * most; else the file in the diff or the unchanged file. Same path and side only.
 */
export function resolveLineReference(range: { readonly path: string; readonly side: RevisionSide; readonly start: number; readonly end: number }, scope: ReferenceScope): ReferenceTarget {
  if (range.path === '' || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 1 || range.end < range.start) {
    return { kind: 'unresolved', reason: 'It does not name a file and lines.' };
  }
  interface Candidate {
    readonly walk: Walk;
    readonly stepIndex: number;
    readonly placeIndex: number;
    /** The focus holds the whole reference. */
    readonly contains: boolean;
    /** Contained: the focus's size (narrower first); else the lines shared (more first). */
    readonly measure: number;
    readonly here: boolean;
    readonly order: number;
  }
  const candidates: Candidate[] = [];
  let order = 0;
  for (const walk of scope.walks) {
    walk.steps.forEach((step, stepIndex) => {
      step.places.forEach((place, placeIndex) => {
        order += 1;
        const focus = place.focus;
        if (focus.path !== range.path || focus.side !== range.side) {
          return;
        }
        const shared = overlap(focus, range);
        if (shared === 0) {
          return;
        }
        const contains = focus.start <= range.start && focus.end >= range.end;
        candidates.push({ walk, stepIndex, placeIndex, contains, measure: contains ? focus.end - focus.start + 1 : shared, here: step.id === scope.currentStepId, order });
      });
    });
  }
  // A containing place first, the narrowest; else the largest overlap. Among equals, the step
  // being read, then walk order.
  candidates.sort((a, b) => {
    if (a.contains !== b.contains) {
      return a.contains ? -1 : 1;
    }
    if (a.measure !== b.measure) {
      return a.contains ? a.measure - b.measure : b.measure - a.measure;
    }
    if (a.here !== b.here) {
      return a.here ? -1 : 1;
    }
    return a.order - b.order;
  });
  const found = candidates[0];
  const step = found?.walk.steps[found.stepIndex];
  if (found !== undefined && step !== undefined) {
    return { kind: 'step', walkId: found.walk.id, stepId: step.id, placeIndex: found.placeIndex, stepTitle: step.title, here: step.id === scope.currentStepId };
  }
  const location: CodeLocation = { path: range.path, side: range.side, start: range.start, end: range.end };
  return scope.changedPaths.has(range.path) ? { kind: 'diff', location } : { kind: 'unchanged', location };
}

/** An explicit step reference: the step with that id in the walks shown, or why there is none. */
export function resolveStepReference(stepId: string, scope: ReferenceScope): ReferenceTarget {
  for (const walk of scope.walks) {
    const step = walk.steps.find((entry) => entry.id === stepId);
    if (step !== undefined) {
      return { kind: 'step', walkId: walk.id, stepId: step.id, placeIndex: 0, stepTitle: step.title, here: step.id === scope.currentStepId };
    }
  }
  return { kind: 'unresolved', reason: scope.walks.length === 0 ? `No walk is open to find step ${stepId} in.` : `This walk has no step ${stepId}.` };
}
