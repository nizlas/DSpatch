/**
 * The graph view's one state model, and the rule that keeps a stale event out of it.
 *
 * DSP-28 #3 and #4. Two things are being defended here and they are different:
 *
 * **Addressing**, which is the ordering problem. Events arrive asynchronously, a user
 * can cancel one run and start another, and a window can be opened halfway through.
 * An entry from the cancelled run must not light a node in the drawing now on screen.
 *
 * **Truthfulness of the marking**, which is DSP-26 #1 applied to a second surface. The
 * marks are a reading of the run's own journal. A finished or cancelled step that keeps
 * looking active would be this module inventing a state model of its own, and the whole
 * argument for one identity and one computed outcome is that there is only ever one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { JournalKind, RunJournalEntry, RunStatus } from '../src/shared/loop-run';
import {
  NODE_RUN_STATE_MARKS,
  UNVERSIONED_CANVAS,
  applyRunEvent,
  describePinnedDrawing,
  describeRunView,
  edgesTakenIn,
  eventBelongsTo,
  explainRunView,
  nodeRunStateFor,
  nodeRunStates,
  runViewFor,
  runViewState,
  viewIsLocked,
  type LiveRunAnnouncement,
  type LoopRunEvent,
  type NodeRunState,
  type RunView,
} from '../src/shared/loop-run-view';

const here = path.dirname(fileURLToPath(import.meta.url));

function announcement(overrides: Partial<LiveRunAnnouncement> = {}): LiveRunAnnouncement {
  return {
    runId: 'editor-live-2026-09-18T06-00-00-000Z',
    graphVersionId: 'graph-aaaa1111',
    graphId: 'dspatch-live-duration',
    graphName: 'Live duration',
    binding: 'editor-loop',
    graphText: '{"id":"dspatch-live-duration"}',
    startedAtUtc: '2026-09-18T06:00:00.000Z',
    ...overrides,
  };
}

let seq = 0;

function entry(kind: JournalKind, nodeId?: string, edgeId?: string): RunJournalEntry {
  seq += 1;
  return {
    seq,
    atIso: '2026-09-18T06:00:01.000Z',
    sinceStartMs: seq * 100,
    kind,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(edgeId === undefined ? {} : { edgeId }),
    detail: `${kind} ${nodeId ?? edgeId ?? 'run'}`,
  };
}

function journal(run: LiveRunAnnouncement, item: RunJournalEntry): LoopRunEvent {
  return {
    kind: 'journal',
    runId: run.runId,
    graphVersionId: run.graphVersionId,
    entry: item,
  };
}

function ended(run: LiveRunAnnouncement, status: RunStatus | null): LoopRunEvent {
  return {
    kind: 'ended',
    runId: run.runId,
    graphVersionId: run.graphVersionId,
    status,
    note: 'ended',
  };
}

function feed(view: RunView | null, ...events: readonly LoopRunEvent[]): RunView | null {
  let current = view;
  for (const event of events) {
    current = applyRunEvent(current, event);
  }
  return current;
}

describe('a late event from an earlier run', () => {
  /**
   * The case the card names, in the shape it really happens: the user cancels a run,
   * starts another, and an entry from the first arrives afterwards. It carries a node
   * id that exists in the drawing on screen, so nothing but the address can save it.
   */
  it('never marks a node in the run the view is showing', () => {
    const cancelled = announcement({ runId: 'run-cancelled', graphVersionId: 'graph-old' });
    const current = announcement({ runId: 'run-current', graphVersionId: 'graph-new' });

    const view = feed(runViewFor(current), journal(current, entry('node-entered', 'implementer')));
    const late = feed(view, journal(cancelled, entry('node-entered', 'verifier')));

    assert.equal(
      nodeRunStateFor(nodeRunStates(late), 'verifier'),
      'not-reached',
      'a node must not light up for a run the view is not showing: this entry belongs to a ' +
        'run the user cancelled, and lighting "verifier" would tell them work is happening ' +
        'that is not happening',
    );
    assert.equal(
      nodeRunStateFor(nodeRunStates(late), 'implementer'),
      'active',
      'and the run actually being watched must be unaffected by the interruption',
    );
    assert.equal(
      late,
      view,
      'the view must be returned unchanged — not merely drawn the same — so a stale entry ' +
        'cannot accumulate anywhere the window can later read it',
    );
  });

  it('is dropped when the run id matches but the drawing does not', () => {
    const watched = announcement({ runId: 'run-1', graphVersionId: 'graph-drawn-now' });
    const impostor = announcement({ runId: 'run-1', graphVersionId: 'graph-edited-since' });
    const view = runViewFor(watched);

    assert.equal(
      eventBelongsTo(view, journal(impostor, entry('node-entered', 'implementer'))),
      false,
      'a run walks one version of one drawing, so an entry claiming this run id against a ' +
        'different version is not from this run and must not mark a node',
    );
    assert.equal(
      nodeRunStateFor(
        nodeRunStates(feed(view, journal(impostor, entry('node-entered', 'implementer')))),
        'implementer',
      ),
      'not-reached',
    );
  });

  it('is dropped when the drawing matches but the run does not', () => {
    const watched = announcement({ runId: 'run-1' });
    const other = announcement({ runId: 'run-2' });
    assert.equal(
      eventBelongsTo(runViewFor(watched), journal(other, entry('node-entered', 'implementer'))),
      false,
      're-running the same drawing is a different run, and the second run must not mark ' +
        "the first run's view",
    );
  });

  it('reaches nothing at all when no run is being watched', () => {
    const run = announcement();
    assert.equal(eventBelongsTo(null, journal(run, entry('node-entered', 'implementer'))), false);
    assert.equal(applyRunEvent(null, journal(run, entry('node-entered', 'implementer'))), null);
  });

  it('does not clear the entries when the run this view was built from re-announces', () => {
    const run = announcement();
    const view = feed(runViewFor(run), journal(run, entry('node-entered', 'implementer')));
    const again = feed(view, { kind: 'started', run });
    assert.equal(
      nodeRunStateFor(nodeRunStates(again), 'implementer'),
      'active',
      'a repeated announcement — a second window asking what is running, say — must not ' +
        'reset the history the view already has',
    );
  });
});

