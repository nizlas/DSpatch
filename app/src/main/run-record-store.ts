/**
 * Where a loop run is kept, and how it is written while it is still happening.
 *
 * The storage conventions are `conversation-store.ts`'s, copied deliberately and
 * for the same reasons: one versioned file per record beside the project store, a
 * file this build cannot read is read as far as possible and **never rewritten**,
 * every error carries a separate concrete recovery action, and secrets are
 * excluded by construction rather than filtered on the way out.
 *
 * **Two departures, both on purpose.**
 *
 * *Appending rather than writing a temporary file and renaming it.* A conversation
 * is saved whole after every turn, so the rename is what stops a dead process from
 * leaving a truncated file where a complete one used to be. A run record is not
 * saved whole: DSP-25 #4 requires the history to survive the run being interrupted,
 * which means the line has to be on disk before the next thing happens. Rewriting
 * the whole file per event would put every earlier line at risk on every event and
 * would grow quadratically with a run's length; appending puts only the newest line
 * at risk. The cost is that a process killed mid-append leaves a partial final
 * line, and `parseRunRecord` reads exactly that back as a run killed mid-write.
 *
 * *A failed write does not stop the run.* The run is happening in the user's
 * project whether or not DSpatch can describe it, and taking the run down over a
 * failed record would destroy the thing the record exists to preserve. Failures are
 * collected on the writer and reported with the run's ending.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ChangedFile, FileEntry } from './experiment-repo';
import type { CommandProvenanceRecord } from '../shared/loop-command';
import type { LiveCommandRecord, LiveInspection } from './loop-live';
import {
  boundedOutput,
  DEFAULT_OUTPUT_BUDGET,
  LOOP_RUN_RECORD_VERSION,
  parseRunRecord,
  serialiseRecordLine,
  type OutputBudget,
  type ParsedRunRecord,
  type RecordedAgentReply,
  type RecordedCommand,
  type RecordedSnapshots,
  type RecordedRunEnding,
  type RunRecordIdentity,
  type RunRecordLine,
} from '../shared/loop-record';
import type { RunJournalEntry } from '../shared/loop-run';

/**
 * Which drawing was executed, as a hash of its bytes.
 *
 * Content and not the name, because the name is stable across every edit the graph
 * editor exists to make. Prefixed the way `snapshotIdFor` prefixes a snapshot, so a
 * reader can tell the two kinds of identity apart at a glance.
 */
