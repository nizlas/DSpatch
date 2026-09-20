/**
 * The own-repository guard, and the two holes Verifier 010 measured in it.
 *
 * DSpatch refuses to point an agent at its own source. Until containment exists
 * that refusal is the only thing between a writing agent run and the repository
 * DSpatch is being built in, and report 003's finding **F1** was that it had no
 * coverage at all and could be removed in silence. So these tests are written to
 * fail if the guard is removed or weakened, not merely to describe it.
 *
 * The two holes, both measured on 15 September 2026 and both closed here:
 *
 * 1. The check looked at the chosen folder only, so `<repo>\app` was opened.
 * 2. A manifest that could not be parsed was treated as "not DSpatch", so the
 *    guard let the folder through.
 *
 * A third, found by report 002's own measurement once the first two were closed
 * and covered here as DSP-16 AC#5: walking **up** cannot see a folder that
 * *contains* DSpatch, so choosing the parent directory of a clone reached its
 * source. That question has a different source of truth — where the running
 * application resolved its own sources to — and `ownRepositoryInside` answers it.
 *
 * Verifier 007 then defeated that third refusal on 15 September 2026 with three
 * spellings of one directory — a UNC path, an 8.3 short name, and a junction — so
 * it no longer compares paths but asks the filesystem which directories are the
 * same directory. The first two spellings are covered below, opportunistically
 * where the platform can produce them and portably through a link either way. The
 * junction case is a **stated limit** and has a test of its own so that it stays a
 * decision rather than becoming an accident.
 *
 * The third thing every case here has to preserve is the one the fix could
 * plausibly break: an unrelated project must still open. Every refusing test has
 * a paired control that differs in one marker and is allowed.
 *
 * Nothing here opens a session, reaches a provider or writes outside `%TEMP%`,
 * and no test in this file names DSpatch's real directory. The guard is proved at
 * the guard.
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
  describeContainingRefusal,
  describeRefusal,
  describeUndecidableContainment,
  findOwnRepository,
  inspectDirectory,
  ownRepositoryInside,
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

// --- What the user reads ----------------------------------------------------

test('the refusal names the folder, the repository and what was looked at', () => {
  const root = makeDspatchShaped('message-own', OWN_MANIFEST);
  const chosen = path.join(root, 'app', 'src');
  const verdict = findOwnRepository(chosen);
  assert.notEqual(verdict.kind, 'unrelated');
  if (verdict.kind === 'unrelated') {
    return;
  }
  const message = describeRefusal(chosen, verdict);

  // The renderer classifies a refused folder by this prefix (`recovery.ts:106`),
  // so it is load-bearing and not a matter of style.
  assert.ok(message.startsWith('Refusing to open'), message);
  assert.ok(message.includes(chosen), 'the chosen folder is named');
  assert.ok(message.includes(root), 'and so is the repository it resolved to');
  assert.match(message, /inside DSpatch's own working copy at/);
  assert.match(message, /not confined to the folder it is given/);
  assert.match(message, /What was checked:/);
  assert.ok(
    message.includes(path.join('app', 'package.json')),
    'the manifest that decided it is named',
  );
  assert.match(message, /DSPATCH_ALLOW_OWN_REPO=1/);
  assert.match(message, /Nothing was opened and nothing was changed/);
});

test('the refusal for the repository root does not claim the folder is inside itself', () => {
  const root = makeDspatchShaped('message-root', OWN_MANIFEST);
  const verdict = findOwnRepository(root);
  assert.notEqual(verdict.kind, 'unrelated');
  if (verdict.kind === 'unrelated') {
    return;
  }
  const message = describeRefusal(root, verdict);
  assert.match(message, /this is DSpatch's own working copy/);
  assert.doesNotMatch(message, /inside DSpatch's own working copy at/);
});

test('the undecidable refusal says what could not be read and how to disagree', () => {
  // A user who has legitimately opened an unrelated project has to be able to see
  // what was checked and fix it. A refusal that only says "no" would be the
  // failure mode of closing a fail-open hole.
  const root = makeDspatchShaped('message-undecidable', '{ "name": "dspa');
  const verdict = findOwnRepository(root);
  assert.equal(verdict.kind, 'undecidable');
  if (verdict.kind !== 'undecidable') {
    return;
  }
  const message = describeRefusal(root, verdict);

  assert.ok(message.startsWith('Refusing to open'), message);
  assert.match(message, /cannot tell whether/);
  assert.ok(message.includes(verdict.manifestPath), 'the unreadable file is named');
  assert.match(message, /not valid JSON/);
  // Why refusing is the direction, in one sentence, because the user is being
  // stopped by an absence of information rather than by a finding.
  assert.match(message, /worse than\s+no check at all/);
  // Three ways forward, not one.
  assert.match(message, /make that file readable and valid JSON/);
  assert.match(message, /choose a folder that is\s+not inside/);
  assert.match(message, /DSPATCH_ALLOW_OWN_REPO=1/);
  // And it must not assert what it does not know.
  assert.doesNotMatch(message, /this is DSpatch's own working copy/);
});

// --- The third case: a folder that contains DSpatch --------------------------
//
// The direction the walk is blind to. Choosing `C:\Users\nicla\development`
// reaches DSpatch's source through `development\DSpatch`, and walking up from that
// parent goes to `C:\Users\nicla` and never sees it. Report 002 measured the real
// parent directory opening cleanly; DSP-16 AC#5 is that it must not.

test('AC#5: a folder containing DSpatch is recognised as containing it', () => {
  const parent = makeDir('contains-parent');
  const own = path.join(parent, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });

  const contained = ownRepositoryInside(parent, own);
  assert.equal(contained.kind, 'contains', 'the parent directory was not recognised');
  if (contained.kind !== 'contains') {
    return;
  }
  assert.equal(contained.root, own);
  assert.equal(contained.relativePath, 'DSpatch', 'where DSpatch sits is named');
  // The ordinary case costs no filesystem access at all: both paths are written the
  // same way, so the spelling answers it and the identity walk is never reached.
  assert.equal(contained.decidedBy, 'spelling');
});

test('AC#5: every directory above DSpatch is recognised, not only the parent', () => {
  const top = makeDir('contains-deep');
  const own = path.join(top, 'code', 'personal', 'DSpatch');
  fs.mkdirSync(own, { recursive: true });

  for (const rel of ['', 'code', path.join('code', 'personal')]) {
    const chosen = path.join(top, rel);
    const contained = ownRepositoryInside(chosen, own);
    assert.equal(contained.kind, 'contains', `${rel === '' ? '<top>' : rel} was not recognised`);
    if (contained.kind !== 'contains') {
      continue;
    }
    assert.equal(contained.relativePath, path.relative(chosen, own));
  }
});

test('AC#5, negative control: the walk alone never sees this', () => {
  // Why a second test is needed at all rather than a wider walk. The parent
  // directory carries none of DSpatch's markers, so `findOwnRepository` is right
  // to call it unrelated — it is looking in the other direction. This is the
  // measurement report 002 made on the real tree, reproduced under `%TEMP%`.
  const parent = makeDir('contains-control');
  const own = path.join(parent, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });
  write(own, path.join('app', 'package.json'), OWN_MANIFEST);
  write(own, path.join('docs', 'VISION.md'), '# Vision\n');
  write(own, 'AGENTS.md', '# Working on it\n');

  assert.equal(
    findOwnRepository(parent).kind,
    'unrelated',
    'the content walk passes the parent, which is the hole',
  );
  assert.equal(findOwnRepository(own).kind, 'own-repository', 'and refuses the clone itself');
  assert.equal(ownRepositoryInside(parent, own).kind, 'contains', 'so this is what refuses it');
});

test('AC#5: the folder that is DSpatch itself is left to the content walk', () => {
  // Not a gap: `findOwnRepository` refuses the root already, and its message can
  // name the manifest it read, which this one cannot. Only a strict ancestor
  // answers here, so the two never both fire on the same folder.
  const own = makeDspatchShaped('contains-self', OWN_MANIFEST);
  assert.equal(ownRepositoryInside(own, own).kind, 'unrelated');
  assert.equal(findOwnRepository(own).kind, 'own-repository');
});

test('AC#5: a folder inside DSpatch does not answer here either', () => {
  const own = makeDspatchShaped('contains-inside', OWN_MANIFEST);
  assert.equal(ownRepositoryInside(path.join(own, 'app'), own).kind, 'unrelated');
  assert.equal(findOwnRepository(path.join(own, 'app')).kind, 'own-repository');
});

test('AC#5, must not refuse: a sibling, a cousin and an unrelated parent', () => {
  // The controls that matter most, because this change makes the guard refuse
  // more. None of these contains DSpatch, and every one of them is a folder
  // someone would legitimately open.
  const parent = makeDir('contains-siblings');
  const own = path.join(parent, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });
  const sibling = path.join(parent, 'some-other-project');
  fs.mkdirSync(path.join(sibling, 'src'), { recursive: true });
  const elsewhere = makeDir('contains-elsewhere');

  for (const chosen of [
    sibling,
    path.join(sibling, 'src'),
    elsewhere,
    // A name that is a prefix of DSpatch's own directory name, which a string
    // comparison would get wrong: `…\DSpatch-notes` does not contain `…\DSpatch`.
    (() => {
      const decoy = path.join(parent, 'DSpatch-notes');
      fs.mkdirSync(decoy, { recursive: true });
      return decoy;
    })(),
  ]) {
    assert.equal(
      ownRepositoryInside(chosen, own).kind,
      'unrelated',
      `${chosen} was refused and must not be`,
    );
  }
});

test('AC#5: a folder that does not contain DSpatch is not refused as containing it', () => {
  // What this used to assert was that `path.relative` answering with an absolute
  // path — the cross-drive case — is not containment. That inference is what
  // Verifier 007 defeated, because `\\localhost\C$\x` and `C:\x` also share no
  // prefix and are one directory, so an absolute result now falls through to the
  // identity question instead of deciding anything.
  //
  // The property that has to hold is the one a user meets: a folder DSpatch is not
  // under must not be refused as containing it. Two real directories, so the
  // identity question is answered rather than merely started.
  const chosen = makeDir('contains-other-tree');
  const own = makeDspatchShaped('contains-other-tree-own', OWN_MANIFEST);
  assert.equal(ownRepositoryInside(chosen, own).kind, 'unrelated');

  // And a path that cannot be examined does **not** become "not contained": it is
  // undecidable, and `validateProjectFolder` refuses it. In production this cannot
  // be reached from either side — the chosen folder has already been stat'ed and
  // read-checked, and DSpatch's own root is the tree it is running from — so this
  // fixes the fail-closed direction as a decision rather than describing a case
  // users meet.
  // Both sides of that rule, because both are places the answer could go missing:
  // a directory above DSpatch's own root that cannot be examined …
  if (process.platform === 'win32') {
    const verdict = ownRepositoryInside(chosen, 'Z:\\not-mounted\\DSpatch');
    assert.notEqual(verdict.kind, 'contains', 'it must never claim containment it has not established');
    assert.equal(verdict.kind, 'undecidable');
  }
  // … and the chosen folder itself.
  assert.equal(ownRepositoryInside(path.join(chosen, 'was-never-here'), own).kind, 'undecidable');
});

test('AC#5: Windows compares paths without regard to case', () => {
  // The reason the spelling test is `path.relative` rather than a string prefix: a
  // folder chosen through a dialog and a path resolved from the application can
  // differ in case, and on Windows they are the same directory. This is answered
  // by the spelling, so it needs no directory to exist.
  if (process.platform !== 'win32') {
    return;
  }
  const verdict = ownRepositoryInside(
    'c:\\users\\someone\\development',
    'C:\\Users\\Someone\\Development\\DSpatch',
  );
  assert.equal(verdict.kind, 'contains');
  assert.equal(verdict.kind === 'contains' ? verdict.decidedBy : null, 'spelling');
});

test('AC#5: an unknown own-root refuses nothing, and that is the stated limit', () => {
  // A packaged copy moved out of the tree it was built in cannot resolve its own
  // root. The limit is in the module header and in the README; here it is a test,
  // so it is a decision rather than an accident. It is also why the undecidable
  // verdict is not this case: `null` is DSpatch knowing it cannot answer, and
  // refusing every folder on that basis would refuse everything a moved artifact
  // is ever offered.
  const parent = makeDir('contains-unknown-root');
  fs.mkdirSync(path.join(parent, 'DSpatch'), { recursive: true });
  assert.equal(ownRepositoryInside(parent, null).kind, 'unrelated');
  assert.equal(ownRepositoryInside(parent, '   ').kind, 'unrelated');
});

test('AC#5: the refusal names the folder, where DSpatch sits, and what to do', () => {
  const parent = makeDir('contains-message');
  const own = path.join(parent, 'projects', 'DSpatch');
  fs.mkdirSync(own, { recursive: true });
  const contained = ownRepositoryInside(parent, own);
  assert.equal(contained.kind, 'contains');
  if (contained.kind !== 'contains') {
    return;
  }
  const message = describeContainingRefusal(parent, contained);

  // The prefix the renderer classifies a refused folder by (`recovery.ts:106`).
  assert.ok(message.startsWith('Refusing to open'), message);
  assert.ok(message.includes(parent), 'the chosen folder is named');
  assert.ok(message.includes(own), "and DSpatch's own root is named");
  assert.ok(
    message.includes(path.join('projects', 'DSpatch')),
    'and where it sits inside the chosen folder, which is what makes it findable',
  );
  assert.match(message, /own working copy is inside it/);
  assert.match(message, /not confined to the folder it is given/);
  // The way forward, which is the whole difference between a guard and an
  // obstruction for someone whose projects live under one parent directory.
  assert.match(message, /Open the specific project you want to work on instead/);
  // Where the claim comes from, so a user who disagrees knows what to look at.
  assert.match(message, /found that location from where it is running/);
  assert.match(message, /DSPATCH_ALLOW_OWN_REPO=1/);
  assert.match(message, /Nothing was opened and nothing was changed/);
  // It must not claim the chosen folder is DSpatch, because it is not.
  assert.doesNotMatch(message, /this is DSpatch's own working copy/);
});

// --- The spellings that defeated it, and the one that still does -------------
//
// Verifier 007 opened the directory containing DSpatch three ways on 15 September
// 2026: a UNC path, an 8.3 short name and an ordinary project carrying a junction
// into DSpatch. In all three cases DSpatch's own `app/package.json` was reachable
// from inside the folder that opened. The first two are closed here by asking the
// filesystem which directories are the same directory; the third is a stated limit
// and has a test of its own below so that it stays a decision.

/**
 * The same directory, spelled a second way, without needing a share or a short
 * name: a junction on Windows and a directory symlink elsewhere. `statSync` follows
 * it, so the link and its target report one identity — which is the whole mechanism
 * under test — while `path.relative` sees two unrelated paths.
 *
 * Returns `null` when the link cannot be created, which is the honest outcome on a
 * platform or filesystem that will not make one.
 */
