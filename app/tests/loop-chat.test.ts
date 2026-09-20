/**
 * Chat-loop binding, entry prompt, live-log sentences, and gate command choice.
 *
 * No provider turn. These are the pure rules the window and the live executor
 * both call.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { suggestBuildCommand } from '../src/main/test-command';
import {
  boundedPathList,
  CHANGED_FILES_OUTCOME,
  CHANGED_NOTHING_OUTCOME,
  CHAT_LOOP_GRAPH_ID,
  CHAT_LOOP_WINDOW_LOOKUP,
  chatPromptFor,
  chatSendAfter,
  type ChatSendState,
  DECLARATION_TOKENS,
  declaredFailureFrom,
  declaredOutcomeFrom,
  describeChatLoopBinding,
  describeSnapshotChange,
  formatChatLiveLogLine,
  loopBusyAfterChatCancel,
  lookupFromGraph,
  MAX_NAMED_PATHS,
  measuredWorkOutcome,
  modelForChatNode,
  nodeHelpText,
  NOT_VERIFIED_OUTCOME,
  notVerifiedOutcome,
  planChatCancel,
  RESULT_TOKEN,
  ROLE_BLOCK_CLOSE,
  ROLE_BLOCK_OPEN,
  UNCLEAR_OUTCOME,
  undeclaredReadableOutcome,
} from '../src/shared/loop-chat';
import { describeLiveBinding, FORBIDDEN_LIVE_GRAPH_ID } from '../src/shared/loop-editor-run';
import { STOPPED_TERMINAL } from '../src/shared/loop-record';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { namesARuntimeFault, type LoopGraph } from '../src/shared/loop-graph';
import type { RunJournalEntry } from '../src/shared/loop-run';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scratchRoots: string[] = [];

function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-chat-loop-${name}-`));
  scratchRoots.push(dir);
  return dir;
}

after(() => {
  for (const root of scratchRoots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

function loadGraph(rel: string): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(repoRoot, rel), 'utf8'), {
    resolveRole: createFileRoleResolver(repoRoot),
    connectedTargets: ['cursor'],
  });
  assert.ok(loaded.ok, `${rel} must be valid`);
  return loaded.graph;
}

function entry(
  kind: RunJournalEntry['kind'],
  extras: Partial<RunJournalEntry> = {},
): RunJournalEntry {
  return {
    seq: 1,
    atIso: '2026-09-16T20:00:00.000Z',
    sinceStartMs: 0,
    kind,
    detail: 'debug journal line that must not appear in the chat log',
    ...extras,
  };
}

/**
 * The shape, which is the whole of Niclas's complaint.
 *
 * The old file said in its own `notes` that it was the `dspatch-live-duration`
 * shape, and that file is a DSP-18 test fixture whose build gate *was* the thing
 * being tested. Copying it made a build the only way out of a chat loop, so a
 * mandate of "check that you can see the git repo" was refused before an agent was
 * called and would have ended in a build if it had started. These assertions are on
 * the drawing rather than on a run, because the drawing is what was wrong.
 */
