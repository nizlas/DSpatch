/**
 * The review discussion's agent (DSP-132): explicit, kept, never a fallback; Claude
 * only under the review's own policy (no tools, a deny-all hook that lets the turn go
 * on); a switch is a new session with the recap disclosed; format 1 records stay
 * readable and are not rewritten on read.
 *
 * SIMULATED: Claude is the real `ClaudeAgentSdkAdapter` with its SDK substituted
 * (`queryFn`, `spawnProcess`, `localLookup`), Cursor is never built here (its factory
 * throws), and the presentation adapters answer the switch test. Nothing reaches a
 * provider; the offline guard refuses the real SDK and every non-local connection.
 * Heavy because it runs git.
 *
 *     node scripts/run-tests.mjs review        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  CHAT_PERMISSIONS,
  ClaudeAgentSdkAdapter,
  REVIEW_DENY_REASON,
  REVIEW_PERMISSIONS,
  describePermissionPolicy,
  type ClaudePermissionPolicy,
} from '../src/adapter/claude-agent-sdk-adapter.ts';
import type { ChatAdapter } from '../src/main/chat-service.ts';
import { providerAdapters } from '../src/main/provider-adapters.ts';
import {
  ReviewDiscussions,
  discussionRecordPath,
  discussionWorkingFolder,
} from '../src/main/review-discussion-service.ts';
import { ReviewService } from '../src/main/review-service.ts';
import type { DiscussionIdentity } from '../src/shared/review-discussion.ts';
import { claudeSubstitute, type ClaudeSubstitute } from './support/claude-chat-substitute.ts';
import { makeReviewFixture, type ReviewFixture } from './support/review-fixture.ts';

const CLEAN_ENV = Object.freeze({ PATH: process.env['PATH'] ?? '' });
const POINT = { kind: 'point', walkId: 'W1', stepId: 'W1.1', placeIndex: 0 } as const;

/** The chat's policy digest before DSP-132, pinned: the review fields are omitted, not `undefined`. */
const CHAT_DIGEST = 'claude-agent-sdk:c5b4686f8f657fea8126d18dc395ac70287b7343a65e4862378c94fe8732f2c7';

