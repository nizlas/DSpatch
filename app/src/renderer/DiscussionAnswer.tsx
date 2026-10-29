import type { JSX } from 'react';

import { splitCodeAnswer, type DiscussionMessage } from '../shared/review-discussion';
import type { CodeLocation } from '../shared/review-model';
import { Markdown } from './Markdown';

/**
 * An answer in the review discussion (Niclas's decision of 30 October 2026). When the agent
 * could read the revisions, the references block at the end of its text is not shown as
 * text: once DSpatch has checked each reference against its commit, the references are
 * links to the code, at their own revision. Nothing is a link that was not checked, and
 * what DSpatch left out is said, folded.
 */
export function DiscussionAnswer({
  answer,
  onShow,
}: {
  readonly answer: DiscussionMessage;
  readonly onShow: (location: CodeLocation) => void;
}): JSX.Element {
  const shown = splitCodeAnswer(answer.text).shown;
  const references = answer.references ?? [];
  const where = (start: number, end: number): string => (start === end ? `line ${String(start)}` : `lines ${String(start)}–${String(end)}`);
  return (
    <div className="rv-answer" data-ev="discussion-answer-body">
      {shown === '' ? <span className="rv-sub">…</span> : <Markdown text={shown} />}
      {answer.insufficient === true && <p className="rv-agent-insufficient">The agent could not settle this from the code it could read.</p>}
      {references.length > 0 && (
        <div className="rv-answer-refs" data-ev="answer-refs">
          <span className="rv-sub">The code it rests on:</span>
          <ul>
            {references.map((reference, index) => (
              <li key={index}>
                <button
                  type="button"
                  className="rv-pair-link"
                  data-ev="answer-ref"
                  data-ref={`${reference.range.side}:${reference.range.path}:${String(reference.range.start)}-${String(reference.range.end)}`}
                  onClick={() =>
                    onShow({ path: reference.range.path, side: reference.range.side, start: reference.range.start, end: reference.range.end })
                  }
                >
                  {reference.label}
                </button>{' '}
                <span className="rv-sub">
                  {reference.range.path} {where(reference.range.start, reference.range.end)} ({reference.range.side === 'base' ? 'From' : 'To'})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(answer.adjustments ?? []).length > 0 && (
        <details className="rv-agent-adjustments">
          <summary>What DSpatch did not accept from the answer</summary>
          <ul>
            {(answer.adjustments ?? []).map((entry, index) => (
              <li key={index}>{entry}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
