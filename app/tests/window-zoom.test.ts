/**
 * Each window's zoom, remembered on the client (DSP-167): the scale and keys, what is saved and
 * read back, and how windows and the pages in them are kept apart. Windows and pages are fakes
 * with the few members `WindowZoom` uses; Electron's real behaviour is in DSP-167's notes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { WINDOW_ZOOM_FILE, WindowZoom, WindowZoomStore, zoomMenuItems, type ZoomContents, type ZoomWindow } from '../src/main/window-zoom.ts';
import {
  WINDOW_ZOOM_LEVEL_CHANNEL,
  ZOOM_MAX_LEVEL,
  ZOOM_MIN_LEVEL,
  clampZoomLevel,
  parseWindowZoomLevels,
  serializeWindowZoomLevels,
  zoomCommandFor,
  zoomFactorFor,
  zoomLevelAfter,
  type ZoomKeyInput,
} from '../src/shared/window-zoom.ts';

const quiet = (): void => undefined;

describe("the scale is VS Code's", () => {
  it('one step is one level, and a level is 1.2 to its power', () => {
    assert.equal(zoomLevelAfter(0, 'in'), 1);
    assert.equal(zoomLevelAfter(1, 'out'), 0);
    assert.equal(zoomLevelAfter(3, 'reset'), 0);
    assert.equal(zoomFactorFor(1), 1.2);
    assert.equal(Math.round(zoomFactorFor(-1) * 1000) / 1000, 0.833);
    assert.equal(zoomFactorFor(0), 1);
  });

  it('stays within -8..8, and a value that is no level is normal size', () => {
    assert.equal(ZOOM_MIN_LEVEL, -8);
    assert.equal(ZOOM_MAX_LEVEL, 8);
    assert.equal(zoomLevelAfter(8, 'in'), 8);
    assert.equal(zoomLevelAfter(-8, 'out'), -8);
    assert.equal(clampZoomLevel(2.4), 2);
    assert.equal(clampZoomLevel(Number.NaN), 0);
    assert.equal(clampZoomLevel(Number.POSITIVE_INFINITY), 0, 'not a level at all, so normal size');
    assert.equal(clampZoomLevel(40), 8);
    assert.equal(clampZoomLevel(-40), -8);
  });
});

describe('the keys', () => {
  const press = (over: Partial<ZoomKeyInput>): ZoomKeyInput => ({ type: 'keyDown', key: '', code: '', control: true, shift: false, alt: false, meta: false, ...over });

  it("reads VS Code's bindings on a US layout", () => {
    assert.equal(zoomCommandFor(press({ key: '=', code: 'Equal' })), 'in');
    assert.equal(zoomCommandFor(press({ key: '+', code: 'Equal', shift: true })), 'in');
    assert.equal(zoomCommandFor(press({ key: '-', code: 'Minus' })), 'out');
    assert.equal(zoomCommandFor(press({ key: '_', code: 'Minus', shift: true })), 'out');
    assert.equal(zoomCommandFor(press({ key: '0', code: 'Digit0' })), 'reset');
  });

  it('reads a Swedish layout by the character the key gives, wherever the key sits', () => {
    // The `+` key sits where a US keyboard has `-`; `-` sits where it has `/`.
    assert.equal(zoomCommandFor(press({ key: '+', code: 'Minus' })), 'in');
    assert.equal(zoomCommandFor(press({ key: '-', code: 'Slash' })), 'out');
    // Shift and the `+` key writes `?`, which is no zoom; the dead key beside it is none either.
    assert.equal(zoomCommandFor(press({ key: '?', code: 'Minus', shift: true })), null);
    assert.equal(zoomCommandFor(press({ key: 'Dead', code: 'Equal' })), null);
  });

  it('reads the keypad by its own keys', () => {
    assert.equal(zoomCommandFor(press({ key: '+', code: 'NumpadAdd' })), 'in');
    assert.equal(zoomCommandFor(press({ key: '-', code: 'NumpadSubtract' })), 'out');
    assert.equal(zoomCommandFor(press({ key: '0', code: 'Numpad0' })), 'reset');
    // Without Num Lock the keypad's 0 is Insert, as in VS Code.
    assert.equal(zoomCommandFor(press({ key: 'Insert', code: 'Numpad0' })), null);
  });

  it('leaves other keys, other modifiers and key-up alone', () => {
    assert.equal(zoomCommandFor(press({ key: '+', code: 'Equal', control: false })), null);
    // AltGr is Ctrl+Alt on Windows: a Swedish `\` is AltGr and the `+` key.
    assert.equal(zoomCommandFor(press({ key: '\\', code: 'Minus', alt: true })), null);
    assert.equal(zoomCommandFor(press({ key: '+', code: 'Minus', alt: true })), null);
    // The Windows key is the system's (Win and + opens Magnifier).
    assert.equal(zoomCommandFor(press({ key: '+', code: 'Minus', meta: true })), null);
    assert.equal(zoomCommandFor(press({ key: '0', code: 'Digit0', shift: true })), null);
    assert.equal(zoomCommandFor(press({ key: 'a', code: 'KeyA' })), null);
    assert.equal(zoomCommandFor(press({ type: 'keyUp', key: '+', code: 'Minus' })), null);
  });
});

describe('what is saved and read back', () => {
  it('keeps known identities with whole levels within the bounds, and nothing else', () => {
    const text = serializeWindowZoomLevels({ main: 2, 'review-diff': -1, editor: 0 });
    assert.deepEqual(parseWindowZoomLevels(text), { main: 2, 'review-diff': -1 });
    const doctored = JSON.stringify({ version: 1, levels: { main: 1.5, editor: 12, 'host-browse': -9, 'review-walk': '2', elsewhere: 3, 'review-panel': -3 } });
    assert.deepEqual(parseWindowZoomLevels(doctored), { 'review-panel': -3 });
  });

  it('reads a missing, broken or foreign file as every window at normal size', () => {
    assert.deepEqual(parseWindowZoomLevels(''), {});
    assert.deepEqual(parseWindowZoomLevels('{ not json'), {});
    assert.deepEqual(parseWindowZoomLevels('[1, 2]'), {});
    assert.deepEqual(parseWindowZoomLevels(JSON.stringify({ version: 2, levels: { main: 1 } })), {});
    assert.deepEqual(parseWindowZoomLevels(JSON.stringify({ levels: { main: 1 } })), {});
  });

  it('the store writes the file in the user data and reads it back in another store', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-zoom-'));
    try {
      const file = path.join(dir, 'client', WINDOW_ZOOM_FILE);
      const store = new WindowZoomStore(file, quiet);
      assert.equal(store.levelFor('main'), 0);
      store.remember('main', 3);
      store.remember('review-panel', -2);
      store.remember('main', 2);
      assert.equal(store.levelFor('main'), 2);
      const again = new WindowZoomStore(file, quiet);
      assert.equal(again.levelFor('main'), 2);
      assert.equal(again.levelFor('review-panel'), -2);
      assert.equal(again.levelFor('editor'), 0);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), [WINDOW_ZOOM_FILE]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the preloads ask on the shared channel', () => {
    for (const preload of ['preload.ts', 'review-preload.ts']) {
      const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'preload', preload), 'utf8');
      assert.ok(source.includes(`ipcRenderer.sendSync('${WINDOW_ZOOM_LEVEL_CHANNEL}')`), preload);
      assert.ok(source.includes('webFrame.setZoomLevel(level)'), preload);
    }
  });
});

/** A page as `WindowZoom` sees it: its level, its mode, and the key and wheel listeners it was given. */
class FakePage implements ZoomContents {
  static next = 1;
  readonly id = FakePage.next++;
  level = 0;
  mode = 'default';
  destroyed = false;
  private keys: ((event: { preventDefault(): void }, input: ZoomKeyInput) => void) | null = null;
  private wheels: ((event: unknown, direction: 'in' | 'out') => void)[] = [];
  private onDestroyed: (() => void) | null = null;
  isDestroyed(): boolean {
    return this.destroyed;
  }
  setZoomMode(mode: 'default' | 'isolated' | 'manual' | 'disabled'): void {
    this.mode = mode;
  }
  setZoomLevel(level: number): void {
    this.level = level;
  }
  on(event: 'before-input-event' | 'zoom-changed', listener: ((event: { preventDefault(): void }, input: ZoomKeyInput) => void) | ((event: unknown, direction: 'in' | 'out') => void)): this {
    if (event === 'before-input-event') {
      this.keys = listener as (event: { preventDefault(): void }, input: ZoomKeyInput) => void;
    } else {
      this.wheels.push(listener as (event: unknown, direction: 'in' | 'out') => void);
    }
    return this;
  }
  once(_event: 'destroyed', listener: () => void): this {
    this.onDestroyed = listener;
    return this;
  }
  /** A key pressed in this page; whether the page would also have seen it. */
  press(input: Partial<ZoomKeyInput>): boolean {
    let prevented = false;
    this.keys?.({ preventDefault: () => (prevented = true) }, { type: 'keyDown', key: '', code: '', control: true, shift: false, alt: false, meta: false, ...input });
    return !prevented;
  }
  /** One notch of the wheel with Control held over this page, as Chromium reports it. */
  wheel(direction: 'in' | 'out'): void {
    for (const listener of this.wheels) {
      listener({}, direction);
    }
  }
  /** How many wheel listeners the page was given: one, however often it moves between windows. */
  wheelListeners(): number {
    return this.wheels.length;
  }
  destroy(): void {
    this.destroyed = true;
    this.onDestroyed?.();
  }
}

