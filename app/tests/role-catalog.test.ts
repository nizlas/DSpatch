/**
 * DSP-231: shared, versioned roles. The catalog's integrity, one definition behind one identity and
 * version, the separation of role, node task and project additions in what a step is sent, the
 * upgrade from legacy roles (requirements, model policies, routes and the reach of project additions
 * kept), pinned versions, a project's own roles, Apply to repository and the chat's graph tools.
 * Synthetic projects and simulated tools only; no provider is called.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import { discoverLoopDefinitions } from '../src/main/loop-definition-files';
import { createFileRoleResolver } from '../src/main/loop-graph-roles';
import { stepSessionId } from '../src/main/loop-live';
import { planProjectGraph, writeProjectGraph } from '../src/main/project-graph';
import { installedRoleCatalog, planProjectRole, roleDigest } from '../src/main/role-catalog-files';
import { parseRoleSource } from '../src/main/role-source';
import { projectGraphMethods } from '../src/host/project-graph-methods';
import { chatPromptFor, chatRoleTextOf, ROLE_BLOCK_CLOSE, ROLE_BLOCK_OPEN } from '../src/shared/loop-chat';
import { effectiveRequirements, type LoopGraph, type ResolvedRole, type RoleReference } from '../src/shared/loop-graph';
import { loadLoopGraph, parseLoopGraph } from '../src/shared/loop-graph-load';
import { serialiseLoopGraph } from '../src/shared/loop-graph-write';
import {
  emptyProjectInstructions,
  PROJECT_INSTRUCTIONS_CLOSE,
  PROJECT_INSTRUCTIONS_OPEN,
  instructionLayers,
  stepProjectText,
  type ProjectInstructions,
} from '../src/shared/project-instructions';
import { catalogReference, orphanedRoleAdditions, parseRoleCatalog, planRoleUpgrade } from '../src/shared/role-catalog';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CATALOG = path.join(repoRoot, 'docs/loop/roles/catalog');
/** The last commit before the migration: the bundled graphs as they were, with their legacy roles. */
const BEFORE = '1737fca';
const MIGRATED = [
  'generic-agent-network',
  'dspatch-chat-loop',
  'dspatch-duration-check',
  'dspatch-parallel-loop',
  'dspatch-mission-loop',
  'dspatch-development-loop-runnable',
  'dspatch-walk-loop',
];
const scratch: string[] = [];
after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const temp = (prefix: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
};
const resolve = createFileRoleResolver(repoRoot);
const graphAt = (text: string): LoopGraph => {
  const parsed = parseLoopGraph(text);
  assert.ok(parsed.ok);
  return parsed.graph;
};
const bundled = (id: string): LoopGraph => graphAt(fs.readFileSync(path.join(repoRoot, 'docs/loop/graphs', `${id}.graph.json`), 'utf8'));
const before = (id: string): LoopGraph => graphAt(execFileSync('git', ['show', `${BEFORE}:docs/loop/graphs/${id}.graph.json`], { cwd: repoRoot, encoding: 'utf8' }));
const requirementsOf = (graph: LoopGraph, nodeId: string, resolver = resolve): readonly string[] => {
  const node = graph.nodes.find((each) => each.id === nodeId)!;
  return effectiveRequirements(node, node.role === undefined ? null : resolver(node.role)).map((entry) => entry.requirement).sort();
};

