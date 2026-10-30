import fs from 'node:fs';
import path from 'node:path';

import { BrowserWindow, Menu, WebContentsView, app, dialog, screen, type MenuItemConstructorOptions, type Rectangle, type WebContents } from 'electron';

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
import type { DiffLocation, PairWindowStart, PanelAction, PanelFollow, PanelPlace, PanelState, RevisionPairIdentity } from '../shared/review-pair';
import { REVIEW_PAIR_NAVIGATE, REVIEW_PANEL_CHANNELS } from '../shared/review-pair';
import { REVIEW_DISCUSSION_CHANNELS, type ReviewDiscussionEvent } from '../shared/review-discussion';

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

const PANEL_SIZE = { width: 560, height: 820, minWidth: 360, minHeight: 420 } as const;

/**
 * Where the review panel's own window opens: where it was left when that is still on a screen
 * (enough of it to take hold of), else its size centred on the main screen. The place is kept
 * in the review preferences under its earlier name, `explanationBounds`.
 */
export function panelBounds(saved: unknown, displays: readonly Rectangle[], primary: Rectangle): Partial<Rectangle> {
  const record = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>) : {};
  const whole = (key: string): number | null => (Number.isInteger(record[key]) ? (record[key] as number) : null);
  const width = Math.min(Math.max(whole('width') ?? PANEL_SIZE.width, PANEL_SIZE.minWidth), primary.width);
  const height = Math.min(Math.max(whole('height') ?? PANEL_SIZE.height, PANEL_SIZE.minHeight), primary.height);
  const x = whole('x');
  const y = whole('y');
  if (x !== null && y !== null) {
    const seen = displays.some((area) => {
      const across = Math.min(x + width, area.x + area.width) - Math.max(x, area.x);
      const down = Math.min(y + height, area.y + area.height) - Math.max(y, area.y);
      // The title bar must be reachable: some width, and the top within the screen.
      return across >= 120 && down >= 60 && y >= area.y && y < area.y + area.height - 40;
    });
    if (seen) {
      return { x, y, width, height };
    }
  }
  return { x: Math.round(primary.x + (primary.width - width) / 2), y: Math.round(primary.y + (primary.height - height) / 2), width, height };
}

