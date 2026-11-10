/**
 * Follow preparation (DSP-190): the window that follows one walk preparation of a review through
 * the planner, writer and reviewer loop, while it runs and afterwards.
 *
 * Two panes. On the left the loop's drawing, drawn by the graph editor's own canvas in its view
 * mode — the same node shapes, run states, ending marks and motion as the editor, read from the
 * same run view (`shared/loop-run-view.ts`) folded from the engine's own journal; no palette, no
 * inspector, nothing to save. On the right the run's activity: what the provider and DSpatch
 * actually reported, each entry bound to its node visit and provider turn, following the active
 * visit by default and letting the person read an earlier one while the run goes on.
 *
 * **Looking is not doing.** Opening this window asks the host for the run as it stands and then
 * listens; it starts no call and repeats none. Closing it stops nothing. The one control that
 * acts is Stop, which is the job's own cancel, the same the diff window offers. There is no
 * field to type into: nothing here is a way to instruct a running preparation.
 *
 * **Nothing is invented.** A quiet turn shows no activity. Reasoning text is shown only where the
 * provider exposes it and is labelled as exposed reasoning, never as the model's whole thinking.
 * Usage is summed only where the readings' meaning allows it, and silence is said as unknown.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';

import { resolverFromEntries } from '../shared/loop-graph-editing';
import { loadLoopGraph } from '../shared/loop-graph-load';
import type { LoopGraph, LoopNode, ResolvedRole } from '../shared/loop-graph';
import { edgesTakenIn, finishedRunMarksFrom, markedNodes, nodeIsWorking, runViewState, type NodeRunState } from '../shared/loop-run-view';
import { PRESENTATION_INSTRUCTION_VERSION, PROFILE_PROMPT_NAMES } from '../shared/presentation-profiles';
import { isPairError, type AgentJob, type PairWindowStart, type ReviewPairBridge } from '../shared/review-pair';
import { activityOfTurn, foldWalkLoopActivity, formatCount, summariseUsage, type WalkLoopActivity, type WalkLoopUsage, type WalkLoopVisitView, type WalkReview } from '../shared/walk-method';
import type { WalkLoopRecordView } from '../shared/walk-method';
import { applyWalkLoopRunEvent, followStateFrom, runEventBelongsTo, type WalkLoopFollowState, type WalkLoopRunEvent, type WalkLoopRunSnapshot } from '../shared/walk-loop-view';
import { GraphCanvas, type GraphSelection } from './GraphCanvas';
import { isRunning, requestFailure } from './PairReview';
import { isFollowingLatest } from './scroll-follow';

type FollowStart = Extract<PairWindowStart, { readonly kind: 'follow' }>;

interface VisitKey {
  readonly nodeId: string;
  readonly occurrence: number;
}

declare global {
  interface Window {
    /** What a trial reads of this window: decisions, not class names. */
    __dspatchFollowCheck?: {
      read: () => unknown;
    };
  }
}

const NO_ACTIVITY: readonly WalkLoopActivity[] = [];

export function WalkLoopFollow(): JSX.Element {
  const bridge = window.dspatchReviewPair;
  const [start, setStart] = useState<FollowStart | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (bridge === undefined) {
      setProblem('This window has no review connection.');
      return;
    }
    void bridge.start().then(
      (answer) => {
        if (answer.kind === 'follow') {
          setStart(answer);
        } else {
          setProblem('This window was not opened for a preparation.');
        }
      },
      (error: unknown) => setProblem(requestFailure(error)),
    );
  }, [bridge]);
  if (bridge === undefined || start === null) {
    return (
      <div className="fw-window">
        <p className="fw-muted">{problem ?? 'Opening…'}</p>
      </div>
    );
  }
  return <FollowRun bridge={bridge} start={start} />;
}

