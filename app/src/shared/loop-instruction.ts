/**
 * A message typed while the loop is working.
 *
 * Until now the composer was dead for the whole of a loop run — `busy !== null`
 * disabled Send, and `busy` is `'sending'` from the moment a walk starts until it
 * ends. So the box was unusable exactly when a person most wants it: watching an
 * agent work and realising it has misunderstood something.
 *
 * **Unlocking the button is not the delivery, and on its own it would be a
 * regression.** A message with nowhere coherent to land is worse than a disabled
 * one: pressed during a run it would have reached `startChatLoopRun`, which
 * refuses an overlapping walk with a sentence about DSpatch running one loop at a
 * time — a true sentence and a useless answer to *"also check the Linux build"*.
 * So the send is **routed** rather than merely permitted, and this module owns
 * both halves of that: {@link composerSendRoute} decides where a press goes, and
 * everything below it decides what the person is told about what happened to it.
 *
 * Three rules, from INTERACTION_MODEL v1.2, and each of them is a thing the
 * previous shape of this window got wrong:
 *
 * **§3, §4.4 — received is not delivered.** DSpatch having a message is not the
 * agent having it. Every state below names which of the two is true, and there is
 * no state that implies the second while only the first holds.
 *
 * **§4.4 — "always the next agent" is not a product rule.** A message can reach
 * the next handover, or the same agent when an interrupted step is continued. So
 * {@link LoopInstruction} records *which* step took it as a fact after the event,
 * and nothing here predicts one.
 *
 * **§7 — no message-type switch.** Version 1.0 proposed that a message during a
 * run is a question by default with a control to send it as an instruction
 * instead; §7 retires that. There is deliberately no `kind` on an instruction, no
 * classifier and no form. The user writes; DSpatch carries it and says what
 * became of it. Interpreting what it *means* belongs to the agent that reads it,
 * which is the only party that can.
 *
 * The internal name is `instruction` because the queue has to be called
 * something. Nothing the user reads calls it that: to them it is their message.
 */

import type { AttemptRef, StoredSteering } from './bridge';
import { ordinal } from './ordinal';

/** Which step took a message, recorded after it happened rather than predicted. */
export interface LoopInstructionDelivery {
  readonly nodeId: string;
  /** The node's label from the graph that was walked, so a person can read it. */
  readonly nodeLabel: string;
  /** 1 for the first time that node ran in this run, 2 for the second, and so on. */
  readonly occurrence: number;
  readonly atUtc: string;
  /**
   * DSP-147: delivered through the runtime's own steering into the work that was running,
   * on the runtime's receipt. For Claude that receipt is the uuid in a result's
   * `user_message_uuids`, which the SDK also gives when Claude Code ran the message as a
   * following turn of the same query, so it says the work took the message in, not when
   * or that the agent acted on it during its step. Absent or `false`: put in front of the
   * step's prompt when it started (DSP-32), or for a chat turn sent as the next message.
   */
  readonly during?: boolean;
  /**
   * DSP-209 S12: taken by a fan-out's mailbox and sent to these branches, each of which gets it
   * when it next checks its messages. Not a delivery to any of them; the run journal and the run
   * report say which branch received it.
   */
  readonly toBranches?: readonly string[];
}

export interface LoopInstruction {
  /** Unique within the conversation. Generated where the message is accepted. */
  readonly id: string;
  /** The run this was typed into. A message is scoped to the work it concerns. */
  readonly runId: string;
  /** Exactly what was typed. Never trimmed for length and never summarised. */
  readonly text: string;
  readonly receivedAtUtc: string;
  /** `null` until a step has actually been given it. */
  readonly delivered: LoopInstructionDelivery | null;
  /** The run finished, and this had still reached nobody. */
  readonly runEnded: boolean;
  /**
   * DSP-147: what the message was sent into. `loop` (absent in entries written before
   * DSP-147): a loop run, `runId` is the run's. `chat`: an ordinary agent turn, `runId`
   * is the turn's run.
   */
  readonly scope?: 'loop' | 'chat';
  /**
   * DSP-147: the agent's runtime has taken it for the running work. Not evidence that
   * the work took it in; that is `delivered` with `during`.
   */
  readonly accepted?: boolean;
  /**
   * DSP-147: the runtime had it and the work ended without evidence that it was taken
   * in. It may still have reached the agent, so it is never handed over again.
   */
  readonly unconfirmed?: boolean;
  /**
   * DSP-147: the running work could not take it (no steering in this runtime, or the
   * runtime declined), so it waits for this handover instead: the run's next step, or
   * the end of the chat turn, when it is sent as the next message.
   */
  readonly waitingFor?: 'next-step' | 'end-of-turn' | null;
  /** DSP-147: where in the work's output the message was sent. Absent: not known. */
  readonly anchor?: InstructionAnchor;
}

