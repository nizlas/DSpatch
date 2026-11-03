import { execFile, spawn, type ChildProcess } from 'node:child_process';
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
 * How to start the host on Windows without this process's handles (DSP-165.1): a PowerShell
 * script and the environment it runs with.
 *
 * A process spawned from here inherits every inheritable handle this one holds: Node starts
 * children on Windows with handle inheritance on, and Chromium's DevTools socket is inheritable.
 * So a host started by a client with a debugging port held that port for its whole life, long
 * after the client had ended. `Start-Process` goes through ShellExecute, which passes the new
 * process none of the caller's handles, and keeps the caller's environment; `cmd` writes the
 * host's output to its log as the redirection of `spawn` does. The host then outlives the client
 * with nothing of it but its environment.
 *
 * **Every path and argument is data.** None is written into the script or the command line: each
 * goes in an environment variable, and the command line names the variables. `cmd` expands a
 * variable once and does not read what it expanded to again, so `%`, `&`, `^`, `!`, `'`, brackets
 * and spaces in a folder's name stay that name (`/v:off` keeps `!` from a second expansion even
 * where the registry turns it on). An argument is escaped for the program's own reading of its
 * command line: backslashes before the closing quote are doubled. A value with a double quote, NUL
 * or line break cannot be passed this way and is refused; none is a valid Windows path.
 */
export function windowsHostStart(
  runtime: string,
  args: readonly string[],
  logFile: string,
  cwd: string,
): { readonly script: string; readonly env: Readonly<Record<string, string>> } {
  for (const value of [runtime, ...args, logFile, cwd]) {
    if (/["\0\r\n]/.test(value)) {
      throw new Error(`The host cannot be started with ${JSON.stringify(value)}: a Windows path cannot hold a double quote or a line break.`);
    }
  }
  const env: Record<string, string> = {
    DSPATCH_HOST_RUNTIME: runtime,
    DSPATCH_HOST_CWD: cwd,
    DSPATCH_HOST_LOG: logFile,
  };
  // Inside quotes a program reads `\"` as a quote; a trailing backslash is doubled so it stays one.
  args.forEach((arg, index) => {
    env[`DSPATCH_HOST_ARG${String(index)}`] = arg.replace(/(\\+)$/, '$1$1');
  });
  const program = ['"%DSPATCH_HOST_RUNTIME%"', ...args.map((_, index) => `"%DSPATCH_HOST_ARG${String(index)}%"`)].join(' ');
  env['DSPATCH_HOST_COMMAND'] = `/d /v:off /s /c "cd /d "%DSPATCH_HOST_CWD%" && ${program} >> "%DSPATCH_HOST_LOG%" 2>&1"`;
  return {
    script: '(Start-Process -FilePath $env:ComSpec -ArgumentList $env:DSPATCH_HOST_COMMAND -WindowStyle Hidden -PassThru).Id',
    env,
  };
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

/** How long a stopped start is waited for before its failure is reported. */
const STOP_START_BOUND_MS = 5_000;

/**
 * Stop the host this start began, and the `cmd` that runs it on Windows, and wait until they have
 * ended. `true` when there was something of this start's to stop.
 */
async function stopOwnStart(startedPid: number | null, startedChild: ChildProcess | null): Promise<boolean> {
  let pid: number | null = null;
  if (startedPid !== null && processAlive(startedPid)) {
    pid = startedPid;
    // The tree: cmd and the host it runs. A host that had already ended leaves nothing to stop.
    await extract('taskkill', ['/PID', String(startedPid), '/T', '/F'], { timeout: STOP_START_BOUND_MS, windowsHide: true }).catch(() => undefined);
  } else if (startedChild !== null && startedChild.exitCode === null && startedChild.signalCode === null && startedChild.pid !== undefined) {
    pid = startedChild.pid;
    startedChild.kill('SIGKILL');
  }
  if (pid === null) {
    return false;
  }
  const until = Date.now() + STOP_START_BOUND_MS;
  while (processAlive(pid) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
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
  /** Elsewhere, the host process this start spawned. */
  let startedChild: ChildProcess | null = null;
  /** On Windows, where this start's cmd writes what the host prints before its own log is open. */
  let startLog: string | null = null;
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
    if (process.platform === 'win32') {
      // The host writes host.log itself (`--log`): cmd's `>>` cannot share a file with another
      // start's cmd. What cmd catches, such as a crash before the host's own logging, goes to a
      // file of this start's own; earlier ones are cleared where nothing holds them any more.
      for (const old of fs.readdirSync(options.dataDir).filter((name) => /^host-start-[a-f0-9]{16}\.log$/.test(name))) {
        try {
          fs.rmSync(path.join(options.dataDir, old));
        } catch {
          // Still held by a running start.
        }
      }
      startLog = path.join(options.dataDir, `host-start-${startToken}.log`);
      const start = windowsHostStart(program.runtime, [...args, '--log', logFile], startLog, path.dirname(program.entry));
      const encoded = Buffer.from(start.script, 'utf16le').toString('base64');
      const started = await extract('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { env: { ...env, ...start.env }, timeout: 30_000, windowsHide: true });
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
        startedChild = child;
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
        throw new Error(`The host ended before it was ready. See ${startLog ?? path.join(options.dataDir, 'host.log')} and ${path.join(options.dataDir, 'host.log')}.`);
      }
    }
    if (holder?.kind === 'desktop') {
      throw new Error(claimRefusal(holder));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // DSP-165.1: a host still on its way when the bound passes would take the folder after this
  // start had been reported as failed, with nobody attached to it. So this start's own host is
  // stopped and waited for before the failure is reported; another starter's is left alone.
  const stopped = await stopOwnStart(startedPid, startedChild);
  const late = runningLocalHost(options.dataDir);
  if (late !== null) {
    return late.endpoint;
  }
  throw new Error(
    `The standalone host did not become ready within ${String(Math.round(options.startTimeoutMs / 1000))} s` +
      `${stopped ? ', so that start was stopped' : ''}. See ${path.join(options.dataDir, 'host.log')}. Try again to attach; no work was sent.`,
  );
}