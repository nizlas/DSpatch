import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * DSpatch's workspaces, in one small versioned JSON file.
 *
 * One file, versioned from the start, because DSP-4 extended this store with
 * conversation history rather than introduce a second one. `formatVersion` exists so
 * that an **older** DSpatch meeting a newer file refuses to rewrite it instead of
 * quietly discarding fields it does not understand.
 *
 * Nothing here is essential to operating DSpatch: a missing or unreadable file costs
 * the list of recent workspaces and nothing else. So every failure is reported and
 * none of them is fatal, and a file that cannot be parsed is left on disk rather than
 * overwritten: it is the user's data, and it may be recoverable by hand.
 */

/**
 * 3 since DSP-149 gave a workspace an identity, a name and its own conversation.
 *
 * Version 2 (DSP-71) kept `recentProjects` — single folders — beside `workspaces`, an
 * arrangement of folders keyed by a saved file. DSP-149 made the workspace the thing a
 * person opens: Recent lists workspaces, a workspace holds one folder or several, and
 * its conversation pointer lives on it. A version-2 file is read and migrated in
 * memory (every remembered folder becomes a one-folder workspace, named after the
 * folder, keeping its conversation) and written as version 3 on the next change. An
 * older build meeting a version-3 file reads the `recentProjects` this build still
 * writes beside the workspaces, and refuses to write.
 */
export const PROJECT_STORE_FORMAT_VERSION = 3;

/**
 * A workspace: a persistent identity, a name and an ordered collection of folders.
 *
 * **The first folder is the primary.** It is the agent's working directory — the
 * shell's `cwd`, and what each provider scopes its own session store by — so it is
 * part of a provider session's resume key. The other folders are working folders of
 * the same sessions (DSP-72, DSP-149). Order is the person's.
 *
 * **The conversation pointer is here.** DSP-71 and DSP-72 kept it off the workspace
 * while "the open project" was a folder and a workspace was an arrangement around it:
 * with one primary there was one answer, recorded on the folder. DSP-149 made the
 * workspace the thing that is opened and that owns its chats, so the answer moved with
 * it. It is still one answer: a workspace has one primary, and the conversation it
 * continues is resumed against that primary.
 *
 * `hiddenFromRecent` is *Remove from recent*: the entry leaves the list and nothing
 * else changes. The workspace keeps its identity, name, folders and conversations, and
 * opening its first folder again brings it back.
 */
export interface WorkspaceRecord {
  readonly id: string;
  readonly name: string;
  readonly folders: readonly string[];
  /** The saved `.dspatch-workspace.json` this workspace was opened from or saved to. */
  readonly filePath: string | null;
  /** The loop definition chosen for this workspace (DSP-68, DSP-71). */
  readonly loopDefinitionKey: string | null;
  readonly lastOpenedAtUtc: string;
  readonly openCount: number;
  /** The chat this workspace was last worked in, or `null`. */
  readonly lastConversationId: string | null;
  readonly hiddenFromRecent: boolean;
}

/**
 * Written beside the workspaces for an older build to read (version 2 and earlier).
 *
 * Derived on every write from the workspaces' primaries; never read by this build
 * except when migrating a file that has no version-3 workspaces yet.
 */
export interface RecentProject {
  readonly path: string;
  readonly lastOpenedAtUtc: string;
  readonly openCount: number;
  readonly lastConversationId: string | null;
}

interface StoreFile {
  readonly formatVersion: number;
  readonly workspaces: readonly WorkspaceRecord[];
  /** The conversation begun before any workspace was chosen (DSP-149), or `null`. */
  readonly looseConversationId: string | null;
  readonly recentProjects: readonly RecentProject[];
}

export interface ProjectStoreState {
  readonly filePath: string;
  readonly formatVersion: number;
  /** Most recently opened first, hidden ones included. */
  readonly workspaces: readonly WorkspaceRecord[];
  readonly looseConversationId: string | null;
  /** Non-null means the list is incomplete or absent, and says why. */
  readonly error: string | null;
  /** True when the file is from a later DSpatch, or unreadable, and must not be rewritten. */
  readonly readOnly: boolean;
}

/** Far more than anyone reopens; View all shows every one of them. */
const MAX_WORKSPACES = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Windows paths differ in case without differing. */
export function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/** The last segment of a folder path; the name a new workspace gets. */
export function defaultWorkspaceName(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '');
  const name = path.basename(trimmed);
  return name === '' ? folder : name;
}

