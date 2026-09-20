/**
 * When the conversation moves itself, and when it must not.
 *
 * DSP-58's fault was not that the window scrolled too little; it was that it
 * scrolled unconditionally. `scrollIntoView` was called on every render that
 * changed the turns, the streaming answer or the loop turns, with no notion of
 * whether the person was reading something further up — and `scrollIntoView`
 * scrolls **every** ancestor that can scroll, so a nested transcript inside a
 * scrolling page moved both, and the page moved to wherever put the transcript's
 * last element at the bottom of the viewport. On the first message of a session,
 * with only one short turn in a transcript near the top of a long page, that
 * position is the top of the document. That is the jump.
 *
 * The rules are here rather than in `App.tsx` because they are about intent —
 * following, or reading — and intent is what a test can state. Nothing in this
 * file touches the DOM: the caller reads three numbers off one element and applies
 * one decision to that same element, never to an ancestor.
 */

/** What the caller measured on the transcript element. */
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * How close to the bottom still counts as following.
 *
 * Generous on purpose: a person who has nudged the wheel by a line is still
 * following, and a streaming reply that grows by a line between two frames must
 * not be read as them having scrolled away. Smaller than the height of one short
 * message, so a deliberate scroll back to read is never mistaken for following.
 */
export const FOLLOW_THRESHOLD_PX = 64;

export function distanceFromBottom(metrics: ScrollMetrics): number {
  return Math.max(metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight, 0);
}

/**
 * Is the conversation following the latest message?
 *
 * A transcript with nothing to scroll is following by definition: there is no
 * earlier position for the reader to have chosen.
 */
export function isFollowingLatest(
  metrics: ScrollMetrics,
  threshold: number = FOLLOW_THRESHOLD_PX,
): boolean {
  if (metrics.scrollHeight <= metrics.clientHeight) {
    return true;
  }
  return distanceFromBottom(metrics) <= threshold;
}

/**
 * Is the reader still following, given a scroll event that has just arrived?
 *
 * A `scroll` event does not say who scrolled. The window's own move produces one
 * as well, and it is delivered on a later frame — by which time the conversation's
 * viewport may be a different height, because the composer grows while a send is
 * in flight and takes the space from the thread. Measuring the distance to the
 * bottom at that moment reads the space the layout took as though the person had
 * scrolled up out of it, and that reading is wrong in the worst possible way: it
 * decides the rest of the reply must be held back from someone who never moved.
 *
 * `appliedScrollTop` is where the window last put the scroller, or `null` if the
 * last movement was not the window's. `scrollToLatest` is the only thing that sets
 * it and it always goes to the foot, so a scroller still standing exactly there is
 * one nobody has touched — whatever the distance to the bottom now says. One pixel
 * of tolerance because the position is a fractional device-pixel value.
 *
 * Anything else is the person's, and measured.
 */
export function followAfterScrollEvent(input: {
  readonly metrics: ScrollMetrics;
  readonly appliedScrollTop: number | null;
  readonly threshold?: number;
}): boolean {
  if (
    input.appliedScrollTop !== null &&
    Math.abs(input.metrics.scrollTop - input.appliedScrollTop) <= 1
  ) {
    return true;
  }
  return isFollowingLatest(input.metrics, input.threshold);
}

/** Why the conversation changed. */
export type ScrollReason =
  /** The person sent something. Their own message is what they want to see. */
  | 'sent'
  /** New or streaming content arrived, or a status line or handover changed. */
  | 'content'
  /** The conversation was replaced wholesale: a project opened, history reopened. */
  | 'conversation-replaced';

export type ScrollDecision = 'scroll-to-latest' | 'hold-position';

/**
 * Whether to move the conversation to the latest message.
 *
 * Three states and one rule: the person's own send and a new conversation go to
 * the latest, and everything else only does so if they were already there.
 * *Everything else* deliberately includes status updates and handovers, which §9.1
 * names, because those arrive as ordinary content changes and were the most
 * frequent cause of the position being taken away mid-sentence.
 */
export function decideScroll(input: {
  readonly reason: ScrollReason;
  readonly followingLatest: boolean;
}): ScrollDecision {
  if (input.reason === 'sent' || input.reason === 'conversation-replaced') {
    return 'scroll-to-latest';
  }
  return input.followingLatest ? 'scroll-to-latest' : 'hold-position';
}

/**
 * Where the conversation should sit after something in it changed height.
 *
 * Expanding or collapsing a long message is the same problem as a reply arriving,
 * so it is answered here rather than beside the button: the content above the
 * reader's eyes changes height, and unless the scroller is moved by the same
 * amount the text they were reading slides away under them.
 *
 * `anchorTop` is the toggled message's own offset from the top of the scroller,
 * measured before and after. Someone following the latest message is taken to the
 * foot instead, which is the rule {@link decideScroll} already keeps for arriving
 * content: their place *is* the bottom.
 */
export function scrollTopAfterResize(input: {
  readonly scrollTop: number;
  readonly anchorTopBefore: number;
  readonly anchorTopAfter: number;
}): number {
  return Math.max(input.scrollTop + (input.anchorTopAfter - input.anchorTopBefore), 0);
}

/**
 * Whether to offer the way back to the latest message.
 *
 * Only when there is something below to go back to *and* the person is not already
 * following it. An always-visible button over a conversation that is already at the
 * bottom is the kind of permanent chrome §9 is trying to remove.
 */
export function shouldOfferReturnToLatest(metrics: ScrollMetrics): boolean {
  return !isFollowingLatest(metrics);
}
