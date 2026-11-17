import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CopilotSdkAdapter } from '../src/adapter/copilot-sdk-adapter.ts';
import { createFileRoleResolver } from '../src/main/loop-graph-roles.ts';
import { runLiveGraph } from '../src/main/loop-live-run.ts';
import { loopRunAgentInfo, prepareLoopRun, type LoopRunAgentRequest } from '../src/main/loop-run-agent.ts';
import { copilotPolicyFor } from '../src/main/provider-adapters.ts';
import { writeReachOf } from '../src/shared/loop-graph.ts';
import { checkLoopGraph, checkRunRequirements, loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { modelSelectionFromData, type RunJournalEntry } from '../src/shared/loop-run.ts';
import { tempRoot } from './support/fixtures.ts';
import { startStandInModel, type StandInModel } from './support/copilot-stand-in-model.ts';

/*
 * DSP-218: a cursor-labelled drawing run through Copilot. The real Copilot SDK and runtime,
 * with a local stand-in model (as in copilot-runtime.test.ts): no account, no network and no
 * model, so this shows which adapter, model, requirement answers and workspace decision the
 * run uses, not what a real Copilot account does.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const CHAT_LOOP = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-loop-home-'));

function runtimeEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, COPILOT_HOME: home };
  for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    delete env[name];
  }
  return env;
}

let model: StandInModel;

before(async () => {
  model = await startStandInModel();
});

after(async () => {
  await model.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe('DSP-218: a cursor-labelled loop run through Copilot', () => {
  it('uses the Copilot adapter, the chat\'s model, Copilot\'s requirement answers and workspace decision', async () => {
    const resolveRole = createFileRoleResolver(repoRoot);
    const loaded = loadLoopGraph(fs.readFileSync(CHAT_LOOP, 'utf8'), { resolveRole });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return;
    }
    // The bundled chat loop, drawn for cursor, with two requirements on its check step so
    // there is something for the run's agent to answer.
    const graph = {
      ...loaded.graph,
      nodes: loaded.graph.nodes.map((node) =>
        node.id === 'check' ? { ...node, requirements: ['no-subagent-delegation' as const, 'background-execution' as const] } : node,
      ),
    };
    assert.equal(graph.target, 'cursor', 'the bundled chat loop is drawn for cursor');

    const built: string[] = [];
    const request: LoopRunAgentRequest = {
      // The chat's choice: a Copilot session with Claude Opus 5.5.
      sessionProvider: 'copilot',
      chosenAgent: 'cursor',
      rootCount: 1,
      entryNode: graph.nodes.find((node) => node.id === graph.entry),
      graph,
      cursorModel: 'composer-2',
      claudeModel: '',
      copilotModel: 'claude-opus-5.5',
      copilotModels: null,
      adapters: {
        preflight: () => null,
        createAdapter: (asked) => {
          built.push(`${asked.provider}/${asked.purpose}`);
          return new CopilotSdkAdapter({
            policy: copilotPolicyFor(asked.purpose),
            env: runtimeEnv(),
            testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' },
          });
        },
      },
    };

    const prepared = prepareLoopRun(request);
    assert.equal(prepared.ok, true, prepared.ok ? '' : prepared.reason);
    if (!prepared.ok) {
      return;
    }
    assert.equal(prepared.provider, 'copilot');
    assert.equal(prepared.personModel, 'claude-opus-5.5');
    assert.equal(loopRunAgentInfo(request).summary, 'Copilot · claude-opus-5.5');

    // Requirements are answered by Copilot, in the run check and in the editor's check alike.
    const runFindings = checkRunRequirements(graph, 'copilot', resolveRole);
    assert.equal(runFindings.some((finding) => finding.severity === 'error'), false);
    const editorFindings = checkLoopGraph(graph, { resolveRole, runProvider: 'copilot' });
    const requirementText = editorFindings.filter((finding) => finding.code.startsWith('requirement-')).map((finding) => finding.message);
    assert.ok(requirementText.length > 0, 'the chat loop\'s steps have requirements to answer');
    // Copilot enforces no-subagent-delegation (its tool list has no `task`), so that one says
    // nothing; background-execution is achieved by other means, in Copilot's own words.
    assert.equal(requirementText.length, 1, requirementText.join('\n'));
    assert.match(requirementText[0] ?? '', /Instruction only: .*background-execution .*Copilot, which runs this loop, does not enforce it, so the agent is told and trusted to follow it: DSpatch answers Copilot’s permission requests/);
    assert.doesNotMatch(requirementText[0] ?? '', /Cursor|cursor/);
    const reach = writeReachOf(graph, resolveRole, 'copilot');
    assert.equal(reach.mayWrite, true, 'Copilot\'s tools can write, so the working folder is measured');

    const entries: RunJournalEntry[] = [];
    // The walk: two steps, each answered by the stand-in model behind the real runtime.
    model.script({ text: 'RESULT: succeeded' }, { text: 'RESULT: succeeded' });
    const workspace = tempRoot('loop-copilot-run');
    fs.writeFileSync(path.join(workspace, 'README.md'), '# a project\n', 'utf8');
    const delivery = await runLiveGraph(graph, {
      runId: 'run-copilot-cursor-label',
      repoRoot,
      outDir: null,
      resultsDir: path.join(tempRoot('loop-copilot-run-results'), 'results'),
      modelRequested: prepared.modelRequested,
      personModel: prepared.personModel,
      workspacePath: workspace,
      keepWorkspace: true,
      bindingKind: 'chat-loop',
      provider: prepared.provider,
      createAdapter: prepared.createAdapter,
      onJournalEntry: (entry) => entries.push(entry),
    });

    assert.equal(delivery.result.status, 'completed', delivery.journalText);
    assert.deepEqual(built, ['copilot/loop'], 'one Copilot adapter, for a loop, and no Cursor');
    assert.equal(delivery.inspection.provider, 'copilot');
    assert.ok(delivery.inspection.sessions.every((session) => session.provider === 'copilot'));
    assert.ok(model.requests.length >= 2);
    for (const sent of model.requests) {
      assert.equal(sent.model, 'claude-opus-5.5', 'the runtime asked for the chat\'s model');
    }
    // The journal's own account of each agent step's model and provider, which is what the
    // loop view reads for the step that is running.
    const models = entries
      .filter((entry) => entry.kind === 'node-entered')
      .map((entry) => modelSelectionFromData(entry.data))
      .filter((chosen) => chosen !== null);
    assert.ok(models.length >= 2);
    for (const chosen of models) {
      assert.equal(chosen?.provider, 'copilot');
      assert.equal(chosen?.model, 'claude-opus-5.5');
      assert.equal(chosen?.source, 'person');
    }
  });
});
