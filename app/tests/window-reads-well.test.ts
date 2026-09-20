import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkConversationScrollsWell,
  checkErrorReadsWell,
  checkRepliesRenderMarkdown,
  checkUserMessageLooksLikeTheReference,
  checkWindowFollowsItsWidth,
  checkWindowGivesTheConversationTheSpace,
  type MarkdownObservation,
  type PlainErrorObservation,
  type ScrollObservation,
  type WindowShapeObservation,
} from '../src/renderer/workflow-gates';

/**
 * The presentation gates, given the defects they exist to catch.
 *
 * A gate that cannot fail is not evidence, and these three are new, so each one is
 * fed the window Niclas actually complained about: a page that scrolls under the
 * conversation, a reply showing its own `###`, and a card taking the space. The
 * passing case is here too, because a gate that fails on everything is the same
 * problem wearing the other face.
 */

const goodScroll: ScrollObservation = {
  verticalScrollersInWindow: ['transcript'],
  pageScrollRangePx: 0,
  pageScrollTopAfterFirstSend: 0,
  transcriptDistanceFromBottomAfterFirstSend: 0,
  transcriptDistanceFromBottomAfterLaterSend: 1,
  readingPositionChosen: 0,
  readingPositionAfterContentArrived: 0,
  contentGrewWhileReading: true,
  offeredTheWayBack: true,
  distanceFromBottomAfterReturning: 0,
};

const goodMarkdown: MarkdownObservation = {
  elementsInReply: ['H2', 'P', 'STRONG', 'EM', 'OL', 'UL', 'LI', 'CODE', 'PRE', 'A'],
  visibleText:
    'What I did for mark-alpha Two things changed, and one of them is load bearing: ' +
    'scroll-follow.ts decides when the conversation moves. ' +
    '### not a heading, **not bold** rg --glob "*.ts" -n "a && b" | head -5 ' +
    '<script>alert("not a script")</script>',
  literalsRequired: [
    '### not a heading, **not bold**',
    'rg --glob "*.ts" -n "a && b" | head -5',
    '<script>alert("not a script")</script>',
  ],
  scriptOrIframeElements: 0,
  inlineEventHandlerAttributes: 0,
  linkHrefs: ['https://example.test/interaction-model'],
  visibleTextWhileStreaming: 'What I did for mark-bravo Two things changed',
  elementsWhileStreaming: ['H2', 'P', 'STRONG', 'OL'],
  elementsAfterReopening: ['H2', 'P', 'STRONG', 'EM', 'OL', 'UL', 'CODE', 'PRE', 'A'],
};

const goodShape: WindowShapeObservation = {
  userMessageBackground: 'rgb(45, 49, 56)',
  agentReplyBackground: 'rgba(0, 0, 0, 0)',
  conversationBackground: 'rgb(24, 28, 34)',
  userMessageBorderWidthPx: 1,
  chromeHeightPx: 44,
  conversationHeightPx: 620,
  sessionDetailsExist: true,
  sessionDetailsOpenAtRest: false,
  sessionDetailsOpenedWhenAsked: true,
  detailsFactsFound: { 'Project folder': true, Account: true },
  projectNameShown: 'duration-repo',
  modelControlBesideComposer: true,
  modelControlSaysWhatItAffects: 'for your next message here.',
  connectionProblemShownInContext: null,
  longMessage: {
    charactersTyped: 2400,
    charactersInDocumentWhileCollapsed: 2400,
    collapsedHeightPx: 103,
    expandedHeightPx: 640,
    readingPositionDriftPx: 0,
    collapsedLines: 3.5,
    fadeAtTheFoot: true,
    buttonsWithTheMessage: 0,
    openedByClickingInside: true,
    foldedByClickingOutside: true,
    heldOpenThroughADragSelection: true,
    charactersSelectedByDragging: 80,
    openedByKeyboard: true,
    shortMessageIsInteractive: false,
  },
  widths: [
    {
      contentWidthPx: 760,
      userMessageWidthPx: 700,
      agentReplyWidthPx: 680,
      composerWidthPx: 700,
      pageOverflowPx: 0,
      conversationOverflowPx: 0,
    },
    {
      contentWidthPx: 1800,
      userMessageWidthPx: 1740,
      agentReplyWidthPx: 1720,
      composerWidthPx: 1740,
      pageOverflowPx: 0,
      conversationOverflowPx: 0,
    },
  ],
  runStatusOutlivedItsPlace: false,
};

