/**
 * The loop graph format.
 *
 * What is worth testing here is not that a graph round-trips. It is the small set of
 * things this format exists to prevent:
 *
 * - a graph that draws a *runtime fault* as an edge, which would give every node a
 *   "what if this hangs" arrow and still not handle one;
 * - a declared failure or a branch with nowhere to go, which is what turns a loop back
 *   into a flowchart;
 * - a role reference that resolves to nothing, silently treated as an empty role;
 * - a step required not to write files that is also asked to file its own report —
 *   the exact mistake made on 15 September 2026;
 * - a target change that quietly drops a requirement.
 *
 * And one integration test that matters more than any of them: the example graph is our
 * own development loop, and it must load and validate against the real role files in
 * `.cursor/`. The editor and the runner are both being built against it.
 *
 *     node --test tests/loop-graph.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import {
  LOOP_GRAPH_FORMAT,
  LOOP_GRAPH_FORMAT_VERSION,
  TARGET_CAPABILITIES,
  attributeSupport,
  describeTargetChange,
  namesARuntimeFault,
  runnableHere,
  withTarget,
  writeReachOf,
} from '../src/shared/loop-graph.ts';
import type { LoopGraph, ResolvedRole, TargetCapabilities } from '../src/shared/loop-graph.ts';
import {
  checkLoopGraph,
  formatFindings,
  hasErrors,
  loadLoopGraph,
  parseLoopGraph,
} from '../src/shared/loop-graph-load.ts';
import type { Finding } from '../src/shared/loop-graph-load.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplePath = path.join(
  repoRoot,
  'docs',
  'loop',
  'graphs',
  'dspatch-development-loop.graph.json',
);

function codes(findings: readonly Finding[]): string[] {
  return findings.map((finding) => finding.code);
}

function errorsOf(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.severity === 'error');
}

/** A minimal valid graph to mutate one thing at a time. */
function minimal(): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'tiny',
    name: 'Tiny loop',
    purpose: 'A two-step loop used to test one rule at a time.',
    target: 'cursor',
    entry: 'start',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [{ id: 'spec-error', label: 'spec error', meaning: 'The premise was wrong.' }],
    nodes: [
      { id: 'start', kind: 'human', label: 'Start' },
      { id: 'done', kind: 'terminal', label: 'Done' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
  };
}

const NEVER_RESOLVES = () => null;

// ---------------------------------------------------------------------------
// The example graph: our own loop, against the real role files.
// ---------------------------------------------------------------------------

test('the example graph is our own loop, and it loads and validates against the real roles', () => {
  const text = fs.readFileSync(examplePath, 'utf8');
  const result = loadLoopGraph(text, {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });

  assert.equal(
    result.ok,
    true,
    result.ok ? '' : `the example graph must be valid, and is not:\n${formatFindings(result.findings)}`,
  );
  if (!result.ok) {
    return;
  }

  assert.equal(result.graph.id, 'dspatch-development-loop');
  assert.equal(result.graph.target, 'cursor');
  assert.equal(result.runnable.runnable, true);
  assert.equal(hasErrors(result.findings), false);

  // The six real roles, one of them referenced by two nodes.
  const roleIds = result.graph.nodes.flatMap((node) => (node.role ? [node.role.id] : []));
  assert.deepEqual(
    [...new Set(roleIds)].sort(),
    [
      'dspatch-backlog-planner',
      'dspatch-implementer',
      'dspatch-loop',
      'dspatch-researcher',
      'dspatch-reviewer',
      'dspatch-verifier',
    ],
  );
  assert.equal(
    roleIds.filter((id) => id === 'dspatch-reviewer').length,
    2,
    'the reviewer role is referenced by both review gates rather than copied',
  );

  // A role every node references must actually exist on disk.
  const resolve = createFileRoleResolver(repoRoot);
  for (const node of result.graph.nodes) {
    if (node.role) {
      assert.ok(resolve(node.role), `role for node ${node.id} does not resolve`);
    }
  }
});

