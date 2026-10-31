/**
 * The model choice (DSP-149): a failed lookup is not cached, so *Try again* reads again;
 * a model chosen earlier stays chosen while the list cannot be read; and an agent's list
 * is shared by two askers at once rather than read twice. A stand-in adapter; no
 * provider is asked anything.
 *
 *     node --import ./scripts/ts-resolve.mjs --test tests/model-choice.test.ts   (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import type { ModelInfo } from '../src/adapter/types.ts';
import { ChatService, MODEL_LIST_REUSE_MS, type ChatAdapter } from '../src/main/chat-service.ts';
import type { StoredSessionProvider } from '../src/shared/bridge.ts';
import { listedDefault, modelRows } from '../src/shared/model-rows.ts';

const roots: string[] = [];
after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function service(listModels: () => Promise<readonly ModelInfo[]>): {
  readonly service: ChatService;
  readonly chosen: Map<StoredSessionProvider, string>;
  readonly built: { count: number };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-model-choice-'));
  roots.push(root);
  const chosen = new Map<StoredSessionProvider, string>();
  const built = { count: 0 };
  const adapter = {
    id: 'stand-in',
    listModels,
    dispose: async () => undefined,
  } as unknown as ChatAdapter;
  return {
    chosen,
    built,
    service: new ChatService({
      repoRoot: path.join(root, 'repo-root'),
      sampleProjectsRoot: path.join(root, 'samples'),
      send: () => undefined,
      log: () => undefined,
      readAuthStatus: () => Promise.resolve({ status: 'logged-in', backendUrl: 'https://example.invalid' }),
      claudeAuthorizationReference: null,
      agentChoiceStore: { read: () => 'cursor', write: () => undefined },
      modelChoice: {
        read: (provider) => chosen.get(provider) ?? null,
        write: (provider, modelId) => {
          if (modelId === null) {
            chosen.delete(provider);
          } else {
            chosen.set(provider, modelId);
          }
        },
      },
      createAdapter: () => {
        built.count += 1;
        return adapter;
      },
    }),
  };
}

const MODELS: readonly ModelInfo[] = [
  { id: 'fast', displayName: 'Fast', provider: 'cursor' },
  { id: 'deep', displayName: 'Deep', provider: 'cursor', resolvedId: 'deep-2' },
];

test('a failed lookup says why, keeps the choice, and is read again on Try again', async () => {
  let calls = 0;
  const { service: chat, chosen } = service(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('the provider could not be reached');
    }
    return MODELS;
  });
  chat.setRequestedModel('deep');
  const failed = await chat.listModels('cursor');
  assert.match(String(failed.error), /could not be reached/);
  assert.deepEqual(failed.models, []);
  assert.equal(failed.chosen, 'deep', 'the earlier choice is kept while the list is missing');
  assert.equal(chosen.get('cursor'), 'deep');
  const again = await chat.listModels('cursor');
  assert.equal(again.error, null);
  assert.deepEqual(again.models.map((model) => [model.id, model.resolvedId]), [['fast', undefined], ['deep', 'deep-2']]);
  assert.equal(calls, 2, 'a failure is not cached');
});

test('two askers at once share one lookup', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const { service: chat } = service(async () => {
    calls += 1;
    await gate;
    return MODELS;
  });
  const first = chat.listModels('cursor');
  const second = chat.listModels('cursor');
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a.models, b.models);
});

test("with no choice the provider's default is asked for, not a model DSpatch picks", () => {
  const { service: chat } = service(async () => MODELS);
  assert.equal(chat.modelFor('claude'), process.env['DSPATCH_CLAUDE_MODEL'] ?? '');
});

test('the dropdown names the default model and never shows "Provider\'s default"', () => {
  const listing = {
    provider: 'claude' as const,
    chosen: '',
    error: null,
    source: 'test',
    models: [
      { id: 'default', displayName: 'Default (recommended)', resolvedId: 'claude-opus-5-5' },
      { id: 'opus', displayName: 'Opus 5.5', resolvedId: 'claude-opus-5-5' },
      { id: 'sonnet', displayName: 'Sonnet 5.5', resolvedId: 'claude-sonnet-5-5' },
    ],
  };
  const none = modelRows(listing, '');
  assert.equal(none.value, 'default', 'no choice follows the default');
  assert.deepEqual(none.rows.map((row) => row.label), ['Opus 5.5 · default', 'Opus 5.5', 'Sonnet 5.5']);
  assert.equal(modelRows(listing, 'opus').value, 'opus', 'the plain row is locked to the model');
  assert.equal(modelRows(listing, 'sonnet').value, 'sonnet');
  assert.equal(modelRows(listing, 'default').value, 'default', 'the default stays the default');
  const unknown = modelRows(listing, 'gone');
  assert.match(unknown.rows[0]?.label ?? '', /not offered to this account/);
  const noDefault = modelRows({ ...listing, models: listing.models.slice(1) }, '');
  assert.match(noDefault.rows[0]?.label ?? '', /not identified by the provider/);
  for (const result of [none, unknown, noDefault]) {
    assert.ok(result.rows.every((row) => !row.label.includes("Provider's default")));
  }
});

test("the provider's default says a model, says Auto, or says it is not known, and is never guessed", () => {
  const base = { provider: 'copilot' as const, chosen: '', error: null, source: 'test' };
  const models = [{ id: 'one', displayName: 'One' }, { id: 'two', displayName: 'Two' }];
  const row = (resolvedId?: string) => ({ id: 'copilot-default', displayName: 'Default', providerDefault: true as const, ...(resolvedId === undefined ? {} : { resolvedId }) });

  const named = modelRows({ ...base, models: [row('two'), ...models] }, '');
  assert.equal(named.value, 'copilot-default', 'the name is what it means now, not a choice');
  assert.deepEqual(named.rows.map((entry) => entry.label), ['Two · default', 'One', 'Two']);
  assert.equal(modelRows({ ...base, models: [row('one'), ...models] }, 'copilot-default').value, 'copilot-default', 'a list that names another model changes the words only');
  assert.equal(modelRows({ ...base, models: [row('one'), ...models] }, 'two').value, 'two', 'a chosen model stays chosen');

  const auto = modelRows({ ...base, models: [row('auto'), ...models] }, '');
  assert.equal(auto.value, 'copilot-default', 'asks for no model: the routing stays the provider\'s');
  assert.equal(auto.rows[0]?.label, 'Auto · default');
  assert.doesNotMatch(auto.rows.map((entry) => entry.label).slice(1).join(), /default/);

  const listedAuto = modelRows({ ...base, models: [row('auto'), { id: 'auto', displayName: 'Auto' }, ...models] }, '');
  assert.equal(listedAuto.value, 'copilot-default');
  assert.deepEqual(listedAuto.rows.slice(0, 2).map((entry) => entry.label), ['Auto · default', 'Auto']);

  const unknown = modelRows({ ...base, models: [row(), ...models] }, '');
  assert.equal(unknown.value, 'copilot-default');
  assert.equal(unknown.rows[0]?.label, 'Default model (not identified by the provider)');
  assert.equal(listedDefault({ ...base, models: [row(), ...models] }), 'copilot-default', 'a review\'s start can use it');

  const elsewhere = modelRows({ ...base, models: [row('three'), ...models] }, '');
  assert.equal(elsewhere.rows[0]?.label, 'three · default', 'a default the list does not hold keeps its name');

  assert.equal(modelRows({ ...base, models: [row('two'), ...models] }, 'one').value, 'one', 'a choice is kept');
});

test('a list is read again after a while, so a login needs no restart', async () => {
  let offered: readonly ModelInfo[] = MODELS.slice(0, 1);
  let reads = 0;
  const { service: chat } = service(() => {
    reads += 1;
    return Promise.resolve(offered);
  });
  const clock = Date.now;
  try {
    assert.equal((await chat.listModels('cursor')).models.length, 1);
    await chat.listModels('cursor');
    assert.equal(reads, 1, 'reused at once');
    offered = MODELS;
    const later = Date.now() + MODEL_LIST_REUSE_MS + 1;
    Date.now = () => later;
    assert.equal((await chat.listModels('cursor')).models.length, MODELS.length);
    assert.equal(reads, 2);
  } finally {
    Date.now = clock;
  }
});

test('the default the picker inherits is the row the list marks, never a guess', () => {
  const base = { provider: 'claude' as const, chosen: '', error: null, source: 'test' };
  const marked = { id: 'opus', displayName: 'Opus 5.5', resolvedId: 'claude-opus-5-5' };
  assert.equal(listedDefault({ ...base, models: [{ id: 'default', displayName: 'Default', resolvedId: 'claude-opus-5-5' }, marked] }), 'default', 'the default row is the choice, not the model it names now');
  assert.equal(listedDefault({ ...base, models: [marked] }), '', 'no default named, so the person chooses');
  assert.equal(listedDefault({ ...base, models: [], error: 'not read' }), '');
});
