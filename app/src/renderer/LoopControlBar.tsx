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
  controlNoteFrom,
  currentControlNote,
  describeControl,
  type ControlNote,
  initialControlState,
  LOOP_MODE_CHOICES,
  LOOP_MODE_EXPLANATION,
  LOOP_MODE_HINT,
  type LoopControlReport,
  type LoopMode,
} from '../shared/loop-control';
import { handoffPromptView, sendHandoffAnswer } from './handoff-prompt';

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
 * DSP-209 S5b: a loop step's recommendation to continue interactively, and the two answers.
 *
 * Shown only while the control report carries one, and gone when it does not. Nothing
 * opens on its own and nothing switches on silence: the run waits until one button is
 * pressed, and Cancel in the composer still ends it. Every word and both answers come from
 * {@link handoffPromptView}.
 */
export function HandoffPrompt({ report }: { readonly report: LoopControlReport }): JSX.Element | null {
  const view = handoffPromptView(report);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const key = view === null ? null : `${report.handoff?.runId ?? ''}:${String(report.handoff?.visit ?? 0)}`;

  // A new recommendation starts with no leftover note and both buttons enabled.
  useEffect(() => {
    setSending(false);
    setNote(null);
  }, [key]);

  if (view === null) {
    return null;
  }
  return (
    <div className="loop-handoff" data-ev="loop-handoff" role="group" aria-label="Continue interactively?">
      <p className="loop-handoff__headline" data-ev="loop-handoff-headline">
        {view.headline}
      </p>
      <blockquote className="loop-handoff__reason" data-ev="loop-handoff-reason">
        {view.reason}
      </blockquote>
      <div className="loop-handoff__choices">
        {view.choices.map((choice) => (
          <button
            key={choice.choice}
            type="button"
            className="button"
            data-ev={`loop-handoff-${choice.choice}`}
            title={choice.hint}
            disabled={sending}
            onClick={() => {
              setSending(true);
              void sendHandoffAnswer((answer) => window.dspatch.answerLoopHandoff(answer), choice).then((refused) => {
                setNote(refused);
                // A refused answer leaves the question standing, so it can be answered again.
                if (refused !== null) {
                  setSending(false);
                }
              });
            }}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {/* DSP-209 S26 (R7): what each answer does, in full, beside the buttons and not only on hover. */}
      <ul className="loop-handoff__explain" data-ev="loop-handoff-explain">
        {view.choices.map((choice) => (
          <li key={choice.choice}>
            <strong>{choice.label}:</strong> {choice.title}
          </li>
        ))}
      </ul>
      {note === null ? null : (
        <p className="loop-handoff__note" data-ev="loop-handoff-note">
          {note}
        </p>
      )}
    </div>
  );
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
  compact = false,
}: {
  readonly report: LoopControlReport;
  readonly loopIntended: boolean;
  /**
   * One line, for a strip whose height must not change (DSP-86).
   *
   * The graph view puts this in a row that already exists and is exactly as tall
   * whether a run is walking or not — because a run that made the strip taller would
   * take height off the drawing at the moment a person most wants it left alone, and
   * the trial measured that at 110 pixels before this existed. So the two paragraphs
   * fold away into **Details**, which the person opens and closes and which overlays
   * the canvas below the strip rather than growing it (DSP-209 S25b: they used to be
   * hovers, and R7 says a hover is never the only place a status appears).
   *
   * It is a shape, not a second vocabulary. Every word is still `describeControl`'s
   * and every enabled button is still `controlActionsFor`'s, which is what keeps the
   * chat and the graph view from wording one run two ways.
   */
  readonly compact?: boolean;
}): JSX.Element | null {
  // DSP-209 S25: kept with the phase it was said in, and shown only while that phase holds.
  const [pressed, setPressed] = useState<ControlNote | null>(null);
  const note = currentControlNote(pressed, report);
  // DSP-209 S25b: opened and closed by the person only, never by a change of phase.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsTop, setDetailsTop] = useState(56);
  const runActive = report.runId !== null;
  const described = describeControl(report.state, {
    runActive,
    // DSP-209 S5b: the bar says the run waits on the person's choice, not that it is going.
    ...(report.handoff === undefined ? {} : { handoff: report.handoff }),
  });
  const actions = controlActionsFor(report.state, { runActive });

  const press = useCallback(async (which: 'pause' | 'continue'): Promise<void> => {
    const outcome =
      which === 'pause'
        ? await window.dspatch.requestLoopPause()
        : await window.dspatch.continueLoop();
    setPressed(controlNoteFrom(outcome));
  }, []);

  // After the hooks, deliberately: a component that returns early above them would
  // break the moment a run started and it began rendering again.
  if (!runActive && !loopIntended) {
    return null;
  }

  return (
    <div
      className={`loop-control loop-control--${described.phase}${compact ? ' loop-control--compact' : ''}`}
      data-ev="loop-control"
    >
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
            steps that start an agent, run a command or hand work outside.
            DSP-209 S25b (R7): the hover is a few words; the full text is in Details. */}
        <label className="loop-control__mode" title={LOOP_MODE_HINT}>
          <span className="loop-control__mode-label">Agent and command steps</span>
          <select
            data-ev="loop-mode"
            value={report.state.mode}
            onChange={(event) => {
              const mode = event.target.value as LoopMode;
              void window.dspatch.setLoopMode(mode).then((outcome) => {
                setPressed(controlNoteFrom(outcome));
              });
            }}
          >
            {LOOP_MODE_CHOICES.map((choice) => (
              <option key={choice.mode} value={choice.mode}>
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
            title={action.hint}
            disabled={!action.enabled}
            onClick={() => {
              void press(action.id);
            }}
          >
            {action.label}
          </button>
        ))}
        {/* DSP-209 S25b (R7): every full sentence the hovers shorten, in a view that stays
            open until closed. Compact adds the phase and the note it has no line for, and
            says on the button that a note is waiting there. */}
        <button
          type="button"
          className="button loop-control__details-toggle"
          data-ev="loop-control-details-toggle"
          aria-expanded={detailsOpen}
          onClick={(event) => {
            // Compact Details is fixed below the toggle (the strip clips what overflows it).
            setDetailsTop(event.currentTarget.getBoundingClientRect().bottom + 4);
            setDetailsOpen((open) => !open);
          }}
        >
          {detailsOpen ? 'Hide details' : compact && note !== null ? 'Details · note' : 'Details'}
        </button>
      </div>
      {runActive && !compact && (
        <p className="loop-control__detail" data-ev="loop-control-detail">
          {described.detail}
        </p>
      )}
      {note === null || compact ? null : (
        <p className="loop-control__note" data-ev="loop-control-note">
          {note}
        </p>
      )}
      {detailsOpen && (
        <div
          className="loop-control__details"
          data-ev="loop-control-details"
          style={compact ? { top: `${String(detailsTop)}px` } : undefined}
        >
          {compact && runActive && (
            <p className="loop-control__detail" data-ev="loop-control-detail">
              <strong>{described.headline}.</strong> {described.detail}
            </p>
          )}
          {compact && note !== null && (
            <p className="loop-control__note" data-ev="loop-control-note">
              {note}
            </p>
          )}
          <p className="loop-control__detail">
            <strong>Agent and command steps.</strong> {LOOP_MODE_EXPLANATION}
          </p>
          <ul className="loop-control__detail">
            {LOOP_MODE_CHOICES.map((choice) => (
              <li key={choice.mode}>
                <strong>{choice.label}:</strong> {choice.title}
              </li>
            ))}
            {(runActive ? actions : []).map((action) => (
              <li key={action.id}>
                <strong>{action.label}:</strong> {action.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
