/**
 * What the graph view shows while a run is happening, and how an event reaches it.
 *
 * DSP-28 #3 and #4. There is one rule here and everything else follows from it:
 * **the marking is a reading of the run's own journal, never a second opinion about
 * it.** `loop-run.ts` already writes one entry per node entered, produced, awaited
 * and faulted; `runOutcomeFrom` in `loop-record.ts` already decides the one outcome
 * a run has. This module adds no third derivation of either. It turns entries into
 * "which box is lit" and nothing more, so a finished or cancelled step cannot keep
 * looking active — that would be a state model of its own, disagreeing with the
 * record, which is the defect DSP-26 #1 exists to prevent.
 *
 * **Addressing.** A window can be opened halfway through a run, two windows can be
 * open at once, and a user can cancel one run and start another while entries from
 * the first are still in flight. So an event is addressed to a run rather than sent
 * to whichever window asked for it: `runId` *and* `graphVersionId` must both match
 * what the view is watching, or the event is dropped and the view is returned
 * unchanged. Both, because a run id says which walk and the graph version says
 * which drawing, and a view that accepted one without the other could light a node
 * in a picture that never contained it.
 */

import {
  finishStepsForNode,
  foldStepActivity,
  type StepActivity,
  type StepActivityState,
} from './loop-activity';
import type { ControlPhase } from './loop-control';
import { terminalDeclaresSuccess } from './loop-graph';
import type { LoopGraph, ResolvedRole } from './loop-graph';
import type { RunJournalEntry, RunStatus } from './loop-run';

/**
 * How a node looks while a run walks the graph.
 *
 * Five, not four. The card names waiting, active, finished and failed; `stopped` is
 * here because a node that was entered and never produced anything, in a run that
 * has since ended, is none of those — and calling it finished or failed would be a
 * statement nobody measured. `not-reached` is the ordinary state of most of the
 * drawing and carries no mark at all.
 *
 * None of these is a verdict about the user's project. That is the run's outcome,
 * it is computed once by `runOutcomeFrom`, and nothing here recomputes it.
 */
export type NodeRunState =
  | 'not-reached'
  /**
   * The entry step of a loop that is chosen but has not been given a mandate.
   *
   * Six became seven for one reason: *ready* had to be sayable without saying
   * *running*. Ticking `Use loop` chooses a graph and starts nothing, and the old
   * vocabulary had no word for that — `not-reached` reads as *this run never got
   * here* and `active` would be a claim that work is happening. This says the loop is
   * standing by for an assignment, which is what is true.
   */
  | 'ready'
  | 'waiting'
  | 'active'
  | 'finished'
  | 'failed'
  | 'stopped';

/**
 * The mark each state carries, and the class that draws it.
 *
 * DSP-28 #3 in one table: every state that means something has a **word** as well
 * as a class, so the difference between waiting, active, finished and failed
 * survives a person who cannot see, does not want, or has switched off the pulse.
 * Motion is added by the stylesheet on top of `active`; it is never what tells the
 * states apart.
 */
export const NODE_RUN_STATE_MARKS: Readonly<
  Record<NodeRunState, { readonly mark: string; readonly label: string; readonly className: string }>
> = {
  'not-reached': {
    mark: '',
    label: 'not reached in this run',
    className: 'node-run-not-reached',
  },
  ready: {
    mark: 'ready',
    // Spelled out because the one-word mark is exactly the thing that could be
    // misread as "something is working". The pulse the stylesheet adds is the same
    // restrained one `active` gets and carries no meaning of its own, which is why
    // the difference has to be carried by the word.
    label: 'ready to receive a task — nothing is running yet',
    className: 'node-run-ready',
  },
  waiting: {
    mark: 'waiting',
    label: 'waiting for a person before the run can continue',
    className: 'node-run-waiting',
  },
  active: {
    mark: 'running',
    label: 'running now',
    className: 'node-run-active',
  },
  finished: {
    mark: 'done',
    label: 'entered and produced its result',
    className: 'node-run-finished',
  },
  failed: {
    mark: 'failed',
    label: 'reported a runtime fault',
    className: 'node-run-failed',
  },
  stopped: {
    mark: 'stopped',
    label: 'entered, and the run ended before it produced anything',
    className: 'node-run-stopped',
  },
};

