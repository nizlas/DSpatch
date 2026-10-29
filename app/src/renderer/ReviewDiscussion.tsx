import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { DiscussionAnswer } from './DiscussionAnswer';
import { ModelSelect, type ModelApi } from './StartPage';
import { firstSentence } from './plain-error';
import type { DiscussionWords } from './review-i18n';
import {
  PROVIDER_ADDED_CONTEXT_LINE,
  REVIEW_DISCUSSION_INSTRUCTION,
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

function short(sha: string): string {
  return sha.slice(0, 7);
}

function agentName(provider: DiscussionProvider): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

/** DSP-132: which agent one question went to, and with what - or that it predates the record. */
function agentOf(message: DiscussionMessage, words: DiscussionWords): string {
  if (message.provider === undefined) {
    return words.recordedBeforeProvider;
  }
  const name = agentName(message.provider);
  const session = message.dspatchSessionId === undefined ? '' : ` · ${message.dspatchSessionId}`;
  return `${message.toolPolicy === undefined ? name : words.agentPolicy(name, message.toolPolicy)}${session}`;
}

/**
 * The subject line for the next question, built here from what the window already
 * has, so moving around asks nothing of the main process. The envelope that is
 * actually sent is built in main, from git; this is only its one-line name.
 */
function previewLine(bundle: ReviewBundle, request: DiscussionRequest, lang: Lang, words: DiscussionWords): string {
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

function rangeText(range: EnvelopeRange): string {
  const lines = range.start === range.end ? String(range.start) : `${String(range.start)}–${String(range.end)}`;
  return `${range.role} · ${range.path} ${lines} · ${range.side} @${short(range.sha)}${range.problem === null ? '' : ` (${range.problem})`}`;
}

/** What one question was sent with. Closed until asked for. */
function ContextDisclosure({
  message,
  words,
  index,
}: {
  readonly message: DiscussionMessage;
  readonly words: DiscussionWords;
  readonly index: number;
}): JSX.Element {
  const envelope = message.envelope;
  const labels = words.contextLabels;
  return (
    <details className="rv-discussion-context" data-ev={`discussion-context-${String(index)}`}>
      <summary>{words.context}</summary>
      <dl>
        <dt>{labels.subject}</dt>
        <dd>{message.subject}</dd>
        {envelope !== undefined && (
          <>
            <dt>{labels.revisions}</dt>
            <dd>
              {short(envelope.identity.base.sha)}→{short(envelope.identity.target.sha)}
            </dd>
            <dt>{labels.code}</dt>
            <dd>
              {envelope.ranges.length === 0 ? (
                words.noCode
              ) : (
                <ul>
                  {envelope.ranges.map((range, at) => (
                    <li key={at}>{rangeText(range)}</li>
                  ))}
                </ul>
              )}
            </dd>
            <dt>{labels.notes}</dt>
            <dd>
              {envelope.notes.length === 0 ? (
                words.noNotes
              ) : (
                <ul>
                  {envelope.notes.map((note, at) => (
                    <li key={at}>
                      [{note.kind}, {note.status}] {note.text}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </>
        )}
        <dt>{labels.instruction}</dt>
        <dd className="rv-discussion-instruction">{REVIEW_DISCUSSION_INSTRUCTION}</dd>
        <dt>{labels.providerContext}</dt>
        <dd>{envelope?.providerContext ?? PROVIDER_ADDED_CONTEXT_LINE}</dd>
        <dt>{labels.agent}</dt>
        <dd data-ev={`discussion-agent-${String(index)}`}>{agentOf(message, words)}</dd>
        {message.model !== undefined && (
          <>
            <dt>{labels.model}</dt>
            <dd>{message.model}</dd>
          </>
        )}
        <dt>{labels.sent}</dt>
        <dd>{message.sentPrompt === undefined ? words.notSent : <pre className="rv-discussion-prompt">{message.sentPrompt}</pre>}</dd>
      </dl>
    </details>
  );
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

export function ReviewDiscussion({
  bundle,
  request,
  lang,
  words,
  shown,
  flush,
  onGoToPoint,
  onGoToLocation,
  onMessages,
}: {
  readonly bundle: ReviewBundle;
  readonly request: DiscussionRequest;
  readonly lang: Lang;
  readonly words: DiscussionWords;
  /** Whether the Discussion tab is the one showing. The thread keeps listening either way. */
  readonly shown: boolean;
  /** The review's own save, awaited before a question is sent. */
  readonly flush: () => Promise<string>;
  readonly onGoToPoint: (stepId: string, placeIndex: number) => void;
  readonly onGoToLocation: (location: CodeLocation) => void;
  /** DSP-152: the thread as it stands, for a step to show its own deepenings beside it. */
  readonly onMessages?: (messages: readonly DiscussionMessage[]) => void;
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
        setText(outcome.draft);
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
    if (!loaded.current || bridge === undefined) {
      return;
    }
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
        const outcome = await bridge.send({ question, subject: request.subject, selection: request.selection, language: lang });
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
      const step = stepsWalks(bundle.definition).find((walk) => walk.id === subject.walkId)?.steps.find((entry) => entry.id === subject.stepId);
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

  const questions = messages.filter((message) => message.role === 'question');
  const answersOf = (id: string): readonly DiscussionMessage[] => messages.filter((message) => message.role === 'answer' && message.questionId === id);
  const turn = status?.turn ?? null;
  const needs = gate.length > 0 ? gate : (status?.needsAcknowledgement ?? []);

  // The scenario's hook: readings, and the gestures a person makes.
  const latest = useRef({ messages, status, text, line, error, note, shown, questions, goTo, stop, submit, needs });
  latest.current = { messages, status, text, line, error, note, shown, questions, goTo, stop, submit, needs };
  useEffect(() => {
    const field = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>('[data-ev="discussion-composer"]');
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
          })),
          status: now.status,
          composer: field()?.value ?? '',
          subjectLine: now.line,
          statusLine: (document.querySelector('[data-ev="discussion-status"]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          error: now.error ?? '',
          errorLine: (document.querySelector('[data-ev="discussion-error"] > span')?.textContent ?? '').trim(),
          contextOpen: document.querySelectorAll('.rv-discussion-context[open]').length,
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
        const button = document.querySelector<HTMLButtonElement>('[data-ev="discussion-stop"]');
        button?.click();
        return button !== null;
      },
      sendAnyway: () => {
        const button = document.querySelector<HTMLButtonElement>('[data-ev="discussion-send-anyway"]');
        button?.click();
        return button !== null;
      },
      goTo: (questionIndex) => {
        const button = document.querySelector<HTMLButtonElement>(`[data-ev="discussion-go-${String(questionIndex)}"]`);
        button?.click();
        return button !== null;
      },
    };
    return () => {
      delete window.__dspatchDiscussionCheck;
    };
  }, []);

  const threadEnd = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: 'end' });
  }, [questions.length]);

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
    statusLine = (
      <>
        <span>{turn.stopping ? words.stopping : words.answering}</span>{' '}
        {!turn.stopping && (
          <button type="button" data-ev="discussion-stop" onClick={stop}>
            {words.stop}
          </button>
        )}
      </>
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
    <section className="rv-discussion" hidden={!shown} data-ev="discussion">
      <div className="rv-discussion-thread" data-ev="discussion-thread">
        {questions.length === 0 && <p className="rv-sub">{words.empty}</p>}
        {questions.map((question, index) => (
          <article key={question.id} className="rv-discussion-turn" data-ev={`discussion-q-${String(index)}`}>
            <div className="rv-discussion-question">
              <div className="rv-discussion-subject">{question.subject}</div>
              <div className="rv-discussion-text">{question.text}</div>
              <div className="rv-discussion-meta">
                {question.status === 'sending' && <span>{words.status.sending}</span>}
                {question.status === 'failed' && <span className="rv-error">{words.status.failed}</span>}
                {question.status === 'unknown' && answersOf(question.id).length === 0 && <span>{words.status.unknown}</span>}
                {question.envelope !== undefined && question.envelope.subject.kind !== 'review' && (
                  <button type="button" className="rv-link" data-ev={`discussion-go-${String(index)}`} onClick={() => goTo(question)}>
                    {words.goToPoint}
                  </button>
                )}
              </div>
              <ContextDisclosure message={question} words={words} index={index} />
            </div>
            {answersOf(question.id).map((answer) => (
              <div key={answer.id} className="rv-discussion-answer" data-status={answer.status}>
                <DiscussionAnswer answer={answer} onShow={onGoToLocation} />
                {answer.status !== 'done' && answer.status !== 'streaming' && (
                  <div className="rv-discussion-meta">
                    {answer.status === 'cancelled' ? words.status.cancelled : answer.status === 'failed' ? words.status.failed : words.status.unknown}
                  </div>
                )}
              </div>
            ))}
          </article>
        ))}
        {goneNote && <p className="rv-sub">{words.pointGone}</p>}
        <div ref={threadEnd} />
      </div>
      <div className="rv-discussion-composer-area">
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
                  if (value === 'cursor' || value === 'claude') {
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
            {agent.provider !== null && agent.unavailable === null && agent.policy !== null && (
              <details className="rv-discussion-agent-policy">
                <summary>{words.agentLimits}</summary>
                <div data-ev="discussion-agent-policy">{agent.policy}</div>
              </details>
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
        <div className="rv-discussion-about" data-ev="discussion-subject" title={line}>
          {words.about}: {line}
        </div>
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
