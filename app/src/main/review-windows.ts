import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, app, dialog, type MenuItemConstructorOptions, type WebContents } from 'electron';

import {
  isReviewHostError,
  type ReviewHostApi,
  type ReviewHostError,
  type ReviewIdentity,
} from '../shared/review-host-contract';
import {
  reviewIdentityLabel,
  type ReviewOpenOutcome,
  type ReviewWindowInput,
  type ReviewWindowOutcome,
} from '../shared/review-model';
import type { DiffLocation, PairWindowStart, RevisionPairIdentity } from '../shared/review-pair';
import { REVIEW_PAIR_NAVIGATE } from '../shared/review-pair';

/*
 * Review windows: the review module's own windows, and the only way into it.
 *
 * The main application makes one call, `open({ repository, definitionPath })`, and
 * gets back a note for the button that asked. Nothing goes the other way: review
 * reads no chat, session, loop or window state of the caller, and its IPC answers
 * only windows opened here (see `review-ipc.ts`). Each window has its own session on
 * the review host, so two reviews side by side never share an open review, a cache
 * or a dialog parent.
 *
 * **The client side of review (DSP-111).** Windows, menus, the file chooser, the close
 * flush and this registry are here; the repository, the review records and the index
 * of the last review per repository are the host's, reached only through
 * `ReviewHostApi` (`shared/review-host-contract.ts`). Nothing here runs git or reads a
 * review record. The one file-system call is `fs.existsSync` on the chooser's start
 * folder, a path on this machine that the native dialog opens in.
 *
 * **One window per review.** A review's identity (repository, the two commits, the
 * definition file) is also the name of its record, so two windows on one review
 * would be two writers of one file. Asking again focuses the window that has it,
 * and choosing in one window a review another window has focuses that one instead.
 */

/** How long closing waits for the view to save what it has not saved yet. */
const CLOSE_FLUSH_TIMEOUT_MS = 3_000;