/** Which run, and which drawing. Both are needed to address an event. */
export interface LoopRunIdentity {
  readonly runId: string;
  readonly graphVersionId: string;
}

/**
 * The graph version a run is walking, announced once when it starts.
 *
 * `graphText` is carried rather than a path, because DSP-28 #2 asks for *exactly
 * the version being executed* and the author may have edited the drawing since. The
 * text is the bytes that were validated and walked; `graphVersionId` is the content
 * hash of those bytes, so a window that was not the one to press Run can still show
 * the right picture.
 *
 * A dry run walks the canvas in the window and reads nothing from disk, so it has
 * no content hash to offer. It says so in `graphVersionId` rather than inventing
 * one — see {@link UNVERSIONED_CANVAS}.
 */
export interface LiveRunAnnouncement extends LoopRunIdentity {
  readonly graphId: string;
  readonly graphName: string;
  readonly binding: LoopRunBinding;
  readonly graphText: string;
  readonly startedAtUtc: string;
  /**
   * What this run's role references resolved to, resolved by the side that has a disk.
   *
   * **This field is the fix for a refusal panel Niclas met.** The editor loaded the
   * run's `graphText` with a resolver built from its own `roles` state, and that map
   * is only ever filled for a graph the author opened through the file dialog. The
   * announced chat loop references `docs/loop/roles/project/project-work.role.md`,
   * which was not in it, so the load failed on *a role reference that resolves to
   * nothing is an error* — a correct rule reaching the wrong conclusion, because the
   * main process had already resolved those very roles in order to run the graph.
   *
   * So the run announces them. A graph view then draws the run's own picture from the
   * run's own bindings rather than from whatever the author happened to have open,
   * and the validation rule keeps its teeth: a reference that genuinely resolves to
   * nothing still arrives here as `null` and still refuses.
   *
   * Optional, because a dry run walks the canvas in a window that already holds its
   * roles, and because an announcement written before this field existed must keep
   * meaning what it meant.
   */
  readonly roles?: readonly AnnouncedRole[];
  /**
   * Whether this announcement is a loop standing by or a run that is walking.
   *
   * `'ready'` is the state `Use loop` puts the graph view in before the first send:
   * the chosen drawing on screen, its entry step marked ready, and nothing started.
   * Absent means `'running'`, which is what every announcement meant before.
   */
  readonly phase?: LoopRunPhase;
}

export type LoopRunPhase = 'ready' | 'running';

/**
 * One role reference and what it resolved to, `null` meaning it resolves to nothing.
 *
 * Structurally identical to `ResolvedRoleEntry` in `bridge.ts` and declared here
 * rather than imported from it, because the bridge already imports this module and
 * the dependency has to point one way. `null` keeps its meaning exactly: a graph view
 * that receives it still refuses to draw, which is the rule working rather than
 * failing.
 */
export interface AnnouncedRole {
  readonly key: string;
  readonly role: ResolvedRole | null;
}

export type LoopRunBinding = 'editor-loop' | 'chat-loop' | 'canvas-dry-run';

/**
 * The version id of a graph that was never read from a file.
 *
 * A dry run walks the drawing in front of the author, unsaved edits included. There
 * is nothing to hash the way `graphVersionIdFor` hashes the bytes a live run read,
 * and a hash computed here would be a different kind of claim wearing the same name.
 * Addressing still works because a run id and a version id must *both* match, and
 * every press produces a new run id.
 */
export const UNVERSIONED_CANVAS = 'canvas-unversioned';