/**
 * DSP-147: where a message sent into running work belongs in the conversation, as what
 * the window had shown of that work when it was sent. The agent text shown before it
 * stays before it, and what came after goes after it, live and when read back.
 */
export interface InstructionAnchor {
  /**
   * A loop run: how many of the run's replies were already shown, so the working step's
   * reply is the one with this index. Absent for an ordinary turn, which has one answer.
   */
  readonly replyIndex?: number;
  /** How many characters of that reply (or the turn's answer) had been shown. */
  readonly textOffset: number;
}

/**
 * What can be true of a message.
 *
 * `never-delivered` is its own state rather than a variant of `pending`, because
 * the difference is the whole of §4.4's last sentence: a message still waiting may
 * yet be used, and one whose run has ended never will be. Collapsing them would
 * leave someone waiting for an effect that can no longer happen.
 *
 * DSP-147 adds two between them. `accepted`: the runtime has it for the running work
 * and has not yet said the work took it in. `unconfirmed`: the runtime had it and the
 * work ended without saying so; it is not handed over again, because a second copy
 * could deliver it twice.
 */
export type LoopInstructionState =
  | 'pending'
  | 'accepted'
  | 'delivered'
  | 'unconfirmed'
  | 'never-delivered';

/**
 * DSP-147: a chat turn's saved steering message, read back, as the entry the window
 * draws. A `received` or `accepted` one in a file means nothing more was learned before
 * DSpatch stopped: it is shown as not confirmed, never as waiting for something that is
 * no longer coming.
 */
export function storedSteeringAsInstruction(entry: StoredSteering, runId: string): LoopInstruction {
  const delivered =
    entry.state === 'delivered' || entry.state === 'sent-as-next-message'
      ? {
          nodeId: '',
          nodeLabel: '',
          occurrence: 0,
          atUtc: entry.settledAtUtc ?? entry.receivedAtUtc,
          ...(entry.state === 'delivered' ? { during: true } : {}),
        }
      : null;
  return {
    id: entry.id,
    runId,
    text: entry.text,
    receivedAtUtc: entry.receivedAtUtc,
    delivered,
    runEnded: entry.state === 'not-delivered' || entry.state === 'waiting-end-of-turn',
    scope: 'chat',
    ...(entry.anchor === undefined ? {} : { anchor: entry.anchor }),
    ...(entry.state === 'unconfirmed' || entry.state === 'accepted' || entry.state === 'received'
      ? { unconfirmed: true }
      : {}),
  };
}

export function loopInstructionState(instruction: LoopInstruction): LoopInstructionState {
  if (instruction.delivered !== null) {
    return 'delivered';
  }
  if (instruction.unconfirmed === true) {
    return 'unconfirmed';
  }
  if (instruction.runEnded) {
    return 'never-delivered';
  }
  return instruction.accepted === true ? 'accepted' : 'pending';
}

/**
 * What the conversation says about one message, in one sentence.
 *
 * The user-visible guarantee of this module, and what its tests assert: a message
 * is never on screen without an account of where it has got to. Same discipline as
 * {@link import('./loop-transcript').loopTurnStatusText}, for the same reason — an
 * echoed message with nothing said about it is worse than the silence it replaces.
 *
 * The pending sentence states a limit rather than a promise. DSpatch cannot change
 * a provider call that has already been sent, and a window that implied otherwise
 * would be lying at the moment a person most needs to trust it. What it can say is
 * where the message is and what will happen to it next.
 *
 * **One line each** (DSP-87). These were two and three sentences, and they were the
 * only acknowledgement a message sent during a run was supposed to need — so they had
 * to carry their own weight and also argue for the standing paragraph that used to sit
 * under the composer. That paragraph is gone; the fact each of these states is kept
 * and the reasoning around it is not.
 */
