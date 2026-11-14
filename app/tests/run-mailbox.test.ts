/**
 * DSP-209 S11: the mailbox between a fan-out's branches, on its own.
 *
 * Delivery only at a check; delivery and acknowledgement separate; nothing waits; a message to
 * an ended branch is refused and recorded; what a branch never checked is recorded undelivered.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRunMailbox, MAX_MESSAGE_BODY, MAX_MESSAGES_PER_BRANCH } from '../src/shared/run-mailbox';

function mailbox(takeInstructions?: () => readonly { id: string; text: string }[]) {
  const journal: { kind: string; data: Readonly<Record<string, string | number | boolean>> }[] = [];
  const box = createRunMailbox({
    visitId: 'work#1',
    sliceIds: ['a', 'b', 'c'],
    post: (kind, _detail, data) => journal.push({ kind, data }),
    ...(takeInstructions === undefined ? {} : { takeInstructions }),
  });
  for (const id of ['a', 'b', 'c']) {
    box.branchStarted(id);
  }
  const port = (id: string) => box.portFor(id, { base: 'base0', branch: `dspatch/run/r/work/v1/${id}` });
  return { box, journal, port };
}

describe('the run mailbox (DSP-209 S11)', () => {
  it('delivers at a check and acknowledges separately, in order, with the sender\'s revision', () => {
    const { journal, port } = mailbox();
    const sent = port('a').send({ to: 'b', purpose: 'finding', body: 'The parser now returns null for empty input.' });
    assert.ok(sent.ok);
    assert.deepEqual(port('c').check(), [], 'not addressed to c');
    const received = port('b').check();
    assert.equal(received.length, 1);
    assert.equal(received[0]?.branch, 'dspatch/run/r/work/v1/a');
    assert.equal(received[0]?.base, 'base0');
    assert.deepEqual(port('b').check(), [], 'delivered once');
    assert.deepEqual(port('b').acknowledge(sent.ok ? sent.id : ''), { ok: true });
    assert.equal(port('b').acknowledge(sent.ok ? sent.id : '').ok, false, 'acknowledged once');
    assert.equal(port('c').acknowledge(sent.ok ? sent.id : '').ok, false, 'only a recipient it was delivered to');
    assert.deepEqual(journal.map((entry) => entry.kind), ['message-sent', 'message-delivered', 'message-acknowledged']);
  });

  it('records undelivered what a branch never checked, and refuses and records a send to an ended branch', () => {
    const { box, journal, port } = mailbox();
    port('a').send({ to: 'all', purpose: 'question', body: 'Does anyone own the shared config?' });
    box.branchEnded('b');
    assert.equal(journal.filter((entry) => entry.kind === 'message-undelivered' && entry.data['to'] === 'b').length, 1);
    box.branchEnded('b');
    assert.equal(journal.filter((entry) => entry.kind === 'message-undelivered').length, 1, 'ending twice records once');
    const refused = port('a').send({ to: 'b', purpose: 'finding', body: 'Too late.' });
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? '' : refused.reason, /already ended.*not restarted/);
    assert.equal(journal.at(-1)?.kind, 'message-undelivered');
    assert.equal(journal.at(-1)?.data['reason'], 'recipient-ended');
    assert.equal(port('c').check().length, 1, 'the message to all still reaches c');
  });

  it('refuses what its bounds do not allow, and never waits', () => {
    const { port } = mailbox();
    for (const [input, reason] of [
      [{ to: 'b', purpose: 'finding', body: '   ' }, /needs a body/],
      [{ to: 'b', purpose: 'finding', body: 'x'.repeat(MAX_MESSAGE_BODY + 1) }, /at most 4000/],
      [{ to: 'nobody', purpose: 'finding', body: 'x' }, /no branch "nobody"/],
      [{ to: 'a', purpose: 'finding', body: 'x' }, /itself/],
      [{ to: 'b', purpose: 'gossip', body: 'x' }, /Purpose must be/],
    ] as const) {
      const result = port('a').send(input);
      assert.equal(result.ok, false);
      assert.match(result.ok ? '' : result.reason, reason);
    }
    for (let index = 0; index < MAX_MESSAGES_PER_BRANCH; index += 1) {
      assert.equal(port('c').send({ to: 'b', purpose: 'finding', body: `note ${String(index)}` }).ok, true);
    }
    const over = port('c').send({ to: 'b', purpose: 'finding', body: 'one too many' });
    assert.match(over.ok ? '' : over.reason, /sent its 20 messages/);
    // Every call is synchronous: none returns a promise to wait on.
    assert.equal(port('b').check() instanceof Promise, false);
  });

  it('lists contract changes and messages to the integrator as open proposals', () => {
    const { box, port } = mailbox();
    port('a').send({ to: 'all', purpose: 'contract-change', body: 'Rename token kind "kw" to "keyword".', contractRef: 'docs/tokens.md@v1' });
    port('b').send({ to: 'integrator', purpose: 'question', body: 'Should the two settings files be merged?' });
    port('c').send({ to: 'a', purpose: 'finding', body: 'Not a proposal.' });
    assert.deepEqual(box.openProposals().map((message) => message.purpose), ['contract-change', 'question']);
    assert.equal(box.openProposals()[0]?.contractRef, 'docs/tokens.md@v1');
  });

  it('turns the person\'s instructions into a message to every branch that has not ended, at a check', () => {
    let given = false;
    const { box, journal, port } = mailbox(() => {
      if (given) return [];
      given = true;
      return [{ id: 'i1', text: 'Keep the public API unchanged.' }];
    });
    box.branchEnded('c');
    const atA = port('a').check();
    assert.equal(atA[0]?.from, 'the person');
    assert.equal(atA[0]?.purpose, 'instruction');
    assert.equal(port('b').check()[0]?.body, 'Keep the public API unchanged.');
    assert.deepEqual(journal.find((entry) => entry.kind === 'message-sent')?.data['recipients'], 'a, b', 'not to the branch that had ended');
  });
});