/** One addressed thing that happened to a run. */
export type LoopRunEvent =
  | { readonly kind: 'started'; readonly run: LiveRunAnnouncement }
  | {
      readonly kind: 'journal';
      readonly runId: string;
      readonly graphVersionId: string;
      readonly entry: RunJournalEntry;
    }
  | {
      readonly kind: 'ended';
      readonly runId: string;
      readonly graphVersionId: string;
      readonly status: RunStatus | null;
      readonly note: string;
      /**
       * The terminal the runner says it reached, or `null` when it reached none.
       *
       * `RunResult.terminalNodeId`, carried rather than worked out here. The journal
       * already says which node was entered last and a view could infer the terminal
       * from it — which is exactly the second derivation this module's first rule
       * forbids, and it would be wrong in the interesting cases: a run cut off inside a
       * step, or one that faulted, has a last-entered node and no terminal at all.
       *
       * Optional, so an announcement written before this field existed keeps meaning
       * what it meant: absent is *no terminal was reported*, never *the run reached one
       * and we mislaid it*.
       */
      readonly terminalNodeId?: string | null;
    }
  /**
   * Something the provider reported while a step was working.
   *
   * On the same addressed channel as the journal, deliberately. The graph view and
   * the chat must read the *same* run state, and two channels with two folds is how
   * they would begin to disagree — the class of defect DSP-26 #1 exists to prevent.
   */
  | {
      readonly kind: 'activity';
      readonly runId: string;
      readonly graphVersionId: string;
      readonly activity: StepActivity;
    }
  /**
   * A stand-by offer withdrawn — `Use loop` switched off before anything was sent.
   *
   * Not an `ended`: the loop never started, and telling a view that a run it is
   * showing has ended would put a run on screen that never happened.
   */
  | { readonly kind: 'stood-down'; readonly runId: string; readonly graphVersionId: string };

/** What the view holds: one run, the drawing it is walking, and its journal. */
export interface RunView {
  readonly run: LiveRunAnnouncement;
  readonly entries: readonly RunJournalEntry[];
  readonly ended: boolean;
  /** The runner's own status when it ended, or `null` while it is still walking. */
  readonly status: RunStatus | null;
  readonly note: string;
  /**
   * What each step has been observed doing, folded by the module the chat also uses.
   *
   * One derivation, two windows. The graph view answers *what is this node actually
   * doing* from the same state the conversation answers it from, so the two cannot
   * give different answers about one run.
   */
  readonly steps: readonly StepActivityState[];
  /**
   * The terminal this run reached, as the runner reported it when it ended.
   *
   * `null` until the run ends, and `null` afterwards for every ending that reached no
   * terminal — a spent bound, a runtime fault, a cancel. See the `ended` event.
   */
  readonly terminalNodeId: string | null;
}

export function runViewFor(run: LiveRunAnnouncement): RunView {
  return {
    run,
    entries: [],
    ended: false,
    status: null,
    note: '',
    steps: [],
    terminalNodeId: null,
  };
}

/** Whether this view is a chosen loop standing by rather than a run that is walking. */
export function viewIsReady(view: RunView | null): boolean {
  return view !== null && view.run.phase === 'ready' && !view.ended;
}

/** The run id and graph version of an event, or `null` for one that has neither. */
export function addressOf(event: LoopRunEvent): LoopRunIdentity {
  return event.kind === 'started'
    ? { runId: event.run.runId, graphVersionId: event.run.graphVersionId }
    : { runId: event.runId, graphVersionId: event.graphVersionId };
}

/**
 * Whether an event is about the run this view is watching.
 *
 * Both fields, and no partial credit. This is the whole of DSP-28 #4's ordering
 * clause: an entry from a run the user cancelled ten seconds ago carries that run's
 * id, so it fails here and never reaches the drawing on screen.
 */
export function eventBelongsTo(view: RunView | null, event: LoopRunEvent): boolean {
  if (view === null) {
    return false;
  }
  const address = addressOf(event);
  return (
    address.runId === view.run.runId && address.graphVersionId === view.run.graphVersionId
  );
}

