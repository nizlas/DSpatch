/**
 * DSP-227: a bounded pilot of real-agent coordination between parallel branches.
 *
 * Usage, from app/:
 *   node --import ./scripts/ts-resolve.mjs scripts/coordination-pilot/pilot.ts <variant> <outDir>
 * where <variant> is `mailbox` (branches get send_message, check_messages, acknowledge_message) or
 * `none` (they get no mailbox and are told nothing of one), and <outDir> is a fresh folder outside
 * every project.
 *
 * Each run starts from the same synthetic repository (`scenario/`, a copy made new per run) and the
 * same graph, built here with the reusable sections: a lead that proposes the split, a fan-out of two
 * branches, a joiner that integrates. The lead is scripted — it writes the same split every time —
 * so both variants begin from one identical split; the two branches and the joiner are real Claude
 * agents through DSpatch's own run engine, with the login DSpatch already has (claude-consent.json).
 * Nothing in a prompt names the detail the pilot is about: it is in the repository's code and data.
 *
 * Afterwards the pilot checks, without telling any agent, whether each branch's own commit and the
 * integrated working copy handle the stored data correctly, and writes `summary.json` beside the
 * run's journal.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHAT_PERMISSIONS, ClaudeAgentSdkAdapter } from '../../src/adapter/claude-agent-sdk-adapter';
import type { AgentEvent, AgentEventListener } from '../../src/adapter/types';
import type { ChatAdapter } from '../../src/main/chat-service';
import { createFileRoleResolver } from '../../src/main/loop-graph-roles';
import { runLiveGraph } from '../../src/main/loop-live-run';
import { chatPromptFor, skippingRoutesOf } from '../../src/shared/loop-chat';
import type { LoopGraph } from '../../src/shared/loop-graph';
import { formatFindings, loadLoopGraph, parseLoopGraph } from '../../src/shared/loop-graph-load';
import { applyChoiceSection, applyParallelSection, modelClassChoiceTemplate } from '../../src/shared/loop-graph-sections';
import type { RunJournalEntry } from '../../src/shared/loop-run';

const here = path.dirname(fileURLToPath(import.meta.url));
const variant = process.argv[2];
const outDir = path.resolve(process.argv[3] ?? '');
if ((variant !== 'mailbox' && variant !== 'none') || process.argv[3] === undefined) {
  throw new Error('usage: pilot.ts mailbox|none <outDir>');
}
fs.mkdirSync(outDir, { recursive: true });

const role = (name: string) => ({ id: `pilot-${name}`, source: { kind: 'role-source' as const, path: `roles/pilot-${name}.role.md` } });

/** The bare graph, then its sections, as a graph builder would add them. */
function pilotGraph(): LoopGraph {
  const bare = parseLoopGraph(
    JSON.stringify({
      format: 'dspatch-loop-graph',
      formatVersion: 1,
      id: 'coordination-pilot',
      name: 'Coordination pilot',
      purpose: 'A lead splits a request into two parallel parts; a joiner integrates and checks them.',
      target: 'claude-code',
      entry: 'lead',
      onRuntimeFault: 'stop-and-reconcile',
      failureKinds: [],
      limits: { maxCalls: 8 },
      nodes: [
        { id: 'lead', kind: 'agent', label: 'Lead', purpose: 'Decide whether one worker does the request, or whether it splits into independent parts.', role: role('lead'), outcomes: ['solo', 'split'], produces: { required: true, form: 'stored-result' } },
        { id: 'solo-worker', kind: 'agent', label: 'Worker', purpose: 'Make the change asked for and run its check.', role: role('worker'), produces: { required: true, form: 'stored-result' } },
        { id: 'done', kind: 'terminal', label: 'Done', ending: 'success' },
        { id: 'halted', kind: 'terminal', label: 'Halted', ending: 'not-success' },
      ],
      edges: [
        { id: 'e1', from: 'lead', to: 'solo-worker', when: { on: 'outcome', outcome: 'solo' } },
        { id: 'e2', from: 'solo-worker', to: 'done', when: { on: 'success' } },
      ],
    }),
  );
  if (!bare.ok) throw new Error(formatFindings(bare.findings));
  const withSize = applyChoiceSection(bare.graph, { choice: modelClassChoiceTemplate('size'), decidedBy: ['lead'], appliesTo: [{ nodeId: 'solo-worker' }] });
  const parallel = applyParallelSection(withSize.graph, {
    proposer: 'lead',
    splitOutcome: 'split',
    branches: { id: 'parts', label: 'Parts in parallel', role: role('worker') },
    branchAs: [],
    sliceChoices: ['size'],
    branchModelChoice: 'size',
    maxConcurrent: 2,
    isolation: 'worktree',
    integrator: {
      id: 'joiner',
      label: 'Joiner',
      role: role('joiner'),
      purpose:
        "Combine the parts into the working copy: read each part's result and ending and any messages between the parts; merge the temporary " +
        'branches in the order listed with git, resolve conflicts and name each merge and resolution. Then run npm test, and check with the ' +
        'shipped data that the whole works together: the TOTAL row of ordersCsv(loadOrders()) must equal the sum of the values of ' +
        "revenueByMonth(loadOrders()), and both must equal the quarter's total in docs/accounting/2024-q1.md. Report what you ran and its output. Choose integrated only when every part is merged " +
        'and those checks pass. Choose rework, with concrete findings per part, when a part must change. Choose needs-decision when a part ' +
        'failed or something needs a decision. Never delete a temporary branch.',
      model: { policy: 'select', options: [{ id: 'steady', modelClass: 'medium' }], default: 'steady' },
    },
    outcomes: { integrated: 'integrated', rework: 'rework', unresolved: 'needs-decision' },
    afterIntegration: { to: 'done' },
    onUnresolved: 'halted',
    onLimit: 'halted',
  });
  if (parallel.problems.length > 0) throw new Error(parallel.problems.join(' '));
  const loaded = loadLoopGraph(JSON.stringify(parallel.graph), { resolveRole: createFileRoleResolver(here) });
  if (!loaded.ok) throw new Error(formatFindings(loaded.findings));
  return loaded.graph;
}

