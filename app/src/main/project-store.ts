import fs from 'node:fs';
import path from 'node:path';

/**
 * The recently used projects, in one small versioned JSON file.
 *
 * One file, versioned from the start, because DSP-4 will extend this store with
 * conversation history rather than introduce a second one. `formatVersion` is
 * written now so that a later DSpatch can recognise this file, and — more
 * importantly — so that an **older** DSpatch meeting a newer file refuses to
 * rewrite it instead of quietly discarding fields it does not understand.
 *
 * Nothing here is essential to operating DSpatch: a missing or unreadable file
 * costs the list of recent projects and nothing else. So every failure is
 * reported and none of them is fatal, and a file that cannot be parsed is left
 * on disk rather than overwritten — it is the user's data, and it may be
 * recoverable by hand.
 */

/**
 * 2 since DSP-71 added `workspaces` beside `recentProjects`.
 *
 * Bumped rather than left alone precisely so that the refuse-to-rewrite behaviour
 * above does the right thing in the direction that matters: a build from before this
 * card meeting a file written by this one reads the recent projects it understands
 * and **will not write**, instead of saving the file back without the workspaces and
 * losing a person's open folders. A version-1 file is read by this build without
 * complaint; it simply has no workspaces in it, which is the truth about it.
 */
export const PROJECT_STORE_FORMAT_VERSION = 2;

export interface RecentProject {
  readonly path: string;
  readonly lastOpenedAtUtc: string;
  readonly openCount: number;
  /**
   * The saved conversation this project was last worked in, if any.
   *
   * The reason it is here and not derived from the conversation files: opening a
   * project after a restart has to **continue** its conversation rather than start a
   * second one beside it, and matching by path across the saved files would guess.
   * `null` means DSpatch has no record of one, which is the honest answer for a
   * project opened before this field existed — a version-1 file written by DSP-2's
   * build has no such field, and reading it must not invent one.
   */
  readonly lastConversationId: string | null;
}

/**
 * A set of folders a person had open together, and the loop they chose for it.
 *
 * **Not a second project list.** A `RecentProject` is a folder that was opened and
 * worked in; this is the arrangement several of them were open in. The two are in one
 * file because DSP-71 said to add to this store rather than restructure it, and
 * because a second store would have its own version, its own corruption case and its
 * own refuse-to-rewrite rule to get right.
 *
 * **There is deliberately no `lastConversationId` here, and DSP-72 kept it that way.**
 * DSP-71's description reserves one, against the day several folders make "which
 * folder's conversation is this" unanswerable, and deferred the question to the card
 * that gave several working roots a meaning. That card has now been done, and the
 * question still has exactly one answer.
 *
 * Working roots stopped being singular; **the working directory did not.** A run's
 * roots are an ordered list with one primary, and the primary is not a presentation
 * choice: it is the shell's `cwd`, and the provider scopes its own local agent store by
 * `cwd`, so which root is primary is part of the resume key. A conversation continues
 * against that store. So "which folder's conversation is this" resolves, as it did
 * before, to the working directory's `RecentProject` entry, where
 * `rememberConversation` already puts the pointer — and a second pointer here would be
 * a second answer to a one-answer question, which is the shape of the bug
 * `rememberConversation` was written to fix.
 *
 * What would change this is a run whose roots have no primary, or one where two roots
 * could each be resumed against separately. Neither exists, and the field should be
 * added when one does rather than reserved against the possibility. The test asserting
 * this field is **absent** stays, and it is now asserting a decision two cards have
 * taken rather than an omission waiting to be corrected.
 *
 * `filePath` is the saved `.dspatch-workspace.json` this arrangement came from, and
 * `null` for the one a person has simply built up in the window without saving it.
 */
export interface WorkspaceRecord {
  readonly filePath: string | null;
  readonly folders: readonly string[];
  /** The declaration file the person chose. Collected here from DSP-68. */
  readonly loopDefinitionKey: string | null;
  readonly lastOpenedAtUtc: string;
}

interface StoreFile {
  readonly formatVersion: number;
  readonly recentProjects: readonly RecentProject[];
  readonly workspaces: readonly WorkspaceRecord[];
}

export interface ProjectStoreState {
  readonly filePath: string;
  readonly formatVersion: number;
  readonly recentProjects: readonly RecentProject[];
  /** Most recently used first. Empty for a version-1 file, which had none. */
  readonly workspaces: readonly WorkspaceRecord[];
  /** Non-null means the list is incomplete or absent, and says why. */
  readonly error: string | null;
  /** True when the file is from a later DSpatch and must not be rewritten. */
  readonly readOnly: boolean;
}

