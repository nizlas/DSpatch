import { endProcessTree, type ProcessTreeDeps } from '../src/adapter/copilot-process-tree.ts';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COPILOT_ANALYSIS_POLICY,
  COPILOT_CALL_CONTROL_FAILED_REASON,
  COPILOT_CHAT_POLICY,
  COPILOT_MANAGED_APPROVAL_REASON,
  COPILOT_REVIEW_POLICY,
  COPILOT_RUNTIME_DEFAULT_MODEL,
  CopilotSdkAdapter,
  copilotEnvironment,
  copilotNotSignedInText,
  copilotPermission,
  copilotPolicyDigest,
  copilotReadAllowed,
  plainCopilotError,
  type CopilotClientLike,
  type CopilotEvent,
  type CopilotSessionLike,
  type CopilotSessionOptions,
} from '../src/adapter/copilot-sdk-adapter.ts';
import type { AgentEvent, AppTool } from '../src/adapter/types.ts';
import { workspaceTools, type WorkspaceToolHost } from '../src/host/workspace-tools.ts';
import { copilotPolicyFor } from '../src/main/provider-adapters.ts';
import { providerAvailability } from '../src/main/provider-availability.ts';

/* DSpatch's own wiring around a substituted SDK client (DSP-148). The real runtime's behaviour is `copilot-runtime.test.ts`. */

const CWD = process.platform === 'win32' ? 'C:\\work\\revisions' : '/work/revisions';
const OUT = process.platform === 'win32' ? 'C:\\work\\repository\\a.ts' : '/work/repository/a.ts';

class FakeSession implements CopilotSessionLike {
  readonly sessionId: string;
  readonly sent: string[] = [];
  aborts = 0;
  idleOnAbort = true;
  private readonly emit: (event: CopilotEvent) => void;

  constructor(sessionId: string, emit: (event: CopilotEvent) => void) {
    this.sessionId = sessionId;
    this.emit = emit;
  }

  send(options: { readonly prompt: string }): Promise<string> {
    this.sent.push(options.prompt);
    return Promise.resolve('m1');
  }

