/**
 * Where a loop run is kept, and — the property DSP-25 #4 turns on — that it is on
 * disk *while the run is still walking* rather than assembled when it ends.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { parseRunRecord, type RunRecordIdentity } from '../src/shared/loop-record';
import { graphVersionIdFor, RunRecordStore } from '../src/main/run-record-store';
import { loopTurnStatusText, loopTurnsFromRecords } from '../src/shared/loop-transcript';

const roots: string[] = [];

function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-record-${name}-`));
  roots.push(dir);
  return dir;
}

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function identity(parts: Partial<RunRecordIdentity> = {}): RunRecordIdentity {
  return {
    runId: 'chat-loop-2026-09-17T21-30-00-000Z',
    projectPath: 'C:/Users/nicla/projects/hers',
    conversationId: 'dsp-conv-1',
    mandate: 'Add the missing field.',
    graphId: 'dspatch-chat-loop',
    graphPath: 'docs/loop/graphs/dspatch-chat-loop.graph.json',
    graphVersionId: 'graph-0000000000000000',
    modelRequested: 'claude-haiku-4-5',
    appVersion: '0.1.0',
    startedAtUtc: '2026-09-17T21:30:00.000Z',
    ...parts,
  };
}

describe('a run record on disk', () => {
  /**
   * The test for continuous writing. Nothing calls `finish`, and the file is read
   * while the "run" is still going: if the writer buffered its lines and wrote them
   * at the end — the obvious alternative design — there would be nothing here at
   * all, and a run interrupted by a crash or a closed window would leave no history.
   */
  it('holds the run and its steps before the run has ended', () => {
    const store = new RunRecordStore(path.join(scratch('live'), 'loop-runs'));
    const writer = store.open(identity());
    writer.journal({
      seq: 1,
      atIso: '2026-09-17T21:30:01.000Z',
      sinceStartMs: 1000,
      kind: 'node-entered',
      nodeId: 'implementer',
      detail: 'Entered "implementer".',
    });

    const read = store.read(identity().runId);
    const turn = loopTurnsFromRecords([{ record: read.record, error: read.error }])[0];
    const said =
      turn === undefined ? '(nothing at all was on disk while the run was going)' : loopTurnStatusText(turn);
    assert.match(
      said,
      /DSpatch stopped before the run reported an end/,
      `a run still being written must read as unfinished. It said: ${said}`,
    );
    assert.equal(turn?.mandate, 'Add the missing field.', 'and must carry the mandate already');
    assert.equal(
      read.record?.completeness,
      'interrupted',
      'and a run with no ending line yet is interrupted, not complete',
    );
    assert.equal(read.record?.journal.length, 1, 'and the step already walked is already kept');
  });

  it('is read back whole once its ending line is written', () => {
    const store = new RunRecordStore(path.join(scratch('finished'), 'loop-runs'));
    const writer = store.open(identity({ runId: 'chat-loop-done' }));
    writer.finish({
      endedAtUtc: '2026-09-17T21:32:00.000Z',
      kind: 'finished',
      status: 'completed',
      terminalNodeId: 'done',
      outcome: 'work-verified',
      outcomeText: 'The command you chose ran and exited 0: npm test in C:/p.',
      modelRequested: 'claude-haiku-4-5',
      modelReported: 'claude-haiku-4-5',
      commands: [],
      snapshots: {
        beforeId: 'snap-a',
        beforeFileCount: 3,
        afterId: 'snap-b',
        afterFileCount: 3,
        changed: [],
        added: [],
        removed: [],
        truncated: null,
      },
      note: 'workspace C:/p (open project; files were not reset)',
      cancelled: false,
      cost: 'unknown',
    });
    assert.deepEqual(writer.failures(), [], 'a run that ended normally reports no lost writes');
    const read = store.read('chat-loop-done');
    assert.equal(
      read.record?.completeness,
      'complete',
      'a run whose ending was written must read back as a whole run',
    );
    assert.equal(
      read.record?.ending?.outcome,
      'work-verified',
      'and must keep the outcome it ended with',
    );
  });

  it('finds the runs of one conversation and leaves the others alone', () => {
    const store = new RunRecordStore(path.join(scratch('many'), 'loop-runs'));
    store.open(identity({ runId: 'run-a', conversationId: 'conv-1' }));
    store.open(identity({ runId: 'run-b', conversationId: 'conv-2' }));
    store.open(identity({ runId: 'run-c', conversationId: 'conv-1' }));
    const mine = store.listForConversation('conv-1').map((entry) => entry.runId);
    assert.deepEqual(
      [...mine].sort(),
      ['run-a', 'run-c'],
      'a reopened conversation shows its own runs and no other conversation\'s',
    );
  });

  it('refuses a run id that could address a file elsewhere, and writes nothing', () => {
    const root = scratch('escape');
    const directory = path.join(root, 'loop-runs');
    const store = new RunRecordStore(directory);
    store.open(identity({ runId: '../escaped' }));
    assert.equal(
      fs.existsSync(path.join(root, 'escaped.jsonl')),
      false,
      'a run id that climbs out of the records folder must not write a file outside it',
    );
    assert.equal(fs.existsSync(directory), false, 'and nothing may be created under that name');
    const read = store.read('../escaped');
    assert.match(
      read.error ?? '',
      /not a usable run id/,
      `and the refusal must be said out loud. It said: ${read.error ?? '(nothing)'}`,
    );
    assert.equal(read.record, null, 'and nothing may be read back through such a name');
  });

  it('reads a damaged file as far as it can, and never rewrites it', () => {
    const directory = path.join(scratch('damaged'), 'loop-runs');
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'run-damaged.jsonl');
    fs.writeFileSync(file, 'this is not JSON at all\n', 'utf8');
    const before = fs.readFileSync(file, 'utf8');
    const read = new RunRecordStore(directory).read('run-damaged');
    assert.equal(
      read.record?.readOnly,
      true,
      'a file DSpatch cannot understand must be left exactly as it is',
    );
    assert.match(
      read.error ?? '',
      /no readable run-record header/,
      `and the person must be told what is wrong with it. It said: ${read.error ?? '(nothing)'}`,
    );
    assert.match(read.recovery ?? '', /will not rewrite it/, 'and that the file is not at risk');
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'the file must be exactly as it was');
  });
});

