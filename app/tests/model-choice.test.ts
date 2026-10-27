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
import { ChatService, type ChatAdapter } from '../src/main/chat-service.ts';
import type { StoredSessionProvider } from '../src/shared/bridge.ts';

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
