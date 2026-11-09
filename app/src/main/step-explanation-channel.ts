/**
 * DSP-184: the step explanations of one review, in a channel of their own beside its discussion.
 *
 * Niclas's decision of 9 November 2026: a profile's explanation, a regeneration, Tell me more,
 * Explain more simply and Explain this from Step update only the step's explanation. They are
 * not questions in the discussion: they create no discussion entries, use no discussion turn,
 * and never enter the discussion's session or its recap.
 *
 * What is shared is everything that is not the conversation (AGENT_BEHAVIOUR_AND_ORCHESTRATION.md,
 * section 5: no second pipeline): the discussion's agent choice, its model, its adapter factory and
 * policy checks (`ReviewDiscussionService.openSession`), its envelope and read-only code access,
 * the prompt builder and the reference check. What is the channel's own:
 *
 * - **its own provider session**, so explanation turns are never in the discussion's context;
 * - **its own one-at-a-time lock**, so an explanation neither waits for the person's question nor
 *   blocks it;
 * - **its own store**, `<key>.explanations.json` beside `<key>.discussion.json`, with the same
 *   key, written whole to a temporary file and renamed;
 * - the same guards as the discussion: an answer belongs to the entry it was asked for (its
 *   review, walk, step, step version and profile), never to what a window shows when it
 *   arrives; an entry that DSpatch closed on, or stopped waiting for, is `unknown`; nothing that
 *   failed or ended unknown is asked again on its own: an automatic request for a slot whose
 *   last attempt ended so is refused, and only the person's Try again sends it again.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { AgentEvent } from '../adapter/types';
import { PRESENTATION_INSTRUCTION_VERSION, PROFILE_PROMPT_NAMES, isPublicProfile, outlineFrom, type PresentationSection, type PublicProfile } from '../shared/presentation-profiles';
import { buildEnvelopePrompt, splitCodeAnswer, splitDetails, type ContextEnvelope, type DiscussionIdentity, type DiscussionProvider, type EnvelopeOutcome } from '../shared/review-discussion';
import {
  EXPLANATION_ACTIONS,
  STEP_EXPLANATIONS_FORMAT_VERSION,
  adoptStepExplanations,
  chainTo,
  explanationLabel,
  forWindow,
  historyOf,
  inSlot,
  isPending,
  type ExplanationAction,
  type ExplanationSlot,
  type StepExplanation,
  type StepExplanationEvent,
  type StepExplanationOutcome,
  type StepExplanationRecord,
  type StepExplanationsView,
} from '../shared/step-explanations';
import { toolActivity } from '../shared/review-pair';
import type { EnvelopeSource, Session } from './review-discussion-service';

/** Where a review's step explanations are kept: beside its discussion, with the same key. */
export function explanationsRecordPath(recordsDir: string, key: string): string {
  return path.join(recordsDir, `${key}.explanations.json`);
}

/** What the channel uses of the review's discussion service: the shared agent connection. */
export interface ExplanationChannelHost {
  readonly identity: DiscussionIdentity;
  readonly recordsDir: string;
  log(message: string): void;
  emit(event: StepExplanationEvent): void;
  /** The agent chosen for the review, the discussion's. */
  provider(): DiscussionProvider | null;
  availabilityOf(provider: DiscussionProvider): { choosable: boolean; reason: string | null };
  model(provider: DiscussionProvider): string;
  openSession(provider: DiscussionProvider, holder: string, onEvent: (event: AgentEvent) => void): Promise<Session>;
  closeSession(session: Session): Promise<void>;
  targetCount(): number;
  /** How long a stop is given to be confirmed before its outcome is unknown. */
  readonly cancelConfirmMs: number;
}

type Mutable = { -readonly [K in keyof StepExplanation]: StepExplanation[K] };

interface Turn {
  readonly entryId: string;
  runId: string | null;
  sendPending: boolean;
  stopping: boolean;
  readonly reads: string[];
  readonly calls: Map<string, { readonly name: string; readonly subject: string | null }>;
  activity?: string;
}

const describeError = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));
const nowIso = (): string => new Date().toISOString();

