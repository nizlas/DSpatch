/**
 * Recognising DSpatch's own working copy.
 *
 * DSpatch reads its loop definitions and example review from here. It opens this
 * repository like any other project (Niclas, 31 October 2026), so nothing here refuses:
 * these tests pin what the recognition concludes, from any folder inside the repository
 * and with a manifest that cannot be read, and that an unrelated project is not taken
 * for DSpatch.
 *
 * Nothing here opens a session, reaches a provider or writes outside `%TEMP%`.
 *
 *     node --test tests/own-repository.test.ts        (from app/)
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import {
  findOwnRepository,
  inspectDirectory,
  ownRepositoryRoot,
} from '../src/main/own-repository.ts';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dspatch-own-repo-'));

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

let counter = 0;

function makeDir(name: string): string {
  counter += 1;
  const dir = path.join(scratch, `${String(counter)}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(root: string, relPath: string, contents: string): string {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents, 'utf8');
  return full;
}

/**
 * A tree shaped like DSpatch's own.
 *
 * `manifest` is the only thing most cases below vary: it is the text of
 * `app/package.json`, or `null` for a tree that has none. Everything else — the
 * vision document, the agent instructions, the backlog — is what DSpatch's own
 * repository carries, and is what corroborates a manifest that cannot be read.
 */
function makeDspatchShaped(
  name: string,
  manifest: string | null,
  options: { readonly corroborating?: boolean } = {},
): string {
  const root = makeDir(name);
  if (manifest !== null) {
    write(root, path.join('app', 'package.json'), manifest);
  }
  write(root, path.join('docs', 'VISION.md'), '# Vision\n');
  if (options.corroborating !== false) {
    write(root, 'AGENTS.md', '# Working on it\n');
    write(root, 'BACKLOG.md', '# Backlog\n');
    write(root, path.join('docs', 'DEVELOPMENT_LOOP.md'), '# Loop\n');
    write(root, path.join('backlog', 'tasks', 'dsp-1 - something.md'), '---\n');
  }
  // The sources an agent would be pointed at, so the folders below are real.
  write(root, path.join('app', 'src', 'main', 'main.ts'), '// not the real one\n');
  write(root, path.join('app', 'tests', 'a.test.ts'), '// not the real one\n');
  return root;
}

const OWN_MANIFEST = `${JSON.stringify({ name: 'dspatch', version: '0.1.0' }, null, 2)}\n`;

// --- Hole 1: a folder inside the repository ---------------------------------

test('hole 1: a subfolder of DSpatch resolves to the repository above it', () => {
  const root = makeDspatchShaped('subfolder', OWN_MANIFEST);

  // `<repo>\app` is the one Verifier 010 measured being opened: the old check
  // looked for `<repo>\app\app\package.json`, which does not exist.
  for (const rel of [
    'app',
    path.join('app', 'src'),
    path.join('app', 'src', 'main'),
    path.join('app', 'tests'),
    'docs',
    path.join('backlog', 'tasks'),
  ]) {
    const chosen = path.join(root, rel);
    const verdict = findOwnRepository(chosen);
    assert.equal(verdict.kind, 'own-repository', `${rel} was not recognised`);
    assert.equal(
      verdict.kind === 'own-repository' ? verdict.root : null,
      root,
      `${rel} resolved to the wrong repository`,
    );
  }
});

test('hole 1, negative control: the old rule accepted exactly those folders', () => {
  // The rule as it was, reconstructed here rather than described: the content
  // test applied to the chosen folder and nothing above it. Without this the
  // test above would only show that some refusal exists, not that walking up is
  // what closes the hole.
  const root = makeDspatchShaped('subfolder-control', OWN_MANIFEST);
  const oldRule = (dir: string): boolean => {
    try {
      const manifest = path.join(dir, 'app', 'package.json');
      if (!fs.existsSync(manifest) || !fs.existsSync(path.join(dir, 'docs', 'VISION.md'))) {
        return false;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as Record<string, unknown>)['name'] === 'dspatch'
      );
    } catch {
      return false;
    }
  };

  assert.equal(oldRule(root), true, 'the old rule did recognise the root');
  assert.equal(
    oldRule(path.join(root, 'app')),
    false,
    'and it did not recognise `<repo>\\app`, which is the hole',
  );
  assert.equal(findOwnRepository(path.join(root, 'app')).kind, 'own-repository');
});

test('the repository root itself is still recognised', () => {
  // The behaviour that already worked must not be lost to the walk.
  const root = makeDspatchShaped('root-itself', OWN_MANIFEST);
  const verdict = findOwnRepository(root);
  assert.equal(verdict.kind, 'own-repository');
  assert.equal(verdict.kind === 'own-repository' ? verdict.root : null, root);
});

test('a DSpatch copy is recognised wherever it is, and so is a folder in it', () => {
  // A second clone or an unpacked artifact: no path boundary can see these, which
  // is why the check is by content.
  const root = makeDspatchShaped('elsewhere', OWN_MANIFEST);
  assert.equal(findOwnRepository(root).kind, 'own-repository');
  assert.equal(
    findOwnRepository(path.join(root, 'app', 'src', 'main')).kind,
    'own-repository',
  );
});

