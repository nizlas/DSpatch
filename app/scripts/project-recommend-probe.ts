/**
 * DSP-229: a small recommendation probe with a real agent. Applies the Workshop example to a fresh
 * synthetic repository, asks the workspace's agent (Claude, with DSpatch's own login and the
 * read-only analysis permissions) for recommendations for all and then for one step, reusing the
 * inventory, and checks that the repository is unchanged afterwards. Writes what came back to
 * <outDir>/answers.json.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/project-recommend-probe.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_PERMISSIONS, ClaudeAgentSdkAdapter } from '../src/adapter/claude-agent-sdk-adapter';
import { discoverLoopDefinitions } from '../src/main/loop-definition-files';
import { projectGraphMethods } from '../src/host/project-graph-methods';
import { emptyProjectInstructions } from '../src/shared/project-instructions';

const out = path.resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) throw new Error('usage: project-recommend-probe.ts <outDir>');
const here = path.dirname(fileURLToPath(import.meta.url));
const dspatch = path.resolve(here, '..', '..');
fs.mkdirSync(out, { recursive: true });
const templates = path.join(out, 'dspatch');
fs.cpSync(path.join(dspatch, 'docs/loop/examples/workshop/.dspatch'), path.join(templates, '.dspatch'), { recursive: true });
const repo = path.join(out, 'orders-kit');
fs.cpSync(path.join(here, 'coordination-pilot/scenario'), repo, { recursive: true });
fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# How we work here\n\n- Amounts are in öre everywhere; see docs/data/import-notes.md for data that is not.\n- Run `npm test` before you hand anything back.\n- Architecture: docs/ARCHITECTURE.md.\n');
fs.writeFileSync(path.join(repo, 'docs/ARCHITECTURE.md'), '# Architecture\n\n`src/orders.js` loads data; `src/ledger.js` computes figures; `src/format.js` is presentation only. Nothing in `src/` writes files.\n');
fs.writeFileSync(path.join(repo, 'docs/TESTING.md'), '# Testing\n\n`npm test` runs node --test. Every new module gets a test file under test/.\n');
fs.mkdirSync(path.join(repo, 'docs/old'), { recursive: true });
fs.writeFileSync(path.join(repo, 'docs/old/2023-plan.md'), '# Plan, 2023 (superseded)\n\nWe planned to store amounts in kronor. Replaced by the öre rule.\n');
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Probe');
git('config', 'user.email', 'probe@localhost');
git('config', 'commit.gpgsign', 'false');
git('add', '.');
git('commit', '-qm', 'orders-kit');

// A new adapter per request, as the host builds them; each is disposed after its request.
const claude = (): ClaudeAgentSdkAdapter =>
  new ClaudeAgentSdkAdapter({ authorization: { kind: 'subscription', authorization: 'accepted in DSpatch (claude-consent.json)' }, permissions: ANALYSIS_PERMISSIONS });
const methods = projectGraphMethods({
  workspaceFolders: () => [repo],
  ownRoot: () => templates,
  appVersion: 'probe',
  choose: () => undefined,
  agent: () => ({ provider: 'claude', model: 'sonnet' }),
  recommendRefusal: () => null,
  createAnalysisAdapter: () => claude() as never,
});
const template = discoverLoopDefinitions([templates]).rows[0];
if (template === undefined) throw new Error('no template');
const applied = await methods({ kind: 'apply', templateKey: template.filePath, repository: repo, name: 'Orders workflow', instructions: emptyProjectInstructions() });
if (applied.kind !== 'applied') throw new Error(JSON.stringify(applied));
git('add', '.');
git('commit', '-qm', 'project graph');
const source = { definitionKey: applied.definitionKey };
const t0 = Date.now();
const all = await methods({ kind: 'recommend', requestId: 'all', repository: repo, source, target: { kind: 'all' }, instructions: emptyProjectInstructions(), inventory: null });
const t1 = Date.now();
const step = all.kind === 'recommended'
  ? await methods({ kind: 'recommend', requestId: 'step', repository: repo, source, target: { kind: 'node', nodeId: 'maker' }, instructions: emptyProjectInstructions(), inventory: all.inventory })
  : null;
const t2 = Date.now();
const status = git('status', '--short');
fs.writeFileSync(path.join(out, 'answers.json'), JSON.stringify({ all, step, ms: { all: t1 - t0, step: t2 - t1 }, statusAfter: status }, null, 2));
process.stdout.write(`${JSON.stringify({ all: all.kind, step: step?.kind ?? null, ms: { all: t1 - t0, step: t2 - t1 }, repositoryUnchanged: status === '' }, null, 2)}\n`);
process.exit(0);