describe('the marking follows the recorded run state', () => {
  it('marks the node the run is in, and the ones it has left', () => {
    const run = announcement();
    const view = feed(
      runViewFor(run),
      journal(run, entry('run-started')),
      journal(run, entry('node-entered', 'implementer')),
      journal(run, entry('node-produced', 'implementer')),
      journal(run, entry('edge-taken', undefined, 'e01')),
      journal(run, entry('node-entered', 'verifier')),
    );
    const states = nodeRunStates(view);
    assert.equal(nodeRunStateFor(states, 'implementer'), 'finished');
    assert.equal(nodeRunStateFor(states, 'verifier'), 'active');
    assert.equal(nodeRunStateFor(states, 'reviewer'), 'not-reached');
  });

  it('marks a node the run has entered a second time as running again', () => {
    const run = announcement();
    const view = feed(
      runViewFor(run),
      journal(run, entry('node-entered', 'implementer')),
      journal(run, entry('node-produced', 'implementer')),
      journal(run, entry('node-entered', 'implementer')),
    );
    assert.equal(
      nodeRunStateFor(nodeRunStates(view), 'implementer'),
      'active',
      'a rework round re-enters a node, and a node being worked on again must not read as done',
    );
  });

  it('marks a human step as waiting rather than as running or failed', () => {
    const run = announcement();
    const view = feed(
      runViewFor(run),
      journal(run, entry('node-entered', 'niclas')),
      journal(run, entry('awaiting-human', 'niclas')),
    );
    assert.equal(nodeRunStateFor(nodeRunStates(view), 'niclas'), 'waiting');
  });

  it('marks the node that reported a runtime fault as failed', () => {
    const run = announcement();
    const view = feed(
      runViewFor(run),
      journal(run, entry('node-entered', 'gate')),
      journal(run, entry('runtime-fault', 'gate')),
      ended(run, 'runtime-fault'),
    );
    assert.equal(nodeRunStateFor(nodeRunStates(view), 'gate'), 'failed');
  });

  /**
   * The lie the card names explicitly: a step that is over still looking active.
   */
  it('leaves nothing running once the run has ended', () => {
    const run = announcement();
    const completed = feed(
      runViewFor(run),
      journal(run, entry('node-entered', 'implementer')),
      journal(run, entry('node-produced', 'implementer')),
      journal(run, entry('node-entered', 'done')),
      ended(run, 'completed'),
    );
    assert.equal(
      nodeRunStateFor(nodeRunStates(completed), 'done'),
      'finished',
      'a terminal is entered and never produces anything, so on a completed run it must ' +
        'read as reached rather than as still running',
    );
    for (const [nodeId, state] of nodeRunStates(completed)) {
      assert.notEqual(
        state,
        'active',
        `nothing may look active after the run has ended, and "${nodeId}" did`,
      );
    }
  });

  it('says a cancelled step stopped rather than claiming it finished or failed', () => {
    const run = announcement();
    const cancelled = feed(
      runViewFor(run),
      journal(run, entry('node-entered', 'implementer')),
      ended(run, 'runtime-fault'),
    );
    const state = nodeRunStateFor(nodeRunStates(cancelled), 'implementer');
    assert.equal(
      state,
      'stopped',
      'a node the run was inside when it ended did not finish and was not reported failed, ' +
        `so it must say neither. It said: ${state}`,
    );
    assert.notEqual(state, 'active', 'and above all it must not still look like work in progress');
  });

  it('takes the edges it draws from the run and from nothing else', () => {
    const run = announcement();
    const view = feed(
      runViewFor(run),
      journal(run, entry('edge-taken', undefined, 'e01')),
      journal(run, entry('node-entered', 'verifier')),
    );
    assert.deepEqual([...edgesTakenIn(view)], ['e01']);
    assert.deepEqual(
      [...edgesTakenIn(feed(view, journal(announcement({ runId: 'other' }), entry('edge-taken', undefined, 'e99'))))],
      ['e01'],
      "another run's edge must not be drawn as taken",
    );
  });
});