describe('the catalog', () => {
  it('lists every version with the digest of its file, and every file says its identity, version and origin', () => {
    const index = parseRoleCatalog(fs.readFileSync(path.join(CATALOG, 'catalog.json'), 'utf8'));
    assert.ok(index.ok);
    assert.ok(index.index.roles.length >= 20);
    for (const role of index.index.roles) {
      for (const version of role.versions) {
        const text = fs.readFileSync(path.join(CATALOG, version.file), 'utf8');
        assert.equal(roleDigest(text), version.sha256, `${role.id} v${String(version.version)}: the file is the listed text`);
        const parsed = parseRoleSource(text);
        assert.ok(parsed.ok, `${role.id}: ${parsed.ok ? '' : parsed.problems.map((problem) => problem.message).join(' ')}`);
        assert.equal(parsed.source.id, role.id);
        assert.equal(parsed.source.version, version.version);
        assert.equal(parsed.source.origin, 'dspatch');
        // A generic role names no project, person or graph.
        assert.doesNotMatch(text, /\bNiclas\b|AGENTS\.md|tl-accept|DSP-\d/, role.id);
      }
    }
    // Every legacy role maps to a version the catalog has.
    for (const legacy of index.index.legacy ?? []) {
      for (const target of legacy.to) assert.ok(index.index.roles.some((role) => role.id === target.role && role.versions.some((entry) => entry.version === target.version)), `${legacy.id} -> ${target.role}`);
    }
  });

  it('the same identity and version is the same definition in two different graphs', () => {
    const generic = bundled('generic-agent-network').nodes.find((node) => node.id === 'implementer')!;
    const chat = bundled('dspatch-chat-loop').nodes.find((node) => node.id === 'work')!;
    assert.deepEqual([generic.role?.id, generic.role?.version], ['implementer', 1]);
    assert.deepEqual([chat.role?.id, chat.role?.version], ['implementer', 1]);
    const a = resolve(generic.role as RoleReference);
    const b = resolve(chat.role as RoleReference);
    assert.ok(a !== null && b !== null);
    assert.equal(a.instructions, b.instructions);
    assert.equal(a.sha256, b.sha256);
    assert.equal(a.catalog?.status, 'listed');
    // And the graphs' own tasks differ: the shared role is not where they are written.
    assert.notEqual(generic.purpose, chat.purpose);
  });

  it('an edited copy of a published version, or a file claiming another version, is refused', () => {
    const root = temp('dsp-edited-');
    const dir = path.join(root, '.dspatch/roles/implementer');
    fs.mkdirSync(dir, { recursive: true });
    const original = fs.readFileSync(path.join(CATALOG, 'implementer/v1.role.md'), 'utf8');
    fs.writeFileSync(path.join(dir, 'v1.role.md'), original.replace('Carry out the work', 'Carry out SOME work'));
    const graph = bundled('dspatch-chat-loop');
    const local: LoopGraph = { ...graph, nodes: graph.nodes.map((node) => (node.id === 'work' ? { ...node, role: catalogReference('implementer', 1, '.dspatch/roles') } : node)) };
    fs.mkdirSync(path.join(root, 'docs/loop/roles/catalog/verifier'), { recursive: true });
    fs.copyFileSync(path.join(CATALOG, 'verifier/v1.role.md'), path.join(root, 'docs/loop/roles/catalog/verifier/v1.role.md'));
    const loaded = loadLoopGraph(serialiseLoopGraph(local), { resolveRole: createFileRoleResolver(root) });
    assert.equal(loaded.ok, false);
    assert.ok(loaded.findings.some((finding) => finding.code === 'role-copy-modified'), JSON.stringify(loaded.findings.map((finding) => finding.code)));
    // Claiming version 2 while the graph asks for 1.
    fs.writeFileSync(path.join(dir, 'v1.role.md'), original.replace('version: 1', 'version: 2'));
    const mismatch = loadLoopGraph(serialiseLoopGraph(local), { resolveRole: createFileRoleResolver(root) });
    assert.ok(mismatch.findings.some((finding) => finding.code === 'role-version-mismatch'));
    // A reference without a version is not a catalog reference.
    const unversioned = serialiseLoopGraph(local).replace('"version": 1,', '');
    assert.ok(loadLoopGraph(unversioned).findings.some((finding) => finding.code === 'role-catalog-without-version'));
  });
});

