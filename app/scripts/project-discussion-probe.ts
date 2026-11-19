/**
 * DSP-230: a small probe of "Discuss project instructions" with a real agent. Applies the Workshop
 * example to a fresh synthetic repository that also holds an earlier VS Code agent definition, makes
 * one unsaved edit to the draft, and sends one chat message through DSpatch's own chat service with
 * the discussion context in front of it, as the main chat does, to Claude (DSpatch's own login, the
 * chat's permissions and its in-process tools). Checks that the agent proposed through the tool,
 * that the proposal names levels, steps and sources, and that neither the draft, the instructions
 * file nor the repository changed. Writes what came back to <outDir>/discussion.json.
 *
 *   node --import ./scripts/ts-resolve.mjs scripts/project-discussion-probe.ts <outDir>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHAT_PERMISSIONS, ClaudeAgentSdkAdapter } from '../src/adapter/claude-agent-sdk-adapter';
import { ChatService } from '../src/main/chat-service';
import { ConversationStore } from '../src/main/conversation-store';
import { discoverLoopDefinitions } from '../src/main/loop-definition-files';
import { projectGraphService } from '../src/host/project-graph-methods';
import { projectInstructionTools } from '../src/host/project-instruction-tools';
import { discussionContext } from '../src/shared/project-draft';
import { emptyProjectInstructions } from '../src/shared/project-instructions';

const out = path.resolve(process.argv[2] ?? '');
if (process.argv[2] === undefined) throw new Error('usage: project-discussion-probe.ts <outDir>');
const here = path.dirname(fileURLToPath(import.meta.url));
const dspatch = path.resolve(here, '..', '..');
fs.mkdirSync(out, { recursive: true });
const templates = path.join(out, 'dspatch');
fs.cpSync(path.join(dspatch, 'docs/loop/examples/workshop/.dspatch'), path.join(templates, '.dspatch'), { recursive: true });
const repo = path.join(out, 'orders-kit');
fs.cpSync(path.join(here, 'coordination-pilot/scenario'), repo, { recursive: true });
fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# How we work here\n\n- Amounts are in öre everywhere.\n- Run `npm test` before you hand anything back.\n');
fs.mkdirSync(path.join(repo, '.github/agents'), { recursive: true });
fs.writeFileSync(
  path.join(repo, '.github/agents/maker.agent.md'),
  '---\nname: maker\n---\n# Maker (VS Code agent, 2024)\n\n- Store amounts in kronor with two decimals.\n- Add a test file under test/ for every new module.\n- Never edit files outside src/ and test/.\n',
);
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
git('init', '-q', '-b', 'main');
git('config', 'user.name', 'Probe');
git('config', 'user.email', 'probe@localhost');
git('config', 'commit.gpgsign', 'false');
git('add', '.');
git('commit', '-qm', 'orders-kit');

const service = projectGraphService({
  workspaceFolders: () => [repo],
  ownRoot: () => templates,
  appVersion: 'probe',
  choose: () => undefined,
  agent: () => ({ provider: 'claude', model: 'sonnet' }),
  recommendRefusal: () => null,
  createAnalysisAdapter: () => {
    throw new Error('not used');
  },
  draftsDir: path.join(out, 'drafts'),
});
const template = discoverLoopDefinitions([templates]).rows[0];
if (template === undefined) throw new Error('no template');
const applied = await service.handle({ kind: 'apply', templateKey: template.filePath, repository: repo, name: 'Orders workflow', instructions: emptyProjectInstructions() });
if (applied.kind !== 'applied') throw new Error(JSON.stringify(applied));
git('add', '.');
git('commit', '-qm', 'project graph');
const key = applied.definitionKey;
// One unsaved edit, which the agent should see as unsaved.
service.drafts.edit(key, [{ level: 'common', section: { text: 'Amounts are in öre everywhere (see AGENTS.md).', documents: [{ path: 'AGENTS.md', purpose: 'project rules', when: 'before starting' }] } }]);
const instructionsFile = path.join(repo, '.dspatch/loops/orders-workflow.project.json');
const fileBefore = fs.readFileSync(instructionsFile, 'utf8');
const draftBefore = JSON.stringify(service.drafts.view(key).ok ? (service.drafts.view(key) as { view: { draft: unknown } }).view.draft : null);

let conversationId: string | null = null;
let turnRunId: string | null = null;
let finished: () => void = () => undefined;
const done = new Promise<void>((resolve) => {
  finished = resolve;
});
const events: string[] = [];
const userData = path.join(out, 'userdata');
const chat = new ChatService({
  agentChoiceStore: { read: () => 'claude', write: () => undefined },
  // The login DSpatch already has; the SDK is the one this checkout's DSP-229 probe used.
  claudeAuthorizationReference: 'accepted in DSpatch (claude-consent.json)',
  claudeSupport: { installed: true, reason: null },
  repoRoot: dspatch,
  send: (event) => {
    events.push(event.type);
    if (event.type === 'run.started') turnRunId = event.dspatchRunId;
    if (event.type === 'run.finished') finished();
  },
  log: () => undefined,
  createAdapter: () => new ClaudeAgentSdkAdapter({ authorization: { kind: 'subscription', authorization: 'accepted in DSpatch (claude-consent.json)' }, permissions: CHAT_PERMISSIONS }) as never,
  conversations: () => new ConversationStore(path.join(userData, 'conversations')),
  appTools: () =>
    projectInstructionTools({
      drafts: service.drafts,
      definitionKeyFor: (id) => service.definitionKeyFor(id),
      conversationId: () => conversationId,
      turnRunId: () => turnRunId,
    }),
});
const session = await chat.startChatSession({ kind: 'folder', path: repo });
conversationId = session.conversationId;
const view = service.drafts.view(key);
if (!view.ok) throw new Error(view.problem);
const context = discussionContext(view.view, { nodeId: 'maker' });
const t0 = Date.now();
await chat.sendPrompt(
  'We used to work with the VS Code agent definition in .github/agents/maker.agent.md. Which of its rules still hold for the maker step here, ' +
    'given AGENTS.md? Propose the ones that do as changes at the right level, with their source, and leave out what is outdated. Do not edit any file.',
  [],
  context,
);
await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 240_000))]);
const ms = Date.now() - t0;
const answer = service.drafts.view(key);
const proposals = answer.ok ? answer.view.proposals : [];
const draftAfter = answer.ok ? JSON.stringify(answer.view.draft) : null;
const status = git('status', '--short');
const result = {
  ms,
  finished: events.includes('run.finished'),
  proposals: proposals.map((proposal) => ({
    explanation: proposal.explanation,
    changes: proposal.changes.map((change) => ({ level: change.level, action: change.action, steps: change.steps, reason: change.reason, sources: change.sources, after: change.after })),
  })),
  draftUnchanged: draftAfter === draftBefore,
  fileUnchanged: fs.readFileSync(instructionsFile, 'utf8') === fileBefore,
  repositoryStatus: status,
  answerText: chat.getRunState(),
};
fs.writeFileSync(path.join(out, 'discussion.json'), JSON.stringify(result, null, 2));
process.stdout.write(
  `${JSON.stringify({ ms, finished: result.finished, proposals: result.proposals.length, levels: result.proposals.flatMap((p) => p.changes.map((c) => `${c.action} ${c.level} (${String(c.steps.length)} steps, ${String(c.sources.length)} sources)`)), draftUnchanged: result.draftUnchanged, fileUnchanged: result.fileUnchanged, repositoryUnchanged: status === '' }, null, 2)}\n`,
);
await chat.dispose();
process.exit(0);
