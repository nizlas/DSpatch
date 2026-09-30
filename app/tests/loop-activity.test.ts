/**
 * What a loop step is observed doing, and the two defects that made it invisible.
 *
 * Both of them were correct code reaching a wrong conclusion, which is why the tests
 * that matter here are the two negative controls rather than the happy paths.
 *
 * **The graph.** The editor loaded a watched run's `graphText` with a resolver built
 * from its own `roles` state, and that map is only ever filled for a graph the author
 * opened through the file dialog. The announced chat loop references
 * `docs/loop/roles/project/project-work.role.md`, which was not in it, so the load
 * failed on *a role reference that resolves to nothing is an error* — about roles the
 * main process had already resolved in order to run the graph. The control below
 * breaks it on purpose: with the run's announced roles removed, the real chat-loop
 * graph must still refuse, or the fix is not the fix.
 *
 * **The activity.** `waitForTurn` handled three event types and none of them arrived
 * before the turn ended. What is checked here is the fold and the wording the window
 * reads, against event shapes measured on this account on 19 September 2026 — the
 * lowercase `shell`/`edit` names, `args.command`, `result.value.exitCode`, and the
 * two-megabyte stdout that arrived as `""` with `truncated: null`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '../src/adapter/agent-adapter';
import type {
  AgentEvent,
  AgentEventListener,
  RunReference,
  SessionHandle,
} from '../src/adapter/types';
import { createLiveExecutor, emptyInspection } from '../src/main/loop-live';
import {
  ACTIVITY_QUIET_MS,
  ACTIVITY_WAIT_LEAD,
  describeToolActivity,
  finishStep,
  foldStepActivity,
  runningStep,
  stepStanding,
  type StepActivity,
  type StepActivityState,
} from '../src/shared/loop-activity';
import { loadLoopGraph } from '../src/shared/loop-graph-load';
import { referencedRoles, resolverFromEntries, roleKey } from '../src/shared/loop-graph-editing';
import type { ResolvedRole } from '../src/shared/loop-graph';
import {
  applyRunEvent,
  nodeRunStates,
  runViewFor,
  viewIsReady,
  type LiveRunAnnouncement,
} from '../src/shared/loop-run-view';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

const ADDRESS = { runId: 'chat-loop-1', nodeId: 'work', occurrence: 1 } as const;

function at(seconds: number): string {
  return new Date(Date.UTC(2026, 8, 20, 9, 0, seconds)).toISOString();
}

function started(): StepActivity {
  return {
    ...ADDRESS,
    atUtc: at(0),
    kind: 'step-started',
    roleId: 'project-work',
    roleSourcePath: 'docs/loop/roles/project/project-work.role.md',
  };
}

function openStep(): readonly StepActivityState[] {
  return foldStepActivity([], started());
}

describe('a step that has started and said nothing', () => {
  it('is waiting, not working, and says so in one line', () => {
    const steps = openStep();
    const report = stepStanding({
      step: runningStep(steps, ADDRESS.runId),
      stillWatching: true,
      nowMs: Date.parse(at(150)),
    });
    assert.equal(report.standing, 'waiting');
    // The rule §9 states: no animation may be offered as proof of activity that is
    // not known. It is a value a component reads, not a rule a component remembers.
    assert.equal(report.activityIsKnown, false);
    assert.ok(report.text.startsWith(ACTIVITY_WAIT_LEAD));
    assert.ok(report.text.includes('2 min ago'), report.text);
    // One line. The paragraph defending the wait is what this replaces.
    assert.ok(!report.text.includes('\n'));
  });

  it('separates "nobody is listening" from "nothing has come back"', () => {
    const steps = openStep();
    const unwatched = stepStanding({
      step: runningStep(steps, ADDRESS.runId),
      stillWatching: false,
      nowMs: Date.parse(at(150)),
    });
    assert.equal(unwatched.standing, 'unknown');
    assert.equal(unwatched.activityIsKnown, false);
    // Three answers, three texts. A run DSpatch has stopped following must not read
    // like one it is waiting on: the first is a statement about the run, the second
    // about DSpatch itself.
    assert.notEqual(unwatched.text, 'waiting');
    assert.ok(!unwatched.text.startsWith(ACTIVITY_WAIT_LEAD));
  });
});

describe('a step that is working', () => {
  it('confirms activity from a provider event and names the tool call', () => {
    let steps = openStep();
    steps = foldStepActivity(steps, {
      ...ADDRESS,
      atUtc: at(3),
      kind: 'tool-started',
      callId: 'call-1',
      name: 'shell',
      summary: describeToolActivity('shell', 'started', { args: { command: 'npm test' } })
        .summary,
    });
    const report = stepStanding({
      step: runningStep(steps, ADDRESS.runId),
      stillWatching: true,
      nowMs: Date.parse(at(4)),
    });
    assert.equal(report.standing, 'confirmed');
    assert.equal(report.activityIsKnown, true);
    assert.ok(report.text.includes('npm test'), report.text);
  });

  it('goes back to waiting when the events stop, without claiming a failure', () => {
    let steps = openStep();
    steps = foldStepActivity(steps, {
      ...ADDRESS,
      atUtc: at(3),
      kind: 'reply-text',
      text: 'Reading the tests',
    });
    const quiet = Date.parse(at(3)) + ACTIVITY_QUIET_MS + 1_000;
    const report = stepStanding({
      step: runningStep(steps, ADDRESS.runId),
      stillWatching: true,
      nowMs: quiet,
    });
    assert.equal(report.standing, 'waiting');
    // Time proves neither progress nor failure, so the line states the interval and
    // says nothing about what it means.
    assert.ok(report.text.includes('last update'), report.text);
    assert.ok(!/fail|stuck|hung|broken/i.test(report.text), report.text);
  });

  it('grows the reply text rather than replacing it', () => {
    let steps = openStep();
    steps = foldStepActivity(steps, { ...ADDRESS, atUtc: at(1), kind: 'reply-text', text: 'One ' });
    steps = foldStepActivity(steps, { ...ADDRESS, atUtc: at(2), kind: 'reply-text', text: 'two.' });
    assert.equal(steps[0]?.text, 'One two.');
  });

  it('carries which agent, role and turn the activity belongs to', () => {
    const step = openStep()[0];
    assert.equal(step?.nodeId, 'work');
    assert.equal(step?.roleId, 'project-work');
    assert.equal(step?.roleSourcePath, 'docs/loop/roles/project/project-work.role.md');
    assert.equal(step?.occurrence, 1);
  });

  it('replaces a running call with its completion rather than listing it twice', () => {
    let steps = openStep();
    steps = foldStepActivity(steps, {
      ...ADDRESS,
      atUtc: at(1),
      kind: 'tool-started',
      callId: 'call-1',
      name: 'shell',
      summary: 'running `npm test`',
    });
    steps = foldStepActivity(steps, {
      ...ADDRESS,
      atUtc: at(9),
      kind: 'tool-finished',
      callId: 'call-1',
      name: 'shell',
      status: 'ok',
      summary: 'ran `npm test` and exited 0',
      detail: null,
    });
    assert.equal(steps[0]?.tools.length, 1);
    assert.equal(steps[0]?.tools[0]?.status, 'ok');
    // The start time survives the completion: how long it took is a fact about the
    // call, and taking the completion's time for both would erase it.
    assert.equal(steps[0]?.tools[0]?.startedAtUtc, at(1));
  });
});

describe('a step that is not this one', () => {
  it('drops an event for a step nobody opened, and changes nothing at all', () => {
    const steps = openStep();
    const after = foldStepActivity(steps, {
      runId: 'a-different-run',
      nodeId: 'work',
      occurrence: 1,
      atUtc: at(5),
      kind: 'reply-text',
      text: 'from somewhere else',
    });
    // The same array, not merely an equal one. A stale event does not cost a render.
    assert.equal(after, steps);
  });

  it('treats a second visit to a node as a different step', () => {
    let steps = openStep();
    steps = foldStepActivity(steps, { ...started(), occurrence: 2, atUtc: at(20) });
    assert.equal(steps.length, 2);
    // The newest unfinished one is the live one, so a re-entered node does not
    // resurrect the turn before it.
    assert.equal(runningStep(steps, ADDRESS.runId)?.occurrence, 2);
  });

  it('stops being live once its reply has landed', () => {
    const steps = finishStep(openStep(), ADDRESS);
    assert.equal(runningStep(steps, ADDRESS.runId), null);
    assert.equal(steps[0]?.finished, true);
  });
});

describe('reading a provider tool call', () => {
  // Shapes verbatim from report 002 of run 20260919-012200-agency, measured on this
  // account. Reused rather than re-measured.
  it('reports the command line and the exit code it was actually given', () => {
    const described = describeToolActivity('shell', 'ok', {
      name: 'shell',
      status: 'completed',
      args: { command: 'node -e "process.exit(3)"', timeout: 30000 },
      result: {
        status: 'success',
        value: { exitCode: 3, signal: '', stdout: '', stderr: '', executionTime: 7349 },
      },
    });
    assert.ok(described.summary.includes('node -e "process.exit(3)"'), described.summary);
    assert.ok(described.summary.includes('exited 3'), described.summary);
  });

  it('never says a command printed nothing, because that is not what it was told', () => {
    const described = describeToolActivity('shell', 'ok', {
      args: { command: 'node -e "process.stdout.write(\'x\'.repeat(2000000))"' },
      truncated: null,
      result: {
        status: 'success',
        value: { exitCode: 0, signal: '', stdout: '', stderr: '', executionTime: 6937 },
      },
    });
    // The measured failure mode: two megabytes arrived as "" with `truncated: null`.
    // A record claiming the build printed nothing would be a fabrication wearing a
    // measurement's clothes.
    assert.ok(described.detail !== null);
    assert.ok((described.detail as string).includes('No output was reported'), described.detail ?? '');
    assert.ok(!/printed nothing\./.test(described.detail as string), described.detail ?? '');
  });

  it('names the file an edit touched and keeps the diff it returned', () => {
    const described = describeToolActivity('edit', 'ok', {
      args: { path: 'C:\\tmp\\notes.txt' },
      result: {
        status: 'success',
        value: {
          linesAdded: 1,
          linesRemoved: 1,
          diffString: '--- a/notes.txt\n+++ b/notes.txt\n@@ -1,2 +1,2 @@\n-second line\n+SECOND line',
        },
      },
    });
    assert.ok(described.summary.includes('notes.txt'), described.summary);
    assert.ok(described.summary.includes('+1'), described.summary);
    assert.ok((described.detail ?? '').includes('+SECOND line'));
  });

  it('says only the name of a tool nobody has measured', () => {
    const described = describeToolActivity('some_future_tool', 'ok', { args: {} });
    assert.ok(described.summary.includes('some_future_tool'), described.summary);
    assert.equal(described.detail, null);
  });
});

/* ------------------------------------------------------------------------- */
/* The graph the run announced, drawn from the run's own bindings              */
/* ------------------------------------------------------------------------- */

