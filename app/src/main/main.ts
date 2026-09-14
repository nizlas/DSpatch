import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, app, ipcMain } from 'electron';

import type {
  BridgeChannel,
  EnvironmentInfo,
  RendererReady,
  ScriptedRunPlan,
  ScriptedRunReport,
} from '../shared/bridge';
import { ChatService } from './chat-service';
import { PROBE_EXIT, runCursorProbe } from './probe-cursor';

const GET_ENVIRONMENT: BridgeChannel = 'dspatch:get-environment';
const RENDERER_READY: BridgeChannel = 'dspatch:renderer-ready';
const GET_CONNECTION: BridgeChannel = 'dspatch:get-connection';
const START_SESSION: BridgeChannel = 'dspatch:start-session';
const SEND_PROMPT: BridgeChannel = 'dspatch:send-prompt';
const CANCEL_RUN: BridgeChannel = 'dspatch:cancel-run';
const CANCEL_OBSERVATIONS: BridgeChannel = 'dspatch:cancel-observations';
const RUN_TEST: BridgeChannel = 'dspatch:run-test';
const WORKSPACE_CHANGES: BridgeChannel = 'dspatch:workspace-changes';
const TURN_USAGE: BridgeChannel = 'dspatch:turn-usage';
const AGENT_EVENT: BridgeChannel = 'dspatch:agent-event';
const GET_SCRIPTED_RUN: BridgeChannel = 'dspatch:get-scripted-run';
const SCRIPTED_RUN_REPORT: BridgeChannel = 'dspatch:scripted-run-report';

/** Set by `scripts/dev.mjs`; points to the Vite development server. */
const rendererUrl = process.env['DSPATCH_RENDERER_URL'];

/**
 * Startup smoke test. Set `DSPATCH_SMOKE=1` to start, load the renderer, report
 * actual observations and exit with a code. A launched command alone does not
 * prove that a window appeared.
 */
const smokeMode = process.env['DSPATCH_SMOKE'] === '1';
const smokeTimeoutMs = 30_000;

/**
 * Connection probe. Set `DSPATCH_PROBE=1` to connect through the Cursor adapter
 * from the main process and exit with a code. See `probe-cursor.ts`; its exit
 * codes start at 10 so they cannot be confused with the smoke test's.
 */
const probeMode = process.env['DSPATCH_PROBE'] === '1';

/**
 * Scripted workflow run. Set `DSPATCH_CHAT_RUN=1` and the renderer drives its own
 * controls through the whole workflow, records what reached the DOM, and the main
 * process exits with a code. Its codes start at 30.
 *
 * This exists because "the window can do this" is otherwise only a claim. The
 * script operates the real buttons and the real input field in the real UI; the
 * evidence is what the DOM ended up showing, plus what the main process observed
 * on disk. It is not a substitute for Niclas judging the window.
 */
const chatRunMode = process.env['DSPATCH_CHAT_RUN'] === '1';
const chatRunTimeoutMs = 900_000;
const chatRunTurnTimeoutMs = 240_000;

/** `app.quit()` loses the exit code; `app.exit(code)` preserves it. */
const EXIT_OK = 0;
const EXIT_LOAD_FAILED = 2;
const EXIT_TIMEOUT = 3;
const EXIT_RENDERER_GONE = 4;

/** Scripted-run codes. 0–4 belong to the smoke test, 10–19 to the probe. */
const CHAT_EXIT_TIMEOUT = 38;
const CHAT_EXIT_NO_REPORT = 39;

function log(message: string): void {
  process.stdout.write(`[dspatch] ${message}\n`);
}

/**
 * The repository the agent must never be pointed at, and the boundary the working
 * copy generator checks against.
 *
 * `app.getAppPath()` is `<repo>/app` when running from source. From a packaged
 * artifact it is inside `app.asar`, where the repository is not an ancestor at
 * all, so a packaged run must pass `DSPATCH_PROBE_REPO_ROOT` explicitly rather
 * than trust the default.
 */
function probeRepoRoot(): string {
  const explicit = process.env['DSPATCH_PROBE_REPO_ROOT'];
  if (explicit !== undefined && explicit.trim() !== '') {
    return path.resolve(explicit);
  }
  return path.resolve(app.getAppPath(), '..');
}

/**
 * The chat service owns the Cursor adapter, in the main process.
 *
 * The renderer reaches it only through the channels registered below. Nothing
 * about the window changes that: `contextIsolation` stays on, `nodeIntegration`
 * stays off and the sandbox stays enabled.
 */
const chatService = new ChatService({
  repoRoot: probeRepoRoot(),
  send: (event) => {
    mainWindow?.webContents.send(AGENT_EVENT, event);
  },
  log: (message) => {
    log(`[chat] ${message}`);
  },
});

let serviceDisposed = false;
let probeStarted = false;

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
      id: chatService.adapterId(),
      capabilities: chatService.capabilities(),
    },
  };
}

