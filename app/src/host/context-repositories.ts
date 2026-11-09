/**
 * The workspace's other repositories as read context for review (DSP-175, Niclas's decision
 * of 5 November 2026).
 *
 * The review's repository and its two commits stay the review's scope. Other repositories
 * the person explicitly added to the same workspace become context the agent may read when
 * it needs to, for example the library whose function a changed line calls. They are not
 * sent in a prompt; they are written beside the revisions, from Git's object store, as
 *
 * ```
 * userData/reviews/revisions/<pair key>/context/<name>/
 * ```
 *
 * so the same read-only tools, the same folder confinement and the same hooks apply to them
 * as to `base/` and `target/`. Nothing outside the workspace's folders is given.
 *
 * **Which commit.** A context repository is read at one commit, chosen here and recorded:
 *
 * 1. a submodule (gitlink) in the reviewed To commit whose commit exists in the repository;
 * 2. else a dependency declaration in the reviewed To commit (package.json and
 *    package-lock.json, go.mod, Cargo.toml and Cargo.lock) naming the repository's own
 *    package, module or crate: one exact version that matches a tag `v<version>` or
 *    `<version>` gives that tag's commit; a path dependency (`file:`, `link:`, a `replace`
 *    to a folder, `path = …`) gives HEAD, marked as such, since the reviewed build uses
 *    whatever is checked out;
 * 3. else HEAD, marked as not established.
 *
 * Only (1) and a matched tag of (2) count as established. The working copy is never read
 * for content: whether it differs from the commit read is recorded as counts only, so the
 * agent and the person know the context may not be what is on disk.
 *
 * **What was given is kept.** Every repository and commit given to an agent for a review is
 * appended to that review's context record (`userData/reviews/context/<key>.json`); a
 * citation names the repository and that commit, and opens only if this review gave it.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { isFullHash, type ContextFileView, type PairAnswer, type RevisionPairIdentity } from '../shared/review-pair';
import type { ContextMaterial, ContextReader } from '../shared/review-agent';

/** How the commit of a context repository was chosen. */
export type ContextChoice = ContextFileView['how'];

export interface ContextResolution {
  readonly commit: string;
  readonly how: ContextChoice;
  readonly established: boolean;
  /** One plain sentence, for the agent and the person. */
  readonly note: string;
}

/** Whether the working copy differs from what was read: counts only, never content. */
export interface WorkingCopyState {
  /** The checked-out commit, or `null` when there is none. */
  readonly head: string | null;
  /** Tracked files changed, staged or not. */
  readonly changed: number;
  /** Untracked files (ignored ones are not counted). */
  readonly untracked: number;
}

/** A repository of the workspace, by the name it has as context in this review. */
export interface ContextRepository {
  /** A single folder name, unique in the review: its folder under `context/`. */
  readonly name: string;
  readonly path: string;
}

/** How many context repositories one snapshot holds at most. */
export const CONTEXT_REPOSITORIES_MAX = 12;

/** How many dependency files of the reviewed commit are read at most, and how deep. */
const MANIFESTS_MAX = 40;
const MANIFEST_DEPTH = 3;
const MANIFEST_NAMES = new Set(['package.json', 'package-lock.json', 'go.mod', 'Cargo.toml', 'Cargo.lock']);
const MANIFEST_SKIPPED = new Set(['node_modules', 'vendor', 'third_party', 'dist', 'build', 'target']);

const MAX_BUFFER = 64 * 1024 * 1024;

function git(repository: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotePath=false', '-C', repository, ...args], { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function gitBuffer(repository: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repository, ...args], { maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(stderr.toString('utf8').trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function gitOk(repository: string, args: readonly string[]): Promise<string | null> {
  try {
    return (await git(repository, args)).trim();
  } catch {
    return null;
  }
}

/** The same folder however it was spelled: resolved, real, and case-blind on Windows. */
export function folderIdentity(folder: string): string {
  let real = path.resolve(folder);
  try {
    real = fs.realpathSync.native(real);
  } catch {
    // A folder that cannot be resolved keeps its spelling.
  }
  return process.platform === 'win32' ? real.toLowerCase() : real;
}

/** Whether `folder` is `root` or inside it. */
function within(folder: string, root: string): boolean {
  const child = folderIdentity(folder);
  const parent = folderIdentity(root);
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}