test('the example graph says which attributes nothing honours yet', () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const notices = checkLoopGraph(parsed.graph, {
    resolveRole: createFileRoleResolver(repoRoot),
  }).filter((finding) => finding.code === 'not-yet-honoured');

  const attributes = notices.map((notice) => notice.message.split('"')[1]);
  for (const expected of ['model', 'limits', 'requirements', 'onRuntimeFault']) {
    assert.ok(
      attributes.includes(expected),
      `"${expected}" is set by the example graph, so its unhonoured state must be reported. ` +
        `Reported: ${attributes.join(', ')}`,
    );
  }

  // `archive` and `report` were in that list until DSP-74, and their leaving it is the
  // point of the card: the runner now computes each step's placement from `archive` and
  // files the entry there, with `report.writtenBy` deciding whether the step or the
  // runner writes it. They are honoured with a caveat rather than silently promoted,
  // because a run given nowhere to file results still files none — so the author is told
  // where the honouring stops instead of being told nothing.
  const partly = checkLoopGraph(parsed.graph, { resolveRole: createFileRoleResolver(repoRoot) })
    .filter((finding) => finding.code === 'partly-honoured')
    .map((finding) => finding.message.split('"')[1]);
  for (const nowHonoured of ['archive', 'report']) {
    assert.equal(
      attributes.includes(nowHonoured),
      false,
      `"${nowHonoured}" is honoured since DSP-74 and must stop reporting itself unhonoured`,
    );
    assert.ok(
      partly.includes(nowHonoured),
      `"${nowHonoured}" is honoured only where a run has somewhere to file results, and an ` +
        `author setting it is owed that sentence. Reported as partly honoured: ${partly.join(', ')}`,
    );
  }
});

/**
 * DSP-79: our own loop's requirements, said in the drawing rather than beside it.
 *
 * Until this card `produces` and `consumes` existed and no shipped graph used either,
 * so the mechanism was exercised by fixtures alone. What is pinned here is the thing a
 * fixture cannot pin — that the drawing of the loop we actually run states what each
 * step must leave and who receives it, in the general vocabulary rather than in prose
 * a runner cannot read.
 */
test('our own loop says what each step must leave and which later step receives it', () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const node = (id: string) => {
    const found = parsed.graph.nodes.find((each) => each.id === id);
    assert.ok(found, `the example graph must still have a node called "${id}"`);
    return found;
  };

  // Every step that owes a report says so, and says it is required — which is what
  // makes "a step that delivered nothing was not recorded as delivered" checkable.
  for (const id of [
    'backlog-planner',
    'researcher',
    'implementer',
    'verifier',
    'plan-review',
    'implementation-review',
    'coordinator-report',
  ]) {
    assert.equal(node(id).produces?.required, true, `"${id}" owes a report`);
    assert.equal(node(id).produces?.form, 'markdown-file');
  }

  // The read-only roles, which is the 15 September mistake expressed as a declaration:
  // they must leave a report and they cannot write it, so the runner files it.
  for (const id of ['backlog-planner', 'researcher', 'plan-review', 'implementation-review']) {
    assert.equal(node(id).report?.writtenBy, 'coordinator', `"${id}" is read-only`);
  }
  for (const id of ['implementer', 'verifier', 'coordinator-report']) {
    assert.equal(node(id).report?.writtenBy, 'self');
  }

  // The handovers our contract describes in prose, as edges cannot: the verifier is
  // given the implementer's report, and the review is given the same material plus the
  // verifier's evidence.
  assert.deepEqual(node('plan-review').consumes, ['backlog-planner']);
  assert.deepEqual(node('verifier').consumes, ['implementer']);
  assert.deepEqual(node('implementation-review').consumes, ['implementer', 'verifier']);

  // And a step nothing hands to — the implementer can be reached without a planner
  // having run — declares no input rather than one the run cannot always satisfy.
  assert.equal(node('implementer').consumes, undefined);
  assert.equal(node('coordinator-report').consumes, undefined);
});

/**
 * DSP-79 #7. The gaps are stated where a person reads the drawing, not only in a card.
 *
 * Prose, so this asserts the subjects rather than the sentences: a reader opening this
 * graph has to be told that the candidate is not bound, that the review nodes used
 * to be gates and are agents now, that limits are declared and not enforced, that
 * the human nodes cannot be answered, and that nothing survives a restart. A drawing
 * that quietly implied DSpatch runs our loop would be the claim this whole card
 * exists to avoid making.
 */
test('our own loop states, in itself, which of it DSpatch would not actually run', () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const notes = parsed.graph.notes ?? '';
  for (const [subject, pattern] of [
    ['it runs in Cursor, not in DSpatch', /runs in Cursor/i],
    ['the candidate is not bound to the evidence', /candidate/i],
    ['the review nodes used to be gates and are agents now', /they are agents now/i],
    ['limits are declared and not enforced', /declared and not enforced/i],
    ['human nodes cannot be answered in the chat', /cannot be answered in the chat/i],
    ['nothing survives a restart', /restart/i],
  ] as const) {
    assert.match(notes, pattern, `the drawing must say that ${subject}`);
  }
  assert.equal(
    parsed.graph.nodes.find((node) => node.id === 'plan-review')?.kind,
    'agent',
  );
  assert.equal(
    parsed.graph.nodes.find((node) => node.id === 'implementation-review')?.kind,
    'agent',
  );
});

