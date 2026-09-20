/**
 * The unified diff, and the things it must refuse to do quietly.
 *
 * AC#7 has two halves and the second is the one that can fail invisibly. Getting
 * a diff of two text files right is easy to see; **not** dropping the files that
 * cannot be diffed is not. A review surface that lists nine changes and silently
 * omits the tenth reads as complete, so the tests below spend most of their
 * effort on the omission path: every input must come back either with diff text
 * or with a reason, and the reason must name the specific problem.
 *
 *     node --test tests/text-diff.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildUnifiedDiff,
  readAsText,
  type DiffSide,
} from '../src/main/text-diff.ts';

const BASE_LABEL = 'snap-1111111111111111 (session baseline)';
const NOW_LABEL = 'snap-2222222222222222 (on disk)';

function bytes(text: string): DiffSide {
  return { kind: 'bytes', bytes: Buffer.from(text, 'utf8') };
}

function diffOf(before: DiffSide, after: DiffSide, relPath = 'src/duration.ts') {
  return buildUnifiedDiff({
    relPath,
    before,
    after,
    beforeLabel: BASE_LABEL,
    afterLabel: NOW_LABEL,
  });
}

// --- Ordinary text ----------------------------------------------------------

test('a changed file produces a conventional unified diff naming both snapshots', () => {
  const result = diffOf(bytes('one\ntwo\nthree\n'), bytes('one\nTWO\nthree\n'));
  const lines = (result.unifiedDiff ?? '').split('\n');

  assert.equal(result.limitation, null);
  assert.equal(lines[0], `--- a/src/duration.ts\t${BASE_LABEL}`);
  assert.equal(lines[1], `+++ b/src/duration.ts\t${NOW_LABEL}`);
  assert.equal(lines[2], '@@ -1,3 +1,3 @@');
  assert.ok(lines.includes('-two'), 'the removed line is shown');
  assert.ok(lines.includes('+TWO'), 'the added line is shown');
  assert.equal(result.addedLines, 1);
  assert.equal(result.removedLines, 1);
  assert.equal(result.truncated, false);

  // The snapshot identities are in the patch itself, not only beside it. A diff
  // copied out of the window still says which two states it is between.
  assert.ok((result.unifiedDiff ?? '').includes('snap-1111111111111111'));
  assert.ok((result.unifiedDiff ?? '').includes('snap-2222222222222222'));
});

test('an added text file is included in full, not merely listed', () => {
  const result = diffOf({ kind: 'absent' }, bytes('alpha\nbeta\n'), 'notes/new.md');
  const lines = (result.unifiedDiff ?? '').split('\n');
  assert.equal(lines[0], `--- /dev/null\t${BASE_LABEL}`);
  assert.equal(lines[1], `+++ b/notes/new.md\t${NOW_LABEL}`);
  assert.ok(lines.includes('+alpha'));
  assert.ok(lines.includes('+beta'));
  assert.equal(result.addedLines, 2);
  assert.equal(result.removedLines, 0);
});

test('a deleted text file is included in full, not merely listed', () => {
  const result = diffOf(bytes('alpha\nbeta\n'), { kind: 'absent' }, 'notes/gone.md');
  const lines = (result.unifiedDiff ?? '').split('\n');
  assert.equal(lines[0], `--- a/notes/gone.md\t${BASE_LABEL}`);
  assert.equal(lines[1], `+++ /dev/null\t${NOW_LABEL}`);
  assert.ok(lines.includes('-alpha'));
  assert.ok(lines.includes('-beta'));
  assert.equal(result.removedLines, 2);
  assert.equal(result.addedLines, 0);
});

test('CRLF files diff line by line rather than whole-file', () => {
  const result = diffOf(
    bytes('one\r\ntwo\r\nthree\r\n'),
    bytes('one\r\nTWO\r\nthree\r\n'),
  );
  // Three lines, one changed. A diff that reported 3 added and 3 removed would
  // mean the line endings were being normalised somewhere, and the reader could
  // not see what actually changed.
  assert.equal(result.addedLines, 1);
  assert.equal(result.removedLines, 1);
});

test('a missing final newline is marked the way git marks it', () => {
  const result = diffOf(bytes('a\nb'), bytes('a\nc'));
  assert.ok((result.unifiedDiff ?? '').includes('\\ No newline at end of file'));
});

test('a byte-order mark is content, not decoration', () => {
  // TextDecoder strips a BOM by default. If it did so here, a file that gained
  // or lost its BOM would produce an empty diff while the hashes beside it said
  // the file had changed — the diff would be contradicting its own evidence.
  const result = diffOf(bytes('alpha\n'), {
    kind: 'bytes',
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('alpha\n')]),
  });
  assert.equal(result.limitation, null);
  assert.equal(result.addedLines, 1);
  assert.equal(result.removedLines, 1);
});

// --- What cannot be shown as text -------------------------------------------

test('a binary file is listed with the reason, never silently skipped', () => {
  const binary: DiffSide = {
    kind: 'bytes',
    bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]),
  };
  const result = diffOf(bytes('text\n'), binary);
  assert.equal(result.unifiedDiff, null);
  assert.match(String(result.limitation), /binary/);
  assert.match(String(result.limitation), /NUL byte at offset 4/);
  // Unknown, not zero. A "+0 −0" beside a changed file would be a false claim.
  assert.equal(result.addedLines, null);
  assert.equal(result.removedLines, null);
});

test('a file that is not valid UTF-8 says so instead of being guessed at', () => {
  const latin1: DiffSide = { kind: 'bytes', bytes: Buffer.from([0x61, 0xe5, 0x0a]) };
  const result = diffOf(bytes('a\n'), latin1);
  assert.equal(result.unifiedDiff, null);
  assert.match(String(result.limitation), /not valid UTF-8/);
});

test('a file above the size limit says how big it is and what the limit was', () => {
  const big: DiffSide = { kind: 'bytes', bytes: Buffer.alloc(2_000_000, 0x61) };
  const result = diffOf(bytes('a\n'), big);
  assert.equal(result.unifiedDiff, null);
  assert.match(String(result.limitation), /2000000 bytes/);
  assert.match(String(result.limitation), /1024 kB per-file limit/);
});

test('a baseline that did not keep the bytes reports that, not "no change"', () => {
  const result = diffOf(
    { kind: 'unavailable', reason: "its content at the baseline was not kept: this session's 64 MB budget was already used" },
    bytes('new content\n'),
  );
  assert.equal(result.unifiedDiff, null);
  assert.match(String(result.limitation), /at the session baseline/);
  assert.match(String(result.limitation), /64 MB budget/);
});

test('both sides unreadable produces one message that names both', () => {
  const result = diffOf(
    { kind: 'unavailable', reason: 'gone from the baseline' },
    { kind: 'unavailable', reason: 'locked by another process' },
  );
  assert.equal(result.unifiedDiff, null);
  assert.match(String(result.limitation), /gone from the baseline/);
  assert.match(String(result.limitation), /locked by another process/);
});

test('nothing is ever returned with neither a diff nor a reason', () => {
  // The negative control for the failure this module exists to prevent. A
  // reviewer reading the window has no way to tell a file with no differences
  // from a file that was dropped, so "no text and no reason" must be
  // unreachable. Each input below is one of the awkward cases.
  const sides: DiffSide[] = [
    { kind: 'absent' },
    bytes('plain text\n'),
    { kind: 'bytes', bytes: Buffer.from([0x00, 0x01, 0x02]) },
    { kind: 'bytes', bytes: Buffer.from([0xff, 0xfe, 0x41]) },
    { kind: 'bytes', bytes: Buffer.alloc(1_500_000, 0x62) },
    { kind: 'unavailable', reason: 'not kept' },
  ];

  let produced = 0;
  for (const before of sides) {
    for (const after of sides) {
      const result = diffOf(before, after, 'f.txt');
      produced += 1;
      assert.ok(
        result.unifiedDiff !== null || (result.limitation ?? '') !== '',
        `a combination returned neither diff text nor a reason`,
      );
      if (result.unifiedDiff === null) {
        assert.ok(
          String(result.limitation).length > 20,
          'the reason must be specific enough to act on',
        );
      }
    }
  }
  assert.equal(produced, sides.length * sides.length, 'every combination was answered');
});

// --- Truncation --------------------------------------------------------------

test('an enormous diff is cut off and says so, with counts for the whole thing', () => {
  const before = Array.from({ length: 400 }, (_, i) => `line ${String(i)}`).join('\n');
  const after = Array.from({ length: 400 }, (_, i) => `LINE ${String(i)}`).join('\n');
  const result = buildUnifiedDiff({
    relPath: 'big.txt',
    before: { kind: 'bytes', bytes: Buffer.from(before) },
    after: { kind: 'bytes', bytes: Buffer.from(after) },
    beforeLabel: BASE_LABEL,
    afterLabel: NOW_LABEL,
    limits: { maxFileBytes: 1024 * 1024, maxPatchLines: 50 },
  });
  assert.equal(result.truncated, true);
  assert.equal((result.unifiedDiff ?? '').trimEnd().split('\n').length, 50);
  assert.match(String(result.limitation), /cut off after 50/);
  // The counts describe the change, not the excerpt. Otherwise a truncated diff
  // would understate how much changed.
  assert.equal(result.addedLines, 400);
  assert.equal(result.removedLines, 400);
});

// --- The text check on its own ------------------------------------------------

test('readAsText answers with the text or with the specific reason', () => {
  assert.deepEqual(readAsText(Buffer.from('hello\n')), {
    kind: 'text',
    text: 'hello\n',
  });
  const nul = readAsText(Buffer.from([0x68, 0x00]));
  assert.equal(nul.kind, 'not-text');
});
