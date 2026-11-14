/**
 * DSP-209 S21: one step's report in the chat entry of a loop run.
 *
 * Labelled **Step report** — or **Combined report** for the integrator by decision 47's rule —
 * and never the run's report, which is S22's final card alone. The heading names the node,
 * the sub-goal the agent claimed where it declared one, and the visit or rework attempt. What
 * needs the person stands out on the card itself, in words. The body is an excerpt cut
 * mechanically (`stepReportExcerpt`); **Full report** shows the reply whole. Expanding and
 * collapsing is this window's view only: nothing stored or delivered changes.
 *
 * The whole reply stays in the page inside **Full report**'s disclosure, closed or open, so
 * everything that read a reply's text before still finds it. Every word comes from
 * `shared/step-report-cards.ts`.
 */

import { useState } from 'react';
import type { JSX, ReactNode } from 'react';

import type { StepAttention } from '../shared/run-presentation';
import { attentionWords, stepReportExcerpt } from '../shared/step-report-cards';
import { Markdown } from './Markdown';

export function StepReportCard({
  label,
  heading,
  attention,
  text,
  full,
  whileCollapsed,
  details,
  children,
  testId,
}: {
  readonly label: 'Step report' | 'Combined report';
  readonly heading: string;
  readonly attention: StepAttention | null;
  /** The reply, for the excerpt; `null` for a fan-out step, whose reports are its branches'. */
  readonly text: string | null;
  /** The whole reply as the chat renders it, inside **Full report**. */
  readonly full: ReactNode;
  /** Shown under the excerpt while the full report is closed: the person's own messages. */
  readonly whileCollapsed?: ReactNode;
  /** Tool calls and the prompt, behind their own disclosures as before. */
  readonly details?: ReactNode;
  /** Branch reports, grouped under their fan-out step. */
  readonly children?: ReactNode;
  readonly testId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const excerpt = text === null ? null : stepReportExcerpt(text);
  const warning = attentionWords(attention);
  return (
    <section
      className={`step-card${attention === null ? '' : ` step-card--attention step-card--${attention}`}${label === 'Combined report' ? ' step-card--combined' : ''}`}
      data-ev={testId}
      data-step-label={label}
      data-attention={attention ?? ''}
    >
      <p className="step-card__label" data-ev={`${testId}-label`}>
        {label}
      </p>
      <h4 className="step-card__heading" data-ev={`${testId}-heading`}>
        {heading}
      </h4>
      {warning === null ? null : (
        <p className="step-card__attention" data-ev={`${testId}-attention`} role="status">
          {warning}
        </p>
      )}
      {excerpt === null || open ? null : (
        <div className="step-card__excerpt" data-ev={`${testId}-excerpt`}>
          <Markdown text={excerpt.text} />
        </div>
      )}
      {open ? null : whileCollapsed}
      {excerpt === null ? null : (
        <details
          className="step-card__full"
          data-ev={`${testId}-full`}
          onToggle={(event) => setOpen(event.currentTarget.open)}
        >
          <summary className="step-card__toggle">{open ? 'Show excerpt' : 'Full report'}</summary>
          {full}
        </details>
      )}
      {details}
      {children === undefined ? null : <div className="step-card__branches">{children}</div>}
    </section>
  );
}
