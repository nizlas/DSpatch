import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ActivityLine, DiscussionAnswer } from './DiscussionAnswer';
import { ModelSelect, type ModelApi } from './StartPage';
import { firstSentence } from './plain-error';
import { FOLLOW_THRESHOLD_PX, decideScroll, discussionScrollReason, followAfterScrollEvent, type LatestSignature } from './scroll-follow';
import type { DiscussionWords } from './review-i18n';
import {
  PROVIDER_ADDED_CONTEXT_LINE,
  subjectLine,
  withoutErrorClass,
  type ContextEnvelope,
  type DiscussionMessage,
  type DiscussionProvider,
  type DiscussionRequest,
  type DiscussionStatusView,
  type EnvelopeRange,
  type ReviewDiscussionBridge,
  type ReviewDiscussionEvent,
  type EnvelopeQuote,
  type SelectionQuote,
} from '../shared/review-discussion';
import { stepsWalks, type CodeLocation, type Lang, type ReviewBundle } from '../shared/review-model';

/*
 * The discussion about the code under review (DSP-127), in the review window's right
 * column. Quiet by default: the thread, one line saying what the next question is
 * about, and the composer. What was sent - DSpatch's instruction, the code with its
 * commits, the notes, the exact text - is behind each question's Context, closed.
 *
 * Nothing is sent on open or navigation: only Enter in the composer sends. The window
 * names the subject; the main process builds the envelope from git and the record.
 */

/** What the scripted `review-discussion` scenario reads and drives, from the main process. */
export interface DiscussionCheckReading {
  readonly shown: boolean;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly status: string;
    readonly subject: string;
    readonly text: string;
    readonly questionId: string | null;
    readonly sentPrompt: string | null;
    readonly envelopeSubject: unknown;
  }[];
  readonly status: DiscussionStatusView | null;
  readonly composer: string;
  readonly subjectLine: string;
  readonly statusLine: string;
  readonly error: string;
  /** The error's one line as drawn, without its detail. */
  readonly errorLine: string;
  readonly contextOpen: number;
  readonly note: string;
}

interface DiscussionCheck {
  read(): DiscussionCheckReading;
  type(text: string): boolean;
  enter(times: number): boolean;
  stop(): boolean;
  sendAnyway(): boolean;
  goTo(questionIndex: number): boolean;
}

declare global {
  interface Window {
    readonly dspatchReviewDiscussion?: ReviewDiscussionBridge;
    __dspatchDiscussionCheck?: DiscussionCheck;
  }
}

function agentName(provider: DiscussionProvider): string {
  return provider === 'claude' ? 'Claude' : provider === 'copilot' ? 'Copilot' : 'Cursor';
}

/**
 * The subject line for the next question, built here from what the window already
 * has, so moving around asks nothing of the main process. The envelope that is
 * actually sent is built in main, from git; this is only its one-line name.
 */
