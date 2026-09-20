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
  /** The note beside the composer at the moment the message was sent. */
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
  if (!observation.routeNoteShownInWindow.includes('rather than starting a second run')) {
    return {
      failure:
        'the window did not say, beside the composer, that the message joins the run ' +
        'already working rather than starting a second one. What DSpatch will do with ' +
        'the text is exactly what a person needs before pressing Enter: it said ' +
        `\u201C${observation.routeNoteShownInWindow}\u201D`,
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
  if (!observation.pendingSentenceShownInWindow.includes('no agent has been given it yet')) {
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

export interface StandingSentences {
  readonly whoIsWorking: string;
  readonly onWhat: string;
  readonly waitingFor: string;
  readonly whatHappensNext: string;
}

export interface InterruptedRunObservation {
  /** The distinct standings the script saw, in the order they first appeared. */
  readonly standingsSeen: readonly string[];
  /** The four sentences while the stop was outstanding. */
  readonly whileStopping: StandingSentences;
  /** The four sentences once the run reported an end. */
  readonly afterTheEnd: StandingSentences;
  readonly badgeShownInWindow: string;
  readonly accountShownInWindow: string;
  /** The interrupted run's own mandate, read after the interruption. */
  readonly mandateShownInWindow: string;
  readonly mandateAsSent: string;
  /** The earlier, completed run, read after the interruption. */
  readonly earlierMandateShownInWindow: string;
  readonly earlierMandateAsSent: string;
  readonly earlierRepliesStillShown: number;
}

function emptySentence(sentences: StandingSentences): string | null {
  const named: readonly (readonly [string, string])[] = [
    ['who is working', sentences.whoIsWorking],
    ['on what', sentences.onWhat],
    ['what it is waiting for', sentences.waitingFor],
    ['what happens next', sentences.whatHappensNext],
  ];
  return named.find(([, value]) => value.trim() === '')?.[0] ?? null;
}

/**
 * §10 trial 11: an interrupted call, with the assignment and the history intact.
 *
 * What it refuses to accept, in order: a window that cannot show the three states
 * §9 asks a reader to tell apart; a stop that reads as a stop before the run has
 * said it stopped; a missing answer to any of §9's four questions; a lost
 * assignment or lost history; and any claim of success over a run that was cut
 * short.
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
  for (const [when, sentences] of [
    ['while the stop was outstanding', observation.whileStopping],
    ['after the run reported an end', observation.afterTheEnd],
  ] as const) {
    const blank = emptySentence(sentences);
    if (blank !== null) {
      return {
        failure:
          `${when} the window left \u201C${blank}\u201D unanswered. §9 asks the ` +
          'conversation to answer all four at a glance.',
      };
    }
  }
  if (!observation.whileStopping.whoIsWorking.includes('asking is not stopping')) {
    return {
      failure:
        'while the stop was outstanding the window did not say that asking is not ' +
        'stopping, so a requested stop and an observed stop read alike: ' +
        `\u201C${observation.whileStopping.whoIsWorking}\u201D`,
    };
  }
  if (!observation.afterTheEnd.whatHappensNext.includes('Nothing will be repeated')) {
    return {
      failure:
        'after the interruption the window did not say that nothing will be repeated on ' +
        'its own. §4.5 and §10 trial 12 both turn on a run never silently redoing work ' +
        `whose outcome is unknown: \u201C${observation.afterTheEnd.whatHappensNext}\u201D`,
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
  if (observation.accountShownInWindow.trim() === '') {
    return {
      failure:
        'the interrupted run was left in the thread with nothing said about how it ' +
        'ended, which is worse than the silence it replaces.',
    };
  }
  return { failure: null };
}
