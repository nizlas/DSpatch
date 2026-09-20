import fs from 'node:fs';
import path from 'node:path';

import type {
  AttemptKind,
  AttemptState,
  ConversationListEntry,
  ConversationListing,
  PartialWriteInfo,
  StoredAttempt,
  StoredConversation,
} from '../shared/bridge';

/**
 * Saved conversations: one versioned JSON file each, beside the project store.
 *
 * **Why files and not a database.** Nothing here is queried. A conversation is read
 * whole or not at all, and the thing that actually matters about the format is that
 * a person can open it in an editor and see what DSpatch remembers about their
 * work. `node:sqlite` would add a native module to the packaged artifact in exchange
 * for indexes nobody reads.
 *
 * **Why one file per conversation and not one big one.** A single file makes every
 * save rewrite every conversation, so one bad write loses all of them; and it makes
 * the export DSP-4 asks for a filtering exercise rather than a copy.
 *
 * The tolerance rules are `project-store.ts`'s, for the same reasons and
 * deliberately in the same words where they apply. A file this build does not
 * recognise is **read as far as it can be and never rewritten**: a newer DSpatch may
 * hold fields this one would silently drop, and a file a user has hand-edited into
 * invalid JSON is still their record of their work. Losing a conversation is worse
 * than showing an unreadable one.
 *
 * What this module deliberately cannot do:
 *
 * - It never writes into a working copy. It has no code that opens a file for
 *   writing anywhere except its own directory, so "a saved diff is evidence and not
 *   a patch" is a property of the code rather than a promise about it.
 * - It has no field for the credential, the account address or the backend URL.
 *   Secrets are excluded by construction rather than filtered on the way out, which
 *   is the only version of that rule that survives someone adding a field later.
 */

export const CONVERSATION_FORMAT_VERSION = 1;

/**
 * How much baseline content one conversation may keep on disk.
 *
 * Smaller than the in-memory retention budget in `workspace-baseline.ts`, and for a
 * different reason: memory is reclaimed when the session ends, while this sits in
 * the user's profile directory until they delete it. 256 kB per file covers ordinary
 * source files by a wide margin and 16 MB caps what one conversation can cost.
 * Everything left out is named in the file, so a diff that cannot be reproduced
 * after a restart says why instead of appearing empty.
 */
