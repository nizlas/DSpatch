import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { REVIEW_PERMISSIONS } from '../adapter/claude-agent-sdk-adapter';
import type { AgentEvent, Unsubscribe } from '../adapter/types';
import { saysSessionAlreadyHasARun } from '../shared/session-run-block';
import {
  REVIEW_DISCUSSION_INSTRUCTION,
  adoptDiscussionRecord,
  buildEnvelopePrompt,
  deepenFrom,
  emptyDiscussionRecord,
  recapFor,
  splitCodeAnswer,
  subjectLine,
  type DiscussionAgentView,
  type DiscussionCancelOutcome,
  type DiscussionChooseOutcome,
  type DiscussionIdentity,
  type DiscussionProvider,
  type DiscussionLoadOutcome,
  type DiscussionMessage,
  type DiscussionRecord,
  type DiscussionRequest,
  type DiscussionSendInput,
  type DiscussionSendOutcome,
  type DiscussionStatus,
  type DiscussionStatusView,
  type ContextEnvelope,
  type EnvelopeOutcome,
  type SimplifySection,
  type ReviewDiscussionEvent,
} from '../shared/review-discussion';
import type { StepAnswer } from '../shared/review-pair';
import { AttemptLedger } from './attempt-ledger';
// DSP-132: the only thing taken from the chat - its adapter interface, as a type. No route
// to the chat service or the loop runner exists from here (an import scan pins it).
import type { ChatAdapter } from './chat-service';

/*
 * A discussion about the code under review (DSP-127): one per review, with its own
 * adapter instance, its own session, its own attempt ledger and its own file.
 *
 * **Not a second `ChatService`.** That service is built around one working-copy
 * session (baseline snapshots, test runs, the working-copy repeat block, the project's
 * conversation, `ensureAdapter` replacing the adapter with the session); a review
 * question has none of those. What is shared is the adapter *interface*
 * (`ChatAdapter`), the `AttemptLedger` and the protections the main chat learned the
 * hard way, mirrored here rather than shared, so `sendPrompt` is untouched:
 *
 * | Protection here | Mirrors in `chat-service.ts` |
 * | --- | --- |
 * | question and attempt saved before `adapter.send` | `sendPrompt`: `ledger.open` then `saveConversation()` before `send` |
 * | Stop before the run exists: `outcome-unknown`, the run cancelled when it appears | `abandonSend`, `abandonedAttempts`, `stopAbandonedRun` |
 * | a requested cancel is unknown, not stopped, unless an end arrives in time | `armCancelConfirmation`, `cancelConfirmWindow`, `CANCEL_CONFIRM_MS`, `CANCEL_CONFIRM_GRACE_MS` |
 * | a terminal event settles the attempt of *its* run | `onAgentEvent`'s `run.finished` branch (incl. DSP-116's `end`) |
 * | events from another session are dropped | `onAgentEvent`'s first guard |
 * | "already has a run": ours or the provider's, read from the adapter | `saysSessionAlreadyHasARun`, `hasActiveRun`, `explainSessionHoldsARun` |
 * | an unknown outcome blocks the next send until acknowledged | `AttemptLedger.mayRepeat` (DSP-6, DSP-124's explicit acknowledgement) |
 * | errors as `name: message`, the person's text kept | `describeError` |
 *
 * **Gates (Niclas's decision 2, with its caveat).** A review question is not blocked
 * by a running loop or a main-chat turn, and does not block them: it uses neither the
 * working-copy repeat block nor the loop lock. That rests on "a text-only turn in an
 * empty folder writes nothing", and whether `tools: []` also removes user-level MCP
 * tools is undocumented and unobserved, so the premise is not fully established.
 *
 * **Read-only by construction, as far as DSpatch can make it.** The adapter is
 * created with `toolPolicy: 'text-only'` (`tools: []`) and its session's working
 * folder is an empty folder DSpatch owns, so the reviewed repository's own project
 * rules, hooks and ignore files are not loaded either. Cursor's user-level rules and
 * hooks may still apply; what the provider adds is unknown, and every message's
 * Context says so.
 *
 * **Reading the code (Niclas's decision of 30 October 2026).** A question may need code
 * the envelope does not hold — the definition of a type it names, say — and the agent
 * looks it up rather than guessing. With `codeAccess`, an agent that has a read-only
 * analysis policy (Claude) gets the analysis access the walk preparation uses: its session
 * runs in the folder the host writes the two revisions to (`RevisionSnapshots`, held while
 * the session is open and released when it closes), and its adapter must hold exactly the
 * analysis policy (Read, Glob and Grep inside that folder), or nothing is sent. Every
 * reference it gives is checked against Git at its commit before it is shown. Cursor has
 * no read-only policy and stays tool-free, as before. The gate above still holds: the
 * folder is DSpatch's own, never the working copy, and nothing in it is written back.
 */

/** Without a declared adapter bound: how long a cancel is given to be confirmed (chat: `CANCEL_CONFIRM_MS`). */
const CANCEL_CONFIRM_MS = 10_000;

/** Extra time after an adapter's declared bound (chat: `CANCEL_CONFIRM_GRACE_MS`). */
const CANCEL_CONFIRM_GRACE_MS = 1_000;

/** The model asked for when nothing else is named: the main chat's default. */
export const REVIEW_DISCUSSION_DEFAULT_MODEL = 'claude-haiku-4-5';

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? String(seconds) : String(Math.round(seconds * 10) / 10);
}

/** Where a discussion's record is kept: beside the reviewer's record, with the same key. */
export function discussionRecordPath(recordsDir: string, key: string): string {
  return path.join(recordsDir, `${key}.discussion.json`);
}

/** The DSpatch-owned empty folder a discussion's session runs in. Never the reviewed repository. */
export function discussionWorkingFolder(recordsDir: string, key: string): string {
  return path.join(recordsDir, 'discussion-cwd', key);
}

/**
 * The one purpose the review path asks adapters for (DSP-132, plan review A2). Bound
 * once, when {@link ReviewDiscussions} is constructed: no call site here can ask for the
 * chat's policy, and every adapter built is checked against the review's.
 */
export const REVIEW_ADAPTER_PURPOSE = 'review' as const;

/** What the review asks the shared factory (`provider-adapters.ts`) for. */
export interface ReviewAdapterRequest {
  readonly provider: DiscussionProvider;
  readonly purpose: typeof REVIEW_ADAPTER_PURPOSE;
}

