/**
 * Seed the kit the `workspace-switch` window scenario runs over (DSP-4 WS-1).
 *
 * Real `ChatService`, `ConversationStore` and `ProjectStore` from this working copy,
 * driven by a fake adapter: **no provider is called and no model turn is made**. Every
 * seeded answer says so. What it writes, into an empty kit folder:
 *
 *     <kit>\userData\conversations\*.json     the four conversations
 *     <kit>\userData\dspatch-projects.json    Recent = A, B, X, X\sub, each pointing at its conversation
 *     <kit>\projects\A, B, X, X\sub            plain folders (not git repositories)
 *     <kit>\seed-summary.json                 what was written, read back through the stores
 *
 * - A: three answered messages and a passing test (`node test.js`, exit 0).
 * - B: one answered message, a reviewed diff of `src/greet.js` and a failing test (exit 1).
 * - X and X\sub: each one **command** attempt left `running`, as a DSpatch that died
 *   mid-command leaves its file, both under the same ID `dsp-attempt-0001`. Each is
 *   written in a store of its own and copied in, which is how two files come to share
 *   an ID.
 *
 * With `--unknown-turn` (DSP-124), A also holds a fourth message whose **agent-turn**
 * attempt was left `running`, as a DSpatch that died mid-turn leaves its file; the next
 * open reads it as `outcome-unknown`, which is what *Send anyway* is offered for. The
 * default kit is unchanged, so `switch` and the refused and failed phases of
 * `resume-choice` run over the same A as before.
 *
 * Run from `app/` (the kit folder must not already hold `userData` or `projects`):
 *
 *     node --import ./scripts/ts-resolve.mjs scripts/seed-switch-kit.mjs <kit-folder> [--unknown-turn]
 *
 * It prints the project paths in the order the scenario wants them, ready for
 * `DSPATCH_CHAT_SWITCH_PROJECTS`. The Verifier's and Niclas's window kits are seeded
 * with this too, so a kit on disk is the same thing the scenario was written against.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ChatService } from '../src/main/chat-service';
import { ConversationStore } from '../src/main/conversation-store';
import { ProjectStore } from '../src/main/project-store';

const kitArgument = process.argv[2];
if (kitArgument === undefined || kitArgument.trim() === '') {
  console.error('usage: node --import ./scripts/ts-resolve.mjs scripts/seed-switch-kit.mjs <kit-folder> [--unknown-turn]');
  process.exit(2);
}
const UNKNOWN_TURN = process.argv.slice(3).includes('--unknown-turn');
const KIT = path.resolve(kitArgument);
const USERDATA = path.join(KIT, 'userData');
const CONVERSATIONS = path.join(USERDATA, 'conversations');
const PROJECTS = path.join(KIT, 'projects');
const A = path.join(PROJECTS, 'A');
const B = path.join(PROJECTS, 'B');
const X = path.join(PROJECTS, 'X');
const XSUB = path.join(X, 'sub');
const NODE = process.execPath;
const APP_VERSION = 'seed-switch-kit';

if (fs.existsSync(USERDATA) || fs.existsSync(PROJECTS)) {
  console.error(`${USERDATA} or ${PROJECTS} already exists; the seed only writes into an empty kit.`);
  process.exit(2);
}
fs.mkdirSync(KIT, { recursive: true });
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-seed-switch-kit-'));

/** @param {string} message */
const log = (message) => {
  console.log(`[seed] ${message}`);
};

/**
 * @param {string} dir
 * @param {Record<string, string>} files
 */
function write(dir, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
  }
}

/**
 * A provider that answers only when told to, and refuses every resume: the seeded
 * session IDs are not real agents anywhere, and the file says so by their names.
 */
class SeedAdapter {
  id = 'seed-adapter (no provider)';

  /** @type {((event: any) => void) | null} */
  listener = null;

  sessionId = '';

  runCounter = 0;

  /** @type {string | null} */
  lastRunId = null;

  /** @param {string} id */
  resume(id) {
    return Promise.reject(
      Object.assign(new Error(`Agent ${id} not found`), {
        name: 'AgentNotFoundError',
        code: 'agent_not_found',
      }),
    );
  }

  capabilities() {
    return {
      start: 'supported',
      streaming: 'supported',
      cancel: 'supported',
      resume: 'unknown',
      modelSelection: 'supported',
      approvals: 'unsupported',
      usageReporting: 'unknown',
    };
  }

  listModels() {
    return Promise.resolve([{ id: 'seeded-no-model', displayName: 'seeded', provider: 'cursor' }]);
  }

  /** @param {{ workspacePath: string }} config */
  startSession(config) {
    this.sessionId = `dsp-session-seed-${String(Date.now())}`;
    return Promise.resolve({
      dspatchSessionId: this.sessionId,
      provider: 'cursor',
      providerSessionId: 'agent-seeded-offline-not-a-real-agent',
      createdAt: new Date().toISOString(),
      workspacePath: config.workspacePath,
    });
  }

