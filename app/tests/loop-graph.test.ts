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
  for (const expected of ['model', 'limits', 'requirements', 'archive', 'onRuntimeFault', 'report']) {
    assert.ok(
      attributes.includes(expected),
      `"${expected}" is set by the example graph, so its unhonoured state must be reported. ` +
        `Reported: ${attributes.join(', ')}`,
    );
  }
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
  const notice = findings.find((finding) => finding.code === 'requirement-not-enforced');
  assert.ok(notice, 'our loop requires no-subagent-delegation and Cursor does not enforce it');
  assert.match(notice?.message ?? '', /no-subagent-delegation/);
  assert.equal(notice?.severity, 'notice');
});