/**
 * Fold one event into the view.
 *
 * Returns **the same object** when the event is not addressed to this run, so a
 * stale entry is not merely invisible but literally does not change what the window
 * holds — which is a property a caller can assert, and a React state setter can
 * skip re-rendering on.
 */
export function applyRunEvent(view: RunView | null, event: LoopRunEvent): RunView | null {
  if (!eventBelongsTo(view, event)) {
    return view;
  }
  const current = view as RunView;
  if (event.kind === 'started') {
    // The announcement for the run already being watched. Nothing to add: the view
    // was built from it, and re-applying it must not clear the entries so far.
    return current;
  }
  if (event.kind === 'stood-down') {
    // The offer is gone and there is nothing to show. `null` puts the window back to
    // the author's own drawing, which is exactly where it was before the tick.
    return null;
  }
  if (event.kind === 'ended') {
    return {
      ...current,
      ended: true,
      status: event.status,
      note: event.note,
      terminalNodeId: event.terminalNodeId ?? null,
    };
  }
  if (event.kind === 'activity') {
    const steps = foldStepActivity(current.steps, event.activity);
    // Same array back when the fold changed nothing, so an event for a step this view
    // never saw open does not even cause a re-render.
    return steps === current.steps ? current : { ...current, steps };
  }
  // A journal entry that closes a node closes its step's live view too. The graph view
  // has no replies to read, so without this a step the run has already finished would
  // go on reporting that it is writing one — a second opinion about the run, from a
  // module whose whole rule is that it never forms one.
  const closed =
    event.entry.nodeId === undefined ||
    (event.entry.kind !== 'node-produced' && event.entry.kind !== 'runtime-fault')
      ? current.steps
      : finishStepsForNode(current.steps, current.run.runId, event.entry.nodeId);
  return { ...current, entries: [...current.entries, event.entry], steps: closed };
}

/**
 * Which box is lit, and how.
 *
 * A single pass over the run's own entries, latest statement about a node winning,
 * because a node entered a second time is running again. Nothing is inferred from
 * anything but these entries — no timers, no "it has been a while", no guess.
 */
export function nodeRunStates(
  view: RunView | null,
  /**
   * The entry node of the drawing on screen, for the ready state alone.
   *
   * Passed in rather than read from `view`, because the view holds the graph's *text*
   * and parsing it here to find one id would be a second loader. The caller already
   * has the loaded graph, and `ready` is the only state that needs to know.
   */
  entryNodeId?: string,
): ReadonlyMap<string, NodeRunState> {
  const states = new Map<string, NodeRunState>();
  if (view === null) {
    return states;
  }
  if (viewIsReady(view)) {
    // A chosen loop with no mandate yet. Its entry step is the only marked node, and
    // the mark says *ready*, not *running*: nothing has been started, and there are
    // no journal entries below to say otherwise.
    if (entryNodeId !== undefined) {
      states.set(entryNodeId, 'ready');
    }
    return states;
  }
  for (const entry of view.entries) {
    const nodeId = entry.nodeId;
    if (nodeId === undefined) {
      continue;
    }
    switch (entry.kind) {
      case 'node-entered':
        states.set(nodeId, 'active');
        break;
      case 'node-produced':
        states.set(nodeId, 'finished');
        break;
      case 'awaiting-human':
      // DSP-51: a gate holding a command in front of a person is waiting on a
      // person, which is what this state means. The answer puts it back to work.
      case 'waiting-for-person':
        states.set(nodeId, 'waiting');
        break;
      case 'person-answered':
        states.set(nodeId, 'active');
        break;
      case 'runtime-fault':
        states.set(nodeId, 'failed');
        break;
      default:
        // `edge-taken` and `limit-reached` name a node without changing what that
        // node is doing: a spent bound is the run's business, not the step's.
        break;
    }
  }
  if (!view.ended) {
    return states;
  }
  // Nothing is running once the run has ended. A terminal is entered and never
  // produces, so on a completed run it reads as finished; anything else still
  // marked active was cut off, and `stopped` says that rather than claiming an
  // outcome the run never reported for it.
  for (const [nodeId, state] of states) {
    if (state === 'active') {
      states.set(nodeId, view.status === 'completed' ? 'finished' : 'stopped');
    }
  }
  return states;
}