/**
 * DSP-46 #3, and the way it was missed.
 *
 * The criterion is that a recorded attribute the runner does not honour says so. It was
 * not broken by a wrong row in `ATTRIBUTE_SUPPORT` — it was broken by a *missing* row:
 * `role` was validated, then ignored, and the table whose entire purpose is disclosing
 * that had nothing to say about it, so every graph read as though its roles were in force.
 *
 * A missing row cannot be caught by reading the table, so this test reads the *type*
 * instead: every optional field a node or a graph may set has to appear, and one added
 * without a row fails here. The field list is written out rather than derived, because
 * TypeScript types do not exist at runtime — so the list itself is the thing under test,
 * and `loop-graph.ts` is the place a new field would be added.
 */
test('every attribute a graph can set has a row saying who honours it', () => {
  const settableOnANode = [
    'label',
    'purpose',
    'role',
    'model',
    'limits',
    'requirements',
    'report',
    'produces',
    'consumes',
    'outcomes',
    'declaredFailures',
    'view',
  ];
  const settableOnAGraph = ['limits', 'archive', 'onRuntimeFault', 'failureKinds', 'notes'];

  for (const attribute of [...settableOnANode, ...settableOnAGraph]) {
    const support = attributeSupport(attribute);
    assert.ok(
      support !== null,
      `"${attribute}" can be set in a graph file and no row says whether anything honours ` +
        `it. An author setting it would be told nothing, which is how "role" came to be ` +
        `validated and then ignored.`,
    );
    assert.ok(
      (support?.by ?? '').length > 0,
      `"${attribute}" must name who honours it or who will — "${String(
        support?.honoured,
      )}" on its own tells an author nothing they can act on`,
    );
  }
});

/**
 * An attribute honoured on one path and not another says which, rather than claiming both.
 *
 * `role` is the case: the chat loop sends the role's text with the prompt, the editor's Run
 * button walks a different graph with a fixed prompt, and a dry run calls no provider. A
 * plain `honoured: true` would tell an author their role governs a dry run.
 */
test('an attribute honoured on only some paths reports the caveat against a graph that sets it', () => {
  const chatLoop = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');
  const parsed = parseLoopGraph(fs.readFileSync(chatLoop, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }

  const role = attributeSupport('role');
  assert.equal(role?.honoured, true, 'the chat loop does send the role text');
  assert.ok(
    role?.caveat !== undefined,
    'and it is not sent on every path, which has to be written down rather than implied',
  );

  const findings = checkLoopGraph(parsed.graph, {
    resolveRole: createFileRoleResolver(repoRoot),
  });
  const partly = findings.filter((finding) => finding.code === 'partly-honoured');
  assert.ok(
    partly.some((finding) => finding.message.includes('"role"')),
    `a graph whose nodes name roles must be told where those roles are not in force. ` +
      `Reported: ${partly.map((finding) => finding.message).join(' | ')}`,
  );
  assert.equal(
    hasErrors(findings),
    false,
    'this is a notice about how far the product reaches, not a fault in the drawing: a ' +
      'graph naming roles must still load and still run',
  );
});

test("the example graph's read-only specialists do not file their own reports", () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const resolve = createFileRoleResolver(repoRoot);
  const readOnly = parsed.graph.nodes.filter((node) =>
    node.role ? (resolve(node.role)?.requirements ?? []).includes('no-file-writes') : false,
  );
  assert.ok(readOnly.length >= 3, 'the planner, researcher and reviewer are read-only');
  for (const node of readOnly) {
    assert.equal(
      node.report?.writtenBy,
      'coordinator',
      `${node.id} cannot write, so another node must file its archive entry`,
    );
  }
});

// ---------------------------------------------------------------------------
// Refusing what is not a graph, rather than half-loading it.
// ---------------------------------------------------------------------------

test('unreadable or foreign files are refused with a reason and no graph', () => {
  const notJson = parseLoopGraph('{ not json');
  assert.equal(notJson.ok, false);
  if (!notJson.ok) {
    assert.deepEqual(codes(notJson.findings), ['not-json']);
  }

  const otherJson = parseLoopGraph('{"formatVersion":1,"nodes":[]}');
  assert.equal(otherJson.ok, false);
  if (!otherJson.ok) {
    assert.deepEqual(codes(otherJson.findings), ['wrong-format']);
    assert.match(otherJson.findings[0]?.message ?? '', /has not been touched/);
  }

  const array = parseLoopGraph('[]');
  assert.equal(array.ok, false);
});

