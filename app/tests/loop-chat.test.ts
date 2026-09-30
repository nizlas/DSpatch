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
// The reader the prompt describes (DSP-104). Reaching into the live executor from a test
// about the message is the point: the card is that the two disagreed, and a test that
// could only see one of them is how that survived.
import { productFromAssistantText } from '../src/main/loop-live';
import { suggestBuildCommand } from '../src/main/test-command';
import {
  boundedPathList,
  carriesRunChange,
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
  describeChosenLoopBinding,
  describeRunChange,
  describeSnapshotChange,
  formatChatLiveLogLine,
  loopBusyAfterChatCancel,
  lookupFromGraph,
  MAX_NAMED_PATHS,
  MAX_NAMED_RUN_PATHS,
  measuredWorkOutcome,
  modelForChatNode,
  nodeHelpText,
  NOT_VERIFIED_OUTCOME,
  notVerifiedOutcome,
  planChatCancel,
  RESULT_TOKEN,
  ROLE_BLOCK_CLOSE,
  ROLE_BLOCK_OPEN,
  RUN_CHANGE_NOTE,
  TASK_PRECEDENCE,
  undeclaredReadableOutcome,
} from '../src/shared/loop-chat';
import { describeLiveBinding } from '../src/shared/loop-editor-run';
import { INSTRUCTION_BLOCK_OPEN, instructionPreamble } from '../src/shared/loop-instruction';
import { workingRootsFrom } from '../src/shared/working-roots';
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
    // DSP-91 #1 replaced the assertion that stood here, which was
    // `prompt.includes(role.sourcePath)`. `sourcePath` is relative to the loop
    // definition's resource root, which is resolved in the main process and never
    // reaches the agent — so from where the agent stands it resolves into the project,
    // and on 21 September a coordinator went looking for its own role file in
    // MiniDAWLab, did not find it, and reported a spec error against its own
    // assignment. The purpose the old assertion served, that a wrong role stays
    // recognisable, is served by the identity; the path stays in the run record.
    assert.equal(
      prompt.includes(role.sourcePath),
      false,
      'a path relative to a root the agent does not have is a path into the project',
    );
    assert.ok(
      prompt.includes(`role "${role.id}"`),
      'the role is still named, so an agent handed the wrong one can say which it got',
    );
    assert.match(prompt, /It reached you from the loop definition\u2019s own resources/);
    assert.match(prompt, /do not look for one/);
  });

  /** A role that resolved to a name and no prose is said, not silently dropped. */
  it('says so when the role file gave it nothing to pass on', () => {
    const prompt = chatPromptFor(node, {
      entryId: 'work',
      mandate: 'Add a field.',
      role: { ...role, instructions: null },
    });

    assert.ok(prompt.includes('read no instructions for it beyond the name'));
    assert.equal(prompt.includes(ROLE_BLOCK_OPEN), false, 'no markers around nothing');
    // And this is the case where an agent is most likely to go hunting for the role it
    // was not given, so the provenance sentence has to be here too.
    assert.match(prompt, /do not read its absence there as a fault in your assignment/);
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

/**
 * DSP-70. The `graph.id !== 'dspatch-chat-loop'` whitelist is gone, and its old
 * assertion went with it: a test requiring a chosen definition to be refused would
 * now be describing a product that does not exist.
 *
 * DSP-78 removed the last of it. The one refusal that survived — our own development
 * loop, by id, whatever folder was open — is gone too, because a drawing is not a
 * folder: what must never happen is a run over DSpatch's working copy, and that is
 * `refuseLiveWorkingRoots`'s question, asked of every loop about the roots the run was
 * actually given. So this now asserts the positive — every chosen drawing binds. The
 * folder guard is asserted next to `refuseLiveWorkingRoots` in `loop-live.test.ts`.
 */
describe('describeChosenLoopBinding', () => {
  it('walks whatever was chosen, including our own development loop', () => {
    const chat = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const development = loadGraph('docs/loop/graphs/dspatch-development-loop.graph.json');
    const runnable = loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');

    const chatBinding = describeChosenLoopBinding(chat);
    assert.equal(chatBinding.ready, true);
    assert.equal(chatBinding.state, 'ready');

    assert.equal(describeLiveBinding(chat).ready, false);
    assert.equal(describeLiveBinding(chat).state, 'unbound');
    assert.equal(describeLiveBinding(duration).ready, true);

    // The drawing that used to be refused by its id, and the subset the standalone
    // definition points at. Both bind: choosing them is allowed wherever they are.
    for (const graph of [development, runnable]) {
      const binding = describeChosenLoopBinding(graph, 'DSpatch development loop');
      assert.equal(binding.ready, true, `${graph.id} must be choosable`);
      assert.equal(binding.state, 'ready');
      assert.match(binding.reason, /DSpatch development loop/);
    }

    const chosen = describeChosenLoopBinding({ id: 'just-drawn', name: 'A new loop' }, 'Ported loop');
    assert.equal(chosen.ready, true, 'a chosen definition other than the chat loop must run');
    assert.match(chosen.reason, /Ported loop/);
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

  /**
   * DSP-103. The two nodes are read off the shipped file rather than reconstructed
   * here, because what is being checked is that the drawing states the route — not
   * that a helper can be handed one. The negative half is the point of the card: a
   * node with the same outcome list and no `whenUndeclared` answers `null`, so the
   * spelling buys nothing. The duration fixture's implementer, which declares no
   * outcomes at all, is left exactly as it was.
   */
  it('takes the route the node states, and nothing from the name alone', () => {
    const chat = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const workNode = chat.nodes.find((node) => node.id === 'work');
    const checkNode = chat.nodes.find((node) => node.id === 'check');
    assert.deepEqual(workNode?.outcomes, work);
    assert.deepEqual(checkNode?.outcomes, check);
    assert.equal(undeclaredReadableOutcome(workNode ?? {})?.outcome, 'unclear');
    assert.equal(undeclaredReadableOutcome(checkNode ?? {})?.outcome, 'could-not-check');

    assert.equal(undeclaredReadableOutcome({ outcomes: work }), null);
    assert.equal(undeclaredReadableOutcome({ outcomes: check }), null);
    // And a name the node cannot produce is not a route either, so the engine can
    // never hand the runner an outcome the graph would refuse the step for.
    assert.equal(
      undeclaredReadableOutcome({ outcomes: work, whenUndeclared: 'not-established' }),
      null,
    );

    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const implementer = duration.nodes.find((node) => node.id === 'implementer');
    assert.equal(undeclaredReadableOutcome(implementer ?? {}), null);
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

  /**
   * DSP-72 #2. The paths and which one the shell starts in, on every agent step.
   *
   * On the entry node *and* on a later one, because a run's second step is where the
   * porting usually happens and a prompt that named the folders only once would leave
   * the step that needed them guessing.
   */
  it('names every working folder and the working directory, on the first step and a later one', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === 'work');
    const check = graph.nodes.find((node) => node.id === 'check');
    assert.ok(work);
    assert.ok(check);
    const workingRoots = workingRootsFrom(
      ['C:/work/source-repo', 'C:/work/target-repo'],
      'C:/work/target-repo',
      true,
    );
    for (const node of [work, check]) {
      const prompt = chatPromptFor(node, {
        entryId: graph.entry,
        mandate: 'Port the retry helper from one repository to the other.',
        workingRoots,
      });
      assert.ok(prompt.includes('C:/work/source-repo'), 'the second folder\u2019s path');
      assert.ok(prompt.includes('C:/work/target-repo'), 'the working folder\u2019s path');
      assert.match(prompt, /\(the working directory\)/);
      assert.match(prompt, /Your shell starts in C:\/work\/target-repo/);
      // The roots come before the work, for the same reason the role does.
      assert.ok(prompt.indexOf('C:/work/source-repo') < prompt.indexOf('RESULT:'));
    }
  });

  /**
   * DSP-91 #2 replaced the assertion here, which pinned that one root changed nothing.
   *
   * The consequence of saying nothing was that a prompt could name a role's resource path,
   * a mandate about a project and a result path, and never once say where the project was
   * — which is the message the 21 September coordinator received. One folder is named, and
   * a prompt with no roots at all is still the prompt it was.
   */
  it('names the one folder, and still says nothing when there are none', () => {
    const graph = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const work = graph.nodes.find((node) => node.id === 'work');
    assert.ok(work);
    const one = workingRootsFrom(['C:/work/only'], 'C:/work/only', true);
    const named = chatPromptFor(work, {
      entryId: graph.entry,
      mandate: 'Read the repo.',
      workingRoots: one,
    });
    assert.ok(named.includes('C:/work/only'));
    assert.match(named, /one working folder/);
    assert.equal(
      chatPromptFor(work, { entryId: graph.entry, mandate: 'Read the repo.', workingRoots: [] }),
      chatPromptFor(work, { entryId: graph.entry, mandate: 'Read the repo.' }),
    );
  });

  /**
   * DSP-91 #6: every branch the drawing can take has a form the agent was taught — and the
   * two kinds of name are introduced separately, which walk 1 of the verification paid for.
   *
   * Under one shared "use one of these names" sentence, a step that had succeeded was being
   * told that finishing meant writing `RESULT: spec-error`, `research-needed` or `blocked`.
   * It invented `RESULT: change` instead, which is what an agent does when the prompt leaves
   * it no true answer. So the failure list has to arrive as the exception it is.
   *
   * The node that holds this property was the runnable loop's `researcher` under DSP-102,
   * and DSP-103 gave that one verdicts of its own — so the shipped drawing that still has
   * a step with failures and no outcome is the duration fixture's `implementer`. The
   * property is the prompt builder's and not any graph's: it is asserted here on whichever
   * real node has the shape, rather than on one written for the test.
   */
  it('asks a step with failures and no verdict for no line at all unless it failed', () => {
    const duration = loadGraph('docs/loop/graphs/dspatch-live-duration.graph.json');
    const runnable = loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');
    const implementer = duration.nodes.find((node) => node.id === 'implementer');
    assert.ok(implementer);
    assert.equal(implementer.outcomes, undefined, 'this test is about a step with no verdict');
    const prompt = chatPromptFor(implementer, {
      entryId: duration.entry,
      mandate: 'Complete formatDuration so the existing tests pass.',
    });
    // The names the drawing draws edges for, neither of which was in the prompt before
    // DSP-91: `e-spec` and `e-blocked` both route on a word nobody had been told.
    assert.match(prompt, /RESULT: spec-error/);
    assert.match(prompt, /RESULT: blocked/);
    // And the sentence that makes them the exception rather than the answer.
    assert.match(prompt, /This step has no verdict to name/);
    assert.match(prompt, /a step that finished writes no such line/);
    assert.doesNotMatch(
      prompt,
      /A missing or contradictory name is read as/,
      'for this node a missing line is success, so that sentence would be false',
    );

    // DSP-104. What this node is told an invented name does is what happens to one.
    //
    // The sentence said *"read as a result nobody can route"*, and nothing reads it at
    // all: the name matches no declared outcome, a node declaring none can state no
    // fallback, and the reply falls through to plain success. `RESULT: change` from
    // DSP-91's first walk was carried onward as work finished, which is the message
    // promising a stricter reader than the one that exists.
    assert.match(prompt, /any other name on such a line is not read as a result at all/);
    assert.match(prompt, /carries on exactly as it would for a reply with no such line/);
    assert.doesNotMatch(
      prompt,
      /read as a result nobody can route/,
      'nothing refuses to route an invented name here; the run reads it as success',
    );

    // The other half of the card, on the machine rather than the message: the routing is
    // unchanged, so the sentence is now true of a reader nobody edited.
    const invented = productFromAssistantText(implementer, 'Done.\n\nRESULT: change');
    assert.deepEqual(invented.product, { kind: 'success' });
    const silentAboutIt = productFromAssistantText(implementer, 'Done.');
    assert.deepEqual(
      silentAboutIt.product,
      invented.product,
      'the invented name reaches the same product as no line at all, which is what the prompt now says',
    );
    // And a name the node *does* declare is still read, so "anything other than one of
    // the names above" is the right scope for the sentence.
    assert.deepEqual(productFromAssistantText(implementer, 'RESULT: blocked').product, {
      kind: 'declared-failure',
      failure: 'blocked',
    });
    // The coordinator's own case, which is the one the 21 September run turned on: it now
    // declares two failures, so it is asked for the two opening words as well.
    const coordinator = runnable.nodes.find((node) => node.id === 'coordinator');
    assert.ok(coordinator);
    const brief = chatPromptFor(coordinator, {
      entryId: runnable.entry,
      mandate: 'Do something this project cannot do.',
    });
    assert.match(brief, /begin your reply with the word SPEC_ERROR/);
    assert.match(brief, /begin your reply with the word BLOCKED/);
  });

  /**
   * The other side of it after DSP-102, and it is the same function doing the work.
   *
   * The three steps down the middle of the runnable loop now declare their own outcomes,
   * so `outcomeInstructions` switches to its verdict branch for them off that one field
   * and no instruction was written by hand for this card. What the implementer is asked
   * for changed from "a step that finished writes no such line" to a named result, and
   * the sentence about a missing name — which was withheld from this node because it was
   * untrue of it — is now both sent and true: a missing name takes `e02a`.
   */
  it('asks a step that must name its result for the name, and says what a missing one means', () => {
    const runnable = loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');
    for (const [id, success, unestablished] of [
      ['coordinator', 'briefed', 'unclear'],
      ['implementer', 'done', 'unclear'],
      ['verifier', 'checked', 'could-not-check'],
    ] as const) {
      const node = runnable.nodes.find((candidate) => candidate.id === id);
      assert.ok(node);
      assert.deepEqual(node.outcomes, [success, unestablished], `${id} declares both names`);
      const prompt = chatPromptFor(node, {
        entryId: runnable.entry,
        mandate: 'Carry out the bounded assignment.',
      });
      assert.match(prompt, new RegExp(`RESULT: ${success}`), `${id} is asked for its result`);
      assert.match(prompt, new RegExp(`RESULT: ${unestablished}`));
      // DSP-103: the sentence used to be the same for every node and true only of the
      // ones whose outcome happened to be spelled one of two ways. It now names this
      // node's own route, read off the same field the runner reads.
      assert.match(
        prompt,
        new RegExp(`A missing or contradictory name is read as "${unestablished}"`),
        `${id} must be told what saying nothing means, because it now means something`,
      );
      assert.doesNotMatch(
        prompt,
        /This step has no verdict to name/,
        `${id} has a verdict to name, and telling it otherwise is what the card is about`,
      );
      // The failures stay, introduced as the exception they are rather than as the answer.
      assert.match(prompt, /RESULT: blocked/);
      assert.match(prompt, /If instead you could not complete the step at all/);
    }
  });

  /**
   * And the other direction: a node that declares no failure is not asked for one.
   *
   * The 21 September coordinator declared none and was asked for both words anyway, so the
   * refusal it gave had no edge to take and was routed as success down `e01` — the
   * implementer was handed a refusal as its brief. Asking only where the drawing can act is
   * the fix; this is the half of it that has to stay true of every other node.
   */
  it('does not ask a node for a declaration the drawing cannot route', () => {
    // A node declaring one failure and not the other, which is the case a shipped graph
    // does not currently contain and the case the fix has to get right: exactly the word
    // with an edge behind it, and not the other.
    const onlyBlocked = {
      id: 'work',
      kind: 'agent' as const,
      purpose: 'Do the work.',
      declaredFailures: ['blocked'],
    };
    const prompt = chatPromptFor(onlyBlocked, { entryId: 'start', mandate: 'Read the repo.' });
    assert.match(prompt, /begin your reply with the word BLOCKED/);
    assert.doesNotMatch(prompt, /SPEC_ERROR/);

    // And a node declaring nothing is asked for neither, which is the 21 September
    // coordinator's own case: it declared none and was asked for both.
    const silent = { id: 'work', kind: 'agent' as const, purpose: 'Do the work.' };
    const quiet = chatPromptFor(silent, { entryId: 'start', mandate: 'Read the repo.' });
    assert.doesNotMatch(quiet, /SPEC_ERROR/);
    assert.doesNotMatch(quiet, /BLOCKED/);
    assert.doesNotMatch(quiet, new RegExp(RESULT_TOKEN));
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

/**
 * The role text and the message have to ask for the same thing (DSP-96 part 1).
 *
 * DSP-91 made `declarationInstructions` and `outcomeInstructions` conditional on the
 * node's own declarations, and the test above pins that. What it could not see is the
 * *role*, which is assembled into the same message: `dspatch-run-coordinator.role.md`
 * went on demanding a `RESULT:` line and both opening words unconditionally, and
 * `coordinator-report` — which declares neither an outcome nor a failure — invented a
 * `RESULT:` line in all four DSP-91 walks. The latent half was worse than the observed
 * one: `productIsDeclared` turns an undeclared failure into the runtime fault
 * `undeclared-product` *after* the result is filed, so a last step that had written the
 * run's report and opened its reply with SPEC_ERROR would have faulted the run.
 *
 * These assertions are on the **assembled prompt** with the role resolved from its real
 * file, because that is the only place the contradiction was visible: either half read
 * alone looks fine.
 */
describe('a step is asked only for the result its own contract offers', () => {
  const runnable = (): LoopGraph =>
    loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');

  function promptForNode(id: string): string {
    const graph = runnable();
    const node = graph.nodes.find((candidate) => candidate.id === id);
    assert.ok(node, `${id} must be a node of the runnable loop`);
    assert.ok(node.role, `${id} must name a role`);
    const role = createFileRoleResolver(repoRoot)(node.role);
    assert.ok(role, `${id}'s role file must resolve`);
    assert.ok((role.instructions ?? '').trim() !== '', `${id}'s role must have prose`);
    return chatPromptFor(node, {
      entryId: graph.entry,
      mandate: 'Report what this run did.',
      role: { id: role.id, sourcePath: role.sourcePath, instructions: role.instructions },
      step: { runId: 'run-9', occurrence: 1, callId: 6, freshSession: true },
    });
  }

  /**
   * DSP-97 changed the first half of this and left the second exactly as it was.
   *
   * The report step now declares two outcomes, so it *is* shown a line — which is the
   * whole of that card at this node. It still declares no failure, so it is still shown
   * neither opening word, and the role still tells it what to do instead. Both halves are
   * asserted together because the defect this test was written for was the role and the
   * message asking for different things, and that is what a change to either can revive.
   */
  it('asks the report step for its own two names and for no declaration, role text included', () => {
    const graph = runnable();
    const report = graph.nodes.find((node) => node.id === 'coordinator-report');
    assert.ok(report);
    assert.deepEqual(report.outcomes, ['reported', 'could-not-report']);
    assert.equal(report.declaredFailures, undefined, 'and no failure');

    const prompt = promptForNode('coordinator-report');
    // The two names the drawing routes, and nothing else on such a line.
    assert.match(prompt, /^RESULT: reported$/m);
    assert.match(prompt, /^RESULT: could-not-report$/m);
    assert.doesNotMatch(prompt, /^RESULT: (?!reported$|could-not-report$)/m);
    // And the absence of a name is described as the route the node states, not as a stop
    // and not as a reading of the reply.
    assert.match(prompt, /A missing or contradictory name is read as "could-not-report"/);
    // No opening word, because no edge here carries one.
    assert.doesNotMatch(prompt, /begin your reply with the word/);
    // And the role says what to do instead, which is the half that makes that absence
    // readable rather than merely silent.
    assert.match(prompt, /decided by the message you are in, not by this role/);
    assert.match(prompt, /Where it lists none, doing the work is the answer/);
    assert.match(prompt, /say plainly in prose what is wrong or what is in the way/);
  });

  it('asks the verifier for the one failure it declares and not the other', () => {
    const graph = runnable();
    const verifier = graph.nodes.find((node) => node.id === 'verifier');
    assert.ok(verifier);
    assert.deepEqual(verifier.declaredFailures, ['blocked'], 'the drawing draws e10 and no more');

    const prompt = promptForNode('verifier');
    assert.match(prompt, /begin your reply with the word BLOCKED/);
    assert.doesNotMatch(prompt, /SPEC_ERROR/, 'no edge carries it from this node');
    assert.match(prompt, /RESULT: blocked/);
    // And since DSP-102 it has verdicts too, so the failure arrives as the exception
    // rather than as the only line it could ever write.
    assert.match(prompt, /RESULT: checked/);
    assert.match(prompt, /If instead you could not complete the step at all/);
  });

  /**
   * The same role, two nodes, two different contracts — which is why the fix is in the
   * message and not in the role. `coordinator` declares two failures and `coordinator-report`
   * declares none, and one file has to serve both.
   */
  it('gives the same role opposite contracts at its two nodes', () => {
    const briefing = promptForNode('coordinator');
    assert.match(briefing, /begin your reply with the word SPEC_ERROR/);
    assert.match(briefing, /begin your reply with the word BLOCKED/);
    assert.match(briefing, /RESULT: spec-error/);
    assert.doesNotMatch(promptForNode('coordinator-report'), /RESULT: spec-error/);
  });

  /**
   * F2: the engine paragraph belongs to the engine, and the role may not hand an agent a
   * DSpatch path while its shell is standing in somebody else's repository.
   */
  it('leaves the shared runtime contract to the message that carries it', () => {
    const prompt = promptForNode('coordinator-report');
    assert.match(prompt, /You are one step inside a loop DSpatch is already walking\./);
    assert.equal(
      (prompt.match(/opens a session per step/g) ?? []).length,
      0,
      'the role\u2019s second copy of the engine paragraph is gone',
    );
    assert.doesNotMatch(prompt, /SKILL\.md/, 'no bare DSpatch path reaches an agent');
    // What is kept is what only this role can say.
    assert.match(prompt, /\*\*That is not this role\*\*/);
  });
});

/**
 * What a receiving agent is told, now that it is a different agent (DSP-79).
 *
 * The test just above pins that a later step is **not** sent the mandate, and that was
 * right while every step shared one conversation: the mandate was two messages up, and
 * repeating it would have been noise. With one session per node it is the opposite —
 * the later step has never seen it. Both are tested, because which one applies depends
 * on whether the caller says there is a session boundary.
 */
describe('chatPromptFor — the brief for an agent that has seen nothing', () => {
  const graph = (): ReturnType<typeof loadGraph> =>
    loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
  const mandate = 'Add a timeout to the retry helper and keep the existing tests.';

  function checkNode(): NonNullable<ReturnType<typeof graph>['nodes'][number]> {
    const node = graph().nodes.find((each) => each.id === 'check');
    assert.ok(node);
    return node;
  }

  it('gives a fresh agent the mandate, its address in the run, and the fact it has no history', () => {
    const prompt = chatPromptFor(checkNode(), {
      entryId: graph().entry,
      mandate,
      step: {
        runId: 'run-7',
        occurrence: 1,
        callId: 2,
        freshSession: true,
        attachments: { receivedResults: true, requiredResult: false },
      },
    });

    assert.match(prompt, /You are step "check" \(Check the work\) of DSpatch loop run run-7, call 2\./);
    assert.match(prompt, /You have not seen the rest of this run/);
    assert.match(prompt, /Other steps of this run are other agents/);
    assert.match(prompt, /Mandate:/);
    assert.match(prompt, /Add a timeout to the retry helper/);
    assert.match(prompt, /Establish whether the assignment was met/);
    // And it is told where to look for the handover, because the executor appends it
    // after this text and an agent reading top to bottom would not know it was coming.
    assert.match(prompt, /At the end of this message you will find what an earlier step left for you\./);
    // Every step is told who is driving (DSP-91 #3), not only the one role file that
    // used to carry the paragraph.
    assert.match(prompt, /You are one step inside a loop DSpatch is already walking\./);
    assert.match(prompt, /Maestro/);
    assert.match(prompt, /you do not call other agents/);
    // Order: who you are, then where things are, then what the run is for, then your
    // step — the same order the role preamble is placed for.
    assert.ok(prompt.indexOf('You have not seen') < prompt.indexOf('Mandate:'));
    assert.ok(prompt.indexOf('Mandate:') < prompt.indexOf('Establish whether'));
  });

  // DSP-79 left this out of a revisit as a repetition the session already held, and
  // DSP-100 put it back. The reason is in the run of 22 September 2026: the revisited
  // implementer had the reviewer's account of the assignment and not the person's, and
  // the precedence paragraph it was also sent asks it to rank exactly those two against
  // each other. A conversation is not a place to rank from — the whole point of the
  // paragraph is that the later account may narrow the earlier words, which is invisible
  // unless both are in front of it.
  it('sends an agent being asked again the mandate again, unchanged and marked as the same one', () => {
    const prompt = chatPromptFor(checkNode(), {
      entryId: graph().entry,
      mandate,
      step: { runId: 'run-7', occurrence: 2, callId: 5, freshSession: false },
    });

    assert.match(prompt, /you are the same agent that made the earlier visit/);
    assert.match(prompt, /what you did then is above in this conversation/);
    assert.match(prompt, /Mandate:/);
    assert.match(prompt, /Add a timeout/);
    // Repeated, and said to be a repetition. An unannounced second copy of the mandate
    // is the thing a revisited agent could read as a new assignment, which is the
    // misreading this whole card exists to stop.
    assert.match(prompt, /It is the same assignment as on your earlier visit, not a new one/);
    // Once, not twice.
    assert.equal(prompt.split('Mandate:').length - 1, 1);
  });

  // The settled half of DSP-100, and it is settled independently of the mandate: a
  // revisit is a route the drawing took, not a reply to the step.
  it('tells a revisited agent that coming back is not an answer to what it asked', () => {
    const prompt = chatPromptFor(checkNode(), {
      entryId: graph().entry,
      mandate,
      step: { runId: 'run-7', occurrence: 2, callId: 5, freshSession: false },
    });

    assert.match(prompt, /it is not a reply to you/);
    assert.match(prompt, /not by itself an answer to anything you asked/);
    assert.match(prompt, /it has not been answered/);
  });

  it('names the route a revisit arrived on when the run says which it was', () => {
    const prompt = chatPromptFor(checkNode(), {
      entryId: graph().entry,
      mandate,
      step: {
        runId: 'run-7',
        occurrence: 2,
        callId: 5,
        freshSession: false,
        arrivedBy: { edgeId: 'e12', from: 'review', label: 'rework, bounded' },
      },
    });

    assert.match(prompt, /come back to this step along "e12" \(rework, bounded\) from "review"/);
    // A first visit has no route and must not be told about one.
    assert.doesNotMatch(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: {
          runId: 'run-7',
          occurrence: 1,
          callId: 2,
          freshSession: true,
          arrivedBy: null,
        },
      }),
      /not by itself an answer/,
    );
  });

  it('leaves a caller that names no step with exactly the prompt it had', () => {
    assert.equal(
      chatPromptFor(checkNode(), { entryId: graph().entry, mandate }),
      chatPromptFor(checkNode(), { entryId: graph().entry, mandate, step: undefined }),
    );
    assert.doesNotMatch(
      chatPromptFor(checkNode(), { entryId: graph().entry, mandate }),
      /DSpatch loop run/,
    );
  });

  it('tells the entry step who it is without telling it twice what it is for', () => {
    const work = graph().nodes.find((each) => each.id === 'work');
    assert.ok(work);
    const prompt = chatPromptFor(work, {
      entryId: graph().entry,
      mandate,
      step: {
        runId: 'run-7',
        occurrence: 1,
        callId: 1,
        freshSession: true,
        attachments: { receivedResults: false, requiredResult: true },
      },
    });
    assert.match(prompt, /You are step "work" \(Do what was asked\) of DSpatch loop run run-7/);
    assert.equal(
      (prompt.match(/Mandate:/g) ?? []).length,
      1,
      'the entry step says the mandate once, as it always did',
    );
    assert.match(prompt, /At the end of this message you will find what you must leave behind\./);
  });

  /**
   * DSP-91 #5. The promise is made by the caller that is going to keep it.
   *
   * This preamble used to announce a closing section whenever the node produced anything
   * at all, while the section is only written for a `markdown-file` the step files itself.
   * On 21 September both messages of the run promised one and neither carried one, and the
   * implementer spent part of its reply asking for "a report path (named in the
   * assignment)". So the announcement is now driven by two booleans the executor sets from
   * the strings it has actually built, and a caller that says nothing promises nothing.
   */
  it('promises a closing section only when the caller says it is appending one', () => {
    const step = { runId: 'run-7', occurrence: 1, callId: 2, freshSession: true } as const;
    assert.doesNotMatch(
      chatPromptFor(checkNode(), { entryId: graph().entry, mandate, step }),
      /At the end of this message/,
    );
    assert.match(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: { ...step, attachments: { receivedResults: true, requiredResult: true } },
      }),
      /At the end of this message you will find what an earlier step left for you, and what you must leave behind\./,
    );
    assert.doesNotMatch(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: { ...step, attachments: { receivedResults: false, requiredResult: false } },
      }),
      /At the end of this message/,
    );
  });

  /** The third section announces itself the same way, and three of them still read as English. */
  it('announces the run\u2019s account of itself only when it is being appended', () => {
    const step = { runId: 'run-7', occurrence: 1, callId: 2, freshSession: true } as const;
    assert.match(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: { ...step, attachments: { receivedResults: false, requiredResult: false, runChange: true } },
      }),
      /At the end of this message you will find what this run has changed in the working folders so far\./,
    );
    assert.match(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: { ...step, attachments: { receivedResults: true, requiredResult: true, runChange: true } },
      }),
      /find what an earlier step left for you, what this run has changed in the working folders so far, and what you must leave behind\./,
    );
    assert.doesNotMatch(
      chatPromptFor(checkNode(), {
        entryId: graph().entry,
        mandate,
        step: { ...step, attachments: { receivedResults: true, requiredResult: false, runChange: false } },
      }),
      /what this run has changed/,
    );
  });
});

