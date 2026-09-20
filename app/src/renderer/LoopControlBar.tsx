/**
 * The visible answer to "who decides that the next work step starts".
 *
 * One component, used by the chat window and by the graph view, because DSP-29 and
 * DSP-30 are one mechanism and two renderings of it could word the same run
 * differently — which is the class of defect this whole call exists to avoid. Every
 * word and every enabled button is derived from `shared/loop-control.ts`; nothing is
 * decided here.
 *
 * **The headline is the honest one.** While a provider call or a command is in flight
 * it reads *Pause requested*, and the only thing that turns it into *Paused* is the
 * main process reporting that the step ended.
 */

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import {
  controlActionsFor,
  describeControl,
  initialControlState,
  LOOP_MODE_CHOICES,
  type LoopControlReport,
  type LoopMode,
} from '../shared/loop-control';

/**
 * Subscribe to the control, and read it once for a window that opened halfway through.
 *
 * The read is a read: it starts nothing, and a window that has just opened onto a
 * paused run is told the same thing as the window that paused it.
 */
export function useLoopControl(): LoopControlReport {
  const [report, setReport] = useState<LoopControlReport>(() => ({
    runId: null,
    state: initialControlState(),
  }));

  useEffect(() => {
    const stop = window.dspatch.onLoopControl(setReport);
    void window.dspatch.loopControl().then(setReport, () => {
      /* Nothing to control is the ordinary case and not an error. */
    });
    return stop;
  }, []);

  return report;
}

/**
 * The control, when there is something for it to control.
 *
 * `loopIntended` is the switch that starts a loop, and it is here because of what the
 * row looked like without it: beside an ordinary chat composer this drew a mode
 * chooser and the sentence *"No loop is running…"*, which Niclas read as a second
 * copy of `Use loop` — reasonably, since at rest that is all it could be. It is not
 * one. What the chooser decides is read out of `loop-control.ts`: whether a step that
 * **starts an agent, runs a command or hands work outside DSpatch** starts on its own
 * or waits to be let through, one step at a time. It holds nothing else — routing
 * between steps never waits, a human step waits either way, and none of it applies
 * until a loop is walking. So it is shown while a run is walking, and while `Use loop`
 * says the next send will start one, and not otherwise.
 */
export function LoopControlBar({
  report,
  loopIntended,
}: {
  readonly report: LoopControlReport;
  readonly loopIntended: boolean;
}): JSX.Element | null {
  const [note, setNote] = useState<string | null>(null);
  const runActive = report.runId !== null;
  const described = describeControl(report.state, { runActive });
  const actions = controlActionsFor(report.state, { runActive });

  const press = useCallback(async (which: 'pause' | 'continue'): Promise<void> => {
    const outcome =
      which === 'pause'
        ? await window.dspatch.requestLoopPause()
        : await window.dspatch.continueLoop();
    setNote(outcome.note);
  }, []);

  // After the hooks, deliberately: a component that returns early above them would
  // break the moment a run started and it began rendering again.
  if (!runActive && !loopIntended) {
    return null;
  }

  return (
    <div className={`loop-control loop-control--${described.phase}`} data-ev="loop-control">
      <div className="loop-control__row">
        {/* With no run, the headline is the mode — which the chooser beside it
            already says. It is worth a word of its own only when it is saying
            something the chooser cannot: running, pause requested, paused,
            waiting for you. */}
        {runActive && (
          <span className="loop-control__phase" data-ev="loop-control-phase">
            {described.headline}
          </span>
        )}
        {/* Named after what it holds, which is the only way a person can tell it from
            `Use loop`: not steps in general, and not the loop as a whole, but the
            steps that start an agent, run a command or hand work outside. */}
        <label
          className="loop-control__mode"
          title={
            'Applies to a step that starts an agent, runs a command or hands work to ' +
            'someone DSpatch does not run. The loop is not held between steps: routing ' +
            'from one to the next never waits, and a human step waits for an answer ' +
            'either way. Letting one step through is spent on that step, so the next ' +
            'one asks again.'
          }
        >
          <span className="loop-control__mode-label">Agent and command steps</span>
          <select
            data-ev="loop-mode"
            value={report.state.mode}
            onChange={(event) => {
              const mode = event.target.value as LoopMode;
              void window.dspatch.setLoopMode(mode).then((outcome) => {
                setNote(outcome.note);
              });
            }}
          >
            {LOOP_MODE_CHOICES.map((choice) => (
              <option key={choice.mode} value={choice.mode} title={choice.title}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {/*
          Pause and Continue are offered while there is a run for them to act on.
          With no run they were two disabled buttons under a paragraph explaining
          what would happen if there were one, which is the idle-plus-running
          -plus-paused row §9.1 asks not to be shown all at once. Nothing about
          what they mean or what they reach has changed — `controlActionsFor`
          still decides which of them can do anything.
        */}
        {(runActive ? actions : []).map((action) => (
          <button
            key={action.id}
            type="button"
            className="button"
            data-ev={`loop-${action.id}`}
            title={action.title}
            disabled={!action.enabled}
            onClick={() => {
              void press(action.id);
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
      {runActive && (
        <p className="loop-control__detail" data-ev="loop-control-detail">
          {described.detail}
        </p>
      )}
      {note === null ? null : (
        <p className="loop-control__note" data-ev="loop-control-note">
          {note}
        </p>
      )}
    </div>
  );
}