export function nodeRunStateFor(
  states: ReadonlyMap<string, NodeRunState>,
  nodeId: string,
): NodeRunState {
  return states.get(nodeId) ?? 'not-reached';
}

/**
 * Whether this node should carry the working animation: the glint (DSP-80).
 *
 * Three things are settled here, and each of them is a way this could have been got
 * wrong.
 *
 * **It reads the run's state, not the provider's chatter.** `state` comes from
 * {@link nodeRunStates}, which is a fold of the run's own journal, and `control` is the
 * loop control's phase. Neither is `StepActivity`, and that is the point: a step whose
 * agent is thinking in silence has produced no deltas for a while and is working all the
 * same. DSP-87 has just finished repairing a fault of exactly that shape one surface
 * over, where the conversation inferred quiet from the absence of deltas; an animation
 * that stalled whenever a model paused would be the same mistake with a nicer surface.
 *
 * **A pause stops it; a pause being asked for does not.** `pause-requested` means the
 * work step is still in flight and nothing new will start after it — the control says so
 * in as many words — so the node really is working and the glint stays. `paused` means
 * it has stopped. Animating through a pause would be the graph contradicting the
 * control an inch away from it.
 *
 * **Waiting for a person is not working.** `waiting-for-you` is a step held for a
 * release, and the `waiting` state is a step that has asked a person something. Neither
 * moves, and neither loses its marking: the border, the colour and the word are all
 * still there, which is what the card means by the state remaining evident.
 *
 * `control` may be `null` — for a window that has no report for *this* run, and for a
 * caller that has none at all. `null` is read as *nothing is holding it*, which is what
 * an active node with no control report means.
 */
export function nodeIsWorking(state: NodeRunState, control: ControlPhase | null): boolean {
  if (state !== 'active') {
    return false;
  }
  return control !== 'paused' && control !== 'waiting-for-you';
}

/**
 * The marks a run left on the drawing, kept after the run itself is gone (DSP-36).
 *
 * Report 024 left this open in one sentence: *a finished run is never marked as finished
 * on the graph*, because the stand-by offer that puts the Ready pulse back replaces the
 * view the moment the run ends, and a ready view marks the entry step and nothing else.
 * So the run's own account of where it got to was on screen for as long as it took the
 * main process to answer, which is not long enough to read.
 *
 * Kept separately from {@link RunView} rather than by delaying the offer, because both
 * things are true at once and Niclas asked to see both: a finished run and a loop ready
 * for the next assignment.
 *
 * **Addressed like everything else here.** The run id and the graph version are carried
 * for the same reason an event carries them, and `drawing` is carried as well because a
 * version id is not enough on its own: a dry run has no content hash and says so with
 * {@link UNVERSIONED_CANVAS}, which every canvas in every window shares — so marks bound
 * to that id alone would follow the person onto a different drawing. `drawing` is the
 * run's pinned graph as text, normalised the way the divergence check normalises it, so
 * the holder can ask the only question that matters: *is the drawing in front of me the
 * one these marks belong to?*
 */
export interface FinishedRunMarks {
  readonly runId: string;
  readonly graphVersionId: string;
  /**
   * The run's pinned drawing, re-serialised, or `null` when it could not be read.
   *
   * `null` withholds nothing by itself. It means the holder cannot tell whether the
   * drawing on screen is this run's, which is the same three-answer distinction
   * {@link PinnedDrawingCheck} makes and for the same reason.
   */
  readonly drawing: string | null;
  readonly status: RunStatus | null;
  /** Every node the run marked, as it was marked when the run ended. */
  readonly states: ReadonlyMap<string, NodeRunState>;
  /** The terminal the run reached, or `null` when it reached none. */
  readonly terminalNodeId: string | null;
  /**
   * The reached terminal, when the graph declares arriving there a success.
   *
   * The green tick's one source. `null` is *no tick*, and it is `null` for a terminal
   * whose author declared nothing as well as for one declared `not-success` — which is
   * why the field is an id rather than a boolean beside `terminalNodeId`: a tick is a
   * claim about a particular node, and a boolean could be read against the wrong one.
   */
  readonly successNodeId: string | null;
}

