/**
 * Code walk generation, followed (DSP-190, reshaped by DSP-191 for Niclas's demo): the window that
 * follows one walk preparation of a review through the planner, writer and reviewer loop, while it
 * runs and afterwards.
 *
 * Left, top to bottom: the heading, the liveness line (what the agent is doing now, in the words the
 * job itself reports, with the spinner the other agent calls use) and the loop's drawing, drawn by the
 * graph editor's own canvas in its view mode — the same shapes, run states, ending marks and motion,
 * read from the same run view folded from the engine's journal; no palette, no inspector, nothing to
 * save. Right, when the liveness line is clicked: the live stream, one chronological flow of what
 * the provider and DSpatch actually reported — the agent's exposed reasoning and reply text open
 * and growing as fragments arrive, short lines for tool activity, commands with large results
 * collapsed, the reviewer's findings, a plain sentence for a turn that failed — with one scroll
 * that follows the foot until the person scrolls up and again once they are back at the foot.
 *
 * **No debug information in this view**, by Niclas's explicit decision: no token events, cache
 * values, internal states, graph ids, instruction versions, raw events, prompts or protocol dumps,
 * and none of it behind any control. All of that stays in the run's files for troubleshooting.
 *
 * **Looking is not doing.** Opening this window asks the host for the run as it stands and then
 * listens; it starts no call and repeats none. Closing it, or the stream, stops nothing. The one
 * control that acts is Stop, the job's own cancel. There is no field to type into. **Nothing is
 * invented**: a quiet turn shows nothing, and silence stays silence.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, MouseEvent as ReactMouseEvent } from 'react';

import { resolverFromEntries } from '../shared/loop-graph-editing';
import { loadLoopGraph } from '../shared/loop-graph-load';
import type { LoopGraph, LoopNode, ResolvedRole } from '../shared/loop-graph';
import { edgesTakenIn, finishedRunMarksFrom, markedNodes, nodeIsWorking, type NodeRunState } from '../shared/loop-run-view';
import { isPairError, type AgentJob, type PairWindowStart, type ReviewPairBridge } from '../shared/review-pair';
import type { WalkLoopActivity, WalkReview } from '../shared/walk-method';
import { applyWalkLoopRunEvent, followStateFrom, runEventBelongsTo, type WalkLoopFollowState, type WalkLoopRunEvent } from '../shared/walk-loop-view';
import { GraphCanvas, type GraphSelection } from './GraphCanvas';
import { isRunning, requestFailure } from './PairReview';
import { followAfterScrollEvent } from './scroll-follow';

type FollowStart = Extract<PairWindowStart, { readonly kind: 'follow' }>;

declare global {
  interface Window {
    /** What a trial reads of this window: decisions, not class names. */
    __dspatchFollowCheck?: {
      read: () => unknown;
    };
  }
}

const NO_ACTIVITY: readonly WalkLoopActivity[] = [];

/** The role's name as a person reads it; the node's label when the role is not one of the three. */
const ROLE_NAMES: Readonly<Record<string, string>> = { 'walk-planner': 'Planner', 'walk-writer': 'Writer', 'walk-reviewer': 'Reviewer' };

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
        <p className="fw-muted fw-opening">{problem ?? 'Opening…'}</p>
      </div>
    );
  }
  return <FollowRun bridge={bridge} start={start} />;
}

// --- The stream as blocks -------------------------------------------------------------------

type StreamBlock =
  | { readonly kind: 'divider'; readonly key: string; readonly anchor: string; readonly who: string; readonly what: string; readonly atUtc: string }
  | { readonly kind: 'text'; readonly key: string; readonly textKind: 'reply' | 'reasoning'; readonly text: string; readonly turn: number }
  | { readonly kind: 'tool'; readonly key: string; readonly callId: string; readonly turn: number; readonly summary: string; readonly status: 'ok' | 'error' | null; readonly detail: string | null }
  | { readonly kind: 'command'; readonly key: string; readonly line: string; readonly ending: string; readonly exitCode: number | null; readonly output: string; readonly truncated: boolean }
  | { readonly kind: 'note'; readonly key: string; readonly text: string }
  | { readonly kind: 'verdict'; readonly key: string; readonly review: WalkReview; readonly final: boolean }
  | { readonly kind: 'ended'; readonly key: string; readonly status: string; readonly error: string | null };

