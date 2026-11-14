/**
 * DSP-209 S25b (N2): a stop asked for in one window, told to the others.
 *
 * The loop editor's Cancel run ends a chat-loop run through the same `cancelChatLoopRun` the
 * chat's Stop uses, but the chat window marks its entry "stop requested" in its own state, and
 * a cancel from the editor never reached that state. This carries the run id from the window
 * that asked to every other window, through storage, as `presentation-choice.ts` shares a
 * choice. No host call and no new channel: it says only that a stop was asked for. The
 * run's own ending still comes from the run, and the chat's reducer ignores a stop for a run
 * whose entry has already ended.
 *
 * A `storage` event reaches the other windows only, which is the point: the window that
 * cancelled has already said so itself.
 */

const STOP_SIGNAL_KEY = 'dspatch.loop.stopRequested';

/** The run id from a stored signal, or `null` when the value is not one. */
export function stopSignalRunId(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const runId = (parsed as Record<string, unknown>)['runId'];
    return typeof runId === 'string' && runId !== '' ? runId : null;
  } catch {
    return null;
  }
}

/** Tell the other windows that a stop was asked for this run. Silent if storage is unavailable. */
export function announceLoopStopRequested(runId: string): void {
  try {
    // The time makes every announcement a change, so a second cancel of one run is heard too.
    window.localStorage.setItem(STOP_SIGNAL_KEY, JSON.stringify({ runId, atMs: Date.now() }));
  } catch {
    // Not shared; the run is cancelled all the same, and its ending reaches the chat.
  }
}

/** Hear stops asked for in other windows. Returns the unsubscribe. */
export function onLoopStopRequestedElsewhere(listener: (runId: string) => void): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== STOP_SIGNAL_KEY) {
      return;
    }
    const runId = stopSignalRunId(event.newValue);
    if (runId !== null) {
      listener(runId);
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
