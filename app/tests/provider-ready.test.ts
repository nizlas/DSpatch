import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ProviderSetupState } from '../src/shared/bridge.ts';
import { providerProblem, providerProblemAction, providerProblemText, setupSteps } from '../src/shared/provider-ready.ts';
import { describePlainly } from '../src/renderer/plain-error.ts';
import { describeBridgeFailure } from '../src/renderer/recovery.ts';

const state = (over: Partial<ProviderSetupState>): ProviderSetupState => ({ tool: 'claude', machine: 'm', program: 'ready', consent: true, signedIn: true, ...over });

describe('what stands between a provider and a first message', () => {
  it('is nothing when all is ready, so no dialog opens', () => {
    assert.deepEqual(setupSteps(state({})), []);
    assert.deepEqual(setupSteps(state({ tool: 'copilot' })), []);
  });

  it('is in order for a new machine', () => {
    assert.deepEqual(setupSteps(state({ program: 'absent', consent: false, signedIn: false })), ['consent', 'install', 'sign-in']);
  });

  it('reuses a login: an incomplete install with a valid login is a repair alone', () => {
    assert.deepEqual(setupSteps(state({ program: 'incomplete' })), ['repair']);
  });

  it('asks a signed-in Copilot for nothing, since the fetched CLI only signs in', () => {
    assert.deepEqual(setupSteps(state({ tool: 'copilot', program: 'absent' })), []);
    assert.deepEqual(setupSteps(state({ tool: 'copilot', program: 'absent', signedIn: false })), ['install', 'sign-in']);
  });

  it('asks for no sign-in it cannot tell is needed', () => {
    assert.deepEqual(setupSteps(state({ tool: 'copilot', signedIn: null })), []);
  });
});

describe('a failure setup can resolve', () => {
  it('tells repair, sign-in and set-up apart, for the provider named', () => {
    assert.deepEqual(providerProblem('Claude support needs repair.'), { provider: 'claude', kind: 'repair' });
    assert.deepEqual(providerProblem('Claude support is not installed. Choose Claude to set it up.'), { provider: 'claude', kind: 'install' });
    assert.deepEqual(providerProblem('Copilot is not signed in on box, where this work runs. Nothing was sent.'), { provider: 'copilot', kind: 'sign-in' });
    assert.deepEqual(providerProblem('Not logged in · Please run /login'), { provider: 'claude', kind: 'sign-in' });
  });

  it('claims nothing about network and other failures', () => {
    for (const message of ['fetch failed', 'ECONNRESET', 'The model is overloaded.', 'Cursor is not signed in.']) {
      assert.equal(providerProblem(message), null, message);
    }
  });

  it('reads as one line and one action, with no recovery text beside it', () => {
    const failure = describeBridgeFailure(new Error("Error invoking remote method 'dspatch:send-prompt': Error: Claude support needs repair."));
    assert.equal(failure.kind, 'provider-setup');
    const plain = describePlainly(failure);
    assert.equal(plain.headline, 'Claude support needs repair.');
    assert.equal(plain.nextStep, '');
    const problem = providerProblem(failure.message);
    assert.ok(problem !== null);
    assert.equal(providerProblemText(problem), 'Claude support needs repair.');
    assert.equal(providerProblemAction(problem), 'Repair');
  });
});