test('a graph from a newer DSpatch is refused rather than read and rewritten', () => {
  const text = JSON.stringify({
    ...minimal(),
    formatVersion: LOOP_GRAPH_FORMAT_VERSION + 1,
  });
  const result = loadLoopGraph(text);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(codes(result.findings), ['newer-format-version']);
  assert.equal(result.graph, null);
  assert.match(result.findings[0]?.message ?? '', /must not be saved by this build/);
});

test('a graph without an identity or a purpose is refused, because there will be several', () => {
  const { id: _id, purpose: _purpose, ...rest } = minimal();
  const result = parseLoopGraph(JSON.stringify(rest));
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(codes(result.findings).sort(), ['missing-id', 'missing-purpose']);
});

test('findings name the node or edge they are about, and read as instructions', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'router', label: 'Start', outcomes: ['a', 'b'] },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'c' } }],
  };
  const findings = checkLoopGraph(graph);
  const undeclared = findings.find((finding) => finding.code === 'undeclared-outcome');
  assert.ok(undeclared);
  assert.equal(undeclared?.edgeId, 'e1');
  assert.equal(undeclared?.pointer, '/edges/0/when/outcome');
  assert.match(undeclared?.message ?? '', /It declares a, b/);
  assert.match(formatFindings(findings), /^error: /m);
});

// ---------------------------------------------------------------------------
// Declared failures route; runtime faults are not expressible.
// ---------------------------------------------------------------------------

test('a runtime fault cannot be drawn as an edge', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human', declaredFailures: ['no-report'] },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'declared-failure', failure: 'no-report' } },
    ],
  };
  const finding = checkLoopGraph(graph).find((item) => item.code === 'runtime-fault-as-edge');
  assert.ok(finding, 'routing on a report that never arrived must be refused');
  assert.equal(finding?.severity, 'error');
  assert.match(finding?.message ?? '', /onRuntimeFault/);
});

test('a runtime fault cannot be declared as a failure kind either', () => {
  const text = JSON.stringify({
    ...minimal(),
    failureKinds: [{ id: 'agent-hung', label: 'hung', meaning: 'The call never came back.' }],
  });
  const result = parseLoopGraph(text);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(codes(result.findings), ['runtime-fault-as-failure-kind']);
});

test('over-matching would be worse: missing-authority is a legitimate declared failure', () => {
  assert.equal(namesARuntimeFault('missing-authority'), null);
  assert.equal(namesARuntimeFault('capacity-error'), null);
  assert.equal(namesARuntimeFault('spec-error'), null);
  assert.equal(namesARuntimeFault('missing-report'), 'missing-report');
  assert.equal(namesARuntimeFault('call-timeout'), 'timeout');
  assert.equal(namesARuntimeFault('no-outcome'), 'no-outcome');
});

test('there is no edge condition for a step that never finished', () => {
  const text = JSON.stringify({
    ...minimal(),
    edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'no-outcome' } }],
  });
  const result = parseLoopGraph(text);
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.deepEqual(codes(result.findings), ['bad-edge-condition']);
  assert.match(result.findings[0]?.message ?? '', /onRuntimeFault/);
});

test('a declared failure with nowhere to go is refused: that is a flowchart, not a loop', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human', declaredFailures: ['spec-error'] },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const finding = checkLoopGraph(graph).find((item) => item.code === 'unrouted-declared-failure');
  assert.ok(finding);
  assert.equal(finding?.nodeId, 'start');
});

test('a declared branch with nowhere to go is refused', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'router', outcomes: ['left', 'right'] },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'left' } }],
  };
  const finding = checkLoopGraph(graph).find((item) => item.code === 'unrouted-outcome');
  assert.ok(finding);
  assert.match(finding?.message ?? '', /"right"/);
});

test('a node cannot both branch on named outcomes and leave on plain success', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human', outcomes: ['left'] },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'left' } },
      { id: 'e2', from: 'start', to: 'done', when: { on: 'success' } },
    ],
  };
  assert.ok(
    checkLoopGraph(graph).some((item) => item.code === 'success-edge-on-a-branching-node'),
  );
});

/**
 * DSP-103. Where a reply that declares no result goes is stated, and stated in a name
 * the node can actually produce.
 *
 * The refusal is the load-bearing half: without it `whenUndeclared` would hand the
 * runner an outcome the node does not declare, and the run would stop the *step* for
 * producing something the graph gave it — a fault blaming the agent for the drawing.
 */
test('a node cannot route an undeclared reply to an outcome it does not declare', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: { id: 'r', source: { kind: 'role-source', path: 'roles/r.role.md' } },
        outcomes: ['done', 'unclear'],
        whenUndeclared: 'not-established',
      },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'done' } },
      { id: 'e2', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'unclear' } },
    ],
  };
  const finding = checkLoopGraph(graph).find(
    (item) => item.code === 'when-undeclared-not-an-outcome',
  );
  assert.ok(finding);
  assert.equal(finding?.severity, 'error');
  assert.match(finding?.message ?? '', /"not-established"/);
  assert.match(finding?.message ?? '', /It declares done, unclear/);
});

