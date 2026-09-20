/**
 * The saved-conversation files.
 *
 * What is worth testing here is not that JSON round-trips. It is the set of things
 * that would quietly destroy a user's record of their own work:
 *
 * - A file written by a later DSpatch, or hand-edited into something this build
 *   cannot parse, must be **left exactly as it is**. Never repaired, never
 *   overwritten by the next save.
 * - A file whose attempts carry a state this build has never heard of must not
 *   produce an attempt at all, because an unrecognised state can be neither settled
 *   nor reconciled and would block every later message with no way out.
 * - Message order must survive the file, by the recorded ordinal rather than by
 *   array position.
 * - No secret may be in a saved file. The test for that is a search of the written
 *   bytes, not an inspection of the type.
 *
 *     node --test tests/conversation-store.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  CONVERSATION_FORMAT_VERSION,
  ConversationStore,
  isUsableConversationId,
  newConversationId,
} from '../src/main/conversation-store.ts';
import type { StoredAttempt, StoredConversation } from '../src/shared/bridge.ts';

const roots: string[] = [];

function storeIn(name: string): { store: ConversationStore; directory: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `dspatch-conv-${name}-`));
  roots.push(root);
  const directory = path.join(root, 'nested', 'conversations');
  return { store: new ConversationStore(directory, '9.9.9-test'), directory };
}

after(() => {
  for (const root of roots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function conversation(overrides: Partial<StoredConversation> = {}): StoredConversation {
  const base: StoredConversation = {
    formatVersion: CONVERSATION_FORMAT_VERSION,
    conversationId: 'dsp-conv-20260915000000-aaaaaa',
    createdAtUtc: '2026-09-15T00:00:00.000Z',
    savedAtUtc: '2026-09-15T00:05:00.000Z',
    appVersion: 'written-by-the-test',
    project: {
      path: path.join(os.tmpdir(), 'a-project'),
      git: {
        isGitRepository: true,
        headRevision: 'abc123',
        branch: 'main',
        dirtyFiles: [],
        error: null,
        gitVersion: 'git version 2.0.0',
        observedAtUtc: '2026-09-15T00:00:00.000Z',
      },
    },
    session: {
      dspatchSessionId: 'dsp-session-1',
      providerSessionId: 'provider-1',
      modelRequested: 'claude-haiku-4-5',
      createdAt: '2026-09-15T00:00:00.000Z',
      toolPolicy: 'provider-default',
      origin: 'chosen-folder',
      workspaceOrigin: 'a folder you chose',
      suggestedTestCommand: 'npm test',
      suggestedTestCwd: path.join(os.tmpdir(), 'a-project'),
      testCommandNote: 'derived from package.json',
    },
    messages: [],
    attempts: [],
    testRuns: [],
    lastTestAttemptId: null,
    baseline: null,
    reviewedDiff: null,
  };
  return { ...base, ...overrides };
}

test('a conversation written is read back with its own fields', () => {
  const { store } = storeIn('roundtrip');
  const original = conversation({
    messages: [
      {
        ordinal: 0,
        dspatchRunId: 'run-1',
        prompt: 'what does this project do',
        answer: 'it dispatches',
        deltaCount: 12,
        toolEvents: 2,
        terminalStatus: 'finished',
        errorMessage: null,
        totalTokens: 480,
        startedAtUtc: '2026-09-15T00:01:00.000Z',
        finishedAtUtc: '2026-09-15T00:01:20.000Z',
      },
    ],
  });
  const written = store.write(original);
  assert.equal(written.error, null);
  assert.ok((written.bytesWritten ?? 0) > 0);

  const read = store.read(original.conversationId).conversation;
  assert.ok(read !== null);
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0]?.prompt, 'what does this project do');
  assert.equal(read.messages[0]?.totalTokens, 480);
  assert.equal(read.project.path, original.project.path);
  // The build that wrote the file, stamped by the store rather than by the caller.
  assert.equal(read.appVersion, '9.9.9-test');
});

test('messages come back in their recorded order, not the array order', () => {
  const { store, directory } = storeIn('order');
  const original = conversation();
  store.write(original);
  const filePath = path.join(directory, `${original.conversationId}.json`);
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  // Written by hand in the wrong order, which is what a merge or a hand edit does.
  onDisk['messages'] = [
    { ordinal: 2, dspatchRunId: 'run-3', prompt: 'third' },
    { ordinal: 0, dspatchRunId: 'run-1', prompt: 'first' },
    { ordinal: 1, dspatchRunId: 'run-2', prompt: 'second' },
  ];
  fs.writeFileSync(filePath, JSON.stringify(onDisk), 'utf8');

  const read = store.read(original.conversationId).conversation;
  assert.deepEqual(
    read?.messages.map((message) => message.prompt),
    ['first', 'second', 'third'],
  );
});

test('a file from a newer DSpatch is not read, and the next save leaves it alone', () => {
  const { store, directory } = storeIn('newer');
  const id = 'dsp-conv-20260915000000-future';
  const future = {
    formatVersion: CONVERSATION_FORMAT_VERSION + 1,
    conversationId: id,
    somethingThisBuildHasNeverHeardOf: ['keep me'],
  };
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(future, null, 2), 'utf8');

  const read = store.read(id);
  assert.equal(read.conversation, null);
  assert.equal(read.readOnly, true);
  assert.match(String(read.error), /newer than the/);

  const written = store.write(conversation({ conversationId: id }));
  assert.notEqual(written.error, null);
  assert.match(String(written.error), /left exactly as it is/);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), future);
});

test('an unparsable file is reported, listed and never overwritten', () => {
  const { store, directory } = storeIn('broken');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'dsp-conv-broken.json');
  fs.writeFileSync(filePath, '{ half a file', 'utf8');

  const read = store.read('dsp-conv-broken');
  assert.equal(read.conversation, null);
  assert.match(String(read.error), /not valid JSON/);

  // Visible in the list rather than missing from it: a conversation the user can
  // see and cannot open is a problem they can act on.
  const listing = store.list();
  assert.equal(listing.entries.length, 1);
  assert.equal(listing.entries[0]?.conversationId, 'dsp-conv-broken');
  assert.notEqual(listing.entries[0]?.error, null);

  store.write(conversation({ conversationId: 'dsp-conv-broken' }));
  assert.equal(fs.readFileSync(filePath, 'utf8'), '{ half a file');
});

// --- Degrading honestly (DSP-4 AC#5, storage half) --------------------------
//
// The requirement is not that a damaged file is detected. It is that every way a
// file can be unusable produces a readable explanation **and** a concrete thing
// the user can do, and that nothing is ever silently lost. So each case below
// checks three things: the conversation is not returned, the recovery text exists
// and names the two actions that work on a file DSpatch cannot parse, and the
// bytes on disk are untouched afterwards.

/** The ways a stored file can be unusable, and what each one should say. */
const DAMAGE: readonly {
  readonly name: string;
  readonly id: string;
  readonly contents: string;
  readonly error: RegExp;
  readonly recovery: RegExp;
}[] = [
  {
    name: 'truncated mid-value',
    id: 'dsp-conv-cut',
    contents: '{"formatVersion":1,"conversationId":"dsp-conv-cut","messages":[{"ord',
    error: /looks cut short/,
    recovery: /ends in the middle of a value/,
  },
  {
    name: 'valid JSON that is not an object',
    id: 'dsp-conv-notobject',
    contents: '["this is a list, not a conversation"]',
    error: /does not contain a JSON object/,
    recovery: /not a conversation at all/,
  },
  {
    name: 'an object with no format version',
    id: 'dsp-conv-noversion',
    contents: '{"conversationId":"dsp-conv-noversion","messages":[]}',
    error: /no usable formatVersion/,
    recovery: /will not guess/,
  },
  {
    name: 'a format version from the future',
    id: 'dsp-conv-future',
    contents: '{"formatVersion":99,"conversationId":"dsp-conv-future"}',
    error: /newer than the/,
    recovery: /Open it with that build/,
  },
  {
    name: 'structurally wrong but perfectly parsable',
    id: 'dsp-conv-shape',
    contents: '{"formatVersion":1,"conversationId":"dsp-conv-shape","project":42}',
    error: /does not have the fields/,
    recovery: /will not invent them/,
  },
  {
    name: 'hand-edited into invalid JSON',
    id: 'dsp-conv-typo',
    contents: '{"formatVersion": 1, "conversationId": "dsp-conv-typo",}',
    error: /not valid JSON/,
    recovery: /edited by hand/,
  },
];

