import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import {
  REVIEW_DISCUSSION_CHANNELS,
  type DiscussionCancelOutcome,
  type DiscussionChooseOutcome,
  type DiscussionIdentity,
  type DiscussionLoadOutcome,
  type DiscussionSendOutcome,
  type DiscussionStatusView,
  type DiscussionTarget,
} from '../shared/review-discussion';
import { isReviewHostError, type ReviewHostApi, type ReviewHostError } from '../shared/review-host-contract';
import {
  REVIEW_CHANNELS,
  adoptPreferences,
  type ReviewFileOutcome,
  type ReviewPreferences,
  type ReviewOpenOutcome,
  type ReviewSearchHit,
  type RevisionSide,
} from '../shared/review-model';
import type { ModelListing } from '../shared/bridge';
import {
  REVIEW_PAIR_CHANNELS,
  REVIEW_PANEL_CHANNELS,
  isPairError,
  type DiffLocation,
  type OpenPair,
  type PairAnswer,
  type PairOpenOutcome,
  type PairWalk,
  type PairWindowStart,
  type ReviewRepository,
} from '../shared/review-pair';
import { samePathHere, type ReviewWindowEntry, type ReviewWindows } from './review-windows';

/*
 * The review surface's channels, registered from `main.ts` with one call.
 *
 * Kept out of `bridge.ts`'s channel union on purpose: review is a standalone
 * capability (VISION §3.3) and these channels touch no chat or loop state. The one
 * adapter path is the review discussion's (DSP-127): its own adapter per review, reached
 * only by an explicit send, and its events go only to the windows showing that review on
 * `dspatch:review-discussion-event`, never through the chat's channels. Loading,
 * opening and navigating never call an adapter. Renderer input is checked in the service.
 *
 * **The discussion runs in the project host (DSP-111)**, beside the review host it builds
 * its context from. Each request carries the window's `DiscussionTarget` — its renderer,
 * the review it shows, its default agent and its review session — and the host sends the
 * discussion's events back addressed to that renderer.
 *
 * **Only review windows are answered.** Each handler finds the window the request
 * came from in the registry and asks the review host in that window's own session. A
 * request from any other window - the chat, the loop editor - is refused, and that
 * refusal is the same function the scripted scenario calls with the chat window's sender.
 *
 * **The host's answers in the view's shapes (DSP-111).** Repository and record access
 * goes through `ReviewHostApi`; a `host-error` is turned here into the shape the review
 * preload already returns (a failed file, a search error, an unsaved save with its
 * reason), so the preload and the view are the same as before the host existed.
 */

/** A host error as the view shows a file that could not be read. */
function fileFailure(error: ReviewHostError): ReviewFileOutcome {
  return { kind: 'failed', error: error.message };
}

/**
 * The review discussions, as the client reaches them: each request names its window,
 * and `detach` says a window has gone. `main.ts` binds this to the project host.
 */
export interface ReviewDiscussionClient {
  call(
    method: 'load' | 'send' | 'cancel' | 'acknowledge' | 'draft' | 'quote' | 'chooseAgent' | 'recap',
    target: DiscussionTarget,
    argument?: unknown,
  ): Promise<unknown>;
  detach(targetId: number): void;
  /** DSP-149: the agent's models from its SDK, and the choice shared with the chat. */
  listModels(provider: unknown): Promise<ModelListing>;
  chooseModel(provider: unknown, modelId: unknown): Promise<string>;
}

/** Why a sender is refused, or `null` when it is a review window. */
/**
 * The host's review-pair methods (DSP-150), called for a window.
 *
 * Each window names its pair by key only after the host opened it for that window, and
 * the repository it may name comes from the host's own list; the checks are the host's.
 */
export interface ReviewPairClient {
  call(method: string, ...args: unknown[]): Promise<unknown>;
}

