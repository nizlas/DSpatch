import { useState } from 'react';
import type { JSX, ReactNode } from 'react';

import { splitCodeAnswer, splitDetails, type DiscussionMessage } from '../shared/review-discussion';
import type { CodeLocation } from '../shared/review-model';
import { Markdown } from './Markdown';

/**
 * An answer in the review discussion (Niclas's decision of 30 October 2026). When the agent
 * could read the revisions, the references block at the end of its text is not shown as
 * text: once DSpatch has checked each reference against its commit, the references are
 * links to the code, at their own revision. Nothing is a link that was not checked, and
 * what DSpatch left out is said, folded.
 */
/**
 * An answer's short part, then two quiet toggles, each on its own (Niclas's decisions of 30
 * October 2026): *Show more* opens the details written with it, and *The code it rests on*
 * opens the checked references. Both start closed, appear only when there is something to
 * open, ask nothing again, and keep their state while the answer streams and when the panel
 * moves to its own window. An answer written before it had details is shown whole.
 */
export function ShortThenMore({
  short,
  details,
  rests,
}: {
  readonly short: string;
  readonly details: string | null | undefined;
  /** The references as links, when there are any. Kept in the page while closed. */
  readonly rests?: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [restsOpen, setRestsOpen] = useState(false);
  const more = details ?? '';
  const hasRests = rests !== undefined && rests !== null && rests !== false;
  return (
    <>
      <Markdown text={short} />
      {open && more.trim() !== '' && (
        <div className="rv-answer-details" data-ev="answer-details">
          <Markdown text={more} />
        </div>
      )}
      {(more.trim() !== '' || hasRests) && (
        <div className="rv-answer-toggles">
          {more.trim() !== '' && (
            <button type="button" className="rv-link rv-show-more" data-ev="answer-show-more" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
          {hasRests && (
            <button type="button" className="rv-link rv-show-more" data-ev="answer-show-code" aria-expanded={restsOpen} onClick={() => setRestsOpen(!restsOpen)}>
              The code it rests on
            </button>
          )}
        </div>
      )}
      {hasRests && (
        <div className="rv-answer-refs" data-ev="answer-refs" hidden={!restsOpen}>
          {rests}
        </div>
      )}
    </>
  );
}

export function DiscussionAnswer({
  answer,
  onShow,
  onSimpler,
}: {
  readonly answer: DiscussionMessage;
  readonly onShow: (location: CodeLocation) => void;
  /** Explain this answer more simply: a new answer, the original kept (30 October 2026). */
  readonly onSimpler?: () => void;
}): JSX.Element {
  const parts = splitDetails(splitCodeAnswer(answer.text).shown);
  const shown = parts.short;
  const references = answer.references ?? [];
  const where = (start: number, end: number): string => (start === end ? `line ${String(start)}` : `lines ${String(start)}–${String(end)}`);
  return (
    <div className="rv-answer" data-ev="discussion-answer-body" data-quote-source="answer">
      {answer.insufficient === true && <p className="rv-agent-insufficient">The agent could not settle this from the code it could read.</p>}
      {shown === '' ? (
        <span className="rv-sub">…</span>
      ) : (
        <ShortThenMore
          short={shown}
          details={parts.details}
          rests={
            references.length === 0 ? undefined : (
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
            )
          }
        />
      )}
      {onSimpler !== undefined && answer.status === 'done' && shown !== '' && (
        <div className="rv-answer-actions">
          <button type="button" className="rv-link rv-quiet-link" data-ev="answer-simpler" title="A new answer that explains this one more simply; this one is kept" onClick={onSimpler}>
            Explain more simply
          </button>
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
