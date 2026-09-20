/**
 * Recognising DSpatch's own working copy, from any folder inside it.
 *
 * DSpatch refuses to point an agent at its own source, because DSP-1 established
 * by measurement that the agent is **not** confined to the folder it is given: it
 * read and wrote outside the working copy and ran a shell command that did the
 * same. So a writing run in DSpatch's own tree can edit DSpatch while it is
 * running. The refusal is not containment and does not pretend to be; it stops
 * the ordinary mistake of pointing the tool at itself.
 *
 * The refusal used to live in one function in `chat-service.ts`, and Verifier 010
 * measured two holes in it on 15 September 2026:
 *
 * 1. It looked for `<chosen>/app/package.json`, so choosing `<repo>\app` looked
 *    for `<repo>\app\app\package.json`, found nothing, and opened DSpatch's own
 *    source. Measured on a mimic in `%TEMP%`; the packaged application opened it.
 * 2. `JSON.parse` failures were caught and treated as "not DSpatch". A manifest
 *    with a UTF-8 BOM was enough, and that is not hypothetical — an agent
 *    overwrote `app/package.json` earlier in this project's own development. A
 *    check that fails open is worse than no check, because it is trusted.
 *
 * Both are closed here. `findOwnRepository` walks **up** from the chosen folder,
 * so any folder inside the repository resolves to the repository; and a manifest
 * that cannot be read or parsed produces `undecidable`, which the caller refuses.
 *
 * ## The third case, which looks the other way
 *
 * Walking up can never see a folder that *contains* DSpatch: from
 * `C:\Users\nicla\development` the walk goes to `C:\Users\nicla`, never down into
 * `development\DSpatch`. So choosing a parent directory was still allowed, and an
 * agent given it could reach DSpatch's source from inside it — the same fail-open
 * as hole 1, in the opposite direction. `ownRepositoryInside` closes it by asking
 * whether the chosen folder is above DSpatch's own root, which is a different
 * question with a different source of truth: not the content of the chosen folder,
 * but where the running application resolved its own sources to be. Someone whose
 * projects all live under one parent directory will meet this refusal, so it names
 * where DSpatch sits inside the folder they chose and points at the specific
 * project instead of merely saying no.
 *
 * ## Why that question is answered by identity rather than by spelling
 *
 * Verifier 007 defeated it on 15 September 2026 with three spellings of one
 * directory. `ownRepositoryInside` compared the two paths with `path.relative` and
 * read an absolute result or a `..` prefix as "not containment" — right for a
 * different drive, wrong for the same directory reached another way. The directory
 * containing DSpatch opened when it was written `\\localhost\C$\…` and again when
 * it was written with its 8.3 short name, and DSpatch's own `app/package.json` was
 * reachable from inside the folder that opened in both cases. That needed no
 * trickery: the native folder dialog returns a UNC path verbatim, and a network
 * share is an ordinary way to open a project.
 *
 * So the spelling no longer decides it. Two paths name the same directory when the
 * filesystem says they do, and `fs.statSync`'s `dev` and `ino` are how it says so.
 * Measured on those three spellings, all three report one identity. A canonical
 * string could not have done this: `fs.realpathSync.native` resolves the 8.3 name
 * to its long form but returns `\\localhost\C$\…` exactly as it was given. So the
 * walk up from DSpatch's own root compares identities, and a spelling nobody has
 * thought of costs nothing.
 *
 * ## The limit that remains: links are not followed
 *
 * An ordinary project that reaches DSpatch through a junction or a symlink inside
 * it is **not** recognised as containing DSpatch. It is not DSpatch's parent, and
 * finding the link would need a bounded search *downwards* through an arbitrary
 * tree when every question here is answered by looking up. That is a separate
 * piece of work with a cost to measure, so until it exists this is a stated limit
 * rather than a hidden one: it is in the README's *reach, stated exactly*
 * paragraph, and there is a test below that fixes it as a decision.
 *
 * ## Why nothing here reads a configured path
 *
 * Both questions are answered from content: the chosen folder's own markers, and
 * the location the running application resolved its sources to. A third refusal
 * used to sit beside them in `chat-service.ts`, testing the chosen folder against
 * `options.repoRoot` — a value `DSPATCH_PROBE_REPO_ROOT` can name. Verifier 004
 * measured the consequence on 15 September 2026: with the variable pointed at an
 * ordinary directory, an unrelated project inside it was refused, in a message
 * asserting that it was inside DSpatch's own working copy. It was not, it carried
 * no marker of any kind, and it opened without the variable. A refusal a user
 * cannot act on is worse than a missing one, and an environment variable deciding
 * what DSpatch declines to open is the opposite of what DSP-16 asked for. So that
 * test is gone, together with the message it produced, and no path this process was
 * *told* takes part in either question below.
 *
 * ## Why the walk goes all the way to the filesystem root
 *
 * Stopping at the first `.git` would be the narrower reading of "the repository
 * containing this folder", but it would reintroduce hole 1 for a nested
 * repository — a submodule or a scratch repository inside DSpatch's tree would
 * hide everything above it. Walking to the root costs a handful of `existsSync`
 * calls per level and can only refuse when an ancestor really does carry
 * DSpatch's markers.
 *
 * ## Why an unreadable manifest needs corroboration before it refuses
 *
 * Failing closed on the manifest alone would refuse any project that has
 * `app/package.json` and `docs/VISION.md` while that manifest is half-edited —
 * someone else's monorepo, mid-keystroke. That is the failure mode to avoid while
 * closing a fail-open hole, so the undecidable verdict also requires at least one
 * of DSpatch's other distinctive files to be present. DSpatch's own tree carries
 * all of them, so the hole is closed for the case that matters; a stranger's
 * project with a broken manifest is not refused unless it also looks like this
 * repository in a second, independent way. This is a deliberate trade and not a
 * complete identification: a tree with the manifest **and** `docs/VISION.md`
 * removed is not recognised at all, by this code or by the code it replaces.
 */

