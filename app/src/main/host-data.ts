import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * One work context per user of a machine (DSP-161). The desktop application and a host started
 * over SSH use one data folder, the application's own, so a machine used locally is the same
 * machine when reached from another one. Two things follow from sharing it:
 *
 * - **One host writes at a time.** A host claims the folder before it reads anything, and a second
 *   one is refused. The claim names the owner, so a client can tell an open application, which has
 *   to hand over, from a host that stays running and can simply be attached to.
 * - **A host that once kept its data apart is adopted**, not abandoned: see `adoptOlderData`.
 *
 * No Electron here. `sharedDataDir` has to name by itself the folder Electron calls `userData`,
 * because a host started over SSH has no Electron to ask.
 */

export type HostKind = 'desktop' | 'standalone';

export interface HostClaim {
  readonly pid: number;
  readonly kind: HostKind;
  readonly startedAtUtc: string;
  /**
   * What makes a process this one and no other, where the system says: on Linux the boot and the
   * process's start, so a reused id is no claim. Never the clock, which can step under a live host.
   */
  readonly identity: string;
}

const CLAIM_FILE = 'host-claim.json';

/** Electron's `userData` for an application called DSpatch. */
export function sharedDataDir(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    return path.win32.join(env['APPDATA'] ?? path.win32.join(home, 'AppData', 'Roaming'), 'DSpatch');
  }
  return path.posix.join(env['XDG_CONFIG_HOME'] ?? path.posix.join(home, '.config'), 'DSpatch');
}

/** Where a host kept its data before it shared the application's folder. */
export function olderHostDataDir(
  platform: NodeJS.Platform = process.platform,
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = os.homedir(),
): string {
  if (platform === 'win32') {
    return path.win32.join(env['LOCALAPPDATA'] ?? path.win32.join(home, 'AppData', 'Local'), 'dspatch-host');
  }
  return path.posix.join(env['XDG_DATA_HOME'] ?? path.posix.join(home, '.local', 'share'), 'dspatch-host');
}

function processIdentity(pid: number): string {
  try {
    const boot = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    const stat = fs.readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
    // After the command, which can hold anything: the 20th field from there is its start.
    const start = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    return `${boot}:${start ?? ''}`;
  } catch {
    return '';
  }
}

