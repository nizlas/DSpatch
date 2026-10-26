import type {
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  Unsubscribe,
  UsageReading,
} from '../adapter/types';
import type { AgentAdapter } from '../adapter/agent-adapter';
import type { AuthStatusReading, ChatAdapter } from './chat-service';

/**
 * A local adapter that streams a fixed reply, for looking at the window.
 *
 * [Proportionate verification](../../../docs/DEVELOPMENT_LOOP.md#proportionate-verification)
 * says presentation is tried in the real window with saved content or controlled
 * streaming, and that provider calls are for when the provider's behaviour is the
 * question. For scrolling, Markdown and where the chrome sits, it is not: what is
 * being checked is what the window does with text it has been given. So this gives
 * it text, in chunks, with no network and no cost, and the trial can then send a
 * dozen messages to build a conversation long enough to scroll — which no billed
 * scenario could afford to do.
 *
 * **It is reachable only from `DSPATCH_CHAT_RUN=presentation`.** Nothing else
 * constructs it, and the trial's own report says which adapter produced its
 * evidence, because a screenshot of a window fed by this is evidence about layout
 * and about nothing else.
 *
 * The reply is deliberately the most awkward text this product has to draw: a
 * heading, emphasis, a nested list, a link, a fenced block whose contents are
 * Markdown markers, and a line of HTML. If those four survive the trip, the easy
 * cases did too.
 */

