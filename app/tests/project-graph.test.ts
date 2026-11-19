/**
 * DSP-229: applying a bundled graph to a repository, its project instructions, and what steps
 * and parallel branches are sent. A synthetic project (AGENTS.md, architecture and testing
 * documents, a document outside docs/) and a template made from the Workshop example, whose
 * "maker" step and "crew" fan-out share the role implementer (the shared catalog role since DSP-231). Simulated adapters only.
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
import { projectGraphMethods, projectGraphService } from '../src/host/project-graph-methods';
import { projectInstructionTools } from '../src/host/project-instruction-tools';
import { ProjectDraftStore } from '../src/main/project-drafts';
import { openChosenLoop } from '../src/main/loop-definition-choice';
import { discussionContext, previewForStep, readProposedChanges, sectionAt, type ProjectDraftView } from '../src/shared/project-draft';
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
  roles: { implementer: { text: 'ROLE-MAKER: run npm test before you finish.', documents: [{ path: 'docs/TESTING.md', purpose: 'how tests are run', when: 'before finishing' }] } },
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
    '.dspatch/roles/catalog.json',
    '.dspatch/roles/coordinator/v1.role.md',
    '.dspatch/roles/explorer/v1.role.md',
    '.dspatch/roles/implementer/v1.role.md',
    '.dspatch/roles/integrator/v1.role.md',
    '.dspatch/roles/verifier/v1.role.md',
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
  // DSP-231: shared roles by identity and version, from the repository's own catalog copies.
  assert.ok(loaded.graph.nodes.every((node) => node.role === undefined || (node.role.source.kind === 'role-catalog' && node.role.source.path.startsWith('.dspatch/roles/'))));
  assert.ok(loaded.graph.nodes.every((node) => node.role === undefined || createFileRoleResolver(repository)(node.role)?.catalog?.status === 'listed'));
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
  // The template's copy of the implementer role changes: the repository keeps its own copy.
  const templateRole = path.join(root, '.dspatch/roles/implementer/v1.role.md');
  fs.writeFileSync(templateRole, fs.readFileSync(templateRole, 'utf8').replace('Carry out the work you are assigned', 'TEMPLATE CHANGED'));
  const resolve = createFileRoleResolver(repository);
  const maker = resolve({ id: 'implementer', version: 1, source: { kind: 'role-catalog', path: '.dspatch/roles/implementer/v1.role.md' } });
  assert.match(maker?.instructions ?? '', /Carry out the work you are assigned/);
  assert.doesNotMatch(maker?.instructions ?? '', /TEMPLATE CHANGED/);
  assert.equal(maker?.catalog?.status, 'listed');
  // And the edited template copy is now an edited copy of a published version: refused, not a variant.
  assert.equal(createFileRoleResolver(root)({ id: 'implementer', version: 1, source: { kind: 'role-catalog', path: '.dspatch/roles/implementer/v1.role.md' } })?.catalog?.status, 'modified');
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
  const preview = projectInstructionsText(instructions.value, { nodeId: 'maker', nodeLabel: makerNode.label ?? 'maker', roleId: 'implementer' }, { file: instructions.relativeFile, repositoryRoot: repository });
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
  assert.ok(planned.kind === 'planned' && planned.files.length === 9, 'graph, definition, instructions, five shared role copies and their index');
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
  // DSP-230: the draft is edited level by level and saved; the file is written only then.
  const levels = ['common', ...Object.keys(INSTRUCTIONS.roles).map((id) => `role:${id}`), ...Object.keys(INSTRUCTIONS.nodes).map((id) => `node:${id}`)];
  const edited = await methods({ kind: 'draftEdit', definitionKey: applied.definitionKey, edits: levels.map((level) => ({ level, section: sectionAt(INSTRUCTIONS, level) })) });
  assert.ok(edited.kind === 'draft' && edited.view.unsaved.length === levels.length, JSON.stringify(edited));
  assert.equal(sha256(fs.readFileSync(reading.instructionsPath, 'utf8')), described.description.instructionsSha256, 'editing the draft writes nothing');
  const saved = await methods({ kind: 'draftSave', definitionKey: applied.definitionKey });
  assert.ok(saved.kind === 'draft' && saved.view.unsaved.length === 0, JSON.stringify(saved));
  assert.equal(parseLoopDefinition(fs.readFileSync(applied.definitionKey, 'utf8')).definition?.projectInstructions, 'orders-workflow.project.json');
  assert.equal(sha256(fs.readFileSync(reading.instructionsPath, 'utf8')), saved.view.savedSha256);
});

// ---------------------------------------------------------------------------------------------
// DSP-230: one shared draft, the chat's proposals, and what a run reads.

/** A project graph with INSTRUCTIONS saved, and a service on it whose drafts are kept in `dir`. */
function draftFixture(dir: string | null = null) {
  const { root, row } = templateFolder();
  const repository = project();
  const plan = apply(repository, row);
  const changes: ProjectDraftView[] = [];
  const service = projectGraphService({
    workspaceFolders: () => [repository],
    ownRoot: () => root,
    appVersion: '9.9.9',
    choose: () => undefined,
    agent: () => ({ provider: 'claude', model: 'sim' }),
    recommendRefusal: () => null,
    createAnalysisAdapter: () => new PresentationAdapter() as never,
    draftsDir: dir,
    onDraftChange: (view) => changes.push(view),
  });
  const instructionsPath = path.join(repository, '.dspatch/loops/orders-workflow.project.json');
  return { repository, root, key: plan.definitionPath, service, changes, instructionsPath };
}