describe('dspatch-chat-loop graph', () => {
  it('validates, and no longer has the duration fixture\'s shape or its prompt', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    assert.equal(graph.id, CHAT_LOOP_GRAPH_ID);
    assert.equal(graph.entry, 'work');
    assert.deepEqual(
      graph.nodes.map((node) => node.id),
      ['work', 'check', 'done', 'not-met', 'not-established', 'stopped'],
    );
    const work = graph.nodes.find((node) => node.id === 'work');
    assert.equal(work?.model?.policy, 'inherit');
    assert.doesNotMatch(JSON.stringify(graph), /formatDuration/);
    assert.doesNotMatch(JSON.stringify(graph), /test\/duration\.test\.ts/);

    // No router. `createLiveExecutor`'s router branch returns `node.outcomes?.[0]`
    // with no other input, so a router here would draw a decision nobody makes.
    assert.equal(
      graph.nodes.some((node) => node.kind === 'router'),
      false,
      'a live router always takes its first declared outcome, so this graph must have none',
    );

    const fromFile = lookupFromGraph(graph);
    for (const node of graph.nodes) {
      assert.deepEqual(
        CHAT_LOOP_WINDOW_LOOKUP.node(node.id),
        fromFile.node(node.id),
        `the window's copy of "${node.id}" must match the file`,
      );
    }
    for (const edge of graph.edges) {
      assert.deepEqual(
        CHAT_LOOP_WINDOW_LOOKUP.edge(edge.id),
        { label: edge.label, to: edge.to },
        `the window's copy of edge "${edge.id}" must match the file`,
      );
    }
  });

  it('hands every successful work step to a checking agent, never to a shell gate', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    assert.deepEqual(
      graph.nodes.filter((node) => node.kind === 'gate').map((node) => node.id),
      [],
      'the chat loop has no shell gate; checking is an agent assignment',
    );
    assert.equal(
      graph.nodes.some((node) => node.id === 'choose-check'),
      false,
      'there is no step whose job is to propose a command for DSpatch to start',
    );

    const work = graph.nodes.find((node) => node.id === 'work');
    const check = graph.nodes.find((node) => node.id === 'check');
    assert.deepEqual(work?.outcomes, ['succeeded', 'unclear']);
    assert.deepEqual(check?.kind, 'agent');
    assert.deepEqual(check?.outcomes, ['met', 'not-met', 'could-not-check']);

    const intoCheck = graph.edges.filter((edge) => edge.to === 'check');
    assert.deepEqual(
      intoCheck.map((edge) => ({ from: edge.from, when: edge.when })),
      [{ from: 'work', when: { on: 'outcome', outcome: 'succeeded' } }],
      'a successful work step always goes to check; files do not choose this branch',
    );
    assert.equal(
      graph.edges.some(
        (edge) =>
          edge.when.on === 'outcome' &&
          (edge.when.outcome === 'changed-files' || edge.when.outcome === 'changed-nothing'),
      ),
      false,
      'the file-diff branch is gone',
    );
  });

  /**
   * DSP-44's half of the drawing. The gate declares three verdicts, and the third
   * one is routed — an outcome the graph declares and does not route is a refusal,
   * so this also proves the file could not have been saved half-done.
   */
  it('routes each checking verdict to its own ending', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const check = graph.nodes.find((node) => node.id === 'check');
    assert.deepEqual(check?.outcomes, ['met', 'not-met', 'could-not-check']);
    const expected: Record<string, string> = {
      met: 'done',
      'not-met': 'not-met',
      'could-not-check': 'not-established',
    };
    for (const [outcome, terminal] of Object.entries(expected)) {
      const edge = graph.edges.find(
        (candidate) =>
          candidate.from === 'check' &&
          candidate.when.on === 'outcome' &&
          candidate.when.outcome === outcome,
      );
      assert.equal(edge?.to, terminal, `outcome "${outcome}" must end at "${terminal}"`);
    }
  });

  /**
   * DSP-44 #4's three sentences turn on three terminal ids, so the ids have to exist.
   *
   * `loop-record.ts` names them itself rather than importing this module, to keep the
   * outcome vocabulary free of a dependency on one drawing — and the cost of that is
   * exactly this: a rename in the graph file would leave two of the three sentences
   * unreachable and nothing would fail. This is the test that fails instead.
   */
  it('has the three endings the outcome sentences are written for', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    for (const terminal of ['not-established', 'not-met', STOPPED_TERMINAL]) {
      const node = graph.nodes.find((candidate) => candidate.id === terminal);
      assert.equal(
        node?.kind,
        'terminal',
        `describeRunOutcome writes a sentence for "${terminal}", so the graph must end there`,
      );
      assert.equal(
        graph.edges.some((edge) => edge.to === terminal),
        true,
        `and "${terminal}" must be reachable, or the sentence is dead code`,
      );
    }
  });

  /** The bounds are guesses, and the file has to say so rather than imply a measurement. */
  it('raises its bounds and records that both numbers are guesses', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    assert.equal(graph.limits?.maxMinutes, 45);
    assert.equal(graph.limits?.maxCalls, 5);
    assert.match(graph.limits?.note ?? '', /guess/i);
  });
});

/**
 * DSP-46 #1: the role in the drawing is what the agent is told.
 *
 * The drawing has named a role for every agent node since DSP-21, and `loadLoopGraph` has
 * refused one that resolves to nothing. Neither of those facts put a word of the role in
 * front of the provider — the prompt was the node's `purpose` and nothing else — so the
 * graph could say "Researcher" while the agent was told only "read the project". These
 * assertions are about the prompt, because the prompt is where the claim was false.
 */
describe('the role the drawing names reaches the agent', () => {
  const role = {
    id: 'project-work',
    sourcePath: 'docs/loop/roles/project/project-work.role.md',
    instructions:
      '## Boundaries\n\nDo not run the project\'s build or its tests. DSpatch runs those.',
  };
  const node = { id: 'work', kind: 'agent' as const, purpose: 'Do what the mandate asks.' };

  it('puts the role\'s own words in the prompt, before the task', () => {
    const prompt = chatPromptFor(node, { entryId: 'work', mandate: 'Add a field.', role });

    assert.ok(
      prompt.includes('Do not run the project\'s build or its tests.'),
      'the role text itself has to be in the prompt — naming the role is not telling it',
    );
    assert.ok(prompt.includes(ROLE_BLOCK_OPEN) && prompt.includes(ROLE_BLOCK_CLOSE));
    assert.ok(
      prompt.indexOf(ROLE_BLOCK_CLOSE) < prompt.indexOf('Add a field.'),
      'the role comes before the mandate: boundaries first, then the work',
    );
    assert.ok(
      prompt.includes(role.sourcePath),
      'and the file is named, so an agent handed the wrong role can say which one it got',
    );
  });

  /** A role that resolved to a name and no prose is said, not silently dropped. */
  it('says so when the role file gave it nothing to pass on', () => {
    const prompt = chatPromptFor(node, {
      entryId: 'work',
      mandate: 'Add a field.',
      role: { ...role, instructions: null },
    });

    assert.ok(prompt.includes('read no instructions from'));
    assert.equal(prompt.includes(ROLE_BLOCK_OPEN), false, 'no markers around nothing');
  });

  /** Every prompt written before DSP-46 is byte for byte what it was. */
  it('changes nothing for a caller that does not resolve roles', () => {
    assert.equal(
      chatPromptFor(node, { entryId: 'work', mandate: 'Add a field.' }),
      chatPromptFor(node, { entryId: 'work', mandate: 'Add a field.', role: null }),
    );
  });

  /**
   * And the real graph's roles really do resolve to prose.
   *
   * Without this the three above pass on a fixture while every node in the shipped drawing
   * hands the provider the "no instructions" sentence — which is exactly the failure the
   * card is about, one level further in.
   */
  it('resolves every agent node in the chat loop to a role with words in it', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const resolve = createFileRoleResolver(repoRoot);
    const agents = graph.nodes.filter((candidate) => candidate.kind === 'agent');
    assert.ok(agents.length >= 2, 'the work step and the checking step');

    for (const agent of agents) {
      assert.ok(agent.role !== undefined, `"${agent.id}" must name a role`);
      const resolved = resolve(agent.role);
      assert.notEqual(resolved, null, `"${agent.id}" names a role file that exists`);
      const instructions = resolved?.instructions?.trim() ?? '';
      assert.ok(
        instructions.length > 0,
        `"${agent.id}" resolves to a role with no prose, so the agent would be told only ` +
          `its name — which is the state DSP-46 #1 exists to end`,
      );
      // DSP-46 #2: these are roles for working on the user's own project. A chat-loop role
      // that told an agent to work on DSpatch would be pointing it at the wrong repository.
      assert.doesNotMatch(
        instructions,
        /\bDSpatch\b.*\b(backlog|BACKLOG\.md|vision)\b/i,
        `"${agent.id}" reads as a DSpatch development role rather than one for the user's ` +
          `own project`,
      );
    }
  });
});