const MODELS: readonly ModelInfo[] = [
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', provider: 'cursor' },
  { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', provider: 'cursor' },
  { id: 'gpt-5-codex', displayName: 'GPT-5 Codex', provider: 'cursor' },
];

const CAPABILITIES: CapabilityReport = {
  start: 'supported',
  streaming: 'supported',
  cancel: 'supported',
  resume: 'supported',
  modelSelection: 'supported',
  approvals: 'unsupported',
  usageReporting: 'unknown',
};

/** The characters the reply must still contain after the window has drawn it. */
export const PRESENTATION_LITERALS = {
  fencedMarkers: '### not a heading, **not bold**',
  shellLine: 'rg --glob "*.ts" -n "a && b" | head -5',
  html: '<script>alert("not a script")</script>',
} as const;

/**
 * The first outcome a loop step's prompt offers it, or `null` for an ordinary turn.
 *
 * DSP-79. A loop step's prompt ends with the names the step may declare, one
 * `RESULT: <name>` per line, and a reply that declares none routes as "could not
 * establish" — so a canned reply would stop every loop at its first step and the
 * window could never walk one without paying for a model. Taking the **first** name is
 * a fixture's rule and is arbitrary on purpose: it is deterministic, it needs no
 * understanding of the graph, and it is the reason this adapter's evidence is about the
 * window and never about whether a verdict was right.
 *
 * Deliberately narrow: it reads only the instruction block this product writes, and a
 * prompt that offers nothing gets nothing added.
 */
export function firstOfferedOutcome(prompt: string): string | null {
  const offered = [...prompt.matchAll(/^RESULT: ([a-z0-9][a-z0-9-]*)$/gm)].map(
    (match) => match[1] ?? '',
  );
  return offered[0] ?? null;
}

/** What the fixed reply says. `token` is echoed so a turn can be identified. */
export function presentationReply(token: string): string {
  return [
    `## What I did for ${token}`,
    '',
    'Two things changed, and one of them is **load bearing**:',
    '',
    '1. `scroll-follow.ts` decides when the conversation moves.',
    '2. The transcript is the *only* vertical scroller.',
    '   - The page itself no longer scrolls.',
    '   - Code blocks still scroll sideways.',
    '',
    'See [the interaction model](https://example.test/interaction-model) for why.',
    '',
    'A reply about Markdown has to survive being drawn:',
    '',
    '```markdown',
    PRESENTATION_LITERALS.fencedMarkers,
    '- a literal bullet',
    '```',
    '',
    'And so does a command:',
    '',
    '```bash',
    PRESENTATION_LITERALS.shellLine,
    '```',
    '',
    `Finally, this must be text and not markup: ${PRESENTATION_LITERALS.html}`,
  ].join('\n');
}

/** A logged-in reading, so the trial never touches the credential store. */
export function presentationAuthStatus(): Promise<AuthStatusReading> {
  return Promise.resolve({
    status: 'logged-in',
    backendUrl: 'https://local.invalid/presentation',
    email: 'presentation@local.invalid',
  });
}

/**
 * How this adapter answers `resume()` (`DSPATCH_CHAT_RESUME`, DSP-121).
 *
 * - `ok`: every resume succeeds, as it always has.
 * - `refused`: every resume throws the shape the Cursor adapter throws when the
 *   provider answers that it does not have the session (`providerCode:
 *   'agent_not_found'`).
 * - `failed`: every resume throws an error with no provider code, the shape of a
 *   transport failure.
 * - `refused-once`: the first resume of each session ID is refused and later ones
 *   succeed, so that *Try again* can be shown succeeding.
 *
 * **Simulated, every one of them.** Nothing here asks any provider anything; the
 * message of every thrown error says so, and the window's "Technical detail" shows
 * that message. What a run over this shows is what the window does with a refusal
 * or a failure, and nothing about whether any provider would give one.
 */
export type PresentationResumeMode = 'ok' | 'refused' | 'failed' | 'refused-once';

const RESUME_MODES: readonly PresentationResumeMode[] = ['ok', 'refused', 'failed', 'refused-once'];

/**
 * The mode an environment value names: unset or empty is `ok`, today's behaviour;
 * any other value must be one of the four, exactly, or `null` is returned so the
 * caller can say so rather than silently running a different trial.
 */
export function presentationResumeMode(raw: string | undefined): PresentationResumeMode | null {
  const value = (raw ?? '').trim();
  if (value === '') {
    return 'ok';
  }
  return RESUME_MODES.find((mode) => mode === value) ?? null;
}

/**
 * How this adapter answers `send()` (`DSPATCH_REVIEW_PRESENTATION_SEND`, DSP-127).
 *
 * - `ok`: every send starts a run, as it always has.
 * - `markers`: a prompt containing {@link SIMULATED_SEND_FAILS} is refused before any
 *   run exists, and one containing {@link SIMULATED_SLOW_START} announces its run and
 *   then holds `send` for {@link SIMULATED_SLOW_START_MS} before it returns: the
 *   interval in which Stop has no run to cancel.
 *
 * Read for the **review** discussion's adapters only (`reviewAdapterFactory`), whose
 * behaviour object is their own: the main chat's sends can never meet it. SIMULATED:
 * nothing is asked of any provider, and the refusal says so.
 */
export type PresentationSendMode = 'ok' | 'markers';

export const SIMULATED_SEND_FAILS = '[simulate: send fails]';
export const SIMULATED_SLOW_START = '[simulate: slow start]';
export const SIMULATED_SLOW_START_MS = 2_500;

/** The mode an environment value names: unset or empty is `ok`; anything else unknown is `null`. */
export function presentationSendMode(raw: string | undefined): PresentationSendMode | null {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'ok') {
    return 'ok';
  }
  return value === 'markers' ? 'markers' : null;
}

/** One `resume()` the adapter was asked for, and how it answered. */
export interface PresentationResumeAttempt {
  readonly sessionId: string;
  readonly outcome: 'resumed' | 'refused' | 'failed';
  readonly atUtc: string;
}

/**
 * The resume behaviour and the record of what the adapter was asked, shared by
 * every `PresentationAdapter` instance of one process.
 *
 * Shared rather than per instance because `ChatService` replaces its adapter with
 * the session: a second *Try again* is a second instance, and `refused-once` has
 * to remember the first refusal across it. The record is what a scripted run's
 * main-process evidence reads: how many resumes were attempted and with what
 * answer, how many sessions were started outright, and the exact text of every
 * `send()` - the whole prompt as it reached the adapter, recap and all, which is
 * what settles whether a recap was in front of a message.
 */