/** More than this is a list nobody reads; the newest entries are kept. */
const MAX_RECENT = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecent(value: unknown): readonly RecentProject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const projects: RecentProject[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const projectPath = entry['path'];
    if (typeof projectPath !== 'string' || projectPath.trim() === '') {
      continue;
    }
    const lastOpened = entry['lastOpenedAtUtc'];
    const openCount = entry['openCount'];
    const conversationId = entry['lastConversationId'];
    projects.push({
      path: projectPath,
      lastOpenedAtUtc: typeof lastOpened === 'string' ? lastOpened : '',
      openCount: typeof openCount === 'number' && Number.isFinite(openCount) ? openCount : 1,
      lastConversationId: typeof conversationId === 'string' && conversationId !== ''
        ? conversationId
        : null,
    });
  }
  return projects;
}

/** More than this and the list is history nobody reopens. */
const MAX_WORKSPACES = 8;

function parseWorkspaces(value: unknown): readonly WorkspaceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const records: WorkspaceRecord[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const folders = entry['folders'];
    if (!Array.isArray(folders)) {
      continue;
    }
    const filePath = entry['filePath'];
    const key = entry['loopDefinitionKey'];
    const at = entry['lastOpenedAtUtc'];
    records.push({
      filePath: typeof filePath === 'string' && filePath !== '' ? filePath : null,
      folders: folders.filter(
        (folder): folder is string => typeof folder === 'string' && folder.trim() !== '',
      ),
      loopDefinitionKey: typeof key === 'string' && key !== '' ? key : null,
      lastOpenedAtUtc: typeof at === 'string' ? at : '',
    });
  }
  return records;
}