describe('describeChatLoopBinding', () => {
  it('is ready only for the chat loop, and editor Run stays unbound for it', () => {
    const chat = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const development = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');

    const chatBinding = describeChatLoopBinding(chat);
    assert.equal(chatBinding.ready, true);
    assert.equal(chatBinding.state, 'ready');

    assert.equal(describeLiveBinding(chat).ready, false);
    assert.equal(describeLiveBinding(chat).state, 'unbound');
    assert.equal(describeLiveBinding(duration).ready, true);

    const forbidden = describeChatLoopBinding(development);
    assert.equal(development.id, FORBIDDEN_LIVE_GRAPH_ID);
    assert.equal(forbidden.ready, false);
    assert.equal(forbidden.state, 'forbidden');

    const unbound = describeChatLoopBinding({ id: 'just-drawn', name: 'A new loop' });
    assert.equal(unbound.ready, false);
    assert.equal(unbound.state, 'unbound');
  });
});

/**
 * The loop starts from a mandate. The Command field is a person tool, not a
 * precondition, and DSpatch does not wait for a confirmation of a command it
 * invented.
 *
 * The handler is an Electron IPC handler with no test harness, so the property is
 * asserted about the file the way `loop-stop-means-stop.test.ts` asserts the control
 * claim: the defect this guards against is a precondition or confirmation someone
 * adds back later.
 */
describe('the loop starts from a mandate, with no Command field', () => {
  const chatLoopSource = (): string => {
    const source = fs.readFileSync(path.join(repoRoot, 'app', 'src', 'main', 'main.ts'), 'utf8');
    return source
      .replaceAll('\r\n', '\n')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
  };

  const fieldReadings = (code: string): readonly { line: number; text: string }[] =>
    code
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }))
      .filter((entry) => entry.text.includes('request.testCommand'));

  it('does not read the Command field on the loop path at all', () => {
    const code = chatLoopSource();
    assert.equal(
      /\bcheckRunRequest\s*\(/.test(code),
      false,
      'main.ts must not judge a Command field before starting a chat-loop run',
    );
    assert.equal(
      fieldReadings(code).length,
      0,
      'the loop request is a mandate; the Command field is not on this path',
    );
    assert.doesNotMatch(code, /waitForCommandDecision|settleOffer|pendingCommandDecision/);
    assert.doesNotMatch(code, /CHAT_LOOP_COMMAND_PROPOSED|CHAT_LOOP_COMMAND_CONFIRM/);
    assert.doesNotMatch(code, /mayRunCommandOffer/);
  });

  it('and the assertion can still see a planted reading of the field', () => {
    const planted = `        return { kind: 'refused', reason: request.testCommand };`;
    const readings = fieldReadings(`${chatLoopSource()}\n${planted}`);
    assert.ok(
      readings.some((reading) => /\breturn\b/.test(reading.text)),
      'a planted refusal reading the field must be found by the same scan',
    );
  });

  it('starts the walk from mandate and run id only', () => {
    const request = fs.readFileSync(
      path.join(repoRoot, 'app', 'src', 'shared', 'bridge.ts'),
      'utf8',
    );
    const start = request.indexOf('export interface ChatLoopRunRequest');
    const end = request.indexOf('}', start);
    assert.ok(start > -1 && end > start);
    const body = request.slice(start, end + 1);
    assert.match(body, /runId/);
    assert.match(body, /mandate/);
    assert.doesNotMatch(body, /testCommand|testCwd/);
  });
});