function previewLine(bundle: ReviewBundle | null, request: DiscussionRequest, lang: Lang, words: DiscussionWords): string {
  if (bundle === null) {
    // The diff window has no walk: the question is about a place in the change, or all of it.
    const subject = request.subject;
    return subject.kind === 'away'
      ? `${subject.location.path} ${subject.location.start === subject.location.end ? `line ${String(subject.location.start)}` : `lines ${String(subject.location.start)}–${String(subject.location.end)}`} (${subject.location.side === 'base' ? 'From' : 'To'})`
      : words.wholeReview;
  }
  const sha = (side: 'base' | 'target'): string => (side === 'base' ? bundle.base.sha : bundle.target.sha);
  const range = (role: EnvelopeRange['role'], location: CodeLocation): EnvelopeRange => ({
    role,
    path: location.path,
    side: location.side,
    sha: sha(location.side),
    start: location.start,
    end: location.end,
    lines: [],
    omittedLines: 0,
    problem: null,
  });
  const subject = request.subject;
  let explanation: ContextEnvelope['explanation'] = null;
  const ranges: EnvelopeRange[] = [];
  if (subject.kind === 'point') {
    const walkIndex = bundle.definition.walks.findIndex((walk) => walk.id === subject.walkId);
    const walk = bundle.definition.walks[walkIndex];
    const step = walk?.steps.find((entry) => entry.id === subject.stepId);
    const place = step?.places[subject.placeIndex];
    if (walk !== undefined && step !== undefined && place !== undefined) {
      explanation = {
        walkNumber: walkIndex + 1,
        walkTitle: walk.title[lang],
        stepTitle: step.title[lang],
        summary: '',
        body: '',
        why: '',
        placeLabel: place.label[lang],
        evidence: [],
      };
      ranges.push(range('focus', place.focus));
    }
  }
  const envelope: ContextEnvelope = {
    version: 1,
    identity: {
      title: '',
      definitionPath: bundle.definitionPath,
      definitionHash: bundle.definitionHash,
      repository: bundle.repository,
      base: { sha: bundle.base.sha, subject: bundle.base.subject },
      target: { sha: bundle.target.sha, subject: bundle.target.subject },
    },
    language: lang,
    subject,
    selection: request.selection,
    explanation,
    overview: null,
    ranges,
    notes: [],
    providerContext: PROVIDER_ADDED_CONTEXT_LINE,
    builtAt: '',
  };
  const line = subjectLine(envelope);
  return line.startsWith('the review as a whole') ? `${words.wholeReview}${line.slice('the review as a whole'.length)}` : line;
}

/** One plain sentence, the rest on request. */
function PlainProblem({ text, words }: { readonly text: string; readonly words: DiscussionWords }): JSX.Element {
  const [open, setOpen] = useState(false);
  // The class name is detail; the line says what happened.
  const headline = firstSentence(withoutErrorClass(text.trim()));
  return (
    <div className="rv-discussion-error" data-ev="discussion-error" role="alert">
      <span>{headline}</span>
      {headline !== text.trim() && (
        <>
          {' '}
          <button type="button" className="rv-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? words.hideDetails : words.details}
          </button>
          {open && <pre className="rv-discussion-detail">{text}</pre>}
        </>
      )}
    </div>
  );
}

/** The quote a sent question carried, compact and read-only: what it was about. */
function SentQuote({ quote }: { readonly quote: EnvelopeQuote }): JSX.Element {
  const where =
    quote.kind === 'text'
      ? quote.source === 'answer'
        ? 'From an answer'
        : 'From the explanation'
      : quoteWhere({ kind: 'code', text: '', segments: quote.segments });
  const text = quote.kind === 'text' ? quote.text : quote.segments.map((segment) => segment.text).join('\n');
  const flat = text.replace(/\s+/g, ' ');
  return (
    <div className="rv-quote-chip rv-quote-sent" data-ev="discussion-sent-quote" title={text}>
      <span className="rv-quote-chip-text">
        {where}: “{flat.slice(0, 80)}
        {flat.length > 80 ? '…' : ''}”
      </span>
    </div>
  );
}

/** Where quoted code is, short: the file name, its first line and the side. */
function quoteWhere(quote: Extract<SelectionQuote, { kind: 'code' }>): string {
  const first = quote.segments[0];
  if (first === undefined) {
    return 'Selected code';
  }
  const name = first.path.split('/').at(-1) ?? first.path;
  return `${name}:${String(first.start)} (${first.side === 'base' ? 'From' : 'To'})`;
}