test('the gates pass the window they were written for', () => {
  assert.equal(checkConversationScrollsWell(goodScroll).failure, null);
  assert.equal(checkRepliesRenderMarkdown(goodMarkdown).failure, null);
  assert.equal(checkWindowGivesTheConversationTheSpace(goodShape).failure, null);
  assert.equal(checkUserMessageLooksLikeTheReference(goodShape).failure, null);
  assert.equal(checkWindowFollowsItsWidth(goodShape).failure, null);
});

/* --- The message box against the Cursor reference (DSP-65 #1) -------------- */

/** The long message as observed, for the counter-examples below. */
const longMessage = goodShape.longMessage as NonNullable<WindowShapeObservation['longMessage']>;

function withLongMessage(
  change: Partial<NonNullable<WindowShapeObservation['longMessage']>>,
): WindowShapeObservation {
  return { ...goodShape, longMessage: { ...longMessage, ...change } };
}

/**
 * The window Niclas was looking at, as this gate must refuse it.
 *
 * Every one of these is a real state of the delivered build rather than an invented
 * one: the box was the same dark as the surface, the clip was hard, and *Copy* and
 * *Show the whole message* were two labelled buttons under it.
 */
test('a box that is only a stronger border is refused', () => {
  assert.match(
    checkUserMessageLooksLikeTheReference({
      ...goodShape,
      userMessageBackground: 'rgb(24, 28, 34)',
      conversationBackground: 'rgb(24, 28, 34)',
    }).failure ?? '',
    /same dark box with a stronger edge/,
  );
  // Two pixels of difference is not "clearly lighter" either.
  assert.match(
    checkUserMessageLooksLikeTheReference({
      ...goodShape,
      userMessageBackground: 'rgb(26, 30, 36)',
    }).failure ?? '',
    /lighter than the conversation/,
  );
});

test('a comparison that parses to nothing refuses rather than passes', () => {
  assert.match(
    checkUserMessageLooksLikeTheReference({ ...goodShape, conversationBackground: '' }).failure ??
      '',
    /could not be compared/,
  );
});

/**
 * The form Chromium actually answers for the mixed surface.
 *
 * `color-mix()` reads back as `color(srgb …)`, and the first run of this gate against
 * the real window refused a correct box over exactly that — the refusal working as
 * intended, and the reason this case is pinned here.
 */
test('the surface is compared in the form the window reports it', () => {
  assert.equal(
    checkUserMessageLooksLikeTheReference({
      ...goodShape,
      userMessageBackground: 'color(srgb 0.174902 0.190196 0.213333)',
      conversationBackground: 'rgb(24, 28, 34)',
    }).failure,
    null,
  );
});

test('buttons with the message, a hard clip and eight visible lines are refused', () => {
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ buttonsWithTheMessage: 2 })).failure ??
      '',
    /labelled button/,
  );
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ fadeAtTheFoot: false })).failure ?? '',
    /hard edge with no fade/,
  );
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ collapsedLines: 8 })).failure ?? '',
    /shows three or four/,
  );
});

test('a box that cannot be clicked, or folds when text is selected, is refused', () => {
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ openedByClickingInside: false }))
      .failure ?? '',
    /clicking inside a folded message did not open it/,
  );
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ foldedByClickingOutside: false }))
      .failure ?? '',
    /did not fold it again/,
  );
  // The detail that decides whether this feels right or infuriating.
  assert.match(
    checkUserMessageLooksLikeTheReference(
      withLongMessage({ heldOpenThroughADragSelection: false }),
    ).failure ?? '',
    /A pointer that moved is not a click/,
  );
  // And a drag that selected nothing proves nothing about it.
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ charactersSelectedByDragging: 0 }))
      .failure ?? '',
    /instrument failing/,
  );
});