export interface ReviewWindowsOptions {
  /** The review host: repository access and the review records. */
  readonly host: ReviewHostApi;
  /** The compiled review preload. */
  readonly preloadPath: string;
  /** Load the renderer into a new review window (`?window=review#review`). */
  readonly load: (window: BrowserWindow, view: 'walk' | 'diff') => void;
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
  /**
   * This window's session on the review host; closed when the window is. Replaced only
   * when the project host was restarted and the old session went with it (`reattach`).
   */
  sessionId: string;
  /** The folder the window was opened for, if any: the chooser's start folder. */
  readonly startFolder: string | null;
  /** DSP-132: the main window's agent when it opened this review, else `null`. */
  readonly defaultProvider: 'cursor' | 'claude' | null;
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
  /** A walk window (a review definition) or a diff window (a chosen revision pair, DSP-150). */
  readonly view: 'walk' | 'diff';
  /** The revision pair this window is over, once known: chosen in a diff window, or a walk's own pair. */
  pairKey: string | null;
  /** What a diff window starts with. */
  pairStart: PairWindowStart;
  /** A short label for the title of a diff window over a pair. */
  pairLabel: string | null;
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

/** A host error as the review view shows a review that did not open. */
export function openFailureOf(error: ReviewHostError): ReviewOpenOutcome {
  return error.detail === undefined
    ? { kind: 'failed', error: error.message }
    : { kind: 'failed', error: error.message, detail: error.detail };
}

function titleFor(entry: Pick<ReviewWindowEntry, 'identity' | 'startFolder'> & { readonly view?: 'walk' | 'diff'; readonly pairLabel?: string | null }): string {
  if (entry.view === 'diff') {
    return entry.pairLabel === null || entry.pairLabel === undefined ? 'DSpatch — review' : `DSpatch — review · ${entry.pairLabel}`;
  }
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
        const host = this.options.host;
        const sessionId = await this.newSession();
        // The session goes with the window made for it; every other way out closes it.
        let handedOver = false;
        try {
          const identified = await host.identify({ sessionId, definitionPath });
          if (!isReviewHostError(identified) && 'identity' in identified) {
            const existing = this.byIdentity(identified.identity.key);
            if (existing !== null) {
              this.focus(existing);
              return {
                kind: 'focused',
                note: `This review is already open in its own window (${this.labelOf(existing)}). It has been brought to the front — one window per review, so two windows never write the same record.`,
              };
            }
          }
          const opened = await host.open({ sessionId, definitionPath, remember: input.remember !== false });
          const outcome = isReviewHostError(opened) ? openFailureOf(opened) : opened.outcome;
          if (outcome.kind === 'opened') {
            const identity = isReviewHostError(opened) ? null : opened.identity;
            if (identity !== null) {
              // A second request may have opened it while this one read git.
              const existing = this.byIdentity(identity.key);
              if (existing !== null) {
                this.focus(existing);
                return { kind: 'focused', note: `This review is already open in its own window (${this.labelOf(existing)}). It has been brought to the front.` };
              }
            }
            const entry = this.create({ sessionId, startFolder: input.repository, defaultProvider: input.defaultProvider ?? null, initial: outcome, identity, chooserKey: null });
            handedOver = true;
            return {
              kind: 'opened',
              note: `Review opened in its own window: ${this.labelOf(entry)}${fromRecent ? ' (the last review opened for this project)' : ''}. The chat is unaffected.`,
            };
          }
          if (!fromRecent) {
            // Named directly: show why it did not open, with the chooser beside it.
            const entry = this.create({
              sessionId,
              startFolder: input.repository,
              defaultProvider: input.defaultProvider ?? null,
              initial: outcome,
              identity: null,
              chooserKey: null,
            });
            handedOver = true;
            return {
              kind: 'opened',
              note: `A review window opened (${entry.window.getTitle()}), but the review in it did not: ${outcome.kind === 'failed' ? outcome.error : outcome.note}`,
            };
          }
          problem = `The last review opened for this project could not be opened again: ${
            outcome.kind === 'failed' ? outcome.error : outcome.note
          }`;
        } finally {
          if (!handedOver) {
            void host.closeSession({ sessionId });
          }
        }
      }

      // No review to open: the chooser, naming the folder it was opened for.
      const chooserKey = input.repository === null ? '' : await this.repositoryKeyOf(input.repository);
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
        sessionId: await this.newSession(),
        startFolder: input.repository,
        defaultProvider: input.defaultProvider ?? null,
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
    const host = this.options.host;
    const identified = await host.identify({ sessionId: entry.sessionId, definitionPath: chosen });
    if (!isReviewHostError(identified) && 'identity' in identified) {
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
    const opened = await host.open({ sessionId: entry.sessionId, definitionPath: chosen, remember: true });
    const outcome = isReviewHostError(opened) ? openFailureOf(opened) : opened.outcome;
    if (outcome.kind === 'opened') {
      const identity = isReviewHostError(opened) ? null : opened.identity;
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
      if (!entry.window.isDestroyed()) {
        entry.window.setTitle(titleFor(entry));
      }
    }
    return outcome;
  }

  /** Readings for the scripted scenario: what main knows about each window, and its record on the host. */
  // --- Diff windows over a chosen revision pair (DSP-150) ---------------------------------

