/**
 * Who hears about a run once there are two windows.
 *
 * DSP-28 #1 and #5. The defect this replaces is concrete: `startEditorLoopRun` sent
 * every journal entry to `event.sender` — the window that happened to invoke the run.
 * With one window that cannot be told from correct. With two it is wrong in both
 * directions, and it would have looked like a bug in the graph view rather than in the
 * delivery.
 *
 * These use a fake window, because what Electron adds is a display and not any
 * different behaviour here. Nothing in this file opens a window; the claims that need
 * one are named as unproven in the report.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LOOP_RUN_EVENT_CHANNEL,
  LoopRunAudience,
  type RunAudienceWindow,
} from '../src/main/loop-run-audience';
import type { LiveRunAnnouncement, LoopRunEvent } from '../src/shared/loop-run-view';

interface FakeWindow extends RunAudienceWindow {
  readonly heard: LoopRunEvent[];
  readonly channels: string[];
  destroy(): void;
}

function fakeWindow(): FakeWindow {
  let destroyed = false;
  const heard: LoopRunEvent[] = [];
  const channels: string[] = [];
  return {
    heard,
    channels,
    destroy(): void {
      destroyed = true;
    },
    isDestroyed(): boolean {
      return destroyed;
    },
    send(channel: string, payload: unknown): void {
      if (destroyed) {
        throw new Error('a destroyed window must not be sent to');
      }
      channels.push(channel);
      heard.push(payload as LoopRunEvent);
    },
  };
}

const run: LiveRunAnnouncement = {
  runId: 'chat-live-1',
  graphVersionId: 'graph-1111',
  graphId: 'dspatch-chat-loop',
  graphName: 'Chat loop',
  binding: 'chat-loop',
  graphText: '{}',
  startedAtUtc: '2026-09-18T06:00:00.000Z',
};

function journalEvent(): LoopRunEvent {
  return {
    kind: 'journal',
    runId: run.runId,
    graphVersionId: run.graphVersionId,
    entry: {
      seq: 1,
      atIso: '2026-09-18T06:00:01.000Z',
      sinceStartMs: 10,
      kind: 'node-entered',
      nodeId: 'implementer',
      detail: 'entered',
    },
  };
}

describe('an event belongs to a run, not to a sender', () => {
  it('reaches every open window, including one that did not start the run', () => {
    const audience = new LoopRunAudience();
    const chat = fakeWindow();
    const editor = fakeWindow();
    audience.add(chat);
    audience.add(editor);

    audience.start(run);
    audience.broadcast(journalEvent());

    assert.equal(
      editor.heard.length,
      2,
      'the editor window is watching the graph and did not press Send, so addressing the ' +
        "run's events to whoever invoked it would leave the graph view blank for the whole run",
    );
    assert.equal(chat.heard.length, 2, 'and the window that did start it still hears them');
    assert.equal(editor.channels[0], LOOP_RUN_EVENT_CHANNEL);
  });

  it('reaches a window opened halfway through, which can ask what is running', () => {
    const audience = new LoopRunAudience();
    const chat = fakeWindow();
    audience.add(chat);
    audience.start(run);
    audience.broadcast(journalEvent());

    const editor = fakeWindow();
    audience.add(editor);
    assert.deepEqual(
      audience.current(),
      run,
      'a window that opens during a run must be able to find out which run is walking and ' +
        'which version of the drawing, or it can only ever show the next run',
    );
    audience.broadcast(journalEvent());
    assert.equal(editor.heard.length, 1, 'and it hears everything from the moment it joined');
    assert.equal(chat.heard.length, 3);
  });

  it('does not double-deliver to a window registered twice', () => {
    const audience = new LoopRunAudience();
    const window = fakeWindow();
    audience.add(window);
    audience.add(window);
    audience.broadcast(journalEvent());
    assert.equal(window.heard.length, 1, 'one window is one audience member');
  });

  it('skips a window that has gone away rather than throwing into the run', () => {
    const audience = new LoopRunAudience();
    const gone = fakeWindow();
    const open = fakeWindow();
    audience.add(gone);
    audience.add(open);
    gone.destroy();

    audience.broadcast(journalEvent());

    assert.equal(open.heard.length, 1, 'a closed window must not cost the open one its events');
    assert.equal(gone.heard.length, 0);
    assert.equal(audience.windowCount(), 1, 'and the closed one is forgotten');
  });
});

describe('looking is not doing', () => {
  /**
   * DSP-28 #1 and #5, as directly as this can be asserted without a display: closing
   * the graph view must not touch the run.
   */
  it('leaves the run exactly as it was when a window closes', () => {
    const audience = new LoopRunAudience();
    const editor = fakeWindow();
    const chat = fakeWindow();
    audience.add(editor);
    audience.add(chat);
    audience.start(run);

    audience.remove(editor);

    assert.deepEqual(
      audience.current(),
      run,
      'closing the graph view is an act of looking: a run that ended because the last ' +
        'viewer left would be the opposite of what the card asks for',
    );
    audience.broadcast(journalEvent());
    assert.equal(chat.heard.length, 2, 'and the run keeps reporting to the windows still open');
  });

  it('answers what is running the same way however often it is asked', () => {
    const audience = new LoopRunAudience();
    const window = fakeWindow();
    audience.add(window);
    audience.start(run);
    const before = window.heard.length;

    assert.deepEqual(audience.current(), run);
    assert.deepEqual(audience.current(), run);

    assert.equal(
      window.heard.length,
      before,
      'asking must not announce anything: a view that quietly did something would spend ' +
        "the user's money while nobody was watching",
    );
  });
});