test('quiet affordances that are mouse-only are refused', () => {
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ openedByKeyboard: false })).failure ??
      '',
    /from the keyboard/,
  );
  assert.match(
    checkUserMessageLooksLikeTheReference(withLongMessage({ shortMessageIsInteractive: true }))
      .failure ?? '',
    /a short message is interactive/,
  );
});

/* --- The window's own width (DSP-65 #2) ------------------------------------ */

test('a column that stops growing with the window is refused', () => {
  // `max-width: 62rem`, measured: the window gains a thousand pixels and the
  // conversation gains none of them.
  const capped = (goodShape.widths as NonNullable<WindowShapeObservation['widths']>).map(
    (at, index) =>
      index === 0 ? at : { ...at, userMessageWidthPx: 992, agentReplyWidthPx: 972, composerWidthPx: 992 },
  );
  assert.match(
    checkWindowFollowsItsWidth({ ...goodShape, widths: capped }).failure ?? '',
    /does not follow the window/,
  );
});

test('a horizontal scrollbar at either width is refused', () => {
  const widths = goodShape.widths as NonNullable<WindowShapeObservation['widths']>;
  assert.match(
    checkWindowFollowsItsWidth({
      ...goodShape,
      widths: [{ ...(widths[0] as (typeof widths)[number]), pageOverflowPx: 120 }, widths[1] as (typeof widths)[number]],
    }).failure ?? '',
    /the page overflows its own width/,
  );
  assert.match(
    checkWindowFollowsItsWidth({
      ...goodShape,
      widths: [
        { ...(widths[0] as (typeof widths)[number]), conversationOverflowPx: 40 },
        widths[1] as (typeof widths)[number],
      ],
    }).failure ?? '',
    /Only a code block may scroll sideways/,
  );
});

test('a user box narrower than the reply is refused, which is the way round it was', () => {
  const widths = goodShape.widths as NonNullable<WindowShapeObservation['widths']>;
  assert.match(
    checkWindowFollowsItsWidth({
      ...goodShape,
      widths: widths.map((at) => ({ ...at, userMessageWidthPx: at.agentReplyWidthPx - 60 })),
    }).failure ?? '',
    /the wider element/,
  );
});

test('one width, or two the same, reports the instrument rather than the window', () => {
  const widths = goodShape.widths as NonNullable<WindowShapeObservation['widths']>;
  assert.match(
    checkWindowFollowsItsWidth({ ...goodShape, widths: [widths[0] as (typeof widths)[number]] })
      .failure ?? '',
    /fewer than two widths/,
  );
  assert.match(
    checkWindowFollowsItsWidth({
      ...goodShape,
      widths: [widths[0] as (typeof widths)[number], widths[0] as (typeof widths)[number]],
    }).failure ?? '',
    /not enough to show/,
  );
  assert.match(
    checkWindowFollowsItsWidth({ ...goodShape, widths: null }).failure ?? '',
    /fewer than two widths/,
  );
});

/* --- The scroll gate, given each defect it is about ----------------------- */

test('a page that can scroll under the conversation is refused', () => {
  const verdict = checkConversationScrollsWell({ ...goodScroll, pageScrollRangePx: 900 });
  assert.match(verdict.failure ?? '', /page itself can scroll/);
});

test('two scroll areas over the conversation are refused', () => {
  const verdict = checkConversationScrollsWell({
    ...goodScroll,
    verticalScrollersInWindow: ['transcript', 'html.app'],
  });
  assert.match(verdict.failure ?? '', /vertical scroll areas/);
});

test('a jump on the first message of a session is refused', () => {
  const verdict = checkConversationScrollsWell({
    ...goodScroll,
    pageScrollTopAfterFirstSend: 240,
  });
  assert.match(verdict.failure ?? '', /first message of the session/);
});

test('being dragged down while reading something earlier is refused', () => {
  const verdict = checkConversationScrollsWell({
    ...goodScroll,
    readingPositionChosen: 0,
    readingPositionAfterContentArrived: 1_200,
  });
  assert.match(verdict.failure ?? '', /moved the reader by 1200 px/);
});