for (const damage of DAMAGE) {
  test(`a file that is ${damage.name} explains itself and offers a way out`, () => {
    const { store, directory } = storeIn(`damage-${damage.id}`);
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, `${damage.id}.json`);
    fs.writeFileSync(filePath, damage.contents, 'utf8');

    const read = store.read(damage.id);
    assert.equal(read.conversation, null, 'nothing half-guessed is returned');
    assert.match(String(read.error), damage.error);

    // The explanation is not enough on its own: AC#5 asks for an action.
    const recovery = String(read.recovery);
    assert.match(recovery, damage.recovery);
    assert.match(recovery, /Export a copy/, 'the way to rescue the bytes is named');
    assert.match(recovery, /Show the file/, 'the way to find the file is named');
    assert.match(recovery, /Nothing has been changed/);

    // The same explanation and action reach the list, which is where the user is
    // when they discover the problem — they have not opened anything yet.
    const entry = store.list().entries.find((row) => row.conversationId === damage.id);
    assert.notEqual(entry, undefined, 'a damaged file is listed, not hidden');
    assert.notEqual(entry?.error, null);
    assert.notEqual(entry?.recovery, null);

    // Not silent loss: reading, listing and exporting all left the bytes alone.
    assert.equal(fs.readFileSync(filePath, 'utf8'), damage.contents);

    // And the bytes are reachable for export even though nothing could parse them.
    const bytes = store.readBytes(damage.id);
    assert.equal(bytes.error, null);
    assert.equal(bytes.bytes?.toString('utf8'), damage.contents);
  });
}

