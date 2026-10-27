/**
 * What the panel says about a node, and whether the agent is told the same thing.
 *
 * DSP-83. Two claims are worth a test rather than a screenshot.
 *
 * The first is *the whole role reaches the agent*. Niclas asked for the role text to be
 * followed from the source file to the adapter boundary, and the panel now presents
 * itself as showing what the agent gets. That is only true while the prompt really does
 * contain the role file's prose in full, so the test resolves the real roles of the real
 * runnable graph and asserts the prompt contains every non-empty line of the file, not a
 * prefix and not a summary. A truncation anywhere in `role-source.ts`,
 * `loop-graph-roles.ts` or `chatPromptFor` fails here.
 *
 * The second is *the help is in words*. A field name is not help, and an empty box that
 * means "the run's limit applies" must not read the same as one that means "nothing
 * bounds this". Those are properties of the text, so they are checked as properties:
 * every limit and requirement has a readable name distinct from its identifier and says
 * what empty means, and every failure kind a graph declares reaches the panel with its
 * `meaning` rather than with its label twice.
 *
 * No provider turn. Layout is the window trial's job; this is the text and the wiring.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { describeGateRunner, EXAMPLE_GATE_COMMAND } from '../src/shared/loop-editor-run';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import {
  BRIEF_EXCLUSIONS,
  briefParts,
  carriesRunChange,
  chatPromptFor,
  describeRunChange,
  DRAWING_TASK_PRECEDENCE,
  ENTRY_LINE_FROM_DRAWING,
  MANDATE_INTRO_FROM_DRAWING,
  nodeHelpText,
  ROLE_BLOCK_CLOSE,
  ROLE_BLOCK_OPEN,
  TASK_PRECEDENCE,
} from '../src/shared/loop-chat';
import { describeGateEvidenceRule } from '../src/shared/loop-results';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import {
  capabilityAnswer,
  NODE_KINDS,
  REQUIREMENTS,
  RUN_PROVIDER_CAPABILITIES,
  TARGET_CAPABILITIES,
  type LoopGraph,
  type LoopNode,
  type ResolvedRole,
} from '../src/shared/loop-graph';
import {
  failureStandings,
  kindEffect,
  limitHelp,
  limitStandings,
  LIMIT_KEYS,
  NO_AGENT_IN_STEP,
  outcomeStandings,
  REQUIREMENT_HELP,
  requirementStandings,
  undeclaredStanding,
} from '../src/shared/loop-node-help';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUNNABLE = 'docs/loop/graphs/dspatch-development-loop-runnable.graph.json';

function loadGraph(rel: string): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, `${rel} must be valid: ${loaded.findings.map((f) => f.message).join('; ')}`);
  return loaded.graph;
}

function nodeNamed(graph: LoopGraph, id: string): LoopNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  assert.ok(node !== undefined, `${id} should exist in the graph`);
  return node;
}

/** The runnable graph's roles, resolved the way the main process resolves them. */
function resolvedRoles(graph: LoopGraph): Map<string, ResolvedRole> {
  const resolve = createFileRoleResolver(repoRoot);
  const roles = new Map<string, ResolvedRole>();
  for (const node of graph.nodes) {
    if (node.role === undefined) {
      continue;
    }
    const resolved = resolve(node.role);
    assert.ok(
      resolved !== null,
      `${node.id} names ${node.role.source.path}, which resolved to nothing`,
    );
    roles.set(node.id, resolved);
  }
  return roles;
}

