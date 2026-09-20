/**
 * The messages a run has been given and not yet handed to a step.
 *
 * Small on purpose. The rules about what a message *means* and what the user is
 * told about it live in `shared/loop-instruction.ts`, where the window reads them
 * too; this is only the part that has to exist in the main process because that
 * is where a run's steps actually start.
 *
 * **Draining is the delivery.** {@link InstructionQueue.takeFor} is called from
 * the one place a step's prompt is built, so a message is marked as delivered at
 * the same instant its text goes into the prompt. There is deliberately no way to
 * mark a delivery separately: two calls could disagree, and the disagreement would
 * be DSpatch telling someone an agent had been told something it had not — the one
 * claim §4.4 singles out as forbidden.
 *
 * **Scoped to a run, by id.** A message typed into one run must not be handed to
 * the next one: it was written about work that has since ended, and its author has
 * not asked for it to be applied to anything else.
 */

export interface QueuedInstruction {
  readonly id: string;
  readonly runId: string;
  readonly text: string;
  readonly receivedAtUtc: string;
}

export class InstructionQueue {
  private readonly waiting: QueuedInstruction[] = [];

  private counter = 0;

  /**
   * Accept a message for a run.
   *
   * Returns the entry so the caller can tell the window what it now holds. The id
   * is generated here rather than in the renderer, so two windows cannot mint the
   * same one and the main process stays the single source of what exists.
   */
  add(runId: string, text: string, atUtc: string): QueuedInstruction {
    this.counter += 1;
    const entry: QueuedInstruction = {
      id: `msg-${String(this.counter)}-${atUtc}`,
      runId,
      text,
      receivedAtUtc: atUtc,
    };
    this.waiting.push(entry);
    return entry;
  }

  /** What is still waiting for this run, oldest first. Reading only. */
  peekFor(runId: string): readonly QueuedInstruction[] {
    return this.waiting.filter((entry) => entry.runId === runId);
  }

  /**
   * Hand this run's waiting messages to the step that is starting now.
   *
   * Removes them, because they are about to be put in a prompt. A message handed
   * to two steps would be an instruction applied twice, and the caller cannot
   * un-send the first prompt to make up for it.
   */
  takeFor(runId: string): readonly QueuedInstruction[] {
    const taken = this.waiting.filter((entry) => entry.runId === runId);
    for (const entry of taken) {
      const at = this.waiting.indexOf(entry);
      if (at !== -1) {
        this.waiting.splice(at, 1);
      }
    }
    return taken;
  }

  /**
   * Forget a finished run's undelivered messages, and say which they were.
   *
   * The caller reports them as never delivered. Dropping them silently is the
   * failure §4.4 names: *if no step receives it before the run ends, say so.*
   */
  releaseRun(runId: string): readonly QueuedInstruction[] {
    return this.takeFor(runId);
  }
}