export function loopInstructionStatusText(instruction: LoopInstruction): string {
  const chat = instruction.scope === 'chat';
  const delivered = instruction.delivered;
  if (delivered !== null) {
    if (delivered.toBranches !== undefined) {
      const count = delivered.toBranches.length;
      return (
        `Sent to ${String(count)} branch${count === 1 ? '' : 'es'} of “${delivered.nodeLabel}”; ` +
        'each gets it when it next checks its messages. The run report says which did.'
      );
    }
    if (delivered.during === true) {
      // DSP-147: the runtime's receipt, and no more: not "read", not "applied", and not
      // "while it worked", because the receipt is also given for a following turn.
      return chat || delivered.nodeLabel === ''
        ? 'Delivered.'
        : `Delivered to “${delivered.nodeLabel}”.`;
    }
    if (chat) {
      return 'Sent as your next message when the turn ended.';
    }
    return (
      `Given to “${delivered.nodeLabel}” when that step started` +
      `${delivered.occurrence > 1 ? `, on its ${ordinal(delivered.occurrence)} turn` : ''}, ` +
      `before its own task.`
    );
  }
  if (instruction.unconfirmed === true) {
    return 'Delivery not confirmed: the work ended without saying it took this in. It is not sent again.';
  }
  if (instruction.runEnded) {
    return chat
      ? 'The turn stopped first, so the agent never received it.'
      : 'The run ended first, so no agent ever received it.';
  }
  if (instruction.accepted === true) {
    return 'Sent to the running work; not yet taken in.';
  }
  if (instruction.waitingFor === 'end-of-turn') {
    return 'Waiting. The agent cannot take it while it works; it is sent when this turn ends.';
  }
  if (instruction.waitingFor === 'next-step' || !chat) {
    // Says no agent has it, because that is §4.4: receipt by the window is not
    // receipt by an agent.
    return 'Waiting. No agent has it yet; it goes to the next step the run starts.';
  }
  return 'Waiting for delivery.';
}

/**
 * DSP-147: what the conversation shows under a message, if anything.
 *
 * Nothing once it is delivered: a person reads their message, not a standing receipt
 * under each one; the account is in Session details ({@link loopInstructionStatusText}).
 * A quiet word while it waits. A visible line when delivery was not confirmed or did not
 * happen, because that is the case where the person may need to act.
 */
export function loopInstructionInline(
  instruction: LoopInstruction,
): { readonly tone: 'quiet' | 'attention'; readonly text: string } | null {
  switch (loopInstructionState(instruction)) {
    case 'delivered':
      return null;
    case 'pending':
    case 'accepted':
      return {
        tone: 'quiet',
        text:
          instruction.waitingFor === 'end-of-turn'
            ? 'Waiting for this turn to end…'
            : instruction.waitingFor === 'next-step' ||
                (instruction.scope !== 'chat' && instruction.accepted !== true)
              ? 'Waiting for the next step…'
              : 'Waiting for delivery…',
      };
    case 'unconfirmed':
    case 'never-delivered':
      return { tone: 'attention', text: loopInstructionStatusText(instruction) };
  }
}

/**
 * The short phrase beside the sentence, for the badge the entry already has.
 *
 * `unknown` for pending is the honest value rather than a cautious one: whether
 * this message reaches an agent depends on whether the run reaches another step,
 * which nobody knows yet.
 */
export function loopInstructionBadgeText(instruction: LoopInstruction): string {
  switch (loopInstructionState(instruction)) {
    case 'delivered':
      return instruction.delivered?.toBranches === undefined ? 'reached the agent' : 'sent to the branches';
    case 'never-delivered':
      return 'never reached an agent';
    case 'unconfirmed':
      return 'delivery not confirmed';
    case 'accepted':
      return 'sent';
    case 'pending':
      return instruction.scope === 'chat' || instruction.waitingFor === 'end-of-turn'
        ? 'waiting'
        : 'waiting for the next step';
  }
}

