import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { sdkEntry } from '../adapter/claude-support';
import type { ProviderLoginStep, ProviderProgramState } from '../shared/bridge';

/*
 * Fetching a provider's program, and its sign-in, on the machine where the work runs (DSP-153).
 *
 * Claude's SDK and the Copilot CLI are the vendors' own: their terms are not ours to redistribute
 * under, so an installed DSpatch does not carry them. When a person asks, this fetches exactly the
 * versions in the pinned lockfile from the npm registry, checks each against its lockfile
 * integrity, proves that the result loads from where it stands, and only then puts the folder in
 * place. Nothing of the packages' own runs at install time.
 *
 * Sign-in is the vendor's own command with its output read: a link and a code for the person,
 * who may be on another computer. No key or token passes through DSpatch, and the login never
 * takes a path that bills through an API key (`--console` is not offered).
 *
 * No Electron here, so the host program uses it as it is.
 */

export type SupportTool = 'claude' | 'copilot';

interface LockEntry {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
  readonly dev?: boolean;
}

export interface WantedPackage {
  readonly folder: string;
  readonly url: string;
  readonly integrity: string;
  readonly version: string;
}

/**
 * The packages of a lockfile this machine needs: what `npm ci` would put there. A `peer` entry
 * counts. The lockfile marks zod and the MCP SDK that way, and the Claude SDK does not work
 * without them.
 */
export function packagesFor(
  lock: { readonly packages: Readonly<Record<string, LockEntry>> },
  platform: string,
  arch: string,
): readonly WantedPackage[] {
  const fits = (list: readonly string[] | undefined, value: string): boolean => list === undefined || list.includes(value);
  return Object.entries(lock.packages).flatMap(([folder, entry]) => {
    if (folder === '' || entry.dev === true || !fits(entry.os, platform) || !fits(entry.cpu, arch)) {
      return [];
    }
    if (entry.libc !== undefined && !entry.libc.includes('glibc')) {
      return [];
    }
    if (entry.resolved === undefined || entry.integrity === undefined) {
      throw new Error(`${folder} has no fixed source in the lockfile.`);
    }
    return [{ folder, url: entry.resolved, integrity: entry.integrity, version: entry.version ?? '' }];
  });
}

/** Unpack an npm tarball's `package/` into `target`, refusing a path that climbs out. */
export function unpackTarball(gzipped: Buffer, target: string): void {
  const tar = gunzipSync(gzipped);
  const root = path.resolve(target);
  let long: string | null = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const text = (start: number, length: number): string => header.toString('utf8', start, start + length).replace(/\0.*$/s, '');
    const size = Number.parseInt(text(124, 12).trim() || '0', 8);
    const mode = Number.parseInt(text(100, 8).trim() || '644', 8);
    const type = text(156, 1);
    const prefix = text(345, 155);
    const name = long ?? (prefix === '' ? text(0, 100) : `${prefix}/${text(0, 100)}`);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const found = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      long = found?.[1] ?? null;
      continue;
    }
    if (type === 'g') {
      continue;
    }
    long = null;
    if (type !== '0' && type !== '') {
      continue;
    }
    const relative = name.replace(/^[^/]+\//, '');
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`The package holds a path outside itself: ${name}`);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, { mode: mode & 0o777 });
  }
}

/** Whether these bytes are what the lockfile's `sha512-…` says. */
export function matchesIntegrity(bytes: Buffer, integrity: string): boolean {
  const [algorithm, wanted] = integrity.split('-');
  return algorithm !== undefined && wanted !== undefined && createHash(algorithm).update(bytes).digest('base64') === wanted;
}