  abort(): Promise<void> {
    this.aborts += 1;
    if (this.idleOnAbort) {
      this.emit({ type: 'session.idle', data: { aborted: true } });
    }
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  event(event: CopilotEvent): void {
    this.emit(event);
  }
}

function fakeClient(auth: { isAuthenticated: boolean; login?: string } = { isAuthenticated: true, login: 'someone' }): {
  client: CopilotClientLike;
  sessions: FakeSession[];
  configs: CopilotSessionOptions[];
  hooks: { hookType: string; origin: string; enabled: boolean }[];
} {
  const sessions: FakeSession[] = [];
  const configs: CopilotSessionOptions[] = [];
  const hooks: { hookType: string; origin: string; enabled: boolean }[] = [];
  const make = (id: string, config: CopilotSessionOptions): Promise<CopilotSessionLike> => {
    configs.push(config);
    const session = new FakeSession(id, config.onEvent);
    sessions.push(session);
    return Promise.resolve(session);
  };
  const client: CopilotClientLike = {
    start: () => Promise.resolve(),
    ping: () => Promise.resolve({}),
    stop: () => Promise.resolve([]),
    forceStop: () => Promise.resolve(),
    getAuthStatus: () => Promise.resolve(auth),
    getStatus: () => Promise.resolve({ version: '1', protocolVersion: 3 }),
    listModels: () => Promise.resolve([{ id: 'gpt-x', name: 'GPT X' }, { id: 'off', name: 'Off', policy: { state: 'disabled' } }]),
    createSession: (config) => make(config.sessionId ?? 'generated', config),
    resumeSession: (id, config) => make(id, config),
    discoverHooks: () => Promise.resolve(hooks),
  };
  return { client, sessions, configs, hooks };
}

describe('ending a runtime with what it started', () => {
  const deps = (platform: NodeJS.Platform, order: string[]): ProcessTreeDeps => ({
    platform,
    childrenOf: (pid) => (pid === 1 ? [2, 3] : pid === 3 ? [4] : []),
    kill: (pid) => order.push(`kill ${String(pid)}`),
    taskkill: (pid) => {
      order.push(`taskkill ${String(pid)}`);
      return Promise.resolve();
    },
  });
  const endRoot = (order: string[]) => (): Promise<void> => {
    order.push('root');
    return Promise.resolve();
  };

  it('on Linux the runtime goes first, then the tree it was seen to hold', async () => {
    const order: string[] = [];
    assert.equal(await endProcessTree(1, endRoot(order), deps('linux', order)), 3);
    assert.deepEqual(order, ['root', 'kill 2', 'kill 3', 'kill 4']);
  });

  it('on Windows `taskkill` walks the tree while the runtime is alive (simulated)', async () => {
    const order: string[] = [];
    assert.equal(await endProcessTree(1, endRoot(order), deps('win32', order)), null);
    assert.deepEqual(order, ['taskkill 1', 'root']);
  });

  it('a process that has ended by itself does not stop the rest', async () => {
    const order: string[] = [];
    const base = deps('linux', order);
    await endProcessTree(1, endRoot(order), {
      ...base,
      kill: (pid) => {
        if (pid === 2) {
          throw new Error('ESRCH');
        }
        order.push(`kill ${String(pid)}`);
      },
    });
    assert.deepEqual(order, ['root', 'kill 3', 'kill 4']);
  });
});

describe('Copilot policies', () => {
  it('the review purpose can never receive the chat policy', () => {
    assert.equal(copilotPolicyFor('review'), COPILOT_REVIEW_POLICY);
    assert.equal(copilotPolicyFor('analysis'), COPILOT_ANALYSIS_POLICY);
    assert.equal(copilotPolicyFor('chat'), COPILOT_CHAT_POLICY);
    assert.equal(copilotPolicyFor('loop'), COPILOT_CHAT_POLICY);
    assert.deepEqual(COPILOT_REVIEW_POLICY.tools, []);
  });

  it('analysis reads stay in the folder, with the runtime\'s own parameter names', () => {
    const allowed = (tool: string, args: unknown): boolean => copilotReadAllowed(tool, args, [CWD], CWD);
    assert.equal(allowed('view', { path: `${CWD}/target/a.ts` }), true);
    assert.equal(allowed('view', { path: 'target/a.ts' }), true);
    assert.equal(allowed('view', { path: OUT }), false);
    assert.equal(allowed('view', { path: '../repository/a.ts' }), false);
    assert.equal(allowed('view', {}), false);
    assert.equal(allowed('grep', { pattern: 'x', paths: [`${CWD}/base`] }), true);
    assert.equal(allowed('grep', { pattern: 'x', paths: [`${CWD}/base`, OUT] }), false);
    assert.equal(allowed('grep', { pattern: 'x', glob: '../**' }), false);
    assert.equal(allowed('glob', { pattern: '**/*.ts' }), true);
    assert.equal(allowed('glob', { pattern: '../**/*.ts' }), false);
    assert.equal(allowed('glob', { pattern: OUT }), false);
    assert.equal(allowed('glob', { pattern: '{..,x}/**' }), false);
    assert.equal(allowed('grep', { pattern: 'x', somewhere: OUT }), false, 'a field the check does not know');
    assert.equal(allowed('create', { path: `${CWD}/x` }), false);
    assert.equal(allowed('bash', { command: 'cat x' }), false);
  });

  it('the permission answer follows the policy and never overrides a managed approval', () => {
    assert.equal(copilotPermission({ kind: 'read', path: `${CWD}/a` }, COPILOT_ANALYSIS_POLICY, [CWD], CWD).kind, 'approve-once');
    assert.equal(copilotPermission({ kind: 'read', path: OUT }, COPILOT_ANALYSIS_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'read', path: `${CWD}/a` }, COPILOT_REVIEW_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'shell' }, COPILOT_ANALYSIS_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'write', fileName: `${CWD}/a` }, COPILOT_ANALYSIS_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'shell' }, COPILOT_CHAT_POLICY, [CWD], CWD).kind, 'approve-once');
    assert.equal(copilotPermission({ kind: 'write', fileName: `${CWD}/a` }, COPILOT_CHAT_POLICY, [CWD], CWD).kind, 'approve-once');
    assert.equal(copilotPermission({ kind: 'write', fileName: OUT }, COPILOT_CHAT_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'url' }, COPILOT_CHAT_POLICY, [CWD], CWD).kind, 'reject');
    assert.equal(copilotPermission({ kind: 'mcp' }, COPILOT_CHAT_POLICY, [CWD], CWD).kind, 'reject');
    assert.deepEqual(copilotPermission({ kind: 'shell', managedApprovalRequired: true }, COPILOT_CHAT_POLICY, [CWD], CWD), { kind: 'reject', feedback: COPILOT_MANAGED_APPROVAL_REASON });
  });

  it('the environment keeps GitHub logins and drops every route to another provider or billing', () => {
    const { env, removed } = copilotEnvironment({
      PATH: 'x',
      GH_TOKEN: 'kept',
      COPILOT_GITHUB_TOKEN: 'kept',
      COPILOT_PROVIDER_BASE_URL: 'http://elsewhere',
      COPILOT_PROVIDER_API_KEY: 'k',
      GITHUB_COPILOT_API_TOKEN: 't',
      COPILOT_API_URL: 'u',
      OPENAI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
    });
    assert.deepEqual(Object.keys(env).sort(), ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'PATH']);
    assert.equal(removed.length, 6);
  });

  it('provider errors read as one plain sentence', () => {
    assert.equal(plainCopilotError('Not authenticated'), copilotNotSignedInText());
    assert.match(plainCopilotError('over quota', 'quota', 429), /out of credits or rate-limited/);
    assert.match(plainCopilotError('forbidden', undefined, 403), /no Copilot access/);
    assert.match(plainCopilotError('boom'), /^Copilot reported an error: boom$/);
  });

  it('availability says what is missing, and needs no login to answer', () => {
    assert.equal(providerAvailability('copilot', { claudeAuthorized: false, claudeInstalled: false, copilotInstalled: true }).choosable, true);
    const missing = providerAvailability('copilot', { claudeAuthorized: false, claudeInstalled: false });
    assert.equal(missing.choosable, false);
    assert.match(missing.reason ?? '', /Reinstall DSpatch/);
  });
});