/** Whether an agent can be chosen in this launch, and why not (`provider-availability.ts`). */
export type DiscussionAvailability = (provider: DiscussionProvider) => {
  readonly choosable: boolean;
  readonly reason: string | null;
};

/** The agents offered, in this order. */
const DISCUSSION_PROVIDERS: readonly DiscussionProvider[] = ['cursor', 'claude'];

function providerName(provider: DiscussionProvider): string {
  return provider === 'claude' ? 'Claude' : 'Cursor';
}

/** What each agent is given here when nothing else is said (tests); main passes the real lines. */
function defaultPolicyLine(provider: DiscussionProvider): string {
  return provider === 'claude' ? 'the review policy (no tools)' : 'text-only (tools: [])';
}

/**
 * The two revisions as files, held for one discussion session (Niclas's decision of 30
 * October 2026). The host writes and removes the folder; the service only holds it.
 */
export interface HeldRevisions {
  readonly folder: string;
  /** What the prompt says about the folder: what it holds and what could not be written. */
  readonly section: string;
  /** Check an answer's references against Git at the two commits, never against the folder. */
  readonly check: (raw: unknown) => Promise<StepAnswer | { readonly error: string }>;
  readonly release: () => void;
}

/** Read access to the two revisions for a discussion, from the host's analysis machinery. */
export interface DiscussionCodeAccess {
  /** Whether this agent can read the revisions: only one with a read-only analysis policy. */
  readonly offered: (provider: DiscussionProvider) => boolean;
  /** An adapter built for the analysis purpose. */
  readonly createAdapter: (provider: DiscussionProvider) => ChatAdapter;
  /** The analysis policy an adapter must hold exactly; anything else is refused. */
  readonly policy: unknown;
  /** The policy as one line, for the window and each question's Context. */
  readonly policyLine: string;
  /** Write (or share) the two revisions as files, held by `holder` until released. */
  readonly hold: (identity: DiscussionIdentity, holder: string) => Promise<HeldRevisions>;
}

/** What builds the envelope: the asking window's own `ReviewService`. */
export interface EnvelopeSource {
  envelopeFor(request: unknown): Promise<EnvelopeOutcome>;
}

/** One window showing this review, as the service sees it: something to send events to. */
export type DiscussionTargetSend = (event: ReviewDiscussionEvent) => void;

export interface ReviewDiscussionServiceOptions {
  readonly identity: DiscussionIdentity;
  /** `userData/reviews`. */
  readonly recordsDir: string;
  /** Bound to the review purpose by {@link ReviewDiscussions}; never asked for another. */
  readonly createAdapter: (provider: DiscussionProvider) => ChatAdapter;
  readonly log: (message: string) => void;
  /** The model asked for of Cursor. {@link REVIEW_DISCUSSION_DEFAULT_MODEL} when absent. */
  readonly model?: string;
  /** DSP-132: the model asked for, per agent. Overrides `model` when given. */
  readonly modelFor?: (provider: DiscussionProvider) => string;
  /** DSP-132: which agents can be chosen in this launch. Every one, when absent (tests). */
  readonly availability?: DiscussionAvailability;
  /** DSP-132: the tool policy each agent is given here, as one line, for the window. */
  readonly policyFor?: (provider: DiscussionProvider) => string;
  /** Test overrides for the confirmation window. Production passes nothing. */
  readonly timings?: { readonly cancelConfirmMs?: number; readonly cancelConfirmGraceMs?: number };
  /** Read access to the two revisions, for the agents that can be given it. None in tests that leave it out. */
  readonly codeAccess?: DiscussionCodeAccess;
}

type MutableMessage = { -readonly [K in keyof DiscussionMessage]: DiscussionMessage[K] };

interface Turn {
  readonly questionId: string;
  answerId: string | null;
  readonly attemptId: string;
  runId: string | null;
  /** `adapter.send` has not returned yet: no run exists that `cancel()` could act on. */
  sendPending: boolean;
  stopping: boolean;
  /** With code access: the files read in this turn, and the tool calls not yet finished. */
  readonly reads: string[];
  readonly calls: Map<string, { readonly name: string; readonly subject: string | null }>;
}

interface Session {
  readonly adapter: ChatAdapter;
  readonly provider: DiscussionProvider;
  readonly sessionId: string;
  readonly unsubscribe: Unsubscribe;
  /** Questions sent in this session; the first of a new session carries the recap. */
  sends: number;
  /** The revisions the session reads, when it was given code access; released when it closes. */
  readonly revisions: HeldRevisions | null;
}

export class ReviewDiscussionService {
  readonly identity: DiscussionIdentity;

  private readonly options: ReviewDiscussionServiceOptions;

  private readonly ledger = new AttemptLedger();

  private messages: MutableMessage[] = [];

  private draft = '';

  /** Why the stored file must not be written, when it must not. */
  private readOnly: string | null = null;

  /** Something to tell the window once about the stored file. */
  private loadNote: string | null = null;

  /**
   * DSP-132: the agent this discussion uses, or `null` when none is chosen. A stored
   * choice wins on reopen; a default (from the main window) applies only to a new,
   * empty discussion; nothing ever replaces a choice that cannot be used.
   */
  private provider: DiscussionProvider | null = null;

  /** DSP-132: after a switch, until the next question goes; `leftOut` drops the recap. */
  private switchNotice: { provider: DiscussionProvider; leftOut: boolean } | null = null;

  private session: Session | null = null;

  /** Starting a session, so two quick sends cannot start two. */
  private starting: Promise<Session> | null = null;

  /** The answer being waited for. One at a time. */
  private turn: Turn | null = null;

  /** A send is being prepared (envelope, session) and has not reached the ledger yet. */
  private preparing = false;

  /** Turns whose `adapter.send` is still pending, the current one or an abandoned one. */
  private pendingSends = 0;

  /** The turn whose `send` is running: `run.started` arrives inside it (chat: `pendingAttemptId`). */
  private pendingTurn: Turn | null = null;

  /** Every run this discussion started, so a late event lands on its own question. */
  private readonly runs = new Map<string, Turn>();

  /** Stop was pressed before a run existed (chat: `abandonedAttempts`). */
  private readonly abandoned = new Set<string>();

  private readonly targets = new Map<number, DiscussionTargetSend>();

  private closedForQuit = false;

  private messageCounter = 0;

  /** Sessions started, so each holds the revisions under a name of its own. */
  private sessionCounter = 0;