test('a missing file is not damage, and says nothing alarming', () => {
  const { store } = storeIn('absent');
  const read = store.read('dsp-conv-never-existed');
  assert.equal(read.conversation, null);
  assert.equal(read.error, null, 'not having a file is the normal first run');
  assert.equal(read.recovery, null);
  assert.equal(read.readOnly, false);
});

test('an ID that could escape the directory is refused by readBytes too', () => {
  // The export path does not go through `read`, so it needs its own guard rather
  // than inheriting one.
  const { store } = storeIn('escape-bytes');
  for (const id of ['../../secrets', 'a/b', 'C:\\Windows\\win.ini', '']) {
    const bytes = store.readBytes(id);
    assert.equal(bytes.bytes, null);
    assert.match(String(bytes.error), /not a usable conversation ID/);
  }
});

test('an interrupted save is reported as a leftover file and never deleted', () => {
  // `write` renames a temporary into place, so a process that dies mid-write
  // leaves the temporary and the previous complete file. The leftover is the only
  // evidence that a save was lost; sweeping it up would tidy away the trace.
  const { store, directory } = storeIn('partial');
  const saved = conversation({ conversationId: 'dsp-conv-intact' });
  store.write(saved);
  const leftover = path.join(directory, 'dsp-conv-intact.json.writing-4242');
  fs.writeFileSync(leftover, '{"formatVersion":1,"conv', 'utf8');

  const listing = store.list();
  assert.equal(listing.partialWrites.length, 1);
  assert.equal(listing.partialWrites[0]?.fileName, 'dsp-conv-intact.json.writing-4242');
  assert.equal(listing.partialWrites[0]?.bytes, 24);

  // Reported once. `error` used to carry a second sentence about the same leftover,
  // and report 008 measured the window showing both — the file named twice, in two
  // slightly different sets of words. `error` means "the list could not be read",
  // which is not what an unfinished save is: the list beside it is complete.
  assert.equal(listing.error, null);
  assert.match(String(listing.recovery), /left alone rather than tidied away/);

  // The unfinished write is not mistaken for a conversation, and the complete
  // file beside it is still whole and still readable.
  assert.deepEqual(
    listing.entries.map((entry) => entry.conversationId),
    ['dsp-conv-intact'],
  );
  assert.equal(store.read('dsp-conv-intact').conversation?.conversationId, 'dsp-conv-intact');
  assert.equal(fs.existsSync(leftover), true, 'DSpatch does not clean this up by itself');
});

