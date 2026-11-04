import fs from 'node:fs';
import path from 'node:path';

import type { MenuItemConstructorOptions } from 'electron';

import {
  clampZoomLevel,
  parseWindowZoomLevels,
  serializeWindowZoomLevels,
  zoomCommandFor,
  zoomLevelAfter,
  type WindowZoomKind,
  type WindowZoomLevels,
  type ZoomCommand,
  type ZoomKeyInput,
} from '../shared/window-zoom';

/*
 * Each window's zoom, kept on the client (DSP-167).
 *
 * **Why Electron's own zoom was not enough.** Chromium keeps a page's zoom per origin, and
 * Electron's `webContents.setZoomLevel` and its `zoomIn`/`zoomOut` menu roles use that: in
 * development every DSpatch window loads `http://localhost:5273`, so zooming the chat zoomed the
 * review beside it, and the roles step by 0.5. Measured on Electron 44.3.0 (4 November 2026):
 * with `setZoomMode('isolated')` a WebContents has a level of its own that survives reloads and
 * navigations, and a `WebContentsView` keeps its level when it is moved between windows; a level
 * set before the first load is lost, while one a preload sets with `webFrame.setZoomLevel` as the
 * document starts holds. So every page's preload asks this module for its window's level on
 * `WINDOW_ZOOM_LEVEL_CHANNEL` before the page runs, which is also what puts a reopened window at
 * its size before it is shown, and changes made later are applied from here.
 *
 * **A window is a unit.** A window's level applies to every page shown in it: its own page, and
 * the review panel while that is docked in it. The panel's page is a WebContents of its own,
 * so it is attached to whichever window it is in, and follows that window's level; in its own
 * window it has that window's remembered level, which docking neither changes nor forgets.
 *
 * **Keys are read here, before the page.** `before-input-event` comes before the page's own
 * handlers and before menu accelerators, so a zoom key pressed in the chat's text field, in a
 * code view or anywhere else changes the window and reaches nothing else; the menu items carry
 * the same shortcuts for the person to see, and act when the keys do not reach a page.
 */

/** The file in the client's user data. */
export const WINDOW_ZOOM_FILE = 'window-zoom.json';

export class WindowZoomStore {
  private levels: WindowZoomLevels | null = null;

  private readonly file: string;

  private readonly log: (message: string) => void;

  constructor(file: string, log: (message: string) => void) {
    this.file = file;
    this.log = log;
  }

  /** The remembered level of a window identity; normal size when none is. */
  levelFor(kind: WindowZoomKind): number {
    return this.read()[kind] ?? 0;
  }

  remember(kind: WindowZoomKind, level: number): void {
    const next = { ...this.read(), [kind]: clampZoomLevel(level) };
    this.levels = next;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(`${this.file}.tmp`, serializeWindowZoomLevels(next), { mode: 0o600 });
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch (error) {
      this.log(`the window zoom could not be saved to ${this.file}: ${String(error)}`);
    }
  }

  private read(): WindowZoomLevels {
    if (this.levels === null) {
      let text = '';
      try {
        text = fs.readFileSync(this.file, 'utf8');
      } catch {
        // No file yet: every window at normal size.
      }
      this.levels = parseWindowZoomLevels(text);
    }
    return this.levels;
  }
}

/** What this module needs of a page: the parts of Electron's `WebContents` it uses. */
export interface ZoomContents {
  readonly id: number;
  isDestroyed(): boolean;
  setZoomMode(mode: 'default' | 'isolated' | 'manual' | 'disabled'): void;
  setZoomLevel(level: number): void;
  on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: ZoomKeyInput) => void): this;
  once(event: 'destroyed', listener: () => void): this;
}

/** What this module needs of a window: the parts of Electron's `BrowserWindow` it uses. */
export interface ZoomWindow {
  readonly id: number;
  readonly webContents: ZoomContents;
  isDestroyed(): boolean;
  once(event: 'closed', listener: () => void): this;
}

interface ZoomedWindow {
  readonly kind: WindowZoomKind;
  level: number;
  readonly pages: Set<ZoomContents>;
}

export class WindowZoom {
  private readonly windows = new Map<number, ZoomedWindow>();

  /** The window each attached page is shown in, by the page's id. */
  private readonly pageWindows = new Map<number, number>();

  private readonly store: WindowZoomStore;

  private readonly log: (message: string) => void;

  constructor(store: WindowZoomStore, log: (message: string) => void) {
    this.store = store;
    this.log = log;
  }