export class PresentationResumeBehaviour {
  readonly mode: PresentationResumeMode;

  private readonly refusedOnce = new Set<string>();

  private readonly attempts: PresentationResumeAttempt[] = [];

  private readonly sentTexts: string[] = [];

  private startSessionCount = 0;

  /** How `send()` answers; `ok` unless a review factory was told otherwise. */
  readonly sendMode: PresentationSendMode;

  constructor(mode: PresentationResumeMode = 'ok', sendMode: PresentationSendMode = 'ok') {
    this.mode = mode;
    this.sendMode = sendMode;
  }

  /**
   * How one `send()` of `prompt` is to go: refused, held, or as usual. Throws the
   * simulated refusal; returns how long to hold otherwise.
   */
  decideSend(prompt: string): number {
    if (this.sendMode !== 'markers') {
      return 0;
    }
    if (prompt.includes(SIMULATED_SEND_FAILS)) {
      throw Object.assign(
        new Error('Presentation adapter: simulated send failure - the question was refused before any run started. Nothing was asked of any provider.'),
        { name: 'PresentationSendFailed' },
      );
    }
    return prompt.includes(SIMULATED_SLOW_START) ? SIMULATED_SLOW_START_MS : 0;
  }

  /**
   * Answer one `resume()` of `sessionId`: return when it is to succeed, throw the
   * simulated refusal or failure otherwise. Records the attempt either way.
   */
  decideResume(sessionId: string): void {
    const refuse =
      this.mode === 'refused' ||
      (this.mode === 'refused-once' && !this.refusedOnce.has(sessionId));
    if (refuse) {
      this.refusedOnce.add(sessionId);
      this.attempts.push({ sessionId, outcome: 'refused', atUtc: new Date().toISOString() });
      throw Object.assign(
        new Error(
          `Presentation adapter: simulated refusal - no session "${sessionId}" (agent_not_found)`,
        ),
        { name: 'PresentationResumeRefused', providerCode: 'agent_not_found' },
      );
    }
    if (this.mode === 'failed') {
      this.attempts.push({ sessionId, outcome: 'failed', atUtc: new Date().toISOString() });
      throw Object.assign(
        new Error('Presentation adapter: simulated temporary failure - TypeError: fetch failed'),
        { name: 'PresentationResumeFailed' },
      );
    }
    this.attempts.push({ sessionId, outcome: 'resumed', atUtc: new Date().toISOString() });
  }

  recordStartSession(): void {
    this.startSessionCount += 1;
  }

  recordSent(text: string): void {
    this.sentTexts.push(text);
  }

  /** What was asked and answered so far, for a run record. */
  record(): {
    readonly mode: PresentationResumeMode;
    readonly simulated: true;
    readonly resumeAttempts: readonly PresentationResumeAttempt[];
    readonly startSessionCalls: number;
    readonly sent: readonly string[];
  } {
    return {
      mode: this.mode,
      simulated: true,
      resumeAttempts: [...this.attempts],
      startSessionCalls: this.startSessionCount,
      sent: [...this.sentTexts],
    };
  }
}

interface SessionState {
  readonly dspatchSessionId: string;
  listener: AgentEventListener | null;
  runCounter: number;
  activeRun: string | null;
  timers: Set<NodeJS.Timeout>;
}

export class PresentationAdapter implements ChatAdapter, AgentAdapter {
  readonly id = 'presentation-local';

  private readonly sessions = new Map<string, SessionState>();

  private sessionCounter = 0;

  /** How fast the canned reply arrives. Small enough to keep the trial short. */
  private readonly deltaMs: number;

  /** How `resume()` answers, and the record of what was asked. `ok` unless given. */
  private readonly behaviour: PresentationResumeBehaviour;