class FakeWindow implements ZoomWindow {
  static next = 100;
  readonly id = FakeWindow.next++;
  readonly webContents = new FakePage();
  private onClosed: (() => void) | null = null;
  isDestroyed(): boolean {
    return false;
  }
  once(_event: 'closed', listener: () => void): this {
    this.onClosed = listener;
    return this;
  }
  close(): void {
    this.onClosed?.();
  }
}

function zoomOver(dir: string): { zoom: WindowZoom; file: string } {
  const file = path.join(dir, WINDOW_ZOOM_FILE);
  return { zoom: new WindowZoom(new WindowZoomStore(file, quiet), quiet), file };
}

describe('windows and the pages in them', () => {
  const withDir = (body: (dir: string) => void): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-zoom-'));
    try {
      body(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('two open windows of one identity each keep their own level; the last change is remembered', () => {
    withDir((dir) => {
      const { zoom, file } = zoomOver(dir);
      const first = new FakeWindow();
      const second = new FakeWindow();
      zoom.adopt(first, 'review-diff');
      zoom.adopt(second, 'review-diff');
      assert.equal(first.webContents.mode, 'isolated');
      assert.equal(zoom.zoom(first, 'in'), 1);
      assert.equal(zoom.zoom(first, 'in'), 2);
      assert.equal(first.webContents.level, 2);
      assert.equal(second.webContents.level, 0);
      assert.equal(zoom.zoom(second, 'out'), -1);
      assert.equal(first.webContents.level, 2, 'the other window is left alone');
      assert.deepEqual(parseWindowZoomLevels(fs.readFileSync(file, 'utf8')), { 'review-diff': -1 });
      const third = new FakeWindow();
      zoom.adopt(third, 'review-diff');
      // Its page has not loaded: it is not touched now, and its preload asks for the level.
      assert.equal(third.webContents.level, 0, 'a page that has not drawn yet is left alone (DSP-168)');
      assert.equal(zoom.levelForPage(third.webContents.id), -1, 'a new window of the identity opens at the last change');
    });
  });

  it('a key in a page zooms the window the page is in, and reaches nothing else', () => {
    withDir((dir) => {
      const { zoom } = zoomOver(dir);
      const window = new FakeWindow();
      zoom.adopt(window, 'main');
      assert.equal(window.webContents.press({ key: '+', code: 'Minus' }), false, 'the page would have seen the key');
      assert.equal(zoom.levelOf(window), 1);
      assert.equal(window.webContents.press({ key: '0', code: 'Digit0' }), false);
      assert.equal(zoom.levelOf(window), 0);
      assert.equal(window.webContents.press({ key: 'a', code: 'KeyA' }), true, 'an ordinary key goes on to the page');
      assert.equal(zoom.levelOf(window), 0);
    });
  });

  it('a wheel notch with Control in a page zooms the window the page is in, as the keys do (DSP-170)', () => {
    withDir((dir) => {
      const { zoom, file } = zoomOver(dir);
      const chat = new FakeWindow();
      const review = new FakeWindow();
      zoom.adopt(chat, 'main');
      zoom.adopt(review, 'review-diff');
      chat.webContents.wheel('in');
      assert.equal(zoom.levelOf(chat), 1, 'one notch forward is one step in');
      assert.equal(zoom.levelOf(review), 0, 'the other window is left alone');
      chat.webContents.wheel('in');
      chat.webContents.wheel('out');
      assert.equal(zoom.levelOf(chat), 1, 'a notch back is one step out');
      assert.equal(chat.webContents.level, 1, 'the page is at the window\'s level');
      assert.deepEqual(parseWindowZoomLevels(fs.readFileSync(file, 'utf8')), { main: 1 }, 'remembered as a key press is');
      for (let notch = 0; notch < 20; notch += 1) {
        review.webContents.wheel('out');
      }
      assert.equal(zoom.levelOf(review), ZOOM_MIN_LEVEL, 'the wheel stops at the bounds');
      assert.equal(chat.webContents.press({ key: '0', code: 'Digit0' }), false);
      assert.equal(zoom.levelOf(chat), 0, 'the keys still work beside the wheel');
    });
  });

  it('the wheel follows a page between windows, with one listener however often it moves', () => {
    withDir((dir) => {
      const { zoom } = zoomOver(dir);
      const code = new FakeWindow();
      const frame = new FakeWindow();
      const panel = new FakePage();
      zoom.adopt(code, 'review-diff');
      zoom.adopt(frame, 'review-panel');
      zoom.attach(panel, frame);
      panel.wheel('in');
      assert.equal(zoom.levelOf(frame), 1, 'in its own window the wheel zooms that window');
      assert.equal(zoom.levelOf(code), 0);
      zoom.attach(panel, code);
      panel.wheel('out');
      assert.equal(zoom.levelOf(code), -1, 'docked, the wheel over the panel zooms the code window');
      assert.equal(panel.level, -1);
      assert.equal(code.webContents.level, -1);
      assert.equal(zoom.levelOf(frame), 1, 'and the panel window\'s own level is kept');
      zoom.attach(panel, frame);
      zoom.attach(panel, code);
      assert.equal(panel.wheelListeners(), 1, 'moved twice more, still one listener');
      panel.destroy();
      panel.wheel('in');
      assert.equal(zoom.levelOf(code), -1, 'a destroyed page zooms nothing');
    });
  });

  it('a docked page follows its window, and keeps its own level in its own window', () => {
    withDir((dir) => {
      const { zoom, file } = zoomOver(dir);
      const code = new FakeWindow();
      const frame = new FakeWindow();
      const panel = new FakePage();
      zoom.adopt(code, 'review-diff');
      zoom.adopt(frame, 'review-panel');
      zoom.attach(panel, frame);
      zoom.zoom(frame, 'in');
      zoom.zoom(frame, 'in');
      assert.equal(panel.level, 2, 'in its own window the panel has that window\'s level');
      // Docked: the code window's level, and a key in the panel zooms the code window.
      zoom.attach(panel, code);
      assert.equal(panel.level, 0);
      assert.equal(panel.press({ key: '-', code: 'Slash' }), false);
      assert.equal(zoom.levelOf(code), -1);
      assert.equal(panel.level, -1);
      assert.equal(code.webContents.level, -1);
      assert.equal(zoom.levelOf(frame), 2, 'docking changed nothing of the panel window\'s own level');
      // Undocked again: back to its own window's level, which was kept.
      zoom.attach(panel, frame);
      assert.equal(panel.level, 2);
      assert.equal(zoom.zoom(code, 'reset'), 0);
      assert.equal(panel.level, 2, 'the code window no longer reaches the panel');
      assert.deepEqual(parseWindowZoomLevels(fs.readFileSync(file, 'utf8')), { 'review-panel': 2 });
    });
  });

  it('a closed window and a destroyed page are forgotten, and a new window of the kind opens remembered', () => {
    withDir((dir) => {
      const { zoom } = zoomOver(dir);
      const window = new FakeWindow();
      const page = new FakePage();
      zoom.adopt(window, 'editor');
      zoom.attach(page, window);
      zoom.zoom(window, 'out');
      page.destroy();
      assert.equal(zoom.levelForPage(page.id), 0);
      window.close();
      assert.equal(zoom.levelOf(window), null);
      assert.equal(zoom.zoom(window, 'in'), null);
      const next = new FakeWindow();
      zoom.adopt(next, 'editor');
      assert.equal(zoom.levelOf(next), -1);
    });
  });

  it('a window of another identity starts at normal size whatever the others did', () => {
    withDir((dir) => {
      const { zoom } = zoomOver(dir);
      const main = new FakeWindow();
      zoom.adopt(main, 'main');
      zoom.zoom(main, 'in');
      const browse = new FakeWindow();
      zoom.adopt(browse, 'host-browse');
      assert.equal(zoom.levelOf(browse), 0);
      assert.equal(zoom.kindOf(browse), 'host-browse');
    });
  });

  it('the menu items name the shortcuts and act on the window they were pressed in', () => {
    withDir((dir) => {
      const { zoom } = zoomOver(dir);
      const window = new FakeWindow();
      zoom.adopt(window, 'main');
      const items = zoomMenuItems(() => zoom);
      assert.deepEqual(items.map((item) => [item.label, item.accelerator]), [
        ['Zoom In', 'CommandOrControl+='],
        ['Zoom Out', 'CommandOrControl+-'],
        ['Reset Zoom', 'CommandOrControl+0'],
      ]);
      const click = (index: number): void => {
        const handler = items[index]?.click as ((item: unknown, window: unknown, event: unknown) => void) | undefined;
        handler?.({}, window, {});
      };
      click(0);
      click(0);
      assert.equal(zoom.levelOf(window), 2);
      click(1);
      assert.equal(zoom.levelOf(window), 1);
      click(2);
      assert.equal(zoom.levelOf(window), 0);
    });
  });
});