describe('what a step is sent', () => {
  it('keeps the generic role, the project additions and the node task apart, in that order', () => {
    const graph = bundled('dspatch-chat-loop');
    const node = graph.nodes.find((each) => each.id === 'work')!;
    const role = resolve(node.role as RoleReference) as ResolvedRole;
    const instructions: ProjectInstructions = {
      ...emptyProjectInstructions(),
      common: { text: 'COMMON-ADDITION', documents: [] },
      roles: { implementer: { text: 'ROLE-ADDITION', documents: [] } },
      nodes: { work: { text: 'NODE-ADDITION', documents: [] } },
    };
    const project = stepProjectText({ value: instructions, relativeFile: '.dspatch/loops/x.project.json' }, graph, node, {}, { repository: '/r', workingFolder: '/r', same: true });
    const prompt = chatPromptFor(node, { entryId: graph.entry, mandate: 'THE-MANDATE', role: chatRoleTextOf(role), projectInstructions: project });
    const at = (text: string): number => prompt.indexOf(text);
    assert.ok(at(ROLE_BLOCK_OPEN) >= 0 && at(ROLE_BLOCK_OPEN) < at(ROLE_BLOCK_CLOSE));
    assert.ok(at(ROLE_BLOCK_CLOSE) < at(PROJECT_INSTRUCTIONS_OPEN), 'the generic role first');
    assert.ok(at(PROJECT_INSTRUCTIONS_CLOSE) < at('THE-MANDATE'), 'then the project additions, then the run input');
    assert.ok(at('THE-MANDATE') < at('Do what the Mandate asks'), 'then the node task');
    const roleBlock = prompt.slice(at(ROLE_BLOCK_OPEN), at(ROLE_BLOCK_CLOSE));
    assert.doesNotMatch(roleBlock, /ADDITION|done-unchecked|Do what the Mandate asks/, 'the role block holds the shared role only');
    assert.match(prompt, /role "Implementer" \(implementer, version 1 from DSpatch’s role catalog\)/);
    for (const addition of ['COMMON-ADDITION', 'ROLE-ADDITION', 'NODE-ADDITION']) assert.equal(prompt.split(addition).length, 2, `${addition} once`);
    // The node's own contract, moved out of the role, is in its task.
    assert.match(node.purpose ?? '', /RESULT: done-unchecked/);
  });

  it('a role addition reaches every node with that role once, and no other node', () => {
    const graph = bundled('generic-agent-network');
    const instructions: ProjectInstructions = { ...emptyProjectInstructions(), roles: { implementer: { text: 'IMPLEMENTER-ADDITION', documents: [] } } };
    const reached = graph.nodes.filter((node) => node.kind === 'agent').filter((node) => {
      const layers = instructionLayers(instructions, { nodeId: node.id, nodeLabel: node.label ?? node.id, roleId: node.role?.id ?? null });
      const text = layers.map((layer) => layer.section.text).join('\n');
      assert.ok(text.split('IMPLEMENTER-ADDITION').length <= 2, `${node.id}: no duplicate`);
      return text.includes('IMPLEMENTER-ADDITION');
    });
    assert.deepEqual(reached.map((node) => node.id).sort(), ['branches', 'implementer']);
    // A branch running as the researcher gets the researcher's additions, not the fan-out node's role's.
    const branches = graph.nodes.find((node) => node.id === 'branches')!;
    const asResearcher = stepProjectText({ value: { ...instructions, roles: { ...instructions.roles, researcher: { text: 'RESEARCHER-ADDITION', documents: [] } } }, relativeFile: 'x' }, graph, { ...branches, role: graph.nodes.find((node) => node.id === 'researcher')!.role! }, { branch: true, runsAs: 'researcher', workspacePath: '/w' }, { repository: '/r', workingFolder: '/r', same: true });
    assert.match(asResearcher, /RESEARCHER-ADDITION/);
    assert.doesNotMatch(asResearcher, /IMPLEMENTER-ADDITION/);
  });

  it('a shared role is not a shared session: every node has its own', () => {
    const graph = bundled('generic-agent-network');
    const sharing = graph.nodes.filter((node) => node.role?.id === 'tech-lead');
    assert.ok(sharing.length >= 6);
    const sessions = new Set(sharing.map((node) => stepSessionId('run-1', node.id)));
    assert.equal(sessions.size, sharing.length);
  });
});

