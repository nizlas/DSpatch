/**
 * DSP-152: explanations of code selected in the diff, beside the diff.
 *
 * The person selects code (part of a line, several lines, removed, added or unchanged) and
 * chooses *Explain this*; the agent explains it through the analysis path, reading the two
 * revisions with its read-only tools. Each explanation is a job of the review, stored with
 * the pair: it reopens with the review, and its selection says the file, side, revision,
 * lines and characters it is about. Follow-ups (*Tell me more*, *Explain more simply*, a
 * question of the person's own) are further jobs over the same selection, given the earlier
 * answers.
 *
 * The panel is folded away to a narrow tab when not wanted; it never moves the diff's
 * reading position and never changes what is marked as reviewed.
 */

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

import { segmentWords, type AgentJob, type CodeSelection, type CodeSelectionRequest, type ExplainAction, type LineRange } from '../shared/review-pair';
import { AgentPicker, type AgentChoice } from './AgentPicker';
import { ShortThenMore } from './DiscussionAnswer';
import { attemptLabel, isRunning, JobLine, JobNote } from './PairReview';

const FOLLOW_UP_WORD: Record<ExplainAction, string> = { more: 'Tell me more', simpler: 'Explain more simply', question: 'Your question' };

/** The explanations of a review: first jobs over a selection, each with its follow-ups in order. */
export interface ExplanationThread {
  readonly root: AgentJob & { readonly selection: CodeSelection };
  readonly followUps: readonly AgentJob[];
}

export function explanationThreads(jobs: readonly AgentJob[]): readonly ExplanationThread[] {
  return jobs
    .filter((job): job is AgentJob & { readonly selection: CodeSelection } => job.kind === 'explain' && job.selection !== undefined && job.followUp === undefined)
    .map((root) => ({ root, followUps: jobs.filter((job) => job.kind === 'explain' && job.followUp?.root === root.id) }));
}

/** A selection in a line, for the list of earlier explanations. */
function selectionTitle(selection: CodeSelection): string {
  const first = selection.segments[0];
  const text = selection.segments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim();
  return `“${text.length > 48 ? `${text.slice(0, 47)}…` : text}”${first === undefined ? '' : ` · line ${String(first.start)}`}`;
}