export type LoopInstructionEvent =
  /** The main process accepted the message for this run. */
  | {
      readonly kind: 'received';
      readonly instruction: LoopInstruction;
    }
  /** A step started and was handed these messages. Ids, because a step takes all pending ones. */
  | {
      readonly kind: 'delivered';
      readonly runId: string;
      readonly instructionIds: readonly string[];
      readonly delivery: LoopInstructionDelivery;
    }
  /**
   * The run ended. Anything still pending has missed its chance and says so.
   *
   * Deliberately not "failed": nothing went wrong, the run simply finished first.
   * §4.4 asks for exactly this to be said rather than left to be inferred from a
   * message that sits on `pending` for ever.
   */
  | { readonly kind: 'run-ended'; readonly runId: string }
  /** DSP-147: the runtime took these for the running work. */
  | { readonly kind: 'accepted'; readonly runId: string; readonly instructionIds: readonly string[] }
  /** DSP-147: the runtime had these and the work ended without saying it took them in. */
  | { readonly kind: 'unconfirmed'; readonly runId: string; readonly instructionIds: readonly string[] }
  /** DSP-147: the running work could not take these; they wait for this handover. */
  | {
      readonly kind: 'waiting';
      readonly runId: string;
      readonly instructionIds: readonly string[];
      readonly waitingFor: 'next-step' | 'end-of-turn';
    }
  /** DSP-147: these were not given to the agent, and nothing will give them now. */
  | { readonly kind: 'not-delivered'; readonly runId: string; readonly instructionIds: readonly string[] }
  /** DSP-147: a chat turn's steering, read back from a saved conversation. */
  | { readonly kind: 'restored'; readonly instructions: readonly LoopInstruction[] }
  /** A different project, a new session, or a saved conversation read back. */
  | { readonly kind: 'conversation-replaced' };

export function loopInstructionsAfter(
  instructions: readonly LoopInstruction[],
  event: LoopInstructionEvent,
): readonly LoopInstruction[] {
  switch (event.kind) {
    case 'conversation-replaced':
      // Scoped to the conversation, exactly as a loop turn is. A message typed at
      // one project's run must not appear under another project's.
      return [];
    case 'received': {
      if (instructions.some((existing) => existing.id === event.instruction.id)) {
        // Ids come from the main process, so a repeat is a fault rather than a
        // second message. Keeping the first is the honest half of that.
        return instructions;
      }
      return [...instructions, event.instruction];
    }
    case 'delivered': {
      const ids = new Set(event.instructionIds);
      return instructions.map((instruction) =>
        instruction.runId === event.runId &&
        ids.has(instruction.id) &&
        // A delivery is recorded once. A second claim about the same message would
        // be rewriting which step read it, and the first one is the one that did.
        instruction.delivered === null
          ? { ...instruction, delivered: event.delivery }
          : instruction,
      );
    }
    case 'run-ended':
      return instructions.map((instruction) =>
        instruction.runId === event.runId &&
        instruction.delivered === null &&
        instruction.unconfirmed !== true
          ? { ...instruction, runEnded: true }
          : instruction,
      );
    case 'accepted':
    case 'unconfirmed':
    case 'not-delivered':
    case 'waiting': {
      const ids = new Set(event.instructionIds);
      return instructions.map((instruction) => {
        if (
          instruction.runId !== event.runId ||
          !ids.has(instruction.id) ||
          instruction.delivered !== null ||
          instruction.runEnded
        ) {
          return instruction;
        }
        if (event.kind === 'accepted') {
          return { ...instruction, accepted: true };
        }
        if (event.kind === 'unconfirmed') {
          return { ...instruction, unconfirmed: true };
        }
        if (event.kind === 'not-delivered') {
          return { ...instruction, runEnded: true };
        }
        return { ...instruction, accepted: false, waitingFor: event.waitingFor };
      });
    }
    case 'restored': {
      const known = new Set(instructions.map((instruction) => instruction.id));
      return [...instructions, ...event.instructions.filter((instruction) => !known.has(instruction.id))];
    }
  }
}

/** The messages a step starting now should be given, oldest first. */
export function pendingInstructionsFor(
  instructions: readonly LoopInstruction[],
  runId: string,
): readonly LoopInstruction[] {
  return instructions.filter(
    (instruction) =>
      instruction.runId === runId && instruction.delivered === null && !instruction.runEnded,
  );
}

/* ------------------------------------------------------------------------- */
/* What the agent is actually told                                            */
/* ------------------------------------------------------------------------- */

