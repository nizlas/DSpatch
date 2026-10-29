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

import { useState } from 'react';
import type { JSX } from 'react';

import { segmentWords, type AgentJob, type CodeSelection, type ExplainAction, type LineRange } from '../shared/review-pair';
import { AgentPicker, type AgentChoice } from './AgentPicker';
import { Markdown } from './Markdown';
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

function Answer({ job, canShow, onShowRange }: { readonly job: AgentJob; readonly canShow: (range: LineRange) => boolean; readonly onShowRange: (range: LineRange) => void }): JSX.Element {
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
      <Markdown text={job.answer.answer} />
      {job.answer.references.length > 0 && (
        <div className="rv-answer-refs">
          <span className="rv-sub">The code it rests on:</span>
          <ul>
            {job.answer.references.map((reference, at) => (
              <li key={at} data-ev="explain-ref">
                {canShow(reference.range) ? (
                  <button type="button" className="rv-pair-link" onClick={() => onShowRange(reference.range)}>
                    {reference.label}
                  </button>
                ) : (
                  <span>{reference.label}</span>
                )}{' '}
                <span className="rv-sub">{where(reference.range)}</span>
              </li>
            ))}
          </ul>
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
  canShow,
  onToggle,
  onActivate,
  onShowSelection,
  onShowRange,
  onFollowUp,
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
  readonly canShow: (range: LineRange) => boolean;
  readonly onToggle: () => void;
  readonly onActivate: (root: string) => void;
  readonly onShowSelection: (selection: CodeSelection) => void;
  readonly onShowRange: (range: LineRange) => void;
  readonly onFollowUp: (root: string, action: ExplainAction, question: string) => void;
  readonly onPick: (choice: AgentChoice) => void;
  readonly onCancelPick: () => void;
  readonly onStop: (job: AgentJob) => void;
}): JSX.Element | null {
  const [question, setQuestion] = useState('');
  const thread = threads.find((entry) => entry.root.id === active) ?? null;
  const here = threads.filter((entry) => entry.root.selection.fileKey === fileKey);
  if (thread === null && here.length === 0 && !picking && problem === null) {
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
                {job.followUp === undefined ? 'Explanation' : FOLLOW_UP_WORD[job.followUp.action]}
                {job.followUp?.action === 'question' && <span className="rv-sub"> · “{job.followUp.question.slice(0, 60)}”</span>}
                {job.state !== 'done' && <span className="rv-sub"> · {job.state}</span>}
              </summary>
              <Answer job={job} canShow={canShow} onShowRange={onShowRange} />
            </details>
          ))}
          {running !== undefined && <JobLine job={running} onStop={() => onStop(running)} />}
          {thread.root.state === 'done' && (
            <div className="rv-explain-more">
              <div className="rv-deepen-actions">
                <button type="button" data-ev="explain-more" disabled={busy} onClick={() => onFollowUp(thread.root.id, 'more', '')}>
                  Tell me more
                </button>
                <button type="button" data-ev="explain-simpler" disabled={busy} onClick={() => onFollowUp(thread.root.id, 'simpler', '')}>
                  Explain more simply
                </button>
              </div>
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