test('a repository nested inside DSpatch does not hide the tree above it', () => {
  // The claim the module header makes about why the walk goes to the filesystem
  // root: stopping at the first `.git` "would reintroduce hole 1 for a nested
  // repository". Verifier 004 mutated the walk to stop there and **all 106 tests
  // still passed**, so nothing held it; its probe measured that the behaviour was
  // right and only the test was missing. This is that probe as a test.
  //
  // Both shapes of a nested repository, because a mutation that stopped at either
  // would slip through a test that only knew the other: `.git` as a directory is an
  // ordinary clone, and `.git` as a file containing `gitdir:` is what a submodule
  // and a linked worktree leave behind.
  const root = makeDspatchShaped('nested-git', OWN_MANIFEST);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });

  const clone = path.join(root, 'scratch', 'trial-repo');
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  write(clone, path.join('src', 'main.c'), 'int main(void){return 0;}\n');

  const submodule = path.join(root, 'vendor', 'thing');
  fs.mkdirSync(submodule, { recursive: true });
  write(submodule, '.git', 'gitdir: ../../.git/modules/thing\n');
  write(submodule, path.join('src', 'lib.ts'), 'export {};\n');

  for (const chosen of [
    clone,
    path.join(clone, 'src'),
    submodule,
    path.join(submodule, 'src'),
  ]) {
    const verdict = findOwnRepository(chosen);
    assert.equal(
      verdict.kind,
      'own-repository',
      `${path.relative(root, chosen)} hid the DSpatch tree above it`,
    );
    assert.equal(
      verdict.kind === 'own-repository' ? verdict.root : null,
      root,
      `${path.relative(root, chosen)} resolved to the wrong repository`,
    );
  }

  // The control for the same walk in the direction it must not refuse: the identical
  // nested repository, in a tree that is nobody's DSpatch, stays unrelated.
  const stranger = makeDir('nested-git-control');
  const strangerClone = path.join(stranger, 'scratch', 'trial-repo');
  fs.mkdirSync(path.join(strangerClone, '.git'), { recursive: true });
  assert.equal(findOwnRepository(strangerClone).kind, 'unrelated');
});

// --- Hole 2: a manifest that cannot be read or parsed ------------------------

test('hole 2: an unparsable manifest refuses instead of allowing', () => {
  // Truncated mid-object, which is what a half-written or overwritten file looks
  // like. An agent overwrote `app/package.json` earlier in this project's own
  // development, so this is not hypothetical.
  const root = makeDspatchShaped('unparsable', '{ "name": "dspa');
  const verdict = findOwnRepository(root);
  assert.equal(verdict.kind, 'undecidable');
  if (verdict.kind === 'undecidable') {
    assert.equal(verdict.root, root);
    assert.match(verdict.reason, /not valid JSON/);
  }
});

test('hole 2: an unparsable manifest refuses from a subfolder too', () => {
  // Both holes at once, which is the case nothing covered.
  const root = makeDspatchShaped('unparsable-subfolder', 'not json at all');
  assert.equal(findOwnRepository(path.join(root, 'app', 'src')).kind, 'undecidable');
});

test('hole 2: a manifest that cannot be read refuses', () => {
  const root = makeDspatchShaped('unreadable', OWN_MANIFEST);
  // A directory where the file should be: `readFileSync` fails with EISDIR, and
  // this is portable, unlike revoking read permission on Windows.
  fs.rmSync(path.join(root, 'app', 'package.json'));
  fs.mkdirSync(path.join(root, 'app', 'package.json'));

  const verdict = findOwnRepository(root);
  assert.equal(verdict.kind, 'undecidable');
  if (verdict.kind === 'undecidable') {
    assert.match(verdict.reason, /could not be read/);
  }
});

test('hole 2: a manifest with no name field cannot clear the folder either', () => {
  const root = makeDspatchShaped('nameless', `${JSON.stringify({ version: '1.0.0' })}\n`);
  const verdict = findOwnRepository(root);
  assert.equal(verdict.kind, 'undecidable');
  if (verdict.kind === 'undecidable') {
    assert.match(verdict.reason, /name field is missing or empty/);
  }
});

test('hole 2, negative control: the old rule allowed every one of those', () => {
  // The `catch { return false }` the old rule ended with, applied to the same
  // three manifests. Each one was a folder the guard opened.
  const oldRule = (dir: string): boolean => {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(dir, 'app', 'package.json'), 'utf8'),
      );
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as Record<string, unknown>)['name'] === 'dspatch'
      );
    } catch {
      return false;
    }
  };

  for (const [name, manifest] of [
    ['control-truncated', '{ "name": "dspa'],
    ['control-garbage', 'not json at all'],
    ['control-nameless', '{ "version": "1.0.0" }'],
  ] as const) {
    const root = makeDspatchShaped(name, manifest);
    assert.equal(oldRule(root), false, `${name}: the old rule allowed this`);
    assert.notEqual(
      findOwnRepository(root).kind,
      'unrelated',
      `${name}: the new guard must not allow it`,
    );
  }
});