describe('describeSnapshotChange — corroboration, not a branch', () => {
  const chatOutcomes = [CHANGED_FILES_OUTCOME, CHANGED_NOTHING_OUTCOME];
  const nothing = { changedFiles: 0, addedFiles: 0, removedFiles: 0 };

  it('describes an empty tree without choosing an outcome name the chat graph draws', () => {
    assert.match(describeSnapshotChange(nothing), /found no file changed, added or removed/);
    assert.match(describeSnapshotChange(nothing), /does not choose the branch/);
    assert.equal(measuredWorkOutcome(chatOutcomes, nothing)?.outcome, CHANGED_NOTHING_OUTCOME);
  });

  /**
   * Added and removed files count, not only modified ones.
   *
   * The case this exists for is a research mandate that writes `FINDINGS.md` into
   * the project: that file is *added*, not changed, and a rule that read
   * `diff.changed` alone would call it "changed nothing" and skip the check on a run
   * that really did leave something behind. The mirror case is a mandate that
   * deletes a file and modifies none.
   */
  it('counts an added file and a removed file as having changed the project', () => {
    assert.equal(
      measuredWorkOutcome(chatOutcomes, { ...nothing, addedFiles: 1 })?.outcome,
      CHANGED_FILES_OUTCOME,
      'a report file added to a project is a change to that project',
    );
    assert.equal(
      measuredWorkOutcome(chatOutcomes, { ...nothing, removedFiles: 1 })?.outcome,
      CHANGED_FILES_OUTCOME,
    );
    assert.equal(
      measuredWorkOutcome(chatOutcomes, { ...nothing, changedFiles: 2 })?.outcome,
      CHANGED_FILES_OUTCOME,
    );
  });

  it('says it compared two trees, so the record cannot read as the agent\'s claim', () => {
    for (const change of [nothing, { ...nothing, changedFiles: 1 }]) {
      const why = describeSnapshotChange(change);
      assert.match(why, /DSpatch compared the project before this step with the project after/);
      assert.match(why, /not the agent's account of what it did/);
      assert.match(why, /does not choose the branch/);
    }
  });

  /**
   * A node that draws no such branch keeps plain success.
   *
   * `dspatch-live-duration` is exactly that node, and it is a fixture several other
   * tests run. Producing an outcome it does not declare would fault every run of it
   * with `undeclared-product` — the runner and the drawing disagreeing about what
   * the file says, which is the thing the declaration check exists to catch.
   */
  it('draws nothing for a node that declares neither name', () => {
    assert.equal(measuredWorkOutcome([], { ...nothing, changedFiles: 3 }), null);
    assert.equal(measuredWorkOutcome([], nothing), null);
    assert.equal(
      measuredWorkOutcome([CHANGED_FILES_OUTCOME], nothing),
      null,
      'one of the two names is a measurement with nowhere to go half the time',
    );
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const implementer = duration.nodes.find((node) => node.id === 'implementer');
    assert.equal(measuredWorkOutcome(implementer?.outcomes ?? [], nothing), null);
  });

  /**
   * DSP-48 #1 and #2. The branch is decided by counts; the sentence names the files.
   *
   * The case this is written from: with a separate OS process appending one line to
   * `build/CMakeCache.txt` while the agent only read, the run took
   * `work → check → done`, spawned a real command and ended at the one ending that
   * says something positive about the project. The measurement cannot be made
   * perfect — the comparison is of the tree, and the agent is not the only thing that
   * writes into a project during a turn — so what has to change is the product
   * claiming it means more than it does. A person who reads `build/CMakeCache.txt`
   * recognises that instantly; one who reads *1 changed file* cannot.
   */
  it('names the files behind the comparison, and says a third party may have written them', () => {
    const why = describeSnapshotChange({
      changedFiles: 1,
      addedFiles: 0,
      removedFiles: 0,
      paths: ['build/CMakeCache.txt'],
    });
    assert.match(why, /1 changed file/, 'the count stays');
    assert.match(why, /build\/CMakeCache\.txt/, 'DSP-48 #1: and the path is named');
    assert.match(
      why,
      /anything else that wrote there while the loop was working/,
      'DSP-48 #2: a path the user did not expect must be attributable to something else',
    );
    assert.match(why, /a build server, an editor saving, an indexer, or you in another window/);
  });

  /** A run that changed four hundred files must not paste four hundred paths. */
  it('bounds the list it names and counts what it left out', () => {
    const many = Array.from({ length: MAX_NAMED_PATHS + 5 }, (_, index) => `src/file-${String(index)}.cpp`);
    const bounded = boundedPathList(many);
    assert.equal(bounded.named.length, MAX_NAMED_PATHS);
    assert.equal(bounded.notListed, 5);
    const why = describeSnapshotChange({
      changedFiles: many.length,
      addedFiles: 0,
      removedFiles: 0,
      paths: many,
    });
    assert.match(why, /src\/file-0\.cpp/);
    assert.doesNotMatch(why, /src\/file-12\.cpp/, 'the list is bounded');
    assert.match(why, /and 5 more this sentence does not list/, 'and the bound is said out loud');
    assert.deepEqual(boundedPathList([]), { named: [], notListed: 0 });
  });

  /** Paths are optional, so every caller written before today reads unchanged. */
  it('says nothing about paths when the caller had none', () => {
    const why = describeSnapshotChange({ ...nothing, changedFiles: 1 });
    assert.doesNotMatch(why, /The files DSpatch measured/);
    const unchanged = describeSnapshotChange({
      ...nothing,
      paths: [],
    });
    assert.doesNotMatch(unchanged, /The files DSpatch measured/);
  });

  it('is not a branch the chat graph draws', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === graph.entry);
    assert.deepEqual(work?.outcomes, ['succeeded', 'unclear']);
    assert.equal(measuredWorkOutcome(work?.outcomes ?? [], nothing), null);
    assert.equal(
      graph.edges.some(
        (edge) =>
          edge.when.on === 'outcome' &&
          (edge.when.outcome === CHANGED_FILES_OUTCOME ||
            edge.when.outcome === CHANGED_NOTHING_OUTCOME),
      ),
      false,
    );
  });
});

