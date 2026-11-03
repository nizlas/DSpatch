import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { HostRunning } from '../shared/host-bootstrap';
import type { RemoteEndpoint } from './remote-link';
import { claimRefusal, heldClaim, olderHostDataDir } from './host-data';
import { readHostManifest } from './host-packages';

const extract = promisify(execFile);

export function runningLocalHost(dataDir: string): { readonly endpoint: RemoteEndpoint; readonly pid: number; readonly startedBy?: string } | null {
  const claim = heldClaim(dataDir);
  if (claim?.kind !== 'standalone') {
    return null;
  }
  try {
    const running = JSON.parse(fs.readFileSync(path.join(dataDir, 'host-running.json'), 'utf8')) as HostRunning;
    const token = fs.readFileSync(path.join(dataDir, 'remote-token'), 'utf8').trim();
    if (running.pid !== claim.pid || !Number.isInteger(running.port) || running.port < 1 || running.port > 65535 || token === '') {
      return null;
    }
    return { endpoint: { host: '127.0.0.1', port: running.port, token }, pid: running.pid, ...(running.startedBy === undefined ? {} : { startedBy: running.startedBy }) };
  } catch {
    return null;
  }
}

export interface LocalHostOptions {
  readonly dataDir: string;
  readonly appPath: string;
  readonly bundledRoot: string | null;
  readonly packaged: boolean;
  readonly startTimeoutMs: number;
  readonly olderDataDir?: string;
  readonly env?: NodeJS.ProcessEnv;
}

async function localProgram(options: LocalHostOptions): Promise<{ readonly runtime: string; readonly entry: string; readonly electron: boolean }> {
  const manifestFile = options.bundledRoot === null ? null : path.join(options.bundledRoot, 'host-manifest.json');
  const manifest = manifestFile === null ? null : readHostManifest(manifestFile);
  if (manifest !== null) {
    const entry = manifest.packages.find((candidate) => candidate.platform === process.platform && candidate.arch === process.arch);
    if (entry === undefined || !/^[a-zA-Z0-9._-]+$/.test(manifest.hostId) || entry.file !== path.basename(entry.file) || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('This DSpatch has no valid bundled host package for this computer.');
    }
    const archive = path.join(options.bundledRoot ?? '', 'host-packages', entry.file);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(archive)) {
      hash.update(chunk);
    }
    if (hash.digest('hex') !== entry.sha256) {
      throw new Error('The bundled host package does not match this DSpatch and was not started.');
    }
    const installs = path.join(options.dataDir, 'host-installations');
    const target = path.join(installs, `${manifest.hostId}-${entry.sha256.slice(0, 16)}`);
    if (!fs.existsSync(target)) {
      fs.mkdirSync(installs, { recursive: true, mode: 0o700 });
      const stage = fs.mkdtempSync(path.join(installs, '.extract-'));
      try {
        await extract('tar', ['-xzf', archive, '-C', stage], { timeout: 60_000, windowsHide: true });
        const installed = JSON.parse(fs.readFileSync(path.join(stage, 'dspatch-host', 'manifest.json'), 'utf8')) as { hostId?: string };
        if (installed.hostId !== manifest.hostId) {
          throw new Error('The bundled host installation has a different identity.');
        }
        try {
          fs.renameSync(path.join(stage, 'dspatch-host'), target);
        } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
            throw error;
          }
        }
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    }
    return {
      runtime: process.platform === 'win32' ? path.join(target, 'node', 'node.exe') : path.join(target, 'node', 'bin', 'node'),
      entry: path.join(target, 'app', 'dist', 'host', 'remote-host.js'),
      electron: false,
    };
  }
  if (options.packaged) {
    throw new Error('This DSpatch installation is missing its bundled standalone host. Reinstall DSpatch and try again.');
  }
  return { runtime: process.execPath, entry: path.join(options.appPath, 'dist', 'host', 'remote-host.js'), electron: process.versions['electron'] !== undefined };
}

/**
 * The command line that starts the host on Windows without this process's handles (DSP-165.1), or
 * `null` when an argument cannot be quoted for `cmd` safely, in which case the host is spawned as
 * on other systems.
 *
 * A process spawned from here inherits every inheritable handle this one holds: Node starts
 * children on Windows with handle inheritance on, and Chromium's DevTools socket is inheritable.
 * So a host started by a client with a debugging port held that port for its whole life, long
 * after the client had ended. `Start-Process` goes through ShellExecute, which passes the new
 * process none of the caller's handles, and keeps the caller's environment; `cmd` writes the
 * host's output to its log as the redirection of `spawn` does. The host then outlives the client
 * with nothing of it but its environment.
 */