/**
 * The messages, as the opening of the next step's prompt.
 *
 * Before the role and the task, and said to be from the user, for the reason the
 * role block is put before the mandate: a model that reads its task first and the
 * correction second has already started planning against the superseded version.
 *
 * Passed through whole. A summarised correction is worse than none — the same rule
 * the live log and the loop transcript already keep — and a correction is the one
 * kind of text where the user's exact words are the entire content.
 *
 * `''` when there is nothing pending, so a prompt built for a step that received
 * no messages is byte for byte the prompt it would have been before this existed.
 * That matters: it is what makes every run without an interjection unchanged.
 */
export function instructionPreamble(texts: readonly string[]): string {
  const said = texts.map((text) => text.trim()).filter((text) => text !== '');
  if (said.length === 0) {
    return '';
  }
  return [
    said.length === 1
      ? 'While this run was working, the person who gave the assignment sent a message. ' +
        'It arrived after an earlier step had already started, so this is the first step ' +
        'that can act on it. Read it as part of your assignment: it may add context, ' +
        'correct a misunderstanding or change what is wanted.'
      : `While this run was working, the person who gave the assignment sent ${String(said.length)} ` +
        'messages. They arrived after an earlier step had already started, so this is the ' +
        'first step that can act on them. Read them as part of your assignment: they may add ' +
        'context, correct a misunderstanding or change what is wanted.',
    // DSP-96 part 3. The half this preamble left open: the words were carried whole and
    // attributed, and nothing said how they ranked against the mandate underneath them.
    // Both directions are stated, because both are wrong on their own — ignoring a
    // correction, and treating one sentence about one thing as a replacement assignment.
    //
    // **A correction may be about a limit.** The first wording said every limit the
    // assignment states stands as it was, which locks the one thing the person is most
    // likely to be writing about: "Läs inte projektet." followed by "Du får läsa README
    // för att kontrollera detta." must leave README readable for that purpose and the
    // rest of the project still covered. So what stands is the limits the message does
    // not touch. What a message cannot move is technical permission and the run's
    // bounds, which is the last sentence. `TASK_PRECEDENCE` in `loop-chat.ts` states the
    // same rule from the assignment's side and reaches the agent in the same message;
    // the two are checked against each other in `loop-chat.test.ts`.
    said.length === 1
      ? 'It is from the same person the assignment came from and it is later than the ' +
        'assignment, so where it contradicts something you have been given, it governs. It ' +
        'governs only the part it actually concerns: the rest of the assignment, and the ' +
        'limits it does not touch, stand as they were. Where it does change a limit the ' +
        'assignment stated, the later wording is the limit, for exactly what it names and ' +
        'no further. It does not widen what you are permitted to reach or the bounds this ' +
        'run is under.'
      : 'They are from the same person the assignment came from and they are later than the ' +
        'assignment, so where they contradict something you have been given, they govern. ' +
        'They govern only the parts they actually concern: the rest of the assignment, and ' +
        'the limits they do not touch, stand as they were. Where one does change a limit ' +
        'the assignment stated, the later wording is the limit, for exactly what it names ' +
        'and no further. They do not widen what you are permitted to reach or the bounds ' +
        'this run is under.',
    '',
    INSTRUCTION_BLOCK_OPEN,
    said.join('\n\n---\n\n'),
    INSTRUCTION_BLOCK_CLOSE,
    '',
  ].join('\n');
}

/**
 * DSP-147: the messages an **earlier** step of this run was given while it worked, as
 * part of a later step's brief.
 *
 * Steering reaches the step that is running, and that step's session alone. A later step
 * runs in a session of its own (DSP-79) and would otherwise judge the work against the
 * assignment as first written, so the verifier would check the implementer against a
 * task the person had since changed. AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §2: the user's
 * task and explicit constraints survive handoffs. The same precedence rule as
 * {@link instructionPreamble}, by reusing it; the opening sentence says these were
 * already given to the step they were sent to, so they are context and not a request
 * to redo that step's work.
 *
 * `''` when there are none, so every run without steering keeps its prompts byte for byte.
 */