export function graphVersionIdFor(graphText: string): string {
  return `graph-${createHash('sha256').update(graphText, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * Whether a run id may be turned into a path.
 *
 * Checked rather than trusted, for the reason `conversation-store.ts` gives: the id
 * reaches the main process from the renderer, and `..` or a separator in it would
 * let a read reach a file outside this directory.
 */
export function isUsableRunId(runId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) && !runId.includes('..');
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export interface RunRecordReadResult {
  readonly filePath: string;
  readonly runId: string;
  /** `null` only when there is no file at all. */
  readonly record: ParsedRunRecord | null;
  readonly error: string | null;
  readonly recovery: string | null;
}

/**
 * An open record, appended to as the run happens.
 *
 * Nothing here throws. `failures` is the honest account of what did not reach the
 * disk, and it is reported with the run rather than swallowed.
 */
export class RunRecordWriter {
  private readonly file: string;

  private readonly budget: OutputBudget;

  private readonly problems: string[] = [];

  private closed = false;

  constructor(filePath: string, budget: OutputBudget = DEFAULT_OUTPUT_BUDGET) {
    this.file = filePath;
    this.budget = budget;
  }

  filePath(): string {
    return this.file;
  }

  /** What could not be written, in the order it happened. Empty is the normal case. */
  failures(): readonly string[] {
    return this.problems;
  }

  private append(line: RunRecordLine): void {
    if (this.closed) {
      return;
    }
    try {
      fs.appendFileSync(this.file, serialiseRecordLine(line), 'utf8');
    } catch (error) {
      // Recorded once per kind rather than once per line: a full disk would
      // otherwise produce one message per journal entry and drown the one that
      // matters.
      const said = `a ${line.line} line of this run could not be written: ${describe(error)}`;
      if (!this.problems.includes(said)) {
        this.problems.push(said);
      }
    }
  }

  start(identity: RunRecordIdentity): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
    } catch (error) {
      this.problems.push(
        `the folder for run records could not be created, so this run will not be kept: ${describe(
          error,
        )}`,
      );
      return;
    }
    this.append({ line: 'header', formatVersion: LOOP_RUN_RECORD_VERSION, identity });
  }

  journal(entry: RunJournalEntry): void {
    this.append({ line: 'journal', entry });
  }

  reply(reply: RecordedAgentReply): void {
    this.append({ line: 'agent-reply', reply });
  }

  command(
    command: LiveCommandRecord,
    snapshotAfterId: string | null,
    /** Where the command came from. `null` from a caller that does not know. DSP-45 #4. */
    provenance: CommandProvenanceRecord | null = null,
  ): void {
    this.append({
      line: 'command',
      command: recordedCommandFrom(command, snapshotAfterId, this.budget, provenance),
    });
  }

  /** The last line. Writing it is what makes the record read as complete. */
  finish(ending: RecordedRunEnding): void {
    this.append({ line: 'ending', ending });
    this.closed = true;
  }
}

/**
 * A command as the record keeps it.
 *
 * **The start time comes off the command, not off the caller's clock.** It used to
 * be a parameter, and both callers passed something that was not a start: the
 * writer passed the moment the command settled and `closeChatLoopRecord` passed
 * the moment the record was closed, so the same command was written twice with two
 * different "start" times and neither was one. `durationMs` could not recover the
 * real start from either. Removing the parameter is what makes the field unable to
 * be wrong again.
 */
export function recordedCommandFrom(
  command: LiveCommandRecord,
  snapshotAfterId: string | null,
  budget: OutputBudget = DEFAULT_OUTPUT_BUDGET,
  provenance: CommandProvenanceRecord | null = null,
): RecordedCommand {
  const out = boundedOutput(command.stdout, budget);
  const err = boundedOutput(command.stderr, budget);
  return {
    command: command.command,
    ...(command.line === undefined ? {} : { line: command.line }),
    ...(provenance === null
      ? {}
      : {
          provenance: provenance.provenance,
          proposedByNodeId: provenance.proposedByNodeId,
          provenanceNote: provenance.note,
        }),
    cwd: command.cwd,
    exitCode: command.exitCode,
    signal: command.signal,
    durationMs: command.durationMs,
    startedAtUtc: command.startedAtUtc,
    notRun: command.notRun,
    stdoutTail: out.tail,
    stderrTail: err.tail,
    truncatedOutput:
      out.cutChars === 0 && err.cutChars === 0
        ? null
        : `Output was longer than this record keeps: ${String(out.cutChars)} characters of ` +
          `standard output and ${String(err.cutChars)} of standard error were cut from the ` +
          `beginning. What is kept is the end of each stream, which is where a failing ` +
          `command says why.`,
    snapshotAfterId,
  };
}

/**
 * The run's effect on the project as references, bounded, with the bound named.
 *
 * `snapshotTree` has no bound of its own and now walks whatever project the user
 * opens, so this is where the record refuses to inherit that. Snapshot identities
 * and per-file hashes are what a review needs; the files themselves are in the
 * project, where they belong.
 */
export function recordedSnapshotsFrom(
  inspection: LiveInspection,
  budget: OutputBudget = DEFAULT_OUTPUT_BUDGET,
): RecordedSnapshots {
  const limit = budget.maxFileEntries;
  const changed = inspection.changedFiles.slice(0, limit).map((file: ChangedFile) => ({
    relPath: file.relPath,
    beforeSha256: file.beforeSha256,
    afterSha256: file.afterSha256,
    beforeBytes: file.beforeBytes,
    afterBytes: file.afterBytes,
  }));
  const added = inspection.addedFiles.slice(0, limit).map(toRecordedFile);
  const removed = inspection.removedFiles.slice(0, limit).map(toRecordedFile);
  const cut =
    inspection.changedFiles.length -
    changed.length +
    (inspection.addedFiles.length - added.length) +
    (inspection.removedFiles.length - removed.length);
  return {
    beforeId: inspection.snapshotBefore?.snapshotId ?? null,
    beforeFileCount: inspection.snapshotBefore?.fileCount ?? 0,
    afterId: inspection.snapshotAfter?.snapshotId ?? null,
    afterFileCount: inspection.snapshotAfter?.fileCount ?? 0,
    changed,
    added,
    removed,
    truncated:
      cut === 0
        ? null
        : `${String(cut)} further changed, added or removed files are not listed here: this ` +
          `record keeps at most ${String(limit)} of each. The two snapshot identities above ` +
          `still cover the whole working copy, so the full difference can be recomputed from ` +
          `them — it is the list that is shortened, not the evidence.`,
  };
}

function toRecordedFile(file: FileEntry): { relPath: string; sha256: string; bytes: number } {
  return { relPath: file.relPath, sha256: file.sha256, bytes: file.bytes };
}

/**
 * Every loop run this DSpatch has kept, one file each.
 *
 * One file per run for the same reason conversations get one file each: a single
 * unreadable record costs that run rather than the whole history, and the file
 * being appended to during a run stays small.
 */
export class RunRecordStore {
  private readonly directory: string;

  private readonly budget: OutputBudget;

  constructor(directory: string, budget: OutputBudget = DEFAULT_OUTPUT_BUDGET) {
    this.directory = directory;
    this.budget = budget;
  }

  directoryPath(): string {
    return this.directory;
  }

  filePathFor(runId: string): string {
    return path.join(this.directory, `${runId}.jsonl`);
  }

  /**
   * Begin a record and write its header.
   *
   * Returns a writer even when the id is unusable, so the caller has one shape to
   * handle: the writer then records the refusal in `failures()` and writes nothing.
   */
  open(identity: RunRecordIdentity): RunRecordWriter {
    if (!isUsableRunId(identity.runId)) {
      const writer = new RunRecordWriter(this.filePathFor('unusable-run-id'), this.budget);
      // Deliberately not started, so nothing is created under a name DSpatch did
      // not choose. The run still happens; only its record does not.
      return writer;
    }
    const writer = new RunRecordWriter(this.filePathFor(identity.runId), this.budget);
    writer.start(identity);
    return writer;
  }

  /** One record, read as far as it can be. The file is never written by this path. */
  read(runId: string): RunRecordReadResult {
    const filePath = this.filePathFor(runId);
    if (!isUsableRunId(runId)) {
      return {
        filePath,
        runId,
        record: null,
        error: `"${runId}" is not a usable run id, so no file was opened.`,
        recovery:
          'This name could address a file outside the run records directory, so DSpatch ' +
          'did not open it. Nothing was read and nothing was written.',
      };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { filePath, runId, record: null, error: null, recovery: null };
      }
      return {
        filePath,
        runId,
        record: null,
        error: `${filePath} could not be read: ${describe(error)}`,
        recovery:
          'The file is there but this account could not open it, so the problem is the ' +
          'file system rather than the run: a permission, a lock held by another ' +
          'program, or a disconnected drive. Nothing has been changed.',
      };
    }
    const record = parseRunRecord(raw);
    return { filePath, runId, record, error: record.error, recovery: record.recovery };
  }

  /**
   * Every record, newest run first.
   *
   * A record that cannot be read stays in the list carrying its own error rather
   * than disappearing from it, for `conversation-store.ts`'s reason: a run the user
   * can see and cannot open is a problem they can act on; one that is silently
   * missing is not.
   */
  list(): readonly RunRecordReadResult[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.directory).sort();
    } catch {
      // No directory yet is the normal state before the first loop run.
      return [];
    }
    const results = names
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => this.read(name.slice(0, -'.jsonl'.length)));
    return results.sort((left, right) => {
      const at = left.record?.identity?.startedAtUtc ?? '';
      const to = right.record?.identity?.startedAtUtc ?? '';
      return at < to ? 1 : at > to ? -1 : 0;
    });
  }

  /** The runs sent in one conversation, oldest first, which is reading order. */
  listForConversation(conversationId: string): readonly RunRecordReadResult[] {
    return this.list()
      .filter((entry) => entry.record?.identity?.conversationId === conversationId)
      .reverse();
  }
}
