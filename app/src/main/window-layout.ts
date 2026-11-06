import fs from 'node:fs';
import path from 'node:path';

import type { BrowserWindow, Rectangle } from 'electron';

export const WINDOW_LAYOUT_FILE = 'window-layout.json';

interface SavedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface SavedWindowLayout {
  readonly bounds: SavedBounds;
  readonly normalBounds: SavedBounds;
  readonly maximized?: true;
}

interface SavedPanelLayout {
  readonly place?: 'window' | 'diff' | 'walk';
  readonly dockedWidth?: { readonly diff?: number; readonly walk?: number };
}

interface SavedLayoutFile {
  readonly version: 1;
  readonly windows: Readonly<Record<string, SavedWindowLayout>>;
  readonly panels: Readonly<Record<string, SavedPanelLayout>>;
}

export interface LayoutPlacement {
  readonly bounds: SavedBounds;
  readonly maximized: boolean;
}

const EMPTY: SavedLayoutFile = { version: 1, windows: {}, panels: {} };

function whole(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function boundsOf(raw: unknown): SavedBounds | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const x = whole(value['x']);
  const y = whole(value['y']);
  const width = whole(value['width']);
  const height = whole(value['height']);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  if (width < 120 || height < 120 || Math.abs(x) > 100_000 || Math.abs(y) > 100_000 || width > 40_000 || height > 40_000) {
    return null;
  }
  return { x, y, width, height };
}

function windowOf(raw: unknown): SavedWindowLayout | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const bounds = boundsOf(value['bounds']);
  const normalBounds = boundsOf(value['normalBounds']);
  if (bounds === null || normalBounds === null) {
    return null;
  }
  return { bounds, normalBounds, ...(value['maximized'] === true ? { maximized: true as const } : {}) };
}

function panelOf(raw: unknown): SavedPanelLayout | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const place = value['place'] === 'window' || value['place'] === 'diff' || value['place'] === 'walk' ? value['place'] : undefined;
  const widthRaw = value['dockedWidth'];
  const widthRecord = typeof widthRaw === 'object' && widthRaw !== null ? (widthRaw as Record<string, unknown>) : null;
  const diff = widthRecord === null ? null : whole(widthRecord['diff']);
  const walk = widthRecord === null ? null : whole(widthRecord['walk']);
  return {
    ...(place === undefined ? {} : { place }),
    ...(diff === null && walk === null
      ? {}
      : {
          dockedWidth: {
            ...(diff === null ? {} : { diff }),
            ...(walk === null ? {} : { walk }),
          },
        }),
  };
}

function parse(text: string): SavedLayoutFile {
  if (text.trim() === '') {
    return EMPTY;
  }
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>)['version'] !== 1) {
      return EMPTY;
    }
    const value = raw as Record<string, unknown>;
    const windowsRaw = typeof value['windows'] === 'object' && value['windows'] !== null ? (value['windows'] as Record<string, unknown>) : {};
    const panelsRaw = typeof value['panels'] === 'object' && value['panels'] !== null ? (value['panels'] as Record<string, unknown>) : {};
    const windows: Record<string, SavedWindowLayout> = {};
    for (const [key, candidate] of Object.entries(windowsRaw)) {
      const entry = windowOf(candidate);
      if (entry !== null) {
        windows[key] = entry;
      }
    }
    const panels: Record<string, SavedPanelLayout> = {};
    for (const [key, candidate] of Object.entries(panelsRaw)) {
      const entry = panelOf(candidate);
      if (entry !== null) {
        panels[key] = entry;
      }
    }
    return { version: 1, windows, panels };
  } catch {
    return EMPTY;
  }
}

function serialize(layout: SavedLayoutFile): string {
  return `${JSON.stringify(layout, null, 2)}\n`;
}

function visible(bounds: SavedBounds, displays: readonly Rectangle[]): boolean {
  return displays.some((area) => {
    const across = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const down = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return across >= 120 && down >= 60 && bounds.y >= area.y && bounds.y < area.y + area.height - 40;
  });
}

