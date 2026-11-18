---
id: DSP-225
title: Show a step's visits apart with their model class and agent context, then release
status: Review
assignee: []
created_date: '2026-11-18'
labels: [loops, ui, release]
dependencies: [DSP-224]
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Check and correct, on main after DSP-224 (57dfa4d), how a node's model class mark and its live output behave when one node is visited several times with different model classes: the mark follows the current visit and is labelled as the latest after the run; visits are kept apart in the node panel and the step output window (built on the visit identities, `step-output.ts` and `StepOutputActions.tsx`), each with its visit number, class and concrete model; an open window keeps its visit and offers to follow a newer one; saved results stay reachable after the run, with what the record lacks said. State, per visit, whether the agent continued an earlier session (its earlier conversation in context) or started a new one; the session policy itself is not changed. Then an ordinary release for Linux and Windows, marked Latest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] #1 The node mark shows the current visit's class and model during a run, the latest visit's labelled as such after it, and no class before the first visit; details give visit, class, model, provider and reason.
- [x] #2 Visits are listed apart with number, class and model; the current or latest is first; an open window keeps its visit and offers to follow a newer one; earlier visits and saved results open after the run, with any missing detail said.
- [x] #3 Each visit says whether the agent continued an earlier session of the node or started a new one; no claim of independent review is made from separate display.
- [ ] #4 Verified with a two-visit run (small then large) through the live executor with a simulated adapter and in the window, normal and zoomed out; real-provider status reported.
- [x] #5 Released as the next version, Latest, Linux and Windows installers and host packages from one commit; files, manifest and checksums checked.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Result (18 November 2026). **Mark.** The canvas line reads "now: visit N · model" while that visit runs and "latest: visit N · model" once it has closed or the run ended; the tag shows that visit's class (Small/Medium/Large, S/M/L zoomed out); before the first visit only "class chosen per visit". The hover and node panel give visit, class, model, provider and why. **Visits.** `nodeVisitRows` carries each visit's model (from its own `node-entered`) and whether its session continued an earlier one (`sessionContinued` on `node-produced`, set by the live executor). The node panel lists the current or latest visit first ("Now"/"Latest") with class and model, earlier visits folded below. The step output window opens on the visit it was opened for — the node's latest from the graph — and moves back and forth between the node's visits in place (Earlier / Later / a button per visit with class and model); a visit that starts while an earlier one is shown is offered ("Show visit N"), not switched to; heading and model line are the shown visit's own; after a restart the visits come from the run record, which keeps replies and commands, not the streamed tool calls. **Agent context.** Each visit says whether the agent continued the node's session (earlier conversation in context; "not an independent review") or ran in a new one. Observed: a revisit with the same model continues the session on every agent; with another model Claude switches it in the same session and the others open a new session. Session policy unchanged; documented in the generic network README and TUTORIAL. **Simulated window support.** `DSPATCH_CHAT_RUN=loop-hold` leaves a presentation-mode window at rest; the presentation adapter honours `[[choice <id> <option>#n]]` and `[[verdicts-only]]` and starts a loop reply with its session, turn and model.

Checks: type check, build; generic-agent-network (50, among them two visits small then large through the live executor with simulated Copilot and Claude adapters: model to the adapter per visit, mark/journal/visit rows agreeing, per-visit output kept apart, session continuity per provider), step-output, presentation-chain, presentation-resume, loop-run, run-inspection. Window (loop-hold, isolated profile, simulated): mark "now: visit 1 · sim-small" with tag Small during visit 1; the visit window listing visits 1–6 with class and model, staying on visit 1 with "Show visit 6" offered, and its own model and context lines. Not completed at Niclas's request to prioritise the release: the rest of the window trial (following, zoomed out, after a restart). Open observation: the simulated identity line at the start of a reply was not seen in the window's live text although the run record and the activity fold hold it; not investigated. No real provider tried.
<!-- SECTION:NOTES:END -->