const chatLoopPath = path.join(repoRoot, 'docs', 'loop', 'graphs', 'dspatch-chat-loop.graph.json');

/** The real bindings, read the way the main process reads them before it runs. */
function announcedRoles(text: string): readonly { key: string; role: ResolvedRole | null }[] {
  return referencedRoles(JSON.parse(text) as never).map((reference) => {
    const file = path.join(repoRoot, reference.source.path);
    const exists = fs.existsSync(file);
    return {
      key: roleKey(reference),
      role: exists
        ? ({
            id: reference.id,
            sourcePath: reference.source.path,
            targets: ['cursor'],
            targetsDeclared: true,
            requirements: [],
            requirementsDeclared: true,
          } satisfies ResolvedRole)
        : null,
    };
  });
}

describe('the graph a watched run is walking', () => {
  it('draws from the bindings the run announced, not from what the window happens to hold', () => {
    const text = fs.readFileSync(chatLoopPath, 'utf8');
    const roles = announcedRoles(text);
    const loaded = loadLoopGraph(text, {
      resolveRole: resolverFromEntries(new Map(roles.map((entry) => [entry.key, entry.role]))),
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, true, 'the chat loop must draw for the window watching it');
  });

  it('still refuses when the run announces no bindings — the control for the fix above', () => {
    /*
     * Broken on purpose, because this comparison is itself the evidence.
     *
     * With the announced roles taken away, the editor is back to the state Niclas met:
     * an empty map, `project-work` and `project-check` resolving to nothing, and a
     * refusal panel where the drawing should be. If this passed, the test above would
     * be proving nothing — the graph would be loading for some other reason and the
     * roles on the announcement would be decoration.
     */
    const text = fs.readFileSync(chatLoopPath, 'utf8');
    const loaded = loadLoopGraph(text, {
      resolveRole: resolverFromEntries(new Map()),
      connectedTargets: ['cursor'],
    });
    assert.equal(loaded.ok, false);
    assert.ok(
      loaded.ok === false &&
        loaded.findings.some((finding) => /role/i.test(finding.message)),
      'the refusal must be about the role references, which is the defect being fixed',
    );
  });
});

/* ------------------------------------------------------------------------- */
/* The executor, and the events it used to drop                               */
/* ------------------------------------------------------------------------- */

/**
 * Just enough adapter to emit the four event types the step now forwards.
 *
 * Deliberately small and local rather than reusing the fuller `FakeAdapter` in
 * `loop-live.test.ts`: that file is in the heavy group because it spawns real
 * processes, and this check spawns nothing, so it belongs where it will actually be
 * run while someone is working.
 */
class EmittingAdapter implements Partial<AgentAdapter> {
  private listener: AgentEventListener | null = null;

  startSession(): Promise<SessionHandle> {
    return Promise.resolve({
      dspatchSessionId: 'dsp-session-fake',
      provider: 'cursor' as const,
      providerSessionId: 'agent-fake',
      createdAt: at(0),
    });
  }

  subscribe(_sessionId: string, listener: AgentEventListener): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  send(): Promise<RunReference> {
    const emit = (event: AgentEvent): void => {
      this.listener?.(event);
    };
    const base = {
      dspatchSessionId: 'dsp-session-fake',
      dspatchRunId: 'dsp-run-1',
      at: at(1),
    };
    queueMicrotask(() => {
      emit({ ...base, type: 'assistant.delta', rawProviderEvent: null, text: 'Reading ' });
      emit({
        ...base,
        type: 'reasoning.delta',
        rawProviderEvent: null,
        text: 'the user probably wants…',
      });
      emit({
        ...base,
        type: 'tool.started',
        toolCallId: 'call-1',
        name: 'shell',
        rawProviderEvent: { args: { command: 'npm test' } },
      });
      emit({
        ...base,
        type: 'tool.finished',
        toolCallId: 'call-1',
        name: 'shell',
        status: 'ok',
        rawProviderEvent: {
          args: { command: 'npm test' },
          result: { status: 'success', value: { exitCode: 0, stdout: 'ok', executionTime: 1200 } },
        },
      });
      emit({ ...base, type: 'assistant.message', rawProviderEvent: null, text: 'DONE' });
      emit({ ...base, type: 'run.finished', rawProviderEvent: null, status: 'finished' });
    });
    return Promise.resolve({ dspatchRunId: 'dsp-run-1' });
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }
}

describe('the events a step forwards', () => {
  it('reports what happens while the turn runs, not only when it ends', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-activity-'));
    try {
      const seen: StepActivity[] = [];
      const executor = createLiveExecutor({
        workspacePath: workspace,
        adapter: new EmittingAdapter() as unknown as AgentAdapter,
        modelRequested: 'composer-2',
        inspection: emptyInspection(workspace, 'composer-2'),
        promptFor: () => 'do the work',
        onStepActivity: (activity) => {
          seen.push(activity);
        },
      });
      await executor({
        runId: 'chat-loop-1',
        graph: { entry: 'work' } as never,
        node: { id: 'work', kind: 'agent' } as never,
        occurrence: 1,
        callId: 1,
        limits: {},
        deadlineAt: null,
        archive: null,
        received: [],
        note: () => {
          /* not this test's business */
        },
      } as never);

      const kinds = seen.map((activity) => activity.kind);
      // The step opens before `send`, which is the interval the whole increment is
      // about: "started and has said nothing" must be distinguishable from "nothing
      // has started".
      assert.equal(kinds[0], 'step-started');
      assert.ok(kinds.includes('reply-text'), kinds.join(', '));
      assert.ok(kinds.includes('tool-started'), kinds.join(', '));
      assert.ok(kinds.includes('tool-finished'), kinds.join(', '));

      /*
       * The control that matters here, and it is an absence.
       *
       * `reasoning.delta` was emitted alongside everything else and must not appear.
       * The assignment asks for available commentary and activity, not private
       * reasoning, and a test asserting only what *is* forwarded would pass just as
       * happily if someone forwarded everything.
       */
      const texts = seen
        .filter((activity) => activity.kind === 'reply-text')
        .map((activity) => (activity as { readonly text: string }).text)
        .join('');
      assert.equal(texts, 'Reading ');
      assert.ok(!texts.includes('the user probably wants'));

      const finished = seen.find((activity) => activity.kind === 'tool-finished');
      assert.ok(
        (finished as { readonly summary: string }).summary.includes('exited 0'),
        'a completed shell call reports its exit code, read from the raw provider message',
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('a loop that has been chosen but not started', () => {
  function readyRun(): LiveRunAnnouncement {
    return {
      runId: 'ready-abc123',
      graphVersionId: 'graph-abc123',
      graphId: 'dspatch-chat-loop',
      graphName: 'Chat loop',
      binding: 'chat-loop',
      graphText: '{}',
      startedAtUtc: at(0),
      phase: 'ready',
    };
  }

  it('marks its entry step ready, which is not the same claim as running', () => {
    const view = runViewFor(readyRun());
    assert.equal(viewIsReady(view), true);
    const states = nodeRunStates(view, 'work');
    assert.equal(states.get('work'), 'ready');
    // Exactly one node is marked. Nothing has been entered, so nothing else may
    // carry a mark that implies it has.
    assert.equal(states.size, 1);
  });

  it('is taken off the screen when the choice is withdrawn, without being called a run that ended', () => {
    const view = runViewFor(readyRun());
    const after = applyRunEvent(view, {
      kind: 'stood-down',
      runId: 'ready-abc123',
      graphVersionId: 'graph-abc123',
    });
    // `null`, not an ended view. A loop that was never started did not end, and a
    // window told otherwise would show a run that never happened.
    assert.equal(after, null);
  });
});