export interface PersistenceBudget {
  readonly maxFileBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_PERSISTENCE_BUDGET: PersistenceBudget = {
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};

export interface ConversationWriteResult {
  readonly filePath: string;
  /** Non-null when the conversation was not saved, and says why. */
  readonly error: string | null;
  readonly bytesWritten: number | null;
}

export interface ConversationReadResult {
  readonly filePath: string;
  /** `null` when nothing usable could be read. */
  readonly conversation: StoredConversation | null;
  readonly error: string | null;
  /**
   * What to do about `error`, as one concrete instruction. `null` when nothing
   * went wrong.
   *
   * AC#5 asks for an explanation **and** a recovery action. They are separate
   * fields because they are separate things: the explanation says what DSpatch
   * found, and this says what the person can do about it, which is never "DSpatch
   * will fix it" — every branch here ends with the file still on disk.
   */
  readonly recovery: string | null;
  /** From a later DSpatch: read, never rewritten. */
  readonly readOnly: boolean;
}

/** The raw bytes of a stored conversation, whether or not they can be parsed. */
export interface ConversationBytes {
  readonly filePath: string;
  readonly bytes: Buffer | null;
  readonly error: string | null;
}

/**
 * What to do about a file this build cannot read.
 *
 * The same four sentences in every branch, because the four things worth saying
 * are the same in every branch: the file is untouched, you can take a copy, you
 * can look at it, and your work is not gone.
 */
function recoveryAdvice(filePath: string, specific: string): string {
  return (
    `${specific} Nothing has been changed: ${filePath} is exactly as it was. Use ` +
    '*Export a copy* on this row to write those bytes somewhere safe before you do ' +
    'anything else — the export copies the file byte for byte and works even when ' +
    'DSpatch cannot read it — and *Show the file* to open the folder it is in. ' +
    'Your other conversations are separate files and are unaffected.'
  );
}

const ATTEMPT_KINDS: readonly AttemptKind[] = ['agent-turn', 'command'];

const ATTEMPT_STATES: readonly AttemptState[] = [
  'waiting',
  'running',
  'cancel-requested',
  'stopped-confirmed',
  'outcome-unknown',
  'completed',
  'failed',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * A conversation ID that is also a safe file name.
 *
 * Derived from the clock and a random suffix rather than from the project path: two
 * conversations about the same project are different conversations, and a path would
 * also put the user's directory names into a file name that DSpatch then has to
 * escape.
 */
export function newConversationId(atUtc: string = new Date().toISOString()): string {
  const stamp = atUtc.replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `dsp-conv-${stamp}-${suffix}`;
}

/**
 * Whether an ID may be turned into a path.
 *
 * The ID reaches this module from the renderer, so it is checked rather than
 * trusted: `..` or a separator in it would let a resume read a file outside the
 * conversations directory.
 */
export function isUsableConversationId(conversationId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(conversationId) && !conversationId.includes('..');
}

export class ConversationStore {
  private readonly directory: string;

  private readonly appVersion: string;

  private readonly budget: PersistenceBudget;

  constructor(
    directory: string,
    appVersion = 'unknown',
    budget: PersistenceBudget = DEFAULT_PERSISTENCE_BUDGET,
  ) {
    this.directory = directory;
    this.appVersion = appVersion;
    this.budget = budget;
  }

  directoryPath(): string {
    return this.directory;
  }

  persistenceBudget(): PersistenceBudget {
    return this.budget;
  }

  filePathFor(conversationId: string): string {
    return path.join(this.directory, `${conversationId}.json`);
  }

  /**
   * Write a conversation.
   *
   * Written to a temporary file and renamed, because the alternative is a truncated
   * file where a complete older one used to be. A save happens after every turn and
   * every command, so "the process died during a write" is not a hypothetical.
   *
   * A failure is returned rather than thrown. The conversation on screen is real
   * whether or not it reached the disk, and taking the window down over a failed
   * save would destroy the very thing it was trying to preserve.
   */
  write(conversation: StoredConversation): ConversationWriteResult {
    const filePath = this.filePathFor(conversation.conversationId);
    if (!isUsableConversationId(conversation.conversationId)) {
      return {
        filePath,
        error:
          `"${conversation.conversationId}" is not a usable conversation ID, so ` +
          'nothing was saved. This is a fault in DSpatch rather than in your work.',
        bytesWritten: null,
      };
    }
    const existing = this.read(conversation.conversationId);
    if (existing.readOnly) {
      return {
        filePath,
        error:
          `${filePath} was written by a DSpatch this build does not recognise, so ` +
          `it has been left exactly as it is: ${existing.error ?? 'unknown reason'} ` +
          'This conversation is not being saved. Everything on screen is still ' +
          'there, and the file on disk is intact.',
        bytesWritten: null,
      };
    }
    const body = `${JSON.stringify({ ...conversation, appVersion: this.appVersion }, null, 2)}\n`;
    const temporary = `${filePath}.writing-${String(process.pid)}`;
    try {
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(temporary, body, 'utf8');
      fs.renameSync(temporary, filePath);
      return { filePath, error: null, bytesWritten: Buffer.byteLength(body, 'utf8') };
    } catch (error) {
      try {
        fs.rmSync(temporary, { force: true });
      } catch {
        // A leftover temporary file is untidy, not harmful: it is never read.
      }
      return {
        filePath,
        error:
          `this conversation could not be saved, so it will not be there after a ` +
          `restart: ${describe(error)}`,
        bytesWritten: null,
      };
    }
  }

  /**
   * Read one conversation.
   *
   * Every failure mode ends with the file still on disk. A conversation that cannot
   * be parsed is the user's record of their own work, and the only thing worse than
   * being unable to show it is overwriting it while trying.
   */
  read(conversationId: string): ConversationReadResult {
    const filePath = this.filePathFor(conversationId);
    if (!isUsableConversationId(conversationId)) {
      return {
        filePath,
        conversation: null,
        error: `"${conversationId}" is not a usable conversation ID.`,
        recovery:
          'This name could address a file outside the conversations directory, so ' +
          'DSpatch did not open it. Nothing was read and nothing was written. If a ' +
          'file with this name is genuinely yours, move it into the directory under ' +
          'a name made only of letters, digits, dots, dashes and underscores.',
        readOnly: true,
      };
    }
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { filePath, conversation: null, error: null, recovery: null, readOnly: false };
      }
      return {
        filePath,
        conversation: null,
        error: `${filePath} could not be read: ${describe(error)}`,
        recovery: recoveryAdvice(
          filePath,
          'The file is there but this account could not open it, so the problem is ' +
            'the file system rather than the conversation: a permission, a lock held ' +
            'by another program, or a disconnected drive.',
        ),
        readOnly: true,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // A conversation is saved after every turn and every command, so "the
      // machine stopped during a save" is not hypothetical. `write` renames a
      // temporary file into place precisely so the previous complete file survives
      // that — which means a file that ends mid-value came from something else, and
      // saying which of the two DSpatch is looking at is worth the check.
      const looksCut = !/[}\]]\s*$/.test(raw);
      return {
        filePath,
        conversation: null,
        error:
          `${filePath} is not valid JSON, so this conversation cannot be read. The ` +
          `file has been left as it is rather than overwritten: ${describe(error)}` +
          (looksCut
            ? ` It also does not end where a complete JSON file would, at ${String(
                raw.length,
              )} bytes, so it looks cut short rather than merely mistyped.`
            : ''),
        recovery: recoveryAdvice(
          filePath,
          looksCut
            ? 'The file ends in the middle of a value. DSpatch saves by renaming a ' +
                'temporary file into place, so an interrupted save leaves the previous ' +
                'complete file alone — which points at the file having been cut short ' +
                'by something else, such as a disk that filled up, a sync client, or an ' +
                'editor that was writing it.'
            : 'The file is there and readable but is not valid JSON, which usually ' +
                'means it has been edited by hand.',
        ),
        readOnly: true,
      };
    }
    if (!isRecord(parsed)) {
      return {
        filePath,
        conversation: null,
        error: `${filePath} does not contain a JSON object. It has been left as it is.`,
        recovery: recoveryAdvice(
          filePath,
          'The file is valid JSON but is not an object, so it is not a conversation ' +
            'at all — something else has been written to this path.',
        ),
        readOnly: true,
      };
    }
    const version = parsed['formatVersion'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return {
        filePath,
        conversation: null,
        error:
          `${filePath} has no usable formatVersion, so it was not written by a ` +
          'DSpatch this code recognises. It has been left as it is.',
        recovery: recoveryAdvice(
          filePath,
          'Every conversation DSpatch writes carries a whole number formatVersion, ' +
            `currently ${String(CONVERSATION_FORMAT_VERSION)}. This file has none, so ` +
            'DSpatch cannot tell which rules to read it by and will not guess.',
        ),
        readOnly: true,
      };
    }
    if (version > CONVERSATION_FORMAT_VERSION) {
      return {
        filePath,
        conversation: null,
        error:
          `${filePath} is format version ${String(version)}, newer than the ` +
          `${String(CONVERSATION_FORMAT_VERSION)} this build understands. It has ` +
          'not been read and will not be changed — use the DSpatch that wrote it.',
        recovery: recoveryAdvice(
          filePath,
          'A newer DSpatch wrote this. Open it with that build, which understands ' +
            'the fields this one would drop. This build will never rewrite it, so ' +
            'nothing in it can be lost by running this one.',
        ),
        readOnly: true,
      };
    }

