import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import type { AgentEvent, AgentEventListener } from '../src/adapter/types.ts';
import type { ChatAdapter } from '../src/main/chat-service.ts';
import { createFileRoleResolver, resolveRoleText } from '../src/main/loop-graph-roles.ts';
import { runLiveGraph } from '../src/main/loop-live-run.ts';
import { prepareLoopRun, type LoopRunAgentRequest } from '../src/main/loop-run-agent.ts';
import { parseRoleSource } from '../src/main/role-source.ts';
import { RUN_PROVIDER_CAPABILITIES, type LoopGraph, type RunProvider, type RunProviderCapabilities } from '../src/shared/loop-graph.ts';
import { checkLoopGraph, checkRunRequirements, loadLoopGraph } from '../src/shared/loop-graph-load.ts';
import { requirementStanding } from '../src/shared/loop-node-help.ts';
import type { RunJournalEntry } from '../src/shared/loop-run.ts';
import { chatPromptFor, skippingRoutesOf } from '../src/shared/loop-chat.ts';
import { tempRoot } from './support/fixtures.ts';

/*
 * DSP-219: DSpatch's own loops are provider-agnostic. The same drawing, with its target
 * unchanged, runs with Cursor, Claude or Copilot (simulated adapters here: no provider is
 * called), each step told the role's common instructions; requirements are answered by the
 * agent that runs it; the target is an export format only.
 */

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const GRAPHS = path.join(repoRoot, 'docs', 'loop', 'graphs');
const resolveRole = createFileRoleResolver(repoRoot);
const PROVIDERS: readonly RunProvider[] = ['cursor', 'claude', 'copilot'];

function graphNamed(file: string): LoopGraph {
  const loaded = loadLoopGraph(fs.readFileSync(path.join(GRAPHS, file), 'utf8'), { resolveRole });
  assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.findings.map((finding) => finding.message).join('\n'));
  if (!loaded.ok) {
    throw new Error('unreachable');
  }
  return loaded.graph;
}

