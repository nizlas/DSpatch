/**
 * The node panel's way to a step's output (Niclas, 15 November 2026): a visible button for
 * the selected agent step, **Open live output** while its visit works and **Show step output**
 * once it is done, which opens the step output window (`StepOutputWindow`). The visit working
 * now, or the latest, comes first; earlier visits and rework attempts are folded below it.
 *
 * Outside the editing lock, as the Branches list is: reading a step's output is not editing
 * the drawing, and a click starts, stops and repeats nothing. A graph with no run shown says
 * it has no run data rather than offering an empty stream. A fan-out step's work is done in
 * its branches, which the Branches list opens one by one.
 */

import { useState } from 'react';
import type { JSX } from 'react';

import type { LoopNode } from '../shared/loop-graph';
import type { RunView } from '../shared/loop-run-view';
import { liveOutputAddressFor } from '../shared/run-presentation';
import { nodeVisitRows, visitContextWords, visitModelWords, type StepVisitRow } from '../shared/step-output';

export function StepOutputActions({ node, watch }: { readonly node: LoopNode; readonly watch: RunView | null }): JSX.Element | null {
  const [note, setNote] = useState<string | null>(null);
  if (node.kind !== 'agent') {
    return null;
  }
  const run = watch === null || watch.run.phase === 'ready' ? null : watch;
  const open = (row: StepVisitRow): void => {
    const conversationId = run?.run.conversationId;
    void window.dspatch
      .openStepOutput({ ...liveOutputAddressFor(row.visit), ...(conversationId === undefined ? {} : { conversationId }) })
      .then(
        (outcome) => setNote(outcome.opened ? null : outcome.note),
        (error: unknown) => setNote(`The window could not be opened: ${error instanceof Error ? error.message : String(error)}`),
      );
  };
  const button = (row: StepVisitRow): JSX.Element => (
    <button type="button" className="button" data-ev="step-output-open" onClick={() => open(row)}>
      {row.ended ? 'Show step output' : 'Open live output'}
    </button>
  );
  const visits = run === null ? [] : nodeVisitRows(run.run.runId, run.entries, node.id, run.ended);
  // DSP-225: each visit with the class and model it ran with, and what its agent had in context.
  const facts = (row: StepVisitRow): string => {
    const model = visitModelWords(row.model);
    return `${row.label}${model === null ? '' : ` · ${model}`}`;
  };
  const current = visits[visits.length - 1];
  const earlier = visits.slice(0, -1).reverse();
  return (
    <section className="step-output-actions" data-ev="step-output-actions" aria-label={`Output of ${node.label ?? node.id}`}>
      <h3 className="branch-list__heading">Step output</h3>
      {run === null ? (
        <p className="muted" data-ev="step-output-no-run">
          No run is shown in this graph, so there is no run data for this step.
        </p>
      ) : current === undefined ? (
        <p className="muted">This step has not run in the run shown here.</p>
      ) : node.fanOut !== undefined ? (
        <p className="muted">
          This step’s work is done in its branches ({current.label}): open each one from <strong>Branches</strong> below.
        </p>
      ) : (
        <>
          <p className="step-output-actions__row" data-ev="step-output-current" title={visitContextWords(current) ?? undefined}>
            {button(current)}{' '}
            <span>
              {current.ended ? (visits.length > 1 ? 'Latest' : 'Done') : 'Now'}: {facts(current)}
            </span>
          </p>
          {visitContextWords(current) === null ? null : (
            <p className="muted" data-ev="step-output-context">
              {visitContextWords(current)}
            </p>
          )}
          {earlier.length === 0 ? null : (
            <details className="step-output-actions__earlier">
              <summary>Earlier visits ({String(earlier.length)})</summary>
              {earlier.map((row) => (
                <p key={row.visit.occurrence} className="step-output-actions__row" data-ev="step-output-earlier" title={visitContextWords(row) ?? undefined}>
                  {button(row)} <span>{facts(row)} · done</span>
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {note === null ? null : <p className="branch-list__note branch-list__note--problem">{note}</p>}
    </section>
  );
}