describe('declaredOutcomeFrom — a named verdict, or nothing readable', () => {
  const work = ['succeeded', 'unclear'];
  const check = ['met', 'not-met', 'could-not-check'];

  it('reads a whole-line RESULT the node declared', () => {
    assert.equal(
      declaredOutcomeFrom('I wrote the helper.\n\nRESULT: succeeded\n', work)?.outcome,
      'succeeded',
    );
    assert.equal(
      declaredOutcomeFrom('**RESULT: met**\nThe tests passed.', check)?.outcome,
      'met',
    );
  });

  it('takes nothing from a missing, contradictory or undeclared name', () => {
    assert.equal(declaredOutcomeFrom('I only read the project.', work), null);
    assert.equal(declaredOutcomeFrom('RESULT: succeeded\nRESULT: unclear', work), null);
    assert.equal(declaredOutcomeFrom('RESULT: pass', check), null);
    assert.equal(declaredOutcomeFrom('RESULT:', work), null);
  });

  it('falls back to the cheap name the node draws, and leaves the duration node alone', () => {
    assert.equal(undeclaredReadableOutcome(work)?.outcome, UNCLEAR_OUTCOME);
    assert.equal(undeclaredReadableOutcome(check)?.outcome, 'could-not-check');
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const implementer = duration.nodes.find((node) => node.id === 'implementer');
    assert.equal(undeclaredReadableOutcome(implementer?.outcomes ?? []), null);
  });
});

/**
 * DSP-47. The reply mentions being blocked; it does not declare it.
 *
 * The defect these are written from was measured end to end by the Verifier of call
 * 003: `/\bBLOCKED\b/i` against the whole reply is the ordinary English word, a
 * declared failure beats the measured branch, and so an agent that read a C++
 * project and reported what it found was routed to `stopped` — whose own purpose
 * sentence says the work was not done. Three of three plausible review sentences
 * did it.
 *
 * The first test is the trap and the second is the contract. The third is the
 * direction that matters most: it proves these strings really are the trap, by
 * running the *old* predicate over them here. A table of strings that the old code
 * would also have passed would prove nothing at all.
 */
describe('declaredFailureFrom — the reply\'s opening, not a word in it', () => {
  /** The three the Verifier measured, plus the ways the word turns up in C++ prose. */
  const mentions = [
    'I read the project. The render thread is blocked on a mutex held by the loader — that is the first defect.',
    'Nothing is Blocked and nothing failed; the repository is visible and has three defects.',
    'The build is not blocked.',
    'Two worker threads are BLOCKED on the same queue, which is the deadlock.',
    'I read the project and found three defects.',
    'The spec_error branch in parser.cpp is never taken.',
    'Blocked threads are the problem here.',
    'I could not find a SPEC_ERROR macro anywhere in the tree.',
    '```\nIf you cannot do the work, begin your reply with the word BLOCKED, then a sentence.\n```\nThat did not apply: here is what I found.',
    '> If the premise is wrong, begin your reply with the word SPEC_ERROR.\n\nThe premise was fine.',
  ];

  it('reads a reply that mentions being blocked as having declared nothing', () => {
    for (const reply of mentions) {
      assert.equal(
        declaredFailureFrom(reply),
        null,
        `this reply reports a finding and declares nothing: ${reply}`,
      );
    }
  });

  /** DSP-47 #2 and #3: the form the prompt asks for still routes exactly as before. */
  it('reads a declaration in the form the prompt asks for', () => {
    const declarations: readonly (readonly [string, 'blocked' | 'spec-error'])[] = [
      ['BLOCKED the workspace is read-only, so I could not write the file.', 'blocked'],
      ['BLOCKED', 'blocked'],
      ['BLOCKED: the project directory does not exist.', 'blocked'],
      // A leading blank line is not content, and providers emit them.
      ['\n\nBLOCKED I have no access to that directory.', 'blocked'],
      // Emphasis is decoration on the same opening, and providers add it.
      ['**BLOCKED** — the workspace is read-only.', 'blocked'],
      ['SPEC_ERROR the file the mandate names does not exist.', 'spec-error'],
      ['  SPEC_ERROR: there is no such target in this CMake project.', 'spec-error'],
      ['**SPEC_ERROR**\n\nThe tests are not the specification here.', 'spec-error'],
    ];
    for (const [reply, expected] of declarations) {
      assert.equal(declaredFailureFrom(reply), expected, `must still declare: ${reply}`);
    }
  });

  /**
   * The second direction, which is what found this defect in the first place.
   *
   * Every string in `mentions` must be one the **old** predicate would have taken.
   * Otherwise the table above could pass against a predicate that had not changed at
   * all, and a test that cannot fail is not evidence.
   */
  it('is a table the old predicate would have got wrong', () => {
    const oldWay = (text: string): boolean =>
      /\bSPEC_ERROR\b/i.test(text) || /\bBLOCKED\b/i.test(text);
    const wouldHaveMatched = mentions.filter((reply) => oldWay(reply));
    assert.equal(
      wouldHaveMatched.length,
      mentions.length - 1,
      'every mention but the one control must be one the old word-boundary match took',
    );
    // The control: a reply containing neither word at all, which proves the comparison
    // above is measuring the anchoring rather than the strings.
    assert.deepEqual(
      mentions.filter((reply) => !oldWay(reply)),
      ['I read the project and found three defects.'],
      'and the one the old predicate also passed must be the one without either word',
    );
    // Written expecting eight and measured at nine, which is itself worth keeping:
    // `/\bSPEC_ERROR\b/i` took `parser.cpp`'s lowercase `spec_error` identifier as a
    // declaration too, so the defect was not only in the word *blocked*.
    assert.ok(
      oldWay('The spec_error branch in parser.cpp is never taken.'),
      'the old predicate read an ordinary lowercase identifier as a declared failure',
    );
    assert.equal(declaredFailureFrom('The spec_error branch in parser.cpp is never taken.'), null);
  });

  it('takes nothing from an empty or whitespace-only reply', () => {
    assert.equal(declaredFailureFrom(''), null);
    assert.equal(declaredFailureFrom('   \n\n  '), null);
  });

  /**
   * The contract and the predicate have to say the same thing, or the next reader of
   * one of them will fix the wrong end. So the prompt DSpatch actually sends is
   * asserted to ask for the opening of the reply.
   */
  it('reads the reply the way chatPromptFor asks for it', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === graph.entry);
    assert.ok(work);
    const prompt = chatPromptFor(work, { entryId: graph.entry, mandate: 'Check the repo.' });
    for (const token of Object.keys(DECLARATION_TOKENS)) {
      assert.match(
        prompt,
        new RegExp(`begin your reply with the word ${token}`),
        'the instruction must ask for the token at the opening, which is where it is read',
      );
    }
  });
});