  /** Events dropped because they named another session. */
  foreignEventsDropped = 0;

  constructor(options: ReviewDiscussionServiceOptions) {
    this.options = options;
    this.identity = options.identity;
    this.readStored();
  }

  // --- Reading and writing the record ------------------------------------------

  private recordPath(): string {
    return discussionRecordPath(this.options.recordsDir, this.identity.key);
  }

  private readStored(): void {
    const file = this.recordPath();
    if (!fs.existsSync(file)) {
      return;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      raw = null;
    }
    const adopted = adoptDiscussionRecord(raw, this.identity);
    if (adopted.kind === 'newer') {
      this.readOnly = adopted.problem;
      this.loadNote = adopted.problem;
      return;
    }
    if (adopted.kind === 'unusable') {
      // Kept aside, never overwritten: it may be the only copy of someone's discussion.
      const aside = `${file}.unusable-${nowIso().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(file, aside);
        this.loadNote = `The stored discussion could not be read (${adopted.problem}) and was kept aside as ${aside}. This discussion starts empty.`;
      } catch (error) {
        this.readOnly = `The stored discussion could not be read (${adopted.problem}) or moved aside (${describeError(error)}), so it is not written over.`;
        this.loadNote = this.readOnly;
      }
      return;
    }
    const record = adopted.record;
    // DSP-132: the stored agent; a format 1 file with questions was always Cursor's. Read
    // only - nothing is written here, so the file stays as it was until a real write.
    this.provider =
      record.provider ?? (adopted.fromVersion === 1 && record.messages.length > 0 ? 'cursor' : null);
    this.messages = record.messages.map((message) => ({ ...message }));
    this.draft = record.draft;
    const restored = this.ledger.restore(record.attempts);
    if (restored.reconciliations.some((entry) => entry.blocksRepeat)) {
      this.loadNote =
        'An earlier question in this discussion has no known outcome: DSpatch closed, or stopped waiting, before its answer ended. ' +
        'Nothing has been sent again. Acknowledge it to ask the next question.';
    }
    this.messageCounter = this.messages.length;
  }

  private persistable(): DiscussionRecord {
    return {
      ...emptyDiscussionRecord(this.identity),
      messages: this.messages.map((message) => ({ ...message })),
      attempts: this.ledger.persistable(),
      draft: this.draft,
      savedAt: nowIso(),
      ...(this.provider === null ? {} : { provider: this.provider }),
    };
  }

  /** Written whole to a temporary file and renamed. Never for a read-only record. */
  private save(): { saved: boolean; error?: string } {
    if (this.readOnly !== null) {
      return { saved: false, error: this.readOnly };
    }
    try {
      const file = this.recordPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(this.persistable(), null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, file);
      return { saved: true };
    } catch (error) {
      const message = describeError(error);
      this.options.log(`review discussion ${this.identity.key}: could not be saved (${message})`);
      return { saved: false, error: message };
    }
  }

  // --- Windows -------------------------------------------------------------------

  /**
   * A window showing this review. A window that comes back while an answer is still
   * arriving is the event target from now on and is told where the turn stands.
   */
  attach(targetId: number, send: DiscussionTargetSend): void {
    this.targets.set(targetId, send);
  }

  /** A window has gone. With no window left and no turn running, the adapter is closed. */
  detach(targetId: number): void {
    this.targets.delete(targetId);
    void this.closeIdleAdapter();
  }

  /** How many windows are showing this review. */
  targetCount(): number {
    return this.targets.size;
  }

  private emit(event: ReviewDiscussionEvent): void {
    for (const send of this.targets.values()) {
      try {
        send(event);
      } catch (error) {
        this.options.log(`review discussion ${this.identity.key}: an event could not be delivered (${describeError(error)})`);
      }
    }
  }

  private emitMessage(message: MutableMessage): void {
    this.emit({ kind: 'message', message: { ...message } });
  }

  private emitStatus(note?: string): void {
    this.emit({ kind: 'status', status: this.status(), ...(note === undefined ? {} : { note }) });
  }

  status(): DiscussionStatusView {
    const unresolved = this.ledger.unresolved('agent-turn');
    const decision = this.ledger.mayRepeat('agent-turn');
    return {
      turn:
        this.turn === null
          ? null
          : {
              questionId: this.turn.questionId,
              answerId: this.turn.answerId,
              attemptId: this.turn.attemptId,
              dspatchRunId: this.turn.runId,
              stopping: this.turn.stopping,
            },
      unresolved: unresolved.map((attempt) => ({
        attemptId: attempt.attemptId,
        label: attempt.label,
        state: attempt.state,
        reason: attempt.stateReason,
        acknowledged: attempt.acknowledgedAtUtc !== null,
      })),
      needsAcknowledgement: decision.allowed ? [] : decision.acknowledgeableAttemptIds,
      readOnly: this.readOnly,
      agent: this.agentView(),
    };
  }

  // --- The agent (DSP-132) ------------------------------------------------------------

  private availabilityOf(provider: DiscussionProvider): { choosable: boolean; reason: string | null } {
    return this.options.availability?.(provider) ?? { choosable: true, reason: null };
  }

  private policyLine(provider: DiscussionProvider): string {
    const access = this.options.codeAccess;
    if (access !== undefined && access.offered(provider)) {
      return access.policyLine;
    }
    return this.options.policyFor?.(provider) ?? defaultPolicyLine(provider);
  }

  /** Close a session: its adapter first, then the revisions it read, so nothing reads them after. */
  private async closeSession(session: Session): Promise<void> {
    session.unsubscribe();
    try {
      await session.adapter.dispose();
    } finally {
      session.revisions?.release();
    }
  }

  private agentView(): DiscussionAgentView {
    const provider = this.provider;
    const notice = this.switchNotice;
    const recap = notice === null ? '' : recapFor(this.messages);
    return {
      provider,
      unavailable: provider === null ? null : this.availabilityOf(provider).reason,
      options: DISCUSSION_PROVIDERS.map((option) => ({ provider: option, ...this.availabilityOf(option) })),
      policy: provider === null ? null : this.policyLine(provider),
      switchNotice:
        notice === null || recap === ''
          ? null
          : {
              provider: notice.provider,
              // The exchanges the recap actually carries (it is bounded), not every question.
              exchanges: (recap.match(/^Q \(/gm) ?? []).length,
              recap,
              leftOut: notice.leftOut,
            },
    };
  }

  /**
   * The main window's agent, offered as the default when this window opened review
   * (DSP-132). Taken only by a new discussion - nothing stored, no agent chosen - and
   * only in memory: nothing is written until a real write. A default that cannot be
   * used in this launch is not taken (R-1): the discussion then asks for a choice.
   */
  offerDefault(provider: DiscussionProvider | null | undefined): void {
    if (provider === undefined || provider === null || this.provider !== null || this.messages.length > 0) {
      return;
    }
    if (!this.availabilityOf(provider).choosable) {
      return;
    }
    this.provider = provider;
  }

  /**
   * Choose the discussion's agent (DSP-132). Creates no adapter and no session; an open
   * session of the previous agent is closed, so the next question starts a new one,
   * with the recap disclosed beforehand. Refused while an answer is on its way, and for
   * an agent that cannot be chosen (its reason is the answer).
   */
  async chooseAgent(provider: unknown): Promise<DiscussionChooseOutcome> {
    if (provider !== 'cursor' && provider !== 'claude') {
      return { kind: 'refused', error: 'Unknown agent.' };
    }
    if (this.readOnly !== null) {
      return { kind: 'refused', error: `This discussion cannot be written: ${this.readOnly}` };
    }
    if (this.turn !== null || this.preparing || this.starting !== null) {
      return { kind: 'refused', error: 'An answer is on its way. The agent can be changed when it has ended.' };
    }
    const availability = this.availabilityOf(provider);
    if (!availability.choosable) {
      return { kind: 'refused', error: availability.reason ?? `${providerName(provider)} cannot be used here.` };
    }
    if (provider !== this.provider) {
      const previous = this.provider;
      this.provider = provider;
      // Never resumed, never carried over: the next question starts a new session.
      const session = this.session;
      this.session = null;
      if (session !== null) {
        await this.closeSession(session).catch((error: unknown) => {
          this.options.log(`review discussion ${this.identity.key}: the previous adapter did not close cleanly (${describeError(error)})`);
        });
      }
      this.switchNotice = this.messages.some((message) => message.role === 'question') ? { provider, leftOut: false } : null;
      this.save();
      this.options.log(
        `review discussion ${this.identity.key}: agent ${previous === null ? 'chosen' : `changed from ${previous}`} -> ${provider}; no adapter built, nothing sent`,
      );
    }
    this.emitStatus();
    return { kind: 'chosen', status: this.status() };
  }

  /** Leave the recap out of the next new session's first question (or put it back). */
  setRecapLeftOut(leftOut: unknown): DiscussionStatusView {
    if (this.switchNotice !== null) {
      this.switchNotice = { ...this.switchNotice, leftOut: leftOut === true };
      this.emitStatus();
    }
    return this.status();
  }

  /** What the window shows on open. Reads the record and, for a subject, git. Never the adapter. */
  async load(request: DiscussionRequest | null, envelopes: EnvelopeSource): Promise<DiscussionLoadOutcome> {
    let line: string | null = null;
    if (request !== null) {
      const outcome = await envelopes.envelopeFor(request);
      line = outcome.kind === 'built' ? subjectLine(outcome.envelope) : null;
    }
    const note = this.loadNote;
    return {
      kind: 'loaded',
      messages: this.messages.map((message) => ({ ...message })),
      draft: this.draft,
      status: this.status(),
      subjectLine: line,
      note,
    };
  }

  saveDraft(text: unknown): { saved: boolean; error?: string } {
    if (typeof text !== 'string') {
      return { saved: false, error: 'A draft is text.' };
    }
    if (text === this.draft) {
      // Nothing changed: the file is not rewritten (DSP-132 S3 - a format 1 file stays
      // format 1 when a window only opens and shows it).
      return { saved: true };
    }
    this.draft = text;
    return this.save();
  }

  /** The person has seen these unknown outcomes and asks the next question anyway (DSP-124's pattern). */
  acknowledge(attemptIds: unknown): DiscussionStatusView {
    const ids = Array.isArray(attemptIds) ? attemptIds.filter((id): id is string => typeof id === 'string') : [];
    const unresolved = new Set(this.ledger.unresolved('agent-turn').map((attempt) => attempt.attemptId));
    for (const id of ids) {
      if (unresolved.has(id)) {
        this.ledger.acknowledge(id, 'Seen in the review discussion. The next question is sent with this attempt left unresolved; nothing was repeated.');
      }
    }
    this.save();
    this.emitStatus();
    return this.status();
  }

  // --- Asking ---------------------------------------------------------------------

  private nextId(prefix: string): string {
    this.messageCounter += 1;
    return `${prefix}-${String(this.messageCounter).padStart(4, '0')}-${Date.now().toString(36)}`;
  }

  private message(id: string): MutableMessage | null {
    return this.messages.find((message) => message.id === id) ?? null;
  }

  private setStatus(id: string | null, status: DiscussionStatus, extra: Partial<MutableMessage> = {}): void {
    const message = id === null ? null : this.message(id);
    if (message === null) {
      return;
    }
    Object.assign(message, extra, { status });
    this.emitMessage(message);
  }

  private ensureSession(provider: DiscussionProvider): Promise<Session> {
    if (this.session !== null && this.session.provider === provider) {
      return Promise.resolve(this.session);
    }
    if (this.starting !== null) {
      return this.starting;
    }
    const starting = (async (): Promise<Session> => {
      const access = this.options.codeAccess;
      const reads = access !== undefined && access.offered(provider);
      // With code access the session runs in the revisions' folder, held until it closes.
      this.sessionCounter += 1;
      const revisions = reads ? await access.hold(this.identity, `discussion-${this.identity.key}-${String(this.sessionCounter)}`) : null;
      const workspacePath = revisions?.folder ?? discussionWorkingFolder(this.options.recordsDir, this.identity.key);
      fs.mkdirSync(workspacePath, { recursive: true });
      const adapter = reads ? access.createAdapter(provider) : this.options.createAdapter(provider);
      try {
        // Plan review A2: a Claude adapter on the review path holds exactly the review's
        // policy - never the chat's, never the adapter's fixture fallback. A Claude
        // adapter that reports no policy at all is refused too (fails closed, R-1 3b).
        // With code access the policy is the analysis one, exactly.
        const expected = reads ? access.policy : REVIEW_PERMISSIONS;
        const policy = adapter.permissionPolicy?.();
        const claudeWithoutPolicy = adapter.id === 'claude-agent-sdk' && policy === undefined;
        if (claudeWithoutPolicy || (policy !== undefined && !isDeepStrictEqual(policy, expected))) {
          throw new Error(
            reads
              ? 'The adapter built to read the revisions does not hold the read-only analysis policy, so it was not used. Nothing was sent.'
              : 'The adapter built for the review discussion does not hold the review policy, so it was not used. Nothing was sent.',
          );
        }
        const handle = await adapter.startSession({
          provider,
          modelRequested: this.model(provider),
          workspacePath,
        });
        const unsubscribe = adapter.subscribe(handle.dspatchSessionId, (event) => {
          this.onAgentEvent(event);
        });
        this.options.log(
          `review discussion ${this.identity.key}: session ${handle.dspatchSessionId} started in ${reads ? 'the revision folder (read-only analysis access)' : workspacePath} (adapter ${adapter.id})`,
        );
        return { adapter, provider, sessionId: handle.dspatchSessionId, unsubscribe, sends: 0, revisions };
      } catch (error) {
        await adapter.dispose().catch(() => undefined);
        revisions?.release();
        throw error;
      }
    })();
    this.starting = starting;
    return starting.then(
      (session) => {
        this.session = session;
        this.starting = null;
        return session;
      },
      (error: unknown) => {
        this.starting = null;
        throw error;
      },
    );
  }

  private model(provider: DiscussionProvider): string {
    return this.options.modelFor?.(provider) ?? this.options.model ?? REVIEW_DISCUSSION_DEFAULT_MODEL;
  }

  /**
   * The earlier answer a question asks to have explained more simply, with the envelope its
   * own question was sent with; `null` when the question asks for no such thing.
   */
  private simplifiedOf(
    raw: unknown,
  ): { readonly answerId: string; readonly envelope: ContextEnvelope; readonly section: SimplifySection } | { readonly error: string } | null {
    if (typeof raw !== 'object' || raw === null || typeof (raw as { answerId?: unknown }).answerId !== 'string') {
      return null;
    }
    const answerId = (raw as { answerId: string }).answerId;
    const answer = this.message(answerId);
    if (answer === null || answer.role !== 'answer' || answer.status !== 'done') {
      return { error: 'That answer is not a finished answer in this discussion; nothing was sent.' };
    }
    const asked = answer.questionId === undefined ? null : this.message(answer.questionId);
    if (asked === null || asked.envelope === undefined) {
      return { error: 'The question that answer belongs to has no stored context to send again; nothing was sent.' };
    }
    return { answerId, envelope: asked.envelope, section: { question: asked.text, answer: splitCodeAnswer(answer.text).shown } };
  }

  /**
   * Ask a question about what the window is showing. Nothing is sent on open, load or
   * navigation; only this, from an explicit action.
   */
  async send(input: unknown, envelopes: EnvelopeSource): Promise<DiscussionSendOutcome> {
    const closing: DiscussionSendOutcome = { kind: 'refused', error: 'DSpatch is closing; the question was not sent.' };
    if (this.closedForQuit) {
      return closing;
    }
    if (this.readOnly !== null) {
      return { kind: 'refused', error: `This discussion cannot be written: ${this.readOnly}` };
    }
    if (this.turn !== null || this.preparing) {
      return { kind: 'refused', error: 'An answer is still on its way. Wait for it, or press Stop, before asking the next question.' };
    }
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<keyof DiscussionSendInput, unknown>>;
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    if (question === '') {
      return { kind: 'refused', error: 'An empty question is not sent.' };
    }
    // DSP-132: an explicit agent, usable in this launch. No fallback to another.
    const provider = this.provider;
    if (provider === null) {
      return { kind: 'refused', error: 'Choose an agent for this discussion. Nothing was sent.' };
    }
    const availability = this.availabilityOf(provider);
    if (!availability.choosable) {
      return {
        kind: 'refused',
        error: `${availability.reason ?? `${providerName(provider)} cannot be used here.`} Nothing was sent; choose another agent to ask here.`,
      };
    }
    const decision = this.ledger.mayRepeat('agent-turn');
    if (!decision.allowed) {
      return { kind: 'refused', error: decision.reason, acknowledgeable: decision.acknowledgeableAttemptIds };
    }
    this.preparing = true;
    let turn: Turn;
    let session: Session;
    let prompt: string;
    try {
      // Explain an earlier answer more simply: with the envelope its own question was sent
      // with (its subject, selection and code), whatever the window shows now.
      const simplified = this.simplifiedOf(raw.simplify);
      if (simplified !== null && 'error' in simplified) {
        return { kind: 'refused', error: simplified.error };
      }
      const built: EnvelopeOutcome =
        simplified !== null
          ? { kind: 'built', envelope: simplified.envelope }
          : await envelopes.envelopeFor({ subject: raw.subject, selection: raw.selection ?? null, language: raw.language, quote: raw.quote ?? null });
      // A quit while the envelope was read: no adapter may be created after `dispose`.
      if (this.closedForQuit) {
        return closing;
      }
      if (built.kind === 'refused') {
        return { kind: 'refused', error: built.error };
      }
      const envelope = built.envelope;
      if (
        envelope.identity.base.sha !== this.identity.base ||
        envelope.identity.target.sha !== this.identity.target ||
        envelope.identity.definitionPath !== this.identity.definitionPath
      ) {
        return { kind: 'refused', error: 'The window is showing another review than this discussion belongs to; nothing was sent.' };
      }
      try {
        session = await this.ensureSession(provider);
      } catch (error) {
        return { kind: 'refused', error: `The review discussion could not start a session with the provider: ${describeError(error)}` };
      }
      // A quit while the session started: it is closed here, since `dispose` ran before it existed.
      if (this.closedForQuit) {
        if (this.session === session) {
          this.session = null;
          await this.closeSession(session).catch(() => undefined);
        }
        return closing;
      }
      // A new session has been told nothing: earlier questions and answers go in front, bounded and shown.
      // DSP-132: after a switch the person may have left it out.
      const recap = session.sends === 0 && this.switchNotice?.leftOut !== true ? recapFor(this.messages) : '';
      prompt = buildEnvelopePrompt(
        envelope,
        question,
        recap === '' ? null : recap,
        session.revisions === null ? null : { folder: session.revisions.section },
        simplified === null ? null : simplified.section,
      );
      const questionId = this.nextId('q');
      const attempt = this.ledger.open('agent-turn', `Review question: ${question.split('\n')[0]?.slice(0, 70) ?? ''}`);
      const message: MutableMessage = {
        id: questionId,
        role: 'question',
        text: question,
        at: nowIso(),
        subject: subjectLine(envelope),
        envelope,
        sentPrompt: prompt,
        status: 'sending',
        model: this.model(provider),
        provider,
        dspatchSessionId: session.sessionId,
        toolPolicy: this.policyLine(provider),
        ...(session.revisions === null ? {} : { codeAccess: true }),
        ...((): { deepen?: NonNullable<DiscussionMessage['deepen']> } => {
          const deepen = deepenFrom(raw.deepen);
          return deepen === null || simplified !== null ? {} : { deepen };
        })(),
        ...(simplified === null ? {} : { simplifies: simplified.answerId }),
      };
      this.messages.push(message);
      this.switchNotice = null;
      turn = { questionId, answerId: null, attemptId: attempt.attemptId, runId: null, sendPending: true, stopping: false, reads: [], calls: new Map() };
      this.turn = turn;
      // Before the send, not after it: a question that never reached the disk cannot be
      // reconciled as an unknown outcome after a restart (chat: `sendPrompt`).
      this.save();
      this.emitMessage(message);
      this.emitStatus();
    } finally {
      this.preparing = false;
    }

    this.pendingTurn = turn;
    this.pendingSends += 1;
    this.options.log(`review discussion ${this.identity.key}: ${turn.attemptId} sending a question (${String(prompt.length)} characters, instruction ${String(REVIEW_DISCUSSION_INSTRUCTION.length)})`);
    try {
      // DSP-149: the model chosen for this agent now, from this question on.
      session.adapter.setSessionModel?.(session.sessionId, this.model(session.provider));
      const reference = await session.adapter.send(session.sessionId, prompt);
      session.sends += 1;
      turn.sendPending = false;
      this.runs.set(reference.dspatchRunId, turn);
      if (turn.runId === null) {
        turn.runId = reference.dspatchRunId;
      }
      const question = this.message(turn.questionId);
      if (question !== null && question.status === 'sending') {
        this.setStatus(question.id, 'sent', { dspatchRunId: reference.dspatchRunId });
      } else if (question !== null) {
        question.dspatchRunId = reference.dspatchRunId;
      }
      if (this.abandoned.has(turn.attemptId)) {
        // Stop was pressed while this was pending, and a run exists after all: it is
        // asked to stop at once, so no turn is left going unwatched (chat: `stopAbandonedRun`).
        await this.stopAbandonedRun(turn, session, reference.dspatchRunId);
      }
      this.save();
      this.emitStatus();
      return { kind: 'sent', questionId: turn.questionId, dspatchRunId: reference.dspatchRunId };
    } catch (error) {
      let message = describeError(error);
      if (saysSessionAlreadyHasARun(message)) {
        message = `${message} ${this.explainSessionHoldsARun(session)}`;
      }
      this.ledger.markFailed(turn.attemptId, `The provider refused the question: ${message}`);
      this.setStatus(turn.questionId, 'failed', { error: message });
      if (this.turn === turn) {
        this.turn = null;
      }
      this.save();
      this.emitStatus();
      return { kind: 'failed', error: message, questionId: turn.questionId };
    } finally {
      this.pendingSends -= 1;
      if (this.pendingTurn === turn) {
        this.pendingTurn = null;
      }
      void this.closeIdleAdapter();
    }
  }

  /** Which of the two "already has a run" cases this is, from the adapter's own state (chat: `explainSessionHoldsARun`). */
  private explainSessionHoldsARun(session: Session): string {
    if (session.adapter.hasActiveRun?.(session.sessionId) === true) {
      return (
        'The previous answer was asked to stop but has not reported an end, so this discussion\'s session still holds it. ' +
        'DSpatch started that run and is subscribed to it, so it sees the end when it arrives; ask again then.'
      );
    }
    return (
      'That run is not one this discussion started, and DSpatch is not subscribed to it, so it cannot say whether or when it ends. ' +
      'Close and reopen the review window to continue in a new session; nothing is repeated.'
    );
  }

  // --- Stopping -------------------------------------------------------------------

  /** Stop the answer being waited for. Never claims an end it has not seen. */
  async cancel(): Promise<DiscussionCancelOutcome> {
    const turn = this.turn;
    if (turn === null) {
      return { kind: 'nothing', note: 'No answer is on its way, so there is nothing to stop.' };
    }
    const session = this.session;
    if (turn.sendPending || session === null) {
      // Before the provider has answered `send`, there is nothing `cancel()` could act
      // on (chat: `abandonSend`). Recorded as unknown, and the run cancelled if it appears.
      this.abandoned.add(turn.attemptId);
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        'You stopped waiting for this question before the provider had replied to it. DSpatch cannot tell how far it got, ' +
          'so this outcome is unknown rather than cancelled. As soon as a run for it can be cancelled, DSpatch asks the provider to cancel it.',
      );
      this.setStatus(turn.questionId, 'unknown');
      this.setStatus(turn.answerId, 'unknown');
      this.turn = null;
      this.save();
      this.emitStatus();
      this.options.log(`review discussion ${this.identity.key}: ${turn.attemptId} abandoned before any run could be cancelled`);
      return {
        kind: 'abandoned',
        note: 'DSpatch stopped waiting for it. Whether the provider received the question is unknown, and nothing is claimed about it.',
      };
    }
    turn.stopping = true;
    this.ledger.markCancelRequested(
      turn.attemptId,
      `Cancellation requested at ${nowIso()}. The request returning is not an ending; DSpatch is waiting for something that confirms one.`,
    );
    this.emitStatus();
    try {
      await session.adapter.cancel(session.sessionId);
    } catch (error) {
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        `The cancellation request itself failed: ${describeError(error)} Whether the answer is still being produced is unknown.`,
      );
      this.setStatus(turn.answerId, 'unknown');
      if (this.turn === turn) {
        this.turn = null;
      }
      this.save();
      this.emitStatus();
      return { kind: 'failed', note: `The request to stop failed: ${describeError(error)}` };
    }
    this.armCancelConfirmation(turn, session);
    this.save();
    return { kind: 'cancel-requested', note: 'Asked to stop. It counts as stopped only when the provider reports an end.' };
  }

  private async stopAbandonedRun(turn: Turn, session: Session, runId: string): Promise<void> {
    this.abandoned.delete(turn.attemptId);
    this.ledger.markCancelRequested(
      turn.attemptId,
      `A run (${runId}) started after you stopped waiting, so DSpatch asked the provider to cancel it. That request has not been confirmed yet.`,
    );
    try {
      await session.adapter.cancel(session.sessionId);
      this.armCancelConfirmation(turn, session);
    } catch (error) {
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        `A run (${runId}) started after you stopped waiting, and the request to cancel it failed: ${describeError(error)}`,
      );
    }
  }

  /** A bounded wait for the end of a cancelled run; silence becomes unknown, never stopped (chat: `armCancelConfirmation`). */
  private armCancelConfirmation(turn: Turn, session: Session): void {
    const configured = this.options.timings?.cancelConfirmMs ?? CANCEL_CONFIRM_MS;
    const grace = this.options.timings?.cancelConfirmGraceMs ?? CANCEL_CONFIRM_GRACE_MS;
    const declared = session.adapter.cancelEndBoundMs;
    const ms = declared === undefined || !Number.isFinite(declared) || declared < 0 ? configured : Math.max(configured, declared + grace);
    const timer = setTimeout(() => {
      const current = this.ledger.get(turn.attemptId);
      if (current === null || current.state !== 'cancel-requested') {
        return;
      }
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        `No end arrived within ${formatSeconds(ms)} s of the cancellation, so this answer's ending cannot be established. ` +
          'It is not being treated as stopped.',
      );
      this.setStatus(turn.answerId, 'unknown');
      if (this.turn === turn) {
        this.turn = null;
      }
      this.save();
      this.emitStatus();
      this.options.log(`review discussion ${this.identity.key}: ${turn.attemptId} no terminal event within ${String(ms)} ms of cancellation; outcome unknown`);
      void this.closeIdleAdapter();
    }, ms);
    timer.unref?.();
  }

  // --- Events -----------------------------------------------------------------------

  private onAgentEvent(event: AgentEvent): void {
    // First guard (chat: `onAgentEvent`): an event from a session that is not this
    // discussion's must not land on any of its questions.
    const sessionId = this.session?.sessionId ?? null;
    if (sessionId !== null && event.dspatchSessionId !== sessionId) {
      this.foreignEventsDropped += 1;
      this.options.log(`review discussion ${this.identity.key}: dropped a ${event.type} event from session ${event.dspatchSessionId}`);
      return;
    }

    if (event.type === 'run.started') {
      const turn = this.pendingTurn ?? this.runs.get(event.dspatchRunId) ?? null;
      if (turn === null) {
        return;
      }
      this.runs.set(event.dspatchRunId, turn);
      turn.runId = event.dspatchRunId;
      this.ledger.markRunning(turn.attemptId, { providerRunId: event.dspatchRunId }, `The provider started run ${event.dspatchRunId} at ${event.at}.`);
      const question = this.message(turn.questionId);
      if (turn.answerId === null) {
        const answer: MutableMessage = {
          id: this.nextId('a'),
          role: 'answer',
          text: '',
          at: event.at,
          subject: question?.subject ?? '',
          questionId: turn.questionId,
          dspatchRunId: event.dspatchRunId,
          // An abandoned question's answer is as unknown as the question.
          status: this.abandoned.has(turn.attemptId) ? 'unknown' : 'streaming',
        };
        turn.answerId = answer.id;
        this.messages.push(answer);
        this.emitMessage(answer);
      }
      if (question !== null) {
        question.dspatchRunId = event.dspatchRunId;
      }
      this.save();
      this.emitStatus();
      return;
    }

    // Everything else belongs to the run it names, never to whatever is on screen.
    const turn = this.runs.get(event.dspatchRunId);
    if (turn === undefined) {
      return;
    }
    const answer = turn.answerId === null ? null : this.message(turn.answerId);

    if (event.type === 'assistant.delta' && answer !== null) {
      answer.text += event.text;
      this.emit({ kind: 'delta', messageId: answer.id, text: event.text });
      return;
    }
    if (event.type === 'assistant.message' && answer !== null) {
      // The provider's own complete text replaces the assembled deltas.
      answer.text = event.text;
      this.emitMessage(answer);
      return;
    }
    // With code access: what the agent read, counted once its result says it ran.
    if (event.type === 'tool.started') {
      turn.calls.set(event.toolCallId, { name: event.name, subject: event.subject ?? null });
      return;
    }
    if (event.type === 'tool.finished') {
      const call = turn.calls.get(event.toolCallId);
      turn.calls.delete(event.toolCallId);
      if (event.status !== 'error' && call !== undefined && call.subject !== null && turn.reads.length < 200) {
        turn.reads.push(`${call.name} ${this.relativeToRevisions(call.subject)}`);
      }
      return;
    }
    if (event.type !== 'run.finished') {
      return;
    }

    const detail =
      `Run ${event.dspatchRunId} reported status "${event.status}" at ${event.at}` +
      `${event.error === undefined ? '' : `: ${event.error.message}`}.`;
    let status: DiscussionStatus;
    if (event.status === 'cancelled' && event.end === 'unconfirmed') {
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        `${detail} The adapter reported the end as unconfirmed, so it is not being treated as stopped.`,
      );
      status = 'unknown';
    } else if (event.status === 'cancelled') {
      this.ledger.markStopped(turn.attemptId, `${detail} A confirmed end, reported rather than inferred from silence.`);
      status = 'cancelled';
    } else if (event.status === 'finished') {
      this.ledger.markCompleted(turn.attemptId, detail);
      status = 'done';
    } else {
      this.ledger.markFailed(turn.attemptId, detail);
      status = 'failed';
    }
    // The ledger's word is final: a late end after a settled state changes nothing.
    const settled = this.ledger.get(turn.attemptId)?.state;
    if (answer !== null) {
      const finalStatus: DiscussionStatus =
        settled === 'completed' ? 'done' : settled === 'stopped-confirmed' ? 'cancelled' : settled === 'failed' ? 'failed' : status;
      this.setStatus(answer.id, finalStatus, event.error === undefined ? {} : { error: event.error.message });
    }
    if (settled === 'completed' || settled === 'stopped-confirmed' || settled === 'failed') {
      // A question abandoned before its run existed read `unknown`; its run has now ended
      // and been seen, so the question was sent, and how it ended is on the answer.
      if (this.message(turn.questionId)?.status === 'unknown') {
        this.setStatus(turn.questionId, 'sent');
      }
    }
    if (this.turn === turn) {
      this.turn = null;
    }
    this.save();
    this.emitStatus();
    if (answer !== null && settled === 'completed' && this.message(turn.questionId)?.codeAccess === true) {
      // The references are checked before the session can close: the check reads Git, not the folder.
      void this.checkReferences(answer, turn).finally(() => void this.closeIdleAdapter());
      return;
    }
    void this.closeIdleAdapter();
  }

  /** A tool subject as a path inside the revision folder (`target/src/x.ts`), when it is one. */
  private relativeToRevisions(subject: string): string {
    const folder = this.session?.revisions?.folder ?? null;
    if (folder === null) {
      return subject;
    }
    const relative = path.relative(folder, subject);
    return relative.startsWith('..') || path.isAbsolute(relative) ? subject : relative.split(path.sep).join('/');
  }

  /**
   * An answer that could read the code: its references block is taken off the text, and
   * every reference is checked against Git at its commit. One that does not exist there is
   * left out and named; nothing is shown as a link that was not checked.
   */
  private async checkReferences(answer: MutableMessage, turn: Turn): Promise<void> {
    const split = splitCodeAnswer(answer.text);
    const block = (typeof split.block === 'object' && split.block !== null ? split.block : {}) as Record<string, unknown>;
    const revisions = this.session?.revisions ?? null;
    answer.text = split.shown;
    answer.reads = [...turn.reads];
    if (revisions === null) {
      answer.references = [];
      answer.adjustments = ['The session that answered had closed, so its references could not be checked and are not shown.'];
    } else {
      const checked = await revisions.check({ ...block, answer: split.shown });
      if ('error' in checked) {
        answer.references = [];
        answer.adjustments = [checked.error];
      } else {
        answer.references = checked.references;
        answer.insufficient = checked.insufficient || undefined;
        answer.adjustments = [
          ...(split.block === null ? ['The answer named no code it rests on in a form DSpatch could check.'] : []),
          ...checked.adjustments.filter((entry) => entry !== 'The answer had no text.'),
        ];
      }
    }
    if (answer.insufficient === undefined) {
      delete answer.insufficient;
    }
    this.options.log(
      `review discussion ${this.identity.key}: answer ${answer.id} read ${String(turn.reads.length)} file(s) or search(es); ${String(answer.references?.length ?? 0)} reference(s) checked, ${String(answer.adjustments?.length ?? 0)} left out`,
    );
    this.emitMessage(answer);
    this.save();
  }

  // --- Closing --------------------------------------------------------------------

  /** Close the adapter when no window shows this review and nothing is running. */
  private async closeIdleAdapter(): Promise<void> {
    if (this.targets.size > 0 || this.turn !== null || this.pendingSends > 0 || this.preparing || this.session === null) {
      return;
    }
    const session = this.session;
    this.session = null;
    try {
      await this.closeSession(session);
      this.options.log(`review discussion ${this.identity.key}: adapter closed (no window, no turn)`);
    } catch (error) {
      this.options.log(`review discussion ${this.identity.key}: adapter did not close cleanly (${describeError(error)})`);
    }
  }

  /**
   * DSpatch is quitting. A turn still going is recorded as unknown, never as ended, and
   * the adapter is closed. Bounded by the caller's shutdown timer.
   */
  async dispose(): Promise<void> {
    this.closedForQuit = true;
    const turn = this.turn;
    if (turn !== null) {
      this.ledger.markOutcomeUnknown(
        turn.attemptId,
        'DSpatch was closed while this answer was on its way. Whether it finished is unknown; closing is not an ending.',
      );
      this.setStatus(turn.answerId, 'unknown');
      if (this.message(turn.questionId)?.status === 'sending') {
        this.setStatus(turn.questionId, 'unknown');
      }
      this.turn = null;
      this.save();
    }
    const session = this.session;
    this.session = null;
    if (session !== null) {
      await this.closeSession(session);
    }
  }

  /** Whether an adapter is currently held. For tests and the run record. */
  holdsAdapter(): boolean {
    return this.session !== null;
  }
}

