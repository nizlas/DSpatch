/**
 * What the drawing says a run is doing, and where it says the run ended.
 *
 * DSP-80 and DSP-36. The window trial establishes that the real states are drawn and can
 * be told apart; these are the decisions underneath it, which are worth a test of their
 * own for one reason each:
 *
 * **Which node is working** is not the same question as which node is active, and the
 * difference is a conjunction of a journal state and a control phase. Every combination
 * has an answer and two of them are easy to get backwards.
 *
 * **Whether a tick is earned** must come from the graph's declaration and the run's
 * recorded outcome and from nothing else. That is Niclas's explicit instruction, and the
 * failure it forbids — a label deciding what DSpatch believes happened — is invisible in a
 * screenshot of a drawing whose wording happens to agree.
 *
 * **Where the outline is** decides whether the glint can change a node's size. A path that
 * left the node's box would make the node appear to grow when it started working, and that
 * is a property of a string this file can check without a browser.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NODE_HEIGHT,
  NODE_WIDTH,
  GLINT_LEADING_FADE,
  GLINT_PATH_LENGTH,
  GLINT_TOTAL_LENGTH,
  glintSegments,
  nodeCornerRadius,
  nodeOutlinePath,
  type GlintSegment,
} from '../src/shared/loop-edge-geometry';
import { NODE_KINDS, terminalDeclaresSuccess, type LoopGraph, type LoopNode } from '../src/shared/loop-graph';
import { parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import type { JournalKind, RunJournalEntry, RunStatus } from '../src/shared/loop-run';
import {
  applyRunEvent,
  endingMarkFor,
  finishedMarksBelongTo,
  finishedRunMarksFrom,
  markedNodes,
  nodeIsWorking,
  runViewFor,
  type LiveRunAnnouncement,
  type LoopRunEvent,
  type NodeRunState,
  type RunView,
} from '../src/shared/loop-run-view';
import type { ControlPhase } from '../src/shared/loop-control';

/* ------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * A drawing with two terminals whose labels say the opposite of their declarations.
 *
 * Deliberately perverse, because the thing being tested is that the wording cannot reach
 * the mark. `won` is declared `not-success` and labelled *Assignment met*; `lost` is
 * declared `success` and labelled *Assignment not met*. Anything that reads the label
 * gets both of them wrong, which is what makes the assertions below worth making.
 */
const TWO_TERMINALS = `{
  "format": "dspatch-loop-graph",
  "formatVersion": 1,
  "id": "liveness-fixture",
  "name": "Liveness fixture",
  "purpose": "Two terminals whose labels disagree with their declarations, so that a mark decided by the wording is a mark that fails this test.",
  "target": "cursor",
  "entry": "work",
  "onRuntimeFault": "stop-and-reconcile",
  "failureKinds": [],
  "nodes": [
    {
      "id": "work",
      "kind": "agent",
      "label": "Do the thing",
      "outcomes": ["good", "bad"],
      "view": { "x": 40, "y": 40 }
    },
    {
      "id": "won",
      "kind": "terminal",
      "label": "Assignment met",
      "ending": "not-success",
      "view": { "x": 40, "y": 200 }
    },
    {
      "id": "lost",
      "kind": "terminal",
      "label": "Assignment not met",
      "ending": "success",
      "view": { "x": 240, "y": 200 }
    },
    {
      "id": "silent",
      "kind": "terminal",
      "label": "Nothing declared",
      "view": { "x": 440, "y": 200 }
    }
  ],
  "edges": [
    {
      "id": "e-good",
      "from": "work",
      "to": "won",
      "when": { "on": "outcome", "outcome": "good" }
    },
    {
      "id": "e-bad",
      "from": "work",
      "to": "lost",
      "when": { "on": "outcome", "outcome": "bad" }
    }
  ]
}
`;

function fixtureGraph(): LoopGraph {
  const parsed = parseLoopGraph(TWO_TERMINALS);
  assert.ok(parsed.ok, `the fixture must load: ${JSON.stringify(parsed.ok ? [] : parsed.findings)}`);
  return parsed.graph;
}

