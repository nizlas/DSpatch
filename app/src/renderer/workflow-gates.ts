/**
 * The pass/fail rules of the scripted workflow run, separated from the DOM.
 *
 * They live here for one reason: a gate that cannot fail is not evidence, and the
 * only way to show that a gate *can* fail is to feed it a counter-example. That is
 * impossible while the rule is welded to a live window and a billed provider turn.
 * `workflow-script.ts` reads the document and calls these functions; `tests/`
 * calls the same functions with hand-made observations. There is no second copy of
 * a rule anywhere.
 *
 * Nothing here may take, return or record an account address. The gates work on
 * presence and shape.
 */

/**
 * The window renders `…` in the answer element while a turn streams with no text
 * yet, so every streaming turn produces one 1-character sample before any text
 * arrives. A sample at or below this length says nothing about the answer.
 */
export const PLACEHOLDER_ANSWER_CHARS = 1;

export interface StreamingSample {
  /** Milliseconds after the send, as sampled by the script. */
  readonly atMs: number;
  readonly answerChars: number;
}

export interface StreamingGateVerdict {
  /** Samples that carry actual answer text rather than the placeholder. */
  readonly substantiveSampleCount: number;
  readonly distinctSubstantiveAnswerLengths: number;
  readonly distinctSubstantiveSampleTimes: number;
  readonly grewBetweenSubstantiveSamples: boolean;
  /** Non-null means the gate rejects the observation, and says why. */
  readonly failure: string | null;
}

/**
 * Did the answer visibly grow *in text* while the turn was still streaming?
 *
 * The rule counts only samples longer than the placeholder and requires at least
 * two distinct such lengths at two distinct times. That is what separates
 * incremental rendering from a buffered replay: a single delivery of the whole
 * answer yields exactly one substantive length, however long it is, whereas
 * incremental rendering yields a length strictly between empty and final.
 */
export function checkAnswerGrewWhileStreaming(
  samplesWhileStreaming: readonly StreamingSample[],
): StreamingGateVerdict {
  const substantive = samplesWhileStreaming.filter(
    (sample) => sample.answerChars > PLACEHOLDER_ANSWER_CHARS,
  );
  const distinctLengths = new Set(substantive.map((sample) => sample.answerChars)).size;
  const distinctTimes = new Set(substantive.map((sample) => sample.atMs)).size;
  const grew = substantive.some(
    (sample, at) => at > 0 && sample.answerChars > (substantive[at - 1]?.answerChars ?? 0),
  );

  let failure: string | null = null;
  if (distinctLengths < 2 || distinctTimes < 2 || !grew) {
    failure =
      'the answer did not visibly grow in the window while the turn was still ' +
      `streaming: ${String(substantive.length)} samples longer than the ` +
      `${String(PLACEHOLDER_ANSWER_CHARS)}-character placeholder, ` +
      `${String(distinctLengths)} distinct lengths at ${String(distinctTimes)} ` +
      'distinct times. A single delivery of the whole answer looks exactly like ' +
      'this, so incremental rendering is not established.';
  }

  return {
    substantiveSampleCount: substantive.length,
    distinctSubstantiveAnswerLengths: distinctLengths,
    distinctSubstantiveSampleTimes: distinctTimes,
    grewBetweenSubstantiveSamples: grew,
    failure,
  };
}

/**
 * What the connection panel said, reduced to shape.
 *
 * `accountCharacters` and `accountLooksLikeAnAddress` are derived by the caller
 * from the DOM text; the text itself is deliberately not a parameter, so no gate
 * or failure message can leak it.
 */
export interface ConnectionShape {
  readonly connectionKind: string;
  readonly accountCharacters: number;
  readonly accountLooksLikeAnAddress: boolean;
  readonly accountSaysUnknown: boolean;
}

export interface ConnectionGateVerdict {
  readonly failure: string | null;
}

/** The shortest thing that could be an address at all: `a@b`. */
const MIN_ACCOUNT_CHARACTERS = 3;

/**
 * Did the window report a live connection **and name an account**?
 *
 * The criterion has always been both halves. Until this gate existed only the
 * first half was enforced, so an empty or `unknown` account field passed.
 */