/**
 * What the run that just ended leaves on the drawing.
 *
 * `null` for a view that has not ended, and for one that ended having marked nothing:
 * a run refused before it entered a step has no ending to show, and an empty set of
 * marks kept on screen would be a finished run nobody could see.
 *
 * `graph` is the drawing on screen, and it is read for exactly one thing — whether the
 * terminal the *runner* named declares itself a success. The lookup is by id, the answer
 * comes from {@link terminalDeclaresSuccess}, and no label is compared anywhere: that is
 * Niclas's explicit instruction, and it is why the graph is passed in rather than the
 * node's name being matched against a list of words DSpatch believes mean success.
 */
export function finishedRunMarksFrom(
  view: RunView,
  graph: LoopGraph | null,
  drawing: string | null,
): FinishedRunMarks | null {
  if (!view.ended) {
    return null;
  }
  // No entry node id: *ready* is a state about what will happen next, and it has no
  // business in the record of what did.
  const states = nodeRunStates(view);
  if (states.size === 0) {
    return null;
  }
  const terminalNodeId = view.terminalNodeId;
  const terminal =
    terminalNodeId === null || graph === null
      ? null
      : (graph.nodes.find((node) => node.id === terminalNodeId) ?? null);
  return {
    runId: view.run.runId,
    graphVersionId: view.run.graphVersionId,
    drawing,
    status: view.status,
    states,
    terminalNodeId,
    successNodeId: terminalDeclaresSuccess(terminal) ? terminalNodeId : null,
  };
}

/**
 * What each ending mark means on screen, for the one node that carries it.
 *
 * `reached` is every other ending the card asks to be marked: a terminal the graph
 * declares `not-success`, and one whose author declared nothing at all. It is
 * deliberately the same word for both, because *the drawing does not say* and *the
 * drawing says no* are the author's business and neither of them is a success.
 */
export type EndingMark = 'reached' | 'success';

/**
 * Which node, if any, carries an ending mark, and which mark.
 *
 * `null` for every node but one. Split out so that the view's merge below and the node
 * that draws the tick read the same answer rather than each testing two fields.
 */
export function endingMarkFor(
  marks: FinishedRunMarks | null,
  nodeId: string,
): EndingMark | null {
  if (marks === null || marks.terminalNodeId !== nodeId) {
    return null;
  }
  return marks.successNodeId === nodeId ? 'success' : 'reached';
}

/**
 * Whether these marks belong to the drawing on screen.
 *
 * The same question {@link describePinnedDrawing} answers for a live run, asked of a run
 * that is over. Switching loop must not carry an ending mark onto another graph, and the
 * honest way to guarantee that is to compare the drawings rather than to remember which
 * gestures might have changed one: DSP-85 and DSP-88 own the switch, and a rule here that
 * depended on knowing every way in would break the first time a new way in was added.
 *
 * `onScreen` is the canvas re-serialised. `false` when either side could not be read,
 * because *we cannot tell* must withhold a mark rather than assert one.
 */
export function finishedMarksBelongTo(
  marks: FinishedRunMarks | null,
  onScreen: string | null,
): boolean {
  return marks !== null && marks.drawing !== null && onScreen !== null && marks.drawing === onScreen;
}