describe('the Copilot adapter on a substituted client', () => {
  const adapterOver = (client: CopilotClientLike, requireManagedHooks = false): CopilotSdkAdapter =>
    new CopilotSdkAdapter({ policy: COPILOT_ANALYSIS_POLICY, env: {}, clientFactory: () => Promise.resolve(client), requireManagedHooks });

  const session = { provider: 'copilot' as const, modelRequested: 'gpt-x', workspacePath: CWD };

  it('asks for the login first and says where to sign in; nothing is created', async () => {
    const fake = fakeClient({ isAuthenticated: false });
    const adapter = adapterOver(fake.client);
    await assert.rejects(adapter.startSession(session), (error: Error) => error.message === copilotNotSignedInText());
    await assert.rejects(adapter.listModels(), (error: Error) => error.message === copilotNotSignedInText());
    assert.equal(fake.configs.length, 0);
  });

  it('gives the runtime no discovery, no skills, no repository hooks, and exactly the policy\'s tools', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    await adapter.startSession(session);
    const config = fake.configs[0];
    assert.deepEqual(config?.availableTools, ['builtin:view', 'builtin:glob', 'builtin:grep']);
    assert.equal(config?.enableConfigDiscovery, false);
    assert.equal(config?.enableFileHooks, false);
    assert.equal(config?.enableSkills, false);
    assert.equal(config?.skipCustomInstructions, true);
    assert.equal(config?.enableHostGitOperations, false);
    assert.equal(config?.memory.enabled, false);
    assert.equal(config?.provider, undefined);
    assert.equal(adapter.account(), 'someone (unknown login)');
  });

  it('omits the model when the runtime default is asked for, and lists it first', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    await adapter.startSession({ ...session, modelRequested: COPILOT_RUNTIME_DEFAULT_MODEL });
    assert.equal(fake.configs[0]?.model, undefined);
    assert.deepEqual((await adapter.listModels()).map((model) => model.id), [COPILOT_RUNTIME_DEFAULT_MODEL, 'gpt-x']);
  });

  it('refuses work when managed hooks are required and the runtime reports none', async () => {
    const fake = fakeClient();
    await assert.rejects(adapterOver(fake.client, true).startSession(session), /requires managed Copilot hooks/);
    fake.hooks.push({ hookType: 'preToolUse', origin: 'repository', enabled: true });
    await assert.rejects(adapterOver(fake.client, true).startSession(session), /requires managed Copilot hooks/);
    fake.hooks.push({ hookType: 'preToolUse', origin: 'user', enabled: true });
    await adapterOver(fake.client, true).startSession(session);
  });

  it('maps a turn, names reading tools as DSpatch knows them, and ends on idle', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    const handle = await adapter.startSession(session);
    const events: AgentEvent[] = [];
    adapter.subscribe(handle.dspatchSessionId, (event) => events.push(event));
    await adapter.send(handle.dspatchSessionId, 'hello');
    await assert.rejects(adapter.send(handle.dspatchSessionId, 'again'), /active run/);
    const live = fake.sessions[0] as FakeSession;
    live.event({ type: 'assistant.message_delta', data: { deltaContent: 'he' } });
    live.event({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'view', arguments: { path: 'target/a.ts' } } });
    live.event({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: true } });
    live.event({ type: 'assistant.usage', data: { model: 'gpt-reported', inputTokens: 5 } });
    live.event({ type: 'assistant.message', data: { content: 'hello' } });
    live.event({ type: 'session.idle' });
    assert.deepEqual(events.map((event) => event.type), ['run.started', 'assistant.delta', 'tool.started', 'tool.finished', 'usage', 'assistant.message', 'run.finished']);
    const tool = events[2];
    assert.equal(tool?.type === 'tool.started' ? tool.name : '', 'Read');
    assert.equal(tool?.type === 'tool.started' ? tool.subject : '', 'target/a.ts');
    assert.equal(adapter.modelReported(handle.dspatchSessionId), 'gpt-reported');
  });

  it('a session error ends the run as an error with its plain sentence', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    const handle = await adapter.startSession(session);
    const events: AgentEvent[] = [];
    adapter.subscribe(handle.dspatchSessionId, (event) => events.push(event));
    await adapter.send(handle.dspatchSessionId, 'hello');
    const live = fake.sessions[0] as FakeSession;
    live.event({ type: 'session.error', data: { errorType: 'quota', message: 'limit', statusCode: 429 } });
    live.event({ type: 'session.idle' });
    const end = events.at(-1);
    assert.equal(end?.type === 'run.finished' ? end.status : '', 'error');
    assert.match(end?.type === 'run.finished' ? (end.error?.message ?? '') : '', /out of credits/);
  });

  it('a stop the runtime confirms reads as stopped', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    const handle = await adapter.startSession(session);
    const events: AgentEvent[] = [];
    adapter.subscribe(handle.dspatchSessionId, (event) => events.push(event));
    await adapter.send(handle.dspatchSessionId, 'hello');
    await adapter.cancel(handle.dspatchSessionId);
    const end = events.at(-1);
    assert.equal(end?.type === 'run.finished' ? end.status : '', 'cancelled');
    assert.equal(end?.type === 'run.finished' ? end.end : '', 'stopped');
  });

  it('a runtime that stopped under a turn ends it as unknown, not as work still going', async () => {
    const fake = fakeClient();
    const client = { ...fake.client, ping: () => Promise.reject(new Error('gone')) };
    const adapter = new CopilotSdkAdapter({ policy: COPILOT_ANALYSIS_POLICY, env: {}, clientFactory: () => Promise.resolve(client), runtimeCheckMs: 10 });
    const handle = await adapter.startSession(session);
    const events: AgentEvent[] = [];
    adapter.subscribe(handle.dspatchSessionId, (event) => events.push(event));
    await adapter.send(handle.dspatchSessionId, 'hello');
    for (const until = Date.now() + 3_000; events.at(-1)?.type !== 'run.finished' && Date.now() < until; ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const end = events.at(-1);
    assert.equal(end?.type === 'run.finished' ? end.status : '', 'error');
    assert.equal(end?.type === 'run.finished' ? end.end : '', 'unconfirmed');
    assert.match(end?.type === 'run.finished' ? (end.error?.message ?? '') : '', /unknown/);
  });

  it('a session recorded under another policy is not resumed; the same policy is, by the runtime', async () => {
    const fake = fakeClient();
    const adapter = adapterOver(fake.client);
    await assert.rejects(adapter.resume('s', { ...session, expectedToolPolicy: copilotPolicyDigest(COPILOT_CHAT_POLICY) }), /not continued under other rules/);
    const handle = await adapter.resume('s', { ...session, expectedToolPolicy: copilotPolicyDigest(COPILOT_ANALYSIS_POLICY) });
    assert.equal(handle.resumeEvidence, 'provider-answered');
    assert.equal(fake.configs[0]?.sessionId, undefined);
  });
});