function locationFrom(raw: unknown): DiffLocation | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  return (value['side'] === 'base' || value['side'] === 'target') &&
    typeof value['path'] === 'string' &&
    Number.isInteger(value['line'])
    ? {
        side: value['side'],
        path: value['path'],
        line: value['line'] as number,
        ...(typeof value['threadId'] === 'string' && value['threadId'] !== '' && value['threadId'].length <= 200 ? { threadId: value['threadId'] } : {}),
      }
    : null;
}

function pairLabel(open: OpenPair): string {
  return `${open.repositoryName} · ${open.base.hash.slice(0, 7)}→${open.target.hash.slice(0, 7)}`;
}

export function reviewSenderRefusal(windows: ReviewWindows, sender: WebContents): string | null {
  return windows.entryFor(sender) === null
    ? 'Refused: this window is not a review window, and review answers only its own windows.'
    : null;
}

/**
 * The discussion identity of the review a window shows, or `null` while it is choosing.
 * A walk names its definition, a diff window none: the host gives every window of one review
 * that review's one discussion (30 October and 9 November 2026). The key is the review's id
 * when the window is tied to a review, else empty, and the host finds the review itself.
 */
function discussionIdentityOf(entry: ReviewWindowEntry): DiscussionIdentity | null {
  const identity = entry.identity;
  if (identity !== null) {
    return { key: entry.pairKey ?? '', repository: identity.repository, base: identity.base, target: identity.target, definitionPath: identity.definitionPath };
  }
  const pair = entry.view === 'diff' ? entry.pairIdentity : null;
  return pair === null ? null : { key: entry.pairKey ?? '', repository: pair.repository, base: pair.base, target: pair.target, definitionPath: '' };
}

