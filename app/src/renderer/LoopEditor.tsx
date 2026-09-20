/**
 * DSP-22: the loop graph editor.
 *
 * A prototype, and its purpose is to find out whether building a loop this way is a
 * sensible way to work. That question is answered by Niclas using it, so this is
 * built for being used and shown: place objects from a palette, connect them, click
 * one and edit its attributes, open our own development loop and save it back.
 *
 * Three things about it are decisions rather than shortcuts.
 *
 * **Validation is live and lives in the window.** `checkLoopGraph` is pure and takes
 * a typed graph, so every edit is revalidated without touching the disk. Only the
 * file and the role descriptions come over IPC.
 *
 * **Findings are ink, not a wall.** Our own loop is valid and produces twenty
 * notices; printing them as a list would read as twenty problems. So a finding
 * highlights the object it names, and the panel groups by the stable `code`.
 *
 * **A runtime fault is not drawable, and there is nothing here for it.** No timeout
 * edge, no "if this hangs" condition, no vocabulary for a call that never came back.
 * That is DSP-22 #5 and it is enforced by absence: the palette offers what the format
 * offers, which is two connection kinds.
 *
 * Out of scope, deliberately and per the task: automatic layout, undo history,
 * multi-user editing, and polish beyond legibility.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ATTRIBUTE_SUPPORT,
  LOOP_TARGETS,
  NODE_KINDS,
  REQUIREMENTS,
  ROLE_SOURCE_KINDS,
  attributeSupport,
  describeTargetChange,
  runnableHere,
  withTarget,
} from '../shared/loop-graph';
import type {
  LoopEdge,
  LoopGraph,
  LoopNode,
  LoopTarget,
  ModelPolicy,
  NodeKind,
  ResolvedRole,
  TargetChangeReport,
} from '../shared/loop-graph';
import { checkLoopGraph, loadLoopGraph } from '../shared/loop-graph-load';
import type { Finding } from '../shared/loop-graph-load';
import {
  KIND_HINTS,
  KIND_LABELS,
  connect,
  groupFindings,
  indexFindings,
  isDraftFinding,
  layOutMissingViews,
  newNode,
  nodeById,
  referencedRoles,
  replaceEdge,
  replaceNode,
  resolverFromEntries,
  roleKey,
  withNode,
  withoutEdge,
  withoutNode,
  worstSeverity,
} from '../shared/loop-graph-editing';
import type { ConnectionKind } from '../shared/loop-graph-editing';
import { serialiseLoopGraph } from '../shared/loop-graph-write';
import {
  describeLiveBinding,
  editorJournalOpen,
  liveRunOffer,
  newEditorRunId,
  runCanvasGraph,
  summariseEditorRun,
} from '../shared/loop-editor-run';
import type { EditorRunSummary } from '../shared/loop-editor-run';
import { formatJournalEntry, type RunJournalEntry, type RunResult } from '../shared/loop-run';
import type { LoopControlReport } from '../shared/loop-control';
import { LoopControlBar, useLoopControl } from './LoopControlBar';
import {
  NODE_RUN_STATE_MARKS,
  UNVERSIONED_CANVAS,
  applyRunEvent,
  describeRunView,
  edgesTakenIn,
  nodeRunStateFor,
  nodeRunStates,
  runViewFor,
  viewIsLocked,
  type LiveRunAnnouncement,
  type NodeRunState,
  type RunView,
} from '../shared/loop-run-view';
import { nodeHelpText, requiredForKind } from '../shared/loop-chat';
import {
  ANCHOR_DOT_RADIUS,
  NODE_HEIGHT,
  NODE_WIDTH,
  attachPoint,
  boxCentre,
  nodeBox,
} from '../shared/loop-edge-geometry';

const EDITOR_HELP_KEY = 'dspatch.editor.help';

function readEditorHelp(): boolean {
  try {
    return window.localStorage.getItem(EDITOR_HELP_KEY) === 'on';
  } catch {
    return false;
  }
}

function writeEditorHelp(on: boolean): void {
  try {
    window.localStorage.setItem(EDITOR_HELP_KEY, on ? 'on' : 'off');
  } catch {
    /* Private mode is fine: help stays off for this session. */
  }
}

interface OpenFile {
  readonly path: string;
  readonly displayPath: string;
  readonly newline: '\n' | '\r\n';
  readonly projectRoot: string;
}

type Selection = { readonly kind: 'node' | 'edge'; readonly id: string } | null;

type Tool =
  | { readonly kind: 'place'; readonly nodeKind: NodeKind }
  | { readonly kind: 'connect'; readonly connection: ConnectionKind }
  | null;

/**
 * Whether this window exists only to be the editor.
 *
 * Set by the main process when it opens the editor's own window, so the one control
 * that does not belong there — "Back to chat", which would make a second chat window on
 * a single session — is absent rather than merely discouraged. `npm run editor` loads the
 * main window on the `#editor` hash and does not set it, so that path is unchanged.
 */
function isDedicatedEditorWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'editor';
  } catch {
    return false;
  }
}