/** A repository-relative path that cannot leave the repository or name something odd. */
export function safeRepositoryPath(filePath: string): boolean {
  return (
    filePath !== '' &&
    !filePath.includes('\0') &&
    !filePath.includes('\\') &&
    !filePath.startsWith('/') &&
    !/^[A-Za-z]:/.test(filePath) &&
    !filePath.split('/').some((segment) => segment === '..' || segment === '.' || segment === '')
  );
}

/**
 * The workspace's other repositories, each with a folder name of its own: only repositories
 * whose top folder is one of the workspace's folders or inside one (a repository above an
 * added folder is not given), and never the reviewed one. Names are the repository's folder
 * name made safe for a single folder, told apart in order of path when two are the same.
 */
export function contextRepositoriesOf(
  reviewed: string,
  workspaceFolders: readonly string[],
  repositories: readonly { readonly name: string; readonly path: string }[],
): readonly ContextRepository[] {
  const reviewedIdentity = folderIdentity(reviewed);
  const kept = repositories
    .filter((entry) => folderIdentity(entry.path) !== reviewedIdentity)
    .filter((entry) => workspaceFolders.some((folder) => within(entry.path, folder)))
    .sort((a, b) => folderIdentity(a.path).localeCompare(folderIdentity(b.path)));
  const used = new Set<string>();
  const out: ContextRepository[] = [];
  for (const entry of kept) {
    const plain = path.basename(entry.path).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '') || 'repository';
    let name = plain;
    for (let index = 2; used.has(name.toLowerCase()) || name === 'base' || name === 'target'; index += 1) {
      name = `${plain}-${String(index)}`;
    }
    used.add(name.toLowerCase());
    out.push({ name, path: path.resolve(entry.path) });
  }
  return out;
}

// --- Which commit --------------------------------------------------------------------

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly object: string;
  readonly path: string;
}

function parseTree(text: string): TreeEntry[] {
  return text
    .split('\0')
    .filter((record) => record !== '')
    .map((record) => {
      const tab = record.indexOf('\t');
      const [mode = '', type = '', object = ''] = record.slice(0, tab).trim().split(/\s+/);
      return { mode, type, object, path: record.slice(tab + 1) };
    });
}

/** What the library calls itself, from its own committed files at HEAD. */
interface LibraryNames {
  readonly npm: string | null;
  readonly go: string | null;
  readonly cargo: string | null;
}

async function blobText(repository: string, spec: string): Promise<string | null> {
  try {
    const buffer = await gitBuffer(repository, ['cat-file', 'blob', spec]);
    return buffer.subarray(0, 8000).includes(0) ? null : buffer.toString('utf8');
  } catch {
    return null;
  }
}

async function libraryNames(library: string): Promise<LibraryNames> {
  let npm: string | null = null;
  try {
    const raw = JSON.parse((await blobText(library, 'HEAD:package.json')) ?? 'null') as unknown;
    if (typeof raw === 'object' && raw !== null && typeof (raw as Record<string, unknown>)['name'] === 'string') {
      npm = (raw as Record<string, string>)['name'] ?? null;
    }
  } catch {
    // No readable package.json.
  }
  const goMod = await blobText(library, 'HEAD:go.mod');
  const go = goMod === null ? null : (/^\s*module\s+(\S+)/m.exec(goMod)?.[1] ?? null);
  const cargoToml = await blobText(library, 'HEAD:Cargo.toml');
  const cargoPackage = cargoToml === null ? null : /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(cargoToml)?.[1];
  const cargo = cargoPackage === undefined || cargoPackage === null ? null : (/^\s*name\s*=\s*"([^"]+)"/m.exec(cargoPackage)?.[1] ?? null);
  return { npm, go, cargo };
}

/** One thing a dependency file of the reviewed commit says about the library. */
type Declared =
  | { readonly kind: 'version'; readonly version: string; readonly where: string }
  | { readonly kind: 'path'; readonly spec: string; readonly where: string }
  | { readonly kind: 'range'; readonly spec: string; readonly where: string };

const EXACT_VERSION = /^[=v]?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function isPathSpec(spec: string): boolean {
  return /^(?:file:|link:|portal:|workspace:)/.test(spec) || spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec);
}

function npmSpec(spec: string, where: string): Declared {
  if (isPathSpec(spec)) {
    return { kind: 'path', spec, where };
  }
  return EXACT_VERSION.test(spec) ? { kind: 'version', version: spec.replace(/^=/, ''), where } : { kind: 'range', spec, where };
}