const FENCE = '```';
/** The lead's reply, the same in every run. */
const LEAD_REPLY = [
  'The request has two independent parts: monthly revenue in the ledger and a CSV export. They write different files and neither needs the other\'s result.',
  '',
  'CHOICE: size medium both parts follow the existing patterns',
  '',
  `${FENCE}dspatch-slices`,
  JSON.stringify(
    {
      slices: [
        {
          id: 'monthly',
          result:
            "Add revenueByMonth(orders) to src/ledger.js: an object from 'YYYY-MM', the month an order was placed, to that month's revenue in öre. Add a test in test/ledger-monthly.test.js.",
          ownedPaths: ['src/ledger.js', 'test/ledger-monthly.test.js'],
          allowedActions: ['edit', 'run tests'],
          contractRefs: ['README.md: amounts are in öre', "docs/accounting/2024-q1.md: the bookkeeper's Q1 figures", 'src/orders.js: loadOrders() returns the stored order records'],
          acceptance: "revenueByMonth(loadOrders()) equals the bookkeeper's figure in docs/accounting/2024-q1.md for each month of the quarter.",
          verification: 'npm test',
          choices: { size: 'medium' },
        },
        {
          id: 'export',
          result:
            'Add src/export.js with ordersCsv(orders): the CSV the accounting team imports, with the header id,month,amount_ore, one row per order, and a last row TOTAL,,<the sum of amount_ore>. Add a test in test/export.test.js.',
          ownedPaths: ['src/export.js', 'test/export.test.js'],
          allowedActions: ['edit', 'run tests'],
          contractRefs: ['README.md: amounts are in öre', 'src/orders.js: loadOrders() returns the stored order records'],
          acceptance: 'ordersCsv(loadOrders()) gives the accounting CSV of the shipped data, amounts in öre.',
          verification: 'npm test',
          choices: { size: 'medium' },
        },
      ],
    },
    null,
    2,
  ),
  FENCE,
  '',
  'RESULT: split',
].join('\n');

const MANDATE =
  'Add two things to orders-kit for the accounting team: the revenue of each month in the ledger, and a CSV export of the orders. Do them in parallel if they are independent.';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** A fresh copy of the scenario, committed once, so every run starts from one base. */
function freshRepo(): string {
  const repo = path.join(outDir, 'repo');
  fs.cpSync(path.join(here, 'scenario'), repo, { recursive: true });
  git(repo, 'init', '--quiet', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Pilot');
  git(repo, 'config', 'user.email', 'pilot@localhost');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'orders-kit');
  return repo;
}

/**
 * The real Claude adapter, with the lead's turn answered by script: every method the live run
 * calls, routed by session id, so the lead's session never reaches the provider.
 */