/**
 * And on a node that declares none, where there is no missing declaration to route: its
 * ordinary reply is its result, which is the contract DSP-103 had to leave alone.
 */
test('a node that declares no outcomes has no undeclared route to give', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human', whenUndeclared: 'unclear' },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [{ id: 'e1', from: 'start', to: 'done', when: { on: 'success' } }],
  };
  const finding = checkLoopGraph(graph).find(
    (item) => item.code === 'when-undeclared-not-an-outcome',
  );
  assert.ok(finding);
  assert.match(finding?.message ?? '', /ordinary reply is its result/);
});

/**
 * The migration, made visible where an author meets it (DSP-103 #6).
 *
 * A drawing that spelled an outcome `unclear` used to get the graceful route for free and
 * now stops the run instead. That is a deliberate change of behaviour to somebody else's
 * file, so it is said on screen while the graph is open rather than discovered as a run
 * that used to reach a terminal. The warning decides nothing: the same graph with
 * `whenUndeclared` set is silent, and a graph that spells the idea any other way is
 * silent too — because there is nothing left to warn about once nothing is inferred.
 */
test('a drawing that relied on the old spelling is told its behaviour has changed', () => {
  const withOldSpelling = (whenUndeclared?: string): LoopGraph => ({
    ...minimal(),
    nodes: [
      {
        id: 'start',
        kind: 'human',
        outcomes: ['succeeded', 'unclear'],
        ...(whenUndeclared === undefined ? {} : { whenUndeclared }),
      },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'succeeded' } },
      { id: 'e2', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'unclear' } },
    ],
  });

  const warned = checkLoopGraph(withOldSpelling()).find(
    (item) => item.code === 'undeclared-route-no-longer-inferred',
  );
  assert.ok(warned, 'the change of behaviour must be said, not left to be discovered');
  assert.equal(warned?.severity, 'warning');
  assert.match(warned?.message ?? '', /"whenUndeclared": "unclear"/);

  // Stating it is what clears it, and it is the only thing that does.
  assert.equal(
    checkLoopGraph(withOldSpelling('unclear')).some(
      (item) => item.code === 'undeclared-route-no-longer-inferred',
    ),
    false,
  );
  // And the same drawing with the idea spelled any other way is not warned about,
  // because nothing was ever inferred from that name either.
  const otherwiseSpelled: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human', outcomes: ['succeeded', 'not-established'] },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'succeeded' } },
      { id: 'e2', from: 'start', to: 'done', when: { on: 'outcome', outcome: 'not-established' } },
    ],
  };
  assert.deepEqual(
    codes(checkLoopGraph(otherwiseSpelled)).filter((code) =>
      code.startsWith('undeclared-route'),
    ),
    [],
  );
});

test('an edge cannot carry a failure its source node does not declare', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'human' },
      { id: 'done', kind: 'terminal' },
    ],
    edges: [
      { id: 'e1', from: 'start', to: 'done', when: { on: 'declared-failure', failure: 'spec-error' } },
    ],
  };
  assert.ok(
    checkLoopGraph(graph).some((item) => item.code === 'failure-not-declared-by-node'),
  );
});

test('an edge to a node that is not there names the missing node', () => {
  const graph: LoopGraph = {
    ...minimal(),
    edges: [{ id: 'e1', from: 'start', to: 'nowhere', when: { on: 'success' } }],
  };
  const finding = checkLoopGraph(graph).find((item) => item.code === 'edge-to-missing-node');
  assert.ok(finding);
  assert.match(finding?.message ?? '', /"nowhere"/);
});

// ---------------------------------------------------------------------------
// Roles are referenced, not contained.
// ---------------------------------------------------------------------------

test('an agent node with no role is refused', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      { id: 'start', kind: 'agent' },
      { id: 'done', kind: 'terminal' },
    ],
  };
  assert.ok(checkLoopGraph(graph).some((item) => item.code === 'agent-without-role'));
});

test('a role reference that resolves to nothing is an error, not an empty role', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: { id: 'ghost', source: { kind: 'cursor-agent-file', path: '.cursor/agents/ghost.md' } },
      },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const finding = checkLoopGraph(graph, { resolveRole: NEVER_RESOLVES }).find(
    (item) => item.code === 'role-does-not-resolve',
  );
  assert.ok(finding);
  assert.equal(finding?.severity, 'error');
});