function viewOf(answer: Awaited<ReturnType<ReturnType<typeof projectGraphService>['handle']>>): ProjectDraftView {
  assert.ok(answer.kind === 'draft', JSON.stringify(answer));
  return answer.view;
}

test('a role edit reaches every step with the role and a step edit one step; two places editing share one draft', async () => {
  const { key, service, instructionsPath, changes } = draftFixture();
  const onDisk = fs.readFileSync(instructionsPath, 'utf8');
  const first = viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  assert.deepEqual(first.unsaved, []);
  assert.deepEqual(first.outline.nodes.filter((node) => node.roleId === 'implementer').map((node) => node.id).sort(), ['crew', 'maker']);
  const where = { file: first.instructionsFile, repositoryRoot: first.repository };
  const before = Object.fromEntries(first.outline.nodes.map((node) => [node.id, previewForStep(first.draft, first.outline, node.id, where)]));

  // "The panel" changes the role; "the window", working from the draft it last saw, changes one step.
  const panel = viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'role:implementer', section: { text: 'ROLE-MAKER-2: keep commits small.', documents: [] } }] }));
  const window = viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'node:scout', section: { text: 'NODE-SCOUT-2: notes in docs/notes only.', documents: [] } }] }));
  assert.deepEqual([...window.unsaved].sort(), ['node:scout', 'role:implementer'], 'neither edit overwrote the other');
  assert.ok(window.revision > panel.revision);
  assert.equal(changes.length >= 2, true, 'every window is told');
  const after = Object.fromEntries(window.outline.nodes.map((node) => [node.id, previewForStep(window.draft, window.outline, node.id, where)]));
  for (const id of ['maker', 'crew']) {
    assert.match(after[id] ?? '', /ROLE-MAKER-2/);
    assert.doesNotMatch(after[id] ?? '', /ROLE-MAKER: run npm test/);
  }
  assert.match(after['scout'] ?? '', /NODE-SCOUT-2/);
  for (const node of window.outline.nodes.filter((each) => !['maker', 'crew', 'scout'].includes(each.id))) {
    assert.equal(after[node.id], before[node.id], `${node.id} is untouched`);
  }
  assert.equal(fs.readFileSync(instructionsPath, 'utf8'), onDisk, 'nothing is saved by editing');
  // The scope said before an edit.
  assert.match(discussionContext(window, { nodeId: 'maker' }), /Reaches all 2 nodes using/);
});

test('save writes the draft and the run reads exactly what the draft previewed; a run already started keeps its own', async () => {
  const { repository, key, service, instructionsPath } = draftFixture();
  const row = (): LoopDefinitionRow => discoverLoopDefinitions([repository]).rows.find((candidate) => candidate.filePath === key)!;
  const started = openChosenLoop(row());
  assert.ok(started.ok);
  const startedText = JSON.stringify(started.chosen.projectInstructions?.value);
  const edited = viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'common', section: { text: 'COMMON-2: say what you changed.', documents: [] } }] }));
  const preview = previewForStep(edited.draft, edited.outline, 'maker', { file: edited.instructionsFile, repositoryRoot: edited.repository });
  // Before saving, a new run reads the saved version.
  const beforeSave = openChosenLoop(row());
  assert.ok(beforeSave.ok);
  assert.equal(JSON.stringify(beforeSave.chosen.projectInstructions?.value), startedText);
  assert.deepEqual(service.drafts.unsaved(key), ['common'], 'what the run start asks about');
  const saved = viewOf(await service.handle({ kind: 'draftSave', definitionKey: key }));
  assert.deepEqual(saved.unsaved, []);
  const next = openChosenLoop(row());
  assert.ok(next.ok && next.chosen.projectInstructions !== null);
  const graph = loadLoopGraph(fs.readFileSync(next.chosen.graphPath, 'utf8'), { resolveRole: createFileRoleResolver(repository) });
  assert.ok(graph.graph);
  const node = graph.graph.nodes.find((each) => each.id === 'maker')!;
  const runText = stepProjectText(
    { value: next.chosen.projectInstructions.value, relativeFile: path.relative(repository, instructionsPath).split(path.sep).join('/') },
    graph.graph,
    node,
    {},
    { repository, workingFolder: repository, same: true },
  );
  assert.equal(runText, preview, 'the saved instructions a run reads are what the draft previewed');
  assert.equal(JSON.stringify(started.chosen.projectInstructions?.value), startedText, 'the run already started keeps what it pinned');
});

