import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  IDENTIFY,
  IDENTIFY_WINDOWS,
  credentials,
  handover,
  install,
  packagePlatform,
  probe,
  readLines,
  receive,
  start,
  stop,
  type HostRunning,
  type RemoteOs,
  type RemoteStep,
} from '../shared/host-bootstrap';
import type { RemoteBuild } from '../shared/remote-protocol';
import { handoverNonce, type HandoverAnswer } from './host-data';
import type { HostPackage } from './host-packages';
import type { RemoteEndpoint } from './remote-link';

/*
 * `Connect` to user@machine (DSP-153): the system's OpenSSH, so the person's config and aliases,
 * agent, keys and known_hosts all apply as they do in a terminal, and host-key checking stays
 * OpenSSH's own (`StrictHostKeyChecking=ask`): an unknown key is asked about with its fingerprint
 * through `SSH_ASKPASS`, and a changed key makes ssh refuse. Passwords go from the person to ssh
 * through the same route. They stay in this object's memory for the reconnects of this session,
 * are written nowhere and are gone on `close`.
 *
 * On POSIX clients one master connection carries everything, so one sign-in is enough and the
 * master's life is the tunnel's. Windows' ssh has no multiplexing: there each step is its own
 * connection, and the remembered password answers the repeats.
 *
 * What a connection loses is the link, never work: see `RemoteLink`, which is what talks to the
 * host. This class only keeps a local port leading to it.
 */

export interface SshPrompt {
  readonly kind: 'secret' | 'confirm';
  readonly text: string;
}

export interface SshConnectionOptions {
  readonly target: string;
  readonly build: RemoteBuild;
  readonly log: (message: string) => void;
  readonly status: (text: string) => void;
  readonly ask: (prompt: SshPrompt) => Promise<string | null>;
  /** The package for a platform, fetched and checked, or a sentence why there is none. */
  readonly packageFor: (platform: string, arch: string) => Promise<HostPackage | string>;
  /** The launcher ssh runs to ask a question, in this process's own runtime. */
  readonly askpassScript: string;
  readonly nodeRunner: string;
  /** For tests in an isolated environment: `ssh -F`. */
  readonly configFile?: string;
  readonly sshProgram?: string;
  /** The tunnel fell and could not be raised again, for a reason retrying will not change. */
  readonly onBroken?: (message: string) => void;
}

/** A sentence for what ssh said, or the last line of it. */
export function sshProblem(target: string, stderr: string): string {
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed|host key .*changed/i.test(stderr)) {
    return /CHANGED/.test(stderr)
      ? `The host key of ${target} has changed since it was last seen, so nothing was sent. If the machine was reinstalled, remove the old key from known_hosts yourself; otherwise this may be someone else answering.`
      : `The host key of ${target} was not accepted, so nothing was sent.`;
  }
  if (/Permission denied/i.test(stderr)) {
    return `${target} refused the sign-in. Check the user name, and your key or password.`;
  }
  if (/Could not resolve hostname|Name or service not known/i.test(stderr)) {
    return `No machine called ${target} could be found. Check the name.`;
  }
  if (/Connection refused/i.test(stderr)) {
    return `${target} refused the connection: no SSH server answers there.`;
  }
  if (/timed out|No route to host|Network is unreachable/i.test(stderr)) {
    return `${target} could not be reached. Check the network and the name.`;
  }
  const last = stderr.trim().split(/\r?\n/).at(-1) ?? '';
  return last === '' ? `The connection to ${target} ended.` : `The connection to ${target} ended: ${last}`;
}

/** A destination for `ssh`, which must not be readable as an option of it. */
export function validTarget(text: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._%+@:\[\]-]*$/.test(text);
}

const POSIX_CLIENT = process.platform !== 'win32';