import fs from 'node:fs';
import path from 'node:path';

/** The manifest whose `name` field identifies this repository. */
const MANIFEST_REL = path.join('app', 'package.json');

/**
 * The file that must be beside the manifest before a directory is examined at
 * all. It keeps the check off the many unrelated projects that have an
 * `app/package.json` and nothing else in common with DSpatch.
 */
const VISION_REL = path.join('docs', 'VISION.md');

/** The name in `app/package.json` that identifies this repository. */
const OWN_PACKAGE_NAME = 'dspatch';

/**
 * Files that corroborate a manifest DSpatch cannot read. Any one of them, with
 * `docs/VISION.md`, is enough for the unreadable manifest to refuse rather than
 * pass. All of them are in DSpatch's own tree.
 */
const CORROBORATING_REL: readonly string[] = [
  'AGENTS.md',
  'BACKLOG.md',
  path.join('docs', 'DEVELOPMENT_LOOP.md'),
  path.join('backlog', 'tasks'),
];

/** What DSpatch concluded about a directory, and what it looked at to conclude it. */
export type OwnRepositoryVerdict =
  | {
      /** No ancestor of the chosen folder carries DSpatch's markers. */
      readonly kind: 'unrelated';
    }
  | {
      /** An ancestor is DSpatch's own working copy, by the name in its manifest. */
      readonly kind: 'own-repository';
      /** The directory that carries the markers. Equal to the chosen folder, or above it. */
      readonly root: string;
      readonly manifestPath: string;
      /** Paths, relative to `root`, that were found. For the refusal message. */
      readonly markersFound: readonly string[];
    }
  | {
      /**
       * An ancestor carries DSpatch's markers but its manifest could not be read
       * or parsed, so whether this is DSpatch cannot be established. The caller
       * refuses: an unreadable marker is not permission.
       */
      readonly kind: 'undecidable';
      readonly root: string;
      readonly manifestPath: string;
      /** Why the manifest could not be used, in the words of the failure. */
      readonly reason: string;
      readonly markersFound: readonly string[];
    };

function exists(target: string): boolean {
  try {
    return fs.existsSync(target);
  } catch {
    // `existsSync` swallows its own errors, so this is belt and braces. An
    // unanswerable question about a path is not evidence that it is absent, but
    // there is nothing more to ask, and the manifest read below is what decides.
    return false;
  }
}