function declaredIn(file: string, text: string, names: LibraryNames): Declared[] {
  const base = path.posix.basename(file);
  const out: Declared[] = [];
  if (base === 'package.json' && names.npm !== null) {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        const deps = raw[section];
        const spec = typeof deps === 'object' && deps !== null ? (deps as Record<string, unknown>)[names.npm] : undefined;
        if (typeof spec === 'string') {
          out.push(npmSpec(spec.trim(), file));
        }
      }
    } catch {
      // Not readable JSON: says nothing.
    }
  } else if (base === 'package-lock.json' && names.npm !== null) {
    try {
      const raw = JSON.parse(text) as Record<string, unknown>;
      const packages = raw['packages'];
      const entry = typeof packages === 'object' && packages !== null ? (packages as Record<string, unknown>)[`node_modules/${names.npm}`] : undefined;
      const legacy = typeof raw['dependencies'] === 'object' && raw['dependencies'] !== null ? (raw['dependencies'] as Record<string, unknown>)[names.npm] : undefined;
      const found = (entry ?? legacy) as Record<string, unknown> | undefined;
      if (typeof found === 'object' && found !== null) {
        const resolved = typeof found['resolved'] === 'string' ? found['resolved'] : '';
        const version = typeof found['version'] === 'string' ? found['version'] : '';
        if (found['link'] === true || isPathSpec(resolved) || isPathSpec(version)) {
          out.push({ kind: 'path', spec: resolved || version || 'link', where: file });
        } else if (version !== '') {
          out.push(npmSpec(version, file));
        }
      }
    } catch {
      // Not readable JSON: says nothing.
    }
  } else if (base === 'go.mod' && names.go !== null) {
    const module = names.go.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(new RegExp(`^\\s*(?:replace\\s+)?${module}(?:\\s+v\\S+)?\\s*=>\\s*(\\S+)(?:\\s+(v\\S+))?`, 'gm'))) {
      const to = match[1] ?? '';
      out.push(isPathSpec(to) ? { kind: 'path', spec: to, where: file } : { kind: 'range', spec: `${to} ${match[2] ?? ''}`.trim(), where: file });
    }
    if (out.length === 0) {
      for (const match of text.matchAll(new RegExp(`^\\s*(?:require\\s+)?${module}\\s+(v[^\\s/]+)`, 'gm'))) {
        out.push({ kind: 'version', version: match[1] ?? '', where: file });
      }
    }
  } else if (base === 'Cargo.lock' && names.cargo !== null) {
    for (const block of text.split(/\n(?=\[\[package\]\])/)) {
      if (new RegExp(`^\\s*name\\s*=\\s*"${names.cargo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*$`, 'm').test(block)) {
        const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        const source = /^\s*source\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        if (version !== undefined) {
          // A crate without a source in the lock is a path (or workspace) dependency.
          out.push(source === undefined ? { kind: 'path', spec: `${names.cargo} ${version} (no source in Cargo.lock)`, where: file } : { kind: 'version', version, where: file });
        }
      }
    }
  } else if (base === 'Cargo.toml' && names.cargo !== null) {
    const crate = names.cargo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inline = new RegExp(`^\\s*${crate}\\s*=\\s*(.+)$`, 'm').exec(text)?.[1] ?? null;
    const table = new RegExp(`\\[(?:[\\w-]+\\.)?dependencies\\.${crate}\\]([\\s\\S]*?)(?:\\n\\[|$)`).exec(text)?.[1] ?? null;
    const spec = inline ?? table;
    if (spec !== null) {
      const pathSpec = /path\s*=\s*"([^"]+)"/.exec(spec)?.[1];
      out.push(pathSpec !== undefined ? { kind: 'path', spec: pathSpec, where: file } : { kind: 'range', spec: spec.trim().slice(0, 80), where: file });
    }
  }
  return out;
}

