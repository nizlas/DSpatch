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
  describeRunToolPolicy,
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
import { describeOpenedGraph } from '../shared/loop-editor-open';
import {
  describeChoiceMade,
  describeChoiceRefused,
  describeLoopChooser,
  describeUnsavedAgainstChoice,
  nextMandateLoopFrom,
} from '../shared/loop-choice-view';
import type {
  LoopDefinitionListing,
  LoopGraphOpenRequest,
  OpenedLoopDefinition,
} from '../shared/bridge';
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
import { LoopControlBar, useLoopControl } from './LoopControlBar';
import { controlPhase } from '../shared/loop-control';
import {
  NODE_RUN_STATE_MARKS,
  UNVERSIONED_CANVAS,
  applyRunEvent,
  describePinnedDrawing,
  edgesTakenIn,
  endingMarkFor,
  finishedMarksBelongTo,
  finishedRunMarksFrom,
  markedNodes,
  nodeIsWorking,
  nodeRunStateFor,
  runViewFor,
  runViewState,
  viewIsLocked,
  viewIsReady,
  type EndingMark,
  type FinishedRunMarks,
  type LiveRunAnnouncement,
  type LoopRunEvent,
  type NodeRunState,
  type PinnedDrawingCheck,
  type RunView,
} from '../shared/loop-run-view';
import { runningStep, stepStanding } from '../shared/loop-activity';
import { BRIEF_EXCLUSIONS, briefParts, nodeHelpText, requiredForKind } from '../shared/loop-chat';
import {
  failureStandings,
  kindEffect,
  limitHelp,
  limitStandings,
  outcomeStandings,
  requirementStandings,
  undeclaredStanding,
  LIMIT_KEYS,
} from '../shared/loop-node-help';
import { Markdown } from './Markdown';
import {
  ANCHOR_DOT_RADIUS,
  GLINT_PATH_LENGTH,
  GLINT_TOTAL_LENGTH,
  glintSegments,
  NODE_HEIGHT,
  NODE_WIDTH,
  attachPoint,
  boxCentre,
  nodeBox,
  nodeCornerRadius,
  nodeOutlinePath,
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
  /** The graph, which is what Save writes to — never the declaration that names it. */
  readonly path: string;
  readonly displayPath: string;
  readonly newline: '\n' | '\r\n';
  readonly projectRoot: string;
  /** The loop this graph was reached through, or `null` for a graph opened directly. */
  readonly definition: OpenedLoopDefinition | null;
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
  const [note, setNote] = useState('Choosing a loop above draws it here.');
  /**
   * The loops that can be chosen, and which one is — the main process's answer.
   *
   * DSP-84's one-source constraint sits in this one decision, and DSP-85 made it the
   * whole of the chooser. The editor could easily have kept a selection of its own and
   * shown that, and it would have been right until the moment something else chose. So
   * there is no editor-side selection at all: this is `listLoopDefinitions`' answer,
   * re-read whenever the workspace announces itself, the `<select>`'s value is the row it
   * marks `preselected`, and picking a row asks the main process to change that.
   *
   * That is why the dropdown can be the statement of what runs rather than a control
   * beside one — it is displaying the stored choice, not a copy of it.
   */
  const [loopChoices, setLoopChoices] = useState<LoopDefinitionListing | null>(null);
  const [choosing, setChoosing] = useState(false);
  /**
   * Why the last choice did not take, beside the chooser that refused it (DSP-85 #8).
   *
   * Only ever a refusal. A choice that succeeded needs no sentence: the dropdown is
   * showing it and the canvas is drawing it, and a line saying so as well is the third
   * way of saying one thing that this card exists to remove. `null` the rest of the time.
   */
  const [choiceError, setChoiceError] = useState<string | null>(null);
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
  /**
   * Where the last run got to, kept after the run itself has gone (DSP-36).
   *
   * The second piece of run state in this file, and the reason there has to be one is a
   * thing report 024 left open: the stand-by offer that puts the Ready pulse back
   * *replaces* `watch` the instant a run ends, and a ready view marks the entry step and
   * nothing else — so the run's ending was on screen for as long as it took the main
   * process to answer. Niclas asked to see both at once, a finished run and a loop ready
   * for the next assignment, and both being true at once is what needs two values.
   *
   * It is not a second opinion about the run. It is the *same* fold, taken once at the
   * moment the run ended and then held: `finishedRunMarksFrom` calls `nodeRunStates` and
   * adds nothing. Set when an `ended` event arrives, replaced when the next run starts,
   * and withheld at render time when the drawing on screen is not the one it belongs to.
   */
  const [finishedMarks, setFinishedMarks] = useState<FinishedRunMarks | null>(null);
  /**
   * The clock, for the one line that has to say how long a step has been quiet.
   *
   * A second of state rather than a `Date.now()` in the render, because a component
   * that reads the clock without re-rendering shows the time it first mounted — and a
   * status line that freezes at "last update just now" is worse than no line at all.
   * It ticks only while a run is being watched.
   */
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** Who decides the next work step. The same report the chat window reads. */
  const loopControl = useLoopControl();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * The drawing and the run's pinned version, for the one thing that reads them from
   * inside an event handler (DSP-36).
   *
   * Refs rather than closed-over values, and the reason they are safe is DSP-86's lock:
   * **editing is locked while a run walks**, so neither the graph on the canvas nor the
   * bytes the run pinned can move between a run starting and that run ending. A ref set
   * on the render before therefore holds exactly what the moment of ending needs.
   *
   * The alternative — a handler that closed over both and resubscribed whenever either
   * changed — would put the ending mark's correctness at the mercy of when a resubscribe
   * happened to land, which is a worse thing to depend on than a lock the product already
   * guarantees and a trial already measures.
   */
  const graphRef = useRef<LoopGraph | null>(null);
  const pinnedTextRef = useRef<string | null>(null);
  /**
   * The run fold itself, beside the state that renders it.
   *
   * `setWatch` takes the value rather than an updater everywhere now, because one event
   * — `ended` — has to produce *two* pieces of state from one fold, and a functional
   * updater cannot hand its result to a second setter. Holding the fold here and mirroring
   * it into state keeps one derivation: `receiveRunEvent` is the only thing that writes
   * either, the live run and the dry run both go through it, and there is no second
   * opinion for them to disagree about.
   */
  const runFoldRef = useRef<RunView | null>(null);

  /**
   * One run event in, and everything this window holds about the run out.
   *
   * **`started` is the only event that changes which run is watched**, unchanged from
   * DSP-28. What DSP-36 adds is the two lines below it: a run *beginning* clears the last
   * run's ending mark, and a stand-by offer does not. That asymmetry is the whole of
   * criteria #6 and #7 — the offer is what puts the Ready pulse back, so if it cleared
   * the mark there would be no moment at which a person could see a finished run and a
   * ready loop together, which is the state Niclas asked for.
   *
   * The ending mark is taken **here**, synchronously, and not in an effect watching
   * `watch.ended`. `runAudience.end` and `offerReadyAgainAfterRun` fire one after the
   * other in the same `finally`, so an effect would be relying on React rendering between
   * two IPC messages to observe the ended view at all — and the one it would miss is the
   * one the card is about.
   */
  const receiveRunEvent = useCallback((event: LoopRunEvent): void => {
    if (event.kind === 'started') {
      if ((event.run.phase ?? 'running') !== 'ready') {
        setFinishedMarks(null);
      }
      const adopted = runViewFor(event.run);
      runFoldRef.current = adopted;
      setWatch(adopted);
      setWatchNote(null);
      return;
    }
    const next = applyRunEvent(runFoldRef.current, event);
    if (next === runFoldRef.current) {
      // Not addressed to this run, or a fold that changed nothing. `applyRunEvent`
      // returns the same object for both, which is a property worth honouring rather
      // than re-rendering over.
      return;
    }
    runFoldRef.current = next;
    setWatch(next);
    if (event.kind === 'ended' && next !== null) {
      const marks = finishedRunMarksFrom(next, graphRef.current, pinnedTextRef.current);
      if (marks !== null) {
        setFinishedMarks(marks);
      }
    }
  }, []);

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

  /**
   * Re-read the loops on offer and which one is chosen.
   *
   * The whole of the editor's knowledge of the selection, and it is a read: one
   * directory listed per open folder in the main process, nothing started, nothing
   * written.
   */
  const readLoopChoices = useCallback(async (): Promise<void> => {
    try {
      setLoopChoices(await window.dspatch.listLoopDefinitions());
    } catch {
      /* A list that cannot be read leaves the last answer alone rather than inventing one. */
    }
  }, []);

  /*
   * Once on mount, and then whenever the workspace announces itself.
   *
   * `WorkspaceView` already carries `loopDefinitionKey`, and `noteChosenLoopDefinition`
   * is the one place it changes — so every way of choosing a loop arrives here, including
   * a second editor window's. That is why this editor has no selection of its own to
   * drift. Since DSP-85 it is also how a folder added to the workspace puts its loops in
   * this dropdown without a reload.
   */
  useEffect(() => {
    void readLoopChoices();
    return window.dspatch.onWorkspaceFolders(() => {
      void readLoopChoices();
    });
  }, [readLoopChoices]);

  /**
   * Which loop the next mandate walks, read off the row the listing marks.
   *
   * `nextMandateLoopFrom` with no key of our own, which is the one-source constraint as
   * a function: `preselected` is `defaultChoiceFrom`'s answer including the workspace's
   * remembered key, and that is the same answer a mandate sent with no explicit key
   * resolves. So this cannot drift from what would run.
   */
  const chosenLoop = useMemo(() => nextMandateLoopFrom(loopChoices), [loopChoices]);

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

  /*
   * DSP-84's `openedByHand` is gone, and its problem with it.
   *
   * That ref decided whether a **stand-by** announcement was allowed to take the canvas.
   * It had to exist because adopting an announcement meant redrawing: ticking `Use loop`
   * in the chat replaced whatever a person had deliberately opened here, which is the
   * "view changed graph under him" half of what Niclas met.
   *
   * DSP-86 removes the premise rather than the symptom. Adopting an announcement no
   * longer redraws anything — the canvas is the author's drawing, before, during and
   * after — so there is nothing for an offer to take and no reason to refuse one. That
   * matters beyond tidiness: the guard was also what would have swallowed the Ready
   * pulse when it came back after a run (#6), because a person who chose a loop in this
   * window has `openedByHand` set for the rest of the session.
   */
  /** What is being watched, readable from a callback that must not depend on it. */
  const watchRef = useRef<RunView | null>(null);

  /**
   * Draw a graph, a definition's graph, or the chosen loop's, and say what was drawn.
   *
   * `lead` is a sentence the caller wants in front of whatever this has to report about
   * the file. DSP-85 gave it one caller: choosing a loop draws it, and the status line
   * then has to say both that the choice took and what the drawing is. Passing the
   * sentence in rather than having the caller `setNote` afterwards is what keeps the two
   * halves in one line instead of one overwriting the other.
   */
  const open = useCallback(async (request: LoopGraphOpenRequest, lead = '') => {
    const preamble = lead === '' ? '' : `${lead} `;
    const outcome = await window.dspatch.openLoopGraph(request);
    if (outcome.kind === 'cancelled') {
      return;
    }
    if (outcome.kind === 'unavailable') {
      setNote(`${preamble}${outcome.note}`);
      return;
    }
    const roleMap = new Map<string, ResolvedRole | null>(
      outcome.roles.map((entry) => [entry.key, entry.role]),
    );
    const loaded = loadLoopGraph(outcome.text, {
      resolveRole: resolverFromEntries(roleMap),
      connectedTargets,
    });
    const described = describeOpenedGraph({
      displayPath: outcome.displayPath,
      definition: outcome.definition ?? null,
    });
    /*
     * Opening a file does not take a run off screen, and does not need to.
     *
     * This used to clear `watch` — the run's announcement — because the canvas *was*
     * the run's drawing while one was on screen, so opening a file and watching a run
     * were two things competing for the same space. DSP-86 removed the competition:
     * the canvas is always the author's drawing now, and `watch` is the run's identity
     * and journal, which decide the marks rather than the picture. A run keeps walking,
     * the file opens, and if the two are not the same drawing the window says so
     * (`pinnedDrawing` below) instead of one of them having to lose.
     */
    setRoles(roleMap);
    setFile({
      // The graph's path, which for a definition is the graph the declaration points
      // at. Save writes here and nowhere else (DSP-82 #4).
      path: outcome.path,
      displayPath: outcome.displayPath,
      newline: outcome.newline,
      projectRoot: outcome.projectRoot,
      definition: outcome.definition ?? null,
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
      setNote(
        `${preamble}${described.opened} It was refused: ${String(loaded.findings.length)} findings, and no graph was loaded.`,
      );
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
      `${preamble}${described.opened} ${String(laidOut.graph.nodes.length)} nodes, ${String(laidOut.graph.edges.length)} edges.` +
        (laidOut.placed.length === 0
          ? ''
          : ` ${String(laidOut.placed.length)} of them had no saved position and ${laidOut.placed.length === 1 ? 'was' : 'were'} placed on a grid; arrange them and save to keep it.`) +
        ` ${loaded.runnable.reason}`,
    );
  }, [connectedTargets]);

  /**
   * Choose a loop and draw it. One act, which is the whole of DSP-85.
   *
   * DSP-84 kept opening and choosing apart on the ground that looking at a loop is not
   * committing to it, and gave the editor a separate `Use this loop` for the second half.
   * Niclas tried that and found too many ways to say one thing: the chat had a dropdown,
   * the editor had a button, and four controls existed only because drawing and choosing
   * were different acts. So they are one act, in one place — this function, reached from
   * the dropdown and from **Open loop…**.
   *
   * `definitionPath` is `null` for **Open loop…**, which asks the main process for a file
   * chooser. Both ways go through one handler, so a definition reached from file is
   * judged, listed and recorded exactly as one picked from the dropdown.
   *
   * **The order matters and is deliberate: choose first, draw second.** A refusal must
   * leave both the selection *and* the canvas as they were — drawing a loop that was not
   * chosen is the "view changed graph under him" half of what Niclas met, and doing it in
   * the name of explaining a refusal would be the same defect with better manners. The
   * reason goes beside the chooser instead, short, and the findings are on the canvas for
   * anyone who opens the file.
   *
   * This holds no key of its own. `outcome.listing` is the main process's fresh answer,
   * and `chosenLoop` is read back off the row it marks.
   */
  const chooseLoop = useCallback(
    async (definitionPath: string | null): Promise<'switched' | 'unchanged'> => {
      setChoosing(true);
      try {
        const outcome = await window.dspatch.chooseLoopDefinition(definitionPath);
        if (outcome.kind === 'cancelled') {
          /*
           * Two cancellations, and only one of them has anything to say (DSP-88).
           *
           * A dismissed file chooser is a person closing a dialog they opened, and a
           * window that narrated it would be noise. A cancel at the unsaved-drawing
           * question is a deliberate *no* to a switch, and the note is the main process's
           * own account of it: the drawing is still here and the selection has not moved.
           */
          if (outcome.note !== null) {
            setNote(outcome.note);
          }
          return 'unchanged';
        }
        if (outcome.kind === 'refused') {
          /*
           * Nothing drawn, nothing selected, and the sentence says both. `chosenLoop` is
           * still the previous answer because the listing has not been replaced, so the
           * dropdown goes on showing it — which is DSP-85 #8's "plainly visible".
           *
           * In two registers, and they are not two voices. The chip sits at the chooser and
           * says *which control refused*; the status line at the foot of the window carries
           * the reason, because a reason a person has to hover to read is a reason they may
           * not read. The chip's hover is the same string, for anyone who starts there.
           */
          const reason = describeChoiceRefused({ note: outcome.note, stillChosen: chosenLoop });
          setChoiceError(reason);
          setNote(reason);
          return 'unchanged';
        }
        setChoiceError(null);
        setLoopChoices(outcome.listing);
        await open(
          { kind: 'definition', path: outcome.key },
          describeChoiceMade({
            name: outcome.name,
            // Unreachable while the chooser is locked during a run (#3), and kept
            // because the sentence is the true one if the lock is ever relaxed.
            runInProgress: viewIsLocked(watchRef.current),
            /*
             * What became of the drawing that was here, as answered rather than as
             * guessed (DSP-88).
             *
             * DSP-85 assembled this from the editor's own `dirty` flag and said the
             * edits had left the window and the file was never written. That was the
             * truth then and is the defect this card fixes: nothing had asked. Now the
             * person answered Save or Discard changes before the switch was carried out,
             * the main process did what they said, and the sentence reports it. Reading
             * `dirty` here again would be the window narrating an act it did not perform.
             */
            unsaved:
              outcome.unsavedDrawing === null || file === null
                ? null
                : { displayPath: file.displayPath, answer: outcome.unsavedDrawing },
          }),
        );
        return 'switched';
      } catch {
        setChoiceError(
          'DSpatch could not reach the main process to choose a loop, so nothing was ' +
            'selected and the next mandate still walks whatever it walked before.',
        );
        return 'unchanged';
      } finally {
        setChoosing(false);
      }
    },
    [chosenLoop, file, open],
  );

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

  /*
   * Tell the main process what is unsaved, so a run can ask before it walks the file.
   *
   * DSP-86's *never quietly run an older version than the one on screen*. The edited
   * drawing exists only in this window, and the run that would read the file is started
   * from the chat's — so unless the main process is told, the question cannot even be
   * asked at the moment it could still change the answer. This is the telling.
   *
   * **It writes nothing and starts nothing.** The text goes no further than memory in
   * the main process until a start asks about it, and `null` — sent whenever the drawing
   * is saved, closed or replaced — forgets it again. `index.errors > 0` counts as nothing
   * to offer: Save refuses a drawing with errors, so offering to save it at the start of
   * a run would be offering something that cannot happen.
   */
  useEffect(() => {
    const offer =
      dirty && file !== null && currentText !== null && graph !== null && index.errors === 0
        ? { path: file.path, text: currentText, graphName: graph.name }
        : null;
    void window.dspatch.noteUnsavedDrawing(offer).catch(() => {
      /* A main process that cannot be told will read the file as saved, which is what
         it did before this existed. The standing line on screen still says so. */
    });
  }, [dirty, file, currentText, graph, index.errors]);

  /*
   * A run's save-or-cancel wrote this window's drawing. Catch up with it.
   *
   * Without this the editor would go on comparing against what *it* last wrote and keep
   * reporting unsaved changes that are now on disk — a window claiming edits it does not
   * have, which is the same kind of untruth as one hiding edits it does.
   */
  useEffect(() => {
    return window.dspatch.onGraphSavedElsewhere((saved) => {
      if (file === null || file.path !== saved.path) {
        return;
      }
      setSavedText(saved.text);
      setNote(
        saved.occasion === 'run'
          ? `Saved ${file.displayPath} before the run started, because you chose Save and run. ` +
              `The run is walking these changes.`
          : // The switch's own status line replaces this a moment later, and it says what
            // was drawn as well. This is what stands if the switch then fails.
            `Saved ${file.displayPath}, because you chose Save before the canvas changed.`,
      );
    });
  }, [file]);

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

  /*
   * The one warning that has to be standing rather than momentary (DSP-84 #8).
   *
   * A run reads the declaration's graph file from disk. So an edited, unsaved drawing of
   * the *selected* loop is the window showing one version and a run walking another, and
   * that must not be something a person has to remember from a status line they dismissed
   * ten minutes ago. `null` whenever the two cannot disagree.
   */
  const unsavedAgainstChoice = describeUnsavedAgainstChoice({
    definition: file?.definition ?? null,
    chosenKey: chosenLoop?.key ?? null,
    dirty,
    graphDisplayPath: file?.path ?? '',
  });

  /**
   * Locked while a run is **walking**, and not otherwise (DSP-86 #3 and #5).
   *
   * `viewIsLocked` carries the whole rule, including that a pause and a wait for a
   * person are runs that have not ended, and that an ended run and a stand-by offer are
   * not runs at all. Nothing here has to be unlocked by pressing anything: the run
   * ending is what unlocks it.
   *
   * Declared this high up because `runBlocked` below reads it, which it has to.
   */
  const locked = viewIsLocked(watch);

  const liveBinding = graph === null ? null : describeLiveBinding(graph);
  /*
   * `locked` belongs in here, which the first walk of DSP-86 showed by leaving it out.
   *
   * **Dry-run** was the one control still live while a chat-loop run walked the drawing,
   * and it is not the harmless read it sounds like: it walks the graph and puts its own
   * marks on the very nodes the live run is marking. Two walks writing to one drawing is
   * worse than an edit, because an edit at least announces itself. `liveRunOffer` already
   * refuses **Run** by the active run's id; this is the same refusal for the other button,
   * and like every other lock in this view it lifts by itself when the run ends.
   */
  const runBlocked = graph === null || index.errors > 0 || runBusy || locked;
  // A dry run walks the canvas and touches no control, so it keeps the local answer.
  // A live run is the one that must not overlap, and `runBusy` is this window's own.
  const liveRun = liveRunOffer({
    ownRunBusy: runBusy,
    activeRunId: loopControl.runId,
    blocked: runBlocked,
    reason: liveBinding?.reason ?? 'Open a graph first.',
  });
  /**
   * Whether the journal pane is on screen — asked for, and nothing else (DSP-86 #8, #9).
   *
   * It used to open itself: `editorJournalOpen` said yes while a run was busy or had left
   * a summary, and a watched run said yes on its own, so *This run so far* and a raw log
   * took a third of the window's height whenever anything had happened. That is
   * diagnostics sitting in the ordinary graph view, which is what the card removes.
   *
   * `editorJournalOpen` is still what decides whether there is anything **in** it; what
   * changed is that having something to show is no longer a reason to show it.
   */
  const [journalAsked, setJournalAsked] = useState(false);
  const journalOpen =
    journalAsked &&
    (watch !== null ||
      editorJournalOpen({
        busy: runBusy,
        summary: runSummary,
        refuse: runRefuse,
      }));

  /*
   * The menu is how the journal is reached (#9).
   *
   * `View → Run journal (diagnostics)` toggles it, so the same item puts it away again;
   * a menu that could only open something a person then has to hunt for a way to close
   * would be the journal occupying the view by another route.
   */
  useEffect(() => {
    return window.dspatch.onMenuCommand((command) => {
      if (command === 'show-run-journal') {
        setJournalAsked((open) => !open);
      }
    });
  }, []);

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
    // Every announcement, offer and run alike. Adopting one changes the marks and never
    // the drawing (DSP-86), so there is nothing here for an offer to take — which is what
    // lets the Ready pulse come back after a run without the person toggling `Use loop`
    // off and on (#6).
    return window.dspatch.onLoopRunEvent(receiveRunEvent);
  }, [receiveRunEvent]);

  useEffect(() => {
    watchRef.current = watch;
  }, [watch]);

  // Only while something is on screen to time. A window with no run does not tick.
  useEffect(() => {
    if (watch === null || watch.ended) {
      return;
    }
    setNowMs(Date.now());
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);
    return () => {
      clearInterval(timer);
    };
  }, [watch === null, watch?.ended]);

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
        if (cancelled || run === null || runFoldRef.current !== null) {
          return;
        }
        const adopted = runViewFor(run);
        runFoldRef.current = adopted;
        setWatch(adopted);
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

  /**
   * Walk the drawing with no provider, and answer what the walk did.
   *
   * The button ignores the answer — it reads the note and the journal like a person does.
   * It is returned for the one caller that cannot: a window trial establishing that the
   * ending mark matches *the run's own recorded outcome* needs the outcome from the runner
   * rather than from the sentence the window wrote about it, or it would be comparing the
   * window's prose with the window's marks and calling that agreement.
   */
  const dryRunCanvas = useCallback(async (): Promise<RunResult | null> => {
    if (graph === null || index.errors > 0 || runBusy) {
      return null;
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
    // Through `receiveRunEvent`, like a live run's events, so that the dry run's ending
    // reaches the ending mark by the same path and cannot come to differ from it.
    receiveRunEvent({ kind: 'started', run: announcement });
    try {
      const result = await runCanvasGraph(graph, {
        runId: announcement.runId,
        abortSignal: abort.signal,
        onJournalEntry: (entry) => {
          receiveRunEvent({ kind: 'journal', ...address, entry });
        },
      });
      receiveRunEvent({
        kind: 'ended',
        ...address,
        status: result.status,
        note: `The dry run ended: ${result.status}.`,
        // The same guard the main process applies to a live run: only `completed`
        // means a terminal was reached, and a dry run is no more entitled to a tick
        // on a walk that stopped at a bound than a live one is.
        terminalNodeId: result.status === 'completed' ? result.terminalNodeId : null,
      });
      showRun(result);
      return result;
    } finally {
      abortRef.current = null;
      setRunBusy(false);
      setRunKind(null);
    }
  }, [graph, currentText, index.errors, runBusy, showRun, receiveRunEvent]);

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
   * The roles a watched run announced, over this window's own.
   *
   * **This is the line that stopped the graph view refusing to draw the loop it was
   * watching.** `resolveRole` above is built from `roles`, and that map is only ever
   * filled for a graph the author opened through the file dialog. The chat loop was
   * never opened here, so its `project-work` and `project-check` references resolved to
   * nothing and `loadLoopGraph` refused on *a role reference that resolves to nothing is
   * an error*: a correct rule, reaching the wrong conclusion, about roles the main
   * process had already resolved in order to run the graph.
   *
   * Since DSP-86 the run's drawing is not what is *drawn*, so this no longer decides
   * what a person sees. It still decides whether the pinned bytes can be read at all,
   * which is what the comparison below depends on — and getting that wrong would report
   * a disagreement between two drawings that are in fact the same one.
   */
  const shownRoles = useMemo(() => {
    const announced = watch?.run.roles;
    if (announced === undefined || announced.length === 0) {
      return roles;
    }
    const merged = new Map<string, ResolvedRole | null>(roles);
    for (const entry of announced) {
      merged.set(entry.key, entry.role);
    }
    return merged;
    // `watch?.run`, not `watch`: the announcement is the same object for the life of a
    // run, so this does not re-merge on every journal entry that arrives.
  }, [watch?.run, roles]);
  const watchedResolveRole = useMemo(() => resolverFromEntries(shownRoles), [shownRoles]);

  /**
   * What the run pinned, as a drawing rather than as bytes.
   *
   * Loaded from the announced text and then **re-serialised**, because the comparison
   * this feeds has to be between two drawings and not between two files. A graph read
   * from disk and the same graph serialised by this editor differ wherever the file's
   * own layout is not the writer's — a `role` on one line rather than four is enough —
   * and comparing raw bytes would report every ordinary run as walking a different
   * version. Both sides go through `layOutMissingViews` and `serialiseLoopGraph` with
   * one newline, so what is compared is the graph as data.
   *
   * `null` when the pinned bytes could not be loaded, which the window says out loud
   * rather than treating as agreement.
   */
  const pinnedText = useMemo<string | null>(() => {
    if (watch === null) {
      return null;
    }
    const loaded = loadLoopGraph(watch.run.graphText, {
      resolveRole: watchedResolveRole,
      connectedTargets,
    });
    return loaded.ok
      ? serialiseLoopGraph(layOutMissingViews(loaded.graph).graph, { newline: '\n' })
      : null;
  }, [watch?.run, watchedResolveRole, connectedTargets]);

  /**
   * The canvas as a drawing, for the two comparisons that need one.
   *
   * `pinCheck` below needs it for a run that is walking, and the ending mark needs it for
   * a run that is over. One memo rather than two calls, because the second one would be
   * the same serialisation of the same graph taken a moment apart.
   */
  const drawingOnScreen = useMemo(
    () => (graph === null ? null : serialiseLoopGraph(graph, { newline: '\n' })),
    [graph],
  );

  /**
   * Whether the drawing on screen is the version the run pinned.
   *
   * **This is what "the run pins its version" means now.** It used to mean the canvas
   * was replaced by the run's own drawing, so pinning was visible because the picture
   * changed — and that replacement is exactly what DSP-86 abolishes. The pin itself is
   * unchanged: the run still holds the bytes it started with and still ignores every
   * edit made afterwards. What changed is that the window reports the pin by comparing,
   * and says something only when there is a disagreement to report.
   *
   * In the ordinary case there is none. Choosing a loop draws it (DSP-85), starting a
   * run against unsaved edits asks to save them first, and editing is locked while a run
   * walks — so the three ways the two could drift apart are each closed at their source
   * rather than explained afterwards.
   */
  const pinCheck: PinnedDrawingCheck = useMemo(() => {
    if (watch === null) {
      return 'same';
    }
    if (pinnedText === null) {
      return 'unreadable';
    }
    return drawingOnScreen === pinnedText ? 'same' : 'different';
  }, [watch, pinnedText, drawingOnScreen]);

  const pinnedDrawing = describePinnedDrawing(watch, pinCheck);

  useEffect(() => {
    graphRef.current = graph;
    pinnedTextRef.current = pinnedText;
  }, [graph, pinnedText]);

  /**
   * The last run's ending mark, shown only on the drawing it belongs to (#8).
   *
   * Switching loop must not carry a mark across, and this is where that is guaranteed:
   * not by remembering which gestures change a drawing — DSP-85 and DSP-88 own those, and
   * a list of them here would be wrong the first time a new one was added — but by asking
   * whether the drawing in front of the person is the one the run walked. Withheld rather
   * than forgotten, so choosing the loop back brings its ending mark back with it: the
   * mark belongs to the run and its graph, and it has not stopped being true because
   * something else was on screen for a moment.
   */
  const endingMarks = useMemo(
    () => (finishedMarksBelongTo(finishedMarks, drawingOnScreen) ? finishedMarks : null),
    [finishedMarks, drawingOnScreen],
  );

  const selectedNode = graph !== null && selection?.kind === 'node' ? nodeById(graph, selection.id) : null;
  const selectedEdge =
    graph !== null && selection?.kind === 'edge'
      ? (graph.edges.find((edge) => edge.id === selection.id) ?? null)
      : null;

  const bounds = useMemo(() => {
    if (graph === null) {
      return { width: 900, height: 600 };
    }
    let maxX = 0;
    let maxY = 0;
    for (const node of graph.nodes) {
      maxX = Math.max(maxX, (node.view?.x ?? 0) + NODE_WIDTH);
      maxY = Math.max(maxY, (node.view?.y ?? 0) + NODE_HEIGHT);
    }
    return { width: maxX + 120, height: maxY + 120 };
  }, [graph]);

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

  /*
   * What is on the canvas when the window appears.
   *
   * **The chosen loop**, since DSP-85. It used to be the Cursor process drawing — our own
   * documentation, which can be neither chosen nor run — on the ground that it is the
   * drawing most often looked at while editing. That was the window coming up on
   * something other than what would run, with a chooser beside it saying a different
   * name, which is exactly the confusion this card removes. Now the dropdown and the
   * canvas agree from the first frame, because choosing and drawing are one act and the
   * mount is the choice already made.
   *
   * Unless the File menu asked for a graph file first (#6). That press may have created
   * this very window, so the path waits in the main process and is taken here; a graph
   * opened that way displaces nothing, because it was never a chosen loop.
   *
   * `openedOnce` is a ref because this must not fire again when the graph is later closed
   * or replaced.
   */
  const openedOnce = useRef(false);
  useEffect(() => {
    if (openedOnce.current) {
      return;
    }
    openedOnce.current = true;
    void window.dspatch.takeGraphToEdit().then(
      (waiting) => {
        if (waiting !== null) {
          void open({ kind: 'path', path: waiting });
          return;
        }
        void open({ kind: 'chosen-loop' });
      },
      () => {
        void open({ kind: 'chosen-loop' });
      },
    );
  }, [open]);

  /*
   * A graph file the File menu asked for while this window was already open (#6).
   *
   * The path is taken rather than carried on the event, so this and the mount-time take
   * above cannot open one file twice.
   */
  useEffect(() => {
    return window.dspatch.onGraphToEdit(() => {
      void window.dspatch.takeGraphToEdit().then(
        (waiting) => {
          if (waiting !== null) {
            void open({ kind: 'path', path: waiting });
          }
        },
        () => {
          /* Nothing to open is not something to report. */
        },
      );
    });
  }, [open]);

  // A hidden hook for DSPATCH_EDITOR_AUTORUN: the main process clicks through
  // the same functions the visible buttons call, so a log of the window is not
  // a claim about a CLI walk.
  useEffect(() => {
    // Installed whether or not a graph loaded. It used to return early on `graph ===
    // null`, which left the previous render's hook in place and made a trial that
    // opened a refused definition drive the *last* file it had opened — and a refused
    // definition is exactly the case DSP-84 #5 has to be able to drive. The functions
    // that need a graph say so themselves, below.
    window.__dspatchEditorCheck = {
      dryRunCurrent: async () => {
        if (graph === null || index.errors > 0) {
          return null;
        }
        const result = await runCanvasGraph(graph, { runId: newEditorRunId('dry') });
        showRun(result);
        return summariseEditorRun(result);
      },
      dryRunRedirectedE08: async () => {
        const edge = graph?.edges.find((entry) => entry.id === 'e08');
        if (graph === null || edge === undefined) {
          return null;
        }
        const next = replaceEdge(graph, 'e08', { ...edge, to: 'coordinator-report' });
        apply(next, 'Redirected e08 to the report, so the drawing — not the file — is what runs.');
        const result = await runCanvasGraph(next, { runId: newEditorRunId('dry') });
        showRun(result);
        return summariseEditorRun(result);
      },
      /**
       * Select one node and say what its panel ended up showing (DSP-83).
       *
       * A trial needs two things a pixel count cannot give it: that the node it meant
       * was selected, and how much role text is on screen — a screenshot in which the
       * role is illegible or absent is not evidence, and `roleChars` is what lets the
       * trial fail before a person is asked to look. `advanced` drives the real
       * `<details>` rather than a second state, so "closed to begin with" is read off
       * the element the browser owns.
       */
      /**
       * Put a graph on the canvas the way the buttons do (DSP-83, and DSP-82's fix).
       *
       * `window.dspatch.openLoopGraph` only *reads*: the renderer resolves, validates
       * and draws. A trial that called the bridge directly would report a file it read
       * and never notice the canvas stayed empty, so it goes through the same `open`
       * the header presses — which is also what makes this a check of opening a chosen
       * definition rather than of reading one.
       */
      openTarget: async (request: LoopGraphOpenRequest) => {
        await open(request);
        // After the paint, not after the state setters. Reading straight through
        // returned the *previous* graph's header and node count, which is worse than
        // no reading at all: a trial would have recorded the wrong file as opened.
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        return {
          headerText: document.querySelector<HTMLElement>('.editor-title')?.textContent ?? '',
          noteText: document.querySelector<HTMLElement>('.editor-note')?.textContent ?? '',
          nodesDrawn: document.querySelectorAll('svg g.node').length,
        };
      },
      /**
       * Choose a loop the way the dropdown does, and say what the window then shows.
       *
       * DSP-85. The same function the `<select>`'s `onChange` calls, for the same reason
       * `openTarget` above goes through `open`: a trial that invoked
       * `chooseLoopDefinition` directly would establish that the main process records a
       * key and nothing at all about whether this window can be used to choose one, nor
       * that the canvas followed. What it returns is read off the DOM after a paint — the
       * chooser's own value and options, the canvas's node count, and the two lines a
       * person reads — so "choosing draws it" is measured rather than assumed.
       */
      chooseLoop: async (definitionPath: string) => {
        const switched = await chooseLoop(definitionPath);
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        const chooser = document.querySelector<HTMLSelectElement>(
          '[data-ev="editor-loop-definition"]',
        );
        const error = document.querySelector<HTMLElement>('[data-ev="editor-choice-error"]');
        const unsaved = document.querySelector<HTMLElement>(
          '[data-ev="editor-unsaved-against-choice"]',
        );
        return {
          noteText: document.querySelector<HTMLElement>('.editor-note')?.textContent ?? '',
          headerText: document.querySelector<HTMLElement>('.editor-title')?.textContent ?? '',
          chooserValue: chooser?.value ?? '',
          chooserKeys: [...(chooser?.options ?? [])].map((option) => option.value),
          nodesDrawn: document.querySelectorAll('svg g.node').length,
          choiceError: error?.getAttribute('title') ?? '',
          unsavedWarning: unsaved?.getAttribute('title') ?? '',
          // Whether the switch was carried out, from the function that carried it out or
          // did not. A trial reading only the DOM would have to infer it from the drawing,
          // which is the very thing a cancelled switch is supposed to leave alone (DSP-88).
          switched,
        };
      },
      /**
       * The whole view as it stands, for reading twice and comparing (DSP-86).
       *
       * This card's claim is *nothing moved*, and nothing-moved can only be established
       * by two readings of the same quantities either side of the event. So this is
       * deliberately one function returning everything at once: zoom, the canvas's own
       * scroll offsets, which node is selected, how much is drawn, and the sizes of the
       * three regions the grid lays out. A trial assembling the same list from separate
       * calls would read them at different moments and could report a difference that
       * was only its own latency.
       *
       * Everything here is read off the DOM or off state the DOM is rendered from,
       * never off the run announcement — otherwise "the view survived the run start"
       * would be measured against the thing that changed.
       */
      readView: () => {
        const canvas = document.querySelector<HTMLElement>('.editor-canvas');
        const svg = canvas?.querySelector('svg') ?? null;
        const box = (selector: string): { width: number; height: number } => {
          const found = document.querySelector<HTMLElement>(selector);
          if (found === null) {
            return { width: 0, height: 0 };
          }
          const rect = found.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        };
        const ev = (name: string): HTMLElement | null =>
          document.querySelector<HTMLElement>(`[data-ev="${name}"]`);
        const disabled = (name: string): boolean | null => {
          const found = ev(name);
          return found === null
            ? null
            : found instanceof HTMLSelectElement ||
                found instanceof HTMLButtonElement ||
                found instanceof HTMLInputElement
              ? found.disabled
              : null;
        };
        // By their visible text, because these four controls have no `data-ev` and
        // adding one only to be read would be a hook rather than a reading of the real
        // header. Their labels are what a person finds them by.
        const buttonLabelled = (label: string): HTMLButtonElement | null =>
          [...document.querySelectorAll<HTMLButtonElement>('.editor-actions button')].find(
            (candidate) => candidate.textContent?.trim() === label,
          ) ?? null;
        return {
          zoom,
          scrollLeft: Math.round(canvas?.scrollLeft ?? -1),
          scrollTop: Math.round(canvas?.scrollTop ?? -1),
          svgWidth: Math.round(Number(svg?.getAttribute('width') ?? 0)),
          canvasBox: box('.editor-canvas'),
          inspectorBox: box('.editor-inspector'),
          paletteBox: box('.editor-palette'),
          selectedKind: selection?.kind ?? '',
          selectedId: selection?.id ?? '',
          nodesDrawn: document.querySelectorAll('svg g.node').length,
          edgesDrawn: document.querySelectorAll('svg g.edge, svg .edge').length,
          graphName: graph?.name ?? '',
          titleLine: ev('editor-title-line')?.textContent ?? '',
          noteLine: document.querySelector<HTMLElement>('.editor-note')?.textContent ?? '',
          // The lock, read three ways: the state the editor computed, the class the
          // canvas carries, and whether the browser is actually refusing the fields.
          // A `locked` that never reached the DOM is the failure worth catching.
          locked,
          canvasLocked: svg?.classList.contains('locked') ?? false,
          inspectorLocked: (ev('inspector-lock') as HTMLFieldSetElement | null)?.disabled ?? null,
          chooserDisabled: disabled('editor-loop-definition'),
          openLoopDisabled: disabled('open-loop-definition'),
          saveDisabled: buttonLabelled('Save')?.disabled ?? null,
          dryRunDisabled: buttonLabelled('Dry-run')?.disabled ?? null,
          runDisabled: buttonLabelled('Run')?.disabled ?? null,
          // A count rather than "are they all disabled": while a run walks the palette
          // is not in the row at all, and `every` over an empty list answers `true`,
          // which would have let a palette that vanished pass as a palette that locked.
          // Not the run's own Pause and Continue, which share the row and are supposed
          // to be live exactly when these are not.
          paletteButtonsEnabled: [
            ...document.querySelectorAll<HTMLButtonElement>('.editor-palette button'),
          ].filter((button) => !button.disabled && button.closest('.editor-palette-run') === null)
            .length,
          /*
           * The marks on the drawing, which is how a run shows itself now (#2).
           *
           * `not-reached` is dropped because it is every node before anything happens,
           * and a list of thirty of them says nothing. What is left is exactly the set
           * of nodes carrying a mark, which is what a person sees change. The entry
           * step is called out separately: the Ready pulse coming back to it is #6, and
           * finding it in a list would mean the trial knowing which id is the entry.
           */
          marked: [...document.querySelectorAll<SVGGElement>('svg g.node')]
            .map((node) => ({
              id: node.getAttribute('data-node-id') ?? '',
              state: node.getAttribute('data-run-state') ?? '',
              working: node.getAttribute('data-run-working') === 'true',
              ending: node.getAttribute('data-run-ending') ?? '',
            }))
            .filter(
              (entry) =>
                entry.state !== '' && (entry.state !== 'not-reached' || entry.ending !== ''),
            ),
          entryNodeId: graph?.entry ?? '',
          entryState:
            graph === null
              ? ''
              : (document
                  .querySelector<SVGGElement>(`svg g.node[data-node-id="${graph.entry}"]`)
                  ?.getAttribute('data-run-state') ?? ''),
          // The surfaces this card removes, and the one it moves behind a menu (#1).
          gone: {
            runBanner: document.querySelector('.editor-watch') !== null,
            leaveTheRunView:
              [...document.querySelectorAll('button')].some((button) =>
                (button.textContent ?? '').includes('Leave the run view'),
              ),
            theRunOnScreen: (document.body.textContent ?? '').includes('The run on screen'),
            whatTheWordsMean: (document.body.textContent ?? '').includes('What the words mean'),
            thisRunSoFar: (document.body.textContent ?? '').includes('This run so far'),
            journal: document.querySelector('.editor-journal') !== null,
          },
          // What is there instead: the control and the run's state, in the strip.
          controlPresent: ev('loop-control') !== null,
          controlPhase: ev('loop-control-phase')?.textContent ?? '',
          standing: ev('watch-standing')?.getAttribute('data-standing') ?? '',
          pinnedDrawingChip: ev('editor-pinned-drawing')?.textContent ?? '',
          unsavedChip: ev('editor-unsaved-against-choice')?.textContent ?? '',
        };
      },
      /**
       * Walk the drawing with no provider and say what the runner recorded (DSP-36).
       *
       * Through `dryRunCanvas`, which is the function the **Dry-run** button calls — so
       * the marks that appear are the ones a person's press produces, by the same path,
       * including the `ended` announcement the ending mark is taken from. What comes back
       * is the *runner's* status and terminal, not the window's sentence about them,
       * because the claim being checked is that the mark agrees with the recorded outcome
       * and a trial reading the window's prose would only establish that it agrees with
       * itself.
       */
      dryRunOnCanvas: async () => {
        const result = await dryRunCanvas();
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        return result === null
          ? null
          : {
              status: result.status,
              terminalNodeId: result.terminalNodeId,
              path: result.path,
            };
      },
      /**
       * Put one node into a run state, with no run at all, so the drawing can be read.
       *
       * Added when Niclas refused the price of the alternative. Establishing how the glint
       * and the pulse *look* had been costing a full walk of a loop through the
       * presentation adapter — a session, a project, a run, minutes of canned replies — to
       * arrive at a node in the `active` state, which is a state this window can simply be
       * told about. Nothing in the change being read touches a state rule, so a run proves
       * nothing about it.
       *
       * It is not a second state model. The two announcements below are the two the real
       * callers send — `dryRunCanvas` sends the first and the main process's
       * `offerReadyAgainAfterRun` sends the second — and they go through `receiveRunEvent`,
       * which is the only thing in this component that writes the run view. So the classes
       * that come out are the classes a run produces, by the same derivation, and
       * `nodeIsWorking` still decides which node is working.
       *
       * What it cannot do is show both states at once, and that is the state rule rather
       * than a limit of the hook: Ready means a loop chosen and nothing run yet, working
       * means a run in flight. A caller wanting both reads them a moment apart.
       */
      showLivenessForLook: async (want: 'working' | 'ready', nodeId?: string) => {
        if (graph === null) {
          return null;
        }
        const chosen =
          want === 'ready'
            ? graph.entry
            : (nodeId ?? graph.nodes.find((node) => node.kind === 'agent')?.id ?? graph.entry);
        const announcement: LiveRunAnnouncement = {
          runId: newEditorRunId('dry'),
          graphVersionId: UNVERSIONED_CANVAS,
          graphId: graph.id,
          graphName: graph.name,
          binding: 'canvas-dry-run',
          graphText: currentText ?? '',
          startedAtUtc: new Date().toISOString(),
          ...(want === 'ready' ? { phase: 'ready' as const } : {}),
        };
        receiveRunEvent({ kind: 'started', run: announcement });
        if (want === 'working') {
          receiveRunEvent({
            kind: 'journal',
            runId: announcement.runId,
            graphVersionId: announcement.graphVersionId,
            entry: {
              seq: 1,
              atIso: announcement.startedAtUtc,
              sinceStartMs: 0,
              kind: 'node-entered',
              nodeId: chosen,
              detail: 'Entered, so that the drawing can be read.',
            },
          });
        }
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        return { nodeId: chosen };
      },
      /**
       * Stop the glint with its leading edge at a chosen point, and say where to sample.
       *
       * The glint is a gradient built from pieces that touch, and the question about it —
       * *can the seams be seen, especially round a corner* — is a question about pixels.
       * Pixels cannot be read from here, so this does the half a renderer can: it holds the
       * animation still at a known phase and hands back the screen coordinates of a line of
       * points along the outline, each labelled with how far behind the leading edge it is.
       * Whatever took the picture can then sample it and get a profile.
       *
       * Three things are deliberate.
       *
       * **The phase is computed, not searched for.** `stroke-dashoffset` runs 0 to −100 over
       * the lap, the dash pattern counts from `-dashoffset`, and the glint occupies the
       * `GLINT_TOTAL_LENGTH` units in front of that origin — so the leading edge is at
       * `origin + total` and the time that puts it at `leadAt` is arithmetic. A trial that
       * hunted for the bright part by taking pictures would be slow and would also not be
       * able to say *where on the outline* it had found it.
       *
       * **The halo is stilled at its trough rather than hidden.** It strokes the same path
       * seven units wide, so at its peak it would swamp the thing being measured. Its
       * opacity is the same all the way round, so stopping it at the bottom of its breath
       * leaves a constant floor under the profile and cannot invent a ramp in it.
       *
       * **Each sample carries its own normal and a background direction.** The stroke is two
       * or three pixels wide and antialiased; a reader sampling the centre line alone would
       * lose a piece to rounding. The normal lets it take the brightest pixel across the
       * stroke and a floor from well outside it.
       */
      freezeGlintAt: async (
        nodeId: string,
        leadAt: number,
        back: number,
        ahead: number,
        step: number,
      ) => {
        const node = document.querySelector<SVGGElement>(`g.node[data-node-id="${nodeId}"]`);
        const glints = [...(node?.querySelectorAll<SVGGeometryElement>('.node-glint') ?? [])];
        const first = glints[0];
        if (node === null || first === undefined) {
          return null;
        }
        // Where in the lap the leading edge is at `leadAt`, in milliseconds of the 2600 ms
        // cycle. `GLINT_TOTAL_LENGTH` behind it is the origin the dash pattern counts from.
        const origin = (((leadAt - GLINT_TOTAL_LENGTH) % 100) + 100) % 100;
        const atMs = (2600 * origin) / 100;
        for (const glint of glints) {
          for (const animation of glint.getAnimations()) {
            animation.pause();
            animation.currentTime = atMs;
          }
        }
        for (const other of node.querySelectorAll<SVGGraphicsElement>('.node-halo, .node-body')) {
          for (const animation of other.getAnimations()) {
            animation.pause();
            animation.currentTime = 0;
          }
        }
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        const total = first.getTotalLength();
        const matrix = first.getScreenCTM();
        const toScreen = (units: number): { x: number; y: number } => {
          const point = first.getPointAtLength((units / GLINT_PATH_LENGTH) * total);
          return matrix === null
            ? { x: point.x, y: point.y }
            : {
                x: matrix.a * point.x + matrix.c * point.y + matrix.e,
                y: matrix.b * point.x + matrix.d * point.y + matrix.f,
              };
        };
        const samples: {
          offsetFromLead: number;
          x: number;
          y: number;
          nx: number;
          ny: number;
          turnDeg: number;
        }[] = [];
        let previousHeading: number | null = null;
        let cumulativeTurn = 0;
        for (let offset = -ahead; offset <= back + 1e-9; offset += step) {
          const at = (((leadAt - offset) % 100) + 100) % 100;
          const here = toScreen(at);
          const just = toScreen((at + 0.15) % 100);
          const dx = just.x - here.x;
          const dy = just.y - here.y;
          const length = Math.hypot(dx, dy) || 1;
          const heading = (Math.atan2(dy, dx) * 180) / Math.PI;
          /*
           * Accumulated rather than measured against the first sample.
           *
           * The first version took each heading modulo a full turn against the first one,
           * which reported −180 degrees for every span of any length: a line of samples
           * that goes right round a rectangle comes back to where it started, and the
           * difference of two absolute headings cannot tell a straight side from that. The
           * sum of the small turns between neighbours can, and it is also what makes a
           * corner findable — a corner is where one of those small turns is large.
           */
          cumulativeTurn +=
            previousHeading === null
              ? 0
              : ((heading - previousHeading + 540) % 360) - 180;
          previousHeading = heading;
          samples.push({
            offsetFromLead: Math.round(offset * 1000) / 1000,
            x: Math.round(here.x * 100) / 100,
            y: Math.round(here.y * 100) / 100,
            // The tangent turned a quarter: across the stroke rather than along it, which
            // is the direction a reader has to search to find the whole of it.
            nx: Math.round((-dy / length) * 1000) / 1000,
            ny: Math.round((dx / length) * 1000) / 1000,
            turnDeg: Math.round(cumulativeTurn * 10) / 10,
          });
        }
        return {
          leadAt,
          frozenAtMs: Math.round(atMs * 10) / 10,
          screenPixelsPerUnit:
            Math.round(((total * (matrix?.a ?? 1)) / GLINT_PATH_LENGTH) * 1000) / 1000,
          devicePixelRatio: window.devicePixelRatio,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          samples,
        };
      },
      /**
       * Scroll one node to the middle of the drawing area, and say where everything ended up.
       *
       * The first version of the light trial did without this and measured the background:
       * at the zoom a pixel reading needs, the canvas scrolled to its origin had the node in
       * the top right corner with most of it behind the inspector panel, and a line of
       * samples along its bottom edge ran off the canvas after two units. The profile that
       * came back was two bright samples and thirteen units of dark, which reads exactly like
       * a glint that is too short — a wrong answer that looks like a real finding, which is
       * the worst kind.
       *
       * Both rectangles are returned rather than a verdict, so the caller can require that
       * the node and the span it means to sample are really inside the drawing area. The
       * scroll is set on the same element the scrollbars move.
       */
      centreNodeInCanvas: (nodeId: string) => {
        const canvas = document.querySelector<HTMLElement>('.editor-canvas');
        const node = document.querySelector<SVGGElement>(`g.node[data-node-id="${nodeId}"]`);
        if (canvas === null || node === null) {
          return null;
        }
        const canvasBox = canvas.getBoundingClientRect();
        const before = node.getBoundingClientRect();
        canvas.scrollLeft +=
          before.left + before.width / 2 - (canvasBox.left + canvasBox.width / 2);
        canvas.scrollTop += before.top + before.height / 2 - (canvasBox.top + canvasBox.height / 2);
        const after = node.getBoundingClientRect();
        return {
          nodeLeft: Math.round(after.left),
          nodeTop: Math.round(after.top),
          nodeRight: Math.round(after.right),
          nodeBottom: Math.round(after.bottom),
          canvasLeft: Math.round(canvasBox.left),
          canvasTop: Math.round(canvasBox.top),
          canvasRight: Math.round(canvasBox.right),
          canvasBottom: Math.round(canvasBox.bottom),
        };
      },
      /**
       * Start everything on a node moving again, after a frame of it was held still.
       *
       * Needed because the next thing the trial asks is what `prefers-reduced-motion` does,
       * and that reading is worthless on a node whose animations are already paused: the
       * count of running animations would be nothing before and nothing after, and a
       * preference being honoured would be indistinguishable from a preference being
       * ignored on a node that was not moving in the first place.
       */
      resumeLivenessMotion: (nodeId: string) => {
        const node = document.querySelector<SVGGElement>(`g.node[data-node-id="${nodeId}"]`);
        let resumed = 0;
        for (const element of node?.querySelectorAll<SVGGraphicsElement>(
          '.node-body, .node-halo, .node-glint',
        ) ?? []) {
          for (const animation of element.getAnimations()) {
            animation.play();
            resumed += 1;
          }
        }
        return resumed;
      },
      /**
       * The pulse's two extremes, its rhythm, and how far it is from the node's words.
       *
       * Niclas found the pulse barely noticeable, so the number that matters is the distance
       * between its weakest and its strongest state. Both are read by stopping the real
       * animation at the keyframes that define them — 0 % and 50 % of its own duration — and
       * asking the browser for the opacity it computed, which is a reading of the stylesheet
       * in force rather than of the numbers a trial expected to find.
       *
       * The durations come back too, because *do not change the rhythm* is half the
       * instruction and a wider range bought with a slower breath would not have honoured it.
       *
       * The clearance is how the other half is answered. The strengthened layer is the ring
       * on the border and the text sits in the middle of the node, so rather than argue
       * about contrast this measures the gap in graph units between the label's ink and the
       * inner edge of the ring's stroke. A positive number is the ring being unable to reach
       * the words at any opacity.
       */
      readPulseExtremes: (nodeId: string, leaveAt = 0.5) => {
        const node = document.querySelector<SVGGElement>(`g.node[data-node-id="${nodeId}"]`);
        const halo = node?.querySelector<SVGGraphicsElement>('.node-halo') ?? null;
        const body = node?.querySelector<SVGGraphicsElement>('.node-body') ?? null;
        const label = node?.querySelector<SVGGraphicsElement>('.node-label') ?? null;
        if (halo === null || body === null) {
          return null;
        }
        const opacityAt = (element: SVGGraphicsElement, fraction: number): number => {
          for (const animation of element.getAnimations()) {
            animation.pause();
            const duration = animation.effect?.getComputedTiming().duration;
            animation.currentTime = (typeof duration === 'number' ? duration : 0) * fraction;
          }
          return Math.round(Number(window.getComputedStyle(element).opacity) * 1000) / 1000;
        };
        const durationMs = (element: SVGGraphicsElement): number => {
          const duration = element.getAnimations()[0]?.effect?.getComputedTiming().duration;
          return typeof duration === 'number' ? Math.round(duration) : 0;
        };
        // `parseFloat`, because the computed value is "7px" and `Number` makes that NaN —
        // which reported a stroke of nothing and a clearance 3.5 units too generous.
        const strokeWidth = Number.parseFloat(window.getComputedStyle(halo).strokeWidth) || 0;
        const reading = {
          haloTrough: opacityAt(halo, 0),
          haloPeak: opacityAt(halo, 0.5),
          bodyTrough: opacityAt(body, 0.5),
          bodyPeak: opacityAt(body, 0),
        };
        // Left where the caller asked, so that a picture taken straight afterwards is a
        // picture of a named point in the cycle rather than of wherever the last reading
        // happened to stop.
        opacityAt(halo, leaveAt);
        opacityAt(body, leaveAt);
        const bodyBox = body.getBoundingClientRect();
        const labelBox = label?.getBoundingClientRect() ?? null;
        // One drawn box against one known width gives the scale, so the clearance below is
        // in the graph's own units and does not depend on the zoom it was read at.
        const scale = bodyBox.width === 0 ? 1 : bodyBox.width / NODE_WIDTH;
        return {
          ...reading,
          haloDurationMs: durationMs(halo),
          bodyDurationMs: durationMs(body),
          haloStrokeWidth: strokeWidth,
          labelClearanceUnits:
            labelBox === null
              ? null
              : Math.round(
                  (Math.min(
                    labelBox.left - bodyBox.left,
                    bodyBox.right - labelBox.right,
                    labelBox.top - bodyBox.top,
                    bodyBox.bottom - labelBox.bottom,
                  ) /
                    scale -
                    strokeWidth / 2) *
                    100,
                ) / 100,
        };
      },
      /**
       * What each node is doing and how big it is, measured (DSP-80, DSP-36).
       *
       * Deliberately not a reading of class names. `getAnimations()` is the browser
       * answering *is anything actually moving on this node*, which is the claim; a class
       * or an `animation-name` would be the stylesheet agreeing with itself. The two
       * boxes are there for the constraint about zoom and panning: `body*` is the drawn
       * box and `group*` is everything drawn with it, so a glint that had been inflated
       * outside the node would show as the second pair growing while the first did not.
       */
      readLiveness: () =>
        [...document.querySelectorAll<SVGGElement>('svg g.node')]
          .map((node) => {
            const body = node.querySelector<SVGGraphicsElement>('.node-body');
            const halo = node.querySelector<SVGGraphicsElement>('.node-halo');
            const glints = [...node.querySelectorAll<SVGGraphicsElement>('.node-glint')];
            const bodyBox = body?.getBoundingClientRect();
            const groupBox = node.getBoundingClientRect();
            const running = [body, halo, ...glints].reduce(
              (total, element) =>
                total +
                (element === null || element === undefined
                  ? 0
                  : element
                      .getAnimations()
                      .filter((animation) => animation.playState === 'running').length),
              0,
            );
            return {
              id: node.getAttribute('data-node-id') ?? '',
              state: node.getAttribute('data-run-state') ?? '',
              working: node.getAttribute('data-run-working') === 'true',
              ending: node.getAttribute('data-run-ending') ?? '',
              animations: running,
              glintsLit: glints.filter(
                (glint) => Number(window.getComputedStyle(glint).opacity) > 0,
              ).length,
              haloOpacity:
                halo === null
                  ? 0
                  : Math.round(Number(window.getComputedStyle(halo).opacity) * 100) / 100,
              bodyWidth: Math.round(bodyBox?.width ?? 0),
              bodyHeight: Math.round(bodyBox?.height ?? 0),
              groupWidth: Math.round(groupBox.width),
              groupHeight: Math.round(groupBox.height),
              groupLeft: Math.round(groupBox.left),
              groupTop: Math.round(groupBox.top),
              tick: node.querySelector('.node-ending-tick') !== null,
              ring: node.querySelector('.node-ending-ring') !== null,
            };
          })
          .filter((entry) => entry.state !== 'not-reached' || entry.ending !== ''),
      /**
       * Put the view somewhere distinctive, so "it did not move" is worth measuring.
       *
       * A default view would pass the comparison by accident: the interesting failure
       * is a remount, and a remount lands exactly on the defaults. Zoom is set through
       * the same state the `+` and `−` buttons set, and the scroll is set on the real
       * scroll container, because those are the two things a person moves.
       */
      setViewState: async (nextZoom: number, left: number, top: number) => {
        setZoom(nextZoom);
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        const canvas = document.querySelector<HTMLElement>('.editor-canvas');
        if (canvas !== null) {
          canvas.scrollLeft = left;
          canvas.scrollTop = top;
        }
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
      },
      /**
       * Move a node a little, which is a real unsaved edit (DSP-86).
       *
       * Through `apply`, which is the function dragging a node on the canvas calls, so
       * what this leaves behind is the same unsaved drawing a person leaves behind —
       * including the registration with the main process that the save-or-cancel at the
       * start of a run reads. A trial that wrote the file itself would be arranging the
       * answer to the question it was about to ask.
       */
      nudgeNode: (id: string, by: number) => {
        const node = graph === null ? null : nodeById(graph, id);
        if (graph === null || node === null) {
          return false;
        }
        apply(
          replaceNode(graph, id, {
            ...node,
            view: { x: (node.view?.x ?? 0) + by, y: node.view?.y ?? 0 },
          }),
          `Moved ${node.label ?? node.id}.`,
        );
        return true;
      },
      /** What the chooser says right now, with no gesture at all. */
      readChooser: () => {
        const chooser = document.querySelector<HTMLSelectElement>(
          '[data-ev="editor-loop-definition"]',
        );
        return {
          chooserValue: chooser?.value ?? '',
          chooserKeys: [...(chooser?.options ?? [])].map((option) => option.value),
          nodesDrawn: document.querySelectorAll('svg g.node').length,
          headerText: document.querySelector<HTMLElement>('.editor-title')?.textContent ?? '',
        };
      },
      showNode: async (id: string, advanced: boolean, anchor?: string) => {
        const node = graph === null ? null : nodeById(graph, id);
        if (node === null) {
          return null;
        }
        setSelection({ kind: 'node', id });
        // After React has drawn the panel for this node, not before.
        return new Promise((resolve) => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              const details = document.querySelector<HTMLDetailsElement>('.inspector .advanced');
              if (details !== null) {
                details.open = advanced;
              }
              const roleText = document.querySelector<HTMLElement>('[data-ev="node-role-text"]');
              const brief = document.querySelectorAll('[data-ev="node-brief"] dt');
              const inspector = document.querySelector<HTMLElement>('.editor-inspector');
              // Closed: the top of the panel, which is the layout being judged. Open:
              // the section that was opened, because a picture of a panel whose Advanced
              // is off-screen proves nothing about Advanced. Both are what a person
              // actually sees at that moment.
              const anchored =
                anchor === undefined ? null : document.querySelector<HTMLElement>(anchor);
              if (anchored !== null) {
                anchored.scrollIntoView({ block: 'start' });
              } else if (advanced && details !== null) {
                details.scrollIntoView({ block: 'start' });
              } else {
                inspector?.scrollTo({ top: 0 });
              }
              // Pixels inside the window, not the element's own height. Measuring height
              // passed a capture in which three lines of the role were visible and the
              // rest was below the fold.
              const onScreen = (element: Element | null | undefined): number => {
                if (element === null || element === undefined) {
                  return 0;
                }
                const box = element.getBoundingClientRect();
                return Math.round(
                  Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0)),
                );
              };
              resolve({
                id,
                label: node.label ?? node.id,
                kind: node.kind,
                roleId: node.role?.id ?? null,
                roleSourcePath: node.role?.source.path ?? null,
                roleChars: roleText?.textContent?.trim().length ?? 0,
                roleVisibleHeight: onScreen(roleText),
                advancedVisibleHeight: onScreen(details),
                briefHeadings: brief.length,
                advancedFound: details !== null,
                advancedOpen: details?.open ?? false,
                purpose: node.purpose ?? '',
                // The instruction blocks as characters, so a trial can hold them
                // against the prompt the builder writes rather than against a count.
                briefTexts: [
                  ...document.querySelectorAll<HTMLElement>(
                    '[data-ev="node-brief"] pre[data-ev$="-text"]',
                  ),
                ].map((block) => ({
                  id: (block.dataset['ev'] ?? '')
                    .replace(/^node-brief-/, '')
                    .replace(/-text$/, ''),
                  text: block.textContent ?? '',
                })),
                briefVisibleHeight: onScreen(
                  document.querySelector<HTMLElement>('[data-ev="node-brief"]'),
                ),
                toolPolicyNote:
                  document.querySelector<HTMLElement>('[data-ev="node-tool-policy"]')
                    ?.textContent ?? '',
                modelNote:
                  document.querySelector<HTMLElement>('[data-ev="node-model-note"]')
                    ?.textContent ?? '',
                modelAppliesToEveryStep:
                  document.querySelector('[data-ev="node-model-reach"]') !== null,
              });
            }, 0);
          });
        });
      },
    };
    return () => {
      delete window.__dspatchEditorCheck;
    };
  }, [graph, index.errors, apply, showRun, open, chooseLoop, locked, selection, zoom]);

  /**
   * Which box is lit, on the one drawing there is.
   *
   * `graph.entry` is read for the ready state alone: a chosen loop marks its entry step
   * and nothing else, and the view holds graph *text* rather than a loaded graph to find
   * that id in. This is where the Ready pulse comes from, and it needs no button —
   * `Use loop` announcing the chosen loop is the whole of it.
   *
   * **Nothing is marked when the drawing on screen is not the version that ran.** The
   * marks are node ids from the run's own journal, and painting them onto a different
   * graph would be the class of untruth this whole module is written against: the ids
   * that happened to match would light and the rest would silently not. `unreadable` is
   * deliberately not treated the same way — failing to load the pinned bytes says
   * nothing about whether the ids are right, and dropping every mark on a walking run
   * for it would hide the run rather than qualify it. The sentence beside them says
   * which of the two it is.
   */
  const runStates = useMemo(
    () =>
      pinCheck === 'different'
        ? new Map<string, NodeRunState>()
        : markedNodes(watch, endingMarks, graph?.entry),
    [watch, endingMarks, graph?.entry, pinCheck],
  );
  const edgeSet = useMemo(
    () => (pinCheck === 'different' ? new Set<string>() : edgesTakenIn(watch)),
    [watch, pinCheck],
  );

  /**
   * Which node is working, which is not the same question as which node is active.
   *
   * DSP-80's four constraints are all in this one line. The state comes from the run's
   * journal; the phase comes from the loop control, and only when the control's report is
   * about *this* run — a phase left over from a previous one would pause an animation
   * belonging to a run nobody paused, which is DSP-87's mistake one level down. Nothing
   * here reads `watch.steps`, so a step whose agent is thinking in silence goes on
   * showing that it is working.
   */
  const workingNodes = useMemo(() => {
    const phase =
      watch !== null && loopControl.runId === watch.run.runId
        ? controlPhase(loopControl.state)
        : null;
    const working = new Set<string>();
    for (const [nodeId, state] of runStates) {
      if (nodeIsWorking(state, phase)) {
        working.add(nodeId);
      }
    }
    return working;
  }, [runStates, watch, loopControl]);

  /**
   * What the step that is running is doing, in one line, for this window.
   *
   * The same fold and the same sentences the conversation reads — `stepStanding` over
   * `view.steps` — so the graph view and the chat cannot give a person two different
   * answers about one run. `stillWatching` is false once the run has ended, which is
   * what stops a finished run's last step reporting that it is waiting for something.
   */
  const watchedStanding = useMemo(
    () =>
      // Nothing for a loop standing by, and nothing for a run that has ended: the
      // ending has its own account, and "DSpatch is no longer following this run" over
      // a run that finished normally would be alarming and untrue.
      watch === null || watch.ended || viewIsReady(watch)
        ? null
        : stepStanding({
            step: runningStep(watch.steps, watch.run.runId),
            stillWatching: true,
            nowMs,
          }),
    [watch, nowMs],
  );

  return (
    /*
      One grid, one row list, before during and after a run (DSP-86 #2).

      `has-watch` is gone with the banner it made room for. The banner was an extra child
      between the palette and the canvas, so a run starting added a row and took height
      from the graph — the layout changing under a person at the moment they most wanted
      it not to. The only row that still comes and goes is the journal, and that one is
      asked for from a menu.
    */
    <div
      className={`editor${journalOpen ? ' has-journal' : ''}`}
      onMouseUp={() => setDrag(null)}
    >
      <header className="editor-bar">
        {/*
          The title names the drawing on the canvas, and then what the run is doing.

          It used to be two different lines — the author's drawing when there was no run,
          the run's own graph when there was — because those were two different pictures.
          There is one picture now, so there is one line: the same graph named the same
          way throughout, with the run's state appended while there is a run. `runViewState`
          is shared with `describeRunView`, so the header and any sentence about the run
          cannot come to word one state two ways.

          The control's phase goes with it, and only when the control is about *this* run
          (DSP-87, closing what report 024 left open). Without it the line said `running
          now` while the control beside it said `Waiting for you`.
        */}
        <div className="editor-title">
          <h1>Loop editor</h1>
          <p data-ev="editor-title-line">
            {`${graph === null ? 'No graph open' : graph.name}${
              // The loop's name when a declaration was the way in, because that is
              // what the person chose it by; a path alone cannot say which loop
              // this is (DSP-82 #3).
              file === null
                ? ''
                : ` — ${describeOpenedGraph({ displayPath: file.displayPath, definition: file.definition }).title}`
            }${dirty ? ' · unsaved changes' : ''}${
              watch === null
                ? ''
                : ` · ${runViewState(
                    watch,
                    loopControl.runId === watch.run.runId
                      ? controlPhase(loopControl.state)
                      : null,
                  )}`
            }`}
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
          {/*
            Where a loop is chosen, and the only place it is (DSP-85 #1 and #2).

            This replaces four controls: `Open the loop that will run`, `Use this loop`,
            `Open our Cursor process drawing`, and the chat's own dropdown. All four
            existed because drawing a loop and choosing one were different acts, and
            Niclas's verdict on the result was that there were too many ways to say the
            same thing. Picking a row here does both, so there is one control and one act.

            **The value is the stored choice, not a copy of it.** `chosenLoop` comes from
            the row `listLoopDefinitions` marks `preselected`, which is the same answer a
            mandate with no explicit key resolves. That is what lets this dropdown *be* the
            window's statement of what will run — and what makes it keep showing the chosen
            loop when the canvas is displaying a graph file opened from the File menu,
            since such a file is not a loop and cannot have been chosen as one (#6).

            **Locked while a run is walking** (DSP-86 #3), which reverses DSP-84's decision
            to leave it live. That decision was sound when choosing only decided the *next*
            run: lining one up while watching another is a reasonable thing to want. Since
            DSP-85 choosing also redraws the canvas, and redrawing the canvas under a
            walking run is the one thing this view must not do — the marks on screen belong
            to the graph that is running, and swapping the graph beneath them would leave
            them landing on whatever node ids happened to match. The lock lifts by itself
            when the run ends (#5), so nothing has to be pressed to choose again.
          */}
          <label className="editor-loop" title={describeLoopChooser()}>
            Loop
            <select
              data-ev="editor-loop-definition"
              value={chosenLoop?.key ?? ''}
              disabled={choosing || locked}
              title={
                locked
                  ? 'A run is walking this loop. The choice unlocks by itself when it ends.'
                  : undefined
              }
              /*
                The control is put back when the switch did not happen (DSP-88 #2).

                A `<select>` changes itself the moment it is used, before the handler has
                decided anything — so a refusal, a failure or a *Cancel* at the
                unsaved-drawing question would leave this row displaying a loop that was
                never adopted, which is the obvious way for this card's fix to lie. React
                does reset a controlled value on its next render and every path through
                `chooseLoop` causes one, but a guarantee that rests on a framework's
                reconciliation of a prop whose value did not change is not one to hang
                this on. `chosenLoop` is the render's own selection, which is exactly what
                the control should be showing again.
              */
              onChange={(event) => {
                const chooser = event.currentTarget;
                if (chooser.value === '') {
                  return;
                }
                void chooseLoop(chooser.value).then((outcome) => {
                  if (outcome === 'unchanged') {
                    chooser.value = chosenLoop?.key ?? '';
                  }
                });
              }}
            >
              {loopChoices === null ? (
                <option value="">Looking for loop definitions …</option>
              ) : loopChoices.choices.length === 0 ? (
                <option value="">No loop definition found</option>
              ) : null}
              {/*
                `describeDefinitionRow`'s own fields, passed through. A declaration that
                did not load is listed, unselectable, with its finding as the title,
                because a definition that vanished from the list would look exactly like
                one nobody wrote.
              */}
              {(loopChoices?.choices ?? []).map((choice) => (
                <option
                  key={choice.key}
                  value={choice.key}
                  disabled={!choice.usable}
                  title={choice.display.error ?? choice.display.dependency ?? undefined}
                >
                  {choice.display.name} · {choice.display.origin}
                  {choice.usable ? '' : ' — will not load'}
                </option>
              ))}
            </select>
          </label>
          {/*
            DSP-85 #3. A declaration filed outside every open folder — which is how the
            standalone development loop arrives — joins the list above and becomes the
            selection, through the same handler and the same judgement the dropdown uses.
            It starts nothing.
          */}
          <button
            type="button"
            data-ev="open-loop-definition"
            disabled={choosing || locked}
            title={
              locked
                ? 'A run is walking. The choice unlocks by itself when it ends.'
                : 'Choose a .loop.json from anywhere. It joins the list beside this button, is drawn here, and becomes the loop the next mandate walks. It starts nothing.'
            }
            onClick={() => void chooseLoop(null)}
          >
            Open loop…
          </button>
          <button
            type="button"
            disabled={graph === null || !dirty || locked}
            title={
              locked
                ? 'A run is walking this drawing, and it keeps the version it started with. Saving unlocks by itself when the run ends.'
                : undefined
            }
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
                : locked
                  ? 'A run is already walking this drawing. A second walk would put its own marks on the same nodes. This unlocks by itself when the run ends.'
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
          {/*
            The `Next:` chip that used to be here is gone with DSP-85's other three
            controls. It named the selection because the editor could hold a definition
            open without having chosen it, and the dropdown above is now the selection
            itself — a chip repeating its current row is the second voice this card removes.
          */}
          {/*
            Why the last choice did not take (DSP-85 #8).

            Beside the findings rather than in the status line at the bottom, because it
            belongs to the control that refused, and it is short on purpose: a broken graph
            produced fifteen lines of findings here in DSP-84's trial, and the dropdown's
            neighbour is not where a finding list belongs. The hover carries the whole of
            `judgeChosenLoop`'s brief, including the sentence naming what is still selected.
          */}
          {choiceError === null ? null : (
            <span
              className="chip chip-live-off"
              data-ev="editor-choice-error"
              title={choiceError}
              role="status"
            >
              Not chosen
            </span>
          )}
          {unsavedAgainstChoice === null ? null : (
            <span
              className="chip chip-live-off"
              data-ev="editor-unsaved-against-choice"
              title={unsavedAgainstChoice}
            >
              {/*
                DSP-86 wrote `a run will ask first`. DSP-88 made three more gestures ask,
                so the chip names the protection rather than one of the things it covers:
                a person reading `a run will ask first` would reasonably conclude that
                choosing another loop does not, which is what DSpatch did until this card.
                The full sentence is the hover.
              */}
              Unsaved · nothing takes this without asking
            </span>
          )}
          {/*
            What the run pinned, when it is not what is drawn (DSP-86).

            Absent in the ordinary case, which is now nearly every case, and that absence
            is the point: the paragraph this replaces explained on every single run that
            the canvas was the run's drawing and the author's would come back. Choosing
            draws (DSP-85), starting against unsaved edits asks first, and editing is
            locked while a run walks, so the three ways the two drawings could drift apart
            are each closed at the source. What is left is the case where they really have
            drifted — a graph file opened from the File menu, most plainly — and then the
            window says so rather than marking a graph nobody is running.
          */}
          {pinnedDrawing === null ? null : (
            <span
              className="chip chip-warning"
              data-ev="editor-pinned-drawing"
              title={pinnedDrawing}
              role="status"
            >
              {pinCheck === 'unreadable'
                ? 'Pinned version unreadable'
                : 'Not the drawing on screen'}
            </span>
          )}
          {/*
            Findings are about the drawing, which is on screen throughout now — so unlike
            DSP-28's arrangement they are not hidden during a run. They were hidden because
            the canvas then belonged to somebody else's graph and counting its errors would
            have been counting the wrong file's. That is no longer the situation: it is the
            author's own drawing, and a person reading a node during a run is entitled to
            the same account of it they had a minute earlier.
          */}
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
        {/*
          The palette itself steps aside while a run walks, and the run's controls take
          the row (DSP-86 #2 and #3).

          Not a second view, and not a panel: the same row, the same height, the same
          place on screen. What changes is what is in it, and what was in it was seven
          buttons a person cannot press — editing is locked — beside a title reading
          *Place*. Leaving them there greyed and squeezing Pause and Continue in beside
          them is how the first walk of this card cost the drawing 110 pixels; the row is
          height-fixed now, so the choice is between showing the run's controls and
          showing dead buttons with the controls scrolled off the end.
        */}
        {locked ? (
          <span className="editor-palette-title">Editing is held while this run walks</span>
        ) : (
          <>
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
          </>
        )}
        {/*
          The run's own controls, at the right-hand end of the row the palette is in.

          **Here because the height of this row never changes.** The first walk of DSP-86
          put these in the header's chip strip, which wraps — and the reading taken either
          side of a run starting showed the canvas losing 110 pixels of height the moment
          one did. Taking height off the drawing to make room for run chrome is the thing
          this card exists to stop; that it happened in a control strip rather than in a
          banner would not have made it better. This row is `height`-fixed in the
          stylesheet, so a run arriving cannot move the grid however much it puts here.

          And it is the right *space*: while a run walks, every button to the left of this
          is disabled, so what fills is a row that has nothing else to do. `compact` folds
          the control's two paragraphs into hovers for the same reason — see LoopControlBar.

          `loopIntended` is false because this window has an editor to be when nothing is
          running. The controls appear with the run and go with it.
        */}
        <div className="editor-palette-run">
          <LoopControlBar report={loopControl} loopIntended={false} compact />
          {watchedStanding === null ? null : (
            <span
              className={`chip editor-watch-standing-${watchedStanding.standing}`}
              data-ev="watch-standing"
              data-standing={watchedStanding.standing}
              data-activity-known={String(watchedStanding.activityIsKnown)}
              title={watchedStanding.text}
              role="status"
            >
              {watchedStanding.standing === 'confirmed'
                ? 'Step working'
                : watchedStanding.standing === 'waiting'
                  ? 'Step quiet'
                  : 'Activity unknown'}
            </span>
          )}
          {watchNote === null ? null : (
            <span className="chip chip-warning" data-ev="watch-note" title={watchNote}>
              About this run
            </span>
          )}
        </div>
      </div>

      {/*
        The run banner that used to sit here is gone (DSP-86 #1 and #7).

        It carried a short line about the run, a disclosure headed *Which run this is, and
        why it is locked*, a standing line, a row of state counts, the loop control and
        **Leave the run view**. All of it described a view the person had been switched
        into; with no switch there is nothing to introduce, explain or leave. What was
        worth keeping went into the control strip above — the run's state on the title
        line, the standing as a chip, the control as itself — and the rest went with the
        view it belonged to.
      */}

      <main className="editor-main">
        <div className="editor-canvas">
          {graph === null ? (
            <RefusalPanel findings={refusal} />
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

              {/*
                Selection and severity are **not** suppressed while a run walks, which
                DSP-28 did because the drawing then belonged to the run rather than to the
                author. It is the author's own drawing throughout now, and DSP-86 #3 asks
                for exactly this: selecting a node and reading what it is told still works
                while the run is going. Editing is what the lock holds, and the lock is
                enforced in `onCanvasClick` and `onNodeMouseDown` where a change would be
                made — not by taking the highlighting away.
              */}
              {graph.edges.map((edge) => (
                <EdgeShape
                  key={edge.id}
                  edge={edge}
                  graph={graph}
                  selected={selection?.kind === 'edge' && selection.id === edge.id}
                  highlighted={
                    selection?.kind === 'node' &&
                    (edge.from === selection.id || edge.to === selection.id)
                  }
                  showLabel={showLabels}
                  taken={edgeSet.has(edge.id)}
                  severity={worstSeverity(index.byEdge.get(edge.id) ?? [])}
                  onSelect={() => {
                    setSelection({ kind: 'edge', id: edge.id });
                  }}
                />
              ))}

              {graph.nodes.map((node) => (
                <NodeShape
                  key={node.id}
                  node={node}
                  role={node.role ? (roles.get(roleKey(node.role)) ?? null) : null}
                  isEntry={graph.entry === node.id}
                  selected={selection?.kind === 'node' && selection.id === node.id}
                  connecting={connectFrom === node.id}
                  runState={nodeRunStateFor(runStates, node.id)}
                  working={workingNodes.has(node.id)}
                  ending={endingMarkFor(endingMarks, node.id)}
                  severity={worstSeverity(index.byNode.get(node.id) ?? [])}
                  helpTitle={showHelp ? nodeHelpText(node) : undefined}
                  onMouseDown={(event) => onNodeMouseDown(event, node)}
                />
              ))}
            </svg>
          )}
        </div>

        {/*
          One inspector, before during and after (DSP-86 #1 and #10).

          `WatchedRunInspector` — *The run on screen*, the node list and *What the words
          mean* — used to replace this whole panel while a run was locked. It is gone: the
          node list repeated what the canvas was already drawing, the legend explained a
          vocabulary the marks carry as words anyway, and both of them arrived by taking
          away the panel a person was reading. The node panel keeps its Markdown role text
          and its collapsed **Advanced**, and works during a run with its fields disabled.
        */}
        <aside className="editor-inspector">
          {/*
            The lock, as one element rather than as a `disabled` on forty fields.

            `fieldset[disabled]` is the browser's own rule and it reaches every control
            inside it, which is why this cannot drift the way a hand-maintained list of
            disabled props would: a field added to an inspector next year is locked by
            having been added. What it does **not** reach is anything that is not a form
            control — the Markdown role text, the finding list, the `<details>` holding
            **Advanced** — so the panel stays fully readable during a run, opens and
            closes, and scrolls (#10).
          */}
          <fieldset className="inspector-lock" disabled={locked} data-ev="inspector-lock">
          {graph === null ? (
            <p className="muted">
              Nothing is open. The <strong>Loop</strong> chooser above lists the loops
              declared in the folders DSpatch has open; picking one draws it here and
              makes it the loop the next mandate walks, in one act, and starts nothing.{' '}
              <strong>Open loop…</strong> reaches a declaration filed anywhere else and
              adds it to that same list. To edit a graph file on its own, use{' '}
              <strong>File → Open Graph File…</strong>: a .graph.json has no declaration
              behind it, so it is not a loop and opening one leaves the chosen loop
              exactly where the chooser says it is.
            </p>
          ) : selectedNode !== null ? (
            <NodeInspector
              graph={graph}
              node={selectedNode}
              role={selectedNode.role ? (roles.get(roleKey(selectedNode.role)) ?? null) : null}
              findings={index.byNode.get(selectedNode.id) ?? []}
              help={showHelp}
              // Where the graph's role paths are measured from: the definition's
              // resource root when a definition was the way in, which for a loop
              // declared outside DSpatch is not this repository (DSP-82).
              resourceRoot={file?.projectRoot ?? null}
              onNote={setNote}
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
          </fieldset>
        </aside>
      </main>

      {/*
        Diagnostics, when asked for, and never otherwise (#8 and #9).

        Same component, same entries, same raw log. What changed is that it no longer
        opens itself: `View → Run journal (diagnostics)` is what puts it on screen, and
        the same item takes it away again.
      */}
      {journalOpen ? (
        <RunJournal
          summary={runSummary}
          refuse={runRefuse}
          busy={runBusy}
          kind={runKind}
          liveEntries={watch?.entries ?? []}
        />
      ) : null}

      {/*
        The author's own commentary, and only that.

        While a run was watched this line used to be replaced by a sentence about the
        run's graph version and about the author's drawing coming back — the footnote the
        card removes. There is nothing to replace it with, because nothing about the
        canvas has changed: what was opened, placed and saved is still what happened here.
      */}
      <footer className="editor-note" data-ev="editor-note">
        {note}
      </footer>

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
 * Removed by DSP-86, with the view they introduced.
 *
 * `RunWatchBanner` and `WatchedRunInspector` were the separate run view: a banner
 * carrying the run's identity, its lock, an explanation of the lock and **Leave the run
 * view**, and a panel replacing the inspector with *The run on screen*, a list of every
 * node's state and *What the words mean*. Both were good answers to the question *how
 * does a person read a run in a view they have been switched into*. The card's answer is
 * that there is no such view: the graph, the layout and the node panel are the same
 * before, during and after, the marks on the drawing say what is happening, and the chat
 * carries the activity and the replies.
 *
 * What was worth keeping moved rather than went. The run's state is on the title line
 * through `runViewState`; the standing line is a chip in the control strip reading the
 * same `stepStanding` fold; `LoopControlBar` is in that strip too. The node list and the
 * legend are not restated anywhere, because the canvas was already drawing both — each
 * node carries its own mark as a word, which is where `NODE_RUN_STATE_MARKS` is read.
 */

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
      <h2>
        {busy
          ? `${kind === 'live' ? 'Live' : 'Dry-run'} in progress`
          : liveEntries.length > 0 && summary === null
            ? 'This run so far'
            : 'Last run'}
      </h2>
      {refuse === null ? null : <p className="journal-refuse">{refuse}</p>}
      {/*
        A run this window is only watching has no summary and no local `busy`, so this
        pane used to be an empty titled box under the graph — space taken from the
        drawing to say nothing. The run's own entries are what it has, so they are what
        it shows.
      */}
      {!busy && summary === null && refuse === null ? (
        liveText === '' ? (
          <p className="muted">Nothing has been written to this run&apos;s journal yet.</p>
        ) : (
          <pre>{liveText}</pre>
        )
      ) : busy && summary === null ? (
        <>
          {/*
            One line, not a paragraph defending the wait.

            The sentence this replaces explained that the first step can take several
            minutes, which is a general fact about agents rather than a statement about
            this run — and a person who has waited five minutes has already learned it.
            The status line above the canvas says what is actually happening.
          */}
          <p className="muted">
            {kind === 'live' ? 'Walking the graph in an isolated experiment repository.' : 'Walking the graph on the canvas.'}
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

/**
 * Why there is no drawing on the canvas.
 *
 * The `watching` branch is gone with DSP-86. It existed because the canvas was replaced
 * by the run's own drawing, so a run whose announced bytes would not load left the view
 * with nothing to show and a Try again button to reload them. The canvas is never the
 * run's drawing now, so a pinned version that cannot be read takes nothing off screen —
 * it costs the *comparison*, and `describePinnedDrawing` says that in one chip instead
 * of replacing the graph with an apology.
 */
function RefusalPanel({
  findings,
}: {
  readonly findings: readonly Finding[] | null;
}): React.JSX.Element {
  if (findings === null) {
    return (
      <div className="refusal">
        <h2>No graph open</h2>
        <p>
          Pick a loop from the chooser above — that draws it and selects it for the next
          mandate together — or reach one filed elsewhere with “Open loop…”. A graph file
          on its own opens from File → Open Graph File… and chooses nothing.
        </p>
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
  working,
  ending,
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
  /**
   * Whether the glint runs on this node (DSP-80).
   *
   * Passed in rather than derived from `runState`, because the two are different
   * questions: a node held at a pause is still `active` and is not working, and
   * `nodeIsWorking` in `shared/loop-run-view.ts` is where the difference is decided.
   */
  readonly working: boolean;
  /** The ending this run reached, on the one node that reached it (DSP-36). */
  readonly ending: EndingMark | null;
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
    working ? 'node-working' : '',
    ending === null ? '' : 'node-ended-here',
    ending === 'success' ? 'node-ended-met' : '',
    severity === null ? '' : `node-${severity}`,
  ]
    .filter((entry) => entry !== '')
    .join(' ');

  const broken = node.role !== undefined && role === null;
  /*
    The node's own outline, as a path, for the halo and the glint (DSP-80).

    A path and not a second `<rect>`, because the glint is a dash travelling the outline
    and a dash needs a length: `pathLength={GLINT_PATH_LENGTH}` makes the browser measure
    this shape and scale every dash and offset to it, so one stylesheet rule works for a
    54-pixel pill, a 6-pixel-cornered box and a diamond without any of them being
    measured here. It also means the corners are not a special case — a dash following a
    path follows it round an arc, which is what "including around the corners" asks for.

    `nodeOutlinePath` shares its corner radius with the `<rect>` below, so the glint
    traces the border rather than something near it.
  */
  const outline = nodeOutlinePath(node.kind);

  return (
    <g
      className={classes}
      // The state as a word, beside the class that colours it. A trial reading the
      // liveness off class names would be asserting the stylesheet's vocabulary; this
      // is the same value `nodeRunStateFor` returned, which is the thing that decides.
      data-node-id={node.id}
      data-run-state={runState}
      // Read by the window trial, and each of these is a decision rather than a class
      // name: whether the working animation is running, and which ending this node is.
      // `data-run-ending` is `success` only where the *graph* declares it, so a trial can
      // establish that renaming a terminal does not earn a tick.
      data-run-working={working ? 'true' : 'false'}
      data-run-ending={ending ?? ''}
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
        <title>{`${node.label ?? node.id}: ${mark.label}${
          ending === null
            ? ''
            : ending === 'success'
              ? ' — the run ended here, at the terminal this loop declares as the assignment being met'
              : ' — the run ended here, and this loop does not declare arriving here as the assignment being met'
        }${helpTitle === undefined ? '' : ` — ${helpTitle}`}`}</title>
      )}
      {/*
        The halo, under the body so only its outer half shows (DSP-80).

        This is the strengthened pulse. The old one dimmed the whole body between 1 and
        0.55 opacity, which on a 168×54 box a person is not looking at reads as almost
        nothing — and the obvious way to make it clearer, more opacity swing or a heavier
        border, is the way to make it flicker. So the amplitude went into a soft ring of
        the state's own colour instead: a wide, low-opacity stroke on the node's own
        outline, breathing between two opacities and drawn *before* the body so the body's
        fill covers the inner half and what is left is a glow outside the border. The
        border itself and the word beside it do not move.

        **Opacity only, and never the width.** A ring that grew and shrank would be the
        clearer pulse and it would also be the node appearing to change size, which is
        the one thing the card forbids. It is off entirely for a node that is neither
        ready nor on the run's path, so an ordinary drawing carries no extra ink.
      */}
      <path className="node-halo" d={outline} pathLength={GLINT_PATH_LENGTH} />
      {node.kind === 'router' ? (
        <polygon
          points={`${String(NODE_WIDTH / 2)},0 ${String(NODE_WIDTH)},${String(NODE_HEIGHT / 2)} ${String(NODE_WIDTH / 2)},${String(NODE_HEIGHT)} 0,${String(NODE_HEIGHT / 2)}`}
          className="node-body"
        />
      ) : (
        <rect
          width={NODE_WIDTH}
          height={NODE_HEIGHT}
          rx={nodeCornerRadius(node.kind)}
          className="node-body"
        />
      )}
      {/*
        The glint: one continuous gradient travelling the outline.

        Niclas tried the four-dash version and read it as what it was — separate bright
        marks of differing intensity. The motion was right and is untouched; what changed is
        how the light is distributed along it. `glintSegments()` cuts one ramp into pieces
        that touch end to end, cut at equal steps of brightness rather than of length, so
        the seams fall where the eye is least able to find them. Its doc comment carries the
        reasoning; the numbers are there and not here so they can be unit-tested.

        Each piece carries its own dash pattern, width, colour and alpha as **attributes**,
        which is deliberate: a presentation attribute loses to any stylesheet rule, so the
        reduced-motion block can still take the whole gradient away and put a still ring in
        its place without needing `!important`.

        Rendered only while the node is working. The pieces are many and they mean exactly
        one thing — *an agent is doing something now* — so a drawing where nothing is
        working carries none of them. The halo is drawn unconditionally and traces the same
        path, so the group's bounding box does not move either way.

        Drawn after the body, because the head is meant to read as light on the border
        rather than under it; `pointer-events: none` keeps them from changing what a click
        on a node hits.
      */}
      {working
        ? glintSegments().map((segment, index) => (
            <path
              key={index}
              className={`node-glint node-glint-${String(index)}`}
              d={outline}
              pathLength={GLINT_PATH_LENGTH}
              strokeDasharray={segment.dashArray}
              strokeWidth={segment.width}
              stroke={segment.colour}
              opacity={segment.alpha}
            />
          ))
        : null}
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
      {/*
        Where the run ended, and whether this loop calls that the assignment being met.

        Both endings are marked and only one of them is a tick, which is the whole of
        DSP-36's second half. The tick is the graph's `ending: "success"` and nothing else:
        `endingMarkFor` reached it through the run's recorded terminal and the terminal's
        own declaration, so a drawing that renames *Assignment not met* to *Delivered* gets
        the ring, and one whose success terminal is labelled `x7` gets the tick.

        A ring rather than a cross for the other endings, because the run ending somewhere
        else is not a failure to report — *could not establish* is an honest outcome, and a
        red cross on it would say something the run did not. The word beside it already
        says which: `done`, `failed` or `stopped` from the state's own mark.

        Top left, where nothing else is drawn: the state's word is bottom right, the
        findings dot is top right, `entry` is bottom left, and both labels are centred.
      */}
      {ending === null ? null : ending === 'success' ? (
        <path className="node-ending-tick" d="M 9 10.5 L 12.6 14.5 L 19.5 4.5" />
      ) : (
        <circle className="node-ending-ring" cx={14} cy={9.5} r={5} />
      )}
      {severity === null ? null : <circle cx={NODE_WIDTH - 9} cy={9} r={4} className="node-mark" />}
    </g>
  );
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * What actually acts on a setting, in three states rather than two.
 *
 * DSP-83 #7. The old badge had one: *not honoured yet · DSP-18*. That conflated two
 * genuinely different things and disclosed a third not at all.
 *
 * - **inert** — recorded and nothing acts on it. The number in the box changes nothing.
 * - **limited** — something acts on it, with a boundary worth knowing. `archive` is
 *   honoured and a dry run still files nothing; `role` is sent by the chat loop and not
 *   by the editor's Run.
 * - **stated** — in force as an instruction the agent is expected to follow, and not as
 *   anything the platform applies. This is the one the requirements list needs, because
 *   the format calls every requirement "required" while what holds one varies: on a run
 *   DSpatch walks, `no-file-writes` and `no-subagent-delegation` are both sentences in a
 *   role file. `readonly: true` enforces the first only for an agent Cursor starts from a
 *   generated definition, which is not this path — the badge takes that from
 *   `requirementStandings`, which asks the capability table which path it is on.
 *
 * The backlog number stays in the tooltip. A person reading the panel wants to know
 * whether the box does anything, not which card will make it.
 */
function Unhonoured({
  attribute,
  stated,
}: {
  readonly attribute?: string;
  /** Set to the mechanism — or to its absence — where the thing holds only by instruction. */
  readonly stated?: string;
}): React.JSX.Element | null {
  if (stated !== undefined) {
    return (
      <span className="support support-stated" title={stated}>
        stated, not enforced
      </span>
    );
  }
  const support = attribute === undefined ? null : attributeSupport(attribute);
  if (support === null) {
    return null;
  }
  if (!support.honoured) {
    return (
      <span className="support support-inert" title={`Nothing acts on this yet. Waiting on: ${support.by}`}>
        recorded, nothing acts on it
      </span>
    );
  }
  if (support.caveat === undefined) {
    return null;
  }
  return (
    <span className="support support-limited" title={`${support.by} ${support.caveat}`}>
      honoured, with limits
    </span>
  );
}

/**
 * A section folded away until asked for.
 *
 * `<details>` rather than a state hook, so the browser owns open and closed and the
 * scripted window trial can read `open` off the element instead of inferring it from
 * what happens to be visible.
 */
function Advanced({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <details className="advanced" data-ev="node-advanced">
      <summary>{summary}</summary>
      <div className="advanced-body">{children}</div>
    </details>
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

/**
 * What one node is, in the order a person needs it.
 *
 * DSP-83 rewrote this panel after Niclas used it. What he met was a path and the words
 * *Role description resolved*, which tells nobody what the agent will be told, above
 * eight fieldsets of the format's own vocabulary. So the order here is the order of the
 * questions: what is this step for, who performs it and in whose words, what is it
 * handed, what must it leave — and only then the settings, folded away.
 *
 * **The role is shown as the agent gets it.** `ResolvedRole.instructions` is the same
 * string `chatRoleTextFor` puts between the markers in the prompt (`loop-chat.ts`,
 * `rolePreamble`), resolved by the same resolver, so this is not a second reading of the
 * file that could drift from the one that is sent. It is rendered with the window's own
 * Markdown reader, which produces React elements and never HTML.
 *
 * **What is in the message is separated from what is only pointed at.** That is
 * {@link briefParts}, which lives beside the function that builds the prompt for exactly
 * this reason, and {@link BRIEF_EXCLUSIONS} for the standing answer: the files a role
 * text names are files the agent has to open itself.
 */
function NodeInspector({
  graph,
  node,
  role,
  findings,
  help,
  resourceRoot,
  onNote,
  onChange,
  onDelete,
}: {
  readonly graph: LoopGraph;
  readonly node: LoopNode;
  readonly role: ResolvedRole | null;
  readonly findings: readonly Finding[];
  readonly help: boolean;
  /** Where this graph's role paths are measured from, or `null` when nothing is open. */
  readonly resourceRoot: string | null;
  readonly onNote: (note: string) => void;
  readonly onChange: (next: LoopNode) => void;
  readonly onDelete: () => void;
}): React.JSX.Element {
  const model: ModelPolicy = node.model ?? { policy: 'inherit' };
  const effect = kindEffect(node.kind);
  const instructions = role?.instructions?.trim() ?? '';
  const outcomes = outcomeStandings(graph, node);
  const undeclared = undeclaredStanding(graph, node);
  const failures = failureStandings(graph, node);
  const limits = limitStandings(node, graph.limits);
  const requirements = requirementStandings(node, role, graph.target, REQUIREMENTS);
  const inherited = requirements.filter((standing) => standing.fromRole);
  const parts = briefParts(node, {
    entryId: graph.entry,
    role:
      role === null
        ? null
        : { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions ?? null },
    workingRootCount: null,
    producedBy: (id) => {
      const other = nodeById(graph, id);
      return other?.produces === undefined
        ? null
        : { form: other.produces.form, label: other.label ?? other.id };
    },
    archivePath: graph.archive?.path ?? null,
    reportWrittenBy: node.report?.writtenBy ?? null,
    // Every edge that leads here, so "what earlier steps left for it" can say *which
    // arrival* (DSP-100). Without them the panel would show one list for a step that is
    // handed different material depending on the route the run took to reach it.
    arrivals: graph.edges.filter((edge) => edge.to === node.id),
  }).filter((part) => part.present);

  return (
    <div className="inspector">
      <h2>
        {node.label ?? node.id}
        {graph.entry === node.id ? <span className="entry-tag">the run starts here</span> : null}
      </h2>
      <p className="kind-line">
        {KIND_LABELS[node.kind]} · <code>{node.id}</code>
        {node.role === undefined ? null : role === null ? (
          <span className="broken">its role resolves to nothing</span>
        ) : (
          <span className="resolved">{role.id}</span>
        )}
      </p>
      {/* Errors stay where they are read. Only the notices moved into Advanced. */}
      <FindingList findings={findings.filter((finding) => finding.severity !== 'notice')} />

            <label title={help ? nodeHelpText(node) : undefined}>
              What this step does
              {/*
                Three rows, not five. The box scrolls and the same text is in the tooltip,
                so the two extra rows bought nothing and cost two lines of the role text
                below — which is the thing this panel exists to show.
              */}
              <textarea
                rows={3}
                data-ev="node-purpose"
          value={node.purpose ?? ''}
          onChange={(event) => onChange({ ...node, purpose: event.target.value || undefined })}
        />
      </label>
      {/*
        Where this text lands, per kind, because it lands in more than one place and one
        of them is a prompt. An agent is *sent* it; a person at a human step is *asked*
        it; at a terminal nobody is. Changing it as though it were only a tooltip is what
        this sentence exists to prevent.
      */}
      <p className="muted" data-ev="node-purpose-goes">
        {effect.purposeGoes}
      </p>
      {effect.withoutEffect.length === 0 ? null : (
        <ul className="no-effect" data-ev="node-without-effect">
          {effect.withoutEffect.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      )}

      {/*
        The role, second, because the task above says what this step is for and the role
        says who is doing it — and both are read before any setting. Shown for the three
        kinds the format lets bind one; whether it is *sent* is a separate question, and
        `kindEffect` answers it above rather than letting the heading imply it.
      */}
      {node.kind === 'agent' || node.kind === 'gate' || node.kind === 'external' ? (
        <section className="role-block">
          <h3>
            <span>
              The role it performs
              {role === null || instructions === '' ? null : effect.callsAnAgent ? (
                <em> — every word of it is in the message, before the task</em>
              ) : (
                <em> — read by people only: no message is built for this kind</em>
              )}
            </span>
            {node.role === undefined || role === null ? null : (
              <button
                type="button"
                className="link"
                data-ev="node-role-open"
                onClick={() => {
                  if (resourceRoot === null) {
                    onNote('There is no open loop, so there is no folder to measure the role path from.');
                    return;
                  }
                  void window.dspatch
                    .revealRoleSource({ root: resourceRoot, path: role.sourcePath })
                    .then((outcome) => {
                      onNote(outcome.note);
                    });
                }}
              >
                Open {role.sourcePath}
              </button>
            )}
          </h3>
          {node.role === undefined ? (
            <>
              <p className="muted">
                This node names no role, so nothing about who is doing the work would reach the
                agent. An agent node is not valid without one.
              </p>
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
            </>
          ) : role === null ? (
            <p className="broken-note">
              Nothing was found at <code>{node.role.source.path}</code>, measured from{' '}
              <code>{resourceRoot ?? 'the loop’s own folder'}</code>. An agent with no description is
              an agent that will be handed whatever the runner happens to have, so the run is refused
              before it starts. Fix the path in Advanced below, or write the file.
            </p>
          ) : (
            <>
              <p className="muted">
                {role.summary === undefined
                  ? 'The file states no one-line summary of itself.'
                  : role.summary}{' '}
                Supports {role.targets.join(', ')}
                {role.targetsDeclared
                  ? ', declared in the file'
                  : ', inferred from the kind of file it is rather than declared'}
                .
              </p>
              {instructions === '' ? (
                <p className="broken-note">
                  The file was read and DSpatch found no instructions in it beyond its name, so the
                  agent would be told only that this role was named. That is a file to fix rather than
                  a reference to change.
                </p>
              ) : (
                // The file's own text, rendered. Said in the heading rather than in a
                // paragraph here: a sentence above the box is a sentence of the box pushed
                // off the screen, and the box is what was asked for.
                <div className="role-text" data-ev="node-role-text">
                  <Markdown text={instructions} />
                </div>
              )}
            </>
          )}
        </section>
      ) : null}

      {effect.callsAnAgent ? (
        <section className="brief-block">
          <h3>What the message to this step contains</h3>
          {/*
            Which claim this section is making, said once (DSP-94).

            Everything below is built from the drawing **as it stands in this window** and
            from the role files as they are on disk now. It is what a run started from here
            would send. It is not what any run that has already walked was sent: a run pins
            its graph and its roles when it starts, and the message it actually built is
            kept with its own step in the conversation. Two different claims, and a reader
            who has to guess which one they are looking at is being misled by a panel that
            is otherwise exact.
          */}
          <p className="muted" data-ev="node-brief-scope">
            The drawing as it stands here, so this is what a run started now would send. A run
            that has already walked kept the version it started with — what one of its steps was
            actually given is on that step in the conversation, under “The message this step was
            sent”.
          </p>
          <dl className="brief" data-ev="node-brief">
            {parts.map((part) => (
              <div key={part.id} className={part.carried ? 'brief-in' : 'brief-named'}>
                <dt>
                  {part.heading}
                  <span className="brief-tag">{part.carried ? 'in the message' : 'pointed at, not included'}</span>
                </dt>
                <dd>
                  {part.detail}
                  {/*
                    The instruction itself, where DSpatch is the one who wrote it.

                    `pre` rather than the Markdown reader: this is the string the provider
                    receives, and rendering it as Markdown would show a person something
                    the agent is not sent. Selectable and copyable, so it can be compared
                    with a run's saved prompt character for character.
                  */}
                  {part.text === undefined ? null : (
                    <pre className="brief-text" data-ev={`node-brief-${part.id}-text`}>
                      {part.text.join('\n\n')}
                    </pre>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <h3>What it never contains</h3>
          <ul className="muted" data-ev="node-brief-excluded">
            {BRIEF_EXCLUSIONS.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          {/*
            What the step may actually do, which is not in the message at all (DSP-94, F6).

            A run-level fact and not a node field, so it sits after the brief rather than
            inside it, and it reads the constant the adapter is given rather than a second
            statement of the same choice.
          */}
          <h3>What the step may do while it works</h3>
          <p className="muted" data-ev="node-tool-policy">
            {describeRunToolPolicy()}
          </p>
        </section>
      ) : null}

      <Advanced summary="Advanced — settings, limits and routing">
        <label>
          Name, as it is drawn
          <input value={node.label ?? ''} onChange={(event) => onChange({ ...node, label: event.target.value })} />
        </label>
        <label>
          Id, used by edges and by <code>consumes</code>
          <input value={node.id} onChange={(event) => onChange({ ...node, id: event.target.value })} />
        </label>
        <label>
          Kind
          <select value={node.kind} onChange={(event) => onChange({ ...node, kind: event.target.value as NodeKind })}>
            {NODE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]} — {KIND_HINTS[kind]}
              </option>
            ))}
          </select>
        </label>

        {node.role === undefined ? null : (
          <fieldset>
            <legend>Where the role is read from</legend>
            <label>
              Role id, which must match the name inside the file
              <input
                value={node.role.id}
                onChange={(event) => onChange({ ...node, role: { ...node.role!, id: event.target.value } })}
              />
            </label>
            <label>
              Kind of file
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
              Path, measured from <code>{resourceRoot ?? 'the loop’s own folder'}</code>
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
          </fieldset>
        )}

        <fieldset>
          <legend>
            Which model runs it{' '}
            {/*
              The one node where this box is not inert (DSP-94, from DSP-92's F7).

              `main.ts` computes `modelForChatNode(entryNode, session.modelRequested)` and
              passes that single value to every session the run opens, so a fixed model on
              the entry step silently sets the model for the whole run. On every other node
              `node.model` is read nowhere on the live path, which is what the table says.
              The error direction mattered: the panel under-promised exactly where the
              effect was largest.
            */}
            {graph.entry === node.id && model.policy === 'fixed' ? (
              <span
                className="support support-limited"
                data-ev="node-model-reach"
                title="A run started from the chat reads this node's fixed model and opens every step's session with it."
              >
                applied — to every step
              </span>
            ) : (
              <Unhonoured attribute="model" />
            )}
          </legend>
          <label>
            Choice
            <select
              value={model.policy}
              onChange={(event) =>
                onChange({ ...node, model: { ...model, policy: event.target.value as ModelPolicy['policy'] } })
              }
            >
              <option value="inherit">Whatever the run is using</option>
              <option value="fixed">One named model</option>
              <option value="described">Described, for a person to apply</option>
            </select>
          </label>
          {model.policy === 'fixed' ? (
            <label>
              The model, as {graph.target} names it
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
          <p className="muted" data-ev="node-model-note">
            {graph.entry === node.id
              ? 'This node is where a run starts, and that makes this box the exception. One named ' +
                'model here becomes the model for every step of a run started from the chat, not ' +
                'only for this one: the run reads the entry step’s choice once and opens every ' +
                'session with it. Left on “Whatever the run is using”, the run uses the model ' +
                'chosen beside the composer. A run started with Run in this window uses DSpatch’s ' +
                'own default and reads nothing from here.'
              : 'Recorded and not applied. Which model this step runs on comes from the run, not ' +
                'from here, and how a per-step choice would be made has not been decided. The one ' +
                'box that does change something is the same box on the entry step, whose named ' +
                'model becomes the model for every step of the run.'}
          </p>
        </fieldset>

        <fieldset data-ev="node-limits">
          <legend>
            Limits on this step <Unhonoured attribute="limits" />
          </legend>
          {limits.map((standing) => (
            <label key={standing.key} className="setting">
              <span className="setting-name">
                {standing.help.name} <code>{standing.key}</code>
              </span>
              <input
                type="number"
                min={0}
                value={standing.onNode ?? ''}
                onChange={(event) =>
                  onChange({
                    ...node,
                    limits: {
                      ...node.limits,
                      [standing.key]: event.target.value === '' ? undefined : Number(event.target.value),
                    },
                  })
                }
              />
              <span className="setting-detail">
                {standing.help.detail}{' '}
                {standing.from === 'graph' ? (
                  <strong>
                    Nothing is set here, and the whole run’s limit of {String(standing.onGraph)} applies
                    to this step.
                  </strong>
                ) : standing.from === 'none' ? (
                  standing.help.whenEmpty
                ) : null}
              </span>
            </label>
          ))}
          <label>
            Why these numbers — for whoever reads the drawing
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
          <legend>What this step requires</legend>
          {inherited.length === 0 ? (
            <p className="muted">
              The role this node performs states no requirements of its own, so everything in force
              here is set below.
            </p>
          ) : (
            <p className="muted" data-ev="node-inherited-requirements">
              In force from the role <code>{role?.id ?? ''}</code> whether or not the boxes below are
              ticked: {inherited.map((standing) => standing.help.name.toLowerCase()).join('; ')}.
            </p>
          )}
          {requirements.map((standing) => (
            <label key={standing.requirement} className="check setting">
              <input
                type="checkbox"
                checked={standing.onNode}
                onChange={(event) =>
                  onChange({
                    ...node,
                    requirements: event.target.checked
                      ? [...(node.requirements ?? []), standing.requirement]
                      : (node.requirements ?? []).filter((entry) => entry !== standing.requirement),
                  })
                }
              />
              <span className="setting-name">
                {standing.help.name} <code>{standing.requirement}</code>
                {standing.fromRole ? <span className="inherited">already required by the role</span> : null}
                {standing.inForce && standing.enforcement !== 'enforced' ? (
                  <Unhonoured stated={standing.howItHolds} />
                ) : null}
              </span>
              <span className="setting-detail">
                {standing.inForce ? standing.howItHolds : standing.help.whenEmpty}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset data-ev="node-routing">
          <legend>How this step ends, and where each ending goes</legend>
          <label>
            The names it may answer with, separated by commas
            <input
              value={(node.outcomes ?? []).join(', ')}
              onChange={(event) => onChange({ ...node, outcomes: splitList(event.target.value) })}
            />
          </label>
          {outcomes.length === 0 ? (
            <p className="muted">
              It declares none, so an ordinary reply leaves on plain success down whichever arrow
              carries that. A node that declares any may not also leave on plain success.
            </p>
          ) : (
            <ul className="routes" data-ev="node-outcome-routes">
              {outcomes.map((standing) => (
                <li key={standing.outcome}>
                  <code>{standing.outcome}</code>{' '}
                  {standing.drawn ? (
                    <>
                      {standing.edgeLabel === null ? 'goes to' : `“${standing.edgeLabel}” — goes to`}{' '}
                      <strong>{standing.leadsTo}</strong>
                    </>
                  ) : (
                    <em>has no arrow yet, so the graph cannot be saved until you draw one.</em>
                  )}
                </li>
              ))}
            </ul>
          )}
          {outcomes.length === 0 ? null : (
            <label>
              When a reply names none of them, route it as
              <input
                value={node.whenUndeclared ?? ''}
                placeholder="leave empty to stop the run"
                onChange={(event) =>
                  onChange({
                    ...node,
                    whenUndeclared:
                      event.target.value.trim() === '' ? undefined : event.target.value.trim(),
                  })
                }
              />
            </label>
          )}
          {outcomes.length === 0 ? null : (
            <p className="muted" data-ev="node-undeclared-route">
              {undeclared.impossible ? (
                <>
                  <code>{undeclared.stated}</code> is not one of the names above, so this step
                  cannot produce it. Until you fix that, a reply that names nothing stops the run.
                </>
              ) : undeclared.outcome === null ? (
                <>
                  Nothing is stated, so a reply that names none of them is not a result this step
                  can end on: the run stops for a person rather than choosing a name. The step’s
                  own reply is filed first either way.
                </>
              ) : (
                <>
                  A reply that names none of them is routed as <code>{undeclared.outcome}</code>
                  {undeclared.drawn ? (
                    <>
                      , which goes to <strong>{undeclared.leadsTo}</strong>
                    </>
                  ) : null}
                  . That is this node’s own choice and nothing is read into the reply; the run
                  records it as an outcome DSpatch selected rather than one the step declared.
                </>
              )}
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>Failures it may declare</legend>
          {graph.failureKinds.length === 0 ? (
            <p className="muted">
              This loop declares no failures at all, so no step can end by reporting one. Every way
              out is an outcome or plain success.
            </p>
          ) : (
            failures.map((standing) => (
              <label key={standing.kind.id} className="check setting">
                <input
                  type="checkbox"
                  checked={standing.declared}
                  onChange={(event) =>
                    onChange({
                      ...node,
                      declaredFailures: event.target.checked
                        ? [...(node.declaredFailures ?? []), standing.kind.id]
                        : (node.declaredFailures ?? []).filter((entry) => entry !== standing.kind.id),
                    })
                  }
                />
                <span className="setting-name">
                  {standing.kind.label} <code>{standing.kind.id}</code>
                </span>
                {/*
                  The meaning, not `id — label`. That pair read "research needed — research
                  needed", which is the same words twice and helps nobody; `meaning` is the
                  sentence the graph's author wrote about when to declare it.
                */}
                <span className="setting-detail" data-ev={`failure-meaning-${standing.kind.id}`}>
                  {standing.kind.meaning}{' '}
                  {standing.declared ? (
                    standing.drawn ? (
                      <>
                        Declaring it here goes to <strong>{standing.leadsTo}</strong>.
                      </>
                    ) : (
                      <em>
                        Declared here with no arrow drawn for it, so the graph cannot be saved until
                        you draw one.
                      </em>
                    )
                  ) : (
                    'This step may not declare it: reporting it would leave the run with nowhere to go.'
                  )}
                </span>
              </label>
            ))
          )}
        </fieldset>

        <fieldset>
          <legend>
            Who files this step’s result <Unhonoured attribute="report" />
          </legend>
          <label>
            Written by
            <select
              value={node.report?.writtenBy ?? ''}
              onChange={(event) =>
                onChange({
                  ...node,
                  report: event.target.value === '' ? undefined : { ...node.report, writtenBy: event.target.value },
                })
              }
            >
              <option value="">Not set — the run decides</option>
              <option value="self">This step writes it itself</option>
              {graph.nodes
                .filter((other) => other.id !== node.id)
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.label ?? other.id} files it on this step’s behalf
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">
            A step required not to write files cannot write its own report, and naming the writer is
            how the format says so. Where another node is named, the runner files this step’s reply
            itself and the agent is asked for no file.
          </p>
        </fieldset>

        <label>
          Notes — for whoever reads the drawing, never read by the runner
          <textarea
            rows={4}
            value={node.notes ?? ''}
            onChange={(event) => onChange({ ...node, notes: event.target.value || undefined })}
          />
        </label>

        <FindingList findings={findings.filter((finding) => finding.severity === 'notice')} />

        <p className="muted">
          Drawn at x {String(node.view?.x ?? 0)}, y {String(node.view?.y ?? 0)}. Presentation only — it
          never affects meaning, and it is saved so the arrangement survives.
        </p>
      </Advanced>

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
        What this connection hands over
        <input
          value={(edge.delivers ?? []).join(', ')}
          placeholder="empty — the step is handed whatever it always consumes"
          onChange={(event) => onChange({ ...edge, delivers: splitList(event.target.value) })}
        />
      </label>
      <p className="muted">
        {edge.delivers === undefined || edge.delivers.length === 0
          ? `Empty, so arriving here changes nothing about what ${
              nodeById(graph, edge.to)?.label ?? edge.to
            } is handed: it gets the results its own settings name, the same on every route.`
          : `Arriving this way, ${nodeById(graph, edge.to)?.label ?? edge.to} is handed ${
              edge.delivers.length === 1 ? 'the result' : 'the results'
            } of ${edge.delivers
              .map((id) => nodeById(graph, id)?.label ?? id)
              .join(', ')} — and only ${
              edge.delivers.length === 1 ? 'that one' : 'those'
            }, instead of what it normally consumes. Each is bound to the visit this run actually
            made, so coming back a third time does not pick up the first time's work.`}
      </p>

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
          Limits on the whole run <Unhonoured attribute="limits" />
        </legend>
        {LIMIT_KEYS.map((key) => {
          const help = limitHelp(key, 'graph');
          return (
            <label key={key} className="setting">
              <span className="setting-name">
                {help.name} <code>{key}</code>
              </span>
              <input
                type="number"
                min={0}
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
              <span className="setting-detail">
                {help.detail} {graph.limits?.[key] === undefined ? help.whenEmpty : ''}
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>Failures this loop routes on</legend>
        {graph.failureKinds.length === 0 ? (
          <p className="muted">None, so no step can end by reporting one.</p>
        ) : (
          graph.failureKinds.map((kind) => (
            <p key={kind.id} className="muted">
              <strong>{kind.label}</strong> <code>{kind.id}</code> — {kind.meaning}
            </p>
          ))
        )}
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