/**
 * What the run itself changed, told to the step that has to judge what was delivered
 * (DSP-99).
 *
 * The failure this is against is on the record. In run
 * `chat-loop-2026-09-22T19-50-58-359Z` the reviewer read `git status`, found
 * `BUGS_INVENTORY.md` and `PERSON_NAMES_INVENTORY.md`, and reported them as the
 * implementer's delivery. They were uncommitted leftovers of the runs on 20 and 21
 * September against the same folder, already in the baseline snapshot. Nothing in the
 * reviewer's reasoning was dishonest — DSpatch had computed `Changed: none` for every
 * step of that run and put it only in the journal, which is in nobody's prompt.
 *
 * So three properties are worth pinning, and they are properties of text: that the three
 * states read as three different things, that **"not measured" never reads as
 * "nothing"**, and that the account is offered as evidence rather than as a verdict the
 * step has to accept.
 */
describe('the run\u2019s own account of what it changed', () => {
  const measured = (paths: readonly string[]): string =>
    describeRunChange({
      kind: 'measured',
      snapshotBefore: 'snap-ea80d1b819248a05',
      snapshotAfter: paths.length === 0 ? 'snap-ea80d1b819248a05' : 'snap-7c31aa0e5f9b2d64',
      observedFromUtc: '2026-09-22T19:50:58.359Z',
      observedToUtc: '2026-09-22T19:52:49.120Z',
      paths,
    });

  it('tells a run that changed nothing that it changed nothing, and says what follows from it', () => {
    const text = measured([]);

    assert.match(text, /What changed in this run\u2019s working folders between two moments DSpatch observed them/);
    assert.match(text, /: nothing\. No file in them differs between the two\./);
    // The sentence that would have saved the run: what is in the folders and not in this
    // account is somebody else's, not this run's delivery.
    assert.match(
      text,
      /anything you find changed or uncommitted in those folders was already like that before the first of those moments, and is not this run\u2019s delivery/,
    );
    assert.match(text, /snap-ea80d1b819248a05/, 'the snapshots the journal names are named here too');
    assert.notEqual(text.trim(), '', 'a run that changed nothing still has an account (DSP-99 #4)');
  });

  it('names the files where there are files, and counts the ones it does not name', () => {
    const three = measured(['src/duration.ts', 'test/duration.test.ts', 'README.md']);
    assert.match(three, /: 3 files differ\./);
    assert.match(three, /What differs: src\/duration\.ts, test\/duration\.test\.ts, README\.md\./);
    assert.doesNotMatch(three, /more this account does not list/);

    const many = measured(
      Array.from({ length: MAX_NAMED_RUN_PATHS + 4 }, (_, index) => `src/file-${String(index)}.ts`),
    );
    assert.match(many, new RegExp(`${String(MAX_NAMED_RUN_PATHS + 4)} files differ`));
    assert.match(many, /and 4 more this account does not list\./);
    assert.equal(
      many.includes(`src/file-${String(MAX_NAMED_RUN_PATHS + 3)}.ts`),
      false,
      'the bound is a bound, and the remainder is counted rather than dropped silently',
    );

    const one = measured(['src/only.ts']);
    assert.match(one, /: 1 file differs\./, 'one file is not "1 files differ"');
  });

  /**
   * The correction Niclas made while this was being built. The heading used to read *what
   * this run has changed*, which the standing note then contradicted by saying a build, an
   * editor saving or the person in another window is in the measurement too. A difference
   * between two observations does not establish who made it — and he edits these projects
   * himself while runs are in flight, so it is a live case.
   *
   * The negative claim survives the correction and is checked here for that reason: a file
   * that did not change cannot have been changed by anybody, this run included.
   */
  it('states a difference between two observations rather than attributing it to the run', () => {
    const changed = measured(['src/duration.ts']);

    assert.doesNotMatch(
      changed,
      /What this run has changed/,
      'the heading must not attribute what only a measurement of the folders was taken',
    );
    assert.match(
      changed,
      /That the files differ is established; who changed them is not, and other work may have been going on in those folders between those two moments\./,
    );
    assert.match(
      changed,
      /A file in them that is not named here did not change between them, and so was not changed by this run either\./,
      'the negative claim is bounded by the measurement either way, so it stays',
    );
    // The nothing branch says the same thing under either reading, so it keeps its plain form.
    assert.match(measured([]), /: nothing\./);
  });

  /**
   * DSP-99's later criterion: the extent of the comparison *and its times*. A snapshot
   * identity says what was there; it does not say when anybody looked, and the second look
   * is not the run's end.
   */
  it('gives both moments it looked, and says which walk the second one is', () => {
    for (const text of [measured([]), measured(['src/duration.ts'])]) {
      assert.match(
        text,
        /DSpatch looked at those folders at 2026-09-22T19:50:58\.359Z \(snapshot snap-ea80d1b819248a05\) and again at 2026-09-22T19:52:49\.120Z \(snapshot snap-[0-9a-f]+\)\./,
      );
      assert.match(
        text,
        /The second look was taken after the most recently finished step of this run, not at the run\u2019s end\./,
      );
      assert.doesNotMatch(text, /since the run started/, 'a vague window is what the times replace');
    }
  });

  /**
   * The state this card is most afraid of. A dry run, a step before any two snapshots
   * exist, and a drawing where nothing could write and the hashing was skipped are all
   * *unknown* — and an unhashed run produces three empty file lists, which is exactly
   * what "nothing changed" looks like from the inside.
   */
  it('says an unmeasured run is unmeasured, and never lets it read as an unchanged one', () => {
    const text = describeRunChange({
      kind: 'not-measured',
      why: 'DSpatch took no before-and-after snapshot of the working root.',
    });

    assert.match(text, /is not established, and that is not the same as nothing/);
    assert.match(text, /a run that changed a hundred files and a run that changed none look identical/);
    assert.match(text, /DSpatch took no before-and-after snapshot of the working root\./);
    // None of the three measured claims may appear: each of them would be a statement
    // about the folders that nothing measured.
    assert.doesNotMatch(text, /: nothing\./);
    assert.doesNotMatch(text, /No file in them has been changed/);
    assert.doesNotMatch(text, /was not changed by this run/);
    assert.doesNotMatch(text, /Snapshot /);
  });

  it('offers the account as evidence, in every state, and not as a verdict', () => {
    const states = [
      measured([]),
      measured(['src/duration.ts']),
      describeRunChange({ kind: 'not-measured', why: 'Nothing was hashed.' }),
    ];
    for (const text of states) {
      for (const line of RUN_CHANGE_NOTE) {
        assert.ok(text.includes(line), `every state carries the standing note: ${text.slice(0, 120)}`);
      }
      // It says what it is not: a judgement, a complete picture, or a limit on reading.
      assert.match(text, /not a limit on what you may read/);
      assert.match(text, /never whether the work was right/);
      // And an empty measurement is not a reproach. A correct run can change nothing —
      // which is the premise of the run this card comes from — so the section must not
      // give a reviewer looking for fault a DSpatch-voiced hook to hang it on.
      assert.match(
        text,
        /Unchanged content is not evidence that nothing was read or that the task was not done\./,
      );
      assert.match(text, /A run can be correct and change nothing at all/);
      assert.match(text, /covers this run\u2019s own working folders and nothing outside them/);
      // Concurrent writers, named in every state: the extent of what the comparison can
      // establish is part of the account rather than an afterthought in one branch.
      assert.match(text, /anything else that wrote there between those two moments/);
      // And a disagreement between the account and the working copy is a finding, not
      // something for the step to resolve quietly — that disagreement is what would
      // have caught the run this card comes from.
      assert.match(text, /Where what you read disagrees with this account, in either direction, say so/);
      // The section separates itself from the task, the way the other appended ones do.
      assert.ok(text.startsWith('\n\n---\n\n'), 'it is a trailing section, marked as one');
    }
  });

  /**
   * Which steps get it, decided from the drawing rather than from a node's name.
   *
   * `consumes` is the graph's own statement that a step has been handed an earlier step's
   * account of its own work, which is the step that has to relate that account to the
   * folders. So the reviewer and the verifier of the runnable loop are told, the chat
   * loop's checking step is told, and an entry step — handed nobody's work, and asked to
   * do the work — is not.
   */
  it('gives the account to a step that is handed somebody\u2019s work, and to no other', () => {
    const runnableLoop = loadGraph('docs/loop/graphs/dspatch-development-loop-runnable.graph.json');
    const told = runnableLoop.nodes.filter((node) => carriesRunChange(node)).map((node) => node.id);
    assert.deepEqual(
      told,
      ['implementer', 'researcher', 'verifier', 'implementation-review', 'coordinator-report'],
      'every step the drawing hands an earlier result to, and nothing else',
    );
    for (const id of ['verifier', 'implementation-review']) {
      const node = runnableLoop.nodes.find((candidate) => candidate.id === id);
      assert.ok(node);
      assert.equal(carriesRunChange(node), true, `${id} judges delivered work`);
    }
    const coordinator = runnableLoop.nodes.find((node) => node.id === 'coordinator');
    assert.ok(coordinator);
    assert.equal(
      carriesRunChange(coordinator),
      false,
      'the entry step is being told what the run is for, before it has changed anything',
    );
    for (const terminal of runnableLoop.nodes.filter((node) => node.kind === 'terminal')) {
      assert.equal(carriesRunChange(terminal), false, `${terminal.id} is not sent a message at all`);
    }

    const chat = loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
    const check = chat.nodes.find((node) => node.id === 'check');
    const work = chat.nodes.find((node) => node.id === 'work');
    assert.ok(check && work);
    assert.equal(carriesRunChange(check), true, 'the checking step is judging what work left');
    assert.equal(carriesRunChange(work), false);
  });
});