function adapterWithScriptedLead(real: ClaudeAgentSdkAdapter): ChatAdapter {
  const listeners = new Map<string, AgentEventListener>();
  const scripted = (id: string | undefined): boolean => /--lead(--visit-\d+)?$/.test(id ?? '');
  const on = real as unknown as Record<string, (...args: unknown[]) => unknown>;
  const router = {
    startSession: (config: { dspatchSessionId?: string }) =>
      scripted(config.dspatchSessionId)
        ? Promise.resolve({ dspatchSessionId: config.dspatchSessionId, provider: 'claude', providerSessionId: `scripted-${config.dspatchSessionId ?? ''}`, createdAt: new Date().toISOString() })
        : on['startSession']!.call(real, config),
    subscribe: (sessionId: string, listener: AgentEventListener) => {
      if (!scripted(sessionId)) return on['subscribe']!.call(real, sessionId, listener);
      listeners.set(sessionId, listener);
      return () => listeners.delete(sessionId);
    },
    send: (sessionId: string, prompt: string, ...rest: unknown[]) => {
      if (!scripted(sessionId)) {
        fs.mkdirSync(path.join(outDir, 'prompts'), { recursive: true });
        fs.appendFileSync(path.join(outDir, 'prompts', `${sessionId.replace(/[^A-Za-z0-9._+-]+/g, '_')}.txt`), `${prompt}\n\n=====\n\n`);
        return on['send']!.call(real, sessionId, prompt, ...rest);
      }
      fs.writeFileSync(path.join(outDir, 'lead-prompt.txt'), prompt);
      const runId = `${sessionId}-1`;
      setImmediate(() => {
        const emit = (event: Partial<AgentEvent>): void => {
          void listeners.get(sessionId)?.({ dspatchSessionId: sessionId, dspatchRunId: runId, at: new Date().toISOString(), rawProviderEvent: null, ...event } as AgentEvent);
        };
        emit({ type: 'run.started' } as Partial<AgentEvent>);
        emit({ type: 'assistant.message', text: LEAD_REPLY } as Partial<AgentEvent>);
        emit({ type: 'run.finished', status: 'finished' } as Partial<AgentEvent>);
      });
      return Promise.resolve({ dspatchRunId: runId });
    },
    cancel: (sessionId: string) => (scripted(sessionId) ? Promise.resolve() : on['cancel']!.call(real, sessionId)),
    readUsage: (sessionId: string) => (scripted(sessionId) ? Promise.resolve([]) : on['readUsage']!.call(real, sessionId)),
    steer: (sessionId: string, ...rest: unknown[]) => on['steer']!.call(real, sessionId, ...rest),
    setSessionModel: (sessionId: string, model: string) => (scripted(sessionId) ? undefined : on['setSessionModel']!.call(real, sessionId, model)),
    modelReported: (sessionId: string) => (scripted(sessionId) ? null : on['modelReported']!.call(real, sessionId)),
    dispose: () => on['dispose']!.call(real),
  };
  return router as unknown as ChatAdapter;
}

/** The hidden check: what the data's revenue really is, against what the code says. */
function check(dir: string): Record<string, unknown> {
  const script = `
    const { loadOrders } = require('./src/orders');
    const orders = loadOrders();
    const ore = (o) => (o.source === 'till-v1' ? o.amount * 100 : o.amount);
    const truth = orders.reduce((s, o) => s + ore(o), 0);
    const out = { truthTotalOre: truth };
    try {
      const { ordersCsv } = require('./src/export');
      const csv = String(ordersCsv(orders)).trim().split(/\\r?\\n/);
      const total = csv.find((line) => line.startsWith('TOTAL'));
      out.csvTotal = total === undefined ? null : Number(total.split(',').pop());
      out.csvTillRow = csv.find((line) => line.startsWith('A-1002')) ?? null;
      out.csvCorrect = out.csvTotal === truth && /,18000$/.test(out.csvTillRow ?? '');
    } catch (error) { out.csvError = String(error && error.message || error); }
    try {
      const { revenueByMonth } = require('./src/ledger');
      const months = revenueByMonth(orders);
      out.monthly = months;
      out.monthlySum = Object.values(months).reduce((s, v) => s + Number(v), 0);
      out.monthlyCorrect = months['2024-01'] === 60900 && months['2024-02'] === 172490 && months['2024-03'] === 174550;
    } catch (error) { out.monthlyError = String(error && error.message || error); }
    process.stdout.write(JSON.stringify(out));
  `;
  try {
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: dir, encoding: 'utf8', timeout: 20000 })) as Record<string, unknown>;
  } catch (error) {
    return { error: String(error) };
  }
}