/**
 * The activity as one flow: fragments of one text joined into the running block, a tool's end
 * folded into its start, usage left out (it is for the files, not for the person), a finished turn
 * closed by the next divider rather than by a line of its own.
 */
function blocksOf(activity: readonly WalkLoopActivity[], labelOf: (nodeId: string) => string): readonly StreamBlock[] {
  const blocks: StreamBlock[] = [];
  const who = (entry: Extract<WalkLoopActivity, { readonly kind: 'turn-started' }>): string => (entry.roleId === null ? labelOf(entry.nodeId) : (ROLE_NAMES[entry.roleId] ?? labelOf(entry.nodeId)));
  for (const entry of activity) {
    const key = `s${String(entry.seq)}`;
    switch (entry.kind) {
      case 'turn-started':
        blocks.push({ kind: 'divider', key, anchor: `${entry.nodeId}#${String(entry.occurrence)}`, who: who(entry), what: entry.what, atUtc: entry.atUtc });
        break;
      case 'reply-text':
      case 'reasoning-text': {
        const textKind = entry.kind === 'reply-text' ? 'reply' : 'reasoning';
        const last = blocks.at(-1);
        if (last !== undefined && last.kind === 'text' && last.textKind === textKind && last.turn === entry.turn) {
          blocks[blocks.length - 1] = { ...last, text: `${last.text}${entry.text}` };
        } else {
          blocks.push({ kind: 'text', key, textKind, text: entry.text, turn: entry.turn });
        }
        break;
      }
      case 'tool-started':
        blocks.push({ kind: 'tool', key, callId: entry.callId, turn: entry.turn, summary: entry.summary, status: null, detail: null });
        break;
      case 'tool-finished': {
        const at = blocks.findIndex((block) => block.kind === 'tool' && block.callId === entry.callId && block.turn === entry.turn);
        if (at === -1) {
          blocks.push({ kind: 'tool', key, callId: entry.callId, turn: entry.turn, summary: entry.summary, status: entry.status, detail: entry.detail });
        } else {
          const started = blocks[at] as Extract<StreamBlock, { readonly kind: 'tool' }>;
          blocks[at] = { ...started, status: entry.status, detail: entry.detail };
        }
        break;
      }
      case 'command':
        blocks.push({ kind: 'command', key, line: entry.line, ending: entry.ending, exitCode: entry.exitCode, output: entry.output, truncated: entry.truncated });
        break;
      case 'note':
        blocks.push({ kind: 'note', key, text: entry.text });
        break;
      case 'verdict':
        blocks.push({ kind: 'verdict', key, review: entry.review, final: entry.final });
        break;
      case 'turn-ended':
        if (entry.status !== 'finished') {
          blocks.push({ kind: 'ended', key, status: entry.status, error: entry.error });
        }
        break;
      case 'usage':
        // Reported usage is kept in the run's files; it is not part of what a person follows here.
        break;
    }
  }
  return blocks;
}

/** What the agent is doing now, from the last thing reported; never a guess. */
function livenessOf(activity: readonly WalkLoopActivity[], labelOf: (nodeId: string) => string): string | null {
  let turnWhat: string | null = null;
  let who = '';
  const openTools = new Map<string, string>();
  let last: WalkLoopActivity | null = null;
  for (const entry of activity) {
    if (entry.kind === 'turn-started') {
      turnWhat = entry.what;
      who = entry.roleId === null ? labelOf(entry.nodeId) : (ROLE_NAMES[entry.roleId] ?? labelOf(entry.nodeId));
      openTools.clear();
    } else if (entry.kind === 'tool-started') {
      openTools.set(entry.callId, entry.summary);
    } else if (entry.kind === 'tool-finished') {
      openTools.delete(entry.callId);
    } else if (entry.kind === 'turn-ended') {
      turnWhat = null;
      openTools.clear();
    }
    if (entry.kind !== 'usage') {
      last = entry;
    }
  }
  if (last === null) {
    return null;
  }
  const running = [...openTools.values()].at(-1);
  if (running !== undefined) {
    return `${who}: ${running}`;
  }
  switch (last.kind) {
    case 'reply-text':
      return turnWhat === null ? `${who}: writing` : `${who}: ${turnWhat} · writing`;
    case 'reasoning-text':
      return turnWhat === null ? `${who}: reasoning` : `${who}: ${turnWhat} · reasoning`;
    case 'turn-started':
      return `${who}: ${last.what}`;
    case 'note':
      return last.text;
    case 'verdict':
      return `${who}: ${last.final ? 'final assessment' : 'verdict'} ${last.review.verdict}`;
    case 'turn-ended':
      return last.status === 'finished' ? `${who}: finished a turn` : `${who}: the turn ended ${last.status}`;
    default:
      return turnWhat === null ? null : `${who}: ${turnWhat}`;
  }
}

