import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';

import { Inline, LineGutter, TokensView, fileName, lineDigits, rangeText, rowsOf, useRows, type Files } from './review-code';
import { pick, type ReviewWords } from './review-i18n';
import { activationLine } from './walk-activation';
import { placeStructures, structureLines } from './code-structure';
import { focusIdentity, paneOfStation, panesOf, shownStation, type FocusRevision } from './walk-panes';
import {
  isProsePath,
  markedChangedRows,
  type CodeLevel,
  type CodeLocation,
  type DiffFile,
  type DiffRow,
  type Lang,
  type Place,
  type RevisionSide,
  type Walk,
} from '../shared/review-model';

/**
 * The walk as a map of code places (third user observation, 24 October 2026).
 *
 * Every place of a walk is a station, and the stations stand in panes in walk order
 * from left to right: two places in different parts of a file stand side by side with
 * their own focus, and a return to an earlier file opens a new pane further right.
 * Neighbouring places on the old and the new side of the same change share one pane
 * (DSP-175, see walk-panes.ts): the pane presents one of them at a time, and choosing
 * the other moves the focus mark and the explanation within it.
 * The panes keep their identity, order, width and local scroll position; only what
 * is far off screen is left unrendered.
 *
 * Two interactions are kept apart: the middle mouse button dragged inside a pane
 * scrolls that pane, and Shift with the left button dragged over the code pans the
 * whole map. Previous/Next and the other step navigation slide the same map; the
 * explanation follows the active station, also when the map is panned by hand: the
 * place whose focus has come into the middle of the view (see settleActive).
 *
 * A pane draws only the rows near its visible part, at fixed row heights, so a whole
 * file stays scrollable without every row being drawn again as the map moves.
 *
 * Before/After is the window's choice of what a diff pane draws — only the From rows,
 * only the To rows, or the comparison — and its heading says which; it has nothing to
 * do with the map's direction.
 */

export interface Station {
  readonly index: number;
  readonly stepId: string;
  readonly placeIndex: number;
  readonly place: Place;
  /** Path and revision side of the focus. */
  readonly key: string;
}

