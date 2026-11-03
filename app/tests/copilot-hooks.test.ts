import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  COPILOT_ANALYSIS_POLICY,
  COPILOT_CALL_CONTROL_FAILED_REASON,
  COPILOT_CHAT_POLICY,
  COPILOT_POST_CONTROL_FAILED_TEXT,
  COPILOT_REVIEW_POLICY,
  CopilotSdkAdapter,
  type CopilotToolPolicy,
} from '../src/adapter/copilot-sdk-adapter.ts';
import type { AgentEvent, AppTool, TerminalRunStatus } from '../src/adapter/types.ts';
import { ReviewAgentJobs } from '../src/host/review-agent-jobs.ts';
import { ReviewPairs } from '../src/host/review-pairs.ts';
import { RevisionSnapshots } from '../src/host/revision-snapshots.ts';
import { isPairError, type AgentJob, type PairRecord } from '../src/shared/review-pair.ts';
import { EXCLUDED_MARKER, makeHookFixture, type HookFixture } from './support/copilot-hook-fixture.ts';
import { startStandInModel, type ScriptedTurn, type StandInModel } from './support/copilot-stand-in-model.ts';
import { makePairFixture } from './support/pair-fixture.ts';

/*
 * What happens to Copilot's `preToolUse` and `postToolUse` command hooks on DSpatch's path, with
 * the real runtime running real scripts from a synthetic runtime home and a local stand-in
 * model (contract section 6). What reached the model is read from what the stand-in was sent.
 * It says nothing of any organisation's scripts, or of what a real model does with an answer.
 *
 * Tests named "known gap" pin what is not covered, so a change in it is noticed; they are
 * not a statement that it is acceptable.
 */

const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const RULE = 'secret/';

let model: StandInModel;
let folder: string;
const fixtures: HookFixture[] = [];

function hooks(options: Parameters<typeof makeHookFixture>[0] = {}): HookFixture {
  const fixture = makeHookFixture(options);
  fixtures.push(fixture);
  return fixture;
}

function adapterFor(policy: CopilotToolPolicy, home: string, extra: { readonly requireManagedHooks?: boolean; readonly log?: (message: string) => void } = {}): CopilotSdkAdapter {
  const env: Record<string, string | undefined> = { ...process.env, COPILOT_HOME: home };
  for (const name of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']) {
    delete env[name];
  }
  return new CopilotSdkAdapter({ policy, env, testProvider: { type: 'openai', baseUrl: model.baseUrl, apiKey: 'stand-in' }, ...extra });
}

interface Turn {
  readonly events: AgentEvent[];
  readonly status: TerminalRunStatus;
  readonly error: string | undefined;
  readonly end: string | undefined;
  /** When the run ended, before the adapter was closed. */
  readonly endedAtMs: number;
  /** Everything the model was sent during this turn. */
  readonly sent: string;
}

