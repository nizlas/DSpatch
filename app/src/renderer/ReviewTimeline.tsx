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
 * The walk as a timeline (second user observation, 23 October 2026).
 *
 * Every place of a walk is a station in time. Moving within one file scrolls that
 * file's pane; moving to another file — or back to an earlier one — opens a pane to
 * the right, so time always runs left to right. Two panes are on screen: the one the
 * walk came from and the one it is in, so a call on the left can be seen leading to
 * the function on the right.
 *
 * Nothing jumps. The old marking fades, the view slides or scrolls in the direction
 * of travel, and the new lines flash briefly before settling into their colour. With
 * the operating system's "reduce motion" setting the same changes happen without
 * movement.
 */

export interface Station {
  readonly index: number;
  readonly stepId: string;
  readonly placeIndex: number;
  readonly place: Place;
  /** Path and revision side: a pane holds consecutive stations with the same key. */
  readonly key: string;
}

interface Pane {
  readonly index: number;
  readonly key: string;
  readonly path: string;
  readonly side: RevisionSide;
  readonly stations: readonly Station[];
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

function panesOf(stations: readonly Station[]): Pane[] {
  const panes: Pane[] = [];
  for (const station of stations) {
    const last = panes[panes.length - 1];
    if (last !== undefined && last.key === station.key) {
      panes[panes.length - 1] = { ...last, stations: [...last.stations, station] };
    } else {
      panes.push({
        index: panes.length,
        key: station.key,
        path: station.place.focus.path,
        side: station.place.focus.side,
        stations: [station],
      });
    }
  }
  return panes;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const FOCUS_MARGIN = 4;
const GAP_CONTEXT = 2;
const STEP_DISTANCE = 120;

type CodeView = 'before' | 'both' | 'after';

export function unitLabel(place: Place | null, words: ReviewWords): string {
  const kind = place?.unit?.kind;
  return kind === undefined ? words.levels.context : words.levels.unit[kind];
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
  words,
  lang,
}: {
  readonly walk: Walk;
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
  const panes = useMemo(() => panesOf(stations), [stations]);
  const activePane = panes.find((pane) => pane.stations.some((station) => station.index === active)) ?? panes[0];
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const previousActive = useRef(active);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [leftPane, setLeftPane] = useState(Math.max(0, (activePane?.index ?? 0) - 1));

  // Which two panes are on screen follows the direction of travel.
  useEffect(() => {
    const forward = active >= previousActive.current;
    previousActive.current = active;
    setDirection(forward ? 'forward' : 'backward');
    const index = activePane?.index ?? 0;
    setLeftPane(
      forward ? Math.max(0, index - 1) : index + 1 < panes.length ? index : Math.max(0, index - 1),
    );
  }, [active, activePane, panes.length]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Moving in time: Shift+wheel, a horizontal wheel or trackpad swipe, a right-button
  // drag, or Alt+arrow keys. Each step moves one station.
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
      const sideways = event.shiftKey ? event.deltaY || event.deltaX : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
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
  const drag = useRef<{ x: number; id: number } | null>(null);

  const leftIndex = Math.min(leftPane, Math.max(0, panes.length - 2));
  const paneWidth = panes.length > 1 ? width / 2 : width;
  const offset = -leftIndex * paneWidth;

  // The link from a call on the left to the place on the right.
  const activeStation = stations[active];
  const [arrow, setArrow] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const measure = useCallback(() => {
    const element = viewport.current;
    const from = activeStation?.place.from;
    if (element === null || from === null || from === undefined) {
      setArrow(null);
      return;
    }
    const box = element.getBoundingClientRect();
    const source = element.querySelector(`[data-pane-key="${CSS.escape(`${from.ref.path}\|${from.ref.side}`)}"] [data-line="${String(from.ref.start)}"]`);
    const target = element.querySelector('[data-active-focus="1"]');
    if (source === null || target === null) {
      setArrow(null);
      return;
    }
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const sourcePane = source.closest('[data-pane-key]');
    const targetPane = target.closest('[data-pane-key]');
    if (sourcePane === targetPane || a.bottom < box.top || a.top > box.bottom || a.right < box.left || a.left > box.right) {
      setArrow(null);
      return;
    }
    // Two panes share the width equally: the arrow crosses their common edge, from
    // the call on the left to the place on the right. Only y is read from the rows.
    if (sourcePane === null || targetPane === null || sourcePane.getBoundingClientRect().left >= targetPane.getBoundingClientRect().left) {
      setArrow(null);
      return;
    }
    const middle = box.width / 2;
    setArrow({
      x1: middle - 28,
      y1: a.top + a.height / 2 - box.top,
      x2: middle + 92,
      y2: b.top + b.height / 2 - box.top,
    });
  }, [activeStation]);
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
  }, [measure, offset, level, view]);

  return (
    <div className="rv-timeline">
      <div
        className="rv-timeline-viewport"
        ref={viewport}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button === 2) {
            drag.current = { x: event.clientX, id: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerMove={(event) => {
          if (drag.current === null || drag.current.id !== event.pointerId) {
            return;
          }
          const moved = drag.current.x - event.clientX;
          if (Math.abs(moved) >= STEP_DISTANCE) {
            step(moved > 0 ? 1 : -1);
            drag.current = { x: event.clientX, id: event.pointerId };
          }
        }}
        onPointerUp={(event) => {
          if (drag.current?.id === event.pointerId) {
            drag.current = null;
          }
        }}
        onScroll={measure}
      >
        <div className="rv-timeline-track" style={{ transform: `translateX(${String(offset)}px)` }}>
          {panes.map((pane) => {
            const isActive = pane.index === activePane?.index;
            const onScreen = pane.index === leftIndex || pane.index === leftIndex + 1 || panes.length === 1;
            // The station a pane shows: the active one, or the one nearest in time.
            const shown = isActive
              ? (activeStation ?? pane.stations[0])
              : pane.index < (activePane?.index ?? 0)
                ? pane.stations[pane.stations.length - 1]
                : pane.stations[0];
            const fromHere =
              !isActive &&
              activeStation?.place.from !== null &&
              activeStation?.place.from !== undefined &&
              `${activeStation.place.from.ref.path}\|${activeStation.place.from.ref.side}` === pane.key
                ? activeStation.place.from.ref
                : null;
            return (
              <div key={`${pane.key}:${String(pane.index)}`} className="rv-pane-slot" style={{ width: `${String(paneWidth)}px` }}>
                {onScreen && shown !== undefined ? (
                  <TimelinePane
                    pane={pane}
                    shown={shown}
                    isActive={isActive}
                    direction={direction}
                    fromRow={isActive ? (activeStation?.place.from ?? null) : null}
                    fromHere={fromHere}
                    diffFile={diffFiles.find((file) => file.path === pane.path) ?? null}
                    files={files}
                    level={level}
                    view={view}
                    overlay={highlightWalk ? walk.steps.flatMap((s) => s.places).filter((p) => p.focus.path === pane.path) : []}
                    words={words}
                    lang={lang}
                    onScrolled={measure}
                  />
                ) : (
                  <div className="rv-pane-placeholder">{fileName(pane.path)}</div>
                )}
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
          const pane = panes.find((entry) => entry.stations.some((s) => s.index === station.index));
          const changesFile = station.index > 0 && stations[station.index - 1]?.key !== station.key;
          return (
            <button
              key={station.index}
              type="button"
              className={`rv-strip-dot${station.index === active ? ' rv-strip-on' : ''}${changesFile ? ' rv-strip-file' : ''}`}
              title={`${station.stepId} · ${pick(station.place.label, lang).replace(/`/g, '')} · ${fileName(pane?.path ?? '')}`}
              onClick={() => onActivate(station.index)}
            />
          );
        })}
        <span className="rv-sub rv-strip-hint">{words.timeline.hint}</span>
      </div>
    </div>
  );
}

function TimelinePane({
  pane,
  shown,
  isActive,
  direction,
  fromRow,
  fromHere,
  diffFile,
  files,
  level,
  view,
  overlay,
  words,
  lang,
  onScrolled,
}: {
  readonly pane: Pane;
  readonly shown: Station;
  readonly isActive: boolean;
  readonly direction: 'forward' | 'backward';
  readonly fromRow: Place['from'];
  readonly fromHere: CodeLocation | null;
  readonly diffFile: DiffFile | null;
  readonly files: Files;
  readonly level: CodeLevel;
  readonly view: CodeView;
  readonly overlay: readonly Place[];
  readonly words: ReviewWords;
  readonly lang: Lang;
  readonly onScrolled: () => void;
}): JSX.Element {
  const content = useRows(files, pane.path, diffFile, pane.side);
  const rows = content?.rows ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  const [openGaps, setOpenGaps] = useState<ReadonlySet<number>>(new Set());

  const focusOf = useMemo(() => {
    const map = new Map<number, { indexes: readonly number[]; changed: boolean }>();
    for (const station of pane.stations) {
      map.set(station.index, referenceRows(rows, station.place.focus));
    }
    return map;
  }, [rows, pane.stations]);
  const shownFocus = focusOf.get(shown.index) ?? { indexes: [], changed: false };
  const shownSet = useMemo(() => new Set(shownFocus.indexes), [shownFocus]);
  const otherFocus = useMemo(() => {
    const set = new Set<number>();
    for (const [index, focus] of focusOf) {
      if (index !== shown.index) {
        focus.indexes.forEach((row) => set.add(row));
      }
    }
    return set;
  }, [focusOf, shown.index]);
  const overlaySet = useMemo(() => {
    const set = new Set<number>();
    for (const place of overlay) {
      referenceRows(rows, place.focus).indexes.forEach((row) => set.add(row));
      for (const ref of place.context) {
        if (ref.path === pane.path) {
          referenceRows(rows, ref).indexes.forEach((row) => set.add(row));
        }
      }
    }
    return set;
  }, [overlay, rows, pane.path]);
  const fromLocation = fromHere ?? (fromRow !== null && fromRow.ref.path === pane.path && fromRow.ref.side === pane.side ? fromRow.ref : null);
  const fromSet = useMemo(() => (fromLocation === null ? new Set<number>() : new Set(referenceRows(rows, fromLocation).indexes)), [fromLocation, rows]);

  // Visible rows: every station of this pane at the chosen level, the link source,
  // and anything opened by hand. The rest folds into gaps.
  const visible = useMemo(() => {
    const keep = rows.map(() => false);
    for (const station of pane.stations) {
      const range = stationRange(rows, station.place, level, focusOf.get(station.index)?.indexes ?? []);
      if (range !== null) {
        keep.fill(true, range[0], range[1] + 1);
      }
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
      if (openGaps.has(start)) {
        keep.fill(true, start, index);
      }
    }
    return keep;
  }, [rows, pane.stations, level, focusOf, fromSet, openGaps]);

  // Arriving and leaving: the old marking fades, the new one flashes, then settles.
  const [arriving, setArriving] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const lastShown = useRef<number | null>(null);
  useEffect(() => {
    if (!isActive || lastShown.current === shown.index) {
      lastShown.current = shown.index;
      return;
    }
    const previous = lastShown.current;
    lastShown.current = shown.index;
    if (reducedMotion()) {
      return;
    }
    setLeaving(previous);
    const flash = window.setTimeout(() => {
      setLeaving(null);
      setArriving(shown.index);
    }, 420);
    const settle = window.setTimeout(() => setArriving(null), 1700);
    return () => {
      window.clearTimeout(flash);
      window.clearTimeout(settle);
    };
  }, [isActive, shown.index]);

  // Scroll to the change itself — its first changed row — or, on the side a call
  // leads from, to the call.
  const scrollKey = `${String(shown.index)}:${level}:${view}:${fromHere === null ? '' : String(fromHere.start)}:${String(rows.length)}`;
  const scrolledFor = useRef('');
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element === null || content === null || scrolledFor.current === scrollKey) {
      return;
    }
    const target =
      (fromHere !== null ? element.querySelector('[data-from="1"]') : null) ??
      element.querySelector('[data-shown-change="1"]') ??
      element.querySelector('[data-shown="1"]');
    if (target === null) {
      return;
    }
    const first = scrolledFor.current === '';
    scrolledFor.current = scrollKey;
    const top = (target as HTMLElement).offsetTop - element.clientHeight / 2 + 20;
    element.scrollTo({ top: Math.max(0, top), behavior: first || reducedMotion() ? 'auto' : 'smooth' });
  });

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
        body.push(
          <div key={`gap-${String(start)}`} className="rv-gap">
            <button type="button" onClick={() => setOpenGaps(new Set([...openGaps, start]))}>
              {words.view.hiddenLines(index - start)}
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
      const side: RevisionSide = row.targetLine !== null ? 'target' : 'base';
      const lineTokens = side === 'target' ? content.tokens.target[(row.targetLine ?? 1) - 1] : content.tokens.base[(row.baseLine ?? 1) - 1];
      const classes = ['rv-row'];
      if (inShown) {
        classes.push(row.kind === 'deleted' ? 'rv-old' : row.kind === 'added' ? 'rv-new' : 'rv-neutral-focus');
        if (arriving === shown.index) {
          classes.push('rv-arrive');
        }
      } else if (otherFocus.has(index)) {
        classes.push(row.kind === 'deleted' ? 'rv-old-faint' : row.kind === 'added' ? 'rv-new-faint' : 'rv-neutral-faint');
        if (leaving !== null && (focusOf.get(leaving)?.indexes ?? []).includes(index)) {
          classes.push('rv-leave');
        }
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
      const attrs: Record<string, string> = {};
      if (pane.side === 'target' && row.targetLine !== null) {
        attrs['data-line'] = String(row.targetLine);
      } else if (pane.side === 'base' && row.baseLine !== null) {
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
          <span className="rv-ln" aria-hidden="true">
            <span>{row.baseLine ?? ''}</span>
            <span>{row.targetLine ?? ''}</span>
          </span>
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
      data-pane-key={pane.key}
      aria-current={isActive ? 'location' : undefined}
    >
      <header className="rv-pane-head">
        <span className="rv-path" title={pane.path}>
          {fileName(pane.path)}
        </span>
        <span className="rv-sub">{pane.side === 'base' ? words.side.base : ''}</span>
        {isActive && fromRow !== null && (
          <span className="rv-pane-from">
            ← <Inline text={pick(fromRow.label, lang)} /> ({fileName(fromRow.ref.path)}:{rangeText(fromRow.ref)})
          </span>
        )}
      </header>
      <div className="rv-lines rv-pane-lines" ref={scroller} onScroll={onScrolled}>
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