/**
 * Which box is lit, with the last run's ending still showing under the Ready pulse.
 *
 * {@link nodeRunStates} answers for the view there is; this puts the finished run's marks
 * underneath it, so that after a run the drawing says both *this is where the last run
 * got to* and *the loop is standing by for the next assignment* — which is the state
 * Niclas asked to be able to read at a glance.
 *
 * **The live view always wins.** A node the new state has anything to say about takes the
 * new state: the moment a run starts, its own marks — including none at all — replace what
 * the previous run left on that node. The caller is expected to drop the finished marks
 * when a run starts, and this ordering means that a caller which had not yet would still
 * not show a stale mark on a node the new run has reached.
 *
 * Pass `marks` as `null` when they do not belong to this drawing; {@link
 * finishedMarksBelongTo} is the question to ask.
 */
export function markedNodes(
  view: RunView | null,
  marks: FinishedRunMarks | null,
  entryNodeId?: string,
): ReadonlyMap<string, NodeRunState> {
  const live = nodeRunStates(view, entryNodeId);
  if (marks === null) {
    return live;
  }
  const merged = new Map(marks.states);
  for (const [nodeId, state] of live) {
    merged.set(nodeId, state);
  }
  return merged;
}

/** Edge ids the run has actually taken, from the same entries and no other source. */
export function edgesTakenIn(view: RunView | null): ReadonlySet<string> {
  const taken = new Set<string>();
  for (const entry of view?.entries ?? []) {
    if (entry.kind === 'edge-taken' && entry.edgeId !== undefined) {
      taken.add(entry.edgeId);
    }
  }
  return taken;
}

/**
 * Whether the drawing on screen may be edited.
 *
 * DSP-28 #2 is kept and its scope is narrowed to what it was always about: a graph
 * you can edit **while it runs** is a graph that no longer describes the run. So the
 * lock is exactly the run, and it ends when the run does.
 *
 * DSP-86 changed the other two cases, and both changes follow from there no longer
 * being a separate run view to leave.
 *
 * **An ended run does not lock.** The old rule kept a finished run's drawing on screen
 * and locked, on the ground that leaving it should be a deliberate act rather than a
 * side effect of the run stopping. That reasoning belonged to a view that had replaced
 * the editor; here the editor never went anywhere, and a lock nobody can lift without
 * pressing a button is the button the card exists to remove.
 *
 * **A stand-by offer does not lock.** `phase: 'ready'` is a loop chosen and nothing
 * started, which is the ordinary state of a window with `Use loop` ticked. Locking the
 * editor for it meant ticking a box in the chat disabled editing in the graph view for
 * as long as the box stayed ticked.
 *
 * A pause, and a step waiting for a person, are both runs that have not ended, so they
 * lock — which is what DSP-86 #4 asks for.
 */
export function viewIsLocked(view: RunView | null): boolean {
  return view !== null && !view.ended && !viewIsReady(view);
}

/**
 * What the run is doing, in as few words as the state can be said in.
 *
 * Split out of {@link describeRunView} because DSP-86 gave it a second reader. The
 * graph editor's title line names the drawing on screen — which no longer changes when
 * a run starts — and appends this. Two places saying *running* had to be one function,
 * or the header and the sentence beside it could come to disagree about one run.
 *
 * `control` closes what report 024 left open: the title said *running now* while the
 * control an inch away said *Waiting for you*, because the hold lives in the control
 * state and this function could only see the run. Nothing on screen was false; the two
 * were answering different questions and reading as one answer. Pass the phase only
 * when it belongs to this run — `LoopControlReport.runId` is what says so — because a
 * phase left over from another run would be exactly the same mistake one level down.
 * Omitted, every caller written before this gets what it got.
 */
export function runViewState(view: RunView, control: ControlPhase | null = null): string {
  if (viewIsReady(view)) {
    return 'ready for a task — nothing has been started';
  }
  if (view.ended) {
    return `ended${view.status === null ? '' : ` (${view.status})`}`;
  }
  switch (control) {
    case 'waiting-for-you':
      return 'waiting for you';
    case 'paused':
      return 'paused';
    case 'pause-requested':
      return 'running now, and stopping when this step ends';
    default:
      return 'running now';
  }
}

