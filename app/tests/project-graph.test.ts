/**
 * DSP-229: applying a bundled graph to a repository, its project instructions, and what steps
 * and parallel branches are sent. A synthetic project (AGENTS.md, architecture and testing
 * documents, a document outside docs/) and a template made from the Workshop example, whose
 * "maker" step and "crew" fan-out share the role maker. Simulated adapters only.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

import type { AgentEvent, AgentEventListener } from '../src/adapter/types';
import type { ChatAdapter } from '../src/main/chat-service';
import { discoverLoopDefinitions, type LoopDefinitionRow } from '../src/main/loop-definition-files';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { runLiveGraph } from '../src/main/loop-live-run';
import { planProjectGraph, readProjectGraph, referenceProblems, saveProjectInstructions, sha256, writeProjectGraph } from '../src/main/project-graph';
import { PresentationAdapter } from '../src/main/presentation-adapter';
import { projectGraphMethods } from '../src/host/project-graph-methods';
import { chatPromptFor } from '../src/shared/loop-chat';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { parseLoopDefinition } from '../src/shared/loop-definition';
import {
  parseProjectInstructions,
  projectInstructionsText,
  stepProjectText,
  type ProjectInstructions,
} from '../src/shared/project-instructions';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FENCE = '```';
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const temp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A DSpatch folder holding one template: the Workshop example, as DSpatch would ship it. */
function templateFolder(): { readonly root: string; readonly row: LoopDefinitionRow } {
  const root = temp('dsp-template-');
  fs.cpSync(path.join(repoRoot, 'docs/loop/examples/workshop/.dspatch'), path.join(root, '.dspatch'), { recursive: true });
  const row = discoverLoopDefinitions([root]).rows.find((candidate) => candidate.definition?.id === 'workshop');
  assert.ok(row);
  return { root, row };
}

const AGENTS_SECRET = 'AGENTS-BODY-NEVER-INLINED';