export function checkConnectionNamesAnAccount(
  shape: ConnectionShape,
): ConnectionGateVerdict {
  if (shape.connectionKind !== 'connected') {
    return {
      failure:
        `the window reported the connection as "${shape.connectionKind}", so the ` +
        'workflow could not be exercised',
    };
  }
  if (shape.accountCharacters === 0) {
    return {
      failure:
        'the window reported the connection as connected but named no account, so ' +
        'the criterion "connection status with the account named" is not met',
    };
  }
  if (shape.accountSaysUnknown) {
    return {
      failure:
        'the window reported the connection as connected but the account field says ' +
        'unknown, so no account was named',
    };
  }
  if (!shape.accountLooksLikeAnAddress || shape.accountCharacters < MIN_ACCOUNT_CHARACTERS) {
    return {
      failure:
        'the window reported the connection as connected but the account field is ' +
        `not address-shaped: ${String(shape.accountCharacters)} characters, ` +
        `contains an at sign: ${String(shape.accountLooksLikeAnAddress)}. The value ` +
        'itself is deliberately not reported.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* INTERACTION_MODEL §10 trials 4, 10 and 11                                  */
/* ------------------------------------------------------------------------- */

/**
 * The gates below read **sentences**, not state.
 *
 * Everything the previous increment built is a sentence a person reads: *DSpatch
 * has this and no agent has been given it yet*, *Given to “Check the work” when
 * that step started*, *asking is not stopping*. A gate that asserted a flag would
 * pass for a window that holds the right state and prints the wrong words, which
 * is the only failure mode that matters here — the state is already covered by
 * `tests/loop-instruction.test.ts` and its neighbours. So each of these takes the
 * text the document showed and nothing else.
 *
 * The curly quotation marks are the ones the product writes (U+201C/U+201D),
 * escaped so this file cannot be broken by an editor that helpfully straightens
 * them.
 */

/** The words the product uses when it has something positive to say about the work. */
const SUCCESS_CLAIMS = [
  'a started command passed',
  'the assignment was met',
  'Assignment met',
] as const;

export interface ComposerKeyObservation {
  /** Shift+Enter: did anything leave the box? */
  readonly shiftEnterSentSomething: boolean;
  /**
   * Whether the window cancelled the Shift+Enter keypress.
   *
   * It must not: cancelling is what would stop the textarea inserting the line
   * break. A scripted keypress is untrusted, so the browser performs no default
   * action for it and the break itself cannot be observed this way — what *can* be
   * observed is whether the window suppressed it, which is the half the window owns.
   */
  readonly shiftEnterDefaultPrevented: boolean;
  /** The composer still holds exactly what was typed before the press. */
  readonly shiftEnterTextPreserved: boolean;
  readonly enterSentSomething: boolean;
  /**
   * Enter must be cancelled, or the textarea inserts a break as well as sending
   * and the next message opens with a blank line.
   */
  readonly enterDefaultPrevented: boolean;
}

export interface GateVerdict {
  readonly failure: string | null;
}

/**
 * §9's keyboard rule, as the window behaves rather than as the helper decides.
 *
 * `composerKeyAction` is already tested directly. This is the other half: that the
 * real textarea in the real window is wired to it, that Enter sends a real message,
 * and that Shift+Enter neither sends nor has its default taken away.
 */
export function checkComposerKeysBehave(
  observation: ComposerKeyObservation,
): GateVerdict {
  if (observation.shiftEnterSentSomething) {
    return {
      failure:
        'Shift+Enter sent the message. §9 says Shift+Enter inserts a line break, so a ' +
        'person composing a second paragraph would have had it sent half-written.',
    };
  }
  if (observation.shiftEnterDefaultPrevented) {
    return {
      failure:
        'Shift+Enter was cancelled by the window, so the textarea never gets the key ' +
        'and no line break can be inserted. Nothing was sent, which is half of the ' +
        'rule; the other half is that the break happens.',
    };
  }
  if (!observation.shiftEnterTextPreserved) {
    return {
      failure:
        'the composer did not hold the text it was given after Shift+Enter, so the ' +
        'keypress changed what the person had written.',
    };
  }
  if (!observation.enterSentSomething) {
    return {
      failure:
        'Enter did not send. §9 says Enter sends, and it is now the only way to send — ' +
        'there is no Send button to fall back on — so this is the window ignoring the ' +
        'key rather than refusing the send.',
    };
  }
  if (!observation.enterDefaultPrevented) {
    return {
      failure:
        'Enter sent the message but the window did not cancel the key, so the textarea ' +
        'also inserted a line break behind the send and the next message starts blank.',
    };
  }
  return { failure: null };
}

export interface ThreadObservation {
  /** Every message the script sent, in the order it sent them. */
  readonly userMessagesSent: readonly string[];
  /**
   * The user's own messages as the thread shows them — mandates and messages into a
   * run alike, read out of the one transcript element and nowhere else.
   */
  readonly userMessagesShownInThread: readonly string[];
  /** The `… answered:` line above each agent reply. */
  readonly replyAuthorLinesShownInThread: readonly string[];
  /** Every handover sentence the thread showed. */
  readonly handoverSentencesShownInThread: readonly string[];
  /** Replies whose text reached the thread. */
  readonly replyTextsShownInThread: readonly string[];
}

/**
 * §10 trial 10: one thread, several turns, and a handover a reader can follow.
 *
 * The messages are matched by content rather than counted, because a count passes
 * for a thread that showed the same message twice and lost the other one. Two
 * distinct authors are required for the same reason a handover sentence alone is
 * not enough: the sentence is DSpatch's, and the replies are what it is about.
 */
export function checkOneThreadWithHandover(
  observation: ThreadObservation,
): GateVerdict {
  const missing = observation.userMessagesSent.filter(
    (sent) =>
      !observation.userMessagesShownInThread.some((shown) => shown.includes(sent.trim())),
  );
  if (missing.length > 0) {
    return {
      failure:
        `${String(missing.length)} of ${String(observation.userMessagesSent.length)} ` +
        'messages the script sent are not in the conversation thread, so the thread is ' +
        'not where the user\u2019s own messages live. §9 requires one continuous thread ' +
        'and §6 rules out separate locations for a question and its reply.',
    };
  }
  const authors = new Set(
    observation.replyAuthorLinesShownInThread.map((line) => line.trim()).filter((line) => line !== ''),
  );
  if (authors.size < 2) {
    return {
      failure:
        `the thread showed ${String(authors.size)} distinct agent replies, so there is ` +
        'no handover in it to follow. A multi-turn conversation with an agent handover ' +
        'needs two agents to have spoken in the same thread.',
    };
  }
  if (observation.replyTextsShownInThread.some((text) => text.trim() === '')) {
    return {
      failure:
        'an agent reply was drawn in the thread with no text in it. A blank block ' +
        'attributed to an agent is DSpatch putting silence in its mouth; a step that ' +
        'said nothing is reported in words instead.',
    };
  }
  const handovers = observation.handoverSentencesShownInThread.filter(
    (sentence) => sentence.trim() !== '',
  );
  if (handovers.length === 0) {
    return {
      failure:
        'two agents replied in the thread and nothing between them said control had ' +
        'moved, so a reader sees two answers and no handover.',
    };
  }
  const unexplained = handovers.filter(
    (sentence) => !sentence.includes('handed over to') || !sentence.includes('took the branch'),
  );
  if (unexplained.length > 0) {
    return {
      failure:
        `${String(unexplained.length)} handover sentence(s) did not both name the roles ` +
        'and say which branch the run took, so the thread marks that control moved ' +
        'without saying why: ' +
        `\u201C${unexplained[0] ?? ''}\u201D`,
    };
  }
  return { failure: null };
}

export interface MessageDuringWorkObservation {
  /**
   * The note beside the composer at the moment the message was sent, which since
   * DSP-87 must be empty for a message that joins a run. See the gate below.
   */
  readonly routeNoteShownInWindow: string;
  /** Loop-run entries in the thread before and after the message was sent. */
  readonly loopEntriesBeforeSending: number;
  readonly loopEntriesAfterSending: number;
  /** The step the window named as current when the message was sent. */
  readonly stepRunningWhenSent: string;
  readonly pendingBadgeShownInWindow: string;
  readonly pendingSentenceShownInWindow: string;
  readonly deliveredBadgeShownInWindow: string;
  readonly deliveredSentenceShownInWindow: string;
  /** The second message, which no step ever took because the run ended first. */
  readonly undeliveredBadgeShownInWindow: string;
  readonly undeliveredSentenceShownInWindow: string;
}

/** `Given to “<step>”`, as the product writes it. */
const DELIVERED_STEP = /Given to \u201C([^\u201D]+)\u201D/;

/**
 * §10 trial 4 and §4.4: a message during work, and what became of it.
 *
 * Three rules do the work here and each of them was a real defect before the
 * previous increment:
 *
 * - the message must not start a second run in the same working copy, which is
 *   checked by counting the loop entries either side of the send;
 * - nothing may stand beside the composer saying so in advance. That check used to
 *   run the other way: the window had to carry *A loop run is working. Sending adds
 *   your message to it rather than starting a second run…* for the whole of every
 *   run. DSP-87 deleted it, and the direction is inverted rather than dropped so the
 *   paragraph cannot come back unnoticed. What it asserted is still asserted — by the
 *   entry count, which measures the run rather than a promise about it, and by the
 *   message's own line, which is written after the fact about the actual message;
 * - the pending sentence must not read as delivery — *received* and *delivered to
 *   the relevant agent* are different facts and §4.4 turns on the difference;
 * - the delivered sentence must **name the step**, and name one other than the step
 *   that was already running when the message was sent. A provider turn in flight
 *   cannot be told anything mid-way, so a window claiming that step had it would be
 *   claiming something that cannot happen.
 */
export function checkMessageJoinedTheRun(
  observation: MessageDuringWorkObservation,
): GateVerdict {
  if (observation.routeNoteShownInWindow.trim() !== '') {
    return {
      failure:
        'a paragraph stood beside the composer for the whole of the run, explaining in ' +
        'advance what the window says again, at the message, once it has happened. ' +
        'DSP-87 deleted it; an acknowledgement belongs on the message that was sent: ' +
        `it said \u201C${observation.routeNoteShownInWindow}\u201D`,
    };
  }
  if (observation.loopEntriesAfterSending !== observation.loopEntriesBeforeSending) {
    return {
      failure:
        `the thread held ${String(observation.loopEntriesBeforeSending)} loop runs before ` +
        `the message and ${String(observation.loopEntriesAfterSending)} after it. A ` +
        'message typed during a run must never start a second run in the same working ' +
        'copy — that is the defect DSP-32 #4 and DSP-53 #2 both name.',
    };
  }
  // The phrase shortened in DSP-87; the claim did not. What must be on screen is
  // that no agent is holding this yet, however few words that takes.
  if (!observation.pendingSentenceShownInWindow.includes('No agent has it yet')) {
    return {
      failure:
        'the message was shown without saying that no agent has it yet, so a person ' +
        'cannot tell DSpatch holding their message from an agent having read it: ' +
        `\u201C${observation.pendingSentenceShownInWindow}\u201D`,
    };
  }
  if (DELIVERED_STEP.test(observation.pendingSentenceShownInWindow)) {
    return {
      failure:
        'the message claimed to have reached a step while it was still only received. ' +
        '§4.4: receipt by the interface is not proof that the agent has acted on it.',
    };
  }
  const delivered = DELIVERED_STEP.exec(observation.deliveredSentenceShownInWindow);
  const step = delivered?.[1]?.trim() ?? '';
  if (step === '') {
    return {
      failure:
        'the message was eventually reported as delivered without naming the step that ' +
        'received it, so nobody can check the claim: ' +
        `\u201C${observation.deliveredSentenceShownInWindow}\u201D`,
    };
  }
  if (step === observation.stepRunningWhenSent.trim()) {
    return {
      failure:
        `the window says the message was given to \u201C${step}\u201D, which is the step ` +
        'that was already running when it was sent. A provider turn already in flight ' +
        'cannot be told anything mid-way, so either the message went nowhere it claims ' +
        'or the script sent it before that step began.',
    };
  }
  if (!observation.deliveredBadgeShownInWindow.includes('reached the agent')) {
    return {
      failure:
        'a delivered message did not read as having reached the agent: ' +
        `\u201C${observation.deliveredBadgeShownInWindow}\u201D`,
    };
  }
  if (observation.pendingBadgeShownInWindow.includes('reached the agent')) {
    return {
      failure:
        'a message that no step had been given read as having reached the agent: ' +
        `\u201C${observation.pendingBadgeShownInWindow}\u201D`,
    };
  }
  if (!observation.undeliveredSentenceShownInWindow.includes('no agent ever received it')) {
    return {
      failure:
        'a message the run ended before any step could take was not reported as never ' +
        'received, so someone is left waiting for an effect that can no longer happen: ' +
        `\u201C${observation.undeliveredSentenceShownInWindow}\u201D`,
    };
  }
  if (!observation.undeliveredBadgeShownInWindow.includes('never reached an agent')) {
    return {
      failure:
        'a message no step ever took did not read as never having reached an agent: ' +
        `\u201C${observation.undeliveredBadgeShownInWindow}\u201D`,
    };
  }
  const sentences = new Set([
    observation.pendingSentenceShownInWindow.trim(),
    observation.deliveredSentenceShownInWindow.trim(),
    observation.undeliveredSentenceShownInWindow.trim(),
  ]);
  if (sentences.size < 3) {
    return {
      failure:
        'two of the three states read identically in the window. A sentence that does ' +
        'not change as a message moves from received to delivered is not evidence that ' +
        'the window can tell them apart.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* INTERACTION_MODEL §9.1 and §10 trials 13 and 14: how the window reads       */
/* ------------------------------------------------------------------------- */

/**
 * The gates below take **measurements**, not claims.
 *
 * Every field is something the script read off the real document in the real
 * window: a pixel offset, a count of elements, a colour a browser computed. None
 * of them is a flag the window sets about itself, because a window that sets a
 * flag saying it did not jump is not evidence that it did not jump.
 *
 * They are deliberately quiet about anything they cannot see. Whether the result
 * is pleasant to read is Niclas's judgement and no gate here pretends otherwise.
 */
export interface ScrollObservation {
  /** Elements in the window that can scroll vertically, by `data-ev` or tag. */
  readonly verticalScrollersInWindow: readonly string[];
  /** How far the page itself can scroll. Zero means it cannot. */
  readonly pageScrollRangePx: number;
  /** Where the page was after the first message of the session was sent. */
  readonly pageScrollTopAfterFirstSend: number;
  /** How far from the bottom the conversation was after that send. */
  readonly transcriptDistanceFromBottomAfterFirstSend: number;
  /** And after a later send, with a long conversation above it. */
  readonly transcriptDistanceFromBottomAfterLaterSend: number;
  /** Where the reader put the conversation before content arrived. */
  readonly readingPositionChosen: number;
  /** Where it was afterwards. The rule is that these are the same. */
  readonly readingPositionAfterContentArrived: number;
  /** Whether new content did in fact arrive during that interval. */
  readonly contentGrewWhileReading: boolean;
  /** Whether the window offered a way back to the latest message. */
  readonly offeredTheWayBack: boolean;
  /** Where the conversation ended up after that offer was taken. */
  readonly distanceFromBottomAfterReturning: number;
}

/**
 * §9.1: one scroll area, no jump, and a reading position that is respected.
 *
 * The first rule is the one that makes the rest impossible to get wrong by
 * accident. If the page cannot scroll at all, no effect in the window can scroll it
 * to the top — the defect stops being unlikely and starts being unreachable.
 */
export function checkConversationScrollsWell(
  observation: ScrollObservation,
): GateVerdict {
  if (observation.verticalScrollersInWindow.length > 1) {
    return {
      failure:
        `the window has ${String(observation.verticalScrollersInWindow.length)} ` +
        'vertical scroll areas over the conversation, and §9.1 asks for one: ' +
        `${observation.verticalScrollersInWindow.join(', ')}. Competing page and ` +
        'message scrollers are what let one movement move two things.',
    };
  }
  if (observation.pageScrollRangePx > 0) {
    return {
      failure:
        `the page itself can scroll by ${String(observation.pageScrollRangePx)} px, ` +
        'so the application can still be moved as a whole while someone reads the ' +
        'conversation.',
    };
  }
  if (observation.pageScrollTopAfterFirstSend !== 0) {
    return {
      failure:
        'the page moved when the first message of the session was sent, which is the ' +
        `jump DSP-58 is about: it was at ${String(observation.pageScrollTopAfterFirstSend)} px.`,
    };
  }
  for (const [when, distance] of [
    ['the first message of the session', observation.transcriptDistanceFromBottomAfterFirstSend],
    ['a later message', observation.transcriptDistanceFromBottomAfterLaterSend],
  ] as const) {
    if (distance > FOLLOWING_TOLERANCE_PX) {
      return {
        failure:
          `after ${when} the conversation was ${String(Math.round(distance))} px from ` +
          'the latest message, so what the person had just sent was not in view.',
      };
    }
  }
  if (!observation.contentGrewWhileReading) {
    return {
      failure:
        'nothing arrived while the reader was scrolled back, so the trial did not ' +
        'produce the situation it exists to check. This is the instrument failing, ' +
        'not the window.',
    };
  }
  const moved = Math.abs(
    observation.readingPositionAfterContentArrived - observation.readingPositionChosen,
  );
  if (moved > FOLLOWING_TOLERANCE_PX) {
    return {
      failure:
        `content arriving moved the reader by ${String(Math.round(moved))} px while ` +
        'they were reading something further up. §9.1 requires the position to be ' +
        'preserved, and status updates and handovers are explicitly included.',
    };
  }
  if (!observation.offeredTheWayBack) {
    return {
      failure:
        'the conversation was scrolled back with newer messages below and the window ' +
        'offered no way to return to the latest.',
    };
  }
  if (observation.distanceFromBottomAfterReturning > FOLLOWING_TOLERANCE_PX) {
    return {
      failure:
        'the way back to the latest message did not reach it: the conversation was ' +
        `still ${String(Math.round(observation.distanceFromBottomAfterReturning))} px short.`,
    };
  }
  return { failure: null };
}

/**
 * Slack in pixels.
 *
 * Sub-pixel layout, a scrollbar's own rounding and a reply that grows by a
 * fraction of a line between two samples all produce small non-zero numbers that
 * mean nothing to a reader. A correct, briefly visible position does not have to
 * be exact to the pixel for an instrument's convenience.
 */
export const FOLLOWING_TOLERANCE_PX = 4;

export interface MarkdownObservation {
  /** Element tag names found inside a rendered agent reply. */
  readonly elementsInReply: readonly string[];
  /** The reply's visible text, as a reader sees it. */
  readonly visibleText: string;
  /** Text that must appear unchanged: code and code-like content. */
  readonly literalsRequired: readonly string[];
  /** Whether any executable element was created from the reply. */
  readonly scriptOrIframeElements: number;
  /** Whether an event-handler attribute reached the document from the reply. */
  readonly inlineEventHandlerAttributes: number;
  /** Link targets the reply produced, as the document holds them. */
  readonly linkHrefs: readonly string[];
  /** The same reply's text half way through streaming. */
  readonly visibleTextWhileStreaming: string;
  /** Element tags found in the reply half way through streaming. */
  readonly elementsWhileStreaming: readonly string[];
  /** The same reply read back after the saved conversation was reopened. */
  readonly elementsAfterReopening: readonly string[];
}

/** Markers a heading or emphasis must not still be showing. */
const RAW_MARKER = /(^|\n)\s*#{1,6}\s|\*\*/;

/**
 * §9.1: replies render, code stays literal, and nothing becomes executable.
 *
 * The literal check and the marker check pull against each other on purpose. It is
 * easy to pass either alone — strip every marker, or render nothing — and the only
 * way to pass both is to know which characters are content.
 */
export function checkRepliesRenderMarkdown(
  observation: MarkdownObservation,
): GateVerdict {
  if (observation.scriptOrIframeElements > 0) {
    return {
      failure:
        `the reply produced ${String(observation.scriptOrIframeElements)} executable ` +
        'element(s) in the document. Model output must never become script or markup, ' +
        'and this is the one rule here that is not a matter of taste.',
    };
  }
  if (observation.inlineEventHandlerAttributes > 0) {
    return {
      failure:
        `${String(observation.inlineEventHandlerAttributes)} inline event-handler ` +
        'attribute(s) reached the document from a reply.',
    };
  }
  const hostileLink = observation.linkHrefs.find(
    (href) => !/^(https?:|mailto:)/i.test(href),
  );
  if (hostileLink !== undefined) {
    return {
      failure: `a reply produced a link to "${hostileLink}", which is not an http or mailto target.`,
    };
  }
  for (const [when, elements, required] of [
    ['when it was finished', observation.elementsInReply, ['CODE', 'PRE']],
    // While streaming, only what has arrived can have been rendered: a fenced
    // block half way down a reply is not there yet, and requiring it would make
    // the gate a test of timing. What must be true is that the text arriving is
    // already formatted rather than waiting for the end.
    ['while it was still streaming', observation.elementsWhileStreaming, ['H2', 'STRONG']],
    [
      'after the saved conversation was reopened',
      observation.elementsAfterReopening,
      ['CODE', 'PRE'],
    ],
  ] as const) {
    const missing = required.filter((tag) => !elements.includes(tag));
    if (elements.length === 0 || missing.length > 0) {
      return {
        failure:
          `${when} the reply was not formatted: it contained ${String(elements.length)} ` +
          `element(s) and lacked ${missing.join(', ') || 'everything'}. §9.1 requires ` +
          'formatting during streaming and when a saved reply is reopened, not only at rest.',
      };
    }
  }
  const missingStructure = ['H2', 'STRONG', 'EM', 'OL', 'UL', 'A'].filter(
    (tag) => !observation.elementsInReply.includes(tag),
  );
  if (missingStructure.length > 0) {
    return {
      failure:
        `the reply did not render ${missingStructure.join(', ')}, so at least one of ` +
        'headings, emphasis, lists and links is still arriving as characters.',
    };
  }
  const missingLiteral = observation.literalsRequired.find(
    (literal) => !observation.visibleText.includes(literal),
  );
  if (missingLiteral !== undefined) {
    return {
      failure:
        'code content did not survive rendering unchanged. Missing from what the ' +
        `window shows: \u201C${missingLiteral}\u201D. A reply about Markdown or about ` +
        'shell syntax is exactly what this product shows.',
    };
  }
  // Outside the code, no marker should still be visible. The literals above are
  // removed first, because their markers are content and must remain.
  let prose = observation.visibleText;
  for (const literal of observation.literalsRequired) {
    prose = prose.split(literal).join(' ');
  }
  if (RAW_MARKER.test(prose)) {
    return {
      failure:
        'the reply still shows literal Markdown markers outside its code: ' +
        `\u201C${prose.replace(/\s+/g, ' ').slice(0, 160)}\u201D`,
    };
  }
  if (observation.visibleTextWhileStreaming.trim() === '') {
    return {
      failure:
        'nothing was readable in the reply while it was streaming, so formatting ' +
        'during streaming was not observed at all.',
    };
  }
  return { failure: null };
}

export interface WindowShapeObservation {
  /** Whether the user's message and the agent's reply are drawn differently. */
  readonly userMessageBackground: string;
  readonly agentReplyBackground: string;
  readonly userMessageBorderWidthPx: number;
  /**
   * The surface behind the conversation, so the box can be compared with it.
   *
   * Niclas's complaint was that a stronger border is not a lighter box, and a border
   * width alone cannot tell those apart. `checkUserMessageLooksLikeTheReference`
   * compares these two colours rather than looking for a particular hex value: the
   * requirement is a visible difference in lightness, not one shade.
   */
  readonly conversationBackground: string;
  /** Pixels of window height taken by permanent chrome above the conversation. */
  readonly chromeHeightPx: number;
  readonly conversationHeightPx: number;
  /** Whether the session details exist, and whether they are shown by default. */
  readonly sessionDetailsExist: boolean;
  readonly sessionDetailsOpenAtRest: boolean;
  /** Whether the real menu item opened them. The menu is the only route now. */
  readonly sessionDetailsOpenedWhenAsked: boolean;
  /** Facts that must still be reachable, and whether each was found. */
  readonly detailsFactsFound: Readonly<Record<string, boolean>>;
  /**
   * Which project the window says is open, without opening anything.
   *
   * Read from the conversation's own heading rather than from a row above it: the
   * project row is gone, and §9's requirement was that identity stays compact,
   * not that it stays in a bar. Reaching *another* project is a menu item, which a
   * script in the document cannot see, so it is checked by pressing the real menu
   * item rather than by looking for a button here.
   */
  readonly projectNameShown: string;
  /** Whether the model control sits with the composer rather than in a card. */
  readonly modelControlBesideComposer: boolean;
  readonly modelControlSaysWhatItAffects: string;
  /**
   * A long message: how tall it is collapsed and expanded, and how much of it is
   * in the document while collapsed.
   *
   * The third number is the one that matters. A preview made by cutting the string
   * would look identical on screen and would leave nothing to copy, so the gate
   * asks for the whole message to be present while the box is short.
   */
  readonly longMessage: {
    readonly charactersTyped: number;
    readonly charactersInDocumentWhileCollapsed: number;
    readonly collapsedHeightPx: number;
    readonly expandedHeightPx: number;
    /** How far the conversation moved under the reader across expand and collapse. */
    readonly readingPositionDriftPx: number;
    /** How many lines of text the collapsed box shows, from its own line height. */
    readonly collapsedLines: number;
    /** Whether a gradient is painted over the foot of the collapsed box. */
    readonly fadeAtTheFoot: boolean;
    /** Whether any labelled button is drawn with the message. None may be. */
    readonly buttonsWithTheMessage: number;
    /** Whether a click inside the collapsed box opened it. */
    readonly openedByClickingInside: boolean;
    /** Whether a click outside it folded it again. */
    readonly foldedByClickingOutside: boolean;
    /** Whether a drag that ended in a click was refused as an expansion. */
    readonly heldOpenThroughADragSelection: boolean;
    /** Whether the selection made by that drag survived. */
    readonly charactersSelectedByDragging: number;
    /** Whether the box can be operated from the keyboard with no visible button. */
    readonly openedByKeyboard: boolean;
    /** Whether a short message is interactive at all. It must not be. */
    readonly shortMessageIsInteractive: boolean;
  } | null;
  /**
   * Whether the conversation follows the window's width.
   *
   * `null` when the trial could not resize the window, which is an absent measurement
   * rather than a pass. Each entry is one width the window was actually given.
   */
  readonly widths: readonly {
    readonly contentWidthPx: number;
    readonly userMessageWidthPx: number;
    readonly agentReplyWidthPx: number;
    readonly composerWidthPx: number;
    /** How far the document overflows its own width. A page scrollbar is a failure. */
    readonly pageOverflowPx: number;
    /** The same for the conversation, where only a code block may scroll sideways. */
    readonly conversationOverflowPx: number;
  }[] | null;
  /**
   * Whether a finished run's status was still drawn after newer messages.
   *
   * `null` when the trial had no finished loop run in the conversation, which is
   * an absent measurement rather than a pass.
   */
  readonly runStatusOutlivedItsPlace: boolean | null;
  /** A connection problem's sentence, when the trial produced one. `null` if not. */
  readonly connectionProblemShownInContext: string | null;
}

/**
 * §9 and §10 trial 14: the conversation has the space, and nothing was lost.
 *
 * The share of the window is a measurement rather than a rule about pixels: a
 * quarter of the height spent on chrome is the difference between a workspace and
 * a dashboard, and that is the complaint this is answering.
 */
export function checkWindowGivesTheConversationTheSpace(
  observation: WindowShapeObservation,
): GateVerdict {
  if (observation.userMessageBackground === observation.agentReplyBackground) {
    return {
      failure:
        'the user\u2019s message and the agent\u2019s reply are drawn on the same ' +
        `background (${observation.userMessageBackground}), so a person cannot tell ` +
        'their own words from the answer at a glance.',
    };
  }
  if (observation.userMessageBorderWidthPx <= 0) {
    return {
      failure:
        'the user\u2019s message has no border, so it is not the distinct compact ' +
        'container §9.1 asks for.',
    };
  }
  if (observation.conversationHeightPx <= 0) {
    return { failure: 'the conversation was not on screen at all when measured.' };
  }
  const share =
    observation.chromeHeightPx / (observation.chromeHeightPx + observation.conversationHeightPx);
  if (share > 0.25) {
    return {
      failure:
        `permanent chrome above the conversation takes ${String(Math.round(share * 100))}% ` +
        'of the window. The card was removed to give the conversation the main space.',
    };
  }
  if (!observation.sessionDetailsExist) {
    return {
      failure:
        'the session details are not in the window at all. They were moved, not ' +
        'deleted: identifiers, paths and diagnostics must stay reachable.',
    };
  }
  if (observation.sessionDetailsOpenAtRest) {
    return {
      failure:
        'the session details are on screen without being asked for, which is the card ' +
        'again under another name.',
    };
  }
  if (!observation.sessionDetailsOpenedWhenAsked) {
    return {
      failure:
        'the Session menu item did not show the session details, so the only route ' +
        'left to identifiers and diagnostics does not work.',
    };
  }
  const lostFact = Object.entries(observation.detailsFactsFound).find(([, found]) => !found);
  if (lostFact !== undefined) {
    return {
      failure: `"${lostFact[0]}" is no longer readable anywhere in the window.`,
    };
  }
  if (observation.projectNameShown.trim() === '') {
    return {
      failure:
        'the window does not say which project is open without opening the details, ' +
        'so project identity did not survive the tidying.',
    };
  }
  if (!observation.modelControlBesideComposer) {
    return {
      failure: 'the model control is not beside the composer, where §9 puts it.',
    };
  }
  if (observation.modelControlSaysWhatItAffects.trim() === '') {
    return {
      failure:
        'the model control does not say which work a selection affects, so a person ' +
        'cannot tell whether it reaches a run already walking.',
    };
  }
  const long = observation.longMessage;
  if (long !== null) {
    if (long.charactersInDocumentWhileCollapsed < long.charactersTyped) {
      return {
        failure:
          `a collapsed long message holds ${String(long.charactersInDocumentWhileCollapsed)} of ` +
          `its ${String(long.charactersTyped)} characters, so it was shortened rather than ` +
          'clipped and cannot be copied whole while it is collapsed.',
      };
    }
    if (long.collapsedHeightPx >= long.expandedHeightPx) {
      return {
        failure:
          'a long message is the same height collapsed as expanded, so it is not ' +
          'bounded and clicking it does nothing visible.',
      };
    }
    if (long.readingPositionDriftPx > 24) {
      return {
        failure:
          `expanding and collapsing moved the conversation ${String(Math.round(long.readingPositionDriftPx))} px ` +
          'under the reader, so their place was not kept.',
      };
    }
  }
  if (observation.runStatusOutlivedItsPlace === true) {
    return {
      failure:
        'a finished run\u2019s status is drawn below newer messages, so it has outlived ' +
        'its place in the conversation and follows every later reply down the page.',
    };
  }
  return { failure: null };
}

/**
 * `rgb(24, 28, 34)` and friends, as three numbers out of 255. `null` for anything else.
 *
 * `color(srgb 0.17 0.19 0.21)` is in here because Chromium answers a `color-mix()`
 * background in that form, and the first run of this gate refused a correct window
 * over it — which is the refusal working: a comparator that cannot read one side must
 * say so rather than pass.
 */
function channelsOf(colour: string): readonly [number, number, number] | null {
  const legacy = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(colour);
  if (legacy !== null) {
    return [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])];
  }
  const modern = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(colour);
  if (modern !== null) {
    return [Number(modern[1]) * 255, Number(modern[2]) * 255, Number(modern[3]) * 255];
  }
  return null;
}

/** How much lighter one surface is than another, averaged over the channels. */
export function lightnessGap(lighter: string, darker: string): number | null {
  const above = channelsOf(lighter);
  const below = channelsOf(darker);
  if (above === null || below === null) {
    return null;
  }
  return (above[0] - below[0] + (above[1] - below[1]) + (above[2] - below[2])) / 3;
}

/** Below this the two surfaces are the same dark box with a different edge. */
const SURFACE_GAP_PX = 8;

/**
 * The user's message against the Cursor reference (DSP-65 #1).
 *
 * Separate from the gate above because it answers a different question. That one asks
 * whether the window gives the conversation the space; this one asks whether the box
 * Niclas is looking at is the one in the reference image — **a lighter surface**, the
 * wider element of the two, three or four lines when folded, a fade rather than a cut,
 * and **no buttons**, operated by clicking it and by the keyboard.
 *
 * None of this establishes that it looks right. A colour difference of nine is not a
 * judgement about a colour, and the only check for that is a person with the reference
 * beside the window. What these numbers do is refuse the four ways the last attempt
 * went wrong while reporting the right words.
 */
export function checkUserMessageLooksLikeTheReference(
  observation: WindowShapeObservation,
): GateVerdict {
  const gap = lightnessGap(observation.userMessageBackground, observation.conversationBackground);
  if (gap === null) {
    return {
      failure:
        `the surfaces could not be compared: the message reads "${observation.userMessageBackground}" ` +
        `and the conversation "${observation.conversationBackground}". A comparison that ` +
        'parses to nothing must refuse rather than pass.',
    };
  }
  if (gap < SURFACE_GAP_PX) {
    return {
      failure:
        `the user\u2019s message is ${gap.toFixed(1)} lighter than the conversation behind it ` +
        `(${observation.userMessageBackground} on ${observation.conversationBackground}), which ` +
        'is the same dark box with a stronger edge \u2014 the reference differs by its surface.',
    };
  }
  const long = observation.longMessage;
  if (long === null) {
    return { failure: null };
  }
  if (long.buttonsWithTheMessage > 0) {
    return {
      failure:
        `${String(long.buttonsWithTheMessage)} labelled button(s) are still drawn with the ` +
        'message. The reference has none: the box itself is the control.',
    };
  }
  if (long.collapsedLines < 2.5 || long.collapsedLines > 5) {
    return {
      failure:
        `a folded message shows ${long.collapsedLines.toFixed(1)} lines, where the reference ` +
        'shows three or four.',
    };
  }
  if (!long.fadeAtTheFoot) {
    return {
      failure:
        'a folded message ends at a hard edge with no fade, so it stops mid-word instead ' +
        'of dissolving into its own background.',
    };
  }
  if (!long.openedByClickingInside) {
    return { failure: 'clicking inside a folded message did not open it.' };
  }
  if (!long.foldedByClickingOutside) {
    return { failure: 'clicking outside an open message did not fold it again.' };
  }
  if (long.charactersSelectedByDragging <= 0) {
    return {
      failure:
        'the drag across the message selected nothing, so whether a selection is read as ' +
        'a click was not tested. This is the instrument failing to set itself up.',
    };
  }
  if (!long.heldOpenThroughADragSelection) {
    return {
      failure:
        'dragging to select text changed the fold, so selecting a sentence out of a message ' +
        'refolds or unfolds it. A pointer that moved is not a click.',
    };
  }
  if (!long.openedByKeyboard) {
    return {
      failure:
        'the folded message could not be opened from the keyboard, so removing the buttons ' +
        'removed the only way in for anyone not using a mouse.',
    };
  }
  if (long.shortMessageIsInteractive) {
    return {
      failure:
        'a short message is interactive, so the window is offering to unfold messages that ' +
        'were never folded.',
    };
  }
  return { failure: null };
}

/** More than a pixel of overflow is a scrollbar, not a rounding difference. */
const OVERFLOW_SLOP_PX = 1;

/**
 * The window at several widths (DSP-65 #2).
 *
 * The chat followed the window's height and not its width, because the column was
 * capped at 62 rem and widening the window past that only added margin. So the
 * measurement is taken at more than one width and compared: the box has to grow with
 * the window, and neither the page nor the conversation may overflow sideways at any
 * of them.
 */
export function checkWindowFollowsItsWidth(
  observation: WindowShapeObservation,
): GateVerdict {
  const widths = observation.widths;
  if (widths === null || widths.length < 2) {
    return {
      failure:
        'the window was measured at fewer than two widths, so whether it follows its own ' +
        'width was not tested. This is the instrument failing to set itself up.',
    };
  }
  for (const at of widths) {
    if (at.pageOverflowPx > OVERFLOW_SLOP_PX) {
      return {
        failure:
          `at ${String(at.contentWidthPx)} px the page overflows its own width by ` +
          `${String(at.pageOverflowPx)} px, so something is wider than the window.`,
      };
    }
    if (at.conversationOverflowPx > OVERFLOW_SLOP_PX) {
      return {
        failure:
          `at ${String(at.contentWidthPx)} px the conversation overflows sideways by ` +
          `${String(at.conversationOverflowPx)} px. Only a code block may scroll sideways.`,
      };
    }
    if (at.userMessageWidthPx < at.agentReplyWidthPx + 4) {
      return {
        failure:
          `at ${String(at.contentWidthPx)} px the user\u2019s message is ` +
          `${String(at.userMessageWidthPx)} px against the reply\u2019s ` +
          `${String(at.agentReplyWidthPx)} px. In the reference the user\u2019s message is the ` +
          'wider element.',
      };
    }
  }
  const narrow = widths[0] as NonNullable<(typeof widths)[number]>;
  const wide = widths[widths.length - 1] as NonNullable<(typeof widths)[number]>;
  const roomGained = wide.contentWidthPx - narrow.contentWidthPx;
  if (roomGained < 200) {
    return {
      failure:
        `the two widths differ by only ${String(roomGained)} px, which is not enough to show ` +
        'whether anything follows. This is the instrument failing to set itself up.',
    };
  }
  for (const [what, gained] of [
    ['the user\u2019s message', wide.userMessageWidthPx - narrow.userMessageWidthPx],
    ['the reply', wide.agentReplyWidthPx - narrow.agentReplyWidthPx],
    ['the composer', wide.composerWidthPx - narrow.composerWidthPx],
  ] as const) {
    if (gained < roomGained / 2) {
      return {
        failure:
          `the window gained ${String(roomGained)} px of width and ${what} gained ` +
          `${String(gained)} px of it, so it does not follow the window.`,
      };
    }
  }
  return { failure: null };
}

/**
 * What the window shows for an error a person meets in normal use (DSP-64).
 *
 * Read off the real session-start refusal, because that is the error Niclas met and
 * the one the card quotes. `fullMessageInDetail` is the check that keeps this from
 * being a cosmetic improvement: shortening the first line is only acceptable if the
 * whole sentence is still somewhere.
 */
export interface PlainErrorObservation {
  /** The first line the window shows. */
  readonly headlineShown: string;
  /** The short line about what can be done. */
  readonly nextStepShown: string;
  /** Whether the technical detail is closed when the error first appears. */
  readonly detailOpenAtRest: boolean;
  readonly detailOpenedWhenAsked: boolean;
  /** The text inside the disclosure, once open. */
  readonly detailText: string;
  /** The words the refusal must not have lost, whatever the presentation does. */
  readonly refusalWordsRequired: readonly string[];
  /** Whether an action was offered beside the error. */
  readonly actionOffered: string;
}

/**
 * DSP-64: one sentence saying what happened, the detail on request, nothing lost.
 *
 * The two failure modes it rules out are the two the card names: an error too short
 * to act on, and an error too long to read. The third rule is §5's, and it is the
 * one worth being strict about — a refusal that lost a word in being shortened has
 * become vaguer, which no amount of tidiness pays for.
 */
export function checkErrorReadsWell(observation: PlainErrorObservation): GateVerdict {
  if (observation.headlineShown.trim() === '') {
    return { failure: 'the window showed no sentence at all for the failure.' };
  }
  if (observation.nextStepShown.trim() === '') {
    return {
      failure:
        'the error says what happened and nothing about what can be done, which is ' +
        'the refusal Niclas met: correct, accurate and no way forward.',
    };
  }
  if (observation.detailOpenAtRest) {
    return {
      failure:
        'the technical detail is on screen without being asked for, so §9\u2019s ' +
        '"diagnostics behind details" is not what the window does.',
    };
  }
  if (!observation.detailOpenedWhenAsked) {
    return {
      failure:
        'asking for the technical detail did not show it. Behind a disclosure and ' +
        'unavailable are different things.',
    };
  }
  const shown = `${observation.headlineShown}\n${observation.detailText}`;
  const lost = observation.refusalWordsRequired.find((required) => !shown.includes(required));
  if (lost !== undefined) {
    return {
      failure:
        `the refusal lost "${lost}" in being shortened. A refusal may not become ` +
        'vaguer to become shorter: everything it said must still be readable.',
    };
  }
  if (observation.actionOffered.trim() === '') {
    return {
      failure: 'no action was offered beside the error, so the short sentence leads nowhere.',
    };
  }
  return { failure: null };
}

/* --------------------------------------------------------------------------- */
/* DSP-71 and DSP-73: folders that exist, a tree that looks, and nothing steered */
/* --------------------------------------------------------------------------- */

export interface FolderTreeObservation {
  /** The roots drawn, by the path each row carries. */
  readonly rootsShown: readonly string[];
  /** Names drawn one level under the second root, after expanding it once. */
  readonly namesUnderRoot: readonly string[];
  /**
   * Names that exist only deeper than one level.
   *
   * The whole of DSP-73 #1 is that none of these is on screen after one expansion.
   * A tree that read the subtree in advance would have them, and would look exactly
   * like this one until someone opened a folder with `node_modules` in it.
   */
  readonly namesOnlyDeeper: readonly string[];
  /** What the window said about the folder with more entries than the cap. */
  readonly cappedNoteShown: string;
  /** How many rows that folder actually drew. */
  readonly cappedRowsDrawn: number;
  /** How many entries are really in it. */
  readonly cappedEntriesOnDisk: number;
  /** How long the expansion of that folder took, measured rather than assumed. */
  readonly cappedExpansionMs: number;
  /** The text the reading view showed for an ordinary text file. */
  readonly textFileShown: string;
  /** A marker written into that file, which must reach the screen. */
  readonly textFileMarker: string;
  /** What the window said when a binary file was opened. */
  readonly binaryRefusalShown: string;
}

/**
 * A tree that looks at one directory at a time and reads a file as text.
 *
 * The expansion time is reported rather than judged. DSP-73 #6 asks for it to be
 * *measured on a real large folder*, and a threshold invented here would be a claim
 * about this machine dressed up as a rule — the number belongs in the report, where
 * a person can see it.
 */
export function checkFolderTree(observation: FolderTreeObservation): GateVerdict {
  if (observation.rootsShown.length < 2) {
    return {
      failure:
        `the tree drew ${String(observation.rootsShown.length)} root(s), so a workspace ` +
        'of several folders was not on screen and nothing else here was tested.',
    };
  }
  if (observation.namesUnderRoot.length === 0) {
    return { failure: 'expanding a root drew nothing, so the tree reads no directory at all.' };
  }
  const leaked = observation.namesOnlyDeeper.filter((name) =>
    observation.namesUnderRoot.includes(name),
  );
  if (leaked.length > 0) {
    return {
      failure:
        `expanding one folder put ${leaked.join(', ')} on screen, and ${
          leaked.length === 1 ? 'that name lives' : 'those names live'
        } deeper than one level. The tree read more than the directory it was asked ` +
        'for, which is the failure the progressive criterion exists to prevent.',
    };
  }
  if (observation.cappedRowsDrawn >= observation.cappedEntriesOnDisk) {
    return {
      failure:
        `the large folder drew ${String(observation.cappedRowsDrawn)} of ` +
        `${String(observation.cappedEntriesOnDisk)} entries, so the cap did not apply ` +
        'and a folder of any size would be laid out in full.',
    };
  }
  if (
    !observation.cappedNoteShown.includes(String(observation.cappedRowsDrawn)) ||
    !observation.cappedNoteShown.includes(String(observation.cappedEntriesOnDisk))
  ) {
    return {
      failure:
        'the large folder was capped without saying so in numbers. A cap counted out ' +
        `loud is the criterion; what was shown was "${observation.cappedNoteShown}".`,
    };
  }
  if (!observation.textFileShown.includes(observation.textFileMarker)) {
    return {
      failure:
        `the reading view did not show "${observation.textFileMarker}", which is in the ` +
        'file that was opened. What reached the screen was not the file.',
    };
  }
  if (observation.binaryRefusalShown.trim() === '') {
    return {
      failure:
        'a binary file was opened and the window said nothing. A refusal with a stated ' +
        'reason is the criterion; silence, or a pane of mangled bytes, is not.',
    };
  }
  return { failure: null };
}

export interface InertSelectionObservation {
  /** The loop definition the composer's chooser held, before and after. */
  readonly definitionBefore: string;
  readonly definitionAfter: string;
  /** The folder the main process calls the run's working copy, before and after. */
  readonly workingRootBefore: string;
  readonly workingRootAfter: string;
  /** Every open folder, before and after, as the main process reports them. */
  readonly foldersBefore: readonly string[];
  readonly foldersAfter: readonly string[];
  /** The file that was selected in between. Named so a pass says what it passed on. */
  readonly fileSelected: string;
}

/**
 * Reading a file did not move the work.
 *
 * DSP-73 #3, and it deserves its own gate for the reason the card gives: it is the
 * exact shape of the mistake INTERACTION_MODEL §8 records, the interface quietly
 * deciding the work. Someone reading a file while a loop runs must not discover that
 * reading moved it.
 */
export function checkSelectionIsInert(observation: InertSelectionObservation): GateVerdict {
  if (observation.fileSelected.trim() === '') {
    return { failure: 'no file was selected, so nothing was tested.' };
  }
  if (observation.workingRootBefore !== observation.workingRootAfter) {
    return {
      failure:
        `selecting ${observation.fileSelected} moved the run\u2019s working copy from ` +
        `${observation.workingRootBefore} to ${observation.workingRootAfter}. A tree is ` +
        'a way of looking, not a way of steering.',
    };
  }
  if (observation.definitionBefore !== observation.definitionAfter) {
    return {
      failure:
        `selecting ${observation.fileSelected} changed the chosen loop definition from ` +
        `${observation.definitionBefore} to ${observation.definitionAfter}.`,
    };
  }
  if (
    observation.foldersBefore.length !== observation.foldersAfter.length ||
    observation.foldersBefore.some((folder, index) => folder !== observation.foldersAfter[index])
  ) {
    return {
      failure:
        `selecting ${observation.fileSelected} changed the open folders from ` +
        `[${observation.foldersBefore.join(', ')}] to [${observation.foldersAfter.join(', ')}].`,
    };
  }
  return { failure: null };
}

export interface ReopenedWorkspaceObservation {
  /** The folders open when the second process started, before anything was opened. */
  readonly foldersAtStart: readonly string[];
  /** The folders the first process saved. */
  readonly foldersSaved: readonly string[];
  readonly definitionAtStart: string;
  readonly definitionSaved: string;
  /** The saved file's own text, so a pass can say what is and is not in it. */
  readonly savedFileText: string;
}

/**
 * A saved workspace came back with its folders and its loop, and with nothing else.
 *
 * DSP-71 #1 and #5 in one gate, because the second is a statement about the same
 * bytes the first is about: a workspace file that carried a run result would satisfy
 * "same folders, same definition" and still be wrong.
 */
export function checkWorkspaceReopened(observation: ReopenedWorkspaceObservation): GateVerdict {
  const missing = observation.foldersSaved.filter(
    (folder) => !observation.foldersAtStart.includes(folder),
  );
  if (missing.length > 0) {
    return {
      failure:
        `the workspace came back without ${missing.join(', ')}. It was saved with ` +
        `${String(observation.foldersSaved.length)} folder(s) and reopened with ` +
        `${String(observation.foldersAtStart.length)}.`,
    };
  }
  if (observation.definitionSaved === '') {
    return { failure: 'no loop definition was saved, so there was nothing to bring back.' };
  }
  if (observation.definitionAtStart !== observation.definitionSaved) {
    return {
      failure:
        `the workspace came back with "${observation.definitionAtStart}" as its loop ` +
        `definition rather than the "${observation.definitionSaved}" it was saved with.`,
    };
  }
  for (const forbidden of ['runId', 'graphVersionId', 'conversationId', 'result']) {
    if (observation.savedFileText.includes(forbidden)) {
      return {
        failure:
          `the saved workspace contains "${forbidden}". A workspace holds folders and a ` +
          'loop; a run result in it would be state nobody asked to keep.',
      };
    }
  }
  return { failure: null };
}

export interface WorkingRootsObservation {
  /** The folders the main process says a run would be given, in its order. */
  readonly rootsGiven: readonly string[];
  /** Which of them the main process calls the working directory. `''` when none. */
  readonly workingRoot: string;
  /** The note the main process wrote for these folders: headline, and the rest. */
  readonly noteFromMain: { readonly headline: string; readonly detail: string };
  /** The same two, as they are drawn in the sidebar. */
  readonly noteOnScreen: { readonly headline: string; readonly detail: string };
  /** Whether the detail was closed before anything was clicked. */
  readonly detailClosedAtFirst: boolean;
  /** Whether clicking the headline opened it. */
  readonly detailOpensOnClick: boolean;
  /** The loop definition the window is showing as chosen. */
  readonly definitionChosen: string;
  /** The graph on screen for that definition, read from its own bytes. */
  readonly graphMarkerOnScreen: string;
  /** What that marker has to be for the definition to be the one from the third place. */
  readonly graphMarkerExpected: string;
  /** The refusal the run gave when DSpatch's own folder was one of the roots. */
  readonly refusalForOwnRepository: string;
  /** DSpatch's own folder, which that refusal has to name. */
  readonly ownRepository: string;
}

/**
 * DSP-72, in the window: several roots, a definition from outside them, and a
 * description that does not overstate what a folder list is.
 *
 * **The wording half is a gate rather than a note**, and deliberately so. This card's
 * available failure is a feature that implies containment it does not have, and that
 * failure is made of sentences. A trial that recorded the sentence without judging it
 * would be a trial that could not fail on the thing most likely to go wrong.
 *
 * **The refusal is the negative control for "the roots reached the run".** DSpatch's own
 * folder is added as a *second* root, never the working copy — so if the window's
 * folders did not reach the run's root list, the run would be composed from the working
 * copy alone, that working copy is an ordinary sample project, and the refusal would not
 * happen at all. A refusal naming DSpatch is only possible if the added folder travelled.
 */
export function checkWorkingRootsReadHonestly(
  observation: WorkingRootsObservation,
): GateVerdict {
  if (observation.rootsGiven.length < 2) {
    return {
      failure:
        `a run would be given ${String(observation.rootsGiven.length)} folder(s), so ` +
        '"two separate folders" was never set up and nothing below was really tested.',
    };
  }
  if (observation.workingRoot === '' || !observation.rootsGiven.includes(observation.workingRoot)) {
    return {
      failure:
        `the working directory is "${observation.workingRoot}", which is not one of the ` +
        `folders the run would be given. Something has to be the shell\u2019s cwd.`,
    };
  }
  if (observation.definitionChosen === '') {
    return { failure: 'no loop definition was chosen, so no definition was used for a run.' };
  }
  if (observation.rootsGiven.some((root) => observation.definitionChosen.startsWith(root))) {
    return {
      failure:
        `the chosen definition ${observation.definitionChosen} is inside one of the ` +
        'working folders, so "a definition from a third place" was not tested.',
    };
  }
  if (observation.graphMarkerOnScreen !== observation.graphMarkerExpected) {
    return {
      failure:
        `the graph on screen carries "${observation.graphMarkerOnScreen}" rather than ` +
        `"${observation.graphMarkerExpected}", so the definition from outside the working ` +
        'folders is not the one that reached the screen.',
    };
  }
  if (observation.noteFromMain.headline === '' || observation.noteFromMain.detail === '') {
    return {
      failure:
        'the main process wrote no note about the folders. A list of folders a person can ' +
        'read as a boundary, with nothing saying it is not one, is the defect this card is ' +
        'about.',
    };
  }
  for (const part of ['headline', 'detail'] as const) {
    if (observation.noteOnScreen[part] !== observation.noteFromMain[part]) {
      return {
        failure:
          `the ${part} on screen is not the ${part} the main process wrote. A window that ` +
          'describes the folders differently from the process that hands them over is a ' +
          'second description, and one of two descriptions is always the wrong one.',
      };
    }
  }
  // The phrases that turn a description into a promise. Specific rather than a search
  // for "limit", because the honest note has to mention the absence of a limit.
  for (const phrase of [
    'limited to',
    'restricted to',
    'confined to',
    'may only',
    'cannot access',
    'only these folders',
    'sandbox',
  ]) {
    for (const part of ['headline', 'detail'] as const) {
      if (observation.noteOnScreen[part].toLowerCase().includes(phrase)) {
        return {
          failure:
            `the ${part} on screen says "${phrase}", which reads as a restriction. DSpatch ` +
            'has no containment to offer here and may not imply one.',
        };
      }
    }
  }
  /*
   * The headline carries it, not just the paragraph behind the disclosure.
   *
   * This is the whole point of DSP-64's shape being applied here rather than the note
   * simply being cut down: a first line that reads comfortably and leaves the
   * qualification for anyone who clicks would be worse than the wall of text it
   * replaced, because most people will not click.
   */
  if (!observation.noteOnScreen.headline.toLowerCase().includes('not a boundary')) {
    return {
      failure:
        'the headline on screen does not say the folders are not a boundary. Someone who ' +
        'reads only the first line must not come away believing they are one.',
    };
  }
  /*
   * A bound, not a style preference. 595 characters drawn open in a 300 px column is
   * the failure this shape was applied to fix, and the way it comes back is by the
   * headline growing a sentence at a time until it is the paragraph again.
   */
  if (observation.noteOnScreen.headline.length > 200) {
    return {
      failure:
        `the headline is ${String(observation.noteOnScreen.headline.length)} characters. ` +
        'It is meant to be the line someone reads at a glance; the detail is where length ' +
        'belongs.',
    };
  }
  if (!observation.detailClosedAtFirst) {
    return {
      failure:
        'the detail was already open, so the sidebar is drawing the whole paragraph ' +
        'unasked — which is the shape this was meant to replace.',
    };
  }
  if (!observation.detailOpensOnClick) {
    return {
      failure:
        'clicking the headline did not open the detail. Behind a disclosure is only ' +
        'acceptable while the disclosure works; unreachable is the same as removed.',
    };
  }
  if (observation.refusalForOwnRepository === '') {
    return {
      failure:
        'a run with DSpatch\u2019s own folder as a second root was not refused. The guard ' +
        'exists because an agent is not confined to the folders it is given.',
    };
  }
  if (!observation.refusalForOwnRepository.includes(observation.ownRepository)) {
    return {
      failure:
        `the refusal does not name ${observation.ownRepository}. With several folders open, ` +
        'a refusal that names no folder leaves a person to find the offending one themselves.',
    };
  }
  return { failure: null };
}

export interface InterruptedRunObservation {
  /** The distinct standings the script saw, in the order they first appeared. */
  readonly standingsSeen: readonly string[];
  /** The one line beside the run while the stop was outstanding. `''` when none. */
  readonly noteWhileStopping: string;
  /** The one line beside the run once it reported an end. `''` when none. */
  readonly noteAfterTheEnd: string;
  /**
   * Disclosures holding a run's standing, anywhere in the window. Must be none.
   *
   * Observed rather than assumed because the card forbids the obvious way to appear
   * to comply with it: a collapsed `details` containing the same paragraphs would
   * satisfy every assertion about what is *visible* while changing nothing.
   */
  readonly standingDisclosuresInTheWindow: number;
  readonly badgeShownInWindow: string;
  /** What the column says about the ending. `''` at a stop the person asked for. */
  readonly accountShownInWindow: string;
  /** The interrupted run's own mandate, read after the interruption. */
  readonly mandateShownInWindow: string;
  readonly mandateAsSent: string;
  /** The earlier, completed run, read after the interruption. */
  readonly earlierMandateShownInWindow: string;
  readonly earlierMandateAsSent: string;
  readonly earlierRepliesStillShown: number;
}

/**
 * §10 trial 11: an interrupted call, with the assignment and the history intact.
 *
 * What it refuses to accept, in order: a window that cannot show the three states
 * §9 asks a reader to tell apart; a stop that reads as a stop before the run has
 * said it stopped; a stop that was confirmed and then explained anyway; a
 * disclosure holding the explanation instead; a lost assignment or lost history;
 * and any claim of success over a run that was cut short.
 *
 * **It no longer requires four sentences per state** (DSP-90). It used to fail a
 * window that left any of §9's four questions unanswered in prose, and that
 * requirement is what put a paragraph of internal vocabulary under Niclas's own
 * cancellation. What replaces it is narrower and, at the two moments this trial
 * looks, stricter: while the stop is outstanding the window must say the stop is
 * not confirmed, and once it is confirmed the window must say nothing further.
 *
 * One assertion moved out rather than away. The old gate required the words
 * *Nothing will be repeated* after an interruption, for §4.5's guarantee that no
 * step is silently redone. That guarantee is behaviour, not wording, and asserting
 * it against a sentence only ever tested that the sentence was present —
 * `loop-stop-means-stop.test.ts` tests the thing itself.
 *
 * It does **not** require a particular ending word. The run may have been anywhere
 * when the stop reached it, and insisting on one ending would make the gate a test
 * of timing rather than of honesty.
 */
export function checkInterruptedRunKeepsItsWork(
  observation: InterruptedRunObservation,
): GateVerdict {
  const seen = new Set(observation.standingsSeen);
  if (!seen.has('active')) {
    return {
      failure:
        'the window never showed the run as active, so \u201Cwork is happening\u201D is ' +
        'not one of the states it was observed to distinguish. Seen: ' +
        `${observation.standingsSeen.join(', ') || 'nothing'}.`,
    };
  }
  if (!seen.has('stop-requested') && !seen.has('unknown')) {
    return {
      failure:
        'the window went straight from working to stopped, with nothing in between for ' +
        'the interval in which a stop has been asked for and not yet confirmed. §4.5 ' +
        'requires those to be distinguishable. Seen: ' +
        `${observation.standingsSeen.join(', ') || 'nothing'}.`,
    };
  }
  if (!seen.has('stopped')) {
    return {
      failure:
        'the run never reached a state the window calls stopped, so nothing establishes ' +
        'that the interruption ended anything. Seen: ' +
        `${observation.standingsSeen.join(', ') || 'nothing'}.`,
    };
  }
  if (!observation.noteWhileStopping.includes('asking is not stopping')) {
    return {
      failure:
        'while the stop was outstanding the window did not say that asking is not ' +
        'stopping, so a requested stop and an observed stop read alike: ' +
        `\u201C${observation.noteWhileStopping}\u201D`,
    };
  }
  /*
   * The confirmed stop, and the whole of DSP-90 in one assertion.
   *
   * A record that could not be written is the exception, and it is allowed by name
   * rather than by a general escape: it is a fact about the person's project that
   * outlives their knowledge of the run's fate, which is the test for anything that
   * gets to speak here.
   */
  if (
    observation.noteAfterTheEnd.trim() !== '' &&
    !observation.noteAfterTheEnd.includes('not fully kept on disk')
  ) {
    return {
      failure:
        'after the stop was confirmed the window explained it anyway: ' +
        `\u201C${observation.noteAfterTheEnd}\u201D. A person who pressed stop and was ` +
        'told it stopped needs nothing further, and the technical account is in the run ' +
        'journal under diagnostics.',
    };
  }
  if (observation.standingDisclosuresInTheWindow > 0) {
    return {
      failure:
        `${String(observation.standingDisclosuresInTheWindow)} disclosure(s) holding a ` +
        'run\u2019s standing are still in the window. A collapsed summary containing the ' +
        'removed paragraphs is not a removal, and DSP-90 rules it out by name.',
    };
  }
  if (!observation.mandateShownInWindow.includes(observation.mandateAsSent.trim())) {
    return {
      failure:
        'the interrupted run\u2019s own assignment is no longer in the thread, so the ' +
        'interruption lost what was asked for and it would have to be typed again.',
    };
  }
  if (!observation.earlierMandateShownInWindow.includes(observation.earlierMandateAsSent.trim())) {
    return {
      failure:
        'the earlier run\u2019s assignment is no longer in the thread after the ' +
        'interruption, so history did not survive it.',
    };
  }
  if (observation.earlierRepliesStillShown < 2) {
    return {
      failure:
        `the earlier run\u2019s replies are down to ${String(observation.earlierRepliesStillShown)} ` +
        'after the interruption. The work that was already done and reported must still ' +
        'be readable.',
    };
  }
  const claimed = SUCCESS_CLAIMS.find(
    (claim) =>
      observation.accountShownInWindow.includes(claim) ||
      observation.badgeShownInWindow.includes(claim),
  );
  if (claimed !== undefined) {
    return {
      failure:
        `a run that was interrupted reported \u201C${claimed}\u201D. An interrupted call ` +
        'establishes nothing, and a false success is the one outcome §10 trial 11 names ' +
        'explicitly.',
    };
  }
  /*
   * A run is never left in the thread with nothing said about it — and the badge is
   * now what says it at a stop the person asked for (DSP-90).
   *
   * This used to require the account sentence outright. That is the assertion this
   * card inverts, so what it protected has to be restated rather than dropped: the
   * invariant was never "there is a paragraph", it was "the entry is not silent about
   * its own run". A marking that names the stop satisfies that, and a marking is what
   * a person who pressed the button is looking for.
   */
  if (observation.accountShownInWindow.trim() === '') {
    if (!seen.has('stopped') || observation.badgeShownInWindow.trim() === '') {
      return {
        failure:
          'the interrupted run was left in the thread with neither an account of how it ' +
          'ended nor a marking that says it stopped, which is worse than the silence it ' +
          'replaces.',
      };
    }
  }
  return { failure: null };
}

/** One agent step, as the run record on disk describes it afterwards. */
export interface RecordedStepObservation {
  readonly nodeId: string;
  /** The provider session the step ran in. `''` when the record names none. */
  readonly sessionId: string;
  /** What the step was told, whole, as the record kept it. */
  readonly prompt: string;
  /** What it answered. */
  readonly text: string;
}

/**
 * What the **main process** found on disk after the window walked a loop.
 *
 * Everything here comes from the run record the main process wrote and read back,
 * never from the document — which is the point. The claim under test is about what
 * DSpatch filed, and a renderer reporting on its own behaviour could not settle it.
 */
export interface LoopResultObservation {
  /** The run the window started. `''` when none did. */
  readonly runId: string;
  /** The run's own status word from the record's ending line. */
  readonly status: string;
  /** `result-filed` journal entries, one per result the runner filed. */
  readonly resultsFiled: readonly {
    readonly nodeId: string;
    readonly bytes: number;
    readonly digest: string;
  }[];
  /** The agent steps, in the order the record holds them. */
  readonly steps: readonly RecordedStepObservation[];
  /** Whether any journal entry says the run was refused, and what it said. */
  readonly refusal: string;
}

/**
 * DSP-79 in the window: a chat loop really walked, really filed a result, and really
 * handed it to a second agent.
 *
 * **It exists because of a hole this card made.** Declaring `consumes` on the chat
 * loop's `check` means a live run given nowhere to keep results is refused before it
 * walks — so a single dropped `resultsDir` in the window's handler turns every chat
 * loop run into a refusal, and no test in the suite would have noticed. The window's
 * wiring was, and had always been, guarded by nothing.
 *
 * **Every clause is a positive fact.** The gate never accepts "no refusal appeared",
 * which would pass for a dozen unrelated reasons including a run that never started.
 * It requires a filed result with bytes and a digest, two steps in two different
 * sessions, and the first step's own words inside the second step's prompt. A run
 * given no store produces none of those.
 */
export function checkLoopFiledAndHandedOver(observation: LoopResultObservation): GateVerdict {
  if (observation.refusal.trim() !== '') {
    return {
      failure:
        `the window's loop run was refused rather than walked: ` +
        `\u201C${observation.refusal.trim()}\u201D. The most likely cause is that the run ` +
        'was given nowhere to keep results, which is the wiring this trial exists for.',
    };
  }
  if (observation.runId.trim() === '') {
    return { failure: 'no run record was written, so the window started no loop run at all.' };
  }
  if (observation.resultsFiled.length === 0) {
    return {
      failure:
        `run ${observation.runId} finished as \u201C${observation.status}\u201D and filed no ` +
        'result. The chat loop\u2019s work step declares one, so either the run never ' +
        'reached it or it had nowhere to file it.',
    };
  }
  const empty = observation.resultsFiled.find(
    (filed) => filed.bytes <= 0 || filed.digest.trim() === '',
  );
  if (empty !== undefined) {
    return {
      failure:
        `the result filed for \u201C${empty.nodeId}\u201D has ${String(empty.bytes)} bytes and ` +
        `digest \u201C${empty.digest}\u201D. A filed nothing is the silence this mechanism ` +
        'exists to end, wearing a journal entry.',
    };
  }
  if (observation.steps.length < 2) {
    return {
      failure:
        `the record holds ${String(observation.steps.length)} agent step(s), so no handover ` +
        'happened and two agents cannot be told from one.',
    };
  }
  const first = observation.steps[0];
  const second = observation.steps[1];
  if (first === undefined || second === undefined) {
    return { failure: 'the record holds fewer steps than it counted.' };
  }
  if (first.sessionId.trim() === '' || second.sessionId.trim() === '') {
    return {
      failure:
        'the record does not say which provider session a step ran in, so whether the ' +
        'two steps were two agents cannot be read back at all.',
    };
  }
  if (first.sessionId === second.sessionId) {
    return {
      failure:
        `both steps ran in session \u201C${first.sessionId}\u201D. That is one agent asked ` +
        'two questions, which is the thing DSP-79 exists to stop being true.',
    };
  }
  const handedOver = first.text.trim();
  if (handedOver === '' || !second.prompt.includes(handedOver)) {
    return {
      failure:
        `\u201C${second.nodeId}\u201D was started without \u201C${first.nodeId}\u201D\u2019s ` +
        'own words in its prompt. With separate sessions that is a second agent working ' +
        'on an assignment it has been told nothing about.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* DSP-87: never silent while answering, and the deleted prose really gone    */
/* ------------------------------------------------------------------------- */

/**
 * One instant during a stream: how much reply was on screen, and what the window
 * was simultaneously saying about having heard nothing.
 *
 * Both halves at the same instant, which is the whole design. Niclas's window said
 * *281 s with nothing back* over a reply that was visibly arriving, and neither half
 * read alone is wrong: the text was there, and a sentence about a wait is a fair
 * thing to write. The defect is that both were true of the same moment, so a sample
 * that measured them a second apart could not see it.
 */
export interface StreamingSilenceSample {
  readonly atMs: number;
  /** Characters of reply text drawn for the working step at this instant. */
  readonly replyCharsShown: number;
  /** Tool calls drawn for the working step at this instant. */
  readonly toolCallsShown: number;
  /**
   * Every sentence on screen at that instant claiming nothing has come back.
   *
   * The scenario collects these by searching the document for the product's own
   * silence wording, so an empty list means the window was not saying it anywhere —
   * not merely that it was absent from the one element the script thought to read.
   */
  readonly silenceSentencesShown: readonly string[];
}

/**
 * The reading DSP-87 turns on: activity arriving and silence being claimed at once.
 *
 * A unit test cannot settle this. Every sentence involved is correct for some state,
 * and the fault was that the window was in two states at once — the loop's activity
 * on one identity and the chat's send-wait clock on another, with the clock winning
 * the line beside the composer. What establishes the fix is a sample taken while the
 * reply is growing, and it is only evidence if the growth and the sentence come from
 * the same instant.
 *
 * The first rule refuses a vacuous pass. A trial that observed no stream at all would
 * otherwise satisfy every other rule here by never having looked, which is the
 * strongest possible result and the emptiest.
 */
export function checkNeverSilentWhileAnswering(
  samples: readonly StreamingSilenceSample[],
): GateVerdict {
  const growing = samples.filter((sample, at) => {
    const previous = samples[at - 1];
    return (
      previous !== undefined &&
      (sample.replyCharsShown > previous.replyCharsShown ||
        sample.toolCallsShown > previous.toolCallsShown)
    );
  });
  if (growing.length < 2) {
    return {
      failure:
        `the trial took ${String(samples.length)} reading(s) and saw the reply grow in ` +
        `${String(growing.length)} of them, so it never observed the state it exists to ` +
        'check. This is a fault in the instrument, not a verdict on the window.',
    };
  }
  const contradicted = growing.find((sample) => sample.silenceSentencesShown.length > 0);
  if (contradicted !== undefined) {
    return {
      failure:
        `at ${String(contradicted.atMs)} ms the window was drawing ` +
        `${String(contradicted.replyCharsShown)} characters of reply and ` +
        `${String(contradicted.toolCallsShown)} tool call(s) from the working step, and ` +
        'saying at the same instant: ' +
        contradicted.silenceSentencesShown
          .map((sentence) => `\u201C${sentence}\u201D`)
          .join('; ') +
        '. DSpatch may not report that nothing has come back while it is receiving it.',
    };
  }
  return { failure: null };
}

export interface DeletedProseObservation {
  /**
   * Which of the deleted passages were found anywhere in the document, at any point
   * during the run. Searched across the whole document rather than per element,
   * because the criterion is absence and an element name can be renamed.
   */
  readonly passagesFoundInDocument: readonly string[];
  /** The composer's placeholder, as a person sees it before typing. */
  readonly placeholderShownInWindow: string;
  /** Words the card removes, found in the conversation column's visible text. */
  readonly wordsFoundInTheConversation: readonly string[];
}

/**
 * The deletions, checked as deletions.
 *
 * "The code no longer renders it" and "it is not in the document" are different
 * claims, and only the second is what Niclas asked for. A passage behind a condition
 * that happens not to hold during one trial is unused, not gone, and would come back
 * the first time the condition did.
 *
 * The placeholder is here rather than in a rule of its own because it is the same
 * deletion: it was a sentence explaining the loop, the entry assignment and both
 * keys, in the one place on screen whose meaning a person can already see.
 */
export function checkDeletedProseIsGone(observation: DeletedProseObservation): GateVerdict {
  if (observation.passagesFoundInDocument.length > 0) {
    return {
      failure:
        `${String(observation.passagesFoundInDocument.length)} passage(s) DSP-87 deletes ` +
        'were still in the document: ' +
        observation.passagesFoundInDocument
          .map((passage) => `\u201C${passage}\u201D`)
          .join('; '),
    };
  }
  const placeholder = observation.placeholderShownInWindow.trim();
  if (placeholder === '') {
    return {
      failure:
        'the composer has no placeholder at all. The keys are not discoverable any other ' +
        'way since the Send button went, so this is a deletion too far.',
    };
  }
  if (!placeholder.includes('Enter sends') || !placeholder.includes('Shift+Enter')) {
    return {
      failure:
        'the composer\u2019s placeholder stopped saying what the two keys do, which is the ' +
        `one fact in it a person cannot see for themselves: \u201C${placeholder}\u201D`,
    };
  }
  if (placeholder.length > 90) {
    return {
      failure:
        `the composer\u2019s placeholder is ${String(placeholder.length)} characters. It is ` +
        'the text a person reads while deciding what to type, and a paragraph there is ' +
        `the thing this card is about: \u201C${placeholder}\u201D`,
    };
  }
  if (observation.wordsFoundInTheConversation.length > 0) {
    return {
      failure:
        'the conversation still uses ' +
        observation.wordsFoundInTheConversation
          .map((word) => `\u201C${word}\u201D`)
          .join(' and ') +
        '. Both are this project\u2019s own vocabulary for things a person already has ' +
        'plain words for, and neither survives into what the window says.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* DSP-90: a stop the person asked for, explained by nothing                  */
/* ------------------------------------------------------------------------- */

/** One reading of the window, taken between the click on Cancel and the reported end. */
export interface StopSample {
  readonly atMs: number;
  /** The state the window is showing, from `data-standing` or the badge. */
  readonly stateShown: string;
  /** The line beside the run, whole. `''` when there is none. */
  readonly noteShown: string;
  /** Whether the run's badge had stopped saying `running …` by this reading. */
  readonly runHasReportedAnEnd: boolean;
}

export interface StopAsAskedObservation {
  /** Every reading from the click on Cancel to the reported end, in order. */
  readonly samples: readonly StopSample[];
  /** The badge on the run once the stop was confirmed. */
  readonly badgeAfterTheStop: string;
  /** The account sentence in the column once the stop was confirmed. */
  readonly accountAfterTheStop: string;
  /** The line beside the run once the stop was confirmed. */
  readonly noteAfterTheStop: string;
  /** Sentences the card deletes, found anywhere in the document after the stop. */
  readonly explanationsFoundAfterTheStop: readonly string[];
  /** Disclosures holding a run's standing, anywhere in the window. Must be none. */
  readonly standingDisclosuresInTheWindow: number;
  /** The note beside the composer after the stop was confirmed. */
  readonly stopWaitingNoteAfterTheStop: string;
}

/**
 * DSP-90: what the window says after a stop the person asked for and got.
 *
 * The reading this gate is written for is a *sequence*, not an end state, and that is
 * deliberate. Nothing here would be hard to satisfy by never showing anything at all,
 * so the first two checks are that the window did the job it is allowed to do — it
 * showed the stop as unconfirmed while it was unconfirmed, and it reached a confirmed
 * end. Only then is silence a virtue rather than an absence.
 *
 * The permitted exception is named rather than general, for the same reason as in the
 * interruption gate: a record that could not be written is a fact about the person's
 * project, and it is Niclas's own example of what must still appear.
 */
export function checkStopSaysNothingExtra(observation: StopAsAskedObservation): GateVerdict {
  if (observation.samples.length === 0) {
    return {
      failure:
        'the trial took no readings between asking for the stop and the run reporting ' +
        'an end, so it observed nothing about either. This is a fault in the instrument.',
    };
  }
  if (!observation.samples.some((sample) => sample.runHasReportedAnEnd)) {
    return {
      failure:
        'the run never reported an end, so what the window says about a *confirmed* stop ' +
        'was never on screen to be read. This is a fault in the instrument.',
    };
  }
  /*
   * The negative control for every silence below.
   *
   * A window that said nothing at any point would pass the rest of this gate while
   * having lost the one sentence DSP-90 keeps. §4.5 requires the interval in which a
   * stop has been asked for and not confirmed to be distinguishable, and this is the
   * assertion that it still is.
   */
  const whileUnconfirmed = observation.samples.filter((sample) => !sample.runHasReportedAnEnd);
  if (
    whileUnconfirmed.length > 0 &&
    !whileUnconfirmed.some((sample) => sample.noteShown.includes('asking is not stopping'))
  ) {
    return {
      failure:
        `in ${String(whileUnconfirmed.length)} reading(s) taken while the stop was ` +
        'unconfirmed, the window never said that asking is not stopping. That interval is ' +
        'the one this card keeps a sentence for, and DSP-1 measured 69.5 s of work ' +
        'continuing after DSpatch stopped listening.',
    };
  }
  if (observation.badgeAfterTheStop.trim() === '') {
    return {
      failure:
        'after the stop there was no marking on the run at all. The marking is what is ' +
        'left when the paragraph goes, so without it the entry says nothing about its own ' +
        'run.',
    };
  }
  if (observation.accountAfterTheStop.trim() !== '') {
    return {
      failure:
        'after a stop the person asked for, the column still explained it: ' +
        `\u201C${observation.accountAfterTheStop}\u201D. The marking ` +
        `\u201C${observation.badgeAfterTheStop}\u201D is the whole of what they did not ` +
        'already know.',
    };
  }
  if (
    observation.noteAfterTheStop.trim() !== '' &&
    !observation.noteAfterTheStop.includes('not fully kept on disk')
  ) {
    return {
      failure:
        'after a stop the person asked for, a note still stood beside the run: ' +
        `\u201C${observation.noteAfterTheStop}\u201D. Only a concrete circumstance they ` +
        'have to act on may speak there.',
    };
  }
  if (observation.stopWaitingNoteAfterTheStop.trim() !== '') {
    return {
      failure:
        'after the stop was confirmed, a note was still beside the composer: ' +
        `\u201C${observation.stopWaitingNoteAfterTheStop}\u201D. *Cancel requested* and ` +
        'what a stop does not replay are both answered by the marking on the run by then.',
    };
  }
  if (observation.explanationsFoundAfterTheStop.length > 0) {
    return {
      failure:
        `${String(observation.explanationsFoundAfterTheStop.length)} passage(s) this card ` +
        'removes were still in the document after the stop: ' +
        observation.explanationsFoundAfterTheStop
          .map((passage) => `\u201C${passage}\u201D`)
          .join('; '),
    };
  }
  if (observation.standingDisclosuresInTheWindow > 0) {
    return {
      failure:
        `${String(observation.standingDisclosuresInTheWindow)} disclosure(s) holding a ` +
        'run\u2019s standing are still in the window. The card rules out a collapsed ' +
        'summary containing the removed paragraphs by name.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* DSP-80 and DSP-36: liveness on the drawing, and where a run ended          */
/* ------------------------------------------------------------------------- */

/**
 * One node as the window is painting it, which is the only shape these gates read.
 *
 * Structurally the same as `NodeLiveness` in `env.d.ts` and deliberately declared again
 * rather than imported: the hook's own type is what the editor promises to report, and a
 * gate that imported it would silently follow a field being redefined. `animations` is the
 * browser's count of running animations, not a class name — *is anything moving* rather
 * than *was a rule written*.
 */
export interface NodeLivenessReading {
  readonly id: string;
  readonly state: string;
  readonly working: boolean;
  readonly ending: string;
  readonly animations: number;
  readonly glintsLit: number;
  readonly haloOpacity: number;
  readonly bodyWidth: number;
  readonly bodyHeight: number;
  readonly groupWidth: number;
  readonly groupHeight: number;
  readonly groupLeft: number;
  readonly groupTop: number;
  readonly tick: boolean;
  readonly ring: boolean;
}

/** One named moment in the walk: every marked node, as it was painted. */
export interface LivenessState {
  /** The state's own name, used in every sentence a failure writes. */
  readonly name: string;
  readonly entryNodeId: string;
  readonly nodes: readonly NodeLivenessReading[];
  /** Whether a run existed at all at this moment, from the view's own lock. */
  readonly runOn: boolean;
  /** The loop control's phase, as the window words it. */
  readonly controlPhase: string;
}

function nodeIn(state: LivenessState, nodeId: string): NodeLivenessReading | null {
  return state.nodes.find((node) => node.id === nodeId) ?? null;
}

function workingIn(state: LivenessState): readonly NodeLivenessReading[] {
  return state.nodes.filter((node) => node.working);
}

/**
 * How many pixels of a node are inside the window, for the capture gate below.
 *
 * Report 021's instrument, applied to a different subject. Its first version measured the
 * element's own height, which is the same whether the element is on screen or below the
 * fold — so it passed a capture in which the thing being claimed was not visible. This
 * measures the intersection with the viewport, which is what a person and a screenshot see.
 */
function visibleArea(node: NodeLivenessReading, width: number, height: number): number {
  const left = Math.max(0, node.groupLeft);
  const top = Math.max(0, node.groupTop);
  const right = Math.min(width, node.groupLeft + node.groupWidth);
  const bottom = Math.min(height, node.groupTop + node.groupHeight);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

/**
 * Refuse a picture that cannot show what it is about to be filed as evidence of.
 *
 * Report 021 built a gate of this shape and it caught two faults in its own instrument
 * before it caught anything in the product, which is the argument for having one at all.
 * Here the subject is a node rather than a panel: a capture titled *the step is working*
 * is worth nothing if the node in question is scrolled out of the canvas, so this measures
 * the node's own painted area inside the window and refuses below a floor that a 168×54
 * box comfortably clears at any zoom this trial uses.
 *
 * It says nothing about whether the glint looks right. That is Niclas's to judge, and no
 * measurement here should be read as a judgement of it.
 */
export function checkCaptureCanShowTheNode(
  label: string,
  node: NodeLivenessReading | null,
  viewportWidth: number,
  viewportHeight: number,
): GateVerdict {
  if (node === null) {
    return {
      failure:
        `the capture "${label}" was about a node that is not on the drawing at all, so ` +
        'there is nothing in the picture to look at.',
    };
  }
  const area = visibleArea(node, viewportWidth, viewportHeight);
  if (area < 2_000) {
    return {
      failure:
        `the capture "${label}" is about node "${node.id}", of which only ` +
        `${String(Math.round(area))} px\u00B2 is inside the window. A picture that does ` +
        'not contain its own subject is not evidence; the trial refuses it rather than ' +
        'filing it.',
    };
  }
  return { failure: null };
}

/**
 * Every state in the walk is the state it claims to be, and no two read alike.
 *
 * **Why one gate over the whole sequence rather than a check at each step.** The card's
 * claim is not that any one state is drawn correctly — it is that *readiness and work in
 * progress can be told apart at a glance*, and that a pause stops the motion without
 * taking the state away. Both are comparisons between moments, and a per-state assertion
 * cannot make one. So the readings are collected and compared here.
 *
 * What it does not do is judge the animation. It establishes that the right nodes are
 * moving, that the ones that should not be are not, and that the states differ from each
 * other in something a person can see. Whether the result is pleasant is Niclas's.
 */
export function checkLivenessStates(states: readonly LivenessState[]): GateVerdict {
  const named = (name: string): LivenessState | null =>
    states.find((state) => state.name === name) ?? null;
  const missing = ['ready', 'working', 'held', 'working-again', 'ended', 'ready-again'].filter(
    (name) => named(name) === null,
  );
  if (missing.length > 0) {
    return {
      failure:
        `the walk never reached ${missing.join(', ')}, so the sequence the card asks for ` +
        'was not put to the window.',
    };
  }
  const ready = named('ready') as LivenessState;
  const working = named('working') as LivenessState;
  const held = named('held') as LivenessState;
  const again = named('working-again') as LivenessState;

  // --- Ready: alive, and not working ---------------------------------------
  const readyEntry = nodeIn(ready, ready.entryNodeId);
  if (readyEntry === null || readyEntry.state !== 'ready') {
    return {
      failure:
        'with a loop chosen and nothing running, the entry step was marked ' +
        `"${readyEntry?.state ?? 'nothing at all'}" rather than ready.`,
    };
  }
  if (readyEntry.animations === 0) {
    return {
      failure:
        'the entry step of a chosen loop was not animating at all, so there is no pulse ' +
        'to say the loop is standing by.',
    };
  }
  if (readyEntry.glintsLit > 0) {
    return {
      failure:
        `a loop standing by had ${String(readyEntry.glintsLit)} glint segments lit on its ` +
        'entry step. The glint means a node is working, and a ready loop is not working \u2014 ' +
        'if it glints, readiness and work in progress cannot be told apart at a glance.',
    };
  }

  // --- Working: the glint, on the node the run is in and nowhere else -------
  const busy = workingIn(working);
  if (busy.length === 0) {
    return {
      failure:
        'no node was working while the run walked, so the glint was never put to the ' +
        'window at all.',
    };
  }
  for (const node of busy) {
    if (node.state !== 'active') {
      return {
        failure:
          `node "${node.id}" was drawn as working while its run state was "${node.state}". ` +
          'The glint has to follow the run.',
      };
    }
    if (node.glintsLit === 0) {
      return {
        failure:
          `node "${node.id}" was working and no glint segment was lit on it, so the one ` +
          'marking that means *an agent is doing something now* was missing.',
      };
    }
    if (node.animations < 2) {
      return {
        failure:
          `node "${node.id}" was working with ${String(node.animations)} running ` +
          'animations. The glint has to be moving and the pulse has to be underneath it.',
      };
    }
  }
  const glintingWhenIdle = working.nodes.filter((node) => !node.working && node.glintsLit > 0);
  if (glintingWhenIdle.length > 0) {
    return {
      failure:
        `${glintingWhenIdle.map((node) => `"${node.id}"`).join(', ')} showed the working ` +
        'glint without being the node the run is in.',
    };
  }

  // --- Ready and working are distinguishable -------------------------------
  //
  // The comparison the card actually asks for, made between the two readings rather
  // than asserted of either. A colour difference alone would pass every check above.
  const busiest = busy[0] as NodeLivenessReading;
  if (busiest.glintsLit <= readyEntry.glintsLit) {
    return {
      failure:
        `a working node showed ${String(busiest.glintsLit)} glint segments and a ready one ` +
        `showed ${String(readyEntry.glintsLit)}. Ready has the pulse alone and working has ` +
        'the glint over it; if those are the same, the two states look the same.',
    };
  }

  // --- Held: the motion stops and the state stays --------------------------
  if (!held.runOn) {
    return {
      failure:
        'the run had already ended by the time the hold was read, so "the working ' +
        'animation stops at a pause" was never put to the window.',
    };
  }
  const stillWorking = workingIn(held);
  if (stillWorking.length > 0) {
    return {
      failure:
        `${stillWorking.map((node) => `"${node.id}"`).join(', ')} was still drawn as ` +
        `working while the control said "${held.controlPhase}". A graph that animates ` +
        'through a pause contradicts the control an inch away from it.',
    };
  }
  if (held.nodes.length === 0) {
    return {
      failure:
        'while the run was held, no node on the drawing carried a mark, so a person ' +
        'looking at the graph could not see where the run had got to.',
    };
  }
  /*
   * "The state must still be evident" is checked as the marks being there, not as ink.
   *
   * The first version of this gate required a halo or a glint on something and failed a
   * correct window: the loop control holds a step *before it starts*, so at a hold the step
   * that just produced reads `finished` — a colour, a border weight and the word `done`,
   * none of which is motion and none of which this reading can see. Requiring a glow would
   * have been the trial insisting on the marking it happened to know about.
   *
   * What is worth insisting on is the one case where stopping the motion could take the
   * marking with it: a node still `active` at a hold. There the halo is the marking, and it
   * has to be visible and still.
   */
  const heldActive = held.nodes.filter((node) => node.state === 'active');
  for (const node of heldActive) {
    if (node.haloOpacity === 0) {
      return {
        failure:
          `node "${node.id}" was still the step the run is in while the control said ` +
          `"${held.controlPhase}", and it lost its marking along with its motion. A held ` +
          'step that looks like an unreached one is the failure this clause is about.',
      };
    }
    if (node.animations > 0) {
      return {
        failure:
          `node "${node.id}" was held and still had ${String(node.animations)} animations ` +
          'running on it.',
      };
    }
  }

  // --- Working again: the glint comes back --------------------------------
  const busyAgain = workingIn(again);
  if (busyAgain.length === 0) {
    return {
      failure:
        'after the hold was released the run went on and no node was drawn as working, so ' +
        'the glint did not come back.',
    };
  }
  if (busyAgain.every((node) => node.glintsLit === 0)) {
    return {
      failure: 'the node working after the hold had no glint segment lit on it.',
    };
  }
  return { failure: null };
}

/** One sample of the pair that establishes the glint does not follow the text. */
export interface SilenceSample {
  /** Characters of reply on screen at this instant. */
  readonly replyChars: number;
  /** The node the run is in, as the window is painting it. */
  readonly working: NodeLivenessReading | null;
  readonly atMs: number;
}

/**
 * A node thinking in silence keeps its glint (DSP-80, and DSP-87's fault one level down).
 *
 * The constraint is that the animation follow the **run's state** and not the arrival of
 * text, and the honest way to establish that is to find an interval in which no text
 * arrived and read the node inside it. So this looks for a consecutive pair of samples
 * whose reply length is identical — nothing came back between them — and requires the node
 * to have been working, with its glint lit and moving, at both ends.
 *
 * It needs the stream slowed to find such a pair at all, which is why the scenario sets
 * `DSPATCH_PRESENTATION_DELTA_MS`. The fixture's speed decides how long the quiet lasts
 * and nothing whatever about what the product does during it.
 *
 * *No such pair* is reported as not established rather than as a pass. A trial that
 * sampled too coarsely to find a quiet moment has not shown anything about quiet moments.
 */
export function checkGlintSurvivesSilence(samples: readonly SilenceSample[]): GateVerdict {
  if (samples.length < 2) {
    return { failure: 'fewer than two samples were taken, so no interval was measured.' };
  }
  const quiet = samples
    .map((sample, index) => ({ before: samples[index - 1], after: sample }))
    .filter(
      (pair): pair is { before: SilenceSample; after: SilenceSample } =>
        pair.before !== undefined &&
        pair.before.replyChars === pair.after.replyChars &&
        pair.before.working !== null &&
        pair.after.working !== null,
    );
  if (quiet.length === 0) {
    const lengths = samples.map((sample) => String(sample.replyChars)).join(', ');
    return {
      failure:
        'no two consecutive samples found the reply the same length while a node was ' +
        `working, so the trial never observed a quiet moment to read. Lengths: ${lengths}. ` +
        'This is a limitation of the sampling, not a verdict about the animation.',
    };
  }
  for (const pair of quiet) {
    for (const end of [pair.before.working, pair.after.working]) {
      if (end === null) {
        continue;
      }
      if (!end.working || end.glintsLit === 0 || end.animations === 0) {
        return {
          failure:
            `node "${end.id}" stopped showing the working glint during an interval in ` +
            `which no new text arrived (${String(pair.before.replyChars)} characters at ` +
            'both ends). A step thinking in silence is still working, and an animation ' +
            'that follows the deltas rather than the run is the fault DSP-87 repaired one ' +
            'surface over.',
        };
      }
    }
  }
  return { failure: null };
}

/** The same node measured at one zoom and then another, while the glint runs. */
export interface GlintFootprint {
  readonly label: string;
  readonly zoom: number;
  readonly node: NodeLivenessReading;
}

/**
 * The glint did not move or resize the node, at this zoom or the next.
 *
 * The failure this exists for is specific and is the one the card names: a travelling
 * highlight is usually drawn a few pixels *outside* the box so that it reads as being
 * around the node, and a shape wider than `NODE_WIDTH` makes the node appear to grow the
 * moment it starts working and shrink when it stops — while connections still attach to
 * the box, so the drawing comes apart under zoom.
 *
 * Two readings, and the comparison is deliberately in **graph units**: a client rectangle
 * grows with the zoom, so comparing raw pixels across a zoom change would fail on a
 * correct implementation. Dividing by the zoom gives the node's own size, which must be
 * the same number at both, and it must be the same for the body and for everything drawn
 * with it — the halo and the glint included.
 */
export function checkGlintKeepsTheNodesSize(
  readings: readonly GlintFootprint[],
): GateVerdict {
  if (readings.length < 2) {
    return { failure: 'fewer than two zoom levels were read, so nothing was compared.' };
  }
  const inUnits = readings.map((reading) => ({
    label: reading.label,
    zoom: reading.zoom,
    bodyWidth: reading.node.bodyWidth / reading.zoom,
    bodyHeight: reading.node.bodyHeight / reading.zoom,
    groupWidth: reading.node.groupWidth / reading.zoom,
    groupHeight: reading.node.groupHeight / reading.zoom,
    working: reading.node.working,
  }));
  const first = inUnits[0] as (typeof inUnits)[number];
  // A pixel of tolerance, because every one of these numbers was rounded to a whole
  // device pixel before being divided by the zoom. Anything the card is about is larger
  // than this by an order of magnitude.
  const tolerance = 1.5;
  for (const reading of inUnits.slice(1)) {
    for (const [what, a, b] of [
      ['the drawn box\u2019s width', first.bodyWidth, reading.bodyWidth],
      ['the drawn box\u2019s height', first.bodyHeight, reading.bodyHeight],
      ['everything drawn with it, in width', first.groupWidth, reading.groupWidth],
      ['everything drawn with it, in height', first.groupHeight, reading.groupHeight],
    ] as const) {
      if (Math.abs(a - b) > tolerance) {
        return {
          failure:
            `${what} changed from ${a.toFixed(1)} to ${b.toFixed(1)} graph units between ` +
            `"${first.label}" (zoom ${String(first.zoom)}) and "${reading.label}" (zoom ` +
            `${String(reading.zoom)}) while the glint was running. Zooming and panning must ` +
            'not move or resize the nodes.',
        };
      }
    }
    if (!reading.working) {
      return {
        failure:
          `the node had stopped working by the time "${reading.label}" was read, so the ` +
          'measurement says nothing about what the glint does under zoom.',
      };
    }
  }
  return { failure: null };
}

/** The same working node, painted with motion allowed and with it refused. */
export interface ReducedMotionObservation {
  /** Whether the main process managed to answer the media query the other way. */
  readonly emulated: boolean;
  readonly ordinary: NodeLivenessReading | null;
  readonly reduced: NodeLivenessReading | null;
}

/**
 * Reduced motion gets a still marking, not nothing.
 *
 * Both halves are failures and the card names both: an animation that ignores the
 * preference, and a node that loses its marking along with its motion. So this requires
 * the running-animation count to fall to nothing *and* the working node still to carry
 * something a person can see — which in the stylesheet is the glint becoming a continuous
 * ring rather than a dash running round the outline.
 *
 * `emulated: false` is reported as not established. A reading taken from a window that
 * never had the preference set would be a reading of the ordinary window twice.
 */
export function checkReducedMotionIsStill(
  observation: ReducedMotionObservation,
): GateVerdict {
  if (!observation.emulated) {
    return {
      failure:
        'prefers-reduced-motion could not be emulated in this window, so what reduced ' +
        'motion does was not established. This is a limitation of the trial.',
    };
  }
  const { ordinary, reduced } = observation;
  if (ordinary === null || reduced === null) {
    return {
      failure:
        'the working node was not on the drawing at one of the two readings, so motion ' +
        'allowed and motion refused were never compared.',
    };
  }
  if (ordinary.animations === 0) {
    return {
      failure:
        'nothing was animating on the working node before reduced motion was asked for, ' +
        'so switching it off cannot be shown to have done anything.',
    };
  }
  if (reduced.animations > 0) {
    return {
      failure:
        `${String(reduced.animations)} animations were still running on the working node ` +
        'with reduced motion asked for. The preference is not a suggestion.',
    };
  }
  if (reduced.glintsLit === 0 && reduced.haloOpacity === 0) {
    return {
      failure:
        'with reduced motion the working node lost every marking it had: no glint and no ' +
        'halo. Reduced motion gets a still marking, not nothing \u2014 otherwise a person ' +
        'who switches motion off can no longer see which step is working.',
    };
  }
  return { failure: null };
}

/* ------------------------------------------------------------------------- */
/* DSP-80, second pass: the light along the glint and the range of the pulse   */
/* ------------------------------------------------------------------------- */

/** The pulse at its two extremes, as the browser computed them. */
export interface PulseObservation {
  readonly label: string;
  readonly haloTrough: number;
  readonly haloPeak: number;
  readonly bodyTrough: number;
  readonly bodyPeak: number;
  readonly haloDurationMs: number;
  readonly bodyDurationMs: number;
  readonly labelClearanceUnits: number | null;
}

/** What the pulse's range was before this pass, for the comparison to mean anything. */
export const PULSE_RANGE_BEFORE = 0.4 - 0.08;

/**
 * The pulse reads more strongly, at the same rhythm, and still cannot reach the words.
 *
 * Three instructions, and each of them is a number here rather than a judgement.
 *
 * **Further apart.** Niclas found the pulse barely noticeable, so the range between its
 * weakest and strongest state has to be materially wider than the 0.32 it was. "Materially"
 * is taken as at least doubled, which is a threshold this gate can hold to and not a claim
 * that doubling is the right amount — whether it now reads clearly is his to say.
 *
 * **The same rhythm.** A wider range bought by breathing more slowly would satisfy the
 * first instruction and break the second, so the durations are required to be exactly the
 * two this stylesheet has always used: 2000 ms on a working node and 3200 ms on a ready one.
 *
 * **The text unaffected.** Argued as geometry rather than contrast. The layer that was
 * strengthened is the ring on the border; the words sit in the middle of the node. If the
 * ring's stroke cannot reach the label's ink, its opacity cannot have cost the label
 * anything at any point in the cycle — and the clearance is measured in graph units, so it
 * is not an artefact of the zoom the reading was taken at.
 */
export function checkPulseCarriesFurther(observation: PulseObservation): GateVerdict {
  const range = observation.haloPeak - observation.haloTrough;
  if (range < PULSE_RANGE_BEFORE * 2) {
    return {
      failure:
        `the pulse's ring moves between ${observation.haloTrough.toFixed(2)} and ` +
        `${observation.haloPeak.toFixed(2)}, a range of ${range.toFixed(2)} against the ` +
        `${PULSE_RANGE_BEFORE.toFixed(2)} it had. Niclas called that one barely noticeable ` +
        'and asked for the difference between the weakest and strongest state to grow.',
    };
  }
  if (observation.bodyPeak <= observation.bodyTrough) {
    return {
      failure:
        'the node body is not breathing at all, so the only thing left moving is the ring ' +
        'outside the border.',
    };
  }
  const expected = observation.label === 'ready' ? 3200 : 2000;
  for (const [what, duration] of [
    ['the ring', observation.haloDurationMs],
    ['the body', observation.bodyDurationMs],
  ] as const) {
    if (duration !== expected) {
      return {
        failure:
          `${what} takes ${String(duration)} ms rather than ${String(expected)} ms at ` +
          `"${observation.label}". The rhythm was the part Niclas approved and it is not to ` +
          'change; a wider range paid for with a slower breath is not what was asked for.',
      };
    }
  }
  if (observation.labelClearanceUnits === null) {
    return {
      failure:
        'the node\u2019s label could not be found, so whether the strengthened ring reaches ' +
        'the text was not established.',
    };
  }
  if (observation.labelClearanceUnits <= 0) {
    return {
      failure:
        `the ring's stroke comes within ${observation.labelClearanceUnits.toFixed(2)} graph ` +
        'units of the label\u2019s ink, so a brighter ring is drawn over the words. The ' +
        'pulse must not cost the text its readability.',
    };
  }
  return { failure: null };
}

/** One frozen frame of the glint, and where along the outline it was sampled. */
export interface GlintFrameObservation {
  readonly label: string;
  /** Where the leading edge was held, in hundredths of the outline. */
  readonly leadAt: number;
  /** How far the outline turned across the sampled span, in degrees. */
  readonly turnAcrossSpanDeg: number;
  /** Screen pixels per hundredth of the outline, which sets what a sample can resolve. */
  readonly screenPixelsPerUnit: number;
  readonly samples: number;
  /** How many of those points fell outside the drawing area, where nothing can be read. */
  readonly samplesOffTheCanvas: number;
  /** Whether this frame was meant to cross a corner. */
  readonly acrossACorner: boolean;
}

/**
 * The frame is worth sampling: it is where it says it is, and at a legible size.
 *
 * The pixel reading itself happens outside the window, in whatever can open the PNG. This is
 * the half that can be checked here, and each part of it answers a mistake of the same kind: a
 * capture labelled *across a corner* that was taken on a straight side would pass every
 * profile test and establish nothing about corners; a frame sampled at a zoom where the
 * gradient's steps are a fraction of a pixel would be a reading of the screen's resolution
 * rather than of the gradient; and a span running off the drawing area gives back a short
 * bright patch followed by dark, which reads exactly like a glint that is too short. The last
 * of those really happened here — the node sat behind the inspector panel — and a wrong answer
 * that looks like a finding is the worst kind of wrong answer to leave findable.
 */
export function checkGlintFrameIsWorthReading(
  observation: GlintFrameObservation,
): GateVerdict {
  if (observation.samplesOffTheCanvas > 0) {
    return {
      failure:
        `${String(observation.samplesOffTheCanvas)} of ${String(observation.samples)} points ` +
        `sampled for "${observation.label}" fell outside the drawing area, so whatever is ` +
        'read there is the window behind the canvas. Centre the node before capturing.',
    };
  }
  if (observation.samples < 40) {
    return {
      failure:
        `"${observation.label}" produced only ${String(observation.samples)} sample points ` +
        'along the outline, which is too few to tell a gradient from a row of dashes.',
    };
  }
  if (observation.screenPixelsPerUnit < 2) {
    return {
      failure:
        `"${observation.label}" was sampled at ${observation.screenPixelsPerUnit.toFixed(2)} ` +
        'screen pixels per hundredth of the outline. The gradient\u2019s finest steps are ' +
        'smaller than that, so a profile read here would be a reading of the screen rather ' +
        'than of the light. Zoom in before capturing.',
    };
  }
  if (observation.acrossACorner && Math.abs(observation.turnAcrossSpanDeg) < 60) {
    return {
      failure:
        `"${observation.label}" was meant to cross a corner and the outline turned only ` +
        `${observation.turnAcrossSpanDeg.toFixed(1)} degrees across the span that was ` +
        'sampled. A reading taken on a straight side says nothing about what happens at a ' +
        'corner, which is where a gradient made of pieces would give itself away.',
    };
  }
  if (!observation.acrossACorner && Math.abs(observation.turnAcrossSpanDeg) > 20) {
    return {
      failure:
        `"${observation.label}" was meant to be the straight-side reading and the outline ` +
        `turned ${observation.turnAcrossSpanDeg.toFixed(1)} degrees across it, so the two ` +
        'frames are not the comparison they are reported as.',
    };
  }
  return { failure: null };
}

/** One walk's ending, and what the drawing that was walked declared about it. */
export interface EndingObservation {
  readonly label: string;
  /** The terminal the runner said it reached. */
  readonly terminalNodeId: string;
  /** That terminal's `ending` attribute in the file that was walked. */
  readonly declared: string;
  /** That terminal's label on screen \u2014 the thing that must *not* decide. */
  readonly terminalLabel: string;
  /** The run's own recorded status. */
  readonly status: string;
  readonly node: NodeLivenessReading | null;
  /** Every other node's marks, so a tick in the wrong place is caught. */
  readonly others: readonly NodeLivenessReading[];
}

/**
 * The tick is the graph's declaration and the run's outcome, and never the wording.
 *
 * Niclas was explicit that success must not be worked out by comparing a node's display
 * name, so the pair this reads is built to make the wording useless: two copies of one
 * loop, walked to the same terminal, that terminal labelled *Assignment met* in both, and
 * the only difference between the files one `ending` attribute. A tick that followed the
 * words would appear twice; a tick that follows the declaration appears once.
 *
 * It also requires the other ending to be *marked* rather than bare — the card asks for
 * that too — and for nothing else on the drawing to carry either mark.
 */
export function checkEndingMarkFollowsTheOutcome(
  observations: readonly EndingObservation[],
): GateVerdict {
  if (observations.length === 0) {
    return { failure: 'no ending was read, so DSP-36 was not put to the window.' };
  }
  for (const observation of observations) {
    const node = observation.node;
    if (node === null) {
      return {
        failure:
          `after the ${observation.label} walk the terminal it reached ` +
          `("${observation.terminalNodeId}") carried no reading at all, so the run left ` +
          'nothing on the drawing to say where it ended.',
      };
    }
    if (node.ending === '') {
      return {
        failure:
          `the ${observation.label} walk ended at "${observation.terminalNodeId}" and the ` +
          'node carries no ending mark. Every end outcome is marked; only the tick is ' +
          'reserved for success.',
      };
    }
    const shouldTick = observation.declared === 'success' && observation.status === 'completed';
    if (shouldTick && !node.tick) {
      return {
        failure:
          `the ${observation.label} walk completed at "${observation.terminalNodeId}", ` +
          'which its own drawing declares as success, and no tick was drawn on it.',
      };
    }
    if (!shouldTick && node.tick) {
      return {
        failure:
          `the ${observation.label} walk put a green tick on "${observation.terminalNodeId}", ` +
          `whose drawing declares "${observation.declared}" and whose run ended ` +
          `"${observation.status}". The tick is what DSpatch believes happened, and the ` +
          `node being labelled \u201C${observation.terminalLabel}\u201D must not be able to ` +
          'earn it.',
      };
    }
    if (!shouldTick && !node.ring) {
      return {
        failure:
          `the ${observation.label} walk ended at "${observation.terminalNodeId}" with no ` +
          'tick and no other mark either. The card asks for the other endings to be ' +
          'marked as well, without a green tick.',
      };
    }
    const strays = observation.others.filter((other) => other.id !== node.id && other.tick);
    if (strays.length > 0) {
      return {
        failure:
          `after the ${observation.label} walk a tick was drawn on ` +
          `${strays.map((other) => `"${other.id}"`).join(', ')} as well as on the terminal ` +
          'the run actually reached.',
      };
    }
  }
  const ticked = observations.filter(
    (observation) => observation.node !== null && observation.node.tick,
  );
  const labels = new Set(observations.map((observation) => observation.terminalLabel));
  if (observations.length > 1 && labels.size === 1 && ticked.length === observations.length) {
    return {
      failure:
        `every walk earned a tick, and all of them ended at a terminal labelled ` +
        `\u201C${[...labels][0] ?? ''}\u201D. That is what a tick decided by the drawing\u2019s ` +
        'wording would look like.',
    };
  }
  return { failure: null };
}

/** What the drawing showed after the run, and after the next one started. */
export interface MarkLifetimeObservation {
  /** The entry step's state once the run had ended and the loop stood by again. */
  readonly entryStateAfterwards: string;
  /** Whether the terminal still carried its mark at that same moment. */
  readonly endingStillShown: boolean;
  /** Whether it was still there once a second run had started. */
  readonly endingShownInTheNextRun: boolean;
  /** Whether anything carried an ending mark after a different loop was drawn. */
  readonly endingShownOnAnotherDrawing: boolean;
  /** The terminal the first run reached, for the sentences below. */
  readonly terminalNodeId: string;
}

/**
 * The mark lasts exactly as long as it is true for (DSP-36 #6, #7, #8).
 *
 * Three moments, and each of them was a way the first attempt at this could have been
 * wrong. It has to survive the stand-by offer that puts the Ready pulse back, because
 * seeing a finished run and a ready loop at once is the whole request. It has to go when
 * the next run starts, because by then it is the wrong answer to *what is happening*. And
 * it must not appear on another drawing, because node ids are not unique across graphs and
 * a mark that followed one would light whichever box happened to share a name.
 */
export function checkEndingMarkLastsAsLongAsItIsTrue(
  observation: MarkLifetimeObservation,
): GateVerdict {
  if (observation.entryStateAfterwards !== 'ready') {
    return {
      failure:
        `after the run the entry step read "${observation.entryStateAfterwards}" rather ` +
        'than ready, so the two things that are supposed to be visible at once \u2014 a ' +
        'finished run and a loop standing by \u2014 were not both there to check.',
    };
  }
  if (!observation.endingStillShown) {
    return {
      failure:
        `the mark on "${observation.terminalNodeId}" was gone by the time the loop was ` +
        'standing by again. The Ready pulse replacing it is exactly the thing this card ' +
        'was written to fix.',
    };
  }
  if (observation.endingShownInTheNextRun) {
    return {
      failure:
        `the previous run's ending mark was still on "${observation.terminalNodeId}" after ` +
        'a new run had started, where it says something that is no longer true.',
    };
  }
  if (observation.endingShownOnAnotherDrawing) {
    return {
      failure:
        'an ending mark was drawn on a different loop\u2019s graph. Node ids are not unique ' +
        'between drawings, so a mark bound to an id rather than to the run and its graph ' +
        'lights whichever box happens to share a name.',
    };
  }
  return { failure: null };
}
