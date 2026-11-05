/**
 * What a walk's context place says about itself (DSP-175): which repository, file, lines and
 * commit it shows, how that commit was chosen, and whether it is established as what the
 * reviewed build uses. Pure, so the words are tested apart from the window.
 *
 * The how and the established come from the review's context record (`readContextFile`),
 * the record of what the analysis was given, never from the definition alone and never
 * from a working copy. Until that record has answered, or when it cannot, the relation is
 * unknown and says so: HEAD is never presented as the reviewed build's dependency.
 */
import type { ContextPlace } from '../shared/review-model';
import type { ContextFileView } from '../shared/review-pair';

/** How many lines are shown around a context place's focus. */
export const CONTEXT_MARGIN = 4;

export type ContextRelation = 'established' | 'not-established' | 'unknown';

export interface ContextPaneLabel {
  readonly repository: string;
  readonly path: string;
  /** `line 3` or `lines 3–9`. */
  readonly lines: string;
  readonly commit: string;
  readonly shortCommit: string;
  /** How the commit was chosen, in plain words; empty while unknown. */
  readonly how: string;
  readonly relation: ContextRelation;
  /** One sentence on the relation to the reviewed build. */
  readonly relationText: string;
}

const HOW: Readonly<Record<ContextFileView['how'], string>> = {
  submodule: 'the commit the reviewed To commit pins as a submodule',
  dependency: 'the tag of the version the reviewed To commit declares',
  'path-dependency': 'HEAD when the analysis ran: the reviewed build uses a path dependency, whatever is checked out',
  head: 'HEAD when the analysis ran',
};

export function contextPaneLabel(place: ContextPlace, view: ContextFileView | { readonly error: string } | null): ContextPaneLabel {
  const focus = place.focus;
  const known = view !== null && !('error' in view) && view.commit === focus.commit ? view : null;
  const relation: ContextRelation = known === null ? 'unknown' : known.established ? 'established' : 'not-established';
  return {
    repository: focus.repository,
    path: focus.path,
    lines: focus.start === focus.end ? `line ${String(focus.start)}` : `lines ${String(focus.start)}–${String(focus.end)}`,
    commit: focus.commit,
    shortCommit: focus.commit.slice(0, 10),
    how: known === null ? '' : HOW[known.how],
    relation,
    relationText:
      relation === 'established'
        ? 'Established as the version the reviewed build uses.'
        : relation === 'not-established'
          ? 'Relation to the reviewed build not established: this is what the repository had at that commit, not necessarily what the reviewed build uses.'
          : 'Relation to the reviewed build unknown: the review\'s context record did not say how this commit was chosen.',
  };
}

/** The lines to show, or why they cannot be: the file must still have the place's lines at its commit. */
export function contextExcerpt(
  place: ContextPlace,
  text: string,
): { readonly from: number; readonly lines: readonly string[] } | { readonly problem: string } {
  const all = text.split('\n');
  if (all.at(-1) === '') {
    all.pop();
  }
  if (place.focus.end > all.length) {
    return { problem: `${place.focus.path} has ${String(all.length)} lines at ${place.focus.commit.slice(0, 10)}; the place ends at line ${String(place.focus.end)}.` };
  }
  if (place.focus.anchor !== undefined && !all.slice(place.focus.start - 1, place.focus.end).join('\n').includes(place.focus.anchor)) {
    return { problem: `"${place.focus.anchor.slice(0, 60)}" does not occur on those lines at ${place.focus.commit.slice(0, 10)}.` };
  }
  const from = Math.max(1, place.focus.start - CONTEXT_MARGIN);
  const to = Math.min(all.length, place.focus.end + CONTEXT_MARGIN);
  return { from, lines: all.slice(from - 1, to).map((line) => line.replace(/\r$/, '')) };
}
