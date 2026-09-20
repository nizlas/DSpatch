/**
 * The loop run as the conversation shows it.
 *
 * No provider turn and no window: these are the pure rules the chat window calls.
 * The assertions are deliberately on the sentence the user reads rather than on the
 * flags behind it, because the defect this code exists to remove was a person being
 * shown nothing — and a test that checks a boolean would still pass while the window
 * said nothing at all.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import type { CapabilitySupport } from '../src/adapter/types';
import type { ChatLoopRunOutcome } from '../src/shared/bridge';
import type { RunResult, RunStatus } from '../src/shared/loop-run';
import {
  describeLoopEnding,
  loopTurnBadge,
  loopTurnBadgeText,
  loopTurnEndingLine,
  loopTurnStatusText,
  loopTurnsAfter,
  mergeTranscript,
  type LoopTurn,
} from '../src/shared/loop-transcript';

function result(status: RunStatus, parts: Partial<RunResult> = {}): RunResult {
  return {
    runId: 'chat-loop-1',
    graphId: 'dspatch-chat-loop',
    status,
    dryRun: false,
    startedAtIso: '2026-09-16T22:00:00.000Z',
    endedAtIso: '2026-09-16T22:04:00.000Z',
    path: ['implementer', 'verify', 'done'],
    edgesTaken: ['e-edit', 'e-pass'],
    terminalNodeId: 'done',
    limitsReached: [],
    fault: null,
    awaiting: null,
    refusal: null,
    usage: {
      calls: 2,
      providerTurns: 1,
      reworkRounds: 0,
      transitions: 2,
      nodesExecuted: 3,
      wallClockMs: 240_000,
    },
    journal: [],
    ...parts,
  };
}

function sent(mandate = 'Add a --json flag to the report command.'): readonly LoopTurn[] {
  return loopTurnsAfter([], {
    kind: 'mandate-sent',
    runId: 'chat-loop-1',
    mandate,
    atUtc: '2026-09-16T22:00:00.000Z',
  });
}

function only(turns: readonly LoopTurn[]): LoopTurn {
  assert.equal(turns.length, 1, 'expected exactly one loop turn');
  return turns[0]!;
}

describe('the mandate in the conversation', () => {
  it('shows the mandate and an account of it from the moment Send is pressed', () => {
    const turn = only(sent());
    // What the user sees: their own words, and a sentence about what is happening.
    assert.equal(turn.mandate, 'Add a --json flag to the report command.');
    assert.equal(
      loopTurnStatusText(turn),
      'The loop is running. Nothing has come back from the agent yet.',
    );
  });

  it('does not invent a second entry for one run', () => {
    const twice = loopTurnsAfter(sent(), {
      kind: 'mandate-sent',
      runId: 'chat-loop-1',
      mandate: 'something else',
      atUtc: '2026-09-16T22:00:01.000Z',
    });
    assert.equal(only(twice).mandate, 'Add a --json flag to the report command.');
  });

  it('ignores a reply for a run it has no entry for', () => {
    const stray = loopTurnsAfter([], {
      kind: 'agent-replied',
      runId: 'chat-loop-unknown',
      reply: { nodeId: 'implementer', nodeLabel: 'Do the requested work', text: 'Done.' },
    });
    assert.deepEqual(stray, []);
  });
});

describe("the agent's own words", () => {
  it('shows the reply whole, however long it is', () => {
    const text = `${'The change touches nine files. '.repeat(400)}DONE`;
    const turns = loopTurnsAfter(sent(), {
      kind: 'agent-replied',
      runId: 'chat-loop-1',
      reply: { nodeId: 'implementer', nodeLabel: 'Do the requested work', text },
    });
    const turn = only(turns);
    assert.equal(turn.replies[0]?.text, text);
    assert.equal(turn.replies[0]?.nodeLabel, 'Do the requested work');
    assert.equal(loopTurnStatusText(turn), 'The agent has replied and the loop is still running.');
  });

  /**
   * Revised for DSP-57 #1, and the revision is the point of the card.
   *
   * The rule it used to assert — an empty reply is not shown as an empty answer —
   * still holds and is still checked below: `replies` stays empty, so no blank
   * block is ever attributed to an agent. What it *also* used to assert was that
   * such a reply left no trace at all, and that was the defect. A step that
   * finished a provider turn and said nothing looked exactly like a step whose
   * reply DSpatch had lost and exactly like a step that never ran, and a run that
   * reached a terminal over one read as an ordinary run.
   *
   * So the reply is still not shown as an answer, and the silence is now stated as
   * a fact about the step, naming it.
   */
  it('keeps an empty reply out of the answers and still says the step was silent', () => {
    const replied = loopTurnsAfter(sent(), {
      kind: 'agent-replied',
      runId: 'chat-loop-1',
      reply: { nodeId: 'implementer', nodeLabel: 'Do the requested work', text: '   \n' },
    });
    assert.equal(only(replied).replies.length, 0);
    assert.deepEqual(only(replied).silentSteps, [
      { nodeId: 'implementer', nodeLabel: 'Do the requested work', occurrence: 1 },
    ]);
    // Named, not counted, and never as an answer.
    assert.match(loopTurnStatusText(only(replied)), /said nothing at all: “Do the requested work”/);
    const ended = loopTurnsAfter(replied, {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: {
        kind: 'finished',
        result: result('runtime-fault', {
          fault: {
            kind: 'no-outcome-delivered',
            nodeId: 'implementer',
            detail: '"implementer" ended without a usable outcome.',
            reconcile: 'Check the project before anything is repeated.',
          },
        }),
        journalText: '',
        workspaceNote: '',
      },
    });
    // The ending still speaks for the run, first and unchanged. The silence is a
    // clause after it rather than a replacement for it.
    assert.match(
      loopTurnStatusText(only(ended)),
      /^"implementer" ended without a usable outcome\. Check the project before anything is repeated\./,
    );
    assert.match(loopTurnStatusText(only(ended)), /An empty reply is not an answer/);
  });
});

