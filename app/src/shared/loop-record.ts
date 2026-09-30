/**
 * A loop run, kept after it ends and after a restart.
 *
 * Until now a chat-loop run was renderer memory. `runLiveGraph` produced a
 * journal, an inspection with before/after snapshots and a full command record,
 * and the main process returned one string of it and dropped the rest. Close the
 * window and the run never happened, while the ordinary chat turn beside it
 * survived — and nothing on screen said so. This module is the format that ends
 * that, and the vocabulary the record is written in.
 *
 * Four decisions are worth stating here rather than leaving to be re-derived.
 *
 * **One JSON object per line, appended as the run happens.** DSP-25 #4 says an
 * interrupted run must still leave understandable history, so the record cannot be
 * assembled at the end. The alternative — rewriting a whole JSON document after
 * every event — is worse for exactly the reason `conversation-store.ts` gives about
 * truncation: it puts the complete previous record at risk on every single event,
 * where appending puts only the newest line at risk. A run killed mid-write
 * therefore loses at most its last line, and `parseRunRecord` reads that back as
 * *a run that was killed mid-write* rather than as a parse error and never as a
 * completed run. That property is the whole point of #4.
 *
 * **The record references the conversation; the conversation does not reference the
 * record.** `CONVERSATION_FORMAT_VERSION` therefore stays at 1 and DSP-25 #6 is
 * satisfied by not breaking anything rather than by migration code. A conversation
 * file written by this build is identical in shape to one written by the last, and
 * a bump would not have been free: a file *newer* than the build is refused by
 * design, so a bump would have made today's conversations unreadable by yesterday's
 * DSpatch for no gain.
 *
 * **The record keeps snapshot identities and the changed, added and removed files —
 * never whole trees.** `snapshotTree` has no file, byte or per-file bound and now
 * walks whatever project the user opens; persisting `files: readonly FileEntry[]`
 * would multiply that by every run the user ever makes. What is left out is named
 * in `RecordedSnapshots.truncated` rather than silently dropped, because a review
 * that cannot be reproduced must say why instead of appearing empty.
 *
 * **No field for a credential, an account address or a backend URL.** Excluded by
 * construction, as `conversation-store.ts` does it, which is the only version of
 * that rule that survives someone adding a field later. The mandate and the agents'
 * replies are the user's own words and their agent's, and they belong in the record.
 */

// Reused rather than reworded. The sentence that names the files a run moved is
// wanted in two places — the step's own reason for its branch, and the ending a
// person reads — and one ending described two different ways in two places is a
// defect an earlier run of this loop already found and paid for.
import { describeMovedPaths } from './loop-chat';
import type { CommandProvenance } from './loop-command';
import type { RunJournalEntry, RunStatus } from './loop-run';

export const LOOP_RUN_RECORD_VERSION = 1;

/**
 * Who, where, what, and **which drawing**.
 *
 * `graphVersionId` is a hash of the graph file's bytes as they were read for this
 * run, not its name. The graph is a file on disk that a person may edit between
 * runs — the editor exists precisely so they can — so a record that named only
 * `dspatch-chat-loop` would claim to identify something it cannot. Two runs of the
 * same named graph with different `graphVersionId` walked different drawings, and
 * the record says so.
 */
export interface RunRecordIdentity {
  readonly runId: string;
  readonly projectPath: string;
  /** The conversation this run was sent in, or `null` when there was none. */
  readonly conversationId: string | null;
  /** What the user typed, whole. Their own words, so never summarised. */
  readonly mandate: string;
  readonly graphId: string;
  readonly graphPath: string;
  readonly graphVersionId: string;
  readonly modelRequested: string;
  readonly appVersion: string;
  readonly startedAtUtc: string;
}

export type CommandNotStartedKind =
  /**
   * There was nothing to run: no command in the field, or no folder to run it in.
   * A statement about DSpatch's configuration, never about the project's tests.
   */
  | 'no-command-configured'
  /**
   * There was a command and DSpatch could not start it — a missing working
   * directory, or an executable that is not on the path. Distinct from a test
   * suite that ran and failed, which is the distinction DSP-26 #2 exists for.
   */
  | 'could-not-start'
  /**
   * A process really started and was still running when its bound ran out, so
   * DSpatch stopped it and there is no exit code.
   *
   * Its own kind rather than either of the two above, because it is neither. The
   * command was not unstartable and it did not fail: nothing is known about the
   * project, and a bound that was spent is the reason. Before this existed a gate
   * command that never returned held the whole run open with no ending and no
   * record of why — measured on a bare `.ps1`, which sat on an invisible Windows
   * "how do you want to open this file?" chooser for 154 seconds until the process
   * tree was killed by hand. Silence is the one outcome the vocabulary must not
   * have, so this is the word for it.
   */
  | 'did-not-finish';

/**
 * Why there is no exit code, as a kind and a message rather than as a sentence alone.
 *
 * One field rather than two, because two fields that have to agree eventually
 * disagree. The kind is what the product reasons about; the message is what the
 * person reads, and for `could-not-start` it is the operating system's or the
 * shell's own words. Those are genuinely more useful than anything DSpatch could
 * substitute and are deliberately not replaced by a euphemism.
 */