test('a change on disk is followed when the draft is clean, refused at save when it is not, and taken in level by level', async () => {
  const { key, service, instructionsPath } = draftFixture();
  viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  const disk = (change: (value: ProjectInstructions) => ProjectInstructions): void => {
    const parsed = parseProjectInstructions(fs.readFileSync(instructionsPath, 'utf8'));
    assert.ok(parsed.ok);
    fs.writeFileSync(instructionsPath, `${JSON.stringify(change(parsed.value), null, 2)}\n`);
  };
  disk((value) => ({ ...value, nodes: { ...value.nodes, scout: { text: 'DISK-SCOUT', documents: [] } } }));
  const followed = viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  assert.equal(followed.disk, 'same');
  assert.equal(followed.draft.nodes['scout']?.text, 'DISK-SCOUT', 'a clean draft follows the file');

  viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'node:maker', section: { text: 'MINE-MAKER', documents: [] } }] }));
  disk((value) => ({ ...value, common: { text: 'DISK-COMMON', documents: [] }, nodes: { ...value.nodes, maker: { text: 'DISK-MAKER', documents: [] } } }));
  const conflicted = viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  assert.equal(conflicted.disk, 'changed');
  const refused = await service.handle({ kind: 'draftSave', definitionKey: key });
  assert.ok(refused.kind === 'refused' && /changed on disk/.test(refused.problems.join(' ')), JSON.stringify(refused));
  assert.match(fs.readFileSync(instructionsPath, 'utf8'), /DISK-MAKER/, 'nothing overwritten');
  const taken = await service.handle({ kind: 'draftTakeDisk', definitionKey: key });
  assert.ok(taken.kind === 'draft' && /node:maker changed both/.test(taken.note ?? ''), JSON.stringify(taken));
  assert.equal(taken.view.draft.common.text, 'DISK-COMMON', 'a level the person did not change takes the disk version');
  assert.equal(taken.view.draft.nodes['maker']?.text, 'MINE-MAKER', 'the person\'s level is kept');
  assert.equal(taken.view.disk, 'same');
  viewOf(await service.handle({ kind: 'draftSave', definitionKey: key }));
  assert.match(fs.readFileSync(instructionsPath, 'utf8'), /MINE-MAKER/);
  // Discard returns to the file.
  viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'common', section: { text: 'THROWN AWAY', documents: [] } }] }));
  const discarded = viewOf(await service.handle({ kind: 'draftDiscard', definitionKey: key }));
  assert.deepEqual(discarded.unsaved, []);
  assert.equal(discarded.draft.common.text, 'DISK-COMMON');
});

