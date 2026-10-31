import type {
  AgentCommandRecord,
  AgentEvent,
  AgentEventListener,
  CapabilityReport,
  ModelInfo,
  RunReference,
  SessionConfig,
  SessionHandle,
  SteerUpdate,
  Unsubscribe,
  UsageReading,
} from '../adapter/types';
import type { AgentAdapter } from '../adapter/agent-adapter';
import { simulatedReviewTask } from './presentation-review-tasks';
import type { AuthStatusReading, ChatAdapter } from './chat-service';

/** SIMULATED: what `[[tools]]` reports for a chat turn. */
const CHAT_TURN_TOOLS = [
  { name: 'Read', subject: 'README.md', ok: true },
  { name: 'Grep', subject: 'share', ok: true },
  { name: 'Bash', subject: 'cd /tmp && ls && cat README.md', ok: true },
] as const;

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

/**
 * DSP-152: a stand-in shaped like a Claude account's own listing (`supportedModels()` as
 * recorded in DSP-149: a `default` alias resolving to a model, then aliases such as
 * `opus`), for trials of how windows treat aliases. SIMULATED: no account was asked.
 */
export const CLAUDE_SHAPED_MODELS: readonly ModelInfo[] = [
  { id: 'default', displayName: 'Default (recommended)', provider: 'claude', resolvedId: 'claude-opus-5-5' },
  { id: 'opus', displayName: 'Opus 5.5', provider: 'claude', resolvedId: 'claude-opus-5-5' },
  { id: 'sonnet', displayName: 'Sonnet 5.5', provider: 'claude', resolvedId: 'claude-sonnet-5-5' },
  { id: 'haiku', displayName: 'Haiku 5.5', provider: 'claude', resolvedId: 'claude-haiku-5-5' },
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

  /** DSP-152: the agent and model each session was opened for, as the adapter got them. */
  private readonly starts: { readonly provider: string; readonly modelRequested: string }[] = [];

  /** The model each `send()` reached the adapter with, in order. */
  private readonly sendModels: string[] = [];

  /** DSP-152: which agent the factory was asked to build each time, in order. */
  private readonly built: string[] = [];

  /**
   * DSP-152: when set, every session start is refused with this SIMULATED text, shaped
   * like a provider's own error, so the window's handling of a start failure can be seen.
   */
  startFailure: string | null = null;

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

  recordSendModel(modelRequested: string): void {
    this.sendModels.push(modelRequested);
  }

  recordStartSession(config?: Pick<SessionConfig, 'provider' | 'modelRequested'>): void {
    this.startSessionCount += 1;
    if (config !== undefined) {
      this.starts.push({ provider: config.provider, modelRequested: config.modelRequested });
    }
    if (this.startFailure !== null) {
      throw Object.assign(new Error(this.startFailure), { name: 'PresentationStartFailed' });
    }
  }

  recordBuilt(provider: string): void {
    this.built.push(provider);
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
    readonly starts: readonly { readonly provider: string; readonly modelRequested: string }[];
    readonly sendModels: readonly string[];
    readonly built: readonly string[];
  } {
    return {
      mode: this.mode,
      simulated: true,
      resumeAttempts: [...this.attempts],
      startSessionCalls: this.startSessionCount,
      sent: [...this.sentTexts],
      starts: [...this.starts],
      sendModels: [...this.sendModels],
      built: [...this.built],
    };
  }
}

interface SessionState {
  readonly dspatchSessionId: string;
  /** DSP-149: what the session was given: its folders and DSpatch's app tools. */
  config: SessionConfig;
  listener: AgentEventListener | null;
  runCounter: number;
  activeRun: string | null;
  timers: Set<NodeJS.Timeout>;
  /** DSP-147: steering messages accepted for the running turn and not yet folded in. */
  steers: { readonly text: string; readonly settle: (update: SteerUpdate) => void }[];
  /** DSP-147: how the running turn answers a steering message (from its prompt's directives). */
  steerMode: 'fold' | 'late' | 'decline';
  /** DSP-147, SIMULATED: a cancel of the running turn ends without a confirmed local end. */
  cancelUnconfirmed: boolean;
  /** SIMULATED: the review questions asked in this session so far, as a session remembers them. */
  asked: string[];
}

export class PresentationAdapter implements ChatAdapter, AgentAdapter {
  readonly id = 'presentation-local';

  private readonly sessions = new Map<string, SessionState>();

  private sessionCounter = 0;

  /** How fast the canned reply arrives. Small enough to keep the trial short. */
  private readonly deltaMs: number;

  /** How `resume()` answers, and the record of what was asked. `ok` unless given. */
  private readonly behaviour: PresentationResumeBehaviour;

  /** The listing, and how long it takes to arrive, as a real lookup is not immediate. */
  private readonly models: readonly ModelInfo[] | (() => readonly ModelInfo[]);

