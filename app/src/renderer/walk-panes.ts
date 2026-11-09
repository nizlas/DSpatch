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
 * the station just before it in the walk only as the other side of the same change: the
 * pane holds one station so far, at the other side of the same changed file, and their
 * hunks overlap (DSP-185: one pane per code place; before it, any station in the same
 * change area joined, so close places of one file shared a pane that scrolled). Only neighbours in walk order are
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

/** A station shape sufficient for pane and stop grouping. */
export interface PaneStation {
  readonly stepId: string;
  readonly placeIndex: number;
  readonly focus: PaneFocus;
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
  const panes: { index: number; path: string; side: RevisionSide; stations: number[]; hunks: Set<number> }[] = [];
  foci.forEach((focus, station) => {
    const hunks = hunksOf(focus, diffFileOf(focus.path));
    const last = panes[panes.length - 1];
    // DSP-185: a pane per place. Only the other side of the same change joins: one station of
    // the pane so far, at the other side, in the same change area. Two places at the same side
    // of one file are two panes however close, so stepping never scrolls one shared file view.
    if (last !== undefined && last.path === focus.path && last.stations.length === 1 && last.side !== focus.side && [...hunks].some((hunk) => last.hunks.has(hunk))) {
      last.stations.push(station);
      hunks.forEach((hunk) => last.hunks.add(hunk));
      return;
    }
    panes.push({ index: panes.length, path: focus.path, side: focus.side, stations: [station], hunks: new Set(hunks) });
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

export interface WalkStop {
  /** Position in walk order, from 0. */
  readonly index: number;
  readonly stepId: string;
  /** Consecutive stations represented by this stop, in walk order. */
  readonly stations: readonly number[];
  /** The place indexes of those stations within the step. */
  readonly places: readonly number[];
  /** The pane that this stop follows. */
  readonly pane: number;
  /** True when a From/To pair of one change is merged into one stop. */
  readonly merged: boolean;
}

/**
 * Navigation stops over a walk's stations, reusing pane grouping:
 * adjacent stations in one step that share one pane and together carry both
 * sides of the change become one stop; everything else stays separate.
 */
export function stopsOf(stations: readonly PaneStation[], paneOf: readonly number[]): WalkStop[] {
  const out: WalkStop[] = [];
  const push = (members: readonly number[]): void => {
    if (members.length === 0) {
      return;
    }
    const first = stations[members[0] ?? -1];
    if (first === undefined) {
      return;
    }
    const sides = new Set<RevisionSide>();
    members.forEach((index) => {
      const station = stations[index];
      if (station !== undefined) {
        sides.add(station.focus.side);
      }
    });
    const merged = members.length > 1 && sides.has('base') && sides.has('target');
    if (merged) {
      out.push({
        index: out.length,
        stepId: first.stepId,
        stations: [...members],
        places: members.map((index) => stations[index]?.placeIndex ?? 0),
        pane: paneOf[members[0] ?? -1] ?? -1,
        merged: true,
      });
      return;
    }
    members.forEach((index) => {
      const station = stations[index];
      if (station === undefined) {
        return;
      }
      out.push({
        index: out.length,
        stepId: station.stepId,
        stations: [index],
        places: [station.placeIndex],
        pane: paneOf[index] ?? -1,
        merged: false,
      });
    });
  };
  let start = 0;
  while (start < stations.length) {
    const head = stations[start];
    if (head === undefined) {
      start += 1;
      continue;
    }
    const pane = paneOf[start] ?? -1;
    let end = start + 1;
    while (end < stations.length) {
      const next = stations[end];
      if (next === undefined || next.stepId !== head.stepId || (paneOf[end] ?? -1) !== pane) {
        break;
      }
      end += 1;
    }
    push(Array.from({ length: end - start }, (_, at) => start + at));
    start = end;
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