  constructor(
    options: {
      readonly deltaMs?: number;
      readonly resume?: PresentationResumeBehaviour;
    } = {},
  ) {
    this.deltaMs = options.deltaMs ?? 45;
    this.behaviour = options.resume ?? new PresentationResumeBehaviour('ok');
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve(MODELS);
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
    this.behaviour.recordStartSession();
    return Promise.resolve(this.open(config));
  }

  /** A fresh local session, counted as a start only when asked for as one. */
  private open(config: SessionConfig): SessionHandle {
    this.sessionCounter += 1;
    // Shaped like the real adapter's ids, so the window and anything reading it
    // sees a session identifier of the usual form rather than a special case.
    const dspatchSessionId =
      config.dspatchSessionId ?? `dsp-session-presentation-${String(this.sessionCounter)}`;
    this.sessions.set(dspatchSessionId, {
      dspatchSessionId,
      listener: null,
      runCounter: 0,
      activeRun: null,
      timers: new Set(),
    });
    return {
      dspatchSessionId,
      // The provider the session was opened for (DSP-117), so a simulated Claude
      // session is recorded as one. Still SIMULATED: nothing here is either provider.
      provider: config.provider === 'claude' ? 'claude' : 'cursor',
      providerSessionId: `local-${dspatchSessionId}`,
      createdAt: new Date().toISOString(),
    };
  }

  resume(sessionId: string, config: SessionConfig): Promise<SessionHandle> {
    // The shared behaviour answers first: a simulated refusal or failure is thrown
    // here and no local session is opened, which is the shape of the real refusal.
    try {
      this.behaviour.decideResume(sessionId);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    // Nothing is checked: a presentation "resume" is a fresh local session under the
    // old ID, and the continuity wording must not claim more than that.
    const handle = this.open({ ...config, dspatchSessionId: sessionId });
    return Promise.resolve({ ...handle, resumeEvidence: 'none' });
  }

  hasActiveRun(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.activeRun !== null;
  }

  subscribe(sessionId: string, listener: AgentEventListener): Unsubscribe {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      throw new Error(`No presentation session ${sessionId}.`);
    }
    state.listener = listener;
    return () => {
      state.listener = null;
    };
  }