function Answer({
  job,
  onShowRange,
  onSimpler,
}: {
  readonly job: AgentJob;
  readonly onShowRange: (range: LineRange) => void;
  /** Explain this answer more simply, with its own question (30 October 2026). */
  readonly onSimpler: (() => void) | null;
}): JSX.Element {
  if (job.state !== 'done' || job.answer === undefined) {
    return (
      <p>
        <span className="rv-agent-attempt">{attemptLabel(job)}</span> <JobNote job={job} />
      </p>
    );
  }
  const where = (range: LineRange): string =>
    `${range.path} ${range.start === range.end ? `line ${String(range.start)}` : `lines ${String(range.start)}–${String(range.end)}`} (${range.side === 'base' ? 'From' : 'To'})`;
  return (
    <>
      {job.answer.insufficient && <p className="rv-agent-insufficient">The agent could not explain this from the code it could read.</p>}
      <ShortThenMore
        short={job.answer.answer}
        details={job.answer.details}
        rests={
          job.answer.references.length === 0 ? undefined : (
            <ul>
              {job.answer.references.map((reference, at) => (
                <li key={at} data-ev="explain-ref">
                  <button
                    type="button"
                    className="rv-pair-link"
                    data-ev="answer-ref"
                    data-ref={`${reference.range.side}:${reference.range.path}:${String(reference.range.start)}-${String(reference.range.end)}`}
                    onClick={() => onShowRange(reference.range)}
                  >
                    {reference.label}
                  </button>{' '}
                  <span className="rv-sub">{where(reference.range)}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
      {onSimpler !== null && (
        <div className="rv-answer-actions">
          <button type="button" className="rv-link rv-quiet-link" data-ev="explain-simpler" title="A new answer that explains this one more simply; this one is kept" onClick={onSimpler}>
            Explain more simply
          </button>
        </div>
      )}
      {job.answer.adjustments.length > 0 && (
        <details className="rv-agent-adjustments">
          <summary>What DSpatch did not accept from the answer</summary>
          <ul>
            {job.answer.adjustments.map((entry, at) => (
              <li key={at}>{entry}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export function ExplainPanel({
  pairKey,
  threads,
  fileKey,
  active,
  open,
  picking,
  busy,
  problem,
  onToggle,
  onActivate,
  onShowSelection,
  onShowRange,
  onFollowUp,
  quote,
  askText,
  onAskText,
  onClearQuote,
  onAsk,
  onPick,
  onCancelPick,
  onStop,
}: {
  readonly pairKey: string;
  readonly threads: readonly ExplanationThread[];
  /** The file shown in the diff: the list offers its explanations. */
  readonly fileKey: string;
  /** The explanation shown, by its first job. */
  readonly active: string | null;
  readonly open: boolean;
  /** No usable agent is chosen for this review: the picker asks, the selection waits. */
  readonly picking: boolean;
  /** An explanation is running for this review: one at a time. */
  readonly busy: boolean;
  readonly problem: string | null;
  readonly onToggle: () => void;
  readonly onActivate: (root: string) => void;
  readonly onShowSelection: (selection: CodeSelection) => void;
  /** A reference of an answer: opened as a place of its own, with the way back. */
  readonly onShowRange: (range: LineRange) => void;
  /** `of`: for Explain more simply, the answer it is about. */
  readonly onFollowUp: (root: string, action: ExplainAction, question: string, of?: string) => void;
  /**
   * Selected code to ask one's own question about (30 October 2026), quoted above the
   * question; removable, and replaced by a new selection. Nothing is sent before *Ask*.
   */
  readonly quote: CodeSelectionRequest | null;
  readonly askText: string;
  readonly onAskText: (text: string) => void;
  readonly onClearQuote: () => void;
  readonly onAsk: () => void;
  readonly onPick: (choice: AgentChoice) => void;
  readonly onCancelPick: () => void;
  readonly onStop: (job: AgentJob) => void;
}): JSX.Element | null {
  const [question, setQuestion] = useState('');
  const askField = useRef<HTMLTextAreaElement | null>(null);
  // A new quote puts the cursor in the question; the code's mark shows what it is about.
  useEffect(() => {
    if (quote !== null && open) {
      askField.current?.focus({ preventScroll: true });
    }
  }, [quote, open]);
  const thread = threads.find((entry) => entry.root.id === active) ?? null;
  const here = threads.filter((entry) => entry.root.selection.fileKey === fileKey);
  if (thread === null && here.length === 0 && !picking && problem === null && quote === null) {
    return null;
  }
  if (!open) {
    return (
      <aside className="rv-explain rv-explain-folded" aria-label="Explanations">
        <button type="button" className="rv-explain-tab" data-ev="explain-open" aria-expanded={false} onClick={onToggle} title="Show the explanations">
          Explanations · {here.length}
        </button>
      </aside>
    );
  }
  const entries = thread === null ? [] : [thread.root, ...thread.followUps];
  const running = entries.find(isRunning);
  const finished = entries.filter((job) => !isRunning(job));
  const quoted = quote === null ? '' : quote.text.replace(/\s+/g, ' ').trim();
  return (
    <aside className="rv-explain" data-ev="explain-panel" aria-label="Explanations">
      <header className="rv-explain-head">
        <span>Explanation</span>
        <button type="button" className="rv-pair-link" data-ev="explain-fold" aria-expanded={true} onClick={onToggle} title="Fold the explanations away">
          Hide
        </button>
      </header>
      {problem !== null && <p className="rv-pair-error" data-ev="explain-problem">{problem}</p>}
      {picking && (
        <div className="rv-explain-pick">
          <p className="rv-pair-muted">No agent is chosen for this review. Choose one; your selection is kept.</p>
          <AgentPicker pairKey={pairKey} action="Explain" busy={busy} testId="explain-agent" onCancel={onCancelPick} onStart={onPick} />
        </div>
      )}
      {thread !== null && (
        <>
          <figure className="rv-explain-quote" data-ev="explain-selection">
            {thread.root.selection.segments.map((segment, index) => (
              <div key={index} className={`rv-explain-part rv-explain-part-${segment.kind}`}>
                <figcaption data-ev="explain-segment">{segmentWords(segment)}</figcaption>
                <pre>{segment.text}</pre>
              </div>
            ))}
            <button type="button" className="rv-pair-link" data-ev="explain-show" onClick={() => onShowSelection(thread.root.selection)}>
              Show in diff
            </button>
          </figure>
          {finished.map((job, index) => (
            <details key={job.id} className="rv-deepening" open={index === finished.length - 1} data-ev="explain-answer" data-state={job.state}>
              <summary>
                {job.followUp === undefined ? (job.asked === undefined ? 'Explanation' : 'Your question') : FOLLOW_UP_WORD[job.followUp.action]}
                {job.followUp?.action === 'question' && <span className="rv-sub"> · “{job.followUp.question.slice(0, 60)}”</span>}
                {job.followUp === undefined && job.asked !== undefined && <span className="rv-sub"> · “{job.asked.slice(0, 60)}”</span>}
                {job.state !== 'done' && <span className="rv-sub"> · {job.state}</span>}
              </summary>
              <Answer
                job={job}
                onShowRange={onShowRange}
                onSimpler={job.state === 'done' && job.answer !== undefined && !busy ? () => onFollowUp(thread.root.id, 'simpler', '', job.id) : null}
              />
            </details>
          ))}
          {running !== undefined && <JobLine job={running} onStop={() => onStop(running)} />}
          {thread.root.state === 'done' && quote === null && (
            <div className="rv-explain-more">
              {/* Show more opens the explanation's own details; Tell me more only where there are none. */}
              {(thread.root.answer?.details ?? '').trim() === '' && (
                <div className="rv-deepen-actions">
                  <button type="button" data-ev="explain-more" disabled={busy} onClick={() => onFollowUp(thread.root.id, 'more', '')}>
                    Tell me more
                  </button>
                </div>
              )}
              <form
                className="rv-explain-ask"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (question.trim() !== '') {
                    onFollowUp(thread.root.id, 'question', question.trim());
                    setQuestion('');
                  }
                }}
              >
                <textarea
                  data-ev="explain-question-text"
                  rows={2}
                  value={question}
                  placeholder="Ask about this code…"
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button type="submit" data-ev="explain-ask" disabled={busy || question.trim() === ''}>
                  Ask
                </button>
              </form>
            </div>
          )}
        </>
      )}
      {quote !== null && (
        <form
          className="rv-explain-ask rv-explain-ask-own"
          data-ev="explain-ask-own"
          onSubmit={(event) => {
            event.preventDefault();
            onAsk();
          }}
        >
          <div className="rv-quote-chip" data-ev="explain-quote" title={quote.text}>
            <span className="rv-quote-chip-text">“{quoted.length > 70 ? `${quoted.slice(0, 69)}…` : quoted}”</span>
            <span className="rv-sub"> · {quote.segments.map((segment) => `${segment.path.split('/').pop() ?? ''} ${segment.start === segment.end ? String(segment.start) : `${String(segment.start)}–${String(segment.end)}`} (${segment.side === 'base' ? 'From' : 'To'})`).join(', ')}</span>
            <button type="button" className="rv-quote-chip-clear" data-ev="explain-quote-remove" aria-label="Remove the quote" title="Remove the quote" onClick={onClearQuote}>
              ×
            </button>
          </div>
          <textarea
            ref={askField}
            data-ev="explain-ask-own-text"
            rows={3}
            value={askText}
            placeholder="Ask about the selected code…"
            onChange={(event) => onAskText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <button type="submit" data-ev="explain-ask-own-send" disabled={busy || askText.trim() === ''}>
            Ask
          </button>
        </form>
      )}
      {here.filter((entry) => entry.root.id !== active).length > 0 && (
        <div className="rv-explain-list">
          <span className="rv-sub">{thread === null ? 'Explanations in this file' : 'Other explanations in this file'}</span>
          <ul>
            {here
              .filter((entry) => entry.root.id !== active)
              .map((entry) => (
                <li key={entry.root.id}>
                  <button type="button" className="rv-pair-link" data-ev="explain-reopen" onClick={() => onActivate(entry.root.id)}>
                    {selectionTitle(entry.root.selection)}
                  </button>
                  {entry.followUps.length > 0 && <span className="rv-sub"> · {entry.followUps.length + 1} answers</span>}
                </li>
              ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