  /**
   * Open review from the chat or the loop editor: a diff window that starts by choosing a
   * repository and two commits. One such window waiting for a choice is enough, so a
   * second press brings it to the front.
   */
  async openDiff(defaultProvider: 'cursor' | 'claude' | null): Promise<ReviewWindowOutcome> {
    try {
      const waiting = this.list().find((entry) => entry.view === 'diff' && entry.pairKey === null);
      if (waiting !== undefined) {
        this.focus(waiting);
        return { kind: 'focused', note: 'A review window waiting for a choice is already open. It has been brought to the front.' };
      }
      this.create({
        sessionId: await this.newSession(),
        startFolder: null,
        defaultProvider,
        initial: { kind: 'none', note: '', repository: null },
        identity: null,
        chooserKey: null,
        view: 'diff',
        pairStart: { kind: 'choose' },
      });
      return { kind: 'opened', note: 'Review opened in its own window. The chat is unaffected.' };
    } catch (error) {
      return { kind: 'failed', note: `The review window could not be opened: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** The diff window showing a pair, if one is open. */
  diffWindowFor(key: string): ReviewWindowEntry | null {
    return this.list().find((entry) => entry.view === 'diff' && entry.pairKey === key) ?? null;
  }

  /** Every window over a pair: its diff window and the walks over it. */
  windowsOverPair(key: string): readonly ReviewWindowEntry[] {
    return this.list().filter((entry) => entry.pairKey === key);
  }

  /**
   * A diff window takes a pair. One diff window per pair, like one window per walk: a
   * second window over the same pair is the first one brought to the front.
   */
  claimPair(entry: ReviewWindowEntry, key: string, label: string): ReviewWindowEntry | null {
    const other = this.diffWindowFor(key);
    if (other !== null && other !== entry) {
      this.focus(other);
      return other;
    }
    entry.pairKey = key;
    entry.pairLabel = label;
    if (!entry.window.isDestroyed()) {
      entry.window.setTitle(titleFor(entry));
    }
    return null;
  }

  /** A walk window learned which pair it is over. */
  joinPair(entry: ReviewWindowEntry, key: string): void {
    entry.pairKey = key;
  }

  /**
   * `Show in diff` from a walk: the diff window over the pair goes to the place, opened
   * first when none is. This is the one way a walk moves the diff view, and it is asked
   * for explicitly; showing a walk step never does it.
   */
  async showInDiff(
    from: ReviewWindowEntry,
    pair: RevisionPairIdentity,
    location: DiffLocation,
  ): Promise<{ readonly ok: boolean; readonly note: string }> {
    const key = from.pairKey;
    if (key === null) {
      return { ok: false, note: 'This walk is not tied to a revision pair yet.' };
    }
    const existing = this.diffWindowFor(key);
    if (existing !== null) {
      existing.contents.send(REVIEW_PAIR_NAVIGATE, location);
      this.focus(existing);
      return { ok: true, note: 'Shown in the diff.' };
    }
    try {
      this.create({
        sessionId: await this.newSession(),
        startFolder: null,
        defaultProvider: from.defaultProvider,
        initial: { kind: 'none', note: '', repository: null },
        identity: null,
        chooserKey: null,
        view: 'diff',
        pairStart: { kind: 'pair', pair, at: location },
      });
      return { ok: true, note: 'The diff opened at that place.' };
    } catch (error) {
      return { ok: false, note: `The diff could not be opened: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** Ask where to find a walk definition (the existing chooser's dialog, or the scripted pick). */
  async pickWalkFile(entry: ReviewWindowEntry): Promise<string | null> {
    if (this.options.scriptedPick !== null) {
      const chosen = this.options.scriptedPick();
      this.options.log(`walk file answered by the scripted pick: ${chosen ?? '(dismissed)'}`);
      return chosen;
    }
    const dialogOptions = {
      title: 'Open a code walk',
      properties: ['openFile' as const],
      filters: [{ name: 'Review definition', extensions: ['json'] }],
    };
    const parent = entry.window.isDestroyed() ? null : entry.window;
    const result = parent === null ? await dialog.showOpenDialog(dialogOptions) : await dialog.showOpenDialog(parent, dialogOptions);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async readings(): Promise<readonly ReviewWindowReading[]> {
    const readings: ReviewWindowReading[] = [];
    // Walk windows only: a diff window over a revision pair (DSP-150) has no walk record
    // and is read through its own check, so the walk scenarios count what they did before.
    for (const entry of this.list().filter((candidate) => candidate.view === 'walk')) {
      let recordPath: string | null = null;
      let recordPosition: unknown = null;
      if (entry.identity !== null) {
        const record = await this.options.host.recordReading({ key: entry.identity.key });
        if (isReviewHostError(record)) {
          recordPosition = `unreadable: ${record.message}`;
        } else {
          recordPath = record.recordPath;
          recordPosition = record.recordPosition;
        }
      }
      readings.push({
        webContentsId: entry.contents.id,
        title: entry.window.getTitle(),
        focused: entry.window.isFocused(),
        focusCount: entry.focusCount,
        startFolder: entry.startFolder,
        identity: entry.identity,
        identityLabel: entry.identity === null ? null : this.labelOf(entry),
        recordPath,
        recordPosition,
      });
    }
    return readings;
  }

  /**
   * Give every open window a session on a restarted host (DSP-111).
   *
   * The old sessions went with the host that stopped. A window that shows a review opens
   * the same definition again in its new session, not remembered as the last review
   * because nobody chose anything; a window still choosing just gets a session. What the
   * window holds on screen is left as it is, and its next save goes to the new session,
   * so a reviewer's unsaved work is kept rather than lost to an `unknown-session`.
   */
  async reattach(): Promise<void> {
    for (const entry of this.list()) {
      try {
        const sessionId = await this.newSession();
        entry.sessionId = sessionId;
        if (entry.identity === null) {
          continue;
        }
        const opened = await this.options.host.open({
          sessionId,
          definitionPath: entry.identity.definitionPath,
          remember: false,
        });
        if (isReviewHostError(opened) || opened.outcome.kind !== 'opened') {
          this.options.log(
            `review window ${String(entry.contents.id)} could not reopen ${entry.identity.definitionPath} on the restarted host: ` +
              (isReviewHostError(opened) ? opened.message : opened.outcome.kind),
          );
        }
      } catch (error) {
        this.options.log(`review window ${String(entry.contents.id)} got no session on the restarted host: ${String(error)}`);
      }
    }
  }

  /** The recent-review index as the host has it, for the scenario's record. */
  async recentIndex(): Promise<unknown> {
    const answer = await this.options.host.recentIndex();
    return isReviewHostError(answer) ? null : answer.index;
  }

  /** A new session on the review host, for a window about to be made. */
  private async newSession(): Promise<string> {
    const created = await this.options.host.createSession();
    if (isReviewHostError(created)) {
      throw new Error(created.message);
    }
    return created.sessionId;
  }

  /** The repository a folder is in, as a key; the folder itself when the host cannot say. */
  private async repositoryKeyOf(folder: string): Promise<string> {
    const answer = await this.options.host.repositoryKey({ folder });
    return isReviewHostError(answer) ? folder : answer.key;
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
    readonly sessionId: string;
    readonly startFolder: string | null;
    readonly defaultProvider: 'cursor' | 'claude' | null;
    readonly initial: ReviewOpenOutcome;
    readonly identity: ReviewIdentity | null;
    readonly chooserKey: string | null;
    readonly view?: 'walk' | 'diff';
    readonly pairStart?: PairWindowStart;
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
      sessionId: init.sessionId,
      startFolder: init.startFolder,
      defaultProvider: init.defaultProvider,
      initial: init.initial,
      identity: init.identity,
      chooserKey: init.chooserKey,
      focusCount: 0,
      flushedForClose: false,
      view: init.view ?? 'walk',
      pairKey: null,
      pairStart: init.pairStart ?? { kind: 'choose' },
      pairLabel: null,
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
      // The view has saved (or given up) by now; the host lets the window's session go.
      void this.options.host.closeSession({ sessionId: entry.sessionId });
      this.options.log('review window closed; the chat and any run were not affected');
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.options.log(
        `review window did-fail-load url=${validatedURL} code=${String(errorCode)} description=${errorDescription}`,
      );
    });
    this.options.load(window, entry.view);
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

  /** The last definition opened for the repository this folder is in, if it still exists. */
  private async recentFor(folder: string): Promise<string | null> {
    const answer = await this.options.host.lastReviewFor({ folder });
    return isReviewHostError(answer) ? null : answer.definitionPath;
  }
}
