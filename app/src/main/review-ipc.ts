import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import {
  REVIEW_DISCUSSION_CHANNELS,
  type DiscussionCancelOutcome,
  type DiscussionChooseOutcome,
  type DiscussionIdentity,
  type DiscussionLoadOutcome,
  type DiscussionSendOutcome,
  type DiscussionStatusView,
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
import type { EnvelopeSource, ReviewDiscussionService, ReviewDiscussions } from './review-discussion-service';
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

/** The review discussion's context, built on the host in this window's session. */
export function envelopeSourceFor(host: ReviewHostApi, sessionId: string): EnvelopeSource {
  return {
    envelopeFor: async (request) => {
      const answer = await host.envelopeFor({ sessionId, request });
      return isReviewHostError(answer) ? { kind: 'refused', error: answer.message } : answer;
    },
  };
}

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

export function registerReviewIpc(windows: ReviewWindows, host: ReviewHostApi, discussions: ReviewDiscussions): void {
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
    return isReviewHostError(answer) ? { saved: false, error: answer.message } : answer;
  });

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
    const service = discussions.attach(
      id,
      identity,
      (payload) => {
        if (!contents.isDestroyed()) {
          contents.send(REVIEW_DISCUSSION_CHANNELS.event, payload);
        }
      },
      // DSP-132: the main window's agent when it opened this review; none when standalone.
      entry.defaultProvider,
    );
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
    return service.load(
      typeof request === 'object' && request !== null ? (request as never) : null,
      envelopeSourceFor(host, entry.sessionId),
    );
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.send, async (event, input: unknown): Promise<DiscussionSendOutcome> => {
    const entry = entryOf(event);
    const service = discussionOf(entry);
    if (service === null) {
      return { kind: 'refused', error: noReview };
    }
    return service.send(input, envelopeSourceFor(host, entry.sessionId));
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
  // DSP-132: choosing the agent records it and builds nothing.
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.chooseAgent, async (event, provider: unknown): Promise<DiscussionChooseOutcome> => {
    const service = discussionOf(entryOf(event));
    return service === null ? { kind: 'refused', error: noReview } : service.chooseAgent(provider);
  });
  ipcMain.handle(REVIEW_DISCUSSION_CHANNELS.recap, (event, leftOut: unknown): DiscussionStatusView | { readonly error: string } => {
    const service = discussionOf(entryOf(event));
    return service === null ? { error: noReview } : service.setRecapLeftOut(leftOut);
  });
}
