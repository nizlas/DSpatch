/**
 * The resource governor at the start of a loop step (DSP-173).
 *
 * Wraps the run's control port (`LoopRunController`): the person's pause, interactive mode and
 * Stop are asked first and unchanged; then, in enforce, a step that would start under YELLOW waits
 * a short pause and one under RED waits for the health to fall, bounded and ended at once by Stop.
 * The wait happens before `node-entered`, so the step's own time limit has not begun. A wait that
 * reaches its bound asks the run to pause: the run then waits for a person, as a pause does,
 * rather than going on by itself under pressure. A person's Continue asks the machine again: the
 * step starts if the pressure has eased and is held again if not, so Continue never lifts the
 * protection silently.
 *
 * Every hold, release, pause and change of the health is in the run's journal; the mode and the
 * health a step started under are on its `node-entered` line. In observe nothing waits.
 */

import type { StepHold, StepRef } from '../shared/loop-control';
import type { HandoffAnswer, HandoffRequest, RunControlPort, StepReleaseOutcome } from '../shared/loop-run';
import type { HealthChange, ResourceGovernor } from './resource-governor';

type JournalData = Readonly<Record<string, string | number | boolean>>;

/** What the wrapper needs of the run's own control. */
export interface InnerRunControl extends RunControlPort {
  requestPause(): { readonly accepted: boolean; readonly note: string };
}

export class GovernedRunControl implements RunControlPort {
  private post: ((detail: string, data: JournalData) => void) | null = null;
  private release: (() => void) | null = null;
  private readonly inner: InnerRunControl;
  private readonly governor: ResourceGovernor;
  private readonly signal: AbortSignal;

  constructor(inner: InnerRunControl, governor: ResourceGovernor, signal: AbortSignal) {
    this.inner = inner;
    this.governor = governor;
    this.signal = signal;
  }

  notices(post: (detail: string, data: JournalData) => void): () => void {
    this.post = post;
    if (this.governor.mode === 'off') {
      return () => {
        this.post = null;
      };
    }
    this.release = this.governor.use((change) => this.changed(change));
    const unknown = this.governor.latest.missing;
    post(
      `Resource governor: ${this.governor.mode}. ${
        this.governor.mode === 'observe' ? 'It records the machine\'s health and changes nothing in how the run goes.' : 'Under sustained pressure it holds new steps and defers DSpatch\'s own command observations.'
      } Health ${this.governor.health}${unknown.length > 0 ? ` (unknown: ${unknown.join('; ')})` : ''}. Commands a provider already runs are not slowed by it.`,
      { mode: this.governor.mode, health: this.governor.health, acted: false },
    );
    return () => this.dispose();
  }

  /** The run has ended: stop reading for it and write nothing more. Safe to call twice. */
  dispose(): void {
    this.post = null;
    this.release?.();
    this.release = null;
  }

  private changed(change: HealthChange): void {
    this.post?.(
      `The machine's health went from ${change.from} to ${change.to}: ${change.reasons.join('; ')}${change.missing.length > 0 ? ` (unknown: ${change.missing.join('; ')})` : ''}.`,
      { mode: this.governor.mode, from: change.from, to: change.to, at: new Date(change.at).toISOString(), acted: false },
    );
  }

  private stepData(): JournalData {
    return this.governor.mode === 'off' ? {} : { resourceGovernor: this.governor.mode, resourceHealth: this.governor.health };
  }

