---
id: DSP-80
title: 'Strengthen the pulse, and a glint along the working node''s edge'
status: Done
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-22 00:36'
labels: []
dependencies:
  - DSP-86
priority: high
type: feature
ordinal: 15712
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's bounded visual mandate of 21 September, after trying the build that abolished the separate run view. Its first criterion, the entry node returning to Ready after a run, was delivered by DSP-86 and is ticked here as such. What remains is the look. PART ONE, strengthen the existing pulse: clearer without becoming sharp or distracting, keeping the graph's colours, layout and readability. The entry point pulses when Use loop is ticked and the loop is ready; during a run the activity marking follows the active node. PART TWO, a glint: a short bright glint with a softly fading tail running continuously along the node's outline, INCLUDING around the corners, with the existing pulse kept underneath it. The glint means the node is working. Ready has the pulse alone, so readiness and work in progress can be told apart. At a pause, or while waiting for the person, the working animation stops and the node's state must still be evident. CONSTRAINTS: the animation shows the run's state and must not depend on new text arriving from the provider - a node that is thinking in silence is still working. It must survive zooming and panning without moving or resizing the nodes. Respect reduced motion with a still marking. Add no panels, status paragraphs, buttons or settings. Hover information about an agent's activity comes later. Niclas judges the look in the app; an agent's opinion of it is not evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After a run ends with Use loop ticked, the entry node shows Ready again and Ready still cannot be read as work in progress.
- [ ] #2 The glint is optional to comprehension: the state remains understandable with animation off.
- [ ] #3 The pulse is clearer without becoming sharp, and the graph's colours, layout and readability are unchanged.
- [ ] #4 The entry point pulses when Use loop is ticked and the loop is ready, and during a run the marking follows the active node.
- [ ] #5 A glint with a softly fading tail runs continuously along the working node's outline, around the corners too, with the pulse kept.
- [ ] #6 Ready shows the pulse alone, so readiness and work in progress are distinguishable.
- [ ] #7 At a pause or a wait for the person the working animation stops and the node's state is still evident.
- [ ] #8 The animation follows the run's state and does not depend on new provider text arriving.
- [ ] #9 Zooming and panning do not move or resize the nodes, and the animation survives both.
- [ ] #10 Reduced motion gives a still marking.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
The glint is one SVG path per node and one CSS rule for every shape. `nodeOutlinePath` in
`shared/loop-edge-geometry.ts` returns the node's own outline as a closed path, with the
corner radius taken from `nodeCornerRadius` — the same function the body's `<rect rx>` now
uses, so a terminal's pill and a step's box cannot drift apart. Four stacked paths with
staggered negative `animation-delay` make the head bright and the tail fade; the travel is
`stroke-dashoffset`, and `pathLength = GLINT_PATH_LENGTH` (100) normalises three different
perimeters so the dash lengths in the stylesheet are shares of the outline rather than
pixels. Going round the corners is therefore free: a dash following an arc follows it.

Nothing is drawn outside the node's box, which is what makes the glint survive zoom. The
window trial measured `work` at 143 px wide at 85% and 235 px at 140% — 168 graph units at
both, the node's own width — and `loop-liveness.test.ts` asserts every coordinate in every
kind's outline path is inside `NODE_WIDTH` × `NODE_HEIGHT`.

Which node glints is `nodeIsWorking(state, controlPhase)`: `active` **and** a control that
is not `paused` or `waiting-for-you`. `pause-requested` still glints, deliberately — the
step in flight has not ended, and stopping the motion there would say the work had stopped
while it was still running. Nothing follows a provider delta; a step was measured glinting
for 5.7 s with no text reaching the surface at all.

Reduced motion took two goes and the second one is the lesson: a media query adds no
specificity, so `.node-body { animation: none }` inside
`@media (prefers-reduced-motion: reduce)` lost to `.node-run-active .node-body` outside it
and switched nothing off. The trial caught it — the glint dimmed to its still ring while six
animations went on running underneath — and the block now repeats the full selectors. With
the preference set the count is 0 and the working node keeps a continuous ring.