  private readonly listDelayMs: number;

  constructor(
    options: {
      readonly deltaMs?: number;
      readonly resume?: PresentationResumeBehaviour;
      readonly models?: readonly ModelInfo[] | (() => readonly ModelInfo[]);
      readonly listDelayMs?: number;
    } = {},
  ) {
    this.deltaMs = options.deltaMs ?? 45;
    this.models = options.models ?? MODELS;
    this.listDelayMs = options.listDelayMs ?? 0;
    this.behaviour = options.resume ?? new PresentationResumeBehaviour('ok');
  }

  capabilities(): CapabilityReport {
    return CAPABILITIES;
  }

  listModels(): Promise<readonly ModelInfo[]> {
    const models = typeof this.models === 'function' ? this.models() : this.models;
    if (this.listDelayMs === 0) {
      return Promise.resolve(models);
    }
    return new Promise((resolve) => {
      setTimeout(() => resolve(models), this.listDelayMs);
    });
  }

  startSession(config: SessionConfig): Promise<SessionHandle> {
    try {
      this.behaviour.recordStartSession(config);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
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
      config,
      listener: null,
      runCounter: 0,
      activeRun: null,
      timers: new Set(),
      steers: [],
      steerMode: 'fold',
      cancelUnconfirmed: false,
      asked: [],
    });
    return {
      dspatchSessionId,
      // The provider the session was opened for (DSP-117), so a simulated Claude
      // session is recorded as one. Still SIMULATED: nothing here is either provider.
      provider: config.provider === 'claude' ? 'claude' : config.provider === 'copilot' ? 'copilot' : 'cursor',
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

  /** DSP-149: the model the next simulated turn asks for. */
  setSessionModel(sessionId: string, modelId: string): void {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) {
      state.config = { ...state.config, modelRequested: modelId };
    }
  }

  /** DSP-149: the folders changed; the next simulated turn reports the new list. */
  setWorkspaceRoots(sessionId: string, roots: readonly string[]): void {
    const state = this.sessions.get(sessionId);
    if (state !== undefined) {
      state.config = { ...state.config, workspacePaths: [...roots] };
    }
  }