async function tagCommit(library: string, version: string): Promise<{ readonly tag: string; readonly commit: string } | null> {
  const bare = version.replace(/^v/, '');
  for (const tag of [`v${bare}`, bare]) {
    const commit = await gitOk(library, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`]);
    if (commit !== null && isFullHash(commit)) {
      return { tag, commit };
    }
  }
  return null;
}

/**
 * Which commit of `library` the reviewed To commit uses, as far as Git and its dependency
 * files say; HEAD, honestly marked, when they do not. Reads the object stores only.
 */
export async function resolveContextVersion(reviewed: string, target: string, library: string): Promise<ContextResolution> {
  const head = await gitOk(library, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const entries = parseTree(await git(reviewed, ['ls-tree', '-r', '-z', '--full-tree', target]));
  // 1. A submodule of the reviewed commit pinned at a commit this repository has.
  for (const entry of entries) {
    if (entry.type === 'commit' && isFullHash(entry.object) && (await gitOk(library, ['cat-file', '-e', `${entry.object}^{commit}`])) !== null) {
      return { commit: entry.object, how: 'submodule', established: true, note: `The reviewed To commit pins it as the submodule ${entry.path}; that commit is what was read.` };
    }
  }
  if (head === null || !isFullHash(head)) {
    throw new Error('it has no commit checked out to read');
  }
  // 2. Its package, module or crate declared in the reviewed commit's dependency files.
  const names = await libraryNames(library);
  const declared: Declared[] = [];
  if (names.npm !== null || names.go !== null || names.cargo !== null) {
    const manifests = entries
      .filter((entry) => entry.type === 'blob' && MANIFEST_NAMES.has(path.posix.basename(entry.path)))
      .filter((entry) => entry.path.split('/').length <= MANIFEST_DEPTH && !entry.path.split('/').some((segment) => MANIFEST_SKIPPED.has(segment)))
      .slice(0, MANIFESTS_MAX);
    for (const manifest of manifests) {
      const text = await blobText(reviewed, `${target}:${manifest.path}`);
      if (text !== null) {
        declared.push(...declaredIn(manifest.path, text, names));
      }
    }
  }
  const label = names.npm ?? names.go ?? names.cargo ?? 'it';
  const versions = [...new Set(declared.flatMap((entry) => (entry.kind === 'version' ? [entry.version.replace(/^v/, '')] : [])))];
  const paths = declared.filter((entry) => entry.kind === 'path');
  const ranges = declared.filter((entry) => entry.kind === 'range');
  if (versions.length === 1 && paths.length === 0) {
    const version = versions[0] ?? '';
    const where = declared.find((entry) => entry.kind === 'version')?.where ?? '';
    const tagged = await tagCommit(library, version);
    if (tagged !== null) {
      return { commit: tagged.commit, how: 'dependency', established: true, note: `The reviewed To commit declares ${label} ${version} (${where}); read at its tag ${tagged.tag}.` };
    }
    return {
      commit: head,
      how: 'head',
      established: false,
      note: `Not established which version the reviewed build uses: it declares ${label} ${version} (${where}), but this repository has no tag v${version} or ${version}. The commit read is HEAD.`,
    };
  }
  if (versions.length > 1) {
    return { commit: head, how: 'head', established: false, note: `Not established which version the reviewed build uses: its files declare several versions of ${label} (${versions.join(', ')}). The commit read is HEAD.` };
  }
  if (paths.length > 0) {
    const first = paths[0];
    return {
      commit: head,
      how: 'path-dependency',
      established: false,
      note: `A path dependency (${first?.kind === 'path' ? first.spec : ''} in ${first?.where ?? ''}): the reviewed build uses whatever is checked out there, so the commit read is HEAD.`,
    };
  }
  if (ranges.length > 0) {
    const first = ranges[0];
    return {
      commit: head,
      how: 'head',
      established: false,
      note: `Not established which version the reviewed build uses: it declares ${label} as ${first?.kind === 'range' ? first.spec : ''} (${first?.where ?? ''}), which names no single version. The commit read is HEAD.`,
    };
  }
  return { commit: head, how: 'head', established: false, note: 'Not established which version the reviewed build uses: no submodule or dependency declaration names it. The commit read is HEAD.' };
}

/** Whether the working copy differs from `commit`: counts only. Takes no lock and writes nothing. */
export async function workingCopyState(repository: string): Promise<WorkingCopyState> {
  const head = await gitOk(repository, ['rev-parse', '--verify', 'HEAD^{commit}']);
  let changed = 0;
  let untracked = 0;
  try {
    const text = await git(repository, ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=normal']);
    const records = text.split('\0').filter((record) => record !== '');
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] ?? '';
      if (record.startsWith('??')) {
        untracked += 1;
      } else if (record.length > 3) {
        changed += 1;
        // A rename or copy is followed by its original name.
        if (/^[RC]|^.[RC]/.test(record)) {
          index += 1;
        }
      }
    }
  } catch {
    // Unknown is not zero: reported as nothing counted, with no head either when Git failed.
  }
  return { head: head !== null && isFullHash(head) ? head : null, changed, untracked };
}

/** A file's lines at a commit of a repository, from Git; `null` when missing or not text. */
export async function linesAtCommit(repository: string, commit: string, filePath: string): Promise<readonly string[] | null> {
  if (!safeRepositoryPath(filePath) || !isFullHash(commit)) {
    return null;
  }
  const text = await blobText(repository, `${commit}:${filePath}`);
  if (text === null) {
    return null;
  }
  const lines = text.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.map((line) => line.replace(/\r$/, ''));
}

/** A context repository as written for the agent, for its prompt and its reference checks. */
export interface ContextSnapshot extends ContextMaterial {
  /** Where the repository is on this machine (never shown to the agent). */
  readonly repository: string;
}

/** The reader every context reference is checked with: Git at the recorded commit. */
export function contextReaderOf(context: readonly ContextSnapshot[]): ContextReader {
  const byName = new Map(context.map((entry) => [entry.name, entry]));
  return {
    names: new Set(byName.keys()),
    read: async (name, filePath) => {
      const entry = byName.get(name);
      return entry === undefined ? null : { commit: entry.commit, lines: await linesAtCommit(entry.repository, entry.commit, filePath) };
    },
  };
}

// --- The record of what a review was given ---------------------------------------------

interface GivenEntry {
  readonly name: string;
  readonly path: string;
  readonly commit: string;
  readonly how: ContextChoice;
  readonly established: boolean;
  readonly note: string;
  readonly workingCopy: WorkingCopyState;
  /** The job or discussion session it was given to, and when. */
  readonly holder: string;
  readonly at: string;
}

interface ContextRecord {
  readonly version: 1;
  readonly pair: RevisionPairIdentity;
  /** The workspace's other repositories when this review was last used from that workspace. */
  readonly workspace: { readonly recordedAt: string; readonly repositories: readonly ContextRepository[] } | null;
  readonly given: readonly GivenEntry[];
}

/** How many given entries a review keeps (the oldest go first). */
const GIVEN_MAX = 400;

export interface ReviewContextsOptions {
  /** `userData/reviews/context`. */
  readonly recordsDir: string;
  /**
   * The open workspace's folders and the Git repositories found under them, or `null` when
   * no workspace is open. Only these are ever given as context.
   */
  readonly workspace: () => Promise<{ readonly folders: readonly string[]; readonly repositories: readonly { readonly name: string; readonly path: string }[] } | null>;
  readonly log: (message: string) => void;
}

const CHOICES: readonly ContextChoice[] = ['submodule', 'dependency', 'path-dependency', 'head'];

export class ReviewContexts {
  private readonly options: ReviewContextsOptions;

  constructor(options: ReviewContextsOptions) {
    this.options = options;
  }

  private file(key: string): string {
    return path.join(this.options.recordsDir, `${key}.json`);
  }

  private read(key: string, pair: RevisionPairIdentity): ContextRecord {
    const empty: ContextRecord = { version: 1, pair, workspace: null, given: [] };
    // A review's id (DSP-186): its pair key when recorded before review ids, else `r-` and 24 hex.
    if (!/^(?:r-)?[0-9a-f]{24}$/.test(key)) {
      return empty;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(key), 'utf8')) as Record<string, unknown>;
      const stored = raw['pair'] as Record<string, unknown> | undefined;
      if (raw['version'] !== 1 || stored === undefined || stored['repository'] !== pair.repository || stored['base'] !== pair.base || stored['target'] !== pair.target) {
        return empty;
      }
      const repositoriesOf = (value: unknown): ContextRepository[] =>
        (Array.isArray(value) ? value : []).flatMap((entry: unknown) => {
          const item = entry as Record<string, unknown> | null;
          return item !== null && typeof item === 'object' && typeof item['name'] === 'string' && typeof item['path'] === 'string' ? [{ name: item['name'], path: item['path'] }] : [];
        });
      const workspaceRaw = raw['workspace'] as Record<string, unknown> | null | undefined;
      const workspace =
        typeof workspaceRaw === 'object' && workspaceRaw !== null
          ? { recordedAt: typeof workspaceRaw['recordedAt'] === 'string' ? workspaceRaw['recordedAt'] : '', repositories: repositoriesOf(workspaceRaw['repositories']) }
          : null;
      const given = (Array.isArray(raw['given']) ? raw['given'] : []).flatMap((entry: unknown): GivenEntry[] => {
        const item = entry as Record<string, unknown> | null;
        if (item === null || typeof item !== 'object' || typeof item['name'] !== 'string' || typeof item['path'] !== 'string' || !isFullHash(item['commit'])) {
          return [];
        }
        const copy = (item['workingCopy'] ?? {}) as Record<string, unknown>;
        return [
          {
            name: item['name'],
            path: item['path'],
            commit: item['commit'],
            how: CHOICES.includes(item['how'] as ContextChoice) ? (item['how'] as ContextChoice) : 'head',
            established: item['established'] === true,
            note: typeof item['note'] === 'string' ? item['note'] : '',
            workingCopy: {
              head: isFullHash(copy['head']) ? copy['head'] : null,
              changed: Number.isInteger(copy['changed']) ? (copy['changed'] as number) : 0,
              untracked: Number.isInteger(copy['untracked']) ? (copy['untracked'] as number) : 0,
            },
            holder: typeof item['holder'] === 'string' ? item['holder'] : '',
            at: typeof item['at'] === 'string' ? item['at'] : '',
          },
        ];
      });
      return { version: 1, pair, workspace, given };
    } catch {
      return empty;
    }
  }

  private write(key: string, record: ContextRecord): void {
    const file = this.file(key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
  }

  /**
   * The repositories to give as context for a review now. When the open workspace holds the
   * reviewed repository, its other repositories are recorded for the review and given; else
   * what was recorded when the review was last used from its workspace. Never anything else.
   */
  async current(key: string, pair: RevisionPairIdentity): Promise<readonly ContextRepository[]> {
    const record = this.read(key, pair);
    let workspace: Awaited<ReturnType<ReviewContextsOptions['workspace']>> = null;
    try {
      workspace = await this.options.workspace();
    } catch (error) {
      this.options.log(`context: the workspace's repositories could not be listed (${error instanceof Error ? error.message : String(error)})`);
    }
    const reviewed = folderIdentity(pair.repository);
    if (workspace !== null && workspace.repositories.some((entry) => folderIdentity(entry.path) === reviewed)) {
      const repositories = contextRepositoriesOf(pair.repository, workspace.folders, workspace.repositories);
      try {
        this.write(key, { ...record, workspace: { recordedAt: new Date().toISOString(), repositories } });
      } catch (error) {
        this.options.log(`context: ${key.slice(0, 12)} could not be recorded (${error instanceof Error ? error.message : String(error)})`);
      }
      return repositories;
    }
    return record.workspace?.repositories ?? [];
  }

  /** What was given to `holder`, kept so its citations open later. */
  given(key: string, pair: RevisionPairIdentity, holder: string, context: readonly ContextSnapshot[]): void {
    if (context.length === 0) {
      return;
    }
    const record = this.read(key, pair);
    const at = new Date().toISOString();
    const added: GivenEntry[] = context.map((entry) => ({
      name: entry.name,
      path: entry.repository,
      commit: entry.commit,
      how: entry.how,
      established: entry.established,
      note: entry.note,
      workingCopy: entry.workingCopy,
      holder,
      at,
    }));
    try {
      this.write(key, { ...record, given: [...record.given, ...added].slice(-GIVEN_MAX) });
    } catch (error) {
      this.options.log(`context: ${key.slice(0, 12)} could not record what was given (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  /**
   * A file of a context repository at a commit this review gave as context, from Git. Any
   * other repository, commit or path is refused; nothing is read from a working copy.
   */
  async readFile(key: unknown, pair: RevisionPairIdentity | null, repository: unknown, filePath: unknown, commit: unknown): Promise<PairAnswer<ContextFileView>> {
    if (typeof key !== 'string' || pair === null) {
      return { error: 'That review is not open.' };
    }
    if (typeof repository !== 'string' || !isFullHash(commit)) {
      return { error: 'That names no context repository and commit of this review.' };
    }
    if (typeof filePath !== 'string' || !safeRepositoryPath(filePath)) {
      return { error: 'That is not a file of the context repository.' };
    }
    const entry = [...this.read(key, pair).given].reverse().find((given) => given.name === repository && given.commit === commit);
    if (entry === undefined) {
      return { error: `${repository} at ${commit.slice(0, 7)} was not given as context in this review.` };
    }
    try {
      const buffer = await gitBuffer(entry.path, ['cat-file', 'blob', `${commit}:${filePath}`]);
      const binary = buffer.subarray(0, 8000).includes(0);
      return { repository, commit, path: filePath, text: binary ? null : buffer.toString('utf8'), binary, how: entry.how, established: entry.established, note: entry.note };
    } catch (error) {
      return { error: `The file could not be read from ${repository} at ${commit.slice(0, 7)}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
