/**
 * Which workspaces the start page lists, and how a row says where one is (DSP-149).
 *
 * Values and decisions only: no `node:fs`, so the renderer draws with the same rules a
 * test checks.
 */

import type { RecentWorkspaceEntry } from './bridge';

/** At most this many on the start page; View all shows every one. */
export const START_PAGE_MAX = 10;
/** The start page tops the recent ones up with older ones until it shows this many. */
export const START_PAGE_MIN = 5;
/** "Recent" on the start page: opened within the last three months. */
export const RECENT_WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The start page's selection, from entries already sorted by last opened.
 *
 * Every workspace opened in the last three months, topped up with older ones until five
 * are shown when there are that many, and never more than ten. An entry with no time
 * (the project named at startup) counts as recent: it is offered because it is wanted
 * now.
 */
export function startPageSelection(
  entries: readonly RecentWorkspaceEntry[],
  nowMs: number,
): readonly RecentWorkspaceEntry[] {
  const cutoff = nowMs - RECENT_WINDOW_DAYS * DAY_MS;
  const isRecent = (entry: RecentWorkspaceEntry): boolean => {
    if (entry.lastOpenedAtUtc === null) {
      return true;
    }
    const at = Date.parse(entry.lastOpenedAtUtc);
    return Number.isFinite(at) && at >= cutoff;
  };
  const recent = entries.filter(isRecent);
  const shown =
    recent.length >= START_PAGE_MIN
      ? recent
      : [...recent, ...entries.filter((entry) => !isRecent(entry))].slice(0, START_PAGE_MIN);
  return shown.slice(0, START_PAGE_MAX);
}

/**
 * What follows the primary folder's path on a row when a workspace has more folders.
 * The path itself is drawn in full and cut at its start by CSS, so its end stays
 * visible however narrow the window; every full path is the row's tooltip.
 */
export function moreFoldersLabel(folders: readonly string[]): string {
  const others = folders.length - 1;
  return others <= 0 ? '' : `+${String(others)} folder${others === 1 ? '' : 's'}`;
}

/** Every folder, one per line, for the tooltip that shows full paths on demand. */
export function fullPathsText(folders: readonly string[]): string {
  return folders.join('\n');
}

/** View all's search: by name or by any folder's path, ignoring case. */
export function matchesSearch(entry: RecentWorkspaceEntry, query: string): boolean {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') {
    return true;
  }
  return (
    entry.name.toLowerCase().includes(wanted) ||
    entry.folders.some((folder) => folder.toLowerCase().includes(wanted))
  );
}