test('an attempt whose state this build does not know does not become an attempt', () => {
  const { store, directory } = storeIn('badstate');
  const original = conversation();
  store.write(original);
  const filePath = path.join(directory, `${original.conversationId}.json`);
  const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  onDisk['attempts'] = [
    { attemptId: 'dsp-attempt-0001', kind: 'agent-turn', state: 'running' },
    { attemptId: 'dsp-attempt-0002', kind: 'agent-turn', state: 'quantum-superposition' },
    { attemptId: 'dsp-attempt-0003', kind: 'telepathy', state: 'running' },
    { attemptId: '', kind: 'command', state: 'running' },
  ];
  fs.writeFileSync(filePath, JSON.stringify(onDisk), 'utf8');

  const read = store.read(original.conversationId).conversation;
  assert.deepEqual(
    read?.attempts.map((attempt) => attempt.attemptId),
    ['dsp-attempt-0001'],
  );
});

test('no directory yet is the normal first run', () => {
  const { store } = storeIn('empty');
  const listing = store.list();
  assert.deepEqual(listing.entries, []);
  assert.equal(listing.error, null);
});

test('the list is newest first and counts what a row has to warn about', () => {
  const { store } = storeIn('list');
  store.write(
    conversation({
      conversationId: 'dsp-conv-older',
      savedAtUtc: '2026-09-15T00:00:00.000Z',
    }),
  );
  store.write(
    conversation({
      conversationId: 'dsp-conv-newer',
      savedAtUtc: '2026-09-15T09:00:00.000Z',
      attempts: [
        {
          attemptId: 'dsp-attempt-0001',
          kind: 'agent-turn',
          label: 'a message',
          state: 'running',
          stateReason: 'started',
          requestedAtUtc: '2026-09-15T08:59:00.000Z',
          endedAtUtc: null,
          providerRunId: 'run-1',
          localPid: null,
          cancelRequestedAtUtc: null,
          acknowledgedAtUtc: null,
          history: [],
        },
        {
          attemptId: 'dsp-attempt-0002',
          kind: 'command',
          label: 'npm test',
          state: 'completed',
          stateReason: 'exit 0',
          requestedAtUtc: '2026-09-15T08:59:30.000Z',
          endedAtUtc: '2026-09-15T08:59:50.000Z',
          providerRunId: null,
          localPid: 4242,
          cancelRequestedAtUtc: null,
          acknowledgedAtUtc: null,
          history: [],
        },
      ],
    }),
  );

  const listing = store.list();
  assert.deepEqual(
    listing.entries.map((entry) => entry.conversationId),
    ['dsp-conv-newer', 'dsp-conv-older'],
  );
  assert.equal(listing.entries[0]?.unresolvedAttemptCount, 1);
  assert.equal(listing.entries[1]?.unresolvedAttemptCount, 0);
  assert.equal(listing.entries[0]?.hasReviewedDiff, false);
  // Unresolved and unconfirmed are two different counts, and the row says different
  // things about them. This one was never confirmed.
  assert.equal(listing.entries[0]?.unacknowledgedAttemptCount, 1);
});

