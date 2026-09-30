---
id: DSP-66
title: The scrolling gate reads 326 px about once in three runs
status: Review
assignee: []
created_date: '2026-09-19 18:56'
updated_date: '2026-09-19 22:06'
labels: []
dependencies:
  - DSP-58
priority: high
type: bug
ordinal: 15623
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen twice now, in two different calls, against code that measures 0.333 px the rest of the time. Implementer 001 of the GUI run reported one unexplained 326 px reading and could not explain it; implementer 002 of the upkeep run then saw the presentation scenario fail the same assertion once in three runs while the process ended cleanly and carried the run's own code. Three other observations, including one against the packaged build, read 0.333251953125 px exactly. So the product is very likely fine and the instrument is load-sensitive: both outliers happened while other work was contending for the machine. It matters anyway, because an intermittent gate teaches a future run to re-run until green, which is the habit that makes every other gate worthless. Either make the reading stable - sample after a settle the scenario can observe rather than after a delay it guesses - or have the gate say it could not measure reliably rather than reporting a distance it does not trust.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The scrolling measurement is either stable across runs under load, or reports that it could not measure rather than failing on a distance it cannot trust.
<!-- AC:END -->


## One deterministic mechanism, exposed by a frame race — and a correction to the section below

<!-- SECTION:NOTES:BEGIN -->
**Rewritten 19 September, 23:40, after removing the Send button made the real shape visible.** This card was opened as a flaky measurement — about one reading in three. That framing was wrong, and the reason it looked intermittent is now understood.

**Measured on the path a person actually uses.** After sending with **Enter**, the conversation sits **283 px** from the latest message in a clean window, and **311 px** in the presentation scenario. *Reported at the time as four runs out of four — see the correction at the end of this section.* The earlier pass passed this gate three times in five because its script **clicked the Send button**, and the button path and the keystroke path do not behave the same.

So there was never a flake **in the sense of an unexplained reading**. There is one mechanism, and a frame race decides whether it fires.

**Not the badge removal**, checked directly: restoring the badge gives 345 px, which is essentially the 349 px recorded when the earlier pass failed. The distance moves with the content height, as a follow that measures too early would.

**Why this is now urgent rather than cosmetic.** Niclas's decision of the same evening removed the Send button, so **Enter is the only way to send**. Every message he sends now leaves the conversation roughly three hundred pixels short of his own message and the reply to it — which is the "the window does not follow" complaint that INTERACTION_MODEL §9.1 exists to answer, arriving through the one door still open.

A red presentation run now means this, deterministically, rather than a flake.
<!-- SECTION:NOTES:END -->


## Correction, and the cause

<!-- SECTION:NOTES:BEGIN -->
**My "four runs out of four" was too strong, and the implementer said so rather than letting it stand.** On the same code it then measured **2 failures in 4 runs, then 2 in 6**, with an identical signature each time and clean readings in between. The honest statement is one deterministic mechanism that a frame race exposes on roughly half of sends — and the Send button was rolling the same dice with better odds, not taking a different road. The button's odds are inferred; the mechanism is measured.

**The cause: the window read its own programmatic scroll as the person walking away.**

At the moment of a send the composer grows from 123 px to 262 px — 132 px of it the *this send needs acknowledgement* block, 7 px the control row wrapping — and the thread pays for all of it, so its viewport drops from 572 px to 401 px. The scroll event that `scrollToLatest` produces is delivered a frame later, **after** that shrink, so `noteTranscriptScrolled` measured a 171 px gap and latched `followingLatest = false`. Every delta of the reply was then correctly held back from someone who had not moved a pixel.

That is why the distance tracked content height, and why restoring the badge moved it to 345 px. `decideScroll` was never the faulty half: **a scroll event does not say who scrolled**, and the window was treating all of them as the person's.

**Fixed** by `followAfterScrollEvent` — a scroller still exactly where the window put it has not been touched — plus a `ResizeObserver` for the case where the viewport shrinks and no content follows, which against a provider that thinks for four seconds would be four seconds of your own message out of view. No timer, no nudging loop, threshold untouched.

**Now:** 0 px in a clean window, 0.67 px in the scenario, green ten runs out of ten, byte-identical every time where before it was 0.333 px or 311 px depending on the race.
<!-- SECTION:NOTES:END -->