function announcement(overrides: Partial<LiveRunAnnouncement> = {}): LiveRunAnnouncement {
  return {
    runId: 'run-liveness',
    graphVersionId: 'graph-1111',
    graphId: 'liveness-fixture',
    graphName: 'Liveness fixture',
    binding: 'editor-loop',
    graphText: TWO_TERMINALS,
    startedAtUtc: '2026-09-21T18:00:00.000Z',
    ...overrides,
  };
}

let seq = 0;

function entry(kind: JournalKind, nodeId?: string): RunJournalEntry {
  seq += 1;
  return {
    seq,
    atIso: '2026-09-21T18:00:01.000Z',
    sinceStartMs: seq * 100,
    kind,
    ...(nodeId === undefined ? {} : { nodeId }),
    detail: `${kind} ${nodeId ?? 'run'}`,
  };
}

function walkTo(
  terminal: string | null,
  status: RunStatus | null = 'completed',
): RunView {
  const run = announcement();
  let view = runViewFor(run);
  const address = { runId: run.runId, graphVersionId: run.graphVersionId };
  const events: LoopRunEvent[] = [
    { kind: 'journal', ...address, entry: entry('node-entered', 'work') },
    { kind: 'journal', ...address, entry: entry('node-produced', 'work') },
  ];
  if (terminal !== null) {
    events.push({ kind: 'journal', ...address, entry: entry('node-entered', terminal) });
  }
  events.push({
    kind: 'ended',
    ...address,
    status,
    note: 'ended',
    terminalNodeId: status === 'completed' ? terminal : null,
  });
  for (const event of events) {
    view = applyRunEvent(view, event) as RunView;
  }
  return view;
}

/** The fixture as the canvas would serialise it, which is what the mark is bound to. */
function fixtureDrawing(): string {
  return serialiseLoopGraph(fixtureGraph(), { newline: '\n' });
}

/* ------------------------------------------------------------------------- */
/* DSP-80: which node is working                                              */
/* ------------------------------------------------------------------------- */

