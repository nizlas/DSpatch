/**
 * The window that streams one step visit's output, or a fan-out visit's branches (DSP-209 S20;
 * every agent step, with the chat's live presentation, since Niclas's trials on 15 November
 * 2026).
 *
 * Opened by clicking an agent node while the graph shows a run (or from the node panel and
 * the Branches list), on `window=branch` with the step's address in the query. It reads the
 * run once from the main process, which keeps the last few runs folded from the events it
 * relays (`stepOutputRunView`), so everything the visit has streamed is there when it opens,
 * also after the step or the run has ended; then it folds the run's events as they come, with
 * the same `applyRunEvent` every window uses. Text, tool calls and the status line are the
 * chat's live step pieces (`LiveStepParts`, `stepStanding`).
 *
 * A finished step is marked finished, not live. A run the main process no longer holds (after
 * a restart) is shown from its run record, and says so. Reading only: opening or closing the
 * window starts, stops and repeats nothing, and no agent is called to show anything.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import { branchRows } from '../shared/branch-presentation';
import { stepStanding } from '../shared/loop-activity';
import { branchViewsFromJournal } from '../shared/run-presentation';
import {
  OPENING_FEED,
  describeStepOutput,
  feedEvent,
  feedSeed,
  liveStateFor,
  nodeVisitRows,
  savedStepOutput,
  stepOutputFromQuery,
  visitContextWords,
  visitModelWords,
  type SavedStepOutput,
  type StepOutputFeed,
  type StepVisitRow,
} from '../shared/step-output';
import { LiveReplyText, LiveToolCalls } from './LiveStepParts';
import { followAfterScrollEvent } from './scroll-follow';

type Saved =
  | { readonly kind: 'none' }
  // DSP-225: with the record's own visits of this node, so a window opened after a restart still
  // names its visit's class and model and the visits that came after it.
  | { readonly kind: 'found'; readonly output: SavedStepOutput; readonly visits: readonly StepVisitRow[] }
  | { readonly kind: 'missing'; readonly note: string };

export function StepOutputWindow(): JSX.Element {
  const address = useMemo(() => stepOutputFromQuery(window.location.search), []);
  const [feed, setFeed] = useState<StepOutputFeed>(OPENING_FEED);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>({ kind: 'none' });
  const [chosenSlice, setChosenSlice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  /**
   * DSP-225: the visit shown. It starts as the one the window was opened for — the node's latest,
   * from the graph — and the reader moves back and forth between the node's visits here. A visit
   * that starts while the window is open does not take it over; it is offered (see `latestRow`).
   */
  const [chosenVisit, setChosenVisit] = useState<number | null>(null);
  /** DSP-225: the node's visits as its run record lists them, for a window that reads the record. */
  const [recordVisits, setRecordVisits] = useState<readonly StepVisitRow[]>([]);

  useEffect(() => {
    if (address === null) {
      return;
    }
    // Events first, held until the read answers; see `feedEvent`.
    const stop = window.dspatch.onLoopRunEvent((event) => setFeed((current) => feedEvent(current, event)));
    void window.dspatch.stepOutputRunView(address.runId).then(
      (seed) => setFeed((current) => feedSeed(current, seed)),
      (error: unknown) => {
        setFeed((current) => feedSeed(current, null));
        setProblem(`The live connection to this run could not be made: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
    return stop;
  }, [address]);

  const seeded = feed.held === null;
  const view = feed.view;
  const nodeId = address?.nodeId ?? '';
  const at = address === null ? null : { ...address, occurrence: chosenVisit ?? address.occurrence };
  const visits = view === null ? [] : nodeVisitRows(view.run.runId, view.entries, nodeId, view.ended);
  const visit = visits.find((row) => row.visit.occurrence === at?.occurrence) ?? null;
  // A fan-out visit opened as a whole: its branches, each followed on its own.
  const branches =
    address === null || view === null
      ? []
      : branchRows(branchViewsFromJournal(view.run.runId, view.entries), nodeId).filter((row) => row.address.occurrence === at?.occurrence);
  const isFanOut = at !== null && at.sliceId === undefined && branches.length > 0;
  const slice = isFanOut
    ? (chosenSlice ?? branches.find((row) => row.state === 'working')?.sliceId ?? branches[0]?.sliceId ?? null)
    : (at?.sliceId ?? null);
  const shown = at === null ? null : { ...at, ...(slice === null ? {} : { sliceId: slice }) };
  const live = shown === null || view === null ? null : liveStateFor(view.steps, view.branchSteps, shown);
  const branch = slice === null ? null : (branches.find((row) => row.sliceId === slice) ?? null);
  const what = slice === null ? 'step' : 'branch';
  const finished =
    seeded &&
    (view === null ||
      (slice === null
        ? (visit?.ended ?? false) || (live?.finished ?? false)
        : (live?.finished ?? false) || view.ended || (branch !== null && branch.state !== 'working' && branch.state !== 'queued')));

  // The status line ticks while the step works, as the chat's does.
  useEffect(() => {
    if (finished) {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [finished]);

  // The run record, when nothing live is held for this visit: after a restart.
  const needSaved = seeded && shown !== null && (view === null || (live === null && finished));
  useEffect(() => {
    if (!needSaved || shown === null) {
      return;
    }
    const conversationId = shown.conversationId ?? view?.run.conversationId;
    if (conversationId === undefined) {
      setSaved({ kind: 'missing', note: 'There is no run data for this step here: the run is not held now, and it names no conversation whose record could be read.' });
      return;
    }
    let current = true;
    void window.dspatch.listRunRecords(conversationId).then(
      (records) => {
        const record = records.find((entry) => entry.runId === shown.runId)?.record ?? null;
        if (current) {
          if (record !== null) {
            setRecordVisits(nodeVisitRows(shown.runId, record.journal, shown.nodeId, true));
          }
          setSaved(
            record === null
              ? { kind: 'missing', note: 'There is no run data for this step: no record of its run was found.' }
              : { kind: 'found', output: savedStepOutput(record, shown), visits: nodeVisitRows(shown.runId, record.journal, shown.nodeId, true) },
          );
        }
      },
      (error: unknown) => {
        if (current) {
          setSaved({ kind: 'missing', note: `The run record could not be read: ${error instanceof Error ? error.message : String(error)}` });
        }
      },
    );
    return () => {
      current = false;
    };
    // `shown` is rebuilt every render; its parts are what matter.
  }, [needSaved, shown?.runId, shown?.nodeId, shown?.occurrence, shown?.sliceId, shown?.conversationId, view?.run.conversationId]);

  // Follow the latest while the reader is at the foot; let them scroll up without being pulled back.
  const stream = useRef<HTMLDivElement | null>(null);
  const following = useRef(true);
  const appliedTop = useRef<number | null>(null);
  const [atFoot, setAtFoot] = useState(true);
  const contentKey = `${slice ?? ''}|${String(live?.text.length ?? -1)}|${live?.tools.map((tool) => tool.status ?? '…').join('') ?? ''}|${String(finished)}|${saved.kind}`;
  useLayoutEffect(() => {
    const element = stream.current;
    if (element === null || !following.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    appliedTop.current = element.scrollTop;
  }, [contentKey]);
  const onScroll = (): void => {
    const element = stream.current;
    if (element === null) {
      return;
    }
    const next = followAfterScrollEvent({
      metrics: { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight },
      appliedScrollTop: appliedTop.current,
    });
    // Kept while the position is still the one this window set, so a zoom, which changes the
    // content's height and not the position, is not read as the reader scrolling away.
    if (appliedTop.current !== null && Math.abs(element.scrollTop - appliedTop.current) > 1) {
      appliedTop.current = null;
    }
    if (next !== following.current) {
      following.current = next;
      setAtFoot(next);
    }
  };
  // Zooming resizes the window in page units: a reader at the foot stays at the foot, and one
  // reading further up is left where they are. Nothing is reloaded and the stream goes on.
  useEffect(() => {
    const onResize = (): void => {
      const element = stream.current;
      if (element === null || !following.current) {
        return;
      }
      element.scrollTop = element.scrollHeight;
      appliedTop.current = element.scrollTop;
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const backToFoot = (): void => {
    const element = stream.current;
    following.current = true;
    setAtFoot(true);
    if (element !== null) {
      element.scrollTop = element.scrollHeight;
      appliedTop.current = element.scrollTop;
    }
  };

  if (address === null) {
    return <main className="branch-window"><p>This window was not given a step to show.</p></main>;
  }
  const nodeLabel = view?.entries.find((entry) => entry.kind === 'node-entered' && entry.nodeId === nodeId)?.data?.['label'];
  // DSP-225: the visit shown, from the run held or else its record; never the node's latest by mistake.
  const rows = visits.length > 0 ? visits : recordVisits;
  const shownOccurrence = at?.occurrence ?? address.occurrence;
  const own = rows.find((row) => row.visit.occurrence === shownOccurrence) ?? null;
  const latestRow = rows.at(-1) ?? null;
  const behind = latestRow !== null && latestRow.visit.occurrence > shownOccurrence && address.sliceId === undefined ? latestRow : null;
  const modelWords = visitModelWords(own?.model ?? null);
  const contextWords = own === null ? null : visitContextWords(own);
  const title = describeStepOutput(shown ?? address, typeof nodeLabel === 'string' ? nodeLabel : nodeId, visit?.visit ?? own?.visit ?? null);
  const showVisit = (occurrence: number): void => {
    setChosenVisit(occurrence);
    setSaved({ kind: 'none' });
    setChosenSlice(null);
    following.current = true;
    setAtFoot(true);
  };

  const standing = finished || view === null ? null : stepStanding({ step: live, stillWatching: !view.ended, nowMs });

  return (
    <main className="branch-window" data-ev="step-output-window" data-finished={finished ? 'true' : 'false'}>
      <h1 className="branch-window__title">{title}</h1>
      {own === null || (own.model === null && contextWords === null) ? null : (
        <p className="branch-window__facts" data-ev="step-output-visit-model">
          {own.model === null
            ? null
            : `This visit (visit ${String(own.visit.occurrence)}) ran ${modelWords ?? ''} on ${own.model.provider}. Chosen: ${own.model.reason}.`}
          {contextWords === null ? null : (
            <>
              {own.model === null ? null : <br />}
              <span data-ev="step-output-visit-context">{contextWords}</span>
            </>
          )}
        </p>
      )}
      {rows.length > 1 && address.sliceId === undefined ? (
        // DSP-225: the node's visits, oldest to latest, to move back and forth between in this window.
        <nav className="step-visits" aria-label="Visits of this step" data-ev="step-output-visits">
          <button type="button" className="button" data-ev="step-output-visit-earlier" disabled={shownOccurrence <= (rows[0]?.visit.occurrence ?? 1)} onClick={() => showVisit(shownOccurrence - 1)}>
            ← Earlier
          </button>
          {rows.map((row) => (
            <button
              key={row.visit.occurrence}
              type="button"
              className="button"
              aria-pressed={row.visit.occurrence === shownOccurrence}
              data-ev="step-output-visit"
              data-visit={row.visit.occurrence}
              onClick={() => showVisit(row.visit.occurrence)}
            >
              {row.label}
              {visitModelWords(row.model) === null ? '' : ` · ${visitModelWords(row.model) ?? ''}`}
              {row.ended ? '' : ' · now'}
            </button>
          ))}
          <button type="button" className="button" data-ev="step-output-visit-later" disabled={latestRow === null || shownOccurrence >= latestRow.visit.occurrence} onClick={() => showVisit(shownOccurrence + 1)}>
            Later →
          </button>
        </nav>
      ) : null}
      {behind === null ? null : (
        // DSP-225: a later visit never takes the window over; one press shows it.
        <p className="step-output-newer" data-ev="step-output-newer" role="status">
          This is visit {String(shownOccurrence)}, not the latest. Visit {String(behind.visit.occurrence)}
          {visitModelWords(behind.model) === null ? '' : ` (${visitModelWords(behind.model) ?? ''})`} {behind.ended ? 'is the latest' : 'is running now'}.{' '}
          <button type="button" className="button" data-ev="step-output-follow-newer" onClick={() => showVisit(behind.visit.occurrence)}>
            Show visit {String(behind.visit.occurrence)}
          </button>
        </p>
      )}
      {isFanOut ? (
        <nav className="step-branches" aria-label="Branches of this step" data-ev="step-output-branches">
          {branches.map((row) => (
            <button
              key={row.key}
              type="button"
              className="button"
              aria-pressed={row.sliceId === slice}
              data-ev="step-output-branch"
              onClick={() => {
                setChosenSlice(row.sliceId);
                following.current = true;
                setAtFoot(true);
              }}
            >
              {row.sliceId} · {row.state}
            </button>
          ))}
        </nav>
      ) : null}
      {branch === null ? null : (
        <p className="branch-window__facts" data-ev="branch-window-facts">
          {branch.state} · {branch.visitLabel} · {branch.model} · {branch.messages}
          <br />
          Task: {branch.task}
        </p>
      )}
      {!seeded ? (
        <p className="branch-window__facts">Connecting to the run…</p>
      ) : finished ? (
        <p className="step-stream__finished" data-ev="step-output-finished">
          {view === null
            ? `Finished. Read from the run record: the reply and commands are kept there, the tool calls as they ran are not.`
            : `Finished. This is the ${what}’s complete output; nothing more will come.`}
        </p>
      ) : standing === null ? null : (
        <p className={`step-status step-status--${standing.standing}`} data-ev="step-output-status" data-standing={standing.standing}>
          {standing.text}
        </p>
      )}
      {problem === null ? null : <p className="branch-window__facts branch-list__note--problem">{problem}</p>}
      <div className="step-stream" ref={stream} onScroll={onScroll} data-ev="step-output-stream">
        {live !== null ? (
          <>
            <LiveReplyText text={live.text} testId="step-output-text" />
            <LiveToolCalls tools={live.tools} testId="step-output" />
            {live.awaitingApproval === null ? null : <p className="app__note">Waiting: {live.awaitingApproval}</p>}
            {live.text === '' && live.tools.length === 0 ? <p className="muted">{finished ? `The ${what} wrote nothing here.` : 'Nothing yet.'}</p> : null}
          </>
        ) : saved.kind === 'found' ? (
          <>
            {saved.output.replies.map((reply, index) => (
              <LiveReplyText key={index} text={reply.text} testId={`step-output-saved-${String(index)}`} />
            ))}
            {saved.output.replies.length === 0 ? <p className="muted">The run record holds no reply for this {what}.</p> : null}
            {saved.output.commands.length === 0 ? null : (
              <ul className="tool-calls__list" data-ev="step-output-commands">
                {saved.output.commands.map((command, index) => (
                  <li key={index} className={`tool-call tool-call--${command.exitCode === 0 ? 'ok' : 'error'}`}>
                    <span className="tool-call__summary">$ {command.line ?? command.command}</span>
                  </li>
                ))}
              </ul>
            )}
            {saved.output.note === null ? null : <p className="muted">{saved.output.note}</p>}
          </>
        ) : saved.kind === 'missing' ? (
          <p className="muted" data-ev="step-output-no-data">{saved.note}</p>
        ) : seeded && view !== null ? (
          <p className="muted">Nothing has been streamed for this {what} yet.</p>
        ) : null}
        {finished && (live !== null || saved.kind === 'found') ? <p className="step-stream__end">— end of output —</p> : null}
      </div>
      {atFoot ? null : (
        <button type="button" className="button step-stream__back" data-ev="step-output-back" onClick={backToFoot}>
          {finished ? 'Back to the end' : 'Back to live'}
        </button>
      )}
      <p className="branch-window__facts">Opening or closing this window starts, stops and repeats nothing.</p>
    </main>
  );
}