export interface ReviewWindowsOptions {
  /** The review host: repository access and the review records. */
  readonly host: ReviewHostApi;
  /** The compiled review preload. */
  readonly preloadPath: string;
  /** Load the renderer into a new review window (`?window=review#review`). */
  readonly load: (target: Pick<WebContents, 'loadFile' | 'loadURL'>, view: 'walk' | 'diff' | 'panel') => void;
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
  /** DSP-152: the opener's model for `defaultProvider`, `''` when none was chosen. */
  readonly defaultModel: string;
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
  /**
   * A walk window (a review definition), a diff window (a chosen revision pair, DSP-150), or
   * the review's panel, Step and Discussion, in its own window or docked (30 October 2026).
   */
  readonly view: 'walk' | 'diff' | 'panel';
  /** The revision pair this window is over, once known: chosen in a diff window, or a walk's own pair. */
  pairKey: string | null;
  /** A diff window's repository and commits, once it has chosen them: what its discussion is about. */
  pairIdentity: RevisionPairIdentity | null;
  /** The panel, opened to be shown so: it is told once its discussion has loaded. */
  showDiscussionOnLoad: ReviewDiscussionEvent | null;
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

function titleFor(entry: Pick<ReviewWindowEntry, 'identity' | 'startFolder'> & { readonly view?: 'walk' | 'diff' | 'panel'; readonly pairLabel?: string | null }): string {
  if (entry.view === 'panel') {
    return entry.identity === null
      ? 'DSpatch — discussion'
      : `DSpatch — discussion · ${reviewIdentityLabel(entry.identity.repository, entry.identity.base, entry.identity.target)}`;
  }
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

  /** Each review's panel, by its pair's key (30 October 2026). */
  private readonly panels = new Map<string, Panel>();

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
            const entry = this.create({ sessionId, startFolder: input.repository, defaultProvider: input.defaultProvider ?? null, defaultModel: input.defaultModel ?? '', initial: outcome, identity, chooserKey: null });
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
              defaultModel: input.defaultModel ?? '',
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
        defaultModel: input.defaultModel ?? '',
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
  /**
   * The review this window shows, read again by its session (30 October 2026): the points
   * worth checking asked for on their own are kept beside the definition and read with it.
   * Nothing else is chosen or opened; the view keeps its own state.
   */
  reread(entry: ReviewWindowEntry): Promise<ReviewOpenOutcome> {
    const definitionPath = entry.identity?.definitionPath ?? null;
    if (definitionPath === null) {
      return Promise.resolve(entry.initial);
    }
    if (entry.view === 'panel') {
      // Its own session is read again; the walk window over the same review is no reason to refuse.
      return this.options.host.open({ sessionId: entry.sessionId, definitionPath, remember: false }).then((opened) => {
        if (isReviewHostError(opened)) {
          return entry.initial;
        }
        entry.initial = opened.outcome;
        return opened.outcome;
      });
    }
    const next = this.queue.then(() => this.openChosen(entry, definitionPath));
    this.queue = next.catch(() => undefined);
    return next;
  }

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
  async openDiff(defaultProvider: 'cursor' | 'claude' | null, defaultModel = ''): Promise<ReviewWindowOutcome> {
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
        defaultModel,
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
    const left = entry.pairKey;
    if (left !== null && left !== key) {
      // This window moves on to another review: a panel docked here does not stay in it.
      this.releasePanelFrom(entry);
    }
    entry.pairKey = key;
    entry.pairLabel = label;
    if (left !== null && left !== key) {
      // The review it left may have no window now.
      this.panelAfterLeaving(left);
    }
    this.panelOffersChanged(key);
    if (!entry.window.isDestroyed()) {
      entry.window.setTitle(titleFor(entry));
    }
    return null;
  }

  /** A walk window learned which pair it is over. */
  joinPair(entry: ReviewWindowEntry, key: string): void {
    entry.pairKey = key;
    if (entry.view === 'walk') {
      this.panelOffersChanged(key);
    }
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
        defaultModel: from.defaultModel,
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

  /**
   * Open a walk definition over a pair in that review's walk window (Niclas's trial
   * feedback, 29 October 2026): one walk window per review. A walk window already over the
   * pair is reused — brought to the front when it shows this definition, else given this
   * definition after it has saved what it holds — and a new one is made only when none is
   * open. The walk's own record keeps its position, so it opens where it was left. The
   * diff window is not moved: the two windows navigate independently.
   */
  openWalkOfPair(from: ReviewWindowEntry, key: string, definitionPath: string): Promise<{ readonly ok: boolean; readonly note: string }> {
    const next = this.queue.then(() => this.openWalkNow(from, key, definitionPath));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async openWalkNow(from: ReviewWindowEntry, key: string, definitionPath: string): Promise<{ readonly ok: boolean; readonly note: string }> {
    const same = (entry: ReviewWindowEntry): boolean =>
      entry.identity !== null && path.resolve(entry.identity.definitionPath).toLowerCase() === path.resolve(definitionPath).toLowerCase();
    const walkWindows = this.list().filter((entry) => entry.view === 'walk');
    // The panel follows the walk opened, whichever it is (30 October 2026).
    this.panelFollowsDefinition(key, definitionPath);
    const showing = walkWindows.find(same);
    if (showing !== undefined) {
      showing.pairKey = key;
      this.focus(showing);
      return { ok: true, note: '' };
    }
    const existing = walkWindows.find((entry) => entry.pairKey === key);
    if (existing !== undefined) {
      await this.flushView(existing);
      const outcome = await this.openChosen(existing, definitionPath);
      if (outcome.kind !== 'opened') {
        return { ok: false, note: outcome.kind === 'failed' ? outcome.error : outcome.note };
      }
      // The view reads what it shows when it loads: the new definition, at its own position.
      existing.contents.reload();
      this.focus(existing);
      return { ok: true, note: '' };
    }
    try {
      const sessionId = await this.newSession();
      let handedOver = false;
      try {
        const opened = await this.options.host.open({ sessionId, definitionPath, remember: true });
        const outcome = isReviewHostError(opened) ? openFailureOf(opened) : opened.outcome;
        if (outcome.kind !== 'opened') {
          return { ok: false, note: outcome.kind === 'failed' ? outcome.error : outcome.note };
        }
        const identity = isReviewHostError(opened) ? null : opened.identity;
        const entry = this.create({
          sessionId,
          startFolder: null,
          defaultProvider: from.defaultProvider,
          defaultModel: from.defaultModel,
          initial: outcome,
          identity,
          chooserKey: null,
        });
        entry.pairKey = key;
        handedOver = true;
        return { ok: true, note: '' };
      } finally {
        if (!handedOver) {
          void this.options.host.closeSession({ sessionId });
        }
      }
    } catch (error) {
      return { ok: false, note: `The walks could not be opened: ${error instanceof Error ? error.message : String(error)}` };
    }
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
      if (entry.identity?.key === key && entry.view !== 'panel' && !entry.window.isDestroyed()) {
        return entry;
      }
    }
    return null;
  }

  focus(entry: ReviewWindowEntry): void {
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
    readonly defaultModel: string;
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
      defaultModel: init.defaultModel,
      initial: init.initial,
      identity: init.identity,
      chooserKey: init.chooserKey,
      focusCount: 0,
      flushedForClose: false,
      view: init.view ?? 'walk',
      pairKey: null,
      pairIdentity: null,
      showDiscussionOnLoad: null,
      pairStart: init.pairStart ?? { kind: 'choose' },
      pairLabel: null,
    };
    this.entries.add(entry);

    window.setMenu(this.viewMenu());
    // A review window opens no window of its own; the review's panel is made here.
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
        // The panel docked here moves to its own window, or goes with the review's last window.
        this.releasePanelFrom(entry);
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
      this.panelAfterClose(entry);
      // The view has saved (or given up) by now; the host lets the window's session go.
      void this.options.host.closeSession({ sessionId: entry.sessionId });
      this.options.log('review window closed; the chat and any run were not affected');
    });
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.options.log(
        `review window did-fail-load url=${validatedURL} code=${String(errorCode)} description=${errorDescription}`,
      );
    });
    this.options.load(window.webContents, entry.view);
    this.options.log(`review window opened: ${window.getTitle()}`);
    return entry;
  }

  // --- The review's panel (Niclas's decision of 30 October 2026) --------------------------
  //
  // The whole right panel, Step and Discussion, belongs to the review: its repository and
  // revision pair. It is one page in a view of its own, which is moved, never rebuilt: in its
  // own window by default, or docked in the diff window or the walk window of the same review,
  // one place at a time. Moving it keeps everything in it (history, draft, quote, an answer on
  // its way, where it is read, what is opened). Closing its window hides it, nothing stops; it
  // goes only with the review's last code window.

  /** The window an entry is seen in: for the panel, the code window it is docked in, or its own. */
  shownWindowOf(entry: ReviewWindowEntry): BrowserWindow {
    if (entry.view === 'panel' && entry.pairKey !== null) {
      const panel = this.panels.get(entry.pairKey);
      if (panel?.host != null && !panel.host.window.isDestroyed()) {
        return panel.host.window;
      }
    }
    return entry.window;
  }

  /** Where the panel of an entry is, for the scenarios' readings. */
  panelReading(entry: ReviewWindowEntry): { readonly place: PanelPlace; readonly visible: boolean; readonly frameVisible: boolean; readonly viewVisible: boolean; readonly viewWidth: number } | null {
    const panel = entry.pairKey === null ? undefined : this.panels.get(entry.pairKey);
    return panel === undefined || panel.entry !== entry
      ? null
      : { place: panel.place, visible: panel.visible, frameVisible: !panel.frame.isDestroyed() && panel.frame.isVisible(), viewVisible: panel.view.getVisible(), viewWidth: panel.view.getBounds().width };
  }

  /** The panel over a pair, if it is open. */
  panelFor(pairKey: string): ReviewWindowEntry | null {
    const panel = this.panels.get(pairKey);
    return panel === undefined || panel.entry.contents.isDestroyed() ? null : panel.entry;
  }

  /** Where the panel of a pair is now, as the panel and a code window of the pair are told. */
  private stateFor(panel: Panel, recipient: ReviewWindowEntry): PanelState {
    const key = panel.entry.pairKey ?? '';
    return {
      place: panel.place,
      visible: panel.visible,
      offers: { diff: this.codeWindow(key, 'diff') !== null, walk: this.codeWindow(key, 'walk') !== null },
      dockedHere: panel.host === recipient && panel.visible,
    };
  }

  private codeWindow(pairKey: string, view: 'diff' | 'walk'): ReviewWindowEntry | null {
    return this.list().find((entry) => entry.view === view && entry.pairKey === pairKey) ?? null;
  }

  /** Tell the panel and every code window of its review where the panel is. */
  private tellPanelState(panel: Panel): void {
    const key = panel.entry.pairKey ?? '';
    for (const entry of [panel.entry, ...this.list().filter((other) => other.view !== 'panel' && other.pairKey === key)]) {
      if (!entry.contents.isDestroyed()) {
        entry.contents.send(REVIEW_PANEL_CHANNELS.state, this.stateFor(panel, entry));
      }
    }
  }

  /** The state a window asks for when it opens: its review's panel, if there is one. */
  panelStateFor(entry: ReviewWindowEntry): PanelState | null {
    const panel = entry.pairKey === null ? undefined : this.panels.get(entry.pairKey);
    return panel === undefined ? null : this.stateFor(panel, entry);
  }

  /**
   * Show the review's panel where it is, opening it when it is not open: over `definitionPath`,
   * the walk shown in the review's walk window, or a definition of the pair with no walks yet.
   * `ask`: the cursor goes into the discussion's question.
   */
  async showPanel(
    pairKey: string,
    definitionPath: string,
    ask: boolean,
    defaults: { readonly provider: 'cursor' | 'claude' | null; readonly model: string },
    tab: 'step' | 'discussion' = 'discussion',
  ): Promise<{ readonly ok: boolean; readonly note: string }> {
    // The step, shown for a point opened in a code window, takes no focus from it.
    const show: ReviewDiscussionEvent = tab === 'step' ? { kind: 'show', quiet: true, tab: 'step' } : { kind: 'show', ...(ask ? {} : { quiet: true as const }) };
    const existing = this.panels.get(pairKey);
    if (existing !== undefined && !existing.entry.contents.isDestroyed()) {
      existing.visible = true;
      this.placePanel(existing, existing.place);
      if (tab !== 'step') {
        this.focusPanel(existing);
      }
      existing.entry.contents.send(REVIEW_DISCUSSION_CHANNELS.event, show);
      return { ok: true, note: '' };
    }
    const sessionId = await this.newSession();
    let handedOver = false;
    try {
      const opened = await this.options.host.open({ sessionId, definitionPath, remember: false });
      const outcome = isReviewHostError(opened) ? openFailureOf(opened) : opened.outcome;
      if (outcome.kind !== 'opened' || isReviewHostError(opened)) {
        return { ok: false, note: outcome.kind === 'failed' ? outcome.error : outcome.kind === 'none' ? outcome.note : 'The discussion could not be opened.' };
      }
      const panel = this.createPanel({ sessionId, initial: outcome, identity: opened.identity, pairKey, defaults });
      handedOver = true;
      panel.entry.showDiscussionOnLoad = show;
      const preferred = await this.preferredPlace();
      panel.visible = true;
      this.placePanel(panel, preferred);
      if (tab !== 'step') {
        this.focusPanel(panel);
      }
      return { ok: true, note: '' };
    } finally {
      if (!handedOver) {
        void this.options.host.closeSession({ sessionId });
      }
    }
  }

  /** Dock the panel in a code window of its review, or move it to its own window. Saved as the choice. */
  dockPanel(panelEntry: ReviewWindowEntry, place: PanelPlace): void {
    const panel = panelEntry.pairKey === null ? undefined : this.panels.get(panelEntry.pairKey);
    if (panel === undefined || panel.entry !== panelEntry) {
      return;
    }
    panel.visible = true;
    this.placePanel(panel, place);
    this.focusPanel(panel);
    void this.savePlace(panel.place);
  }

  /** Hide the panel. Nothing running stops; the next show brings it back where it was. */
  hidePanel(panelEntry: ReviewWindowEntry): void {
    const panel = panelEntry.pairKey === null ? undefined : this.panels.get(panelEntry.pairKey);
    if (panel === undefined || panel.entry !== panelEntry) {
      return;
    }
    panel.visible = false;
    this.placePanel(panel, panel.place);
  }

  /** A code window says where it keeps room for the panel docked in it. */
  panelSlot(host: ReviewWindowEntry, rect: Rectangle | null): void {
    const panel = host.pairKey === null ? undefined : this.panels.get(host.pairKey);
    if (panel === undefined || panel.host !== host) {
      return;
    }
    panel.slot = rect;
    this.layoutPanel(panel);
  }

  /** The walk window says where it is: the panel's Step follows it. */
  panelFollow(walk: ReviewWindowEntry, position: PanelFollow): void {
    if (walk.pairKey === null) {
      return;
    }
    this.lastFollows.set(walk.pairKey, position);
    const panel = this.panels.get(walk.pairKey);
    if (panel === undefined || panel.entry.contents.isDestroyed()) {
      return;
    }
    if (!this.panelFollowsDefinition(walk.pairKey, position.definitionPath)) {
      panel.entry.contents.send(REVIEW_PANEL_CHANNELS.follow, position);
    }
  }

  private readonly lastFollows = new Map<string, PanelFollow>();

  /** Where the walk window over the panel's pair last was, for a panel that has just opened. */
  lastFollowFor(panelEntry: ReviewWindowEntry): PanelFollow | null {
    return panelEntry.pairKey === null ? null : (this.lastFollows.get(panelEntry.pairKey) ?? null);
  }

  /** From the panel: something for a code window of its review to do. The walk's when there is one. */
  panelAction(panelEntry: ReviewWindowEntry, action: PanelAction): void {
    const key = panelEntry.pairKey;
    if (key === null) {
      return;
    }
    const target = this.codeWindow(key, 'walk') ?? (action.kind === 'openLocation' ? this.codeWindow(key, 'diff') : null);
    if (target === null) {
      return;
    }
    target.contents.send(REVIEW_PANEL_CHANNELS.action, action);
    // Seen where it happens: the code window comes forward unless the panel is docked in it.
    const panel = this.panels.get(key);
    if (panel?.host !== target) {
      this.focus(target);
    }
  }

  /**
   * The walk window over the pair shows another definition: the panel's Step is that walk's.
   * Its page is read again over it; what the discussion holds is the service's and stays.
   * True when the panel was changed over.
   */
  private panelFollowsDefinition(pairKey: string, definitionPath: string): boolean {
    const panel = this.panels.get(pairKey);
    if (panel === undefined || panel.entry.contents.isDestroyed()) {
      return false;
    }
    const current = panel.entry.identity?.definitionPath ?? '';
    if (path.resolve(current).toLowerCase() === path.resolve(definitionPath).toLowerCase()) {
      return false;
    }
    void this.options.host.open({ sessionId: panel.entry.sessionId, definitionPath, remember: false }).then((opened) => {
      if (isReviewHostError(opened) || opened.outcome.kind !== 'opened' || panel.entry.contents.isDestroyed()) {
        return;
      }
      panel.entry.initial = opened.outcome;
      panel.entry.identity = opened.identity;
      panel.entry.contents.reload();
    });
    return true;
  }

  private createPanel(init: {
    readonly sessionId: string;
    readonly initial: ReviewOpenOutcome;
    readonly identity: ReviewIdentity | null;
    readonly pairKey: string;
    readonly defaults: { readonly provider: 'cursor' | 'claude' | null; readonly model: string };
  }): Panel {
    const preferences = this.cachedPreferences;
    // Where it was last left, while that is on a screen.
    const bounds = panelBounds(
      preferences?.explanationBounds,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
    const frame = new BrowserWindow({
      ...bounds,
      minWidth: PANEL_SIZE.minWidth,
      minHeight: PANEL_SIZE.minHeight,
      show: false,
      backgroundColor: '#101317',
      title: titleFor({ identity: init.identity, startFolder: null, view: 'panel' }),
    });
    frame.setMenu(this.viewMenu());
    const view = new WebContentsView({
      webPreferences: { preload: this.options.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view.setBackgroundColor('#101317');
    const entry: ReviewWindowEntry = {
      window: frame,
      contents: view.webContents,
      sessionId: init.sessionId,
      startFolder: null,
      defaultProvider: init.defaults.provider,
      defaultModel: init.defaults.model,
      initial: init.initial,
      identity: init.identity,
      chooserKey: null,
      focusCount: 0,
      flushedForClose: false,
      view: 'panel',
      pairKey: init.pairKey,
      pairIdentity: null,
      showDiscussionOnLoad: null,
      pairStart: { kind: 'choose' },
      pairLabel: null,
    };
    this.entries.add(entry);
    const panel: Panel = { entry, view, frame, place: 'window', visible: false, host: null, slot: null, closing: false };
    this.panels.set(init.pairKey, panel);
    frame.on('page-title-updated', (event) => event.preventDefault());
    frame.on('resize', () => this.layoutPanel(panel));
    // Closing its own window hides it (30 October 2026): not a Stop, and not a dock.
    frame.on('close', (event) => {
      if (panel.closing || this.quitRequested) {
        return;
      }
      event.preventDefault();
      this.saveBounds(frame);
      panel.visible = false;
      frame.hide();
      this.tellPanelState(panel);
    });
    frame.on('closed', () => {
      this.entries.delete(entry);
      if (this.panels.get(init.pairKey) === panel) {
        this.panels.delete(init.pairKey);
      }
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
      void this.options.host.closeSession({ sessionId: entry.sessionId });
      this.options.log('review panel closed with its review');
    });
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      this.options.log(`review panel did-fail-load url=${validatedURL} code=${String(errorCode)} description=${errorDescription}`);
    });
    view.webContents.on('did-finish-load', () => this.tellPanelState(panel));
    this.options.load(view.webContents, 'panel');
    this.options.log(`review panel opened: ${frame.getTitle()}`);
    return panel;
  }

  /** Put the panel in its place: its own window, or docked in a code window of its review. */
  private placePanel(panel: Panel, wanted: PanelPlace): void {
    const key = panel.entry.pairKey ?? '';
    const target = wanted === 'window' ? null : this.codeWindow(key, wanted);
    const place: PanelPlace = target === null ? 'window' : wanted;
    const host = place === 'window' ? null : target;
    if (panel.host !== null && panel.host !== host && !panel.host.window.isDestroyed()) {
      panel.host.window.contentView.removeChildView(panel.view);
    }
    if (panel.host === null && host !== null && !panel.frame.isDestroyed()) {
      panel.frame.contentView.removeChildView(panel.view);
    }
    panel.place = place;
    panel.host = host;
    if (host === null) {
      if (!panel.frame.isDestroyed()) {
        panel.frame.contentView.addChildView(panel.view);
        if (panel.visible) {
          // Shown without taking the focus; it is focused when that is asked for.
          if (!panel.frame.isVisible()) {
            panel.frame.showInactive();
          }
        } else {
          panel.frame.hide();
        }
      }
    } else {
      if (!panel.frame.isDestroyed()) {
        panel.frame.hide();
      }
      host.window.contentView.addChildView(panel.view);
      // Until the window says where its room is, the panel is not drawn over its code.
      panel.slot = null;
    }
    this.layoutPanel(panel);
    this.tellPanelState(panel);
  }

  private layoutPanel(panel: Panel): void {
    if (panel.host === null) {
      if (panel.frame.isDestroyed()) {
        return;
      }
      const size = panel.frame.getContentBounds();
      panel.view.setBounds({ x: 0, y: 0, width: size.width, height: size.height });
      panel.view.setVisible(panel.visible);
      return;
    }
    const slot = panel.slot;
    panel.view.setVisible(panel.visible && slot !== null);
    if (slot !== null) {
      panel.view.setBounds({ x: Math.round(slot.x), y: Math.round(slot.y), width: Math.round(slot.width), height: Math.round(slot.height) });
    }
  }

  private focusPanel(panel: Panel): void {
    const window = panel.host === null ? panel.frame : panel.host.window;
    if (window.isDestroyed() || !panel.visible) {
      return;
    }
    if (window.isMinimized()) {
      window.restore();
    }
    window.show();
    window.focus();
    panel.entry.contents.focus();
    panel.entry.focusCount += 1;
  }

  /** A code window is closing: a panel docked in it moves to its own window, keeping all it holds. */
  private releasePanelFrom(entry: ReviewWindowEntry): void {
    if (entry.view === 'panel' || entry.pairKey === null) {
      return;
    }
    const panel = this.panels.get(entry.pairKey);
    if (panel === undefined || panel.host !== entry) {
      return;
    }
    const others = this.list().some((other) => other !== entry && other.view !== 'panel' && other.pairKey === entry.pairKey);
    if (others && !this.quitRequested) {
      this.placePanel(panel, 'window');
    } else {
      entry.window.contentView.removeChildView(panel.view);
      panel.host = null;
    }
  }

  /** After a code window has gone: the panel goes with the review's last one. */
  private panelAfterClose(entry: ReviewWindowEntry): void {
    if (entry.view === 'panel' || entry.pairKey === null) {
      return;
    }
    this.panelAfterLeaving(entry.pairKey);
  }

  /** A code window is no longer over this pair: the panel goes with the review's last one. */
  private panelAfterLeaving(pairKey: string): void {
    const panel = this.panels.get(pairKey);
    if (panel === undefined) {
      return;
    }
    const others = this.list().some((other) => other.view !== 'panel' && other.pairKey === pairKey);
    if (!others) {
      panel.closing = true;
      if (!panel.frame.isDestroyed()) {
        panel.frame.close();
      }
      return;
    }
    this.tellPanelState(panel);
  }

  /** A code window of the review opened or learned its pair: the panel may now dock there. */
  panelOffersChanged(pairKey: string | null): void {
    const panel = pairKey === null ? undefined : this.panels.get(pairKey);
    if (panel !== undefined) {
      this.tellPanelState(panel);
    }
  }

  private cachedPreferences: { readonly explanationBounds?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }; readonly discussionPlace?: 'diff' | 'walk' } | null = null;

  /** Where the person last put the panel; its own window the first time, and when that window is gone. */
  private async preferredPlace(): Promise<PanelPlace> {
    const answer = await this.options.host.getPreferences();
    if (isReviewHostError(answer)) {
      return 'window';
    }
    this.cachedPreferences = answer;
    return answer.discussionPlace ?? 'window';
  }

  private async savePlace(place: PanelPlace): Promise<void> {
    const answer = await this.options.host.getPreferences();
    if (isReviewHostError(answer)) {
      return;
    }
    const { discussionPlace: _old, ...rest } = answer;
    const next = place === 'window' ? rest : { ...rest, discussionPlace: place };
    this.cachedPreferences = next;
    await this.options.host.setPreferences({ preferences: next });
  }

  private saveBounds(frame: BrowserWindow): void {
    if (frame.isDestroyed()) {
      return;
    }
    const bounds = frame.getBounds();
    void this.options.host.getPreferences().then((answer) => {
      if (isReviewHostError(answer)) {
        return;
      }
      const next = { ...answer, explanationBounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
      this.cachedPreferences = next;
      return this.options.host.setPreferences({ preferences: next });
    });
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

/** The review's panel: its page, its own window, and where it is. */
interface Panel {
  readonly entry: ReviewWindowEntry;
  readonly view: WebContentsView;
  readonly frame: BrowserWindow;
  place: PanelPlace;
  visible: boolean;
  /** The code window it is docked in, or `null` in its own window. */
  host: ReviewWindowEntry | null;
  /** Where that window keeps room for it, in the window's coordinates. */
  slot: Rectangle | null;
  /** Its review has gone: its window closes for good. */
  closing: boolean;
}
