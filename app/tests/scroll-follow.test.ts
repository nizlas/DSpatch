import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FOLLOW_THRESHOLD_PX,
  decideScroll,
  distanceFromBottom,
  followAfterScrollEvent,
  isFollowingLatest,
  scrollTopAfterResize,
  shouldOfferReturnToLatest,
} from '../src/renderer/scroll-follow';

/**
 * DSP-58's rule, given the counter-examples it exists to refuse.
 *
 * The one that matters is the third: content arriving while the reader is further
 * up must not move them. That was the defect, and it is the case the previous
 * implementation had no way to express, because it called `scrollIntoView` before
 * asking anything.
 */

const bottom = { scrollTop: 900, scrollHeight: 1400, clientHeight: 500 };
const readingEarlier = { scrollTop: 100, scrollHeight: 1400, clientHeight: 500 };
const nothingToScroll = { scrollTop: 0, scrollHeight: 300, clientHeight: 500 };

test('a transcript at its bottom is following', () => {
  assert.equal(distanceFromBottom(bottom), 0);
  assert.equal(isFollowingLatest(bottom), true);
});

test('a transcript with nothing to scroll is following', () => {
  assert.equal(isFollowingLatest(nothingToScroll), true);
  assert.equal(shouldOfferReturnToLatest(nothingToScroll), false);
});

test('a nudge of a line or two is still following; a scroll back to read is not', () => {
  const nudged = { ...bottom, scrollTop: bottom.scrollTop - FOLLOW_THRESHOLD_PX + 1 };
  assert.equal(isFollowingLatest(nudged), true);
  const scrolledAway = { ...bottom, scrollTop: bottom.scrollTop - FOLLOW_THRESHOLD_PX - 1 };
  assert.equal(isFollowingLatest(scrolledAway), false);
  assert.equal(isFollowingLatest(readingEarlier), false);
  assert.equal(shouldOfferReturnToLatest(readingEarlier), true);
});

test('content arriving while the reader is further up does not move them', () => {
  assert.equal(
    decideScroll({ reason: 'content', followingLatest: false }),
    'hold-position',
  );
});

test('content arriving while following keeps the latest in view', () => {
  assert.equal(
    decideScroll({ reason: 'content', followingLatest: true }),
    'scroll-to-latest',
  );
});

test('the person’s own send always goes to their message, wherever they were', () => {
  assert.equal(decideScroll({ reason: 'sent', followingLatest: false }), 'scroll-to-latest');
  assert.equal(decideScroll({ reason: 'sent', followingLatest: true }), 'scroll-to-latest');
});

test('a conversation that was replaced starts at its latest message', () => {
  assert.equal(
    decideScroll({ reason: 'conversation-replaced', followingLatest: false }),
    'scroll-to-latest',
  );
});

/**
 * DSP-66: the window reading its own scroll as the person leaving.
 *
 * The measured case. The window put the scroller at the foot of a 3 841 px thread
 * with a 572 px viewport, and the scroll event that produced arrived a frame later,
 * after the composer had grown an acknowledgement and a Cancel and taken 171 px from
 * the thread. The distance then read 170.67 px, which is past the threshold, so the
 * window concluded the person had scrolled away and held the rest of their reply
 * back from them. The scroller had not moved a pixel.
 */
test('the window’s own move is not the person walking away, however the viewport changed', () => {
  const applied = 3269.333251953125;
  const afterTheComposerGrew = {
    scrollTop: applied,
    scrollHeight: 3841,
    clientHeight: 401,
  };
  assert.equal(isFollowingLatest(afterTheComposerGrew), false);
  assert.equal(
    followAfterScrollEvent({ metrics: afterTheComposerGrew, appliedScrollTop: applied }),
    true,
  );
});

test('a scroll back to read earlier is the person’s, and is measured', () => {
  assert.equal(
    followAfterScrollEvent({ metrics: readingEarlier, appliedScrollTop: bottom.scrollTop }),
    false,
  );
});

test('a scroll nobody remembers making is measured', () => {
  assert.equal(followAfterScrollEvent({ metrics: readingEarlier, appliedScrollTop: null }), false);
  assert.equal(followAfterScrollEvent({ metrics: bottom, appliedScrollTop: null }), true);
});

test('a fractional device pixel is not a scroll', () => {
  assert.equal(
    followAfterScrollEvent({
      metrics: { scrollTop: 900.6666, scrollHeight: 2400, clientHeight: 500 },
      appliedScrollTop: 900,
    }),
    true,
  );
});

/**
 * Expanding and collapsing a long message, which changes the height of content
 * the reader may be below. Same rule as arriving content and answered here for
 * the same reason: the message has to stay where it was on screen.
 */
test('a message that grows above the reader moves the scroller by the same amount', () => {
  // The message was 200 px down the scroller and is now 40 px further down,
  // because expanding the one above it made it taller.
  assert.equal(
    scrollTopAfterResize({ scrollTop: 600, anchorTopBefore: 200, anchorTopAfter: 240 }),
    640,
  );
});

test('a message that shrinks above the reader moves the scroller back', () => {
  assert.equal(
    scrollTopAfterResize({ scrollTop: 640, anchorTopBefore: 240, anchorTopAfter: 200 }),
    600,
  );
});

test('the scroller is never asked to go above its own top', () => {
  assert.equal(
    scrollTopAfterResize({ scrollTop: 10, anchorTopBefore: 100, anchorTopAfter: 0 }),
    0,
  );
});