test('the chat proposes through its tool; applying changes only the draft, and a newer manual edit is never overwritten', async () => {
  const dir = temp('dsp-drafts-');
  const { key, service, instructionsPath } = draftFixture(dir);
  const onDisk = fs.readFileSync(instructionsPath, 'utf8');
  let turn = 'turn-1';
  const tools = projectInstructionTools({
    drafts: service.drafts,
    definitionKeyFor: (id) => service.definitionKeyFor(id),
    conversationId: () => 'conv-1',
    turnRunId: () => turn,
    newId: (() => {
      let n = 0;
      return () => `p${String((n += 1))}`;
    })(),
  });
  const tool = (name: string) => tools.find((each) => each.name === name)!;
  const read = await tool('read_project_instructions').execute({ graph: 'orders-workflow', step: 'maker' });
  assert.ok(!read.isError && /ROLE-MAKER: run npm test/.test(read.text) && /Reaches all 2 nodes using/.test(read.text), read.text);
  assert.doesNotMatch(read.text, new RegExp(AGENTS_SECRET), 'documents are named, never included');

  // Malformed: a level the graph lacks is refused and nothing is kept.
  const bad = await tool('propose_project_instructions').execute({ graph: 'orders-workflow', explanation: 'x', changes: JSON.stringify([{ level: 'role:nobody', text: 'x', reason: 'r' }]) });
  assert.ok(bad.isError && /no role "nobody"/.test(bad.text));

  const changes = JSON.stringify([
    { level: 'role:implementer', text: 'ROLE-MAKER: run npm test and npm run lint before you finish.', reason: 'Lint is required by CI.', sources: [{ path: '.github/copilot/agents/maker.agent.md', note: 'earlier agent definition; the lint rule is still in CI, the rest is outdated' }] },
    { level: 'node:scout', remove: true, reason: 'The scout no longer writes notes.' },
  ]);
  const proposed = await tool('propose_project_instructions').execute({ graph: 'orders-workflow', explanation: 'Bring the lint rule over.', changes });
  assert.ok(!proposed.isError, proposed.text);
  let view = viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  const p1 = view.proposals.find((proposal) => proposal.id === 'p1')!;
  assert.equal(p1.turnRunId, 'turn-1');
  assert.deepEqual(p1.changes.map((change) => [change.level, change.action, [...change.steps].sort()]), [['role:implementer', 'change', ['crew', 'maker']], ['node:scout', 'remove', ['scout']]]);
  assert.match(p1.changes[0]!.sources[0]!.note, /outdated/);
  assert.deepEqual(view.unsaved, [], 'proposing changes nothing');

  // A second proposal for the role, then the person edits the role by hand.
  turn = 'turn-2';
  const second = await tool('propose_project_instructions').execute({ graph: 'orders-workflow', explanation: 'Shorter.', changes: JSON.stringify([{ level: 'role:implementer', text: 'ROLE-MAKER: test.', reason: 'shorter' }]) });
  assert.ok(!second.isError);
  viewOf(await service.handle({ kind: 'draftEdit', definitionKey: key, edits: [{ level: 'role:implementer', section: { text: 'MY OWN ROLE TEXT', documents: [] } }] }));
  const stale = await service.handle({ kind: 'proposalApply', definitionKey: key, proposalId: 'p2' });
  assert.ok(stale.kind === 'refused' && /role:implementer changed in the draft/.test(stale.problems.join(' ')), JSON.stringify(stale));
  view = viewOf(await service.handle({ kind: 'draft', definitionKey: key }));
  assert.equal(view.draft.roles['implementer']?.text, 'MY OWN ROLE TEXT', 'the newer manual edit is kept');
  assert.equal(view.proposals.find((proposal) => proposal.id === 'p2')?.status, 'stale');

  // p1 is stale for the role too; undo the manual edit and it applies whole.
  viewOf(await service.handle({ kind: 'draftDiscard', definitionKey: key }));
  const applied = viewOf(await service.handle({ kind: 'proposalApply', definitionKey: key, proposalId: 'p1' }));
  assert.match(applied.draft.roles['implementer']?.text ?? '', /npm run lint/);
  assert.equal(applied.draft.nodes['scout'], undefined);
  assert.deepEqual([...applied.unsaved].sort(), ['node:scout', 'role:implementer']);
  assert.equal(fs.readFileSync(instructionsPath, 'utf8'), onDisk, 'applying a proposal saves nothing');
  assert.equal(applied.proposals.find((proposal) => proposal.id === 'p1')?.status, 'applied');

  // Restarting DSpatch: a new store on the same folder still has the unsaved draft and the history.
  const again = projectGraphService({
    workspaceFolders: () => [path.dirname(path.dirname(path.dirname(key)))],
    ownRoot: () => null,
    appVersion: '9.9.9',
    choose: () => undefined,
    agent: () => ({ provider: null, model: null }),
    recommendRefusal: () => null,
    createAnalysisAdapter: () => new PresentationAdapter() as never,
    draftsDir: dir,
  }).drafts;
  assert.ok(again instanceof ProjectDraftStore);
  const restored = again.view(key);
  assert.ok(restored.ok);
  assert.deepEqual([...restored.view.unsaved].sort(), ['node:scout', 'role:implementer']);
  assert.equal(again.proposalsFor('conv-1').length, 2);
});

test('proposed changes are read strictly: a reason is required, unchanged levels and duplicates are refused', () => {
  const outline = { name: 'g', roles: [{ id: 'maker', title: 'Maker', summary: '' }], nodes: [{ id: 'maker', label: 'Make', roleId: 'maker', purpose: '' }] };
  const draft = INSTRUCTIONS;
  assert.equal(readProposedChanges('[{"level":"common","text":"x"}]', outline, draft).ok, false);
  assert.equal(readProposedChanges(JSON.stringify([{ level: 'common', text: draft.common.text, reason: 'r' }]), outline, draft).ok, false);
  assert.equal(readProposedChanges(JSON.stringify([{ level: 'common', text: 'a', reason: 'r' }, { level: 'common', text: 'b', reason: 'r' }]), outline, draft).ok, false);
  const added = readProposedChanges(JSON.stringify([{ level: 'node:maker', documents: [{ path: 'docs\\TESTING.md', purpose: 'tests', when: 'always' }], reason: 'r' }]), outline, { ...draft, nodes: {} });
  assert.ok(added.ok && added.changes[0]?.action === 'add' && added.changes[0].after.documents[0]?.path === 'docs/TESTING.md', JSON.stringify(added));
});