test('without a resolver, a role is reported as unchecked rather than as fine', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: { id: 'ghost', source: { kind: 'cursor-agent-file', path: '.cursor/agents/ghost.md' } },
      },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const findings = checkLoopGraph(graph);
  const finding = findings.find((item) => item.code === 'role-not-checked');
  assert.ok(finding);
  assert.equal(finding?.severity, 'warning');
  assert.equal(errorsOf(findings).length, 0, 'unchecked is not invalid');
});

test('a role that does not support the graph target is an error', () => {
  const graph: LoopGraph = {
    ...minimal(),
    target: 'claude-code',
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: {
          id: 'cursor-only',
          source: { kind: 'cursor-agent-file', path: '.cursor/agents/cursor-only.md' },
        },
      },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const role: ResolvedRole = {
    id: 'cursor-only',
    sourcePath: '.cursor/agents/cursor-only.md',
    targets: ['cursor'],
    targetsDeclared: true,
    requirements: [],
    requirementsDeclared: true,
  };
  const finding = checkLoopGraph(graph, { resolveRole: () => role }).find(
    (item) => item.code === 'role-does-not-support-target',
  );
  assert.ok(finding);
  assert.match(finding?.message ?? '', /supports cursor/);
});

test('the role files in .cursor are read as Cursor-only, and the inference is labelled', () => {
  const resolve = createFileRoleResolver(repoRoot);
  const researcher = resolve({
    id: 'dspatch-researcher',
    source: { kind: 'cursor-agent-file', path: '.cursor/agents/dspatch-researcher.md' },
  });
  assert.ok(researcher);
  assert.deepEqual(researcher?.targets, ['cursor']);
  assert.equal(researcher?.targetsDeclared, false, 'no role declares its targets before DSP-23');
  assert.equal(researcher?.requirementsDeclared, false, 'readonly: true is a mechanism, read backwards');
  assert.deepEqual(researcher?.requirements, ['no-file-writes']);

  const implementer = resolve({
    id: 'dspatch-implementer',
    source: { kind: 'cursor-agent-file', path: '.cursor/agents/dspatch-implementer.md' },
  });
  assert.deepEqual(implementer?.requirements, [], 'the implementer writes files');

  assert.equal(
    resolve({ id: 'x', source: { kind: 'cursor-agent-file', path: '../outside.md' } }),
    null,
    'a reference climbing out of the project is not resolved',
  );
});

test('a step that must not write files cannot also file its own report', () => {
  const graph: LoopGraph = {
    ...minimal(),
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: { id: 'r', source: { kind: 'role-source', path: 'roles/r.md' } },
        requirements: ['no-file-writes'],
        report: { writtenBy: 'self' },
      },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const finding = checkLoopGraph(graph, {
    resolveRole: () => ({
      id: 'r',
      sourcePath: 'roles/r.md',
      targets: ['cursor'],
      targetsDeclared: true,
      requirements: [],
      requirementsDeclared: true,
    }),
  }).find((item) => item.code === 'report-written-by-a-node-that-cannot-write');
  assert.ok(finding, 'this is the 15 September 2026 mistake and must be refused');
  assert.equal(finding?.severity, 'error');
});

// ---------------------------------------------------------------------------
// The target lives in the file.
// ---------------------------------------------------------------------------

test('a graph for a framework this machine is not connected to is reported, not refused', () => {
  const graph = withTarget(minimal(), 'copilot');
  const result = loadLoopGraph(JSON.stringify(graph), { connectedTargets: ['cursor'] });
  assert.equal(result.ok, true, 'not runnable here is not invalid');
  if (!result.ok) {
    return;
  }
  assert.equal(result.runnable.runnable, false);
  assert.match(result.runnable.reason, /cannot be run here/);
  assert.ok(result.findings.some((finding) => finding.code === 'not-runnable-here'));
});

test('an unestablished environment is unknown rather than not-runnable', () => {
  const answer = runnableHere(minimal(), null);
  assert.equal(answer.runnable, false);
  assert.match(answer.reason, /unknown/);
});

test('the same file means the same thing whoever opens it', () => {
  const text = fs.readFileSync(examplePath, 'utf8');
  const here = parseLoopGraph(text);
  const elsewhere = parseLoopGraph(text);
  assert.equal(here.ok && elsewhere.ok, true);
  if (here.ok && elsewhere.ok) {
    assert.equal(here.graph.target, elsewhere.graph.target);
    assert.deepEqual(here.graph, elsewhere.graph);
  }
});