function clampTo(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function fallbackBounds(defaults: { readonly width: number; readonly height: number }, minimum: { readonly width: number; readonly height: number }, primary: Rectangle): SavedBounds {
  const width = clampTo(Math.round(defaults.width), minimum.width, Math.max(minimum.width, primary.width));
  const height = clampTo(Math.round(defaults.height), minimum.height, Math.max(minimum.height, primary.height));
  return {
    width,
    height,
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
  };
}

function fittedBounds(
  saved: SavedBounds | null,
  defaults: { readonly width: number; readonly height: number },
  minimum: { readonly width: number; readonly height: number },
  displays: readonly Rectangle[],
  primary: Rectangle,
): SavedBounds {
  if (saved === null) {
    return fallbackBounds(defaults, minimum, primary);
  }
  const maxWidth = Math.max(...displays.map((display) => display.width), primary.width, minimum.width);
  const maxHeight = Math.max(...displays.map((display) => display.height), primary.height, minimum.height);
  const width = clampTo(saved.width, minimum.width, maxWidth);
  const height = clampTo(saved.height, minimum.height, maxHeight);
  const candidate = { x: saved.x, y: saved.y, width, height };
  if (visible(candidate, displays)) {
    return candidate;
  }
  return {
    width: clampTo(width, minimum.width, primary.width),
    height: clampTo(height, minimum.height, primary.height),
    x: Math.round(primary.x + (primary.width - clampTo(width, minimum.width, primary.width)) / 2),
    y: Math.round(primary.y + (primary.height - clampTo(height, minimum.height, primary.height)) / 2),
  };
}

export class WindowLayoutStore {
  private readonly file: string;

  private readonly log: (message: string) => void;

  private data: SavedLayoutFile | null = null;

  constructor(file: string, log: (message: string) => void) {
    this.file = file;
    this.log = log;
  }

  placementFor(
    key: string,
    defaults: { readonly width: number; readonly height: number },
    minimum: { readonly width: number; readonly height: number },
    displays: readonly Rectangle[],
    primary: Rectangle,
  ): LayoutPlacement {
    const entry = this.read().windows[key];
    const basis = entry?.normalBounds ?? entry?.bounds ?? null;
    return { bounds: fittedBounds(basis, defaults, minimum, displays, primary), maximized: entry?.maximized === true };
  }

  rememberWindowSnapshot(key: string, window: Pick<BrowserWindow, 'isDestroyed' | 'isMaximized' | 'getBounds' | 'getNormalBounds'>): void {
    if (window.isDestroyed()) {
      return;
    }
    const maximized = window.isMaximized();
    const bounds = window.getBounds();
    const normalBounds = maximized ? window.getNormalBounds() : bounds;
    const next = {
      ...this.read(),
      windows: {
        ...this.read().windows,
        [key]: {
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
          normalBounds: { x: normalBounds.x, y: normalBounds.y, width: normalBounds.width, height: normalBounds.height },
          ...(maximized ? { maximized: true as const } : {}),
        },
      },
    };
    this.data = next;
    this.write(next);
  }

  trackWindow(
    window: Pick<BrowserWindow, 'isDestroyed' | 'isMaximized' | 'getBounds' | 'getNormalBounds' | 'on'>,
    key: () => string,
  ): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const saveNow = (): void => this.rememberWindowSnapshot(key(), window);
    const saveSoon = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        saveNow();
      }, 120);
    };
    window.on('move', saveSoon);
    window.on('resize', saveSoon);
    window.on('maximize', saveSoon);
    window.on('unmaximize', saveSoon);
    window.on('close', () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      saveNow();
    });
  }

  panelPlaceFor(key: string): 'window' | 'diff' | 'walk' | null {
    return this.read().panels[key]?.place ?? null;
  }

  rememberPanelPlace(key: string, place: 'window' | 'diff' | 'walk'): void {
    const current = this.read().panels[key] ?? {};
    const next = { ...this.read(), panels: { ...this.read().panels, [key]: { ...current, place } } };
    this.data = next;
    this.write(next);
  }

  panelDockedWidthFor(key: string, view: 'diff' | 'walk'): number | null {
    const width = this.read().panels[key]?.dockedWidth?.[view];
    return width === undefined ? null : width;
  }

  rememberPanelDockedWidth(key: string, view: 'diff' | 'walk', width: number): void {
    const rounded = Math.max(240, Math.min(2400, Math.round(width)));
    const current = this.read().panels[key] ?? {};
    const docked = current.dockedWidth ?? {};
    const next = {
      ...this.read(),
      panels: {
        ...this.read().panels,
        [key]: {
          ...current,
          dockedWidth: { ...docked, [view]: rounded },
        },
      },
    };
    this.data = next;
    this.write(next);
  }

  private read(): SavedLayoutFile {
    if (this.data === null) {
      let text = '';
      try {
        text = fs.readFileSync(this.file, 'utf8');
      } catch {
        // No file yet.
      }
      this.data = parse(text);
    }
    return this.data;
  }

  private write(layout: SavedLayoutFile): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, serialize(layout), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (error) {
      this.log(`the window layout could not be saved to ${this.file}: ${String(error)}`);
    }
  }
}