test('a UTF-8 BOM is not a reason to refuse, and not a reason to allow either', () => {
  // The BOM is how Verifier 010 discovered hole 2: PowerShell's `Set-Content
  // -Encoding utf8` wrote one, `JSON.parse` threw, and the guard passed the
  // folder. `JSON.parse` is the only thing that objects to a BOM, so stripping it
  // is the accurate reading of the file rather than leniency — and the answer it
  // then gives is the truthful one in both directions.
  const own = makeDspatchShaped('bom-own', `\uFEFF${OWN_MANIFEST}`);
  assert.equal(findOwnRepository(own).kind, 'own-repository');

  const other = makeDspatchShaped(
    'bom-other',
    `\uFEFF${JSON.stringify({ name: 'someone-elses-app' })}\n`,
  );
  assert.equal(findOwnRepository(other).kind, 'unrelated');
});

// --- The failure mode the fix could introduce -------------------------------

test('a legitimate unrelated project is not refused', () => {
  // The control that matters most. A project of the same shape — `app/`, `docs/`,
  // a `docs/VISION.md` of its own, agent instructions, a backlog — and a manifest
  // that names something else. Nothing about it may be refused, at the root or
  // anywhere inside it.
  const root = makeDspatchShaped(
    'legitimate',
    `${JSON.stringify({ name: 'someone-elses-app', version: '2.0.0' }, null, 2)}\n`,
  );
  for (const rel of ['', 'app', path.join('app', 'src'), 'docs', 'backlog']) {
    assert.equal(
      findOwnRepository(path.join(root, rel)).kind,
      'unrelated',
      `${rel === '' ? '<root>' : rel} was refused and must not be`,
    );
  }
});

test('an ordinary project far from anything DSpatch-shaped is not refused', () => {
  const plain = makeDir('plain-project');
  write(plain, 'package.json', `${JSON.stringify({ name: 'a-tool' })}\n`);
  write(plain, path.join('src', 'index.ts'), 'export {};\n');
  write(plain, 'README.md', '# A tool\n');
  assert.equal(findOwnRepository(plain).kind, 'unrelated');
  assert.equal(findOwnRepository(path.join(plain, 'src')).kind, 'unrelated');
});

test('a half-written manifest in a project that is not DSpatch-shaped is allowed', () => {
  // The deliberate limit on failing closed. Refusing on an unreadable manifest
  // alone would refuse anyone whose `app/package.json` is mid-keystroke, so the
  // undecidable verdict also needs one of DSpatch's other distinctive files.
  // Here there is none: `docs/VISION.md` and a broken manifest, nothing else.
  const root = makeDspatchShaped('half-written-stranger', '{ "name": ', {
    corroborating: false,
  });
  assert.equal(findOwnRepository(root).kind, 'unrelated');

  // And the same tree with DSpatch's other files present is refused, which is
  // what makes the corroboration the deciding factor rather than a formality.
  const shaped = makeDspatchShaped('half-written-dspatch', '{ "name": ');
  assert.equal(findOwnRepository(shaped).kind, 'undecidable');
});

test('a tree with no manifest at all is not refused, and that is a known limit', () => {
  // Stated as a test so the limit is visible rather than discovered: the guard
  // reads `app/package.json`, so a tree without one is not recognised. The code
  // it replaces had the same limit.
  const root = makeDspatchShaped('no-manifest', null);
  assert.equal(findOwnRepository(root).kind, 'unrelated');
});

test('the walk stops at the filesystem root rather than looping', () => {
  // `path.dirname` is its own fixed point at a drive root and at a UNC share
  // root. If that were not the termination condition this would not return.
  assert.equal(findOwnRepository(path.parse(scratch).root).kind, 'unrelated');
  assert.equal(inspectDirectory(path.parse(scratch).root).kind, 'unrelated');
});

// --- Where DSpatch thinks its own sources are -------------------------------

test('the running app resolves its own repository from the app path', () => {
  // `app.getAppPath()` is `<repo>/app` from source and a path inside `app.asar`
  // when packaged. Both are below the repository while the artifact is still in
  // the tree it was built in, which is what makes `DSPATCH_PROBE_REPO_ROOT`
  // unnecessary. Both are simulated here; neither uses the real directory.
  const root = makeDspatchShaped('own-root', OWN_MANIFEST);
  assert.equal(ownRepositoryRoot(path.join(root, 'app')), root, 'from source');
  assert.equal(
    ownRepositoryRoot(
      path.join(root, 'app', 'release', 'win-unpacked', 'resources', 'app.asar'),
    ),
    root,
    'from a packaged artifact inside the tree',
  );
  // A copy moved out of the tree cannot be resolved, and says so rather than
  // guessing. The guard on the chosen folder does not depend on this.
  const moved = makeDir('moved-artifact');
  assert.equal(
    ownRepositoryRoot(path.join(moved, 'win-unpacked', 'resources', 'app.asar')),
    null,
  );
});