export interface CommandNotStarted {
  readonly kind: CommandNotStartedKind;
  readonly message: string;
}

/**
 * How much of a command's output and how many file entries one record may keep.
 *
 * Counted in characters rather than bytes, because this module is shared with the
 * renderer and `Buffer` is not: a bound only the main process can apply is a bound
 * that silently stops existing when the same code runs in the window.
 */
export interface OutputBudget {
  readonly maxOutputChars: number;
  readonly maxFileEntries: number;
}

/**
 * Bounded, and the bound is named where it bites.
 *
 * 16 000 characters of each stream is the tail a person actually reads — the
 * failing assertion, the compiler's last error, the shell's "not recognized" line
 * — and 2 000 file entries covers an ordinary change by orders of magnitude while
 * refusing to let one run write a whole project into the user's profile directory.
 */
export const DEFAULT_OUTPUT_BUDGET: OutputBudget = {
  maxOutputChars: 16_000,
  maxFileEntries: 2_000,
};

/** One command the run ran, or tried to. */
export interface RecordedCommand {
  /** The command line as it was handed to the shell, with the shell named. */
  readonly command: string;
  /**
   * The same command as a person would type it, without the shell prefix.
   *
   * DSP-45 #4 asks the record to show the command *exactly as it ran*. `command` above is
   * literally that — `cmd.exe /d /s /c cmake --build build` is what was started — and it
   * is not what a person compares against their Command field or pastes into a terminal.
   * Both are kept rather than one being chosen for them.
   *
   * Optional: absent in a record written before this field, and `null` for a command
   * started without a shell, where there is no prefix and the two would be one string.
   */
  readonly line?: string | null;
  /**
   * Where this command came from: DSpatch's suggestion, the user, or a step of this run.
   *
   * DSP-45 #4. Optional so every record written before today reads unchanged, and absent
   * means *not recorded* rather than any particular source — a record that defaulted to
   * "the user" would be asserting the one thing this field exists to establish.
   */
  readonly provenance?: CommandProvenance;
  /** Which step proposed it, when `provenance` is `step-proposal`. */
  readonly proposedByNodeId?: string | null;
  /**
   * How the command came to be allowed to run, in the words a person reads.
   *
   * The sentence rather than a flag, because what matters after the fact is *whether the
   * user had the chance to see this exact command before it ran*, and that is a small story
   * — a step proposed it, it was shown, it was confirmed or changed — not a boolean.
   */
  readonly provenanceNote?: string;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly durationMs: number;
  readonly startedAtUtc: string;
  /** `null` when a process really ran. */
  readonly notRun: CommandNotStarted | null;
  /** The end of each stream, bounded. `truncatedOutput` says when something was cut. */
  readonly stdoutTail: string;
  readonly stderrTail: string;
  readonly truncatedOutput: string | null;
  /** The working copy's identity when this command finished, for review afterwards. */
  readonly snapshotAfterId: string | null;
}

export interface RecordedFileChange {
  readonly relPath: string;
  readonly beforeSha256: string;
  readonly afterSha256: string;
  readonly beforeBytes: number;
  readonly afterBytes: number;
}