describe('the migration of the bundled graphs', () => {
  for (const id of MIGRATED) {
    it(`${id}: routes, model policies, parallelism, limits, outcomes and every node's effective requirements are what they were`, () => {
      const old = before(id);
      const now = bundled(id);
      assert.deepEqual(now.edges, old.edges);
      assert.deepEqual(now.choices, old.choices);
      assert.equal(now.entry, old.entry);
      assert.deepEqual(now.nodes.map((node) => node.id), old.nodes.map((node) => node.id));
      for (const node of now.nodes) {
        const was = old.nodes.find((each) => each.id === node.id)!;
        for (const field of ['kind', 'model', 'limits', 'outcomes', 'declaredFailures', 'whenUndeclared', 'fanOut', 'capabilities', 'declares', 'report', 'produces', 'consumes', 'decides'] as const) {
          assert.deepEqual(node[field], was[field], `${id}/${node.id}.${field}`);
        }
        if (node.kind !== 'agent') continue;
        assert.equal(node.role?.source.kind, 'role-catalog', `${id}/${node.id}`);
        assert.deepEqual(requirementsOf(now, node.id), requirementsOf(old, node.id), `${id}/${node.id}: effective requirements`);
        // The node's task keeps what it said; text moved out of the role is added after it.
        assert.ok((node.purpose ?? '').startsWith((was.purpose ?? '').trim()), `${id}/${node.id}: its task is kept`);
      }
      const loaded = loadLoopGraph(serialiseLoopGraph(now), { resolveRole: resolve });
      assert.ok(loaded.ok, loaded.ok ? '' : loaded.findings.filter((finding) => finding.severity === 'error').map((finding) => finding.message).join('\n'));
    });
  }

  it('an older graph with legacy roles still loads and resolves as it did', () => {
    const old = before('dspatch-chat-loop');
    const loaded = loadLoopGraph(serialiseLoopGraph(old), { resolveRole: resolve });
    assert.ok(loaded.ok, loaded.ok ? '' : loaded.findings.map((finding) => finding.message).join('\n'));
    assert.equal(resolve(old.nodes.find((node) => node.id === 'work')!.role!)?.id, 'project-work');
  });
});

