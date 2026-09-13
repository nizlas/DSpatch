import path from 'node:path';

import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import { NotImplementedAdapter } from '../adapter/not-implemented-adapter';
import type {
  BridgeChannel,
  EnvironmentInfo,
  RendererReady,
} from '../shared/bridge';

const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';

/** Set by `scripts/dev.mjs`; points to the Vite development server. */
const rendererUrl = process.env['DSPATCH_RENDERER_URL'];

/**
 * Startup smoke test. Set `DSPATCH_SMOKE=1` to start, load the renderer, report
 * actual observations and exit with a code. A launched command alone does not
 * prove that a window appeared.
 */
const smokeMode = process.env['DSPATCH_SMOKE'] === '1';
const smokeTimeoutMs = 30_000;

/** `app.quit()` loses the exit code; `app.exit(code)` preserves it. */
const EXIT_OK = 0;
const EXIT_LOAD_FAILED = 2;
const EXIT_TIMEOUT = 3;
const EXIT_RENDERER_GONE = 4;

const adapter = new NotImplementedAdapter();
let adapterDisposed = false;

function log(message: string): void {
  process.stdout.write(`[dspatch] ${message}\n`);
}

function environmentInfo(): EnvironmentInfo {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    rendererSource: rendererUrl === undefined ? 'built-files' : 'dev-server',
    versions: {
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    adapter: {
      id: adapter.id,
      capabilities: adapter.capabilities(),
    },
  };
}

async function disposeAdapterOnce(): Promise<void> {
  if (adapterDisposed) {
    return;
  }
  adapterDisposed = true;
  await adapter.dispose();
}

/**
 * Both startup conditions must hold: a loaded document is not a visible window,
 * and a visible window is not a painted renderer.
 */
let windowShown = false;
let rendererReady = false;
let pendingExitCode: number | null = null;
let mainWindow: BrowserWindow | null = null;

/** Dispose and exit. `app.quit()` would lose the exit code. */
function exitNow(code: number): void {
  void disposeAdapterOnce().finally(() => {
    app.exit(code);
  });
}

/**
 * Exit with a code that actually propagates, but only after the window is shown.
 *
 * This wait addresses an observed failure. Exiting directly in `did-fail-load`,
 * before the window appeared, did not terminate the process: neither `app.exit()`
 * nor `process.exit()` worked, and timers stopped after `app.exit()`. One probe
 * hung for three minutes before external termination. Once the window had appeared
 * (including Chromium's error page), the process exited normally.
 *
 * This differs from the first run's finding that `app.quit()` loses the exit code.
 */
function exitWith(code: number): void {
  if (!windowShown) {
    pendingExitCode = code;
    log(`exit code ${String(code)} waiting for the window to be shown`);
    return;
  }
  exitNow(code);
}

function completeSmokeRunIfReady(): void {
  if (!smokeMode || !windowShown || !rendererReady) {
    return;
  }
  const bounds = mainWindow === null ? null : mainWindow.getBounds();
  log(
    'startup smoke test passed: window shown and renderer painted. ' +
      `visible=${String(mainWindow?.isVisible() ?? false)} ` +
      `bounds=${JSON.stringify(bounds)}`,
  );
  exitWith(EXIT_OK);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 860,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#101317',
    title: 'DSpatch',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The skeleton has no navigation or additional windows.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('show', () => {
    log(`window shown bounds=${JSON.stringify(window.getBounds())}`);
    windowShown = true;
    if (pendingExitCode !== null) {
      exitNow(pendingExitCode);
      return;
    }
    completeSmokeRunIfReady();
  });

  window.webContents.on('did-finish-load', () => {
    log(`did-finish-load url=${window.webContents.getURL()}`);
  });

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      log(
        `did-fail-load url=${validatedURL} code=${String(errorCode)} ` +
          `description=${errorDescription}`,
      );
      if (smokeMode) {
        exitWith(EXIT_LOAD_FAILED);
      }
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details.reason}`);
    if (smokeMode) {
      exitWith(EXIT_RENDERER_GONE);
    }
  });

  if (rendererUrl === undefined) {
    const indexPath = path.join(__dirname, '..', 'renderer', 'index.html');
    log(`loading built files: ${indexPath}`);
    void window.loadFile(indexPath);
  } else {
    log(`loading development server: ${rendererUrl}`);
    void window.loadURL(rendererUrl);
  }

  return window;
}

function registerIpc(): void {
  ipcMain.handle(GET_ENVIRONMENT, () => environmentInfo());

  let readyReported = false;
  ipcMain.on(RENDERER_READY, (_event, ready: RendererReady) => {
    if (readyReported) {
      return;
    }
    readyReported = true;
    log(
      `renderer-ready heading="${ready.headingText}" ` +
        `capabilities=${String(ready.capabilityCount)} at=${ready.renderedAt}`,
    );
    rendererReady = true;
    completeSmokeRunIfReady();
  });
}

/**
 * Dispose the adapter before closing the app. A real provider path may own a
 * child process or local storage with open files; exiting without disposal would
 * leave those resources behind.
 */
function registerLifecycle(): void {
  app.on('before-quit', (event) => {
    if (adapterDisposed) {
      return;
    }
    event.preventDefault();
    void disposeAdapterOnce().finally(() => {
      app.quit();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

function main(): void {
  registerLifecycle();

  // Remove Electron's standard menu because its actions are not implemented.
  // A custom workspace menu belongs in a later task.
  Menu.setApplicationMenu(null);

  void app.whenReady().then(() => {
    registerIpc();
    mainWindow = createWindow();

    if (smokeMode) {
      setTimeout(() => {
        log(
          `startup smoke test did not meet both conditions within ${String(smokeTimeoutMs)} ` +
            `ms. window shown=${String(windowShown)} ` +
            `renderer painted=${String(rendererReady)}`,
        );
        // Deliberately bypass the window wait: if it has not appeared within half a
        // minute, keeping the smoke test waiting indefinitely is worse than the
        // remaining risk of a process that fails to exit.
        exitNow(EXIT_TIMEOUT);
      }, smokeTimeoutMs);
    }
  });
}

main();
