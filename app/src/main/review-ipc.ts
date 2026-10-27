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
    method: 'load' | 'send' | 'cancel' | 'acknowledge' | 'draft' | 'chooseAgent' | 'recap',
    target: DiscussionTarget,
    argument?: unknown,
  ): Promise<unknown>;
  detach(targetId: number): void;
  /** DSP-149: the agent's models from its SDK, and the choice shared with the chat. */
  listModels(provider: unknown): Promise<ModelListing>;
  chooseModel(provider: unknown, modelId: unknown): Promise<string>;
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

export function registerReviewIpc(windows: ReviewWindows, host: ReviewHostApi, discussions: ReviewDiscussionClient): void {
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
    const target = targetOf(entryOf(event));
    if (target === null) {
      return { kind: 'refused', error: noReview };
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
