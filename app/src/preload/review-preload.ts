import type { HostBrowsePage, HostLinkBridge, HostLinkState } from '../shared/host-link';
import { contextBridge, ipcRenderer, webFrame } from 'electron';

import type {
  ReviewBridge,
  ReviewFileOutcome,
  ReviewOpenOutcome,
  ReviewPreferences,
  ReviewState,
  RevisionSide,
} from '../shared/review-model';
import type { ReviewDiscussionBridge, ReviewDiscussionEvent } from '../shared/review-discussion';
import type { DiffLocation, PairChangedEvent, PanelAction, PanelFollow, PanelState, ReviewPairBridge, ReviewPanelBridge } from '../shared/review-pair';

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
/*
 * This window's zoom, applied before the page runs (DSP-167). The main process keeps one level
 * per window identity (`main/window-zoom.ts`); asked here, synchronously, so the page is never
 * drawn at another size first. The channel name is written out because a sandboxed preload can
 * require no module of DSpatch's; `tests/window-zoom.test.ts` holds it to the shared constant.
 */
try {
  const level: unknown = ipcRenderer.sendSync('dspatch:window-zoom-level');
  // Normal size is left alone: a level set on a page that has not drawn yet kept a hidden
  // window's renderer from drawing its first frame on Linux (DSP-168).
  if (typeof level === 'number' && Number.isFinite(level) && level !== 0) {
    webFrame.setZoomLevel(level);
  }
} catch {
  // Normal size, as a page with no remembered level.
}

const reviewBridge: ReviewBridge = {
  initial: () => ipcRenderer.invoke('dspatch:review-initial') as Promise<ReviewOpenOutcome>,
  choose: () => ipcRenderer.invoke('dspatch:review-choose') as Promise<ReviewOpenOutcome>,
  reread: () => ipcRenderer.invoke('dspatch:review-reread') as Promise<ReviewOpenOutcome>,
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

/**
 * The discussion about the code under review (DSP-127). Channel literals match
 * `REVIEW_DISCUSSION_CHANNELS` in `src/shared/review-discussion.ts`; a test compares
 * them. Events arrive only for the review this window shows.
 */
const discussionBridge: ReviewDiscussionBridge = {
  load: (request) => ipcRenderer.invoke('dspatch:review-discussion-load', request) as ReturnType<ReviewDiscussionBridge['load']>,
  send: (input) => ipcRenderer.invoke('dspatch:review-discussion-send', input) as ReturnType<ReviewDiscussionBridge['send']>,
  cancel: () => ipcRenderer.invoke('dspatch:review-discussion-cancel') as ReturnType<ReviewDiscussionBridge['cancel']>,
  acknowledge: (attemptIds) =>
    ipcRenderer.invoke('dspatch:review-discussion-acknowledge', attemptIds) as ReturnType<ReviewDiscussionBridge['acknowledge']>,
  saveDraft: (text) => ipcRenderer.invoke('dspatch:review-discussion-draft', text) as ReturnType<ReviewDiscussionBridge['saveDraft']>,
  setQuote: (quote) => ipcRenderer.invoke('dspatch:review-discussion-quote', quote) as ReturnType<ReviewDiscussionBridge['setQuote']>,
  // DSP-132: the discussion's agent, and leaving the recap out after a switch.
  chooseAgent: (provider) =>
    ipcRenderer.invoke('dspatch:review-discussion-choose-agent', provider) as ReturnType<ReviewDiscussionBridge['chooseAgent']>,
  setRecapLeftOut: (leftOut) =>
    ipcRenderer.invoke('dspatch:review-discussion-recap', leftOut) as ReturnType<ReviewDiscussionBridge['setRecapLeftOut']>,
  listModels: (provider) =>
    ipcRenderer.invoke('dspatch:review-discussion-list-models', provider) as ReturnType<ReviewDiscussionBridge['listModels']>,
  chooseModel: (provider, modelId) =>
    ipcRenderer.invoke('dspatch:review-discussion-choose-model', provider, modelId) as ReturnType<ReviewDiscussionBridge['chooseModel']>,
  onEvent: (listener) => {
    const handler = (_event: unknown, payload: ReviewDiscussionEvent): void => {
      listener(payload);
    };
    ipcRenderer.on('dspatch:review-discussion-event', handler);
    return () => {
      ipcRenderer.removeListener('dspatch:review-discussion-event', handler);
    };
  },
};

// The renderer has no Node access and no other Electron access.
// DSP-150: a chosen revision pair. The literals repeat `REVIEW_PAIR_CHANNELS`, which the
// sandboxed preload cannot import; a test compares the two.
const pairBridge: ReviewPairBridge = {
  start: () => ipcRenderer.invoke('dspatch:review-pair-start') as ReturnType<ReviewPairBridge['start']>,
  repositories: () => ipcRenderer.invoke('dspatch:review-pair-repositories') as ReturnType<ReviewPairBridge['repositories']>,
  log: (repository, skip) => ipcRenderer.invoke('dspatch:review-pair-log', repository, skip) as ReturnType<ReviewPairBridge['log']>,
  direction: (repository, first, second) =>
    ipcRenderer.invoke('dspatch:review-pair-direction', repository, first, second) as ReturnType<ReviewPairBridge['direction']>,
  open: (pair) => ipcRenderer.invoke('dspatch:review-pair-open', pair) as ReturnType<ReviewPairBridge['open']>,
  forWalk: () => ipcRenderer.invoke('dspatch:review-pair-for-walk') as ReturnType<ReviewPairBridge['forWalk']>,
  readFile: (key, side, filePath) =>
    ipcRenderer.invoke('dspatch:review-pair-read-file', key, side, filePath) as ReturnType<ReviewPairBridge['readFile']>,
  state: (key) => ipcRenderer.invoke('dspatch:review-pair-state', key) as ReturnType<ReviewPairBridge['state']>,
  mark: (key, request) => ipcRenderer.invoke('dspatch:review-pair-mark', key, request) as ReturnType<ReviewPairBridge['mark']>,
  savePosition: (key, position) =>
    ipcRenderer.invoke('dspatch:review-pair-save-position', key, position) as ReturnType<ReviewPairBridge['savePosition']>,
  walks: (key) => ipcRenderer.invoke('dspatch:review-pair-walks', key) as ReturnType<ReviewPairBridge['walks']>,
  openWalk: (key, definitionPath) =>
    ipcRenderer.invoke('dspatch:review-pair-open-walk', key, definitionPath) as ReturnType<ReviewPairBridge['openWalk']>,
  openWalks: (key) => ipcRenderer.invoke('dspatch:review-pair-open-walks', key) as ReturnType<ReviewPairBridge['openWalks']>,
  ongoing: () => ipcRenderer.invoke('dspatch:review-pair-ongoing') as ReturnType<ReviewPairBridge['ongoing']>,
  end: (pair) => ipcRenderer.invoke('dspatch:review-pair-end', pair) as ReturnType<ReviewPairBridge['end']>,
  showInDiff: (location) =>
    ipcRenderer.invoke('dspatch:review-pair-show-in-diff', location) as ReturnType<ReviewPairBridge['showInDiff']>,
  agents: (key) => ipcRenderer.invoke('dspatch:review-pair-agents', key) as ReturnType<ReviewPairBridge['agents']>,
  startJob: (key, request) =>
    ipcRenderer.invoke('dspatch:review-pair-start-job', key, request) as ReturnType<ReviewPairBridge['startJob']>,
  cancelJob: (key, jobId) =>
    ipcRenderer.invoke('dspatch:review-pair-cancel-job', key, jobId) as ReturnType<ReviewPairBridge['cancelJob']>,
  onChanged: (listener) => {
    const handler = (_event: unknown, payload: PairChangedEvent): void => {
      listener(payload);
    };
    ipcRenderer.on('dspatch:review-pair-changed', handler);
    return () => {
      ipcRenderer.removeListener('dspatch:review-pair-changed', handler);
    };
  },
  onNavigate: (listener) => {
    const handler = (_event: unknown, payload: DiffLocation): void => {
      listener(payload);
    };
    ipcRenderer.on('dspatch:review-pair-navigate', handler);
    return () => {
      ipcRenderer.removeListener('dspatch:review-pair-navigate', handler);
    };
  },
};

/** The review's panel, Step and Discussion (30 October 2026). The channels are spelt out: a sandboxed preload imports nothing. */
function listen<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: unknown, payload: T): void => {
    listener(payload);
  };
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}
const panelBridge: ReviewPanelBridge = {
  show: (key, ask, tab) => ipcRenderer.invoke('dspatch:review-panel-show', key, ask, tab === 'step' ? 'step' : 'discussion') as ReturnType<ReviewPanelBridge['show']>,
  dock: (place) => ipcRenderer.invoke('dspatch:review-panel-dock', place) as ReturnType<ReviewPanelBridge['dock']>,
  hide: () => ipcRenderer.invoke('dspatch:review-panel-hide') as ReturnType<ReviewPanelBridge['hide']>,
  slot: (rect) => {
    ipcRenderer.send('dspatch:review-panel-slot', rect);
  },
  follow: (position) => {
    ipcRenderer.send('dspatch:review-panel-follow', position);
  },
  lastFollow: () => ipcRenderer.invoke('dspatch:review-panel-last-follow') as ReturnType<ReviewPanelBridge['lastFollow']>,
  state: () => ipcRenderer.invoke('dspatch:review-panel-state') as ReturnType<ReviewPanelBridge['state']>,
  action: (action) => {
    ipcRenderer.send('dspatch:review-panel-action', action);
  },
  onFollow: (listener) => listen<PanelFollow>('dspatch:review-panel-follow', listener),
  onAction: (listener) => listen<PanelAction>('dspatch:review-panel-action', listener),
  onState: (listener) => listen<PanelState>('dspatch:review-panel-state', listener),
};