/**
 * DSP-25 #1 asks for the **exact graph version** that was executed. The graph is a
 * file a person may edit between runs, so a name identifies nothing; the bytes do.
 */
describe('which drawing was executed', () => {
  it('distinguishes two versions of the same named graph', () => {
    const one = '{"id":"dspatch-chat-loop","nodes":[]}';
    const two = '{"id":"dspatch-chat-loop","nodes":[],"edges":[]}';
    assert.notEqual(
      graphVersionIdFor(one),
      graphVersionIdFor(two),
      'two drawings with the same name but different content are different versions',
    );
    assert.equal(
      graphVersionIdFor(one),
      graphVersionIdFor(one),
      'and the same content is always the same version',
    );
    assert.match(graphVersionIdFor(one), /^graph-[0-9a-f]{16}$/, 'and the id is readable as one');
  });
});

describe('parsing what the store wrote', () => {
  it('drops a half-written last line rather than losing the whole file', () => {
    const store = new RunRecordStore(path.join(scratch('cut'), 'loop-runs'));
    const writer = store.open(identity({ runId: 'run-cut' }));
    writer.journal({
      seq: 1,
      atIso: '2026-09-17T21:30:01.000Z',
      sinceStartMs: 1000,
      kind: 'run-started',
      detail: 'Run started.',
    });
    const file = store.filePathFor('run-cut');
    fs.appendFileSync(file, '{"line":"journal","entry":{"seq":2,"ki', 'utf8');
    const parsed = parseRunRecord(fs.readFileSync(file, 'utf8'));
    assert.equal(
      parsed.truncatedLastLine,
      true,
      'a file that stops mid-line must be reported as one, because a step may be missing',
    );
    assert.equal(parsed.identity?.runId, 'run-cut', 'and the run it belongs to survives');
    assert.equal(parsed.journal.length, 1, 'and so does every line that was written whole');
    assert.equal(parsed.unreadableLines, 0, 'the fragment is an unfinished write, not damage');
  });
});