function FollowRun({ bridge, start }: { readonly bridge: ReviewPairBridge; readonly start: FollowStart }): JSX.Element {
  const key = start.review;
  const jobId = start.jobId;
  const [job, setJob] = useState<AgentJob | null>(null);
  const [state, setState] = useState<WalkLoopFollowState>({ view: null, activity: NO_ACTIVITY });
  const [meta, setMeta] = useState<{ readonly live: boolean; readonly limitations: readonly string[]; readonly summary: WalkLoopRunSnapshot['summary'] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [followLive, setFollowLive] = useState(true);
  const [chosenVisit, setChosenVisit] = useState<VisitKey | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Run events that arrived before the opening read answered; dropped when it does. */
  const heldRef = useRef<WalkLoopRunEvent[] | null>([]);

  const receive = useCallback((event: WalkLoopRunEvent): void => {
    const next = applyWalkLoopRunEvent(stateRef.current, event);
    if (next !== stateRef.current) {
      stateRef.current = next;
      setState(next);
    }
  }, []);

  /** The run as it stands: a read, which starts nothing. Asked again once the job has ended, for the summary kept with it. */
  const readRun = useCallback(
    (adopt: boolean): void => {
      void bridge
        .walkLoopRunView(key, jobId)
        .catch((error: unknown) => ({ error: requestFailure(error) }))
        .then((answer) => {
          if (isPairError(answer)) {
            heldRef.current = null;
            setProblem(answer.error);
            return;
          }
          setMeta({ live: answer.live, limitations: answer.limitations, summary: answer.summary });
          if (adopt) {
            // Everything sent before this answer is in it; what arrives after reaches `receive`.
            heldRef.current = null;
            const adopted = followStateFrom(answer);
            stateRef.current = adopted;
            setState(adopted);
          }
        });
    },
    [bridge, key, jobId],
  );

  useEffect(() => {
    const offRun = bridge.onRunEvent((event) => {
      if (!runEventBelongsTo(event, key, jobId)) {
        return;
      }
      if (heldRef.current !== null) {
        heldRef.current.push(event);
        return;
      }
      receive(event);
    });
    const offChanged = bridge.onChanged((event) => {
      if (event.key === key) {
        setJob(event.record.jobs.find((entry) => entry.id === jobId) ?? null);
      }
    });
    void bridge
      .state(key)
      .catch((error: unknown) => ({ error: requestFailure(error) }))
      .then((answer) => {
        if (isPairError(answer)) {
          setProblem(answer.error);
          return;
        }
        setJob(answer.jobs.find((entry) => entry.id === jobId) ?? null);
      });
    readRun(true);
    return () => {
      offRun();
      offChanged();
    };
  }, [bridge, key, jobId, receive, readRun]);

  // Once the job has ended, the summary kept with the run (usage, rounds, status) is read once.
  const jobState = job?.state ?? null;
  const endedRead = useRef(false);
  useEffect(() => {
    if (jobState !== null && jobState !== 'running' && jobState !== 'cancelling' && !endedRead.current) {
      endedRead.current = true;
      readRun(false);
    }
  }, [jobState, readRun]);

  const view = state.view;
  const roles = useMemo(() => new Map<string, ResolvedRole | null>((view?.run.roles ?? []).map((entry) => [entry.key, entry.role])), [view?.run]);
  const graph: LoopGraph | null = useMemo(() => {
    if (view === null) {
      return null;
    }
    const loaded = loadLoopGraph(view.run.graphText, { resolveRole: resolverFromEntries(roles) });
    return loaded.ok ? loaded.graph : null;
  }, [view?.run, roles]);
  // The drawing on screen is the run's own, so its ending marks belong to it by construction.
  const endingMarks = useMemo(() => (view === null ? null : finishedRunMarksFrom(view, graph, 'the run\'s own drawing')), [view, graph]);
  const runStates: ReadonlyMap<string, NodeRunState> = useMemo(() => markedNodes(view, endingMarks), [view, endingMarks]);
  const edgesTaken = useMemo(() => edgesTakenIn(view), [view]);
  const workingNodes = useMemo(() => {
    const working = new Set<string>();
    for (const [nodeId, nodeState] of runStates) {
      if (nodeIsWorking(nodeState, null)) {
        working.add(nodeId);
      }
    }
    return working;
  }, [runStates]);

  const visits = useMemo(() => foldWalkLoopActivity(state.activity), [state.activity]);
  const activeVisit: WalkLoopVisitView | null = visits.at(-1) ?? null;
  const shownVisit: WalkLoopVisitView | null = useMemo(() => {
    if (followLive || chosenVisit === null) {
      return activeVisit;
    }
    return visits.find((visit) => visit.nodeId === chosenVisit.nodeId && visit.occurrence === chosenVisit.occurrence) ?? activeVisit;
  }, [followLive, chosenVisit, visits, activeVisit]);

  const labelOf = useCallback((nodeId: string): string => graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId, [graph]);
  const chooseVisit = (visit: VisitKey): void => {
    setChosenVisit(visit);
    setFollowLive(false);
    setSelection({ kind: 'node', id: visit.nodeId });
  };
  const backToLive = (): void => {
    setFollowLive(true);
    setChosenVisit(null);
    setSelection(null);
  };
  const onNodeMouseDown = (event: ReactMouseEvent, node: LoopNode): void => {
    event.stopPropagation();
    const latest = [...visits].reverse().find((visit) => visit.nodeId === node.id);
    if (latest === undefined) {
      setSelection({ kind: 'node', id: node.id });
      return;
    }
    chooseVisit({ nodeId: latest.nodeId, occurrence: latest.occurrence });
  };

  const running = job !== null && isRunning(job);
  const stop = (): void => {
    void bridge
      .cancelJob(key, jobId)
      .catch((error: unknown) => ({ error: requestFailure(error) }))
      .then((answer) => {
        if (isPairError(answer)) {
          setProblem(answer.error);
        }
      });
  };

  // What is happening now, from the last thing reported: never a guess.
  const progress = useMemo(() => {
    if (view === null) {
      return job === null ? 'Opening…' : running ? (job.activity ?? 'Preparing the revision folder…') : 'The run has not announced itself; nothing of it was recorded.';
    }
    const lastStart = [...state.activity].reverse().find((entry) => entry.kind === 'turn-started');
    const open = activeVisit !== null && activeVisit.open;
    if (!view.ended && open && lastStart !== undefined && lastStart.kind === 'turn-started') {
      return `${labelOf(lastStart.nodeId)}: ${lastStart.what}`;
    }
    if (!view.ended) {
      // Between turns: the last thing DSpatch said, or the node the journal says was entered.
      const lastNote = [...state.activity].reverse().find((entry) => entry.kind === 'note');
      if (lastNote !== undefined && lastNote.kind === 'note' && lastStart !== undefined && lastNote.seq > lastStart.seq) {
        return `${labelOf(lastNote.nodeId)}: ${lastNote.text}`;
      }
      const entered = [...runStates].find(([, nodeState]) => nodeState === 'active');
      return entered === undefined ? runViewState(view) : `${labelOf(entered[0])}: entered, no turn sent yet`;
    }
    return `Ended${view.status === null ? '' : ` (${view.status})`}${view.note === '' ? '' : `: ${view.note}`}`;
  }, [view, job, running, state.activity, activeVisit, labelOf, runStates]);

  // The summary strip: time, turns and what the provider reported, with nothing made up.
  const turns = state.activity.filter((entry) => entry.kind === 'turn-started').length;
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    if (view === null || view.ended) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [view]);
  const durationMs = meta?.summary?.durationMs ?? (view === null ? 0 : Math.max(0, (view.ended ? Date.parse(state.activity.at(-1)?.atUtc ?? view.run.startedAtUtc) : nowMs) - Date.parse(view.run.startedAtUtc)));
  const usageReadings: readonly WalkLoopUsage[] = useMemo(
    () => (meta?.summary !== null && meta?.summary !== undefined && meta.summary.usage !== 'unknown' ? meta.summary.usage : state.activity.flatMap((entry) => (entry.kind === 'usage' ? entry.readings : []))),
    [meta?.summary, state.activity],
  );
  const usage = useMemo(() => summariseUsage(usageReadings.length === 0 ? 'unknown' : usageReadings), [usageReadings]);

  useEffect(() => {
    window.__dspatchFollowCheck = {
      read: () => ({
        key,
        jobId,
        jobState: job?.state ?? null,
        live: meta?.live ?? null,
        announced: view !== null,
        ended: view?.ended ?? null,
        status: view?.status ?? null,
        terminal: view?.terminalNodeId ?? null,
        nodes: Object.fromEntries(runStates),
        working: [...workingNodes],
        edgesTaken: [...edgesTaken],
        journal: view?.entries.length ?? 0,
        activity: state.activity.length,
        seqMonotonic: state.activity.every((entry, index) => index === 0 || entry.seq > (state.activity[index - 1]?.seq ?? 0)),
        turnNumbers: state.activity.filter((entry) => entry.kind === 'turn-started').map((entry) => entry.turn),
        kinds: state.activity.reduce<Record<string, number>>((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] ?? 0) + 1 }), {}),
        visits: visits.map((visit) => ({ nodeId: visit.nodeId, occurrence: visit.occurrence, turns: visit.turns, entries: visit.entries.length, open: visit.open })),
        shown: shownVisit === null ? null : { nodeId: shownVisit.nodeId, occurrence: shownVisit.occurrence },
        followLive,
        progress,
        turns,
        usage: usage.text,
        usageLines: usage.lines.length,
        limitations: meta?.limitations ?? [],
        graphDrawn: document.querySelectorAll('.fw-graph svg .node').length,
        editorControls: document.querySelector('.editor-palette, .editor-inspector, [data-ev="editor-save"]') !== null,
        zoom,
      }),
    };
    return () => {
      delete window.__dspatchFollowCheck;
    };
  });

  const label = start.label === '' ? `${start.pair.repository} ${start.pair.base.slice(0, 7)}→${start.pair.target.slice(0, 7)}` : start.label;
  const provenance =
    job === null
      ? ''
      : `${job.provider === 'claude' ? 'Claude' : job.provider === 'copilot' ? 'Copilot' : 'Cursor'} (${job.model})${job.presentation === undefined ? '' : `, explained in the ${PROFILE_PROMPT_NAMES[job.presentation.profile]} profile, instruction version ${String(job.presentation.version)}${job.presentation.version === PRESENTATION_INSTRUCTION_VERSION ? '' : ` (now ${String(PRESENTATION_INSTRUCTION_VERSION)})`}`}, started ${formatTime(job.startedAt)}`;

  return (
    <div className="fw-window" data-ev="follow-window" data-live={meta?.live === true ? 'true' : 'false'} data-ended={view?.ended === true ? 'true' : 'false'}>
      <header className="fw-header">
        <div className="fw-title">
          <h1>Follow preparation</h1>
          <span className="fw-muted" data-ev="follow-label">
            {label}
          </span>
        </div>
        <div className="fw-status" data-ev="follow-progress" aria-live="polite">
          {running && <span className="rv-agent-spinner" aria-hidden="true" />}
          <span>{progress}</span>
        </div>
        <div className="fw-controls">
          {running && job.state === 'running' && (
            <button type="button" data-ev="follow-stop" onClick={stop}>
              Stop
            </button>
          )}
          {job?.state === 'cancelling' && <span className="fw-muted">Stopping…</span>}
          <span className="fw-zoom">
            <button type="button" data-ev="follow-zoom-out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))} title="Smaller">
              −
            </button>
            {String(Math.round(zoom * 100))}%
            <button type="button" data-ev="follow-zoom-in" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))} title="Larger">
              +
            </button>
          </span>
        </div>
      </header>
      <p className="fw-provenance fw-muted" data-ev="follow-provenance">
        {provenance}
        {view !== null && ` · ${view.run.graphName} (${view.run.graphVersionId.slice(0, 12)})`}
        {job?.state === 'failed' && ` · failed: ${job.note}`}
        {job?.state === 'cancelled' && ` · stopped: ${job.note}`}
      </p>
      {problem !== null && (
        <p className="fw-problem" data-ev="follow-problem">
          {problem}
        </p>
      )}
      {(meta?.limitations.length ?? 0) > 0 && (
        <ul className="fw-limitations" data-ev="follow-limitations">
          {meta?.limitations.map((limitation, index) => (
            <li key={index}>{limitation}</li>
          ))}
        </ul>
      )}
      <main className="fw-main">
        <Pannable className="fw-graph editor-canvas" data-ev="follow-graph">
          {graph === null ? (
            <p className="fw-muted fw-graph-empty">{view === null ? 'The drawing is shown once the run has started.' : 'The run\'s drawing could not be loaded.'}</p>
          ) : (
            <GraphCanvas
              graph={graph}
              roles={roles}
              zoom={zoom}
              mode="view"
              selection={selection}
              showLabels={false}
              edgesTaken={edgesTaken}
              runStates={runStates}
              workingNodes={workingNodes}
              endingMarks={endingMarks}
              onSelectEdge={(id) => setSelection({ kind: 'edge', id })}
              onNodeMouseDown={onNodeMouseDown}
            />
          )}
        </Pannable>
        <ActivityPanel
          bridge={bridge}
          pairKey={key}
          jobId={jobId}
          visits={visits}
          shownVisit={shownVisit}
          activeVisit={activeVisit}
          followLive={followLive}
          labelOf={labelOf}
          onChooseVisit={chooseVisit}
          onBackToLive={backToLive}
          ended={view?.ended ?? false}
          summary={{ turns, durationMs, usage: usage.text, usageLines: usage.lines, rounds: meta?.summary?.rounds ?? null, status: meta?.summary?.status ?? null }}
        />
      </main>
    </div>
  );
}