/** An agent that answers each turn from a script and keeps every prompt it was sent. */
class ScriptedAgent {
  readonly prompts: string[] = [];
  private readonly listeners = new Map<string, AgentEventListener>();
  private readonly provider: RunProvider;
  private readonly answers: readonly string[];
  constructor(provider: RunProvider, answers: readonly string[]) {
    this.provider = provider;
    this.answers = answers;
  }
  startSession(config: { dspatchSessionId?: string }) {
    return Promise.resolve({
      dspatchSessionId: config.dspatchSessionId ?? 's',
      provider: this.provider,
      providerSessionId: `${this.provider}-${config.dspatchSessionId ?? 's'}`,
      createdAt: new Date().toISOString(),
    });
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  send(sessionId: string, prompt: string) {
    const index = this.prompts.length;
    this.prompts.push(prompt);
    const runId = `run-${String(index)}`;
    const emit = (event: Partial<AgentEvent>): void => {
      this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
    };
    setImmediate(() => {
      emit({ type: 'run.started' });
      emit({ type: 'assistant.message', text: this.answers[index] ?? 'RESULT: succeeded' } as Partial<AgentEvent>);
      emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
    });
    return Promise.resolve({ dspatchRunId: runId });
  }
  cancel() {
    return Promise.resolve();
  }
  readUsage() {
    return Promise.resolve([]);
  }
  dispose() {
    return Promise.resolve();
  }
}

describe('DSP-219: one loop, three providers, the target unchanged', () => {
  for (const provider of PROVIDERS) {
    it(`the bundled chat loop (drawn for cursor) runs with ${provider}, told the roles' common instructions`, async () => {
      const graph = graphNamed('dspatch-chat-loop.graph.json');
      assert.equal(graph.target, 'cursor');
      assert.equal(checkRunRequirements(graph, provider, resolveRole).some((finding) => finding.severity === 'error'), false);

      const agent = new ScriptedAgent(provider, ['Done.\n\nRESULT: succeeded', 'Checked.\n\nRESULT: met']);
      const built: string[] = [];
      const request: LoopRunAgentRequest = {
        sessionProvider: provider,
        chosenAgent: null,
        rootCount: 1,
        entryNode: graph.nodes.find((node) => node.id === graph.entry),
        graph,
        cursorModel: 'composer-2',
        claudeModel: 'claude-haiku-4-5',
        claudeModels: ['claude-haiku-4-5'],
        copilotModel: 'claude-opus-5.5',
        copilotModels: null,
        adapters: {
          preflight: () => null,
          createAdapter: (asked) => {
            built.push(asked.provider);
            return agent as unknown as ChatAdapter;
          },
        },
      };
      const prepared = prepareLoopRun(request);
      assert.equal(prepared.ok, true, prepared.ok ? '' : prepared.reason);
      if (!prepared.ok) {
        return;
      }
      const entries: RunJournalEntry[] = [];
      const workspace = tempRoot(`agnostic-${provider}`);
      fs.writeFileSync(path.join(workspace, 'README.md'), '# a project\n', 'utf8');
      const delivery = await runLiveGraph(graph, {
        runId: `agnostic-${provider}`,
        repoRoot,
        outDir: null,
        resultsDir: path.join(tempRoot(`agnostic-${provider}-results`), 'results'),
        modelRequested: prepared.modelRequested,
        personModel: prepared.personModel,
        workspacePath: workspace,
        keepWorkspace: true,
        bindingKind: 'chat-loop',
        provider: prepared.provider,
        createAdapter: prepared.createAdapter,
        onJournalEntry: (entry) => entries.push(entry),
        // The brief the chat's *Use loop* gives each step, with its role's text (as the host).
        promptFor: (node, step) =>
          chatPromptFor(node, {
            entryId: graph.entry,
            mandate: 'Fix the failing test.',
            step,
            role: (() => {
              const resolved = node.role === undefined ? null : resolveRole(node.role);
              return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null };
            })(),
            skipping: skippingRoutesOf(graph, node.id),
          }),
      });

      assert.equal(delivery.result.status, 'completed', delivery.journalText);
      assert.deepEqual(built, [provider]);
      assert.ok(delivery.inspection.sessions.every((session) => session.provider === provider));
      // Each step is told its role's common instructions, whatever the provider.
      const work = resolveRole({ id: 'implementer', version: 1, source: { kind: 'role-catalog', path: 'docs/loop/roles/catalog/implementer/v1.role.md' } });
      const firstLine = (work?.instructions ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
      assert.ok(firstLine.length > 20);
      assert.ok(agent.prompts[0]?.includes(firstLine), 'the work step was told the role’s own words');
      // The run-started record names the agent and keeps the drawing's target as it was.
      const started = entries.find((entry) => entry.kind === 'run-started');
      assert.equal(started?.data?.['agent'], provider);
      assert.equal(started?.data?.['target'], 'cursor');
    });
  }

  it('every bundled runnable loop checks out with each of the three, with no error', () => {
    for (const file of ['dspatch-chat-loop.graph.json', 'dspatch-parallel-loop.graph.json', 'dspatch-mission-loop.graph.json', 'dspatch-walk-loop.graph.json', 'dspatch-development-loop-runnable.graph.json', 'generic-agent-network.graph.json']) {
      const graph = graphNamed(file);
      for (const provider of PROVIDERS) {
        const errors = checkLoopGraph(graph, { resolveRole, runProvider: provider }).filter((finding) => finding.severity === 'error');
        assert.deepEqual(errors, [], `${file} with ${provider}`);
      }
    }
  });
});

describe('DSP-219: requirements answered by the agent, in four kinds', () => {
  const oneStep = (requirements: LoopGraph['nodes'][number]['requirements']): LoopGraph => {
    const graph = graphNamed('dspatch-chat-loop.graph.json');
    return { ...graph, nodes: graph.nodes.map((node) => (node.id === 'work' ? { ...node, requirements } : node)) };
  };

  it('an unsupported requirement refuses, naming the step, the requirement and the limit', () => {
    const table: RunProviderCapabilities = {
      ...RUN_PROVIDER_CAPABILITIES,
      claude: { ...RUN_PROVIDER_CAPABILITIES.claude, 'tool-restriction': { status: 'unmet', how: 'No tool list can be passed on this path.', evidence: 'documentation' } },
    };
    const findings = checkRunRequirements(oneStep(['tool-restriction']), 'claude', resolveRole, table);
    const error = findings.find((finding) => finding.severity === 'error');
    assert.ok(error);
    assert.equal(error?.nodeId, 'work');
    assert.match(error?.message ?? '', /^Not supported: node "work" requires tool-restriction \(from this node\) and Claude, which runs this loop, cannot meet it: No tool list can be passed on this path\./);
  });

  it('a requirement nobody has established for Cursor is said as such, and Copilot enforces it', () => {
    const graph = oneStep(['tool-restriction']);
    const cursor = checkRunRequirements(graph, 'cursor', resolveRole).filter((finding) => finding.message.includes('tool-restriction'));
    assert.equal(cursor.length, 1);
    assert.equal(cursor[0]?.severity, 'warning');
    assert.match(cursor[0]?.message ?? '', /^Not established: .*Cursor, which runs this loop/);
    assert.equal(checkRunRequirements(graph, 'copilot', resolveRole).some((finding) => finding.message.includes('tool-restriction')), false);
  });

  it('a requirement held only by instruction is said to be one, never as enforced', () => {
    const graph = oneStep(['no-file-writes']);
    for (const provider of PROVIDERS) {
      const said = checkRunRequirements(graph, provider, resolveRole).find((finding) => finding.message.includes('no-file-writes'));
      assert.equal(said?.severity, 'notice', provider);
      assert.match(said?.message ?? '', /^Instruction only: .*does not enforce it, so the agent is told and trusted to follow it/);
      const standing = requirementStanding('no-file-writes', { kind: 'agent', requirements: ['no-file-writes'] }, null, provider);
      assert.equal(standing.enforcement, 'other-means');
      assert.doesNotMatch(standing.howItHolds, /enforces this itself/);
    }
  });

  it("DSpatch's own fan-out is not the agent delegating: no-subagent-delegation never stops it, and Cursor's one-at-a-time is said", () => {
    const graph = graphNamed('dspatch-parallel-loop.graph.json');
    const fanOut = graph.nodes.find((node) => node.fanOut !== undefined);
    assert.ok(fanOut);
    const strict = { ...graph, nodes: graph.nodes.map((node) => (node === fanOut ? { ...node, requirements: ['no-subagent-delegation' as const] } : node)) };
    for (const provider of PROVIDERS) {
      const findings = checkLoopGraph(strict, { resolveRole, runProvider: provider });
      assert.equal(findings.some((finding) => finding.severity === 'error'), false, provider);
      const limited = findings.find((finding) => finding.code === 'fan-out-limited-by-agent');
      if (provider === 'cursor') {
        assert.match(limited?.message ?? '', /Cursor, which runs this loop, runs at most 1 at a time in DSpatch, so its branches run one after another/);
      } else {
        assert.equal(limited, undefined, provider);
      }
    }
  });
});

describe('DSP-219: older definitions and the export format', () => {
  it('a loop drawn for claude-code with Cursor-file roles, refused before, loads and checks out', () => {
    const text = fs.readFileSync(path.join(GRAPHS, 'dspatch-development-loop-runnable.graph.json'), 'utf8');
    const drawn = JSON.stringify({ ...JSON.parse(text), target: 'claude-code' });
    const loaded = loadLoopGraph(drawn, { resolveRole, runProvider: 'copilot' });
    assert.equal(loaded.ok, true, loaded.ok ? '' : loaded.findings.map((finding) => finding.message).join('\n'));
    assert.equal(loaded.ok && loaded.graph.target, 'claude-code', 'the target is kept as it was');
  });

  it('a role whose export form is wrong is still read for a run, and generation still refuses it', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'docs/loop/roles/project/project-work.role.md'), 'utf8');
    // A block for a framework the role does not declare: wrong for export, harmless for a run.
    const broken = source.replace('## Purpose', '<!-- target: copilot -->\nCopilot-only text\n<!-- end target -->\n\n## Purpose');
    const strict = parseRoleSource(broken);
    assert.equal(strict.ok, false, 'generating agent files refuses it, as before');
    assert.ok(!strict.ok && strict.problems.every((problem) => problem.exportOnly === true));
    const role = resolveRoleText(broken, { id: 'project-work', source: { kind: 'role-source', path: 'docs/loop/roles/project/project-work.role.md' } }, 'project-work.role.md');
    assert.ok(role?.instructions?.includes('Do what the person asked'));
    assert.doesNotMatch(role?.instructions ?? '', /Copilot-only text/, 'a target block is never told to a run');
    assert.equal(role?.exportProblems?.length, 1);

    const graph = graphNamed('dspatch-chat-loop.graph.json');
    // The chat loop's work step uses the catalog Implementer since DSP-231; the broken local role stands in for it.
    const findings = checkLoopGraph(graph, { resolveRole: (reference) => (reference.id === 'implementer' ? role : resolveRole(reference)), runProvider: 'claude' });
    assert.equal(findings.some((finding) => finding.severity === 'error'), false);
    assert.match(findings.find((finding) => finding.code === 'role-export-form')?.message ?? '', /generating those files will refuse/);
  });

  it('a role source broken beyond its export form still resolves to nothing', () => {
    const role = resolveRoleText('---\nrole: x\n---\n\nno sections\n', { id: 'x', source: { kind: 'role-source', path: 'x.role.md' } }, 'x.role.md');
    assert.equal(role, null);
  });
});
