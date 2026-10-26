import fs from 'node:fs';
import path from 'node:path';

/*
 * The bundled example review (DSP-129): the DSP-116 walk, kept in the repository at
 * `examples/review/dsp-116.review.json` so a second reviewer can open it from the
 * main window. Its `repository` is `../..`, the clone root relative to the file, so
 * it reviews the two revisions in whichever clone it is opened from - never an
 * absolute path, an old worktree, a Temp folder or a test kit.
 *
 * Only the location is decided here. Opening goes through `ReviewWindows.open` like
 * every other review, and the reviewer's record lives under `userData/reviews/`,
 * never beside the bundled file.
 */

/** The example's place in DSpatch's own repository, as path segments. */
export const EXAMPLE_REVIEW_SEGMENTS = ['examples', 'review', 'dsp-116.review.json'] as const;

export type ExampleReviewLocation =
  | { readonly kind: 'found'; readonly definitionPath: string; readonly repositoryRoot: string }
  | { readonly kind: 'unavailable'; readonly note: string };

/**
 * Where the example is for a DSpatch whose own repository root is `ownRoot`
 * (`ownRepositoryRoot(app.getAppPath())`), or why it cannot be offered.
 *
 * `null` means DSpatch is not running from inside a clone of its repository - a
 * packaged copy moved out of the tree, for instance - and then there is nothing to
 * review: the example is two revisions of that repository.
 */
export function locateExampleReview(
  ownRoot: string | null,
  exists: (file: string) => boolean = fs.existsSync,
): ExampleReviewLocation {
  if (ownRoot === null) {
    return {
      kind: 'unavailable',
      note:
        'The example review needs a clone of the DSpatch repository: it reviews two revisions of DSpatch itself, ' +
        'and this DSpatch is not running from inside a clone (a packaged or moved copy has no repository beside it). ' +
        'Run DSpatch from a full clone of its repository to open the example.',
    };
  }
  const definitionPath = path.join(ownRoot, ...EXAMPLE_REVIEW_SEGMENTS);
  if (!exists(definitionPath)) {
    return {
      kind: 'unavailable',
      note:
        `DSpatch is running from its repository at ${ownRoot}, but the example review is not there ` +
        `(${EXAMPLE_REVIEW_SEGMENTS.join('/')}). A checkout from before the example was added does not have it.`,
    };
  }
  return { kind: 'found', definitionPath, repositoryRoot: ownRoot };
}