/** The synthetic project, a git repository with one commit. */
function project(): string {
  const dir = path.join(temp('dsp-project-'), 'orders-kit');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Rules\n${AGENTS_SECRET}\n`);
  fs.writeFileSync(path.join(dir, 'docs/ARCHITECTURE.md'), '# Architecture\n');
  fs.writeFileSync(path.join(dir, 'docs/TESTING.md'), '# Testing\n');
  fs.writeFileSync(path.join(dir, 'tools/RELEASE.md'), '# Releasing\n');
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'a\n');
  git(dir, 'init', '--quiet', '--initial-branch=main');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'user.email', 'test@localhost');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '.');
  git(dir, 'commit', '--quiet', '-m', 'first');
  return dir;
}

const INSTRUCTIONS: ProjectInstructions = {
  format: 'dspatch-project-instructions',
  formatVersion: 1,
  common: { text: 'COMMON: follow the repository rules.', documents: [{ path: 'AGENTS.md', purpose: 'the project rules', when: 'before starting' }] },
  roles: { maker: { text: 'ROLE-MAKER: run npm test before you finish.', documents: [{ path: 'docs/TESTING.md', purpose: 'how tests are run', when: 'before finishing' }] } },
  nodes: {
    maker: { text: 'NODE-MAKER: change only src/.', documents: [{ path: 'docs/ARCHITECTURE.md', purpose: 'module boundaries', when: 'before changing structure' }] },
    crew: { text: 'NODE-CREW: keep to your slice.', documents: [] },
    scout: { text: 'NODE-SCOUT: write notes only.', documents: [{ path: 'tools/RELEASE.md', purpose: 'release rules', when: 'when a note concerns releases' }] },
  },
};

function apply(repository: string, template: LoopDefinitionRow, name = 'Orders workflow', instructions = INSTRUCTIONS) {
  const planned = planProjectGraph({ template, repository, workspaceFolders: [repository], name, appVersion: '9.9.9', instructions });
  assert.ok(planned.ok, JSON.stringify(planned));
  const written = writeProjectGraph(planned.plan);
  assert.ok(written.ok, JSON.stringify(written));
  return planned.plan;
}

test('applying creates a self-contained project graph, leaves the template as it was and never overwrites', () => {
  const { root, row } = templateFolder();
  const before = Object.fromEntries(
    fs.readdirSync(path.join(root, '.dspatch/loops'), { recursive: true }).map((file) => [String(file), fs.statSync(path.join(root, '.dspatch/loops', String(file))).isFile() ? fs.readFileSync(path.join(root, '.dspatch/loops', String(file)), 'utf8') : '']),
  );
  const repository = project();
  const plan = apply(repository, row);
  assert.deepEqual(plan.files.map((file) => file.relative).sort(), [
    '.dspatch/loops/orders-workflow.graph.json',
    '.dspatch/loops/orders-workflow.loop.json',
    '.dspatch/loops/orders-workflow.project.json',
    '.dspatch/loops/roles/orders-workflow/workshop-assembler.role.md',
    '.dspatch/loops/roles/orders-workflow/workshop-checker.role.md',
    '.dspatch/loops/roles/orders-workflow/workshop-coordinator.role.md',
    '.dspatch/loops/roles/orders-workflow/workshop-maker.role.md',
    '.dspatch/loops/roles/orders-workflow/workshop-scout.role.md',
  ]);
  // A project workflow of this repository, found by discovery, loading on its own copied roles.
  const found = discoverLoopDefinitions([repository]).rows.find((candidate) => candidate.definition?.id === 'orders-workflow');
  assert.ok(found?.definition);
  assert.equal(found.definition.origin?.templateId, 'workshop');
  assert.equal(found.definition.origin?.appVersion, '9.9.9');
  assert.equal(found.definition.origin?.roles.length, 5);
  assert.equal(found.resourceRoot, repository);
  const loaded = loadLoopGraph(fs.readFileSync(found.graphPath ?? '', 'utf8'), { resolveRole: createFileRoleResolver(repository) });
  assert.ok(loaded.ok, JSON.stringify(loaded.ok ? [] : loaded.findings));
  assert.ok(loaded.graph.nodes.every((node) => node.role === undefined || node.role.source.path.startsWith('.dspatch/loops/roles/orders-workflow/')));
  assert.ok(!fs.readFileSync(found.filePath, 'utf8').includes(repository), 'no absolute path in the definition');
  // The template is untouched.
  for (const [file, text] of Object.entries(before)) {
    if (text !== '') assert.equal(fs.readFileSync(path.join(root, '.dspatch/loops', file), 'utf8'), text, file);
  }
  // A second apply under the same name writes nothing.
  const again = planProjectGraph({ template: row, repository, workspaceFolders: [repository], name: 'Orders workflow', appVersion: '9.9.9' });
  assert.ok(!again.ok && again.problems.some((problem) => /exists already/.test(problem)));
  // A repository outside the workspace is refused.
  assert.ok(!planProjectGraph({ template: row, repository, workspaceFolders: [], name: 'Other', appVersion: '9.9.9' }).ok);
});

test('a save that fails part-way leaves nothing the chooser offers, and removes what it wrote', () => {
  const { row } = templateFolder();
  const repository = project();
  const planned = planProjectGraph({ template: row, repository, workspaceFolders: [repository], name: 'Broken', appVersion: '1' });
  assert.ok(planned.ok);
  let writes = 0;
  const result = writeProjectGraph(planned.plan, {
    write: (file, text) => {
      writes += 1;
      if (file.endsWith('.graph.json')) throw new Error('disk full');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
    },
  });
  assert.ok(!result.ok && /disk full/.test(result.problem));
  assert.ok(writes > 1);
  assert.equal(discoverLoopDefinitions([repository]).rows.length, 0, 'no definition was written');
  assert.ok(!fs.existsSync(path.join(repository, '.dspatch/loops/roles/broken')) || fs.readdirSync(path.join(repository, '.dspatch/loops/roles/broken')).length === 0);
});

test('the copy keeps its instructions when the template changes, and its references resolve when the repository moves', () => {
  const { root, row } = templateFolder();
  const repository = project();
  apply(repository, row);
  // DSpatch is updated: the template's maker role changes.
  const templateRole = path.join(root, '.dspatch/loops/roles/workshop-maker.role.md');
  fs.writeFileSync(templateRole, fs.readFileSync(templateRole, 'utf8').replace('Make the change you are given', 'TEMPLATE CHANGED'));
  const resolve = createFileRoleResolver(repository);
  const maker = resolve({ id: 'maker', source: { kind: 'role-source', path: '.dspatch/loops/roles/orders-workflow/workshop-maker.role.md' } });
  assert.match(maker?.instructions ?? '', /Make the change you are given/);
  assert.doesNotMatch(maker?.instructions ?? '', /TEMPLATE CHANGED/);
  // Moved elsewhere, the graph, its roles and its references still resolve.
  const moved = path.join(temp('dsp-moved-'), 'orders-kit');
  fs.cpSync(repository, moved, { recursive: true });
  fs.rmSync(repository, { recursive: true, force: true });
  const row2 = discoverLoopDefinitions([moved]).rows[0];
  assert.ok(row2?.definition);
  const loaded = loadLoopGraph(fs.readFileSync(row2.graphPath ?? '', 'utf8'), { resolveRole: createFileRoleResolver(moved) });
  assert.ok(loaded.ok);
  const reading = readProjectGraph(row2);
  assert.ok(!('problem' in reading));
  assert.deepEqual(referenceProblems(moved, reading.instructions, loaded.graph), []);
});

test('missing and outside references are named by step and role; a save refuses a changed file and strays', () => {
  const { row } = templateFolder();
  const repository = project();
  const plan = apply(repository, row);
  const graph = plan.graph;
  const broken: ProjectInstructions = {
    ...INSTRUCTIONS,
    nodes: { ...INSTRUCTIONS.nodes, maker: { text: '', documents: [{ path: 'docs/GONE.md', purpose: '', when: '' }, { path: '../elsewhere.md', purpose: '', when: '' }] } },
  };
  const problems = referenceProblems(repository, broken, graph);
  assert.deepEqual(problems.map((problem) => [problem.layer, problem.path]), [
    ['step Maker (maker)', 'docs/GONE.md'],
    ['step Maker (maker)', '../elsewhere.md'],
  ]);
  assert.match(problems[1]?.problem ?? '', /not inside the repository/);
  const found = discoverLoopDefinitions([repository]).rows[0];
  assert.ok(found);
  const reading = readProjectGraph(found);
  assert.ok(!('problem' in reading));
  // Someone else edits the file meanwhile: the save is refused, and nothing is written.
  fs.appendFileSync(reading.instructionsPath, ' ');
  const refused = saveProjectInstructions({ reading, instructions: broken, graph });
  assert.ok(!refused.ok && /changed outside this window/.test(refused.problem));
  const fresh = readProjectGraph(found);
  assert.ok(!('problem' in fresh));
  assert.ok(!saveProjectInstructions({ reading: fresh, instructions: { ...INSTRUCTIONS, nodes: { nowhere: { text: 'x', documents: [] } } }, graph }).ok);
  const ok = saveProjectInstructions({ reading: fresh, instructions: broken, graph });
  assert.ok(ok.ok);
  const reread = parseProjectInstructions(fs.readFileSync(fresh.instructionsPath, 'utf8'));
  assert.ok(reread.ok && reread.value.nodes['maker']?.documents.length === 2, 'saved, and read back as saved');
});

/** Answers each step by script, records every prompt. */
class Agent {
  readonly prompts = new Map<string, string[]>();
  private readonly listeners = new Map<string, AgentEventListener>();
  private readonly replies: Record<string, string>;
  constructor(replies: Record<string, string>) {
    this.replies = replies;
  }
  private key(sessionId: string): string {
    const slice = /\+\d+\+([A-Za-z0-9._-]+)$/.exec(sessionId)?.[1];
    return slice !== undefined ? `branch:${slice}` : /--([a-z-]+?)(--visit-\d+)?$/.exec(sessionId)?.[1] ?? sessionId;
  }
  startSession(config: { dspatchSessionId?: string }) {
    const id = config.dspatchSessionId ?? 's';
    return Promise.resolve({ dspatchSessionId: id, provider: 'claude', providerSessionId: `p-${id}`, createdAt: new Date().toISOString() });
  }
  subscribe(sessionId: string, listener: AgentEventListener) {
    this.listeners.set(sessionId, listener);
    return () => this.listeners.delete(sessionId);
  }
  send(sessionId: string, prompt: string) {
    const key = this.key(sessionId);
    this.prompts.set(key, [...(this.prompts.get(key) ?? []), prompt]);
    const runId = `${sessionId}-${String(this.prompts.get(key)?.length ?? 0)}`;
    setImmediate(() => {
      const emit = (event: Partial<AgentEvent>): void => {
        void this.listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
      };
      emit({ type: 'run.started' } as Partial<AgentEvent>);
      emit({ type: 'assistant.message', text: this.replies[key] ?? `${key} done.` } as Partial<AgentEvent>);
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

async function runProject(repository: string, replies: Record<string, string>) {
  const row = discoverLoopDefinitions([repository]).rows[0];
  assert.ok(row?.definition && row.graphPath);
  const resolveRole = createFileRoleResolver(repository);
  const loaded = loadLoopGraph(fs.readFileSync(row.graphPath, 'utf8'), { resolveRole });
  assert.ok(loaded.ok);
  const graph = loaded.graph;
  const reading = readProjectGraph(row);
  assert.ok(!('problem' in reading));
  const instructions = { value: reading.instructions, relativeFile: '.dspatch/loops/orders-workflow.project.json' };
  const agent = new Agent(replies);
  const delivery = await runLiveGraph(graph, {
    runId: 'project-run',
    repoRoot: repository,
    outDir: null,
    resultsDir: path.join(temp('dsp-results-'), 'r'),
    modelRequested: 'm',
    workspacePath: repository,
    keepWorkspace: true,
    bindingKind: 'chat-loop',
    provider: 'claude',
    createAdapter: () => agent as unknown as ChatAdapter,
    promptFor: (node, step) => {
      const resolved = node.role === undefined ? null : resolveRole(node.role);
      return chatPromptFor(node, {
        entryId: graph.entry,
        mandate: 'Add the export.',
        step,
        role: resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null },
        projectInstructions: stepProjectText(instructions, graph, node, step, { repository, workingFolder: repository, same: true }),
      });
    },
  });
  return { delivery, agent, graph, instructions };
}

const count = (text: string, needle: string): number => text.split(needle).length - 1;

test('a step gets its role, then the common, role and step additions once, by the preview\'s own assembly; documents are pointed at', async () => {
  const { row } = templateFolder();
  const repository = project();
  apply(repository, row);
  const { delivery, agent, graph, instructions } = await runProject(repository, {
    coordinator: 'One maker.\n\nRESULT: make',
    'quick-check': 'Fine.\n\nRESULT: pass',
    'deep-check': 'Fine.\n\nRESULT: pass',
  });
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  const maker = agent.prompts.get('maker')?.[0] ?? '';
  // Generic role first, then the project's layers, then the task.
  assert.ok(maker.indexOf('===== role, as written =====') < maker.indexOf('===== project instructions ====='));
  assert.ok(maker.indexOf('===== end of project instructions =====') < maker.indexOf('Add the export.'));
  for (const needle of ['COMMON: follow', 'ROLE-MAKER:', 'NODE-MAKER:', '- AGENTS.md', '- docs/TESTING.md', '- docs/ARCHITECTURE.md']) assert.equal(count(maker, needle), 1, needle);
  assert.doesNotMatch(maker, /NODE-CREW|NODE-SCOUT/);
  assert.ok(!maker.includes(AGENTS_SECRET), 'a referenced document is not attached');
  assert.match(maker, new RegExp(`repository root, which for this step is ${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // The preview a person reads is the very text in the prompt.
  const makerNode = graph.nodes.find((node) => node.id === 'maker')!;
  const preview = projectInstructionsText(instructions.value, { nodeId: 'maker', nodeLabel: makerNode.label ?? 'maker', roleId: 'maker' }, { file: instructions.relativeFile, repositoryRoot: repository });
  assert.ok(maker.includes(preview));
  // The coordinator gets the common layer only.
  const coordinator = agent.prompts.get('coordinator')?.[0] ?? '';
  assert.equal(count(coordinator, 'COMMON: follow'), 1);
  assert.doesNotMatch(coordinator, /ROLE-MAKER|NODE-MAKER/);
});

