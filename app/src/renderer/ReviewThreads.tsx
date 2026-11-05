/**
 * Review threads in the windows of a review (DSP-175): one card per thread, the same in
 * the diff, beside a walk and in the review's panel, because every window reads the same
 * pair record. A card folds to one line with its status, title and number of replies.
 *
 * Accepting a recommendation, keeping a thread open, resolving, dismissing and reopening
 * are records of the person's decision: the host keeps them and nothing runs. A question in
 * a thread goes to the review's agent with the thread as its subject, and its answer stays
 * in the thread.
 */

import { createContext, useContext, useEffect, useRef, useState, type JSX } from 'react';

import type { CodeLocation } from '../shared/review-model';
import type { DiscussionMessage, SelectionQuote } from '../shared/review-discussion';
import type { LineRange, ThreadEventKind } from '../shared/review-pair';
import { KIND_WORDS, RECOMMENDATION_WORDS, STATUS_WORDS, type ReviewThread, type ThreadStatus } from '../shared/review-threads';
import { DiscussionAnswer } from './DiscussionAnswer';

/** One question asked in a thread and its answer, from the review's discussion. */
export interface ThreadExchange {
  readonly question: DiscussionMessage;
  readonly answer: DiscussionMessage | null;
}

/** What a window lets its thread cards do. */
export interface ThreadActions {
  /** The thread chosen in this window, shown at its code. */
  readonly selectedId: string | null;
  /** Choose a thread: open its code, scroll to it and mark it. */
  readonly select: (thread: ReviewThread) => void;
  /** Open a checked place of the thread. */
  readonly show: (range: LineRange) => void;
  /** Record a comment or decision; resolves to an error sentence, or `null`. */
  readonly act: (thread: ReviewThread, kind: ThreadEventKind, text: string) => Promise<string | null>;
  /**
   * Ask the review's agent in this thread, with the selection quoted when there is one: the
   * question and its answer stay in the thread. Resolves to an error sentence, or `null`.
   */
  readonly ask: (thread: ReviewThread, question: string, quote: SelectionQuote | null) => Promise<string | null>;
  /** The questions asked in a thread and their answers. */
  readonly exchanges: (threadId: string) => readonly ThreadExchange[];
  /** Open a reference from an answer. */
  readonly openLocation: (location: CodeLocation) => void;
}

export const ThreadContext = createContext<ThreadActions | null>(null);

/** Unsent comments, kept per thread while the window lives: folding or moving keeps them. */
const drafts = new Map<string, string>();
/** Folded or not, per thread, as the person left it in this window. */
const folded = new Map<string, boolean>();
/** Selected text of a thread to ask about, per thread, until it is sent or removed. */
const quotes = new Map<string, SelectionQuote>();

/** The selection inside a thread's own text, as a quote; `null` when there is none. */
function selectedIn(body: HTMLElement): SelectionQuote | null {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!body.contains(range.commonAncestorContainer)) {
    return null;
  }
  const text = selection.toString().trim();
  return text === '' ? null : { kind: 'text', text: text.slice(0, 20_000), source: 'thread', context: (body.innerText || '').slice(0, 1_500) };
}

const STATUS_MARK: Record<ThreadStatus, string> = { open: '●', 'action-agreed': '◐', resolved: '✓', dismissed: '⊘' };

function sideWord(side: LineRange['side']): string {
  return side === 'base' ? 'From' : 'To';
}

