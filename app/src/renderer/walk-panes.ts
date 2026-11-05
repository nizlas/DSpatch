/**
 * Which walk places share a code pane (DSP-175).
 *
 * A walk step can explain one change from both sides: a place with its focus on the
 * old lines and a place with its focus on the new lines of the same hunk. Both used to
 * get a pane of their own, each drawing the same Before → After diff. Now places whose
 * focus lies in the same change area of the same changed file share one pane, and each
 * stays a station of its own: choosing it moves the focus mark and the explanation
 * inside that pane.
 *
 * The change area of a focus is the set of the file's `-U0` hunks it touches, each hunk
 * widened by Git's default three lines of context on the focus's own side (base lines
 * for a base focus, target lines for a target focus), so a focus that starts on the
 * unchanged line just above a change still belongs to it. A station joins the pane of
 * the station just before it in the walk when both are in the same changed file and
 * its hunks overlap the hunks of that pane so far. Only neighbours in walk order are
 * joined: the map reads left to right in walk order, and a later return to the same
 * change still opens a new pane further right. Places in separate regions of a file,
 * in other files, in unchanged files or in binary files keep panes of their own.
 *
 * This is presentation only: walk definitions, their places and references, review
 * coverage and navigation are untouched, so saved walks get it without regeneration.
 */
import type { RevisionSide } from '../shared/review-model';
import type { ReviewWords } from './review-i18n';

/** Lines on either side of a hunk that still belong to its change area: Git's default context. */
export const CHANGE_AREA_MARGIN = 3;

export interface PaneFocus {
  readonly path: string;
  readonly side: RevisionSide;
  /** 1-based, inclusive. */
  readonly start: number;
  readonly end: number;
}

export interface PaneHunk {
  readonly baseStart: number;
  readonly baseCount: number;
  readonly targetStart: number;
  readonly targetCount: number;
}

/** What grouping needs of a changed file; null for a file the change does not touch. */
export interface PaneDiffFile {
  readonly binary: boolean;
  readonly hunks: readonly PaneHunk[];
}

export interface WalkPane {
  /** Position on the map, from 0, in walk order. */
  readonly index: number;
  readonly path: string;
  /** The stations shown in this pane, in walk order; never empty. */
  readonly stations: readonly number[];
}

/** The hunk's lines on one side, widened by the margin; a side with no lines is the gap after its start line. */
function areaOf(hunk: PaneHunk, side: RevisionSide): readonly [number, number] {
  const start = side === 'base' ? hunk.baseStart : hunk.targetStart;
  const count = side === 'base' ? hunk.baseCount : hunk.targetCount;
  if (count > 0) {
    return [start - CHANGE_AREA_MARGIN, start + count - 1 + CHANGE_AREA_MARGIN];
  }
  // `-U0` names the line after which lines were added (or removed, on the other side).
  return [start + 1 - CHANGE_AREA_MARGIN, start + CHANGE_AREA_MARGIN];
}

/** The indexes of the file's hunks whose change area the focus touches. */
export function hunksOf(focus: PaneFocus, file: PaneDiffFile | null): ReadonlySet<number> {
  const out = new Set<number>();
  if (file === null || file.binary) {
    return out;
  }
  file.hunks.forEach((hunk, index) => {
    const [from, to] = areaOf(hunk, focus.side);
    if (focus.start <= to && focus.end >= from) {
      out.add(index);
    }
  });
  return out;
}

/** The panes of a walk's stations, given each station's focus in walk order. */
export function panesOf(foci: readonly PaneFocus[], diffFileOf: (path: string) => PaneDiffFile | null): WalkPane[] {
  const panes: { index: number; path: string; stations: number[]; hunks: Set<number> }[] = [];
  foci.forEach((focus, station) => {
    const hunks = hunksOf(focus, diffFileOf(focus.path));
    const last = panes[panes.length - 1];
    if (last !== undefined && last.path === focus.path && [...hunks].some((hunk) => last.hunks.has(hunk))) {
      last.stations.push(station);
      hunks.forEach((hunk) => last.hunks.add(hunk));
      return;
    }
    panes.push({ index: panes.length, path: focus.path, stations: [station], hunks: new Set(hunks) });
  });
  return panes.map(({ index, path, stations }) => ({ index, path, stations }));
}

/** For each station, the index of its pane. */
export function paneOfStation(panes: readonly WalkPane[]): number[] {
  const out: number[] = [];
  for (const pane of panes) {
    for (const station of pane.stations) {
      out[station] = pane.index;
    }
  }
  return out;
}

/**
 * The station a pane presents — whose focus it marks and which panning activates when
 * the pane wins: the active station when it is in the pane, else the pane's station
 * nearest it in walk order (the first of a pane further on, the last of one before).
 * Travelling forward thus enters a pane at its first station, travelling back at its
 * last, as Next and Previous would.
 */
export function shownStation(pane: WalkPane, active: number): number {
  if (pane.stations.includes(active)) {
    return active;
  }
  const first = pane.stations[0] ?? active;
  const last = pane.stations[pane.stations.length - 1] ?? first;
  return active < first ? first : last;
}

/** The repository and commits of a walk's revision pair, for naming a place in full. */
export interface FocusRevision {
  readonly repository: string;
  readonly base: string;
  readonly target: string;
}

/** The active place in full: its name, repository, side and commit, file and lines (DSP-175). */
export function focusIdentity(name: string, path: string, focus: { readonly side: RevisionSide; readonly start: number; readonly end: number }, revision: FocusRevision | undefined, words: ReviewWords): string {
  const repository = revision === undefined ? '' : (revision.repository.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '');
  const commit = revision === undefined ? '' : (focus.side === 'base' ? revision.base : revision.target).slice(0, 7);
  const at = `${focus.side === 'base' ? words.view.shownFrom : words.view.shownTo}${commit === '' ? '' : ` ${commit}`}`;
  const lines = focus.start === focus.end ? words.timeline.lineAt(focus.start) : words.timeline.linesAt(focus.start, focus.end);
  return [name, repository, at, `${path} ${lines}`].filter((part) => part !== '').join(' · ');
}
