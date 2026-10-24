import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';

import { Inline, TokensView, fileName, rangeText, useRows, type Files } from './review-code';
import { pick, type ReviewWords } from './review-i18n';
import {
  referenceRows,
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
 * Every place of a walk is a station, and every station has a pane of its own, in
 * walk order from left to right: two places in the same file stand side by side with
 * their own focus, and a return to an earlier file opens a new pane further right.
 * The panes keep their identity, order, width and local scroll position; only what
 * is far off screen is left unrendered.
 *
 * Two interactions are kept apart: the middle mouse button dragged inside a pane
 * scrolls that pane, and Shift with the left button dragged over the code pans the
 * whole map. Previous/Next and the other step navigation slide the same map; the
 * explanation follows the active station, also when the map is panned by hand, and
 * only switches when the viewport's centre is well inside another pane.
 *
 * Before/After is each pane's own choice of revision side and has nothing to do with
 * the map's direction.
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
/** A pointer must travel this far before a press becomes a drag. */
const DRAG_THRESHOLD = 6;
/** The viewport's centre must be this far inside another pane before it becomes active. */
const ACTIVATION_INSET = 0.15;

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

/** The rows a station shows at a level: its focus, its unit (or prepared context), or everything. */
function stationRange(rows: readonly DiffRow[], place: Place, level: CodeLevel, focusIndexes: readonly number[]): [number, number] | null {
  if (rows.length === 0 || focusIndexes.length === 0) {
    return null;
  }
  const first = focusIndexes[0] ?? 0;
  const last = focusIndexes[focusIndexes.length - 1] ?? first;
  let from = first - FOCUS_MARGIN;
  let to = last + FOCUS_MARGIN;
  if (level === 'unit') {
    const unit =
      place.unit !== null && place.unit.ref.path === place.focus.path
        ? place.unit.ref
        : (place.context.find((ref) => ref.path === place.focus.path) ?? null);
    if (unit !== null) {
      const unitRows = referenceRows(rows, unit).indexes;
      if (unitRows.length > 0) {
        from = Math.min(from, unitRows[0] ?? from);
        to = Math.max(to, unitRows[unitRows.length - 1] ?? to);
      }
    }
  }
  if (level === 'file') {
    return [0, rows.length - 1];
  }
  return [Math.max(0, from), Math.min(rows.length - 1, to)];
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

/**
 * The pane the walk's link into `station` leads from: the nearest earlier pane that
 * shows the file and side of the call. Two panes of the same file are two panes.
 */
function fromPaneOf(stations: readonly Station[], station: Station | undefined): number | null {
  const from = station?.place.from;
  if (station === undefined || from === null || from === undefined) {
    return null;
  }
  const key = `${from.ref.path}\|${from.ref.side}`;
  for (let index = station.index - 1; index >= 0; index -= 1) {
    if (stations[index]?.key === key) {
      return index;
    }
  }
  return null;
}

export function WalkTimeline({
  walk,
  stations,
  active,
  onActivate,
  diffFiles,
  files,
  level,
  view,
  highlightWalk,
  entry,
  selection,
  onSelect,
  words,
  lang,
}: {
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
  readonly highlightWalk: boolean;
  readonly words: ReviewWords;
  readonly lang: Lang;
}): JSX.Element {
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

  // Pane widths: a shared default until the reader changes one. Half the viewport
  // shows two panes side by side; a wide window still gets readable panes.
  const defaultWidth = Math.max(MIN_PANE_WIDTH, Math.min(900, Math.floor((viewWidth - PANE_GAP) / 2)));
  const [widths, setWidths] = useState<ReadonlyMap<number, number>>(new Map());
  const layout = useMemo(() => layoutOf(stations.length, widths, defaultWidth), [stations.length, widths, defaultWidth]);

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
  const [direction, setDirection] = useState<'forward' | 'backward'>(entry);
  // Read through a ref: a width change must not realign a map the reader has panned.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useLayoutEffect(() => {
    const forward = active >= previousActive.current;
    const moved = active !== previousActive.current;
    previousActive.current = active;
    if (moved) {
      setDirection(forward ? 'forward' : 'backward');
    }
    if (panActivated.current === active) {
      panActivated.current = null;
      return;
    }
    if (viewWidth === 0) {
      return;
    }
    const left = layoutRef.current.lefts[active] ?? 0;
    const width = layoutRef.current.widths[active] ?? defaultWidth;
    const target = forward ? left + width - viewWidth : left;
    setMapX(Math.min(Math.max(0, target), Math.max(0, layoutRef.current.total - viewWidth)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, viewWidth, defaultWidth]);

  // The active station follows the map when it is panned by hand: the pane under the
  // viewport's centre, once the centre is well inside it.
  const settleActive = useCallback(
    (x: number) => {
      const centre = x + viewWidth / 2;
      for (let index = 0; index < stations.length; index += 1) {
        const left = layout.lefts[index] ?? 0;
        const width = layout.widths[index] ?? defaultWidth;
        const inset = width * ACTIVATION_INSET;
        if (centre >= left + inset && centre <= left + width - inset) {
          if (index !== active) {
            panActivated.current = index;
            onActivate(index);
          }
          return;
        }
      }
    },
    [viewWidth, stations.length, layout, defaultWidth, active, onActivate],
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
      let longest = 0;
      for (const text of element.querySelectorAll('.rv-row .rv-text')) {
        longest = Math.max(longest, (text as HTMLElement).scrollWidth);
      }
      const numbers = element.querySelector('.rv-row .rv-ln') as HTMLElement | null;
      const marker = element.querySelector('.rv-row .rv-marker') as HTMLElement | null;
      const fixed = (numbers?.offsetWidth ?? 0) + (marker?.offsetWidth ?? 0) + 34;
      const width = Math.min(Math.max(MIN_PANE_WIDTH, longest + fixed), Math.max(MIN_PANE_WIDTH, viewWidth));
      setWidths((current) => new Map([...current, [index, width]]));
    },
    [viewWidth],
  );

  // Links: a dashed arrow from the call in the pane it leads from to the active focus.
  const activeStation = stations[active];
  const fromPane = useMemo(() => fromPaneOf(stations, activeStation), [stations, activeStation]);
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
    const targetPane = element.querySelector(`[data-pane-index="${String(active)}"]`);
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
    setArrow({ x1: sourceBox.right - box.left - 18, y1, x2: targetBox.left - box.left + 92, y2 });
  }, [activeStation, fromPane, active]);
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
  const scrollTops = useRef(new Map<number, number>());
  const changedFiles = useMemo(() => new Map(diffFiles.map((file) => [file.path, file])), [diffFiles]);
  const overlayByPath = useMemo(() => {
    const map = new Map<string, Place[]>();
    if (highlightWalk) {
      for (const step of walk.steps) {
        for (const place of step.places) {
          map.set(place.focus.path, [...(map.get(place.focus.path) ?? []), place]);
        }
      }
    }
    return map;
  }, [walk, highlightWalk]);

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
          settleActive(x);
        }}
        onPointerUp={(event) => {
          if (resize.current?.id === event.pointerId) {
            resize.current = null;
            return;
          }
          if (pan.current?.id === event.pointerId) {
            swallowClick.current = pan.current.moved;
            if (pan.current.moved) {
              settleActive(mapXRef.current);
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
          {stations.map((station) => {
            const left = layout.lefts[station.index] ?? 0;
            const width = layout.widths[station.index] ?? defaultWidth;
            const rendered = left + width >= renderFrom && left <= renderTo;
            const isActive = station.index === active;
            const path = station.place.focus.path;
            return (
              <div
                key={station.index}
                className={`rv-pane-slot${isActive ? ' rv-pane-slot-active' : ''}`}
                style={{ left: `${String(left)}px`, width: `${String(width)}px` }}
              >
                {rendered ? (
                  <TimelinePane
                    station={station}
                    isActive={isActive}
                    direction={direction}
                    fromRow={isActive ? (activeStation?.place.from ?? null) : null}
                    fromHere={fromPane === station.index && activeStation !== undefined && activeStation.place.from !== null ? activeStation.place.from.ref : null}
                    diffFile={changedFiles.get(path) ?? null}
                    files={files}
                    level={level}
                    view={view}
                    overlay={overlayByPath.get(path) ?? []}
                    sameFile={stations.filter((other) => other.key === station.key && other.index !== station.index)}
                    selection={selection}
                    onSelect={onSelect}
                    words={words}
                    lang={lang}
                    onScrolled={measure}
                    savedScroll={scrollTops.current.get(station.index)}
                    onScrollTop={(top) => scrollTops.current.set(station.index, top)}
                  />
                ) : (
                  <div className="rv-pane-placeholder">
                    {station.stepId} · {fileName(path)}
                  </div>
                )}
                <div
                  className="rv-pane-resize"
                  data-resize-index={station.index}
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
          const changesFile = station.index > 0 && stations[station.index - 1]?.key !== station.key;
          return (
            <button
              key={station.index}
              type="button"
              className={`rv-strip-dot${station.index === active ? ' rv-strip-on' : ''}${changesFile ? ' rv-strip-file' : ''}`}
              title={`${station.stepId} · ${pick(station.place.label, lang).replace(/`/g, '')} · ${fileName(station.place.focus.path)}`}
              aria-label={`${station.stepId} · ${pick(station.place.label, lang).replace(/`/g, '')} · ${fileName(station.place.focus.path)}`}
              aria-current={station.index === active ? 'step' : undefined}
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

function TimelinePane({
  station,
  isActive,
  direction,
  fromRow,
  fromHere,
  diffFile,
  files,
  level,
  view,
  overlay,
  sameFile,
  selection,
  onSelect,
  words,
  lang,
  onScrolled,
  savedScroll,
  onScrollTop,
}: {
  readonly selection: CodeLocation | null;
  readonly onSelect: (location: CodeLocation | null) => void;
  readonly station: Station;
  readonly isActive: boolean;
  readonly direction: 'forward' | 'backward';
  readonly fromRow: Place['from'];
  readonly fromHere: CodeLocation | null;
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly level: CodeLevel;
  readonly view: CodeView;
  readonly overlay: readonly Place[];
  /** The walk's other stations in this file: their focus shows faintly, as orientation. */
  readonly sameFile: readonly Station[];
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onScrolled: () => void;
  readonly savedScroll: number | undefined;
  readonly onScrollTop: (top: number) => void;
}): JSX.Element {
  const path = station.place.focus.path;
  const side = station.place.focus.side;
  const content = useRows(files, path, diffFile, side);
  const rows = content?.rows ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  // A gap is opened in two stages when a declared context ends inside it: first the
  // rest of that context (the enclosing function of a block), then everything.
  const [openGaps, setOpenGaps] = useState<ReadonlyMap<number, 'context' | 'all'>>(new Map());
  const inContext = useMemo(() => {
    const set = new Set<number>();
    for (const ref of station.place.context) {
      if (ref.path === path && (ref.side ?? 'target') === side) {
        for (const index of referenceRows(rows, ref).indexes) {
          set.add(index);
        }
      }
    }
    return set;
  }, [rows, station.place.context, path, side]);

  const shownFocus = useMemo(() => referenceRows(rows, station.place.focus), [rows, station.place.focus]);
  const shownSet = useMemo(() => new Set(shownFocus.indexes), [shownFocus]);
  const otherFocus = useMemo(() => {
    const set = new Set<number>();
    for (const other of sameFile) {
      referenceRows(rows, other.place.focus).indexes.forEach((row) => set.add(row));
    }
    return set;
  }, [rows, sameFile]);
  const overlaySet = useMemo(() => {
    const set = new Set<number>();
    for (const place of overlay) {
      referenceRows(rows, place.focus).indexes.forEach((row) => set.add(row));
      for (const ref of place.context) {
        if (ref.path === path) {
          referenceRows(rows, ref).indexes.forEach((row) => set.add(row));
        }
      }
    }
    return set;
  }, [overlay, rows, path]);
  const fromLocation = fromHere ?? (fromRow !== null && fromRow.ref.path === path && fromRow.ref.side === side ? fromRow.ref : null);
  const fromSet = useMemo(() => (fromLocation === null ? new Set<number>() : new Set(referenceRows(rows, fromLocation).indexes)), [fromLocation, rows]);
  const selectionSet = useMemo(
    () => (selection === null || selection.path !== path ? new Set<number>() : new Set(referenceRows(rows, selection).indexes)),
    [selection, rows, path],
  );
  const select = (row: DiffRow, extend: boolean): void => {
    const rowSide: RevisionSide = row.targetLine !== null ? 'target' : 'base';
    const line = row.targetLine ?? row.baseLine;
    if (line === null) {
      return;
    }
    if (extend && selection !== null && selection.path === path && selection.side === rowSide) {
      onSelect({ ...selection, start: Math.min(selection.start, line), end: Math.max(selection.end, line) });
    } else {
      onSelect({ path, side: rowSide, start: line, end: line });
    }
  };

  // Visible rows: this station at the chosen level, the link source, and anything
  // opened by hand. The rest folds into gaps.
  const visible = useMemo(() => {
    const keep = rows.map(() => false);
    const range = stationRange(rows, station.place, level, shownFocus.indexes);
    if (range !== null) {
      keep.fill(true, range[0], range[1] + 1);
    }
    for (const index of fromSet) {
      keep.fill(true, Math.max(0, index - GAP_CONTEXT), Math.min(rows.length, index + GAP_CONTEXT + 1));
    }
    let index = 0;
    while (index < keep.length) {
      if (keep[index] === true) {
        index += 1;
        continue;
      }
      const start = index;
      while (index < keep.length && keep[index] !== true) {
        index += 1;
      }
      const stage = openGaps.get(start);
      if (stage === 'all') {
        keep.fill(true, start, index);
      } else if (stage === 'context') {
        for (let row = start; row < index; row += 1) {
          if (inContext.has(row)) {
            keep[row] = true;
          }
        }
      }
    }
    return keep;
  }, [rows, station.place, level, shownFocus, fromSet, openGaps, inContext]);

  // Arriving: the focus flashes briefly when the walk reaches this pane.
  const [arriving, setArriving] = useState(false);
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (isActive && !wasActive.current && !reducedMotion()) {
      setArriving(true);
      const settle = window.setTimeout(() => setArriving(false), 1600);
      wasActive.current = isActive;
      return () => {
        window.clearTimeout(settle);
        setArriving(false);
      };
    }
    wasActive.current = isActive;
    return undefined;
  }, [isActive]);

  // Scroll to the change itself — its first changed row — or, on the side a call
  // leads from, to the call. A pane that was scrolled and then left the rendered
  // range comes back where it was.
  const scrollKey = `${level}:${view}:${fromHere === null ? '' : String(fromHere.start)}:${String(rows.length)}`;
  const scrolledFor = useRef('');
  const scrollTimer = useRef<number | null>(null);
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null || scrolledFor.current === scrollKey) {
      return;
    }
    const findTarget = (): HTMLElement | null =>
      ((fromHere !== null ? element.querySelector('[data-from="1"]') : null) ??
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
    if (first && savedScroll !== undefined) {
      element.scrollTop = savedScroll;
      return;
    }
    const scrollNow = (behavior: ScrollBehavior): void => {
      const target = findTarget();
      if (target !== null) {
        const offset = target.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
        element.scrollTo({ top: Math.max(0, offset - element.clientHeight / 2 + 20), behavior });
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

  // The middle button dragged inside the pane scrolls it, in both directions.
  const localDrag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  const changed = shownFocus.changed;
  const effectiveView: CodeView = changed ? view : 'both';
  const hidden = (row: DiffRow): boolean =>
    (effectiveView === 'before' && row.kind === 'added') || (effectiveView === 'after' && row.kind === 'deleted');

  const body: JSX.Element[] = [];
  if (content !== null && content.error === null) {
    let index = 0;
    let firstShown = true;
    let firstChange = true;
    let firstFrom = true;
    let noteDone = false;
    while (index < rows.length) {
      if (visible[index] !== true) {
        const start = index;
        while (index < rows.length && visible[index] !== true) {
          index += 1;
        }
        let contextRows = 0;
        for (let row = start; row < index; row += 1) {
          if (inContext.has(row)) {
            contextRows += 1;
          }
        }
        const partial = openGaps.get(start) !== 'context' && contextRows > 0 && contextRows < index - start;
        const gapStart = start;
        body.push(
          <div key={`gap-${String(start)}`} className="rv-gap">
            <button type="button" onClick={() => setOpenGaps(new Map([...openGaps, [gapStart, partial ? 'context' : 'all']]))}>
              {words.view.hiddenLines(partial ? contextRows : index - start)}
            </button>
          </div>,
        );
        continue;
      }
      const row = rows[index] as DiffRow;
      const inShown = shownSet.has(index);
      if (hidden(row)) {
        if (inShown && !noteDone && !shownFocus.indexes.some((focusIndex) => !hidden(rows[focusIndex] as DiffRow))) {
          noteDone = true;
          body.push(
            <div key={`none-${String(index)}`} className="rv-nothing">
              {effectiveView === 'before' ? words.view.nothingBefore : words.view.nothingAfter}
            </div>,
          );
        }
        index += 1;
        continue;
      }
      const rowSide: RevisionSide = row.targetLine !== null ? 'target' : 'base';
      const lineTokens = rowSide === 'target' ? content.tokens.target[(row.targetLine ?? 1) - 1] : content.tokens.base[(row.baseLine ?? 1) - 1];
      const classes = ['rv-row'];
      if (inShown) {
        classes.push(row.kind === 'deleted' ? 'rv-old' : row.kind === 'added' ? 'rv-new' : 'rv-neutral-focus');
        if (arriving) {
          classes.push('rv-arrive');
        }
      } else if (otherFocus.has(index)) {
        classes.push(row.kind === 'deleted' ? 'rv-old-faint' : row.kind === 'added' ? 'rv-new-faint' : 'rv-neutral-faint');
      } else if (row.kind === 'deleted') {
        classes.push('rv-old-faint');
      } else if (row.kind === 'added') {
        classes.push('rv-new-faint');
      } else if (overlaySet.has(index)) {
        classes.push('rv-walk-mark');
      }
      if (overlaySet.has(index) && !inShown && row.kind !== 'context') {
        classes.push('rv-walk-edge');
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
      if (inShown && firstShown) {
        attrs['data-shown'] = '1';
        firstShown = false;
      }
      if (inShown && row.kind !== 'context' && firstChange) {
        attrs['data-shown-change'] = '1';
        firstChange = false;
      }
      if (isActive && inShown && (attrs['data-shown-change'] === '1' || (!changed && attrs['data-shown'] === '1'))) {
        attrs['data-active-focus'] = '1';
      }
      if (isFrom && firstFrom) {
        attrs['data-from'] = '1';
        firstFrom = false;
      }
      const marker = row.kind === 'deleted' ? words.view.before : row.kind === 'added' ? words.view.after : isFrom ? words.timeline.call : '';
      body.push(
        <div key={`row-${String(index)}`} className={classes.join(' ')} {...attrs}>
          <button type="button" className="rv-ln" title={words.view.selectLine} onClick={(event) => select(row, event.shiftKey)}>
            <span>{row.baseLine ?? ''}</span>
            <span>{row.targetLine ?? ''}</span>
          </button>
          <span className={inShown || isFrom ? 'rv-marker rv-marker-strong' : 'rv-marker'}>{marker}</span>
          <code className="rv-text">
            <TokensView tokens={lineTokens} />
          </code>
        </div>,
      );
      index += 1;
    }
  }

  return (
    <section
      className={`rv-pane ${isActive ? 'rv-pane-active' : 'rv-pane-inactive'} rv-pane-${direction}`}
      data-pane-key={station.key}
      data-pane-index={station.index}
      aria-current={isActive ? 'location' : undefined}
    >
      <header className="rv-pane-head">
        <span className="rv-step-id rv-pane-step">{station.stepId}</span>
        <span className="rv-path" title={path}>
          {fileName(path)}
        </span>
        <span className="rv-sub">{side === 'base' ? words.side.base : ''}</span>
        {content !== null && content.error === null && !changed && <span className="rv-unchanged-tag">{words.view.unchangedHere}</span>}
        {isActive && fromRow !== null && (
          <span className="rv-pane-from">
            ← <Inline text={pick(fromRow.label, lang)} /> ({fileName(fromRow.ref.path)}:{rangeText(fromRow.ref)})
          </span>
        )}
      </header>
      <div
        className="rv-lines rv-pane-lines"
        ref={scroller}
        onScroll={(event) => {
          onScrollTop(event.currentTarget.scrollTop);
          onScrolled();
        }}
        onPointerDown={(event) => {
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
        {body}
      </div>
    </section>
  );
}

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