describe('the role the panel shows is the role the agent is sent', () => {
  it('puts every line of the role file into the prompt, not a prefix of it', () => {
    const graph = loadGraph(RUNNABLE);
    const roles = resolvedRoles(graph);

    for (const node of graph.nodes) {
      if (node.kind !== 'agent') {
        continue;
      }
      const role = roles.get(node.id);
      assert.ok(role !== undefined, `${node.id} is an agent and must have a resolved role`);
      const instructions = role.instructions ?? '';
      assert.notEqual(instructions.trim(), '', `${role.sourcePath} should hold prose`);

      const prompt = chatPromptFor(node, {
        entryId: graph.entry,
        mandate: 'A mandate, so the prompt is the shape a run builds.',
        role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
      });

      assert.ok(prompt.includes(ROLE_BLOCK_OPEN), `${node.id}: role block should open`);
      assert.ok(prompt.includes(ROLE_BLOCK_CLOSE), `${node.id}: role block should close`);
      // Line by line rather than as one substring, so a failure names the line that
      // went missing instead of only saying the whole text did not match.
      for (const line of instructions.split('\n')) {
        if (line.trim() === '') {
          continue;
        }
        assert.ok(
          prompt.includes(line),
          `${node.id}: ${role.sourcePath} line missing from the prompt: ${line.slice(0, 80)}`,
        );
      }
      // Order matters as much as presence: a model that reads the task first has
      // already started planning before it learns its own boundaries.
      const purpose = node.purpose ?? '';
      if (purpose !== '') {
        assert.ok(
          prompt.indexOf(ROLE_BLOCK_CLOSE) < prompt.indexOf(purpose),
          `${node.id}: the role should come before the task`,
        );
      }
    }
  });

  it('sends the role as well as the purpose, so neither stands in for the other', () => {
    const graph = loadGraph(RUNNABLE);
    const roles = resolvedRoles(graph);
    const node = nodeNamed(graph, 'implementer');
    const role = roles.get('implementer');
    assert.ok(role !== undefined);

    const prompt = chatPromptFor(node, {
      entryId: graph.entry,
      mandate: 'Do the bounded change.',
      role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
    });

    assert.ok(prompt.includes(node.purpose ?? '\u0000'), 'the purpose should be in the prompt');
    assert.ok(
      prompt.includes((role.instructions ?? '').split('\n').filter((line) => line.trim() !== '')[0]),
      'the role should be in the prompt as well',
    );
    // Where it came from, not a path to it (DSP-91 #1). The path is relative to the loop
    // definition's resource root and the agent's `cwd` is the project, so emitting it
    // pointed the agent at a file inside the repository it was working on.
    assert.match(
      prompt,
      /It reached you from the loop definition\u2019s own resources/,
      'the prompt should name where the role came from',
    );
    assert.equal(
      prompt.includes(role.sourcePath),
      false,
      'and must not hand the agent a path that resolves into the working folders',
    );
  });

  it('gives the in-run coordinator a role of its own, not the Cursor skill', () => {
    const graph = loadGraph(RUNNABLE);
    for (const id of ['coordinator', 'coordinator-report']) {
      const node = nodeNamed(graph, id);
      assert.ok(node.role !== undefined, `${id} should name a role`);
      assert.equal(
        node.role.source.path.includes('.cursor/skills'),
        false,
        `${id} should not be told to be the Cursor coordinator: it cannot call subagents`,
      );
      assert.equal(node.role.source.kind, 'role-source');
      assert.ok(
        fs.existsSync(path.join(repoRoot, node.role.source.path)),
        `${node.role.source.path} should exist`,
      );
    }
  });

  it('leaves the Cursor loop’s own drawing pointing at the skill', () => {
    // The external loop is running this very card. If this fails, the Cursor workflow
    // was edited by accident and that is the regression, not this assertion.
    const graph = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const coordinators = graph.nodes.filter((node) => node.id.startsWith('coordinator'));
    assert.ok(coordinators.length > 0, 'the drawing should still have coordinator nodes');
    for (const node of coordinators) {
      assert.ok(
        node.role?.source.path.includes('.cursor/skills/dspatch-loop/SKILL.md') === true,
        `${node.id} in the Cursor drawing should still point at SKILL.md`,
      );
    }
  });

  it('says of every agent node’s brief which parts travel and which are pointed at', () => {
    const graph = loadGraph(RUNNABLE);
    const roles = resolvedRoles(graph);
    const node = nodeNamed(graph, 'implementation-review');
    const role = roles.get('implementation-review');
    assert.ok(role !== undefined);

    const parts = briefParts(node, {
      entryId: graph.entry,
      role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
      workingRootCount: 2,
      producedBy: (id) => {
        const other = nodeNamed(graph, id);
        return other.produces === undefined
          ? null
          : { form: other.produces.form, label: other.label ?? other.id };
      },
      archivePath: graph.archive?.path ?? null,
      reportWrittenBy: node.report?.writtenBy ?? null,
    });

    const roleePart = parts.find((part) => part.id === 'role');
    assert.equal(roleePart?.carried, true, 'the role travels inside the message');
    const received = parts.find((part) => part.id === 'received');
    assert.equal(received?.present, true, 'a review step is given what it reviews');
    assert.equal(
      received?.carried,
      false,
      'a report filed as a file is named, not pasted: the file is the result',
    );
    // DSP-99 #3: a reader of the panel can see that the run's own account of what it
    // changed is carried, without going to the prompt builder to find out.
    const change = parts.find((part) => part.id === 'run-change');
    assert.equal(change?.present, true, 'a review step is told what the run changed');
    assert.equal(change?.carried, true, 'and the measurement itself travels in the message');
    assert.ok(
      (change?.detail ?? '').includes('never "nothing"'),
      `the panel should say an unmeasured run is not reported as an unchanged one: ${change?.detail ?? ''}`,
    );
    assert.ok(
      BRIEF_EXCLUSIONS.some((sentence) => sentence.includes('AGENTS.md')),
      'the panel should say a file the role links to is not included',
    );
  });

  /**
   * DSP-100: what a step receives is no longer one list, so the panel may not show one.
   *
   * Niclas's requirement was that the choice of inputs be *explicit in the drawing and
   * visible in the node inspection we already have*. The drawing half is `delivers` on
   * the edge; this is the other half, and it is asserted against the real runnable
   * graph rather than a fixture, because the point is that a person opening the
   * implementer can see why its rework round is not its first visit.
   */
  it('says what each arrival at a step hands it, where the arrivals disagree', () => {
    const graph = loadGraph(RUNNABLE);
    const roles = resolvedRoles(graph);
    const node = nodeNamed(graph, 'implementer');
    const role = roles.get('implementer');
    assert.ok(role !== undefined);

    const parts = briefParts(node, {
      entryId: graph.entry,
      role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
      workingRootCount: 2,
      producedBy: (id) => {
        const other = nodeNamed(graph, id);
        return other.produces === undefined
          ? null
          : { form: other.produces.form, label: other.label ?? other.id };
      },
      archivePath: graph.archive?.path ?? null,
      reportWrittenBy: node.report?.writtenBy ?? null,
      arrivals: graph.edges.filter((edge) => edge.to === node.id),
    });

    const received = parts.find((part) => part.id === 'received');
    assert.equal(received?.present, true);
    const detail = received?.detail ?? '';
    assert.ok(
      detail.includes('depends on the route that reached it'),
      `the panel must not show one list for a step handed different material: ${detail}`,
    );
    assert.ok(detail.includes('rework, bounded'), `the rework arrival should be named: ${detail}`);
    assert.ok(detail.includes('Implementation review'), `and what it brings: ${detail}`);
    // Both ways back from the researcher, which DSP-103 made two arrivals rather than
    // one: they hand over the same material and the panel names each of them, because
    // which one arrived is the thing the implementer is being told.
    assert.ok(
      detail.includes('the question was answered'),
      `as should the research answer coming back: ${detail}`,
    );
    assert.ok(
      detail.includes('the question was not settled'),
      `and the round that settled nothing, which arrives the same way: ${detail}`,
    );

    // And the same node described without its arrivals — the caller that has only a
    // node — still says exactly what it said before the field existed.
    const withoutArrivals = briefParts(node, {
      entryId: graph.entry,
      role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
      workingRootCount: 2,
      producedBy: (id) => {
        const other = nodeNamed(graph, id);
        return other.produces === undefined
          ? null
          : { form: other.produces.form, label: other.label ?? other.id };
      },
      archivePath: graph.archive?.path ?? null,
      reportWrittenBy: node.report?.writtenBy ?? null,
    });
    assert.ok(
      (withoutArrivals.find((part) => part.id === 'received')?.detail ?? '').includes(
        'The same on every route to this step',
      ),
    );
  });

  /**
   * DSP-94, from DSP-92's F4, and the reason it is worth a test rather than a look.
   *
   * The three strongest sentences DSpatch adds are the engine's own — the paragraph
   * saying the loop is already running, the sentence saying the role is in the message
   * and there is no file to go and find, and the precedence block. What the panel showed
   * of them was prose written beside them, which is the thing §3 of the agent-behaviour
   * guideline forbids: a separately maintained summary standing in for the instruction.
   *
   * So the panel now renders the constants, and this asserts the only property that
   * makes that worth anything: **every line the panel shows as sent is in the message
   * that is sent**, for the same node, from the same resolved role. Editing either side
   * alone fails here.
   */
  it('shows the engine\u2019s own instructions as the text the prompt sends, not as a description of it', () => {
    const graph = loadGraph(RUNNABLE);
    const roles = resolvedRoles(graph);

    for (const node of graph.nodes) {
      if (node.kind !== 'agent') {
        continue;
      }
      const role = roles.get(node.id);
      assert.ok(role !== undefined);
      const roleText = { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions };

      // With a `step`, because that is the shape a run builds: the engine paragraph
      // arrives with the step's address, and a caller that does not know which step it
      // is — the editor's fixture, and every test written before per-node sessions —
      // gets the prompt it always got.
      const head = chatPromptFor(node, {
        entryId: graph.entry,
        mandate: 'A mandate, so the prompt is the shape a run builds.',
        role: roleText,
        step: { runId: 'run-1', occurrence: 1, callId: 1, freshSession: true },
      });
      // The whole message, not only the part `chatPromptFor` builds: the run's account of
      // what it changed is appended by the executor, so a test that read the head alone
      // would report the panel as showing something the message does not contain.
      const prompt =
        head +
        (carriesRunChange(node)
          ? describeRunChange({
              kind: 'measured',
              snapshotBefore: 'snap-000000000000000a',
              snapshotAfter: 'snap-000000000000000a',
              observedFromUtc: '2026-09-22T19:50:58.359Z',
              observedToUtc: '2026-09-22T19:52:49.120Z',
              paths: [],
            })
          : '');
      const parts = briefParts(node, {
        entryId: graph.entry,
        role: roleText,
        workingRootCount: null,
        producedBy: (id) => {
          const other = nodeNamed(graph, id);
          return other.produces === undefined
            ? null
            : { form: other.produces.form, label: other.label ?? other.id };
        },
        archivePath: graph.archive?.path ?? null,
        reportWrittenBy: node.report?.writtenBy ?? null,
      });

      for (const part of parts) {
        if (part.text === undefined) {
          continue;
        }
        for (const line of part.text) {
          assert.ok(
            prompt.includes(line),
            `${node.id}: the panel shows a line under "${part.heading}" that the message does ` +
              `not contain: ${line.slice(0, 90)}`,
          );
        }
      }

      // The ones that must be there. A part quietly losing its text would leave the
      // loop above with nothing to check and still pass. The fourth is DSP-99's: a step
      // handed an earlier step's work is also handed the run's own account of the folders,
      // and the standing half of that account is DSpatch's wording rather than the run's.
      //
      // `outcomes` is DSP-104 #2, and it is conditional on the node having a name to
      // answer with at all: what the run does with a `RESULT:` line it cannot route is
      // DSpatch's own sentence, and the panel used to carry a separately written account
      // of it that outlived the sentence it described. A node that declares neither an
      // outcome nor a failure is sent no such sentence, so there is none to show.
      const hasNamesToAnswerWith =
        (node.outcomes ?? []).length + (node.declaredFailures ?? []).length > 0;
      const shown = parts.filter((part) => part.text !== undefined).map((part) => part.id);
      assert.deepEqual(
        [...shown].sort(),
        [
          'engine',
          ...(hasNamesToAnswerWith ? ['outcomes'] : []),
          'precedence',
          'provenance',
          ...(carriesRunChange(node) ? ['run-change'] : []),
        ],
        `${node.id}: the runtime instructions DSpatch adds should each be shown as their own text`,
      );
    }
  });
});