contextBridge.exposeInMainWorld('dspatchReview', reviewBridge);
contextBridge.exposeInMainWorld('dspatchReviewPanel', panelBridge);
contextBridge.exposeInMainWorld('dspatchReviewPair', pairBridge);
contextBridge.exposeInMainWorld('dspatchReviewDiscussion', discussionBridge);

contextBridge.exposeInMainWorld('dspatchHost', {
  state: () => ipcRenderer.invoke('dspatch:host-link-state') as Promise<HostLinkState>,
  onState: (listener: (state: HostLinkState) => void) => {
    const handler = (_event: unknown, state: HostLinkState): void => {
      listener(state);
    };
    ipcRenderer.on('dspatch:host-link', handler);
    return () => {
      ipcRenderer.removeListener('dspatch:host-link', handler);
    };
  },
  retry: () => {
    ipcRenderer.send('dspatch:host-link-retry');
  },
  connect: (address: string, token: string) => ipcRenderer.invoke('dspatch:remote-connect', address, token) as Promise<string>,
  leave: () => {
    ipcRenderer.send('dspatch:remote-leave');
  },
  useHere: () => {
    ipcRenderer.send('dspatch:use-here');
  },
  browse: (folder: string | null) => ipcRenderer.invoke('dspatch:host-browse', folder) as Promise<HostBrowsePage>,
  browseDone: (chosen: string | null) => {
    ipcRenderer.send('dspatch:host-browse-done', chosen);
  },
} satisfies HostLinkBridge);
