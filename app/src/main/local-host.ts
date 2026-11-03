import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { HostRunning } from '../shared/host-bootstrap';
import type { RemoteEndpoint } from './remote-link';
import { claimRefusal, heldClaim, olderHostDataDir } from './host-data';
import { readHostManifest } from './host-packages';

const extract = promisify(execFile);

export function runningLocalHost(dataDir: string): { readonly endpoint: RemoteEndpoint; readonly pid: number } | null {
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
    return { endpoint: { host: '127.0.0.1', port: running.port, token }, pid: running.pid };
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
    fs.mkdirSync(options.dataDir, { recursive: true, mode: 0o700 });
    const output = fs.openSync(path.join(options.dataDir, 'host.log'), 'a', 0o600);
    try {
      const child = spawn(program.runtime, [program.entry, '--data', options.dataDir, '--older-data', options.olderDataDir ?? olderHostDataDir(process.platform, env), '--port', '0'], {
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
          exited = `Host exited with code ${String(code)}. See ${path.join(options.dataDir, 'host.log')}.`;
        }
      });
      child.unref();
    } finally {
      fs.closeSync(output);
    }
  }
  const deadline = Date.now() + options.startTimeoutMs;
  while (Date.now() < deadline) {
    const ready = runningLocalHost(options.dataDir);
    if (ready !== null) {
      return ready.endpoint;
    }
    if (exited !== null) {
      throw new Error(exited);
    }
    const holder = heldClaim(options.dataDir);
    if (holder?.kind === 'desktop') {
      throw new Error(claimRefusal(holder));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The standalone host did not become ready. See ${path.join(options.dataDir, 'host.log')}. Try again to attach; no work was sent.`);
}