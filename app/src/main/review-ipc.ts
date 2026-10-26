import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import {
  REVIEW_DISCUSSION_CHANNELS,
  type DiscussionCancelOutcome,
  type DiscussionIdentity,
  type DiscussionLoadOutcome,
  type DiscussionSendOutcome,
  type DiscussionStatusView,
} from '../shared/review-discussion';
import { REVIEW_CHANNELS, type ReviewOpenOutcome, type RevisionSide } from '../shared/review-model';
import type { ReviewDiscussionService, ReviewDiscussions } from './review-discussion-service';
import type { ReviewWindowEntry, ReviewWindows } from './review-windows';

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
 * **Only review windows are answered.** Each handler finds the window the request
 * came from in the registry and uses that window's own service. A request from any
 * other window - the chat, the loop editor - is refused, and that refusal is the
 * same function the scripted scenario calls with the chat window's sender.
 */

/** Why a sender is refused, or `null` when it is a review window. */
export function reviewSenderRefusal(windows: ReviewWindows, sender: WebContents): string | null {
  return windows.entryFor(sender) === null
    ? 'Refused: this window is not a review window, and review answers only its own windows.'
    : null;
}

/** The discussion identity of the review a window shows, or `null` while it is choosing. */
function discussionIdentityOf(entry: ReviewWindowEntry): DiscussionIdentity | null {
  const identity = entry.identity;
  return identity === null
    ? null
    : { key: identity.key, repository: identity.repository, base: identity.base, target: identity.target, definitionPath: identity.definitionPath };
}

export function registerReviewIpc(windows: ReviewWindows, discussions: ReviewDiscussions): void {
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
  ipcMain.handle(REVIEW_CHANNELS.readFile, (event, side: RevisionSide, filePath: string) =>
    entryOf(event).service.readFile(side, filePath),
  );
  ipcMain.handle(REVIEW_CHANNELS.listFiles, (event, side: RevisionSide) => entryOf(event).service.listFiles(side));
  ipcMain.handle(REVIEW_CHANNELS.search, (event, side: RevisionSide, query: string) =>
    entryOf(event).service.search(side, query),
  );
  ipcMain.handle(REVIEW_CHANNELS.saveState, (event, state: unknown) => entryOf(event).service.saveState(state));
  ipcMain.handle(REVIEW_CHANNELS.getPreferences, (event) => entryOf(event).service.getPreferences());
  ipcMain.handle(REVIEW_CHANNELS.setPreferences, (event, preferences: unknown) =>
    entryOf(event).service.setPreferences(preferences),
  );

  // --- The review discussion (DSP-127) ---------------------------------------------

  /** Windows already told to detach when they go. */
  const watched = new Set<number>();
  /**
   * The discussion of the review this window shows, with the window bound as its event
   * target. A window that comes back while an answer is still arriving is rebound here.
   */
  const discussionOf = (entry: ReviewWindowEntry): ReviewDiscussionService | null => {
    const identity = discussionIdentityOf(entry);
    if (identity === null) {
      return null;
    }
    const contents = entry.contents;
    const id = contents.id;
    const service = discussions.attach(id, identity, (payload) => {
      if (!contents.isDestroyed()) {
        contents.send(REVIEW_DISCUSSION_CHANNELS.event, payload);
      }
    });
    if (!watched.has(id)) {
      watched.add(id);
      contents.once('destroyed', () => {
        watched.delete(id);
        discussions.detach(id);
      });
    }
    return service;
  };
  const noReview = 'No review is open in this window, so there is nothing to discuss yet.';

  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.load, async (event, request: unknown): Promise<DiscussionLoadOutcome> => {
    const entry = entryOf(event);
    const service = discussionOf(entry);
    if (service === null) {
      return { kind: 'refused', error: noReview };
    }
    return service.load(typeof request === 'object' && request !== null ? (request as never) : null, entry.service);
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.send, async (event, input: unknown): Promise<DiscussionSendOutcome> => {
    const entry = entryOf(event);
    const service = discussionOf(entry);
    if (service === null) {
      return { kind: 'refused', error: noReview };
    }
    return service.send(input, entry.service);
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.cancel, async (event): Promise<DiscussionCancelOutcome> => {
    const service = discussionOf(entryOf(event));
    return service === null ? { kind: 'nothing', note: noReview } : service.cancel();
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.acknowledge, (event, attemptIds: unknown): DiscussionStatusView | { readonly error: string } => {
    const service = discussionOf(entryOf(event));
    return service === null ? { error: noReview } : service.acknowledge(attemptIds);
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.draft, (event, text: unknown) => {
    const service = discussionOf(entryOf(event));
    return service === null ? { saved: false, error: noReview } : service.saveDraft(text);
  });
}