describe('waiting, running, done and failed are told apart without animation', () => {
  const meaningful: readonly NodeRunState[] = ['waiting', 'active', 'finished', 'failed', 'stopped'];

  it('gives every state that means something its own word', () => {
    const marks = meaningful.map((state) => NODE_RUN_STATE_MARKS[state].mark);
    for (const [position, mark] of marks.entries()) {
      assert.notEqual(
        mark,
        '',
        `"${meaningful[position] ?? ''}" must carry a word a person can read, because motion ` +
          `may carry emphasis and never meaning on its own`,
      );
    }
    assert.equal(
      new Set(marks).size,
      marks.length,
      `the words must differ, or two states are one state on screen: ${marks.join(', ')}`,
    );
    assert.equal(
      new Set(meaningful.map((state) => NODE_RUN_STATE_MARKS[state].className)).size,
      meaningful.length,
      'and so must the classes that draw them',
    );
  });

  it('describes each state in a sentence, so the word has a meaning to look up', () => {
    for (const state of meaningful) {
      assert.ok(
        NODE_RUN_STATE_MARKS[state].label.length > 10,
        `"${state}" needs a readable label; it had "${NODE_RUN_STATE_MARKS[state].label}"`,
      );
    }
  });

  /**
   * The accessibility clause, asserted against the stylesheet rather than trusted.
   *
   * A pulse on the active node is welcome. A pulse as the *only* difference is the
   * defect the card names, and it is the kind that is introduced later by someone
   * tidying up, so it is worth a test that reads the CSS.
   */
  it('styles every state with something that is not animation', () => {
    const css = fs
      .readFileSync(path.join(here, '..', 'src', 'renderer', 'loop-editor.css'), 'utf8')
      // Comments out first, or a comment left inside an otherwise animation-only rule
      // would count as a declaration and this check would pass on nothing.
      .replaceAll(/\/\*[\s\S]*?\*\//g, '');
    for (const state of meaningful) {
      const className = NODE_RUN_STATE_MARKS[state].className;
      // Scoped to the node's own shape. A static colour on the word beside it would
      // satisfy a looser test while the box itself was told apart by the pulse alone,
      // which is the case worth catching: the border is what a person sees at a glance,
      // and the word is asserted separately above.
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => {
        const selector = match[1] ?? '';
        return selector.includes(`.${className}`) && selector.includes('.node-body');
      });
      assert.ok(
        rules.length > 0,
        `.${className} .node-body must be styled, or "${state}" is invisible on the canvas`,
      );
      const staticDeclarations = rules
        .flatMap((match) => (match[2] ?? '').split(';'))
        .map((declaration) => declaration.trim())
        .filter((declaration) => declaration !== '')
        .filter((declaration) => !/^animation/.test(declaration));
      assert.ok(
        staticDeclarations.length > 0,
        `.${className} must draw the node itself differently when the animation is absent, ` +
          `ignored or switched off, and every declaration on its body is an animation`,
      );
    }
  });
});