/** A scrolling room the person can drag to pan, as well as scroll. Nothing in it is edited. */
function Pannable({ className, children, ...rest }: { readonly className: string; readonly children: React.ReactNode; readonly 'data-ev': string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ readonly x: number; readonly y: number; readonly left: number; readonly top: number } | null>(null);
  return (
    <div
      ref={ref}
      className={className}
      data-ev={rest['data-ev']}
      onMouseDown={(event) => {
        // A press on the room itself, not on a node: nodes select their visit.
        if ((event.target as Element).closest('.node, .edge') !== null || ref.current === null) {
          return;
        }
        drag.current = { x: event.clientX, y: event.clientY, left: ref.current.scrollLeft, top: ref.current.scrollTop };
      }}
      onMouseMove={(event) => {
        if (drag.current === null || ref.current === null || event.buttons === 0) {
          drag.current = null;
          return;
        }
        ref.current.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
        ref.current.scrollTop = drag.current.top - (event.clientY - drag.current.y);
      }}
      onMouseUp={() => {
        drag.current = null;
      }}
      onMouseLeave={() => {
        drag.current = null;
      }}
    >
      {children}
    </div>
  );
}

interface SummaryStrip {
  readonly turns: number;
  readonly durationMs: number;
  readonly usage: string;
  readonly usageLines: ReturnType<typeof summariseUsage>['lines'];
  readonly rounds: 0 | 1 | null;
  readonly status: string | null;
}