describe('the upgrade of a graph with legacy roles', () => {
  const catalog = installedRoleCatalog()!;
  const upgrade = (graph: LoopGraph, instructions: ProjectInstructions | null, choices?: Record<string, string>) =>
    planRoleUpgrade({
      graph,
      instructions,
      catalog,
      resolve,
      catalogDir: 'docs/loop/roles/catalog',
      resolveCatalog: (id, version) => resolve(catalogReference(id, version, 'docs/loop/roles/catalog')),
      ...(choices === undefined ? {} : { choices }),
    });
  /** What each agent node is sent from the project's additions, by node. */
  const reach = (graph: LoopGraph, instructions: ProjectInstructions): Record<string, string> =>
    Object.fromEntries(
      graph.nodes
        .filter((node) => node.kind === 'agent')
        .map((node) => [node.id, instructionLayers(instructions, { nodeId: node.id, nodeLabel: node.id, roleId: node.role?.id ?? null }).map((layer) => layer.section.text).join('|')]),
    );

  it('reproduces the bundled migration, and keeps the reach of every project addition when roles split or merge', () => {
    const old = before('generic-agent-network');
    const instructions: ProjectInstructions = {
      ...emptyProjectInstructions(),
      common: { text: 'ALL', documents: [] },
      roles: {
        'generic-reviewer': { text: 'REVIEWER-RULE', documents: [{ path: 'docs/REVIEW.md', purpose: 'review rules', when: 'before reviewing' }] },
        'generic-tech-lead': { text: 'LEAD-RULE', documents: [] },
        'generic-tech-lead-m': { text: 'SLICE-LEAD-RULE', documents: [] },
        'generic-implementer': { text: 'IMPLEMENTER-RULE', documents: [] },
      },
      nodes: { qa: { text: 'QA-ONLY', documents: [] } },
    };
    const plan = upgrade(old, instructions);
    assert.deepEqual(plan.kept, []);
    assert.deepEqual(plan.graph.nodes.map((node) => [node.id, node.role?.id]), bundled('generic-agent-network').nodes.map((node) => [node.id, node.role?.id]), 'the same mapping as the bundled graph');
    assert.ok(plan.instructions !== null);
    // Every node is sent exactly what it was sent before, whichever way its role went.
    assert.deepEqual(reach(plan.graph, plan.instructions), reach(old, instructions));
    // One legacy role, one new role, the same nodes: the addition stays a role addition.
    assert.equal(plan.instructions.roles['implementer']?.text, 'IMPLEMENTER-RULE');
    // Merged and split roles: placed node by node and said as conflicts, never widened.
    assert.equal(plan.instructions.roles['tech-lead'], undefined);
    assert.ok(plan.conflicts.some((conflict) => /generic-tech-lead-m/.test(conflict)));
    assert.ok(plan.conflicts.some((conflict) => /generic-reviewer/.test(conflict)));
    assert.match(plan.instructions.nodes['reviewer-readiness']?.text ?? '', /REVIEWER-RULE/);
    assert.equal(plan.instructions.nodes['reviewer-readiness']?.documents[0]?.path, 'docs/REVIEW.md');
    assert.equal(plan.instructions.nodes['qa']?.text, 'QA-ONLY');
    assert.deepEqual(orphanedRoleAdditions(plan.graph, plan.instructions), []);
  });

  it('lets the person choose another target the legacy role offers, and keeps an edited role as it is', () => {
    const old = before('generic-agent-network');
    const chosen = upgrade(old, null, { reviewer: 'plan-reviewer' });
    assert.equal(chosen.graph.nodes.find((node) => node.id === 'reviewer')?.role?.id, 'plan-reviewer');
    const root = temp('dsp-edited-legacy-');
    fs.cpSync(path.join(repoRoot, 'docs/loop/roles/generic'), path.join(root, 'docs/loop/roles/generic'), { recursive: true });
    fs.appendFileSync(path.join(root, 'docs/loop/roles/generic/skeptic.role.md'), '\nOur own extra rule.\n');
    const edited = planRoleUpgrade({
      graph: old,
      instructions: null,
      catalog,
      resolve: createFileRoleResolver(root),
      catalogDir: 'docs/loop/roles/catalog',
      resolveCatalog: (id, version) => resolve(catalogReference(id, version, 'docs/loop/roles/catalog')),
    });
    assert.deepEqual(edited.kept.map((kept) => [kept.nodeId, kept.roleId]), [['skeptic', 'generic-skeptic']]);
    assert.equal(edited.graph.nodes.find((node) => node.id === 'skeptic')?.role?.id, 'generic-skeptic', 'not upgraded unasked');
  });
});