test('a parallel branch gets the additions of the step it runs as, in its own worktree', async () => {
  const { row } = templateFolder();
  const repository = project();
  apply(repository, row);
  const slices = `${FENCE}dspatch-slices\n${JSON.stringify({
    slices: [
      { id: 'a', as: 'maker', result: 'part a', ownedPaths: ['src'], allowedActions: ['edit'], contractRefs: [], verification: 'none' },
      { id: 'b', as: 'scout', result: 'part b', ownedPaths: ['notes'], allowedActions: ['edit'], contractRefs: [], verification: 'none' },
      { id: 'c', result: 'part c', ownedPaths: ['docs/c.md'], allowedActions: ['edit'], contractRefs: [], verification: 'none' },
    ],
  })}\n${FENCE}`;
  const { delivery, agent } = await runProject(repository, {
    coordinator: `Three parts.\n\n${slices}\n\nRESULT: split`,
    assembler: 'Merged.\n\nRESULT: integrated',
    'quick-check': 'Fine.\n\nRESULT: pass',
    'deep-check': 'Fine.\n\nRESULT: pass',
  });
  assert.equal(delivery.result.status, 'completed', delivery.journalText);
  const [a, b, c] = ['a', 'b', 'c'].map((id) => agent.prompts.get(`branch:${id}`)?.[0] ?? '');
  assert.match(a ?? '', /NODE-MAKER:/);
  assert.match(a ?? '', /ROLE-MAKER:/);
  assert.match(b ?? '', /NODE-SCOUT:/);
  assert.doesNotMatch(b ?? '', /ROLE-MAKER|NODE-MAKER/, 'the scout branch has the scout role, not the maker additions');
  assert.match(c ?? '', /NODE-CREW:/, 'a branch that runs as the fan-out step gets its additions');
  for (const prompt of [a, b, c]) {
    const root = /repository root, which for this step is (\S+)\./.exec(prompt ?? '')?.[1] ?? '';
    assert.notEqual(root, repository, 'a branch\'s documents resolve in its worktree');
    assert.match(root, /[\\/]worktrees[\\/]w/, `the branch's own worktree, ${root}`);
    assert.ok(!root.startsWith(repoRoot), 'never DSpatch\'s own folder');
  }
});