/**
 * Every review discussion in this process, one per review identity, and which windows
 * show each. Events go only to those windows, never through the chat's channels.
 */
export class ReviewDiscussions {
  private readonly services = new Map<string, ReviewDiscussionService>();

  private readonly options: Omit<ReviewDiscussionServiceOptions, 'identity'>;

  /**
   * `createAdapter` is the shared factory's (`provider-adapters.ts`); the review purpose
   * is bound here, once, so no discussion can ask it for anything else (plan review A2).
   */
  constructor(
    options: Omit<ReviewDiscussionServiceOptions, 'identity' | 'createAdapter'> & {
      readonly createAdapter: (request: ReviewAdapterRequest) => ChatAdapter;
    },
  ) {
    const factory = options.createAdapter;
    this.options = {
      ...options,
      createAdapter: (provider) => factory({ provider, purpose: REVIEW_ADAPTER_PURPOSE }),
    };
  }

  serviceFor(identity: DiscussionIdentity): ReviewDiscussionService {
    let service = this.services.get(identity.key);
    if (service === undefined) {
      service = new ReviewDiscussionService({ ...this.options, identity });
      this.services.set(identity.key, service);
    }
    return service;
  }

  /**
   * Bind a window to the discussion of the review it shows, and to no other.
   * `defaultProvider` is the agent of the main window that opened review, if any
   * (DSP-132); a new discussion takes it, a stored one keeps its own.
   */
  attach(
    targetId: number,
    identity: DiscussionIdentity,
    send: DiscussionTargetSend,
    defaultProvider?: DiscussionProvider | null,
  ): ReviewDiscussionService {
    const service = this.serviceFor(identity);
    service.offerDefault(defaultProvider);
    for (const other of this.services.values()) {
      if (other !== service) {
        other.detach(targetId);
      }
    }
    service.attach(targetId, send);
    return service;
  }

  detach(targetId: number): void {
    for (const service of this.services.values()) {
      service.detach(targetId);
    }
  }

  /** Quit: every discussion closes its adapter; a running turn is left unknown. */
  async dispose(): Promise<void> {
    const results = await Promise.allSettled([...this.services.values()].map((service) => service.dispose()));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined) {
      throw failed.reason instanceof Error ? failed.reason : new Error(String(failed.reason));
    }
  }
}
