/**
 * Who hears about a run, and what "the current run" means to a window that has just
 * opened.
 *
 * DSP-28 #1 puts a second window on screen, and that turns an assumption in the
 * existing code into a defect. `startEditorLoopRun` sent every journal entry with
 * `event.sender.send(...)` — to whichever window happened to invoke the run. With
 * one window that is indistinguishable from correct. With two it is wrong in both
 * directions: a chat-loop run started from the chat window has nothing to send to
 * the editor window that is watching the graph, and an editor run keeps talking to
 * the window that started it after the user has moved on.
 *
 * **Events belong to a run, not to a sender.** So this class holds the audience —
 * every live window — and the run they might be watching, and each event carries the
 * run's identity so a window can decide for itself whether the event is addressed to
 * what it is showing (`eventBelongsTo` in `shared/loop-run-view.ts`). Delivery is
 * deliberately dumb; the addressing is what makes it correct.
 *
 * **Looking is not doing** (DSP-28 #5). Nothing here starts, cancels or repeats
 * anything. Adding a window, removing one and asking what is running are all reads:
 * closing the graph view leaves the run exactly as it was, which is the property the
 * tests for this file assert directly.
 */

import type { BridgeChannel } from '../shared/bridge';
import type { LiveRunAnnouncement, LoopRunEvent } from '../shared/loop-run-view';

/**
 * The part of a `BrowserWindow` this needs.
 *
 * An interface rather than the Electron class, so the addressing and the
 * bookkeeping can be tested without a display. What Electron adds is a real window;
 * what it does not add is any different behaviour here.
 */
export interface RunAudienceWindow {
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
}

export class LoopRunAudience {
  private readonly windows = new Set<RunAudienceWindow>();

  private active: LiveRunAnnouncement | null = null;

  /**
   * A window that should hear about runs from now on.
   *
   * Idempotent, because a `Set` is the right shape for an audience: registering the
   * same window twice must not double every entry it receives.
   */
  add(window: RunAudienceWindow): void {
    this.windows.add(window);
  }

  /**
   * A window that has closed.
   *
   * **This must not touch the run.** DSP-28 #1 and #5: closing the graph view is an
   * act of looking, and a run that stopped because the last viewer left would be the
   * exact opposite of what the card asks for. So the active announcement is
   * untouched here, and a window that opens later can still ask what is running.
   */
  remove(window: RunAudienceWindow): void {
    this.windows.delete(window);
  }

  /** Live windows only, in registration order. Destroyed ones are dropped as found. */
  private live(): readonly RunAudienceWindow[] {
    const live: RunAudienceWindow[] = [];
    for (const window of this.windows) {
      if (window.isDestroyed()) {
        this.windows.delete(window);
        continue;
      }
      live.push(window);
    }
    return live;
  }

  windowCount(): number {
    return this.live().length;
  }

  /**
   * Announce a run, and remember it for a window that opens halfway through.
   *
   * One at a time is all the product supports today: the editor refuses a second
   * live run while one is in progress and the chat loop does the same. A second
   * `start` therefore replaces the first, which is what a caller that has already
   * refused the overlap means.
   */
  start(run: LiveRunAnnouncement): void {
    this.active = run;
    this.broadcast({ kind: 'started', run });
  }

  /**
   * The run has ended. The announcement is cleared **only** if it is still this run.
   *
   * Guarded rather than unconditional: a slow `finally` from a cancelled run must not
   * clear the announcement of the run the user has already started after it. That is
   * the same ordering hazard the addressing rule exists for, on the sending side.
   */
  end(ended: Omit<Extract<LoopRunEvent, { kind: 'ended' }>, 'kind'>): void {
    this.broadcast({ kind: 'ended', ...ended });
    if (this.active?.runId === ended.runId) {
      this.active = null;
    }
  }

  /**
   * What is running now, for a window that has just opened.
   *
   * A read. It starts nothing, and calling it twice is the same as calling it once.
   */
  current(): LiveRunAnnouncement | null {
    return this.active;
  }

  /**
   * Send one event to every live window.
   *
   * Not to a sender, and not only to the window that started the run. A window that
   * is not watching this run drops the event itself, which is cheaper and far safer
   * than the main process guessing which window cares: the guess is what would go
   * wrong, silently, the first time a user rearranged their windows.
   */
  broadcast(event: LoopRunEvent): void {
    this.broadcastOn(LOOP_RUN_EVENT_CHANNEL, event);
  }

  /**
   * The same audience, another channel.
   *
   * DSP-29 and DSP-30 put a second thing in front of every window — whether the next
   * work step may start — and it is not a journal entry, so it does not go down the
   * addressed run-event channel and the rule there is left exactly as call 005 built
   * it. What it shares is the audience: every live window, decided the same way.
   */
  broadcastOn(channel: BridgeChannel, payload: unknown): void {
    for (const window of this.live()) {
      try {
        window.send(channel, payload);
      } catch {
        // A window that went away between the liveness check and the send is not an
        // error worth stopping the run for. The others still get the event.
      }
    }
  }
}

/** Kept beside the class so main and preload cannot drift on the channel name. */
export const LOOP_RUN_EVENT_CHANNEL: BridgeChannel = 'dspatch:loop-run-event';