describe('how a run ends', () => {
  /**
   * Every ending a chat-loop run can have, with the reason the runner recorded and
   * with none. The point of the table is the assertion under it: whichever way the
   * run ends, the entry says something a person can act on.
   */
  const endings: readonly { readonly name: string; readonly outcome: ChatLoopRunOutcome }[] = [
    {
      name: 'refused with a reason',
      outcome: { kind: 'refused', reason: 'Open a project first.' },
    },
    { name: 'refused with no reason', outcome: { kind: 'refused', reason: '   ' } },
    { name: 'failed with a note', outcome: { kind: 'failed', note: 'The graph could not be read.' } },
    { name: 'failed with no note', outcome: { kind: 'failed', note: '' } },
    {
      name: 'cancelled',
      outcome: {
        kind: 'cancelled',
        result: result('runtime-fault', {
          fault: {
            kind: 'no-outcome-delivered',
            nodeId: 'implementer',
            detail: 'The operator cancelled "implementer".',
            reconcile: 'Read the changed files before anything is repeated.',
          },
        }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'completed',
      outcome: { kind: 'finished', result: result('completed'), journalText: '', workspaceNote: '' },
    },
    {
      name: 'a spent bound with no bound named',
      outcome: {
        kind: 'finished',
        result: result('limit-reached', { limitsReached: [] }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'a spent bound',
      outcome: {
        kind: 'finished',
        result: result('limit-reached', { limitsReached: ['maxMinutes 20'] }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'a fault with no fault recorded',
      outcome: {
        kind: 'finished',
        result: result('runtime-fault', { fault: null }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'waiting for a person with no question',
      outcome: {
        kind: 'finished',
        result: result('awaiting-human', { awaiting: null }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'waiting for a person with a question',
      outcome: {
        kind: 'finished',
        result: result('awaiting-human', {
          awaiting: { nodeId: 'review', question: 'Is this the change you wanted?' },
        }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'a terminal the runner did not name',
      outcome: {
        kind: 'finished',
        result: result('completed', { terminalNodeId: null }),
        journalText: '',
        workspaceNote: '',
      },
    },
    {
      name: 'refused by the runner',
      outcome: {
        kind: 'finished',
        result: result('refused', { refusal: 'That drawing has no chat binding.' }),
        journalText: '',
        workspaceNote: '',
      },
    },
  ];

  for (const ending of endings) {
    it(`says why after ${ending.name}`, () => {
      const turns = loopTurnsAfter(sent(), {
        kind: 'run-settled',
        runId: 'chat-loop-1',
        outcome: ending.outcome,
      });
      const turn = only(turns);
      // The user-visible requirement, and the only one that matters here: an echoed
      // mandate is never left with nothing said about how its run ended.
      const account = loopTurnStatusText(turn);
      assert.notEqual(account.trim(), '', `${ending.name} left the entry with no account`);
      assert.ok(
        account.trim().length > 20,
        `${ending.name} said only "${account}", which is not an account of anything`,
      );
      assert.ok(account.trim().endsWith('.'), `${ending.name} did not end in a sentence`);
      assert.notEqual(turn.ending, null);
    });
  }

  /**
   * The conversation shows a short ending; the technical account is behind it.
   *
   * Niclas's complaint about the long version was placement, not content: paragraphs of
   * run detail under a loop run in the middle of a conversation. So the pair has to hold
   * two properties at once — the column gets something short, and nothing is lost.
   */
  describe('a short ending, with the account behind it', () => {
    it('leaves a run someone may have to act on whole in the column', () => {
      const cancelled = loopTurnsAfter(sent(), {
        kind: 'run-settled',
        runId: 'chat-loop-1',
        outcome: {
          kind: 'cancelled',
          result: result('completed', { terminalNodeId: 'done' }),
          journalText: '',
          workspaceNote: '',
        },
      });
      const line = loopTurnEndingLine(only(cancelled));
      // Nothing held back, so nothing to disclose: what a stopped run left behind is
      // exactly the part a short line would drop.
      assert.equal(line.hasMore, false);
      assert.equal(line.text, loopTurnStatusText(only(cancelled)));
    });
  });

  it("passes a fault's own reconciliation instruction through whole", () => {
    const ending = describeLoopEnding(
      {
        kind: 'finished',
        result: result('runtime-fault', {
          fault: {
            kind: 'step-timed-out',
            nodeId: 'implementer',
            detail: '"implementer" outran 15 minutes and was cancelled. Changed files left as they are: src/report.ts.',
            reconcile: 'Establish what the agent had already written before anything is repeated.',
          },
        }),
        journalText: '',
        workspaceNote: '',
      },
      { cancelRequested: false, abandoned: false },
    );
    assert.equal(ending.kind, 'runtime-fault');
    assert.equal(
      ending.text,
      '"implementer" outran 15 minutes and was cancelled. Changed files left as they are: ' +
        'src/report.ts. Establish what the agent had already written before anything is repeated.',
    );
  });

  /**
   * DSP-51 #4. The tail that contradicted the sentence above it.
   *
   * A read-only mandate is the first thing Niclas will try, and it ends at the
   * terminal labelled *Nothing changed — the answer is the answer* having measured no
   * file changed at all. The generic tail sent him to the workspace view for the file
   * changes anyway, and named the ending `nothing-changed` — the raw node id — in the
   * same breath. Both are fixed here, and the sentence above the tail, which was
   * already correct, is untouched.
   */
  describe('the tail after the recorded sentence', () => {
    const terminalEntry = (nodeId: string, label: string) => ({
      seq: 9,
      atIso: '2026-09-16T22:04:00.000Z',
      sinceStartMs: 240_000,
      kind: 'node-entered' as const,
      nodeId,
      detail: `Reached terminal "${nodeId}" (${label}).`,
      data: { kind: 'terminal', occurrence: 1, label },
    });

    const recordedWith = (
      moved: { changed: number; added: number; removed: number },
    ): ChatLoopRunOutcome =>
      ({
        kind: 'finished',
        result: result('completed', {
          terminalNodeId: 'nothing-changed',
          journal: [terminalEntry('nothing-changed', 'Nothing changed — the answer is the answer')],
        }),
        journalText: '',
        workspaceNote: '',
        recorded: {
          recordPath: null,
          recordNote: null,
          ending: {
            endedAtUtc: '2026-09-16T22:04:00.000Z',
            kind: 'finished',
            status: 'completed',
            terminalNodeId: 'nothing-changed',
            outcome: 'verification-not-performed',
            outcomeText: 'DSpatch did not test the project, and there was nothing to test.',
            modelRequested: 'composer-2',
            modelReported: null,
            commands: [],
            snapshots: {
              beforeId: 'snap-a',
              beforeFileCount: 3,
              afterId: 'snap-a',
              afterFileCount: 3,
              changed: Array.from({ length: moved.changed }, () => ({
                path: 'src/a.ts',
                beforeHash: 'x',
                afterHash: 'y',
              })),
              added: Array.from({ length: moved.added }, () => ({ path: 'src/b.ts', hash: 'z' })),
              removed: Array.from({ length: moved.removed }, () => ({
                path: 'src/c.ts',
                hash: 'w',
              })),
              truncated: null,
            },
            note: 'workspace C:\\project',
            cancelled: false,
            cost: 'unknown',
          },
        },
      }) as ChatLoopRunOutcome;

    it('does not send a run that changed nothing to look at its file changes', () => {
      const ending = describeLoopEnding(recordedWith({ changed: 0, added: 0, removed: 0 }), {
        cancelRequested: false,
        abandoned: false,
      });
      assert.doesNotMatch(
        ending.text,
        /file changes are in the workspace view/,
        `there are none, and the recorded sentence above says so. It said: ${ending.text}`,
      );
      assert.match(
        ending.text,
        /the loop log below shows which branch it took\./,
        'the half of the tail that is still true is kept',
      );
    });

    it('still offers the file changes when the run really moved something', () => {
      const ending = describeLoopEnding(recordedWith({ changed: 0, added: 1, removed: 0 }), {
        cancelRequested: false,
        abandoned: false,
      });
      assert.match(ending.text, /file changes are in the workspace view/);
    });

    it("names the ending by the drawing's label rather than by its node id", () => {
      const ending = describeLoopEnding(recordedWith({ changed: 0, added: 0, removed: 0 }), {
        cancelRequested: false,
        abandoned: false,
      });
      assert.match(ending.text, /stopped at "Nothing changed — the answer is the answer"/);
      assert.doesNotMatch(
        ending.text,
        /nothing-changed/,
        `the five terminals were labelled so an ending could be read. It said: ${ending.text}`,
      );
    });

    /**
     * The fallback, which is not a regression: a run whose journal is absent or
     * predates the label still names the terminal it reached, by the only name there
     * is. Saying nothing would be worse than saying the id.
     */
    it('falls back to the node id when the journal carries no label', () => {
      const ending = describeLoopEnding(
        {
          kind: 'finished',
          result: result('completed', { terminalNodeId: 'done', journal: [] }),
          journalText: '',
          workspaceNote: '',
        },
        { cancelRequested: false, abandoned: false },
      );
      assert.match(ending.text, /stopped at "done"/);
      assert.match(
        ending.text,
        /file changes are in the workspace view/,
        'and with no record to ask, the wording is exactly what it was before',
      );
    });
  });

  it('does not overwrite an ending with a second one', () => {
    const ended = loopTurnsAfter(sent(), {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: { kind: 'refused', reason: 'Open a project first.' },
    });
    const again = loopTurnsAfter(ended, {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: { kind: 'failed', note: 'something later' },
    });
    assert.ok(loopTurnStatusText(only(again)).includes('Open a project first.'));
  });

  it('says the call failed when there is no outcome to read', () => {
    const threw = loopTurnsAfter(sent(), {
      kind: 'send-threw',
      runId: 'chat-loop-1',
      message: 'The main process closed the channel.',
    });
    const account = loopTurnStatusText(only(threw));
    assert.ok(account.includes('The main process closed the channel.'));
    assert.ok(account.includes('unknown'), 'a failed call leaves an unknown outcome');
  });
});

/**
 * The badge beside the sentence, which is the only part of the card that can
 * contradict it. The sentence for a spent bound already says nothing was repeated
 * and files were left as they are; drawing it in the failure tone says something
 * broke, and one of the two is wrong.
 */
describe('how an ending is drawn', () => {
  const drawn = (outcome: ChatLoopRunOutcome): CapabilitySupport =>
    loopTurnBadge(
      only(loopTurnsAfter(sent(), { kind: 'run-settled', runId: 'chat-loop-1', outcome })),
    );
  const finished = (parts: Partial<RunResult>): ChatLoopRunOutcome => ({
    kind: 'finished',
    result: result(parts.status ?? 'completed', parts),
    journalText: '',
    workspaceNote: '',
  });

  it('does not draw a run that stopped to ask a question, or one that spent its bound, as a failure', () => {
    const notFailures: readonly { readonly name: string; readonly outcome: ChatLoopRunOutcome }[] = [
      {
        name: 'waiting for a person',
        outcome: finished({
          status: 'awaiting-human',
          awaiting: { nodeId: 'review', question: 'Is this the change you wanted?' },
        }),
      },
      {
        name: 'a spent bound',
        outcome: finished({ status: 'limit-reached', limitsReached: ['maxMinutes 15'] }),
      },
    ];
    // The user-visible requirement: neither of these is a failure, so neither may
    // be drawn in the tone the window uses for one.
    const asFailures = notFailures
      .filter((ending) => drawn(ending.outcome) === 'unsupported')
      .map((ending) => ending.name);
    assert.deepEqual(
      asFailures,
      [],
      `drawn as failures, which they are not: ${asFailures.join(', ')}`,
    );
  });

  it('still draws a run that broke, was refused or was stopped short as not a success', () => {
    assert.equal(drawn({ kind: 'refused', reason: 'Open a project first.' }), 'unsupported');
    assert.equal(drawn({ kind: 'failed', note: 'The graph could not be read.' }), 'unsupported');
    assert.equal(drawn(finished({ status: 'runtime-fault', fault: null })), 'unsupported');
    assert.equal(drawn(finished({ status: 'refused', refusal: 'No chat binding.' })), 'unsupported');
    assert.equal(
      drawn({
        kind: 'cancelled',
        result: result('runtime-fault', { fault: null }),
        journalText: '',
        workspaceNote: '',
      }),
      'unsupported',
    );
  });

  /**
   * Niclas's first real run, 17 September 2026: the loop stopped at *Failed or
   * abandoned* and the card drew a green badge reading `ended: completed`. The
   * sentence beside it was correct, and the colour and the word were what he read
   * first.
   */
  it('does not draw a run that stopped at the failed terminal as a success', () => {
    const stoppedAtFailed = only(
      loopTurnsAfter(sent(), {
        kind: 'run-settled',
        runId: 'chat-loop-1',
        outcome: finished({
          status: 'completed',
          terminalNodeId: 'failed',
          edgesTaken: ['e-edit', 'e-fail'],
          path: ['implementer', 'verify', 'failed'],
        }),
      }),
    );
    assert.equal(loopTurnBadge(stoppedAtFailed), 'unknown');
    // By the id, because this fixture's journal carries no label for the terminal.
    assert.equal(loopTurnBadgeText(stoppedAtFailed), 'reached “failed”');
  });

  /**
   * And no ending earns the positive tone, including the one that reached `done`.
   * The format cannot say which terminals mean success — both are
   * `kind: "terminal"` — so a green badge could only ever be a guess.
   */
  it('gives no ending the positive tone, and names the terminal rather than the status', () => {
    assert.equal(drawn(finished({ status: 'completed', terminalNodeId: 'done' })), 'unknown');

    const text = (outcome: ChatLoopRunOutcome): string =>
      loopTurnBadgeText(
        only(loopTurnsAfter(sent(), { kind: 'run-settled', runId: 'chat-loop-1', outcome })),
      );
    assert.equal(text(finished({ status: 'completed', terminalNodeId: 'done' })), 'reached “done”');
    // Endings that reached no terminal have nothing to name, and say what happened.
    assert.equal(text({ kind: 'refused', reason: 'Open a project first.' }), 'did not start');
    // The fixture leaves a terminal id on a faulted result, which the runner never
    // does, to check the badge does not borrow one it was not entitled to.
    assert.equal(text(finished({ status: 'runtime-fault', fault: null })), 'could not finish');
    assert.equal(
      text({
        kind: 'cancelled',
        result: result('completed', { terminalNodeId: 'done' }),
        journalText: '',
        workspaceNote: '',
      }),
      'stopped short',
      'a run the user cut short is not reported by the terminal its aborted walk reached',
    );
    assert.equal(loopTurnBadgeText(only(sent())), 'running …');
    assert.equal(loopTurnBadge(only(sent())), 'unknown');
  });
});

/**
 * DSP-55, measured by the Verifier on a real run against a CMake/CTest project.
 *
 * The checking agent read the project's README, ran `cmake -S . -B build -G Ninja`
 * and then `ctest --test-dir build --output-on-failure`, which passed 3 of 3 — and
 * the badge the chat column drew over that run read **nothing was checked**. The
 * sentence beside it said, correctly, that the checking step declared the assignment
 * met. The badge was wrong twice: untrue about the project, and identical over every
 * terminal the graph has, so where the sentence distinguishes *met*, *not met*,
 * *could not establish* and *stopped*, the badge described none of them.
 *
 * Its cause is the word *checked* keyed on whether DSpatch spawned the process, which
 * is [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md) §8's misallocation in a
 * product string. Both halves are asserted here: the phrase is gone, and the four
 * endings are told apart.
 *
 * The terminals are read from the shipped drawing rather than listed, so a rename in
 * the graph cannot leave this passing against terminals nobody ships.
 */
describe('the badge over a chat loop that DSpatch started no command in', () => {
  interface Terminal {
    readonly id: string;
    readonly label: string;
  }

  function chatLoopTerminals(): readonly Terminal[] {
    const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
    const graph = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json'),
        'utf8',
      ),
    ) as { readonly nodes: readonly { kind: string; id: string; label?: string }[] };
    const terminals = graph.nodes
      .filter((node) => node.kind === 'terminal')
      .map((node) => ({ id: node.id, label: node.label ?? node.id }));
    assert.ok(terminals.length > 1, 'the chat loop must have terminals to tell apart');
    return terminals;
  }

  /**
   * One run that walked to `terminal` and recorded `verification-not-performed`,
   * which is what every chat-loop ending records: the graph has no gate, so DSpatch
   * starts no command of its own whatever the agents establish.
   */
  function badgeAt(terminal: Terminal): string {
    const settled = loopTurnsAfter(sent(), {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: {
        kind: 'finished',
        result: result('completed', {
          terminalNodeId: terminal.id,
          path: ['work', 'check', terminal.id],
          journal: [
            {
              seq: 9,
              atIso: '2026-09-19T09:40:00.000Z',
              sinceStartMs: 240_000,
              kind: 'node-entered',
              nodeId: terminal.id,
              detail: `Reached terminal "${terminal.id}" (${terminal.label}).`,
              data: { kind: 'terminal', occurrence: 1, label: terminal.label },
            },
          ],
        }),
        journalText: '',
        workspaceNote: '',
        recorded: {
          recordPath: 'C:/Users/nicla/projects/hers/.dspatch/runs/chat-loop-1.jsonl',
          recordNote: null,
          ending: {
            endedAtUtc: '2026-09-19T09:40:00.000Z',
            kind: 'finished',
            status: 'completed',
            terminalNodeId: terminal.id,
            outcome: 'verification-not-performed',
            outcomeText: 'The checking step declared that the assignment was met.',
            modelRequested: 'composer-2',
            modelReported: null,
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
            note: 'workspace C:/Users/nicla/projects/hers',
            cancelled: false,
            cost: 'unknown',
          },
        },
      },
    });
    return loopTurnBadgeText(only(settled));
  }

  it('never tells a person nothing was checked', () => {
    for (const terminal of chatLoopTerminals()) {
      const badge = badgeAt(terminal);
      assert.doesNotMatch(
        badge,
        /nothing was checked|not checked|unchecked/,
        `the checking agent configured CMake and ran ctest to 3 of 3 passing before the ` +
          `run reached "${terminal.id}". The badge said: ${badge}`,
      );
    }
  });

  it('tells the four endings apart, by the label a person reads', () => {
    const terminals = chatLoopTerminals();
    const badges = new Map<string, string>();
    for (const terminal of terminals) {
      const badge = badgeAt(terminal);
      const already = badges.get(badge);
      assert.equal(
        already,
        undefined,
        `"${terminal.id}" and "${String(already)}" are different endings and must not ` +
          `read identically on screen. Both said: ${badge}`,
      );
      badges.set(badge, terminal.id);
      assert.equal(
        badge,
        `reached “${terminal.label}”`,
        'and each names the drawing\'s own label rather than its node id',
      );
    }
    assert.equal(badges.size, terminals.length);
  });

  /**
   * The successful ending in particular. `stopped at "done"` read as a failure over a
   * run that met its assignment, and *met* is the verdict of the checking step and not
   * DSpatch's — so the badge names what the walk reached and claims nothing more. The
   * tone stays neutral: reaching a terminal still earns no green.
   */
  it('does not read as a failure over the ending that met its assignment', () => {
    const met = chatLoopTerminals().find((terminal) => terminal.id === 'done');
    assert.ok(met, 'the chat loop must still have a "done" terminal');
    assert.equal(badgeAt(met), 'reached “Assignment met”');
    assert.doesNotMatch(badgeAt(met), /stopped|failed|could not/);

    const turn = only(
      loopTurnsAfter(sent(), {
        kind: 'run-settled',
        runId: 'chat-loop-1',
        outcome: {
          kind: 'finished',
          result: result('completed', { terminalNodeId: 'done' }),
          journalText: '',
          workspaceNote: '',
        },
      }),
    );
    assert.equal(loopTurnBadge(turn), 'unknown', 'and no walk earns the positive tone');
  });
});

describe('stopping a loop run', () => {
  it('records the request without claiming the agent stopped', () => {
    const stopping = loopTurnsAfter(sent(), {
      kind: 'stop-requested',
      runId: 'chat-loop-1',
      abandonsWait: false,
    });
    const account = loopTurnStatusText(only(stopping));
    assert.equal(
      account,
      'A stop was requested. The run has not reported an end yet, so nothing here says ' +
        'the agent has stopped.',
    );
  });

  it('still ends the entry when the result arrives after the user stopped waiting', () => {
    const abandoned = loopTurnsAfter(sent(), {
      kind: 'stop-requested',
      runId: 'chat-loop-1',
      abandonsWait: true,
    });
    assert.ok(loopTurnStatusText(only(abandoned)).startsWith('You stopped waiting'));
    const late = loopTurnsAfter(abandoned, {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: {
        kind: 'cancelled',
        result: result('runtime-fault', {
          fault: {
            kind: 'no-outcome-delivered',
            nodeId: 'implementer',
            detail: 'The operator cancelled "implementer". Changed files left as they are: src/report.ts.',
            reconcile: 'Read those files before anything is repeated.',
          },
        }),
        journalText: '',
        workspaceNote: '',
      },
    });
    const account = loopTurnStatusText(only(late));
    // The user-visible consequence: the entry stops saying the run may still be
    // going and says what it actually did to the files.
    assert.ok(
      account.includes('src/report.ts'),
      `an abandoned run's ending never reached the entry: "${account}"`,
    );
    assert.ok(account.startsWith('You stopped waiting for this run.'));
    assert.notEqual(only(late).ending, null);
  });

  it('leaves a run that has already ended alone', () => {
    const ended = loopTurnsAfter(sent(), {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: { kind: 'finished', result: result('completed'), journalText: '', workspaceNote: '' },
    });
    const after = loopTurnsAfter(ended, {
      kind: 'stop-requested',
      runId: 'chat-loop-1',
      abandonsWait: true,
    });
    assert.equal(only(after).cancelRequested, false);
    assert.ok(loopTurnStatusText(only(after)).startsWith('The loop ran to a terminal step'));
  });
});

describe('one conversation column', () => {
  const chatTurn = (id: string, at: string): { readonly dspatchRunId: string; readonly startedAtUtc: string } => ({
    dspatchRunId: id,
    startedAtUtc: at,
  });

  it('puts an ordinary message sent after a loop run below it', () => {
    const loop = only(sent());
    const merged = mergeTranscript(
      [chatTurn('run-a', '2026-09-16T21:50:00.000Z'), chatTurn('run-b', '2026-09-16T22:10:00.000Z')],
      [loop],
    );
    assert.deepEqual(
      merged.map((item) => (item.kind === 'chat' ? item.turn.dspatchRunId : item.turn.runId)),
      ['run-a', 'chat-loop-1', 'run-b'],
    );
  });

  it('keeps each turn addressed by its own position, so the older ones do not move', () => {
    const merged = mergeTranscript(
      [chatTurn('run-a', '2026-09-16T21:50:00.000Z'), chatTurn('run-b', '2026-09-16T22:10:00.000Z')],
      [only(sent())],
    );
    assert.deepEqual(
      merged.map((item) => `${item.kind}-${String(item.index)}`),
      ['chat-0', 'loop-0', 'chat-1'],
    );
  });

  it('keeps the order it was given when a timestamp cannot be read', () => {
    const merged = mergeTranscript([chatTurn('run-a', 'not a time')], [only(sent())]);
    assert.deepEqual(
      merged.map((item) => item.kind),
      ['chat', 'loop'],
    );
  });

  /**
   * DSP-53 #3. A message typed during a run belongs in the same column as the run
   * and as the user's other messages, at the moment it was typed — not in a
   * pending-instructions panel, which is the "separate locations for a question
   * and its reply" §6 rules out.
   */
  it('puts a message sent during a run in the same column, where it was typed', () => {
    const merged = mergeTranscript(
      [chatTurn('run-a', '2026-09-16T21:50:00.000Z')],
      [only(sent())],
      [
        {
          id: 'msg-1',
          runId: 'chat-loop-1',
          text: 'also check the Linux build',
          receivedAtUtc: '2026-09-16T22:02:00.000Z',
          delivered: null,
          runEnded: false,
        },
      ],
    );
    assert.deepEqual(
      merged.map((item) => item.kind),
      ['chat', 'loop', 'instruction'],
    );
  });

  /**
   * And every call written before this parameter existed still produces exactly
   * what it produced, which is what makes the third argument additive.
   */
  it('is unchanged when no messages are supplied', () => {
    const chat = [chatTurn('run-a', '2026-09-16T21:50:00.000Z')];
    assert.deepEqual(mergeTranscript(chat, [only(sent())]), mergeTranscript(chat, [only(sent())], []));
  });
});

/**
 * A loop entry belongs to the conversation it was sent in, and to no other.
 *
 * The card's whole purpose is to say *this mandate, walked by the loop, on this
 * project*. Carrying it into the next conversation makes it say that about a
 * project it never touched, which is the one thing it must not do — and it is the
 * same mistake the restored-conversation guard in `startSession` exists to
 * prevent for a restored diff.
 */
describe('a loop card belongs to one conversation', () => {
  const mandateA = 'Rename the invoice parser in project A.';
  const nextConversation = { dspatchRunId: 'run-b', startedAtUtc: '2026-09-16T23:00:00.000Z' };

  it('does not follow the user into the next conversation', () => {
    const ended = loopTurnsAfter(sent(mandateA), {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: { kind: 'finished', result: result('completed'), journalText: '', workspaceNote: '' },
    });
    // The next project's column exactly as a person reads it, top to bottom.
    const column = mergeTranscript(
      [nextConversation],
      loopTurnsAfter(ended, { kind: 'conversation-replaced' }),
    );
    const carried = column.flatMap((item) => (item.kind === 'loop' ? [item.turn.mandate] : []));
    assert.deepEqual(
      carried,
      [],
      `the next conversation still shows an earlier one's mandate: ${carried.join(' | ')}`,
    );
    assert.deepEqual(
      column.map((item) => item.kind),
      ['chat'],
      'the new conversation lost its own message',
    );
  });

  it('does not leave an unfinished run behind either', () => {
    const carried = loopTurnsAfter(sent(mandateA), { kind: 'conversation-replaced' }).map(
      (turn) => turn.mandate,
    );
    assert.deepEqual(
      carried,
      [],
      `a loop run still in flight left its mandate behind: ${carried.join(' | ')}`,
    );
  });

  it('is not brought back by its own run reporting late', () => {
    // Switching project does not cancel the outstanding `startChatLoopRun` call,
    // so its result arrives in the next conversation. It must not draw a card
    // there, however complete it is.
    const cleared = loopTurnsAfter(sent(mandateA), { kind: 'conversation-replaced' });
    const late = loopTurnsAfter(cleared, {
      kind: 'run-settled',
      runId: 'chat-loop-1',
      outcome: { kind: 'finished', result: result('completed'), journalText: '', workspaceNote: '' },
    });
    const carried = late.map((turn) => turn.mandate);
    assert.deepEqual(
      carried,
      [],
      `a late result recreated the previous conversation's card: ${carried.join(' | ')}`,
    );
  });
});