test('changing the target reports what is lost and gained, and changes nothing', () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const resolve = createFileRoleResolver(repoRoot);
  const report = describeTargetChange(parsed.graph, 'claude-code', { resolveRole: resolve });

  assert.equal(report.from, 'cursor');
  assert.equal(report.to, 'claude-code');
  assert.ok(report.unknowns.length > 0, 'nothing has been run against Claude Code from here');
  assert.equal(report.rolesChecked, true);
  assert.ok(
    report.rolesWithoutSupport.length > 0,
    'every role is a Cursor file, so none of them supports Claude Code yet',
  );

  // Nothing was migrated and nothing was removed.
  const after = withTarget(parsed.graph, 'claude-code');
  assert.equal(after.nodes.length, parsed.graph.nodes.length);
  assert.deepEqual(
    after.nodes.map((node) => node.requirements ?? []),
    parsed.graph.nodes.map((node) => node.requirements ?? []),
  );
  assert.equal(parsed.graph.target, 'cursor', 'the original graph is untouched');
});

test('a requirement the target cannot meet is an error', () => {
  const table: TargetCapabilities = {
    ...TARGET_CAPABILITIES,
    copilot: {
      ...TARGET_CAPABILITIES.copilot,
      'no-file-writes': {
        status: 'unmet',
        how: 'There is no way to prevent writes there.',
        evidence: 'documentation',
      },
    },
  };
  const graph: LoopGraph = {
    ...minimal(),
    target: 'copilot',
    nodes: [
      {
        id: 'start',
        kind: 'agent',
        role: { id: 'r', source: { kind: 'role-source', path: 'roles/r.md' } },
        requirements: ['no-file-writes'],
        report: { writtenBy: 'done' },
      },
      { id: 'done', kind: 'terminal' },
    ],
  };
  const findings = checkLoopGraph(graph, {
    resolveRole: () => ({
      id: 'r',
      sourcePath: 'roles/r.md',
      targets: ['copilot'],
      targetsDeclared: true,
      requirements: [],
      requirementsDeclared: true,
    }),
    targetCapabilities: table,
  });
  const finding = findings.find((item) => item.code === 'requirement-target-cannot-meet');
  assert.ok(finding);
  assert.match(finding?.message ?? '', /reads as though the requirement held/);

  const change = describeTargetChange({ ...graph, target: 'cursor' }, 'copilot', {
    targetCapabilities: table,
  });
  assert.ok(change.blocking.some((entry) => entry.startsWith('no-file-writes')));
});

