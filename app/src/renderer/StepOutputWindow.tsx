/**
 * The window that shows one step visit's output, or one fan-out branch's (DSP-209 S20; every
 * agent step since Niclas's trial on 15 November 2026).
 *
 * Opened from the graph's node panel (**Open live output** / **Show step output**) or a
 * Branches list, on `window=branch` with the step's address in the query. Two sources, each
 * labelled:
 *
 * - **Live output** — the run view every window folds (`currentLoopRunView`, then the run's
 *   events through the same `applyRunEvent`), so it shows what the graph and the chat show,
 *   from the tool calls and reply text so far, and keeps them when the step ends.
 * - **Saved output** — the run record's reply and commands for this visit, read with
 *   `listRunRecords` once the step is done, and again after a restart, when nothing live is
 *   left.
 *
 * When neither has anything, it says so; it never shows an empty stream as if it were one.
 * Reading only: opening or closing it starts, stops and repeats nothing in the run.
 */

import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';

import { branchRows } from '../shared/branch-presentation';
import { applyRunEvent, type RunView } from '../shared/loop-run-view';
import { branchViewsFromJournal } from '../shared/run-presentation';
import {
  describeStepOutput,
  liveOutputLines,
  liveStateFor,
  nodeVisitRows,
  savedOutputLines,
  savedStepOutput,
  stepOutputFromQuery,
  type SavedStepOutput,
} from '../shared/step-output';

type Saved = { readonly kind: 'none' } | { readonly kind: 'found'; readonly output: SavedStepOutput } | { readonly kind: 'missing'; readonly note: string };

export function StepOutputWindow(): JSX.Element {
  const address = useMemo(() => stepOutputFromQuery(window.location.search), []);
  const [view, setView] = useState<RunView | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState<Saved>({ kind: 'none' });

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
        if (seed !== null && seed.run.runId === address.runId) {
          setView((current) => current ?? seed);
        }
        setSeeded(true);
      },
      () => setSeeded(true),
    );
    return stop;
  }, [address]);

  const what = address?.sliceId === undefined ? 'step' : 'branch';
  const visits = address === null || view === null ? [] : nodeVisitRows(view.run.runId, view.entries, address.nodeId, view.ended);
  const visit = visits.find((row) => row.visit.occurrence === address?.occurrence) ?? null;
  const live = address === null || view === null ? null : liveStateFor(view.steps, view.branchSteps, address);
  // Done: the run that is live has closed this visit (or this branch), or the run is not live here.
  const done = seeded && (view === null || (address?.sliceId === undefined ? (visit?.ended ?? false) : (live?.finished ?? false) || view.ended));

  useEffect(() => {
    if (address === null || !done) {
      return;
    }
    const conversationId = address.conversationId ?? view?.run.conversationId;
    if (conversationId === undefined) {
      setSaved({ kind: 'missing', note: 'This run names no conversation here, so its saved record cannot be found from this window.' });
      return;
    }
    let current = true;
    void window.dspatch.listRunRecords(conversationId).then(
      (records) => {
        if (!current) {
          return;
        }
        const record = records.find((entry) => entry.runId === address.runId)?.record ?? null;
        setSaved(
          record === null
            ? { kind: 'missing', note: 'No saved record of this run was found in its conversation.' }
            : { kind: 'found', output: savedStepOutput(record, address) },
        );
      },
      (error: unknown) => {
        if (current) {
          setSaved({ kind: 'missing', note: `The saved record could not be read: ${error instanceof Error ? error.message : String(error)}` });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [address, done, view?.run.conversationId]);

  if (address === null) {
    return <main className="branch-window"><p>This window was not given a step to show.</p></main>;
  }
  const nodeLabel = view?.entries.find((entry) => entry.kind === 'node-entered' && entry.nodeId === address.nodeId)?.data?.['label'];
  const title = describeStepOutput(address, typeof nodeLabel === 'string' ? nodeLabel : address.nodeId, visit?.visit ?? null);
  const branch =
    address.sliceId === undefined || view === null
      ? null
      : (branchRows(branchViewsFromJournal(view.run.runId, view.entries), address.nodeId).find(
          (item) => item.key === `${address.nodeId}#${String(address.occurrence)}/${address.sliceId ?? ''}`,
        ) ?? null);
  const state = view === null ? null : done ? (view.ended ? 'The run has ended.' : `This ${what} is done; the run goes on.`) : `This ${what} is working now.`;
  const nothing = seeded && live === null && saved.kind !== 'found';
  return (
    <main className="branch-window" data-ev="step-output-window">
      <h1 className="branch-window__title">{title}</h1>
      {branch === null ? null : (
        <p className="branch-window__facts" data-ev="branch-window-facts">
          {branch.state} · {branch.visitLabel} · {branch.model} · {branch.messages}
          <br />
          Task: {branch.task}
        </p>
      )}
      <p className="branch-window__facts">
        {state === null ? '' : `${state} `}Opening or closing this window starts, stops and repeats nothing.
      </p>
      {live === null ? null : (
        <>
          <h2 className="branch-window__section">Live output</h2>
          <pre className="branch-list__output branch-window__output" data-ev="step-output-live">
            {liveOutputLines(live, what).join('\n')}
          </pre>
        </>
      )}
      {saved.kind === 'found' ? (
        <>
          <h2 className="branch-window__section">Saved output, from the run record</h2>
          <pre className="branch-list__output branch-window__output" data-ev="step-output-saved">
            {savedOutputLines(saved.output).join('\n')}
          </pre>
        </>
      ) : null}
      {saved.kind === 'missing' ? <p className="branch-window__facts">{saved.note}</p> : null}
      {nothing && saved.kind !== 'missing' && !done ? (
        <p className="branch-window__facts" data-ev="step-output-none">
          No output has been observed for this {what} yet.
        </p>
      ) : null}
      {!seeded ? <p className="branch-window__facts">Reading the run…</p> : null}
    </main>
  );
}