/**
 * The short line about a run: which drawing, and what it is doing.
 *
 * **Short is the requirement, not the style.** The banner this was written for used to
 * carry the whole paragraph below in one line — the run id, the content hash, the lock,
 * why the lock exists and what leaving does — over a canvas that was refusing to draw.
 * DSP-86 removed the banner; the sentence is still what a window says when it has to
 * name a run and its state together in one breath.
 */
export function describeRunView(view: RunView): string {
  return `${view.run.graphName} — ${runViewState(view)}`;
}

/** The identity and the lock, for whoever asks. Never the first thing on screen. */
export function explainRunView(view: RunView): string {
  const version =
    view.run.graphVersionId === UNVERSIONED_CANVAS
      ? 'the unsaved drawing in this window, which was never read from a file and so has no content version'
      : `graph version ${view.run.graphVersionId}`;
  if (viewIsReady(view)) {
    return (
      `This is ${view.run.graphName} as ${version} — the loop that will run when you send ` +
      `a task. Nothing has started, and opening or closing this window starts nothing.`
    );
  }
  return (
    `Run ${view.run.runId} — ${view.run.graphName} as ${version}. This is the version that ` +
    `${view.ended ? 'ran' : 'is running'}: a run keeps the drawing it started with, whatever ` +
    `is edited afterwards. ${
      view.ended
        ? 'The run has ended, so the graph is yours to edit again.'
        : 'Editing is locked until it ends, and nothing you do here stops it.'
    }`
  );
}

/**
 * Whether the drawing on screen is the version the run pinned.
 *
 * Three answers and not two, because *we could not read the pinned version* is a
 * different thing from *it differs*, and reporting the first as the second would be
 * inventing a disagreement nobody measured.
 */
export type PinnedDrawingCheck = 'same' | 'different' | 'unreadable';

/**
 * What the window says when the drawing on screen is not what the run pinned.
 *
 * DSP-86 removed the separate run view, and with it the old answer to *how does a run
 * pin its version*: the canvas used to be replaced by the run's own drawing, loaded
 * from the announced bytes, and the pinning was visible because the picture changed.
 * The picture no longer changes — that is the whole card — so pinning had to mean
 * something else, and the honest meaning is the one it always had underneath: **the
 * run holds the bytes it started with, and the window says so when the drawing in
 * front of you is not them.**
 *
 * `null` in the ordinary case, which is now almost every case: choosing a loop draws
 * it (DSP-85), and a run started against unsaved edits asks to save them first, so the
 * canvas and the pinned version normally *are* the same drawing. A sentence repeating
 * that agreement on every run is the footnote this card deleted.
 */
export function describePinnedDrawing(
  view: RunView | null,
  check: PinnedDrawingCheck,
): string | null {
  if (view === null || check === 'same') {
    return null;
  }
  const name = view.run.graphName;
  if (viewIsReady(view)) {
    return check === 'unreadable'
      ? `DSpatch could not read "${name}", the loop a run would use, so it cannot tell ` +
          `you whether the drawing on screen is that loop.`
      : `"${name}" is the loop a run would use, and the drawing on screen is not it. ` +
          `A run uses the chosen loop, not whatever is drawn here.`;
  }
  const tense = view.ended ? 'ran' : 'is running';
  if (check === 'unreadable') {
    return (
      `DSpatch could not read the version this run pinned, so it cannot tell you whether the ` +
      `drawing on screen is what ${tense}.`
    );
  }
  if (view.run.graphVersionId === UNVERSIONED_CANVAS) {
    return (
      `This run took the drawing as it was when it started, and the canvas has changed since. ` +
      `The marks belong to the earlier drawing.`
    );
  }
  return (
    `This run pinned "${name}" at ${view.run.graphVersionId} and keeps it. The drawing on ` +
    `screen is not that version, so the marks on it belong to a graph you are not looking at.`
  );
}