export function ReviewDiscussion({
  bundle,
  request,
  lang,
  words,
  shown,
  flush,
  onGoToPoint,
  onGoToLocation,
  onClearQuote,
  onMessages,
  onActivity,
  onSharedQuote,
  onShow,
}: {
  /** The walk the window shows; `null` in the diff window, which has none (30 October 2026). */
  readonly bundle: ReviewBundle | null;
  readonly request: DiscussionRequest;
  readonly lang: Lang;
  readonly words: DiscussionWords;
  /** Whether the Discussion tab is the one showing. The thread keeps listening either way. */
  readonly shown: boolean;
  /** The review's own save, awaited before a question is sent. */
  readonly flush: () => Promise<string>;
  readonly onGoToPoint: (stepId: string, placeIndex: number) => void;
  readonly onGoToLocation: (location: CodeLocation) => void;
  /** Take the selection off the next question. */
  readonly onClearQuote?: () => void;
  /** DSP-152: the thread as it stands, for a step to show its own deepenings beside it. */
  readonly onMessages?: (messages: readonly DiscussionMessage[]) => void;
  /** What the agent answering a question is doing now, for a step that shows the question. */
  readonly onActivity?: (activity: { readonly questionId: string; readonly text: string } | null) => void;
  /**
   * What the next question is about, as another window of the same review chose it (30
   * October 2026): one discussion per revision pair. `null` when it was let go there.
   */
  readonly onSharedQuote?: (quote: SelectionQuote | null) => void;
  /** Asked from another window to show the discussion, with the cursor in its question. */
  readonly onShow?: (quiet: boolean, tab: 'step' | 'discussion') => void;
}): JSX.Element {
  const bridge = window.dspatchReviewDiscussion;
  // DSP-149: the agent's models from its SDK; the choice is the same one the chat uses.
  const models = useMemo<ModelApi>(
    () => ({
      list: (provider) =>
        bridge === undefined ? Promise.reject(new Error('This window has no discussion bridge.')) : bridge.listModels(provider),
      choose: (provider, modelId) =>
        bridge === undefined ? Promise.reject(new Error('This window has no discussion bridge.')) : bridge.chooseModel(provider, modelId),
    }),
    [bridge],
  );
  const [messages, setMessages] = useState<readonly DiscussionMessage[]>([]);
  useEffect(() => {
    onMessages?.(messages);
  }, [messages, onMessages]);
  const [status, setStatus] = useState<DiscussionStatusView | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gate, setGate] = useState<readonly string[]>([]);
  const [goneNote, setGoneNote] = useState(false);
  /** DSP-132: the recap behind the switch notice is shown on request. */
  const [recapShown, setRecapShown] = useState(false);
  const sending = useRef(false);
  const loaded = useRef(false);
  /** The draft as it came from the record or another window: not saved back. */
  const fromElsewhere = useRef<string | null>(null);
  const sharedQuote = useRef(onSharedQuote);
  sharedQuote.current = onSharedQuote;
  const showMe = useRef(onShow);
  showMe.current = onShow;

  // Read the stored thread and draft. No adapter is involved in this.
  useEffect(() => {
    if (bridge === undefined) {
      setError('The discussion bridge is missing from this window (preload).');
      return;
    }
    const unsubscribe = bridge.onEvent((event: ReviewDiscussionEvent) => {
      if (event.kind === 'message') {
        setMessages((current) => {
          const at = current.findIndex((entry) => entry.id === event.message.id);
          return at < 0 ? [...current, event.message] : current.map((entry, index) => (index === at ? event.message : entry));
        });
      } else if (event.kind === 'delta') {
        setMessages((current) => current.map((entry) => (entry.id === event.messageId ? { ...entry, text: entry.text + event.text } : entry)));
      } else if (event.kind === 'activity') {
        // Only for the turn still going: it ends with the turn, whatever arrives after.
        setStatus((current) =>
          current?.turn != null && current.turn.questionId === event.questionId ? { ...current, turn: { ...current.turn, activity: event.activity } } : current,
        );
      } else if (event.kind === 'quote') {
        sharedQuote.current?.(event.quote);
      } else if (event.kind === 'show') {
        showMe.current?.(event.quiet === true, event.tab ?? 'discussion');
      } else if (event.kind === 'draft') {
        // Written in another window of the review: shown here, and not saved back from here.
        fromElsewhere.current = event.text;
        setText(event.text);
      } else {
        setStatus(event.status);
        if (event.note !== undefined) {
          setNote(event.note);
        }
      }
    });
    void bridge.load(null).then(
      (outcome) => {
        if (outcome.kind === 'refused') {
          setError(outcome.error);
          return;
        }
        setMessages(outcome.messages);
        setStatus(outcome.status);
        fromElsewhere.current = outcome.draft;
        setText(outcome.draft);
        if (outcome.quote != null) {
          sharedQuote.current?.(outcome.quote);
        }
        setNote(outcome.note);
        loaded.current = true;
      },
      (failure: unknown) => {
        setError(String(failure));
      },
    );
    return unsubscribe;
  }, [bridge]);

  // The draft is kept per review, in the discussion's own record.
  useEffect(() => {
    if (!loaded.current || bridge === undefined || text === fromElsewhere.current) {
      return;
    }
    fromElsewhere.current = null;
    const timer = window.setTimeout(() => {
      void bridge.saveDraft(text);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [text, bridge]);

  const line = useMemo(() => previewLine(bundle, request, lang, words), [bundle, request, lang, words]);

  const submit = useCallback(
    async (acknowledge: readonly string[] = []): Promise<void> => {
      if (bridge === undefined || sending.current) {
        return;
      }
      const question = text.trim();
      if (question === '' && acknowledge.length === 0) {
        return;
      }
      // DSP-132: no agent, no question. The line above the box already says so.
      if (status?.agent.provider == null) {
        return;
      }
      sending.current = true;
      setError(null);
      try {
        if (acknowledge.length > 0) {
          setStatus(await bridge.acknowledge(acknowledge));
          setGate([]);
          setNote(null);
          if (question === '') {
            return;
          }
        }
        // The position and notes the envelope reads come from the saved record.
        await flush();
        // The selection goes along with the question, exactly as it is shown above the field.
        const outcome = await bridge.send({ question, subject: request.subject, selection: request.selection, language: lang, quote: request.quote ?? null });
        if (outcome.kind === 'sent') {
          setText('');
          void bridge.saveDraft('');
          setNote(null);
        } else if (outcome.kind === 'refused' && (outcome.acknowledgeable?.length ?? 0) > 0) {
          setGate(outcome.acknowledgeable ?? []);
        } else {
          // Refused or failed: the text stays in the box.
          setError(outcome.error);
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        sending.current = false;
      }
    },
    [bridge, text, flush, request, lang, status],
  );

  /** DSP-132: choose the agent. Builds nothing; the next question starts its session. */
  const choose = useCallback(
    (provider: DiscussionProvider) => {
      if (bridge === undefined) {
        return;
      }
      setRecapShown(false);
      void bridge.chooseAgent(provider).then(
        (outcome) => {
          if (outcome.kind === 'chosen') {
            setStatus(outcome.status);
            setError(null);
          } else {
            setError(outcome.error);
          }
        },
        (failure: unknown) => {
          setError(String(failure));
        },
      );
    },
    [bridge],
  );

  const setLeftOut = useCallback(
    (leftOut: boolean) => {
      if (bridge !== undefined) {
        void bridge.setRecapLeftOut(leftOut).then(setStatus, (failure: unknown) => {
          setError(String(failure));
        });
      }
    },
    [bridge],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void submit();
      }
    },
    [submit],
  );

  const stop = useCallback(() => {
    if (bridge !== undefined) {
      void bridge.cancel().then(
        (outcome) => {
          if (outcome.kind === 'failed') {
            setError(outcome.note);
          }
        },
        (failure: unknown) => {
          setError(String(failure));
        },
      );
    }
  }, [bridge]);

  /**
   * Explain an earlier answer more simply (30 October 2026): a new question in this
   * discussion, sent with the context that answer's own question had, whatever the window
   * shows now. The original answer stays; the person's draft is left as it is.
   */
  const simplify = useCallback(
    async (answer: DiscussionMessage): Promise<void> => {
      if (bridge === undefined) {
        return;
      }
      setError(null);
      try {
        // Which answer, said in the thread: the question it answered, shortened.
        const asked = messages.find((message) => message.id === answer.questionId)?.text.replace(/\s+/g, ' ').trim() ?? '';
        const about = asked.length > 90 ? `${asked.slice(0, 89)}…` : asked;
        const outcome = await bridge.send({
          question: lang === 'sv' ? `Förklara enklare svaret på: “${about}”` : `Explain more simply the answer to: “${about}”`,
          subject: request.subject,
          selection: null,
          language: lang,
          simplify: { answerId: answer.id },
        });
        if (outcome.kind !== 'sent') {
          setError(outcome.error);
        }
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    },
    [bridge, lang, messages, request.subject],
  );

  const goTo = useCallback(
    (message: DiscussionMessage) => {
      const envelope = message.envelope;
      if (envelope === undefined) {
        return;
      }
      setGoneNote(false);
      const subject = envelope.subject;
      if (subject.kind === 'away') {
        onGoToLocation(subject.location);
        return;
      }
      if (subject.kind !== 'point') {
        return;
      }
      const step = bundle === null ? undefined : stepsWalks(bundle.definition).find((walk) => walk.id === subject.walkId)?.steps.find((entry) => entry.id === subject.stepId);
      if (step?.places[subject.placeIndex] !== undefined) {
        onGoToPoint(subject.stepId, subject.placeIndex);
        return;
      }
      // The walk changed since: the frozen location still names the code that was asked about.
      const focus = envelope.ranges.find((range) => range.role === 'focus');
      setGoneNote(true);
      if (focus !== undefined) {
        onGoToLocation({ path: focus.path, side: focus.side, start: focus.start, end: focus.end });
      }
    },
    [bundle, onGoToPoint, onGoToLocation],
  );

  // A question asked in a review thread stays in that thread (DSP-175); here it is one line.
  const questions = messages.filter((message) => message.role === 'question');
  const answersOf = (id: string): readonly DiscussionMessage[] => messages.filter((message) => message.role === 'answer' && message.questionId === id);
  const turn = status?.turn ?? null;
  const activityText = turn === null ? null : turn.stopping ? words.stopping : (turn.activity ?? words.answering);
  useEffect(() => {
    onActivity?.(turn === null || activityText === null ? null : { questionId: turn.questionId, text: activityText });
  }, [onActivity, turn?.questionId, activityText]);
  const needs = gate.length > 0 ? gate : (status?.needsAcknowledgement ?? []);

  // The scenario's hook: readings, and the gestures a person makes.
  const latest = useRef({ messages, status, text, line, error, note, shown, questions, goTo, stop, submit, needs });
  latest.current = { messages, status, text, line, error, note, shown, questions, goTo, stop, submit, needs };
  // Its own elements, in whichever window the panel is shown (docked or on its own).
  const own = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const scope = (): ParentNode => own.current ?? document;
    const field = (): HTMLTextAreaElement | null => scope().querySelector<HTMLTextAreaElement>('[data-ev="discussion-composer"]');
    window.__dspatchDiscussionCheck = {
      read: () => {
        const now = latest.current;
        return {
          shown: now.shown,
          messages: now.messages.map((message) => ({
            id: message.id,
            role: message.role,
            status: message.status,
            subject: message.subject,
            text: message.text,
            questionId: message.questionId ?? null,
            sentPrompt: message.sentPrompt ?? null,
            envelopeSubject: message.envelope?.subject ?? null,
            // 30 October 2026: whether it could read the code, and what it rests on, as checked.
            codeAccess: message.codeAccess === true,
            toolPolicy: message.toolPolicy ?? null,
            references: (message.references ?? []).map((entry) => `${entry.range.side}:${entry.range.path}:${String(entry.range.start)}-${String(entry.range.end)}`),
            insufficient: message.insufficient === true,
            adjustments: message.adjustments ?? [],
            reads: message.reads ?? [],
            // 30 October 2026: what each question was about, exactly, with its revisions.
            quote: message.envelope?.quote ?? null,
            simplifies: message.simplifies ?? null,
          })),
          status: now.status,
          composer: field()?.value ?? '',
          subjectLine: now.line,
          statusLine: (scope().querySelector('[data-ev="discussion-status"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          error: now.error ?? '',
          errorLine: (scope().querySelector('[data-ev="discussion-error"] > span')?.textContent ?? '').trim(),
          agentChosen: scope().querySelector<HTMLSelectElement>('[data-ev="discussion-agent-select"]')?.value ?? '',
          modelChosen: scope().querySelector<HTMLSelectElement>('[data-ev="model-select"]')?.value ?? '',
          modelShown: scope().querySelector<HTMLSelectElement>('[data-ev="model-select"]')?.selectedOptions[0]?.textContent ?? '',
          contextOpen: scope().querySelectorAll('.rv-discussion-context[open]').length,
          note: now.note ?? '',
        };
      },
      type: (value) => {
        const box = field();
        if (box === null) {
          return false;
        }
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(box, value);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      },
      enter: (times) => {
        const box = field();
        if (box === null) {
          return false;
        }
        for (let count = 0; count < times; count += 1) {
          box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        }
        return true;
      },
      stop: () => {
        const button = scope().querySelector<HTMLButtonElement>('[data-ev="discussion-stop"]');
        button?.click();
        return button !== null;
      },
      sendAnyway: () => {
        const button = scope().querySelector<HTMLButtonElement>('[data-ev="discussion-send-anyway"]');
        button?.click();
        return button !== null;
      },
      goTo: (questionIndex) => {
        const question = latest.current.questions[questionIndex];
        if (question?.envelope === undefined || question.envelope.subject.kind === 'review') {
          return false;
        }
        latest.current.goTo(question);
        return true;
      },
    };
    return () => {
      delete window.__dspatchDiscussionCheck;
    };
  }, []);

  /*
   * DSP-175: following the latest. The panel's own scroller is moved, never the window: a
   * new question (typed here, or Explain this from any window of the review) goes to it and
   * the answer's place; an answer arriving is followed only while the reader is at the
   * bottom. A reader who scrolls up stays where they are and is offered *New response ↓*.
   * Ordinary re-renders and changes to older messages move nothing.
   */
  const threadEnd = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLElement | null>(null);
  const following = useRef(true);
  const applied = useRef<number | null>(null);
  const [newBelow, setNewBelow] = useState(false);
  const scrollerOf = useCallback((): HTMLElement | null => {
    if (scroller.current?.isConnected === true) {
      return scroller.current;
    }
    let element = own.current?.parentElement ?? null;
    while (element !== null) {
      const overflow = getComputedStyle(element).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight >= element.clientHeight) {
        scroller.current = element;
        return element;
      }
      element = element.parentElement;
    }
    return null;
  }, []);
  const toLatest = useCallback((): void => {
    const element = scrollerOf();
    if (element === null) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    applied.current = element.scrollTop;
    following.current = true;
    setNewBelow(false);
  }, [scrollerOf]);
  useEffect(() => {
    const element = scrollerOf();
    if (element === null) {
      return undefined;
    }
    const onScroll = (): void => {
      following.current = followAfterScrollEvent({
        metrics: { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight },
        appliedScrollTop: applied.current,
        threshold: FOLLOW_THRESHOLD_PX,
      });
      if (following.current) {
        setNewBelow(false);
      }
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [scrollerOf, shown]);
  const shownQuestions = questions.filter((question) => question.envelope?.subject.kind !== 'thread');
  const lastQuestion = shownQuestions.at(-1) ?? null;
  const signature: LatestSignature = {
    questions: shownQuestions.length,
    lastQuestionId: lastQuestion?.id ?? null,
    latestContent: lastQuestion === null ? '' : answersOf(lastQuestion.id).map((answer) => `${answer.status}:${answer.text}`).join('|') + (turn?.questionId === lastQuestion.id ? `:${turn.activity ?? ''}` : ''),
  };
  const before = useRef<LatestSignature | null>(null);
  useLayoutEffect(() => {
    const reason = discussionScrollReason(before.current, signature);
    before.current = signature;
    if (reason === null) {
      return;
    }
    if (decideScroll({ reason, followingLatest: following.current }) === 'scroll-to-latest') {
      toLatest();
    } else if (reason === 'content') {
      setNewBelow(true);
    }
  });
  // Shown again (another tab, or the panel moved): a reader who was following still is.
  useLayoutEffect(() => {
    if (shown && following.current) {
      toLatest();
    }
  }, [shown, toLatest]);

  let statusLine: JSX.Element | null = null;
  if (status?.readOnly != null) {
    statusLine = <span>{words.readOnly(status.readOnly)}</span>;
  } else if (needs.length > 0) {
    statusLine = (
      <>
        <span>{words.needsAcknowledgement}</span>{' '}
        <button type="button" data-ev="discussion-send-anyway" onClick={() => void submit(needs)}>
          {text.trim() === '' ? words.continueAnyway : words.sendAnyway}
        </button>
      </>
    );
  } else if (turn !== null) {
    // What the agent is doing is said under the question; here only the way to stop it.
    statusLine = turn.stopping ? null : (
      <button type="button" data-ev="discussion-stop" onClick={stop}>
        {words.stop}
      </button>
    );
  } else if (note !== null) {
    statusLine = <span>{note}</span>;
  }

  // DSP-132: the agent, its limits, and what a switch carries.
  const agent = status?.agent ?? null;
  const agentLocked = turn !== null || status?.readOnly != null;
  const noAgent = agent !== null && agent.provider === null;
  const notice = agent?.switchNotice ?? null;

  return (
    <section className="rv-discussion" hidden={!shown} data-ev="discussion" ref={(node) => {
      own.current = node;
    }}>
      <div className="rv-discussion-thread" data-ev="discussion-thread">
        {questions.length === 0 && <p className="rv-sub">{words.empty}</p>}
        {questions.map((question, index) =>
          question.envelope?.subject.kind === 'thread' ? (
            <p key={question.id} className="rv-sub rv-discussion-in-thread" data-ev="discussion-in-thread">
              Asked in the review thread “{question.envelope.thread?.title ?? ''}”; the question and its answer are kept there.
            </p>
          ) : (
          <article key={question.id} className="rv-discussion-turn" data-ev={`discussion-q-${String(index)}`}>
            {/*
              What was asked, and what it was about when something was selected (Niclas's trial,
              30 October 2026). The subject, the envelope and the exact text sent are kept with the
              question and sent as before; the view does not show them.
            */}
            <div className="rv-discussion-question">
              {question.envelope?.quote != null && <SentQuote quote={question.envelope.quote} />}
              <div className="rv-discussion-text">{question.text}</div>
              {(question.status === 'sending' || question.status === 'failed' || (question.status === 'unknown' && answersOf(question.id).length === 0)) && (
                <div className="rv-discussion-meta">
                  {question.status === 'sending' && <span>{words.status.sending}</span>}
                  {question.status === 'failed' && <span className="rv-error">{words.status.failed}</span>}
                  {question.status === 'unknown' && <span>{words.status.unknown}</span>}
                </div>
              )}
            </div>
            {answersOf(question.id).map((answer) => (
              <div key={answer.id} className="rv-discussion-answer" data-status={answer.status}>
                <DiscussionAnswer
                  answer={answer}
                  onShow={onGoToLocation}
                  onSimpler={turn === null && status?.readOnly == null ? () => void simplify(answer) : undefined}
                />
                {answer.status !== 'done' && answer.status !== 'streaming' && (
                  <div className="rv-discussion-meta">
                    {answer.status === 'cancelled' ? words.status.cancelled : answer.status === 'failed' ? words.status.failed : words.status.unknown}
                  </div>
                )}
              </div>
            ))}
            {turn?.questionId === question.id && (
              <ActivityLine text={turn.stopping ? words.stopping : (turn.activity ?? words.answering)} testId="discussion-activity" />
            )}
          </article>
          ),
        )}
        {goneNote && <p className="rv-sub">{words.pointGone}</p>}
        <div ref={threadEnd} />
      </div>
      <div className="rv-discussion-composer-area">
        {/* Above the question field, which stays at the bottom of the panel, so nothing covers it. */}
        {newBelow && (
          <button type="button" className="rv-new-response" data-ev="discussion-new-response" onClick={toLatest}>
            New response ↓
          </button>
        )}
        {statusLine !== null && (
          <div className="rv-discussion-status" role="status" data-ev="discussion-status">
            {statusLine}
          </div>
        )}
        {error !== null && <PlainProblem text={error} words={words} />}
        {agent !== null && (
          <div className="rv-discussion-agent" data-ev="discussion-agent">
            <label>
              {words.agentLabel}{' '}
              <select
                data-ev="discussion-agent-select"
                value={agent.provider ?? ''}
                disabled={agentLocked}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'cursor' || value === 'claude' || value === 'copilot') {
                    choose(value);
                  }
                }}
              >
                {agent.provider === null && (
                  <option value="" disabled>
                    {words.chooseAgent}
                  </option>
                )}
                {agent.options.map((option) => (
                  <option
                    key={option.provider}
                    value={option.provider}
                    disabled={!option.choosable && option.provider !== agent.provider}
                    title={option.reason ?? undefined}
                  >
                    {option.choosable ? agentName(option.provider) : `${agentName(option.provider)} (${words.notAvailable})`}
                  </option>
                ))}
              </select>
            </label>
            <ModelSelect provider={agent.provider} disabled={agentLocked} compact api={models} />
            {noAgent && (
              <div className="rv-sub" data-ev="discussion-choose-agent">
                {words.chooseAgent}
              </div>
            )}
            {agent.provider !== null && agent.unavailable !== null && (
              <div className="rv-error" data-ev="discussion-agent-unavailable">
                {words.agentUnavailable(agentName(agent.provider), agent.unavailable)}
              </div>
            )}
            {notice !== null && (
              <div className="rv-discussion-switch" data-ev="discussion-switch-notice">
                <span>
                  {notice.leftOut
                    ? words.recapLeftOut(agentName(notice.provider))
                    : words.switchNotice(agentName(notice.provider), notice.exchanges)}
                </span>{' '}
                {!notice.leftOut && (
                  <button type="button" className="rv-link" data-ev="discussion-recap-show" aria-expanded={recapShown} onClick={() => setRecapShown(!recapShown)}>
                    {recapShown ? words.hideRecap : words.showRecap}
                  </button>
                )}{' '}
                <button type="button" className="rv-link" data-ev="discussion-recap-leave-out" onClick={() => setLeftOut(!notice.leftOut)}>
                  {notice.leftOut ? words.includeAgain : words.leaveOut}
                </button>
                {recapShown && !notice.leftOut && <pre className="rv-discussion-prompt">{notice.recap}</pre>}
              </div>
            )}
          </div>
        )}
        {request.quote != null && (
          <div className="rv-quote-chip" data-ev="discussion-quote" title={request.quote.text}>
            <span className="rv-quote-chip-text">
              {request.quote.kind === 'code' ? quoteWhere(request.quote) : request.quote.source === 'answer' ? 'From an answer' : request.quote.source === 'thread' ? 'From a review thread' : 'From the explanation'}: “{request.quote.text.replace(/\s+/g, ' ').slice(0, 80)}
              {request.quote.text.length > 80 ? '…' : ''}”
            </span>
            {onClearQuote !== undefined && (
              <button type="button" className="rv-quote-chip-clear" data-ev="discussion-quote-clear" aria-label="Remove the selection from the question" onClick={onClearQuote}>
                ×
              </button>
            )}
          </div>
        )}
        <textarea
          className="rv-discussion-composer"
          data-ev="discussion-composer"
          rows={3}
          value={text}
          placeholder={words.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={bridge === undefined || status?.readOnly != null}
        />
      </div>
    </section>
  );
}