export function stationsOf(walk: Walk): Station[] {
  const out: Station[] = [];
  for (const step of walk.steps) {
    step.places.forEach((place, placeIndex) => {
      out.push({
        index: out.length,
        stepId: step.id,
        placeIndex,
        place,
        key: `${place.focus.path}\|${place.focus.side}`,
      });
    });
  }
  return out;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUS_MARGIN = 4;
const GAP_CONTEXT = 2;
const STEP_DISTANCE = 120;
/** Space between panes, in pixels. */
const PANE_GAP = 6;
const MIN_PANE_WIDTH = 260;
/** Room the viewport keeps beside a pane that widened for its change. */
const AUTO_WIDTH_MARGIN = 120;
/** A pointer must travel this far before a press becomes a drag. */
const DRAG_THRESHOLD = 6;
/**
 * In a pane every row, fold and note has a fixed height (set in review.css), so a
 * long file is drawn a screen at a time while its whole height stays scrollable.
 */
const ROW_HEIGHT = 19;
const GAP_HEIGHT = 24;
const NOTE_HEIGHT = 28;
/** Rows drawn beyond the pane's visible part, in pixels, above and below. */
const OVERSCAN = 600;
/** A fold away from the place's function opens this many lines at a time. */
const GAP_STEP = 20;
/** Panning: a place whose focus is at least this much in view can become active. */
const FOCUS_IN_VIEW = 0.8;
/** Panning: two places whose focus visibility differs less than this are about equally in view. */
const FOCUS_TIE = 0.1;
/**
 * Panning: of two places about equally in view, the one whose focus is nearer the map's
 * centre takes over — at once when it lies the way the map is travelling, else only when
 * it is this much nearer.
 */
const FOCUS_NEARER = 64;
/** Panning: after a switch the map must travel this far before the next one, over one drag or several (no flicker). */
const SWITCH_TRAVEL = 64;

type CodeView = 'before' | 'both' | 'after';

export function unitLabel(place: Place | null, words: ReviewWords): string {
  const kind = place?.unit?.kind;
  return kind === undefined ? words.levels.context : words.levels.unit[kind];
}

/** What the unit level shows for this place, by name and lines: the tooltip of its button. */
export function unitTitle(place: Place | null): string | undefined {
  if (place === null) {
    return undefined;
  }
  if (place.unit !== null) {
    return `${place.unit.name} (${String(place.unit.ref.start)}–${String(place.unit.ref.end)})`;
  }
  const context = place.context.find((ref) => ref.path === place.focus.path);
  return context === undefined ? undefined : `${String(context.start)}–${String(context.end)}`;
}

/** A place's unit in its own file: at its side, and at the other side when it is there too. */
function unitRefs(place: Place): readonly CodeLocation[] {
  const unit = place.unit;
  if (unit === null || unit.ref.path !== place.focus.path) {
    return [];
  }
  return unit.counterpart === null ? [unit.ref] : [unit.ref, unit.counterpart];
}

/**
 * The rows a station shows at a level, as ranges: its focus with a margin; at the unit level also
 * the function (or declaration, class, section) it lies in at each side, and its prepared unit or
 * context; at the file level everything.
 */
function stationRanges(rows: readonly DiffRow[], place: Place, level: CodeLevel, focusIndexes: readonly number[]): readonly (readonly [number, number])[] {
  if (rows.length === 0 || focusIndexes.length === 0) {
    return [];
  }
  if (level === 'file') {
    return [[0, rows.length - 1]];
  }
  const first = focusIndexes[0] ?? 0;
  const last = focusIndexes[focusIndexes.length - 1] ?? first;
  const clamp = (range: readonly [number, number]): readonly [number, number] => [Math.max(0, range[0]), Math.min(rows.length - 1, range[1])];
  const ranges: (readonly [number, number])[] = [clamp([first - FOCUS_MARGIN, last + FOCUS_MARGIN])];
  if (level === 'unit') {
    const unit = unitRefs(place);
    const fallback = place.context.find((ref) => ref.path === place.focus.path);
    for (const ref of unit.length > 0 ? unit : fallback === undefined ? [] : [fallback]) {
      const unitRows = rowsOf(rows, ref).indexes;
      if (unitRows.length > 0) {
        ranges.push([unitRows[0] ?? 0, unitRows[unitRows.length - 1] ?? 0]);
      }
    }
    for (const entry of placeStructures(rows, place.focus)) {
      for (const [start, end] of structureLines(entry)) {
        const indexes = rowsOf(rows, { side: entry.side, start, end }).indexes;
        if (indexes.length > 0) {
          ranges.push([indexes[0] ?? 0, indexes[indexes.length - 1] ?? 0]);
        }
      }
    }
  }
  return ranges;
}

/**
 * The horizontal scroll that shows the change itself: the first column where a
 * removed line and its added counterpart differ (or the first code of a line that is
 * only added or removed), kept well inside the pane. 0 when the line fits anyway.
 */
function changeLeft(element: HTMLElement, rows: readonly DiffRow[], focus: readonly number[]): number {
  const changed = focus.map((index) => rows[index]).filter((row): row is DiffRow => row !== undefined && row.kind !== 'context');
  if (changed.length === 0) {
    return 0;
  }
  const deleted = changed.filter((row) => row.kind === 'deleted');
  const added = changed.filter((row) => row.kind === 'added');
  let column: number | null = null;
  for (let pair = 0; pair < Math.min(deleted.length, added.length); pair += 1) {
    const a = deleted[pair]?.text ?? '';
    const b = added[pair]?.text ?? '';
    let at = 0;
    while (at < a.length && at < b.length && a[at] === b[at]) {
      at += 1;
    }
    if (at < Math.max(a.length, b.length)) {
      column = column === null ? at : Math.min(column, at);
    }
  }
  if (column === null) {
    const match = /\S/.exec(changed[0]?.text ?? '');
    column = match === null ? 0 : match.index;
  }
  // Measure that column in the first rendered changed row.
  const text = element.querySelector('[data-shown-change="1"] .rv-text');
  if (text === null) {
    return 0;
  }
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  let remaining = column;
  let node = walker.nextNode();
  while (node !== null && remaining > (node.textContent?.length ?? 0)) {
    remaining -= node.textContent?.length ?? 0;
    node = walker.nextNode();
  }
  let x: number;
  if (node === null) {
    x = text.getBoundingClientRect().right;
  } else {
    const range = document.createRange();
    range.setStart(node, Math.min(remaining, node.textContent?.length ?? 0));
    range.collapse(true);
    x = range.getBoundingClientRect().left;
  }
  const inContent = x - element.getBoundingClientRect().left + element.scrollLeft;
  if (inContent + 80 <= element.clientWidth) {
    return 0;
  }
  // The line numbers and the before/after label stay at the left edge: the change
  // goes clearly to their right, at about 45 % of the pane.
  const numbers = element.querySelector<HTMLElement>('.rv-row .rv-ln');
  const marker = element.querySelector<HTMLElement>('.rv-row .rv-marker');
  const reserve = (numbers?.offsetWidth ?? 0) + (marker?.offsetWidth ?? 0) + 24;
  return Math.max(0, Math.round(inContent - Math.max(element.clientWidth * 0.45, reserve)));
}

/** Where each pane stands on the map, from the widths chosen so far. */
function layoutOf(count: number, widths: ReadonlyMap<number, number>, fallback: number): { lefts: number[]; widths: number[]; total: number } {
  const lefts: number[] = [];
  const sizes: number[] = [];
  let x = 0;
  for (let index = 0; index < count; index += 1) {
    const width = widths.get(index) ?? fallback;
    lefts.push(x);
    sizes.push(width);
    x += width + PANE_GAP;
  }
  return { lefts, widths: sizes, total: Math.max(0, x - PANE_GAP) };
}

/** Whether a station's own code — its focus, unit or prepared context — contains the lines. */
function shows(station: Station, ref: CodeLocation): boolean {
  const place = station.place;
  const ranges = [place.focus, ...(place.unit === null ? [] : [place.unit.ref]), ...place.context];
  return ranges.some(
    (range) => range.path === ref.path && (range.side ?? 'target') === (ref.side ?? 'target') && range.start <= ref.start && range.end >= ref.end,
  );
}

/**
 * The pane the walk's link into `station` leads from: the nearest earlier pane whose
 * own code contains the source line. The same file is not enough: a pane showing
 * another function of that file is not the source, and gets no arrow. Null when no
 * pane of the walk shows the source; the link is then a reference that opens it.
 */
function fromPaneOf(stations: readonly Station[], station: Station | undefined): number | null {
  const from = station?.place.from;
  if (station === undefined || from === null || from === undefined) {
    return null;
  }
  const focusShows = (candidate: Station): boolean => shows({ ...candidate, place: { ...candidate.place, unit: null, context: [] } }, from.ref);
  let inCode: number | null = null;
  for (let index = station.index - 1; index >= 0; index -= 1) {
    const candidate = stations[index];
    if (candidate === undefined) {
      continue;
    }
    // A pane whose own focus is the source line reads most directly; else one that
    // shows it in its function or prepared context.
    if (focusShows(candidate)) {
      return index;
    }
    if (inCode === null && shows(candidate, from.ref)) {
      inCode = index;
    }
  }
  return inCode;
}

/** Where a station's call is shown: the pane it leads from, or its own pane when that has the file. */
function callPaneOf(stations: readonly Station[], station: Station | undefined): number | null {
  const from = station?.place.from;
  if (station === undefined || from === null || from === undefined) {
    return null;
  }
  const pane = fromPaneOf(stations, station);
  if (pane !== null) {
    return pane;
  }
  return shows(station, from.ref) ? station.index : null;
}

const NO_CALLS: readonly CodeLocation[] = [];
const NO_STATIONS: readonly Station[] = [];

export function WalkTimeline({
  walk,
  stations,
  active,
  onActivate,
  diffFiles,
  files,
  level,
  view,
  wrapProse,
  wrapCode,
  entry,
  selection,
  onSelect,
  words,
  lang,
  onOpenLocation,
  navRequest,
  revision,
  activeStopFoci,
}: {
  /** The repository and the two commits, named in the active place's mark (DSP-175). */
  readonly revision?: FocusRevision;
  readonly walk: Walk;
  /** How this walk was entered: from the walk before it, or back from the one after. */
  readonly entry: 'forward' | 'backward';
  readonly selection: CodeLocation | null;
  readonly onSelect: (location: CodeLocation | null) => void;
  readonly stations: readonly Station[];
  readonly active: number;
  readonly onActivate: (index: number) => void;
  readonly diffFiles: readonly DiffFile[];
  readonly files: Files;
  readonly level: CodeLevel;
  readonly view: CodeView;
  /** Whether long lines wrap in Markdown panes and in code panes. */
  readonly wrapProse: boolean;
  readonly wrapCode: boolean;
  readonly words: ReviewWords;
  readonly lang: Lang;
  /** Opens code outside the walk (a source no pane of the walk shows). */
  readonly onOpenLocation: (location: CodeLocation) => void;
  /** Counts explicit choices of a step or place: each one shows the active place, also when it is already active. */
  readonly navRequest: number;
  /** The active navigation stop's focus references in this step (one place or a merged From/To pair). */
  readonly activeStopFoci: readonly CodeLocation[];
}): JSX.Element {
  // The walk is the key of this view; its places are not marked as a whole any more (30 October 2026).
  void walk;
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => setViewWidth(element.clientWidth));
    observer.observe(element);
    setViewWidth(element.clientWidth);
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // The panes: neighbouring places on both sides of one change share one (walk-panes.ts).
  // Widths, room, scroll positions, arrivals and the map's layout are all per pane.
  const changedFiles = useMemo(() => new Map(diffFiles.map((file) => [file.path, file])), [diffFiles]);
  const panes = useMemo(
    () => panesOf(stations.map((station) => station.place.focus), (path) => changedFiles.get(path) ?? null),
    [stations, changedFiles],
  );
  const paneOf = useMemo(() => paneOfStation(panes), [panes]);
  const paneAt = (station: number): number => paneOf[station] ?? -1;
  const activePane = paneAt(active);
  const paneMembers = useMemo(() => panes.map((pane) => pane.stations.flatMap((index) => stations[index] ?? [])), [panes, stations]);

  // Pane widths: a shared default until the reader changes one. Half the viewport
  // shows two panes side by side; a wide window still gets readable panes.
  const defaultWidth = Math.max(MIN_PANE_WIDTH, Math.min(900, Math.floor((viewWidth - PANE_GAP) / 2)));
  const [widths, setWidths] = useState<ReadonlyMap<number, number>>(new Map());
  // A pane the walk arrives in may ask for room for its change. Such a width only
  // grows, stays between the shared default and the viewport less a margin, and a
  // width the reader chose by hand always wins over it.
  const [autoWidths, setAutoWidths] = useState<ReadonlyMap<number, number>>(new Map());
  const roomCap = Math.max(MIN_PANE_WIDTH, viewWidth - AUTO_WIDTH_MARGIN);
  const effectiveWidths = useMemo(() => {
    const map = new Map<number, number>();
    for (const [index, width] of autoWidths) {
      map.set(index, Math.max(defaultWidth, Math.min(width, roomCap)));
    }
    // A pane of prose takes the whole view from the start: in half of it a long line of prose
    // becomes a narrow column of a few words a row (Niclas's trial, 29 October 2026). Whether
    // lines wrap never sets a width (30 October 2026): Wrap lines breaks lines within the
    // width each pane already has, so the panes, the dividers and the map stay where they are.
    for (const pane of panes) {
      if (isProsePath(pane.path)) {
        map.set(pane.index, Math.max(defaultWidth, viewWidth));
      }
    }
    for (const [index, width] of widths) {
      map.set(index, width);
    }
    return map;
  }, [autoWidths, widths, defaultWidth, roomCap, panes, viewWidth]);
  const layout = useMemo(() => layoutOf(panes.length, effectiveWidths, defaultWidth), [panes.length, effectiveWidths, defaultWidth]);
  /** Asks for room for a pane's change; true when the pane will get wider. */
  const roomFor = useCallback(
    (index: number, wanted: number): boolean => {
      const width = Math.min(wanted, roomCap);
      if (width <= Math.max(autoWidths.get(index) ?? 0, defaultWidth)) {
        return false;
      }
      setAutoWidths((current) => new Map([...current, [index, Math.max(current.get(index) ?? 0, width)]]));
      return true;
    },
    [autoWidths, roomCap, defaultWidth],
  );

  // The map's position: how far it has been moved to the left, in pixels.
  const [mapX, setMapX] = useState(0);
  const [panning, setPanning] = useState(false);
  const mapXRef = useRef(0);
  mapXRef.current = mapX;
  const maxMapX = Math.max(0, layout.total - viewWidth);
  useEffect(() => {
    setMapX((x) => Math.min(x, maxMapX));
  }, [maxMapX]);
  const clampX = useCallback((x: number) => Math.min(Math.max(0, x), Math.max(0, layout.total - viewWidth)), [layout.total, viewWidth]);

  // Direction of travel decides where the active pane settles: moving forward it
  // takes the right side so the pane it came from stays visible on the left; moving
  // back it takes the left side. A pane activated by panning does not move the map.
  const previousActive = useRef(active);
  const panActivated = useRef<number | null>(null);
  const activatedByPan = useRef(false);
  // Where panning last switched the active place, and to which (see SWITCH_TRAVEL).
  const lastSwitch = useRef<{ x: number; index: number } | null>(null);
  const [direction, setDirection] = useState<'forward' | 'backward'>(entry);
  // Read through a ref: a width change by hand must not realign a map the reader has panned.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const lastDirection = useRef<'forward' | 'backward'>(entry);
  const activeAutoWidth = autoWidths.get(activePane);
  // Each arrival by navigation is numbered; the pane it reaches makes room for its
  // change and places it in view once per number. The station the map opens on is
  // arrival 0. Panning activates panes without arriving anywhere.
  const [arrival, setArrival] = useState(() => ({ index: active, seq: 0 }));
  const arrivalRef = useRef(arrival);
  arrivalRef.current = arrival;
  const handledArrivals = useRef(new Map<number, number>());
  // The source of a link is unfolded and brought into view only by an explicit act —
  // arriving at the place by navigation, or asking for its source — never by panning.
  const sourceSignalFor = (index: number): { pane: number | null; ref: CodeLocation | null } => {
    const station = stations[index];
    const callStation = callPaneOf(stations, station);
    const pane = callStation === null ? null : paneAt(callStation);
    return { pane, ref: pane === null || station?.place.from == null ? null : station.place.from.ref };
  };
  const [source, setSource] = useState(() => ({ ...sourceSignalFor(active), seq: 0 }));
  // "Visa källan": the source pane scrolls to the line even when it mounts because of it.
  const [reveal, setReveal] = useState<{ pane: number | null; seq: number }>({ pane: null, seq: 0 });
  const handledReveals = useRef(new Map<number, number>());
  const lastNavRequest = useRef(navRequest);
  useLayoutEffect(() => {
    const forward = active >= previousActive.current;
    const moved = active !== previousActive.current;
    previousActive.current = active;
    // An explicit choice of a step or place: shown even when it is already the active one.
    const chosen = navRequest !== lastNavRequest.current;
    lastNavRequest.current = navRequest;
    if (chosen) {
      panActivated.current = null;
      if (!moved) {
        lastDirection.current = (layoutRef.current.lefts[paneAt(active)] ?? 0) < mapXRef.current ? 'backward' : 'forward';
      }
    }
    if (moved || chosen) {
      if (moved) {
        setDirection(forward ? 'forward' : 'backward');
        lastDirection.current = forward ? 'forward' : 'backward';
      }
      activatedByPan.current = moved && panActivated.current === active;
      if (!activatedByPan.current) {
        lastSwitch.current = null;
        setArrival((current) => ({ index: active, seq: current.seq + 1 }));
        setSource((current) => ({ ...sourceSignalFor(active), seq: current.seq + 1 }));
      } else {
        // Panning takes over: an arrival not yet placed is dropped, never placed later.
        const pending = arrivalRef.current;
        handledArrivals.current.set(paneAt(pending.index), pending.seq);
      }
    }
    if (panActivated.current === active) {
      panActivated.current = null;
      return;
    }
    // The active pane widening for its change realigns only a station reached by navigation.
    if (!moved && activatedByPan.current) {
      return;
    }
    if (viewWidth === 0) {
      return;
    }
    const left = layoutRef.current.lefts[paneAt(active)] ?? 0;
    const width = layoutRef.current.widths[paneAt(active)] ?? defaultWidth;
    const target = lastDirection.current === 'forward' ? left + width - viewWidth : left;
    setMapX(Math.min(Math.max(0, target), Math.max(0, layoutRef.current.total - viewWidth)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewWidth, defaultWidth, activeAutoWidth, navRequest]);

  // The active place follows the map when it is panned by hand: the place whose focus
  // rows are most in view — horizontally in the map and in its pane's code area,
  // vertically in its pane — once at least FOCUS_IN_VIEW of it is. Between places about
  // equally in view, the one whose focus is nearer the map's centre (see FOCUS_NEARER).
  // After a switch the map must travel SWITCH_TRAVEL more while that place is active.
  // Panes are measured, each by the focus of the place it presents; a pane that wins
  // makes that place active (shownStation: the first place of a pane further on, the
  // last of one before), and the active pane never competes with itself.
  const settleActive = useCallback(
    (x: number, direction: number) => {
      const element = viewport.current;
      if (element === null) {
        return;
      }
      const maxX = Math.max(0, layoutRef.current.total - element.clientWidth);
      // At either end the map can travel no further, so a switch there needs no more travel.
      const atEnd = x <= 0 || x >= maxX;
      if (!atEnd && lastSwitch.current !== null && lastSwitch.current.index === active && Math.abs(x - lastSwitch.current.x) < SWITCH_TRAVEL) {
        return;
      }
      // The DOM still shows the map at the rendered position; x is where it is going.
      const shift = x - mapXRef.current;
      const view = element.getBoundingClientRect();
      const middle = activationLine(x, maxX, view.left, view.width);
      const seen = new Map<number, { amount: number; off: number; paneOff: number }>();
      for (const pane of element.querySelectorAll<HTMLElement>('[data-pane-index]')) {
        const scroller = pane.querySelector<HTMLElement>('.rv-pane-lines');
        if (scroller === null) {
          continue;
        }
        const box = scroller.getBoundingClientRect();
        const numbers = scroller.querySelector<HTMLElement>('.rv-row .rv-ln');
        const marker = scroller.querySelector<HTMLElement>('.rv-row .rv-marker');
        const codeLeft = box.left - shift + (numbers?.offsetWidth ?? 0) + (marker?.offsetWidth ?? 0);
        const codeRight = box.left - shift + scroller.clientWidth;
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (const text of scroller.querySelectorAll<HTMLElement>('[data-focus="1"] .rv-text')) {
          const rect = text.getBoundingClientRect();
          left = Math.min(left, rect.left - shift);
          right = Math.max(right, rect.right - shift);
          top = Math.min(top, rect.top);
          bottom = Math.max(bottom, rect.bottom);
        }
        if (!Number.isFinite(left)) {
          continue;
        }
        // The focus as far as its pane can show it, and how much of that is in the map.
        const shownLeft = Math.max(left, codeLeft);
        const shownRight = Math.min(right, codeRight);
        const across = shownRight > shownLeft ? Math.max(0, Math.min(shownRight, view.right) - Math.max(shownLeft, view.left)) / (shownRight - shownLeft) : 0;
        // A focus taller than its pane counts as fully in view once it fills half of it.
        const fullHeight = Math.min(bottom - top, box.height / 2);
        const down = fullHeight > 0 ? Math.min(1, Math.max(0, Math.min(bottom, box.bottom) - Math.max(top, box.top)) / fullHeight) : 0;
        const paneBox = pane.getBoundingClientRect();
        seen.set(Number(pane.dataset.paneIndex), {
          amount: across * down,
          off: Math.abs((shownLeft + shownRight) / 2 - middle),
          paneOff: Math.abs((paneBox.left + paneBox.right) / 2 - shift - middle),
        });
      }
      // A candidate is clearly more in view than an active place whose focus is leaving
      // the view — and nearer the centre than the active pane itself, which the reader may
      // have scrolled away from its focus — or about as much in view and nearer the
      // centre. The most visible one wins; on a tie, the most central.
      const activePaneIndex = paneOf[active] ?? -1;
      const current = seen.get(activePaneIndex) ?? { amount: 0, off: Infinity, paneOff: Infinity };
      let best = activePaneIndex;
      let bestSeen = { amount: -1, off: Infinity, paneOff: Infinity };
      for (const [index, candidate] of seen) {
        if (index === activePaneIndex || candidate.amount < FOCUS_IN_VIEW) {
          continue;
        }
        const clearer = current.amount < FOCUS_IN_VIEW && candidate.amount > current.amount + FOCUS_TIE && candidate.off < current.paneOff;
        const ahead = direction !== 0 && Math.sign(index - activePaneIndex) === Math.sign(direction);
        const nearer = candidate.amount >= current.amount - FOCUS_TIE && candidate.off <= current.off - (ahead ? 0 : FOCUS_NEARER);
        if (!clearer && !nearer) {
          continue;
        }
        const better = candidate.amount > bestSeen.amount + FOCUS_TIE || (Math.abs(candidate.amount - bestSeen.amount) <= FOCUS_TIE && candidate.off < bestSeen.off);
        if (better) {
          best = index;
          bestSeen = candidate;
        }
      }
      const bestPane = panes[best];
      if (best !== activePaneIndex && bestPane !== undefined) {
        const station = shownStation(bestPane, active);
        lastSwitch.current = { x, index: station };
        panActivated.current = station;
        onActivate(station);
      }
    },
    [active, onActivate, panes, paneOf],
  );

  // Stepping in time: Shift+wheel or Alt+arrow keys (in the view). Each step is one station.
  const travel = useRef(0);
  const step = useCallback(
    (delta: number) => {
      const next = Math.min(stations.length - 1, Math.max(0, active + delta));
      if (next !== active) {
        onActivate(next);
      }
    },
    [active, stations.length, onActivate],
  );
  useEffect(() => {
    const element = viewport.current;
    if (element === null) {
      return;
    }
    const onWheel = (event: WheelEvent): void => {
      const sideways = event.shiftKey ? event.deltaY || event.deltaX : 0;
      if (sideways === 0) {
        return;
      }
      event.preventDefault();
      travel.current += sideways;
      if (Math.abs(travel.current) >= STEP_DISTANCE) {
        step(travel.current > 0 ? 1 : -1);
        travel.current = 0;
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [step]);

  // Shift + left button dragged over the code pans the map. A press that does not
  // travel stays a click (Shift-click on a line number extends a selection); one that
  // does travel swallows the click that would follow it.
  const pan = useRef<{ id: number; startX: number; startMapX: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const down = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') {
        setShiftHeld(true);
      }
    };
    const up = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') {
        setShiftHeld(false);
      }
    };
    const blur = (): void => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Pane widths by hand: drag the edge, or double-click it to fit the longest line
  // of what the pane shows.
  const resize = useRef<{ id: number; index: number; startX: number; startWidth: number; captured: boolean } | null>(null);
  const lastHandlePress = useRef<{ index: number; at: number } | null>(null);
  const fitPane = useCallback(
    (index: number) => {
      const element = viewport.current?.querySelector(`[data-pane-index="${String(index)}"]`);
      if (element === null || element === undefined) {
        return;
      }
      // The longest line the pane shows — drawn or not — with its line numbers and label.
      const longest = element.querySelector<HTMLElement>('.rv-longest');
      const width = Math.min(Math.max(MIN_PANE_WIDTH, (longest?.offsetWidth ?? 0) + 34), Math.max(MIN_PANE_WIDTH, viewWidth));
      setWidths((current) => new Map([...current, [index, width]]));
    },
    [viewWidth],
  );

  // Links: a dashed arrow from the call in the pane it leads from to the active focus.
  const activeStation = stations[active];
  const fromStation = useMemo(() => fromPaneOf(stations, activeStation), [stations, activeStation]);
  const fromPane = fromStation === null ? null : (paneOf[fromStation] ?? null);
  // The active place's call is marked where it is shown. The rows around a call are
  // unfolded for the latest navigation and stay so until the next one: panning neither
  // folds nor unfolds rows in any pane.
  const callStation = useMemo(() => callPaneOf(stations, activeStation), [stations, activeStation]);
  const callPane = callStation === null ? null : (paneOf[callStation] ?? null);
  const sourceCalls = useMemo((): readonly CodeLocation[] => (source.ref === null ? NO_CALLS : [source.ref]), [source.ref]);
  // Where the active place's source is, for the reference in its header: a pane of the
  // walk (on screen or not), or nowhere in the walk.
  const placeName = (index: number): string => {
    const station = stations[index];
    if (station === undefined) {
      return '';
    }
    const count = stations.filter((other) => other.stepId === station.stepId).length;
    return words.nav.placeOf(station.stepId, station.placeIndex + 1, count);
  };
  const paneOnScreen = (index: number): boolean => {
    const left = layout.lefts[index] ?? 0;
    const width = layout.widths[index] ?? defaultWidth;
    return Math.min(left + width, mapX + viewWidth) - Math.max(left, mapX) >= Math.min(160, width * 0.5);
  };
  // Bring the source pane into view — together with the active pane when both fit —
  // unfold the source and scroll it to the source line. An explicit act, like navigation.
  const revealSource = (): void => {
    if (fromPane === null) {
      return;
    }
    const left = layout.lefts[fromPane] ?? 0;
    const activeRight = (layout.lefts[activePane] ?? 0) + (layout.widths[activePane] ?? defaultWidth);
    const target = activeRight - left <= viewWidth ? activeRight - viewWidth : left - PANE_GAP;
    setMapX(clampX(Math.min(left, target)));
    setSource((current) => ({ ...sourceSignalFor(active), seq: current.seq + 1 }));
    setReveal((current) => ({ pane: fromPane, seq: current.seq + 1 }));
  };
  // And back from the source to the place it leads to.
  const returnToPlace = (): void => {
    const left = layout.lefts[activePane] ?? 0;
    const width = layout.widths[activePane] ?? defaultWidth;
    setMapX(clampX(left + width - viewWidth));
  };
  const [arrow, setArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const measure = useCallback(() => {
    const element = viewport.current;
    const from = activeStation?.place.from;
    if (element === null || from === null || from === undefined || fromPane === null) {
      setArrow(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const sourcePane = element.querySelector(`[data-pane-index="${String(fromPane)}"]`);
    const targetPane = element.querySelector(`[data-pane-index="${String(activePane)}"]`);
    const source = sourcePane?.querySelector(`[data-line="${String(from.ref.start)}"]`) ?? null;
    const target = targetPane?.querySelector('[data-active-focus="1"]') ?? null;
    if (sourcePane === null || sourcePane === undefined || targetPane === null || targetPane === undefined || source === null || target === null) {
      setArrow(null);
      return;
    }
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const sourceBox = sourcePane.getBoundingClientRect();
    const targetBox = targetPane.getBoundingClientRect();
    if (sourceBox.right > targetBox.left || sourceBox.right < box.left - 40 || targetBox.left > box.right + 40) {
      setArrow(null);
      return;
    }
    // Rows outside their pane's code area are hidden by it: the arrow ends at the edge.
    const y1 = Math.min(Math.max(a.top + a.height / 2, sourceBox.top + 30), sourceBox.bottom - 6) - box.top;
    const y2 = Math.min(Math.max(b.top + b.height / 2, targetBox.top + 30), targetBox.bottom - 6) - box.top;
    const x1 = sourceBox.right - box.left - 18;
    const x2 = targetBox.left - box.left + 92;
    // Measured every frame for a while after the map moves: a new arrow only when it moved.
    setArrow((current) => (current !== null && current.x1 === x1 && current.y1 === y1 && current.x2 === x2 && current.y2 === y2 ? current : { x1, y1, x2, y2 }));
  }, [activeStation, fromPane, activePane]);
  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const loop = (): void => {
      measure();
      if (performance.now() - started < 1200) {
        frame = requestAnimationFrame(loop);
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [measure, mapX, level, view, layout]);

  // Each pane's own scroll position survives its pane leaving the rendered range.
  const scrollTops = useRef(new Map<number, { top: number; left: number }>());
  // Each pane gets one lasting box of handlers, refilled on every render: a pane that
  // skips a render still calls the current ones.
  const paneHandlers = useRef(new Map<number, { current: PaneHandlers }>());
  const handlersFor = (index: number, handlers: PaneHandlers): { readonly current: PaneHandlers } => {
    const box = paneHandlers.current.get(index) ?? { current: handlers };
    box.current = handlers;
    paneHandlers.current.set(index, box);
    return box;
  };
  const renderFrom = mapX - viewWidth;
  const renderTo = mapX + viewWidth * 2;

  return (
    <div className="rv-timeline">
      <div
        className={`rv-timeline-viewport${panning ? ' rv-panning' : shiftHeld ? ' rv-pan-ready' : ''}`}
        ref={viewport}
        onPointerDown={(event) => {
          // A new press starts clean: only the click of a pan that just ended is swallowed.
          swallowClick.current = false;
          const handle = (event.target as HTMLElement).closest('[data-resize-index]');
          if (event.button === 0 && handle !== null) {
            // The edge takes no clicks: no text selection, and no native drag of one.
            event.preventDefault();
            const index = Number(handle.getAttribute('data-resize-index'));
            // Two presses on the same edge within a moment fit the pane to its longest line.
            const now = performance.now();
            if (lastHandlePress.current !== null && lastHandlePress.current.index === index && now - lastHandlePress.current.at < 450) {
              lastHandlePress.current = null;
              fitPane(index);
              return;
            }
            lastHandlePress.current = { index, at: now };
            resize.current = { id: event.pointerId, index, startX: event.clientX, startWidth: layout.widths[index] ?? defaultWidth, captured: false };
            return;
          }
          if (event.button === 0 && event.shiftKey) {
            // Nothing is captured yet: a Shift-click that does not travel must reach
            // the line number as an ordinary click. The pointer event is the truth
            // about Shift (the key may have gone down while the window was unfocused).
            setShiftHeld(true);
            pan.current = { id: event.pointerId, startX: event.clientX, startMapX: mapXRef.current, moved: false };
          }
        }}
        onPointerMove={(event) => {
          if (resize.current !== null && resize.current.id === event.pointerId) {
            const { index, startX, startWidth } = resize.current;
            if (!resize.current.captured) {
              if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD) {
                return;
              }
              resize.current = { ...resize.current, captured: true };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            const width = Math.min(Math.max(MIN_PANE_WIDTH, startWidth + event.clientX - startX), Math.max(MIN_PANE_WIDTH, viewWidth));
            setWidths((current) => new Map([...current, [index, width]]));
            return;
          }
          if (pan.current === null || pan.current.id !== event.pointerId) {
            return;
          }
          const delta = pan.current.startX - event.clientX;
          if (!pan.current.moved && Math.abs(delta) < DRAG_THRESHOLD) {
            return;
          }
          if (!pan.current.moved) {
            pan.current = { ...pan.current, moved: true };
            event.currentTarget.setPointerCapture(event.pointerId);
            // A pan moves the map, never a text selection.
            window.getSelection()?.removeAllRanges();
            setPanning(true);
          }
          const x = clampX(pan.current.startMapX + delta);
          setMapX(x);
          settleActive(x, Math.sign(x - mapXRef.current));
        }}
        onPointerUp={(event) => {
          // The pointer event is also the truth about Shift being released.
          setShiftHeld(event.shiftKey);
          if (resize.current?.id === event.pointerId) {
            resize.current = null;
            return;
          }
          if (pan.current?.id === event.pointerId) {
            swallowClick.current = pan.current.moved;
            if (pan.current.moved) {
              settleActive(mapXRef.current, 0);
            }
            pan.current = null;
            setPanning(false);
          }
        }}
        onPointerCancel={() => {
          pan.current = null;
          resize.current = null;
          setPanning(false);
        }}
        onClickCapture={(event) => {
          if (swallowClick.current) {
            swallowClick.current = false;
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        <div
          ref={track}
          className={`rv-timeline-track${ready && !panning ? '' : ' rv-no-motion'} rv-enter-${entry}`}
          style={{ transform: `translateX(${String(-mapX)}px)`, width: `${String(layout.total)}px` }}
        >
          {panes.map((pane) => {
            const station = stations[shownStation(pane, active)];
            if (station === undefined) {
              return null;
            }
            const left = layout.lefts[pane.index] ?? 0;
            const width = layout.widths[pane.index] ?? defaultWidth;
            const rendered = left + width >= renderFrom && left <= renderTo;
            const isActive = pane.index === activePane;
            const path = pane.path;
            const diffFile = changedFiles.get(path) ?? null;
            return (
              <div
                key={pane.index}
                className={`rv-pane-slot${isActive ? ' rv-pane-slot-active' : ''}`}
                style={{ left: `${String(left)}px`, width: `${String(width)}px` }}
              >
                {rendered ? (
                  <TimelinePane
                    station={station}
                    paneIndex={pane.index}
                    paneStations={paneMembers[pane.index] ?? NO_STATIONS}
                    isActive={isActive}
                    focusName={isActive ? placeName(station.index) : ''}
                    revision={revision}
                    direction={direction}
                    fromRow={isActive ? (activeStation?.place.from ?? null) : null}
                    fromHere={callPane === pane.index && activeStation !== undefined && activeStation.place.from !== null ? activeStation.place.from.ref : null}
                    calls={source.pane === pane.index ? sourceCalls : NO_CALLS}
                    sourceLink={
                      isActive && activeStation?.place.from != null
                        ? fromPane === null
                          ? { kind: 'open' }
                          : { kind: paneOnScreen(fromPane) ? 'shown' : 'reveal', name: placeName(fromStation ?? active) }
                        : null
                    }
                    sourceFor={fromPane === pane.index && fromPane !== activePane && !paneOnScreen(activePane) ? { name: placeName(active) } : null}
                    diffFile={diffFile}
                    files={files}
                    level={level}
                    view={view}
                    wrap={isProsePath(path) ? wrapProse : wrapCode}
                    selection={selection}
                    words={words}
                    lang={lang}
                    savedScroll={scrollTops.current.get(pane.index)}
                    userSized={widths.has(pane.index)}
                    width={width}
                    arrival={paneAt(arrival.index) === pane.index ? arrival.seq : -1}
                    arrivalHandled={handledArrivals.current.get(pane.index) ?? -1}
                    callArrival={source.pane === pane.index && pane.index !== activePane ? source.seq : -1}
                    reveal={reveal.pane === pane.index ? reveal.seq : -1}
                    revealHandled={handledReveals.current.get(pane.index) ?? -1}
                    handlers={handlersFor(pane.index, {
                      select: onSelect,
                      scrolled: measure,
                      scrollTop: (top, left) => scrollTops.current.set(pane.index, { top, left }),
                      room: (wanted) => roomFor(pane.index, wanted),
                      arrivalHandled: (seq) => handledArrivals.current.set(pane.index, seq),
                      revealHandled: (seq) => handledReveals.current.set(pane.index, seq),
                      sourceLink: () => {
                        const from = activeStation?.place.from;
                        if (from === null || from === undefined) {
                          return;
                        }
                        if (fromPane === null) {
                          onOpenLocation(from.ref);
                        } else {
                          revealSource();
                        }
                      },
                      sourceFor: returnToPlace,
                    })}
                    activeStopFoci={activeStopFoci}
                  />
                ) : (
                  <div className="rv-pane-placeholder">
                    {station.stepId} · {fileName(path)}
                  </div>
                )}
                <div
                  className="rv-pane-resize"
                  data-resize-index={pane.index}
                  title={words.timeline.resize}
                  role="separator"
                  aria-orientation="vertical"
                />
              </div>
            );
          })}
        </div>
        {arrow !== null && (
          <svg className="rv-arrow" aria-hidden="true">
            <defs>
              <marker id="rv-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" />
              </marker>
            </defs>
            <path
              d={`M${String(arrow.x1)},${String(arrow.y1)} C${String(arrow.x1 + 60)},${String(arrow.y1)} ${String(arrow.x2 - 60)},${String(arrow.y2)} ${String(arrow.x2)},${String(arrow.y2)}`}
              markerEnd="url(#rv-arrowhead)"
            />
          </svg>
        )}
      </div>
      <div className="rv-timeline-strip" aria-label={words.timeline.label}>
        {stations.map((station) => {
          // A new file starts here; the two sides of one change share a pane and are not marked apart.
          const changesFile = station.index > 0 && stations[station.index - 1]?.place.focus.path !== station.place.focus.path;
          return (
            <button
              key={station.index}
              type="button"
              className={`rv-strip-dot${station.index === active ? ' rv-strip-on' : ''}${changesFile ? ' rv-strip-file' : ''}`}
              title={`${station.stepId} · ${pick(station.place.label, lang).replace(/`/g, '')} · ${fileName(station.place.focus.path)}`}
              aria-label={`${station.stepId} · ${pick(station.place.label, lang).replace(/`/g, '')} · ${fileName(station.place.focus.path)}`}
              aria-current={station.index === active ? 'step' : undefined}
              data-station={station.index}
              onClick={() => onActivate(station.index)}
            />
          );
        })}
        <span className="rv-sub rv-strip-hint">{words.timeline.hint}</span>
        {maxMapX > 0 && <span className="rv-sub rv-strip-position">{Math.round((mapX / maxMapX) * 100)}%</span>}
      </div>
    </div>
  );
}

function TimelinePaneView({
  station,
  paneIndex,
  paneStations,
  isActive,
  focusName,
  revision,
  direction,
  fromRow,
  fromHere,
  diffFile,
  files,
  level,
  view,
  wrap,
  selection,
  words,
  lang,
  savedScroll,
  userSized,
  width,
  arrival,
  arrivalHandled,
  calls,
  callArrival,
  reveal,
  revealHandled,
  sourceLink,
  sourceFor,
  handlers,
  activeStopFoci,
}: {
  readonly selection: CodeLocation | null;
  /** The place the pane presents: its focus is marked, its unit and context fold. */
  readonly station: Station;
  /** The pane's place on the map. */
  readonly paneIndex: number;
  /** Every place the pane shows, in walk order: the two sides of one change share a pane. */
  readonly paneStations: readonly Station[];
  readonly isActive: boolean;
  /** The active place's name, as the map's references give it; empty in other panes. */
  readonly focusName: string;
  readonly revision: FocusRevision | undefined;
  readonly direction: 'forward' | 'backward';
  readonly fromRow: Place['from'];
  readonly fromHere: CodeLocation | null;
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly level: CodeLevel;
  readonly view: CodeView;
  /**
   * Long lines wrap within the pane (Niclas's trial feedback, 29 October 2026). A file's
   * line may then take several rows on screen and keeps its own Git line number; every row
   * is drawn at its own height, so the pane draws all of its rows instead of a screenful.
   */
  readonly wrap: boolean;
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly savedScroll: { readonly top: number; readonly left: number } | undefined;
  readonly userSized: boolean;
  readonly width: number;
  /** The number of the navigation that brought the walk to this pane, or -1. */
  readonly arrival: number;
  /** The last arrival this pane has placed its change for, kept while it is not rendered. */
  readonly arrivalHandled: number;
  /** The call of the latest navigation, when it is shown in this pane: kept unfolded. */
  readonly calls: readonly CodeLocation[];
  /** The number of the explicit act that asked this pane to show a link's source, or -1. */
  readonly callArrival: number;
  /** The number of a "show the source" request for this pane, or -1. */
  readonly reveal: number;
  /** The last request this pane has acted on, kept while it is not rendered. */
  readonly revealHandled: number;
  /** In the active pane: where its link's source is shown — here on screen, off screen, or nowhere in the walk. */
  readonly sourceLink: { readonly kind: 'shown' | 'reveal'; readonly name: string } | { readonly kind: 'open' } | null;
  /** In the source pane, when the place it leads to is off screen: the way back. */
  readonly sourceFor: { readonly name: string } | null;
  /** What the pane calls back; a lasting box the map refills on every render. */
  readonly handlers: { readonly current: PaneHandlers };
  /** The current navigation stop's focus references in this step. */
  readonly activeStopFoci: readonly CodeLocation[];
}): JSX.Element {
  const path = station.place.focus.path;
  const side = station.place.focus.side;
  const content = useRows(files, path, diffFile, side);
  const rows = content?.rows ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  // Rows opened by hand beyond what the level shows, as inclusive index ranges.
  const [opened, setOpened] = useState<readonly (readonly [number, number])[]>([]);
  const inContext = useMemo(() => {
    const set = new Set<number>();
    for (const ref of station.place.context) {
      if (ref.path === path && (ref.side ?? 'target') === side) {
        for (const index of rowsOf(rows, ref).indexes) {
          set.add(index);
        }
      }
    }
    return set;
  }, [rows, station.place.context, path, side]);

  const shownFocus = useMemo(() => rowsOf(rows, station.place.focus), [rows, station.place.focus]);
  const shownSet = useMemo(() => new Set(shownFocus.indexes), [shownFocus]);
  /*
   * DSP-202 (Niclas, 12 November 2026): every pane marks the changed rows of its own places,
   * active or not, so the next place's change is clear before the walk gets there. The rows are
   * the ones Accept decides about (`markedChangedRows`, DSP-201): unchanged rows inside a
   * reference are never among them. Marking a row is not reviewing it.
   */
  const ownRows = useMemo(() => {
    const set = new Set<number>();
    for (const member of paneStations) {
      if (member.place.focus.path === path) {
        markedChangedRows(rows, member.place.focus).forEach((row) => set.add(row));
      }
    }
    return set;
  }, [rows, paneStations, path]);
  const activeStopSides = useMemo(() => new Set(activeStopFoci.map((focus) => focus.side)), [activeStopFoci]);
  // The rows the walk arrives at: the active place's changed rows, and those of the places its
  // stop shows with it on both sides. Only these carry the amber edge and the arrival flash.
  const arrivalRows = useMemo(() => {
    const set = new Set<number>();
    if (!isActive) {
      return set;
    }
    markedChangedRows(rows, station.place.focus).forEach((row) => set.add(row));
    if (activeStopSides.has('base') && activeStopSides.has('target')) {
      for (const focus of activeStopFoci) {
        if (focus.path === path) {
          markedChangedRows(rows, focus).forEach((row) => set.add(row));
        }
      }
    }
    return set;
  }, [isActive, rows, station.place.focus, activeStopSides, activeStopFoci, path]);
  // The active place's call is marked; the latest navigation's call stays unfolded.
  const fromSet = useMemo(() => (fromHere === null ? new Set<number>() : new Set(rowsOf(rows, fromHere).indexes)), [fromHere, rows]);
  const callRows = useMemo(() => {
    const set = new Set<number>();
    for (const ref of calls) {
      rowsOf(rows, ref).indexes.forEach((row) => set.add(row));
    }
    return set;
  }, [calls, rows]);
  const selectionSet = useMemo(
    () => (selection === null || selection.path !== path ? new Set<number>() : new Set(rowsOf(rows, selection).indexes)),
    [selection, rows, path],
  );
  const select = (row: DiffRow, extend: boolean): void => {
    const rowSide: RevisionSide = row.targetLine !== null ? 'target' : 'base';
    const line = row.targetLine ?? row.baseLine;
    if (line === null) {
      return;
    }
    if (extend && selection !== null && selection.path === path && selection.side === rowSide) {
      handlers.current.select({ ...selection, start: Math.min(selection.start, line), end: Math.max(selection.end, line) });
    } else {
      handlers.current.select({ path, side: rowSide, start: line, end: line });
    }
  };

  // The place's function or other unit, as rows: the first thing a fold opens. DSP-207: also the
  // function, declaration or section found in the code at each side, and the first row of each head.
  const structures = useMemo(() => (rows.length === 0 ? [] : placeStructures(rows, station.place.focus)), [rows, station.place.focus]);
  const unitSet = useMemo(
    () =>
      new Set([
        ...unitRefs(station.place).flatMap((ref) => rowsOf(rows, ref).indexes),
        ...structures.filter((entry) => entry.structure.reliable).flatMap((entry) => rowsOf(rows, { side: entry.side, start: entry.structure.start, end: entry.structure.end }).indexes),
      ]),
    [rows, station.place, structures],
  );
  const unitHeads = useMemo(
    () => new Set(level === 'file' ? [] : structures.flatMap((entry) => rowsOf(rows, { side: entry.side, start: entry.structure.start, end: entry.structure.start }).indexes.slice(0, 1))),
    [rows, structures, level],
  );
  const structureName = structures.find((entry) => entry.structure.reliable && entry.structure.name !== '')?.structure.name ?? '';
  // DSP-207: no function, declaration or section was found with certainty at any side, and the walk
  // named none: the context is the lines around the place, and the pane says so.
  const contextUncertain = station.place.unit === null && station.place.context.length === 0 && structures.length > 0 && structures.every((entry) => !entry.structure.reliable);

  // Visible rows: every place of the pane at the chosen level — so choosing another of
  // them moves the focus without folding or unfolding anything — the latest navigation's
  // call when it is shown here, and anything opened by hand. The rest folds into gaps.
  const visible = useMemo(() => {
    const keep = rows.map(() => false);
    for (const member of paneStations) {
      for (const range of stationRanges(rows, member.place, level, rowsOf(rows, member.place.focus).indexes)) {
        keep.fill(true, range[0], range[1] + 1);
      }
    }
    for (const index of callRows) {
      keep.fill(true, Math.max(0, index - GAP_CONTEXT), Math.min(rows.length, index + GAP_CONTEXT + 1));
    }
    for (const [from, to] of opened) {
      keep.fill(true, from, to + 1);
    }
    return keep;
  }, [rows, paneStations, level, callRows, opened]);

  // Arriving: the focus flashes briefly when the walk reaches this pane, or another of
  // its places.
  const [arriving, setArriving] = useState(false);
  const wasActive = useRef<number | null>(isActive ? station.index : null);
  useEffect(() => {
    const now = isActive ? station.index : null;
    if (now !== null && wasActive.current !== now && !reducedMotion()) {
      setArriving(true);
      const settle = window.setTimeout(() => setArriving(false), 1600);
      wasActive.current = now;
      return () => {
        window.clearTimeout(settle);
        setArriving(false);
      };
    }
    wasActive.current = now;
    return undefined;
  }, [isActive, station.index]);

  // Scroll to the change itself — its first changed row — or, in the pane the active
  // place's call is in, to the call: on first view and when the level or Before/After
  // changes. A pane that was scrolled and then left the rendered range comes back
  // where it was. Neither the active place nor its link is part of the key, so panning
  // past a pane — or past a place called from it — leaves its scroll alone.
  // Wrapping is not part of the key: turning it on or off keeps the line being read (below).
  const scrollKey = `${level}:${view}:${String(rows.length)}`;
  // DSP-207: where a pane is placed to show a row: centred, or at the unit level with the head of
  // the function (its documentation and signature) at the top when the head and the change fit
  // in the pane together. Only where the pane is placed anyway, never again while it is read.
  const topFor = (element: HTMLElement, target: HTMLElement): number => {
    const box = element.getBoundingClientRect();
    const offsetOf = (node: Element): number => node.getBoundingClientRect().top - box.top + element.scrollTop;
    const centred = Math.max(0, offsetOf(target) - element.clientHeight / 2 + 20);
    if (level !== 'unit') {
      return centred;
    }
    const head = [...element.querySelectorAll<HTMLElement>('[data-unit-head="1"]')].find((row) => offsetOf(row) <= offsetOf(target));
    if (head === undefined) {
      return centred;
    }
    const changeRows = [...element.querySelectorAll<HTMLElement>('[data-focus-active="1"], [data-shown-change="1"]'), target];
    const changeEnd = Math.max(...changeRows.map((row) => offsetOf(row) + row.offsetHeight));
    return changeEnd - offsetOf(head) <= element.clientHeight - 40 ? Math.max(0, offsetOf(head) - 8) : centred;
  };
  const scrolledFor = useRef('');
  const scrollTimer = useRef<number | null>(null);
  // Set when this pane has just been placed for the first time; read by the arrival below.
  const placedFirst = useRef(false);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null || scrolledFor.current === scrollKey) {
      return;
    }
    const findTarget = (): HTMLElement | null =>
      ((fromHere !== null && !isActive ? element.querySelector('[data-from="1"]') : null) ??
        element.querySelector('[data-shown-change="1"]') ??
        element.querySelector('[data-shown="1"]')) as HTMLElement | null;
    if (findTarget() === null) {
      return;
    }
    const first = scrolledFor.current === '';
    scrolledFor.current = scrollKey;
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    placedFirst.current = first;
    if (first && savedScroll !== undefined) {
      element.scrollTop = savedScroll.top;
      element.scrollLeft = wrap ? 0 : savedScroll.left;
      return;
    }
    const scrollNow = (behavior: ScrollBehavior): void => {
      const target = findTarget();
      if (target !== null) {
        const left = wrap ? 0 : changeLeft(element, rows, shownFocus.indexes);
        element.scrollTo({ top: topFor(element, target), left, behavior });
      }
    };
    if (first || reducedMotion()) {
      scrollNow('auto');
      return;
    }
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      scrollNow('smooth');
    }, 120);
  });
  useEffect(
    () => () => {
      if (scrollTimer.current !== null) {
        window.clearTimeout(scrollTimer.current);
      }
    },
    [],
  );
  /*
   * The line being read: the first row at or below the top of the pane, and how far below
   * the top it is. When lines start or stop wrapping, rows change height; the pane is
   * scrolled so that this row stays where it was (30 October 2026).
   */
  const reading = useRef<{ readonly index: number; readonly offset: number } | null>(null);
  const noteReading = (): void => {
    const element = scroller.current;
    if (element === null) {
      return;
    }
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll<HTMLElement>('[data-row]')].find((entry) => entry.getBoundingClientRect().bottom > top + 1);
    reading.current = row === undefined ? null : { index: Number(row.dataset['row']), offset: row.getBoundingClientRect().top - top };
  };
  const wrapSeen = useRef(wrap);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (wrapSeen.current === wrap || element === null) {
      return;
    }
    wrapSeen.current = wrap;
    const held = reading.current;
    if (held === null) {
      return;
    }
    if (!wrap) {
      // Unwrapped, every row has the same height and is placed by it.
      const at = items.findIndex((item) => item.kind === 'row' && item.index === held.index);
      if (at >= 0) {
        element.scrollTop = Math.max(0, (tops[at] ?? 0) - held.offset);
      }
    }
    const row = element.querySelector<HTMLElement>(`[data-row="${String(held.index)}"]`);
    if (row !== null) {
      element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - held.offset;
    }
  });
  // Arriving by navigation, or as the pane the map opens on: room for the change, and
  // the change in view — vertically, and sideways to where Before and After differ.
  // A pane the reader pans to is left exactly as it was.
  const handledHere = useRef(-1);
  const placeAfterRoom = useRef(false);
  useLayoutEffect(() => {
    const immediate = placedFirst.current;
    placedFirst.current = false;
    const element = scroller.current;
    if (element === null || content === null || arrival < 0 || arrival === arrivalHandled || arrival === handledHere.current) {
      return;
    }
    const findTarget = (): HTMLElement | null =>
      (element.querySelector('[data-shown-change="1"]') ?? element.querySelector('[data-shown="1"]')) as HTMLElement | null;
    if (findTarget() === null) {
      return;
    }
    handledHere.current = arrival;
    handlers.current.arrivalHandled(arrival);
    placeAfterRoom.current = false;
    if (!userSized && !wrap) {
      // The widest focus row, with the line numbers and margins.
      let widest = 0;
      for (const row of element.querySelectorAll('[data-focus="1"] .rv-text')) {
        widest = Math.max(widest, (row as HTMLElement).scrollWidth);
      }
      const numbers = element.querySelector('.rv-row .rv-ln') as HTMLElement | null;
      const marker = element.querySelector('.rv-row .rv-marker') as HTMLElement | null;
      if (widest > 0) {
        placeAfterRoom.current = handlers.current.room(widest + (numbers?.offsetWidth ?? 0) + (marker?.offsetWidth ?? 0) + 34);
      }
    }
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    const place = (behavior: ScrollBehavior): void => {
      const target = findTarget();
      if (target !== null) {
        element.scrollTo({ top: topFor(element, target), left: wrap ? 0 : changeLeft(element, rows, shownFocus.indexes), behavior });
      }
    };
    if (immediate || reducedMotion()) {
      place('auto');
      return;
    }
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      place('smooth');
    }, 120);
  });
  // The walk arrived, by navigation, at a place called from this pane: the call comes
  // into view, once and only vertically. Panning never does this. An arrival issued
  // before this pane was rendered is not its to act on: its first view already goes
  // to the call, and a remembered scroll position is restored, not overridden.
  const callHandledHere = useRef(callArrival);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null || callArrival < 0 || callArrival === callHandledHere.current) {
      return;
    }
    const findCall = (): HTMLElement | null => element.querySelector<HTMLElement>('[data-from="1"]');
    if (findCall() === null) {
      return;
    }
    callHandledHere.current = callArrival;
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    const placeCall = (behavior: ScrollBehavior): void => {
      const target = findCall();
      if (target !== null) {
        const offset = target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
        element.scrollTo({ top: Math.max(0, offset - element.clientHeight / 2 + 20), behavior });
      }
    };
    if (reducedMotion()) {
      placeCall('auto');
      return;
    }
    scrollTimer.current = window.setTimeout(() => {
      scrollTimer.current = null;
      placeCall('smooth');
    }, 120);
  });
  // "Visa källan" asked for this pane: the source line comes into view, also when the
  // pane has just mounted and restored a remembered position. Only vertically.
  const revealHere = useRef(-1);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null || reveal < 0 || reveal === revealHandled || reveal === revealHere.current) {
      return;
    }
    const target = element.querySelector<HTMLElement>('[data-from="1"]');
    if (target === null) {
      return;
    }
    revealHere.current = reveal;
    handlers.current.revealHandled(reveal);
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    const offset = target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
    element.scrollTo({ top: Math.max(0, offset - element.clientHeight / 2 + 20), behavior: 'auto' });
  });
  // The room asked for arrives as a new width a render later: the change is placed
  // sideways again for that width, once. A pane just mounted has had no width change.
  const lastWidth = useRef(width);
  useLayoutEffect(() => {
    const element = scroller.current;
    const widthChanged = lastWidth.current !== width;
    lastWidth.current = width;
    if (element === null || !widthChanged || !placeAfterRoom.current) {
      return;
    }
    placeAfterRoom.current = false;
    element.scrollLeft = wrap ? 0 : changeLeft(element, rows, shownFocus.indexes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
  // The reader's own scrolling wins over a placement that is still pending.
  const yieldToReader = (): void => {
    if (scrollTimer.current !== null) {
      window.clearTimeout(scrollTimer.current);
      scrollTimer.current = null;
    }
    placeAfterRoom.current = false;
  };

  // The middle button dragged inside the pane scrolls it, in both directions.
  const localDrag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  const changed = shownFocus.changed;
  // Before and After apply to a pane where any of its places is a change; the view stays
  // the same as its places are chosen in turn.
  const paneChanged = useMemo(() => paneStations.some((member) => rowsOf(rows, member.place.focus).changed), [paneStations, rows]);
  const effectiveView: CodeView = changed || paneChanged ? view : 'both';
  // The heading says what is drawn: in a diff the window's view — only the From rows
  // (Before), only the To rows (After), or the comparison — and for a file the change
  // does not touch, the one revision it is read at.
  const inDiff = diffFile !== null && !diffFile.binary;
  const shownWord = diffFile?.binary === true ? '' : inDiff ? words.view[effectiveView] : side === 'base' ? words.view.shownFrom : words.view.shownTo;

  // What the pane shows, top to bottom — rows, folds and a note where one side has no
  // code — with where each item starts. Cheap descriptions; only what is near the
  // visible part becomes elements.
  const layoutRows = useMemo(() => {
    const hidden = (row: DiffRow): boolean =>
      (effectiveView === 'before' && row.kind === 'added') || (effectiveView === 'after' && row.kind === 'deleted');
    const items: PaneItem[] = [];
    const firstFocus = shownFocus.indexes[0] ?? 0;
    const unitName = station.place.unit?.name || structureName;
    // A fold opens, in this order: the rest of the place's function, the rest of its
    // prepared context, then GAP_STEP lines at a time from the side nearest the change.
    // The whole file is a level of its own, never one click on a fold.
    const fold = (start: number, end: number): PaneItem | null => {
      const part = (set: ReadonlySet<number>): readonly [number, number] | null => {
        let from = -1;
        let to = -1;
        for (let row = start; row < end; row += 1) {
          if (set.has(row)) {
            from = from < 0 ? row : from;
            to = row;
          }
        }
        return from < 0 ? null : [from, to];
      };
      // DSP-207: a fold counts the rows it opens in the view shown (Before hides added rows, After
      // removed ones) and says only how many; it never calls them unchanged, as added and removed
      // rows of other changes fold too. A fold that would open no row in this view is not drawn.
      const shownIn = (from: number, to: number): number => {
        let count = 0;
        for (let row = from; row <= to; row += 1) {
          if (!hidden(rows[row] as DiffRow)) {
            count += 1;
          }
        }
        return count;
      };
      const total = shownIn(start, end - 1);
      if (total === 0) {
        return null;
      }
      const unitPart = part(unitSet);
      if (unitPart !== null && shownIn(unitPart[0], unitPart[1]) > 0) {
        const count = shownIn(unitPart[0], unitPart[1]);
        return { kind: 'gap', start, reveal: unitPart, label: unitName === '' ? words.view.hiddenLines(count) : words.view.restOfUnit(unitName, count) };
      }
      const contextPart = part(inContext);
      if (contextPart !== null && shownIn(contextPart[0], contextPart[1]) > 0) {
        return { kind: 'gap', start, reveal: contextPart, label: words.view.hiddenLines(shownIn(contextPart[0], contextPart[1])) };
      }
      if (total <= GAP_STEP + GAP_STEP / 2) {
        return { kind: 'gap', start, reveal: [start, end - 1], label: words.view.hiddenLines(total) };
      }
      const reveal: readonly [number, number] = end <= firstFocus ? [end - GAP_STEP, end - 1] : [start, start + GAP_STEP - 1];
      return { kind: 'gap', start, reveal, label: words.view.moreLines(shownIn(reveal[0], reveal[1]), total) };
    };
    let noteDone = false;
    let index = 0;
    while (index < rows.length) {
      if (visible[index] !== true) {
        const start = index;
        while (index < rows.length && visible[index] !== true) {
          index += 1;
        }
        const gap = fold(start, index);
        if (gap !== null) {
          items.push(gap);
        }
        continue;
      }
      const row = rows[index] as DiffRow;
      if (hidden(row)) {
        if (shownSet.has(index) && !noteDone && !shownFocus.indexes.some((focusIndex) => !hidden(rows[focusIndex] as DiffRow))) {
          noteDone = true;
          items.push({ kind: 'nothing', index });
        }
        index += 1;
        continue;
      }
      items.push({ kind: 'row', index });
      index += 1;
    }
    const tops: number[] = [0];
    let columns = 0;
    let firstShown = -1;
    let firstChange = -1;
    let firstFrom = -1;
    for (const item of items) {
      const last = tops[tops.length - 1] ?? 0;
      tops.push(last + (item.kind === 'row' ? ROW_HEIGHT : item.kind === 'gap' ? GAP_HEIGHT : NOTE_HEIGHT));
      if (item.kind !== 'row') {
        continue;
      }
      const row = rows[item.index] as DiffRow;
      columns = Math.max(columns, textColumns(row.text));
      if (shownSet.has(item.index)) {
        firstShown = firstShown < 0 ? item.index : firstShown;
        if (row.kind !== 'context' && firstChange < 0) {
          firstChange = item.index;
        }
      }
      if (fromSet.has(item.index) && firstFrom < 0) {
        firstFrom = item.index;
      }
    }
    return { items, tops, columns, firstShown, firstChange, firstFrom };
  }, [rows, visible, effectiveView, shownFocus, shownSet, fromSet, unitSet, inContext, station.place.unit, structureName, words]);
  const { items, tops, columns } = layoutRows;
  const digits = useMemo(() => lineDigits(rows), [rows]);

  // The part of the pane's content in view, kept in step with scrolling and resizing.
  // Only when the view nears the edge of what is drawn does the pane draw again.
  const rowsBox = useRef<HTMLDivElement>(null);
  const [drawn, setDrawn] = useState<{ readonly from: number; readonly to: number }>({ from: 0, to: 1600 });
  const drawnRef = useRef(drawn);
  drawnRef.current = drawn;
  const follow = useCallback((): void => {
    const element = scroller.current;
    const box = rowsBox.current;
    if (element === null || box === null) {
      return;
    }
    const top = element.scrollTop - (box.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop);
    const bottom = top + element.clientHeight;
    const current = drawnRef.current;
    if (Math.max(0, top - OVERSCAN / 2) >= current.from && bottom + OVERSCAN / 2 <= current.to) {
      return;
    }
    const next = { from: Math.max(0, top - OVERSCAN), to: bottom + OVERSCAN };
    if (next.from === current.from && next.to === current.to) {
      return;
    }
    drawnRef.current = next;
    setDrawn(next);
  }, []);
  useEffect(() => {
    const element = scroller.current;
    if (element === null) {
      return undefined;
    }
    const observer = new ResizeObserver(() => follow());
    observer.observe(element);
    return () => observer.disconnect();
  }, [follow]);
  // After the content changes (a fold opened, another level) the view is checked again.
  useLayoutEffect(() => follow(), [follow, items]);

  // The items to draw: those near the visible part, and always the focus and the call,
  // which placement, the arrow and the map's choice of active place measure.
  const body: JSX.Element[] = [];
  if (content !== null && content.error === null) {
    const wanted: number[] = [];
    const first = wrap ? 0 : firstAtOrAfter(tops, drawn.from);
    for (let item = Math.max(0, first - 1); item < items.length && (wrap || (tops[item] ?? 0) < drawn.to); item += 1) {
      wanted.push(item);
    }
    items.forEach((item, at) => {
      if (item.kind === 'row' && (shownSet.has(item.index) || fromSet.has(item.index))) {
        wanted.push(at);
      }
    });
    const order = [...new Set(wanted)].sort((a, b) => a - b);
    let next = 0;
    for (const at of order) {
      if (at > next) {
        body.push(<div key={`space-${String(next)}`} className="rv-spacer" style={{ height: `${String((tops[at] ?? 0) - (tops[next] ?? 0))}px` }} />);
      }
      const item = items[at] as PaneItem;
      body.push(drawItem(item));
      next = at + 1;
    }
    if (next < items.length) {
      body.push(<div key={`space-${String(next)}`} className="rv-spacer" style={{ height: `${String((tops[items.length] ?? 0) - (tops[next] ?? 0))}px` }} />);
    }
  }

  function drawItem(item: PaneItem): JSX.Element {
    if (item.kind === 'gap') {
      return (
        <div key={`gap-${String(item.start)}`} className="rv-gap">
          <button type="button" onClick={() => setOpened((current) => [...current, item.reveal])}>
            {item.label}
          </button>
        </div>
      );
    }
    if (item.kind === 'nothing') {
      return (
        <div key={`none-${String(item.index)}`} className="rv-nothing">
          {effectiveView === 'before' ? words.view.nothingBefore : words.view.nothingAfter}
        </div>
      );
    }
    const index = item.index;
    const row = rows[index] as DiffRow;
    const inShown = shownSet.has(index);
    const rowSide: RevisionSide = row.targetLine !== null ? 'target' : 'base';
    const lineTokens = rowSide === 'target' ? content?.tokens.target[(row.targetLine ?? 1) - 1] : content?.tokens.base[(row.baseLine ?? 1) - 1];
    const classes = ['rv-row'];
    // DSP-202: a place's own changed rows are light red and green in every pane; other changed
    // rows a weaker, still clear red and green; unchanged rows keep the code view's background,
    // also inside a reference. The amber edge and the gold flash are the arriving place's
    // changed rows only, so context, the whole reference and other panes never flash.
    if (row.kind === 'deleted') {
      classes.push(ownRows.has(index) ? 'rv-old' : 'rv-old-faint');
    } else if (row.kind === 'added') {
      classes.push(ownRows.has(index) ? 'rv-new' : 'rv-new-faint');
    }
    const arrivalHere = arrivalRows.has(index);
    if (arrivalHere) {
      classes.push('rv-focus-active');
      if (arriving) {
        classes.push('rv-arrive');
      }
    }
    const isFrom = fromSet.has(index);
    if (isFrom) {
      classes.push('rv-from');
    }
    if (selectionSet.has(index)) {
      classes.push('rv-row-selected');
    }
    const attrs: Record<string, string> = {};
    if (side === 'target' && row.targetLine !== null) {
      attrs['data-line'] = String(row.targetLine);
    } else if (side === 'base' && row.baseLine !== null) {
      attrs['data-line'] = String(row.baseLine);
    }
    if (inShown) {
      attrs['data-focus'] = '1';
    }
    if (arrivalHere) {
      attrs['data-focus-active'] = '1';
    }
    if (unitHeads.has(index)) {
      attrs['data-unit-head'] = '1';
    }
    if (index === layoutRows.firstShown) {
      attrs['data-shown'] = '1';
    }
    if (index === layoutRows.firstChange) {
      attrs['data-shown-change'] = '1';
    }
    if (isActive && inShown && (index === layoutRows.firstChange || (!changed && index === layoutRows.firstShown))) {
      attrs['data-active-focus'] = '1';
    }
    if (index === layoutRows.firstFrom) {
      attrs['data-from'] = '1';
    }
    const mark =
      row.kind === 'deleted'
        ? { sign: '−', word: words.view.before }
        : row.kind === 'added'
          ? { sign: '+', word: words.view.after }
          : isFrom
            ? { sign: '↳', word: words.timeline.call }
            : null;
    return (
      <div
        key={`row-${String(index)}`}
        className={classes.join(' ')}
        {...attrs}
        // Where this row's text is, for a text selection to ask about (`walk-selection.ts`).
        data-row={index}
        data-sel-side={rowSide}
        data-sel-path={path}
        data-sel-line={String((rowSide === 'target' ? row.targetLine : row.baseLine) ?? '')}
      >
        <LineGutter
          base={row.baseLine}
          target={row.targetLine}
          mark={mark}
          strong={inShown || isFrom}
          title={words.view.selectLine}
          onSelect={(shift) => select(row, shift)}
        />
        <code className="rv-text">
          <TokensView tokens={lineTokens} />
        </code>
      </div>
    );
  }

  return (
    <section
      className={`rv-pane ${isActive ? 'rv-pane-active' : 'rv-pane-inactive'} rv-pane-${direction}`}
      data-pane-key={station.key}
      data-pane-index={paneIndex}
      aria-current={isActive ? 'location' : undefined}
    >
      <header className="rv-pane-head">
        <span className="rv-step-id rv-pane-step">{station.stepId}</span>
        <span className="rv-path" title={path}>
          {fileName(path)}
        </span>
        <span className="rv-sub rv-pane-shown" title={inDiff ? undefined : words.side[side]}>
          {shownWord}
        </span>
        {content !== null && content.error === null && !changed && <span className="rv-unchanged-tag">{words.view.unchangedHere}</span>}
        {level === 'unit' && contextUncertain && (
          <span className="rv-sub rv-pane-uncertain" data-ev="pane-context-uncertain" title={words.view.contextUncertainTitle}>
            {words.view.contextUncertain}
          </span>
        )}
        {isActive && (
          // What the mark in this pane is, in full (DSP-175): the place, the repository,
          // the revision and side its lines are at, and the lines — not a file name alone.
          <span className="rv-pane-focus" data-ev="pane-focus-identity" data-focus-side={side} data-focus-start={station.place.focus.start} data-focus-end={station.place.focus.end}>
            <span className="rv-pane-focus-mark" aria-hidden="true">▍</span>
            {focusIdentity(focusName, path, station.place.focus, revision, words)}
          </span>
        )}
        {isActive && fromRow !== null && (
          <span className="rv-pane-from">
            ← <Inline text={pick(fromRow.label, lang)} /> ({fileName(fromRow.ref.path)}:{rangeText(fromRow.ref)})
            {sourceLink?.kind === 'shown' && <span className="rv-sub"> · {words.timeline.sourceIn(sourceLink.name)}</span>}
            {sourceLink?.kind === 'reveal' && (
              <button type="button" className="rv-link rv-source-link" onClick={() => handlers.current.sourceLink()}>
                {words.timeline.showSource(sourceLink.name)}
              </button>
            )}
            {sourceLink?.kind === 'open' && (
              <button type="button" className="rv-link rv-source-link" onClick={() => handlers.current.sourceLink()}>
                {words.timeline.openSource}
              </button>
            )}
          </span>
        )}
        {sourceFor !== null && (
          <button type="button" className="rv-link rv-source-link" onClick={() => handlers.current.sourceFor()}>
            {words.timeline.sourceFor(sourceFor.name)}
          </button>
        )}
      </header>
      <div
        className={wrap ? 'rv-lines rv-pane-lines rv-lines-wrap' : 'rv-lines rv-pane-lines'}
        data-wrap={wrap ? '1' : '0'}
        ref={scroller}
        onScroll={(event) => {
          noteReading();
          handlers.current.scrollTop(event.currentTarget.scrollTop, event.currentTarget.scrollLeft);
          handlers.current.scrolled();
          follow();
        }}
        onWheel={yieldToReader}
        onPointerDown={(event) => {
          yieldToReader();
          if (event.button === 1) {
            const element = event.currentTarget;
            localDrag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
            element.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
        }}
        onPointerMove={(event) => {
          const drag = localDrag.current;
          if (drag === null || drag.id !== event.pointerId) {
            return;
          }
          event.currentTarget.scrollTop = drag.top - (event.clientY - drag.y);
          event.currentTarget.scrollLeft = drag.left - (event.clientX - drag.x);
        }}
        onPointerUp={(event) => {
          if (localDrag.current?.id === event.pointerId) {
            localDrag.current = null;
          }
        }}
        onPointerCancel={() => {
          localDrag.current = null;
        }}
        onAuxClick={(event) => {
          // The middle button is for dragging here, not for opening anything.
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        {content === null && <div className="rv-empty">{words.view.reading}</div>}
        {content !== null && content.error !== null && (
          <div className="rv-error">{content.error === 'binary' ? words.view.binary : content.error}</div>
        )}
        <div
          className="rv-rows"
          ref={rowsBox}
          style={{ '--rv-digits': String(digits), '--rv-longest': `calc(${String(columns + 2 * digits)}ch + 3.2rem)` } as CSSProperties}
        >
          {/* As wide as the longest line the pane shows, drawn or not: what fitting measures. */}
          <div className="rv-longest" aria-hidden="true" />
          {body}
        </div>
      </div>
    </section>
  );
}

/** One thing a pane shows, top to bottom. */
type PaneItem =
  | { readonly kind: 'row'; readonly index: number }
  | { readonly kind: 'gap'; readonly start: number; readonly reveal: readonly [number, number]; readonly label: string }
  | { readonly kind: 'nothing'; readonly index: number };

/** What a pane calls back. The map refills one lasting box per pane on every render. */
interface PaneHandlers {
  readonly select: (location: CodeLocation | null) => void;
  readonly scrolled: () => void;
  readonly scrollTop: (top: number, left: number) => void;
  /** The pane asks for this much width so its change is readable; true when it will get wider. */
  readonly room: (wanted: number) => boolean;
  readonly arrivalHandled: (seq: number) => void;
  readonly revealHandled: (seq: number) => void;
  readonly sourceLink: () => void;
  readonly sourceFor: () => void;
}

/** The first item that ends after `y`: `tops` holds every item's start and the end. */
function firstAtOrAfter(tops: readonly number[], y: number): number {
  let low = 0;
  let high = tops.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((tops[middle + 1] ?? Infinity) <= y) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** A line's width in columns as `white-space: pre` draws it, tabs every eight. */
function textColumns(text: string): number {
  if (!text.includes('\t')) {
    return text.length;
  }
  let column = 0;
  for (const character of text) {
    column = character === '\t' ? column + 8 - (column % 8) : column + 1;
  }
  return column;
}

/**
 * A pane is drawn again only when something it shows changed. Panning moves the map
 * many times a second; the panes it passes keep their rows. Lists and descriptions
 * the map builds afresh on every render are compared by content; the remembered
 * scroll position only matters when a pane mounts.
 */
function samePaneProps(before: PaneProps, after: PaneProps): boolean {
  for (const key of Object.keys(after) as (keyof PaneProps)[]) {
    const a = before[key];
    const b = after[key];
    if (a === b || key === 'savedScroll') {
      continue;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length || a.some((value, index) => value !== b[index])) {
        return false;
      }
      continue;
    }
    if ((key === 'sourceLink' || key === 'sourceFor') && a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

type PaneProps = Parameters<typeof TimelinePaneView>[0];

const TimelinePane = memo(TimelinePaneView, samePaneProps);

// --- The file tree ----------------------------------------------------------------

interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, TreeNode>;
  readonly file: boolean;
}

function buildTree(paths: readonly string[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), file: false };
  for (const path of paths) {
    let node = root;
    const parts = path.split('/');
    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1;
      const childPath = parts.slice(0, index + 1).join('/');
      let child = node.children.get(part);
      if (child === undefined) {
        child = { name: part, path: childPath, children: new Map(), file: isFile };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  return root;
}

/**
 * The whole repository at the target revision (and files that only exist in the
 * base), with only the current file's folders open. When the current file changes,
 * its path opens and the tree scrolls to it.
 */
export function FileTree({
  paths,
  changed,
  current,
  words,
  onOpen,
}: {
  readonly paths: readonly string[];
  readonly changed: ReadonlyMap<string, DiffFile>;
  readonly current: string | null;
  readonly words: ReviewWords;
  readonly onOpen: (file: string) => void;
}): JSX.Element {
  const [onlyChanged, setOnlyChanged] = useState(false);
  const shownPaths = useMemo(() => (onlyChanged ? paths.filter((path) => changed.has(path)) : paths), [paths, changed, onlyChanged]);
  const tree = useMemo(() => buildTree(shownPaths), [shownPaths]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [justOpened, setJustOpened] = useState<ReadonlySet<string>>(new Set());
  const container = useRef<HTMLDivElement>(null);

  // Only the current file's folders are open; the path opens as the file changes.
  useEffect(() => {
    if (current === null) {
      return;
    }
    const parts = current.split('/');
    const ancestors = new Set(parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/')));
    setJustOpened(new Set([...ancestors].filter((path) => !open.has(path))));
    setOpen(ancestors);
    const timer = window.setTimeout(() => setJustOpened(new Set()), 600);
    return () => window.clearTimeout(timer);
  }, [current]);

  useEffect(() => {
    const element = container.current?.querySelector('[data-tree-current="1"]');
    if (element !== null && element !== undefined) {
      element.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }, [current, open]);

  const render = (node: TreeNode, depth: number): JSX.Element[] => {
    const children = [...node.children.values()].sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
    return children.map((child) => {
      if (child.file) {
        const diff = changed.get(child.path);
        const isCurrent = child.path === current;
        return (
          <li key={child.path}>
            <button
              type="button"
              className={`rv-tree-file${isCurrent ? ' rv-tree-current' : ''}${diff === undefined ? '' : ' rv-tree-changed'}`}
              style={{ paddingLeft: `${String(depth * 0.8 + 1.1)}rem` }}
              {...(isCurrent ? { 'data-tree-current': '1' } : {})}
              title={child.path}
              onClick={() => onOpen(child.path)}
            >
              {diff !== undefined && <span className={`rv-status rv-status-${diff.status}`}>{diff.status.charAt(0).toUpperCase()}</span>}
              <span>{child.name}</span>
              {diff !== undefined && (
                <span className="rv-sub">
                  +{diff.added} −{diff.deleted}
                </span>
              )}
            </button>
          </li>
        );
      }
      const isOpen = open.has(child.path);
      return (
        <li key={child.path}>
          <button
            type="button"
            className="rv-tree-dir"
            style={{ paddingLeft: `${String(depth * 0.8 + 0.2)}rem` }}
            aria-expanded={isOpen}
            onClick={() => {
              const next = new Set(open);
              if (isOpen) {
                next.delete(child.path);
              } else {
                next.add(child.path);
              }
              setOpen(next);
            }}
          >
            <span className="rv-chevron">{isOpen ? '▾' : '▸'}</span> {child.name}
          </button>
          {isOpen && <ul className={justOpened.has(child.path) ? 'rv-tree-list rv-tree-opening' : 'rv-tree-list'}>{render(child, depth + 1)}</ul>}
        </li>
      );
    });
  };

  return (
    <div className="rv-tree" ref={container}>
      <div className="rv-tree-head">
        <span className="rv-section-title">{words.tree.title}</span>
        <label className="rv-check">
          <input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} /> {words.tree.onlyChanged}
        </label>
      </div>
      <ul className="rv-tree-list">{render(tree, 0)}</ul>
    </div>
  );
}