  /**
   * SIMULATED provider behaviour for DSP-149's window trial, in presentation mode only.
   * `[[tool NAME {json}]]` in a prompt calls that app tool with those arguments, as a
   * model would through its SDK's tool mechanism; `[[folders]]` answers with the folders
   * the session was given. The tools are the session's own `appTools`, the host's real
   * functions. Nothing else in a prompt is acted on.
   */
  private async simulatedTools(
    state: SessionState,
    prompt: string,
    base: { readonly dspatchSessionId: string; readonly dspatchRunId: string; readonly rawProviderEvent: unknown },
    emit: (event: AgentEvent) => void,
  ): Promise<string[]> {
    const lines: string[] = [];
    // Only the person's new message: a recap DSpatch put in front of it repeats earlier
    // messages, and their tool directives were acted on when those messages were sent.
    const marker = '=== end of the record. The message below is the new one, from the person. ===';
    const at = prompt.lastIndexOf(marker);
    const own = at === -1 ? prompt : prompt.slice(at + marker.length);
    if (own.includes('[[context]]')) {
      // DSP-149: whether DSpatch's record of the earlier conversation came in front of
      // this message, and how many earlier messages it held.
      const record = at === -1 ? '' : prompt.slice(0, at);
      const messages = record.split('\n--- message ').length - 1;
      lines.push(
        at === -1
          ? 'Earlier conversation received: no'
          : `Earlier conversation received: yes, ${String(messages)} earlier messages`,
      );
    }
    if (own.includes('[[model]]')) {
      // DSP-149: the model id this turn reached the adapter with, as it arrived.
      lines.push(`Model requested by this turn: ${state.config.modelRequested === '' ? '(provider default)' : state.config.modelRequested}`);
    }
    if (own.includes('[[folders]]')) {
      const roots = [state.config.workspacePath, ...(state.config.workspacePaths ?? []).slice(1)];
      lines.push(`Working folders given to this session: ${roots.join(' | ')}`);
    }
    let index = 0;
    for (const match of own.matchAll(/\[\[tool (\w+) (\{.*?\})\]\]/g)) {
      const name = match[1] ?? '';
      const tool = (state.config.appTools ?? []).find((entry) => entry.name === name);
      index += 1;
      const toolCallId = `${base.dspatchRunId}-tool-${String(index)}`;
      emit({ ...base, type: 'tool.started', at: new Date().toISOString(), toolCallId, name });
      let text: string;
      let ok = false;
      if (tool === undefined) {
        text = `The tool ${name} was not given to this session.`;
      } else {
        try {
          const outcome = await tool.execute(JSON.parse(match[2] ?? '{}') as Record<string, unknown>);
          text = outcome.text;
          ok = !outcome.isError;
        } catch (error) {
          text = `The tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
      emit({ ...base, type: 'tool.finished', at: new Date().toISOString(), toolCallId, name, status: ok ? 'ok' : 'error' });
      lines.push(`Tool ${name}: ${text}`);
    }
    return lines;
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
    this.behaviour.recordSendModel(state.config.modelRequested);
    let holdMs: number;
    try {
      holdMs = this.behaviour.decideSend(prompt);
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    state.runCounter += 1;
    const dspatchRunId = `${sessionId}-run-${String(state.runCounter)}`;
    state.activeRun = dspatchRunId;
    // DSP-147, SIMULATED: `[[slow]]` makes the turn last long enough to be steered;
    // `[[steer-late]]` answers a steering message as a turn that ended at that instant;
    // `[[steer-declined]]` as a runtime that declines it. Read from the whole prompt, so a
    // loop's mandate sets them for every step.
    // `[[very-slow]]` (DSP-28 follow-up) holds a loop step open long enough for a window
    // to be opened in the middle of it.
    const deltaMs = prompt.includes('[[very-slow]]')
      ? Math.max(this.deltaMs, 1_200)
      : prompt.includes('[[slow]]')
        ? Math.max(this.deltaMs, 300)
        : this.deltaMs;
    state.steerMode = prompt.includes('[[steer-late]]')
      ? 'late'
      : prompt.includes('[[steer-declined]]')
        ? 'decline'
        : 'fold';
    state.steers = [];
    state.cancelUnconfirmed = prompt.includes('[[cancel-unconfirmed]]');
    const heard: string[] = [];

    const token = (/\b(mark-\w+)\b/.exec(prompt)?.[1] ?? prompt.trim().slice(0, 24)) || 'this';
    // A loop step is answered with a declared outcome; an ordinary chat turn is not.
    // Appended rather than folded in, so the Markdown the presentation scenarios read
    // is byte for byte what it was and only a loop prompt sees anything new.
    const declared = firstOfferedOutcome(prompt);
    let answer =
      declared === null
        ? presentationReply(token)
        : `${presentationReply(token)}\n\nRESULT: ${declared}`;
    // DSP-152, SIMULATED: an analysis task (walks, a delegated review, a step question),
    // answered by reading the revision folder the session runs in, as the real agent does.
    const task = simulatedReviewTask(prompt, state.config.workspacePath, state.asked);
    answer = task?.answer ?? answer;
    // An analysis task reads before it answers: long enough to be stopped, as a real one is,
    // whether or not the revision folder had to be written first (a discussion may hold it).
    const toolMs = Math.max(0, Number(process.env['DSPATCH_PRESENTATION_TOOL_MS'] ?? '0') || 0);
    const lead = (task === null ? 0 : 400) + toolMs * (task?.tools.length ?? (prompt.includes('[[tools]]') ? CHAT_TURN_TOOLS.length : 0));
    // Chunked on whitespace, so what arrives is the partial text a real stream
    // produces — including a fence that is open for several frames, which is the
    // case the reader has to survive.
    let chunks = answer.match(/[\s\S]{1,40}/g) ?? [answer];

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
    // DSP-152, SIMULATED: the reads and searches the analysis task made, reported as the
    // Claude adapter reports its Read and Grep calls, with the path they used. With
    // DSPATCH_PRESENTATION_TOOL_MS (30 October 2026) each call takes that long, as a real
    // read does, so what the agent is doing can be seen while it works; by default none.
    // `[[tools]]`: the same for a chat turn, with a command among them.
    const tools = task?.tools ?? (prompt.includes('[[tools]]') ? CHAT_TURN_TOOLS : []);
    tools.forEach((tool, index) => {
      const toolCallId = `${dspatchRunId}-read-${String(index + 1)}`;
      const call = (): void => {
        if (state.activeRun !== dspatchRunId) {
          return;
        }
        emit({ ...base, type: 'tool.started', at: new Date().toISOString(), toolCallId, name: tool.name, subject: tool.subject });
        if (tool.name === 'Bash') {
          const startedAtUtc = new Date().toISOString();
          const record: AgentCommandRecord = {
            commandId: toolCallId,
            requestedBy: 'provider-reported',
            line: tool.subject,
            shell: 'sh -c',
            cwd: state.config.workspacePath,
            pid: null,
            startedAtUtc,
            finishedAtUtc: startedAtUtc,
            durationMs: 2_700,
            timeoutMs: null,
            ending: 'exited',
            endingMessage: null,
            exitCode: 0,
            signal: null,
            killedByDspatch: false,
            stdout: '',
            stderr: '',
            outputTruncated: false,
            outputNote: null,
            testedSnapshotId: null,
            afterRunSnapshotId: null,
            snapshotRoots: [],
          };
          emit({ ...base, type: 'command.started', at: startedAtUtc, toolCallId, commandId: toolCallId, line: tool.subject, cwd: state.config.workspacePath });
          emit({ ...base, type: 'command.finished', at: new Date().toISOString(), toolCallId, command: record });
        }
        emit({ ...base, type: 'tool.finished', at: new Date().toISOString(), toolCallId, name: tool.name, status: tool.ok ? 'ok' : 'error' });
      };
      if (toolMs === 0) {
        call();
        return;
      }
      const timer = setTimeout(() => {
        state.timers.delete(timer);
        call();
      }, toolMs * index);
      state.timers.add(timer);
    });

    const reply = (): void => {
      // `[[fail]]`, SIMULATED: the turn ends as a provider's error does, after its tools.
      if (prompt.includes('[[fail]]')) {
        const timer = setTimeout(() => {
          state.timers.delete(timer);
          state.activeRun = null;
          emit({ ...base, type: 'run.finished', at: new Date().toISOString(), status: 'error', error: { message: 'SIMULATED: the provider stopped this turn.' } });
        }, lead);
        state.timers.add(timer);
        return;
      }
      chunks.forEach((chunk, index) => {
        const timer = setTimeout(
          () => {
            state.timers.delete(timer);
            if (state.activeRun !== dspatchRunId) {
              return;
            }
            // DSP-147, SIMULATED: a steering message is folded into the turn at its next
            // step, as Claude Code folds a queued message in between tool rounds.
            for (const steer of state.steers.splice(0)) {
              heard.push(steer.text);
              steer.settle({ state: 'delivered', dspatchRunId, detail: 'SIMULATED: folded into the turn.' });
            }
            emit({
              ...base,
              type: 'assistant.delta',
              at: new Date().toISOString(),
              text: chunk,
            });
            if (index === chunks.length - 1) {
              if (heard.length > 0) {
                answer = `${answer}\n\n${heard.map((text) => `Steering taken into this turn: ${text}`).join('\n\n')}`;
              }
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
          lead + deltaMs * (index + 1),
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
    // DSP-149: any simulated tool calls run first, and their results are part of the reply.
    const withTools = (): void => {
      void this.simulatedTools(state, prompt, base, emit).then((lines) => {
        if (lines.length > 0) {
          answer = `${answer}\n\n${lines.join('\n\n')}`;
          chunks = answer.match(/[\s\S]{1,40}/g) ?? [answer];
        }
        reply();
      });
    };
    setTimeout(withTools, 0);

    return Promise.resolve({ dspatchRunId });
  }

  /**
   * DSP-147, SIMULATED steering, shaped like the Claude adapter's: accepted at once for a
   * running turn, delivered when the turn folds it in at its next step, not delivered when
   * the turn ends or is cancelled first. Nothing here is a provider.
   */
  steer(sessionId: string, text: string, onUpdate?: (update: SteerUpdate) => void): Promise<SteerUpdate> {
    const state = this.sessions.get(sessionId);
    const dspatchRunId = state?.activeRun ?? null;
    if (state === undefined || dspatchRunId === null || state.steerMode === 'late') {
      return Promise.resolve({
        state: 'not-delivered',
        reason: 'no-running-turn',
        detail: 'SIMULATED: the turn had ended.',
      });
    }
    if (state.steerMode === 'decline') {
      return Promise.resolve({
        state: 'not-delivered',
        reason: 'declined',
        dspatchRunId,
        detail: 'SIMULATED: the runtime declined the message for the running turn.',
      });
    }
    return new Promise<SteerUpdate>((resolve) => {
      state.steers.push({ text, settle: resolve });
      onUpdate?.({ state: 'accepted', dspatchRunId });
    });
  }

  cancel(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (state === undefined || state.activeRun === null) {
      return Promise.resolve();
    }
    const dspatchRunId = state.activeRun;
    state.activeRun = null;
    for (const steer of state.steers.splice(0)) {
      steer.settle({ state: 'not-delivered', reason: 'cancelled', dspatchRunId, detail: 'SIMULATED: cancelled first.' });
    }
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
      // DSP-147, SIMULATED: `[[cancel-unconfirmed]]` reports the end as the Claude adapter
      // does when it stops waiting without seeing its process exit.
      // `DSPATCH_PRESENTATION_UNCONFIRMED_STOP=1` does so for every cancel, for a run whose
      // prompts come from a drawing and cannot carry the directive (the graph editor's).
      ...(state.cancelUnconfirmed || process.env['DSPATCH_PRESENTATION_UNCONFIRMED_STOP'] === '1'
        ? { end: 'unconfirmed' as const }
        : {}),
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