export function installedHostToStart(
  build: RemoteBuild,
  facts: ReadonlyMap<string, readonly string[]>,
  allowCompatible = true,
): string | null {
  const compatible: { hostId: string; appVersion: string }[] = [];
  for (const text of facts.get('installed') ?? []) {
    try {
      const installed = JSON.parse(text) as Record<string, unknown>;
      const hostId = installed['hostId'];
      const appVersion = installed['appVersion'];
      const commit = installed['commit'];
      if (
        typeof hostId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(hostId) || hostId.includes('..') ||
        typeof appVersion !== 'string' || typeof commit !== 'string' ||
        hostId !== `${appVersion}-${commit}` || !(facts.get('version') ?? []).includes(hostId) ||
        installed['protocol'] !== build.protocol || installed['contract'] !== build.contract
      ) {
        continue;
      }
      compatible.push({ hostId, appVersion });
    } catch {
      continue;
    }
  }
  const exact = `${build.appVersion}-${build.commit}`;
  if (compatible.some((installed) => installed.hostId === exact)) {
    return exact;
  }
  if (!allowCompatible) {
    return null;
  }
  compatible.sort((left, right) =>
    Number(right.appVersion === build.appVersion) - Number(left.appVersion === build.appVersion) ||
    left.hostId.localeCompare(right.hostId),
  );
  return compatible[0]?.hostId ?? null;
}

export class SshConnection {
  private readonly options: SshConnectionOptions;

  private readonly runtime: string;

  private readonly controlPath: string;

  private readonly nonce = randomBytes(24).toString('hex');

  private askServer: net.Server | null = null;

  private askAddress = '';

  private remembered = new Map<string, string>();

  private master: ChildProcess | null = null;

  private tunnel: ChildProcess | null = null;

  private closed = false;

  private localPort = 0;

  private remotePort = 0;

  private remoteOs: RemoteOs = 'posix';

  private repairing = false;

  /** The master that holds the forward, so a new master is known to need one. */
  private forwardedOn: ChildProcess | null = null;

  constructor(options: SshConnectionOptions) {
    this.options = options;
    this.runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-ssh-'));
    this.controlPath = path.join(this.runtime, 'c');
  }

  private environment(): NodeJS.ProcessEnv {
    const { ELECTRON_RUN_AS_NODE: _ignored, ...rest } = process.env;
    return {
      ...rest,
      SSH_ASKPASS: this.askpassLauncher(),
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env['DISPLAY'] ?? 'dspatch:0',
      ELECTRON_RUN_AS_NODE: '1',
      DSPATCH_ASKPASS_ELECTRON: process.execPath,
      DSPATCH_ASKPASS_JS: this.options.askpassScript,
      DSPATCH_ASKPASS_SOCKET: this.askAddress,
      DSPATCH_ASKPASS_NONCE: this.nonce,
    };
  }