export function anchorWords(range: LineRange): string {
  const lines = range.start === range.end ? `line ${String(range.start)}` : `lines ${String(range.start)}–${String(range.end)}`;
  return `${range.path} ${lines} (${sideWord(range.side)})`;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const EVENT_WORDS: Record<ThreadEventKind, string> = {
  comment: 'Comment',
  accept: 'Accepted the recommendation',
  'keep-open': 'Kept open',
  resolve: 'Marked resolved',
  dismiss: 'Dismissed',
  reopen: 'Reopened',
};

export function replyCountOf(thread: ReviewThread, exchanges: readonly ThreadExchange[]): number {
  return thread.events.filter((event) => event.text.trim() !== '').length + exchanges.length;
}

/** The line a folded thread reads as, and the head of an open one. */
function ThreadHead({ thread, replies, open, onToggle }: { readonly thread: ReviewThread; readonly replies: number; readonly open: boolean; readonly onToggle: () => void }): JSX.Element {
  return (
    <button type="button" className="rv-thread-head" aria-expanded={open} data-ev="thread-toggle" onClick={onToggle}>
      <span className={`rv-thread-status rv-thread-status-${thread.status}`} data-ev="thread-status">
        <span aria-hidden="true">{STATUS_MARK[thread.status]}</span> {STATUS_WORDS[thread.status]}
      </span>
      <span className="rv-thread-kind">{KIND_WORDS[thread.kind]}</span>
      <span className="rv-thread-title" data-ev="thread-title">
        {thread.title}
      </span>
      <span className="rv-thread-replies" data-ev="thread-replies">
        {replies === 0 ? 'no replies' : `${String(replies)} ${replies === 1 ? 'reply' : 'replies'}`}
      </span>
    </button>
  );
}

export function ThreadCard({ thread, inline = false }: { readonly thread: ReviewThread; readonly inline?: boolean }): JSX.Element | null {
  const actions = useContext(ThreadContext);
  const closed = thread.status === 'resolved' || thread.status === 'dismissed';
  const [open, setOpen] = useState(() => folded.get(thread.id) === undefined ? !closed : !folded.get(thread.id));
  const [draft, setDraftState] = useState(() => drafts.get(thread.id) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [quote, setQuoteState] = useState<SelectionQuote | null>(() => quotes.get(thread.id) ?? null);
  const [offer, setOffer] = useState<SelectionQuote | null>(null);
  const card = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const historyEnd = useRef<HTMLLIElement | null>(null);
  const setQuote = (next: SelectionQuote | null): void => {
    if (next === null) {
      quotes.delete(thread.id);
    } else {
      quotes.set(thread.id, next);
    }
    setQuoteState(next);
  };
  const selected = actions?.selectedId === thread.id;
  useEffect(() => {
    // A chosen thread opens and comes into view in its own scroller, never the window.
    if (selected) {
      setOpen(true);
      folded.set(thread.id, false);
      card.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [selected, thread.id]);
  if (actions === null) {
    return null;
  }
  const exchanges = actions.exchanges(thread.id);
  const ask = async (): Promise<void> => {
    const question = draft.trim();
    if (busy || question === '') {
      return;
    }
    setBusy(true);
    setError(null);
    const problem = await actions.ask(thread, question, quote);
    setBusy(false);
    if (problem !== null) {
      // Nothing was sent: the question and the quote stay as they were.
      setError(problem);
      return;
    }
    setDraft('');
    setQuote(null);
    // The new question and its answer come into view in the thread, in its own scroller.
    requestAnimationFrame(() => historyEnd.current?.scrollIntoView({ block: 'nearest' }));
  };
  const setDraft = (text: string): void => {
    drafts.set(thread.id, text);
    setDraftState(text);
  };
  const toggle = (): void => {
    folded.set(thread.id, open);
    setOpen(!open);
  };
  const act = async (kind: ThreadEventKind, text: string): Promise<void> => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    const problem = await actions.act(thread, kind, text);
    setBusy(false);
    if (problem !== null) {
      setError(problem);
      return;
    }
    setDismissing(false);
    if (text !== '') {
      setDraft('');
    }
  };
  const recommendation = thread.recommendation;
  const remaining = thread.status === 'open' || thread.status === 'action-agreed';
  return (
    <article
      ref={card}
      className={`rv-thread rv-thread-${thread.status}${selected ? ' rv-thread-selected' : ''}${inline ? ' rv-thread-inline' : ''}`}
      data-ev="review-thread"
      data-thread-id={thread.id}
      data-thread-status={thread.status}
      data-thread-kind={thread.kind}
    >
      <ThreadHead thread={thread} replies={replyCountOf(thread, exchanges)} open={open} onToggle={toggle} />
      {open && (
        <div
          ref={body}
          className="rv-thread-body"
          data-quote-source="thread"
          data-quote-thread={thread.id}
          onMouseUp={() => setTimeout(() => setOffer(body.current === null ? null : selectedIn(body.current)), 0)}
        >
          <p className="rv-thread-origin rv-sub">
            {thread.origin.reviewer} · delegated review of {thread.origin.scope || 'the change'}
            {thread.origin.at === '' ? '' : ` · ${when(thread.origin.at)}`}
          </p>
          {thread.anchors.length > 0 && (
            <p className="rv-thread-places">
              {thread.anchors.map((anchor, index) => (
                <button key={index} type="button" className="rv-pair-link" data-ev="thread-place" onClick={() => (index === 0 ? actions.select(thread) : actions.show(anchor))}>
                  {anchorWords(anchor)}
                </button>
              ))}
            </p>
          )}
          {thread.missing.map((entry, index) => (
            <p key={index} className="rv-thread-missing" data-ev="thread-missing">
              The agent named {anchorWords(entry.range)}, which was not found at that commit ({entry.reason}). Nothing is marked in the code for it.
            </p>
          ))}
          {thread.level === 'review' && thread.anchors.length === 0 && thread.missing.length === 0 && <p className="rv-sub">Not tied to a place in the code: it is about the review as a whole.</p>}
          {thread.level === 'file' && thread.anchors.length === 0 && thread.missing.length === 0 && thread.file !== null && (
            <p className="rv-sub">About {thread.file.path} as a whole; no line was named.</p>
          )}
          {thread.explanation !== '' && (
            <div className="rv-thread-section">
              <h5>Observed</h5>
              <p>{thread.explanation}</p>
            </div>
          )}
          {thread.evidence !== '' && (
            <div className="rv-thread-section">
              <h5>Rests on</h5>
              <p>{thread.evidence}</p>
            </div>
          )}
          {thread.details !== '' && (
            <details className="rv-thread-details">
              <summary>Reasoning</summary>
              <p>{thread.details}</p>
            </details>
          )}
          {recommendation === null ? (
            <div className="rv-thread-section rv-thread-norec" data-ev="thread-no-recommendation">
              <h5>Recommendation</h5>
              <p>None was recorded: this review was made before the agent was asked for recommendations, or the agent gave none. None is made up.</p>
              <button
                type="button"
                className="rv-pair-link"
                data-ev="thread-ask-recommendation"
                onClick={() => {
                  // The question is written into the field; the person sends it.
                  setDraft('What do you recommend doing about this, and why? If more needs to be established first, what is the next concrete step?');
                  field.current?.focus();
                }}
              >
                Ask the agent for a recommendation…
              </button>
            </div>
          ) : (
            <div className="rv-thread-section rv-thread-rec" data-ev="thread-recommendation">
              <h5>Recommendation · {RECOMMENDATION_WORDS[recommendation.kind]}</h5>
              <p>{recommendation.action}</p>
              {recommendation.rationale !== '' && <p className="rv-sub">Why: {recommendation.rationale}</p>}
              {recommendation.uncertainty !== '' && <p className="rv-sub">Uncertain: {recommendation.uncertainty}</p>}
              {recommendation.nextStep !== '' && <p className="rv-sub">Next step: {recommendation.nextStep}</p>}
            </div>
          )}
          {thread.gaps.length > 0 && (
            <div className="rv-thread-section" data-ev="thread-gaps">
              <h5>Verification gaps</h5>
              <ul>
                {thread.gaps.map((gap, index) => (
                  <li key={index}>
                    {gap.text}
                    {gap.recommendation !== null && <span className="rv-sub"> — {RECOMMENDATION_WORDS[gap.recommendation.kind]}: {gap.recommendation.action}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(thread.events.length > 0 || exchanges.length > 0) && (
            <ol className="rv-thread-history" data-ev="thread-history">
              {thread.events.map((event) => (
                <li key={event.id} className={`rv-thread-event rv-thread-event-${event.kind}`}>
                  <span className="rv-sub">
                    {EVENT_WORDS[event.kind]} · {when(event.at)}
                  </span>
                  {event.text !== '' && <p>{event.text}</p>}
                </li>
              ))}
              {exchanges.map((exchange) => (
                <li key={exchange.question.id} className="rv-thread-exchange" data-ev="thread-exchange">
                  <p className="rv-thread-asked">
                    <span className="rv-sub">Asked · {when(exchange.question.at)}</span> {exchange.question.text}
                  </p>
                  {exchange.answer === null ? <p className="rv-sub">…</p> : <DiscussionAnswer answer={exchange.answer} onShow={actions.openLocation} />}
                </li>
              ))}
              <li ref={historyEnd} className="rv-thread-end" aria-hidden="true" />
            </ol>
          )}
          <div className="rv-thread-reply">
            {offer !== null && quote?.text !== offer.text && (
              <button
                type="button"
                className="rv-pair-link"
                data-ev="thread-ask-selection"
                // Pressing keeps the selection; the quote goes above the field, which takes the focus.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuote(offer);
                  setOffer(null);
                  field.current?.focus();
                }}
              >
                Ask about the selected text…
              </button>
            )}
            {quote !== null && (
              <p className="rv-thread-quote" data-ev="thread-quote">
                <span className="rv-sub">Asking about:</span> “{quote.text.replace(/\s+/g, ' ').slice(0, 160)}
                {quote.text.length > 160 ? '…' : ''}”{' '}
                <button type="button" className="rv-link" data-ev="thread-quote-clear" aria-label="Remove the quote" onClick={() => setQuote(null)}>
                  ×
                </button>
              </p>
            )}
            <textarea
              ref={field}
              className="rv-thread-field"
              data-ev="thread-comment-field"
              rows={2}
              value={draft}
              placeholder={dismissing ? 'Why is it dismissed? (required)' : 'A comment kept with the thread, or a question to the agent'}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Ctrl+Enter asks the agent; a plain Enter is a new line, so nothing is sent by accident.
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void ask();
                }
              }}
            />
            {error !== null && (
              <p className="rv-thread-error" role="alert">
                {error}
              </p>
            )}
            <div className="rv-thread-actions">
              {thread.status === 'open' && recommendation !== null && (
                <button type="button" className="rv-pair-button rv-thread-primary" data-ev="thread-accept" disabled={busy} title="Records that you agree. It starts no change, command or other action." onClick={() => void act('accept', draft.trim())}>
                  Accept recommendation
                </button>
              )}
              {remaining && (
                <button type="button" className="rv-pair-button" data-ev="thread-keep-open" disabled={busy} onClick={() => void act('keep-open', draft.trim())}>
                  Keep open
                </button>
              )}
              <button type="button" className="rv-pair-button" data-ev="thread-comment" disabled={busy || draft.trim() === ''} onClick={() => void act('comment', draft.trim())}>
                Comment
              </button>
              <button type="button" className="rv-pair-button" data-ev="thread-ask" disabled={busy || draft.trim() === ''} title="Send the text as a question to the review's agent; the answer stays in this thread (Ctrl+Enter)" onClick={() => void ask()}>
                Ask the agent
              </button>
              {remaining && (
                <button type="button" className="rv-pair-link" data-ev="thread-resolve" disabled={busy} onClick={() => void act('resolve', draft.trim())}>
                  Mark resolved
                </button>
              )}
              {remaining &&
                (dismissing ? (
                  <button type="button" className="rv-pair-link" data-ev="thread-dismiss-confirm" disabled={busy || draft.trim() === ''} onClick={() => void act('dismiss', draft.trim())}>
                    Dismiss with this comment
                  </button>
                ) : (
                  <button type="button" className="rv-pair-link" data-ev="thread-dismiss" onClick={() => setDismissing(true)}>
                    Dismiss…
                  </button>
                ))}
              {!remaining && (
                <button type="button" className="rv-pair-button" data-ev="thread-reopen" disabled={busy} onClick={() => void act('reopen', draft.trim())}>
                  Reopen
                </button>
              )}
            </div>
            {thread.status === 'action-agreed' && <p className="rv-sub">Action agreed: it stays among what remains until it is done and marked resolved.</p>}
          </div>
        </div>
      )}
    </article>
  );
}

/** Threads in a list, closed ones dimmed and optionally hidden. */
export function ThreadList({ threads, label }: { readonly threads: readonly ReviewThread[]; readonly label: string }): JSX.Element | null {
  const [showClosed, setShowClosed] = useState(false);
  if (threads.length === 0) {
    return null;
  }
  const closed = threads.filter((thread) => thread.status === 'resolved' || thread.status === 'dismissed');
  const shown = showClosed ? threads : threads.filter((thread) => !closed.includes(thread));
  return (
    <section className="rv-thread-list" data-ev="thread-list" aria-label={label}>
      {shown.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} />
      ))}
      {closed.length > 0 && (
        <button type="button" className="rv-pair-link rv-thread-closed-toggle" data-ev="thread-show-closed" onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? 'Hide closed threads' : `Show ${String(closed.length)} closed ${closed.length === 1 ? 'thread' : 'threads'}`}
        </button>
      )}
    </section>
  );
}