describe('versions are pinned', () => {
  it('a newer version changes no graph that pins the older one, and a running resolver keeps what it read', () => {
    const root = temp('dsp-pinned-');
    const save = (text: string): { id: string; version: number } => {
      const planned = planProjectRole(root, text, (source) => {
        const parsed = parseRoleSource(source);
        return parsed.ok ? { ok: true, id: parsed.source.id } : { ok: false, problems: parsed.problems.map((problem) => problem.message) };
      });
      assert.ok(planned.ok, JSON.stringify(planned));
      for (const file of planned.files) {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        fs.writeFileSync(file.path, file.text);
      }
      return { id: planned.id, version: planned.version };
    };
    const source = (purpose: string): string => `---\nrole: release-keeper\ntitle: Release keeper\nsummary: "Keep releases honest."\ntargets: cursor\n---\n\n## Purpose\n\n${purpose}\n`;
    assert.deepEqual(save(source('VERSION-ONE text.')), { id: 'release-keeper', version: 1 });
    const pinned = catalogReference('release-keeper', 1, '.dspatch/roles');
    const running = createFileRoleResolver(root);
    assert.match(running(pinned)?.instructions ?? '', /VERSION-ONE/);
    assert.equal(running(pinned)?.catalog?.status, 'listed');
    assert.equal(running(pinned)?.origin, 'project');
    assert.deepEqual(save(source('VERSION-TWO text.')), { id: 'release-keeper', version: 2 });
    // The graph that pins v1 still gets v1, from a fresh resolver as from the running one.
    assert.match(createFileRoleResolver(root)(pinned)?.instructions ?? '', /VERSION-ONE/);
    assert.match(createFileRoleResolver(root)(catalogReference('release-keeper', 2, '.dspatch/roles'))?.instructions ?? '', /VERSION-TWO/);
    // A run that started keeps the text it read even if the file is then edited by hand.
    fs.appendFileSync(path.join(root, '.dspatch/roles/release-keeper/v1.role.md'), '\nEDITED LATER\n');
    assert.doesNotMatch(running(pinned)?.instructions ?? '', /EDITED LATER/);
    assert.equal(createFileRoleResolver(root)(pinned)?.catalog?.status, 'modified', 'and the edit is refused for every later run');
    // A shared identity is never taken by a project role.
    const taken = planProjectRole(root, source('x').replace('release-keeper', 'implementer'), () => ({ ok: true, id: 'implementer' }));
    assert.ok(!taken.ok);
  });
});