  /** A window of an identity, from now until it closes: its own page is attached at once. */
  adopt(window: ZoomWindow, kind: WindowZoomKind): void {
    const level = this.store.levelFor(kind);
    this.windows.set(window.id, { kind, level, pages: new Set() });
    window.once('closed', () => {
      const zoomed = this.windows.get(window.id);
      this.windows.delete(window.id);
      for (const page of zoomed?.pages ?? []) {
        this.pageWindows.delete(page.id);
      }
    });
    this.attach(window.webContents, window);
    if (level !== 0) {
      this.log(`window ${kind} opens at zoom level ${String(level)}`);
    }
  }

  /**
   * A page shown in a window: it takes the window's level now and follows its changes. A page
   * attached to a second window leaves the first, which is how the review panel moves.
   */
  attach(page: ZoomContents, window: ZoomWindow): void {
    const zoomed = this.windows.get(window.id);
    if (zoomed === undefined || page.isDestroyed()) {
      return;
    }
    const before = this.pageWindows.get(page.id);
    if (before === window.id) {
      return;
    }
    if (before !== undefined) {
      this.windows.get(before)?.pages.delete(page);
    } else {
      // First seen: the level is this page's own, not its origin's; and its keys are read here.
      page.setZoomMode('isolated');
      page.on('before-input-event', (event, input) => {
        const command = zoomCommandFor(input);
        const at = this.pageWindows.get(page.id);
        if (command === null || at === undefined) {
          return;
        }
        event.preventDefault();
        this.apply(at, command);
      });
      page.once('destroyed', () => {
        const at = this.pageWindows.get(page.id);
        this.pageWindows.delete(page.id);
        if (at !== undefined) {
          this.windows.get(at)?.pages.delete(page);
        }
      });
    }
    zoomed.pages.add(page);
    this.pageWindows.set(page.id, window.id);
    // A page moved between windows takes the new window's level now. A page seen for the first
    // time is not touched: it has not loaded, a level set now is lost at its first load, and its
    // preload applies the level as the page starts. On Linux a zoom set on a page that has not
    // drawn yet kept the hidden window's renderer from drawing its first frame, and a window
    // shown on that frame never appeared (DSP-168).
    if (before !== undefined) {
      page.setZoomLevel(zoomed.level);
    }
  }

  /** The level a page's window has: what its preload applies before the page runs. */
  levelForPage(pageId: number): number {
    const at = this.pageWindows.get(pageId);
    return at === undefined ? 0 : (this.windows.get(at)?.level ?? 0);
  }

  levelOf(window: Pick<ZoomWindow, 'id'>): number | null {
    return this.windows.get(window.id)?.level ?? null;
  }

  kindOf(window: Pick<ZoomWindow, 'id'>): WindowZoomKind | null {
    return this.windows.get(window.id)?.kind ?? null;
  }

  /** Zoom a window one step in or out, or back to normal: every page in it, and the memory. */
  zoom(window: Pick<ZoomWindow, 'id'>, command: ZoomCommand): number | null {
    return this.apply(window.id, command);
  }

  private apply(windowId: number, command: ZoomCommand): number | null {
    const zoomed = this.windows.get(windowId);
    if (zoomed === undefined) {
      return null;
    }
    const level = zoomLevelAfter(zoomed.level, command);
    zoomed.level = level;
    for (const page of zoomed.pages) {
      if (!page.isDestroyed()) {
        page.setZoomLevel(level);
      }
    }
    this.store.remember(zoomed.kind, level);
    this.log(`window ${zoomed.kind} zoom ${command}: level ${String(level)}`);
    return level;
  }
}

/**
 * The View menu's three items, for every window's menu. The accelerators are what the menu
 * shows; Windows names the key by the layout in use, so `CommandOrControl+=` reads `Ctrl++` on
 * a Swedish keyboard. The keys themselves are read by `WindowZoom` before any page or menu sees
 * them, so a press is handled once; the items act when a key does not reach a page.
 */
export function zoomMenuItems(zoom: () => Pick<WindowZoom, 'zoom'> | null): MenuItemConstructorOptions[] {
  const act =
    (command: ZoomCommand): MenuItemConstructorOptions['click'] =>
    (_item, window) => {
      if (window !== undefined) {
        zoom()?.zoom(window, command);
      }
    };
  return [
    { id: 'dspatch-zoom-in', label: 'Zoom In', accelerator: 'CommandOrControl+=', click: act('in') },
    { id: 'dspatch-zoom-out', label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: act('out') },
    { id: 'dspatch-zoom-reset', label: 'Reset Zoom', accelerator: 'CommandOrControl+0', click: act('reset') },
  ];
}