export function earlierInstructionsContext(texts: readonly string[]): string {
  const said = texts.map((text) => text.trim()).filter((text) => text !== '');
  if (said.length === 0) {
    return '';
  }
  const body = instructionPreamble(said);
  const firstBreak = body.indexOf('\n');
  // Not "that step received it": a message the runtime had without confirming that the
  // turn took it in is carried too, and the brief does not claim more than is known.
  const opening =
    said.length === 1
      ? 'Earlier in this run, the person who gave the assignment sent a message to the work ' +
        'while an earlier step was doing it. It is part of the assignment as it now stands: ' +
        'do your step, and judge earlier work, against the assignment with it applied.'
      : `Earlier in this run, the person who gave the assignment sent ${String(said.length)} ` +
        'messages to the work while earlier steps were doing it. They are part of the ' +
        'assignment as it now stands: do your step, and judge earlier work, against the ' +
        'assignment with them applied.';
  return `${opening}${body.slice(firstBreak)}`;
}

/**
 * The markers around the user's own words, so the agent can tell them from the task.
 *
 * Fenceless and unusual for the reason the role block's are: a message may contain
 * any heading, list or code fence a person cares to type, and a delimiter the
 * content could itself contain is one that ends the content early. A test asserts
 * the prompt contains these, which is how *the message reached the provider* stops
 * being a claim and becomes something checkable in the run record's saved prompt.
 */
export const INSTRUCTION_BLOCK_OPEN = '===== message from the user, as written =====';
export const INSTRUCTION_BLOCK_CLOSE = '===== end of message =====';

/* ------------------------------------------------------------------------- */
/* Where a press of Send goes                                                 */
/* ------------------------------------------------------------------------- */

/**
 * What the composer does with the text it is holding.
 *
 * One function, because the hazard this carries is a *routing* mistake and not a
 * permission mistake. DSP-53 and DSP-32 both say a message typed during a run must
 * never start a competing walk in the same working copy, and both say it as
 * something the code must guarantee rather than something a caller must remember.
 * A `canSend` boolean beside a separate `if (useLoop)` would leave exactly one
 * unguarded combination — Use loop on, a walk already running — which is precisely
 * the state this card is about. Here that combination cannot be expressed: when a
 * run is in flight the only route out of this function is `instruction`.
 *
 * `blocked` carries its reason so the window can put it beside the button rather
 * than leaving a disabled control with no explanation.
 */
export type ComposerRoute =
  /** Start a chat-loop walk. Only reachable when no run is in flight. */
  | { readonly kind: 'loop-run' }
  /** An ordinary single-agent turn. */
  | { readonly kind: 'agent-turn' }
  /**
   * Into the run already walking (DSP-32, DSP-147): to the step that is working, through
   * its runtime's steering where it has it, and otherwise to the next step.
   */
  | { readonly kind: 'instruction'; readonly runId: string }
  /** DSP-147: into the ordinary agent turn that is working, as steering of that turn. */
  | { readonly kind: 'steer' }
  | {
      readonly kind: 'blocked';
      readonly reason: string;
      /**
       * The reason is worth saying only if the person asks for it.
       *
       * One case: an empty box. *There is nothing in the box to send* beside an
       * empty box and a dead Send button tells a person what they can already
       * see, and it was on screen for the whole of every idle moment. The reason
       * is still here for the press that reaches `send` with nothing in it; it is
       * not printed under the composer.
       */
      readonly quiet?: boolean;
    };

export interface ComposerState {
  /** The composer's text, untrimmed. */
  readonly text: string;
  /** A chat-loop walk is in flight in this working copy. */
  readonly loopRunning: boolean;
  /** The run that walk belongs to, or `null` when the window has lost track of it. */
  readonly loopRunId: string | null;
  /** The Use loop toggle, as it is at the moment of the press. */
  readonly useLoop: boolean;
  /** An ordinary provider turn is outstanding and has not been asked to stop. */
  readonly outstandingTurn: boolean;
  /**
   * Attempts with no known outcome, which gate the next message until named: by
   * conversation and ID, so a send that names some of them can be told apart from
   * the ones it does not (DSP-124).
   */
  readonly unresolvedAttempts: readonly AttemptRef[];
  /**
   * Something other than a send is occupying the window: choosing a folder,
   * starting a session, cancelling, reading files, running the command.
   *
   * Separate from the send itself, and that separation is the fix. `busy !== null`
   * conflated "a loop run is walking" with "a modal folder dialog is open", and
   * only the second is a reason the composer cannot be used.
   */
  readonly otherWorkInProgress: boolean;
  /** No project is open, so there is nothing to send to. */
  readonly sessionOpen: boolean;
  /**
   * A project is open but no agent session is behind it (DSP-121): the sentence that
   * says what to do instead, naming only the choices on offer, or `null` while an
   * agent session is open. An ordinary message is held back in the box rather than
   * sent to be refused; a loop run is unaffected, because it opens sessions of its
   * own.
   */
  readonly noProviderSession: string | null;
}

