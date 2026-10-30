import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { HostBrowsePage } from '../shared/host-link';

/**
 * One folder on the host, for a person choosing a project on it (DSP-111). Names only: no file
 * is read, and seeing a name gives no agent anything. `null` starts at the home folder.
 */
export function browseHostFolder(folder: string | null): HostBrowsePage {
  const target = path.resolve(folder ?? os.homedir());
  const parent = path.dirname(target);
  const page = { path: target, parent: parent === target ? null : parent };
  try {
    const entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isFile() || entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, kind: entry.isFile() ? ('file' as const) : ('folder' as const) }))
      .sort((one, other) => (one.kind === other.kind ? one.name.localeCompare(other.name) : one.kind === 'folder' ? -1 : 1));
    return { ...page, entries, error: null };
  } catch (error) {
    return { ...page, entries: [], error: error instanceof Error ? error.message : String(error) };
  }
}
