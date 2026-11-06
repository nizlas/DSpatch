import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { WINDOW_LAYOUT_FILE, WindowLayoutStore } from '../src/main/window-layout.ts';

const quiet = (): void => undefined;

const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }] as const;
const primary = displays[0];

describe('WindowLayoutStore', () => {
  const withDir = (body: (dir: string) => void): void => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsp-layout-'));
    try {
      body(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('falls back to defaults when no file exists', () => {
    withDir((dir) => {
      const store = new WindowLayoutStore(path.join(dir, WINDOW_LAYOUT_FILE), quiet);
      const placement = store.placementFor('main', { width: 1280, height: 920 }, { width: 720, height: 560 }, displays, primary);
      assert.equal(placement.maximized, false);
      assert.equal(placement.bounds.width, 1280);
      assert.equal(placement.bounds.height, 920);
    });
  });

  it('remembers and restores window bounds and maximized state', () => {
    withDir((dir) => {
      const store = new WindowLayoutStore(path.join(dir, WINDOW_LAYOUT_FILE), quiet);
      const window = {
        isDestroyed: () => false,
        isMaximized: () => true,
        getBounds: () => ({ x: 12, y: 34, width: 1600, height: 900 }),
        getNormalBounds: () => ({ x: 100, y: 120, width: 1400, height: 880 }),
      };
      store.rememberWindowSnapshot('main', window);
      const again = new WindowLayoutStore(path.join(dir, WINDOW_LAYOUT_FILE), quiet);
      const placement = again.placementFor('main', { width: 900, height: 700 }, { width: 720, height: 560 }, displays, primary);
      assert.equal(placement.maximized, true);
      assert.deepEqual(placement.bounds, { x: 100, y: 120, width: 1400, height: 880 });
    });
  });

  it('clamps off-screen bounds back onto a visible display', () => {
    withDir((dir) => {
      const store = new WindowLayoutStore(path.join(dir, WINDOW_LAYOUT_FILE), quiet);
      store.rememberWindowSnapshot('main', {
        isDestroyed: () => false,
        isMaximized: () => false,
        getBounds: () => ({ x: 99_000, y: 99_000, width: 1600, height: 900 }),
        getNormalBounds: () => ({ x: 99_000, y: 99_000, width: 1600, height: 900 }),
      });
      const restored = store.placementFor('main', { width: 900, height: 700 }, { width: 720, height: 560 }, displays, primary);
      assert.ok(restored.bounds.x >= 0 && restored.bounds.x <= 400);
      assert.ok(restored.bounds.y >= 0 && restored.bounds.y <= 300);
    });
  });

  it('stores panel place and docked widths', () => {
    withDir((dir) => {
      const file = path.join(dir, WINDOW_LAYOUT_FILE);
      const store = new WindowLayoutStore(file, quiet);
      store.rememberPanelPlace('pair:one', 'walk');
      store.rememberPanelDockedWidth('pair:one', 'walk', 612);
      const again = new WindowLayoutStore(file, quiet);
      assert.equal(again.panelPlaceFor('pair:one'), 'walk');
      assert.equal(again.panelDockedWidthFor('pair:one', 'walk'), 612);
      assert.equal(again.panelDockedWidthFor('pair:one', 'diff'), null);
    });
  });
});