function ActivityPanel({
  bridge,
  pairKey,
  jobId,
  visits,
  shownVisit,
  activeVisit,
  followLive,
  labelOf,
  onChooseVisit,
  onBackToLive,
  ended,
  summary,
}: {
  readonly bridge: ReviewPairBridge;
  readonly pairKey: string;
  readonly jobId: string;
  readonly visits: readonly WalkLoopVisitView[];
  readonly shownVisit: WalkLoopVisitView | null;
  readonly activeVisit: WalkLoopVisitView | null;
  readonly followLive: boolean;
  readonly labelOf: (nodeId: string) => string;
  readonly onChooseVisit: (visit: VisitKey) => void;
  readonly onBackToLive: () => void;
  readonly ended: boolean;
  readonly summary: SummaryStrip;
}): JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [unseen, setUnseen] = useState(false);
  const shownKey = shownVisit === null ? '' : `${shownVisit.nodeId}#${String(shownVisit.occurrence)}`;
  const entryCount = shownVisit?.entries.length ?? 0;
  const lastAt = shownVisit?.lastAtUtc ?? '';
  const announcedFor = useRef(shownKey);
  // New activity moves the list only when the reader is at its foot; otherwise it is announced.
  useEffect(() => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    if (announcedFor.current !== shownKey) {
      // A different visit on screen: its entries are what the person asked for, not news.
      announcedFor.current = shownKey;
      return;
    }
    if (atBottom) {
      element.scrollTop = element.scrollHeight;
      setUnseen(false);
    } else {
      setUnseen(true);
    }
    // The count and the last time together say that something was added or grew.
  }, [entryCount, lastAt, atBottom, shownKey]);
  useEffect(() => {
    // A different visit: start at its top when it is an earlier one, at the foot when live.
    const element = scroller.current;
    if (element === null) {
      return;
    }
    element.scrollTop = followLive ? element.scrollHeight : 0;
    setAtBottom(followLive);
    setUnseen(false);
  }, [shownKey, followLive]);
  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const following = isFollowingLatest({ scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight });
    setAtBottom(following);
    if (following) {
      setUnseen(false);
    }
  };
  return (
    <aside className="fw-activity" data-ev="follow-activity">
      <div className="fw-summary" data-ev="follow-summary">
        <span>
          {String(summary.turns)} turn{summary.turns === 1 ? '' : 's'} · {minutesOf(summary.durationMs)}
          {summary.rounds === null ? '' : summary.rounds === 0 ? ' · no correction round' : ' · one correction round'}
          {summary.status === null ? '' : ` · ${summary.status}`}
        </span>
        <details className="fw-usage" data-ev="follow-usage">
          <summary>Usage: {summary.usage}</summary>
          {summary.usageLines.length === 0 ? (
            <p className="fw-muted">The provider reported no usage readings.</p>
          ) : (
            <table className="fw-usage-table">
              <tbody>
                {summary.usageLines.map((line) => (
                  <tr key={`${line.unit}:${line.scope}:${line.source}`}>
                    <td>{line.label}</td>
                    <td className="fw-number">{line.value === null ? 'unknown' : formatCount(line.value)}</td>
                    <td className="fw-muted">
                      {line.summed ? 'sum of ' : 'last of '}
                      {String(line.readings)} reading{line.readings === 1 ? '' : 's'} ({line.scope}
                      {line.unknown === 0 ? '' : `, ${String(line.unknown)} unknown`}); {line.source}
                      {line.why === null ? '' : `; ${line.why}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </details>
      </div>
      <div className="fw-visits" data-ev="follow-visits">
        {visits.map((visit) => {
          const shown = shownVisit !== null && shownVisit.nodeId === visit.nodeId && shownVisit.occurrence === visit.occurrence;
          const active = activeVisit !== null && activeVisit.nodeId === visit.nodeId && activeVisit.occurrence === visit.occurrence;
          return (
            <button
              key={`${visit.nodeId}#${String(visit.occurrence)}`}
              type="button"
              className={`fw-visit${shown ? ' fw-visit-shown' : ''}${active && visit.open ? ' fw-visit-open' : ''}`}
              data-ev={`follow-visit-${visit.nodeId}-${String(visit.occurrence)}`}
              aria-pressed={shown}
              onClick={() => onChooseVisit({ nodeId: visit.nodeId, occurrence: visit.occurrence })}
            >
              {labelOf(visit.nodeId)} #{String(visit.occurrence)}
              <span className="fw-muted"> · {String(visit.turns)} turn{visit.turns === 1 ? '' : 's'}</span>
            </button>
          );
        })}
        {!followLive && (
          <button type="button" className="fw-live" data-ev="follow-back-to-live" onClick={onBackToLive}>
            {ended ? 'Latest' : 'Back to live'}
          </button>
        )}
        {followLive && visits.length > 0 && (
          <span className="fw-muted fw-following" data-ev="follow-following">
            {ended ? 'Showing the last visit' : 'Following the active node'}
          </span>
        )}
      </div>
      <div className="fw-entries" ref={scroller} onScroll={onScroll} data-ev="follow-entries" data-visit={shownKey}>
        {shownVisit === null ? (
          <p className="fw-muted">No activity has been reported yet.</p>
        ) : (
          <>
            <h2 className="fw-visit-title">
              {labelOf(shownVisit.nodeId)}, visit {String(shownVisit.occurrence)}
              {shownVisit.roleId === null ? '' : ` · role ${shownVisit.roleId}`}
            </h2>
            {shownVisit.entries.map((entry) => (
              <ActivityRow key={entry.seq} entry={entry} finished={entry.kind === 'tool-started' ? finishedCall(shownVisit.entries, entry.turn, entry.callId) : null} />
            ))}
            {shownVisit.open && !ended && <p className="fw-muted fw-open">A turn is running; what the provider reports appears here as it comes.</p>}
          </>
        )}
      </div>
      {unseen && (
        <button
          type="button"
          className="fw-unseen"
          data-ev="follow-unseen"
          onClick={() => {
            const element = scroller.current;
            if (element !== null) {
              element.scrollTop = element.scrollHeight;
            }
            setAtBottom(true);
            setUnseen(false);
          }}
        >
          New activity below ↓
        </button>
      )}
      <RecordOnRequest bridge={bridge} pairKey={pairKey} jobId={jobId} ended={ended} />
    </aside>
  );
}

function finishedCall(entries: readonly WalkLoopActivity[], turn: number, callId: string): Extract<WalkLoopActivity, { readonly kind: 'tool-finished' }> | null {
  for (const entry of activityOfTurn(entries, turn)) {
    if (entry.kind === 'tool-finished' && entry.callId === callId) {
      return entry;
    }
  }
  return null;
}

/** One entry: a short row, and the whole of it when opened. The label says what the content is. */
function ActivityRow({ entry, finished }: { readonly entry: WalkLoopActivity; readonly finished: Extract<WalkLoopActivity, { readonly kind: 'tool-finished' }> | null }): JSX.Element | null {
  const at = new Date(entry.atUtc);
  const time = Number.isNaN(at.getTime()) ? entry.atUtc : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const row = (label: string, brief: string, body: React.ReactNode | null, className = ''): JSX.Element =>
    body === null ? (
      <div className={`fw-entry fw-entry-${entry.kind} ${className}`} data-ev="follow-entry" data-kind={entry.kind} data-turn={String(entry.turn)}>
        <span className="fw-kind">{label}</span>
        <span className="fw-brief">{brief}</span>
        <time className="fw-time">{time}</time>
      </div>
    ) : (
      <details className={`fw-entry fw-entry-${entry.kind} ${className}`} data-ev="follow-entry" data-kind={entry.kind} data-turn={String(entry.turn)}>
        <summary>
          <span className="fw-kind">{label}</span>
          <span className="fw-brief">{brief}</span>
          <time className="fw-time">{time}</time>
        </summary>
        <div className="fw-body">{body}</div>
      </details>
    );
  switch (entry.kind) {
    case 'turn-started':
      return row(`Turn ${String(entry.turn)}`, `${entry.what}${entry.stepId === null ? '' : ` (${entry.stepId})`}`, null, 'fw-entry-head');
    case 'reply-text':
      return row('Reply text', briefOf(entry.text), <pre className="fw-text">{entry.text}</pre>);
    case 'reasoning-text':
      return row('Reasoning text (exposed by the provider)', briefOf(entry.text), <pre className="fw-text">{entry.text}</pre>);
    case 'tool-started':
      return row('Tool', `${entry.summary}${finished === null ? '' : finished.status === 'ok' ? ' · done' : ' · refused or failed'}`, null);
    case 'tool-finished':
      return entry.detail === null ? null : row('Tool result', briefOf(entry.detail), <pre className="fw-text">{entry.detail}</pre>);
    case 'command':
      return row(
        'Command',
        `${entry.line} · ${entry.ending}${entry.exitCode === null ? '' : ` ${String(entry.exitCode)}`}`,
        <pre className="fw-text">{entry.output === '' ? '(no output was reported)' : entry.output}{entry.truncated ? '\n… (cut to the record\'s bound)' : ''}</pre>,
      );
    case 'usage':
      return row('Usage reported', summariseUsage(entry.readings).text, null);
    case 'turn-ended':
      return row('Turn ended', `${entry.status}${entry.error === null ? '' : `: ${entry.error}`} · ${formatCount(entry.textLength)} characters of reply`, null, 'fw-entry-foot');
    case 'note':
      return row('DSpatch', entry.text, null);
    case 'verdict':
      return row(
        entry.final ? 'Final assessment' : 'Reviewer\'s verdict',
        `${entry.review.verdict}${entry.review.findings.length === 0 ? '' : ` · ${String(entry.review.findings.length)} finding${entry.review.findings.length === 1 ? '' : 's'}`}`,
        <FindingsList review={entry.review} />,
      );
  }
}

function briefOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= 140 ? line : `${line.slice(0, 139)}…`;
}

