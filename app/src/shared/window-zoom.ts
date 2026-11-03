/*
 * Zooming a DSpatch window (DSP-167): what a level is, which keys mean what, and what is saved.
 *
 * **The scale is VS Code's.** A window has an integer zoom level; level 0 is normal size and each
 * step is one level, which scales text and the rest of the interface together by 1.2. VS Code
 * says of `window.zoomLevel` that "each increment above 0 (e.g. 1) or below (e.g. -1) represents
 * zooming 20% larger or smaller", computes `zoomLevelToZoomFactor = 1.2 ** level` from Electron's
 * `scale := 1.2 ^ level`, and bounds the level to -8..8 (`MIN_ZOOM_LEVEL`, `MAX_ZOOM_LEVEL` in
 * `src/vs/platform/window/electron-browser/window.ts`, read 4 November 2026). The same numbers
 * here, so a press feels as it does there.
 *
 * **The keys are VS Code's, read by the character the key gives.** VS Code binds Zoom In to
 * Ctrl+= with Ctrl+Shift+= and Ctrl+NumpadAdd, Zoom Out to Ctrl+- with Ctrl+Shift+- and
 * Ctrl+NumpadSubtract, and Reset to Ctrl+Numpad0 (`desktop.contribution.ts` and
 * `windowActions.ts`); Niclas asked for Ctrl+0 as the reset here (in VS Code Ctrl+0 focuses the
 * side bar). Windows gives those bindings' virtual keys, `VK_OEM_PLUS` and `VK_OEM_MINUS`, to
 * whichever physical key writes `+` and `-` in the layout in use, so on a Swedish keyboard Ctrl
 * with the `+` key zooms in although that key sits where a US keyboard has `-`. Matching on the
 * character the key gives (`KeyboardEvent.key`, which Chromium derives from the layout without
 * the Control modifier) follows that: `+` wherever it is and however it is reached, `=` where the
 * key writes `=` unshifted, `-` and `_`, and the keypad's own keys by their codes. AltGr is
 * Ctrl+Alt on Windows, so an Alt that is down means another character was meant, and the Windows
 * key (`meta`) belongs to the system.
 *
 * **What is saved** is one integer level per window identity, in the client's own user data
 * (`main/window-zoom.ts`), never in a project, on a host or in a provider session: a client that
 * connects to another host keeps its levels, and another computer has its own.
 */

/** The channel a page's preload asks its window's level on, before the page runs. */
export const WINDOW_ZOOM_LEVEL_CHANNEL = 'dspatch:window-zoom-level';

export const ZOOM_MIN_LEVEL = -8;
export const ZOOM_MAX_LEVEL = 8;
/** One press changes the level by this much: VS Code's one increment. */
export const ZOOM_STEP = 1;

/**
 * The identity a window's level is saved under: what the window is for, not which content it
 * shows or which Electron id it got this time. A review window over another pair, or the chat
 * over another project or host, is the same identity, so a change of content changes no saved
 * level and creates none. Two open windows of one identity each keep their own live level; the
 * last change is what is saved and what the next window of that identity opens with.
 */
export const WINDOW_ZOOM_KINDS = [
  /** The chat window, the loop editor on its `#editor` hash included. */
  'main',
  /** The loop editor in a window of its own. */
  'editor',
  /** The chooser that browses a host's folders and files. */
  'host-browse',
  /** A review window over a review definition and its walks. */
  'review-walk',
  /** A review window over a chosen revision pair. */
  'review-diff',
  /** The review's panel, Step and Discussion, in a window of its own. Docked, it has none. */
  'review-panel',
] as const;

export type WindowZoomKind = (typeof WINDOW_ZOOM_KINDS)[number];

export function isWindowZoomKind(value: unknown): value is WindowZoomKind {
  return typeof value === 'string' && (WINDOW_ZOOM_KINDS as readonly string[]).includes(value);
}

/** Electron's scale for a level: `1.2 ^ level`, the formula VS Code quotes. */
export function zoomFactorFor(level: number): number {
  return 1.2 ** level;
}

/** A whole level within the bounds; anything that is not a finite number is normal size. */
export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.min(ZOOM_MAX_LEVEL, Math.max(ZOOM_MIN_LEVEL, Math.round(level)));
}

export type ZoomCommand = 'in' | 'out' | 'reset';

/** The part of Electron's `Input` (a `before-input-event`) that decides a zoom key. */
export interface ZoomKeyInput {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly control: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/**
 * The zoom command a key press means, or `null` for every other key. Only a key going down;
 * a held key repeats, one step per repeat, as in VS Code.
 */
export function zoomCommandFor(input: ZoomKeyInput): ZoomCommand | null {
  if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) {
    return null;
  }
  if (input.key === '+' || (input.key === '=' && !input.shift) || input.code === 'NumpadAdd') {
    return 'in';
  }
  if (input.key === '-' || input.key === '_' || input.code === 'NumpadSubtract') {
    return 'out';
  }
  if (input.key === '0' && !input.shift) {
    return 'reset';
  }
  return null;
}

/** The level a command leads to from the one in force. */
export function zoomLevelAfter(level: number, command: ZoomCommand): number {
  switch (command) {
    case 'in':
      return clampZoomLevel(level + ZOOM_STEP);
    case 'out':
      return clampZoomLevel(level - ZOOM_STEP);
    default:
      return 0;
  }
}

export type WindowZoomLevels = Partial<Record<WindowZoomKind, number>>;

const STORE_VERSION = 1;

/**
 * What a saved file says, keeping only what can be used: a known identity with a whole level
 * within the bounds. A level that is not that is left out, so the window opens at normal size
 * rather than at something the file made up. Text that is not the file's shape is an empty set.
 */
export function parseWindowZoomLevels(text: string): WindowZoomLevels {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  const file = parsed as { readonly version?: unknown; readonly levels?: unknown };
  if (file.version !== STORE_VERSION || typeof file.levels !== 'object' || file.levels === null) {
    return {};
  }
  const levels: Record<string, number> = {};
  for (const [kind, level] of Object.entries(file.levels as Record<string, unknown>)) {
    if (!isWindowZoomKind(kind) || typeof level !== 'number' || !Number.isInteger(level)) {
      continue;
    }
    if (level < ZOOM_MIN_LEVEL || level > ZOOM_MAX_LEVEL) {
      continue;
    }
    levels[kind] = level;
  }
  return levels;
}

/** The file's text for a set of levels; a normal-size window is not written. */
export function serializeWindowZoomLevels(levels: WindowZoomLevels): string {
  const kept: Record<string, number> = {};
  for (const kind of WINDOW_ZOOM_KINDS) {
    const level = levels[kind];
    if (level !== undefined && level !== 0) {
      kept[kind] = clampZoomLevel(level);
    }
  }
  return `${JSON.stringify({ version: STORE_VERSION, levels: kept }, null, 2)}\n`;
}