test('a requirement the target does not enforce is said out loud rather than assumed', () => {
  const parsed = parseLoopGraph(fs.readFileSync(examplePath, 'utf8'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    return;
  }
  const findings = checkLoopGraph(parsed.graph, { resolveRole: createFileRoleResolver(repoRoot) });
  const notices = findings.filter((finding) => finding.code === 'requirement-not-enforced');
  assert.ok(
    notices.some((notice) => notice.message.includes('no-subagent-delegation')),
    'our loop requires no-subagent-delegation and Cursor does not enforce it',
  );
  // DSP-96 part 2. `no-file-writes` reads as not enforced too, and that is the correction
  // rather than a regression: a graph is validated for the run DSpatch would walk, which
  // writes and loads no agent definition, so `readonly: true` is not in play and the
  // requirement reaches the agent as a sentence in its role. Validation must not tell a
  // person a restriction holds when the only thing holding it is the agent's goodwill.
  const write = notices.find((notice) => notice.message.includes('no-file-writes'));
  assert.ok(write, 'the read-only roles in our own loop are read-only by instruction here');
  assert.match(write?.message ?? '', /nothing applies it on this path/);
  for (const notice of notices) {
    assert.equal(notice.severity, 'notice', 'a true statement about the path, not a refusal');
  }
});

// ---------------------------------------------------------------------------
// Whether any step of a drawing could write where the run measures (DSP-91 #7).
// ---------------------------------------------------------------------------

/**
 * The property the snapshot decision rests on, and why it is a property of the drawing.
 *
 * DSP-91 #7 asks for the project to stop being hashed on a run that does not use it, and
 * the card forbids deciding that from words in the mandate. A drawing is the only thing
 * available before the run that says anything about writing, and the only thing it says is
 * which steps require `no-file-writes`. So the question is asked of that, conservatively:
 * anything this engine cannot see inside counts as able to write, because unknown is not
 * none.
 */
function reachGraph(nodes: LoopGraph['nodes']): LoopGraph {
  return { ...minimal(), nodes, edges: [] };
}

const READ_ONLY_ROLE: ResolvedRole = {
  id: 'reader',
  sourcePath: 'roles/reader.md',
  targets: ['cursor'],
  targetsDeclared: true,
  requirements: ['no-file-writes'],
  requirementsDeclared: true,
};

/**
 * A table where something other than the agent actually applies `no-file-writes`.
 *
 * DSP-96 part 2. The real table says `other-means` for the path DSpatch walks, because on
 * that path the requirement is a sentence in a role file. So the skip branch can only be
 * exercised against a target that enforces it, and stating that here — rather than
 * asserting it of `cursor` — is the difference between testing the mechanism and asserting
 * a guarantee the product does not have.
 */
const ENFORCED_READ_ONLY: TargetCapabilities = {
  ...TARGET_CAPABILITIES,
  cursor: {
    ...TARGET_CAPABILITIES.cursor,
    'no-file-writes': {
      status: 'enforced',
      how: 'a sandbox that refuses writes.',
      evidence: 'observed',
    },
  },
};

test('a read-only drawing is still hashed while read-only is only an instruction', () => {
  const drawing = reachGraph([
    {
      id: 'review',
      kind: 'agent',
      role: { id: 'reader', source: { kind: 'role-source', path: 'roles/reader.md' } },
    },
    {
      id: 'check',
      kind: 'agent',
      role: { id: 'reader', source: { kind: 'role-source', path: 'roles/reader.md' } },
    },
    { id: 'done', kind: 'terminal' },
    { id: 'ask', kind: 'human' },
    { id: 'route', kind: 'router' },
  ]);

  // As the product actually stands. The skip would otherwise fire exactly where the
  // read-only guarantee is weakest, removing the only thing DSpatch has that can
  // contradict an agent claiming it changed nothing (DSP-92 F12 point 4).
  const asItStands = writeReachOf(drawing, () => READ_ONLY_ROLE);
  assert.equal(asItStands.mayWrite, true);
  assert.match(asItStands.reason, /"review"/);
  assert.match(asItStands.reason, /does not enforce it/);
  assert.match(asItStands.reason, /not a reason to stop measuring/);

  // And the branch itself, which is not dead: it is waiting for a path that makes
  // read-only true. The reason is written for a run record, so it has to say what was
  // concluded and from what — a record that only said "skipped" would be the absent
  // measurement again.
  const enforced = writeReachOf(drawing, () => READ_ONLY_ROLE, ENFORCED_READ_ONLY);
  assert.equal(enforced.mayWrite, false);
  assert.match(enforced.reason, /No step in this drawing may write/);
  assert.match(enforced.reason, /no-file-writes/);
  assert.match(enforced.reason, /enforces that on the path this run takes/);
});

test('one agent step that may write is enough, and the reason names it', () => {
  const reach = writeReachOf(
    reachGraph([
      {
        id: 'review',
        kind: 'agent',
        role: { id: 'reader', source: { kind: 'role-source', path: 'roles/reader.md' } },
      },
      {
        id: 'implement',
        kind: 'agent',
        role: { id: 'writer', source: { kind: 'role-source', path: 'roles/writer.md' } },
      },
    ]),
    (reference) =>
      reference.id === 'reader' ? READ_ONLY_ROLE : { ...READ_ONLY_ROLE, id: 'writer', requirements: [] },
    // Enforced, so that the step this test is about is the first one that may write. With
    // the real table the read-only step may write too, which is that table's point and not
    // this test's.
    ENFORCED_READ_ONLY,
  );
  assert.equal(reach.mayWrite, true);
  assert.match(reach.reason, /"implement"/);
  assert.match(reach.reason, /does not require no-file-writes/);
});

test('a gate and an external step count as able to write, because nothing here can see inside them', () => {
  const gate = writeReachOf(
    reachGraph([{ id: 'build', kind: 'gate' }]),
    NEVER_RESOLVES,
  );
  assert.equal(gate.mayWrite, true);
  assert.match(gate.reason, /a command may write anything/);

  const external = writeReachOf(reachGraph([{ id: 'ci', kind: 'external' }]), NEVER_RESOLVES);
  assert.equal(external.mayWrite, true);
  assert.match(external.reason, /unknown is not none/);
});

test('an agent step whose role will not resolve may write, rather than being assumed safe', () => {
  const reach = writeReachOf(
    reachGraph([
      {
        id: 'work',
        kind: 'agent',
        role: { id: 'gone', source: { kind: 'role-source', path: 'roles/gone.md' } },
      },
    ]),
    NEVER_RESOLVES,
  );
  assert.equal(reach.mayWrite, true);
});

test('the runnable development loop is hashed, because its implementer writes the code', () => {
  const text = fs.readFileSync(
    path.join(repoRoot, 'docs/loop/graphs/dspatch-development-loop-runnable.graph.json'),
    'utf8',
  );
  const loaded = loadLoopGraph(text, {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  // The direction that matters: the drawing DSP-91 was verified on keeps its snapshots,
  // so the skip cannot silently become the default for a loop that changes code.
  assert.equal(writeReachOf(loaded.graph, createFileRoleResolver(repoRoot)).mayWrite, true);
});
