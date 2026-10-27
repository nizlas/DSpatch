import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AppTool, AppToolResult } from '../adapter/types';

/**
 * DSpatch's workspace functions, offered to the chat's agent as tools (DSP-149).
 *
 * The same host functions the menus and the start page use, reached through each
 * provider SDK's own tool mechanism; they replace none of the agent's tools and run in
 * the project host. What they can do is exactly what a person can do from the window:
 * look at folders on this host, create and name a workspace of existing folders, open
 * one, and add folders to the open one. They never create, move or delete a folder, and
 * the agent never writes DSpatch's own files: the host's store does.
 *
 * Opening a workspace replaces the session the agent is answering in, so it is not done
 * in the middle of the reply: the tool records it, says so, and the host opens it as
 * soon as the turn has ended. Opening sends nothing and starts no work.
 *
 * Every description below is sent to the model word for word and is shown in the
 * session details (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 1: instructions DSpatch
 * adds must be inspectable).
 */

/** What the tools need from the host. Injected, so the tools can be tested alone. */
export interface WorkspaceToolHost {
  /** Recent workspaces, most recent first. */
  recent(): readonly { readonly id: string; readonly name: string; readonly folders: readonly string[] }[];
  /** The workspace open now, or `null` (a conversation with no workspace). */
  openWorkspace(): { readonly id: string; readonly name: string; readonly folders: readonly string[] } | null;
  /** The checks a folder gets when opened; throws with the reason. Returns the resolved path. */
  checkFolder(folder: string): string;
  /** Create a workspace record of existing folders; returns its id. */
  createWorkspace(name: string, folders: readonly string[]): { readonly id: string } | { readonly problem: string };
  /** Add folders to the open workspace; returns the folders it now has, or why not. */
  addFolders(folders: readonly string[]): { readonly folders: readonly string[] } | { readonly problem: string };
  /** Open this workspace when the current turn has ended. */
  openWhenTurnEnds(workspaceId: string): void;
}

/** How far below a named place {@link findFolders} looks, and how much it may visit. */
const SEARCH_DEPTH = 3;
const SEARCH_VISIT_LIMIT = 5000;
const LIST_LIMIT = 200;

/**
 * `~` and `~/...` mean this host's home folder, and so does a relative path: never the
 * process's working directory, which is DSpatch's and not the person's (DSP-149).
 */
export function hostPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~' || trimmed === '') {
    return os.homedir();
  }
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.join(os.homedir(), trimmed);
}

function ok(text: string): AppToolResult {
  return { text, isError: false };
}

function failed(text: string): AppToolResult {
  return { text, isError: true };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '') : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Lower case with spaces, dashes, dots and underscores dropped: "Mini DAW-Lab" ~ "minidawlab". */
function loose(name: string): string {
  return name.toLowerCase().replace(/[\s._-]+/g, '');
}

function subfolders(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

/**
 * Folders under `under` whose name matches each wanted name: exact (ignoring case) and,
 * separately, close (ignoring case, spaces, dashes, dots and underscores, or containing
 * the name). Breadth first, a bounded number of folders, never into hidden folders or
 * `node_modules`. Nothing is guessed: every path returned exists.
 */
export function findFolders(
  under: string,
  names: readonly string[],
): { readonly matches: Record<string, { exact: string[]; close: string[] }>; readonly visited: number; readonly limited: boolean } {
  const matches: Record<string, { exact: string[]; close: string[] }> = {};
  for (const name of names) {
    matches[name] = { exact: [], close: [] };
  }
  let frontier = [under];
  let visited = 0;
  let limited = false;
  for (let depth = 1; depth <= SEARCH_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of frontier) {
      for (const child of subfolders(dir)) {
        visited += 1;
        if (visited > SEARCH_VISIT_LIMIT) {
          limited = true;
          break;
        }
        const base = path.basename(child);
        for (const name of names) {
          const entry = matches[name];
          if (entry === undefined) {
            continue;
          }
          if (base.toLowerCase() === name.toLowerCase()) {
            entry.exact.push(child);
          } else if (loose(base) === loose(name) || loose(base).includes(loose(name))) {
            entry.close.push(child);
          }
        }
        next.push(child);
      }
      if (limited) {
        break;
      }
    }
    if (limited) {
      break;
    }
    frontier = next;
  }
  return { matches, visited, limited };
}