  private askpassLauncher(): string {
    const file = path.join(this.runtime, POSIX_CLIENT ? 'askpass.sh' : 'askpass.cmd');
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        POSIX_CLIENT
          ? '#!/bin/sh\nexec "$DSPATCH_ASKPASS_ELECTRON" "$DSPATCH_ASKPASS_JS" "$@"\n'
          : '@"%DSPATCH_ASKPASS_ELECTRON%" "%DSPATCH_ASKPASS_JS%" %*\r\n',
        { mode: 0o700 },
      );
    }
    return file;
  }

  private listenForQuestions(): Promise<void> {
    this.askAddress = POSIX_CLIENT ? path.join(this.runtime, 'a') : `\\\\.\\pipe\\dspatch-${randomBytes(12).toString('hex')}`;
    const server = net.createServer((socket) => {
      let text = '';
      socket.on('error', () => undefined);
      socket.on('data', (chunk) => {
        text += chunk.toString('utf8');
        if (!text.includes('\n')) {
          return;
        }
        const asked = JSON.parse(text) as { nonce?: string; prompt?: string };
        if (asked.nonce !== this.nonce) {
          socket.destroy();
          return;
        }
        void this.answer(asked.prompt ?? '').then((answer) => {
          socket.end(JSON.stringify({ answer }));
        });
      });
    });
    this.askServer = server;
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.askAddress, resolve);
    });
  }

  /** ssh's question. Its text says which: yes/no with a fingerprint, or a secret. */
  private async answer(prompt: string): Promise<string | null> {
    if (/\(yes\/no/i.test(prompt)) {
      const answer = await this.options.ask({ kind: 'confirm', text: prompt });
      return answer === 'yes' ? 'yes' : 'no';
    }
    const known = this.remembered.get(prompt);
    if (known !== undefined) {
      return known;
    }
    const answer = await this.options.ask({ kind: 'secret', text: prompt });
    if (answer !== null && /password/i.test(prompt)) {
      this.remembered.set(prompt, answer);
    }
    return answer;
  }

  private args(extra: readonly string[], forwarding = false): string[] {
    return [
      ...(this.options.configFile === undefined ? [] : ['-F', this.options.configFile]),
      '-T',
      '-o',
      'StrictHostKeyChecking=ask',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      // What a host block written for a terminal or a hand-made tunnel adds: not for these
      // connections. A `LocalForward` on a port in use would otherwise stop the sign-in itself,
      // `ControlPersist` would send the master to the background, `RemoteCommand` refuses a command.
      ...(forwarding ? [] : ['-o', 'ClearAllForwardings=yes']),
      '-o',
      'RemoteCommand=none',
      '-o',
      'RequestTTY=no',
      ...(POSIX_CLIENT ? ['-o', `ControlPath=${this.controlPath}`, '-o', 'ControlPersist=no'] : []),
      ...extra,
    ];
  }

  private program(): string {
    return this.options.sshProgram ?? 'ssh';
  }

  private spawnSsh(args: readonly string[]): ChildProcess {
    // Detached: no controlling terminal, so ssh can only ask through askpass.
    return spawn(this.program(), [...args], { env: this.environment(), stdio: ['pipe', 'pipe', 'pipe'], detached: POSIX_CLIENT, windowsHide: true });
  }

  /** Run one step on the machine. */
  private exec(step: RemoteStep, input?: fs.ReadStream, sent?: (bytes: number) => void): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawnSsh(this.args([...(POSIX_CLIENT ? ['-o', 'ControlMaster=no'] : []), '--', this.options.target, step.command]));
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        reject(new Error(error.code === 'ENOENT' ? 'No SSH client was found on this computer. Install OpenSSH and try again.' : error.message));
      });
      child.stdin?.on('error', () => undefined);
      if (input !== undefined) {
        input.on('data', (chunk) => {
          sent?.(chunk.length);
        });
        input.pipe(child.stdin as NodeJS.WritableStream);
      } else {
        child.stdin?.end(step.stdin ?? '');
      }
      child.on('close', (code) => {
        resolve({ code, stdout, stderr });
      });
    });
  }

  private async must(step: RemoteStep): Promise<ReadonlyMap<string, readonly string[]>> {
    const result = await this.exec(step);
    if (result.code === 255) {
      throw new Error(sshProblem(this.options.target, result.stderr));
    }
    return readLines(result.stdout);
  }

  /** The master connection, signed in. Its end is the tunnel's end. */
  private openMaster(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnSsh(this.args(['-M', '-N', '-o', 'ControlMaster=yes', '-o', 'ExitOnForwardFailure=yes', '--', this.options.target]));
      this.master = child;
      child.stdin?.end();
      let stderr = '';
      let open = false;
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
        reject(new Error(error.code === 'ENOENT' ? 'No SSH client was found on this computer. Install OpenSSH and try again.' : error.message));
      });
      child.on('exit', () => {
        if (this.master === child) {
          this.master = null;
        }
        if (!open) {
          reject(new Error(sshProblem(this.options.target, stderr)));
        } else if (!this.closed) {
          this.options.log('the SSH connection ended; raising it again');
          void this.repair();
        }
      });
      const check = (): void => {
        if (this.master !== child) {
          return;
        }
        const checking = this.spawnSsh(this.args(['-O', 'check', '--', this.options.target]));
        checking.on('close', (code) => {
          if (code === 0) {
            open = true;
            resolve();
          } else {
            setTimeout(check, 200);
          }
        });
      };
      check();
    });
  }

  private freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => {
          resolve(typeof address === 'object' && address !== null ? address.port : 0);
        });
      });
    });
  }

  private forward(): Promise<void> {
    const spec = `127.0.0.1:${String(this.localPort)}:127.0.0.1:${String(this.remotePort)}`;
    if (POSIX_CLIENT) {
      return new Promise((resolve, reject) => {
        const child = this.spawnSsh(this.args(['-O', 'forward', '-L', spec, '--', this.options.target], true));
        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('close', (code) => {
          if (code === 0) {
            this.forwardedOn = this.master;
            resolve();
          } else {
            reject(new Error(`The tunnel could not be opened: ${stderr.trim()}`));
          }
        });
      });
    }
    return new Promise((resolve, reject) => {
      const child = this.spawnSsh(this.args(['-N', '-o', 'ExitOnForwardFailure=yes', '-L', spec, '--', this.options.target], true));
      this.tunnel = child;
      child.stdin?.end();
      let stderr = '';
      let open = false;
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('exit', () => {
        if (this.tunnel === child) {
          this.tunnel = null;
        }
        if (!open) {
          reject(new Error(sshProblem(this.options.target, stderr)));
        } else if (!this.closed) {
          void this.repair();
        }
      });
      const look = (): void => {
        if (this.tunnel !== child) {
          return;
        }
        const socket = net.connect(this.localPort, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          open = true;
          resolve();
        });
        socket.once('error', () => {
          setTimeout(look, 200);
        });
      };
      look();
    });
  }

  /** A record DSpatch can act on: a process id, a port, and an identity of the expected form. */
  private parseRunning(line: string | undefined): HostRunning | null {
    try {
      const running = line === undefined ? null : (JSON.parse(line) as HostRunning);
      const sound =
        running !== null &&
        Number.isInteger(running.pid) &&
        running.pid > 0 &&
        Number.isInteger(running.port) &&
        (running.identity === undefined || (typeof running.identity === 'string' && /^[A-Za-z0-9:._-]*$/.test(running.identity)));
      return sound ? running : null;
    } catch {
      return null;
    }
  }

  private async identify(): Promise<{ readonly os: RemoteOs; readonly platform: string; readonly arch: string }> {
    const first = await this.exec(IDENTIFY);
    if (first.code === 255) {
      throw new Error(sshProblem(this.options.target, first.stderr));
    }
    const text = first.code === 0 ? first.stdout : (await this.exec(IDENTIFY_WINDOWS)).stdout;
    const known = packagePlatform(text);
    if (known === null) {
      throw new Error(`${this.options.target} is ${text.trim() || 'a system DSpatch could not identify'}. A host is built for Linux x64 and Windows x64 only.`);
    }
    return known;
  }

  private async putInPlace(platform: string, arch: string): Promise<void> {
    const found = await this.options.packageFor(platform, arch);
    if (typeof found === 'string') {
      throw new Error(found);
    }
    this.options.status('Installing host…');
    const size = fs.statSync(found.path).size;
    let sent = 0;
    let shown = -1;
    const stream = fs.createReadStream(found.path);
    const received = await this.exec(receive(this.remoteOs, found.file), stream, (bytes) => {
      sent += bytes;
      const percent = Math.floor((sent / size) * 10) * 10;
      if (percent !== shown) {
        shown = percent;
        this.options.status(`Installing host… ${String(percent)} %`);
      }
    });
    if (received.code !== 0) {
      throw new Error(`The host package could not be sent to ${this.options.target}: ${received.stderr.trim().split('\n').at(-1) ?? 'the connection ended'}. Nothing was changed there; try again.`);
    }
    const done = await this.must(install(this.remoteOs, found.file, found.sha256, found.hostId));
    const failed = done.get('failed')?.[0];
    if (failed !== undefined || done.get('installed') === undefined) {
      const words: Record<string, string> = {
        checksum: 'What arrived does not match the package this build expects',
        unpack: 'The package could not be unpacked there (is the disk full?)',
        runtime: "The host's own Node runtime does not run there, which on Linux usually means a C library older than it needs",
      };
      throw new Error(`${words[failed ?? ''] ?? 'The host could not be installed'}. A working version there was left as it was; try again.`);
    }
    this.options.log(`host ${found.hostId} installed on ${this.options.target}`);
  }

  /** Make sure a host we can use runs there, and return where. */
  private async ensureHost(interactive: boolean): Promise<{ readonly running: HostRunning; readonly token: string }> {
    const machine = await this.identify();
    this.remoteOs = machine.os;
    const facts = await this.must(probe(machine.os));
    let replacing = false;
    let running = this.parseRunning(facts.get('running')?.[0]);
    if (running === null && (facts.get('hostpids')?.[0] ?? '').trim() !== '') {
      throw new Error(`A DSpatch host started by hand is running on ${this.options.target}, without saying where it listens. Stop it there, or use the address and token under Advanced.`);
    }
    if (running !== null && running.commit !== this.options.build.commit) {
      const usable = running.protocol === this.options.build.protocol && running.contract === this.options.build.contract;
      if (!interactive) {
        if (!usable) {
          throw new Error(`The host on ${this.options.target} is another version now. Connect again to decide what to do.`);
        }
      } else {
        const answer = await this.options.ask({
          kind: 'confirm',
          text: `The host on ${this.options.target} is version ${running.appVersion} (${running.commit}); this DSpatch is ${this.options.build.appVersion} (${this.options.build.commit}). Replace it? Work running there would stop, and its outcome would be unknown.${usable ? ' Choosing No keeps using it as it is.' : ' They cannot work together, so choosing No stops here.'}`,
        });
        if (answer === 'yes') {
          replacing = true;
          this.options.status('Stopping the old host…');
          const stopped = await this.must(stop(machine.os, running));
          if (stopped.get('failed')?.[0] === 'unverified') {
            throw new Error(`The process the old host on ${this.options.target} named could not be confirmed as that host, so nothing was stopped. Stop the host there by hand and connect again.`);
          }
          if (stopped.get('stopped') === undefined) {
            throw new Error(`The old host on ${this.options.target} did not stop. Nothing else was changed.`);
          }
          running = null;
        } else if (!usable) {
          throw new Error(`The host on ${this.options.target} was left running, and this DSpatch cannot work with it.`);
        }
      }
    }
    if (running === null && facts.get('desktop') !== undefined) {
      await this.askToHandOver(machine.os, interactive);
    }
    if (running === null) {
      const installed = installedHostToStart(this.options.build, facts, !replacing);
      const hostId = installed ?? `${this.options.build.appVersion}-${this.options.build.commit}`;
      if (installed === null) {
        const missing = facts.get('missing');
        if (missing !== undefined) {
          throw new Error(`${this.options.target} is missing ${missing.join(' and ')}, which installing a host needs. Install it there and try again.`);
        }
        await this.putInPlace(machine.platform, machine.arch);
      }
      this.options.status(installed !== null && hostId !== `${this.options.build.appVersion}-${this.options.build.commit}`
        ? `Starting compatible host ${hostId}...`
        : 'Starting host…');
      this.options.log(`starting host ${hostId} on ${this.options.target}`);
      const started = await this.must(start(machine.os, hostId));
      if (started.get('started') === undefined) {
        throw new Error(`The host did not start on ${this.options.target}. ${(started.get('log') ?? []).join(' ')}`.trim());
      }
    }
    const held = await this.must(credentials(machine.os));
    const now = this.parseRunning(held.get('running')?.[0]);
    const token = held.get('token')?.[0];
    if (now === null || token === undefined || token === '') {
      throw new Error(`The host on ${this.options.target} did not say where it listens.`);
    }
    return { running: now, token };
  }

  /** DSpatch is open on the machine, so its host owns the data until it lets go (DSP-161). */
  private async askToHandOver(os: RemoteOs, interactive: boolean): Promise<void> {
    const { target } = this.options;
    if (!interactive) {
      throw new Error(`DSpatch is in use on ${target} again, so this connection has stopped.`);
    }
    const answer = await this.options.ask({
      kind: 'confirm',
      text: `DSpatch is open on ${target}. Continue here with the same projects and conversations? It then stops working in that window until someone chooses to use it there again. Running work is not interrupted: if any is running, you will be told and nothing changes.`,
    });
    if (answer !== 'yes') {
      throw new Error(`DSpatch stayed open on ${target}, and nothing was changed there.`);
    }
    this.options.status('Asking DSpatch there to hand over…');
    const nonce = handoverNonce();
    const heard = await this.must(handover(os, nonce));
    let said: HandoverAnswer | null = null;
    try {
      said = JSON.parse(heard.get('answer')?.[0] ?? '') as HandoverAnswer;
    } catch {
      // No answer in time.
    }
    if (said === null || said.nonce !== nonce) {
      throw new Error(`DSpatch on ${target} did not answer, so nothing was changed there. If it has stopped responding, close it there and connect again.`);
    }
    if (said.answer === 'busy') {
      throw new Error(`DSpatch on ${target} is busy, and nothing was interrupted: ${said.detail} Connect again when it is done.`);
    }
  }

  /** Sign in, make sure a host runs and open the tunnel. Throws a sentence. */
  async connect(): Promise<RemoteEndpoint> {
    this.options.status('Connecting…');
    await this.listenForQuestions();
    if (POSIX_CLIENT) {
      try {
        await this.openMaster();
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : String(error)}${await this.whereItWent()}`);
      }
    }
    const { running, token } = await this.ensureHost(true);
    this.options.status('Opening the tunnel…');
    this.remotePort = running.port;
    this.localPort = await this.freePort();
    await this.forward();
    return { host: '127.0.0.1', port: this.localPort, token };
  }

  /**
   * The connection fell, or the link says the host stopped answering. Raise what is missing, on
   * the same local port so the link needs nothing new. A host that restarted is told apart by
   * `RemoteLink`, which also answers for what that means for work; nothing is sent again here.
   */
  async repair(): Promise<void> {
    if (this.repairing || this.closed) {
      return;
    }
    this.repairing = true;
    try {
      for (let attempt = 0; !this.closed; attempt += 1) {
        try {
          if (POSIX_CLIENT && this.master === null) {
            await this.openMaster();
          }
          const { running } = await this.ensureHost(false);
          await this.lead(running.port);
          this.options.log('the SSH connection is back');
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/refused the sign-in|host key|another version|in use on/i.test(message)) {
            this.options.onBroken?.(message);
            return;
          }
          this.options.log(`the SSH connection is not back yet: ${message}`);
          await new Promise((resolve) => setTimeout(resolve, Math.min(15_000, 1_000 * 2 ** attempt)));
        }
      }
    } finally {
      this.repairing = false;
    }
  }

  /** What the system's ssh made of the name, so an alias that went astray can be seen. */
  private whereItWent(): Promise<string> {
    return new Promise((resolve) => {
      const child = this.spawnSsh([...(this.options.configFile === undefined ? [] : ['-F', this.options.configFile]), '-G', '--', this.options.target]);
      let text = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8');
      });
      child.on('error', () => {
        resolve('');
      });
      child.on('close', () => {
        const value = (key: string): string | undefined => new RegExp(`^${key} (.+)$`, 'm').exec(text)?.[1];
        const user = value('user');
        const name = value('hostname');
        resolve(user === undefined || name === undefined ? '' : ` This was as ${user} on ${name}, port ${value('port') ?? '22'}.`);
      });
    });
  }

  /** Keep the local port and lead it to where the host listens now. */
  private async lead(port: number): Promise<void> {
    if (POSIX_CLIENT) {
      const master = this.forwardedOn === this.master && this.master !== null;
      if (master && port === this.remotePort) {
        return;
      }
      if (master) {
        await this.cancelForward();
      }
    } else {
      if (this.tunnel !== null && port === this.remotePort) {
        return;
      }
      this.tunnel?.kill();
    }
    this.remotePort = port;
    await this.forward();
  }

  private cancelForward(): Promise<void> {
    const spec = `127.0.0.1:${String(this.localPort)}:127.0.0.1:${String(this.remotePort)}`;
    return new Promise((resolve) => {
      this.spawnSsh(this.args(['-O', 'cancel', '-L', spec, '--', this.options.target], true)).on('close', () => {
        resolve();
      });
    });
  }

  /** End this client's connection and tunnel. The host and its work go on. */
  close(): void {
    this.closed = true;
    this.remembered.clear();
    this.master?.kill();
    this.tunnel?.kill();
    this.askServer?.close();
    fs.rmSync(this.runtime, { recursive: true, force: true });
  }
}
