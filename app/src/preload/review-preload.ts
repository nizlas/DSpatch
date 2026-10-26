import { contextBridge, ipcRenderer } from 'electron';

import type {
  ReviewBridge,
  ReviewFileOutcome,
  ReviewOpenOutcome,
  ReviewPreferences,
  ReviewState,
  RevisionSide,
} from '../shared/review-model';

/**
 * The review window's preload, and the only bridge a review window has.
 *
 * Separate from `preload.ts` on purpose: a review window gets `dspatchReview` and
 * nothing else - no chat, session, loop or workspace channel - and the chat and editor
 * windows do not get `dspatchReview`. Review is a standalone capability: read-only git
 * at a fixed revision pair, and the reviewer's record.
 *
 * Channel names match `REVIEW_CHANNELS` in `src/shared/review-model.ts`; they are
 * literals here because the sandboxed preload cannot load that module, and a test
 * compares the two. The main process answers them only for review windows.
 */
const reviewBridge: ReviewBridge = {
  initial: () => ipcRenderer.invoke('dspatch:review-initial') as Promise<ReviewOpenOutcome>,
  choose: () => ipcRenderer.invoke('dspatch:review-choose') as Promise<ReviewOpenOutcome>,
  readFile: (side: RevisionSide, filePath: string) =>
    ipcRenderer.invoke('dspatch:review-read-file', side, filePath) as Promise<ReviewFileOutcome>,
  listFiles: (side: RevisionSide) =>
    ipcRenderer.invoke('dspatch:review-list-files', side) as Promise<readonly string[]>,
  search: (side: RevisionSide, query: string) =>
    ipcRenderer.invoke('dspatch:review-search', side, query) as ReturnType<ReviewBridge['search']>,
  saveState: (state: ReviewState) =>
    ipcRenderer.invoke('dspatch:review-save-state', state) as ReturnType<ReviewBridge['saveState']>,
  getPreferences: () =>
    ipcRenderer.invoke('dspatch:review-get-preferences') as ReturnType<ReviewBridge['getPreferences']>,
  setPreferences: (preferences: ReviewPreferences) =>
    ipcRenderer.invoke('dspatch:review-set-preferences', preferences) as ReturnType<ReviewBridge['setPreferences']>,
};

// The renderer has no Node access and no other Electron access.
contextBridge.exposeInMainWorld('dspatchReview', reviewBridge);
