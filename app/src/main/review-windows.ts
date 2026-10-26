import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, app, dialog, type MenuItemConstructorOptions, type WebContents } from 'electron';

import {
  reviewIdentityLabel,
  type ReviewOpenOutcome,
  type ReviewWindowInput,
  type ReviewWindowOutcome,
} from '../shared/review-model';
import { ReviewService, reviewRecordKey, type ReviewIdentity } from './review-service';

/*
 * Review windows: the review module's own windows, and the only way into it.
 *
 * The main application makes one call, `open({ repository, definitionPath })`, and
 * gets back a note for the button that asked. Nothing goes the other way: review
 * reads no chat, session, loop or window state of the caller, and its IPC answers
 * only windows opened here (see `review-ipc.ts`). Each window has its own
 * `ReviewService`, so two reviews side by side never share an open review, a cache
 * or a dialog parent.
 *
 * **One window per review.** A review's identity (repository, the two commits, the
 * definition file) is also the name of its record, so two windows on one review
 * would be two writers of one file. Asking again focuses the window that has it,
 * and choosing in one window a review another window has focuses that one instead.
 */

/** The file the last review per repository is kept in, beside the review records. */
const RECENT_FILE = 'recent.json';

/** How long closing waits for the view to save what it has not saved yet. */
const CLOSE_FLUSH_TIMEOUT_MS = 3_000;

export interface ReviewWindowsOptions {
  /** Where review records live: `userData/reviews`. */
  readonly recordsDir: string;
  /** The compiled review preload. */
  readonly preloadPath: string;
  /** Load the renderer into a new review window (`?window=review#review`). */
  readonly load: (window: BrowserWindow) => void;
  /** Development builds get reload and developer tools in the View menu. */
  readonly development: boolean;
  /**
   * The file chooser's answer during a scripted run, or `null` for the real dialog.
   * Called only while a scripted run is on; see `DSPATCH_PICK_FILE` in `main.ts`.
   */
  readonly scriptedPick: (() => string | null) | null;
  readonly log: (message: string) => void;
}

/** One review window and what it is showing. */
export interface ReviewWindowEntry {
  readonly window: BrowserWindow;
  /** Held while the window lives: `closed` must not ask a destroyed window for it. */
  readonly contents: WebContents;
  readonly service: ReviewService;
  /** The folder the window was opened for, if any: the chooser's start folder. */
  readonly startFolder: string | null;
  /** What `initial` answers: the review opened for it, or the chooser's note. */
  initial: ReviewOpenOutcome;
  /** The review on screen, once a definition has opened; `null` while choosing. */
  identity: ReviewIdentity | null;
  /** The repository whose chooser this is, while no definition has opened. */
  readonly chooserKey: string | null;
  /** Times this window was brought to the front by a repeated open. */
  focusCount: number;
  /** Set once the view has been asked to save before the window goes. */
  flushedForClose: boolean;
}

/** What the scripted scenario reads of a window, beside what its view reports. */
export interface ReviewWindowReading {
  readonly webContentsId: number;
  readonly title: string;
  readonly focused: boolean;
  readonly focusCount: number;
  readonly startFolder: string | null;
  readonly identity: ReviewIdentity | null;
  readonly identityLabel: string | null;
  readonly recordPath: string | null;
  /** The record's saved position, read from disk; `null` when there is no record. */
  readonly recordPosition: unknown;
}

/** A repository's top level, or the folder itself when git cannot say. */
function topLevel(folder: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', folder, 'rev-parse', '--show-toplevel'],
      { windowsHide: true, encoding: 'utf8', timeout: 10_000 },
      (error, stdout) => {
        const found = stdout.trim();
        resolve(error === null && found !== '' ? path.resolve(found) : path.resolve(folder));
      },
    );
  });
}