function linkTo(target: string, linkPath: string): string | null {
  try {
    fs.symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return linkPath;
  } catch {
    return null;
  }
}

test('AC#5: the same directory under a second spelling is refused', (t) => {
  // The mechanism Verifier 007's UNC and 8.3 cases needed, in a form that needs no
  // elevation and no short names: `alt` and `real` are one directory.
  const outer = makeDir('spelling-link');
  const real = path.join(outer, 'real-parent');
  const own = path.join(real, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });
  const alt = linkTo(real, path.join(outer, 'alias'));
  if (alt === null) {
    // Said out loud: a test that skips in silence is indistinguishable from one
    // that passed, which is the reporting failure this project keeps meeting.
    t.diagnostic('SKIPPED: this platform would not create a directory link');
    return;
  }

  // First, that the spelling test cannot see it — otherwise this would prove
  // nothing about the identity question.
  assert.equal(
    path.relative(alt, own).split(path.sep)[0],
    '..',
    'the two spellings must not overlap, or this measures the wrong thing',
  );

  const verdict = ownRepositoryInside(alt, own);
  assert.equal(verdict.kind, 'contains', 'the second spelling of the parent was not recognised');
  if (verdict.kind !== 'contains') {
    return;
  }
  assert.equal(verdict.decidedBy, 'identity', 'and it was the filesystem that said so');
  assert.equal(verdict.relativePath, 'DSpatch', 'where DSpatch sits is still named');
  assert.equal(verdict.root, own);
  t.diagnostic(`EXERCISED: a directory link as a second spelling — ${alt}`);
});