  /**
   * @param {string} _sessionId
   * @param {(event: any) => void} listener
   */
  subscribe(_sessionId, listener) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  hasActiveRun() {
    return false;
  }

  send() {
    this.runCounter += 1;
    const dspatchRunId = `dsp-run-seed-${String(this.runCounter)}`;
    this.lastRunId = dspatchRunId;
    this.emit({ type: 'run.started', dspatchRunId });
    return Promise.resolve({ dspatchRunId });
  }

  cancel() {
    return Promise.resolve();
  }

  readUsage() {
    return Promise.resolve([]);
  }

  providerMessageTypes() {
    return {};
  }

  streamPumpFinished() {
    return null;
  }

  modelReported() {
    return null;
  }

  dispose() {
    return Promise.resolve();
  }

  /** @param {Record<string, unknown>} partial */
  emit(partial) {
    this.listener?.({
      dspatchSessionId: this.sessionId,
      dspatchRunId: partial['dspatchRunId'] ?? this.lastRunId,
      at: new Date().toISOString(),
      rawProviderEvent: null,
      ...partial,
    });
  }

  /** @param {string} text */
  answer(text) {
    this.emit({ type: 'assistant.message', text });
    this.emit({ type: 'run.finished', status: 'finished' });
  }
}

/**
 * @param {ConversationStore} store
 * @returns {{ service: ChatService, adapter: SeedAdapter }}
 */
function serviceOver(store) {
  const adapter = new SeedAdapter();
  const service = new ChatService({
    repoRoot: fs.mkdtempSync(path.join(SCRATCH, 'repo-root-')),
    send: () => {
      // No renderer here.
    },
    log: (message) => {
      log(`  ${message}`);
    },
    createAdapter: () => /** @type {any} */ (adapter),
    conversations: () => store,
    conversationForProject: () => null,
    timings: { cancelConfirmMs: 200, cancelWatchMs: 60 },
  });
  return { service, adapter };
}

/** @param {string} args */
const command = (args) => `"${NODE}" ${args}`;

/** @param {string} folder */
const folderRequest = (folder) => /** @type {any} */ ({ kind: 'folder', path: folder });

// --- The project folders: plain folders, which DSpatch handles without git ------------
write(A, {
  'README.md': '# Project A\n\nA tiny calculator used for the DSpatch WS-1 window test.\n',
  'src/calc.js': 'exports.add = (a, b) => a + b;\n',
  'test.js':
    "const { add } = require('./src/calc');\n" +
    "if (add(2, 3) !== 5) { console.error('add is wrong'); process.exit(1); }\n" +
    "console.log('A: 1 test passed');\n",
});
write(B, {
  'README.md': '# Project B\n\nA tiny greeter used for the DSpatch WS-1 window test.\n',
  'src/greet.js': 'exports.greet = (name) => `Hello, ${name}!`;\n',
  'test.js':
    "const { greet } = require('./src/greet');\n" +
    "if (greet('B') !== 'Hello, B!') { console.error('greet is wrong: ' + greet('B')); process.exit(1); }\n" +
    "console.log('B: 1 test passed');\n",
});
write(X, {
  'README.md': '# Project X\n\nThe outer folder for the shared-attempt-ID check.\n',
  'x.txt': 'x\n',
});
write(XSUB, { 'README.md': '# X/sub\n\nA folder inside X.\n', 's.txt': 's\n' });

const store = new ConversationStore(CONVERSATIONS, APP_VERSION);
/** @type {Record<string, string>} */
const ids = {};

// --- A: three answered messages and a passing test -------------------------------------
{
  const { service, adapter } = serviceOver(store);
  const session = await service.startChatSession(folderRequest(A));
  ids['A'] = session.conversationId;
  /** @type {[string, string][]} */
  const turns = [
    ['What does this project do?', 'SEEDED ANSWER (no model was called): it has one function, add, in src/calc.js, and test.js checks it.'],
    ['How do I run its test?', 'SEEDED ANSWER (no model was called): run `node test.js` in the project folder.'],
    ['Is there anything to change?', 'SEEDED ANSWER (no model was called): nothing; the test passes as it is.'],
  ];
  for (const [question, answer] of turns) {
    await service.sendPrompt(question);
    adapter.answer(answer);
  }
  const test = await service.runWorkspaceTest({ command: command('test.js'), cwd: '' });
  log(`A test: verdict=${test.verdict} exit=${String(test.exitCode)}`);
  if (UNKNOWN_TURN) {
    // A fourth message that is never answered: its attempt is saved as `running`
    // before the send, and the file is kept as it is now, because disposing the
    // service would write an ending of its own.
    await service.sendPrompt('A fourth message whose answer never came.');
    const file = store.filePathFor(session.conversationId);
    const leftRunning = fs.readFileSync(file);
    await service.dispose();
    fs.writeFileSync(file, leftRunning);
    log('A: a fourth message left with its agent-turn attempt running (--unknown-turn)');
  } else {
    await service.dispose();
  }
}