export function windowsHostStart(runtime: string, args: readonly string[], logFile: string, cwd: string): string | null {
  const parts = [runtime, ...args, logFile, cwd];
  if (parts.some((part) => /["%\r\n]/.test(part))) {
    return null;
  }
  const quoted = [runtime, ...args].map((part) => `"${part}"`).join(' ');
  const line = `/d /s /c "${quoted} >> "${logFile}" 2>&1"`;
  const literal = (text: string): string => `'${text.replaceAll("'", "''")}'`;
  return `(Start-Process -FilePath $env:ComSpec -ArgumentList ${literal(line)} -WorkingDirectory ${literal(cwd)} -WindowStyle Hidden -PassThru).Id`;
}

/** How long a host started through the shell may be gone with no claim before it counts as failed. */
const ENDED_HOST_GRACE_MS = 3_000;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function ensureLocalHost(options: LocalHostOptions): Promise<RemoteEndpoint> {
  const running = runningLocalHost(options.dataDir);
  if (running !== null) {
    return running.endpoint;
  }
  const owner = heldClaim(options.dataDir);
  if (owner?.kind === 'desktop') {
    throw new Error(claimRefusal(owner));
  }
  let exited: string | null = null;
  /** On Windows, the `cmd` that runs the host and lives as long as it does. */
  let startedPid: number | null = null;
  /** What this start told its host, so the host that becomes ready can be known as this one. */
  const startToken = randomBytes(8).toString('hex');
  if (owner === null) {
    const program = await localProgram(options);
    const env = { ...(options.env ?? process.env) };
    if (program.electron) {
      env['ELECTRON_RUN_AS_NODE'] = '1';
    } else {
      delete env['ELECTRON_RUN_AS_NODE'];
    }
    if (env['DSPATCH_TRIAL_HOST_RUN'] !== undefined) {
      env['DSPATCH_CHAT_RUN'] = env['DSPATCH_TRIAL_HOST_RUN'];
    }
    env['DSPATCH_HOST_START_TOKEN'] = startToken;
    fs.mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const logFile = path.join(options.dataDir, 'host.log');
    const args = [program.entry, '--data', options.dataDir, '--older-data', options.olderDataDir ?? olderHostDataDir(process.platform, env), '--port', '0'];
    const viaShell = process.platform === 'win32' ? windowsHostStart(program.runtime, args, logFile, path.dirname(program.entry)) : null;
    if (viaShell !== null) {
      const encoded = Buffer.from(viaShell, 'utf16le').toString('base64');
      const started = await extract('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env, timeout: 30_000, windowsHide: true });
      startedPid = Number(started.stdout.trim()) || null;
    } else {
      const output = fs.openSync(logFile, 'a', 0o600);
      try {
        const child = spawn(program.runtime, args, {
          cwd: path.dirname(program.entry),
          env,
          detached: true,
          stdio: ['ignore', output, output],
          windowsHide: true,
        });
        child.once('error', (error) => { exited = error.message; });
        child.once('exit', (code) => {
          // 3 is a host that found the folder claimed: another starter won, and its host is the one
          // to wait for. Any other ending of this one is a failure to start (DSP-164).
          if (code !== 3) {
            exited = `Host exited with code ${String(code)}. See ${logFile}.`;
          }
        });
        child.unref();
      } finally {
        fs.closeSync(output);
      }
    }
  }
  const deadline = Date.now() + options.startTimeoutMs;
  let endedAt: number | null = null;
  while (Date.now() < deadline) {
    const ready = runningLocalHost(options.dataDir);
    if (ready !== null) {
      // Another starter's host won. This start's own host, still on its way through the shell,
      // finds the folder taken and ends; until it has, it could take the folder from a winner
      // that ended meanwhile, so this start waits for it, within the same bound (DSP-165.1).
      while (startedPid !== null && ready.startedBy !== startToken && processAlive(startedPid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return ready.endpoint;
    }
    if (exited !== null) {
      throw new Error(exited);
    }
    const holder = heldClaim(options.dataDir);
    // Started through the shell there is no exit code to read. A host gone before it was ready
    // either failed or found the folder being taken by another starter's host, whose claim may
    // not be written yet: a host that is neither ready nor claimed a little later failed.
    if (startedPid !== null && !processAlive(startedPid) && holder === null) {
      endedAt ??= Date.now();
      if (Date.now() - endedAt > ENDED_HOST_GRACE_MS) {
        throw new Error(`The host ended before it was ready. See ${path.join(options.dataDir, 'host.log')}.`);
      }
    }
    if (holder?.kind === 'desktop') {
      throw new Error(claimRefusal(holder));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The standalone host did not become ready. See ${path.join(options.dataDir, 'host.log')}. Try again to attach; no work was sent.`);
}