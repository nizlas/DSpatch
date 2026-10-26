import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import { REVIEW_CHANNELS, type ReviewOpenOutcome, type RevisionSide } from '../shared/review-model';
import type { ReviewWindowEntry, ReviewWindows } from './review-windows';

/*
 * The review surface's channels, registered from `main.ts` with one call.
 *
 * Kept out of `bridge.ts`'s channel union on purpose: review is a standalone
 * capability (VISION §3.3) and these channels touch no chat, loop or adapter state.
 * Nothing here calls an agent adapter. Renderer input is checked in the service.
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

export function registerReviewIpc(windows: ReviewWindows): void {
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
}