describe('the help says what a setting does, in words', () => {
  it('names every limit readably, in a unit, and says what empty means', () => {
    for (const scope of ['graph', 'node'] as const) {
      for (const key of LIMIT_KEYS) {
        const help = limitHelp(key, scope);
        assert.notEqual(help.name, key, `${key} needs a name that is not its field name`);
        assert.ok(help.name.length > 6, `${key}: ${help.name} is not a sentence's worth of name`);
        assert.ok(help.detail.length > 40, `${key}: the detail should explain what it counts`);
        assert.ok(help.whenEmpty.length > 20, `${key}: an empty value needs an explanation`);
      }
    }
    // The one Niclas named, in the words he asked for.
    assert.equal(limitHelp('maxReworkRounds', 'node').name, 'Maximum correction rounds');
    const rework = limitHelp('maxReworkRounds', 'node').detail;
    assert.ok(rework.includes('round is counted'), 'it should say what counts as a round');
    assert.ok(rework.includes('bound was reached'), 'it should say what happens at the limit');
  });

  it('shows an inherited limit as inherited rather than as nothing', () => {
    const node: Pick<LoopNode, 'limits'> = { limits: { maxCalls: 3 } };
    const standings = limitStandings(node, { maxCalls: 30, maxReworkRounds: 2 });

    const calls = standings.find((standing) => standing.key === 'maxCalls');
    assert.equal(calls?.from, 'node');
    assert.equal(calls?.inForce, 3);

    const rework = standings.find((standing) => standing.key === 'maxReworkRounds');
    assert.equal(rework?.onNode, undefined, 'the node sets nothing');
    assert.equal(rework?.from, 'graph', 'yet a limit applies, and it comes from the run');
    assert.equal(rework?.inForce, 2);

    const minutes = standings.find((standing) => standing.key === 'maxMinutes');
    assert.equal(minutes?.from, 'none');
    assert.equal(minutes?.inForce, null);
  });

  it('keeps an inherited requirement in force with the node’s box empty', () => {
    const node: LoopNode = { id: 'reviewer', kind: 'agent', requirements: [] };
    const role: ResolvedRole = {
      id: 'dspatch-reviewer',
      sourcePath: 'docs/loop/roles/dspatch-reviewer.role.md',
      targets: ['cursor'],
      targetsDeclared: true,
      requirements: ['no-file-writes'],
      requirementsDeclared: true,
      instructions: 'Review it.',
    };

    const standings = requirementStandings(node, role, 'cursor', REQUIREMENTS);
    const write = standings.find((standing) => standing.requirement === 'no-file-writes');
    assert.equal(write?.onNode, false, 'the checkbox is empty');
    assert.equal(write?.fromRole, true);
    assert.equal(write?.inForce, true, 'and it still holds, which is the point');
    assert.ok(write.howItHolds !== '', 'and the panel can say how it holds');

    const delegation = standings.find(
      (standing) => standing.requirement === 'no-subagent-delegation',
    );
    assert.equal(delegation?.inForce, false);
    assert.equal(delegation?.howItHolds, '', 'nothing to say about a requirement not in force');
  });

  /**
   * DSP-96 part 2, and the assertion this test used to make is the one that was wrong.
   *
   * It read `no-file-writes` as `enforced` and `no-subagent-delegation` as asked-for, and
   * the panel said the same to a person. But the panel describes a node of a drawing
   * **DSpatch walks**, and on that path nothing applies either of them: `readonly: true`
   * is a field of an agent definition the SDK path never writes and never loads. So the
   * distinction the test is named for is still the distinction that matters — it just
   * does not fall where the table used to put it.
   *
   * `fixed-model-selection` is kept here as the control. Something outside the agent does
   * apply that one on this path — the model the adapter passes to `Agent.create` — so the
   * badge must not become "nothing is ever enforced", which would be the same untruth
   * pointing the other way.
   */
  it('separates a restriction something applies from one the agent is only asked to keep', () => {
    const node: LoopNode = {
      id: 'step',
      kind: 'agent',
      requirements: ['no-file-writes', 'no-subagent-delegation', 'fixed-model-selection'],
    };
    const standings = requirementStandings(node, null, 'cursor', REQUIREMENTS);

    for (const requirement of ['no-file-writes', 'no-subagent-delegation'] as const) {
      const asked = standings.find((standing) => standing.requirement === requirement);
      assert.equal(
        asked?.enforcement,
        'other-means',
        `${requirement} is role text on a run DSpatch walks, not something the platform applies`,
      );
      assert.ok(
        asked.howItHolds.includes('does not enforce this'),
        `a requirement nothing applies should say so: ${asked.howItHolds}`,
      );
      assert.ok(
        asked.howItHolds.includes('instruction'),
        `and should say what it is instead: ${asked.howItHolds}`,
      );
    }
    // The wording a person actually reads for the one this card is about: it must name
    // the mechanism's absence rather than leave "not enforced" to be interpreted.
    const write = standings.find((standing) => standing.requirement === 'no-file-writes');
    assert.match(write?.howItHolds ?? '', /nothing applies it on this path/);

    const enforced = standings.find(
      (standing) => standing.requirement === 'fixed-model-selection',
    );
    assert.equal(enforced?.enforcement, 'enforced');
    assert.ok(enforced.howItHolds.includes('enforces'), 'it should say who applies it');
    assert.match(
      enforced?.howItHolds ?? '',
      /Agent\.create/,
      'and name the mechanism that is in play on this path, not one in a file nobody reads',
    );
  });

  it('gives every requirement a readable name and an explanation of an empty box', () => {
    for (const requirement of REQUIREMENTS) {
      const help = REQUIREMENT_HELP[requirement];
      assert.ok(help !== undefined, `${requirement} needs help text`);
      assert.notEqual(help.name, requirement);
      assert.ok(help.detail.length > 20, `${requirement}: the detail should be a sentence`);
      assert.ok(help.whenEmpty.startsWith('Not required'), `${requirement}: say what empty means`);
    }
  });

  it('says where each outcome leads instead of listing code words', () => {
    const graph = loadGraph(RUNNABLE);
    const node = nodeNamed(graph, 'implementation-review');
    const standings = outcomeStandings(graph, node);

    assert.ok(standings.length > 1, 'a review declares more than one answer');
    for (const standing of standings) {
      assert.equal(standing.drawn, true, `${standing.outcome} should have an edge`);
      assert.ok(standing.leadsTo !== null, `${standing.outcome} should name where it goes`);
      assert.notEqual(
        standing.leadsTo,
        standing.leadsToId,
        `${standing.outcome} should lead to a step named as a person reads it`,
      );
    }
  });

  /**
   * DSP-103 #2. What happens when a reply names none of them used to be unsayable.
   *
   * It depended on whether the author had happened to spell an outcome `unclear` or
   * `could-not-check`, which is not a fact the drawing records, so the panel showed
   * nothing and a person could only find it by reading the prompt builder. The field is
   * the answer now, and the panel reads it through the same function the runner does —
   * so what the panel shows and what the run would do cannot disagree.
   */
  it('says where a reply that names no outcome goes, or that the run stops', () => {
    const graph = loadGraph(RUNNABLE);

    const implementer = undeclaredStanding(graph, nodeNamed(graph, 'implementer'));
    assert.equal(implementer.outcome, 'unclear');
    assert.equal(implementer.impossible, false);
    assert.equal(implementer.drawn, true);
    assert.equal(implementer.leadsTo, 'Stopped without a result');

    // The report step and the review, both of which stated nothing until DSP-97 — the
    // first because it declared no outcomes at all, the second because it declared three
    // and named no fallback, so a reply naming none of them stopped the run as a fault.
    // They state a route now, and they share a destination while keeping distinct reasons,
    // which is what the panel has to be able to show an author.
    const report = undeclaredStanding(graph, nodeNamed(graph, 'coordinator-report'));
    assert.equal(report.outcome, 'could-not-report');
    assert.equal(report.stated, 'could-not-report');
    assert.equal(report.declaresOutcomes, true);
    assert.equal(report.drawn, true);
    assert.equal(report.leadsTo, 'Ended without complete reporting');

    const review = undeclaredStanding(graph, nodeNamed(graph, 'implementation-review'));
    assert.equal(review.outcome, 'could-not-review');
    assert.equal(review.impossible, false);
    assert.equal(review.leadsTo, 'Ended without complete reporting');
    assert.notEqual(review.outcome, report.outcome, 'shared destination, distinct reason');

    // And a value the node cannot produce is shown as the graph error it is, rather
    // than as a route.
    const broken = undeclaredStanding(graph, {
      ...nodeNamed(graph, 'implementer'),
      whenUndeclared: 'not-established',
    });
    assert.equal(broken.impossible, true);
    assert.equal(broken.outcome, null);
    assert.equal(broken.stated, 'not-established');
  });

  it('explains a declared failure by its meaning, not by its label twice', () => {
    const graph = loadGraph(RUNNABLE);
    const node = nodeNamed(graph, 'implementer');
    const standings = failureStandings(graph, node);

    assert.ok(standings.length > 0, 'the graph declares failure kinds');
    for (const standing of standings) {
      assert.ok(standing.kind.meaning.length > 30, `${standing.kind.id}: the meaning is the help`);
      assert.notEqual(
        standing.kind.meaning,
        standing.kind.label,
        `${standing.kind.id}: "label — label" is what this replaced`,
      );
      if (standing.declared) {
        assert.equal(standing.drawn, true, `${standing.kind.id} is declared, so it must route`);
      }
    }
  });

  it('says of every node kind where its purpose goes and what reaches an agent', () => {
    for (const kind of NODE_KINDS) {
      const effect = kindEffect(kind);
      assert.ok(effect.purposeGoes.length > 30, `${kind}: say where the purpose lands`);
      assert.ok(effect.whatTheRunnerDoes.length > 20, `${kind}: say what the runner does`);
    }
    assert.equal(kindEffect('agent').callsAnAgent, true);
    assert.equal(kindEffect('agent').withoutEffect.length, 0, 'an agent node uses its fields');
    assert.ok(
      kindEffect('agent').purposeGoes.includes('Sent to the agent'),
      'the answer to "is purpose part of the prompt" should be in the panel',
    );

    for (const kind of ['gate', 'router', 'human', 'external', 'terminal'] as const) {
      assert.equal(kindEffect(kind).callsAnAgent, false, `${kind} reaches no provider`);
    }
    assert.ok(
      kindEffect('gate').withoutEffect.some((sentence) => sentence.includes('role')),
      'a role bound to a gate is never sent, and the panel should say so',
    );
    assert.ok(
      kindEffect('router').withoutEffect.length > 0,
      'a router takes its first outcome, which the panel should not hide',
    );
    assert.ok(
      kindEffect('human').purposeGoes.includes('question'),
      'at a human step the purpose is the question, which constrains how it is written',
    );
  });

  it('keeps the tooltip and the prompt the same text, from purpose', () => {
    const graph = loadGraph(RUNNABLE);
    for (const id of ['implementer', 'researcher', 'coordinator-report']) {
      const node = nodeNamed(graph, id);
      const purpose = node.purpose ?? '';
      assert.notEqual(purpose.trim(), '', `${id} should say what it does`);
      assert.ok(
        nodeHelpText(node).includes(purpose),
        `${id}: the tooltip should show the purpose rather than a second copy of it`,
      );
    }
  });
});

