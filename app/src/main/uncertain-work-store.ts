/**
 * DSP-147: agent work with no confirmed end that belongs to no conversation, kept with
 * the run it came from and the folders that run gave its agents.
 *
 * Today that is a graph editor run whose step was stopped without a confirmed end. The
 * chat keeps its own such attempts in the conversation's file; an editor run has no
 * conversation, and inventing one would put a chat in the history that nobody had. So
 * each run gets an entry here: its folders and an {@link AttemptLedger} of its own, in
 * the same saved shape as a conversation's attempts, so the one rule for unknown
 * outcomes (refused until named, named once, never marked stopped) applies unchanged.
 *
 * The chat service reads the entries whose folders overlap the work being gated and
 * treats their ledgers exactly like another conversation's over the same working copy.
 * One file in user data; read when first needed, written on every change.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { StoredAttempt } from '../shared/bridge';
import { AttemptLedger, type AttemptSequence } from './attempt-ledger';
import { foldersOverlap } from './working-copy-lock';

const FORMAT_VERSION = 1;

interface StoredEntry {
  readonly runId: string;
  readonly origin: 'graph-editor';
  readonly folders: readonly string[];
  readonly attempts: readonly StoredAttempt[];
}

export interface UncertainWorkEntry {
  readonly runId: string;
  readonly folders: readonly string[];
  readonly ledger: AttemptLedger;
}

export class UncertainWorkStore {
  private entries: UncertainWorkEntry[] | null = null;

  private readonly filePath: string;

  private readonly sequence: AttemptSequence;

  private readonly log: (message: string) => void;

  constructor(
    filePath: string,
    sequence: AttemptSequence,
    log: (message: string) => void = () => undefined,
  ) {
    this.filePath = filePath;
    this.sequence = sequence;
    this.log = log;
  }

  /** Who owns an entry's attempts, as an attempt reference names it. */
  static ownerFor(runId: string): string {
    return `editor-run:${runId}`;
  }

  private load(): UncertainWorkEntry[] {
    if (this.entries !== null) {
      return this.entries;
    }
    const loaded: UncertainWorkEntry[] = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as {
        readonly entries?: readonly StoredEntry[];
      };
      for (const entry of parsed.entries ?? []) {
        if (typeof entry.runId !== 'string' || !Array.isArray(entry.folders) || !Array.isArray(entry.attempts)) {
          continue;
        }
        const ledger = new AttemptLedger(undefined, this.sequence, UncertainWorkStore.ownerFor(entry.runId));
        // The same reconciliation a conversation's attempts get after a restart.
        ledger.restore(entry.attempts);
        loaded.push({ runId: entry.runId, folders: [...entry.folders], ledger });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log(`[uncertain work] could not read ${this.filePath}: ${String(error)}`);
      }
    }
    this.entries = loaded;
    return loaded;
  }

  /** Record a run's agent work with no confirmed end. */
  record(runId: string, folders: readonly string[], label: string, note: string): string {
    const entries = this.load();
    let entry = entries.find((candidate) => candidate.runId === runId);
    if (entry === undefined) {
      entry = {
        runId,
        folders: [...folders],
        ledger: new AttemptLedger(undefined, this.sequence, UncertainWorkStore.ownerFor(runId)),
      };
      entries.push(entry);
    }
    const attempt = entry.ledger.open('agent-turn', label);
    entry.ledger.markOutcomeUnknown(attempt.attemptId, note);
    this.save();
    return attempt.attemptId;
  }

  /** The entries whose folders overlap any of these. */
  overlapping(folders: readonly string[]): readonly UncertainWorkEntry[] {
    return this.load().filter((entry) =>
      entry.folders.some((theirs) => folders.some((ours) => foldersOverlap(theirs, ours))),
    );
  }

  save(): void {
    const entries = this.load();
    const body = {
      formatVersion: FORMAT_VERSION,
      entries: entries.map(
        (entry): StoredEntry => ({
          runId: entry.runId,
          origin: 'graph-editor',
          folders: entry.folders,
          attempts: entry.ledger.persistable(),
        }),
      ),
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.filePath);
    } catch (error) {
      this.log(`[uncertain work] could not write ${this.filePath}: ${String(error)}`);
    }
  }
}