/** Windows has no such reading at hand: a process of another program at that id is no claim. */
function runsAHost(pid: number): boolean {
  if (process.platform !== 'win32') {
    return true;
  }
  try {
    return /node|dspatch/i.test(execFileSync('tasklist', ['/FI', `PID eq ${String(pid)}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true }));
  } catch {
    return true;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function claimHolds(claim: HostClaim): boolean {
  if (!processAlive(claim.pid)) {
    return false;
  }
  return claim.identity === '' ? runsAHost(claim.pid) : claim.identity === processIdentity(claim.pid);
}

/** The claim on a folder, when a live host holds it. */
export function heldClaim(dataDir: string): HostClaim | null {
  try {
    const claim = JSON.parse(fs.readFileSync(path.join(dataDir, CLAIM_FILE), 'utf8')) as HostClaim;
    return typeof claim.pid === 'number' && claimHolds(claim) ? claim : null;
  } catch {
    return null;
  }
}

/**
 * Take the folder for this process, or answer who has it. The file is created exclusively, so of
 * two hosts starting together one gets it; a claim left by a process that is gone is removed first.
 */
export function claimDataFolder(dataDir: string, kind: HostKind): { readonly held: HostClaim } | { readonly release: () => void } {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, CLAIM_FILE);
  const mine: HostClaim = { pid: process.pid, kind, startedAtUtc: new Date().toISOString(), identity: processIdentity(process.pid) };
  const spare = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}`;
  fs.writeFileSync(spare, `${JSON.stringify(mine, null, 2)}\n`, { mode: 0o600 });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // A link appears whole or not at all, so nobody ever reads a half-written claim.
      fs.linkSync(spare, file);
      fs.rmSync(spare, { force: true });
      const release = (): void => {
        const held = heldClaim(dataDir);
        if (held?.pid === process.pid) {
          fs.rmSync(file, { force: true });
        }
      };
      process.on('exit', release);
      return { release };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        fs.rmSync(spare, { force: true });
        throw error;
      }
    }
    const held = heldClaim(dataDir);
    if (held !== null) {
      fs.rmSync(spare, { force: true });
      return { held };
    }
    // Taken aside rather than deleted: if another starter got there first, what was taken is its
    // fresh claim, which goes back.
    const aside = `${file}.gone.${randomBytes(4).toString('hex')}`;
    try {
      fs.renameSync(file, aside);
      const taken = JSON.parse(fs.readFileSync(aside, 'utf8') || '{}') as HostClaim;
      if (typeof taken.pid === 'number' && claimHolds(taken)) {
        fs.linkSync(aside, file);
      }
    } catch {
      // Someone else moved it; the next round finds out.
    }
    fs.rmSync(aside, { force: true });
  }
  fs.rmSync(spare, { force: true });
  throw new Error(`The data folder ${dataDir} could not be claimed.`);
}

/** What a person is told when a folder is taken. */
export function claimRefusal(claim: HostClaim): string {
  return claim.kind === 'desktop'
    ? `DSpatch is open on this computer (process ${String(claim.pid)}) and owns its data. Close it, or connect from DSpatch to hand it over.`
    : `A DSpatch host (process ${String(claim.pid)}) already runs over this data folder.`;
}

/* Handing over from an open application to a host started over SSH. */

const REQUEST_FILE = 'handover-request.json';
const ANSWER_FILE = 'handover-answer.json';

/** How long a request stands before an application that sees it treats it as old. */
const REQUEST_LIFE_MS = 60_000;

export interface HandoverAnswer {
  readonly nonce: string;
  readonly answer: 'released' | 'busy';
  readonly detail: string;
}

/** The request waiting in a folder, if a recent one is. It is taken: it is answered once. */
export function takeHandoverRequest(dataDir: string, now: number = Date.now()): string | null {
  const file = path.join(dataDir, REQUEST_FILE);
  try {
    const stat = fs.statSync(file);
    const nonce = (JSON.parse(fs.readFileSync(file, 'utf8')) as { nonce?: unknown }).nonce;
    fs.rmSync(file, { force: true });
    return typeof nonce === 'string' && now - stat.mtimeMs < REQUEST_LIFE_MS ? nonce : null;
  } catch {
    return null;
  }
}

export function writeHandoverAnswer(dataDir: string, answer: HandoverAnswer): void {
  const file = path.join(dataDir, ANSWER_FILE);
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(answer)}\n`, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

export function handoverNonce(): string {
  return randomBytes(12).toString('hex');
}

/*
 * Adopting a host's older, separate folder. Everything is copied to a backup first, and the older
 * folder is left as it was apart from a marker. Nothing in the shared folder is overwritten: a file
 * that exists on both sides with different content is a conflict, which is never settled by
 * choosing. Both are kept: a conversation arrives under an id of its own so both can be opened; any
 * other record is kept in `adopted-conflicts/`, and the report and the person are told.
 */

/** Folders and files that are DSpatch's own; `userData` also holds Chromium's. */
const OWN_ENTRIES = [
  'conversations',
  'conversation-without-workspace',
  'loop-runs',
  'reviews',
  'dspatch-agent-choice.json',
  'dspatch-model-choice.json',
  'dspatch-projects.json',
  'dspatch-uncertain-work.json',
  'claude-consent.json',
  'copilot-hooks-required',
] as const;

/*
 * `provider-support` is not among them: it is fetched programs, which a person's data is not, and
 * it can be large. A machine fetches it again when it is needed.
 */

/** Files of this name are per-machine state, read by a generated name. */
const LOOP_CHOICE = /^dspatch-.*\.json$/;

const MARKER = 'adopted-into.json';
export const ADOPTION_REPORT = 'adopted-older-data.json';

export interface AdoptionReport {
  readonly adoptedAtUtc: string;
  readonly from: string;
  readonly backup: string;
  readonly copied: number;
  readonly alreadyThere: number;
  readonly conflicts: readonly { readonly record: string; readonly keptAt: string }[];
  /** Whether the person has been told. */
  readonly told: boolean;
}

function filesUnder(root: string, relative = ''): string[] {
  const here = path.join(root, relative);
  const found = fs.lstatSync(here);
  if (!found.isDirectory()) {
    return found.isFile() ? [relative] : [];
  }
  return fs.readdirSync(here).flatMap((name) => filesUnder(root, path.join(relative, name)));
}

function sameBytes(one: string, other: string): boolean {
  return fs.statSync(one).size === fs.statSync(other).size && fs.readFileSync(one).equals(fs.readFileSync(other));
}

function copyWhole(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, `${to}.adopting`);
  fs.renameSync(`${to}.adopting`, to);
}

function ownEntries(folder: string): string[] {
  if (!fs.existsSync(folder)) {
    return [];
  }
  const named = fs.readdirSync(folder).filter((name) => LOOP_CHOICE.test(name) && !name.startsWith('dspatch-uncertain'));
  return [...new Set([...OWN_ENTRIES.filter((entry) => fs.existsSync(path.join(folder, entry))), ...named])];
}

interface StoredWorkspace {
  readonly id?: unknown;
  readonly folders?: unknown;
  readonly lastOpenedAtUtc?: unknown;
}

/** The workspaces of both, by first folder: the list of recent work, not a record of work. */
function mergeProjects(olderFile: string, targetFile: string): void {
  const older = JSON.parse(fs.readFileSync(olderFile, 'utf8')) as Record<string, unknown>;
  const target = JSON.parse(fs.readFileSync(targetFile, 'utf8')) as Record<string, unknown>;
  const mine = Array.isArray(target['workspaces']) ? (target['workspaces'] as StoredWorkspace[]) : [];
  const theirs = Array.isArray(older['workspaces']) ? (older['workspaces'] as StoredWorkspace[]) : [];
  const key = (entry: StoredWorkspace): string => (Array.isArray(entry.folders) ? String(entry.folders[0]) : String(entry.id));
  const known = new Set(mine.map(key));
  const added = theirs.filter((entry) => !known.has(key(entry)));
  fs.writeFileSync(`${targetFile}.adopting`, `${JSON.stringify({ ...target, workspaces: [...mine, ...added] }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${targetFile}.adopting`, targetFile);
}

/** A conversation under an id of its own, saying where it came from in its file only. */
function keepConversationBeside(from: string, targetDir: string): string {
  const id = `${path.basename(from, '.json').slice(0, 100)}-from-older-host`;
  const to = path.join(targetDir, `${id}.json`);
  const conversation = JSON.parse(fs.readFileSync(from, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(`${to}.adopting`, `${JSON.stringify({ ...conversation, conversationId: id }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(`${to}.adopting`, to);
  return to;
}

/**
 * Adopt `older` into `target`. To be called while holding the claim on `target`, before anything
 * reads it. Answers the report, or `null` when there is nothing to do. A second run after an
 * interruption repeats nothing that was finished: only a whole adoption leaves the marker.
 */
export function adoptOlderData(target: string, older: string, log: (message: string) => void): AdoptionReport | null {
  if (path.resolve(target) === path.resolve(older) || adoptedInto(older) === path.resolve(target) || ownEntries(older).length === 0) {
    return null;
  }
  const running = path.join(older, 'host-running.json');
  if (fs.existsSync(running)) {
    try {
      if (processAlive((JSON.parse(fs.readFileSync(running, 'utf8')) as { pid: number }).pid)) {
        log(`an older host is still running over ${older}; its data is left for a later start`);
        return null;
      }
    } catch {
      // A record that cannot be read names no running host.
    }
  }
  // One backup per adoption: taken whole once, and an interrupted attempt keeps what it took.
  const backup = path.join(target, 'backups', 'before-adopting-older-host-data');
  const done = path.join(backup, 'complete');
  if (!fs.existsSync(done)) {
    fs.rmSync(backup, { recursive: true, force: true });
    for (const entry of ownEntries(older)) {
      fs.cpSync(path.join(older, entry), path.join(backup, 'older-host', entry), { recursive: true });
    }
    for (const entry of ownEntries(target)) {
      fs.cpSync(path.join(target, entry), path.join(backup, 'shared-folder', entry), { recursive: true });
    }
    fs.writeFileSync(done, '');
  }
  let copied = 0;
  let alreadyThere = 0;
  const conflicts: { record: string; keptAt: string }[] = [];
  for (const entry of ownEntries(older)) {
    for (const relative of filesUnder(path.join(older, entry))) {
      const record = path.join(entry, relative);
      const from = path.join(older, record);
      const to = path.join(target, record);
      if (!fs.existsSync(to)) {
        copyWhole(from, to);
        copied += 1;
      } else if (sameBytes(from, to)) {
        alreadyThere += 1;
      } else if (record === 'dspatch-projects.json') {
        mergeProjects(from, to);
      } else if (entry === 'conversations' && record.endsWith('.json')) {
        conflicts.push({ record, keptAt: keepConversationBeside(from, path.join(target, 'conversations')) });
      } else {
        const keptAt = path.join(target, 'adopted-conflicts', record);
        copyWhole(from, keptAt);
        conflicts.push({ record, keptAt });
      }
    }
  }
  const report: AdoptionReport = { adoptedAtUtc: new Date().toISOString(), from: older, backup, copied, alreadyThere, conflicts, told: conflicts.length === 0 };
  fs.writeFileSync(path.join(target, ADOPTION_REPORT), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(older, MARKER), `${JSON.stringify({ into: target, adoptedAtUtc: report.adoptedAtUtc, backup }, null, 2)}\n`, { mode: 0o600 });
  log(`adopted the host data in ${older}: ${String(copied)} copied, ${String(alreadyThere)} already here, ${String(conflicts.length)} conflict(s); backup in ${backup}`);
  return report;
}

function adoptedInto(older: string): string | null {
  try {
    const into = (JSON.parse(fs.readFileSync(path.join(older, MARKER), 'utf8')) as { into?: unknown }).into;
    return typeof into === 'string' ? path.resolve(into) : null;
  } catch {
    return null;
  }
}

/** Whether a start has anything to adopt, which may then take longer than a start usually does. */
export function adoptionWaiting(target: string, older: string): boolean {
  return path.resolve(target) !== path.resolve(older) && adoptedInto(older) !== path.resolve(target) && ownEntries(older).length > 0;
}

const FAILED_FILE = 'adoption-failed.json';

/**
 * Adopt, and never stop a start for it: this person's work here matters more than older work
 * elsewhere, which stays untouched. The next start tries again, and the person is told.
 */
export function adoptWithoutFailing(target: string, older: string, log: (message: string) => void): void {
  try {
    adoptOlderData(target, older, log);
    fs.rmSync(path.join(target, FAILED_FILE), { force: true });
  } catch (error) {
    log(`older host data in ${older} could not be adopted: ${String(error)}`);
    try {
      fs.writeFileSync(path.join(target, FAILED_FILE), `${JSON.stringify({ from: older, why: String(error) })}\n`, { mode: 0o600 });
    } catch {
      // The log has it.
    }
  }
}

/** The sentence a person still has to be told about an adoption, once. */
export function adoptionNotice(dataDir: string): string | null {
  const failed = path.join(dataDir, FAILED_FILE);
  if (fs.existsSync(failed)) {
    try {
      const said = JSON.parse(fs.readFileSync(failed, 'utf8')) as { from: string; why: string };
      return `Older host data in ${said.from} could not be brought into this DSpatch, so it is not shown here. It has not been changed, and DSpatch tries again at the next start. What stopped it: ${said.why}`;
    } catch {
      return null;
    }
  }
  const file = path.join(dataDir, ADOPTION_REPORT);
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8')) as AdoptionReport;
    if (report.told || report.conflicts.length === 0) {
      return null;
    }
    fs.writeFileSync(file, `${JSON.stringify({ ...report, told: true }, null, 2)}\n`, { mode: 0o600 });
    return `Older host data was brought into this DSpatch. ${String(report.conflicts.length)} record(s) existed in both places with different content, and both versions were kept: conversations appear twice, the second ending in "from-older-host", and other records are in ${path.dirname(report.conflicts.find((one) => !one.keptAt.includes('from-older-host'))?.keptAt ?? report.backup)}. A backup of both is in ${report.backup}.`;
  } catch {
    return null;
  }
}