/**
 * DSP-139. The requirement answers belong to the agent a run uses and to the kind of
 * step, not to the drawing's target, which is a label.
 */
describe('requirement answers by the run’s agent and the step’s kind (DSP-139)', () => {
  const asked: LoopNode = {
    id: 'step',
    kind: 'agent',
    requirements: ['no-file-writes', 'no-subagent-delegation', 'tool-restriction', 'fixed-model-selection'],
  };
  const of = (provider: 'cursor' | 'claude' | null, node: LoopNode = asked) =>
    new Map(requirementStandings(node, null, provider, REQUIREMENTS).map((standing) => [standing.requirement, standing]));

  it('answers for Claude from its own permissions, which differ from Cursor’s', () => {
    const claude = of('claude');
    assert.equal(claude.get('no-subagent-delegation')?.enforcement, 'enforced');
    assert.equal(claude.get('tool-restriction')?.enforcement, 'enforced');
    assert.equal(claude.get('no-file-writes')?.enforcement, 'other-means');
    assert.match(claude.get('no-file-writes')?.howItHolds ?? '', /^Claude does not enforce this/);
    assert.match(claude.get('fixed-model-selection')?.howItHolds ?? '', /whatever model the step names/);
    assert.match(claude.get('tool-restriction')?.howItHolds ?? '', /not observed against the real Claude runtime/);
    const cursor = of('cursor');
    assert.equal(cursor.get('no-subagent-delegation')?.enforcement, 'other-means');
    assert.equal(cursor.get('tool-restriction')?.enforcement, 'unknown');
  });

  it('reads Cursor’s row from the target table rather than copying it', () => {
    for (const requirement of REQUIREMENTS) {
      assert.deepEqual(
        RUN_PROVIDER_CAPABILITIES.cursor[requirement],
        capabilityAnswer('cursor', requirement, 'dspatch-walked-run'),
      );
    }
  });

  it('keeps the target table as it was: no Claude row beside claude-code', () => {
    assert.deepEqual(Object.keys(TARGET_CAPABILITIES).sort(), ['claude-code', 'copilot', 'cursor']);
    for (const requirement of REQUIREMENTS) {
      assert.equal(capabilityAnswer('claude-code', requirement, 'dspatch-walked-run').status, 'unknown');
    }
  });

  it('says nothing is established when no agent is chosen', () => {
    for (const standing of [...of(null).values()].filter((entry) => entry.inForce)) {
      assert.equal(standing.enforcement, 'unknown');
      assert.match(standing.howItHolds, /No agent is chosen/);
    }
  });

  it('says a gate has no agent, whatever the run’s agent, and names the command it runs', () => {
    const gate: LoopNode = { id: 'test', kind: 'gate', requirements: ['no-file-writes'] };
    for (const provider of ['cursor', 'claude', null] as const) {
      const standing = of(provider, gate).get('no-file-writes');
      assert.equal(standing?.enforcement, 'not-applicable');
      assert.equal(standing?.howItHolds, NO_AGENT_IN_STEP);
    }
    const bound = describeGateRunner('dspatch-duration-check');
    assert.match(bound, /^No agent works in this step\./);
    assert.ok(bound.includes(`DSpatch runs \`${EXAMPLE_GATE_COMMAND}\` itself`), bound);
    assert.match(bound, /pass or fail is its exit code/);
    assert.match(describeGateRunner('some-other-drawing'), /no command bound/);
  });
});