describe('the glint follows the run and the control, not the provider', () => {
  it('runs on an active node that nothing is holding', () => {
    for (const phase of ['running', 'ready', null] as const) {
      assert.equal(
        nodeIsWorking('active', phase),
        true,
        `an active node with the control ${String(phase)} is working`,
      );
    }
  });

  /**
   * The line the card is explicit about: `pause-requested` is still working.
   *
   * The control says in as many words that a pause has been asked for and the step in
   * flight has not ended. Stopping the glint there would tell a person the work had
   * stopped while it was still running, which is worse than not animating at all.
   */
  it('keeps running when a pause has been asked for and the step has not ended', () => {
    assert.equal(nodeIsWorking('active', 'pause-requested'), true);
  });

  it('stops at a pause that has arrived, and while waiting for the person', () => {
    assert.equal(nodeIsWorking('active', 'paused'), false);
    assert.equal(nodeIsWorking('active', 'waiting-for-you'), false);
  });

  it('never runs on a node that is not active, whatever the control says', () => {
    const states: readonly NodeRunState[] = [
      'not-reached',
      'ready',
      'waiting',
      'finished',
      'failed',
      'stopped',
    ];
    const phases: readonly (ControlPhase | null)[] = [
      'running',
      'pause-requested',
      'paused',
      'waiting-for-you',
      'ready',
      null,
    ];
    for (const state of states) {
      for (const phase of phases) {
        assert.equal(
          nodeIsWorking(state, phase),
          false,
          `${state} with the control ${String(phase)} must not glint`,
        );
      }
    }
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-80: the outline the glint travels                                      */
/* ------------------------------------------------------------------------- */

describe('the outline the glint travels', () => {
  /**
   * The constraint the card warns about, as a property of the path itself.
   *
   * A travelling highlight is usually inflated a few pixels outside the box so that it
   * reads as being *around* the node. Every coordinate here has to be inside the node's
   * own box instead, because connections attach to `nodeBox` and dragging hit-tests
   * against these two constants — so a shape wider than either would make the node appear
   * to grow the moment it started working.
   */
  it('stays inside the node box for every kind of node', () => {
    for (const kind of NODE_KINDS) {
      const path = nodeOutlinePath(kind);
      const numbers = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
      assert.ok(numbers.length > 0, `${kind} must produce a drawable path`);
      for (const value of numbers) {
        assert.ok(
          value >= 0 && value <= Math.max(NODE_WIDTH, NODE_HEIGHT),
          `${kind}: ${String(value)} in "${path}" is outside the node's own box`,
        );
      }
    }
  });

  it('closes, so a lap of the glint ends where it began', () => {
    for (const kind of NODE_KINDS) {
      assert.match(nodeOutlinePath(kind), /Z$/, `${kind}'s outline must be a closed path`);
    }
  });

  /**
   * The corner radius is shared with the `<rect>` the body is drawn as.
   *
   * Not a restatement of the function: the point is that a terminal is a pill and a step
   * is not, so a glint drawn with one radius on a node drawn with the other would visibly
   * cut across the ends. Both numbers come from here, and this is the check that they
   * stay the two different numbers they have to be.
   */
  it('rounds a terminal into a pill and a step into a box', () => {
    assert.equal(nodeCornerRadius('terminal'), NODE_HEIGHT / 2);
    assert.equal(nodeCornerRadius('agent'), 6);
    assert.equal(nodeCornerRadius('human'), 14);
    assert.notEqual(nodeCornerRadius('terminal'), nodeCornerRadius('agent'));
  });

  /**
   * One stylesheet for three shapes, which is what `pathLength` buys.
   *
   * Their real perimeters differ by about a fifth, so a dash written in pixels would be a
   * different fraction of each and the glint would be a different length and speed on
   * every kind of node. This is the constant that makes the CSS numbers shares of the
   * perimeter instead.
   */
  it('declares one length for every shape, so the dash is a share of the perimeter', () => {
    assert.equal(GLINT_PATH_LENGTH, 100);
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-80: the light along the glint                                          */
/* ------------------------------------------------------------------------- */

/**
 * One continuous gradient, which is a claim about numbers before it is one about pixels.
 *
 * Niclas tried the four-dash version and read it as separate bright marks. What he asked
 * for is one glint: a tail fading continuously up to a bright leading edge, a very short
 * fade at that edge, the same total length, and the same motion. SVG cannot put a gradient
 * along a path, so the ramp is pieces of one path — and the whole question is whether the
 * pieces can be told apart.
 *
 * Every property below is one that would betray them. A gap between two pieces would be a
 * dark line; an overlap would be a bright one; a jump in brightness at a seam would be a
 * visible step; and a tail cut into equal lengths would put its biggest jumps exactly
 * where the light changes fastest, which is where the eye is. They are checked here rather
 * than in a window because they are arithmetic, and because a window can only show that
 * the seams are invisible at one zoom on one screen.
 */
describe('the light along the glint', () => {
  const segments = glintSegments();
  const dash = (segment: GlintSegment): readonly number[] =>
    segment.dashArray.split(' ').map(Number);

  it('is one object of the length the four dashes came to together', () => {
    const first = segments[0] as GlintSegment;
    const last = segments[segments.length - 1] as GlintSegment;
    assert.equal(first.from, 0, 'the gradient must begin at the leading edge');
    assert.equal(
      Math.round(last.to * 100) / 100,
      GLINT_TOTAL_LENGTH,
      'and end at the length the staggered dashes spanned',
    );
    // 3 × 3.846 units of stagger plus the last dash's 3.5, which is what the old comet
    // measured from its head to the end of its final tail.
    assert.equal(GLINT_TOTAL_LENGTH, 15.04);
  });

  it('has no gap and no overlap anywhere along it', () => {
    for (let index = 1; index < segments.length; index += 1) {
      const previous = segments[index - 1] as GlintSegment;
      const current = segments[index] as GlintSegment;
      assert.ok(
        Math.abs(current.from - previous.to) < 1e-9,
        `piece ${String(index)} begins at ${String(current.from)} and the one before it ` +
          `ended at ${String(previous.to)}: a gap darkens the seam and an overlap brightens it`,
      );
      assert.ok(current.to > current.from, `piece ${String(index)} must have a length`);
    }
  });

  /**
   * The dash pattern is what places a piece, and it must place it where `from`/`to` say.
   *
   * Two things could go wrong invisibly here. The pattern could fail to sum to
   * `GLINT_PATH_LENGTH`, in which case it repeats at some other interval and the gradient
   * appears more than once on the outline; or the gap could be measured from the wrong end,
   * which would reverse the ramp and put the bright edge at the back.
   */
  it('places every piece by its dash pattern, counting from the leading edge', () => {
    for (const segment of segments) {
      const [zero, gap, drawn, rest] = dash(segment) as [number, number, number, number];
      assert.equal(zero, 0, 'the pattern must open with a zero-length dash that draws nothing');
      assert.ok(
        Math.abs(gap - (GLINT_TOTAL_LENGTH - segment.to)) < 0.001,
        `the gap before a piece ending ${String(segment.to)} behind the edge was ${String(gap)}`,
      );
      assert.ok(
        Math.abs(drawn - (segment.to - segment.from)) < 0.001,
        'the drawn length must be the piece\u2019s own length',
      );
      assert.ok(
        Math.abs(zero + gap + drawn + rest - GLINT_PATH_LENGTH) < 0.01,
        `the pattern summed to ${String(zero + gap + drawn + rest)} rather than ` +
          `${String(GLINT_PATH_LENGTH)}, so the gradient would repeat within one lap`,
      );
    }
  });

  it('is brightest just behind the leading edge, and fades to nothing at the tail', () => {
    const brightest = segments.reduce((best, segment) =>
      segment.alpha > best.alpha ? segment : best,
    );
    assert.ok(
      brightest.to <= GLINT_LEADING_FADE + 1,
      `the brightest piece ends ${String(brightest.to)} units back, which is not "near the ` +
        'leading edge"',
    );
    assert.ok(brightest.alpha > 0.9, 'the brightest piece must be very nearly opaque');
    const last = segments[segments.length - 1] as GlintSegment;
    assert.ok(last.alpha < 0.05, `the tail ends at ${String(last.alpha)} rather than at nothing`);
  });

  /**
   * The fade at the front is short, and the fall behind the peak never turns back up.
   *
   * "Nearly sharp, but without a hard cut" is a length: about four or five screen pixels at
   * the zoom the editor opens at, which is what `GLINT_LEADING_FADE` of a ~430-unit
   * perimeter comes to. A longer one would read as a blunt comet pointing the wrong way.
   */
  it('rises over a very short leading fade and then only falls', () => {
    assert.ok(
      GLINT_LEADING_FADE <= 1.5,
      `a ${String(GLINT_LEADING_FADE)}-unit fade at the front is not nearly sharp`,
    );
    const rising = segments.filter((segment) => segment.to <= GLINT_LEADING_FADE + 1e-9);
    assert.ok(rising.length >= 3, 'the leading fade needs steps, or it is a cut');
    for (let index = 1; index < rising.length; index += 1) {
      assert.ok(
        (rising[index] as GlintSegment).alpha > (rising[index - 1] as GlintSegment).alpha,
        'the leading fade must rise the whole way to the peak',
      );
    }
    const falling = segments.filter((segment) => segment.from >= GLINT_LEADING_FADE - 1e-9);
    for (let index = 1; index < falling.length; index += 1) {
      assert.ok(
        (falling[index] as GlintSegment).alpha < (falling[index - 1] as GlintSegment).alpha,
        `the tail brightened again at ${String((falling[index] as GlintSegment).from)} units back`,
      );
    }
  });

  /**
   * The tail is cut at equal steps of brightness, and that is the reason it reads as one.
   *
   * Equal *lengths* would band worst right behind the leading edge, where the ramp is
   * steepest and the eye is looking. Solving for equal alpha instead puts short pieces
   * where the light changes fast and long ones out in the faint tail. Both halves are
   * asserted: the steps are equal, and the lengths consequently are not.
   */
  it('steps the tail evenly in brightness rather than in length', () => {
    const tail = segments.filter((segment) => segment.from >= GLINT_LEADING_FADE - 1e-9);
    const steps = tail
      .slice(1)
      .map((segment, index) => (tail[index] as GlintSegment).alpha - segment.alpha);
    const largest = Math.max(...steps);
    const smallest = Math.min(...steps);
    assert.ok(
      Math.abs(largest - smallest) < 1e-9,
      `the tail's brightness steps ran from ${String(smallest)} to ${String(largest)}`,
    );
    assert.ok(
      largest <= 0.06,
      `a ${String(largest)} jump at a seam is large enough to see; the tail needs more steps`,
    );
    const lengths = tail.map((segment) => segment.to - segment.from);
    assert.ok(
      Math.max(...lengths) > Math.min(...lengths) * 3,
      'equal-length pieces would mean the steps are not equal in brightness after all',
    );
  });

  it('tapers width and colour between the two values the stylesheet already used', () => {
    const first = segments[0] as GlintSegment;
    const last = segments[segments.length - 1] as GlintSegment;
    assert.equal(first.width, 3, 'the head keeps the old head\u2019s width');
    assert.ok(
      Math.abs(last.width - 1.8) < 0.15,
      `the end of the tail is ${String(last.width)} wide rather than the old tail's 1.8`,
    );
    assert.equal(first.colour, 'rgb(232, 251, 241)');
    // Not exactly the tail colour: the last piece is taken at its middle like every other,
    // so it lands a little short of the far end. Near enough that it is the green and not
    // the near-white is the whole of the claim.
    const [red] = /rgb\((\d+)/.exec(last.colour)?.slice(1).map(Number) as [number];
    assert.ok(red < 145, `the end of the tail is ${last.colour}, which is not the green`);
    for (let index = 1; index < segments.length; index += 1) {
      assert.ok(
        (segments[index] as GlintSegment).width <= (segments[index - 1] as GlintSegment).width,
        'the width may narrow along the tail but must never widen',
      );
    }
    assert.ok(
      Math.max(...segments.map((segment) => segment.width)) <= 3,
      'no piece may be wider than the widest the four dashes were, or the glow grew',
    );
  });

  /**
   * Fine enough that the smallest thing it could band at is smaller than a pixel.
   *
   * The perimeter of a step is about 430 user units, so a piece is `length / 100 * 430`
   * units long and, at the zoom the editor opens at, about 0.85 of that in pixels. The
   * shortest piece works out under two pixels — which is the strongest form the claim can
   * take: at the steep end of the ramp the quantisation is finer than the screen.
   */
  it('cuts its steepest part into pieces shorter than a pixel and a half', () => {
    const shortest = Math.min(...segments.map((segment) => segment.to - segment.from));
    const perimeterUnits = 433.7;
    const pixels = (shortest / GLINT_PATH_LENGTH) * perimeterUnits * 0.85;
    assert.ok(
      pixels < 1.5,
      `the shortest piece is ${String(Math.round(pixels * 100) / 100)} pixels at the opening zoom`,
    );
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-36: what earns a tick                                                  */
/* ------------------------------------------------------------------------- */

describe('a terminal that declares success', () => {
  const nodeById = (id: string): LoopNode =>
    fixtureGraph().nodes.find((node) => node.id === id) as LoopNode;

  it('is the declaration and not the label', () => {
    // `lost` is labelled *Assignment not met* and declares success; `won` is the reverse.
    assert.equal(terminalDeclaresSuccess(nodeById('lost')), true);
    assert.equal(terminalDeclaresSuccess(nodeById('won')), false);
  });

  it('is false for a terminal that declares nothing, and for nothing at all', () => {
    assert.equal(terminalDeclaresSuccess(nodeById('silent')), false);
    assert.equal(terminalDeclaresSuccess(null), false);
    assert.equal(terminalDeclaresSuccess(undefined), false);
  });

  it('is false for a step that is not a terminal', () => {
    assert.equal(terminalDeclaresSuccess(nodeById('work')), false);
  });

  it('is refused by the loader on a node that cannot end a run', () => {
    const broken = TWO_TERMINALS.replace(
      '"label": "Do the thing",',
      '"label": "Do the thing",\n      "ending": "success",',
    );
    const parsed = parseLoopGraph(broken);
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok);
    assert.ok(
      parsed.findings.some((finding) => finding.code === 'ending-on-a-step-that-does-not-end'),
      `expected a refusal about ending on a step: ${JSON.stringify(parsed.findings.map((f) => f.code))}`,
    );
  });

  it('is refused by the loader when it is not one of the two values', () => {
    const parsed = parseLoopGraph(TWO_TERMINALS.replace('"not-success"', '"maybe"'));
    assert.equal(parsed.ok, false);
    assert.ok(!parsed.ok);
    assert.ok(parsed.findings.some((finding) => finding.code === 'bad-ending'));
  });
});

describe('the mark a finished run leaves', () => {
  it('ticks the terminal the run reached when the graph declares it a success', () => {
    const marks = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), fixtureDrawing());
    assert.ok(marks !== null);
    assert.equal(marks.terminalNodeId, 'lost');
    assert.equal(marks.successNodeId, 'lost');
    assert.equal(endingMarkFor(marks, 'lost'), 'success');
  });

  /**
   * The reading Niclas asked for, in one assertion.
   *
   * `won` is labelled *Assignment met*. A tick decided by the words would appear on it.
   */
  it('does not tick a terminal labelled "Assignment met" that declares not-success', () => {
    const marks = finishedRunMarksFrom(walkTo('won'), fixtureGraph(), fixtureDrawing());
    assert.ok(marks !== null);
    assert.equal(marks.successNodeId, null);
    assert.equal(endingMarkFor(marks, 'won'), 'reached');
  });

  it('marks a terminal that declares nothing, without a tick', () => {
    const marks = finishedRunMarksFrom(walkTo('silent'), fixtureGraph(), fixtureDrawing());
    assert.ok(marks !== null);
    assert.equal(endingMarkFor(marks, 'silent'), 'reached');
  });

  it('marks no node but the one the run ended at', () => {
    const marks = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), fixtureDrawing());
    assert.equal(endingMarkFor(marks, 'won'), null);
    assert.equal(endingMarkFor(marks, 'work'), null);
  });

  /**
   * A run that faulted has a last-entered node and no terminal.
   *
   * Which is why the terminal is carried rather than inferred from the journal: the last
   * node entered is exactly the wrong answer here, and it would have earned this run a
   * mark saying it ended somewhere on purpose.
   */
  it('leaves no ending mark for a run that reached no terminal', () => {
    const marks = finishedRunMarksFrom(walkTo(null, 'runtime-fault'), fixtureGraph(), fixtureDrawing());
    assert.ok(marks !== null);
    assert.equal(marks.terminalNodeId, null);
    assert.equal(marks.successNodeId, null);
    assert.equal(endingMarkFor(marks, 'work'), null);
  });

  it('leaves nothing at all for a run that has not ended', () => {
    const run = announcement();
    const walking = applyRunEvent(runViewFor(run), {
      kind: 'journal',
      runId: run.runId,
      graphVersionId: run.graphVersionId,
      entry: entry('node-entered', 'work'),
    }) as RunView;
    assert.equal(finishedRunMarksFrom(walking, fixtureGraph(), fixtureDrawing()), null);
  });
});

describe('the mark belongs to the run and its graph', () => {
  it('is shown on the drawing it was recorded for', () => {
    const marks = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), fixtureDrawing());
    assert.equal(finishedMarksBelongTo(marks, fixtureDrawing()), true);
  });

  /**
   * DSP-36 #8, and the reason it is a comparison of drawings rather than of ids.
   *
   * A dry run has no content hash and says so with one shared value, so a mark bound to
   * the version id alone would follow a person onto a different loop — where the ids that
   * happened to match would light and the rest would silently not.
   */
  it('is withheld on any other drawing', () => {
    const marks = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), fixtureDrawing());
    const somethingElse = fixtureDrawing().replace('"Do the thing"', '"Something else"');
    assert.equal(finishedMarksBelongTo(marks, somethingElse), false);
  });

  it('is withheld when either side could not be read', () => {
    const unreadable = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), null);
    assert.equal(finishedMarksBelongTo(unreadable, fixtureDrawing()), false);
    const marks = finishedRunMarksFrom(walkTo('lost'), fixtureGraph(), fixtureDrawing());
    assert.equal(finishedMarksBelongTo(marks, null), false);
  });

  /**
   * Line endings cannot decide whether a mark is shown.
   *
   * Both sides are serialised with `'\n'` by their callers, so the comparison is of
   * normalised text. Worth a test because the alternative — comparing the bytes as they
   * sit on disk — would make the mark appear or vanish according to how the file was
   * checked out, and thirteen files in this working copy changed line ending overnight.
   */
  it('does not depend on how the file on disk ends its lines', () => {
    const graph = fixtureGraph();
    const lf = serialiseLoopGraph(graph, { newline: '\n' });
    const crlf = serialiseLoopGraph(graph, { newline: '\r\n' });
    assert.notEqual(lf, crlf, 'the two serialisations must really differ, or this proves nothing');
    const loadedFromCrlf = parseLoopGraph(crlf);
    assert.ok(
      loadedFromCrlf.ok,
      `CRLF bytes must load: ${JSON.stringify(loadedFromCrlf.ok ? [] : loadedFromCrlf.findings)}`,
    );
    assert.equal(
      serialiseLoopGraph(loadedFromCrlf.graph, { newline: '\n' }),
      lf,
      'a graph read from CRLF bytes must serialise to the same normalised drawing',
    );
  });
});

describe('a finished run and a ready loop, both on screen', () => {
  const ended = (): RunView => walkTo('lost');

  it('keeps the run\u2019s marks under the Ready pulse', () => {
    const marks = finishedRunMarksFrom(ended(), fixtureGraph(), fixtureDrawing());
    const standingBy = runViewFor(announcement({ runId: 'ready-1', phase: 'ready' }));
    const merged = markedNodes(standingBy, marks, 'work');
    // The entry step says the loop is standing by, and the terminal still says where the
    // last run got to. Both at once is the whole request.
    assert.equal(merged.get('work'), 'ready');
    assert.equal(merged.get('lost'), 'finished');
  });

  /**
   * A new run's own marks win, including the absence of one.
   *
   * The caller drops the finished marks when a run starts; this ordering means that a
   * caller which had not yet would still not show a stale mark on a node the new run has
   * reached, which is the safer way round for the two to disagree.
   */
  it('lets a live state override what the last run left on that node', () => {
    const marks = finishedRunMarksFrom(ended(), fixtureGraph(), fixtureDrawing());
    const second = announcement({ runId: 'run-second' });
    const walking = applyRunEvent(runViewFor(second), {
      kind: 'journal',
      runId: second.runId,
      graphVersionId: second.graphVersionId,
      entry: entry('node-entered', 'lost'),
    }) as RunView;
    assert.equal(markedNodes(walking, marks).get('lost'), 'active');
  });

  it('marks nothing at all when the marks do not belong to this drawing', () => {
    const standingBy = runViewFor(announcement({ runId: 'ready-1', phase: 'ready' }));
    // `null` is what the caller passes once `finishedMarksBelongTo` has said no.
    assert.deepEqual([...markedNodes(standingBy, null, 'work')], [['work', 'ready']]);
  });
});
