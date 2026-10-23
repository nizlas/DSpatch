import { dialog, ipcMain, type BrowserWindow } from 'electron';

import type { ReviewOpenOutcome, ReviewState, RevisionSide } from '../shared/review-model';
import { ReviewService } from './review-service';

/**
 * The review surface's channels, registered from `main.ts` with one call.
 *
 * Kept out of `bridge.ts`'s channel union on purpose: review is a standalone
 * capability (VISION §3.3) and these channels touch no chat, loop or adapter state.
 * Nothing here calls an agent adapter.
 */
export const REVIEW_CHANNELS = {
  initial: 'dspatch:review-initial',
  choose: 'dspatch:review-choose',
  readFile: 'dspatch:review-read-file',
  listFiles: 'dspatch:review-list-files',
  search: 'dspatch:review-search',
  saveState: 'dspatch:review-save-state',
} as const;

export interface ReviewIpcOptions {
  readonly recordsDir: string;
  /** From `DSPATCH_REVIEW_DEFINITION`, set by `npm run review -- <file>`. */
  readonly initialDefinition: string | null;
  readonly window: () => BrowserWindow | null;
  readonly log: (message: string) => void;
}

export function registerReviewIpc(options: ReviewIpcOptions): void {
  const service = new ReviewService({ recordsDir: options.recordsDir, log: options.log });

  ipcMain.handle(REVIEW_CHANNELS.initial, async (): Promise<ReviewOpenOutcome> => {
    if (options.initialDefinition === null) {
      return {
        kind: 'none',
        note: 'No review was named at start. Choose a review definition file (*.review.json).',
      };
    }
    return service.openDefinition(options.initialDefinition);
  });

  ipcMain.handle(REVIEW_CHANNELS.choose, async (): Promise<ReviewOpenOutcome> => {
    const window = options.window();
    const dialogOptions = {
      title: 'Open a review definition',
      properties: ['openFile' as const],
      filters: [{ name: 'Review definition', extensions: ['json'] }],
    };
    const result =
      window === null ? await dialog.showOpenDialog(dialogOptions) : await dialog.showOpenDialog(window, dialogOptions);
    const chosen = result.filePaths[0];
    if (result.canceled || chosen === undefined) {
      return { kind: 'none', note: 'No file was chosen.' };
    }
    return service.openDefinition(chosen);
  });

  ipcMain.handle(REVIEW_CHANNELS.readFile, (_event, side: RevisionSide, filePath: string) =>
    service.readFile(side, filePath),
  );
  ipcMain.handle(REVIEW_CHANNELS.listFiles, (_event, side: RevisionSide) => service.listFiles(side));
  ipcMain.handle(REVIEW_CHANNELS.search, (_event, side: RevisionSide, query: string) => service.search(side, query));
  ipcMain.handle(REVIEW_CHANNELS.saveState, (_event, state: ReviewState) => service.saveState(state));
}