/**
 * DSP-139 AC #7. The instructions that reach a step are true for an agent that cannot
 * run commands, and still tell one that can to run them.
 */
describe('the project roles and chat-loop purposes are true for an agent without a shell (DSP-139)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('the check role tells both kinds of agent what to do', () => {
    const role = read('docs/loop/roles/project/project-check.role.md');
    // DSP-145: the tools named, and the agent judges independently from real results.
    assert.match(role, /If your tools can run commands, run the checks you choose\.\*\*/);
    assert.match(role, /You are independent of the work step/);
    assert.match(role, /RESULT: rework/);
    assert.match(role, /Do not declare `limit-reached`/);
    assert.match(role, /If your tools cannot run commands, do not say you ran anything\./);
    assert.match(role, /evidence about the code version it names and no other/);
    assert.doesNotMatch(role, /\*\*Run the checks you choose\.\*\* Use your own tools\./);
  });

  it('the work role does too', () => {
    const role = read('docs/loop/roles/project/project-work.role.md');
    // DSP-145: the work step runs its own builds and tests and fixes what fails.
    assert.match(role, /where your tools can run commands, find out how this project is built and tested/);
    assert.match(role, /A failing build or test is information, not the end of your step/);
    assert.match(role, /If your tools cannot run commands, do not say you ran anything\./);
  });

  it('the chat loop’s purposes make running commands conditional on the tools', () => {
    const graph = JSON.parse(read('docs/loop/graphs/dspatch-chat-loop.graph.json')) as {
      purpose: string;
      nodes: { id: string; purpose?: string }[];
    };
    assert.match(graph.purpose, /where its tools can run commands/);
    for (const id of ['work', 'check']) {
      const purpose = graph.nodes.find((node) => node.id === id)?.purpose ?? '';
      assert.match(purpose, /where (your tools|they) can run commands/, id);
      assert.match(purpose, /say what you could not run|do not say you ran anything/, id);
    }
  });
});

