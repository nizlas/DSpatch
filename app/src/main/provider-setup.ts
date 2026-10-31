import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { ProviderLoginStep } from '../shared/bridge';

/*
 * Fetching a provider's program, and its sign-in, on the machine where the work runs (DSP-153).
 *
 * Claude's SDK and the Copilot CLI are the vendors' own: their terms are not ours to redistribute
 * under, so an installed DSpatch does not carry them. When a person asks, this fetches exactly the
 * versions in the pinned lockfile from the npm registry, checks each against its lockfile
 * integrity and only then puts the folder in place. Nothing runs at install time.
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
  readonly peer?: boolean;
  readonly dev?: boolean;
}

/** The packages of a lockfile this machine needs. */
export function packagesFor(
  lock: { readonly packages: Readonly<Record<string, LockEntry>> },
  platform: string,
  arch: string,
): readonly { readonly folder: string; readonly url: string; readonly integrity: string }[] {
  const fits = (list: readonly string[] | undefined, value: string): boolean => list === undefined || list.includes(value);
  return Object.entries(lock.packages).flatMap(([folder, entry]) => {
    if (folder === '' || entry.peer === true || entry.dev === true || !fits(entry.os, platform) || !fits(entry.cpu, arch)) {
      return [];
    }
    if (entry.libc !== undefined && !entry.libc.includes('glibc')) {
      return [];
    }
    if (entry.resolved === undefined || entry.integrity === undefined) {
      throw new Error(`${folder} has no fixed source in the lockfile.`);
    }
    return [{ folder, url: entry.resolved, integrity: entry.integrity }];
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
  readonly fetchBytes?: (url: string) => Promise<Buffer>;
  /** The environment a login runs in. */
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnLogin?: (command: string, args: readonly string[]) => ChildProcessWithoutNullStreams;
}

const realFetch = async (url: string): Promise<Buffer> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/** Bump when the words of the Claude consent change: an old acceptance does not cover new words. */
const CLAUDE_CONSENT_VERSION = 1;

export class ProviderSetup {
  private readonly options: ProviderSetupOptions;

  private login: { readonly tool: SupportTool; readonly child: ChildProcessWithoutNullStreams } | null = null;

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

  installed(tool: SupportTool): boolean {
    return fs.existsSync(path.join(this.folderOf(tool), 'installed.json'));
  }

  /** Fetch, check and put in place. A failure leaves whatever was there. Throws a sentence. */
  async install(tool: SupportTool, progress: (done: number, total: number) => void): Promise<void> {
    const fetchBytes = this.options.fetchBytes ?? realFetch;
    const wanted = packagesFor(this.lockOf(tool), process.platform, process.arch);
    const target = this.folderOf(tool);
    const staging = `${target}.tmp-${String(process.pid)}`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      let done = 0;
      for (const entry of wanted) {
        const bytes = await fetchBytes(entry.url);
        if (!matchesIntegrity(bytes, entry.integrity)) {
          throw new Error(`${entry.folder} does not match the checksum this build expects, so it was not installed.`);
        }
        unpackTarball(bytes, path.join(staging, entry.folder));
        done += 1;
        progress(done, wanted.length);
      }
      fs.copyFileSync(path.join(this.options.pinnedDir, `${tool}-support`, 'package.json'), path.join(staging, 'package.json'));
      fs.writeFileSync(path.join(staging, 'installed.json'), `${JSON.stringify({ atUtc: new Date().toISOString() })}\n`);
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(staging, target);
      this.options.log(`${tool} support installed in ${target}`);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
    }
  }

  /** The vendor's program in the fetched folder. */
  private program(tool: SupportTool): string {
    const exe = process.platform === 'win32' ? '.exe' : '';
    const scope = path.join(this.folderOf(tool), 'node_modules', tool === 'claude' ? '@anthropic-ai' : '@github');
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
      if (!this.installed('claude')) {
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
