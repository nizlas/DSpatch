/**
 * Controls for regenerating the test repository.
 *
 * Niclas hit this in the packaged app on 14 September 2026:
 *
 *     Could not start a session: EPERM, Permission denied:
 *     \\?\...\Temp\dspatch-chat\duration-repo
 *
 * The first guess was read-only git objects. A probe disproved it: on Node
 * 24.21.0 `fs.rm` with `force` deletes read-only files, and it deletes a tree
 * someone holds an open handle in. What it cannot delete is a directory that is
 * a live process's *working directory* — and that reproduces the message above
 * exactly, path prefix and all. DSpatch runs the working copy's test with `cwd`
 * set there, so a runner outliving its turn blocks every later session.
 *
 * So the control below holds the directory the way the bug holds it. The
 * assertion is not that the delete succeeds — it cannot, and no amount of
 * retrying changes that. It is that the failure explains itself, because a bare
 * `EPERM` sent the first diagnosis to the wrong place.
 *
 *     node --test tests/experiment-repo.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { generateExperimentRepo } from '../src/main/experiment-repo.ts';
import { holdDirectory, tempRoot } from './support/fixtures.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function scratch(name: string): string {
  return path.join(tempRoot(`test-${name}`), 'duration-repo');
}

test('names the real cause when a live process holds the working directory', async () => {
  const target = scratch('cwdlock');
  generateExperimentRepo(target, repoRoot);

  // A process sitting in the directory, which is what an orphaned test runner is.
  // Registered rather than merely spawned: a failed assertion below used to leave
  // it alive, which kept this whole process alive and made the removal in cleanup
  // race the kill for an `EPERM`.
  const release = await holdDirectory(target);
  try {
    let message = '';
    assert.throws(
      () => generateExperimentRepo(target, repoRoot),
      (err: Error) => {
        message = err.message;
        return true;
      },
    );

    // The negative control: the old code threw exactly this and nothing else,
    // which is why the first diagnosis went looking at file permissions.
    assert.ok(
      !/^EPERM, Permission denied/.test(message),
      `the bare provider error reached the caller unexplained: ${message}`,
    );
    assert.match(message, /working directory/, 'the message must point at the real cause');
    assert.match(message, /EPERM|EACCES|EBUSY|ENOTEMPTY/, 'and still carry the code');
    assert.ok(message.includes(target), 'and name the directory to clear');
  } finally {
    // Waits for the exit, not for the kill to be requested. The next line depends
    // on the directory really being free.
    await release();
  }

  // Once the holder is gone the same call must succeed, or the advice is wrong.
  const after = generateExperimentRepo(target, repoRoot);
  assert.ok(after.files.length > 0);
  assert.ok(fs.existsSync(path.join(target, 'src', 'duration.ts')));
});

test('regenerates over a committed repository, read-only git objects and all', () => {
  const target = scratch('regen');

  const first = generateExperimentRepo(target, repoRoot);
  assert.equal(first.gitError, null, 'the first generation should commit cleanly');
  assert.ok(first.gitCommit, 'a commit is what leaves read-only objects behind');

  const second = generateExperimentRepo(target, repoRoot);
  assert.ok(second.files.length > 0);
  assert.ok(fs.existsSync(path.join(target, 'test', 'duration.test.ts')));
});

test('still refuses a non-empty directory it did not generate', () => {
  const target = scratch('foreign');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'someones-work.txt'), 'do not delete me\n', 'utf8');

  // Retrying harder must not have widened into deleting things it should not.
  assert.throws(() => generateExperimentRepo(target, repoRoot), /Refusing to delete/);
  assert.ok(fs.existsSync(path.join(target, 'someones-work.txt')));
});