**Second pass, 21 September, after Niclas saw it.** The movement was right and is untouched:
same 2.6-second lap of the same `stroke-dashoffset` on the same path. What changed is the
distribution of light. The four staggered dashes are now one ramp cut into 23 pieces of one
path by `glintSegments()` in `shared/loop-edge-geometry.ts`, which is also where the argument
lives. Three things make the pieces invisible as pieces: they touch end to end with `butt`
caps rather than the `round` ones that would have left a bright bead at every seam; the tail
is cut at equal steps of *brightness* rather than of length, so the short pieces fall where
the ramp is steepest and no seam is a jump larger than a twentieth of the range; and every
piece carries the same animation with **no delay**, its position being in the dash pattern
(`0 gap dash rest`) rather than in its phase, so there is no timing relationship left that
could let one lead or lag. The pieces arrive as presentation *attributes*, which is what lets
the reduced-motion block still replace the whole gradient with a still ring without
`!important`.

The total length 15.04 is the old comet's own extent — four dashes 3.846 units apart plus the
last tail's 3.5 — so the light was redistributed and the object is the same size. The pieces
are rendered only while the node is working; the halo traces the same path unconditionally, so
the group's bounding box is unchanged and the zoom constraint still holds.

The pulse's ring went from 0.08–0.40 to 0.04–0.78, 2.3 times the swing, with the rhythm
untouched — same 2 s, same 3.2 s when ready, same keyframes. The body's 1 → 0.82 is
deliberately unchanged: the words sit in front of the body, so that is the one layer whose
swing could cost them contrast, and the ring is outside the border. Measured, the ring's
stroke stops 4.17 graph units short of the label's ink.

Read on **one forced node rather than a walk** — Niclas's correction, since no state rule
changed. The `how-the-liveness-looks` scenario opens a graph from a path with no project,
session or provider, forces `working` and `ready` through the same announcements real callers
send, freezes the glint at a computed phase with its leading edge on a chosen point, and
differences each frame against a reference frame with the glint half a lap away — necessary
because an active node's border is a bright stroke on the glint's own path. 1.7 seconds of
window time. Measured: nothing lit 1.6 units in front of the leading edge, peak 1.4 units
behind it, a monotone fall to nothing by 15.04, no dip below half its neighbours anywhere, and
the profile across a **−90° corner** within a few percent of the straight side's at every
distance. Reduced motion: 25 animations before, 0 after, one still ring left.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-20 20:40
---
Split by Niclas's cleanup mandate, 20 September: the Ready-pulse restoration after a run moves into DSP-86, which abolishes the separate run view and so owns the unlock-and-reset behaviour. What is left here is the walking glint along the active edge, and the end-node tick, both explicitly deferred.
---

created: 2026-09-21 16:00
---
Paused mid-implementation 21 September 17:57 for a machine shutdown, call 027. Code written, typecheck clean, NOTHING seen in a window - no acceptance may be ticked. Tree candidate-36.json sha256:bf4871b0. Resume by running the loop-graph and loop-definition test groups first, then the window walk. Details in the run journal's paused_for_shutdown block and in report 027, which is headed INTERRUPTED AND INCOMPLETE.
---

created: 2026-09-21 20:38
---
Niclas tried the animation on 21 September and judged the movement right: speed, direction, path, cycle time and the general feel of the motion are all to be left exactly as they are. Two visual adjustments only. ONE, the glint reads as separate bright dashes of differing intensity and must become one continuous glint: same total length as the present segments together, a tail fading continuously from transparent up to the brightest part near the leading edge, and a very short fade at the leading edge itself - nearly sharp, but without a hard cut. The gradient must follow the direction of travel along the whole outline, around the corners too. Adjust the distribution of light and nothing else. TWO, the pulse is barely noticeable: increase the difference between its weakest and strongest state so it reads clearly, without changing its rhythm and without affecting the readability of the text. Keep exactly when and where the animations are used - a working node during a run, and the Ready pulse on the entry point when the loop stands ready. Change no state rules. Reduced motion must still give a still marking.
---

created: 2026-09-22 00:36
---
Niclas accepted the look and the motion on 22 September after trying build 0c2fa964d8e0ca12: the glint's appearance and movement are approved and are to be left unchanged. The measured criteria - reduced motion, zoom and pan, the state rules - were established in report 027. Closing.
---
<!-- COMMENTS:END -->
