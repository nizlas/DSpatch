/**
 * Whether a chosen definition can actually be walked, answered once.
 *
 * DSP-84 #5 asks that a definition which cannot run says why **at the point of
 * choosing**, with no silent fall back to another loop. The three checks that decide
 * that already existed and were written out inline in `PREPARE_CHAT_LOOP`: read the
 * declaration and its graph, validate the graph with the definition's own role
 * resolver, and ask {@link describeChosenLoopBinding} whether chat may walk it.
 *
 * They are here because there are now three callers — the preview, the editor's
 * `Use this loop`, and anything later that wants to judge a row before offering it —
 * and three copies of a refusal is three wordings of it. DSP-84 was explicit about
 * reusing the existing vocabulary rather than inventing a second one, and the cheapest
 * way to keep that true is for there to be one function to reuse.
 *
 * **It decides nothing and records nothing.** It reads, and it answers.
 */

import { describeChosenLoopBinding } from '../shared/loop-chat';
import type { LiveBinding } from '../shared/loop-editor-run';
import type { LoopGraph } from '../shared/loop-graph';
import { formatFindings, loadLoopGraph } from '../shared/loop-graph-load';
import type { ChosenLoop, ChosenLoopOutcome } from './loop-definition-choice';

export type LoopChoiceJudgement =
  | {
      readonly runnable: true;
      readonly chosen: ChosenLoop;
      /** The validated graph, so a caller that needs it does not read the file twice. */
      readonly graph: LoopGraph;
      readonly binding: LiveBinding;
    }
  | {
      readonly runnable: false;
      readonly note: string;
      /**
       * The same refusal at the length a dropdown can carry (DSP-85 #8).
       *
       * Not a summary and not a second vocabulary: it is `note` with the finding list
       * folded down to the first error and a count. The chat's preview has room for the
       * whole thing and keeps reading `note`; the editor's chooser has a line beside a
       * `<select>`, and DSP-84's trial put fifteen lines there. A reason nobody finishes
       * reading is not a reason, and the full list is on the canvas.
       */
      readonly brief: string;
    };

/**
 * Judge what `openChosenLoop` returned.
 *
 * The three refusals, in the order a run meets them, each keeping the sentence it
 * already had:
 *
 * 1. the declaration or its graph could not be read — `openChosenLoop`'s own note;
 * 2. the graph does not validate — the definition's name and `formatFindings`;
 * 3. the runner will not walk this drawing — the binding's own reason.
 *
 * `connectedTargets` is `['cursor']` for the same reason it is in the preview and in
 * the run: a graph's target binding is part of whether it validates, and judging it
 * against a different set would answer a question neither of those asked.
 *
 * `consequence` is the caller's half of the one sentence that has one — *there is
 * nothing to show*, *it was not chosen*. Passed in rather than fixed, because the
 * finding is the same fact and what follows from it is not; making the preview share a
 * tail about choosing would have it claim something it did not do.
 */
export function judgeChosenLoop(
  outcome: ChosenLoopOutcome,
  consequence: string,
): LoopChoiceJudgement {
  if (!outcome.ok) {
    // One sentence already: a file that could not be read, or a declaration with no
    // resource root. Nothing to fold down, so the two lengths are the same string
    // rather than a shortened copy that could drift from it.
    return { runnable: false, note: outcome.note, brief: outcome.note };
  }
  const chosen = outcome.chosen;
  const loaded = loadLoopGraph(chosen.graphText, {
    resolveRole: chosen.resolveRole,
    connectedTargets: ['cursor'],
  });
  if (!loaded.ok) {
    /*
     * The findings that caused the refusal, not every finding the file has.
     *
     * A graph with one dangling edge produced fifteen lines here, thirteen of which
     * were notices about features that are recorded and not yet honoured. They are
     * true and they belong in the editor, where a person is reading the file; in a
     * refusal they bury the two sentences that say what is actually wrong, and a
     * reason nobody finishes reading is not a reason. The rest are counted rather
     * than dropped, and the editor is named as the place they are.
     */
    const errors = loaded.findings.filter((finding) => finding.severity === 'error');
    const others = loaded.findings.length - errors.length;
    const rest =
      others === 0
        ? ''
        : `\n\n${String(others)} further finding${others === 1 ? '' : 's'} (warnings and ` +
          `notices) are not listed here. Open the definition in the loop editor to read them.`;
    const head = `"${chosen.definitionName}" points at a graph that does not validate, so ${consequence}`;
    // The brief keeps the first error and counts the rest of *everything*, warnings and
    // notices included. Beside a dropdown one nameable fault and a number is what a
    // person can act on; which severity the remainder was is a question the canvas
    // answers properly.
    const beyondTheFirst = loaded.findings.length - 1;
    const firstError = errors[0];
    return {
      runnable: false,
      note: `${head}:\n\n${formatFindings(errors)}${rest}`,
      brief:
        firstError === undefined
          ? `${head}.`
          : `${head}: ${firstError.message}${
              beyondTheFirst === 0
                ? ''
                : ` (and ${String(beyondTheFirst)} further finding${beyondTheFirst === 1 ? '' : 's'}; the canvas lists them all.)`
            }`,
    };
  }
  const binding = describeChosenLoopBinding(loaded.graph, chosen.definitionName);
  if (!binding.ready) {
    return { runnable: false, note: binding.reason, brief: binding.reason };
  }
  return { runnable: true, chosen, graph: loaded.graph, binding };
}