describe('notVerifiedOutcome — a leftover gate name, not a chat-loop verdict', () => {
  it('is offered only to a gate that still declares it', () => {
    const chat = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    assert.equal(
      notVerifiedOutcome(chat.nodes.find((node) => node.id === 'check')?.outcomes ?? []),
      null,
      'the chat checking step is an agent and does not draw not-verified',
    );
    assert.equal(
      notVerifiedOutcome(duration.nodes.find((node) => node.id === 'verify')?.outcomes ?? []),
      null,
      'the duration fixture draws two verdicts, so "nothing to run" still stops its run',
    );
    assert.equal(notVerifiedOutcome([NOT_VERIFIED_OUTCOME]), NOT_VERIFIED_OUTCOME);
    assert.equal(notVerifiedOutcome([]), null);
  });

  /**
   * The name is not a runtime fault's name, which the format would refuse.
   *
   * `no-outcome`, `timed-out` and `undelivered` are refused as failure kinds and as
   * edge conditions on purpose. `not-verified` is a verdict about the project's
   * configuration and has to stay expressible, so this pins that it does not match.
   */
  it('is not a name the format reads as the machinery breaking', () => {
    assert.equal(namesARuntimeFault(NOT_VERIFIED_OUTCOME), null);
    assert.equal(namesARuntimeFault(CHANGED_NOTHING_OUTCOME), null);
    assert.equal(namesARuntimeFault(CHANGED_FILES_OUTCOME), null);
  });
});

describe('chatPromptFor', () => {
  it('puts the composer text on the entry node and purpose on later nodes', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === 'work');
    const check = graph.nodes.find((node) => node.id === 'check');
    assert.ok(work);
    assert.ok(check);

    const mandate = 'Add a timeout to the retry helper and keep the existing tests.';
    const entryPrompt = chatPromptFor(work, { entryId: graph.entry, mandate });
    assert.match(entryPrompt, /Mandate:/);
    assert.match(entryPrompt, /Add a timeout to the retry helper/);
    assert.match(entryPrompt, /Standing purpose for this node:/);
    assert.match(entryPrompt, /Do what the Mandate asks/);
    assert.doesNotMatch(entryPrompt, /formatDuration/);

    const later = chatPromptFor(check, { entryId: graph.entry, mandate });
    assert.match(later, /Establish whether the assignment was met/);
    assert.match(later, /RESULT: met/);
    assert.match(later, /RESULT: not-met/);
    assert.match(later, /RESULT: could-not-check/);
    assert.doesNotMatch(later, /Mandate:/);
    assert.doesNotMatch(later, /Add a timeout/);
  });

  it('tells every agent step the names it may declare', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === 'work');
    assert.ok(work);
    const prompt = chatPromptFor(work, { entryId: graph.entry, mandate: 'Read the repo.' });
    assert.match(prompt, /RESULT: succeeded/);
    assert.match(prompt, /RESULT: unclear/);
    assert.match(prompt, new RegExp(RESULT_TOKEN));
  });
});