export class ProjectStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  read(): ProjectStoreState {
    const empty = (error: string | null, readOnly = false): ProjectStoreState => ({
      filePath: this.filePath,
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects: [],
      workspaces: [],
      error,
      readOnly,
    });

    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No file yet is the normal first run, not a fault.
        return empty(null);
      }
      return empty(`the settings file could not be read: ${describe(error)}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return empty(
        `the settings file at ${this.filePath} is not valid JSON, so the list of ` +
          `recent projects is unknown. The file has been left as it is rather than ` +
          `overwritten: ${describe(error)}`,
        true,
      );
    }

    if (!isRecord(parsed)) {
      return empty(
        `the settings file at ${this.filePath} does not contain a JSON object. It ` +
          `has been left as it is rather than overwritten.`,
        true,
      );
    }

    const version = parsed['formatVersion'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return empty(
        `the settings file at ${this.filePath} has no usable formatVersion, so it ` +
          `was not written by a DSpatch this code recognises. It has been left as ` +
          `it is rather than overwritten.`,
        true,
      );
    }
    if (version > PROJECT_STORE_FORMAT_VERSION) {
      return {
        filePath: this.filePath,
        formatVersion: version,
        // Read what is recognisable; refuse to write. A newer DSpatch may hold
        // fields this one would silently drop on the next save.
        recentProjects: parseRecent(parsed['recentProjects']).slice(0, MAX_RECENT),
        workspaces: parseWorkspaces(parsed['workspaces']).slice(0, MAX_WORKSPACES),
        error:
          `the settings file at ${this.filePath} is format version ` +
          `${String(version)}, newer than the ${String(
            PROJECT_STORE_FORMAT_VERSION,
          )} this build writes. It is being read but will not be changed.`,
        readOnly: true,
      };
    }

    return {
      filePath: this.filePath,
      formatVersion: version,
      recentProjects: parseRecent(parsed['recentProjects']).slice(0, MAX_RECENT),
      workspaces: parseWorkspaces(parsed['workspaces']).slice(0, MAX_WORKSPACES),
      error: null,
      readOnly: false,
    };
  }

  /** The conversation a project was last worked in, or `null` if there is none. */
  conversationFor(projectPath: string): string | null {
    const normalised = path.resolve(projectPath);
    return (
      this.read().recentProjects.find((entry) => samePath(entry.path, normalised))
        ?.lastConversationId ?? null
    );
  }

  /**
   * Move a project to the front of the list.
   *
   * Returns the state as it now stands, including a write failure, so the window
   * can say that the project opened but was not remembered — which is true, and
   * better than an unexplained empty list next time.
   *
   * `conversationId` is what makes reopening a project continue its work rather
   * than start beside it. Omitting it keeps whatever was recorded before, so a code
   * path that does not know about conversations cannot erase the association.
   *
   * Both options are named rather than positional because both are strings: a
   * conversation id passed where a timestamp was expected typechecks perfectly and
   * silently records the wrong thing in both fields. That mistake was made here.
   */
  recordOpened(
    projectPath: string,
    options: { readonly conversationId?: string; readonly atUtc?: string } = {},
  ): ProjectStoreState {
    const atUtc = options.atUtc ?? new Date().toISOString();
    const conversationId = options.conversationId;
    const current = this.read();
    const normalised = path.resolve(projectPath);
    const previous = current.recentProjects.find((entry) => samePath(entry.path, normalised));
    const entry: RecentProject = {
      path: normalised,
      lastOpenedAtUtc: atUtc,
      openCount: (previous?.openCount ?? 0) + 1,
      lastConversationId: conversationId ?? previous?.lastConversationId ?? null,
    };
    const recentProjects = [
      entry,
      ...current.recentProjects.filter((old) => !samePath(old.path, normalised)),
    ].slice(0, MAX_RECENT);

    if (current.readOnly) {
      return { ...current, recentProjects };
    }

    const file: StoreFile = {
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects,
      workspaces: current.workspaces,
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      return {
        ...current,
        recentProjects,
        error: `the project opened, but it could not be remembered for next time: ${describe(error)}`,
      };
    }
    return {
      filePath: this.filePath,
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects,
      workspaces: current.workspaces,
      error: null,
      readOnly: false,
    };
  }

  /**
   * Point a remembered project at the conversation being worked in now.
   *
   * **Separate from {@link recordOpened} because this is not an opening.** That
   * method was the only writer of `lastConversationId`, and it runs once, at the
   * moment a session opens — so the pointer recorded whichever conversation was
   * current *then* and nothing moved it afterwards. Reading an earlier conversation
   * back and then working in it therefore left the project pointing at the one it
   * had been opened with, and the next open returned to that one.
   *
   * Nothing else about the entry changes: `openCount` and `lastOpenedAtUtc` describe
   * openings, and bumping them here would make the list of recent projects reorder
   * itself every time a conversation was chosen.
   *
   * A project not in the list is left alone rather than added. This is the pointer on
   * an existing entry; a project earns its entry by being opened.
   */
  rememberConversation(projectPath: string, conversationId: string): ProjectStoreState {
    const current = this.read();
    const normalised = path.resolve(projectPath);
    const previous = current.recentProjects.find((entry) => samePath(entry.path, normalised));
    if (
      previous === undefined ||
      conversationId === '' ||
      previous.lastConversationId === conversationId
    ) {
      return current;
    }
    const recentProjects = current.recentProjects.map((entry) =>
      samePath(entry.path, normalised) ? { ...entry, lastConversationId: conversationId } : entry,
    );
    if (current.readOnly) {
      return { ...current, recentProjects };
    }
    const file: StoreFile = {
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects,
      workspaces: current.workspaces,
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      return {
        ...current,
        recentProjects,
        error:
          'this conversation could not be recorded as the project\'s latest, so ' +
          `opening the project again may return to an earlier one: ${describe(error)}`,
      };
    }
    return {
      filePath: this.filePath,
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects,
      workspaces: current.workspaces,
      error: null,
      readOnly: false,
    };
  }

  /**
   * Remove remembered projects from the list.
   *
   * **This is the only thing it does.** Nothing is deleted from disk, no project
   * folder is touched and no saved conversation is removed or rewritten — the
   * conversations live in their own directory keyed by conversation ID, and a
   * conversation whose project has been forgotten is still listed and still
   * readable. The entry's `lastConversationId` goes with the entry, so opening that
   * folder again would start a new conversation rather than continue the old one;
   * the old one is reached from Saved conversations, which is where it always was.
   *
   * DSP-5 is why this exists: nine of the ten remembered entries were throwaway
   * `%TEMP%` repositories left by overnight verification runs, several no longer on
   * disk, and the list had no way to drop one. `MAX_RECENT` alone does not help —
   * it evicts the oldest, which is the opposite of what was wanted.
   *
   * A path that is not in the list is not an error: the caller is a window that may
   * be working from a list read a moment ago, and "it is not there" is the state it
   * asked for. `removed` says what actually happened.
   *
   * A file this build must not rewrite is refused rather than pruned in memory.
   * Reporting a removal that the next read would undo is worse than saying no.
   */
  forget(projectPaths: readonly string[]): ForgetOutcome {
    const current = this.read();
    const targets = projectPaths
      .filter((value) => typeof value === 'string' && value.trim() !== '')
      .map((value) => path.resolve(value));
    if (targets.length === 0) {
      return { state: current, removed: [], notFound: [] };
    }

    const removed = current.recentProjects
      .filter((entry) => targets.some((target) => samePath(entry.path, target)))
      .map((entry) => entry.path);
    const notFound = targets.filter(
      (target) => !current.recentProjects.some((entry) => samePath(entry.path, target)),
    );

    if (current.readOnly) {
      return {
        state: {
          ...current,
          error:
            `nothing was removed: ${this.filePath} ` +
            `${current.error ?? 'cannot be rewritten by this build'}`,
        },
        removed: [],
        notFound,
      };
    }
    if (removed.length === 0) {
      return { state: current, removed, notFound };
    }

    const recentProjects = current.recentProjects.filter(
      (entry) => !targets.some((target) => samePath(entry.path, target)),
    );
    const file: StoreFile = {
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects,
      workspaces: current.workspaces,
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      // The list on disk is unchanged, so the list reported here has to be too.
      // A window showing the entry as gone until the next restart would be lying.
      return {
        state: {
          ...current,
          error:
            'the list could not be changed, so nothing was removed and the ' +
            `entries are still remembered: ${describe(error)}`,
        },
        removed: [],
        notFound,
      };
    }
    return {
      state: {
        filePath: this.filePath,
        formatVersion: PROJECT_STORE_FORMAT_VERSION,
        recentProjects,
        workspaces: current.workspaces,
        error: null,
        readOnly: false,
      },
      removed,
      notFound,
    };
  }

  /**
   * The arrangement of folders a person last had open, or `null`.
   *
   * Read at startup for **one thing**: the loop definition that was chosen. DSpatch
   * deliberately does not reopen the folders on its own — opening a folder is an act
   * a person performs, and a window that had opened three of them before anyone
   * asked would be the interface deciding the work. The folders are here so that
   * reopening the arrangement is offered, not so that it happens.
   */
  currentWorkspace(): WorkspaceRecord | null {
    return this.read().workspaces[0] ?? null;
  }

  /**
   * Record the arrangement now open, moving it to the front.
   *
   * Keyed by `filePath` when there is one, so saving the same workspace twice keeps
   * one entry, and by "the unsaved one" otherwise, of which there is at most one.
   *
   * This is where DSP-68's deferred question lands. The manual loop-definition picker
   * remembered nothing across a restart because the right owner of that memory was
   * this card; `loopDefinitionKey` is that owner. Nothing about a run is written here
   * and there is no field to write it in.
   */
  rememberWorkspace(
    workspace: {
      readonly filePath: string | null;
      readonly folders: readonly string[];
      readonly loopDefinitionKey: string | null;
    },
    atUtc: string = new Date().toISOString(),
  ): ProjectStoreState {
    const current = this.read();
    const entry: WorkspaceRecord = {
      filePath: workspace.filePath === null ? null : path.resolve(workspace.filePath),
      folders: workspace.folders.map((folder) => path.resolve(folder)),
      loopDefinitionKey: workspace.loopDefinitionKey,
      lastOpenedAtUtc: atUtc,
    };
    const sameEntry = (other: WorkspaceRecord): boolean =>
      entry.filePath === null
        ? other.filePath === null
        : other.filePath !== null && samePath(other.filePath, entry.filePath);
    const workspaces = [entry, ...current.workspaces.filter((old) => !sameEntry(old))].slice(
      0,
      MAX_WORKSPACES,
    );

    if (current.readOnly) {
      return { ...current, workspaces };
    }
    const file: StoreFile = {
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects: current.recentProjects,
      workspaces,
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      return {
        ...current,
        workspaces,
        error:
          'the folders you have open could not be remembered for next time: ' +
          `${describe(error)}`,
      };
    }
    return {
      filePath: this.filePath,
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      recentProjects: current.recentProjects,
      workspaces,
      error: null,
      readOnly: false,
    };
  }
}

/** What {@link ProjectStore.forget} did, separated from what was asked for. */
export interface ForgetOutcome {
  readonly state: ProjectStoreState;
  /** Entries actually dropped from the file. Empty when the write was refused. */
  readonly removed: readonly string[];
  /** Paths that were not in the list to begin with. Not a failure. */
  readonly notFound: readonly string[];
}

/** Windows paths differ in case without differing. */
export function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