test('an unresolved attempt already confirmed is counted apart from one that is not', () => {
  // What Verifier 004 measured the row getting wrong: an attempt whose
  // acknowledgement is on the record gates nothing when the conversation is opened,
  // because DSP-6 made one acknowledgement hold for the attempt. The listing has to
  // carry that difference or the row cannot say what will happen.
  const { store } = storeIn('list-acknowledged');
  const attempt = (
    attemptId: string,
    acknowledgedAtUtc: string | null,
  ): StoredAttempt => ({
    attemptId,
    kind: 'agent-turn',
    label: 'a message',
    state: 'outcome-unknown',
    stateReason: 'DSpatch was closed while this was still going.',
    requestedAtUtc: '2026-09-15T08:59:00.000Z',
    endedAtUtc: null,
    providerRunId: 'run-1',
    localPid: null,
    cancelRequestedAtUtc: null,
    acknowledgedAtUtc,
    history: [],
  });

  store.write(
    conversation({
      conversationId: 'dsp-conv-confirmed',
      savedAtUtc: '2026-09-15T09:00:00.000Z',
      attempts: [attempt('dsp-attempt-0001', '2026-09-15T08:59:59.000Z')],
    }),
  );
  store.write(
    conversation({
      conversationId: 'dsp-conv-mixed',
      savedAtUtc: '2026-09-15T08:00:00.000Z',
      attempts: [
        attempt('dsp-attempt-0001', '2026-09-15T07:59:59.000Z'),
        attempt('dsp-attempt-0002', null),
      ],
    }),
  );

  const byId = new Map(store.list().entries.map((entry) => [entry.conversationId, entry]));
  assert.equal(byId.get('dsp-conv-confirmed')?.unresolvedAttemptCount, 1);
  assert.equal(byId.get('dsp-conv-confirmed')?.unacknowledgedAttemptCount, 0);
  assert.equal(byId.get('dsp-conv-mixed')?.unresolvedAttemptCount, 2);
  assert.equal(byId.get('dsp-conv-mixed')?.unacknowledgedAttemptCount, 1);
});

test('a conversation ID cannot reach outside the conversations directory', () => {
  const { store, directory } = storeIn('traversal');
  assert.equal(isUsableConversationId('../../etc/passwd'), false);
  assert.equal(isUsableConversationId('a/b'), false);
  assert.equal(isUsableConversationId('..'), false);
  assert.equal(isUsableConversationId(newConversationId()), true);

  const read = store.read('../../secrets');
  assert.equal(read.conversation, null);
  assert.match(String(read.error), /not a usable conversation ID/);

  const written = store.write(conversation({ conversationId: '../escape' }));
  assert.notEqual(written.error, null);
  assert.equal(fs.existsSync(path.join(directory, '..', 'escape.json')), false);
});

test('nothing that could identify the account or a credential is written', () => {
  const { store, directory } = storeIn('secrets');
  const original = conversation({
    messages: [
      {
        ordinal: 0,
        dspatchRunId: 'run-1',
        prompt: 'hello',
        answer: 'hello back',
        deltaCount: 1,
        toolEvents: 0,
        terminalStatus: 'finished',
        errorMessage: null,
        totalTokens: null,
        startedAtUtc: '2026-09-15T00:01:00.000Z',
        finishedAtUtc: '2026-09-15T00:01:01.000Z',
        // DSP-4 S3 added this field, and it is the one field made of text DSpatch
        // composed rather than text it was given, so it is the one most likely to
        // pick something up that does not belong in a file. It is included here so
        // the whole-field search below covers it.
        resentContext: 'Earlier in this conversation: you asked about the project.',
      },
    ],
  });
  store.write(original);
  const body = fs.readFileSync(
    path.join(directory, `${original.conversationId}.json`),
    'utf8',
  );
  // Whole field names, because the rule is that these have no place to live rather
  // than that a filter removed them. A field added later would fail this. Matched as
  // keys so that `totalTokens` — a count, and legitimately saved — is not mistaken
  // for a credential named `token`.
  for (const forbidden of [
    'apiKey',
    'api_key',
    'token',
    'accessToken',
    'refreshToken',
    'credential',
    'credentials',
    'account',
    'authorization',
    'cookie',
    'password',
    'secret',
    'bearer',
    'backendUrl',
  ]) {
    assert.equal(
      new RegExp(`"${forbidden}"\\s*:`, 'i').test(body),
      false,
      `a saved conversation must not have a "${forbidden}" field`,
    );
  }
  // And nothing address-shaped, which is what the connection card shows and the one
  // piece of personal data this project has already leaked into a log once.
  assert.equal(/[\w.+-]+@[\w-]+\.[\w.]+/.test(body), false);
});

test('a save failure is reported rather than thrown', () => {
  const { store, directory } = storeIn('unwritable');
  // A file where the directory has to go: creating the directory must fail, and the
  // conversation on screen must survive that.
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.writeFileSync(directory, 'not a directory', 'utf8');

  const written = store.write(conversation());
  assert.notEqual(written.error, null);
  assert.match(String(written.error), /could not be saved/);
});