// --- B: one answered message, a reviewed diff (a change after the session opened) and a failing test
{
  const { service, adapter } = serviceOver(store);
  const session = await service.startChatSession(folderRequest(B));
  ids['B'] = session.conversationId;
  await service.sendPrompt('Make the greeting more enthusiastic.');
  adapter.answer('SEEDED ANSWER (no model was called): changed src/greet.js to add a second exclamation mark.');
  // The "agent's" change, made after the session opened, so it is in B's diff.
  fs.writeFileSync(path.join(B, 'src/greet.js'), 'exports.greet = (name) => `Hello, ${name}!!`;\n', 'utf8');
  const diff = service.getWorkspaceChanges();
  log(`B diff: changed=${JSON.stringify(diff.changed.map((file) => file.relPath))}`);
  const test = await service.runWorkspaceTest({ command: command('test.js'), cwd: '' });
  log(`B test: verdict=${test.verdict} exit=${String(test.exitCode)}`);
  await service.dispose();
}

// --- X and X\sub: each with an unresolved command attempt dsp-attempt-0001 -------------
// The file is copied while the command runs, which is the record a DSpatch that died
// mid-command leaves: state "running". Each in a store of its own, so both get the
// first attempt number.
/**
 * @param {string} project
 * @param {string} label
 */
async function runningCommandIn(project, label) {
  const own = new ConversationStore(path.join(SCRATCH, `${label}-userdata`, 'conversations'), APP_VERSION);
  const { service } = serviceOver(own);
  const session = await service.startChatSession(folderRequest(project));
  const pending = service.runWorkspaceTest({
    command: command('-e "setTimeout(function () {}, 60000)"'),
    cwd: '',
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 800);
  });
  fs.mkdirSync(CONVERSATIONS, { recursive: true });
  fs.copyFileSync(own.filePathFor(session.conversationId), store.filePathFor(session.conversationId));
  await service.dispose(); // ends the command; the copy already holds the running record
  await pending.catch(() => undefined);
  return session.conversationId;
}
ids['X'] = await runningCommandIn(X, 'X');
ids['XSUB'] = await runningCommandIn(XSUB, 'XSUB');

// --- Recent, newest first, each with its conversation ------------------------------
const projects = new ProjectStore(path.join(USERDATA, 'dspatch-projects.json'));
const base = Date.now() - 60 * 60 * 1000;
/** @type {[string, string][]} */
const order = [
  [XSUB, ids['XSUB'] ?? ''],
  [X, ids['X'] ?? ''],
  [B, ids['B'] ?? ''],
  [A, ids['A'] ?? ''],
];
order.forEach(([project, conversationId], index) => {
  const state = projects.recordOpened(project, {
    conversationId,
    atUtc: new Date(base + index * 60_000).toISOString(),
  });
  if (state.error !== null) {
    throw new Error(state.error);
  }
});

// --- Read everything back through the real stores ----------------------------------
/** @type {Record<string, unknown>} */
const readBack = {};
for (const [name, id] of Object.entries(ids)) {
  const read = store.read(id);
  if (read.conversation === null) {
    throw new Error(`${name} does not read back: ${String(read.error)}`);
  }
  const conversation = read.conversation;
  readBack[name] = {
    conversationId: id,
    project: conversation.project.path,
    formatVersion: conversation.formatVersion,
    messages: conversation.messages.length,
    attempts: conversation.attempts.map((attempt) => `${attempt.attemptId}:${attempt.kind}:${attempt.state}`),
    testRuns: conversation.testRuns.map((run) => `${String(run.attemptId)}:${run.verdict}:exit=${String(run.exitCode)}`),
    reviewedDiff:
      conversation.reviewedDiff === null
        ? null
        : {
            changed: conversation.reviewedDiff.changed.map((file) => file.relPath),
            added: conversation.reviewedDiff.added.map((file) => file.relPath),
          },
  };
}
const listing = store.list();
const projectState = projects.read();
const summary = {
  seededBy: 'scripts/seed-switch-kit.mjs — no provider called, no model turn',
  kit: KIT,
  userData: USERDATA,
  projectsInScenarioOrder: [A, B, X, XSUB],
  ids,
  readBack,
  listing: {
    error: listing.error,
    entries: listing.entries.map((entry) => ({
      id: entry.conversationId,
      project: entry.projectPath,
      unresolved: entry.unresolvedAttemptCount,
      error: entry.error,
    })),
  },
  projectStore: {
    error: projectState.error,
    readOnly: projectState.readOnly,
    formatVersion: projectState.formatVersion,
    recent: projectState.recentProjects.map((entry) => ({
      path: entry.path,
      conversation: entry.lastConversationId,
    })),
  },
};
fs.writeFileSync(path.join(KIT, 'seed-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
fs.rmSync(SCRATCH, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
console.log(JSON.stringify(summary, null, 2));
console.log(`DSPATCH_CHAT_SWITCH_PROJECTS=${[A, B, X, XSUB].join(';')}`);