/**
 * How the window writes attempts that need acknowledging: by ID, and by conversation
 * as well where two of them carry the same ID (WS-1 follow-up). Files saved by
 * earlier builds can share an ID, and "dsp-attempt-0004, dsp-attempt-0004" names
 * nothing. Full owner labels on every row are later work (WS-2).
 */
export function attemptRefLabels(refs: readonly AttemptRef[]): string[] {
  return refs.map((ref) =>
    refs.filter((other) => other.attemptId === ref.attemptId).length > 1
      ? `${ref.attemptId} (conversation ${ref.conversationId ?? 'none'})`
      : ref.attemptId,
  );
}

/**
 * Where a press of Send goes.
 *
 * `acknowledged` is what an explicit *Send anyway* (or the Execution state's button)
 * names, and nothing else passes it: Enter and the ordinary route name nothing.
 * Those attempts no longer block this one send (DSP-124) - the press is the
 * acknowledgement, and the main process records it and leaves them unresolved.
 * Matched by conversation and ID, never by label, so an attempt the press did not
 * name still blocks. Only for an ordinary message: the acknowledgement travels with
 * `sendPrompt`, and a loop run or a message into a running walk carries none, so for
 * those the gate stays exactly as it was.
 */
export function composerSendRoute(
  state: ComposerState,
  acknowledged: readonly AttemptRef[] = [],
): ComposerRoute {
  if (state.text.trim() === '') {
    return { kind: 'blocked', reason: 'There is nothing in the box to send.', quiet: true };
  }
  if (!state.sessionOpen) {
    return {
      kind: 'blocked',
      reason: 'No project is open, so there is nowhere to send this. Open one first.',
    };
  }
  if (state.otherWorkInProgress) {
    return {
      kind: 'blocked',
      reason:
        'DSpatch is in the middle of something else — opening a project, cancelling, or ' +
        'running a command. Your text is kept; send it when that has finished.',
    };
  }
  // DSP-121: with no agent session behind the conversation an ordinary message has
  // nowhere to go, whatever else is pending - so this comes before the unresolved
  // attempts, whose acknowledgement could not get it sent either, and the note names
  // the way forward the panel offers. Only for an ordinary message: a loop run walks in
  // sessions of its own (review B2), so Use loop and a run in flight are routed below
  // exactly as before. Enter holds the text in the box rather than sending it to be
  // refused.
  if (state.noProviderSession !== null && !state.useLoop && !state.loopRunning) {
    return { kind: 'blocked', reason: state.noProviderSession };
  }
  // DSP-147: a message while work is running is steering of that work (INTERACTION_MODEL
  // §3.1). It is part of the work already going, not a new attempt, so the gate on earlier
  // attempts with no known outcome below does not apply to it. A run in flight takes the
  // message whatever the toggle says, so there is no path from here to a second walk in
  // the same working copy.
  if (state.loopRunning) {
    if (state.loopRunId === null) {
      return {
        kind: 'blocked',
        reason:
          'A loop run is working but DSpatch has lost track of which one, so it cannot ' +
          'say where this message would go. Your text is kept. Cancel the run, or wait ' +
          'for it to report an end.',
      };
    }
    return { kind: 'instruction', runId: state.loopRunId };
  }
  if (state.outstandingTurn) {
    return { kind: 'steer' };
  }
  const acknowledgedHere = state.useLoop || state.loopRunning ? [] : acknowledged;
  const labels = attemptRefLabels(state.unresolvedAttempts);
  const unnamed = labels.filter((_label, position) => {
    const ref = state.unresolvedAttempts[position];
    return !acknowledgedHere.some(
      (named) =>
        named.attemptId === ref?.attemptId && named.conversationId === ref.conversationId,
    );
  });
  if (unnamed.length > 0) {
    return {
      kind: 'blocked',
      reason:
        `${unnamed.length === 1 ? 'An earlier attempt has' : `${String(unnamed.length)} earlier attempts have`} ` +
        `no known outcome (${unnamed.join(', ')}), so DSpatch will not send ` +
        'another message by itself. Your text stays where it is.',
    };
  }
  return state.useLoop ? { kind: 'loop-run' } : { kind: 'agent-turn' };
}