test('a graph without project instructions is sent exactly what it was', () => {
  const node = { id: 'n', kind: 'agent' as const, purpose: 'Do it.' };
  const plain = chatPromptFor(node, { entryId: 'n', mandate: 'M' });
  assert.equal(chatPromptFor(node, { entryId: 'n', mandate: 'M', projectInstructions: stepProjectText(null, { nodes: [node] }, node, {}, { repository: '/r', workingFolder: '/r', same: true }) }), plain);
});

test('the host applies, chooses and saves; recommendations reuse one inventory and change nothing on their own', async () => {
  const { root, row } = templateFolder();
  const repository = project();
  const chosen: string[] = [];
  const methods = projectGraphMethods({
    workspaceFolders: () => [repository],
    ownRoot: () => root,
    appVersion: '9.9.9',
    choose: (definitionPath) => chosen.push(definitionPath),
    agent: () => ({ provider: 'claude', model: 'sim' }),
    recommendRefusal: () => null,
    createAnalysisAdapter: () => new PresentationAdapter() as never,
  });
  const options = await methods({ kind: 'options' });
  assert.ok(options.kind === 'options' && options.templates.some((template) => template.key === row.filePath));
  const empty = { format: 'dspatch-project-instructions' as const, formatVersion: 1, common: { text: '', documents: [] }, roles: {}, nodes: {} };
  const planned = await methods({ kind: 'plan', templateKey: row.filePath, repository, name: 'Orders workflow', instructions: empty });
  assert.ok(planned.kind === 'planned' && planned.files.length === 8);
  assert.equal(discoverLoopDefinitions([repository]).rows.length, 0, 'a plan writes nothing');
  const applied = await methods({ kind: 'apply', templateKey: row.filePath, repository, name: 'Orders workflow', instructions: empty });
  assert.ok(applied.kind === 'applied');
  assert.deepEqual(chosen, [applied.definitionKey], 'the new graph is this workspace\'s choice; nothing ran');
  const described = await methods({ kind: 'describe', source: { definitionKey: applied.definitionKey } });
  assert.ok(described.kind === 'described');
  // "For all": an inventory; "for this step": handed it back, told to reuse it.
  const all = await methods({ kind: 'recommend', requestId: 'r1', repository, source: { definitionKey: applied.definitionKey }, target: { kind: 'all' }, instructions: described.description.instructions, inventory: null });
  assert.ok(all.kind === 'recommended', JSON.stringify(all));
  assert.ok(all.answer.inventory.governing.some((entry) => entry.path === 'AGENTS.md'));
  assert.ok(all.answer.recommendations.some((rec) => rec.target === 'common' && rec.documents.some((doc) => doc.path === 'AGENTS.md')));
  const one = await methods({ kind: 'recommend', requestId: 'r2', repository, source: { definitionKey: applied.definitionKey }, target: { kind: 'node', nodeId: 'maker' }, instructions: described.description.instructions, inventory: all.inventory });
  assert.ok(one.kind === 'recommended');
  assert.deepEqual(one.answer.recommendations.map((rec) => rec.target), ['node:maker']);
  assert.ok(one.answer.missing.some((item) => /inventory was reused/.test(item)));
  // Recommending wrote nothing.
  const reading = readProjectGraph(discoverLoopDefinitions([repository]).rows[0]!);
  assert.ok(!('problem' in reading));
  assert.equal(reading.instructionsSha256, described.description.instructionsSha256);
  // A save with the hash it was read with.
  const saved = await methods({ kind: 'save', definitionKey: applied.definitionKey, instructions: INSTRUCTIONS, expectedSha256: described.description.instructionsSha256 });
  assert.ok(saved.kind === 'saved', JSON.stringify(saved));
  const stale = await methods({ kind: 'save', definitionKey: applied.definitionKey, instructions: INSTRUCTIONS, expectedSha256: described.description.instructionsSha256 });
  assert.ok(stale.kind === 'refused', 'a second save with the old hash is refused');
  assert.equal(parseLoopDefinition(fs.readFileSync(applied.definitionKey, 'utf8')).definition?.projectInstructions, 'orders-workflow.project.json');
  assert.equal(sha256(fs.readFileSync(reading.instructionsPath, 'utf8')), saved.sha256);
});
