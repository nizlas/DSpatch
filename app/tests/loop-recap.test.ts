/**
 * DSP-209 S7: which loop runs the next chat message tells the agent about, and how.
 *
 * Pure: the rule and the text, from run records and saved messages. The chat service's own
 * use of it — once, disclosed, removable, kept apart — is in `chat-service.test.ts`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildLoopRecap, loopRecapRuns, type LoopRecapRecord } from '../src/shared/loop-recap';
import type { RunJournalEntry } from '../src/shared/loop-run';

function run(runId: string, endedAtUtc: string | null, journal: RunJournalEntry[] = [], status = 'completed'): LoopRecapRecord {
  return {
    runId,
    record: {
      formatVersion: 1,
      identity: { runId, projectPath: 'C:/p', conversationId: 'c', mandate: `mandate of ${runId}\nsecond line`, graphId: 'g', graphPath: 'g', graphVersionId: 'v', modelRequested: 'm', appVersion: '1', startedAtUtc: '2026-11-14T01:00:00.000Z' },
      journal,
      replies: [],
      commands: [],
      ending:
        endedAtUtc === null
          ? null
          : {
              endedAtUtc,
              kind: 'finished',
              status,
              terminalNodeId: status === 'completed' ? 'check-skipped' : null,
              snapshots: { beforeId: null, beforeFileCount: 0, afterId: null, afterFileCount: 0, changed: [], added: [], removed: [], truncated: null },
            },
    } as unknown as LoopRecapRecord['record'],
  };
}

function message(startedAtUtc: string, extra: Record<string, unknown> = {}) {
  return { startedAtUtc, ...extra };
}

const skip: RunJournalEntry = {
  seq: 3, atIso: '', sinceStartMs: 0, kind: 'node-skipped', nodeId: 'check', detail: '', data: { decidedBy: 'work', reason: 'a question\nonly' },
};

describe('the loop recap (DSP-209 S7)', () => {
  it('offers ended runs after the last message that nothing has accounted for', () => {
    const records = [
      run('old', '2026-11-14T01:00:00.000Z'),
      run('walking', null),
      run('recapped', '2026-11-14T03:00:00.000Z'),
      run('removed', '2026-11-14T03:00:00.000Z'),
      run('handed', '2026-11-14T03:00:00.000Z', [], 'handed-over'),
      run('excluded', '2026-11-14T03:00:00.000Z'),
      run('new', '2026-11-14T03:00:00.000Z'),
    ];
    const messages = [
      message('2026-11-14T02:00:00.000Z', { loopRecap: { runIds: ['recapped'], text: 'x' } }),
      message('2026-11-14T02:30:00.000Z', { loopRecap: { runIds: ['removed'], text: null } }),
      // S6: the handover turn already delivered that run's material.
      message('2026-11-14T02:40:00.000Z', { handover: { runId: 'handed', fromStep: 'Work', text: 'h' } }),
    ];
    assert.deepEqual(loopRecapRuns(records, messages, ['excluded']).map((entry) => entry.runId), ['new']);
    // A handed-over run whose handover was never sent is recapped: its material was not delivered.
    assert.deepEqual(loopRecapRuns([run('handed', '2026-11-14T03:00:00.000Z', [], 'handed-over')], []).map((entry) => entry.runId), ['handed']);
  });

  it('says it is DSpatch\'s, with the mandate quoted, the ending, the skips and what is known of files', () => {
    const recap = buildLoopRecap([run('chat-loop-1', '2026-11-14T03:00:00.000Z', [skip])]);
    assert.ok(recap !== null);
    assert.deepEqual(recap.runIds, ['chat-loop-1']);
    assert.match(recap.text, /^=== DSpatch: what loop runs in this conversation did ===/);
    assert.match(recap.text, /DSpatch supplied this; the person did not type it\./);
    assert.match(recap.text, /--- Run chat-loop-1: ended as completed, at "check-skipped" ---/);
    assert.match(recap.text, /Skipped "check": a question only\./, 'a reason is put on one line');
    assert.ok(recap.text.includes('| mandate of chat-loop-1\n| second line'));
    assert.match(recap.text, /Files changed: not known/);
    assert.equal(buildLoopRecap([]), null);
  });
});