export function LoopEditor(): React.JSX.Element {
  const dedicatedEditorWindow = useMemo(isDedicatedEditorWindow, []);
  const [file, setFile] = useState<OpenFile | null>(null);
  const [graph, setGraph] = useState<LoopGraph | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [roles, setRoles] = useState<ReadonlyMap<string, ResolvedRole | null>>(new Map());
  const [refusal, setRefusal] = useState<readonly Finding[] | null>(null);
  const [note, setNote] = useState('Open our development loop to start.');
  const [selection, setSelection] = useState<Selection>(null);
  const [tool, setTool] = useState<Tool>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connectedTargets, setConnectedTargets] = useState<readonly LoopTarget[] | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [showHelp, setShowHelp] = useState(readEditorHelp);
  const [zoom, setZoom] = useState(0.85);
  const [pendingTarget, setPendingTarget] = useState<{
    readonly to: LoopTarget;
    readonly report: TargetChangeReport;
  } | null>(null);
  const [drag, setDrag] = useState<{ readonly id: string; readonly dx: number; readonly dy: number } | null>(
    null,
  );
  const [runBusy, setRunBusy] = useState(false);
  const [runKind, setRunKind] = useState<'dry' | 'live' | null>(null);
  /*
   * There is deliberately no `runResult` state any more.
   *
   * It used to hold the finished `RunResult` so the canvas could draw `result.path` and
   * `result.edgesTaken` after a run, while a live run drew the journal entries as they
   * arrived. That is two derivations of one thing, and the second one only existed because
   * the first was not available yet — exactly the shape of the defect Niclas met, where a
   * badge read the walk and the sentence beside it read the terminal. The marking now comes
   * from the run's own entries in `watch`, before and after the run alike, and `summariseEditorRun`
   * still produces the journal summary from the returned result for the pane below.
   */
  const [runSummary, setRunSummary] = useState<EditorRunSummary | null>(null);
  const [runRefuse, setRunRefuse] = useState<string | null>(null);
  /**
   * The run this window is watching, or `null` when the window is an editor.
   *
   * DSP-28 #2 to #4 live in this one piece of state, and its shape is the point: it is
   * the run's own identity plus the run's own journal entries, and every mark on the
   * canvas is derived from it by `nodeRunStates`. There is deliberately no second set
   * of booleans about which node is busy — that is what would begin to disagree with
   * the record, which is the defect DSP-26 #1 exists to prevent.
   */
  const [watch, setWatch] = useState<RunView | null>(null);
  const [watchNote, setWatchNote] = useState<string | null>(null);
  /** Who decides the next work step. The same report the chat window reads. */
  const loopControl = useLoopControl();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const resolveRole = useMemo(() => resolverFromEntries(roles), [roles]);

  const findings = useMemo<readonly Finding[]>(
    () => (graph === null ? [] : checkLoopGraph(graph, { resolveRole, connectedTargets })),
    [graph, resolveRole, connectedTargets],
  );
  const index = useMemo(() => indexFindings(findings), [findings]);

  const currentText = useMemo(
    () => (graph === null ? null : serialiseLoopGraph(graph, { newline: file?.newline ?? '\n' })),
    [graph, file],
  );
  const dirty = currentText !== null && savedText !== null && currentText !== savedText;

  // Which frameworks this machine is connected to, asked in the background because a
  // provider check is a network call and a graph opens without one. `null` stays
  // "not established", which is a different answer from "none".
  useEffect(() => {
    let cancelled = false;
    void window.dspatch.getConnection().then(
      (status) => {
        if (cancelled) {
          return;
        }
        if (status.kind === 'connected') {
          setConnectedTargets(['cursor']);
        } else if (status.kind === 'not-connected') {
          setConnectedTargets([]);
        }
      },
      () => {
        /* Unknown stays unknown. */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const open = useCallback(async (which: 'development-loop' | 'pick') => {
    const outcome = await window.dspatch.openLoopGraph({ kind: which });
    if (outcome.kind === 'cancelled') {
      return;
    }
    if (outcome.kind === 'unavailable') {
      setNote(outcome.note);
      return;
    }
    const roleMap = new Map<string, ResolvedRole | null>(
      outcome.roles.map((entry) => [entry.key, entry.role]),
    );
    const loaded = loadLoopGraph(outcome.text, {
      resolveRole: resolverFromEntries(roleMap),
      connectedTargets,
    });
    setRoles(roleMap);
    setFile({
      path: outcome.path,
      displayPath: outcome.displayPath,
      newline: outcome.newline,
      projectRoot: outcome.projectRoot,
    });
    setSelection(null);
    setTool(null);
    setConnectFrom(null);
    setRunSummary(null);
    setRunRefuse(null);
    if (!loaded.ok) {
      // Refused, not partially loaded: DSP-21's rule and DSP-22 #3. Drawing half a
      // file would show a picture that is not the file.
      setGraph(null);
      setSavedText(null);
      setRefusal(loaded.findings);
      setNote(`${outcome.displayPath} was refused: ${String(loaded.findings.length)} findings, and no graph was loaded.`);
      return;
    }
    setRefusal(null);
    // `view` is optional in the format, so a hand-written graph arrives with every node
    // at 0,0 — one visible box and thirty-one invisible edges. Placing them is a view of
    // the file, not a change to it, which is why the saved text below is taken from the
    // laid-out graph: the positions exist on the canvas and not in the file until the
    // author changes something and saves.
    const laidOut = layOutMissingViews(loaded.graph);
    setGraph(laidOut.graph);
    // What the author is compared against is what we would write for the graph as
    // opened, not the bytes on disk. Those differ wherever the file's own layout is not
    // the writer's — a `role` on one line rather than four is enough — and comparing
    // against the file made every such graph open as "unsaved changes" with Save live,
    // before anything had been touched. The graph is identical to the file as data; it
    // was the text comparison that was wrong, so nothing is suppressed here.
    setSavedText(serialiseLoopGraph(laidOut.graph, { newline: outcome.newline }));
    setNote(
      `${outcome.displayPath} — ${String(laidOut.graph.nodes.length)} nodes, ${String(laidOut.graph.edges.length)} edges.` +
        (laidOut.placed.length === 0
          ? ''
          : ` ${String(laidOut.placed.length)} of them had no saved position and ${laidOut.placed.length === 1 ? 'was' : 'were'} placed on a grid; arrange them and save to keep it.`) +
        ` ${loaded.runnable.reason}`,
    );
  }, [connectedTargets]);

  const save = useCallback(async () => {
    if (graph === null || file === null || currentText === null) {
      return;
    }
    if (index.errors > 0) {
      setNote(
        `Not saved: ${String(index.errors)} error${index.errors === 1 ? '' : 's'} would make the file mean something nobody drew. The objects are marked on the canvas.`,
      );
      return;
    }
    const outcome = await window.dspatch.saveLoopGraph({ path: file.path, text: currentText });
    if (outcome.kind === 'written') {
      setSavedText(currentText);
      setNote(`Saved ${file.displayPath} — ${String(outcome.bytes)} bytes.`);
    } else if (outcome.kind === 'failed') {
      setNote(outcome.note);
    }
  }, [graph, file, currentText, index.errors]);

  /** Re-resolve role bindings the author has changed, so "broken" stays truthful. */
  const refreshRoles = useCallback(
    async (next: LoopGraph) => {
      const missing = referencedRoles(next).filter((reference) => !roles.has(roleKey(reference)));
      if (missing.length === 0) {
        return;
      }
      const entries = await window.dspatch.resolveLoopRoles(missing);
      setRoles((previous) => {
        const merged = new Map(previous);
        for (const entry of entries) {
          merged.set(entry.key, entry.role);
        }
        return merged;
      });
    },
    [roles],
  );

  const apply = useCallback(
    (next: LoopGraph, message?: string) => {
      setGraph(next);
      if (message !== undefined) {
        setNote(message);
      }
      void refreshRoles(next);
    },
    [refreshRoles],
  );

  const liveBinding = graph === null ? null : describeLiveBinding(graph);
  const runBlocked = graph === null || index.errors > 0 || runBusy;
  // A dry run walks the canvas and touches no control, so it keeps the local answer.
  // A live run is the one that must not overlap, and `runBusy` is this window's own.
  const liveRun = liveRunOffer({
    ownRunBusy: runBusy,
    activeRunId: loopControl.runId,
    blocked: runBlocked,
    reason: liveBinding?.reason ?? 'Open a graph first.',
  });
  const journalOpen =
    watch !== null ||
    editorJournalOpen({
      busy: runBusy,
      summary: runSummary,
      refuse: runRefuse,
    });

  /**
   * Follow the run that is actually happening.
   *
   * Every event is addressed to a run, and `applyRunEvent` drops anything that is not
   * about the run on screen — including an entry still arriving from a run the user
   * cancelled a moment ago. A `started` event is the one thing that changes which run
   * is watched, because a run beginning is precisely when the answer to "what is
   * happening" changes.
   *
   * Subscribing is not starting: this listens, and a window with nothing to watch shows
   * the editor exactly as before.
   */
  useEffect(() => {
    return window.dspatch.onLoopRunEvent((event) => {
      if (event.kind === 'started') {
        setWatch(runViewFor(event.run));
        setWatchNote(null);
        return;
      }
      setWatch((previous) => applyRunEvent(previous, event));
    });
  }, []);

  /**
   * What is already running when this window opens.
   *
   * A window can be opened halfway through a run — that is the ordinary case, since
   * the reason to open the editor during a run is to watch it. **A read:** it starts
   * nothing, cancels nothing and repeats nothing (DSP-28 #5).
   */
  useEffect(() => {
    let cancelled = false;
    void window.dspatch.currentLoopRun().then(
      (run) => {
        if (cancelled || run === null) {
          return;
        }
        setWatch((previous) => (previous === null ? runViewFor(run) : previous));
      },
      () => {
        /* Nothing to watch is the ordinary case and not an error. */
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const showRun = useCallback(
    (result: RunResult, extra?: string) => {
      const summary = summariseEditorRun(result);
      setRunSummary(summary);
      setRunRefuse(null);
      setNote(
        `${summary.headline}. Path: ${summary.path}. ${summary.usage}.` +
          (extra === undefined ? '' : ` ${extra}`),
      );
    },
    [],
  );

  const dryRunCanvas = useCallback(async () => {
    if (graph === null || index.errors > 0 || runBusy) {
      return;
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setRunBusy(true);
    setRunKind('dry');
    setRunSummary(null);
    setRunRefuse(null);
    setNote('Dry-running the graph on the canvas. No provider is reachable.');
    // A dry run is watched through exactly the same state as a live one, so the
    // highlight is not a second implementation that could differ from the one a real
    // run uses — and it is how the marking can be seen at all without spending a turn.
    // It walks the drawing in this window, so there is no content hash to offer and it
    // says so rather than inventing one.
    const announcement: LiveRunAnnouncement = {
      runId: newEditorRunId('dry'),
      graphVersionId: UNVERSIONED_CANVAS,
      graphId: graph.id,
      graphName: graph.name,
      binding: 'canvas-dry-run',
      graphText: currentText ?? '',
      startedAtUtc: new Date().toISOString(),
    };
    const address = { runId: announcement.runId, graphVersionId: announcement.graphVersionId };
    setWatch(runViewFor(announcement));
    setWatchNote(null);
    try {
      const result = await runCanvasGraph(graph, {
        runId: announcement.runId,
        abortSignal: abort.signal,
        onJournalEntry: (entry) => {
          setWatch((previous) => applyRunEvent(previous, { kind: 'journal', ...address, entry }));
        },
      });
      setWatch((previous) =>
        applyRunEvent(previous, {
          kind: 'ended',
          ...address,
          status: result.status,
          note: `The dry run ended: ${result.status}.`,
        }),
      );
      showRun(result);
    } finally {
      abortRef.current = null;
      setRunBusy(false);
      setRunKind(null);
    }
  }, [graph, currentText, index.errors, runBusy, showRun]);

  const liveRunCanvas = useCallback(async () => {
    if (graph === null || currentText === null || index.errors > 0 || runBusy) {
      return;
    }
    if (liveBinding === null || !liveBinding.ready) {
      setRunSummary(null);
      setRunRefuse(liveBinding?.reason ?? 'This drawing has no live binding.');
      setNote(liveBinding?.reason ?? 'This drawing has no live binding.');
      return;
    }
    setRunBusy(true);
    setRunKind('live');
    setRunSummary(null);
    setRunRefuse(null);
    setNote(
      'Live-running the canvas graph on an isolated experiment repository. ' +
        'The first agent step can take minutes. The journal below updates as nodes are entered.',
    );
    try {
      const outcome = await window.dspatch.startEditorLoopRun({
        runId: newEditorRunId('live'),
        text: currentText,
      });
      if (outcome.kind === 'refused') {
        setRunSummary(null);
        setRunRefuse(outcome.reason);
        setNote(outcome.reason);
        return;
      }
      if (outcome.kind === 'failed') {
        setRunRefuse(outcome.note);
        setNote(outcome.note);
        return;
      }
      showRun(outcome.result, outcome.workspaceNote);
    } finally {
      setRunBusy(false);
      setRunKind(null);
    }
  }, [graph, currentText, index.errors, runBusy, liveBinding, showRun]);

  const cancelRun = useCallback(async () => {
    abortRef.current?.abort();
    if (runKind === 'live') {
      const outcome = await window.dspatch.cancelEditorLoopRun();
      setNote(outcome.note);
    } else if (runBusy) {
      setNote('Cancel requested. Completed steps are not replayed; the graph stays as it is.');
    }
  }, [runBusy, runKind]);

  /**
   * The graph a watched run is walking, loaded from the bytes that were validated for
   * it rather than from the canvas.
   *
   * DSP-28 #2. Showing "the graph" by name is precisely the mistake the content hash
   * exists to prevent: the author may have moved a node or redirected an edge since Run
   * was pressed, and the picture has to be the one that is running. A version that
   * cannot be loaded is said out loud, because drawing the author's own graph and
   * calling it the run's would be the same untruth in a friendlier voice.
   */
  const watchedGraph = useMemo<LoopGraph | null>(() => {
    if (watch === null) {
      return null;
    }
    const loaded = loadLoopGraph(watch.run.graphText, { resolveRole, connectedTargets });
    return loaded.ok ? layOutMissingViews(loaded.graph).graph : null;
  }, [watch, resolveRole, connectedTargets]);

  /** Locked while a run is on screen: an editable graph would stop describing the run. */
  const locked = viewIsLocked(watch);
  /** One graph on screen at a time, and while a run is watched it is the run's. */
  const shownGraph = watch === null ? graph : watchedGraph;

  const selectedNode = graph !== null && selection?.kind === 'node' ? nodeById(graph, selection.id) : null;
  const selectedEdge =
    graph !== null && selection?.kind === 'edge'
      ? (graph.edges.find((edge) => edge.id === selection.id) ?? null)
      : null;

  const bounds = useMemo(() => {
    if (shownGraph === null) {
      return { width: 900, height: 600 };
    }
    let maxX = 0;
    let maxY = 0;
    for (const node of shownGraph.nodes) {
      maxX = Math.max(maxX, (node.view?.x ?? 0) + NODE_WIDTH);
      maxY = Math.max(maxY, (node.view?.y ?? 0) + NODE_HEIGHT);
    }
    return { width: maxX + 120, height: maxY + 120 };
  }, [shownGraph]);

  const pointIn = useCallback(
    (event: React.MouseEvent): { readonly x: number; readonly y: number } => {
      const svg = svgRef.current;
      if (svg === null) {
        return { x: 0, y: 0 };
      }
      const rect = svg.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) / zoom,
        y: (event.clientY - rect.top) / zoom,
      };
    },
    [zoom],
  );

  const onCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      // Locked means locked, at the point where a change would be made rather than only
      // on the buttons: DSP-28 #2, and a disabled palette alone would still leave the
      // canvas itself editable.
      if (graph === null || locked) {
        return;
      }
      if (tool?.kind === 'place') {
        const point = pointIn(event);
        const node = newNode(tool.nodeKind, graph, point.x - NODE_WIDTH / 2, point.y - NODE_HEIGHT / 2);
        apply(
          withNode(graph, node),
          `Placed ${KIND_LABELS[tool.nodeKind].toLowerCase()} "${node.id}". ${KIND_HINTS[tool.nodeKind]}`,
        );
        setSelection({ kind: 'node', id: node.id });
        setTool(null);
        return;
      }
      setSelection(null);
      setConnectFrom(null);
    },
    [graph, locked, tool, pointIn, apply],
  );

  const onNodeMouseDown = useCallback(
    (event: React.MouseEvent, node: LoopNode) => {
      event.stopPropagation();
      if (graph === null || locked) {
        return;
      }
      if (tool?.kind === 'connect') {
        if (connectFrom === null) {
          setConnectFrom(node.id);
          setNote(`Connecting from "${node.label ?? node.id}". Click the node it goes to.`);
          return;
        }
        const result = connect(graph, connectFrom, node.id, tool.connection);
        apply(result.graph, result.note);
        setSelection({ kind: 'edge', id: result.edgeId });
        setConnectFrom(null);
        setTool(null);
        return;
      }
      setSelection({ kind: 'node', id: node.id });
      const point = pointIn(event);
      setDrag({ id: node.id, dx: point.x - (node.view?.x ?? 0), dy: point.y - (node.view?.y ?? 0) });
    },
    [graph, locked, tool, connectFrom, pointIn, apply],
  );

  const onCanvasMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (drag === null || graph === null) {
        return;
      }
      const node = nodeById(graph, drag.id);
      if (node === null) {
        return;
      }
      const point = pointIn(event);
      // `view` is presentation only. Moving a node must never change what the graph
      // means, so nothing else on the node is touched.
      setGraph(
        replaceNode(graph, node.id, {
          ...node,
          view: { x: Math.round(point.x - drag.dx), y: Math.round(point.y - drag.dy) },
        }),
      );
    },
    [drag, graph, pointIn],
  );

  const changeTarget = useCallback(
    (to: LoopTarget) => {
      if (graph === null || to === graph.target) {
        return;
      }
      // Reported first and applied never: describeTargetChange returns prose and no
      // graph, and this dialog is the whole of DSP-22 #8's "applies nothing on its own".
      setPendingTarget({ to, report: describeTargetChange(graph, to, { resolveRole }) });
    },
    [graph, resolveRole],
  );

  useEffect(() => {
    window.dspatch.reportReady({
      headingText: 'Loop editor',
      capabilityCount: NODE_KINDS.length,
      renderedAt: new Date().toISOString(),
    });
  }, []);

  // Our own development loop is what the editor is for first, so it is already open
  // when the window appears rather than one click away. `openedOnce` is a ref because
  // this must not fire again when the graph is later closed or replaced.
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) {
      return;
    }
    openedOnce.current = true;
    void open('development-loop');
  }, [open]);

  // A hidden hook for DSPATCH_EDITOR_AUTORUN: the main process clicks through
  // the same functions the visible buttons call, so a log of the window is not
  // a claim about a CLI walk.
  useEffect(() => {
    if (graph === null) {
      return;
    }
    window.__dspatchEditorCheck = {
      dryRunCurrent: async () => {
        if (index.errors > 0) {
          return null;
        }
        const result = await runCanvasGraph(graph, { runId: newEditorRunId('dry') });
        showRun(result);
        return summariseEditorRun(result);
      },
      dryRunRedirectedE08: async () => {
        const edge = graph.edges.find((entry) => entry.id === 'e08');
        if (edge === undefined) {
          return null;
        }
        const next = replaceEdge(graph, 'e08', { ...edge, to: 'coordinator-report' });
        apply(next, 'Redirected e08 to the report, so the drawing — not the file — is what runs.');
        const result = await runCanvasGraph(next, { runId: newEditorRunId('dry') });
        showRun(result);
        return summariseEditorRun(result);
      },
    };
    return () => {
      delete window.__dspatchEditorCheck;
    };
  }, [graph, index.errors, apply, showRun]);

  const runStates = useMemo(() => nodeRunStates(watch), [watch]);
  const edgeSet = useMemo(() => edgesTakenIn(watch), [watch]);

  /** Leave the run view and go back to editing. Deliberate, and it stops nothing. */
  const leaveRunView = useCallback(() => {
    setWatch(null);
    setWatchNote(null);
    setNote(
      'Left the run view. Your own drawing is back exactly as it was, and the run — if one ' +
        'is still going — is untouched: closing a view never starts or stops work.',
    );
  }, []);

  return (
    <div className={`editor${journalOpen ? ' has-journal' : ''}`} onMouseUp={() => setDrag(null)}>
      <header className="editor-bar">
        <div className="editor-title">
          <h1>Loop editor</h1>
          <p>
            {graph === null ? 'No graph open' : graph.name}
            {file === null ? '' : ` — ${file.displayPath}`}
            {dirty ? ' · unsaved changes' : ''}
          </p>
        </div>

        <div className="editor-actions">
          {/*
            Only in a window that has a chat to go back to. A window opened by "Edit agent
            loops" is the editor's own (DSP-28 #1), and turning it into a second chat would
            put two windows on one session — the opposite of the point. `npm run editor`
            still opens the main window on `#editor`, and there the button stays.
          */}
          {dedicatedEditorWindow ? null : (
            <button
              type="button"
              onClick={() => {
                window.location.hash = '';
              }}
            >
              Back to chat
            </button>
          )}
          <button type="button" onClick={() => void open('development-loop')}>
            Open our development loop
          </button>
          <button type="button" onClick={() => void open('pick')}>
            Open a graph…
          </button>
          <button
            type="button"
            disabled={graph === null || !dirty || locked}
            title={locked ? 'A run is on screen. Leave the run view to edit and save your own drawing.' : undefined}
            onClick={() => void save()}
          >
            Save
          </button>
          <button
            type="button"
            className="editor-run"
            disabled={runBlocked}
            title={
              graph === null
                ? 'Open a graph first.'
                : index.errors > 0
                  ? 'The graph has errors, so it is not the drawing that would run.'
                  : 'Walk the graph on the canvas. No provider is reachable.'
            }
            onClick={() => void dryRunCanvas()}
          >
            Dry-run
          </button>
          <button
            type="button"
            className="editor-run"
            disabled={!liveRun.enabled}
            title={liveRun.title}
            onClick={() => void liveRunCanvas()}
          >
            Run
          </button>
          <button type="button" disabled={!runBusy} onClick={() => void cancelRun()}>
            Cancel run
          </button>
          <label className="editor-target">
            Target framework
            <select
              value={graph?.target ?? 'cursor'}
              disabled={graph === null || locked}
              onChange={(event) => changeTarget(event.target.value as LoopTarget)}
            >
              {LOOP_TARGETS.map((target) => (
                <option key={target} value={target}>
                  {target}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="editor-state">
          <Chip severity="error" count={index.errors} />
          <Chip severity="warning" count={index.warnings} />
          <Chip severity="notice" count={index.notices} />
          {runBusy ? (
            <span className="chip chip-live-ready" title="A run is walking the canvas. Cancel run stays available.">
              {runKind === 'live' ? 'Live running…' : 'Dry-run…'}
            </span>
          ) : liveBinding === null ? null : (
            <span
              className={`chip ${liveBinding.ready ? 'chip-live-ready' : 'chip-live-off'}`}
              title={liveBinding.reason}
            >
              {liveBinding.ready ? 'Live ready' : 'Live: dry-run only'}
            </span>
          )}
          <label className="editor-toggle">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(event) => setShowLabels(event.target.checked)}
            />
            Edge labels
          </label>
          <label
            className="editor-toggle"
            title="Hover text: each object's purpose and what it requires. Off by default."
          >
            <input
              type="checkbox"
              checked={showHelp}
              onChange={(event) => {
                const next = event.target.checked;
                setShowHelp(next);
                writeEditorHelp(next);
              }}
            />
            Help
          </label>
          <span className="editor-zoom">
            <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
              −
            </button>
            {String(Math.round(zoom * 100))}%
            <button type="button" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}>
              +
            </button>
          </span>
        </div>
      </header>

      <div className="editor-palette">
        <span className="editor-palette-title">Place</span>
        {NODE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={tool?.kind === 'place' && tool.nodeKind === kind ? 'chosen' : ''}
            title={
              showHelp ? `${KIND_HINTS[kind]} Required: ${requiredForKind(kind)}` : KIND_HINTS[kind]
            }
            disabled={graph === null || locked}
            onClick={() => {
              setTool({ kind: 'place', nodeKind: kind });
              setConnectFrom(null);
              setNote(`${KIND_LABELS[kind]}: ${KIND_HINTS[kind]} Click the canvas to place it.`);
            }}
          >
            <span className={`swatch kind-${kind}`} />
            {KIND_LABELS[kind]}
          </button>
        ))}
        <span className="editor-palette-title">Connect</span>
        <button
          type="button"
          className={tool?.kind === 'connect' && tool.connection === 'plain' ? 'chosen' : ''}
          disabled={graph === null || locked}
          onClick={() => {
            setTool({ kind: 'connect', connection: 'plain' });
            setConnectFrom(null);
            setNote('Plain connection. Click the node it comes from, then the node it goes to.');
          }}
        >
          <svg width="34" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="33" y2="5" className="sample-plain" />
          </svg>
          Connection
        </button>
        <button
          type="button"
          className={tool?.kind === 'connect' && tool.connection === 'declared-failure' ? 'chosen' : ''}
          disabled={graph === null || locked}
          onClick={() => {
            setTool({ kind: 'connect', connection: 'declared-failure' });
            setConnectFrom(null);
            setNote(
              'Declared failure. Click the node that can report it, then where the run goes when it does.',
            );
          }}
        >
          <svg width="34" height="10" aria-hidden="true">
            <line x1="1" y1="5" x2="33" y2="5" className="sample-failure" />
          </svg>
          Declared failure
        </button>
        {tool === null ? null : (
          <button type="button" className="editor-cancel" onClick={() => { setTool(null); setConnectFrom(null); }}>
            Cancel
          </button>
        )}
      </div>

      {watch === null ? null : (
        <RunWatchBanner
          view={watch}
          graphLoaded={watchedGraph !== null}
          note={watchNote}
          control={loopControl}
          onLeave={leaveRunView}
        />
      )}

      <main className="editor-main">
        <div className="editor-canvas">
          {shownGraph === null ? (
            <RefusalPanel findings={refusal} watching={watch !== null} />
          ) : (
            <svg
              ref={svgRef}
              width={bounds.width * zoom}
              height={bounds.height * zoom}
              viewBox={`0 0 ${String(bounds.width)} ${String(bounds.height)}`}
              className={`${tool === null || locked ? '' : 'armed'}${locked ? ' locked' : ''}`}
              onClick={onCanvasClick}
              onMouseMove={onCanvasMouseMove}
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head" />
                </marker>
                <marker id="arrow-failure" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" className="arrow-head-failure" />
                </marker>
              </defs>

              {shownGraph.edges.map((edge) => (
                <EdgeShape
                  key={edge.id}
                  edge={edge}
                  graph={shownGraph}
                  selected={!locked && selection?.kind === 'edge' && selection.id === edge.id}
                  highlighted={
                    !locked &&
                    selection?.kind === 'node' &&
                    (edge.from === selection.id || edge.to === selection.id)
                  }
                  showLabel={showLabels}
                  taken={edgeSet.has(edge.id)}
                  severity={locked ? null : worstSeverity(index.byEdge.get(edge.id) ?? [])}
                  onSelect={() => {
                    if (!locked) {
                      setSelection({ kind: 'edge', id: edge.id });
                    }
                  }}
                />
              ))}

              {shownGraph.nodes.map((node) => (
                <NodeShape
                  key={node.id}
                  node={node}
                  role={node.role ? (roles.get(roleKey(node.role)) ?? null) : null}
                  isEntry={shownGraph.entry === node.id}
                  selected={!locked && selection?.kind === 'node' && selection.id === node.id}
                  connecting={connectFrom === node.id}
                  runState={nodeRunStateFor(runStates, node.id)}
                  severity={locked ? null : worstSeverity(index.byNode.get(node.id) ?? [])}
                  helpTitle={showHelp ? nodeHelpText(node) : undefined}
                  onMouseDown={(event) => onNodeMouseDown(event, node)}
                />
              ))}
            </svg>
          )}
        </div>

        <aside className="editor-inspector">
          {locked && watch !== null ? (
            <WatchedRunInspector view={watch} states={runStates} graph={shownGraph} />
          ) : graph === null ? (
            <p className="muted">
              Nothing is open. “Open our development loop” loads
              docs/loop/graphs/dspatch-development-loop.graph.json.
            </p>
          ) : selectedNode !== null ? (
            <NodeInspector
              graph={graph}
              node={selectedNode}
              role={selectedNode.role ? (roles.get(roleKey(selectedNode.role)) ?? null) : null}
              findings={index.byNode.get(selectedNode.id) ?? []}
              help={showHelp}
              onChange={(next) => apply(replaceNode(graph, selectedNode.id, next))}
              onDelete={() => {
                apply(withoutNode(graph, selectedNode.id), `Removed "${selectedNode.id}" and every edge that touched it.`);
                setSelection(null);
              }}
            />
          ) : selectedEdge !== null ? (
            <EdgeInspector
              graph={graph}
              edge={selectedEdge}
              findings={index.byEdge.get(selectedEdge.id) ?? []}
              onChange={(next) => apply(replaceEdge(graph, selectedEdge.id, next))}
              onDelete={() => {
                apply(withoutEdge(graph, selectedEdge.id), `Removed edge ${selectedEdge.id}.`);
                setSelection(null);
              }}
            />
          ) : (
            <GraphInspector
              graph={graph}
              findings={findings}
              connectedTargets={connectedTargets}
              onChange={(next) => apply(next)}
              onSelect={(target) => setSelection(target)}
            />
          )}
        </aside>
      </main>

      {journalOpen ? (
        <RunJournal
          summary={runSummary}
          refuse={runRefuse}
          busy={runBusy}
          kind={runKind}
          liveEntries={watch?.entries ?? []}
        />
      ) : null}

      <footer className="editor-note">{note}</footer>

      {pendingTarget === null || graph === null ? null : (
        <TargetChangeDialog
          graph={graph}
          to={pendingTarget.to}
          report={pendingTarget.report}
          onCancel={() => setPendingTarget(null)}
          onApply={() => {
            apply(
              withTarget(graph, pendingTarget.to),
              `Target is now ${pendingTarget.to}. Nothing was removed; the warnings below are about ${pendingTarget.to}.`,
            );
            setPendingTarget(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Which run is on screen, and the one thing a person needs to know about looking at it.
 *
 * The lock is stated rather than merely enforced. A disabled palette with no explanation
 * reads as a broken editor, and the honest sentence is short: this is the version that
 * ran, editing it would stop it describing the run, and leaving does nothing to the run.
 */
function RunWatchBanner({
  view,
  graphLoaded,
  note,
  control,
  onLeave,
}: {
  readonly view: RunView;
  readonly graphLoaded: boolean;
  readonly note: string | null;
  readonly control: LoopControlReport;
  readonly onLeave: () => void;
}): React.JSX.Element {
  const states = nodeRunStates(view);
  const counted = new Map<NodeRunState, number>();
  for (const state of states.values()) {
    counted.set(state, (counted.get(state) ?? 0) + 1);
  }
  return (
    <section className={`editor-watch${view.ended ? ' editor-watch-ended' : ''}`} aria-label="Run being watched">
      <p className="editor-watch-line">{describeRunView(view)}</p>
      {note === null ? null : <p className="editor-watch-note">{note}</p>}
      {/*
        The same controls as the chat window, from the same component reading the same
        state. A person watching the graph is exactly the person who wants to pause it,
        and if this window offered a different answer from the chat's about one run,
        that disagreement would be the defect rather than the display of it.
      */}
      {/* `loopIntended` is true because this section only exists while a run is being
          watched: in the chat window the flag keeps the chooser away from an ordinary
          composer, and here there is nothing else the window could be about. */}
      <LoopControlBar report={control} loopIntended />
      <p className="editor-watch-states">
        {[...counted.entries()].map(([state, count]) => (
          <span key={state} className={`chip ${NODE_RUN_STATE_MARKS[state].className}`} title={NODE_RUN_STATE_MARKS[state].label}>
            {String(count)} {NODE_RUN_STATE_MARKS[state].mark || 'not reached'}
          </span>
        ))}
        {graphLoaded ? null : <span className="chip chip-error">the run&apos;s graph could not be drawn</span>}
      </p>
      <button type="button" onClick={onLeave}>
        Leave the run view
      </button>
    </section>
  );
}

/**
 * The inspector while a run is on screen: what each node is doing, and nothing to edit.
 *
 * The editing inspector is **absent** rather than present-and-disabled, which is the
 * cheaper and the more honest of the two: a form full of greyed fields invites the reader
 * to work out which of them would have mattered, and every one of them would have been
 * editing the run's own drawing.
 */
function WatchedRunInspector({
  view,
  states,
  graph,
}: {
  readonly view: RunView;
  readonly states: ReadonlyMap<string, NodeRunState>;
  readonly graph: LoopGraph | null;
}): React.JSX.Element {
  const rows =
    graph === null
      ? [...states.entries()].map(([id, state]) => ({ id, label: id, state }))
      : graph.nodes.map((node) => ({
          id: node.id,
          label: node.label ?? node.id,
          state: nodeRunStateFor(states, node.id),
        }));
  return (
    <div className="inspector">
      <h2>The run on screen</h2>
      <p className="muted">
        This is a view of run <code>{view.run.runId}</code>, not a drawing board. Nothing here
        can change the graph that ran, and leaving the view neither starts nor stops anything.
      </p>
      <h3>Nodes</h3>
      <ul className="findings">
        {rows.map((row) => (
          <li key={row.id} className={`run-row ${NODE_RUN_STATE_MARKS[row.state].className}`}>
            <code>{row.id}</code> {row.label} — {NODE_RUN_STATE_MARKS[row.state].label}
          </li>
        ))}
      </ul>
      <h3>What the words mean</h3>
      <ul className="findings">
        {(['waiting', 'active', 'finished', 'failed', 'stopped'] as const).map((state) => (
          <li key={state} className={`run-row ${NODE_RUN_STATE_MARKS[state].className}`}>
            <strong>{NODE_RUN_STATE_MARKS[state].mark}</strong> — {NODE_RUN_STATE_MARKS[state].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RunJournal({
  summary,
  refuse,
  busy,
  kind,
  liveEntries,
}: {
  readonly summary: EditorRunSummary | null;
  readonly refuse: string | null;
  readonly busy: boolean;
  readonly kind: 'dry' | 'live' | null;
  readonly liveEntries: readonly RunJournalEntry[];
}): React.JSX.Element {
  const liveText = liveEntries.map((entry) => formatJournalEntry(entry)).join('\n');
  return (
    <section className="editor-journal" aria-label="Run journal">
      <h2>{busy ? `${kind === 'live' ? 'Live' : 'Dry-run'} in progress` : 'Last run'}</h2>
      {refuse === null ? null : <p className="journal-refuse">{refuse}</p>}
      {busy && summary === null ? (
        <>
          <p className="muted">
            {kind === 'live'
              ? 'Cursor is working in an isolated experiment repository. Nodes light up as they are entered. This first step can take several minutes.'
              : 'Walking the graph on the canvas…'}
          </p>
          {liveText === '' ? null : <pre>{liveText}</pre>}
        </>
      ) : summary === null ? null : (
        <>
          <p className="journal-headline">{summary.headline}</p>
          <dl>
            <div>
              <dt>Path</dt>
              <dd>{summary.path}</dd>
            </div>
            <div>
              <dt>Edges</dt>
              <dd>{summary.edges}</dd>
            </div>
            <div>
              <dt>Usage</dt>
              <dd>{summary.usage}</dd>
            </div>
            <div>
              <dt>Reconcile</dt>
              <dd>{summary.reconcile}</dd>
            </div>
          </dl>
          <pre>{summary.journal}</pre>
        </>
      )}
    </section>
  );
}

function Chip({ severity, count }: { readonly severity: Finding['severity']; readonly count: number }): React.JSX.Element {
  const label = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'notice';
  return (
    <span className={`chip chip-${severity}${count === 0 ? ' chip-none' : ''}`}>
      {String(count)} {label}
      {count === 1 ? '' : 's'}
    </span>
  );
}

function RefusalPanel({
  findings,
  watching,
}: {
  readonly findings: readonly Finding[] | null;
  readonly watching: boolean;
}): React.JSX.Element {
  if (watching) {
    // The run's own graph text could not be loaded. Said rather than papered over: the
    // alternative is drawing the author's canvas and calling it the run's picture.
    return (
      <div className="refusal">
        <h2>The version this run is walking could not be drawn</h2>
        <p>
          The run announced a graph DSpatch could not load, so there is nothing here that
          would honestly be called the graph that is running. The journal below is still
          this run's own history. Leave the run view to go back to your drawing; the run is
          not affected either way.
        </p>
      </div>
    );
  }
  if (findings === null) {
    return (
      <div className="refusal">
        <h2>No graph open</h2>
        <p>Open our development loop, or a graph file of your own.</p>
      </div>
    );
  }
  return (
    <div className="refusal">
      <h2>Refused, not partially loaded</h2>
      <p>
        A half-loaded graph would draw a picture that is not the file. Nothing was opened.
      </p>
      <ul>
        {findings.map((finding, position) => (
          <li key={`${finding.code}-${String(position)}`} className={`finding finding-${finding.severity}`}>
            <code>{finding.code}</code> {finding.message}
            <span className="pointer">{finding.pointer}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function centreOf(node: LoopNode): { readonly x: number; readonly y: number } {
  return boxCentre(nodeBox(node.view));
}

function EdgeShape({
  edge,
  graph,
  selected,
  highlighted,
  showLabel,
  taken,
  severity,
  onSelect,
}: {
  readonly edge: LoopEdge;
  readonly graph: LoopGraph;
  readonly selected: boolean;
  readonly highlighted: boolean;
  readonly showLabel: boolean;
  readonly taken: boolean;
  readonly severity: Finding['severity'] | null;
  readonly onSelect: () => void;
}): React.JSX.Element | null {
  const source = nodeById(graph, edge.from);
  const target = nodeById(graph, edge.to);
  if (source === null || target === null) {
    return null;
  }
  const a = centreOf(source);
  const b = centreOf(target);
  const sourceBox = nodeBox(source.view);
  const targetBox = nodeBox(target.view);

  // Parallel edges are bowed apart so two arrows between the same pair stay two.
  const siblings = graph.edges.filter(
    (other) =>
      (other.from === edge.from && other.to === edge.to) ||
      (other.from === edge.to && other.to === edge.from),
  );
  const position = siblings.findIndex((other) => other.id === edge.id);
  const spread = (position - (siblings.length - 1) / 2) * 30;
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const control = {
    x: (a.x + b.x) / 2 + normal.x * spread,
    y: (a.y + b.y) / 2 + normal.y * spread,
  };

  const start = attachPoint(control, sourceBox);
  const end = attachPoint(control, targetBox);
  const failure = edge.when.on === 'declared-failure';
  const midpoint = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };

  const classes = [
    'edge',
    failure ? 'edge-failure' : edge.when.on === 'outcome' ? 'edge-outcome' : 'edge-success',
    selected ? 'edge-selected' : '',
    highlighted ? 'edge-highlighted' : '',
    taken ? 'edge-taken' : '',
    severity === null ? '' : `edge-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  const text =
    edge.label ??
    (edge.when.on === 'outcome'
      ? edge.when.outcome
      : edge.when.on === 'declared-failure'
        ? edge.when.failure
        : 'success');

  return (
    <g
      className={classes}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <path
        d={`M ${String(start.x)} ${String(start.y)} Q ${String(control.x)} ${String(control.y)} ${String(end.x)} ${String(end.y)}`}
        markerEnd={failure ? 'url(#arrow-failure)' : 'url(#arrow)'}
      />
      <path
        className="edge-hit"
        d={`M ${String(start.x)} ${String(start.y)} Q ${String(control.x)} ${String(control.y)} ${String(end.x)} ${String(end.y)}`}
      />
      <circle className="edge-dot" cx={start.x} cy={start.y} r={ANCHOR_DOT_RADIUS} />
      <circle className="edge-dot" cx={end.x} cy={end.y} r={ANCHOR_DOT_RADIUS} />
      {showLabel || selected || highlighted ? (
        <text x={midpoint.x} y={midpoint.y - 4} className="edge-label">
          {text}
        </text>
      ) : null}
    </g>
  );
}

function NodeShape({
  node,
  role,
  isEntry,
  selected,
  connecting,
  runState,
  severity,
  helpTitle,
  onMouseDown,
}: {
  readonly node: LoopNode;
  readonly role: ResolvedRole | null;
  readonly isEntry: boolean;
  readonly selected: boolean;
  readonly connecting: boolean;
  readonly runState: NodeRunState;
  readonly severity: Finding['severity'] | null;
  readonly helpTitle?: string;
  readonly onMouseDown: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  const x = node.view?.x ?? 0;
  const y = node.view?.y ?? 0;
  const mark = NODE_RUN_STATE_MARKS[runState];
  const classes = [
    'node',
    `kind-${node.kind}`,
    selected ? 'node-selected' : '',
    connecting ? 'node-connecting' : '',
    runState === 'not-reached' ? '' : 'node-on-path',
    mark.className,
    severity === null ? '' : `node-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  const broken = node.role !== undefined && role === null;

  return (
    <g
      className={classes}
      transform={`translate(${String(x)} ${String(y)})`}
      onMouseDown={onMouseDown}
      // Selection happens on mousedown, and the click that follows would otherwise
      // reach the canvas and clear it again — which made a node impossible to select
      // and was found by clicking one.
      onClick={(event) => event.stopPropagation()}
    >
      {/*
        The run state is the first thing the accessibility tree should reach, and it is
        a title rather than only a colour because DSP-28 #3 asks for states that are
        distinguishable when the animation is absent, ignored or unwanted.
      */}
      {runState === 'not-reached' ? (
        helpTitle === undefined ? null : (
          <title>{helpTitle}</title>
        )
      ) : (
        <title>{`${node.label ?? node.id}: ${mark.label}${helpTitle === undefined ? '' : ` — ${helpTitle}`}`}</title>
      )}
      {node.kind === 'router' ? (
        <polygon
          points={`${String(NODE_WIDTH / 2)},0 ${String(NODE_WIDTH)},${String(NODE_HEIGHT / 2)} ${String(NODE_WIDTH / 2)},${String(NODE_HEIGHT)} 0,${String(NODE_HEIGHT / 2)}`}
          className="node-body"
        />
      ) : (
        <rect
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx={node.kind === 'terminal' ? NODE_HEIGHT / 2 : node.kind === 'human' ? 14 : 6}
          className="node-body"
        />
      )}
      <text x={NODE_WIDTH / 2} y={21} className="node-label">
        {truncate(node.label ?? node.id, 24)}
      </text>
      <text x={NODE_WIDTH / 2} y={38} className="node-kind">
        {node.kind}
        {node.role === undefined ? '' : broken ? ' · role broken' : ` · ${node.role.id}`}
      </text>
      {isEntry ? (
        <text x={6} y={NODE_HEIGHT - 5} className="node-entry">
          entry
        </text>
      ) : null}
      {/*
        A word, not only a border and never only a pulse. "running" and "done" are told
        apart here by reading, which is the whole of the accessibility clause: motion may
        add emphasis to the active node and carries no meaning by itself.
      */}
      {mark.mark === '' ? null : (
        <text x={NODE_WIDTH - 6} y={NODE_HEIGHT - 5} className="node-run-mark" textAnchor="end">
          {mark.mark}
        </text>
      )}
      {severity === null ? null : <circle cx={NODE_WIDTH - 9} cy={9} r={4} className="node-mark" />}
    </g>
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/** A field the runner does not honour yet says so, rather than implying it works. */
function Unhonoured({ attribute }: { readonly attribute: string }): React.JSX.Element | null {
  const support = attributeSupport(attribute);
  if (support === null || support.honoured) {
    return null;
  }
  return (
    <span className="unhonoured" title={`Nothing honours this yet. Waiting on: ${support.by}`}>
      not honoured yet · {support.by}
    </span>
  );
}

function FindingList({ findings }: { readonly findings: readonly Finding[] }): React.JSX.Element | null {
  if (findings.length === 0) {
    return null;
  }
  return (
    <ul className="findings">
      {findings.map((finding, position) => (
        <li
          key={`${finding.code}-${String(position)}`}
          className={`finding finding-${isDraftFinding(finding) ? 'draft' : finding.severity}`}
        >
          <code>{finding.code}</code> {finding.message}
        </li>
      ))}
    </ul>
  );
}

function NodeInspector({
  graph,
  node,
  role,
  findings,
  help,
  onChange,
  onDelete,
}: {
  readonly graph: LoopGraph;
  readonly node: LoopNode;
  readonly role: ResolvedRole | null;
  readonly findings: readonly Finding[];
  readonly help: boolean;
  readonly onChange: (next: LoopNode) => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const model: ModelPolicy = node.model ?? { policy: 'inherit' };
  return (
    <div className="inspector">
      <h2>
        {KIND_LABELS[node.kind]} · <code>{node.id}</code>
      </h2>
      <FindingList findings={findings} />

      <label>
        Label
        <input value={node.label ?? ''} onChange={(event) => onChange({ ...node, label: event.target.value })} />
      </label>
      <label>
        Id
        <input value={node.id} onChange={(event) => onChange({ ...node, id: event.target.value })} />
      </label>
      <label title={help ? nodeHelpText(node) : undefined}>
        Purpose
        <textarea
          rows={3}
          value={node.purpose ?? ''}
          onChange={(event) => onChange({ ...node, purpose: event.target.value || undefined })}
        />
      </label>
      <label>
        Kind
        <select value={node.kind} onChange={(event) => onChange({ ...node, kind: event.target.value as NodeKind })}>
          {NODE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>

      {node.kind === 'agent' || node.kind === 'gate' || node.kind === 'external' ? (
        <fieldset>
          <legend>
            Role description
            {node.role === undefined ? null : role === null ? (
              <span className="broken">resolves to nothing</span>
            ) : (
              <span className="resolved">resolved</span>
            )}
          </legend>
          {node.role === undefined ? (
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...node,
                  role: { id: node.id, source: { kind: 'cursor-agent-file', path: `.cursor/agents/${node.id}.md` } },
                })
              }
            >
              Bind a role
            </button>
          ) : (
            <>
              <label>
                Role id
                <input
                  value={node.role.id}
                  onChange={(event) =>
                    onChange({ ...node, role: { ...node.role!, id: event.target.value } })
                  }
                />
              </label>
              <label>
                Source
                <select
                  value={node.role.source.kind}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      role: {
                        ...node.role!,
                        source: { ...node.role!.source, kind: event.target.value as typeof ROLE_SOURCE_KINDS[number] },
                      },
                    })
                  }
                >
                  {ROLE_SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Path, from the project root
                <input
                  value={node.role.source.path}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      role: { ...node.role!, source: { ...node.role!.source, path: event.target.value } },
                    })
                  }
                />
              </label>
              {role === null ? (
                <p className="broken-note">
                  Nothing was found there. An agent with no description is an agent that will be
                  handed whatever the runner happens to have.
                </p>
              ) : (
                <p className="muted">
                  Supports {role.targets.join(', ')}
                  {role.targetsDeclared ? '' : ' (inferred from the kind of file, not declared)'}.
                  {role.requirements.length === 0
                    ? ' Requires nothing.'
                    : ` Requires ${role.requirements.join(', ')}${role.requirementsDeclared ? '' : ' (read backwards from Cursor’s own fields)'}.`}
                </p>
              )}
            </>
          )}
        </fieldset>
      ) : null}

      <fieldset>
        <legend>
          Model <Unhonoured attribute="model" />
        </legend>
        <label>
          Policy
          <select
            value={model.policy}
            onChange={(event) =>
              onChange({ ...node, model: { ...model, policy: event.target.value as ModelPolicy['policy'] } })
            }
          >
            <option value="inherit">inherit — whatever the runner is using</option>
            <option value="fixed">fixed — one named model</option>
            <option value="described">described — how to choose, for a person to apply</option>
          </select>
        </label>
        {model.policy === 'fixed' ? (
          <label>
            Model, as the target names it
            <input
              value={model.model ?? ''}
              onChange={(event) => onChange({ ...node, model: { ...model, model: event.target.value } })}
            />
          </label>
        ) : null}
        {model.policy === 'described' ? (
          <label>
            What should decide — the sizes this step may use for work of different size or complexity
            <textarea
              rows={3}
              value={model.description ?? ''}
              onChange={(event) => onChange({ ...node, model: { ...model, description: event.target.value } })}
            />
          </label>
        ) : null}
        <p className="muted">
          The format records a model <em>policy</em>, not a list of sizes: <code>described</code> is
          where alternative sizes for work of different complexity are written down, because DSP-8 has
          not decided how that choice is made.
        </p>
      </fieldset>

      <fieldset>
        <legend>
          Limits <Unhonoured attribute="limits" />
        </legend>
        {(['maxCalls', 'maxReworkRounds', 'maxMinutes', 'maxTasks'] as const).map((key) => (
          <label key={key}>
            {key}
            <input
              type="number"
              value={node.limits?.[key] ?? ''}
              onChange={(event) =>
                onChange({
                  ...node,
                  limits: {
                    ...node.limits,
                    [key]: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
        <label>
          note
          <textarea
            rows={2}
            value={node.limits?.note ?? ''}
            onChange={(event) =>
              onChange({ ...node, limits: { ...node.limits, note: event.target.value || undefined } })
            }
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>
          Requirements <Unhonoured attribute="requirements" />
        </legend>
        {REQUIREMENTS.map((requirement) => (
          <label key={requirement} className="check">
            <input
              type="checkbox"
              checked={(node.requirements ?? []).includes(requirement)}
              onChange={(event) =>
                onChange({
                  ...node,
                  requirements: event.target.checked
                    ? [...(node.requirements ?? []), requirement]
                    : (node.requirements ?? []).filter((entry) => entry !== requirement),
                })
              }
            />
            {requirement}
          </label>
        ))}
      </fieldset>

      <label>
        Outcomes, comma separated
        <input
          value={(node.outcomes ?? []).join(', ')}
          onChange={(event) =>
            onChange({
              ...node,
              outcomes: splitList(event.target.value),
            })
          }
        />
      </label>
      <p className="muted">
        A node that declares outcomes routes only on them and may not also leave on plain success.
        Each one needs an edge before the graph can be saved.
      </p>

      <fieldset>
        <legend>Declared failures</legend>
        {graph.failureKinds.length === 0 ? (
          <p className="muted">This graph declares no failure kinds yet.</p>
        ) : (
          graph.failureKinds.map((kind) => (
            <label key={kind.id} className="check" title={kind.meaning}>
              <input
                type="checkbox"
                checked={(node.declaredFailures ?? []).includes(kind.id)}
                onChange={(event) =>
                  onChange({
                    ...node,
                    declaredFailures: event.target.checked
                      ? [...(node.declaredFailures ?? []), kind.id]
                      : (node.declaredFailures ?? []).filter((entry) => entry !== kind.id),
                  })
                }
              />
              {kind.id} — {kind.label}
            </label>
          ))
        )}
      </fieldset>

      <label>
        Report written by <Unhonoured attribute="report" />
        <select
          value={node.report?.writtenBy ?? ''}
          onChange={(event) =>
            onChange({
              ...node,
              report: event.target.value === '' ? undefined : { ...node.report, writtenBy: event.target.value },
            })
          }
        >
          <option value="">not set</option>
          <option value="self">self</option>
          {graph.nodes
            .filter((other) => other.id !== node.id)
            .map((other) => (
              <option key={other.id} value={other.id}>
                {other.id}
              </option>
            ))}
        </select>
      </label>

      <label>
        Notes
        <textarea
          rows={3}
          value={node.notes ?? ''}
          onChange={(event) => onChange({ ...node, notes: event.target.value || undefined })}
        />
      </label>

      <p className="muted">
        Drawn at x {String(node.view?.x ?? 0)}, y {String(node.view?.y ?? 0)}. Presentation only — it
        never affects meaning, and it is saved so the arrangement survives.
      </p>

      <button type="button" className="danger" onClick={onDelete}>
        Delete this node and its edges
      </button>
    </div>
  );
}

function splitList(value: string): readonly string[] | undefined {
  const parts = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return parts.length === 0 ? undefined : parts;
}

function EdgeInspector({
  graph,
  edge,
  findings,
  onChange,
  onDelete,
}: {
  readonly graph: LoopGraph;
  readonly edge: LoopEdge;
  readonly findings: readonly Finding[];
  readonly onChange: (next: LoopEdge) => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const source = nodeById(graph, edge.from);
  return (
    <div className="inspector">
      <h2>
        Connection · <code>{edge.id}</code>
      </h2>
      <FindingList findings={findings} />

      <label>
        From
        <select value={edge.from} onChange={(event) => onChange({ ...edge, from: event.target.value })}>
          {graph.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label ?? node.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        To
        <select value={edge.to} onChange={(event) => onChange({ ...edge, to: event.target.value })}>
          {graph.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label ?? node.id}
            </option>
          ))}
        </select>
      </label>

      <label>
        Taken when
        <select
          value={edge.when.on}
          onChange={(event) => {
            const on = event.target.value;
            if (on === 'success') {
              onChange({ ...edge, when: { on: 'success' } });
            } else if (on === 'outcome') {
              onChange({ ...edge, when: { on: 'outcome', outcome: (source?.outcomes ?? [''])[0] ?? '' } });
            } else {
              onChange({
                ...edge,
                when: {
                  on: 'declared-failure',
                  failure: (source?.declaredFailures ?? graph.failureKinds.map((k) => k.id))[0] ?? '',
                },
              });
            }
          }}
        >
          <option value="success">success — the step finished normally</option>
          <option value="outcome">outcome — a named branch or verdict</option>
          <option value="declared-failure">declared failure — the dashed arrow</option>
        </select>
      </label>

      {edge.when.on === 'outcome' ? (
        <label>
          Outcome
          <select
            value={edge.when.outcome}
            onChange={(event) => onChange({ ...edge, when: { on: 'outcome', outcome: event.target.value } })}
          >
            {(source?.outcomes ?? []).map((outcome) => (
              <option key={outcome} value={outcome}>
                {outcome}
              </option>
            ))}
            {(source?.outcomes ?? []).includes(edge.when.outcome) ? null : (
              <option value={edge.when.outcome}>{edge.when.outcome} — not declared by the source</option>
            )}
          </select>
        </label>
      ) : null}

      {edge.when.on === 'declared-failure' ? (
        <label>
          Failure
          <select
            value={edge.when.failure}
            onChange={(event) =>
              onChange({ ...edge, when: { on: 'declared-failure', failure: event.target.value } })
            }
          >
            {graph.failureKinds.map((kind) => (
              <option key={kind.id} value={kind.id}>
                {kind.id} — {kind.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label>
        Label on the arrow
        <input value={edge.label ?? ''} onChange={(event) => onChange({ ...edge, label: event.target.value || undefined })} />
      </label>
      <label>
        Notes
        <textarea
          rows={3}
          value={edge.notes ?? ''}
          onChange={(event) => onChange({ ...edge, notes: event.target.value || undefined })}
        />
      </label>

      <p className="muted">
        There is no fourth condition. A call that hangs, a report that never arrives or a dead
        process is the runner's concern and is deliberately not drawable.
      </p>

      <button type="button" className="danger" onClick={onDelete}>
        Delete this connection
      </button>
    </div>
  );
}

function GraphInspector({
  graph,
  findings,
  connectedTargets,
  onChange,
  onSelect,
}: {
  readonly graph: LoopGraph;
  readonly findings: readonly Finding[];
  readonly connectedTargets: readonly LoopTarget[] | null;
  readonly onChange: (next: LoopGraph) => void;
  readonly onSelect: (selection: Selection) => void;
}): React.JSX.Element {
  const groups = groupFindings(findings);
  const here = runnableHere(graph, connectedTargets);
  return (
    <div className="inspector">
      <h2>The graph</h2>
      <label>
        Name
        <input value={graph.name} onChange={(event) => onChange({ ...graph, name: event.target.value })} />
      </label>
      <label>
        Id
        <input value={graph.id} onChange={(event) => onChange({ ...graph, id: event.target.value })} />
      </label>
      <label>
        Purpose — what kind of work this loop is for
        <textarea
          rows={4}
          value={graph.purpose}
          onChange={(event) => onChange({ ...graph, purpose: event.target.value })}
        />
      </label>
      <label>
        Entry
        <select value={graph.entry} onChange={(event) => onChange({ ...graph, entry: event.target.value })}>
          {graph.nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.label ?? node.id}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        Target <strong>{graph.target}</strong>, stored in the file. {here.reason}
      </p>
      <p className="muted">
        On a runtime fault: <strong>{graph.onRuntimeFault}</strong> <Unhonoured attribute="onRuntimeFault" />
      </p>

      <fieldset>
        <legend>
          Run limits <Unhonoured attribute="limits" />
        </legend>
        {(['maxTasks', 'maxCalls', 'maxReworkRounds', 'maxMinutes'] as const).map((key) => (
          <label key={key}>
            {key}
            <input
              type="number"
              value={graph.limits?.[key] ?? ''}
              onChange={(event) =>
                onChange({
                  ...graph,
                  limits: {
                    ...graph.limits,
                    [key]: event.target.value === '' ? undefined : Number(event.target.value),
                  },
                })
              }
            />
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Failure kinds this loop routes on</legend>
        {graph.failureKinds.map((kind) => (
          <p key={kind.id} className="muted">
            <code>{kind.id}</code> — {kind.label}
          </p>
        ))}
      </fieldset>

      <h3>Findings, grouped by rule</h3>
      {groups.length === 0 ? (
        <p className="muted">Nothing to report.</p>
      ) : (
        <ul className="findings">
          {groups.map((group) => (
            <li key={group.code} className={`finding finding-${group.severity}`}>
              <code>{group.code}</code> ×{String(group.count)} {group.message}
              {group.objects.length === 0 ? null : (
                <span className="objects">
                  {group.objects.map((object) => (
                    <button
                      key={object}
                      type="button"
                      onClick={() =>
                        onSelect({
                          kind: graph.nodes.some((node) => node.id === object) ? 'node' : 'edge',
                          id: object,
                        })
                      }
                    >
                      {object}
                    </button>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>What nothing honours yet</h3>
      <ul className="findings">
        {ATTRIBUTE_SUPPORT.filter((entry) => !entry.honoured).map((entry) => (
          <li key={entry.attribute} className="finding finding-notice">
            <code>{entry.attribute}</code> waits on {entry.by}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TargetChangeDialog({
  graph,
  to,
  report,
  onCancel,
  onApply,
}: {
  readonly graph: LoopGraph;
  readonly to: LoopTarget;
  readonly report: TargetChangeReport;
  readonly onCancel: () => void;
  readonly onApply: () => void;
}): React.JSX.Element {
  const section = (title: string, entries: readonly string[]): React.JSX.Element | null =>
    entries.length === 0 ? null : (
      <>
        <h3>{title}</h3>
        <ul>
          {entries.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </>
    );

  return (
    <div className="dialog-backdrop">
      <div className="dialog">
        <h2>
          Change target from {graph.target} to {to}?
        </h2>
        <p>
          This report is all that happens until you apply it. Nothing is removed either way: no node
          is dropped and no requirement is deleted, even where {to} cannot meet it.
        </p>
        {section('Stops being enforced', report.losses)}
        {section('Newly enforced', report.gains)}
        {section('Nobody has established', report.unknowns)}
        {section('Cannot be met at all — the graph would be invalid', report.blocking)}
        {report.rolesChecked
          ? section('Roles with no form for the new target', report.rolesWithoutSupport)
          : null}
        {report.losses.length === 0 &&
        report.gains.length === 0 &&
        report.unknowns.length === 0 &&
        report.blocking.length === 0 &&
        report.rolesWithoutSupport.length === 0 ? (
          <p>Nothing changes about the requirements this graph uses.</p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Keep {graph.target}
          </button>
          <button type="button" onClick={onApply}>
            Set the target to {to}
          </button>
        </div>
      </div>
    </div>
  );
}