/**
 * DSP-139, review R-1 B1. The panel describes what the editor's Run actually sends for a
 * drawing bound with its own purposes: the drawing's purpose as the mandate, the
 * precedence text without a person's words, and the stale rule beside a gate's result.
 */
describe('the brief panel for a drawing whose purpose is the mandate (DSP-139)', () => {
  const graph = loadGraph(path.join('docs', 'loop', 'graphs', 'dspatch-duration-check.graph.json'));
  const resolve = createFileRoleResolver(repoRoot);
  const partsFor = (id: string) => {
    const node = nodeNamed(graph, id);
    const resolved = node.role === undefined ? null : resolve(node.role);
    return briefParts(node, {
      entryId: graph.entry,
      role:
        resolved === null
          ? null
          : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null },
      workingRootCount: null,
      producedBy: (other) => {
        const producer = nodeNamed(graph, other);
        return producer.produces === undefined
          ? null
          : { form: producer.produces.form, label: producer.label ?? producer.id, isGate: producer.kind === 'gate' };
      },
      mandateFrom: 'drawing',
      archivePath: graph.archive?.path ?? null,
      reportWrittenBy: node.report?.writtenBy ?? null,
      arrivals: graph.edges.filter((edge) => edge.to === id),
    });
  };

  it('shows the precedence text the message carries, word for word', () => {
    for (const id of ['work', 'check']) {
      const node = nodeNamed(graph, id);
      const prompt = chatPromptFor(node, {
        entryId: graph.entry,
        mandate: graph.purpose,
        mandateFrom: 'drawing',
        step: {
          runId: 'r',
          occurrence: 1,
          callId: 1,
          freshSession: true,
          arrivedBy: null,
          attachments: { receivedResults: false, requiredResult: false, runChange: false },
        },
      });
      const shown = partsFor(id).find((part) => part.id === 'precedence')?.text ?? [];
      assert.deepEqual(shown, DRAWING_TASK_PRECEDENCE.filter((line) => line !== ''));
      for (const line of shown) {
        assert.ok(prompt.includes(line), `${id}: the panel shows a line the message carries`);
      }
      assert.ok(!shown.join(' ').includes('person’s own words'), id);
      const mandate = partsFor(id).find((part) => part.id === 'mandate');
      const opening = id === graph.entry ? ENTRY_LINE_FROM_DRAWING : MANDATE_INTRO_FROM_DRAWING;
      assert.deepEqual(mandate?.text, [opening]);
      assert.ok(prompt.includes(opening), `${id}: the opening shown is the one sent`);
    }
  });

  it('shows the stale rule for the check, and words the gate handover as DSpatch’s record', () => {
    const parts = partsFor('check');
    const rule = parts.find((part) => part.id === 'gate-evidence');
    assert.equal(rule?.present, true);
    assert.equal(rule?.carried, true);
    const sent = describeGateEvidenceRule(
      [{ nodeId: 'test', occurrence: 1, testedSnapshotId: '<the snapshot it tested>', staleBecause: null }],
      'could-not-check',
    );
    for (const line of rule?.text ?? []) {
      assert.ok(sent.includes(line), `shown line is in the rule as sent: ${line}`);
    }
    assert.match((rule?.text ?? []).join(' '), /"could-not-check" in place of any verdict that would end the run in success/);
    const received = parts.find((part) => part.id === 'received');
    assert.match(received?.detail ?? '', /DSpatch’s record of the command it ran/);
    assert.doesNotMatch(received?.detail ?? '', /DSpatch runs the tests” — its account/);
    assert.equal(partsFor('work').find((part) => part.id === 'gate-evidence')?.present, false);
  });

  it('leaves the chat loop’s panel as it was', () => {
    const node = nodeNamed(graph, 'work');
    const person = briefParts(node, {
      entryId: graph.entry,
      role: null,
      workingRootCount: null,
      producedBy: () => null,
      archivePath: null,
      reportWrittenBy: null,
    });
    assert.deepEqual(
      person.find((part) => part.id === 'precedence')?.text,
      TASK_PRECEDENCE.filter((line) => line !== ''),
    );
    assert.equal(person.find((part) => part.id === 'mandate')?.text, undefined);
  });
});