test('AC#5: a second spelling of an unrelated folder is still not refused', (t) => {
  // The control for the test above. Identity refuses more folders than the spelling
  // did, so the direction that must not change is the one a user meets: a folder
  // DSpatch is not under, reached by an alias, still opens.
  const outer = makeDir('spelling-link-control');
  const own = path.join(outer, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });
  const sibling = path.join(outer, 'some-other-project');
  fs.mkdirSync(path.join(sibling, 'src'), { recursive: true });
  const alt = linkTo(sibling, path.join(outer, 'alias-to-sibling'));
  if (alt === null) {
    t.diagnostic('SKIPPED: this platform would not create a directory link');
    return;
  }
  assert.equal(ownRepositoryInside(alt, own).kind, 'unrelated');
  assert.equal(ownRepositoryInside(path.join(alt, 'src'), own).kind, 'unrelated');
});

test('AC#5: the 8.3 short name of a folder containing DSpatch is refused', (t) => {
  // Verbatim one of Verifier 007's two openings. Node cannot produce a short name,
  // so `cmd` is asked for one — a read-only question about a path, not a command
  // against the product. The test skips where short names are unavailable, which is
  // every non-Windows platform and any volume with 8.3 generation switched off.
  if (process.platform !== 'win32') {
    t.diagnostic('SKIPPED: 8.3 short names are a Windows spelling');
    return;
  }
  const parent = makeDir('spelling-shortname');
  const own = path.join(parent, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });

  let short: string;
  try {
    // `windowsVerbatimArguments` because Node otherwise escapes the quotes for a
    // program that parses its own command line, and `cmd.exe` does not read that
    // escaping: without it the answer comes back as `C:\"C:\…\"` and this test
    // skips while looking as though it ran.
    short = execFileSync('cmd', ['/d', '/c', `for %I in ("${parent}") do @echo %~fsI`], {
      encoding: 'utf8',
      windowsVerbatimArguments: true,
    }).trim();
  } catch (error) {
    t.diagnostic(`SKIPPED: no short name could be obtained: ${String(error)}`);
    return;
  }
  if (short === '' || short.toLowerCase() === parent.toLowerCase() || !fs.existsSync(short)) {
    t.diagnostic(`SKIPPED: this volume has no 8.3 spelling for the folder (got ${short})`);
    return;
  }

  assert.notEqual(
    path.relative(short, own).split(path.sep)[0],
    'DSpatch',
    'the short name must really be a different spelling',
  );
  const verdict = ownRepositoryInside(short, own);
  assert.equal(verdict.kind, 'contains', `the 8.3 spelling ${short} opened`);
  assert.equal(verdict.kind === 'contains' ? verdict.decidedBy : null, 'identity');
  t.diagnostic(`EXERCISED: the 8.3 spelling ${short}`);
});