/** The questions and answers of each thread, from the discussion's messages. */
export function exchangesByThread(messages: readonly DiscussionMessage[]): ReadonlyMap<string, ThreadExchange[]> {
  const out = new Map<string, ThreadExchange[]>();
  const answers = new Map<string, DiscussionMessage>();
  for (const message of messages) {
    if (message.role === 'answer' && message.questionId !== undefined) {
      answers.set(message.questionId, message);
    }
  }
  for (const message of messages) {
    const subject = message.envelope?.subject;
    if (message.role !== 'question' || subject?.kind !== 'thread') {
      continue;
    }
    const list = out.get(subject.threadId) ?? [];
    list.push({ question: message, answer: answers.get(message.id) ?? null });
    out.set(subject.threadId, list);
  }
  return out;
}

/**
 * The review discussion's messages as this window sees them, kept current from its events,
 * for the questions asked in threads. Loading reads the stored record; it sends nothing.
 */
export function useDiscussionMessages(): readonly DiscussionMessage[] {
  const [messages, setMessages] = useState<readonly DiscussionMessage[]>([]);
  useEffect(() => {
    const bridge = window.dspatchReviewDiscussion;
    if (bridge === undefined) {
      return undefined;
    }
    let alive = true;
    const off = bridge.onEvent((event) => {
      if (event.kind === 'message') {
        setMessages((current) => {
          const at = current.findIndex((entry) => entry.id === event.message.id);
          return at < 0 ? [...current, event.message] : current.map((entry, index) => (index === at ? event.message : entry));
        });
      } else if (event.kind === 'delta') {
        setMessages((current) => current.map((entry) => (entry.id === event.messageId ? { ...entry, text: entry.text + event.text } : entry)));
      }
    });
    void bridge.load(null).then((outcome) => {
      if (alive && outcome.kind === 'loaded') {
        setMessages(outcome.messages);
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return messages;
}

/**
 * Threads one line each, for a review result or an overview: choosing one shows it at its
 * code (the diff opens and scrolls there). With `expand`, a line opens its thread in place,
 * for a window that shows no diff, such as the walk window.
 */
export function ThreadIndex({ threads, expand = false }: { readonly threads: readonly ReviewThread[]; readonly expand?: boolean }): JSX.Element | null {
  const actions = useContext(ThreadContext);
  const [opened, setOpened] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  if (actions === null || threads.length === 0) {
    return null;
  }
  const closed = threads.filter((thread) => thread.status === 'resolved' || thread.status === 'dismissed');
  const shown = showClosed ? threads : threads.filter((thread) => !closed.includes(thread));
  return (
    <div className="rv-thread-index" data-ev="thread-index">
      <ul>
        {shown.map((thread) => {
          const first = thread.anchors[0];
          return (
            <li key={thread.id} className={`rv-thread-index-row rv-thread-${thread.status}`} data-thread-id={thread.id} data-thread-status={thread.status}>
              <button
                type="button"
                className="rv-thread-index-line"
                data-ev="thread-index-line"
                aria-expanded={expand ? opened === thread.id : undefined}
                onClick={() => {
                  if (expand) {
                    setOpened(opened === thread.id ? null : thread.id);
                  } else {
                    actions.select(thread);
                  }
                }}
              >
                <span className={`rv-thread-status rv-thread-status-${thread.status}`}>
                  <span aria-hidden="true">{STATUS_MARK[thread.status]}</span> {STATUS_WORDS[thread.status]}
                </span>
                <span className="rv-thread-kind">{KIND_WORDS[thread.kind]}</span>
                <span className="rv-thread-title">{thread.title}</span>
                <span className="rv-sub">{first !== undefined ? anchorWords(first) : thread.file !== null ? thread.file.path : 'the review'}</span>
              </button>
              {expand && opened === thread.id && <ThreadCard thread={thread} />}
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <button type="button" className="rv-pair-link rv-thread-closed-toggle" data-ev="thread-show-closed" onClick={() => setShowClosed(!showClosed)}>
          {showClosed ? 'Hide closed threads' : `Show ${String(closed.length)} closed ${closed.length === 1 ? 'thread' : 'threads'}`}
        </button>
      )}
    </div>
  );
}