describe('the graph is locked by a run and unlocked by its ending', () => {
  it('is locked while a run walks, and unlocked the moment it ends', () => {
    const run = announcement();
    const view = runViewFor(run);
    assert.equal(viewIsLocked(view), true, 'a graph you can edit while it runs no longer describes the run');
    /*
     * DSP-86 #5 and #7, and this assertion is the card's whole point in one line.
     *
     * DSP-28 kept an ended run locked on the ground that leaving its drawing should be a
     * deliberate act rather than a side effect of the run stopping. That reasoning was
     * about a *separate view* the person had been switched into, and there is no longer
     * one: the editor never went anywhere, so a lock that outlives the run is a lock only
     * a button can lift — which is the button the card exists to remove.
     */
    assert.equal(
      viewIsLocked(feed(view, ended(run, 'completed'))),
      false,
      'the run ending is what returns the graph to its author; no button should be needed',
    );
    assert.equal(viewIsLocked(null), false, 'with no run on screen the editor is an editor again');
  });

  /*
   * A pause, and a step waiting for a person, are runs that have not ended. Both had to be
   * checked rather than assumed, because both are states in which nothing is happening —
   * and "nothing is happening" is exactly what would tempt a future reader to unlock.
   */
  it('keeps the lock while a run waits for a person', () => {
    const run = announcement();
    const waiting = feed(runViewFor(run), journal(run, entry('awaiting-human', 'coordinator')));
    assert.equal(
      viewIsLocked(waiting),
      true,
      'a run waiting for an answer is still a run, and its drawing is still the one walking',
    );
  });

  /*
   * `Use loop` announces the chosen loop as a stand-by offer the moment it is ticked, and
   * under the old rule that locked the editor — ticking a box in the chat window disabled
   * editing in the graph view for as long as it stayed ticked. It also had to stop locking
   * for #6 to be possible at all: the Ready pulse returning after a run must return to a
   * graph a person can edit.
   */
  it('does not lock for a loop that is merely standing by', () => {
    const offer = runViewFor(announcement({ phase: 'ready' }));
    assert.equal(viewIsLocked(offer), false, 'choosing a loop starts nothing and locks nothing');
  });

  /*
   * The banner used to be one sentence carrying all of this at once, over a canvas
   * that was refusing to draw. It is now two: the line a person reads while watching
   * a run, and the identity they ask for when the short line is not enough. Nothing
   * has been dropped — the assertions below are the same claims, moved to whichever
   * of the two now makes them.
   */
  it('names the drawing and what it is doing, in one short line', () => {
    const run = announcement({ graphVersionId: 'graph-9f3a2c', graphName: 'Live duration' });
    const said = describeRunView(runViewFor(run));
    assert.match(said, /Live duration/);
    assert.match(said, /running now/);
    assert.ok(said.length < 80, `the line a person reads while waiting must be short. It said: ${said}`);
  });

  it('says which run and which version of the drawing is on screen, when asked', () => {
    const run = announcement({ graphVersionId: 'graph-9f3a2c', graphName: 'Live duration' });
    const said = explainRunView(runViewFor(run));
    assert.match(said, /graph-9f3a2c/, 'the content version is the point: a name identifies nothing');
    assert.match(said, new RegExp(run.runId.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(said, /locked/);
    /*
     * DSP-84 asserted *Leaving changes nothing about the run*, because there was a run
     * view to leave. There is not, so the sentence would be an instruction to press
     * something that no longer exists. What it had to keep saying is the half that is
     * still true and still the reason for the lock — a run holds the drawing it started
     * with — and the half that replaces it: the lock lifts on its own.
     */
    assert.match(
      said,
      /keeps the drawing it started with/,
      `the pin is why the lock exists, and it outlived the view. It said: ${said}`,
    );
    assert.match(said, /nothing you do here stops it/, 'because looking is not doing');
    assert.doesNotMatch(
      said,
      /leave the run view/i,
      'there is no run view to leave, so telling a person to leave one is an instruction to nowhere',
    );
  });

  it('says a finished run has given the graph back', () => {
    const run = announcement();
    const said = explainRunView(feed(runViewFor(run), ended(run, 'completed')) as RunView);
    assert.match(said, /yours to edit again/, `it said: ${said}`);
  });

  it('does not pretend a dry run of the unsaved canvas has a content version', () => {
    const said = explainRunView(runViewFor(announcement({ graphVersionId: UNVERSIONED_CANVAS })));
    assert.match(
      said,
      /never read from a file and so has no content version/,
      `a dry run walks the drawing in the window; naming a hash for it would be a different ` +
        `claim wearing the same word. It said: ${said}`,
    );
  });

  it('says a chosen loop is ready rather than running', () => {
    const view = runViewFor(announcement({ phase: 'ready', graphName: 'Chat loop' }));
    const said = describeRunView(view);
    assert.match(said, /ready for a task/);
    assert.ok(
      !/running/.test(said),
      `a loop standing by must not read as work in progress. It said: ${said}`,
    );
  });

  /*
   * The header appends `runViewState` to the name of the drawing on screen, and the
   * sentence about a run is `describeRunView`. Two readers, and they have to be reading
   * one function or a window can say *running* in one place and *ended* in another about
   * one run — which is DSP-26 #1 in miniature and exactly what DSP-28 found first.
   */
  it('builds the sentence out of the state word, so a header cannot disagree with it', () => {
    const run = announcement({ graphName: 'Chat loop' });
    const view = runViewFor(run);
    assert.ok(describeRunView(view).endsWith(runViewState(view)));
    const finished = feed(view, ended(run, 'completed')) as RunView;
    assert.equal(runViewState(finished), 'ended (completed)');
    assert.ok(describeRunView(finished).endsWith(runViewState(finished)));
  });
});

/*
 * What "the run pins its version" means once the view stops changing.
 *
 * DSP-28 made the pin visible by replacing the canvas with the run's own drawing, so a
 * person could see that the picture was not theirs. DSP-86 abolishes that replacement,
 * which left the pin needing a way to be *reported* rather than *displayed*. The pin
 * itself is untouched — the run still holds the bytes it started with — and these are
 * the sentences that say so when, and only when, the drawing in front of a person is not
 * those bytes.
 */
describe('the run pins a version, and the window says so when the drawing is not it', () => {
  it('says nothing at all when the drawing on screen is the version that is running', () => {
    assert.equal(
      describePinnedDrawing(runViewFor(announcement()), 'same'),
      null,
      'a sentence on every ordinary run is the footnote DSP-86 deleted; agreement is not news',
    );
    assert.equal(describePinnedDrawing(null, 'different'), null, 'with no run there is no pin');
  });

  it('names the pinned version and warns that the marks belong elsewhere', () => {
    const said = describePinnedDrawing(
      runViewFor(announcement({ graphVersionId: 'graph-9f3a2c', graphName: 'Chat loop' })),
      'different',
    );
    assert.ok(said !== null);
    assert.match(said, /graph-9f3a2c/, 'the pinned version is the identity, not the name');
    assert.match(
      said,
      /not looking at/,
      `a person has to be told the marks are about another graph, or they will read them as ` +
        `being about this one. It said: ${said}`,
    );
  });

  /*
   * Three answers rather than two. Reporting *we could not read the pinned bytes* as
   * *they differ* would be inventing a disagreement nobody measured, which is the class
   * of claim this whole module is written against.
   */
  it('keeps unreadable apart from different', () => {
    const view = runViewFor(announcement());
    const unreadable = describePinnedDrawing(view, 'unreadable');
    assert.ok(unreadable !== null);
    assert.match(unreadable, /could not read/);
    assert.doesNotMatch(
      unreadable,
      /is not that version/,
      'not knowing is not the same claim as knowing they differ',
    );
  });

  it('does not offer a content version for a dry run of the canvas', () => {
    const said = describePinnedDrawing(
      runViewFor(announcement({ graphVersionId: UNVERSIONED_CANVAS })),
      'different',
    );
    assert.ok(said !== null);
    assert.doesNotMatch(said, /canvas-unversioned/, 'the placeholder is not an identity to print');
    assert.match(said, /as it was when it started/, `it said: ${said}`);
  });

  /*
   * A stand-by offer is not a run, and the sentence must not say one is walking. This is
   * the case a graph file opened from File → Open Graph File… produces: the chooser still
   * names the chosen loop, the canvas holds something else, and what a run would use
   * is the loop rather than the drawing.
   */
  it('says which loop a run would use when the drawing is not that loop', () => {
    const said = describePinnedDrawing(
      runViewFor(announcement({ phase: 'ready', graphName: 'Chat loop' })),
      'different',
    );
    assert.ok(said !== null);
    assert.match(said, /Chat loop/);
    assert.match(said, /A run uses the chosen loop/, `it said: ${said}`);
    assert.doesNotMatch(said, /running|is walking/, 'nothing has been started');
  });
});

/*
 * The title line and the control beside it, saying one thing about one run.
 *
 * Report 024 left this open: the editor's title read `running now` while the control
 * an inch to its left read `Waiting for you`. Neither was false — the run had not
 * ended, and a step was held — but they answer different questions and sit close
 * enough to read as one answer. `runViewState` now takes the control's phase, and the
 * guard that matters is the second test: a phase belonging to another run is exactly
 * the mis-addressing that produced the card this work is under.
 */
describe('the title line says held when the control says held', () => {
  it('reads the hold, the pause and the pause not yet arrived', () => {
    const view = runViewFor(announcement());
    assert.equal(runViewState(view, 'waiting-for-you'), 'waiting for you');
    assert.equal(runViewState(view, 'paused'), 'paused');
    assert.match(runViewState(view, 'pause-requested'), /^running now, and stopping/);
    assert.equal(runViewState(view, 'running'), 'running now');
    assert.equal(runViewState(view, 'ready'), 'running now');
  });

  it('an ended run is ended whatever the control is left saying', () => {
    const run = announcement();
    const finished = feed(runViewFor(run), ended(run, 'completed')) as RunView;
    assert.equal(runViewState(finished, 'waiting-for-you'), 'ended (completed)');
  });

  it('omitting the phase leaves every caller written before this unchanged', () => {
    const view = runViewFor(announcement());
    assert.equal(runViewState(view), 'running now');
    assert.ok(describeRunView(view).endsWith(runViewState(view)));
  });
});