/** The question line an action is asked with, in the prompt's language. */
function questionFor(action: ExplanationAction, profile: string, selection: string | undefined): string {
  switch (action) {
    case 'present':
      return `Explain this step in the ${profile} profile.`;
    case 'regenerate':
      return `Explain this step again in the ${profile} profile, as a new explanation.`;
    case 'more':
      return 'Tell me more about this step: the mechanism, how the code connects, and the details that matter.';
    case 'simpler':
      return 'Explain this step more simply.';
    case 'explain':
      return `Explain this, in the context of this step: "${(selection ?? '').slice(0, 2000)}"`;
  }
}

/**
 * The exact prompt a step explanation sends (DSP-185: one function, so a script can build the
 * same prompts outside a session for an independent check): the step's envelope, the question
 * for the action, the folder section when the agent can read the revisions, and the profile's
 * section with what was shown before and the walk's outline.
 */
export function stepExplanationPrompt(input: {
  readonly envelope: ContextEnvelope;
  readonly action: ExplanationAction;
  readonly profile: PublicProfile;
  readonly selection?: string;
  /** What was shown before, oldest first, along the parent links. */
  readonly chain: readonly { readonly label: string; readonly text: string }[];
  readonly outline: unknown;
  /** The revision folder's prompt section, or `null` without code access. */
  readonly folderSection: string | null;
}): string {
  const { envelope, action, profile, selection, outline, folderSection } = input;
  const chain = [...input.chain];
  const prepared = envelope.explanation;
  // With nothing of this profile yet, the walk's own text.
  if (chain.length === 0 && action !== 'present' && prepared !== null) {
    chain.push({ label: 'The prepared explanation of the step', text: [prepared.summary, prepared.body, prepared.why].filter((part) => part.trim() !== '').join('\n\n') });
  }
  const mode: PresentationSection['mode'] = action;
  const section: PresentationSection = { profile, mode, shown: mode === 'present' ? [] : mode === 'regenerate' || mode === 'more' || mode === 'explain' ? chain.slice(-1) : chain, walk: outlineFrom(outline) };
  return buildEnvelopePrompt(envelope, questionFor(action, PROFILE_PROMPT_NAMES[profile], selection), null, folderSection === null ? null : { folder: folderSection }, null, section);
}

export class StepExplanationChannel {
  private readonly host: ExplanationChannelHost;

  private entries: Mutable[] = [];

  private readOnly: string | null = null;

  private loadNote: string | null = null;

  private session: Session | null = null;

  private starting: Promise<Session> | null = null;

  private turn: Turn | null = null;

  private preparing = false;

  private readonly runs = new Map<string, Turn>();

  private pendingTurn: Turn | null = null;

  private closed = false;

  /**
   * Set once `dispose` has recorded what it closed on. From then on nothing is written: a review
   * deleted after its channel was disposed must not have its file recreated by a late end (DSP-186).
   */
  private sealed = false;

  private counter = 0;

  constructor(host: ExplanationChannelHost) {
    this.host = host;
    this.readStored();
  }

  // --- The store -----------------------------------------------------------------------

  private file(): string {
    return explanationsRecordPath(this.host.recordsDir, this.host.identity.key);
  }

  private readStored(): void {
    const file = this.file();
    if (!fs.existsSync(file)) {
      return;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      raw = null;
    }
    const adopted = adoptStepExplanations(raw, this.host.identity);
    if (adopted.kind === 'newer') {
      this.readOnly = adopted.problem;
      this.loadNote = adopted.problem;
      return;
    }
    if (adopted.kind === 'unusable') {
      // Kept aside, never overwritten.
      const aside = `${file}.unusable-${nowIso().replace(/[:.]/g, '-')}`;
      try {
        fs.renameSync(file, aside);
        this.loadNote = `The stored step explanations could not be read (${adopted.problem}) and were kept aside as ${aside}.`;
      } catch (error) {
        this.readOnly = `The stored step explanations could not be read (${adopted.problem}) or moved aside (${describeError(error)}), so they are not written over.`;
        this.loadNote = this.readOnly;
      }
      return;
    }
    // An explanation DSpatch closed on is not on its way any more: its end was never seen.
    this.entries = adopted.record.entries.map((entry) =>
      isPending(entry) ? { ...entry, status: 'unknown', error: 'DSpatch closed, or stopped waiting, before this explanation ended. Nothing was sent again.' } : { ...entry },
    );
    this.counter = this.entries.length;
  }