export interface ProviderSetupOptions {
  /** Where the fetched programs go: `<data>/provider-support`. */
  readonly supportDir: string;
  /** The folder holding `claude-support/` and `copilot-support/`, each with its lockfile. */
  readonly pinnedDir: string;
  readonly dataDir: string;
  readonly log: (message: string) => void;
  readonly fetchBytes?: (url: string, signal: AbortSignal) => Promise<Buffer>;
  /** Proves a folder works from where it stands; answers why not, or `null`. */
  readonly prove?: (tool: SupportTool, folder: string) => Promise<string | null>;
  /** The environment a login runs in. */
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnLogin?: (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
}

const realFetch = async (url: string, signal: AbortSignal): Promise<Buffer> => {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/** Packages fetched at the same time. */
const FETCHES_AT_ONCE = 6;

/** How long a proof may take: the first run of a large program can be slow on a busy disk. */
const PROOF_MS = 60_000;

/** A program that starts is no proof: this loads the SDK and zod and builds a tool server. */
const CLAUDE_PROOF = `
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [folder, entry] = process.argv.slice(1);
const sdk = await import(pathToFileURL(entry).href);
const zod = await import(pathToFileURL(createRequire(path.join(folder, 'package.json')).resolve('zod')).href);
const z = zod.z ?? zod;
const tool = sdk.tool('proof', 'proof', { text: z.string() }, async () => ({ content: [] }), { annotations: { readOnlyHint: true } });
sdk.createSdkMcpServer({ name: 'proof', version: '0', tools: [tool] });
`;

/** Run a command to its end. Answers what went wrong, or `null`. */
function ranCleanly(command: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, timeout: PROOF_MS });
    let said = '';
    child.stderr.on('data', (chunk: Buffer) => {
      said = `${said}${chunk.toString('utf8')}`.slice(-2_000);
    });
    child.on('error', (error) => {
      resolve(error.message);
    });
    child.on('close', (code) => {
      resolve(code === 0 ? null : `${path.basename(command)} ended with ${String(code)}: ${said.trim()}`);
    });
  });
}

/** Thrown when the person cancelled, so nobody reports it as a failure. */
export class SetupCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'SetupCancelled';
  }
}

/** Bump when the words of the Claude consent change: an old acceptance does not cover new words. */
const CLAUDE_CONSENT_VERSION = 1;

export class ProviderSetup {
  private readonly options: ProviderSetupOptions;

  private login: { readonly tool: SupportTool; readonly child: ChildProcessWithoutNullStreams } | null = null;

  private readonly installing = new Map<SupportTool, { readonly done: Promise<void>; readonly stop: AbortController }>();

  /** The install marker a folder was proved with; a new install is proved again. */
  private readonly proved = new Map<SupportTool, string>();

  constructor(options: ProviderSetupOptions) {
    this.options = options;
  }

  folderOf(tool: SupportTool): string {
    return path.join(this.options.supportDir, tool);
  }

  private lockOf(tool: SupportTool): { readonly packages: Readonly<Record<string, LockEntry>> } {
    const file = path.join(this.options.pinnedDir, `${tool}-support`, 'package-lock.json');
    return JSON.parse(fs.readFileSync(file, 'utf8')) as { readonly packages: Readonly<Record<string, LockEntry>> };
  }

  /** A swap that was cut off between its two renames leaves the old folder beside the place. */
  private restoreInterrupted(tool: SupportTool): void {
    const target = this.folderOf(tool);
    const parent = path.dirname(target);
    if (!fs.existsSync(parent) || fs.existsSync(target)) {
      return;
    }
    const left = fs.readdirSync(parent).find((name) => name.startsWith(`${tool}.old-`));
    if (left !== undefined) {
      fs.renameSync(path.join(parent, left), target);
    }
  }

  /** What is missing from a folder compared with the lockfile; `null` when nothing is. */
  private missingFrom(tool: SupportTool, folder: string): string | null {
    for (const entry of packagesFor(this.lockOf(tool), process.platform, process.arch)) {
      try {
        const found = JSON.parse(fs.readFileSync(path.join(folder, entry.folder, 'package.json'), 'utf8')) as { version?: unknown };
        if (found.version !== entry.version) {
          return `${entry.folder} is ${String(found.version)}, not ${entry.version}`;
        }
      } catch {
        return `${entry.folder} is missing`;
      }
    }
    return fs.existsSync(this.program(tool, folder)) ? null : `${this.program(tool, folder)} is missing`;
  }

  /** The folder against the lockfile. Reads files only, so it can be asked often. */
  programState(tool: SupportTool): ProviderProgramState {
    this.restoreInterrupted(tool);
    const target = this.folderOf(tool);
    if (!fs.existsSync(target)) {
      return 'absent';
    }
    return this.missingFrom(tool, target) === null ? 'ready' : 'incomplete';
  }

  /** As `programState`, and proved to work from where it stands, once per install. */
  async provenState(tool: SupportTool): Promise<ProviderProgramState> {
    const state = this.programState(tool);
    if (state !== 'ready') {
      return state;
    }
    const marker = path.join(this.folderOf(tool), 'installed.json');
    const stamp = fs.existsSync(marker) ? String(fs.statSync(marker).mtimeMs) : 'none';
    if (this.proved.get(tool) === stamp) {
      return 'ready';
    }
    const problem = await this.prove(tool, this.folderOf(tool));
    if (problem !== null) {
      this.options.log(`${tool} support does not work: ${problem}`);
      return 'incomplete';
    }
    this.proved.set(tool, stamp);
    return 'ready';
  }

