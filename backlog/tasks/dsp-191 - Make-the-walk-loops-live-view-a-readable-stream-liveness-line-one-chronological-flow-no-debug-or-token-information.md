---
id: DSP-191
title: >-
  Make the walk loop's live view a readable stream: liveness line, one
  chronological flow, no debug or token information
status: In Progress
assignee: []
created_date: '2026-11-10 11:40'
updated_date: '2026-11-10 11:40'
labels:
  - review
  - loop
dependencies:
  - DSP-190
priority: high
type: bug
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 10 November 2026, before his demo that afternoon and before the task on clarifying Essentials and Teacher: a focused presentation fix of DSP-190's *Follow preparation*. The graph and its animations stay; the activity panel, which read as a debug table (token reports dominating, every reasoning entry behind its own control with its own scroll box), becomes one readable live stream; *Every prompt and answer of the run so far* said *That preparation has no loop record* while the run was going. No change to the profile instructions or to the Standard explanations' behaviour; no rebuild of the loop engine; no new settings or view modes.

**The no-record cause.** `ReviewAgentJobs.walkLoopRecord` required `job.loop`, the summary a job gets only when its run has ended, so during a run the record on disk (written as the run goes) was refused. The method now serves any loop job's record from its deterministic place, with the summary where there is one; the live view itself reads the run through `walkLoopRunView`, which was never the failing path.

**Decided (Niclas, explicitly).** The user's view of a run holds no debug information: no token events, cache values, internal states, graph ids, instruction versions, raw events, prompts or protocol dumps, and none of it behind a Details control, a tab or an expander. That material stays in the run's files (`record.jsonl`, `activity.jsonl`, `summary.json`, `graph.json`) for troubleshooting and for agents. The readable stream is the person's way to follow the work.

**What is built.** Left, top to bottom: the heading *Code walk generation*, the liveness line (the job's own activity sentence as the diff window's job line shows it, with the spinner; clickable), and the animated loop. Right, when the liveness line is clicked: the whole available live stream of the run in one chronological flow with one vertical scroll: discreet dividers for roles and turns, the agent's exposed reasoning text and reply text open and growing as fragments arrive, short work lines for tool activity (reading a file, searching), commands readable with large results collapsed, the reviewer's assessment and findings, and a plain sentence for a turn that failed. Closing the panel (the line again, or its close control) stops nothing; the liveness line keeps updating. Scrolling: the stream follows its foot from the start, stops following when the person scrolls up, resumes when they scroll back to the foot; expanding a result moves nothing. A run recorded by an earlier version shows its answers with one short sentence about what was not kept.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The left side shows the heading, the liveness line with the current understandable activity, and the animated loop; the internal metadata line is gone; Stop and zoom remain
- [ ] #2 Clicking the liveness line opens a right panel with the whole available live stream; clicking again or a close control closes it without stopping the job; the liveness line updates while the panel is closed; opening, closing and reopening start no agent call and neither duplicate nor lose text
- [ ] #3 The stream shows exposed reasoning text, reply text and understandable tool activity as they arrive, open and readable without expanding entries, fragments joined into the running text, discreet dividers for roles and turns, earlier content kept in one chronological flow with one vertical scroll, line breaks and formatting kept, large tool results collapsed without hiding the agent's text, nothing invented
- [ ] #4 The stream follows the foot from the start, stops following when the person scrolls up, resumes when they scroll back to the foot, and expanding a result or reading history causes no jump
- [ ] #5 No token events, cache values, internal states, graph ids, instruction versions, raw events, prompts or protocol dumps are in the view, behind no control; the record link is gone from the view; the files keep that material; errors are described plainly with what the person can do
- [ ] #6 The live stream works before a final record line is written, with the same run identity and event flow; the record is also readable during the run; review isolation, Stop and the protection against late answers after deletion are unchanged; nothing reaches the diff view, Step or Discussion
- [ ] #7 Verified: build and type checks; in a real window the stream opened from the liveness line during a run with text growing without opening entries, scrolling up kept and resumed, close and reopen without extra calls or doubled text, role changes and the end, no debug or token information; the path tried (simulated provider) stated; pushed, and a Linux pre-release published with .deb, host package, manifest and checksums
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `walkLoopRecord` serves a running loop job; the read-back's limitation sentence in plain words.
2. `WalkLoopFollow.tsx`: the left column (heading, liveness line, graph), the stream panel (one flow, dividers, open text, tool lines, collapsed results, findings, plain errors), the scroll rule with the chat's follow helpers; `follow.css`.
3. The follow trial and the loop trial adapted to the new view; build; a real window run; release 0.1.16.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
10 November 2026, Windows, main checkout, started 11:40 for the demo after lunch.

**Niclas's two checks.** (1) The 64 KB bound on reasoning applies to the file only: `WalkLoopFollow.flush` emits and holds the whole text and writes a cut copy, so the live stream is never cut; a run read from its files afterwards carries a plain sentence where reasoning beyond the bound was shown and not kept. (2) The reply text being on the record's reply lines did not cause *no loop record*: the cause was `walkLoopRecord` requiring the job's summary, written with the end; the stream reads the live snapshot and the numbered events, never the record, and the record is now served from its place during the run as well.

**What changed.** `WalkLoopFollow.tsx` rebuilt: the left column (heading, the liveness line as a button with the job line's spinner and sentences, the graph in view mode unchanged), the stream panel (`blocksOf`: fragments joined into one running text per kind and turn, a tool's end folded into its start, usage left out, a finished turn closed by the next divider; `livenessOf`: the last thing reported, never a guess; the scroll rule with the chat's `followAfterScrollEvent`, applied scroll positions told from the person's; opening at a node's latest divider from a click on the graph); `follow.css` for the two columns. Gone from the view: the metadata line, the visit chips, the summary strip with usage, the per-entry details, the record control. `walkLoopRecord` accepts a running loop job (`summary: null` until the end). The limitation sentence for a 0.1.14 run in plain words. The follow trial's stream stages rewritten for the new experience (the stream opened from the liveness line, text growing with no entry to open, one scroll and no scroll box in a text block, `pre-wrap`, following from the start, scrolled up kept while text arrives with *new text waits below*, following resumed at the foot, the stream closed with the liveness line still updating, reopened with one divider per turn and no doubled text, the window closed and reopened without a second job, role dividers, the correction round and the final assessment in the flow, the liveness line with the job's own ending sentence, no token, usage, version, graph id, prompt or record control open or closed, the finished run's whole flow from its files); the loop trial's stage likewise.

**Checks.** `npm run typecheck` clean; build; tests/walk-loop-follow.test.ts and review-model 45/45. scripts/walk-follow-trial.mjs on Windows, real windows, simulated provider: ALL PASSED, 68 checks, first run after the rewrite. Screenshots in docs/evaluations/dsp-191/. Not run before the demo release, by Niclas's instruction: the broad groups and `linux-verify`, which run after publication and are reported in these notes. Not tried: a real provider.
<!-- SECTION:NOTES:END -->