  async awaitStepRelease(step: StepRef, onHeld: (hold: StepHold, why: string) => void): Promise<StepReleaseOutcome> {
    let outcome = await this.inner.awaitStepRelease(step, onHeld);
    let waitedMs = outcome.waitedMs;
    let heldMs = 0;
    let pausedForPerson = false;
    const data = (): JournalData => ({
      ...this.stepData(),
      ...(heldMs > 0 || pausedForPerson ? { resourceHeldMs: heldMs } : {}),
      ...(pausedForPerson ? { resourcePausedForPerson: true } : {}),
    });
    // Asked again after each pause at the bound: a person's Continue lets the run go on, but it
    // does not lift the protection. If the machine is still pressed the step is held again, said
    // as such, bounded and ended by Stop as before.
    for (;;) {
      if (outcome.kind === 'cancelled' || this.governor.mode !== 'enforce') {
        return { ...outcome, waitedMs, ...(pausedForPerson ? { heldBy: outcome.heldBy ?? 'resources' } : {}), stepData: data() };
      }
      const health = this.governor.health;
      if (health !== 'YELLOW' && health !== 'RED') {
        return { ...outcome, waitedMs, ...(pausedForPerson ? { heldBy: outcome.heldBy ?? 'resources' } : {}), stepData: data() };
      }
      const reasons = this.governor.latest.reasons.join('; ');
      const bound = `${String(Math.round(this.governor.config.maxWaitMs / 60_000))} min`;
      const why =
        health === 'RED'
          ? pausedForPerson
            ? `Held again before "${step.nodeLabel}" after Continue: the machine is still under heavy pressure (${reasons}). Continue does not override the resource protection; the step starts when the pressure eases, or waits for you again after ${bound}; Stop ends the wait.`
            : `Held before "${step.nodeLabel}": the machine is under heavy pressure (${reasons}). It starts when that eases, or waits for you after ${bound}; Stop ends the wait.`
          : `A short pause before "${step.nodeLabel}": the machine is under some pressure (${reasons}).`;
      onHeld('resources', why);
      this.post?.(why, { mode: 'enforce', health, acted: true, action: health === 'RED' ? (pausedForPerson ? 'hold-after-continue' : 'hold') : 'pause' });
      const gate = await this.governor.beforeStep(this.signal);
      waitedMs += gate.waitedMs;
      heldMs += gate.waitedMs;
      if (gate.kind === 'stopped') {
        return {
          kind: 'cancelled',
          detail: 'The run was cancelled while it waited for the machine\'s load to ease, so the step it was holding was not started.',
          heldBy: 'resources',
          waitedMs,
          stepData: data(),
        };
      }
      if (gate.kind === 'go') {
        const detail = `Released "${step.nodeLabel}" after ${String(Math.round(gate.waitedMs / 1000))} s held for the machine's load; health now ${gate.health}.`;
        this.post?.(detail, { mode: 'enforce', health: gate.health, acted: true, action: 'released', heldMs: gate.waitedMs });
        // A pause, or interactive mode, asked for while this waited still decides: the run's own
        // control is asked again before the step starts.
        const again = await this.inner.awaitStepRelease(step, onHeld);
        return {
          kind: again.kind,
          detail: again.kind === 'start' && again.heldBy === null ? detail : again.detail,
          heldBy: again.heldBy ?? 'resources',
          waitedMs: waitedMs + again.waitedMs,
          stepData: { ...data(), resourceHeldMs: heldMs },
        };
      }
      // The bound: not going on by itself under pressure, and not ending the run either. The run
      // pauses as a person's pause does, keeping everything, and waits for Continue or Stop.
      const paused = this.inner.requestPause();
      const detail = `Paused for you: the machine stayed under heavy pressure for ${String(Math.round(gate.waitedMs / 60_000))} min (${gate.reasons.join('; ')}). Nothing was started and nothing was reset. Continue checks the machine again: "${step.nodeLabel}" starts if the pressure has eased and is held again if not; Stop ends the run.`;
      this.post?.(detail, { mode: 'enforce', health: gate.health, acted: true, action: 'paused', heldMs: gate.waitedMs, pauseAccepted: paused.accepted });
      if (!paused.accepted) {
        // No run to pause: nothing can wait for a person, and nothing may start under pressure.
        return { kind: 'cancelled', detail: `${detail} ${paused.note}`, heldBy: 'resources', waitedMs, stepData: data() };
      }
      pausedForPerson = true;
      outcome = await this.inner.awaitStepRelease(step, (hold) => onHeld(hold, detail));
      waitedMs += outcome.waitedMs;
    }
  }

  stepStarted(step: StepRef): void {
    this.inner.stepStarted(step);
  }

  stepEnded(step: StepRef): void {
    this.inner.stepEnded(step);
  }

  /**
   * DSP-209 S5a: the person's answer is the run's own control's business; the governor
   * holds nothing here. An inner control without it is one nobody can answer through.
   */
  awaitHandoffAnswer(request: HandoffRequest): Promise<HandoffAnswer> {
    return (
      this.inner.awaitHandoffAnswer?.(request) ??
      Promise.resolve({
        kind: 'loop',
        detail: 'This run has no control a person could answer through, so it continues in the loop.',
        waitedMs: 0,
      })
    );
  }
}