test('a trial where nothing arrived while reading reports itself, not the window', () => {
  const verdict = checkConversationScrollsWell({
    ...goodScroll,
    contentGrewWhileReading: false,
  });
  assert.match(verdict.failure ?? '', /instrument failing/);
});

test('no way back to the latest is refused', () => {
  assert.match(
    checkConversationScrollsWell({ ...goodScroll, offeredTheWayBack: false }).failure ?? '',
    /no way to return/,
  );
});

/* --- The Markdown gate ----------------------------------------------------- */

test('a reply still showing its own markers is refused', () => {
  const verdict = checkRepliesRenderMarkdown({
    ...goodMarkdown,
    visibleText: `${goodMarkdown.visibleText}\n### Where the run stands`,
  });
  assert.match(verdict.failure ?? '', /literal Markdown markers/);
});

test('code whose characters were eaten by the renderer is refused', () => {
  const verdict = checkRepliesRenderMarkdown({
    ...goodMarkdown,
    visibleText: goodMarkdown.visibleText.replace('### not a heading, **not bold**', 'not a heading, not bold'),
  });
  assert.match(verdict.failure ?? '', /did not survive rendering unchanged/);
});

test('an executable element produced by a reply is refused', () => {
  assert.match(
    checkRepliesRenderMarkdown({ ...goodMarkdown, scriptOrIframeElements: 1 }).failure ?? '',
    /executable element/,
  );
  assert.match(
    checkRepliesRenderMarkdown({ ...goodMarkdown, inlineEventHandlerAttributes: 1 }).failure ?? '',
    /event-handler attribute/,
  );
  assert.match(
    checkRepliesRenderMarkdown({
      ...goodMarkdown,
      linkHrefs: ['javascript:alert(1)'],
    }).failure ?? '',
    /not an http or mailto target/,
  );
});

test('plain text during streaming or after reopening is refused', () => {
  assert.match(
    checkRepliesRenderMarkdown({ ...goodMarkdown, elementsWhileStreaming: [] }).failure ?? '',
    /while it was still streaming/,
  );
  assert.match(
    checkRepliesRenderMarkdown({ ...goodMarkdown, elementsAfterReopening: ['P'] }).failure ?? '',
    /after the saved conversation was reopened/,
  );
});

/* --- The window-shape gate ------------------------------------------------- */

test('a user message drawn like the reply is refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      userMessageBackground: goodShape.agentReplyBackground,
    }).failure ?? '',
    /same background/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace({ ...goodShape, userMessageBorderWidthPx: 0 })
      .failure ?? '',
    /no border/,
  );
});

test('chrome taking a quarter of the window is refused', () => {
  const verdict = checkWindowGivesTheConversationTheSpace({
    ...goodShape,
    chromeHeightPx: 260,
    conversationHeightPx: 400,
  });
  assert.match(verdict.failure ?? '', /permanent chrome above the conversation takes 39%/);
});

test('details that are gone, or open without being asked for, are refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace({ ...goodShape, sessionDetailsExist: false })
      .failure ?? '',
    /moved, not\s+deleted/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace({ ...goodShape, sessionDetailsOpenAtRest: true })
      .failure ?? '',
    /the card again under another name/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      detailsFactsFound: { 'Project folder': true, Account: false },
    }).failure ?? '',
    /"Account" is no longer readable/,
  );
});

test('losing project identity is refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace({ ...goodShape, projectNameShown: '  ' }).failure ??
      '',
    /which project is open/,
  );
});

/**
 * The two things Niclas asked to be able to see, as the gate must refuse them.
 *
 * A preview made by cutting the string is the tempting implementation and the one
 * that cannot be copied whole, so it gets a counter-example of its own; so does a
 * finished run whose status is still drawn under newer messages, which is the
 * defect this pass was sent to fix.
 */
test('a long message that was shortened rather than clipped is refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace(
      withLongMessage({ charactersInDocumentWhileCollapsed: 300 }),
    ).failure ?? '',
    /shortened rather than\s+clipped/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace(withLongMessage({ collapsedHeightPx: 640 })).failure ??
      '',
    /same height collapsed as expanded/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace(withLongMessage({ readingPositionDriftPx: 180 }))
      .failure ?? '',
    /under the reader/,
  );
});