function folderKey(folder: string): string {
  const resolved = path.resolve(folder);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function titleFor(entry: Pick<ReviewWindowEntry, 'identity' | 'startFolder'>): string {
  if (entry.identity !== null) {
    return `DSpatch — review · ${reviewIdentityLabel(entry.identity.repository, entry.identity.base, entry.identity.target)}`;
  }
  return entry.startFolder === null
    ? 'DSpatch — review'
    : `DSpatch — review · choose a review for ${path.basename(entry.startFolder)}`;
}

export class ReviewWindows {
  private readonly options: ReviewWindowsOptions;

  private readonly entries = new Set<ReviewWindowEntry>();

  /** Opens one at a time, so two quick presses cannot both create a window. */
  private queue: Promise<unknown> = Promise.resolve();

  /** A quit was asked for while a review window held its close to save. */
  private quitRequested = false;

  constructor(options: ReviewWindowsOptions) {
    this.options = options;
    app.on('before-quit', () => {
      this.quitRequested = true;
    });
  }

  /** The window this sender belongs to, if it is a review window. */
  entryFor(sender: WebContents): ReviewWindowEntry | null {
    for (const entry of this.entries) {
      if (entry.contents === sender) {
        return entry;
      }
    }
    return null;
  }

  /** Every open review window. */
  list(): readonly ReviewWindowEntry[] {
    return [...this.entries].filter((entry) => !entry.window.isDestroyed());
  }

  /**
   * Open review for the caller's input, or bring the window that already has it to
   * the front. The one call the main application makes into review.
   */
  open(input: ReviewWindowInput): Promise<ReviewWindowOutcome> {
    const next = this.queue.then(() => this.openNow(input));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async openNow(input: ReviewWindowInput): Promise<ReviewWindowOutcome> {
    try {
      let definitionPath = input.definitionPath;
      let fromRecent = false;
      let problem: string | null = null;
      if (definitionPath === null && input.repository !== null) {
        definitionPath = await this.recentFor(input.repository);
        fromRecent = definitionPath !== null;
      }

      if (definitionPath !== null) {
        const service = this.newService();
        const identified = await service.identify(definitionPath);
        if ('identity' in identified) {
          const existing = this.byIdentity(identified.identity.key);
          if (existing !== null) {
            this.focus(existing);
            return {
              kind: 'focused',
              note: `This review is already open in its own window (${this.labelOf(existing)}). It has been brought to the front — one window per review, so two windows never write the same record.`,
            };
          }
        }
        const outcome = await service.openDefinition(definitionPath);
        if (outcome.kind === 'opened') {
          const identity = this.identityOf(outcome);
          if (identity !== null) {
            // A second request may have opened it while this one read git.
            const existing = this.byIdentity(identity.key);
            if (existing !== null) {
              this.focus(existing);
              return { kind: 'focused', note: `This review is already open in its own window (${this.labelOf(existing)}). It has been brought to the front.` };
            }
            await this.rememberRecent(identity);
          }
          const entry = this.create({ service, startFolder: input.repository, initial: outcome, identity, chooserKey: null });
          return {
            kind: 'opened',
            note: `Review opened in its own window: ${this.labelOf(entry)}${fromRecent ? ' (the last review opened for this project)' : ''}. The chat is unaffected.`,
          };
        }
        if (!fromRecent) {
          // Named directly: show why it did not open, with the chooser beside it.
          const entry = this.create({
            service,
            startFolder: input.repository,
            initial: outcome,
            identity: null,
            chooserKey: null,
          });
          return {
            kind: 'opened',
            note: `A review window opened (${entry.window.getTitle()}), but the review in it did not: ${outcome.kind === 'failed' ? outcome.error : outcome.note}`,
          };
        }
        problem = `The last review opened for this project could not be opened again: ${
          outcome.kind === 'failed' ? outcome.error : outcome.note
        }`;
      }

      // No review to open: the chooser, naming the folder it was opened for.
      const chooserKey = input.repository === null ? '' : folderKey(await topLevel(input.repository));
      const existingChooser = [...this.entries].find(
        (entry) => entry.identity === null && entry.chooserKey === chooserKey && !entry.window.isDestroyed(),
      );
      if (existingChooser !== undefined) {
        this.focus(existingChooser);
        return {
          kind: 'focused',
          note: 'A review window for this project is already open and waiting for a review definition. It has been brought to the front.',
        };
      }
      const note =
        input.repository === null
          ? 'No review was named. Choose a review definition file (*.review.json).'
          : `No review has been opened for ${input.repository} yet. Choose a review definition file (*.review.json); the chooser starts in this folder.`;
      this.create({
        service: this.newService(),
        startFolder: input.repository,
        initial: { kind: 'none', note, repository: input.repository, ...(problem === null ? {} : { problem }) },
        identity: null,
        chooserKey,
      });
      return {
        kind: 'opened',
        note: 'Review opened in its own window. Choose a review definition there; nothing is chosen for you. The chat is unaffected.',
      };
    } catch (error) {
      return {
        kind: 'failed',
        note: `The review window could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * The window's file chooser, parented to that window and starting in its folder.
   *
   * A definition another window already has is not opened here: that window is
   * brought to the front and this one keeps what it shows.
   */
  async choose(entry: ReviewWindowEntry): Promise<ReviewOpenOutcome> {
    const startIn =
      entry.identity?.repository ?? (entry.startFolder !== null && fs.existsSync(entry.startFolder) ? entry.startFolder : undefined);
    let chosen: string | undefined;
    if (this.options.scriptedPick !== null) {
      chosen = this.options.scriptedPick() ?? undefined;
      this.options.log(`review choose answered by the scripted pick: ${chosen ?? '(dismissed)'}`);
    } else {
      const dialogOptions = {
        title: 'Open a review definition',
        properties: ['openFile' as const],
        filters: [{ name: 'Review definition', extensions: ['json'] }],
        ...(startIn === undefined ? {} : { defaultPath: startIn }),
      };
      const parent = entry.window.isDestroyed() ? null : entry.window;
      const result = parent === null ? await dialog.showOpenDialog(dialogOptions) : await dialog.showOpenDialog(parent, dialogOptions);
      chosen = result.canceled ? undefined : result.filePaths[0];
    }
    if (chosen === undefined) {
      return { kind: 'none', note: 'No file was chosen.', repository: entry.startFolder };
    }
    // The dialog is outside the queue (it waits on a person); opening is inside it, so a
    // review being opened by `open()` and by this window at once is opened by one of them.
    const picked = chosen;
    const next = this.queue.then(() => this.openChosen(entry, picked));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async openChosen(entry: ReviewWindowEntry, chosen: string): Promise<ReviewOpenOutcome> {
    const identified = await entry.service.identify(chosen);
    if ('identity' in identified) {
      const other = this.byIdentity(identified.identity.key);
      if (other !== null && other !== entry) {
        this.focus(other);
        return {
          kind: 'none',
          note: `That review is already open in another window (${this.labelOf(other)}), which has been brought to the front. One window per review, so two windows never write the same record.`,
          repository: entry.startFolder,
        };
      }
    }
    const outcome = await entry.service.openDefinition(chosen);
    if (outcome.kind === 'opened') {
      const identity = this.identityOf(outcome);
      // Checked again after reading git: another window may have taken it meanwhile.
      const other = identity === null ? null : this.byIdentity(identity.key);
      if (other !== null && other !== entry) {
        this.focus(other);
        return {
          kind: 'none',
          note: `That review was opened in another window (${this.labelOf(other)}) meanwhile, which has been brought to the front. One window per review.`,
          repository: entry.startFolder,
        };
      }
      entry.identity = identity;
      entry.initial = outcome;
      if (identity !== null) {
        await this.rememberRecent(identity);
      }
      if (!entry.window.isDestroyed()) {
        entry.window.setTitle(titleFor(entry));
      }
    }
    return outcome;
  }

  /** Readings for the scripted scenario: what main knows about each window. */
  readings(): readonly ReviewWindowReading[] {
    return this.list().map((entry) => {
      const recordPath =
        entry.identity === null ? null : path.join(this.options.recordsDir, `${entry.identity.key}.json`);
      let recordPosition: unknown = null;
      if (recordPath !== null && fs.existsSync(recordPath)) {
        try {
          recordPosition = (JSON.parse(fs.readFileSync(recordPath, 'utf8')) as { position?: unknown }).position ?? null;
        } catch (error) {
          recordPosition = `unreadable: ${String(error)}`;
        }
      }
      return {
        webContentsId: entry.contents.id,
        title: entry.window.getTitle(),
        focused: entry.window.isFocused(),
        focusCount: entry.focusCount,
        startFolder: entry.startFolder,
        identity: entry.identity,
        identityLabel: entry.identity === null ? null : this.labelOf(entry),
        recordPath,
        recordPosition,
      };
    });
  }

  /** The recent-review index as it stands on disk, for the scenario's record. */
  recentIndex(): unknown {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.options.recordsDir, RECENT_FILE), 'utf8'));
    } catch {
      return null;
    }
  }

  private newService(): ReviewService {
    return new ReviewService({ recordsDir: this.options.recordsDir, log: this.options.log });
  }

  private identityOf(outcome: ReviewOpenOutcome): ReviewIdentity | null {
    if (outcome.kind !== 'opened') {
      return null;
    }
    const bundle = outcome.bundle;
    return {
      key: reviewRecordKey(bundle.repository, bundle.base.sha, bundle.target.sha, bundle.definitionPath),
      definitionPath: bundle.definitionPath,
      repository: bundle.repository,
      base: bundle.base.sha,
      target: bundle.target.sha,
    };
  }

  private labelOf(entry: ReviewWindowEntry): string {
    return entry.identity === null
      ? entry.window.getTitle()
      : reviewIdentityLabel(entry.identity.repository, entry.identity.base, entry.identity.target);
  }

  private byIdentity(key: string): ReviewWindowEntry | null {
    for (const entry of this.entries) {
      if (entry.identity?.key === key && !entry.window.isDestroyed()) {
        return entry;
      }
    }
    return null;
  }

  private focus(entry: ReviewWindowEntry): void {
    entry.focusCount += 1;
    if (entry.window.isMinimized()) {
      entry.window.restore();
    }
    entry.window.show();
    entry.window.focus();
    this.options.log(`review window focused (already open): ${entry.window.getTitle()}`);
  }

  private create(init: {
    readonly service: ReviewService;
    readonly startFolder: string | null;
    readonly initial: ReviewOpenOutcome;
    readonly identity: ReviewIdentity | null;
    readonly chooserKey: string | null;
  }): ReviewWindowEntry {
    const window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 720,
      minHeight: 560,
      show: false,
      backgroundColor: '#101317',
      title: titleFor(init),
      // A sibling with its own taskbar entry, like the loop editor: no parent, not modal.
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const entry: ReviewWindowEntry = {
      window,
      contents: window.webContents,
      service: init.service,
      startFolder: init.startFolder,
      initial: init.initial,
      identity: init.identity,
      chooserKey: init.chooserKey,
      focusCount: 0,
      flushedForClose: false,
    };
    this.entries.add(entry);

    window.setMenu(this.viewMenu());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // The title says which review this is; the page's own <title> must not replace it.
    window.on('page-title-updated', (event) => {
      event.preventDefault();
    });
    window.once('ready-to-show', () => {
      window.show();
    });
    window.on('close', (event) => {
      if (entry.flushedForClose) {
        return;
      }
      // Held open until the view has saved: a position changed a moment ago is
      // still waiting for its 250 ms save, and closing is not a reason to lose it.
      event.preventDefault();
      entry.flushedForClose = true;
      void this.flushView(entry).then((result) => {
        this.options.log(`review window closing after the view saved: ${result}`);
        if (!window.isDestroyed()) {
          window.close();
        }
        if (this.quitRequested) {
          app.quit();
        }
      });
    });
    window.on('closed', () => {
      this.entries.delete(entry);
      this.options.log('review window closed; the chat and any run were not affected');
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.options.log(
        `review window did-fail-load url=${validatedURL} code=${String(errorCode)} description=${errorDescription}`,
      );
    });
    this.options.load(window);
    this.options.log(`review window opened: ${window.getTitle()}`);
    return entry;
  }

  /** Ask the view to save what it holds and wait for the answer, within a bound. */
  private async flushView(entry: ReviewWindowEntry): Promise<string> {
    if (entry.contents.isDestroyed()) {
      return 'the view was already gone';
    }
    const flushed = entry.contents
      .executeJavaScript(
        "(async () => { const flush = window.__dspatchReviewFlush; return typeof flush === 'function' ? await flush() : 'nothing open to save'; })()",
      )
      .then(
        (answer: unknown) => String(answer),
        (error: unknown) => `the view could not be asked to save (${String(error)})`,
      );
    const timeout = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(`no answer within ${String(CLOSE_FLUSH_TIMEOUT_MS)} ms; closing anyway`);
      }, CLOSE_FLUSH_TIMEOUT_MS);
    });
    return Promise.race([flushed, timeout]);
  }

  /** Review windows have no File or Session menu: those are the chat's. View stays. */
  private viewMenu(): Menu {
    const view: MenuItemConstructorOptions[] = [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
    ];
    if (this.options.development) {
      view.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
    }
    return Menu.buildFromTemplate([{ label: '&View', submenu: view }]);
  }

  private recentPath(): string {
    return path.join(this.options.recordsDir, RECENT_FILE);
  }

  private readRecent(): Record<string, { readonly repository: string; readonly definitionPath: string; readonly openedAt: string }> {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.recentPath(), 'utf8')) as { version?: unknown; repositories?: unknown };
      if (parsed.version === 1 && typeof parsed.repositories === 'object' && parsed.repositories !== null) {
        return parsed.repositories as Record<string, { repository: string; definitionPath: string; openedAt: string }>;
      }
    } catch {
      // Missing or unreadable: no last review is known, and the chooser opens instead.
    }
    return {};
  }

  /** The last definition opened for the repository this folder is in, if it still exists. */
  private async recentFor(folder: string): Promise<string | null> {
    const key = folderKey(await topLevel(folder));
    const entry = this.readRecent()[key];
    if (entry === undefined || typeof entry.definitionPath !== 'string' || !fs.existsSync(entry.definitionPath)) {
      return null;
    }
    return entry.definitionPath;
  }

  /** Remember the definition just opened as the last one for its repository. */
  private async rememberRecent(identity: ReviewIdentity): Promise<void> {
    const root = await topLevel(identity.repository);
    try {
      const repositories = { ...this.readRecent() };
      repositories[folderKey(root)] = {
        repository: root,
        definitionPath: identity.definitionPath,
        openedAt: new Date().toISOString(),
      };
      fs.mkdirSync(this.options.recordsDir, { recursive: true });
      const temporary = `${this.recentPath()}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, repositories }, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.recentPath());
    } catch (error) {
      // Opening the review is not undone by this; next time the chooser opens instead.
      this.options.log(`the last review for ${root} could not be remembered: ${String(error)}`);
    }
  }
}