/** What the directory carries, relative to itself, for the message. */
function markersIn(dir: string): readonly string[] {
  const found: string[] = [];
  for (const rel of [MANIFEST_REL, VISION_REL, ...CORROBORATING_REL]) {
    if (exists(path.join(dir, rel))) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Examine one directory. No walking: `findOwnRepository` does that.
 *
 * Exported for the tests, which check the three outcomes directly as well as
 * through the walk.
 */
export function inspectDirectory(dir: string): OwnRepositoryVerdict {
  const root = path.resolve(dir);
  const manifestPath = path.join(root, MANIFEST_REL);
  if (!exists(manifestPath) || !exists(path.join(root, VISION_REL))) {
    return { kind: 'unrelated' };
  }

  let text: string;
  try {
    text = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    return undecidable(root, manifestPath, `it could not be read: ${String(error)}`);
  }

  let parsed: unknown;
  try {
    // A UTF-8 BOM is the case Verifier 010 hit by accident, and stripping it is
    // not leniency: `JSON.parse` is the only thing that objects to it, so a BOM
    // would otherwise make a perfectly ordinary manifest undecidable and refuse
    // an unrelated project. Anything else that will not parse stays undecidable.
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    return undecidable(root, manifestPath, `it is not valid JSON: ${String(error)}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undecidable(
      root,
      manifestPath,
      'it parsed as JSON but is not an object, so it has no name field to read',
    );
  }
  const name = (parsed as Record<string, unknown>)['name'];
  if (name === OWN_PACKAGE_NAME) {
    return {
      kind: 'own-repository',
      root,
      manifestPath,
      markersFound: markersIn(root),
    };
  }
  if (typeof name !== 'string' || name.trim() === '') {
    // A manifest that parses but names nothing cannot clear this folder either.
    return undecidable(
      root,
      manifestPath,
      'it parsed as JSON but its name field is missing or empty',
    );
  }
  return { kind: 'unrelated' };
}

/**
 * The manifest could not clear the folder. Whether that refuses depends on
 * whether anything else here looks like DSpatch — see the trade in the header.
 */
function undecidable(
  root: string,
  manifestPath: string,
  reason: string,
): OwnRepositoryVerdict {
  const markersFound = markersIn(root);
  const corroborated = CORROBORATING_REL.some((rel) => markersFound.includes(rel));
  if (!corroborated) {
    return { kind: 'unrelated' };
  }
  return { kind: 'undecidable', root, manifestPath, reason, markersFound };
}

/**
 * Walk up from `startDir`, inclusive, and report the first ancestor that is or
 * might be DSpatch's own working copy.
 *
 * The chosen folder itself is examined first, so the behaviour for the
 * repository root is unchanged; the ancestors are what closes hole 1.
 */
export function findOwnRepository(startDir: string): OwnRepositoryVerdict {
  let dir = path.resolve(startDir);
  for (;;) {
    const verdict = inspectDirectory(dir);
    if (verdict.kind !== 'unrelated') {
      return verdict;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // `path.dirname` is a fixed point at the root of a drive and at a UNC
      // share root, which is the only termination condition that holds on both
      // Windows and Linux.
      return { kind: 'unrelated' };
    }
    dir = parent;
  }
}

/**
 * Where DSpatch's own sources are, as far as the running process can tell.
 *
 * `appPath` is `<repo>/app` when running from source and a path inside
 * `app.asar` when packaged. Walking up from either finds the repository whenever
 * the artifact is still inside the tree it was built in — which the packaged
 * artifact under `app/release/win-unpacked` is. It returns `null` for a copy that
 * has been moved out of the tree, and that is the honest answer: the guard on the
 * chosen folder does not depend on this value, so an unknown own-root costs
 * nothing that used to be covered.
 */
export function ownRepositoryRoot(appPath: string): string | null {
  const verdict = findOwnRepository(appPath);
  return verdict.kind === 'unrelated' ? null : verdict.root;
}

/** DSpatch's own working copy, found below the folder the user chose. */
export interface ContainedOwnRepository {
  readonly kind: 'contains';
  /** DSpatch's own root, as the running process resolved it. */
  readonly root: string;
  /** Where it sits relative to the chosen folder. For the message. */
  readonly relativePath: string;
  /**
   * Which of the two questions answered it: the two paths written the same way, or
   * the filesystem reporting one directory under two spellings. The refusal reads
   * the same either way; the tests assert this so the identity path is known to be
   * what fires for a spelling `path.relative` cannot see through.
   */
  readonly decidedBy: 'spelling' | 'identity';
}

/**
 * Whether the chosen folder contains DSpatch, or whether that cannot be told.
 *
 * `undecidable` exists because the question is now asked of the filesystem, and a
 * filesystem can decline to answer. Treating that as "not contained" would be the
 * fail-open this module was written to remove, so the caller refuses — the same
 * direction as a manifest that cannot be read.
 */
export type ContainmentVerdict =
  | { readonly kind: 'unrelated' }
  | ContainedOwnRepository
  | {
      readonly kind: 'undecidable';
      /** The directory whose identity could not be established. Named in the message. */
      readonly unresolved: string;
      /** Why, in the words of the failure. */
      readonly reason: string;
    };

/**
 * A directory's identity as the filesystem reports it, independent of spelling.
 *
 * `dev` and `ino` are one directory's name in the only vocabulary that has no
 * synonyms. `ino === 0` is the filesystem saying it does not keep such a name, and
 * a comparison of two zeroes would call every pair of directories the same one, so
 * that is a failure to answer rather than an answer.
 */
type DirectoryIdentity = { readonly key: string } | { readonly failure: string };

function identityOf(dir: string): DirectoryIdentity {
  let stats: fs.BigIntStats;
  try {
    stats = fs.statSync(dir, { bigint: true });
  } catch (error) {
    return { failure: `it could not be examined: ${String(error)}` };
  }
  if (stats.ino === 0n) {
    return { failure: 'the filesystem does not report an identity for it' };
  }
  return { key: `${stats.dev.toString()}:${stats.ino.toString()}` };
}

/**
 * Is DSpatch's own working copy **inside** the chosen folder?
 *
 * `ownRoot` is what the running process resolved its own sources to, or `null`
 * when it could not: a packaged copy moved out of the tree it was built in cannot
 * answer, and an unknown own-root refuses nothing. That is a real limit and not a
 * hidden one — the content walk is what closes the cases that matter, and this
 * test is a second direction on top of it.
 *
 * Only a **strict** ancestor answers here. The chosen folder being the own root
 * itself, or inside it, is `findOwnRepository`'s case, and its message is the
 * better one: it can name the manifest it read.
 *
 * Two questions, in this order, and the second is what Verifier 007's three
 * spellings needed — see the header:
 *
 * 1. **The spelling.** `path.relative` rather than a string prefix, because on
 *    Windows it compares without regard to case, which a prefix test would get
 *    wrong for `c:\users\…` against `C:\Users\…`. This answers every case where
 *    both paths are written the same way, which is the ordinary one, and it
 *    touches the filesystem not at all.
 * 2. **The identity.** When the spellings do not overlap, that is not evidence
 *    they are different directories: `\\localhost\C$\x` and `C:\x` share no
 *    prefix and are one directory. So walk up from DSpatch's own root — the same
 *    direction everything else here looks, and a handful of `statSync` calls —
 *    and ask the filesystem whether any strict ancestor *is* the chosen folder.
 *
 * A directory whose identity cannot be established makes this `undecidable`
 * rather than "not contained". For the chosen folder that is close to
 * unreachable, since `validateProjectFolder` has already stat'ed it and checked
 * it can be read before asking; for an ancestor of DSpatch's own root it would
 * mean DSpatch cannot examine the tree it is running from, which is worth
 * refusing loudly rather than passing over in silence.
 */
export function ownRepositoryInside(chosen: string, ownRoot: string | null): ContainmentVerdict {
  if (ownRoot === null || ownRoot.trim() === '') {
    return { kind: 'unrelated' };
  }
  const from = path.resolve(chosen);
  const root = path.resolve(ownRoot);

  const relativePath = path.relative(from, root);
  // The first segment, not a `startsWith('..')` prefix test: a directory may be
  // called `..something`, and that is inside the chosen folder rather than above
  // it. An empty result is the chosen folder itself and an absolute one means the
  // spellings do not overlap; both fall through to the identity question.
  if (
    relativePath !== '' &&
    !path.isAbsolute(relativePath) &&
    relativePath.split(path.sep)[0] !== '..'
  ) {
    return { kind: 'contains', root, relativePath, decidedBy: 'spelling' };
  }

  const chosenIdentity = identityOf(from);
  if ('failure' in chosenIdentity) {
    return { kind: 'undecidable', unresolved: from, reason: chosenIdentity.failure };
  }

  let dir = root;
  for (;;) {
    const parent = path.dirname(dir);
    if (parent === dir) {
      // The same fixed point `findOwnRepository` terminates on, at a drive root
      // and at a UNC share root.
      return { kind: 'unrelated' };
    }
    dir = parent;
    const identity = identityOf(dir);
    if ('failure' in identity) {
      return { kind: 'undecidable', unresolved: dir, reason: identity.failure };
    }
    if (identity.key === chosenIdentity.key) {
      // `dir` and the chosen folder are one directory, however differently the two
      // are spelled, so the relative path is taken in DSpatch's own spelling: it
      // names a real folder the user can go and look at.
      return {
        kind: 'contains',
        root,
        relativePath: path.relative(dir, root),
        decidedBy: 'identity',
      };
    }
  }
}

/** Why the refusal exists, in the two sentences that are true of every case. */
const WHY =
  'DSP-1 measured that the agent is not confined to the folder it is given, so ' +
  'a writing run here could edit DSpatch while it is running. Containment is ' +
  'not built yet.';

/** The way past it, and what did not happen. */
const OVERRIDE =
  'Set DSPATCH_ALLOW_OWN_REPO=1 if you mean to do this anyway. Nothing was ' +
  'opened and nothing was changed.';

/**
 * The refusal the user reads.
 *
 * It names the folder, the directory that was recognised, the files that were
 * looked at and the way out. The wording has to survive two things: the renderer
 * classifies a refused folder by the `Refusing to open` prefix
 * (`recovery.ts:106`), and someone who has legitimately opened an unrelated
 * project needs to be able to see what was checked and disagree with it.
 */
export function describeRefusal(
  chosen: string,
  verdict: Exclude<OwnRepositoryVerdict, { kind: 'unrelated' }>,
): string {
  const checked = `What was checked: ${verdict.markersFound.join(', ')} under ${verdict.root}. `;

  if (verdict.kind === 'own-repository') {
    const where =
      path.resolve(chosen) === verdict.root
        ? "this is DSpatch's own working copy"
        : `it is inside DSpatch's own working copy at ${verdict.root}`;
    return (
      `Refusing to open ${chosen}: ${where}. ${WHY} ` +
      `${verdict.manifestPath} names the project "${OWN_PACKAGE_NAME}". ${checked}` +
      OVERRIDE
    );
  }
  return (
    `Refusing to open ${chosen}: DSpatch cannot tell whether ${verdict.root} is ` +
    `its own working copy. ${verdict.manifestPath} is the file that would say, and ` +
    `${verdict.reason}. DSpatch refuses when it cannot answer this, because a check ` +
    `that lets a folder through when the marker it reads is unreadable is worse than ` +
    `no check at all. ${WHY} ${checked}If this is your own project, make that file ` +
    `readable and valid JSON and choose the folder again, or choose a folder that is ` +
    `not inside ${verdict.root}. ${OVERRIDE}`
  );
}

/**
 * The refusal when the chosen folder **contains** DSpatch's own working copy.
 *
 * This one is the most likely of the three to be met by someone doing nothing
 * wrong: keep your projects under one parent directory, clone DSpatch into it, and
 * choosing that parent is now refused. So it says where DSpatch sits inside the
 * folder, says where the claim comes from — the running application's own
 * location, not the content of the chosen folder — and points at the specific
 * project, which is what the user almost certainly meant.
 *
 * The `Refusing to open` prefix is what `renderer/recovery.ts:106` classifies a
 * refused folder by, and losing it loses the window's *choose another folder*
 * handling.
 */
export function describeContainingRefusal(
  chosen: string,
  contained: ContainedOwnRepository,
): string {
  return (
    `Refusing to open ${chosen}: DSpatch's own working copy is inside it, at ` +
    `${contained.root} — the ${contained.relativePath} folder within the one you ` +
    `chose. ${WHY} A folder above DSpatch gives the agent DSpatch's own source ` +
    `along with everything else beneath it, so opening this is opening DSpatch ` +
    `the long way round. Open the specific project you want to work on instead: ` +
    `a folder that neither contains ${contained.root} nor is inside it. DSpatch ` +
    `found that location from where it is running, not from the contents of the ` +
    `folder you chose. ${OVERRIDE}`
  );
}

/**
 * The refusal when DSpatch cannot tell whether the chosen folder contains it.
 *
 * The containing question is answered by asking the filesystem which directories
 * are the same directory, and a filesystem that will not say leaves the question
 * open. Refusing is the same direction as an unreadable manifest and for the same
 * reason, so the message says which directory could not be identified and how to
 * get past it — a refusal nobody can act on is the failure mode to avoid while
 * closing a fail-open one.
 */
export function describeUndecidableContainment(
  chosen: string,
  verdict: Extract<ContainmentVerdict, { kind: 'undecidable' }>,
): string {
  return (
    `Refusing to open ${chosen}: DSpatch cannot tell whether its own working copy ` +
    `is inside it. One directory can be written several ways — a network share, a ` +
    `short name, a link — so which folders are the same folder is a question for ` +
    `the filesystem rather than for the paths, and ${verdict.unresolved} could not ` +
    `be identified: ${verdict.reason}. DSpatch refuses when it cannot answer this, ` +
    `for the same reason it refuses a manifest it cannot read: a check that lets a ` +
    `folder through when the thing it reads is unreadable is worse than no check at ` +
    `all, because it is trusted. ${WHY} If this is your own project, choose it again ` +
    `by its ordinary path — a drive letter and folders rather than a share or a ` +
    `link — or make ${verdict.unresolved} readable. ${OVERRIDE}`
  );
}