test('a finished run\u2019s status drawn under newer messages is refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      runStatusOutlivedItsPlace: true,
    }).failure ?? '',
    /outlived\s+its place/,
  );
  // Not measured is not a pass, and not a failure either: the trial had no
  // finished run to look at, and the gate says nothing about what it did not see.
  assert.equal(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      runStatusOutlivedItsPlace: null,
    }).failure,
    null,
  );
});

test('a model control that is elsewhere, or silent about its effect, is refused', () => {
  assert.match(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      modelControlBesideComposer: false,
    }).failure ?? '',
    /beside the composer/,
  );
  assert.match(
    checkWindowGivesTheConversationTheSpace({
      ...goodShape,
      modelControlSaysWhatItAffects: '',
    }).failure ?? '',
    /which work a selection affects/,
  );
});

/* --- DSP-64: the error-presentation gate, given the errors it must refuse --- */

/** The refusal as the window now shows it: one sentence, detail on request. */
const goodError: PlainErrorObservation = {
  headlineShown:
    'Refusing to delete C:\\work\\not-ours: it is not empty and has no ' +
    ".dspatch-experiment file, so it was not generated here and may be someone's work.",
  nextStepShown:
    'Nothing in that folder was touched. Open the project you want, or use an empty folder.',
  detailOpenAtRest: false,
  detailOpenedWhenAsked: true,
  detailText:
    "What DSpatch reported, in full: Refusing to delete C:\\work\\not-ours: it is not " +
    "empty and has no .dspatch-experiment file, so it was not generated here and may " +
    "be someone's work. Reported over dspatch:start-session.",
  refusalWordsRequired: [
    'Refusing to delete',
    '.dspatch-experiment',
    "may be someone's work",
  ],
  actionOffered: 'Choose another folder',
};

test('the error a person can act on passes', () => {
  assert.equal(checkErrorReadsWell(goodError).failure, null);
});

test('the error Niclas met — correct, and silent about what to do — is refused', () => {
  assert.match(
    checkErrorReadsWell({ ...goodError, nextStepShown: '' }).failure ?? '',
    /nothing about what can be done/,
  );
});

test('diagnostics shown without being asked for are refused', () => {
  assert.match(
    checkErrorReadsWell({ ...goodError, detailOpenAtRest: true }).failure ?? '',
    /without being asked for/,
  );
});

test('detail that cannot be opened at all is refused', () => {
  assert.match(
    checkErrorReadsWell({ ...goodError, detailOpenedWhenAsked: false }).failure ?? '',
    /Behind a disclosure and\s+unavailable are different things/,
  );
});

test('a refusal made vaguer in being made shorter is refused', () => {
  // The failure this gate exists for. A tidy headline, a helpful next step, and the
  // marker the refusal was actually about is nowhere in the window.
  const vaguer: PlainErrorObservation = {
    ...goodError,
    headlineShown: 'That folder could not be used.',
    detailText: 'What DSpatch reported, in full: That folder could not be used.',
  };
  // It names the first thing missing — the refusal's own subject — and says why.
  assert.match(checkErrorReadsWell(vaguer).failure ?? '', /lost "Refusing to delete"/);
  assert.match(checkErrorReadsWell(vaguer).failure ?? '', /may not become/);
  // And the marker being gone is caught on its own too, so a headline that keeps the
  // first words while dropping what was looked for does not slip through.
  assert.match(
    checkErrorReadsWell({
      ...goodError,
      headlineShown: 'Refusing to delete C:\\work\\not-ours.',
      detailText: 'What DSpatch reported, in full: Refusing to delete C:\\work\\not-ours.',
    }).failure ?? '',
    /lost "\.dspatch-experiment"/,
  );
});

test('an error with nothing on screen, or no action beside it, is refused', () => {
  assert.match(
    checkErrorReadsWell({ ...goodError, headlineShown: '   ' }).failure ?? '',
    /no sentence at all/,
  );
  assert.match(
    checkErrorReadsWell({ ...goodError, actionOffered: '' }).failure ?? '',
    /leads nowhere/,
  );
});