  send(sessionId: string, prompt: string): Promise<RunReference> {
    const state = this.sessions.get(sessionId);
    if (state === undefined) {
      return Promise.reject(new Error(`No presentation session ${sessionId}.`));
    }
    // The whole text as it arrived, recap and all: what the record reads to say
    // whether a recap was in front of the message.
    this.behaviour.recordSent(prompt);
    let holdMs: number;
    try {
      holdMs = this.behaviour.decideSend(prompt);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    state.runCounter += 1;
    const dspatchRunId = `${sessionId}-run-${String(state.runCounter)}`;
    state.activeRun = dspatchRunId;

    const token = (/\b(mark-\w+)\b/.exec(prompt)?.[1] ?? prompt.trim().slice(0, 24)) || 'this';
    // A loop step is answered with a declared outcome; an ordinary chat turn is not.
    // Appended rather than folded in, so the Markdown the presentation scenarios read
    // is byte for byte what it was and only a loop prompt sees anything new.
    const declared = firstOfferedOutcome(prompt);
    const answer =
      declared === null
        ? presentationReply(token)
        : `${presentationReply(token)}\n\nRESULT: ${declared}`;
    // Chunked on whitespace, so what arrives is the partial text a real stream
    // produces — including a fence that is open for several frames, which is the
    // case the reader has to survive.
    const chunks = answer.match(/[\s\S]{1,40}/g) ?? [answer];

    const emit = (event: AgentEvent): void => {
      state.listener?.(event);
    };
    const base = {
      dspatchSessionId: sessionId,
      dspatchRunId,
      rawProviderEvent: { source: 'presentation-local' },
    };

    // `run.started` inside `send`, before it returns, because that is the adapter
    // contract the service is written against: `ChatService.sendPrompt` holds the
    // prompt, the attempt and the recap it put in front of the message only while
    // `send` is running, and picks them up from this event ("which the adapter does
    // inside `send` before it awaits the provider"). Both real adapters keep it:
    // `CursorSdkAdapter.send` and `ClaudeAgentSdkAdapter.send` emit `run.started`
    // inside `send`, before they await the provider. Emitted on a timer, as it used to
    // be here, the event arrived after `send` had returned and the service had let go,
    // so in presentation runs no turn recorded the recap that went with it (DSP-121,
    // run 20261024-070000-dsp121-flow). The reply below keeps its timers as before.
    emit({ ...base, type: 'run.started', at: new Date().toISOString() });

    const reply = (): void => {
      chunks.forEach((chunk, index) => {
        const timer = setTimeout(
          () => {
            state.timers.delete(timer);
            if (state.activeRun !== dspatchRunId) {
              return;
            }
            emit({
              ...base,
              type: 'assistant.delta',
              at: new Date().toISOString(),
              text: chunk,
            });
            if (index === chunks.length - 1) {
              state.activeRun = null;
              // The whole answer once, the way the real adapter ends a turn.
              //
              // **This was missing, and it made the double incomplete in a way nothing
              // noticed until a loop walked through it.** `turn-routing.ts` says the
              // adapter emits this at the end with the same text the deltas carried,
              // and replaces rather than appends — so the chat path read the deltas and
              // never missed it. The loop executor reads `assistant.message` and
              // nothing else, so a loop step run through this adapter collected an
              // empty reply, routed as "could not establish" and filed nothing: the
              // trial's first run reported the product failing at something the fixture
              // had not done.
              emit({
                ...base,
                type: 'assistant.message',
                at: new Date().toISOString(),
                text: answer,
              });
              emit({
                ...base,
                type: 'run.finished',
                at: new Date().toISOString(),
                status: 'finished',
              });
            }
          },
          this.deltaMs * (index + 1),
        );
        state.timers.add(timer);
      });
    };
    if (holdMs > 0) {
      // A slow start: the run is announced, and `send` returns only after the hold.
      return new Promise<RunReference>((resolve) => {
        const timer = setTimeout(() => {
          state.timers.delete(timer);
          reply();
          resolve({ dspatchRunId });
        }, holdMs);
        state.timers.add(timer);
      });
    }
    setTimeout(reply, 0);

    return Promise.resolve({ dspatchRunId });
  }

  cancel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.activeRun === null) {
      return Promise.resolve();
    }
    const dspatchRunId = state.activeRun;
    state.activeRun = null;
    for (const timer of state.timers) {
      clearTimeout(timer);
    }
    state.timers.clear();
    state.listener?.({
      dspatchSessionId: sessionId,
      dspatchRunId,
      rawProviderEvent: { source: 'presentation-local' },
      type: 'run.finished',
      at: new Date().toISOString(),
      status: 'cancelled',
    });
    return Promise.resolve();
  }

  readUsage(): Promise<readonly UsageReading[]> {
    return Promise.resolve([]);
  }

  /**
   * Refused, and `capabilities().approvals` says `unsupported` to match.
   *
   * Present because this class now also satisfies {@link AgentAdapter}, so a loop run
   * can walk in the window with no provider call. Rejecting is the honest answer: there
   * is nothing here that could be waiting for an approval.
   */
  respondToApproval(): Promise<void> {
    return Promise.reject(
      new Error('The presentation adapter has no approvals: nothing here asks for one.'),
    );
  }

  providerMessageTypes(): Record<string, number> {
    return {};
  }

  streamPumpFinished(): boolean | null {
    return null;
  }

  modelReported(): string | null {
    return null;
  }

  dispose(): Promise<void> {
    for (const state of this.sessions.values()) {
      for (const timer of state.timers) {
        clearTimeout(timer);
      }
      state.timers.clear();
    }
    this.sessions.clear();
    return Promise.resolve();
  }
}