describe('modelForChatNode', () => {
  it('keeps inherit as the session model and a fixed slug as written', () => {
    assert.equal(modelForChatNode({ model: { policy: 'inherit' } }, 'composer-2'), 'composer-2');
    assert.equal(
      modelForChatNode({ model: { policy: 'fixed', model: 'gpt-5' } }, 'composer-2'),
      'gpt-5',
    );
  });
});

describe('formatChatLiveLogLine', () => {
  it('shows entered kind+label, outcome, branch and end — not the debug journal', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const lookup = lookupFromGraph(graph);

    const entered = formatChatLiveLogLine(
      entry('node-entered', { nodeId: 'work', data: { kind: 'agent' } }),
      lookup,
    );
    assert.equal(entered, 'Entered agent “Do what was asked”.');

    const produced = formatChatLiveLogLine(
      entry('node-produced', { nodeId: 'work', data: { product: 'outcome' } }),
      lookup,
    );
    assert.equal(produced, 'Produced outcome.');

    const branch = formatChatLiveLogLine(
      entry('edge-taken', { edgeId: 'e-succeeded', data: { to: 'check' } }),
      lookup,
    );
    assert.equal(branch, 'Took branch “work succeeded” to Check the work.');

    assert.equal(
      formatChatLiveLogLine(
        entry('edge-taken', { edgeId: 'e-unclear', data: { to: 'not-established' } }),
        lookup,
      ),
      'Took branch “work unclear” to Could not establish.',
    );
    assert.equal(
      formatChatLiveLogLine(
        entry('edge-taken', { edgeId: 'e-could-not-check', data: { to: 'not-established' } }),
        lookup,
      ),
      'Took branch “could not check” to Could not establish.',
    );

    const ended = formatChatLiveLogLine(entry('run-ended', { data: { status: 'completed' } }), lookup);
    assert.equal(ended, 'Run ended: completed.');

    assert.equal(formatChatLiveLogLine(entry('run-started'), lookup), null);
    assert.doesNotMatch(entered ?? '', /debug journal/);
  });

  it('says why a run faulted, passing the reconciliation guidance through whole', () => {
    const lookup = lookupFromGraph(loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json'));
    // The wording a real fault carries: fail() records `${fault.detail} ${fault.reconcile}`.
    const detail =
      '"work" reported a runtime fault: the provider closed the connection. ' +
      'Establish what the turn changed in the project before anything is repeated.';
    assert.equal(
      formatChatLiveLogLine(
        entry('runtime-fault', { nodeId: 'work', detail, data: { fault: 'executor-threw' } }),
        lookup,
      ),
      detail,
    );
  });

  it('says which bound was spent, and what is pending at a human step', () => {
    const lookup = lookupFromGraph(loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json'));

    const bound =
      '"work" is bounded at 15 minutes and took 16. The run stops here with its ' +
      'result and a proposed next step.';
    assert.equal(
      formatChatLiveLogLine(entry('limit-reached', { nodeId: 'work', detail: bound }), lookup),
      bound,
    );

    const waiting =
      '"review" is waiting for a person: approve the change. Nothing was repeated and ' +
      'nothing was reset; the run\'s history stands as journalled.';
    assert.equal(
      formatChatLiveLogLine(entry('awaiting-human', { nodeId: 'review', detail: waiting }), lookup),
      waiting,
    );
  });

  it('falls back to an honest sentence when the ending recorded no reason', () => {
    const lookup = lookupFromGraph(loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json'));
    for (const kind of ['runtime-fault', 'limit-reached', 'awaiting-human'] as const) {
      const line = formatChatLiveLogLine(entry(kind, { detail: '   ' }), lookup);
      assert.ok(line !== null && line.trim() !== '', `${kind} must not produce an empty line`);
      assert.match(line, /before anything is repeated/);
    }
  });
});

describe('planChatCancel', () => {
  it('routes at the loop while one is walking and at the run otherwise', () => {
    assert.equal(planChatCancel({ loopBusy: true, abandonsSend: false }).target, 'chat-loop');
    assert.equal(planChatCancel({ loopBusy: false, abandonsSend: false }).target, 'agent-run');
    assert.equal(planChatCancel({ loopBusy: true, abandonsSend: true }).target, 'chat-loop');
    assert.equal(planChatCancel({ loopBusy: false, abandonsSend: true }).target, 'agent-run');
  });

  it('leaves no stale loop flag after Stop waiting, so the next Cancel reaches the run', () => {
    // Use loop on, Send: the window is walking the chat loop.
    let loopBusy = true;

    // Stop waiting. This abandons the send, so the send's own generation-guarded
    // cleanup no longer matches and will never clear the flag.
    const stop = planChatCancel({ loopBusy, abandonsSend: true });
    assert.equal(stop.target, 'chat-loop');
    assert.equal(stop.clearLoopBusy, true);
    loopBusy = loopBusyAfterChatCancel(loopBusy, stop);
    assert.equal(loopBusy, false);

    // Use loop off, Send normally, Cancel. With the flag left stale this reaches
    // cancelChatLoopRun, which answers "No chat loop is in progress" while the
    // provider run continues uncancelled.
    const cancel = planChatCancel({ loopBusy, abandonsSend: false });
    assert.equal(cancel.target, 'agent-run');
    assert.equal(cancel.clearLoopBusy, false);
    assert.equal(loopBusyAfterChatCancel(loopBusy, cancel), false);
  });

  it('leaves a Cancel during a loop walk to the send it interrupts', () => {
    // Cancel does not bump the send generation, so the send still ends in its own
    // cleanup; clearing the flag here would be a second owner of the same state.
    const cancel = planChatCancel({ loopBusy: true, abandonsSend: false });
    assert.equal(cancel.clearLoopBusy, false);
    assert.equal(loopBusyAfterChatCancel(true, cancel), true);
  });
});

describe('chatSendAfter', () => {
  /** Send pressed with the Use loop toggle in the given position. */
  function sendPressed(state: ChatSendState, walksLoop: boolean): ChatSendState {
    return chatSendAfter(state, { kind: 'send-started', walksLoop });
  }

  /** What Cancel would reach in this state. */
  function cancelTarget(state: ChatSendState): string {
    return planChatCancel({ loopBusy: state.loopBusy, abandonsSend: false }).target;
  }

  const idle: ChatSendState = { generation: 0, loopBusy: false };

  it('points Cancel at the run during a send that follows a cancelled loop walk', () => {
    // Use loop on, Send: the window walks the chat loop and Cancel belongs to it.
    let state = sendPressed(idle, true);
    const walk = state.generation;
    assert.equal(state.loopBusy, true);
    assert.equal(cancelTarget(state), 'chat-loop');

    // Cancel. cancelChatLoopRun only requests the abort, so the walk stays
    // outstanding; Cancel bumps no generation and clears no flag.
    const stopWalk = planChatCancel({ loopBusy: state.loopBusy, abandonsSend: false });
    state = { ...state, loopBusy: loopBusyAfterChatCancel(state.loopBusy, stopWalk) };
    assert.equal(state.loopBusy, true);

    // Cancel has cleared `busy`, so Send is enabled again and the composer still
    // holds its text. Use loop off, Send: an ordinary provider run starts.
    state = sendPressed(state, false);
    assert.notEqual(state.generation, walk);

    // The consequence the user meets. Cancel must reach the run that is actually
    // going, not a loop that has already been asked to stop and would answer
    // "No chat loop is in progress" while the run continues uncancelled.
    assert.equal(cancelTarget(state), 'agent-run');
    assert.equal(state.loopBusy, false);

    // The aborted walk settles late, naming the generation it belonged to. It must
    // leave this send's flag as it found it.
    const late = chatSendAfter(state, { kind: 'send-settled', generation: walk });
    assert.equal(cancelTarget(late), 'agent-run');
    assert.equal(late.loopBusy, false);
  });

  it('keeps the newer loop send flag when an older walk settles after it', () => {
    let state = sendPressed(idle, true);
    const first = state.generation;

    // Cancel, then Send again with Use loop still on, before the first walk has
    // settled. The main process refuses a second concurrent walk (main.ts:1247), so
    // what is at stake here is the order in which two outstanding sends settle, not
    // two walks running at once.
    state = sendPressed(state, true);
    const second = state.generation;
    assert.equal(state.loopBusy, true);

    // The first send settles last. Its cleanup must leave the flag the second send
    // holds alone, or Cancel would stop reaching the loop mid-send.
    state = chatSendAfter(state, { kind: 'send-settled', generation: first });
    assert.equal(cancelTarget(state), 'chat-loop');
    assert.equal(state.loopBusy, true);

    // The second send settles: nothing is outstanding and Cancel goes back to the run.
    state = chatSendAfter(state, { kind: 'send-settled', generation: second });
    assert.equal(cancelTarget(state), 'agent-run');
    assert.equal(state.loopBusy, false);
  });

  it('still leaves no stale flag when Stop waiting abandons the loop send', () => {
    let state = sendPressed(idle, true);
    const walk = state.generation;

    // Stop waiting, as the window does it: bump the generation, then take the flag
    // from the cancel plan, which clears it because the send has been abandoned.
    const stop = planChatCancel({ loopBusy: state.loopBusy, abandonsSend: true });
    assert.equal(stop.target, 'chat-loop');
    state = {
      generation: state.generation + 1,
      loopBusy: loopBusyAfterChatCancel(state.loopBusy, stop),
    };
    assert.equal(state.loopBusy, false);

    // Use loop off, Send normally, Cancel.
    state = sendPressed(state, false);
    assert.equal(cancelTarget(state), 'agent-run');

    // And the abandoned walk settling afterwards changes nothing.
    assert.equal(chatSendAfter(state, { kind: 'send-settled', generation: walk }).loopBusy, false);
  });
});

describe('chat-loop gate command', () => {
  it('follows suggestBuildCommand, not the duration file, when that file is absent', () => {
    const dir = scratch('npm-test');
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      `${JSON.stringify({ name: 'sample', scripts: { test: 'echo ok' } }, null, 2)}\n`,
      'utf8',
    );
    const suggestion = suggestBuildCommand(dir, null);
    assert.equal(suggestion.command, 'npm test');
    assert.doesNotMatch(suggestion.command, /duration\.test\.ts/);
  });
});

describe('nodeHelpText', () => {
  it('joins purpose with what the kind requires', () => {
    const text = nodeHelpText({
      id: 'work',
      kind: 'agent',
      label: 'Do what was asked',
      purpose: 'Do what the Mandate asks.',
    });
    assert.match(text, /Do what the Mandate asks/);
    assert.match(text, /Required: A role description/);
  });
});