/**
 * A stable identity for a workspace migrated from a version-2 entry.
 *
 * Derived from its first folder rather than random, so reading the same old file twice
 * (or in a build that cannot write it) gives the same identity both times.
 */
function migratedId(primary: string): string {
  const key = process.platform === 'win32' ? primary.toLowerCase() : primary;
  return `ws-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
}

export function newWorkspaceId(): string {
  return `ws-${crypto.randomUUID()}`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function parseFolders(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const folders: string[] = [];
  for (const folder of value) {
    if (typeof folder === 'string' && folder.trim() !== '' && !folders.some((kept) => samePath(kept, folder))) {
      folders.push(folder);
    }
  }
  return folders;
}

function parseRecentProjects(value: unknown): RecentProject[] {
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
    const openCount = entry['openCount'];
    projects.push({
      path: projectPath,
      lastOpenedAtUtc: typeof entry['lastOpenedAtUtc'] === 'string' ? entry['lastOpenedAtUtc'] : '',
      openCount: typeof openCount === 'number' && Number.isFinite(openCount) ? openCount : 1,
      lastConversationId: stringOrNull(entry['lastConversationId']),
    });
  }
  return projects;
}

/** A version-3 workspace entry, or `null` when it is not usable. */
function parseWorkspace(entry: unknown): WorkspaceRecord | null {
  if (!isRecord(entry)) {
    return null;
  }
  const folders = parseFolders(entry['folders']);
  const id = stringOrNull(entry['id']);
  if (folders.length === 0 || id === null) {
    return null;
  }
  const name = stringOrNull(entry['name']);
  const openCount = entry['openCount'];
  return {
    id,
    name: name ?? defaultWorkspaceName(folders[0] ?? ''),
    folders,
    filePath: stringOrNull(entry['filePath']),
    loopDefinitionKey: stringOrNull(entry['loopDefinitionKey']),
    lastOpenedAtUtc: typeof entry['lastOpenedAtUtc'] === 'string' ? entry['lastOpenedAtUtc'] : '',
    openCount: typeof openCount === 'number' && Number.isFinite(openCount) ? openCount : 1,
    lastConversationId: stringOrNull(entry['lastConversationId']),
    hiddenFromRecent: entry['hiddenFromRecent'] === true,
  };
}

/**
 * A version-1 or version-2 file's contents as version-3 workspaces.
 *
 * Every remembered project becomes a one-folder workspace named after its folder and
 * keeping its conversation. A version-2 arrangement whose first folder is such a
 * project lends it its extra folders and loop definition; one whose first folder is
 * not remembered becomes a workspace of its own. Nothing is dropped.
 */
function migrateVersion2(parsed: Record<string, unknown>): WorkspaceRecord[] {
  const projects = parseRecentProjects(parsed['recentProjects']);
  const arrangements = Array.isArray(parsed['workspaces']) ? parsed['workspaces'] : [];
  const records: WorkspaceRecord[] = projects.map((project) => ({
    id: migratedId(project.path),
    name: defaultWorkspaceName(project.path),
    folders: [project.path],
    filePath: null,
    loopDefinitionKey: null,
    lastOpenedAtUtc: project.lastOpenedAtUtc,
    openCount: project.openCount,
    lastConversationId: project.lastConversationId,
    hiddenFromRecent: false,
  }));
  for (const arrangement of arrangements) {
    if (!isRecord(arrangement)) {
      continue;
    }
    const folders = parseFolders(arrangement['folders']);
    const primary = folders[0];
    if (primary === undefined) {
      continue;
    }
    const at = typeof arrangement['lastOpenedAtUtc'] === 'string' ? arrangement['lastOpenedAtUtc'] : '';
    const index = records.findIndex((record) => samePath(record.folders[0] ?? '', primary));
    const existing = index === -1 ? null : records[index];
    if (existing === null || existing === undefined) {
      records.push({
        id: migratedId(primary),
        name: defaultWorkspaceName(primary),
        folders,
        filePath: stringOrNull(arrangement['filePath']),
        loopDefinitionKey: stringOrNull(arrangement['loopDefinitionKey']),
        lastOpenedAtUtc: at,
        openCount: 1,
        lastConversationId: null,
        hiddenFromRecent: false,
      });
      continue;
    }
    if (existing.folders.length > 1) {
      // A second arrangement over the same first folder; the newer one was read first.
      continue;
    }
    records[index] = {
      ...existing,
      folders,
      filePath: stringOrNull(arrangement['filePath']),
      loopDefinitionKey: stringOrNull(arrangement['loopDefinitionKey']),
      lastOpenedAtUtc: existing.lastOpenedAtUtc > at ? existing.lastOpenedAtUtc : at,
    };
  }
  return records;
}

/** Most recently opened first; the order everything reads the list in. */
function byRecency(records: readonly WorkspaceRecord[]): WorkspaceRecord[] {
  return [...records].sort((left, right) =>
    left.lastOpenedAtUtc < right.lastOpenedAtUtc ? 1 : left.lastOpenedAtUtc > right.lastOpenedAtUtc ? -1 : 0,
  );
}

/** DSP-149: Recent projects is what was opened and not removed from the list. */
export function inRecent(record: WorkspaceRecord): boolean {
  return !record.hiddenFromRecent && record.openCount > 0;
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
      workspaces: [],
      looseConversationId: null,
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

    const workspaces =
      version >= 3
        ? (Array.isArray(parsed['workspaces']) ? parsed['workspaces'] : [])
            .map(parseWorkspace)
            .filter((record): record is WorkspaceRecord => record !== null)
        : migrateVersion2(parsed);
    const looseConversationId = version >= 3 ? stringOrNull(parsed['looseConversationId']) : null;
    const newer = version > PROJECT_STORE_FORMAT_VERSION;
    return {
      filePath: this.filePath,
      formatVersion: version,
      workspaces: byRecency(workspaces).slice(0, MAX_WORKSPACES),
      looseConversationId,
      error: newer
        ? `the settings file at ${this.filePath} is format version ${String(version)}, ` +
          `newer than the ${String(PROJECT_STORE_FORMAT_VERSION)} this build writes. It ` +
          'is being read but will not be changed.'
        : null,
      // Read what is recognisable; refuse to write. A newer DSpatch may hold fields this
      // one would silently drop on the next save.
      readOnly: newer,
    };
  }

  workspace(id: string): WorkspaceRecord | null {
    return this.read().workspaces.find((record) => record.id === id) ?? null;
  }

  /**
   * The workspace whose first folder this is: the most recently opened one, hidden or
   * not. `null` when there is none.
   */
  workspaceForPrimary(folder: string): WorkspaceRecord | null {
    const resolved = path.resolve(folder);
    return this.read().workspaces.find((record) => samePath(record.folders[0] ?? '', resolved)) ?? null;
  }

  /**
   * Open Project: the workspace of this first folder, reopened, or a new one created
   * with the folder's name. Either way it is moved to the front of Recent and shown
   * there again if it had been removed from it.
   */
  openFolder(folder: string, atUtc: string = new Date().toISOString()): StoreOutcome {
    const resolved = path.resolve(folder);
    const existing = this.workspaceForPrimary(resolved);
    if (existing !== null) {
      return this.recordOpened(existing.id, atUtc);
    }
    return this.createWorkspace({ name: defaultWorkspaceName(resolved), folders: [resolved] }, atUtc);
  }

  /**
   * A new workspace of these folders, the first being the primary, at the front of
   * Recent. The folders are recorded as given (resolved); none is created or moved.
   */
  createWorkspace(
    request: {
      readonly name: string;
      readonly folders: readonly string[];
      /**
       * DSP-149: whether this is an opening. A workspace the chat creates is recorded
       * unopened and enters Recent when it is actually opened; Recent is the history of
       * what was opened, not of what was made.
       */
      readonly opened?: boolean;
    },
    atUtc: string = new Date().toISOString(),
  ): StoreOutcome {
    const opened = request.opened !== false;
    const folders = parseFolders(request.folders.map((folder) => path.resolve(folder)));
    const primary = folders[0];
    if (primary === undefined) {
      return { state: this.read(), workspace: null, problem: 'A workspace needs at least one folder.' };
    }
    const name = request.name.trim() === '' ? defaultWorkspaceName(primary) : request.name.trim();
    const record: WorkspaceRecord = {
      id: newWorkspaceId(),
      name,
      folders,
      filePath: null,
      loopDefinitionKey: null,
      lastOpenedAtUtc: opened ? atUtc : '',
      openCount: opened ? 1 : 0,
      lastConversationId: null,
      hiddenFromRecent: false,
    };
    return this.write((current) => [record, ...current], record.id);
  }

  /** Moved to the front of Recent, counted, and shown there again. */
  recordOpened(id: string, atUtc: string = new Date().toISOString()): StoreOutcome {
    return this.write(
      (current) =>
        current.map((record) =>
          record.id === id
            ? { ...record, lastOpenedAtUtc: atUtc, openCount: record.openCount + 1, hiddenFromRecent: false }
            : record,
        ),
      id,
    );
  }

  /**
   * Change what a workspace is called, which folders it has, which loop it chose or
   * which chat it continues. Nothing about when it was opened changes: choosing a chat
   * or adding a folder is not an opening, and Recent must not reorder itself for it.
   */
  updateWorkspace(
    id: string,
    patch: {
      readonly name?: string;
      readonly folders?: readonly string[];
      readonly loopDefinitionKey?: string | null;
      readonly lastConversationId?: string | null;
      readonly filePath?: string | null;
    },
  ): StoreOutcome {
    return this.write(
      (current) =>
        current.map((record) => {
          if (record.id !== id) {
            return record;
          }
          const folders =
            patch.folders === undefined ? record.folders : parseFolders(patch.folders.map((f) => path.resolve(f)));
          return {
            ...record,
            ...(patch.name === undefined || patch.name.trim() === '' ? {} : { name: patch.name.trim() }),
            folders: folders.length === 0 ? record.folders : folders,
            ...(patch.loopDefinitionKey === undefined ? {} : { loopDefinitionKey: patch.loopDefinitionKey }),
            ...(patch.lastConversationId === undefined ? {} : { lastConversationId: patch.lastConversationId }),
            ...(patch.filePath === undefined ? {} : { filePath: patch.filePath }),
          };
        }),
      id,
    );
  }

  /**
   * Remove from recent: **the list entry and nothing else.** No folder is touched, no
   * conversation is removed and the workspace keeps its identity, name and folders —
   * opening its first folder again brings it back as it was. Unknown ids are ignored.
   */
  removeFromRecent(ids: readonly string[]): StoreOutcome {
    return this.write((current) =>
      current.map((record) => (ids.includes(record.id) ? { ...record, hiddenFromRecent: true } : record)),
    );
  }

  /** The conversation begun before any workspace was chosen, or `null` to clear it. */
  setLooseConversation(conversationId: string | null): StoreOutcome {
    return this.write((current) => current, undefined, conversationId);
  }

  private write(
    change: (current: readonly WorkspaceRecord[]) => readonly WorkspaceRecord[],
    focusId?: string,
    looseConversationId?: string | null,
  ): StoreOutcome {
    const current = this.read();
    const workspaces = byRecency(change(current.workspaces)).slice(0, MAX_WORKSPACES);
    const loose = looseConversationId === undefined ? current.looseConversationId : looseConversationId;
    const next: ProjectStoreState = { ...current, workspaces, looseConversationId: loose };
    const workspace = focusId === undefined ? null : (workspaces.find((record) => record.id === focusId) ?? null);
    if (current.readOnly) {
      return {
        state: next,
        workspace,
        problem:
          `DSpatch could not remember this for next time: ${current.error ?? 'the settings file cannot be rewritten by this build'}`,
      };
    }
    const file: StoreFile = {
      formatVersion: PROJECT_STORE_FORMAT_VERSION,
      workspaces,
      looseConversationId: loose,
      recentProjects: workspaces
        .filter((record) => !record.hiddenFromRecent && record.openCount > 0)
        .map((record) => ({
          path: record.folders[0] ?? '',
          lastOpenedAtUtc: record.lastOpenedAtUtc,
          openCount: record.openCount,
          lastConversationId: record.lastConversationId,
        })),
    };
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    } catch (error) {
      return {
        state: { ...next, error: `DSpatch could not remember this for next time: ${describe(error)}` },
        workspace,
        problem: `DSpatch could not remember this for next time: ${describe(error)}`,
      };
    }
    return {
      state: { ...next, formatVersion: PROJECT_STORE_FORMAT_VERSION, error: null, readOnly: false },
      workspace,
      problem: null,
    };
  }
}

/** What a change did: the state as it now stands, the workspace concerned, and any failure. */
export interface StoreOutcome {
  readonly state: ProjectStoreState;
  readonly workspace: WorkspaceRecord | null;
  /** Set when the change could not be written, and says why. */
  readonly problem: string | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