async function turn(
  policy: CopilotToolPolicy,
  fixture: HookFixture,
  scripted: readonly ScriptedTurn[],
  options: { readonly prompt?: string; readonly appTools?: readonly AppTool[]; readonly onEvent?: (adapter: CopilotSdkAdapter, sessionId: string, event: AgentEvent) => void; readonly log?: (message: string) => void } = {},
): Promise<Turn> {
  const adapter = adapterFor(policy, fixture.home, options.log === undefined ? {} : { log: options.log });
  const asked = model.requests.length;
  model.script(...scripted);
  const handle = await adapter.startSession({ provider: 'copilot', modelRequested: 'stand-in', workspacePath: folder, ...(options.appTools === undefined ? {} : { appTools: options.appTools }) });
  const events: AgentEvent[] = [];
  const finished = new Promise<Extract<AgentEvent, { type: 'run.finished' }>>((resolve) => {
    adapter.subscribe(handle.dspatchSessionId, (event) => {
      events.push(event);
      options.onEvent?.(adapter, handle.dspatchSessionId, event);
      if (event.type === 'run.finished') {
        resolve(event);
      }
    });
  });
  await adapter.send(handle.dspatchSessionId, options.prompt ?? 'Work on it');
  const end = await finished;
  const endedAtMs = Date.now();
  await adapter.dispose();
  // A stopped turn leaves answers it never asked for, which would answer the next test.
  for (let left = scripted.length - (model.requests.length - asked); left > 0; left -= 1) {
    model.forget();
  }
  return { events, status: end.status, error: end.error?.message, end: end.end, endedAtMs, sent: JSON.stringify(model.requests.slice(asked).map((request) => request.messages)) };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hookEnded(pid: number): Promise<void> {
  for (const until = Date.now() + 3_000; isAlive(pid) && Date.now() < until; ) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(isAlive(pid), false, `hook process ${String(pid)} is still running`);
}

function view(file: string): ScriptedTurn {
  return { tool: 'view', args: { path: path.join(folder, file) } };
}

function shell(command: string): ScriptedTurn {
  return { tool: SHELL, args: { command, description: 'a command', mode: 'sync', initial_wait: 20 } };
}

describe('Copilot tool hooks through the real runtime', { timeout: 240_000 }, () => {
  before(async () => {
    model = await startStandInModel();
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-hook-work-'));
    fs.writeFileSync(path.join(folder, 'allowed.txt'), 'allowed content\n');
    fs.mkdirSync(path.join(folder, 'secret'));
    fs.writeFileSync(path.join(folder, 'secret', 'file.txt'), `${EXCLUDED_MARKER}\n`);
  });

  after(async () => {
    await model.close();
    fs.rmSync(folder, { recursive: true, force: true });
    for (const fixture of fixtures) {
      fixture.remove();
    }
  });

  it('an allowed read: each hook runs once, around the call, in the session folder, and the result reaches the model', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { denyMatching: RULE } });
    const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('allowed.txt'), { text: 'done' }]);
    assert.equal(result.status, 'finished');
    assert.ok(result.sent.includes('allowed content'));
    const runs = fixture.invocations();
    assert.deepEqual(runs.map((run) => run.kind), ['pre', 'post'], 'one invocation of each, not doubled by the callback');
    const [pre, post] = runs;
    assert.equal(fs.realpathSync(pre?.cwd ?? ''), fs.realpathSync(folder));
    assert.equal(pre?.input.toolName, 'view');
    assert.equal(pre?.input.toolArgs['path'], path.join(folder, 'allowed.txt'));
    assert.equal(post?.input.toolResult?.resultType, 'success');
    assert.ok(post?.input.toolResult?.textResultForLlm.includes('allowed content'));
    assert.equal(fs.realpathSync(pre?.environment['COPILOT_HOOK_DIR'] ?? ''), fs.realpathSync(path.join(fixture.home, 'hooks')));
    assert.equal(fs.realpathSync(pre?.environment['COPILOT_PROJECT_DIR'] ?? ''), fs.realpathSync(folder));
  });

  it('a denied read stops before the file is read: nothing reaches the model and the post hook does not run', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { denyMatching: RULE } });
    const lines: string[] = [];
    const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('secret/file.txt'), { text: 'done' }], { log: (line) => lines.push(line) });
    assert.equal(result.status, 'finished');
    assert.ok(!result.sent.includes(EXCLUDED_MARKER));
    assert.ok(result.sent.includes('The synthetic rule excludes this path.'), 'the model is told why');
    assert.deepEqual(fixture.invocations().map((run) => run.kind), ['pre']);
    assert.ok(result.events.some((event) => event.type === 'tool.finished' && event.status === 'error'));
    assert.ok(lines.some((line) => line.includes('a view call was refused')), lines.join('\n'));
    assert.ok(!lines.join('\n').includes(EXCLUDED_MARKER));
  });

  it('a search or a command naming the path is denied the same way', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { denyMatching: RULE } });
    const made = path.join(folder, 'ran-denied.txt');
    const result = await turn(
      COPILOT_CHAT_POLICY,
      fixture,
      [
        { tool: 'grep', args: { pattern: 'EXCLUDED', paths: [path.join(folder, 'secret/')], output_mode: 'content' } },
        { tool: 'glob', args: { pattern: 'secret/**' } },
        shell(`node -e "require('fs').writeFileSync('${made.replace(/\\/g, '/')}','x');console.log(require('fs').readFileSync('secret/file.txt','utf8'))"`),
        { text: 'done' },
      ],
    );
    assert.ok(!result.sent.includes(EXCLUDED_MARKER));
    assert.equal(fs.existsSync(made), false, 'the command ran');
    assert.deepEqual(fixture.invocations().map((run) => run.kind), ['pre', 'pre', 'pre']);
  });

  it('known gap: a search of the whole folder or an indirect command passes a path rule, and only the post hook can catch the result', async () => {
    const fixture = hooks();
    const scripted = (): ScriptedTurn[] => [
      { tool: 'grep', args: { pattern: 'EXCLUDED', paths: [folder], output_mode: 'content' } },
      shell(process.platform === 'win32' ? 'Get-Content sec*/file.txt' : 'cat sec*/file.txt'),
      { text: 'done' },
    ];
    fixture.behave({ pre: { denyMatching: RULE } });
    const through = await turn(COPILOT_CHAT_POLICY, fixture, scripted());
    assert.ok(through.sent.includes(EXCLUDED_MARKER), 'the pre rule alone no longer lets this through: update the contract');
    fixture.behave({ pre: { denyMatching: RULE }, post: { replaceResultContaining: EXCLUDED_MARKER } });
    const caught = await turn(COPILOT_CHAT_POLICY, fixture, scripted());
    assert.ok(!caught.sent.includes(EXCLUDED_MARKER), 'the runtime honours a replaced result before the model call');
    assert.ok(caught.sent.includes('The synthetic rule removed this result.'));
  });

  it('known gap: the post hook does not run for a failed tool, so an error message passes it', async () => {
    const fixture = hooks();
    fixture.behave({ post: { replaceResultContaining: EXCLUDED_MARKER } });
    const result = await turn(COPILOT_CHAT_POLICY, fixture, [{ tool: 'view', args: { path: path.join(folder, `absent-${EXCLUDED_MARKER}.txt`) } }, { text: 'done' }]);
    assert.ok(result.sent.includes(EXCLUDED_MARKER), 'the error reached the model unseen by the post hook: update the contract if not');
    assert.deepEqual(fixture.invocations().map((run) => run.kind), ['pre']);
  });

  it('a pre hook that errors or is missing stops that call, and the turn goes on', async () => {
    for (const [fixture, what] of [
      [hooks(), 'exit 1'],
      [hooks({ missingPre: true }), 'missing script'],
    ] as const) {
      fixture.behave({ pre: { exit: 1 } });
      const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('secret/file.txt'), { text: 'done' }]);
      assert.ok(!result.sent.includes(EXCLUDED_MARKER), what);
      assert.ok(result.events.some((event) => event.type === 'tool.finished' && event.status === 'error'), what);
      // `sh` answers 2 for a script it cannot open, which the runtime reads as a denial.
      assert.equal(result.status, 'finished', what);
      assert.equal(result.error, undefined, what);
    }
  });

  it('a pre hook that times out stops a read, a write and a command before they run (the runtime alone would let them through), and only that call', async () => {
    const fixture = hooks({ timeoutSec: 1 });
    fixture.behave({ pre: { sleepMs: 4_000 } });
    const made = path.join(folder, 'made-after-timeout.txt');
    const ran = path.join(folder, 'ran-after-timeout.txt');
    const lines: string[] = [];
    for (const call of [
      view('secret/file.txt'),
      { tool: 'grep', args: { pattern: 'EXCLUDED', paths: [folder], output_mode: 'content' } },
      { tool: 'create', args: { path: made, file_text: 'made\n' } },
      shell(`node -e "require('fs').writeFileSync('${ran.replace(/\\/g, '/')}','x')"`),
    ] satisfies ScriptedTurn[]) {
      const result = await turn(COPILOT_CHAT_POLICY, fixture, [call, { text: 'done' }], { log: (line) => lines.push(line) });
      assert.ok(!result.sent.includes(EXCLUDED_MARKER), JSON.stringify(call));
      assert.equal(result.status, 'finished', JSON.stringify(call));
      assert.equal(result.error, undefined);
      assert.ok(result.sent.includes(COPILOT_CALL_CONTROL_FAILED_REASON), JSON.stringify(call));
      assert.ok(result.events.some((event) => event.type === 'tool.finished' && event.status === 'error'), JSON.stringify(call));
    }
    assert.equal(fs.existsSync(made), false);
    assert.equal(fs.existsSync(ran), false);
    assert.ok(lines.some((line) => line.includes('hook') && line.includes('timed out')), lines.join('\n'));
  });

  it('after a pre hook fails, a DSpatch tool that asks no permission is not run', async () => {
    const fixture = hooks({ timeoutSec: 1 });
    fixture.behave({ pre: { sleepMs: 4_000 } });
    let runs = 0;
    const tool: AppTool = {
      name: 'dspatch_probe',
      description: 'A probe',
      parameters: {},
      execute: () => {
        runs += 1;
        return Promise.resolve({ text: EXCLUDED_MARKER, isError: false });
      },
    };
    const result = await turn(COPILOT_CHAT_POLICY, fixture, [{ tool: 'dspatch_probe', args: {} }, { text: 'done' }], { appTools: [tool] });
    assert.equal(runs, 0, 'the tool ran after its pre hook failed');
    assert.ok(!result.sent.includes(EXCLUDED_MARKER));
    assert.ok(result.sent.includes(COPILOT_CALL_CONTROL_FAILED_REASON));
    assert.equal(result.status, 'finished');
  });

  it('after a pre hook times out for one call, the next calls run and their results reach the model', async () => {
    const fixture = hooks({ timeoutSec: 1 });
    fixture.behave({ pre: { sleepMs: 4_000, sleepMatching: 'secret' } });
    const ran = path.join(folder, 'ran-after-refused.txt');
    const lines: string[] = [];
    const result = await turn(
      COPILOT_CHAT_POLICY,
      fixture,
      [view('secret/file.txt'), view('allowed.txt'), shell(`node -e "require('fs').writeFileSync('${ran.replace(/\\/g, '/')}','x')"`), { text: 'done' }],
      { log: (line) => lines.push(line) },
    );
    assert.equal(result.status, 'finished');
    assert.equal(result.error, undefined);
    assert.ok(!result.sent.includes(EXCLUDED_MARKER));
    assert.ok(result.sent.includes(COPILOT_CALL_CONTROL_FAILED_REASON));
    assert.ok(result.sent.includes('allowed content'));
    assert.equal(fs.existsSync(ran), true, 'a call after the refused one did not run');
    assert.ok(lines.some((line) => line.includes('1 call is refused and the turn goes on')), lines.join('\n'));
    fs.rmSync(ran, { force: true });
  });

  it('known gap: a pre hook that exits 0 with unreadable output counts as allowing, and DSpatch cannot tell', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { stdout: 'this is not a decision' } });
    const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('secret/file.txt'), { text: 'done' }]);
    assert.ok(result.sent.includes(EXCLUDED_MARKER), 'the runtime no longer passes this: update the contract');
    assert.equal(result.status, 'finished');
  });

  it('a pre hook that exits 2 denies without a decision on its output', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { exit: 2 } });
    const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('secret/file.txt'), { text: 'done' }]);
    assert.ok(!result.sent.includes(EXCLUDED_MARKER));
  });

  for (const [what, behaviour] of [
    ['errors', { exit: 1 }],
    ['times out', { sleepMs: 4_000 }],
  ] as const) {
    it(`a post hook that ${what} stops the turn and says the result may have gone; nothing further runs`, async () => {
      const fixture = hooks({ timeoutSec: 1 });
      fixture.behave({ post: behaviour });
      const next = path.join(folder, `after-post-${String(behaviour.exit ?? 0)}.txt`);
      const result = await turn(COPILOT_CHAT_POLICY, fixture, [view('allowed.txt'), { tool: 'create', args: { path: next, file_text: 'x' } }, { text: 'done' }]);
      assert.equal(result.status, 'error');
      assert.equal(result.error, COPILOT_POST_CONTROL_FAILED_TEXT);
      assert.equal(fs.existsSync(next), false, 'a later call ran after the failed control');
    });
  }

  it('a denial printed by a post hook is ignored: only a replaced result counts', async () => {
    const fixture = hooks();
    fixture.behave({ post: { stdout: JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: 'no' }) } });
    const result = await turn(COPILOT_ANALYSIS_POLICY, fixture, [view('secret/file.txt'), { text: 'done' }]);
    assert.ok(result.sent.includes(EXCLUDED_MARKER), 'the runtime now acts on it: update the contract');
  });

  it('a required control: no hook file, or an unreadable one, refuses the session before anything is sent', async () => {
    const empty = hooks();
    fs.rmSync(path.join(empty.home, 'hooks'), { recursive: true });
    for (const fixture of [empty, hooks({ invalidConfiguration: true })]) {
      const adapter = adapterFor(COPILOT_CHAT_POLICY, fixture.home, { requireManagedHooks: true });
      const asked = model.requests.length;
      await assert.rejects(adapter.startSession({ provider: 'copilot', modelRequested: 'stand-in', workspacePath: folder }), /requires managed Copilot hooks/);
      assert.equal(model.requests.length, asked);
      await adapter.dispose();
    }
    const present = hooks();
    const adapter = adapterFor(COPILOT_CHAT_POLICY, present.home, { requireManagedHooks: true });
    await adapter.startSession({ provider: 'copilot', modelRequested: 'stand-in', workspacePath: folder });
    await adapter.dispose();
  });

  it('a stop while a hook runs ends the turn within the bound, and the tool does not run', async () => {
    const fixture = hooks({ timeoutSec: 60 });
    fixture.behave({ pre: { sleepMs: 30_000 } });
    const made = path.join(folder, 'made-after-stop.txt');
    const started = Date.now();
    let stopped = false;
    const result = await turn(COPILOT_CHAT_POLICY, fixture, [{ tool: 'create', args: { path: made, file_text: 'x' } }, { text: 'done' }], {
      onEvent: (adapter, sessionId, event) => {
        if (!stopped && event.type === 'tool.started') {
          stopped = true;
          setTimeout(() => {
            void adapter.cancel(sessionId);
          }, 500);
        }
      },
    });
    assert.equal(result.status, 'cancelled');
    assert.ok(result.endedAtMs - started < 16_000, `took ${String(result.endedAtMs - started)} ms, end ${String(result.end)}`);
    assert.equal(result.end, 'forced');
    assert.equal(fs.existsSync(made), false);
    await hookEnded(fixture.invocations()[0]?.pid ?? 0);
  });

  it('with two sessions, a stop during a slow hook ends that one alone and takes the hook process with it', async () => {
    const fixture = hooks({ timeoutSec: 60 });
    fixture.behave({ pre: { sleepMs: 30_000, sleepMatching: 'stopped-file' } });
    const made = path.join(folder, 'stopped-file.txt');
    const adapter = adapterFor(COPILOT_CHAT_POLICY, fixture.home);
    const config = { provider: 'copilot' as const, modelRequested: 'stand-in', workspacePath: folder };
    const stopped = await adapter.startSession(config);
    const working = await adapter.startSession(config);
    const seen = new Map<string, AgentEvent[]>([[stopped.dspatchSessionId, []], [working.dspatchSessionId, []]]);
    const listen = (id: string): void => {
      adapter.subscribe(id, (event) => seen.get(id)?.push(event));
    };
    listen(stopped.dspatchSessionId);
    listen(working.dspatchSessionId);
    const ended = async (id: string, count = 1): Promise<Extract<AgentEvent, { type: 'run.finished' }>> => {
      for (const until = Date.now() + 40_000; Date.now() < until; ) {
        const ends = (seen.get(id) ?? []).filter((event) => event.type === 'run.finished');
        if (ends.length >= count) {
          return ends[count - 1] as Extract<AgentEvent, { type: 'run.finished' }>;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('the run did not end');
    };

    model.script({ tool: 'create', args: { path: made, file_text: 'x' } });
    const run = await adapter.send(stopped.dspatchSessionId, 'Slow');
    for (const until = Date.now() + 20_000; fixture.invocations().length === 0 && Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const hook = fixture.invocations()[0]?.pid ?? 0;
    assert.ok(isAlive(hook), 'the hook is running');

    // B reads, then its model takes longer than the stop's bound: its work spans A's whole end.
    model.script(view('allowed.txt'), { text: 'B answered', delayMs: 10_000 });
    const asked = model.requests.length;
    await adapter.send(working.dspatchSessionId, 'Normal');
    void adapter.cancel(stopped.dspatchSessionId);
    const end = await ended(stopped.dspatchSessionId);
    assert.equal(end.status, 'cancelled');
    assert.equal(end.end, 'forced');
    assert.equal(end.dspatchRunId, run.dspatchRunId);
    await hookEnded(hook);
    assert.deepEqual(fixture.slept(), [], 'the hook was ended, not left to finish');
    assert.equal(fs.existsSync(made), false);
    assert.equal(adapter.hasActiveRun(working.dspatchSessionId), true, 'B is still working');

    const answered = await ended(working.dspatchSessionId);
    assert.equal(answered.status, 'finished', JSON.stringify(answered));
    const messages = (seen.get(working.dspatchSessionId) ?? []).filter((event) => event.type === 'assistant.message');
    assert.deepEqual(messages.map((event) => (event.type === 'assistant.message' ? event.text : '')), ['B answered']);
    assert.ok(JSON.stringify(model.requests.slice(asked)).includes('allowed content'));

    // A new turn in B, a new session, and A again from the runtime's own record.
    model.script({ text: 'B again' }, { text: 'C answered' }, { text: 'A resumed' });
    await adapter.send(working.dspatchSessionId, 'More');
    assert.equal((await ended(working.dspatchSessionId, 2)).status, 'finished');
    const next = await adapter.startSession(config);
    seen.set(next.dspatchSessionId, []);
    listen(next.dspatchSessionId);
    const nextRun = await adapter.send(next.dspatchSessionId, 'New');
    const nextEnd = await ended(next.dspatchSessionId);
    assert.equal(nextEnd.status, 'finished');
    assert.equal(nextEnd.dspatchRunId, nextRun.dspatchRunId);
    const resumed = await adapter.resume(stopped.dspatchSessionId, config);
    const afterwards: AgentEvent[] = [];
    adapter.subscribe(resumed.dspatchSessionId, (event) => afterwards.push(event));
    await adapter.send(resumed.dspatchSessionId, 'After');
    for (const until = Date.now() + 20_000; !afterwards.some((event) => event.type === 'run.finished') && Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(afterwards.at(-1)?.type === 'run.finished' ? afterwards.at(-1)?.type : '', 'run.finished');

    // Nothing of the stopped run came later, on any session.
    const all = [...seen.values()].flat();
    assert.equal(all.filter((event) => event.type === 'run.finished' && event.dspatchRunId === run.dspatchRunId).length, 1);
    assert.equal((seen.get(stopped.dspatchSessionId) ?? []).at(-1)?.type, 'run.finished');
    await adapter.dispose();
    await hookEnded(hook);
  });

  it('known gap: text DSpatch itself sends passes no tool hook', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { denyMatching: EXCLUDED_MARKER } });
    const result = await turn(COPILOT_REVIEW_POLICY, fixture, [{ text: 'An answer.' }], { prompt: `The diff:\n+${EXCLUDED_MARKER}\n` });
    assert.ok(result.sent.includes(EXCLUDED_MARKER));
    assert.deepEqual(fixture.invocations(), []);
  });

  it('a walk reads the exported revision: the hook runs there, sees a path under target/, and a path pattern denies it', async () => {
    const fixture = hooks();
    fixture.behave({ pre: { denyMatching: 'src/keep\\.ts' } });
    const pair = await makePairFixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-copilot-hook-jobs-'));
    const pairs = new ReviewPairs({ recordsDir: path.join(dir, 'pairs'), changed: () => undefined });
    await pairs.repositories([pair.workspace]);
    const opened = await pairs.openPair({ repository: pair.app, base: pair.appBase, target: pair.appTarget });
    if (isPairError(opened)) {
      throw new Error(opened.error);
    }
    const jobs = new ReviewAgentJobs({
      recordsDir: dir,
      createAdapter: () => adapterFor(COPILOT_ANALYSIS_POLICY, fixture.home),
      snapshots: new RevisionSnapshots({ root: path.join(dir, 'revisions'), log: () => undefined }),
      availability: () => ({ choosable: true, reason: null }),
      pairs,
      language: () => Promise.resolve('en'),
      log: () => undefined,
    });
    const asked = model.requests.length;
    model.script({ tool: 'view', args: { path: path.join('target', 'src', 'keep.ts') } }, { text: '```json\n{"summary":"x","walks":[]}\n```' });
    const started = jobs.start(opened.key, { kind: 'walks', provider: 'copilot', model: 'stand-in' });
    assert.ok(!isPairError(started));
    const until = Date.now() + 40_000;
    let job: AgentJob | undefined;
    while (Date.now() < until) {
      job = (pairs.state(opened.key) as PairRecord).jobs.find((entry) => entry.id === started.id);
      if (job !== undefined && job.state !== 'running' && job.state !== 'cancelling') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await jobs.dispose();
    const [pre] = fixture.invocations();
    assert.ok(pre !== undefined, 'the hook did not run on the review path');
    const seen = String(pre.input.toolArgs['path']).replaceAll('\\', '/');
    assert.equal(fs.existsSync(path.join(pre.cwd, '.git')), false, 'a revision folder is no repository');
    assert.ok(path.basename(path.dirname(path.dirname(pre.cwd))) === 'reviews' || pre.cwd.includes('revisions'), pre.cwd);
    assert.ok(seen.endsWith('target/src/keep.ts'), seen);
    assert.deepEqual(fixture.invocations().map((run) => run.kind), ['pre'], 'denied, so no post hook');
    const content = fs.readFileSync(path.join(pair.app, 'src', 'keep.ts'), 'utf8').trim();
    const results = JSON.stringify(model.requests.slice(asked).flatMap((request) => request.messages.filter((message) => message.role === 'tool')));
    assert.ok(content !== '' && !results.includes(JSON.stringify(content).slice(1, -1)), 'the file reached the model');
    assert.ok(results.includes('The synthetic rule excludes this path.'), results);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
});
