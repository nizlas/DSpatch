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

interface SessionState {
  readonly dspatchSessionId: string;
  listener: AgentEventListener | null;
  runCounter: number;
  activeRun: string | null;
  timers: Set<NodeJS.Timeout>;
}

export class PresentationAdapter implements ChatAdapter {
  readonly id = 'presentation-local';

  private readonly sessions = new Map<string, SessionState>();

  private sessionCounter = 0;

  /** How fast the canned reply arrives. Small enough to keep the trial short. */
  private readonly deltaMs: number;

  constructor(options: { readonly deltaMs?: number } = {}) {
    this.deltaMs = options.deltaMs ?? 45;
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  listModels(): Promise<readonly ModelInfo[]> {
    return Promise.resolve(MODELS);
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
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
    return Promise.resolve({
      dspatchSessionId,
      provider: 'cursor',
      providerSessionId: `local-${dspatchSessionId}`,
      createdAt: new Date().toISOString(),
    });
  }

  resume(sessionId: string, config: SessionConfig): Promise<SessionHandle> {
    return this.startSession({ ...config, dspatchSessionId: sessionId });
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
    state.runCounter += 1;
    const dspatchRunId = `${sessionId}-run-${String(state.runCounter)}`;
    state.activeRun = dspatchRunId;

    const token = (/\b(mark-\w+)\b/.exec(prompt)?.[1] ?? prompt.trim().slice(0, 24)) || 'this';
    const answer = presentationReply(token);
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

    setTimeout(() => {
      emit({ ...base, type: 'run.started', at: new Date().toISOString() });
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
    }, 0);

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