async function until(condition: () => boolean, what: string, ms = 3_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > ms) {
      throw new Error(`timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface Setup {
  readonly fixture: ReviewFixture;
  readonly review: ReviewService;
  readonly identity: DiscussionIdentity;
  readonly sdk: ClaudeSubstitute;
  /** Every Claude adapter built, and the `resume` calls made on any of them. */
  readonly claudes: ClaudeAgentSdkAdapter[];
  readonly resumes: string[];
  /** Asked for, in order: `<provider>/<purpose>`. */
  readonly asked: string[];
  discussions(options?: { claudeAvailable?: boolean; claudePermissions?: ClaudePermissionPolicy }): ReviewDiscussions;
  file(): string;
}

async function setup(): Promise<Setup> {
  const fixture = makeReviewFixture();
  const review = new ReviewService({ recordsDir: fixture.records, log: () => undefined });
  assert.equal((await review.openDefinition(fixture.definitionPath)).kind, 'opened');
  const identified = await review.identify(fixture.definitionPath);
  assert.ok('identity' in identified);
  const sdk = claudeSubstitute('A text answer.');
  const claudes: ClaudeAgentSdkAdapter[] = [];
  const resumes: string[] = [];
  const asked: string[] = [];
  const s: Setup = {
    fixture,
    review,
    identity: identified.identity,
    sdk,
    claudes,
    resumes,
    asked,
    file: () => discussionRecordPath(fixture.records, identified.identity.key),
    discussions: (options = {}) => {
      const available = options.claudeAvailable !== false;
      const factory = providerAdapters({
        presentation: false,
        claudeAuthorizationReference: available ? 'test-only reference' : null,
        claudeInstalled: true,
        construct: {
          cursor: () => {
            throw new Error('DSP-132: a Cursor adapter was built in a Claude-only test');
          },
          claude: (permissions) => {
            const adapter = new ClaudeAgentSdkAdapter({
              queryFn: sdk.queryFn,
              spawnProcess: sdk.spawnProcess,
              localLookup: sdk.localLookup,
              env: CLEAN_ENV,
              permissions: options.claudePermissions ?? permissions,
            });
            const resume = adapter.resume.bind(adapter);
            adapter.resume = (sessionId, config) => {
              resumes.push(sessionId);
              return resume(sessionId, config);
            };
            claudes.push(adapter);
            return adapter;
          },
        },
      });
      return new ReviewDiscussions({
        recordsDir: fixture.records,
        log: () => undefined,
        createAdapter: (request) => {
          asked.push(`${request.provider}/${request.purpose}`);
          return factory.createAdapter(request);
        },
        availability: (provider) =>
          provider === 'claude' && !available
            ? { choosable: false, reason: 'Claude is not enabled for this launch.' }
            : { choosable: true, reason: null },
      });
    },
  };
  return s;
}

function cleanup(s: Setup): void {
  fs.rmSync(s.fixture.root, { recursive: true, force: true });
}

test('a Claude question builds only Claude, under the review policy, in its own session and empty folder; the deny-all hook refuses every tool and the turn goes on', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    await service.load({ subject: POINT, selection: null }, s.review);
    assert.deepEqual(s.asked, [], 'loading builds nothing');

    const sent = await service.send({ question: 'Why 20?', subject: POINT, selection: null }, s.review);
    assert.equal(sent.kind, 'sent');
    assert.deepEqual(s.asked, ['claude/review'], 'only Claude, only for review');
    const adapter = s.claudes[0];
    assert.ok(adapter !== undefined);
    assert.deepEqual(adapter.permissionPolicy(), REVIEW_PERMISSIONS);
    await until(() => s.sdk.calls.length === 1, 'the query');

    const options = s.sdk.calls[0]?.options ?? {};
    assert.deepEqual(options['tools'], []);
    assert.deepEqual(options['allowedTools'], []);
    assert.deepEqual(options['disallowedTools'], [...(REVIEW_PERMISSIONS.disallowedTools ?? [])]);
    assert.ok((options['disallowedTools'] as string[]).includes('mcp__*'));
    assert.equal(options['strictMcpConfig'], true);
    assert.deepEqual(options['settingSources'], []);
    assert.equal(options['permissionMode'], 'dontAsk');
    assert.equal(options['cwd'], discussionWorkingFolder(s.fixture.records, s.identity.key));
    assert.notEqual(options['cwd'], s.fixture.repo);

    // The deny-all hook: every tool, on every call, with the reason, and no stop.
    const hooks = (options['hooks'] as { PreToolUse: { matcher?: string; hooks: ((input: unknown, id: string | undefined, o: unknown) => Promise<Record<string, any>>)[] }[] }).PreToolUse;
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]?.matcher, undefined, 'no matcher: every tool');
    const denyAll = hooks[0]?.hooks[1];
    assert.ok(denyAll !== undefined, 'a second hook beside the cancellation hook');
    for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'mcp__x']) {
      const output = await denyAll({ tool_name: tool, tool_use_id: `use-${tool}` }, undefined, { signal: new AbortController().signal });
      assert.equal(output['hookSpecificOutput']?.permissionDecision, 'deny', tool);
      assert.equal(output['hookSpecificOutput']?.permissionDecisionReason, REVIEW_DENY_REASON, tool);
      assert.equal(output['continue'], undefined, `${tool}: the turn is not stopped`);
      assert.equal(output['stopReason'], undefined, tool);
    }

    // The question records its agent and its own session.
    await until(() => {
      const raw = JSON.parse(fs.readFileSync(s.file(), 'utf8')) as { messages: { role: string; status: string }[] };
      return raw.messages.some((message) => message.role === 'answer' && message.status === 'done');
    }, 'the answer');
    const stored = JSON.parse(fs.readFileSync(s.file(), 'utf8')) as {
      version: number;
      provider: string;
      messages: { role: string; provider?: string; dspatchSessionId?: string; toolPolicy?: string }[];
    };
    assert.equal(stored.version, 2);
    assert.equal(stored.provider, 'claude');
    const question = stored.messages.find((message) => message.role === 'question');
    assert.equal(question?.provider, 'claude');
    assert.match(question?.dspatchSessionId ?? '', /^dsp-session-/);
    assert.equal(s.resumes.length, 0, 'never resumed');
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test("the review policy's digest differs from the chat's, and the chat's is unchanged", () => {
  const chat = new ClaudeAgentSdkAdapter({ queryFn: () => { throw new Error('unused'); }, permissions: CHAT_PERMISSIONS, env: CLEAN_ENV });
  const review = new ClaudeAgentSdkAdapter({ queryFn: () => { throw new Error('unused'); }, permissions: REVIEW_PERMISSIONS, env: CLEAN_ENV });
  assert.equal(chat.policyDigest(), CHAT_DIGEST);
  assert.notEqual(review.policyDigest(), chat.policyDigest());
  assert.ok(!('disallowedTools' in CHAT_PERMISSIONS) && !('denyEveryTool' in CHAT_PERMISSIONS));
  assert.match(describePermissionPolicy(REVIEW_PERMISSIONS), /^no tools; nothing pre-approved; disallowed Bash, .*mcp__\*; .*every tool call denied by a hook \(the turn continues\)$/);
});

test('the review path never uses an adapter holding another policy: the chat policy is refused and nothing is sent', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions({ claudePermissions: CHAT_PERMISSIONS });
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    const outcome = await service.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    assert.equal(outcome.kind, 'refused');
    assert.match(outcome.kind === 'refused' ? outcome.error : '', /does not hold the review policy/);
    assert.equal(s.sdk.calls.length, 0);
    assert.equal(service.holdsAdapter(), false);
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('a standalone review asks for an agent: nothing is built or sent until one is chosen, and choosing builds nothing', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions();
    const service = discussions.attach(1, s.identity, () => undefined);
    const loaded = await service.load({ subject: POINT, selection: null }, s.review);
    assert.equal(loaded.kind === 'loaded' ? loaded.status.agent.provider : 'x', null);
    const refused = await service.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    assert.equal(refused.kind, 'refused');
    assert.match(refused.kind === 'refused' ? refused.error : '', /^Choose an agent for this discussion/);
    assert.equal(fs.existsSync(s.file()), false, 'nothing written');

    const chosen = await service.chooseAgent('claude');
    assert.equal(chosen.kind, 'chosen');
    assert.equal(chosen.kind === 'chosen' ? chosen.status.agent.provider : null, 'claude');
    assert.deepEqual(s.asked, [], 'choosing builds nothing');
    // Navigating builds nothing either.
    await service.load({ subject: { kind: 'review' }, selection: null }, s.review);
    assert.deepEqual(s.asked, []);
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('a stored agent wins on reopen over the opening window, and an unavailable one is shown with its reason, never replaced', async () => {
  const s = await setup();
  try {
    const first = s.discussions();
    const service = first.attach(1, s.identity, () => undefined);
    assert.equal((await service.chooseAgent('claude')).kind, 'chosen');
    await first.dispose();

    // Reopened from a main window whose agent is Cursor: the discussion stays Claude.
    const again = s.discussions().attach(2, s.identity, () => undefined, 'cursor');
    assert.equal(again.status().agent.provider, 'claude');

    // A launch without Claude: still Claude, with the reason; nothing built or sent.
    const without = s.discussions({ claudeAvailable: false });
    const off = without.attach(3, s.identity, () => undefined, 'cursor');
    const agent = off.status().agent;
    assert.equal(agent.provider, 'claude');
    assert.equal(agent.unavailable, 'Claude is not enabled for this launch.');
    assert.deepEqual(
      agent.options.map((option) => [option.provider, option.choosable]),
      [['cursor', true], ['claude', false]],
    );
    const refused = await off.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    assert.equal(refused.kind, 'refused');
    assert.match(refused.kind === 'refused' ? refused.error : '', /Claude is not enabled for this launch\. Nothing was sent/);
    const chooseRefused = await off.chooseAgent('claude');
    assert.equal(chooseRefused.kind, 'refused', 'an unavailable agent cannot be chosen, even again');
    assert.equal(off.status().agent.provider, 'claude', 'and the stored choice is not replaced');
    assert.deepEqual(s.asked, []);
    await without.dispose();
  } finally {
    cleanup(s);
  }
});

test('Claude cannot be chosen where it is unavailable, with its reason', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions({ claudeAvailable: false });
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    const outcome = await service.chooseAgent('claude');
    assert.equal(outcome.kind, 'refused');
    assert.equal(outcome.kind === 'refused' ? outcome.error : '', 'Claude is not enabled for this launch.');
    assert.equal(service.status().agent.provider, 'cursor');
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('switching agents is a new session with the recap disclosed; Leave out sends the question without it; history is kept', async () => {
  const s = await setup();
  try {
    const factory = providerAdapters({
      presentation: true,
      reviewPresentation: { deltaMs: 1 },
      claudeAuthorizationReference: 'test-only reference',
      claudeInstalled: true,
    });
    const built: string[] = [];
    const discussions = new ReviewDiscussions({
      recordsDir: s.fixture.records,
      log: () => undefined,
      createAdapter: (request) => {
        built.push(request.provider);
        return factory.createAdapter(request) as ChatAdapter;
      },
    });
    const service = discussions.attach(1, s.identity, () => undefined, 'cursor');
    assert.equal((await service.send({ question: 'First question', subject: POINT, selection: null }, s.review)).kind, 'sent');
    await until(() => service.status().turn === null, 'the first answer');
    assert.deepEqual(built, ['cursor']);

    const switched = await service.chooseAgent('claude');
    assert.equal(switched.kind, 'chosen');
    assert.equal(service.holdsAdapter(), false, 'the Cursor session was closed');
    assert.deepEqual(built, ['cursor'], 'choosing built nothing');
    const notice = service.status().agent.switchNotice;
    assert.equal(notice?.provider, 'claude');
    assert.equal(notice?.exchanges, 1);
    assert.match(notice?.recap ?? '', /First question/);
    assert.equal(notice?.leftOut, false);

    assert.equal(service.setRecapLeftOut(true).agent.switchNotice?.leftOut, true);
    assert.equal((await service.send({ question: 'Second question', subject: POINT, selection: null }, s.review)).kind, 'sent');
    await until(() => service.status().turn === null, 'the second answer');
    assert.deepEqual(built, ['cursor', 'claude']);
    const sent = factory.reviewPresentationBehaviour?.record().sent ?? [];
    assert.equal(sent.length, 2);
    assert.doesNotMatch(sent[1] ?? '', /First question/, 'the recap was left out');
    assert.equal(service.status().agent.switchNotice, null);

    const stored = JSON.parse(fs.readFileSync(s.file(), 'utf8')) as { messages: { role: string; provider?: string; dspatchSessionId?: string }[] };
    const questions = stored.messages.filter((message) => message.role === 'question');
    assert.deepEqual(questions.map((question) => question.provider), ['cursor', 'claude'], 'history kept, each with its agent');
    assert.notEqual(questions[0]?.dspatchSessionId, undefined);
    assert.equal(factory.reviewPresentationBehaviour?.record().resumeAttempts.length, 0, 'never resumed');
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('a format 1 Cursor discussion is readable, keeps Cursor, and is not rewritten on read; the next real write makes it format 2', async () => {
  const s = await setup();
  try {
    fs.mkdirSync(path.dirname(s.file()), { recursive: true });
    const v1 = {
      version: 1,
      identity: s.identity,
      messages: [
        { id: 'q-0001', role: 'question', text: 'Old question', at: '2026-10-20T10:00:00.000Z', subject: 'Walk 1', status: 'sent', model: 'claude-haiku-4-5' },
        { id: 'a-0002', role: 'answer', text: 'Old answer', at: '2026-10-20T10:00:05.000Z', subject: 'Walk 1', questionId: 'q-0001', status: 'done' },
      ],
      attempts: [],
      draft: 'kept draft',
      savedAt: '2026-10-20T10:00:06.000Z',
    };
    fs.writeFileSync(s.file(), `${JSON.stringify(v1, null, 2)}\n`, 'utf8');
    const before = fs.readFileSync(s.file(), 'utf8');

    const discussions = s.discussions();
    // Opened from a Claude main window: a stored (Cursor) discussion is not new.
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    const loaded = await service.load(null, s.review);
    assert.equal(loaded.kind, 'loaded');
    assert.equal(loaded.kind === 'loaded' ? loaded.messages.length : 0, 2);
    assert.equal(loaded.kind === 'loaded' ? loaded.messages[0]?.provider : 'x', undefined, 'shown as recorded before the provider was stored');
    assert.equal(service.status().agent.provider, 'cursor');
    // The window saves the same draft back right after loading: no rewrite.
    assert.deepEqual(service.saveDraft('kept draft'), { saved: true });
    assert.equal(fs.readFileSync(s.file(), 'utf8'), before, 'not rewritten on read');

    assert.equal(service.saveDraft('a new draft').saved, true);
    const after = JSON.parse(fs.readFileSync(s.file(), 'utf8')) as { version: number; provider: string; messages: unknown[] };
    assert.equal(after.version, 2);
    assert.equal(after.provider, 'cursor');
    assert.equal(after.messages.length, 2);
    assert.deepEqual(s.asked, []);
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('the factory refuses an unavailable provider before constructing anything, and gives review its own policies', () => {
  const constructed: string[] = [];
  const factory = providerAdapters({
    presentation: false,
    claudeAuthorizationReference: null,
    claudeInstalled: true,
    construct: {
      cursor: (toolPolicy) => {
        constructed.push(`cursor:${toolPolicy}`);
        return {} as ChatAdapter;
      },
      claude: (permissions) => {
        constructed.push(permissions === REVIEW_PERMISSIONS ? 'claude:review' : 'claude:chat');
        return {} as ChatAdapter;
      },
    },
  });
  assert.throws(() => factory.createAdapter({ provider: 'claude', purpose: 'review' }), /Claude is not enabled for this launch/);
  assert.deepEqual(constructed, []);
  factory.createAdapter({ provider: 'cursor', purpose: 'review' });
  factory.createAdapter({ provider: 'cursor', purpose: 'chat' });
  assert.deepEqual(constructed, ['cursor:text-only', 'cursor:provider-default']);

  const withClaude = providerAdapters({
    presentation: false,
    claudeAuthorizationReference: 'test-only reference',
    claudeInstalled: true,
    construct: { claude: (permissions) => {
      constructed.push(permissions === REVIEW_PERMISSIONS ? 'claude:review' : permissions === CHAT_PERMISSIONS ? 'claude:chat' : 'claude:other');
      return {} as ChatAdapter;
    } },
  });
  withClaude.createAdapter({ provider: 'claude', purpose: 'review' });
  withClaude.createAdapter({ provider: 'claude', purpose: 'chat' });
  assert.deepEqual(constructed.slice(2), ['claude:review', 'claude:chat']);
});

test('the review discussion has no route to the chat service or a loop: only the ChatAdapter type is taken', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'main', 'review-discussion-service.ts'), 'utf8');
  const imports = [...source.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)';/gm)].map((match) => ({
    typeOnly: match[1] !== undefined,
    names: match[2] ?? '',
    from: match[3] ?? '',
  }));
  const chat = imports.filter((entry) => entry.from === './chat-service');
  assert.deepEqual(chat.map((entry) => [entry.typeOnly, entry.names.replace(/\s+/g, ' ')]), [[true, '{ ChatAdapter }']]);
  for (const entry of imports) {
    assert.ok(!/loop/.test(entry.from), `no loop module: ${entry.from}`);
    assert.ok(!/cursor-sdk-adapter|presentation-adapter|provider-adapters|main$/.test(entry.from), `no adapter construction here: ${entry.from}`);
  }
});

test('a default from the main window that cannot be used here is not taken: the new discussion asks for a choice (R-1)', async () => {
  const s = await setup();
  try {
    const discussions = s.discussions({ claudeAvailable: false });
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    assert.equal(service.status().agent.provider, null);
    const refused = await service.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    assert.match(refused.kind === 'refused' ? refused.error : '', /^Choose an agent for this discussion/);
    assert.deepEqual(s.asked, []);
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});

test('a Claude adapter that reports no policy is refused on the review path (fails closed, R-1 3b)', async () => {
  const s = await setup();
  try {
    let disposed = false;
    const bare = {
      id: 'claude-agent-sdk',
      startSession: () => Promise.reject(new Error('must not start')),
      dispose: () => {
        disposed = true;
        return Promise.resolve();
      },
    } as unknown as ChatAdapter;
    const discussions = new ReviewDiscussions({
      recordsDir: s.fixture.records,
      log: () => undefined,
      createAdapter: () => bare,
    });
    const service = discussions.attach(1, s.identity, () => undefined, 'claude');
    const outcome = await service.send({ question: 'Q', subject: POINT, selection: null }, s.review);
    assert.equal(outcome.kind, 'refused');
    assert.match(outcome.kind === 'refused' ? outcome.error : '', /does not hold the review policy/);
    assert.ok(disposed);
    await discussions.dispose();
  } finally {
    cleanup(s);
  }
});
