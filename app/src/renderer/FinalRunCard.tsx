/**
 * DSP-209 S22 (R5): the final run card at the end of a run's chat entry.
 *
 * Every word is `buildFinalRunCard`'s; this only lays it out. The card is visible text, not
 * hover text (R7): nothing here relies on a tooltip, and the long parts — the step outcomes, the
 * run report and the journal — are behind disclosures that stay open and can be selected.
 */

import type { JSX, ReactNode } from 'react';

import type { FinalRunCard as FinalRunCardModel, FinalRunStatus } from '../shared/loop-final-card';

/** No ending earns the positive tone, as for the run's badge: arriving is not success. */
function toneOf(status: FinalRunStatus): 'unsupported' | 'unknown' {
  switch (status) {
    case 'cancelled':
    case 'runtime-fault':
    case 'refused':
    case 'failed':
    case 'interrupted':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

const CARD_STYLE = {
  border: '1px solid currentColor',
  borderRadius: '6px',
  padding: '0.5rem 0.75rem',
  marginTop: '0.5rem',
} as const;

export function FinalRunCard({
  card,
  testId,
  report,
}: {
  readonly card: FinalRunCardModel;
  readonly testId: string;
  /** S12's run report, shown behind the card's expansion. */
  readonly report?: ReactNode;
}): JSX.Element {
  if (card.status === 'running') {
    // Not a final card: the host still runs it, and a pause can still continue.
    return (
      <p className="app__note" data-ev={testId} data-status="running">
        {card.reason}
      </p>
    );
  }
  return (
    <section className="final-run-card" style={CARD_STYLE} data-ev={testId} data-status={card.status} aria-label="Final run card">
      <p className="app__note">
        <strong>Run ended</strong>{' '}
        <span className={`badge badge--${toneOf(card.status)}`} data-ev={`${testId}-status`}>
          {card.statusLabel}
        </span>
      </p>
      <p className="app__note" data-ev={`${testId}-reason`}>
        {card.reason}
      </p>
      <p className="app__note" data-ev={`${testId}-next`}>
        <strong>Your next action:</strong> {card.nextAction}
      </p>
      <dl className="app__note" data-ev={`${testId}-facts`}>
        <dt>Assignment</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{card.assignment}</dd>
        <dt>Sub-goals</dt>
        <dd>{card.subGoals}</dd>
        <dt>Model</dt>
        <dd>
          {card.models.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </dd>
        <dt>Commits</dt>
        <dd data-ev={`${testId}-commits`}>
          {card.commits.map((line, index) => (
            <div key={`commit-${String(index)}`}>{line}</div>
          ))}
        </dd>
      </dl>
      <ul className="app__note" data-ev={`${testId}-counters`}>
        {card.counters.map((line) => (
          <li key={line.label}>
            {line.label}: {line.value}
          </li>
        ))}
      </ul>
      <ul className="app__note" data-ev={`${testId}-distinctions`}>
        {card.distinctions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {card.stepOutcomes.length === 0 ? null : (
        <details className="turn__counts" data-ev={`${testId}-outcomes`}>
          <summary className="turn__counts-summary">What each step declared</summary>
          <ul className="app__note">
            {card.stepOutcomes.map((line, index) => (
              <li key={`outcome-${String(index)}`}>{line}</li>
            ))}
          </ul>
        </details>
      )}
      {report ?? null}
      {card.journal.length === 0 ? null : (
        <details className="turn__counts" data-ev={`${testId}-journal`}>
          <summary className="turn__counts-summary">The run’s journal</summary>
          <ul className="app__note">
            {card.journal.map((line, index) => (
              <li key={`journal-${String(index)}`} style={{ whiteSpace: 'pre-wrap' }}>
                {line}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