  private save(): void {
    if (this.readOnly !== null || this.sealed) {
      return;
    }
    const record: StepExplanationRecord = { version: STEP_EXPLANATIONS_FORMAT_VERSION, identity: this.host.identity, entries: this.entries, savedAt: nowIso() };
    try {
      const file = this.file();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, file);
    } catch (error) {
      this.host.log(`step explanations ${this.host.identity.key}: could not be saved (${describeError(error)})`);
    }
  }

  private entry(id: string): Mutable | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  private emitEntry(entry: Mutable): void {
    this.host.emit({ kind: 'explanation', entry: forWindow({ ...entry }) });
  }

  private emitBusy(): void {
    const turn = this.turn;
    this.host.emit({ kind: 'explanation-busy', busy: turn === null ? null : { entryId: turn.entryId, ...(turn.activity === undefined ? {} : { activity: turn.activity }) } });
  }

  /** What a window reads on open. Never the adapter. */
  view(): StepExplanationsView {
    return {
      entries: this.entries.map((entry) => forWindow({ ...entry })),
      busy: this.turn === null ? null : { entryId: this.turn.entryId, ...(this.turn.activity === undefined ? {} : { activity: this.turn.activity }) },
      note: this.loadNote,
    };
  }

  /** Every stored entry with its prompt: for tests and troubleshooting. */
  stored(): readonly StepExplanation[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  busy(): boolean {
    return this.turn !== null || this.preparing;
  }

  // --- Asking -------------------------------------------------------------------------

  private ensureSession(provider: DiscussionProvider): Promise<Session> {
    if (this.session !== null && this.session.provider === provider) {
      return Promise.resolve(this.session);
    }
    if (this.starting !== null) {
      return this.starting;
    }
    const previous = this.session;
    this.session = null;
    if (previous !== null) {
      void this.host.closeSession(previous).catch(() => undefined);
    }
    const starting = this.host.openSession(provider, 'explanations', (event) => this.onAgentEvent(event));
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

  /** Ask for a step explanation. Refused, with the reason, rather than queued or repeated. */
  async send(input: unknown, envelopes: EnvelopeSource): Promise<StepExplanationOutcome> {
    if (this.closed) {
      return { kind: 'refused', error: 'DSpatch is closing; nothing was sent.' };
    }
    if (this.readOnly !== null) {
      return { kind: 'refused', error: this.readOnly };
    }
    const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
    const ids = ['walkId', 'stepId', 'basis'].map((key) => raw[key]);
    if (!ids.every((value) => typeof value === 'string' && /^[\w.:-]{1,128}$/.test(value)) || !isPublicProfile(raw['profile'])) {
      return { kind: 'refused', error: 'The step explanation request names no step, version or profile; nothing was sent.' };
    }
    const action = raw['action'];
    if (!EXPLANATION_ACTIONS.includes(action as ExplanationAction)) {
      return { kind: 'refused', error: 'Unknown explanation action; nothing was sent.' };
    }
    const slot: ExplanationSlot = { walkId: ids[0] as string, stepId: ids[1] as string, basis: ids[2] as string, profile: raw['profile'] };
    const trigger = raw['trigger'] === 'auto' ? 'auto' : 'person';
    const language = raw['language'] === 'sv' ? 'sv' : 'en';
    const selection = typeof raw['selection'] === 'string' && raw['selection'].trim() !== '' ? raw['selection'].slice(0, 2000) : undefined;
    if (action === 'explain' && selection === undefined) {
      return { kind: 'refused', error: 'Select the text to explain first; nothing was sent.' };
    }
    const parentId = typeof raw['parent'] === 'string' ? raw['parent'] : null;
    const parent = parentId === null ? null : this.entry(parentId);
    if (parentId !== null && (parent === null || parent.status !== 'done' || !inSlot(parent, slot))) {
      return { kind: 'refused', error: 'The explanation this builds on is not a finished explanation of this step in this profile; nothing was sent.' };
    }
    const history = historyOf(this.entries, slot);
    if (history.pending !== null) {
      return { kind: 'refused', error: 'An explanation of this step in this profile is already on its way.', busy: true };
    }
    if (trigger === 'auto' && (action !== 'present' || history.hasDone || history.failed !== null)) {
      // Never on its own after a failure or an unknown end: that waits for the person's Try again.
      return { kind: 'refused', error: history.failed !== null ? 'The last attempt ended without an explanation; it waits for Try again.' : 'Nothing to ask for on its own.' };
    }
    if (this.turn !== null || this.preparing) {
      return { kind: 'refused', error: 'Another step explanation is being written; this one can be asked for when it has ended.', busy: true };
    }
    const provider = this.host.provider();
    if (provider === null) {
      return { kind: 'refused', error: 'Choose an agent for this review in the Discussion tab. Nothing was sent.' };
    }
    const availability = this.host.availabilityOf(provider);
    if (!availability.choosable) {
      return { kind: 'refused', error: `${availability.reason ?? 'That agent cannot be used here.'} Nothing was sent.` };
    }
    this.preparing = true;
    let turn: Turn;
    let session: Session;
    let prompt: string;
    try {
      const built: EnvelopeOutcome = await envelopes.envelopeFor({
        subject: { kind: 'point', walkId: slot.walkId, stepId: slot.stepId, placeIndex: 0 },
        selection: null,
        language,
        quote: action === 'explain' ? (raw['quote'] ?? { kind: 'text', text: selection, source: 'explanation', context: '' }) : null,
      });
      if (this.closed) {
        return { kind: 'refused', error: 'DSpatch is closing; nothing was sent.' };
      }
      if (built.kind === 'refused') {
        return { kind: 'refused', error: built.error };
      }
      const envelope = built.envelope;
      if (envelope.identity.base.sha !== this.host.identity.base || envelope.identity.target.sha !== this.host.identity.target) {
        return { kind: 'refused', error: 'The window is showing another review than these explanations belong to; nothing was sent.' };
      }
      try {
        session = await this.ensureSession(provider);
      } catch (error) {
        return { kind: 'refused', error: `The step explanations could not start a session with the provider: ${describeError(error)}` };
      }
      if (this.closed) {
        return { kind: 'refused', error: 'DSpatch is closing; nothing was sent.' };
      }
      // What was shown before, along the parent links; with nothing of this profile yet, the walk's own text.
      const chain = chainTo(this.entries, parentId).map((entry) => ({ label: explanationLabel(entry), text: splitDetails(entry.text).short }));
      prompt = stepExplanationPrompt({
        envelope,
        action: action as ExplanationAction,
        profile: slot.profile,
        ...(selection === undefined ? {} : { selection }),
        chain,
        outline: raw['outline'],
        folderSection: session.revisions === null ? null : session.revisions.section,
      });
      this.counter += 1;
      const entry: Mutable = {
        ...slot,
        id: `x-${String(this.counter).padStart(4, '0')}-${Date.now().toString(36)}`,
        action: action as ExplanationAction,
        parent: parentId,
        ...(selection === undefined ? {} : { selection }),
        text: '',
        status: 'sending',
        at: nowIso(),
        prompt,
        instructionVersion: PRESENTATION_INSTRUCTION_VERSION,
        language,
        provider,
        model: this.host.model(provider),
        dspatchSessionId: session.sessionId,
        ...(session.revisions === null ? {} : { codeAccess: true }),
        trigger,
      };
      this.entries.push(entry);
      turn = { entryId: entry.id, runId: null, sendPending: true, stopping: false, reads: [], calls: new Map(), activity: 'Waiting for the agent…' };
      this.turn = turn;
      // Saved before the send: an explanation that never reached the disk cannot be reconciled after a restart.
      this.save();
      this.emitEntry(entry);
      this.emitBusy();
    } finally {
      this.preparing = false;
    }

    this.pendingTurn = turn;
    this.host.log(`step explanations ${this.host.identity.key}: ${turn.entryId} sending ${String(action)} for ${slot.stepId} in ${slot.profile} (${String(prompt.length)} characters)`);
    try {
      session.adapter.setSessionModel?.(session.sessionId, this.host.model(session.provider));
      const reference = await session.adapter.send(session.sessionId, prompt);
      session.sends += 1;
      turn.sendPending = false;
      this.runs.set(reference.dspatchRunId, turn);
      turn.runId ??= reference.dspatchRunId;
      const entry = this.entry(turn.entryId);
      if (entry !== null) {
        entry.dspatchRunId = reference.dspatchRunId;
      }
      if (turn.stopping) {
        await this.stopRun(turn, session);
      }
      this.save();
      return { kind: 'sent', entryId: turn.entryId };
    } catch (error) {
      const message = describeError(error);
      this.settle(turn, 'failed', message);
      return { kind: 'failed', error: message, entryId: turn.entryId };
    } finally {
      if (this.pendingTurn === turn) {
        this.pendingTurn = null;
      }
      void this.closeIdle();
    }
  }

  /** End a turn: its entry's status, saved and told, and the lock released. */
  private settle(turn: Turn, status: StepExplanation['status'], error?: string): void {
    const entry = this.entry(turn.entryId);
    if (entry !== null && isPending(entry)) {
      entry.status = status;
      entry.finishedAt = nowIso();
      if (error !== undefined) {
        entry.error = error;
      }
      this.emitEntry(entry);
    }
    if (this.turn === turn) {
      this.turn = null;
    }
    this.save();
    this.emitBusy();
  }

  // --- Stopping ----------------------------------------------------------------------

  /** Stop the explanation being written. Never claims an end it has not seen. */
  async cancel(): Promise<{ readonly kind: 'nothing' | 'cancel-requested' | 'abandoned' | 'failed'; readonly note: string }> {
    const turn = this.turn;
    if (turn === null) {
      return { kind: 'nothing', note: 'No explanation is being written.' };
    }
    turn.stopping = true;
    const session = this.session;
    if (turn.sendPending || session === null) {
      this.settle(turn, 'unknown', 'You stopped waiting before the provider had replied; whether it received the request is unknown.');
      return { kind: 'abandoned', note: 'DSpatch stopped waiting for it; whether the provider received it is unknown.' };
    }
    return this.stopRun(turn, session);
  }

  private async stopRun(turn: Turn, session: Session): Promise<{ readonly kind: 'cancel-requested' | 'failed'; readonly note: string }> {
    try {
      await session.adapter.cancel(session.sessionId);
    } catch (error) {
      this.settle(turn, 'unknown', `The request to stop failed: ${describeError(error)}`);
      return { kind: 'failed', note: `The request to stop failed: ${describeError(error)}` };
    }
    const declared = session.adapter.cancelEndBoundMs;
    const ms = declared === undefined || !Number.isFinite(declared) || declared < 0 ? this.host.cancelConfirmMs : Math.max(this.host.cancelConfirmMs, declared + 1_000);
    const timer = setTimeout(() => {
      if (this.turn === turn) {
        this.settle(turn, 'unknown', 'No end arrived after the request to stop, so how this explanation ended is unknown.');
        void this.closeIdle();
      }
    }, ms);
    timer.unref?.();
    return { kind: 'cancel-requested', note: 'Asked to stop. It counts as stopped only when the provider reports an end.' };
  }

  // --- Events -----------------------------------------------------------------------

  private onAgentEvent(event: AgentEvent): void {
    if (this.session !== null && event.dspatchSessionId !== this.session.sessionId) {
      return;
    }
    if (event.type === 'run.started') {
      const turn = this.pendingTurn ?? this.runs.get(event.dspatchRunId) ?? null;
      if (turn === null) {
        return;
      }
      this.runs.set(event.dspatchRunId, turn);
      turn.runId = event.dspatchRunId;
      const entry = this.entry(turn.entryId);
      if (entry !== null && entry.status === 'sending') {
        entry.status = 'streaming';
        entry.dspatchRunId = event.dspatchRunId;
        this.emitEntry(entry);
        this.save();
      }
      return;
    }
    // Everything else belongs to the run it names: an answer lands on its own entry, wherever any window is.
    const turn = this.runs.get(event.dspatchRunId);
    if (turn === undefined) {
      return;
    }
    const entry = this.entry(turn.entryId);
    if (event.type === 'assistant.delta' && entry !== null) {
      entry.text += event.text;
      this.host.emit({ kind: 'explanation-delta', entryId: entry.id, text: event.text });
      if (turn.activity !== 'Writing the explanation…') {
        turn.activity = 'Writing the explanation…';
        this.emitBusy();
      }
      return;
    }
    if (event.type === 'assistant.message' && entry !== null) {
      entry.text = event.text;
      this.emitEntry(entry);
      return;
    }
    if (event.type === 'tool.started') {
      turn.calls.set(event.toolCallId, { name: event.name, subject: event.subject ?? null });
      const activity = toolActivity(event.name, event.subject ?? null);
      if (activity !== null) {
        turn.activity = `${activity}…`;
        this.emitBusy();
      }
      return;
    }
    if (event.type === 'tool.finished') {
      const call = turn.calls.get(event.toolCallId);
      turn.calls.delete(event.toolCallId);
      if (event.status !== 'error' && call !== undefined && call.subject !== null && turn.reads.length < 200) {
        turn.reads.push(`${call.name} ${call.subject}`);
      }
      return;
    }
    if (event.type !== 'run.finished') {
      return;
    }
    if (this.turn !== turn && entry !== null && !isPending(entry)) {
      // Already settled (stopped waiting, or unknown): a late end changes nothing.
      return;
    }
    const status: StepExplanation['status'] =
      event.status === 'finished' ? 'done' : event.status === 'cancelled' ? (event.end === 'unconfirmed' ? 'unknown' : 'cancelled') : 'failed';
    if (status === 'done' && entry !== null) {
      // The references are checked against Git before the entry is finished, and before the session can close.
      void this.finish(entry, turn).finally(() => void this.closeIdle());
      return;
    }
    this.settle(turn, status, event.error?.message);
    void this.closeIdle();
  }

  private async finish(entry: Mutable, turn: Turn): Promise<void> {
    const split = splitCodeAnswer(entry.text);
    const block = (typeof split.block === 'object' && split.block !== null ? split.block : {}) as Record<string, unknown>;
    entry.text = split.shown;
    if (entry.codeAccess === true) {
      const revisions = this.session?.revisions ?? null;
      if (revisions === null) {
        entry.references = [];
        entry.adjustments = ['The session that answered had closed, so its references could not be checked and are not shown.'];
      } else {
        try {
          const checked = await revisions.check({ ...block, answer: split.shown });
          if (this.closed) {
            // Closed (quit or deleted) while the references were checked: the entry was left unknown.
            return;
          }
          if ('error' in checked) {
            entry.references = [];
            entry.adjustments = [checked.error];
          } else {
            entry.references = checked.references;
            if ((checked.contextReferences?.length ?? 0) > 0) {
              entry.contextReferences = checked.contextReferences;
            }
            if ((checked.stepReferences?.length ?? 0) > 0) {
              entry.stepReferences = checked.stepReferences;
            }
            if (checked.insufficient) {
              entry.insufficient = true;
            }
            entry.adjustments = [
              ...(split.block === null ? ['The answer named no code it rests on in a form DSpatch could check.'] : []),
              ...checked.adjustments.filter((line) => line !== 'The answer had no text.'),
            ];
          }
        } catch (error) {
          entry.references = [];
          entry.adjustments = [`Its references could not be checked: ${describeError(error)}`];
        }
      }
    }
    this.settle(turn, entry.text.trim() === '' ? 'failed' : 'done', entry.text.trim() === '' ? 'The agent wrote no explanation.' : undefined);
  }

  // --- Closing ------------------------------------------------------------------------

  /** Close the channel's session when no window shows the review and nothing is being written. */
  async closeIdle(): Promise<void> {
    if (this.host.targetCount() > 0 || this.turn !== null || this.preparing || this.session === null) {
      return;
    }
    const session = this.session;
    this.session = null;
    await this.host.closeSession(session).catch((error: unknown) => {
      this.host.log(`step explanations ${this.host.identity.key}: adapter did not close cleanly (${describeError(error)})`);
    });
  }

  /** DSpatch is quitting: an explanation on its way is unknown, never ended. */
  async dispose(): Promise<void> {
    this.closed = true;
    const turn = this.turn;
    if (turn !== null) {
      this.settle(turn, 'unknown', 'DSpatch was closed while this explanation was on its way. Whether it finished is unknown.');
    }
    this.sealed = true;
    const session = this.session;
    this.session = null;
    if (session !== null) {
      await this.host.closeSession(session);
    }
  }

  holdsAdapter(): boolean {
    return this.session !== null;
  }
}