export interface RecordedFile {
  readonly relPath: string;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * What the run did to the project, as references rather than as contents.
 *
 * This is DSP-25 #3's second half: review has to be possible against the actual
 * code at the revision the run saw, not against the agent's description of it and
 * not against whatever the working copy happens to hold later. A snapshot id plus
 * a per-file before and after hash is what makes that check possible without this
 * file becoming a copy of the project.
 */
export interface RecordedSnapshots {
  readonly beforeId: string | null;
  readonly beforeFileCount: number;
  readonly afterId: string | null;
  readonly afterFileCount: number;
  readonly changed: readonly RecordedFileChange[];
  readonly added: readonly RecordedFile[];
  readonly removed: readonly RecordedFile[];
  /** Non-null when a bound was reached, naming what is missing. Never silent. */
  readonly truncated: string | null;
}

/**
 * The five things "did it work" can mean, which it is never allowed to merge.
 *
 * On the first real chat-loop run a gate that started no process reported the
 * user's tests as failed — a false statement about his C++ code, produced by
 * DSpatch fabricating `exitCode: 1` for "there is nothing to run". These five are
 * the vocabulary that makes that statement unsayable.
 */
export type RunOutcomeKind =
  /** A command the user chose ran to the end and exited 0. */
  | 'work-verified'
  /** A command ran to the end and did not exit 0. A statement about the project. */
  | 'tests-failed'
  /** No verification happened: nothing was configured, or the run never got there. */
  | 'verification-not-performed'
  /** There was a command and it could not be started. A statement about DSpatch. */
  | 'command-could-not-start'
  /** Cancelled, waiting for a person, interrupted, or an outcome nobody established. */
  | 'unresolved';

/** How the run's own call came back, which is not the same as what it found. */
export type RecordedEndingKind = 'finished' | 'cancelled' | 'failed';

export interface RecordedRunEnding {
  readonly endedAtUtc: string;
  readonly kind: RecordedEndingKind;
  /** The runner's status word, or `null` when there was no result to read. */
  readonly status: RunStatus | null;
  readonly terminalNodeId: string | null;
  readonly outcome: RunOutcomeKind;
  /** The sentence that goes with `outcome`, written once and read everywhere. */
  readonly outcomeText: string;
  readonly modelRequested: string;
  /** What the provider said it used, when it said anything. `null` is unknown, not none. */
  readonly modelReported: string | null;
  readonly commands: readonly RecordedCommand[];
  readonly snapshots: RecordedSnapshots;
  /** Which working copy, and what was left in it. The runner's own words. */
  readonly note: string;
  readonly cancelled: boolean;
  /** `'unknown'` is not zero. A reading never taken is not a reading of nought. */
  readonly cost: 'unknown' | number;
}

export interface RecordedAgentReply {
  readonly atUtc: string;
  readonly nodeId: string;
  readonly nodeLabel: string;
  readonly occurrence: number;
  /** As the agent wrote it. Never trimmed for length. */
  readonly text: string;
  readonly terminalStatus: string | null;
  /**
   * What the agent was told, whole, including the role's own text.
   *
   * DSP-46 #1: *what the agent was actually told can be read afterwards from the run
   * record*. Kept on the reply rather than on a line of its own, because the prompt and
   * the reply are one exchange and a reader asking what a step was told is always
   * looking at what it answered — and because a new `RunRecordLine` kind would make
   * every record this build writes read as containing unreadable lines to the build
   * before it, for no gain.
   *
   * Optional, so a record written before this field, or by a caller that does not know
   * the prompt, reads exactly as it did. Absent means *not recorded*, never *nothing was
   * sent*.
   */
  readonly prompt?: string;
  /** The role the drawing named for the step, by identity. Absent when it named none. */
  readonly roleId?: string;
  /** Where that role was read from, relative to the project root. */
  readonly roleSourcePath?: string;
  /**
   * The provider session this step ran in.
   *
   * DSP-79 #1: with one session per agent node, *two consecutive agent nodes use two
   * different provider sessions* is a claim about the run, and this is the only place
   * a reader can check it after the fact. Absent in a record written before per-node
   * sessions, which means **not recorded** and not "the same session" — a run of the
   * old build genuinely shared one, and its records say nothing either way.
   */
  readonly sessionId?: string;
}

/**
 * One line of the file.
 *
 * `line` discriminates rather than `kind`, because `kind` is already taken three
 * times over inside the things being carried and a reader of the raw file should
 * not have to work out which one they are looking at.
 */
export type RunRecordLine =
  | { readonly line: 'header'; readonly formatVersion: number; readonly identity: RunRecordIdentity }
  /**
   * A `RunJournalEntry`, unchanged.
   *
   * Deliberately the runner's own event and not a second vocabulary beside it.
   * DSP-26 #1 is the rule that one run cannot have two state models; inventing a
   * record event that has to be kept in step with the journal entry it was derived
   * from is how the second model gets in.
   */
  | { readonly line: 'journal'; readonly entry: RunJournalEntry }
  | { readonly line: 'agent-reply'; readonly reply: RecordedAgentReply }
  | { readonly line: 'command'; readonly command: RecordedCommand }
  | { readonly line: 'ending'; readonly ending: RecordedRunEnding };

export function serialiseRecordLine(line: RunRecordLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** How complete the file on disk is, which is a fact about the run as much as the file. */
export type RecordCompleteness =
  /** The run wrote its ending line. Whatever it says, it said it. */
  | 'complete'
  /**
   * A header and no ending: the process stopped before the run did. The run may
   * still have changed files, and nothing here says what happened after the last
   * line. Shown as incomplete, never as success and never as failure.
   */
  | 'interrupted'
  /** Not a record this build can read. The file is left exactly as it is. */
  | 'unreadable';

export interface ParsedRunRecord {
  readonly formatVersion: number | null;
  readonly identity: RunRecordIdentity | null;
  readonly journal: readonly RunJournalEntry[];
  readonly replies: readonly RecordedAgentReply[];
  readonly commands: readonly RecordedCommand[];
  readonly ending: RecordedRunEnding | null;
  readonly completeness: RecordCompleteness;
  /** The file ended in the middle of a line, so the last write did not finish. */
  readonly truncatedLastLine: boolean;
  /** Lines this build could not read, counted rather than hidden. */
  readonly unreadableLines: number;
  readonly error: string | null;
  /** What the person can do, as one concrete instruction. Never "DSpatch will fix it". */
  readonly recovery: string | null;
  /** From a later DSpatch: read as far as possible, never rewritten. */
  readonly readOnly: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emptyParse(parts: Partial<ParsedRunRecord>): ParsedRunRecord {
  return {
    formatVersion: null,
    identity: null,
    journal: [],
    replies: [],
    commands: [],
    ending: null,
    completeness: 'unreadable',
    truncatedLastLine: false,
    unreadableLines: 0,
    error: null,
    recovery: null,
    readOnly: false,
    ...parts,
  };
}

/**
 * Read a record back, including one that stops in the middle of a line.
 *
 * Tolerant in the same three ways `conversation-store.ts` is tolerant, and for the
 * same reason: this is the user's record of their own work, and the only thing
 * worse than being unable to show it is overwriting it while trying. A file from a
 * newer build is read as far as it can be and marked `readOnly`. Individual lines
 * that cannot be parsed are counted and skipped rather than ending the read, because
 * the twenty lines after a bad one are still twenty facts about the run.
 *
 * The last line is treated specially. A file that does not end in a newline was
 * being appended to when the process stopped, so its final fragment is dropped and
 * `truncatedLastLine` says so — that is a run killed mid-write, and it must read as
 * one rather than as a parse error and never as a completed run.
 */
export function parseRunRecord(text: string): ParsedRunRecord {
  if (text.trim() === '') {
    return emptyParse({
      error: 'This run record is empty, so nothing about the run can be read from it.',
      recovery:
        'An empty file means the run was recorded but never wrote its first line — ' +
        'DSpatch stopped between creating the file and the run starting. Nothing has ' +
        'been changed and the file is still there. Whatever the run did to your ' +
        'project is still in the project; check it there rather than here.',
    });
  }

  const endsCleanly = text.endsWith('\n');
  const segments = text.split('\n');
  // `split` on a clean file leaves an empty final segment; on a truncated one it
  // leaves the fragment that was being written. Both are dropped here, and only
  // the second is a truncation.
  const fragment = segments.pop() ?? '';
  const truncatedLastLine = !endsCleanly && fragment.trim() !== '';

  let formatVersion: number | null = null;
  let identity: RunRecordIdentity | null = null;
  const journal: RunJournalEntry[] = [];
  const replies: RecordedAgentReply[] = [];
  const commands: RecordedCommand[] = [];
  let ending: RecordedRunEnding | null = null;
  let unreadableLines = 0;

  for (const segment of segments) {
    if (segment.trim() === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(segment);
    } catch {
      unreadableLines += 1;
      continue;
    }
    if (!isRecord(parsed)) {
      unreadableLines += 1;
      continue;
    }
    switch (parsed['line']) {
      case 'header': {
        const version = parsed['formatVersion'];
        formatVersion = typeof version === 'number' && Number.isInteger(version) ? version : null;
        identity = parseIdentity(parsed['identity']);
        break;
      }
      case 'journal': {
        const entry = parsed['entry'];
        if (isRecord(entry) && typeof entry['kind'] === 'string' && typeof entry['seq'] === 'number') {
          journal.push(entry as unknown as RunJournalEntry);
        } else {
          unreadableLines += 1;
        }
        break;
      }
      case 'agent-reply': {
        const reply = parsed['reply'];
        if (isRecord(reply) && typeof reply['text'] === 'string') {
          replies.push(reply as unknown as RecordedAgentReply);
        } else {
          unreadableLines += 1;
        }
        break;
      }
      case 'command': {
        const command = parsed['command'];
        if (isRecord(command) && typeof command['command'] === 'string') {
          commands.push(command as unknown as RecordedCommand);
        } else {
          unreadableLines += 1;
        }
        break;
      }
      case 'ending': {
        const recorded = parsed['ending'];
        if (isRecord(recorded) && typeof recorded['outcome'] === 'string') {
          ending = recorded as unknown as RecordedRunEnding;
        } else {
          unreadableLines += 1;
        }
        break;
      }
      default:
        // A line kind a later DSpatch writes and this one has never heard of. Counted,
        // not guessed at, and the file is never rewritten because of it.
        unreadableLines += 1;
    }
  }

  if (identity === null || formatVersion === null) {
    return emptyParse({
      formatVersion,
      journal,
      replies,
      commands,
      ending,
      truncatedLastLine,
      unreadableLines,
      readOnly: true,
      error:
        'This file has no readable run-record header, so DSpatch cannot say which run ' +
        'it belongs to or which rules to read it by. It has been left exactly as it is.',
      recovery:
        'Every run record DSpatch writes begins with a header line carrying the format ' +
        'version and the run, the project, the conversation and the graph it walked. ' +
        'This file begins with something else, so it was not written by a DSpatch this ' +
        'build recognises, or its first line was lost. Open it in a text editor to see ' +
        'what it holds; DSpatch will not rewrite it.',
    });
  }

  if (formatVersion > LOOP_RUN_RECORD_VERSION) {
    return emptyParse({
      formatVersion,
      identity,
      journal,
      replies,
      commands,
      ending,
      completeness: ending === null ? 'interrupted' : 'complete',
      truncatedLastLine,
      unreadableLines,
      readOnly: true,
      error:
        `This run record is format version ${String(formatVersion)}, newer than the ` +
        `${String(LOOP_RUN_RECORD_VERSION)} this build understands. What is shown is ` +
        'only the part this build can read, and the file will not be changed.',
      recovery:
        'A newer DSpatch wrote this run. Open it with that build, which understands the ' +
        'fields this one would drop. This build never rewrites a record it does not ' +
        'recognise, so nothing in it can be lost by running this one.',
    });
  }

  return {
    formatVersion,
    identity,
    journal,
    replies,
    commands,
    ending,
    completeness: ending === null ? 'interrupted' : 'complete',
    truncatedLastLine,
    unreadableLines,
    error:
      unreadableLines === 0
        ? null
        : `${String(unreadableLines)} line${unreadableLines === 1 ? '' : 's'} of this run ` +
          'record could not be read and have been left out of what is shown. Everything ' +
          'else in the file was read.',
    recovery:
      unreadableLines === 0
        ? null
        : 'The rest of the run is shown above. A line DSpatch cannot read was either ' +
          'written by a later build or damaged after the run; the file has not been ' +
          'changed either way. Open it in a text editor to see the lines themselves.',
    readOnly: false,
  };
}

function parseIdentity(value: unknown): RunRecordIdentity | null {
  if (!isRecord(value)) {
    return null;
  }
  const runId = value['runId'];
  const projectPath = value['projectPath'];
  if (typeof runId !== 'string' || runId === '' || typeof projectPath !== 'string') {
    return null;
  }
  const conversationId = value['conversationId'];
  return {
    runId,
    projectPath,
    conversationId: typeof conversationId === 'string' ? conversationId : null,
    mandate: asString(value['mandate'], ''),
    graphId: asString(value['graphId'], ''),
    graphPath: asString(value['graphPath'], ''),
    graphVersionId: asString(value['graphVersionId'], ''),
    modelRequested: asString(value['modelRequested'], ''),
    appVersion: asString(value['appVersion'], 'unknown'),
    startedAtUtc: asString(value['startedAtUtc'], ''),
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/* ------------------------------------------------------------------------- */
/* The outcome vocabulary                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The three chat-loop endings that record no command, and so share one outcome.
 *
 * DSP-44 #4. `runOutcomeFrom` reaches `verification-not-performed` whenever no
 * command was attempted, and three of the chat loop's five endings attempt none —
 * `not-established` and `stopped` (and the historical `not-checked` /
 * `nothing-changed` ids, so a record written before increment 1 still reads).
 * All of them used to produce the identical paragraph, ending *"Anything the
 * agent changed is still in the working copy, unchecked."* For `stopped` that
 * is three wrong notes at once: the agent's refusal goes unmentioned, the
 * changes warned about do not exist, and *nothing was checked* frames a
 * deliberate stop as a gap in configuration.
 *
 * Counts cannot separate the last two — both are zero, and both have empty command
 * lists — so the distinguishing fact is which terminal the walk reached. These are
 * ids from `dspatch-chat-loop`, named here rather than imported to keep the outcome
 * vocabulary free of a dependency on one graph. A graph that ends somewhere else
 * falls through to the general sentence, which is what every caller got before, and
 * a test pins the current terminals against the shipped file so a rename cannot
 * leave the branch quietly dead.
 */
export const NOTHING_CHANGED_TERMINAL = 'nothing-changed';
export const STOPPED_TERMINAL = 'stopped';
export const NOT_CHECKED_TERMINAL = 'not-checked';
export const NOT_ESTABLISHED_TERMINAL = 'not-established';
export const NOT_MET_TERMINAL = 'not-met';

/**
 * What the walk itself ended at, for the sentence and never for the value.
 *
 * Additive and optional: `RunOutcomeKind` does not move while DSP-26 is in Review
 * awaiting Niclas's assessment, no sixth kind is added, and every existing caller
 * and test compiles and reads exactly as before.
 */
export interface RunWalkEnding {
  /** The terminal the walk reached, or `null` when it reached none. */
  readonly terminalNodeId: string | null;
  /** Paths DSpatch measured as changed, added or removed. Already bounded. */
  readonly movedPaths: readonly string[];
  /** How many further paths there were beyond `movedPaths`. Never silently dropped. */
  readonly movedPathsNotListed: number;
}

export interface RunOutcomeInput {
  readonly commands: readonly RecordedCommand[];
  /** The runner's own status, or `null` when the call produced no result at all. */
  readonly status: RunStatus | null;
  /** A stop was asked for, or the provider reported the turn cancelled. */
  readonly cancelled: boolean;
  /** False when the record stops before its ending line. */
  readonly recordComplete: boolean;
  /**
   * Which ending the walk reached and what it left behind, when the caller knows.
   *
   * Read by `describeRunOutcome` and **deliberately not** by `runOutcomeFrom`:
   * arriving at a terminal earns nothing, which is DSP-26 #3, so the id may change
   * the sentence and must not change the value.
   */
  readonly walk?: RunWalkEnding | null;
}

/**
 * Which of the five the run reached, from what was recorded and nothing else.
 *
 * **The order of the checks is the content.** A command that was attempted is the
 * most direct evidence there is about whether the work was verified, so the two
 * states only a command can report come first — otherwise the gate's own runtime
 * fault, which is how "we started no process" reaches the runner, would be
 * swallowed by the general `unresolved` branch and the distinction DSP-26 #2
 * exists for would be lost at the last step.
 *
 * **Arriving at a terminal earns nothing.** `work-verified` requires a command
 * that ran to the end and exited 0; there is no path to it from the walk alone.
 * That is DSP-26 #3 expressed where it can be checked, rather than in a badge's
 * colour table where the previous version of this rule lived. This is also why
 * `input.walk` is not read here even though it is on the input: DSP-44 #4 needed the
 * terminal id to choose a *sentence*, and the moment a terminal id could choose a
 * *value* this rule would have a second way round it.
 */
export function runOutcomeFrom(input: RunOutcomeInput): RunOutcomeKind {
  if (input.commands.some((command) => command.notRun?.kind === 'could-not-start')) {
    return 'command-could-not-start';
  }
  // Before the `no-command-configured` check, and before the status checks, because
  // a command that was really started and had to be killed is the strongest
  // evidence in the record that nothing was established — stronger than another
  // gate having had nothing to run. Without this branch the run's status would
  // still reach `unresolved` today, but only as a side effect of the gate raising
  // a fault; stating it here is what lets the sentence name the command.
  if (input.commands.some((command) => command.notRun?.kind === 'did-not-finish')) {
    return 'unresolved';
  }
  if (input.commands.some((command) => command.notRun?.kind === 'no-command-configured')) {
    return 'verification-not-performed';
  }
  if (
    !input.recordComplete ||
    input.cancelled ||
    input.status === null ||
    input.status === 'awaiting-human' ||
    input.status === 'refused' ||
    input.status === 'runtime-fault' ||
    input.status === 'limit-reached'
  ) {
    return 'unresolved';
  }
  const ran = input.commands.filter((command) => command.notRun === null);
  if (ran.length === 0) {
    // The walk finished and no command was ever attempted. True, and not a verdict:
    // this graph's `spec-error` and `blocked` branches both reach a terminal without
    // passing the gate.
    return 'verification-not-performed';
  }
  return ran.every((command) => command.exitCode === 0) ? 'work-verified' : 'tests-failed';
}

/**
 * Which recorded command an outcome was decided from.
 *
 * **This exists because the outcome and the sentence beside it used to read
 * different commands.** `runOutcomeFrom` quantifies over every command; the
 * sentence read only the last one. The Verifier of run `20260917-204500-obs18`
 * measured what that costs: a run recording exit 1 and then exit 0 wrote the
 * outcome `tests-failed` and the badge *your command failed* into the same ending
 * line as the sentence "The command you chose ran to the end and exited **0** …
 * That is a real result about your project." A `could-not-start` followed by an
 * exit 0 threw away the shell's own message and said "No reason was recorded".
 *
 * Not reachable on today's single-gate graph. Reachable the moment a run records
 * two commands, which `inspection.commands` being an array, the replay cache
 * keying on `node:occurrence` and the graph editor's retry edge all point at — and
 * DSP-27 and DSP-28 are about to draw both of these values on screen.
 *
 * So there is now one function that picks the evidence and both the value and the
 * sentence ask it. Each branch names the *first* command that satisfies the
 * outcome, because that is the one that decided it in `runOutcomeFrom`'s `some`;
 * `work-verified` is the exception, since it is the only outcome that quantifies
 * over *all* the commands that ran, and the last of them is the one whose passing
 * completed the claim.
 */
export function decidingCommandFor(
  outcome: RunOutcomeKind,
  commands: readonly RecordedCommand[],
): RecordedCommand | null {
  const first = (match: (command: RecordedCommand) => boolean): RecordedCommand | null =>
    commands.find(match) ?? null;
  switch (outcome) {
    case 'command-could-not-start':
      return first((command) => command.notRun?.kind === 'could-not-start');
    case 'verification-not-performed':
      return first((command) => command.notRun?.kind === 'no-command-configured');
    case 'tests-failed':
      return first((command) => command.notRun === null && command.exitCode !== 0);
    case 'work-verified': {
      const ran = commands.filter((command) => command.notRun === null);
      return ran[ran.length - 1] ?? null;
    }
    case 'unresolved':
      return first((command) => command.notRun?.kind === 'did-not-finish');
  }
}

/**
 * The sentence that goes with the outcome, written once so the chat, the graph and
 * the record cannot word it differently.
 *
 * Each one names what is known, what is not, and what is still in the project.
 * None of them says "success" for arriving somewhere.
 *
 * The command it reads is `decidingCommandFor`'s, not the last one recorded. See
 * that function for the contradiction this closes.
 */
export function describeRunOutcome(
  outcome: RunOutcomeKind,
  input: Pick<RunOutcomeInput, 'commands' | 'walk'>,
): string {
  const attempted = decidingCommandFor(outcome, input.commands);
  // DSP-48 #1 and #2. `''` whenever the caller passed no walk or the walk moved
  // nothing, so every sentence below reads exactly as it did before for callers
  // that know neither — which is all of them outside `closeChatLoopRecord`.
  const moved =
    input.walk === undefined || input.walk === null
      ? ''
      : describeMovedPaths(input.walk.movedPaths, input.walk.movedPathsNotListed);
  const andMoved = moved === '' ? '' : ` ${moved}`;
  switch (outcome) {
    case 'work-verified':
      return (
        `A command DSpatch started ran and exited 0: ${attempted?.command ?? 'the command'}` +
        `${attempted === null ? '' : ` in ${attempted.cwd}`}. That is a statement about your ` +
        `project, made by that process — not about the loop having reached the end of ` +
        `its drawing.` +
        // The most important place the paths appear. This is the one ending that says
        // something positive about the project, and it is the ending the Verifier
        // reached with an agent that wrote nothing and a separate OS process that
        // appended a line to `build/CMakeCache.txt`.
        andMoved
      );
    case 'tests-failed':
      return (
        `A command DSpatch started ran to the end and exited ` +
        `${attempted === null ? 'non-zero' : String(attempted.exitCode)}: ` +
        `${attempted?.command ?? 'the command'}. That is a real result about your ` +
        `project. What the agent changed is still in the working copy.` +
        andMoved
      );
    case 'verification-not-performed': {
      const why = attempted?.notRun?.message.trim() ?? '';
      const noCommand = why === '' ? 'DSpatch did not start a command of its own.' : why;
      switch (input.walk?.terminalNodeId) {
        case 'done':
          return (
            `The checking step declared that the assignment was met. ${noCommand} ` +
            `That verdict is a claim; what DSpatch independently observed is in the record ` +
            `beside it.` +
            andMoved
          );
        case NOT_MET_TERMINAL:
          return (
            `The checking step declared that the assignment was not met. ${noCommand} ` +
            `What the work step changed is still in the working copy.` +
            andMoved
          );
        case NOT_CHECKED_TERMINAL:
        case NOT_ESTABLISHED_TERMINAL:
          return (
            `The run could not establish whether the assignment was met. ${noCommand} ` +
            `This is not a pass and not a failure of the project. Anything the agent ` +
            `changed is still in the working copy.` +
            andMoved
          );
        case NOTHING_CHANGED_TERMINAL:
          // **This sentence used to say "there was nothing to test".** It did not
          // know that, and it could not: what DSpatch measured is that no file
          // moved, and it then read that measurement as a finding that no check was
          // wanted — which is exactly the substitution §5 forbids, "files changed"
          // standing in for an assessment of whether the assignment was met. The two
          // come apart constantly. A reading task legitimately changes nothing; so
          // does a change the agent believed it had made and had not, and so does a
          // verification task, which is supposed to run tests and touch no file.
          // The measurement stays, worded as a measurement; the conclusion goes.
          return (
            `DSpatch did not test the project: it started no command of its own. Its own ` +
            `comparison of the project before the work step and after it found no file ` +
            `changed, added or removed — a fact about files, and not a finding that ` +
            `nothing needed checking. The agent's reply is its own account of the work; ` +
            `whether that account is right is not established here. Nothing was built ` +
            `or run, so this is not a test failure and says nothing about whether your ` +
            `project builds or its tests pass.`
          );
        case STOPPED_TERMINAL:
          // A deliberate stop, which the general sentence framed as a gap in
          // configuration. The declaration is the agent's statement about the *task*
          // and beat the measurement to get here, so files may still have moved on
          // the way — hence the clause rather than a claim that nothing did.
          return (
            `DSpatch did not test the project, because the agent stopped instead of doing ` +
            `the work: it replied that the premise was wrong or that it was blocked, and ` +
            `its own reply is the account of why. ${noCommand} So this is not a test ` +
            `failure and says nothing about whether your project builds.` +
            (moved === ''
              ? ` DSpatch measured no file as changed, added or removed.`
              : ` ${moved}`)
          );
        default:
          return (
            `DSpatch did not start a command of its own. This run says nothing about ` +
            `whether your project builds or its tests pass from a process DSpatch spawned, ` +
            `and it is not a test failure. ${noCommand} ` +
            `Anything the agent changed is still in the working copy.` +
            andMoved
          );
      }
    }
    case 'command-could-not-start': {
      const why = attempted?.notRun?.message.trim() ?? '';
      return (
        `DSpatch could not start a command it was given, so it did not test the project and ` +
        `this is not a test failure. ${why === '' ? 'No reason was recorded.' : why} Anything ` +
        `the agent changed is still in the working copy, unchecked.` +
        andMoved
      );
    }
    case 'unresolved': {
      // The only outcome that can be reached without a command at all, so the
      // reason is appended when there is one rather than assumed. A command DSpatch
      // had to stop is the case where the reason is the useful half of the sentence.
      const why = attempted?.notRun?.message.trim() ?? '';
      return (
        `This run has no established outcome: it was stopped, is waiting, or ended without ` +
        `one. Unknown is not a pass and not a failure. ${why === '' ? '' : `${why} `}` +
        `Anything the agent changed is still in the working copy, and nothing has been ` +
        `repeated or reset.` +
        andMoved
      );
    }
  }
}

/**
 * The run's ending in one short factual line, for the default view.
 *
 * {@link describeRunOutcome} is four to six sentences of what was and was not
 * established, and every one of them is worth keeping — but not all of them are worth
 * reading before anything else. Niclas's own words for the result: paragraphs of
 * technical run detail where a sentence would do, in a conversation.
 *
 * So this is what the ending *is*, and the long account becomes the detail behind it.
 * Deliberately built from the outcome and the recorded terminal rather than by cutting
 * the long text down: the first sentence of prose containing `cmake -S . -B build` and
 * a Windows path cannot be found by looking for a full stop, and a summary produced by
 * truncation is a summary nobody chose. Nothing here says more than the long version.
 *
 * `null` for `unresolved`, because the ending's own sentence names the particular
 * thing — stopped, waiting, interrupted — and a shorter line could only say less. The
 * caller keeps the full sentence in view in that case, which is the right place for
 * a run a person may still have to act on.
 */
export function briefRunOutcome(
  outcome: RunOutcomeKind,
  terminalNodeId: string | null,
): string | null {
  switch (outcome) {
    case 'work-verified':
      return 'A command DSpatch started ran and exited 0.';
    case 'tests-failed':
      return 'A command DSpatch started ran and did not exit 0.';
    case 'command-could-not-start':
      return 'A command DSpatch was given could not be started, so nothing was checked.';
    case 'verification-not-performed':
      switch (terminalNodeId) {
        case NOTHING_CHANGED_TERMINAL:
          // The correction in `describeRunOutcome`, kept in one line: the fact, and
          // not the conclusion that used to be drawn from it.
          return (
            'No file changed, and DSpatch started no command of its own. Whether ' +
            'anything needed checking is not established.'
          );
        case 'done':
          return 'The checking step declared the assignment met. DSpatch started no command of its own.';
        case NOT_MET_TERMINAL:
          return 'The checking step declared the assignment not met.';
        case NOT_CHECKED_TERMINAL:
        case NOT_ESTABLISHED_TERMINAL:
          return 'Whether the assignment was met could not be established.';
        case STOPPED_TERMINAL:
          return 'The agent stopped instead of doing the work, and said why in its reply.';
        default:
          return 'DSpatch started no command of its own, so it checked nothing itself.';
      }
    case 'unresolved':
      return null;
  }
}

/**
 * The words inside the badge, for the outcomes that have earned words of their own.
 *
 * Two of the five have none, and it is the same reason twice: the badge holds one
 * short phrase, the ending already has a more specific one, and a word here could
 * only say less than the phrase it would displace. `unresolved` defers because
 * `stopped short`, `waiting for a person` and `spent a bound` each name the
 * particular thing.
 *
 * `verification-not-performed` defers because **it is not a statement about checking
 * at all.** It says DSpatch started no command of its own, which on the chat loop is
 * true of every ending — including the one the Verifier measured on 19 September
 * 2026, where the checking agent read the project's README, ran `cmake -S . -B build
 * -G Ninja` and then `ctest`, which passed 3 of 3. The badge drawn over that run read
 * *nothing was checked*. It was untrue, the run's own sentence beside it said so
 * correctly, and the identical phrase was drawn over all four of the graph's
 * terminals, so it also flattened *met*, *not met*, *could not establish* and
 * *stopped* into one phrase describing none of them.
 *
 * That is [INTERACTION_MODEL.md](../../../docs/INTERACTION_MODEL.md) §8's
 * misallocation surviving as a product string: *checked* keyed on who spawned the
 * process. The **value** is right and stays — DSpatch genuinely started no command,
 * and DSP-26 revises this vocabulary onto the agent's observed tool calls — so only
 * the words go. `loopTurnBadgeText` then names the terminal the run reached, which is
 * true of each ending and different for each.
 *
 * `work-verified` and `tests-failed` keep their words unchanged. Both are reached only
 * through a command that really ran, so *a started command passed* and *a started
 * command failed* are exactly what happened wherever they appear.
 */
export const RUN_OUTCOME_BADGE_TEXT: Readonly<Record<RunOutcomeKind, string | null>> = {
  'work-verified': 'a started command passed',
  'tests-failed': 'a started command failed',
  'verification-not-performed': null,
  'command-could-not-start': 'could not start the command',
  unresolved: null,
};

/**
 * Bound one command's output, naming what was cut.
 *
 * The **tail** rather than the head: a failing command's useful line is its last,
 * and the shell's "not recognized as an internal or external command" is the only
 * line it prints at all.
 */
export function boundedOutput(
  value: string,
  budget: OutputBudget = DEFAULT_OUTPUT_BUDGET,
): { readonly tail: string; readonly cutChars: number } {
  if (value.length <= budget.maxOutputChars) {
    return { tail: value, cutChars: 0 };
  }
  return {
    tail: value.slice(value.length - budget.maxOutputChars),
    cutChars: value.length - budget.maxOutputChars,
  };
}
