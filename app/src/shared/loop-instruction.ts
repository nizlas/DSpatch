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

/** Which step took a message, recorded after it happened rather than predicted. */
export interface LoopInstructionDelivery {
  readonly nodeId: string;
  /** The node's label from the graph that was walked, so a person can read it. */
  readonly nodeLabel: string;
  /** 1 for the first time that node ran in this run, 2 for the second, and so on. */
  readonly occurrence: number;
  readonly atUtc: string;
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
}

/**
 * The three things that can be true of a message, and there is no fourth.
 *
 * `never-delivered` is its own state rather than a variant of `pending`, because
 * the difference is the whole of §4.4's last sentence: a message still waiting may
 * yet be used, and one whose run has ended never will be. Collapsing them would
 * leave someone waiting for an effect that can no longer happen.
 */
export type LoopInstructionState = 'pending' | 'delivered' | 'never-delivered';

export function loopInstructionState(instruction: LoopInstruction): LoopInstructionState {
  if (instruction.delivered !== null) {
    return 'delivered';
  }
  return instruction.runEnded ? 'never-delivered' : 'pending';
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
  const delivered = instruction.delivered;
  if (delivered !== null) {
    return (
      `Given to “${delivered.nodeLabel}” when that step started` +
      `${delivered.occurrence > 1 ? `, on its ${ordinal(delivered.occurrence)} turn` : ''}, ` +
      `before its own task.`
    );
  }
  if (instruction.runEnded) {
    return 'The run ended first, so no agent ever received it.';
  }
  // Still says *next*, because that is the limit: a provider turn already running
  // cannot be told anything mid-way, and a person who reads this as "it has been
  // passed on" will expect an effect that is not coming. And still says no agent
  // has it, because that is §4.4: receipt by the window is not receipt by an agent.
  return 'Waiting. No agent has it yet; it goes to the next step the run starts.';
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
      return 'reached the agent';
    case 'never-delivered':
      return 'never reached an agent';
    case 'pending':
      return 'waiting for the next step';
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
        instruction.runId === event.runId && instruction.delivered === null
          ? { ...instruction, runEnded: true }
          : instruction,
      );
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
  /** Into the run already walking, as a message for a step that has not started. */
  | { readonly kind: 'instruction'; readonly runId: string }
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
  /** Attempts with no known outcome, which gate the next message until named. */
  readonly unresolvedAttempts: readonly string[];
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
}

export function composerSendRoute(state: ComposerState): ComposerRoute {
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
  if (state.unresolvedAttempts.length > 0) {
    return {
      kind: 'blocked',
      reason:
        `${state.unresolvedAttempts.length === 1 ? 'An earlier attempt has' : `${String(state.unresolvedAttempts.length)} earlier attempts have`} ` +
        `no known outcome (${state.unresolvedAttempts.join(', ')}), so DSpatch will not send ` +
        'another message by itself. Your text stays where it is.',
    };
  }
  // Before the `useLoop` branch, and that order is the guard. A run in flight takes
  // the message whatever the toggle says, so there is no path from here to a second
  // walk in the same working copy.
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
    return {
      kind: 'blocked',
      reason:
        'The agent is still working on the previous message and has not been asked to ' +
        'stop. Your text is kept. Cancel that turn, or wait for it to answer.',
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
    case 'loop-run':
    case 'agent-turn':
      return null;
  }
}

function ordinal(value: number): string {
  if (value === 2) {
    return 'second';
  }
  if (value === 3) {
    return 'third';
  }
  if (value === 4) {
    return 'fourth';
  }
  return `${String(value)}th`;
}
