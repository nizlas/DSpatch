import { useState } from 'react';
import { createContext, useContext } from 'react';
import type { JSX, ReactNode } from 'react';

import { splitCodeAnswer, splitDetails, type CheckedContextReference, type DiscussionMessage } from '../shared/review-discussion';
import type { ContextFileView } from '../shared/review-pair';
import type { CodeLocation, Lang } from '../shared/review-model';
import { resolveLineReference, resolveStepReference, type ReferenceScope, type ReferenceTarget } from '../shared/reference-links';
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
 * moves to its own window. An answer written before it had details is shown whole. Whatever
 * else can be done with the answer (`actions`) sits in the same row, so an answer has one
 * quiet row of actions under it, with room above it (DSP-171).
 */
export function ShortThenMore({
  short,
  base,
  details,
  rests,
  actions,
}: {
  readonly short: string;
  /**
   * More of the base text, read with the short part before the Show more control (DSP-195): a
   * prepared step's "Why it matters". Rendered after the control, it stood on both sides of it.
   */
  readonly base?: ReactNode;
  readonly details: string | null | undefined;
  /** The references as links, when there are any. Kept in the page while closed. */
  readonly rests?: ReactNode;
  /** Further actions on the answer, in the same row as the toggles. */
  readonly actions?: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [restsOpen, setRestsOpen] = useState(false);
  const more = details ?? '';
  const hasRests = rests !== undefined && rests !== null && rests !== false;
  const hasActions = actions !== undefined && actions !== null && actions !== false;
  return (
    <>
      <Markdown text={short} />
      {base}
      {open && more.trim() !== '' && (
        <div className="rv-answer-details" data-ev="answer-details">
          <Markdown text={more} />
        </div>
      )}
      {(more.trim() !== '' || hasRests || hasActions) && (
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
          {hasActions && actions}
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

/**
 * What the agent is doing now, in one quiet line under what it answers (30 October 2026):
 * from what the provider reports, never a guessed stage, an estimate or a count. It is
 * replaced in place rather than added to, and gone when the answer ends.
 */
export function ActivityLine({ text, testId }: { readonly text: string; readonly testId: string }): JSX.Element {
  return (
    <div className="rv-activity-line" role="status" data-ev={testId}>
      <span className="rv-agent-spinner" aria-hidden="true" />
      <span className="rv-agent-activity">{text}</span>
    </div>
  );
}

/** The question being answered now, and what the agent is doing for it, for every view of it. */
export const DiscussionActivity = createContext<{ readonly questionId: string; readonly text: string } | null>(null);

/** Under a question shown outside the thread: what is happening while its answer is on its way. */
export function PendingLine({ questionId, pending }: { readonly questionId: string; readonly pending: boolean }): JSX.Element | null {
  const activity = useContext(DiscussionActivity);
  if (activity !== null && activity.questionId === questionId) {
    return <ActivityLine text={activity.text} testId="deepening-activity" />;
  }
  return pending ? <p className="rv-sub">…</p> : null;
}

/**
 * DSP-185: the walk an answer's references are resolved against, and how to go to a step. Given
 * by the walk window and its panel; absent where no walk is open, where a code reference opens
 * the code as before and a step reference is shown as not found.
 */
export interface ReferenceLinks {
  readonly scope: ReferenceScope;
  readonly lang: Lang;
  readonly goToStep: (stepId: string, placeIndex: number) => void;
}

export const ReferenceLinksContext = createContext<ReferenceLinks | null>(null);

/** One reference as a link to where it leads, or as text when it leads nowhere (DSP-185). */
function ReferenceItem({
  label,
  target,
  dataRef,
  onShow,
}: {
  readonly label: string;
  readonly target: ReferenceTarget;
  readonly dataRef?: string;
  readonly onShow: (location: CodeLocation) => void;
}): JSX.Element {
  const links = useContext(ReferenceLinksContext);
  const where = (start: number, end: number): string => (start === end ? `line ${String(start)}` : `lines ${String(start)}–${String(end)}`);
  if (target.kind === 'step') {
    const title = links === null ? '' : target.stepTitle[links.lang] || target.stepTitle.en || target.stepTitle.sv;
    return (
      <li>
        <button
          type="button"
          className="rv-pair-link"
          data-ev="answer-step-ref"
          data-step={target.stepId}
          data-place={String(target.placeIndex)}
          {...(dataRef === undefined ? {} : { 'data-ref': dataRef })}
          title="Go to this step of the walk and its explanation"
          onClick={() => links?.goToStep(target.stepId, target.placeIndex)}
        >
          {target.here ? `This step, ${target.stepId}` : `Step ${target.stepId}`}
          {title === '' ? '' : `: ${title}`}
        </button>{' '}
        <span className="rv-sub">{label}</span>
      </li>
    );
  }
  if (target.kind === 'unresolved') {
    return (
      <li data-ev="answer-ref-unresolved">
        <span>{label}</span> <span className="rv-sub">· {target.reason}</span>
      </li>
    );
  }
  const location = target.location;
  return (
    <li>
      <button
        type="button"
        className="rv-pair-link"
        data-ev="answer-ref"
        data-ref={dataRef ?? `${location.side}:${location.path}:${String(location.start)}-${String(location.end)}`}
        data-kind={target.kind}
        title={target.kind === 'diff' ? 'Open these lines in the diff, marked' : 'Open these lines of the unchanged file, marked'}
        onClick={() => onShow(location)}
      >
        {label}
      </button>{' '}
      <span className="rv-sub">
        {location.path} {where(location.start, location.end)} ({location.side === 'base' ? 'From' : 'To'})
        {target.kind === 'unchanged' ? ' · not in this diff: unchanged code at this revision' : ''}
      </span>
    </li>
  );
}

/** The revision pair the window is over, for opening context citations (DSP-175). */
export const PairKeyContext = createContext<string | null>(null);

/**
 * A place in another repository of the workspace an answer rests on (DSP-175): opened in place
 * from the review, read at the commit recorded for it, never the working copy. It says how
 * that commit was chosen and whether it is established as what the reviewed build uses.
 * Context is never reviewed or approved.
 */
function ContextCitation({ reference }: { readonly reference: CheckedContextReference }): JSX.Element {
  const pairKey = useContext(PairKeyContext);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ContextFileView | { readonly error: string } | null>(null);
  const range = reference.range;
  const where = range.start === range.end ? `line ${String(range.start)}` : `lines ${String(range.start)}–${String(range.end)}`;
  const toggle = (): void => {
    setOpen(!open);
    if (!open && view === null) {
      const bridge = window.dspatchReviewPair;
      if (bridge === undefined || pairKey === null) {
        setView({ error: 'This window cannot open places in other repositories.' });
        return;
      }
      void bridge
        .readContextFile(pairKey, range.repository, range.path, range.commit)
        .then((answer) => setView(answer))
        .catch((error: unknown) => setView({ error: error instanceof Error ? error.message : String(error) }));
    }
  };
  const lines = view !== null && !('error' in view) && view.text !== null ? view.text.split('\n') : [];
  const from = Math.max(1, range.start - 4);
  const to = Math.min(lines.length, range.end + 4);
  return (
    <li>
      <button type="button" className="rv-pair-link" data-ev="answer-context-ref" aria-expanded={open} onClick={toggle}>
        {reference.label}
      </button>{' '}
      <span className="rv-sub">
        {range.repository}/{range.path} {where} @ {range.commit.slice(0, 10)} · another repository, read as context, not under review
      </span>
      {open && view !== null && (
        <div className="rv-context-view" data-ev="answer-context-view">
          {'error' in view ? (
            <p className="rv-error">{view.error}</p>
          ) : (
            <>
              <p className="rv-sub">
                {view.note} {view.established ? '' : 'Which version the reviewed build uses is not established; this is what the workspace has at that commit.'}
              </p>
              {view.text === null ? (
                <p className="rv-sub">A binary file.</p>
              ) : (
                <pre className="rv-context-code">
                  {lines.slice(from - 1, to).map((text, index) => {
                    const number = from + index;
                    const marked = number >= range.start && number <= range.end;
                    return (
                      <span key={number} className={marked ? 'rv-context-line rv-context-line-marked' : 'rv-context-line'}>
                        <span className="rv-context-number">{number}</span> {text}
                        {'\n'}
                      </span>
                    );
                  })}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </li>
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
  const contextReferences = answer.contextReferences ?? [];
  const stepReferences = answer.stepReferences ?? [];
  const links = useContext(ReferenceLinksContext);
  // DSP-185: where each reference leads. Without a walk, code opens as before and a step id finds nothing.
  const noWalk: ReferenceLinks['scope'] = { walks: [], changedPaths: new Set(), currentStepId: null };
  const lineTarget = (range: { readonly path: string; readonly side: 'base' | 'target'; readonly start: number; readonly end: number }): ReferenceTarget =>
    links === null ? { kind: 'diff', location: { path: range.path, side: range.side, start: range.start, end: range.end } } : resolveLineReference(range, links.scope);
  return (
    <div className="rv-answer rv-reading" data-ev="discussion-answer-body" data-quote-source="answer">
      {answer.insufficient === true && <p className="rv-agent-insufficient">The agent could not settle this from the code it could read.</p>}
      {shown === '' ? (
        // While it is on its way, the activity line beside it says what is happening.
        answer.status === 'streaming' ? null : <span className="rv-sub">…</span>
      ) : (
        <ShortThenMore
          short={shown}
          details={parts.details}
          actions={
            onSimpler !== undefined && answer.status === 'done' ? (
              <button type="button" className="rv-link rv-show-more rv-quiet-link" data-ev="answer-simpler" title="A new answer that explains this one more simply; this one is kept" onClick={onSimpler}>
                Explain more simply
              </button>
            ) : undefined
          }
          rests={
            references.length === 0 && contextReferences.length === 0 && stepReferences.length === 0 ? undefined : (
              <ul>
                {stepReferences.map((reference, index) => (
                  <ReferenceItem key={`step-${String(index)}`} label={reference.label} target={resolveStepReference(reference.step, links?.scope ?? noWalk)} onShow={onShow} />
                ))}
                {contextReferences.map((reference, index) => (
                  <ContextCitation key={`context-${String(index)}`} reference={reference} />
                ))}
                {references.map((reference, index) => (
                  <ReferenceItem
                    key={index}
                    label={reference.label}
                    target={lineTarget(reference.range)}
                    dataRef={`${reference.range.side}:${reference.range.path}:${String(reference.range.start)}-${String(reference.range.end)}`}
                    onShow={onShow}
                  />
                ))}
              </ul>
            )
          }
        />
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