test('AC#5: the UNC spelling of a folder containing DSpatch is refused', (t) => {
  // Verifier 007's other opening, and the one that needed no trickery: DSpatch's own
  // folder dialog returned `\\localhost\C$\…` verbatim. The administrative share
  // needs an elevated session, so this skips when it is not readable — and note that
  // `fs.realpathSync.native` does not repair this spelling, which is why identity
  // rather than a canonical string is what answers it.
  if (process.platform !== 'win32') {
    t.diagnostic('SKIPPED: a UNC administrative share is a Windows spelling');
    return;
  }
  const parent = makeDir('spelling-unc');
  const own = path.join(parent, 'DSpatch');
  fs.mkdirSync(own, { recursive: true });

  const root = path.parse(parent).root;
  const drive = root.replace(/\\$/, '');
  if (!/^[A-Za-z]:$/.test(drive)) {
    t.diagnostic(`SKIPPED: ${parent} is not on a lettered drive`);
    return;
  }
  const unc = `\\\\localhost\\${drive[0] ?? ''}$\\${parent.slice(root.length)}`;
  if (!fs.existsSync(unc)) {
    t.diagnostic(`SKIPPED: ${unc} is not readable, which needs an elevated session`);
    return;
  }

  assert.ok(
    path.isAbsolute(path.relative(unc, own)),
    'the UNC spelling must share no prefix with the drive spelling',
  );
  const verdict = ownRepositoryInside(unc, own);
  assert.equal(verdict.kind, 'contains', `the UNC spelling ${unc} opened`);
  assert.equal(verdict.kind === 'contains' ? verdict.decidedBy : null, 'identity');
  t.diagnostic(`EXERCISED: the UNC spelling ${unc}`);
});