/** Each temporary branch's own commit, checked out alone into a scratch folder. */
function checkBranch(repo: string, branch: string): Record<string, unknown> {
  const dir = path.join(outDir, 'check', branch.replace(/[^A-Za-z0-9._-]+/g, '_'));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const archive = execFileSync('git', ['archive', branch], { cwd: repo, maxBuffer: 1 << 24 });
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  let tests: string;
  try {
    tests = execFileSync('npm', ['test', '--silent'], { cwd: dir, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).slice(-400);
  } catch (error) {
    tests = `FAILED: ${String((error as { stdout?: string }).stdout ?? error).slice(-400)}`;
  }
  return { ...check(dir), tests, diffFromBase: git(repo, 'diff', '--stat', 'main', branch) };
}

const repo = freshRepo();
const graph = pilotGraph();
fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
const entries: RunJournalEntry[] = [];
const activity: unknown[] = [];
const resolveRole = createFileRoleResolver(here);
const started = Date.now();
const real = new ClaudeAgentSdkAdapter({
  authorization: { kind: 'subscription', authorization: 'accepted in DSpatch (claude-consent.json)' },
  permissions: CHAT_PERMISSIONS,
});
const delivery = await runLiveGraph(graph, {
  runId: `pilot-${variant}`,
  repoRoot: here,
  outDir: path.join(outDir, 'run'),
  resultsDir: path.join(outDir, 'results'),
  modelRequested: 'sonnet',
  personModel: 'sonnet',
  modelClasses: { small: 'haiku', medium: 'sonnet', large: 'opus' },
  workspacePath: repo,
  keepWorkspace: true,
  bindingKind: 'chat-loop',
  provider: 'claude',
  branchMessaging: variant === 'mailbox',
  createAdapter: () => adapterWithScriptedLead(real),
  onJournalEntry: (entry) => {
    entries.push(entry);
    fs.appendFileSync(path.join(outDir, 'journal.jsonl'), `${JSON.stringify(entry)}\n`);
  },
  onStepActivity: (event) => {
    activity.push(event);
    fs.appendFileSync(path.join(outDir, 'activity.jsonl'), `${JSON.stringify(event)}\n`);
  },
  promptFor: (node, step) =>
    chatPromptFor(node, {
      entryId: graph.entry,
      mandate: MANDATE,
      step,
      role: (() => {
        const resolved = node.role === undefined ? null : resolveRole(node.role);
        return resolved === null ? null : { id: resolved.id, sourcePath: resolved.sourcePath, instructions: resolved.instructions ?? null };
      })(),
      skipping: skippingRoutesOf(graph, node.id),
    }),
});
const ms = Date.now() - started;

const branchesStarted = entries.filter((entry) => entry.kind === 'branch-started');
const branchesEnded = entries.filter((entry) => entry.kind === 'branch-ended');
const branchNames = branchesEnded.map((entry) => String(entry.data?.['branch'] ?? '')).filter((name) => name !== '');
const summary = {
  variant,
  status: delivery.result.status,
  fault: delivery.result.fault ?? null,
  durationMs: ms,
  path: delivery.result.path,
  edgesTaken: delivery.result.edgesTaken,
  branches: branchesStarted.map((entry) => ({ slice: entry.data?.['sliceId'], at: entry.atIso, sinceStartMs: entry.sinceStartMs, model: entry.data?.['model'] })),
  branchEnds: branchesEnded.map((entry) => ({ slice: entry.data?.['sliceId'], at: entry.atIso, sinceStartMs: entry.sinceStartMs, data: entry.data })),
  mail: entries.filter((entry) => String(entry.kind).startsWith('message-')).map((entry) => ({ kind: entry.kind, at: entry.atIso, sinceStartMs: entry.sinceStartMs, detail: entry.detail, data: entry.data })),
  usage: delivery.inspection.usageReadings,
  perBranch: Object.fromEntries(branchNames.map((name) => [name, checkBranch(repo, name)])),
  integrated: check(repo),
  integratedLog: git(repo, 'log', '--oneline', '-8'),
  integratedStatus: git(repo, 'status', '--short'),
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
process.stdout.write(`${JSON.stringify({ variant, status: summary.status, durationMs: ms, integrated: summary.integrated, mail: summary.mail.length }, null, 2)}\n`);
await real.dispose?.();
process.exit(0);