async function disposeAdapterOnce(): Promise<void> {
  if (serviceDisposed) {
    return;
  }
  serviceDisposed = true;
  await chatService.dispose();
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
    width: 1040,
    height: 900,
    minWidth: 720,
    minHeight: 560,
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

  // No navigation and no additional windows.
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
    startProbeIfRequested();
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
      if (smokeMode || chatRunMode) {
        exitWith(EXIT_LOAD_FAILED);
      }
    },
  );

  window.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone reason=${details.reason}`);
    if (smokeMode || chatRunMode) {
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

function startProbeIfRequested(): void {
  if (!probeMode || probeStarted) {
    return;
  }
  probeStarted = true;
  const repoRoot = probeRepoRoot();
  log(`connection probe starting. repo root treated as ${repoRoot}`);
  void runCursorProbe(repoRoot).then(
    ({ exitCode }) => {
      log(`connection probe finished with exit code ${String(exitCode)}`);
      exitNow(exitCode);
    },
    (error: unknown) => {
      log(`connection probe threw outside its own handling: ${String(error)}`);
      exitNow(PROBE_EXIT.unexpectedError);
    },
  );
}

/**
 * Write the scripted run's record.
 *
 * The renderer's own observations and the main process's are kept apart on
 * purpose: what the DOM showed and what was on disk are different kinds of
 * evidence and must not be presented as one.
 */
function writeChatRunRecord(report: ScriptedRunReport | null): void {
  const target = process.env['DSPATCH_CHAT_LOG'];
  if (target === undefined || target.trim() === '') {
    return;
  }
  const record = {
    run: 'DSP-1 substep 7 — the whole workflow driven through the window',
    startedAtUtc: chatRunStartedAtUtc,
    finishedAtUtc: new Date().toISOString(),
    rendererSource: rendererUrl === undefined ? 'built-files' : 'dev-server',
    appPath: app.getAppPath(),
    execPath: process.execPath,
    packaged: app.isPackaged,
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    renderer: report,
    main: chatService.evidence(),
  };
  try {
    const resolved = path.resolve(target);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    log(`chat run record written: ${resolved}`);
  } catch (error) {
    log(`could not write the chat run record: ${String(error)}`);
  }
}

const chatRunStartedAtUtc = new Date().toISOString();
let chatRunReported = false;

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

  ipcMain.handle(GET_CONNECTION, () => chatService.getConnection());
  ipcMain.handle(START_SESSION, () => chatService.startChatSession());
  ipcMain.handle(SEND_PROMPT, (_event, prompt: string) =>
    chatService.sendPrompt(prompt),
  );
  ipcMain.handle(CANCEL_RUN, () => chatService.cancelRun());
  ipcMain.handle(CANCEL_OBSERVATIONS, () => chatService.getCancelObservations());
  ipcMain.handle(RUN_TEST, () => chatService.runWorkspaceTest());
  ipcMain.handle(WORKSPACE_CHANGES, () => chatService.getWorkspaceChanges());
  ipcMain.handle(TURN_USAGE, (_event, dspatchRunId: string) =>
    chatService.getTurnUsage(dspatchRunId),
  );

  ipcMain.handle(GET_SCRIPTED_RUN, (): ScriptedRunPlan | null => {
    if (!chatRunMode) {
      return null;
    }
    return {
      enabled: true,
      turnTimeoutMs: chatRunTurnTimeoutMs,
      note:
        'Scripted workflow run. The renderer operates its own controls and records ' +
        'what reached the DOM. This is evidence that the chain works, not a ' +
        'judgement of the interface.',
    };
  });

  ipcMain.on(SCRIPTED_RUN_REPORT, (_event, report: ScriptedRunReport) => {
    if (chatRunReported) {
      return;
    }
    chatRunReported = true;
    log(
      `scripted run finished: passed=${String(report.passed)} ` +
        `exitCode=${String(report.exitCode)} failures=${String(report.failures.length)}`,
    );
    for (const failure of report.failures) {
      log(`scripted run failure: ${failure}`);
    }
    writeChatRunRecord(report);
    exitWith(report.exitCode);
  });
}

/**
 * Dispose the adapter before closing the app. The provider path owns a local
 * agent runtime and on-disk storage with open files; exiting without disposal
 * would leave those resources behind.
 */
function registerLifecycle(): void {
  app.on('before-quit', (event) => {
    if (serviceDisposed) {
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
  const modes = [smokeMode, probeMode, chatRunMode].filter(Boolean).length;
  if (modes > 1) {
    log(
      'DSPATCH_SMOKE, DSPATCH_PROBE and DSPATCH_CHAT_RUN each own the exit code ' +
        'and would fight over it. Set at most one.',
    );
    app.exit(PROBE_EXIT.misconfigured);
    return;
  }

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

    if (chatRunMode) {
      setTimeout(() => {
        if (chatRunReported) {
          return;
        }
        chatRunReported = true;
        log(
          `scripted run did not report within ${String(chatRunTimeoutMs)} ms. ` +
            'This is a timeout, not a verdict: the turn may still be going.',
        );
        writeChatRunRecord(null);
        exitNow(rendererReady ? CHAT_EXIT_TIMEOUT : CHAT_EXIT_NO_REPORT);
      }, chatRunTimeoutMs);
    }
  });
}

main();
