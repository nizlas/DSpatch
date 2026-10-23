/**
 * A manual clock for the Claude adapter's injected timers, shared by
 * `claude-agent-sdk-adapter.test.ts` and `claude-agent-sdk-adapter-process.test.ts`.
 * Nothing here starts a process or reads a real clock except the short real
 * pauses in {@link advanceUntilSettled}.
 */

/** Timers that fire only when a test advances them. */
export class ManualTimers {
  private now = 0;
  private next = 1;
  private readonly due = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, ms: number): unknown => {
    const id = this.next++;
    this.due.set(id, { at: this.now + ms, callback });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.due.delete(handle as number);
  };

  get pending(): number {
    return this.due.size;
  }

  async advance(ms: number): Promise<void> {
    const target = this.now + ms;
    for (;;) {
      const next = [...this.due.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (next === undefined) {
        break;
      }
      this.due.delete(next[0]);
      this.now = next[1].at;
      next[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

/** Let promises and stream callbacks run. */
export async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Advance the manual clock in steps, with a short real pause between them, until
 * `promise` settles: for code that reaches its next timed wait only after real
 * time (a real process, or a scenario's own real-time watch).
 */
export async function advanceUntilSettled<T>(
  timers: ManualTimers,
  promise: Promise<T>,
  stepMs: number,
): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  tracked.catch(() => undefined);
  for (let turn = 0; turn < 400 && !done; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await timers.advance(stepMs);
  }
  return tracked;
}