function FindingsList({ review }: { readonly review: WalkReview }): JSX.Element {
  return (
    <div className="fw-findings">
      {review.assessment !== '' && <p>{review.assessment}</p>}
      {review.findings.length > 0 && (
        <ul>
          {review.findings.map((finding, index) => (
            <li key={index}>
              <strong>{finding.steps.length === 0 ? 'The walks' : finding.steps.join(', ')}</strong> ({finding.kind}): {finding.problem}
              {finding.why === '' ? '' : ` ${finding.why}`}
              {finding.evidence === '' ? '' : ` Evidence: ${finding.evidence}`}
            </li>
          ))}
        </ul>
      )}
      <p className="fw-muted">The reviewer is an agent: its acceptance approves nothing of the code.</p>
    </div>
  );
}

/** Every prompt and answer of the run, read on request only (DSP-189's record, unchanged). */
function RecordOnRequest({ bridge, pairKey, jobId, ended }: { readonly bridge: ReviewPairBridge; readonly pairKey: string; readonly jobId: string; readonly ended: boolean }): JSX.Element {
  const [record, setRecord] = useState<WalkLoopRecordView | { readonly error: string } | null>(null);
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (!wanted || record !== null) {
      return;
    }
    let live = true;
    void bridge
      .walkLoopRecord(pairKey, jobId)
      .catch((error: unknown) => ({ error: requestFailure(error) }))
      .then((answer) => {
        if (live) {
          setRecord(answer);
        }
      });
    return () => {
      live = false;
    };
  }, [wanted, record, bridge, pairKey, jobId]);
  return (
    <details
      className="fw-record"
      data-ev="follow-record"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) {
          setRecord(null);
          setWanted(true);
        }
      }}
    >
      <summary>Every prompt and answer of the run{ended ? '' : ' so far'}</summary>
      {record === null && wanted && <p className="fw-muted">Reading the record…</p>}
      {record !== null && isPairError(record) && <p className="fw-problem">{record.error}</p>}
      {record !== null && !isPairError(record) && (
        <div data-ev="follow-replies" data-count={record.replies.length}>
          {record.error !== null && <p className="fw-problem">{record.error}</p>}
          {record.replies.map((reply, index) => (
            <details key={index} className="fw-reply">
              <summary>
                {reply.nodeLabel} (visit {String(reply.occurrence)}
                {reply.roleId === null ? '' : `, ${reply.roleId}`}) · {reply.atUtc.slice(11, 19)} UTC
              </summary>
              <p className="fw-muted">Prompt</p>
              <pre className="fw-text">{reply.prompt === '' ? '(not recorded)' : reply.prompt}</pre>
              <p className="fw-muted">Answer</p>
              <pre className="fw-text">{reply.text}</pre>
            </details>
          ))}
        </div>
      )}
    </details>
  );
}

function minutesOf(ms: number): string {
  if (ms < 60_000) {
    return `${String(Math.round(ms / 1000))} s`;
  }
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms - minutes * 60_000) / 1000);
  return `${String(minutes)} min ${String(seconds)} s`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