describe('the run that has ended', () => {
  it('is announced as ended and stops being the current run', () => {
    const audience = new LoopRunAudience();
    const window = fakeWindow();
    audience.add(window);
    audience.start(run);

    audience.end({ runId: run.runId, graphVersionId: run.graphVersionId, status: 'completed', note: 'done' });

    assert.equal(audience.current(), null);
    assert.equal(window.heard.at(-1)?.kind, 'ended');
  });

  /**
   * The sending-side twin of the addressing rule. A slow `finally` from a cancelled
   * run arriving after the next run has started must not clear the announcement the
   * new run just made, or a window opening a moment later is told nothing is running.
   */
  it('does not clear the announcement of the run that came after it', () => {
    const audience = new LoopRunAudience();
    const window = fakeWindow();
    audience.add(window);
    audience.start(run);
    const next: LiveRunAnnouncement = { ...run, runId: 'chat-live-2', graphVersionId: 'graph-2222' };
    audience.start(next);

    audience.end({ runId: run.runId, graphVersionId: run.graphVersionId, status: null, note: 'cancelled' });

    assert.deepEqual(
      audience.current(),
      next,
      'the ending of an earlier run must not be able to say that the current one is over',
    );
  });
});

/* ------------------------------------------------------------------------- */
/* DSP-62: how a window leaves the audience decides whether the app can close */
/* ------------------------------------------------------------------------- */

/**
 * A destroyed window is a fine key to delete by, and a terrible object to ask.
 *
 * Both `closed` handlers in `main.ts` take their window out of the audience. They
 * used to do it with `runAudience.remove(window.webContents)`, and by the time
 * `closed` runs the `BrowserWindow` is destroyed: Electron answers a property
 * access on a destroyed object with `TypeError: Object has been destroyed`.
 *
 * During an ordinary close that is an uncaught exception. During `app.exit()` it
 * is worse, and it is DSP-62: Electron emits `closed` while tearing the process
 * down, and the throw leaves that teardown half-finished — the window goes, the
 * timers stop, and **the process never ends**. Measured on 19 September 2026: with
 * the property access the app outlived `app.exit(0)` past a 60-second wait on both
 * the scripted-run and the window-close paths; with the reference captured while
 * the window was alive it exits in about a second.
 *
 * Read out of the file rather than modelled, for the reason
 * `loop-stop-means-stop.test.ts` reads it: an Electron `closed` handler has no test
 * harness, and the defect returns as one plausible-looking word added by someone
 * who does not know what it costs.
 */
describe('a closed window is taken out of the audience without being asked anything', () => {
  it('has no `closed` handler in main.ts that reads a property of its window', () => {
    const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const source = fs.readFileSync(path.join(repoRoot, 'app', 'src', 'main', 'main.ts'), 'utf8');

    const handlers: string[] = [];
    for (const match of source.matchAll(/^([ \t]*)window\.on\('closed', \(\) => \{$/gm)) {
      const from = (match.index ?? 0) + match[0].length;
      const closing = new RegExp(`^${match[1] ?? ''}\\}\\);$`, 'm');
      const rest = source.slice(from);
      const end = closing.exec(rest);
      assert.notEqual(end, null, 'a `closed` handler has to end for this to read it');
      handlers.push(
        rest
          .slice(0, end?.index ?? 0)
          .replaceAll(/\/\*[\s\S]*?\*\//g, '')
          .replaceAll(/\/\/[^\n]*/g, ''),
      );
    }

    assert.equal(
      handlers.length,
      2,
      'the chat window and the loop editor window both have one, and both are the defect',
    );

    for (const body of handlers) {
      const asked = /\bwindow\.[A-Za-z]/.exec(body);
      assert.equal(
        asked,
        null,
        'a `closed` handler asked its own window for something. The window is destroyed by ' +
          'then, so the access throws `Object has been destroyed` — and when the close came ' +
          'from `app.exit()` the throw stops the process from exiting at all, which is the ' +
          'application that will not close (DSP-62). Capture what the handler needs while the ' +
          `window is alive and use that instead. What it asked for: ${asked?.[0] ?? ''}`,
      );
    }
  });
});