    const conversation = parseConversation(parsed, filePath);
    if (conversation === null) {
      return {
        filePath,
        conversation: null,
        error:
          `${filePath} is version ${String(version)} but does not have the fields ` +
          'this build needs, so it cannot be read. It has been left as it is. A ' +
          'conversation needs at least conversationId, project.path and session.',
        recovery: recoveryAdvice(
          filePath,
          `The file parses as JSON and claims format version ${String(version)}, but ` +
            'the fields a conversation is made of are missing or of the wrong type. ' +
            'DSpatch will not invent them: a conversation half-guessed from a damaged ' +
            'file would be a record of something that never happened.',
        ),
        readOnly: true,
      };
    }
    return { filePath, conversation, error: null, recovery: null, readOnly: false };
  }

  /**
   * One conversation's file as bytes, parsed or not.
   *
   * The export path. Deliberately does not go through {@link read}: the whole
   * value of an export for a file DSpatch cannot read is that it copies what is
   * actually there, and anything that understood the contents would be tempted to
   * write back its own idea of them.
   */
  readBytes(conversationId: string): ConversationBytes {
    const filePath = this.filePathFor(conversationId);
    if (!isUsableConversationId(conversationId)) {
      return {
        filePath,
        bytes: null,
        error: `"${conversationId}" is not a usable conversation ID, so no file was opened.`,
      };
    }
    try {
      return { filePath, bytes: fs.readFileSync(filePath), error: null };
    } catch (error) {
      return {
        filePath,
        bytes: null,
        error: `${filePath} could not be read: ${describe(error)}`,
      };
    }
  }

  /**
   * Every saved conversation, as summaries.
   *
   * A file that cannot be read becomes an entry carrying its own error rather than
   * disappearing from the list. A conversation the user can see and cannot open is
   * a problem they can act on; one that is silently missing is not.
   */
  list(): ConversationListing {
    let all: string[];
    try {
      all = fs.readdirSync(this.directory).sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No directory yet is the normal state before the first conversation.
        return {
          directory: this.directory,
          formatVersion: CONVERSATION_FORMAT_VERSION,
          entries: [],
          error: null,
          recovery: null,
          partialWrites: [],
        };
      }
      return {
        directory: this.directory,
        formatVersion: CONVERSATION_FORMAT_VERSION,
        entries: [],
        error: `the saved conversations could not be listed: ${describe(error)}`,
        recovery:
          `DSpatch could not read the directory ${this.directory} itself, so it ` +
          'cannot say whether there are saved conversations in it — this is not the ' +
          'same as there being none. Nothing has been created or deleted. Check that ' +
          'the path exists and that this account can read it; if the drive it is on ' +
          'is disconnected, reconnect it and reopen DSpatch.',
        partialWrites: [],
      };
    }
    const names = all.filter((name) => name.endsWith('.json'));
    const partialWrites = this.partialWrites(all);

    const entries: ConversationListEntry[] = [];
    for (const name of names) {
      const conversationId = name.slice(0, -'.json'.length);
      const result = this.read(conversationId);
      const conversation = result.conversation;
      if (conversation === null) {
        entries.push({
          conversationId,
          filePath: result.filePath,
          projectPath: '',
          projectExists: false,
          createdAtUtc: '',
          savedAtUtc: '',
          messageCount: 0,
          unresolvedAttemptCount: 0,
          unacknowledgedAttemptCount: 0,
          hasReviewedDiff: false,
          hasTestResult: false,
          formatVersion: 0,
          error: result.error ?? 'this conversation could not be read.',
          recovery:
            result.recovery ??
            recoveryAdvice(result.filePath, 'This conversation could not be read.'),
          readOnly: result.readOnly,
        });
        continue;
      }
      entries.push({
        conversationId: conversation.conversationId,
        filePath: result.filePath,
        recovery: null,
        projectPath: conversation.project.path,
        projectExists: directoryExists(conversation.project.path),
        createdAtUtc: conversation.createdAtUtc,
        savedAtUtc: conversation.savedAtUtc,
        messageCount: conversation.messages.length,
        unresolvedAttemptCount: conversation.attempts.filter(
          (attempt) => !SETTLED_STATES.includes(attempt.state),
        ).length,
        // Read from the file, not derived from it: `acknowledgedAtUtc` is what the
        // ledger consults when it decides whether the next message is gated, so the
        // row and the gate cannot disagree about which attempts still need a person.
        unacknowledgedAttemptCount: conversation.attempts.filter(
          (attempt) =>
            !SETTLED_STATES.includes(attempt.state) && attempt.acknowledgedAtUtc === null,
        ).length,
        hasReviewedDiff: conversation.reviewedDiff !== null,
        hasTestResult: conversation.testRuns.length > 0,
        formatVersion: conversation.formatVersion,
        error: null,
        readOnly: false,
      });
    }
    // Newest work first: the conversation someone wants back is usually the last
    // one they were in.
    entries.sort((left, right) => (left.savedAtUtc < right.savedAtUtc ? 1 : -1));
    return {
      directory: this.directory,
      formatVersion: CONVERSATION_FORMAT_VERSION,
      entries,
      // Deliberately `null` even when a save did not finish. `error` is for "the
      // saved conversations could not be listed", which is not what an unfinished
      // save is — the list above is complete and readable. It used to carry a
      // sentence about the leftovers as well, and report 008 measured the result:
      // the same unfinished save was reported twice in the window, in two slightly
      // different sets of words. `partialWrites` and `recovery` below are where it
      // belongs, and they name the files and say what to do about them.
      error: null,
      recovery:
        partialWrites.length === 0
          ? null
          : 'These leftovers have been left alone rather than tidied away: they are ' +
            'the only trace of a save that was lost, and they may contain the turn ' +
            'that is missing from the conversation. They are never read back, so ' +
            'they cost nothing but the space. Open one in a text editor if you want ' +
            'to see what it holds, and delete it when you are finished with it.',
      partialWrites,
    };
  }

  /**
   * Temporary files from saves that never completed.
   *
   * Reported rather than removed. `write` renames its temporary file into place, so
   * one of these means a process died between writing and renaming and the save was
   * lost; deleting it quietly would be DSpatch clearing away the only evidence of
   * the thing that went wrong, and DSP-4's whole point is that a loss is never
   * silent.
   */
  private partialWrites(names: readonly string[]): readonly PartialWriteInfo[] {
    return names
      .filter((name) => /\.json\.writing-\d+$/.test(name))
      .map((fileName) => {
        const filePath = path.join(this.directory, fileName);
        try {
          const stat = fs.statSync(filePath);
          return {
            fileName,
            filePath,
            bytes: stat.size,
            modifiedAtUtc: stat.mtime.toISOString(),
          };
        } catch {
          return { fileName, filePath, bytes: null, modifiedAtUtc: null };
        }
      });
  }
}