export const WORKSPACE_TOOL_NAMES = [
  'list_recent_workspaces',
  'list_folders',
  'find_folders',
  'create_workspace',
  'open_workspace',
  'add_folders_to_workspace',
] as const;

export function workspaceTools(host: WorkspaceToolHost): readonly AppTool[] {
  return [
    {
      name: 'list_recent_workspaces',
      description:
        "DSpatch's Recent projects: each workspace's name and folders, most recently opened first, " +
        'and which one is open now. A workspace is a named set of one or more existing folders.',
      parameters: {},
      readOnly: true,
      execute: async () => {
        const open = host.openWorkspace();
        const recent = host.recent();
        const lines = recent.map(
          (entry) => `- ${entry.name}${open?.id === entry.id ? ' (open now)' : ''}: ${entry.folders.join(' | ')}`,
        );
        return ok(
          (open === null ? 'No workspace is open now.\n' : `Open now: ${open.name}: ${open.folders.join(' | ')}\n`) +
            (lines.length === 0 ? 'Recent projects is empty.' : `Recent projects:\n${lines.join('\n')}`),
        );
      },
    },
    {
      name: 'list_folders',
      description:
        'The folders directly inside a folder on this computer. "~" is the home folder. Use it to find ' +
        'where the person keeps projects (for example a development folder under the home folder) ' +
        'before naming paths. Lists names only; reads no file.',
      parameters: { path: { type: 'string', description: 'The folder to list, absolute or starting with ~.' } },
      readOnly: true,
      execute: async (args) => {
        const where = hostPath(text(args['path']));
        let entries: string[];
        try {
          if (!fs.statSync(where).isDirectory()) {
            return failed(`${where} is a file, not a folder.`);
          }
          entries = subfolders(where);
        } catch {
          return failed(`There is no folder at ${where} on this computer.`);
        }
        const shown = entries.slice(0, LIST_LIMIT).map((entry) => path.basename(entry));
        return ok(
          `${where} contains ${String(entries.length)} folder${entries.length === 1 ? '' : 's'}` +
            `${entries.length > LIST_LIMIT ? ` (first ${String(LIST_LIMIT)} shown)` : ''}:\n${shown.join('\n')}`,
        );
      },
    },
    {
      name: 'find_folders',
      description:
        'Look for existing folders by name below a place on this computer (a few levels deep, not ' +
        'inside hidden folders or node_modules). Returns exact and close matches per name. If a ' +
        'name has no match, or more than one, ask the person which folder they mean; never make ' +
        'up a path.',
      parameters: {
        names: { type: 'string-list', description: 'Folder names to look for, for example ["DSpatch", "MiniDAWLab"].' },
        under: { type: 'string', description: 'Where to look, absolute or starting with ~ (for example "~/development").' },
      },
      readOnly: true,
      execute: async (args) => {
        const names = strings(args['names']);
        const under = hostPath(text(args['under']));
        if (names.length === 0) {
          return failed('No folder names were given.');
        }
        try {
          if (!fs.statSync(under).isDirectory()) {
            return failed(`${under} is a file, not a folder.`);
          }
        } catch {
          return failed(`There is no folder at ${under} on this computer.`);
        }
        const found = findFolders(under, names);
        const lines = names.map((name) => {
          const entry = found.matches[name] ?? { exact: [], close: [] };
          if (entry.exact.length === 1 && entry.close.length === 0) {
            return `- ${name}: ${entry.exact[0] ?? ''}`;
          }
          if (entry.exact.length === 0 && entry.close.length === 0) {
            return `- ${name}: not found under ${under}. Ask the person where it is.`;
          }
          return (
            `- ${name}: more than one candidate, ask the person which one: ` +
            [...entry.exact, ...entry.close].join(' | ')
          );
        });
        return ok(
          `Looked under ${under}${found.limited ? ` (stopped after ${String(SEARCH_VISIT_LIMIT)} folders)` : ''}:\n` +
            lines.join('\n'),
        );
      },
    },
    {
      name: 'create_workspace',
      description:
        'Create a named DSpatch workspace of existing folders on this computer and open it when your ' +
        'reply ends; this conversation then continues there. The first folder is the primary one, ' +
        'where commands start. Folders are not created, moved or changed. Use full paths you have ' +
        'found or been given; if a folder is uncertain, ask first.',
      parameters: {
        name: { type: 'string', description: 'What to call the workspace.' },
        folders: { type: 'string-list', description: 'Full paths of existing folders, primary first.' },
      },
      readOnly: false,
      execute: async (args) => {
        const folders = strings(args['folders']);
        if (folders.length === 0) {
          return failed('No folders were given. Ask the person which folders the workspace should have.');
        }
        const checked: string[] = [];
        for (const folder of folders) {
          try {
            checked.push(host.checkFolder(hostPath(folder)));
          } catch (error) {
            return failed(
              `Nothing was created: ${error instanceof Error ? error.message : String(error)} ` +
                'Ask the person about this folder.',
            );
          }
        }
        const created = host.createWorkspace(text(args['name']), checked);
        if ('problem' in created) {
          return failed(`Nothing was created: ${created.problem}`);
        }
        host.openWhenTurnEnds(created.id);
        return ok(
          `Created the workspace "${text(args['name']).trim() || path.basename(checked[0] ?? '')}" with ` +
            `${checked.join(' | ')}. DSpatch opens it when this reply ends and the conversation continues ` +
            'there; it is also in Recent projects. Opening it sends nothing and starts no work, so tell the ' +
            'person what you will do next and let them continue.',
        );
      },
    },
    {
      name: 'open_workspace',
      description:
        'Open a workspace from Recent projects by its name when your reply ends; this conversation ' +
        'then continues there as a chat of its own. If several workspaces have similar names, ask.',
      parameters: { name: { type: 'string', description: 'The workspace name as listed in Recent projects.' } },
      readOnly: false,
      execute: async (args) => {
        const wanted = text(args['name']).trim().toLowerCase();
        const hits = host.recent().filter((entry) => entry.name.toLowerCase() === wanted);
        if (hits.length !== 1) {
          return failed(
            hits.length === 0
              ? `No workspace in Recent projects is called "${text(args['name'])}". Use list_recent_workspaces, or ask.`
              : `More than one workspace is called "${text(args['name'])}". Ask the person which one.`,
          );
        }
        const hit = hits[0];
        if (hit === undefined) {
          return failed('No such workspace.');
        }
        host.openWhenTurnEnds(hit.id);
        return ok(`DSpatch opens "${hit.name}" when this reply ends; the conversation continues there.`);
      },
    },
    {
      name: 'add_folders_to_workspace',
      description:
        'Add existing folders to the workspace that is open now. You can work in them from the next ' +
        'message. Folders are not created, moved or changed. Needs an open workspace.',
      parameters: { folders: { type: 'string-list', description: 'Full paths of existing folders.' } },
      readOnly: false,
      execute: async (args) => {
        if (host.openWorkspace() === null) {
          return failed('No workspace is open. Create one with create_workspace, or ask the person which to open.');
        }
        const folders = strings(args['folders']);
        const checked: string[] = [];
        for (const folder of folders) {
          try {
            checked.push(host.checkFolder(hostPath(folder)));
          } catch (error) {
            return failed(`Nothing was added: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        if (checked.length === 0) {
          return failed('No folders were given.');
        }
        const outcome = host.addFolders(checked);
        if ('problem' in outcome) {
          return failed(`Nothing was added: ${outcome.problem}`);
        }
        return ok(
          `The workspace now has ${outcome.folders.join(' | ')}. The new folders are available to you from ` +
            'the next message.',
        );
      },
    },
  ];
}