  private prove(tool: SupportTool, folder: string): Promise<string | null> {
    if (this.options.prove !== undefined) {
      return this.options.prove(tool, folder);
    }
    return this.provenByRunning(tool, folder);
  }

  /** In a process of its own: a failed import would otherwise stay in this one's module cache. */
  private async provenByRunning(tool: SupportTool, folder: string): Promise<string | null> {
    const env = this.options.env ?? process.env;
    const program = await ranCleanly(this.program(tool, folder), ['--version'], env);
    if (program !== null || tool !== 'claude') {
      return program;
    }
    const node = { ...env, ELECTRON_RUN_AS_NODE: '1' };
    return ranCleanly(process.execPath, ['--input-type=module', '--eval', CLAUDE_PROOF, folder, sdkEntry(folder)], node);
  }

  /** Fetch, check, prove and put in place. A failure leaves whatever was there. Throws a sentence. */
  install(tool: SupportTool, progress: (done: number, total: number) => void): Promise<void> {
    const running = this.installing.get(tool);
    if (running !== undefined) {
      return running.done;
    }
    const stop = new AbortController();
    const done = this.fetchAndSwap(tool, progress, stop.signal).finally(() => {
      this.installing.delete(tool);
    });
    this.installing.set(tool, { done, stop });
    return done;
  }

  cancelInstall(tool: SupportTool): void {
    this.installing.get(tool)?.stop.abort();
  }

