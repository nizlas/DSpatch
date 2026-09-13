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

/** Sätts av `scripts/dev.mjs` och pekar på Vites utvecklingsserver. */
const rendererUrl = process.env['DSPATCH_RENDERER_URL'];

/**
 * Startprovet. Sätt `DSPATCH_SMOKE=1` för att starta, ladda renderaren, skriva
 * vad som faktiskt observerades och avsluta med en exitkod. Läget finns för att
 * ett startat kommando inte är bevis för ett fönster.
 */
const smokeMode = process.env['DSPATCH_SMOKE'] === '1';
const smokeTimeoutMs = 30_000;

/** `app.quit()` slukar exitkoden; `app.exit(code)` gör det inte. */
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
 * Startprovets två villkor. Båda måste vara uppfyllda: ett laddat dokument är
 * inte ett synligt fönster, och ett synligt fönster är inte en målad renderare.
 */
let windowShown = false;
let rendererReady = false;
let pendingExitCode: number | null = null;
let mainWindow: BrowserWindow | null = null;

/** Avvecklar och avslutar. `app.quit()` skulle sluka exitkoden. */
function exitNow(code: number): void {
  void disposeAdapterOnce().finally(() => {
    app.exit(code);
  });
}

/**
 * Avslutar med en exitkod som faktiskt propagerar — men aldrig innan fönstret
 * har realiserats.
 *
 * Väntan är inte försiktighet utan en åtgärd mot ett observerat fel. Avslutas
 * processen direkt i `did-fail-load`, innan fönstret hunnit visas, avslutas den
 * inte alls: varken `app.exit()` eller `process.exit()` terminerade processen,
 * och efter `app.exit()` slutade även timers att köra. Ett prov hängde i tre
 * minuter innan processen dödades utifrån. Så snart fönstret visats — vilket
 * sker även när Chromium visar sin egen felsida — avslutas processen normalt.
 *
 * Detta är en annan fälla än den pass 1 fann, att `app.quit()` slukar exitkoden.
 */
function exitWith(code: number): void {
  if (!windowShown) {
    pendingExitCode = code;
    log(`avslut med kod ${String(code)} väntar på att fönstret realiseras`);
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
    'startprovet lyckades: fönstret visas och renderaren har målat. ' +
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

  // Skelettet har ingen navigering och inga extra fönster.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  window.once('ready-to-show', () => {
    window.show();
  });

  window.on('show', () => {
    log(`fönstret visas bounds=${JSON.stringify(window.getBounds())}`);
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
    log(`laddar byggda filer: ${indexPath}`);
    void window.loadFile(indexPath);
  } else {
    log(`laddar utvecklingsservern: ${rendererUrl}`);
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
 * Avvecklar adaptern innan appen stängs. Punkten finns redan nu eftersom en
 * verklig leverantörsväg kan äga en barnprocess eller ett lokalt lager med
 * öppna filer; en app som avslutas utan avveckling lämnar dem kvar.
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

  // Electrons standardmeny tas bort. Den erbjuder poster vi inte byggt, och ett
  // gränssnitt ska inte visa handlingar som inte finns. En egen meny hör till
  // arbetsytan i en senare uppgift.
  Menu.setApplicationMenu(null);

  void app.whenReady().then(() => {
    registerIpc();
    mainWindow = createWindow();

    if (smokeMode) {
      setTimeout(() => {
        log(
          `startprovet nådde inte båda villkoren inom ${String(smokeTimeoutMs)} ` +
            `ms. visat fönster=${String(windowShown)} ` +
            `målad renderare=${String(rendererReady)}`,
        );
        // Går förbi väntan på fönstret med avsikt: har det inte realiserats på
        // en halv minut kommer det inte att göra det, och då är risken att
        // processen hänger mindre illa än att provet aldrig svarar.
        exitNow(EXIT_TIMEOUT);
      }, smokeTimeoutMs);
    }
  });
}

main();