test('AC#5, the stated limit: a link into DSpatch is not containment', (t) => {
  // Verifier 007's third route, left open deliberately. An ordinary project with a
  // junction pointing at DSpatch is not DSpatch's parent, and finding the link would
  // need a bounded search *downwards* through an arbitrary tree when every question
  // here is answered by looking up. So it is stated — in this module's header and in
  // the README's *reach, stated exactly* paragraph — and fixed here as a test, so
  // that closing it later is a change someone makes on purpose.
  //
  // The reachability is measured rather than assumed: if the manifest were not
  // reachable through the link there would be nothing to state.
  const outer = makeDir('spelling-link-limit');
  const own = makeDspatchShaped('spelling-link-limit-own', OWN_MANIFEST);
  const project = path.join(outer, 'ordinary-project');
  fs.mkdirSync(path.join(project, 'vendor'), { recursive: true });
  const link = linkTo(own, path.join(project, 'vendor', 'dspatch'));
  if (link === null) {
    t.diagnostic('SKIPPED: this platform would not create a directory link');
    return;
  }

  assert.ok(
    fs.existsSync(path.join(project, 'vendor', 'dspatch', 'app', 'package.json')),
    "DSpatch's manifest is reachable from inside the project, which is what makes this a limit",
  );
  assert.equal(
    ownRepositoryInside(project, own).kind,
    'unrelated',
    'the limit as measured: this is not recognised as containing DSpatch',
  );
  // And the walk up is not what covers it either, so nothing else quietly does.
  assert.equal(findOwnRepository(project).kind, 'unrelated');
  // What *is* covered: choosing the link itself, or a folder under it, because then
  // the walk up reads DSpatch's own markers through it.
  assert.equal(findOwnRepository(link).kind, 'own-repository');
  assert.equal(findOwnRepository(path.join(link, 'app')).kind, 'own-repository');
});