export function registerReviewIpc(
  windows: ReviewWindows,
  host: ReviewHostApi,
  discussions: ReviewDiscussionClient,
  pairs: ReviewPairClient,
  /** DSP-152: where a start request's way through the main process is logged (ids, no content). */
  log: (message: string) => void = () => undefined,
): void {
  const entryOf = (event: IpcMainInvokeEvent): ReviewWindowEntry => {
    const refusal = reviewSenderRefusal(windows, event.sender);
    const entry = windows.entryFor(event.sender);
    if (refusal !== null || entry === null) {
      throw new Error(refusal ?? 'Refused.');
    }
    return entry;
  };

  ipcMain.handle(REVIEW_CHANNELS.initial, (event): ReviewOpenOutcome => entryOf(event).initial);
  ipcMain.handle(REVIEW_CHANNELS.choose, (event): Promise<ReviewOpenOutcome> => windows.choose(entryOf(event)));
  ipcMain.handle(REVIEW_CHANNELS.reread, (event): Promise<ReviewOpenOutcome> => windows.reread(entryOf(event)));
  ipcMain.handle(REVIEW_CHANNELS.readFile, async (event, side: RevisionSide, filePath: string): Promise<ReviewFileOutcome> => {
    const answer = await host.readFile({ sessionId: entryOf(event).sessionId, side, path: filePath });
    return isReviewHostError(answer) ? fileFailure(answer) : answer;
  });
  ipcMain.handle(REVIEW_CHANNELS.listFiles, async (event, side: RevisionSide): Promise<readonly string[]> => {
    const answer = await host.listFiles({ sessionId: entryOf(event).sessionId, side });
    if (isReviewHostError(answer)) {
      // As before the host: a listing that fails is a rejected call, with the reason.
      throw new Error(answer.detail === undefined ? answer.message : `${answer.message} ${answer.detail}`);
    }
    return answer.files;
  });
  ipcMain.handle(
    REVIEW_CHANNELS.search,
    async (event, side: RevisionSide, query: string): Promise<{ hits: readonly ReviewSearchHit[]; truncated: boolean; error?: string }> => {
      const answer = await host.search({ sessionId: entryOf(event).sessionId, side, query });
      return isReviewHostError(answer) ? { hits: [], truncated: false, error: answer.message } : answer;
    },
  );
  ipcMain.handle(REVIEW_CHANNELS.saveState, async (event, state: unknown): Promise<{ saved: boolean; at: string; error?: string }> => {
    const answer = await host.saveState({ sessionId: entryOf(event).sessionId, state });
    // Not saved, with the reason: the view keeps what it holds and tries again.
    return isReviewHostError(answer) ? { saved: false, at: new Date().toISOString(), error: answer.message } : answer;
  });
  ipcMain.handle(REVIEW_CHANNELS.getPreferences, async (event): Promise<ReviewPreferences> => {
    entryOf(event);
    const answer = await host.getPreferences();
    return isReviewHostError(answer) ? adoptPreferences(null) : answer;
  });
  ipcMain.handle(REVIEW_CHANNELS.setPreferences, async (event, preferences: unknown): Promise<{ saved: boolean; error?: string }> => {
    entryOf(event);
    const answer = await host.setPreferences({ preferences });
    if (isReviewHostError(answer)) {
      // DSP-200: the window says only that its view preferences were not saved; the cause, here.
      log(`[review] view preferences not saved: ${answer.message}`);
      return { saved: false, error: answer.message };
    }
    return answer;
  });

  // --- The review discussion (DSP-127) ---------------------------------------------

  /** Windows already told to detach when they go. */
  // --- A chosen revision pair (DSP-150) ---------------------------------------------------

  const keyOf = (entry: ReviewWindowEntry, key: unknown): string => {
    if (typeof key !== 'string' || key !== entry.pairKey) {
      throw new Error('Refused: this window is not over that revision pair.');
    }
    return key;
  };
  ipcMain.handle(REVIEW_PAIR_CHANNELS.start, (event): PairWindowStart => entryOf(event).pairStart);
  ipcMain.handle(REVIEW_PAIR_CHANNELS.repositories, async (event): Promise<readonly ReviewRepository[]> => {
    entryOf(event);
    return (await pairs.call('reviewPair.repositories')) as readonly ReviewRepository[];
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.log, async (event, repository: unknown, skip: unknown) => {
    entryOf(event);
    return pairs.call('reviewPair.log', repository, skip);
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.direction, async (event, repository: unknown, first: unknown, second: unknown) => {
    entryOf(event);
    return pairs.call('reviewPair.direction', repository, first, second);
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.open, async (event, request: unknown): Promise<PairOpenOutcome> => {
    const entry = entryOf(event);
    if (entry.view !== 'diff') {
      return { kind: 'failed', error: 'Only a diff window chooses a revision pair.' };
    }
    const opened = (await pairs.call('reviewPair.open', request)) as PairAnswer<OpenPair>;
    if (isPairError(opened)) {
      return { kind: 'failed', error: opened.error };
    }
    const other = windows.claimPair(entry, opened.key, pairLabel(opened), opened.pair);
    if (other !== null) {
      return { kind: 'focused', note: 'This review is already open in another review window, which has been brought to the front.' };
    }
    return { kind: 'opened', open: opened };
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.forWalk, async (event): Promise<PairAnswer<OpenPair>> => {
    const entry = entryOf(event);
    const identity = entry.identity;
    if (entry.view === 'diff' || identity === null) {
      return { error: 'No walk is open in this window.' };
    }
    // The definition this window shows, as main opened it: the host reads its points worth checking itself (DSP-175).
    const opened = (await pairs.call(
      'reviewPair.openForWalk',
      {
        repository: identity.repository,
        base: identity.base,
        target: identity.target,
      },
      identity.definitionPath,
      // DSP-186: the review this window was opened for, when it was opened from one.
      entry.pairKey,
    )) as PairAnswer<OpenPair>;
    if (!isPairError(opened)) {
      windows.joinPair(entry, opened.key);
    }
    return opened;
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.readFile, async (event, key: unknown, side: unknown, filePath: unknown) =>
    pairs.call('reviewPair.readFile', keyOf(entryOf(event), key), side, filePath),
  );
  // DSP-175: a file of a context repository, at a commit this review gave as context.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.readContextFile, async (event, key: unknown, repository: unknown, filePath: unknown, commit: unknown) =>
    pairs.call('reviewPair.readContextFile', keyOf(entryOf(event), key), repository, filePath, commit),
  );
  ipcMain.handle(REVIEW_PAIR_CHANNELS.state, async (event, key: unknown) => pairs.call('reviewPair.state', keyOf(entryOf(event), key)));
  ipcMain.handle(REVIEW_PAIR_CHANNELS.mark, async (event, key: unknown, request: unknown) =>
    pairs.call('reviewPair.mark', keyOf(entryOf(event), key), request),
  );
  ipcMain.handle(REVIEW_PAIR_CHANNELS.savePosition, async (event, key: unknown, position: unknown) => {
    const entry = entryOf(event);
    if (entry.view !== 'diff') {
      return { error: 'Only the diff window keeps a position in the pair record.' };
    }
    return pairs.call('reviewPair.savePosition', keyOf(entry, key), position);
  });
  const openWalkDefinitions = (): readonly string[] =>
    windows
      .list()
      .map((other) => other.identity?.definitionPath ?? null)
      .filter((definition): definition is string => definition !== null);
  ipcMain.handle(REVIEW_PAIR_CHANNELS.walks, async (event, key: unknown) =>
    pairs.call('reviewPair.walks', keyOf(entryOf(event), key), openWalkDefinitions()),
  );
  const openWalk = async (entry: ReviewWindowEntry, key: string, definitionPath: string): Promise<{ ok: boolean; note: string }> => {
    const matching = (await pairs.call('reviewPair.walks', key, [definitionPath])) as PairAnswer<readonly PairWalk[]>;
    if (isPairError(matching) || !matching.some((walk) => samePathHere(walk.definitionPath, definitionPath))) {
      return { ok: false, note: 'That walk is over another repository or other revisions, so it is not about this change.' };
    }
    const outcome = await windows.openWalkOfPair(entry, key, definitionPath);
    if (outcome.ok) {
      await pairs.call('reviewPair.walkOpened', key, definitionPath);
    }
    return outcome;
  };
  ipcMain.handle(REVIEW_PAIR_CHANNELS.openWalk, async (event, key: unknown, definitionPath: unknown) => {
    const entry = entryOf(event);
    if (typeof definitionPath !== 'string') {
      return { ok: false, note: 'No walk was named.' };
    }
    return openWalk(entry, keyOf(entry, key), definitionPath);
  });
  // *Code walks*: straight into the review's walk window, at the walk last opened from it.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.openWalks, async (event, key: unknown) => {
    const entry = entryOf(event);
    const pairKey = keyOf(entry, key);
    const chosen = (await pairs.call('reviewPair.walkToOpen', pairKey, openWalkDefinitions())) as PairAnswer<{ readonly definitionPath: string | null }>;
    if (isPairError(chosen)) {
      return { ok: false, note: chosen.error };
    }
    return chosen.definitionPath === null ? { ok: false, note: 'No code walks yet.' } : openWalk(entry, pairKey, chosen.definitionPath);
  });
  /*
   * The review's panel, Step and Discussion (Niclas's decision of 30 October 2026): it
   * belongs to the review, in its own window by default or docked in a code window of the
   * review. Shown from any window of the review; opened over the walk the walk window shows,
   * or the walks prepared, or before any walk over a definition of the pair with none.
   */
  ipcMain.handle(REVIEW_PANEL_CHANNELS.show, async (event, key: unknown, ask: unknown, tab: unknown) => {
    const entry = entryOf(event);
    // The panel and a walk window ask for their own review; the diff window names its pair.
    const pairKey = entry.view === 'panel' || (entry.view === 'walk' && key === null) ? entry.pairKey : keyOf(entry, key);
    if (pairKey === null || pairKey === '') {
      return { ok: false, note: 'No review is open in this window.' };
    }
    let definitionPath = windows.list().find((other) => other.view === 'walk' && other.pairKey === pairKey)?.identity?.definitionPath ?? null;
    if (definitionPath === null && windows.panelFor(pairKey) === null) {
      const chosen = (await pairs.call('reviewPair.walkToOpen', pairKey, openWalkDefinitions())) as PairAnswer<{ readonly definitionPath: string | null }>;
      definitionPath = isPairError(chosen) ? null : chosen.definitionPath;
      if (definitionPath === null) {
        const empty = (await pairs.call('reviewPair.discussionWalk', pairKey)) as PairAnswer<{ readonly definitionPath: string }>;
        if (isPairError(empty)) {
          return { ok: false, note: empty.error };
        }
        definitionPath = empty.definitionPath;
      }
    }
    return windows.showPanel(pairKey, definitionPath ?? '', ask === true, { provider: entry.defaultProvider, model: entry.defaultModel }, tab === 'step' ? 'step' : 'discussion');
  });
  ipcMain.handle(REVIEW_PANEL_CHANNELS.dock, (event, place: unknown) => {
    const entry = entryOf(event);
    if (entry.view === 'panel' && (place === 'window' || place === 'diff' || place === 'walk')) {
      windows.dockPanel(entry, place);
    }
  });
  ipcMain.handle(REVIEW_PANEL_CHANNELS.hide, (event) => {
    const entry = entryOf(event);
    if (entry.view === 'panel') {
      windows.hidePanel(entry);
    }
  });
  ipcMain.handle(REVIEW_PANEL_CHANNELS.lastFollow, (event) => windows.lastFollowFor(entryOf(event)));
  ipcMain.handle(REVIEW_PANEL_CHANNELS.state, (event) => windows.panelStateFor(entryOf(event)));
  ipcMain.on(REVIEW_PANEL_CHANNELS.slot, (event, rect: unknown) => {
    const entry = windows.entryFor(event.sender);
    if (entry === null || entry.view === 'panel') {
      return;
    }
    const value = typeof rect === 'object' && rect !== null ? (rect as Record<string, unknown>) : null;
    const ok = value !== null && ['x', 'y', 'width', 'height'].every((name) => typeof value[name] === 'number' && Number.isFinite(value[name] as number));
    windows.panelSlot(entry, ok && value !== null ? { x: value['x'] as number, y: value['y'] as number, width: value['width'] as number, height: value['height'] as number } : null);
  });
  ipcMain.on(REVIEW_PANEL_CHANNELS.follow, (event, position: unknown) => {
    const entry = windows.entryFor(event.sender);
    const value = typeof position === 'object' && position !== null ? (position as Record<string, unknown>) : null;
    if (entry === null || entry.view !== 'walk' || value === null || typeof value['definitionPath'] !== 'string') {
      return;
    }
    windows.panelFollow(entry, {
      definitionPath: value['definitionPath'],
      stepId: typeof value['stepId'] === 'string' ? value['stepId'] : null,
      placeIndex: Number.isInteger(value['placeIndex']) ? (value['placeIndex'] as number) : 0,
      refIndex: Number.isInteger(value['refIndex']) ? (value['refIndex'] as number) : 0,
      checkId: typeof value['checkId'] === 'string' ? value['checkId'] : null,
      checkBack: typeof value['checkBack'] === 'string' ? value['checkBack'].slice(0, 200) : null,
    });
  });
  ipcMain.on(REVIEW_PANEL_CHANNELS.action, (event, action: unknown) => {
    const entry = windows.entryFor(event.sender);
    const value = typeof action === 'object' && action !== null ? (action as Record<string, unknown>) : null;
    if (entry === null || entry.view !== 'panel' || value === null) {
      return;
    }
    if (value['kind'] === 'goToStep' && typeof value['stepId'] === 'string') {
      windows.panelAction(entry, { kind: 'goToStep', stepId: value['stepId'], placeIndex: Number.isInteger(value['placeIndex']) ? (value['placeIndex'] as number) : 0 });
    } else if (value['kind'] === 'closeCheck') {
      windows.panelAction(entry, { kind: 'closeCheck' });
    } else if (value['kind'] === 'openCheck' && typeof value['checkId'] === 'string') {
      windows.panelAction(entry, { kind: 'openCheck', checkId: value['checkId'] });
    } else if (value['kind'] === 'openLocation') {
      const location = typeof value['location'] === 'object' && value['location'] !== null ? (value['location'] as Record<string, unknown>) : {};
      if ((location['side'] === 'base' || location['side'] === 'target') && typeof location['path'] === 'string' && Number.isInteger(location['start']) && Number.isInteger(location['end'])) {
        windows.panelAction(entry, { kind: 'openLocation', location: { side: location['side'], path: location['path'], start: location['start'] as number, end: location['end'] as number } });
      }
    }
  });
  // The way into review: every review, closing one and deleting one. None starts agent work.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.ongoing, async (event) => {
    entryOf(event);
    return pairs.call('reviewPair.ongoing');
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.end, async (event, review: unknown) => {
    entryOf(event);
    return pairs.call('reviewPair.end', review);
  });
  // DSP-186: the review's windows close first, saving what they hold, so nothing of the
  // review is written after the host has removed it. The window asking stays, without it.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.delete, async (event, review: unknown) => {
    const entry = entryOf(event);
    if (typeof review !== 'string' || review === '') {
      return { error: 'No review was named.' };
    }
    await windows.closeReview(review, entry, 5000);
    return pairs.call('reviewPair.delete', review);
  });
  // DSP-152: agent work over the pair. The host checks the request; a window names only its own pair.
  // The opener's agent and model go with the question: the host answers with the choice
  // made in this review if there is one, else this one, and never picks one itself.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.agents, async (event, key: unknown) => {
    const entry = entryOf(event);
    return pairs.call('reviewPair.agents', keyOf(entry, key), { provider: entry.defaultProvider, model: entry.defaultModel });
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.startJob, async (event, key: unknown, request: unknown) => {
    const from = `review window ${String(event.sender.id)}`;
    log(`[review] ${from}: start request received`);
    try {
      const answer = await pairs.call('reviewPair.startJob', keyOf(entryOf(event), key), request);
      log(`[review] ${from}: start request answered (${isPairError(answer) ? `refused: ${answer.error}` : 'registered'})`);
      return answer;
    } catch (error) {
      log(`[review] ${from}: start request failed before the host answered: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.thread, async (event, key: unknown, request: unknown) =>
    pairs.call('reviewPair.thread', keyOf(entryOf(event), key), request),
  );
  ipcMain.handle(REVIEW_PAIR_CHANNELS.cancelJob, async (event, key: unknown, jobId: unknown) =>
    pairs.call('reviewPair.cancelJob', keyOf(entryOf(event), key), jobId),
  );
  // DSP-189: a walk loop's record, on request only; the window's own review, like every job call.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.walkLoopRecord, async (event, key: unknown, jobId: unknown) =>
    pairs.call('reviewPair.walkLoopRecord', keyOf(entryOf(event), key), jobId),
  );
  // DSP-190: the run as it stands, for the window that follows it; a read, like the record.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.walkLoopRunView, async (event, key: unknown, jobId: unknown) =>
    pairs.call('reviewPair.walkLoopRunView', keyOf(entryOf(event), key), jobId),
  );
  // DSP-190: the window that follows a preparation, opened from a window over the same review.
  ipcMain.handle(REVIEW_PAIR_CHANNELS.openFollow, async (event, key: unknown, jobId: unknown): Promise<{ readonly ok: boolean; readonly note: string }> => {
    const entry = entryOf(event);
    if (typeof jobId !== 'string' || jobId === '') {
      return { ok: false, note: 'No preparation was named.' };
    }
    return windows.openFollow(entry, keyOf(entry, key), jobId);
  });
  ipcMain.handle(REVIEW_PAIR_CHANNELS.showInDiff, async (event, raw: unknown) => {
    const entry = entryOf(event);
    const location = locationFrom(raw);
    const identity = entry.identity;
    if (location === null || identity === null) {
      return { ok: false, note: 'Nothing to show.' };
    }
    return windows.showInDiff(entry, { repository: identity.repository, base: identity.base, target: identity.target }, location);
  });

  const watched = new Set<number>();
  /**
   * The discussion target for this window: the review it shows, or `null` while it is
   * still choosing one. The window is bound as the discussion's event target by every
   * request, so a window that comes back while an answer is still arriving is rebound.
   */
  const targetOf = (entry: ReviewWindowEntry): DiscussionTarget | null => {
    const identity = discussionIdentityOf(entry);
    if (identity === null) {
      return null;
    }
    const contents = entry.contents;
    const id = contents.id;
    if (!watched.has(id)) {
      watched.add(id);
      contents.once('destroyed', () => {
        watched.delete(id);
        discussions.detach(id);
      });
    }
    return {
      targetId: id,
      identity,
      // DSP-132: the main window's agent when it opened this review; none when standalone.
      defaultProvider: entry.defaultProvider,
      sessionId: entry.sessionId,
    };
  };
  const noReview = 'No review is open in this window, so there is nothing to discuss yet.';

  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.load, async (event, request: unknown): Promise<DiscussionLoadOutcome> => {
    const entry = entryOf(event);
    const target = targetOf(entry);
    if (target === null) {
      return { kind: 'refused', error: noReview };
    }
    // The panel, opened to be asked in: once its discussion has loaded, it is shown so.
    const show = entry.showDiscussionOnLoad;
    if (show !== null) {
      entry.showDiscussionOnLoad = null;
      setTimeout(() => {
        if (!entry.contents.isDestroyed()) {
          entry.contents.send(REVIEW_DISCUSSION_CHANNELS.event, show);
        }
      }, 300);
    }
    return (await discussions.call('load', target, request)) as DiscussionLoadOutcome;
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.send, async (event, input: unknown): Promise<DiscussionSendOutcome> => {
    const target = targetOf(entryOf(event));
    if (target === null) {
      return { kind: 'refused', error: noReview };
    }
    return (await discussions.call('send', target, input)) as DiscussionSendOutcome;
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.cancel, async (event): Promise<DiscussionCancelOutcome> => {
    const target = targetOf(entryOf(event));
    return target === null ? { kind: 'nothing', note: noReview } : ((await discussions.call('cancel', target)) as DiscussionCancelOutcome);
  });
  ipcMain.handle(
    REVIEW_DISCUSSION_CHANNELS.acknowledge,
    async (event, attemptIds: unknown): Promise<DiscussionStatusView | { readonly error: string }> => {
      const target = targetOf(entryOf(event));
      return target === null ? { error: noReview } : ((await discussions.call('acknowledge', target, attemptIds)) as DiscussionStatusView);
    },
  );
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.draft, async (event, text: unknown) => {
    const target = targetOf(entryOf(event));
    return target === null ? { saved: false, error: noReview } : discussions.call('draft', target, text);
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.quote, async (event, quote: unknown) => {
    const target = targetOf(entryOf(event));
    if (target !== null) {
      await discussions.call('quote', target, quote);
    }
  });
  // DSP-132: choosing the agent records it and builds nothing.
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.chooseAgent, async (event, provider: unknown): Promise<DiscussionChooseOutcome> => {
    const target = targetOf(entryOf(event));
    return target === null ? { kind: 'refused', error: noReview } : ((await discussions.call('chooseAgent', target, provider)) as DiscussionChooseOutcome);
  });
  // DSP-149: the agent's models and the choice, shared with the chat; no review needed.
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.listModels, (_event, provider: unknown) => discussions.listModels(provider));
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.chooseModel, (_event, provider: unknown, modelId: unknown) =>
    discussions.chooseModel(provider, modelId),
  );
  ipcMain.handle(
    REVIEW_DISCUSSION_CHANNELS.recap,
    async (event, leftOut: unknown): Promise<DiscussionStatusView | { readonly error: string }> => {
      const target = targetOf(entryOf(event));
      return target === null ? { error: noReview } : ((await discussions.call('recap', target, leftOut)) as DiscussionStatusView);
    },
  );
}
