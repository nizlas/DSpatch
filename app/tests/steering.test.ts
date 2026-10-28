/**
 * DSP-147: steering the running work, and the lock between agent work and the person's
 * own command. The chat service's real send, steer and Run paths, on the presentation
 * adapter's SIMULATED steering (shaped like the Claude adapter's: accepted at once,
 * delivered when the turn folds it in at its next step). Whether a real model reads a
 * steering message, and when, only a live run can show.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/steering.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';

import { ChatService } from '../src/main/chat-service.ts';
import { ConversationStore } from '../src/main/conversation-store.ts';
import { InstructionQueue } from '../src/main/instruction-queue.ts';
import { PresentationAdapter } from '../src/main/presentation-adapter.ts';
import { WorkingCopyLock, foldersOverlap } from '../src/main/working-copy-lock.ts';
import type { LoopInstructionEventPayload, UiAgentEvent } from '../src/shared/bridge.ts';
import { tempRoot } from './support/fixtures.ts';

const services: ChatService[] = [];
after(async () => {
  for (const service of services) {
    await service.dispose();
  }
});

function harness(name: string) {
  const root = tempRoot(`steering-${name}`);
  const workspace = path.join(root, 'project');
  fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  const store = new ConversationStore(path.join(root, 'userdata', 'conversations'));
  const lock = new WorkingCopyLock();
  const events: UiAgentEvent[] = [];
  const steering: LoopInstructionEventPayload[] = [];
  const service = new ChatService({
    repoRoot: path.join(root, 'repo-root'),
    sampleProjectsRoot: path.join(root, 'samples'),
    send: (event) => {
      events.push(event);
    },
    sendSteering: (payload) => {
      steering.push(payload);
    },
    log: () => undefined,
    conversations: () => store,
    readAuthStatus: () => Promise.resolve({ status: 'logged-in', backendUrl: 'https://example.invalid' }),
    claudeAuthorizationReference: null,
    agentChoiceStore: { read: () => 'cursor', write: () => undefined },
    workingCopyLock: lock,
    createAdapter: () => new PresentationAdapter({ deltaMs: 5 }),
  });
  services.push(service);
  return { service, workspace, store, lock, events, steering };
}

async function until(condition: () => boolean, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const finishedRuns = (events: readonly UiAgentEvent[]): number =>
  events.filter((event) => event.type === 'run.finished').length;

test('a message during a turn goes into that turn, is delivered on the runtime\'s word, and starts nothing', async () => {
  const h = harness('fold');
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  await h.service.sendPrompt('[[slow]] Look at the failing build.');
  await until(() => h.events.some((event) => event.type === 'assistant.delta'), 'the turn to be working');
  const outcome = await h.service.steerTurn('Change nothing yet; investigate first.');
  assert.equal(outcome.kind, 'received');
  await until(() => finishedRuns(h.events) === 1, 'the turn to end');
  const kinds = h.steering.map((payload) => payload.kind);
  assert.deepEqual(kinds, ['accepted', 'delivered']);
  const delivered = h.steering[1];
  assert.equal(delivered?.kind === 'delivered' ? delivered.during : undefined, true);
  // One turn, one run: steering is part of it, not a second piece of work.
  assert.equal(h.events.filter((event) => event.type === 'run.started').length, 1);
  const reply = h.events.find((event) => event.type === 'assistant.message');
  assert.match(reply?.text ?? '', /Steering taken into this turn: Change nothing yet; investigate first\./);
  // Saved with the turn it went into.
  const saved = h.store.list().entries[0];
  const message = h.store.read(saved?.conversationId ?? '').conversation?.messages[0];
  assert.equal(message?.steering?.[0]?.state, 'delivered');
  assert.equal(message?.steering?.[0]?.text, 'Change nothing yet; investigate first.');
});

test('a message the running turn cannot take waits for its end, then goes in once as the next message', async () => {
  const h = harness('declined');
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  await h.service.sendPrompt('[[slow]] [[steer-declined]] Build it.');
  await until(() => h.events.some((event) => event.type === 'assistant.delta'), 'the turn to be working');
  const outcome = await h.service.steerTurn('Also run the linter.');
  assert.equal(outcome.kind, 'received');
  await until(() => h.steering.some((payload) => payload.kind === 'waiting'), 'the waiting state');
  const waiting = h.steering.find((payload) => payload.kind === 'waiting');
  assert.equal(waiting?.kind === 'waiting' ? waiting.waitingFor : null, 'end-of-turn');
  await until(() => finishedRuns(h.events) === 1, 'the turn to end');
  assert.ok(!h.steering.some((payload) => payload.kind === 'delivered'), 'not claimed delivered');
  // The window sends it through the ordinary send once the turn has finished.
  await h.service.sendPrompt('Also run the linter.');
  await until(() => h.steering.some((payload) => payload.kind === 'delivered'), 'the delivery as the next message');
  const delivered = h.steering.find((payload) => payload.kind === 'delivered');
  assert.equal(delivered?.kind === 'delivered' ? delivered.during : 'absent', undefined);
  await until(() => finishedRuns(h.events) === 2, 'the next turn to end');
});

test('a message as the turn ends is not sent anywhere, and says so', async () => {
  const h = harness('late');
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  assert.deepEqual(await h.service.steerTurn('Anything'), { kind: 'no-running-turn' });
  await h.service.sendPrompt('Quick question.');
  await until(() => finishedRuns(h.events) === 1, 'the turn to end');
  assert.deepEqual(await h.service.steerTurn('Too late'), { kind: 'no-running-turn' });
  assert.equal(h.steering.length, 0);
});

test('agent work and the Run command exclude each other in overlapping folders, in both directions', async () => {
  const h = harness('lock');
  await h.service.startChatSession({ kind: 'folder', path: h.workspace });
  await h.service.sendPrompt('[[slow]] Work on it.');
  await until(() => h.events.some((event) => event.type === 'assistant.delta'), 'the turn to be working');
  // Run while the agent works: refused, with a reason, in the project and in a subfolder.
  await assert.rejects(
    h.service.runWorkspaceTest({ command: 'node --version', cwd: h.workspace }),
    /agent is working in this folder/,
  );
  await assert.rejects(
    h.service.runWorkspaceTest({ command: 'node --version', cwd: path.join(h.workspace, 'src') }),
    /agent is working in this folder/,
  );
  // Steering is part of the work that holds the lock, not refused by it.
  assert.equal((await h.service.steerTurn('Keep going.')).kind, 'received');
  await until(() => finishedRuns(h.events) === 1, 'the turn to end');
  // The agent's work has ended, so Run starts.
  const ran = await h.service.runWorkspaceTest({ command: 'node --version', cwd: h.workspace });
  assert.equal(ran.exitCode, 0);
  // The other direction: a person's command holds the folder, and a message is refused.
  const held = h.lock.claim({ kind: 'manual-command', folders: [path.join(h.workspace, 'src')], label: 'npm test' });
  assert.ok(held.ok);
  await assert.rejects(h.service.sendPrompt('Now fix it.'), /Your command is running in this folder \(npm test\)/);
  if (held.ok) {
    held.release();
  }
  await h.service.sendPrompt('Now fix it.');
  await until(() => finishedRuns(h.events) === 2, 'the turn after the command');
});

test('the lock compares folders, not strings: nested folders overlap and siblings do not', () => {
  const base = path.resolve('C:/work/project');
  assert.ok(foldersOverlap(base, path.join(base, 'src')));
  assert.ok(foldersOverlap(path.join(base, 'src'), base));
  assert.ok(!foldersOverlap(base, path.resolve('C:/work/project-other')));
  const lock = new WorkingCopyLock();
  const agent = lock.claim({ kind: 'agent-work', folders: [base, path.resolve('C:/work/lib')], label: 'a loop run' });
  assert.ok(agent.ok);
  // A second folder of a workspace counts as much as the first.
  const refused = lock.claim({ kind: 'manual-command', folders: [path.resolve('C:/work/lib/build')], label: 'make' });
  assert.equal(refused.ok, false);
  // Unrelated folders, and work of the same kind, are not this lock's question.
  assert.ok(lock.claim({ kind: 'manual-command', folders: [path.resolve('C:/elsewhere')], label: 'ls' }).ok);
  assert.ok(lock.claim({ kind: 'agent-work', folders: [base], label: 'the agent\'s turn' }).ok);
  if (agent.ok) {
    agent.release();
    agent.release();
  }
});

test('a message offered to the working step is out of the queue meanwhile, and goes back in its place if not taken', () => {
  const queue = new InstructionQueue();
  const first = queue.add('run-1', 'first', '2026-10-28T10:00:00.000Z');
  const second = queue.add('run-1', 'second', '2026-10-28T10:00:01.000Z');
  assert.equal(queue.withdraw(first.id)?.text, 'first');
  assert.deepEqual(queue.peekFor('run-1').map((entry) => entry.text), ['second']);
  assert.equal(queue.withdraw(first.id), null, 'not twice');
  queue.restore(first);
  queue.restore(first);
  assert.deepEqual(queue.takeFor('run-1').map((entry) => entry.id), [first.id, second.id]);
});