const SETTLED_STATES: readonly AttemptState[] = [
  'stopped-confirmed',
  'completed',
  'failed',
];

function directoryExists(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Turn a parsed JSON object into a conversation, or `null`.
 *
 * Deliberately checking rather than casting. This file can be hand-edited, can come
 * from a build with different ideas, and its contents are fed straight into the
 * attempt ledger — where a state string the ledger has never heard of would produce
 * an attempt that is neither settled nor recognised, and therefore blocks the window
 * forever with no way out. Anything unrecognised is dropped with the rest of its
 * record instead.
 */
function parseConversation(raw: Record<string, unknown>, filePath: string): StoredConversation | null {
  const conversationId = raw['conversationId'];
  const project = raw['project'];
  const session = raw['session'];
  if (
    typeof conversationId !== 'string' ||
    conversationId === '' ||
    !isRecord(project) ||
    typeof project['path'] !== 'string' ||
    !isRecord(session)
  ) {
    return null;
  }
  const formatVersion = raw['formatVersion'];
  return {
    formatVersion: typeof formatVersion === 'number' ? formatVersion : CONVERSATION_FORMAT_VERSION,
    conversationId,
    createdAtUtc: asString(raw['createdAtUtc'], ''),
    savedAtUtc: asString(raw['savedAtUtc'], ''),
    appVersion: asString(raw['appVersion'], 'unknown'),
    // The project and the session are the file's own record of what the work was
    // about. They are carried through as read, because a partially rewritten
    // version of them would be a claim this code is not entitled to make; the
    // fields the window needs are checked above.
    project: project as unknown as StoredConversation['project'],
    session: session as unknown as StoredConversation['session'],
    messages: parseMessages(raw['messages']),
    attempts: parseAttempts(raw['attempts'], filePath),
    testRuns: Array.isArray(raw['testRuns'])
      ? (raw['testRuns'].filter(isRecord) as unknown as StoredConversation['testRuns'])
      : [],
    lastTestAttemptId:
      typeof raw['lastTestAttemptId'] === 'string' ? raw['lastTestAttemptId'] : null,
    baseline: isRecord(raw['baseline'])
      ? (raw['baseline'] as unknown as StoredConversation['baseline'])
      : null,
    reviewedDiff: isRecord(raw['reviewedDiff'])
      ? (raw['reviewedDiff'] as unknown as StoredConversation['reviewedDiff'])
      : null,
  };
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * The messages, in the order the file says rather than the order they are listed in.
 *
 * `ordinal` is the field AC#1 rests on. Sorting by it means a file whose array has
 * been reordered — by a merge, by a hand edit, by a future writer that appends — still
 * reads back in the order the conversation happened.
 */
function parseMessages(value: unknown): StoredConversation['messages'] {
  if (!Array.isArray(value)) {
    return [];
  }
  const messages = value
    .filter(isRecord)
    .filter((entry) => typeof entry['dspatchRunId'] === 'string')
    .map((entry, index) => ({
      ordinal:
        typeof entry['ordinal'] === 'number' && Number.isFinite(entry['ordinal'])
          ? entry['ordinal']
          : index,
      dspatchRunId: String(entry['dspatchRunId']),
      prompt: asString(entry['prompt'], ''),
      // Absent in files written before DSpatch resent anything, and absent in every
      // message of a session that resumed the provider's own. `null` is the truth in
      // both cases: no record was kept of a recap, because there was none.
      resentContext:
        typeof entry['resentContext'] === 'string' ? entry['resentContext'] : null,
      answer: asString(entry['answer'], ''),
      deltaCount: asNumber(entry['deltaCount'], 0),
      toolEvents: asNumber(entry['toolEvents'], 0),
      terminalStatus:
        typeof entry['terminalStatus'] === 'string' ? entry['terminalStatus'] : null,
      errorMessage: typeof entry['errorMessage'] === 'string' ? entry['errorMessage'] : null,
      totalTokens:
        typeof entry['totalTokens'] === 'number' && Number.isFinite(entry['totalTokens'])
          ? entry['totalTokens']
          : null,
      startedAtUtc: asString(entry['startedAtUtc'], ''),
      finishedAtUtc:
        typeof entry['finishedAtUtc'] === 'string' ? entry['finishedAtUtc'] : null,
    }));
  return messages.sort((left, right) => left.ordinal - right.ordinal);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * The attempts, with every unrecognised kind or state dropped.
 *
 * The strictest parsing in this file, because the ledger's rules are only as sound
 * as the states they are given. A record whose state is not one of the seven the
 * ledger knows cannot be reconciled, cannot be settled and would sit in the way of
 * every later message, so it does not become an attempt at all.
 */
function parseAttempts(value: unknown, filePath: string): readonly StoredAttempt[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attempts: StoredAttempt[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const attemptId = entry['attemptId'];
    const kind = entry['kind'];
    const state = entry['state'];
    if (
      typeof attemptId !== 'string' ||
      attemptId === '' ||
      typeof kind !== 'string' ||
      !ATTEMPT_KINDS.includes(kind as AttemptKind) ||
      typeof state !== 'string' ||
      !ATTEMPT_STATES.includes(state as AttemptState)
    ) {
      continue;
    }
    attempts.push({
      attemptId,
      kind: kind as AttemptKind,
      label: asString(entry['label'], attemptId),
      state: state as AttemptState,
      stateReason: asString(
        entry['stateReason'],
        `Read back from ${filePath} without a recorded reason.`,
      ),
      requestedAtUtc: asString(entry['requestedAtUtc'], ''),
      endedAtUtc: typeof entry['endedAtUtc'] === 'string' ? entry['endedAtUtc'] : null,
      providerRunId:
        typeof entry['providerRunId'] === 'string' ? entry['providerRunId'] : null,
      localPid:
        typeof entry['localPid'] === 'number' && Number.isFinite(entry['localPid'])
          ? entry['localPid']
          : null,
      cancelRequestedAtUtc:
        typeof entry['cancelRequestedAtUtc'] === 'string'
          ? entry['cancelRequestedAtUtc']
          : null,
      acknowledgedAtUtc:
        typeof entry['acknowledgedAtUtc'] === 'string' ? entry['acknowledgedAtUtc'] : null,
      history: parseHistory(entry['history'], state as AttemptState),
    });
  }
  return attempts;
}

function parseHistory(
  value: unknown,
  fallbackState: AttemptState,
): StoredAttempt['history'] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord).map((step) => ({
    atUtc: asString(step['atUtc'], ''),
    state:
      typeof step['state'] === 'string' && ATTEMPT_STATES.includes(step['state'] as AttemptState)
        ? (step['state'] as AttemptState)
        : fallbackState,
    note: asString(step['note'], ''),
    applied: step['applied'] !== false,
  }));
}