function FollowRun({ bridge, start }: { readonly bridge: ReviewPairBridge; readonly start: FollowStart }): JSX.Element {
  const key = start.review;
  const jobId = start.jobId;
  const [job, setJob] = useState<AgentJob | null>(null);
  const [state, setState] = useState<WalkLoopFollowState>({ view: null, activity: NO_ACTIVITY });
  const [meta, setMeta] = useState<{ readonly live: boolean; readonly limitations: readonly string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
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

  /** The run as it stands: a read, which starts nothing. */
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
          setMeta({ live: answer.live, limitations: answer.limitations });
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

  // Once the job has ended, what the run's files hold (its limits) is read once more.
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

  const labelOf = useCallback((nodeId: string): string => graph?.nodes.find((node) => node.id === nodeId)?.label ?? nodeId, [graph]);
  const blocks = useMemo(() => blocksOf(state.activity, labelOf), [state.activity, labelOf]);
  const running = job !== null && isRunning(job);

  // The liveness line: the last thing reported, or the job's own sentence, or how it ended.
  const liveness = useMemo((): string => {
    if (job !== null && !isRunning(job)) {
      if (job.state === 'done') {
        return job.note === '' ? 'Done.' : job.note;
      }
      const ending = job.state === 'cancelled' ? 'Stopped.' : job.state === 'failed' ? 'The preparation failed.' : 'How this ended is unknown.';
      return `${ending} ${job.note === '' ? '' : `${job.note} `}You can prepare the walks again from the review.`.trim();
    }
    if (job?.state === 'cancelling') {
      return 'Stopping…';
    }
    const fromStream = livenessOf(state.activity, labelOf);
    if (fromStream !== null) {
      return fromStream;
    }
    if (job !== null && job.activity !== undefined && job.activity !== '') {
      return job.activity;
    }
    return view === null ? 'Preparing the two revisions for the agent…' : 'Waiting for the agent…';
  }, [job, state.activity, labelOf, view]);

  const openStreamAt = (anchor: string | null): void => {
    setPanelOpen(true);
    setScrollTo(anchor);
  };
  const onNodeMouseDown = (event: ReactMouseEvent, node: LoopNode): void => {
    event.stopPropagation();
    setSelection({ kind: 'node', id: node.id });
    const latest = [...blocks].reverse().find((block) => block.kind === 'divider' && block.anchor.startsWith(`${node.id}#`));
    openStreamAt(latest !== undefined && latest.kind === 'divider' ? latest.anchor : null);
  };
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
        activity: state.activity.length,
        seqMonotonic: state.activity.every((entry, index) => index === 0 || entry.seq > (state.activity[index - 1]?.seq ?? 0)),
        turnNumbers: state.activity.filter((entry) => entry.kind === 'turn-started').map((entry) => entry.turn),
        kinds: state.activity.reduce<Record<string, number>>((counts, entry) => ({ ...counts, [entry.kind]: (counts[entry.kind] ?? 0) + 1 }), {}),
        panelOpen,
        liveness,
        blocks: blocks.reduce<Record<string, number>>((counts, block) => ({ ...counts, [block.kind]: (counts[block.kind] ?? 0) + 1 }), {}),
        textLength: blocks.reduce((sum, block) => sum + (block.kind === 'text' ? block.text.length : 0), 0),
        dividers: blocks.flatMap((block) => (block.kind === 'divider' ? [`${block.who} · ${block.what}`] : [])),
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

  return (
    <div className={`fw-window${panelOpen ? ' fw-with-stream' : ''}`} data-ev="follow-window" data-live={meta?.live === true ? 'true' : 'false'} data-ended={view?.ended === true ? 'true' : 'false'}>
      <div className="fw-left">
        <header className="fw-header">
          <h1>Code walk generation</h1>
          <div className="fw-controls">
            {running && job.state === 'running' && (
              <button type="button" data-ev="follow-stop" onClick={stop}>
                Stop
              </button>
            )}
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
        {/* The liveness line: what the agent does now, as the job reports it. A click opens the stream beside the graph. */}
        <button
          type="button"
          className={`fw-liveness rv-agent-line rv-agent-line-${job?.state ?? 'running'}`}
          data-ev="follow-liveness"
          aria-pressed={panelOpen}
          aria-live="polite"
          title={panelOpen ? 'Close the live stream' : 'Open the live stream of this run'}
          onClick={() => (panelOpen ? setPanelOpen(false) : openStreamAt(null))}
        >
          {running && <span className="rv-agent-spinner" aria-hidden="true" />}
          <span className="fw-liveness-text">{liveness}</span>
          <span className="fw-liveness-hint">{panelOpen ? 'Hide the live stream' : 'Show the live stream'}</span>
        </button>
        {problem !== null && (
          <p className="fw-problem" data-ev="follow-problem">
            {problem}
          </p>
        )}
        <Pannable className="fw-graph editor-canvas" data-ev="follow-graph">
          {graph === null ? (
            <p className="fw-muted fw-graph-empty">{view === null ? 'The loop is drawn once the run has started.' : 'The run\'s drawing could not be loaded.'}</p>
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
      </div>
      {panelOpen && (
        <StreamPanel
          blocks={blocks}
          running={running}
          limitations={meta?.limitations ?? []}
          scrollTo={scrollTo}
          onScrolledTo={() => setScrollTo(null)}
          onClose={() => setPanelOpen(false)}
        />
      )}
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

/**
 * The live stream: one flow, one scroll.
 *
 * Following: the foot from the start; a scroll up by the person ends it, a scroll back to the foot
 * resumes it. The window's own moves are told apart from the person's by the position they were
 * applied at (`followAfterScrollEvent`, the chat's rule), so a reply that grows between two frames
 * is never read as the person having scrolled away. Only new activity moves the stream; opening a
 * collapsed result moves nothing.
 */
function StreamPanel({
  blocks,
  running,
  limitations,
  scrollTo,
  onScrolledTo,
  onClose,
}: {
  readonly blocks: readonly StreamBlock[];
  readonly running: boolean;
  readonly limitations: readonly string[];
  readonly scrollTo: string | null;
  readonly onScrolledTo: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);
  const appliedTop = useRef<number | null>(null);
  const contentKey = `${String(blocks.length)}:${String(blocks.reduce((sum, block) => sum + (block.kind === 'text' ? block.text.length : 0), 0))}`;
  useEffect(() => {
    const element = scroller.current;
    if (element === null || !followingRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    appliedTop.current = element.scrollTop;
  }, [contentKey]);
  useEffect(() => {
    // Opened at a node's latest visit: the stream starts there and does not follow until the person is back at the foot.
    const element = scroller.current;
    if (element === null) {
      return;
    }
    if (scrollTo === null) {
      element.scrollTop = element.scrollHeight;
      appliedTop.current = element.scrollTop;
      followingRef.current = true;
      setFollowing(true);
      return;
    }
    const target = element.querySelector<HTMLElement>(`[data-divider="${CSS.escape(scrollTo)}"]`);
    if (target !== null) {
      element.scrollTop = Math.max(0, target.offsetTop - element.offsetTop - 8);
      appliedTop.current = element.scrollTop;
      const atFoot = element.scrollHeight - element.scrollTop - element.clientHeight <= 64;
      followingRef.current = atFoot;
      setFollowing(atFoot);
    }
    onScrolledTo();
    // Once, when the panel opens or a node is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTo]);
  const onScroll = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const next = followAfterScrollEvent({
      metrics: { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight },
      appliedScrollTop: appliedTop.current,
    });
    appliedTop.current = null;
    if (next !== followingRef.current) {
      followingRef.current = next;
      setFollowing(next);
    }
  };
  return (
    <aside className="fw-stream" data-ev="follow-stream" data-following={following ? 'true' : 'false'}>
      <header className="fw-stream-header">
        <h2>Live stream</h2>
        <span className="fw-muted fw-stream-standing">{running ? (following ? 'Following' : 'Scrolled up · new text waits below') : 'The run has ended'}</span>
        <button type="button" className="fw-stream-close" data-ev="follow-stream-close" onClick={onClose} title="Close the live stream; the run goes on">
          Close
        </button>
      </header>
      <div className="fw-stream-body" ref={scroller} onScroll={onScroll} data-ev="follow-entries">
        {limitations.map((limitation, index) => (
          <p key={index} className="fw-muted fw-limitation" data-ev="follow-limitation">
            {limitation}
          </p>
        ))}
        {blocks.length === 0 && <p className="fw-muted">Nothing has been reported yet.</p>}
        {blocks.map((block) => (
          <StreamBlockView key={block.key} block={block} />
        ))}
        {running && <p className="fw-muted fw-open">The run goes on; what the agent reports appears here as it comes.</p>}
      </div>
    </aside>
  );
}

function StreamBlockView({ block }: { readonly block: StreamBlock }): JSX.Element {
  switch (block.kind) {
    case 'divider':
      return (
        <div className="fw-divider" data-ev="follow-divider" data-divider={block.anchor}>
          <span className="fw-divider-who">{block.who}</span>
          <span className="fw-divider-what">{block.what}</span>
        </div>
      );
    case 'text':
      return (
        <div className={`fw-text-block fw-text-${block.textKind}`} data-ev="follow-text" data-text-kind={block.textKind}>
          {block.textKind === 'reasoning' && <span className="fw-text-label">Reasoning, as the provider exposes it</span>}
          <div className="fw-text-body">{block.text}</div>
        </div>
      );
    case 'tool':
      return (
        <div className="fw-tool" data-ev="follow-tool" data-status={block.status ?? 'running'}>
          <span className="fw-tool-line">
            {block.summary}
            {block.status === 'error' ? ' · did not run' : block.status === 'ok' ? '' : ' …'}
          </span>
          {block.detail !== null && (
            <details className="fw-result">
              <summary>Result</summary>
              <pre className="fw-pre">{block.detail}</pre>
            </details>
          )}
        </div>
      );
    case 'command':
      return (
        <div className="fw-tool fw-command" data-ev="follow-command">
          <span className="fw-tool-line">
            Ran <code>{block.line}</code>
            {block.exitCode === null ? ` · ${block.ending}` : ` · exited ${String(block.exitCode)}`}
          </span>
          {block.output !== '' && (
            <details className="fw-result">
              <summary>Output</summary>
              <pre className="fw-pre">
                {block.output}
                {block.truncated ? '\n… (the rest was not kept)' : ''}
              </pre>
            </details>
          )}
        </div>
      );
    case 'note':
      return (
        <p className="fw-note" data-ev="follow-note">
          {block.text}
        </p>
      );
    case 'verdict':
      return (
        <div className="fw-verdict" data-ev="follow-verdict" data-verdict={block.review.verdict}>
          <span className="fw-verdict-head">
            {block.final ? 'Final assessment' : 'The reviewer\'s verdict'}: {block.review.verdict}
          </span>
          {block.review.assessment !== '' && <p>{block.review.assessment}</p>}
          {block.review.findings.length > 0 && (
            <ul>
              {block.review.findings.map((finding, index) => (
                <li key={index}>
                  <strong>{finding.steps.length === 0 ? 'The walks' : finding.steps.join(', ')}</strong>: {finding.problem}
                  {finding.why === '' ? '' : ` ${finding.why}`}
                </li>
              ))}
            </ul>
          )}
          <p className="fw-muted">The reviewer is an agent: its acceptance approves nothing of the code.</p>
        </div>
      );
    case 'ended':
      return (
        <p className="fw-ended" data-ev="follow-turn-ended">
          {block.status === 'cancelled' ? 'This turn was stopped.' : block.status === 'unconfirmed' ? 'The provider did not confirm how this turn ended.' : 'The provider stopped this turn.'}
          {block.error === null ? '' : ` ${block.error}`}
        </p>
      );
  }
}