  private async fetchAndSwap(tool: SupportTool, progress: (done: number, total: number) => void, signal: AbortSignal): Promise<void> {
    const fetchBytes = this.options.fetchBytes ?? realFetch;
    const wanted = packagesFor(this.lockOf(tool), process.platform, process.arch);
    const target = this.folderOf(tool);
    const staging = `${target}.tmp-${String(process.pid)}`;
    this.restoreInterrupted(tool);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    for (const left of fs.readdirSync(path.dirname(target))) {
      if (left.startsWith(`${tool}.tmp-`) || left.startsWith(`${tool}.old-`)) {
        fs.rmSync(path.join(path.dirname(target), left), { recursive: true, force: true });
      }
    }
    fs.mkdirSync(staging, { recursive: true });
    try {
      let done = 0;
      const queue = [...wanted];
      const fetchNext = async (): Promise<void> => {
        for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
          const bytes = await this.fetched(fetchBytes, entry.url, signal);
          if (signal.aborted) {
            throw new SetupCancelled();
          }
          if (!matchesIntegrity(bytes, entry.integrity)) {
            throw new Error(`${entry.folder} does not match the checksum this build expects, so it was not installed.`);
          }
          unpackTarball(bytes, path.join(staging, entry.folder));
          done += 1;
          progress(done, wanted.length);
        }
      };
      await Promise.all(Array.from({ length: FETCHES_AT_ONCE }, fetchNext));
      fs.copyFileSync(path.join(this.options.pinnedDir, `${tool}-support`, 'package.json'), path.join(staging, 'package.json'));
      const problem = await this.prove(tool, staging);
      if (problem !== null) {
        this.options.log(`${tool} support was fetched but does not work: ${problem}`);
        throw new Error(`The ${tool === 'claude' ? 'Claude' : 'Copilot'} support that was fetched does not work on this machine, so it was not installed.`);
      }
      if (signal.aborted) {
        throw new SetupCancelled();
      }
      fs.writeFileSync(path.join(staging, 'installed.json'), `${JSON.stringify({ atUtc: new Date().toISOString() })}\n`);
      this.swapIn(tool, staging);
      this.options.log(`${tool} support installed in ${target}`);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async fetched(fetchBytes: NonNullable<ProviderSetupOptions['fetchBytes']>, url: string, signal: AbortSignal): Promise<Buffer> {
    try {
      return await fetchBytes(url, signal);
    } catch (error) {
      if (signal.aborted) {
        throw new SetupCancelled();
      }
      this.options.log(`Fetching ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error('The download could not be reached. Check the network connection and try again.', { cause: error });
    }
  }

  /** Two renames, so nothing is half deleted: on Windows a program in use refuses the first. */
  private swapIn(tool: SupportTool, staging: string): void {
    const target = this.folderOf(tool);
    const old = `${target}.old-${String(process.pid)}`;
    const present = fs.existsSync(target);
    try {
      if (present) {
        fs.renameSync(target, old);
      }
    } catch (error) {
      this.options.log(`Moving ${target} aside failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error('This support is in use. Finish or stop the running work and try again.', { cause: error });
    }
    try {
      fs.renameSync(staging, target);
    } catch (error) {
      if (present) {
        fs.renameSync(old, target);
      }
      throw error;
    }
    fs.rm(old, { recursive: true, force: true }, () => undefined);
  }

  /** The vendor's program in the fetched folder. */
  private program(tool: SupportTool, folder: string = this.folderOf(tool)): string {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const scope = path.join(folder, 'node_modules', tool === 'claude' ? '@anthropic-ai' : '@github');
    const platformFolder = `${tool === 'claude' ? 'claude-agent-sdk' : 'copilot'}-${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`;
    const name = tool === 'claude' ? `claude${exe}` : `copilot${exe}`;
    return path.join(scope, platformFolder, name);
  }

  claudeConsent(): boolean {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(this.options.dataDir, 'claude-consent.json'), 'utf8')) as { version?: unknown };
      return saved.version === CLAUDE_CONSENT_VERSION;
    } catch {
      return false;
    }
  }

  recordClaudeConsent(): void {
    fs.writeFileSync(
      path.join(this.options.dataDir, 'claude-consent.json'),
      `${JSON.stringify({ version: CLAUDE_CONSENT_VERSION, acceptedAtUtc: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  /** The reference an accepted consent gives the adapter, in the shape the launch variable has. */
  claudeReference(): string | null {
    return this.claudeConsent() ? 'accepted in DSpatch (claude-consent.json)' : null;
  }

  private run(tool: SupportTool, args: readonly string[]): ChildProcessWithoutNullStreams {
    const start = this.options.spawnLogin ?? ((command, list) => spawn(command, [...list], { env: this.options.env ?? process.env, stdio: 'pipe', windowsHide: true }));
    return start(this.program(tool), args);
  }

  /** Whether Claude Code has a subscription login here, by its own account of it. */
  claudeSignedIn(): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.programState('claude') !== 'ready') {
        resolve(false);
        return;
      }
      const child = this.run('claude', ['auth', 'status']);
      let text = '';
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
      });
      child.stdin.end();
      child.on('error', () => {
        resolve(false);
      });
      child.on('close', () => {
        try {
          resolve((JSON.parse(text) as { loggedIn?: unknown }).loggedIn === true);
        } catch {
          resolve(false);
        }
      });
    });
  }

  /** Start the vendor's sign-in. Each thing the person must do comes through `step`. */
  startLogin(tool: SupportTool, step: (next: ProviderLoginStep) => void): void {
    this.cancelLogin();
    const child = this.run(tool, tool === 'claude' ? ['auth', 'login', '--claudeai'] : ['login']);
    const current = { tool, child };
    this.login = current;
    let said = '';
    let sentUrl = '';
    const read = (chunk: Buffer): void => {
      said += chunk.toString('utf8');
      const url = /https:\/\/\S+/.exec(said)?.[0] ?? '';
      const code = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/.exec(said)?.[0];
      // Once for the link, and again if the code comes after it.
      if (url !== '' && `${url} ${code ?? ''}` !== sentUrl) {
        sentUrl = `${url} ${code ?? ''}`;
        step({ kind: 'open-url', url, ...(code === undefined ? {} : { code }) });
      }
      if (/paste code/i.test(said) && !said.includes('\u0000asked')) {
        said += '\u0000asked';
        step({ kind: 'input', prompt: 'Paste the code the page gives you.' });
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', (error) => {
      step({ kind: 'failed', message: `The sign-in could not start: ${error.message}` });
    });
    child.on('close', (code) => {
      if (this.login === current) {
        this.login = null;
        step(code === 0 ? { kind: 'done' } : { kind: 'failed', message: 'The sign-in did not finish. Nothing was changed.' });
      }
    });
  }

  answerLogin(text: string): void {
    this.login?.child.stdin.write(`${text.trim()}\n`);
  }

  cancelLogin(): void {
    const running = this.login;
    this.login = null;
    running?.child.kill();
  }
}