describe('Apply to repository and the chat tools use the catalog', () => {
  it('two project graphs in one repository share one identified copy of each shared role', async () => {
    const templates = temp('dsp-templates-');
    fs.cpSync(path.join(repoRoot, 'docs/loop/examples/workshop/.dspatch'), path.join(templates, '.dspatch'), { recursive: true });
    const row = discoverLoopDefinitions([templates]).rows.find((candidate) => candidate.definition?.id === 'workshop')!;
    const repository = path.join(temp('dsp-repo-'), 'kit');
    fs.mkdirSync(repository, { recursive: true });
    for (const name of ['First', 'Second']) {
      const planned = planProjectGraph({ template: row, repository, workspaceFolders: [repository], name, appVersion: 't' });
      assert.ok(planned.ok, JSON.stringify(planned));
      assert.ok(writeProjectGraph(planned.plan).ok);
    }
    const copies = fs.readdirSync(path.join(repository, '.dspatch/roles'), { recursive: true }).map(String).filter((file) => file.endsWith('.role.md')).sort();
    assert.deepEqual(copies, ['coordinator/v1.role.md', 'explorer/v1.role.md', 'implementer/v1.role.md', 'integrator/v1.role.md', 'verifier/v1.role.md'].map((file) => file.split('/').join(path.sep)));
    const second = discoverLoopDefinitions([repository]).rows.find((candidate) => candidate.definition?.id === 'second')!;
    assert.equal(second.definition?.origin?.roles.find((role) => role.id === 'implementer')?.version, 1);
    assert.ok(loadLoopGraph(fs.readFileSync(second.graphPath!, 'utf8'), { resolveRole: createFileRoleResolver(repository) }).ok);
    assert.equal(fs.existsSync(path.join(repository, '.dspatch/loops/roles')), false, 'no per-graph copies of shared roles');
    // The host lists the shared roles for the editor's picker.
    const methods = projectGraphMethods({
      workspaceFolders: () => [repository],
      ownRoot: () => repoRoot,
      appVersion: 't',
      choose: () => undefined,
      agent: () => ({ provider: null, model: null }),
      recommendRefusal: () => null,
      createAnalysisAdapter: () => {
        throw new Error('not used');
      },
    });
    const listed = await methods({ kind: 'roleCatalog', resourceRoot: repository });
    assert.ok(listed.kind === 'roleCatalog' && listed.roles.some((role) => role.id === 'work-reviewer') && listed.catalogDir === '.dspatch/roles');
  });

  it('a legacy project graph is offered an upgrade for review, and applying it writes copies, instructions and graph', async () => {
    const repository = path.join(temp('dsp-legacy-'), 'kit');
    fs.mkdirSync(path.join(repository, '.dspatch/loops/roles'), { recursive: true });
    const old = before('dspatch-chat-loop');
    for (const file of ['project-work.role.md', 'project-check.role.md']) {
      fs.copyFileSync(path.join(repoRoot, 'docs/loop/roles/project', file), path.join(repository, '.dspatch/loops/roles', file));
    }
    const local: LoopGraph = { ...old, id: 'ours', nodes: old.nodes.map((node) => (node.role === undefined ? node : { ...node, role: { ...node.role, source: { kind: 'role-source', path: `.dspatch/loops/roles/${path.basename(node.role.source.path)}` } } })) };
    fs.writeFileSync(path.join(repository, '.dspatch/loops/ours.graph.json'), serialiseLoopGraph(local));
    fs.writeFileSync(
      path.join(repository, '.dspatch/loops/ours.project.json'),
      JSON.stringify({ format: 'dspatch-project-instructions', formatVersion: 1, common: { text: '', documents: [] }, roles: { 'project-work': { text: 'WORK-RULE', documents: [] } }, nodes: {} }),
    );
    fs.writeFileSync(
      path.join(repository, '.dspatch/loops/ours.loop.json'),
      JSON.stringify({ format: 'dspatch-loop-definition', formatVersion: 1, id: 'ours', name: 'Ours', resourceRoot: '../..', graph: '.dspatch/loops/ours.graph.json', projectInstructions: 'ours.project.json' }),
    );
    const unchanged = fs.readFileSync(path.join(repository, '.dspatch/loops/ours.graph.json'), 'utf8');
    const methods = projectGraphMethods({
      workspaceFolders: () => [repository],
      ownRoot: () => repoRoot,
      appVersion: 't',
      choose: () => undefined,
      agent: () => ({ provider: null, model: null }),
      recommendRefusal: () => null,
      createAnalysisAdapter: () => {
        throw new Error('not used');
      },
    });
    const key = path.join(repository, '.dspatch/loops/ours.loop.json');
    const shown = await methods({ kind: 'roleUpgrade', definitionKey: key });
    assert.ok(shown.kind === 'roleUpgrade', JSON.stringify(shown));
    assert.deepEqual(shown.plan.mappings.map((mapping) => [mapping.nodeId, mapping.from, mapping.to]), [['work', 'project-work', 'implementer'], ['check', 'project-check', 'verifier']]);
    assert.equal(fs.readFileSync(path.join(repository, '.dspatch/loops/ours.graph.json'), 'utf8'), unchanged, 'showing it writes nothing');
    const applied = await methods({ kind: 'roleUpgradeApply', definitionKey: key, graphSha256: shown.graphSha256 });
    assert.ok(applied.kind === 'roleUpgraded', JSON.stringify(applied));
    const loaded = loadLoopGraph(fs.readFileSync(path.join(repository, '.dspatch/loops/ours.graph.json'), 'utf8'), { resolveRole: createFileRoleResolver(repository) });
    assert.ok(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.findings));
    const saved = JSON.parse(fs.readFileSync(path.join(repository, '.dspatch/loops/ours.project.json'), 'utf8')) as ProjectInstructions;
    assert.equal(saved.roles['implementer']?.text, 'WORK-RULE', 'the addition follows the role to its new identity');
    assert.equal(saved.roles['project-work'], undefined);
    // A second apply against the old digest is refused.
    assert.equal((await methods({ kind: 'roleUpgradeApply', definitionKey: key, graphSha256: shown.graphSha256 })).kind, 'refused');
  });
});
