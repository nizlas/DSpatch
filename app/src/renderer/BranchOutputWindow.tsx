/**
 * DSP-209 S20: the window that follows one fan-out branch's live output.
 *
 * Opened by **Open in window** in a Branches list, on `window=branch` with the branch's
 * address in the query. It reads the run view once (`currentLoopRunView`) and then folds the
 * run's events itself with the same `applyRunEvent` every window uses, so it shows what the
 * graph view and the chat show. Reading only: nothing here reaches the run.
 */

import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import {
  branchActivityFor,
  branchAddressFromQuery,
  branchOutputLines,
  branchRows,
  describeBranchAddress,
} from '../shared/branch-presentation';
import { applyRunEvent, type RunView } from '../shared/loop-run-view';
import { branchViewsFromJournal } from '../shared/run-presentation';

export function BranchOutputWindow(): JSX.Element {
  const address = useMemo(() => branchAddressFromQuery(window.location.search), []);
  const [view, setView] = useState<RunView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (address === null) {
      return;
    }
    // Events first, so none is lost while the read is in flight; the read only seeds a
    // view that has not been seen yet, and is never applied over a newer one.
    const stop = window.dspatch.onLoopRunEvent((event) => {
      setView((current) => (current === null ? current : applyRunEvent(current, event)));
    });
    void window.dspatch.currentLoopRunView().then(
      (seed) => {
        if (seed === null || seed.run.runId !== address.runId) {
          setProblem('This run is not the one DSpatch is running now, so there is no live output to follow.');
          return;
        }
        setView((current) => current ?? seed);
      },
      (error: unknown) => setProblem(`The run could not be read: ${error instanceof Error ? error.message : String(error)}`),
    );
    return stop;
  }, [address]);

  if (address === null) {
    return <main className="branch-window"><p>This window was not given a branch to follow.</p></main>;
  }
  const row = view === null ? null : branchRows(branchViewsFromJournal(view.run.runId, view.entries), address.nodeId).find((item) => item.key === `${address.nodeId}#${String(address.occurrence)}/${address.sliceId ?? ''}`) ?? null;
  const title = describeBranchAddress(address, address.nodeId);
  return (
    <main className="branch-window" data-ev="branch-window">
      <h1 className="branch-window__title">{title}</h1>
      {row === null ? null : (
        <p className="branch-window__facts" data-ev="branch-window-facts">
          {row.state} · {row.visitLabel} · {row.model} · {row.messages}
          <br />
          Task: {row.task}
        </p>
      )}
      {view?.ended === true ? <p className="branch-window__facts">The run has ended.</p> : null}
      {problem === null ? null : <p className="branch-window__facts">{problem}</p>}
      <pre className="branch-list__output branch-window__output" data-ev="branch-window-output">
        {branchOutputLines(branchActivityFor(view?.branchSteps, address)).join('\n')}
      </pre>
    </main>
  );
}