/**
 * Which text governs, said in the message rather than left to the agent (DSP-96 part 3).
 *
 * DSP-92's F8 and F9. Both texts already travelled together — the person's own mandate
 * and the earlier step's account of it — and the run record shows they did so before
 * DSP-91 as well. What neither the message nor any role said was which one wins, and
 * 029's W2 is what the agent deciding for itself looks like: *do not read the project*
 * arriving at the next step as *do not read the whole project*.
 *
 * **These tests establish that the instruction is sent, and nothing more than that.**
 * Whether a model then honours it is a separate question that no unit test can answer,
 * and the four DSP-91 walks are one model on one machine.
 */
describe('precedence is stated in the call, not left to the agent', () => {
  const graph = (): LoopGraph => loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json');
  const mandate = 'Add a timeout to the retry helper. Do not read the project.';

  function node(id: string): NonNullable<ReturnType<typeof graph>['nodes'][number]> {
    const found = graph().nodes.find((candidate) => candidate.id === id);
    assert.ok(found);
    return found;
  }

  /** The four things the wording has to carry, each as the agent would read it. */
  function assertAllFourParts(prompt: string, where: string): void {
    assert.match(prompt, /The person\u2019s own words for this run are the assignment/, where);
    assert.match(prompt, /does not replace them/, where);
    assert.match(prompt, /A later message from the same person is later on purpose/, where);
    assert.match(prompt, /leaves the rest of it standing/, where);
    assert.match(prompt, /the limit governs and the routine is not performed on this step/, where);
    assert.match(prompt, /widens what you may actually do/, where);
  }

  it('reaches the entry step, a fresh later step and a revisit alike', () => {
    assertAllFourParts(
      chatPromptFor(node('work'), { entryId: graph().entry, mandate }),
      'the entry step, where the role\u2019s routines meet the person\u2019s limits',
    );
    assertAllFourParts(
      chatPromptFor(node('check'), {
        entryId: graph().entry,
        mandate,
        step: { runId: 'run-3', occurrence: 1, callId: 2, freshSession: true },
      }),
      'a fresh later step, which receives both the mandate and an account of it',
    );
    // A revisit is the round this whole paragraph was written for: it is where an
    // earlier step's account of the assignment arrives. DSP-79 sent the ranking there
    // without one of the two texts it ranks, which is not a ranking anyone can make;
    // DSP-100 sends both.
    const revisit = chatPromptFor(node('check'), {
      entryId: graph().entry,
      mandate,
      step: { runId: 'run-3', occurrence: 2, callId: 5, freshSession: false },
    });
    assert.match(revisit, /Mandate:/, 're-sent, reversing DSP-79');
    assert.match(revisit, /Do not read the project\./, 'including the limit the person set');
    assertAllFourParts(revisit, 'a revisit');
  });

  /**
   * The composition `main.ts` actually performs: `instructionPreamble(...) + prompt`.
   *
   * A message typed mid-run is the case where all three texts are in one call — the
   * person's later words, the person's original mandate, and the role — so it is the one
   * worth assembling rather than asserting a part of.
   */
  it('ranks a mid-run message against the mandate without replacing it', () => {
    const assembled =
      instructionPreamble(['Actually, use the existing helper. Everything else stands.']) +
      chatPromptFor(node('check'), {
        entryId: graph().entry,
        mandate,
        step: { runId: 'run-3', occurrence: 1, callId: 2, freshSession: true },
      });

    // The person's words, whole and attributed, as DSP-32 left them.
    assert.match(assembled, /Actually, use the existing helper\./);
    assert.ok(assembled.includes(INSTRUCTION_BLOCK_OPEN));
    // Later, so it governs — and only over the part it concerns.
    assert.match(assembled, /where it contradicts something you have been given, it governs/);
    assert.match(assembled, /governs only the part it actually concerns/);
    assert.match(assembled, /the limits it does not touch, stand as they were/);
    assert.match(assembled, /It does not widen what you are permitted to reach/);
    // And the original is still in the same message, so there is something to rank
    // against. This is the fact the DSP-92 correction turned on.
    assert.match(assembled, /Do not read the project\./);
    assert.ok(
      assembled.indexOf('Actually, use the existing helper') < assembled.indexOf('Mandate:'),
      'the correction is read before the task it corrects',
    );
  });

  /**
   * Two messages read as two corrections, not as one replacement assignment. The plural
   * wording is a separate string and was wrong to leave untested once it carried a rule.
   */
  it('says the same of several messages', () => {
    const two = instructionPreamble(['Use the existing helper.', 'And keep the old name.']);
    assert.match(two, /they govern/);
    assert.match(two, /govern only the parts they actually concern/);
    assert.match(two, /They do not widen what you are permitted to reach/);
  });

  /**
   * The case Niclas found, which the first wording of this got wrong.
   *
   * *"Läs inte projektet."* is a limit the assignment states. *"Du får läsa README för
   * att kontrollera detta."* is the same person, later, changing that very limit. The
   * text as first shipped said a later message "leaves every limit the assignment states
   * standing", and read together with the sentence ranking the person's own words that
   * locks README shut — the one thing the correction exists to open.
   *
   * **What this test checks is the contract that is sent.** It reads the assembled
   * message and asserts what the message tells the step about corrections and limits. It
   * does not run a model, it does not observe a file being read, and it establishes
   * nothing whatever about whether an agent then reads README or leaves the rest of the
   * project alone. That question is behavioural and no unit test can answer it.
   *
   * Both writers of the rule are in one assembled string here on purpose. They reach the
   * agent in the same message, and they were saying different things until this card.
   */
  it('tells the step a correction changes the limit it names and leaves the others', () => {
    const limited = 'L\u00e4s inte projektet. Fix the retry helper.';
    const assembled =
      instructionPreamble([
        'Du f\u00e5r l\u00e4sa README f\u00f6r att kontrollera detta.',
      ]) +
      chatPromptFor(node('check'), {
        entryId: graph().entry,
        mandate: limited,
        step: { runId: 'run-4', occurrence: 1, callId: 2, freshSession: true },
      });

    // Both texts are in the one message, so there is something to rank.
    assert.match(assembled, /L\u00e4s inte projektet\./);
    assert.match(assembled, /Du f\u00e5r l\u00e4sa README f\u00f6r att kontrollera detta\./);

    // The message's own side: a correction may be about a limit, and then it is the limit.
    assert.match(
      assembled,
      /Where it does change a limit the assignment stated, the later wording is the limit, for exactly what it names and no further\./,
    );
    // The assignment's side says the same, and says which limits survive.
    assert.match(
      assembled,
      /the person can loosen, tighten or withdraw a limit their own earlier wording set/,
    );
    assert.match(assembled, /The other limits, the ones it does not touch, stand as they were\./);

    // The sentence that caused the defect is gone from both. A limit set by the person is
    // no longer described as surviving a message from the same person about that limit.
    assert.doesNotMatch(assembled, /every limit the assignment states, stand as they were/);
    assert.doesNotMatch(assembled, /every limit the assignment states, stand as it was/);

    // And the correction still buys nothing beyond what it names: reach and the run's
    // bounds are not a limit the person's later message can move.
    assert.match(assembled, /It does not widen what you are permitted to reach or the bounds/);
    assert.match(
      assembled,
      /a later message from the person included \u2014 widens what you may actually do/,
    );
  });

  /**
   * The two texts reach the same agent in the same message, so a later edit to one of
   * them and not the other is the defect this card fixed, arriving again.
   */
  it('has both writers of the rule saying a correction can change a limit', () => {
    const fromTheMessage = instructionPreamble(['Du f\u00e5r l\u00e4sa README.']);
    const fromTheAssignment = TASK_PRECEDENCE.join('\n');
    for (const [text, where] of [
      [fromTheMessage, 'instructionPreamble'],
      [fromTheAssignment, 'TASK_PRECEDENCE'],
    ] as const) {
      assert.match(text, /limit/, where);
      assert.doesNotMatch(text, /every limit the assignment states, stand as/, where);
    }
    assert.match(fromTheMessage, /the limits it does not touch, stand as they were/);
    assert.match(fromTheAssignment, /The other limits, the ones it does not touch/);
  });

  /** A run with no interjection is unchanged, which is what makes the rest safe. */
  it('says nothing at all when nobody sent anything', () => {
    assert.equal(instructionPreamble([]), '');
    assert.equal(instructionPreamble(['   ']), '');
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

  it('names the result a step left, so the conversation mentions it at all', () => {
    const lookup = lookupFromGraph(loadGraph('docs/loop/graphs/dspatch-chat-loop.graph.json'));
    assert.equal(
      formatChatLiveLogLine(
        entry('result-filed', { nodeId: 'work', data: { archiveRef: 'reports/run-1/001-work.md' } }),
        lookup,
      ),
      'Left its result: reports/run-1/001-work.md.',
    );
    // The line at the head of a dry run says results exist and none were filed. It
    // carries no reference, and a conversation is not the place to explain it.
    assert.equal(formatChatLiveLogLine(entry('result-filed', { data: { dryRun: true } }), lookup), null);
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