describe('a DSpatch tool whose pre hook failed is not run (DSP-164)', () => {
  // The workspace tools, over a host that records every side effect they would have.
  const recorded = (): { host: WorkspaceToolHost; effects: string[] } => {
    const effects: string[] = [];
    const open = { id: 'w0', name: 'Open', folders: [CWD] };
    const host: WorkspaceToolHost = {
      recent: () => [open, { id: 'w1', name: 'Other', folders: [CWD] }],
      openWorkspace: () => open,
      checkFolder: (folder) => folder,
      createWorkspace: (name) => {
        effects.push(`created ${name}`);
        return { id: 'w2' };
      },
      addFolders: (folders) => {
        effects.push(`added ${folders.join(',')}`);
        return { folders: [CWD, ...folders] };
      },
      openWhenTurnEnds: (id) => {
        effects.push(`opens ${id}`);
      },
    };
    return { host, effects };
  };

  const CALLS = [
    { name: 'create_workspace', args: { name: 'New', folders: [CWD] }, effects: ['created New', 'opens w2'] },
    { name: 'add_folders_to_workspace', args: { folders: [OUT] }, effects: [`added ${OUT}`] },
    { name: 'open_workspace', args: { name: 'Other' }, effects: ['opens w1'] },
  ] as const;

  async function turnWithTools(): Promise<{ live: FakeSession; tools: Map<string, AppTool>; effects: string[]; lines: string[] }> {
    const fake = fakeClient();
    const { host, effects } = recorded();
    const tools = new Map<string, AppTool>();
    const lines: string[] = [];
    const adapter = new CopilotSdkAdapter({
      policy: COPILOT_CHAT_POLICY,
      env: {},
      clientFactory: () => Promise.resolve(fake.client),
      // What the runtime would call is what DSpatch hands the factory.
      toolFactory: (tool) => {
        tools.set(tool.name, tool);
        return Promise.resolve(tool.name);
      },
      log: (line) => lines.push(line),
    });
    const handle = await adapter.startSession({ provider: 'copilot', modelRequested: 'gpt-x', workspacePath: CWD, appTools: workspaceTools(host) });
    await adapter.send(handle.dspatchSessionId, 'hello');
    return { live: fake.sessions[0] as FakeSession, tools, effects, lines };
  }

  const hookFor = (live: FakeSession, invocation: string, call: { name: string; args: unknown }): void => {
    live.event({ type: 'hook.start', data: { hookType: 'preToolUse', hookInvocationId: invocation, input: { toolCalls: [{ id: `id-${invocation}`, name: call.name, args: call.args }] } } });
  };

  for (const call of CALLS) {
    it(`${call.name} does nothing when its pre hook timed out`, async () => {
      const { live, tools, effects } = await turnWithTools();
      hookFor(live, 'h1', call);
      live.event({ type: 'hook.end', data: { hookType: 'preToolUse', hookInvocationId: 'h1', success: false, error: { message: 'Hook timed out' } } });
      const result = await tools.get(call.name)?.execute(call.args);
      assert.deepEqual(result, { text: COPILOT_CALL_CONTROL_FAILED_REASON, isError: true });
      assert.deepEqual(effects, []);
    });

    it(`${call.name} still runs when its pre hook allowed it`, async () => {
      const { live, tools, effects } = await turnWithTools();
      hookFor(live, 'h1', call);
      live.event({ type: 'hook.end', data: { hookType: 'preToolUse', hookInvocationId: 'h1', success: true } });
      const result = await tools.get(call.name)?.execute(call.args);
      assert.equal(result?.isError, false, result?.text);
      assert.deepEqual(effects, call.effects);
    });
  }

  it('a call whose hook has not answered when the tool is called waits for it, and runs once it allows', async () => {
    const { live, tools, effects } = await turnWithTools();
    const call = CALLS[0];
    hookFor(live, 'h1', call);
    const running = tools.get(call.name)?.execute(call.args);
    setTimeout(() => live.event({ type: 'hook.end', data: { hookType: 'preToolUse', hookInvocationId: 'h1', success: true } }), 100);
    assert.equal((await running)?.isError, false);
    assert.deepEqual(effects, call.effects);
  });

  it('a call whose hook never answers is refused, not run', async () => {
    const { live, tools, effects, lines } = await turnWithTools();
    const call = CALLS[1];
    hookFor(live, 'h1', call);
    const result = await tools.get(call.name)?.execute(call.args);
    assert.deepEqual(result, { text: COPILOT_CALL_CONTROL_FAILED_REASON, isError: true });
    assert.deepEqual(effects, []);
    assert.ok(lines.some((line) => line.includes('add_folders_to_workspace call was refused before it ran')), lines.join('\n'));
  });

  it('only the refused call is held: another call in the same turn runs', async () => {
    const { live, tools, effects } = await turnWithTools();
    hookFor(live, 'h1', CALLS[0]);
    live.event({ type: 'hook.end', data: { hookType: 'preToolUse', hookInvocationId: 'h1', success: false, error: { message: 'failed' } } });
    assert.equal((await tools.get(CALLS[0].name)?.execute(CALLS[0].args))?.isError, true);
    assert.equal((await tools.get(CALLS[2].name)?.execute(CALLS[2].args))?.isError, false);
    assert.deepEqual(effects, ['opens w1']);
  });
});