/** Whether Send is live, for the button and for Enter. */
export function composerCanSend(state: ComposerState): boolean {
  return composerSendRoute(state).kind !== 'blocked';
}

/**
 * Why a press of Send would be refused, or `null` when there is nothing to say.
 *
 * **The `instruction` route says nothing here any more** (DSP-87). It used to carry a
 * standing paragraph — *A loop run is working. Sending adds your message to it rather
 * than starting a second run in this project…* — which sat under the composer for the
 * whole of every run, explaining in advance something the window then says again, at
 * the message, once it has happened. The acknowledgement a person needs is the short
 * line on their own message in the column, which {@link loopInstructionStatusText}
 * writes and which is about the message that was actually sent.
 *
 * What is left is the refusals, and those stay: a press that does nothing has to say
 * why, and since the Send button went this is the only thing that does.
 */
export function composerRouteNote(route: ComposerRoute): string | null {
  switch (route.kind) {
    case 'blocked':
      return route.quiet === true ? null : route.reason;
    case 'instruction':
    case 'steer':
    case 'loop-run':
    case 'agent-turn':
      return null;
  }
}

/* ------------------------------------------------------------------------- */
/* Where a message sits in the output it was sent into (DSP-147)              */
/* ------------------------------------------------------------------------- */

/**
 * Where to break `text` for a message sent when `offset` characters of it had been
 * shown. Never earlier, so everything the person had read stays above their message;
 * moved forward only to the end of a word, or past the end of a fenced code block it
 * would otherwise cut, so both halves still read as text.
 */
export function steeringSplitPoint(text: string, offset: number): number {
  const at = Math.max(0, Math.min(Math.floor(Number.isFinite(offset) ? offset : 0), text.length));
  if (at === 0 || at === text.length) {
    return at;
  }
  const lines = text.slice(0, at).split('\n');
  const insideFence = lines.filter((line) => /^\s*```/.test(line)).length % 2 === 1;
  if (insideFence) {
    // The line holding `at` is the fence's opening or one inside it; the block closes at
    // the next fence line after it.
    const lineEnd = text.indexOf('\n', at);
    let search = lineEnd === -1 ? text.length : lineEnd + 1;
    while (search < text.length) {
      const next = text.indexOf('\n', search);
      const line = text.slice(search, next === -1 ? text.length : next);
      if (/^\s*```/.test(line)) {
        return next === -1 ? text.length : next + 1;
      }
      search = next === -1 ? text.length : next + 1;
    }
    return text.length;
  }
  if (/\s/.test(text.charAt(at - 1)) || /\s/.test(text.charAt(at))) {
    return at;
  }
  const space = /\s/.exec(text.slice(at));
  return space === null ? text.length : at + space.index;
}

export type AnchoredPiece<T> =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'message'; readonly message: T };

/**
 * `text` with each message put where it was sent ({@link steeringSplitPoint}), in the
 * order they were sent where two fall at the same place. Empty text pieces are left out.
 */
export function interleaveMessages<T>(
  text: string,
  messages: readonly { readonly offset: number; readonly message: T }[],
): readonly AnchoredPiece<T>[] {
  const placed = messages
    .map((entry, order) => ({ at: steeringSplitPoint(text, entry.offset), order, message: entry.message }))
    .sort((left, right) => left.at - right.at || left.order - right.order);
  const pieces: AnchoredPiece<T>[] = [];
  let from = 0;
  for (const entry of placed) {
    if (entry.at > from) {
      pieces.push({ kind: 'text', text: text.slice(from, entry.at) });
      from = entry.at;
    }
    pieces.push({ kind: 'message', message: entry.message });
  }
  if (from < text.length) {
    pieces.push({ kind: 'text', text: text.slice(from) });
  }
  return pieces;
}
