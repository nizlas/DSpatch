/**
 * DSP-209 S11: messages between running branches, through the runner.
 *
 * Two branches of one fan-out run at once with a scripted executor: A sends B a finding, B
 * checks before it ends, receives it and acknowledges it; a contract change becomes an open
 * proposal in the fan-out's result; the person's instruction reaches both branches at their
 * next check. Read-only branches, so no git is needed. No provider.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CHAT_LOOP_WINDOW_LOOKUP, formatChatLiveLogLine } from '../src/shared/loop-chat';
import { LOOP_GRAPH_FORMAT, LOOP_GRAPH_FORMAT_VERSION, type LoopGraph } from '../src/shared/loop-graph';
import { createMemoryResultStore } from '../src/shared/loop-results';
import { runLoopGraph, type RunJournalEntry, type StepExecutor } from '../src/shared/loop-run';
import { describeMessageCounts, messageCountsIn, runViewFor } from '../src/shared/loop-run-view';

const FENCE = '```';

function graph(): LoopGraph {
  return {
    format: LOOP_GRAPH_FORMAT,
    formatVersion: LOOP_GRAPH_FORMAT_VERSION,
    id: 'mail',
    name: 'Mailbox',
    purpose: 'Two branches that talk.',
    target: 'cursor',
    entry: 'slice',
    onRuntimeFault: 'stop-and-reconcile',
    failureKinds: [{ id: 'branch-failed', label: 'branch failed', meaning: 'A branch failed.' }],
    nodes: [
      { id: 'slice', kind: 'agent', label: 'Slice', produces: { required: true, form: 'stored-result' } },
      { id: 'work', kind: 'agent', label: 'Work', declaredFailures: ['branch-failed'], produces: { required: false, form: 'stored-result' }, fanOut: { slicesFrom: 'slice', maxConcurrent: 2, isolation: 'shared-read-only' } },
      { id: 'done', kind: 'terminal', label: 'Done' },
      { id: 'failed', kind: 'terminal', label: 'Failed', ending: 'not-success' },
    ],
    edges: [
      { id: 'e1', from: 'slice', to: 'work', when: { on: 'success' } },
      { id: 'e2', from: 'work', to: 'done', when: { on: 'success' } },
      { id: 'e3', from: 'work', to: 'failed', when: { on: 'declared-failure', failure: 'branch-failed' } },
    ],
  };
}

const SLICES = `${FENCE}dspatch-slices\n${JSON.stringify({
  slices: ['a', 'b'].map((id) => ({ id, result: `${id} done`, ownedPaths: [], allowedActions: [], contractRefs: [], verification: 'read' })),
})}\n${FENCE}`;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('messages between running branches (DSP-209 S11)', () => {
  it('lets A send B a finding that B receives before it ends and acknowledges, with sent, delivered and acknowledged in order', async () => {
    const aSent = deferred();
    const bEnded = deferred();
    const refusals: string[] = [];
    let instructionsAsked = 0;
    const executor: StepExecutor = async (context) => {
      const instance = context.instance;
      if (instance === undefined) {
        return { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: SLICES };
      }
      if (instance.sliceId === 'a') {
        assert.ok(instance.mailbox.send({ to: 'b', purpose: 'finding', body: 'The cache key now includes the locale.' }).ok);
        assert.ok(instance.mailbox.send({ to: 'all', purpose: 'contract-change', body: 'Make the key a tuple.', contractRef: 'docs/cache.md@v1' }).ok);
        assert.equal(instance.mailbox.check().length, 1, 'A gets the person\'s instruction');
        aSent.resolve();
        await bEnded.promise;
        const late = instance.mailbox.send({ to: 'b', purpose: 'question', body: 'Still there?' });
        refusals.push(late.ok ? 'sent' : late.reason);
        return { product: { kind: 'success' }, summary: 'a', providerTurns: 1, resultBody: 'A done.' };
      }
      await aSent.promise;
      const received = instance.mailbox.check();
      const finding = received.find((message) => message.purpose === 'finding');
      assert.ok(finding !== undefined);
      assert.deepEqual(instance.mailbox.acknowledge(finding.id), { ok: true });
      setTimeout(() => bEnded.resolve(), 0);
      return { product: { kind: 'success' }, summary: 'b', providerTurns: 1, resultBody: 'B done.' };
    };
    const result = await runLoopGraph(graph(), {
      runId: 'run-mail',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      takeInstructions: () => {
        instructionsAsked += 1;
        return instructionsAsked === 1 ? [{ id: 'i1', text: 'Keep the public API unchanged.' }] : [];
      },
      executor,
    });
    assert.equal(result.status, 'completed', result.fault?.detail ?? '');
    assert.equal(result.terminalNodeId, 'done');

    const messageLines = (kinds: readonly string[]): readonly RunJournalEntry[] =>
      result.journal.filter((entry) => kinds.includes(entry.kind));
    const findingId = messageLines(['message-sent']).find((entry) => entry.data?.['purpose'] === 'finding')?.data?.['messageId'];
    const forFinding = messageLines(['message-sent', 'message-delivered', 'message-acknowledged']).filter(
      (entry) => entry.data?.['messageId'] === findingId,
    );
    assert.deepEqual(forFinding.map((entry) => entry.kind), ['message-sent', 'message-delivered', 'message-acknowledged']);

    // The person's instruction reached both branches at their next check.
    const instruction = messageLines(['message-sent']).find((entry) => entry.data?.['from'] === 'the person');
    assert.equal(instruction?.data?.['recipients'], 'a, b');
    const deliveredInstruction = messageLines(['message-delivered']).filter((entry) => entry.data?.['messageId'] === instruction?.data?.['messageId']);
    assert.deepEqual(deliveredInstruction.map((entry) => entry.data?.['to']).sort(), ['a', 'b']);

    // A's late question to the ended B was refused and recorded; nothing restarted B.
    assert.match(refusals[0] ?? '', /already ended/);
    assert.ok(messageLines(['message-undelivered']).some((entry) => entry.data?.['reason'] === 'recipient-ended'));
    assert.equal(result.journal.filter((entry) => entry.kind === 'branch-started').length, 2, 'no branch was started again');

    // The contract change is listed for the integrator as an open proposal, beside every message.
    const stored = result.results.find((entry) => entry.nodeId === 'work');
    assert.match(stored?.body ?? '', /## Open proposals for the integrator[\s\S]*contract-change from a to all, about docs\/cache\.md@v1[\s\S]*> Make the key a tuple\./);
    assert.match(stored?.body ?? '', /## Messages between the branches[\s\S]*> The cache key now includes the locale\./);

    const counts = messageCountsIn({ ...runViewFor({ runId: 'r', graphVersionId: 'g', graphId: 'mail', graphName: 'Mailbox', binding: 'chat-loop', graphText: '{}', startedAtUtc: '2026-11-14T05:00:00.000Z' }), entries: result.journal, ended: true, status: 'completed' }).get('work');
    assert.match(describeMessageCounts(counts) ?? '', /^messages: 3 sent, \d+ delivered, 1 acknowledged, 1 undelivered$/);
  });

  it('records undelivered a message its recipient ended without checking', async () => {
    const executor: StepExecutor = async (context) => {
      const instance = context.instance;
      if (instance === undefined) {
        return { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: SLICES };
      }
      if (instance.sliceId === 'a') {
        instance.mailbox.send({ to: 'b', purpose: 'finding', body: 'B never looks.' });
      }
      return { product: { kind: 'success' }, summary: instance.sliceId, providerTurns: 1, resultBody: 'done' };
    };
    const result = await runLoopGraph(graph(), {
      runId: 'run-unread',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      executor,
    });
    const undelivered = result.journal.filter((entry) => entry.kind === 'message-undelivered');
    assert.deepEqual(undelivered.map((entry) => [entry.data?.['to'], entry.data?.['reason']]), [['b', 'recipient-ended-unchecked']]);
  });

  it('says each message in the conversation: who to whom, why, the words as the sender\'s, and when it is delivered', () => {
    const line = (kind: RunJournalEntry['kind'], data: Record<string, string | number | boolean>) =>
      formatChatLiveLogLine({ seq: 1, atIso: '', sinceStartMs: 0, kind, nodeId: 'work', detail: '', data }, CHAT_LOOP_WINDOW_LOOKUP);
    assert.equal(
      line('message-sent', { from: 'a', to: 'b', purpose: 'finding', body: 'The key includes the locale.' }),
      'Branch “a” sent a finding to “b”: “The key includes the locale.” (the branch\'s words; delivered when the recipient next checks its messages).',
    );
    assert.equal(
      line('message-sent', { from: 'the person', to: 'all', purpose: 'instruction', body: 'Keep the API.' }),
      'Your instruction to the branches: “Keep the API.” — delivered when each branch next checks its messages.',
    );
    assert.match(line('message-delivered', { to: 'b', from: 'a', messageId: 'work#1/m1' }) ?? '', /Branch “b” received work#1\/m1 from a/);
    assert.match(line('message-acknowledged', { by: 'b', messageId: 'work#1/m1' }) ?? '', /acknowledged/);
    assert.match(line('message-undelivered', { to: 'b', reason: 'recipient-ended' }) ?? '', /not restarted for a message/);
  });

  it('leaves a fan-out where no message is sent with no mailbox entries and no mailbox section', async () => {
    const executor: StepExecutor = async (context) =>
      context.instance === undefined
        ? { product: { kind: 'success' }, summary: 'sliced', providerTurns: 1, resultBody: SLICES }
        : { product: { kind: 'success' }, summary: 'quiet', providerTurns: 1, resultBody: 'done' };
    const result = await runLoopGraph(graph(), {
      runId: 'run-quiet',
      dryRun: true,
      resultStore: createMemoryResultStore((body) => `digest-${String(body.length)}`),
      executor,
    });
    assert.equal(result.journal.some((entry) => entry.kind.startsWith('message-')), false);
    assert.doesNotMatch(result.results.find((entry) => entry.nodeId === 'work')?.body ?? '', /Messages between the branches/);
  });
});
