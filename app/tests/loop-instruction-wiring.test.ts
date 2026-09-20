/**
 * That the chat run handler is wired the way the measured mechanism assumes.
 *
 * `loop-live.test.ts` measures the delivery itself: a real queue, a real
 * preamble, a real walk, and an assertion on the prompt the adapter actually
 * received. What it cannot reach is the `promptFor` closure inside `main.ts`,
 * because that is an Electron IPC handler with no test harness — the same gap
 * `loop-stop-means-stop.ts` names, and this follows its precedent of reading the
 * source rather than modelling it.
 *
 * These are shape assertions and they are worth what shape assertions are worth.
 * They cannot show the delivery works; that is measured elsewhere. What they can
 * show is that the handler still calls the mechanism that was measured, which is
 * the thing a later edit silently removes. Each one below is a line someone could
 * plausibly delete or move without noticing what it was for.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function mainSource(): string {
  return fs.readFileSync(path.join(repoRoot, 'app', 'src', 'main', 'main.ts'), 'utf8');
}

/** The body of the chat run handler, which is where all of this has to happen. */
function chatRunHandler(source: string): string {
  const at = source.indexOf('START_CHAT_LOOP_RUN,');
  assert.notEqual(at, -1, 'the chat run handler has to exist for any of this to mean anything');
  const end = source.indexOf('ipcMain.handle(', at + 1);
  return source.slice(at, end === -1 ? source.length : end);
}

describe('the chat run handler carries a message to the next step', () => {
  /**
   * The delivery point. Draining in `promptFor` is what makes "delivered" mean
   * "its text went into the prompt" rather than two separate claims that could
   * disagree — and a disagreement here is DSpatch telling someone an agent had
   * been told something it had not, which §4.4 singles out as forbidden.
   */
  it('drains the queue where the step\u2019s prompt is built, and nowhere else', () => {
    const handler = chatRunHandler(mainSource());
    assert.match(
      handler,
      /promptFor: \(node\) => \{[\s\S]*chatLoopInstructions\.takeFor\(request\.runId\)/,
      'the queue must be drained inside promptFor, so a message is marked delivered at the ' +
        'instant its text enters the prompt',
    );
    assert.equal(
      (handler.match(/chatLoopInstructions\.takeFor\(/g) ?? []).length,
      1,
      'exactly one drain. A second would hand the same message to two steps, and an ' +
        'instruction applied twice cannot be un-applied',
    );
    assert.match(
      handler,
      /instructionPreamble\(taken\.map\(\(entry\) => entry\.text\)\)/,
      'and the message must go through the shared preamble, which is what puts the ' +
        'markers the run record is later read for around the user\u2019s own words',
    );
  });

  /**
   * §4.4's last requirement: *if no step receives it before the run ends, say
   * so.* In the `finally`, for the reason the loop control is released there —
   * the throwing path is a run that ended too, and a message left in the queue
   * after its run has gone would sit on "waiting" for ever.
   */
  it('releases undelivered messages on every path out of the handler', () => {
    const handler = chatRunHandler(mainSource());
    const finallyAt = handler.lastIndexOf('} finally {');
    assert.notEqual(finallyAt, -1, 'the handler has a finally that cleans the run up');
    const cleanup = handler.slice(finallyAt);
    assert.match(
      cleanup,
      /chatLoopInstructions\.releaseRun\(request\.runId\)/,
      'a run that threw still ended, and its undelivered messages must be reported as ' +
        'undelivered rather than left waiting for a run that is gone',
    );
    assert.match(
      cleanup,
      /kind: 'run-ended'/,
      'and the window has to be told, or the message reads as pending for ever',
    );
    assert.match(cleanup, /chatLoopRunId = null/, 'and the run must stop being the current one');
  });

  /**
   * The never-delivered case has no prompt to live in, so it goes on the ending
   * note. This is the only place it is saved, which is why its absence would be
   * silent rather than obvious.
   */
  it('puts messages that reached nobody into the run\u2019s saved ending', () => {
    const handler = chatRunHandler(mainSource());
    assert.match(
      handler,
      /undeliveredNote\(chatLoopInstructions\.peekFor\(request\.runId\)\)/,
      'a message no step took is kept with the run it was meant for, on disk',
    );
  });

  /**
   * DSP-53 #2 and DSP-32 #4 at the main-process end. The window routes a send
   * during a run to `ADD_LOOP_INSTRUCTION`, and that handler must refuse to file
   * a message against a run other than the one walking — including when no run
   * is walking at all, which is the case a slow window produces.
   */
  it('refuses a message for a run that is not the one walking', () => {
    const source = mainSource();
    const at = source.indexOf('ADD_LOOP_INSTRUCTION,');
    assert.notEqual(at, -1, 'the handler the composer routes to during a run has to exist');
    const handler = source.slice(at, source.indexOf('ipcMain.handle(', at + 1));
    assert.match(handler, /chatLoopRunId === null/, 'no run walking is refused, not filed');
    assert.match(
      handler,
      /chatLoopRunId !== request\.runId/,
      'and a message typed at a run that has since ended must not be given to its successor: ' +
        'it was written about different work',
    );
    // Every refusal says where the text is. Losing what someone typed at the
    // moment of telling them no is the cheapest way to make a window hostile.
    for (const branch of handler.split("kind: 'refused'").slice(1)) {
      const reason = branch.slice(0, branch.indexOf('};'));
      assert.match(
        reason,
        /still in the box|nothing in the message/,
        `a refusal must say where the text now is. It said: ${reason}`,
      );
    }
  });

  /**
   * The handler must not be able to start a walk. This is the structural half of
   * "a message never starts a competing run": the window routes here, and there
   * is nothing here to route into a run even if the routing were wrong.
   */
  it('cannot start a run of any kind', () => {
    const source = mainSource();
    const at = source.indexOf('ADD_LOOP_INSTRUCTION,');
    const handler = source.slice(at, source.indexOf('ipcMain.handle(', at + 1));
    for (const forbidden of ['runLiveGraph', 'beginRun', 'startSession', 'AbortController']) {
      assert.equal(
        handler.includes(forbidden),
        false,
        `adding a message must not be able to start work. It mentions: ${forbidden}`,
      );
    }
  });
});