test('AC#5: the undecidable refusal says which directory it could not identify', () => {
  // The prefix `renderer/recovery.ts:106` classifies a refused folder by, on the
  // third outcome, plus the way out. A refusal nobody can act on is the failure
  // mode to avoid while closing a fail-open one.
  const message = describeUndecidableContainment('C:\\somewhere\\chosen', {
    kind: 'undecidable',
    unresolved: 'C:\\somewhere\\else',
    reason: 'it could not be examined: Error: EPERM',
  });

  assert.ok(message.startsWith('Refusing to open'), message);
  assert.ok(message.includes('C:\\somewhere\\chosen'), 'the chosen folder is named');
  assert.ok(message.includes('C:\\somewhere\\else'), 'and the directory that could not be identified');
  assert.match(message, /cannot tell whether its own working copy/);
  assert.match(message, /EPERM/, 'the reason is quoted rather than paraphrased');
  assert.match(message, /worse than no check at\s+all/);
  assert.match(message, /choose it again\s+by its ordinary path/);
  assert.match(message, /DSPATCH_ALLOW_OWN_REPO=1/);
  assert.match(message, /Nothing was opened and nothing was changed/);
  // It must not assert containment it has not established: the refusal that *has*
  // established it says "own working copy is inside it, at <root>", and this one
  // only ever says it cannot tell.
  assert.doesNotMatch(message, /working copy is inside it, at/);
  assert.doesNotMatch(message, /this is DSpatch's own working copy/);
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
