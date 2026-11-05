---
id: DSP-176
title: >-
  Selectable presentation profiles for the review agent's explanations:
  Original, Essens and Pedagog, a better Explain more simply, and follow-ups at
  the same level
status: Review
assignee: []
created_date: '2026-11-05 22:10'
updated_date: '2026-11-06 00:40'
labels:
  - ux
  - review
dependencies:
  - DSP-175
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 5 November 2026. He wants to compare ways of explaining the same code on real reviews without losing today's presentation or reverting code. This is presentation work on top of the existing review flow; it changes no review depth, facts, findings, recommendations or approval rules.

- A dropdown in the Step/Discussion panel offers **Original** (today's behaviour, the default during the trial, saved explanations shown as they are), **Essens** (what changes, why, and what the reader must understand or check; Show more gives mechanism, special cases and more references) and **Pedagog** (a simple mental model first, with a short concrete example when it helps; Show more adds detail in the same plain language). Each has a short description.
- For Essens and Pedagog, the first presentation and Show more are distinct levels: start with the step's point, no repetition between heading, lead and list, short paragraphs, details where they help, real depth under Show more, no arbitrary word limits that drop important information.
- **Explain more simply**, in every profile: fewer concepts at once, what the code achieves before how, plain words with needed terms explained, an example or analogy true to the code, caveats kept, no automatic extra detail, not a reworded repeat. Repeated presses build on the explanations already shown, try another way in, do not grow longer, and in the end ask a short question about what is unclear instead of saying it cannot be simpler.
- **Follow-ups keep the level**: the agent is told the profile, the explanation the question follows, and the simplification round and examples already used. Links to step, code, quotes and threads are kept; a question in a finding's thread stays in that thread.
- **Switching profile** generates an alternative explanation for the current step only, never the whole walk; the existing explanation stays visible meanwhile, with a discreet indicator; nothing is replaced or deleted; a failure keeps the existing one and can be retried; a late answer never shows under the wrong profile or step. Alternatives are kept (back to a generated profile shows it without a model call, also after a restart), bound to review, walk step, its material and profile; Show more and simplifications belong to their alternative; history is not rewritten. The chosen profile applies to later explanations and follow-ups; no background generation of other steps.
- The difference lies mostly in collected profile instructions that are easy to iterate on; no duplicated review pipeline. The walk's left side and navigation are not redesigned.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Original, Essens and Pedagog are offered with short descriptions in the panel, docked and standalone; Original is the default and older reviews open unchanged
- [x] #2 The profiles' instructions are collected in one readable place and shown to the person; they change presentation only
- [x] #3 Switching profile generates only the current step's alternative, shows the existing explanation meanwhile, survives failure with retry, and never shows a late answer under the wrong profile or step
- [x] #4 Generated alternatives are reused without a model call, also after a restart, and are bound to review, step, material and profile; Show more and simplifications belong to their alternative
- [x] #5 Explain more simply follows the new rules in every profile and gets the explanations already shown as its basis on repeated presses
- [x] #6 Follow-up questions carry the profile and the explanation they follow; thread questions stay in their thread
- [x] #7 Coverage, findings, thread identities and decisions are unchanged by any of it
- [x] #8 Targeted tests and a Linux window trial on the trial's own Xvfb pass, with limits stated; simulated answers verify UI and data flow, not a real model's teaching
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 5 November 2026 on Linux. Governing decisions: VISION.md section 3.4 (the review flow, short answers first and Show more, the review's panel, DSP-175's threads and Ask), AGENT_BEHAVIOUR_AND_ORCHESTRATION.md sections 1–2 (every instruction DSpatch adds is visible and inspectable, defined in one place), section 5 (review uses the shared agent connection; no second pipeline), and DSP-175's notes. The profiles are presentation requests in the review's existing discussion, so they go through the same envelope, tools, policy and storage as Tell me more and Explain more simply.

What was built:
- **One place for the profiles' instructions**: `app/src/shared/presentation-profiles.ts` holds the three profiles (name, description, first-presentation and Show more rules), the rules every alternative follows, the new Explain more simply rules (and those for pressing it again), the follow-up rules, and the prompt section built from them. The panel shows the description with the choice and the full text under *What it asks for*. Original adds nothing to today's prompts; only Explain more simply has the new rules in every profile.
- **No second pipeline**: an alternative is a new deepening, `present`, in the review's own discussion, with the profile and the step's content hash (`stepContentHash`) as its version; Explain more simply, Tell me more, Explain this and follow-ups carry `presentation` (the profile and the ids of the answers already shown), which the discussion service resolves to the texts it sends. Questions keep their profile in the discussion record, so Show more, simplifications and follow-ups belong to their alternative, and history is never rewritten.
- **What the step shows** is chosen from the record (`app/src/renderer/presentation-choice.ts`): the alternative of this step, version and profile; a finished one before a later failed retry; deepenings of the same profile and version (older ones stay with Original). A late answer is kept and shown only where it belongs.
- **The panel**: the dropdown sits in the tab row that stays in view (it scrolled away under the walk's threads at first); a line above the explanation says what is shown and what is happening — *Writing the Essens explanation of this step… The prepared explanation is shown meanwhile*, a failure with *Try again*, *Explain this step as Essens* at a step without one, and a toggle to the prepared explanation. The choice is kept in the windows' storage, shared by the walk and the panel.
- **Decided-design point**: the discussion's rule is that nothing is sent on open, load or navigation. So a switch asks only for the current step, and arriving at another step offers its alternative with a button instead of asking by itself.
- **Explain more simply** gets the explanations already shown (the alternative or the prepared explanation, then each earlier simplification, also along a chain of *Explain more simply* on discussion answers), numbered attempts, and from the second press is asked for another way in and to end with a short question about what is unclear.
- **Found and fixed on the way**: switching the panel from Step to Discussion and back lost the reader's place (the hidden discussion's scroller jumped to the top, which was read as the reader scrolling away); it now returns to the latest for a reader who was there, and to the same place for one who had scrolled up.
- SIMULATED provider: answers shaped by the prompt's sections (Essens, Pedagog, the attempts of Explain more simply, follow-ups), `DSPATCH_REVIEW_SIM_PRESENT_MS` (slow presentations) and `DSPATCH_REVIEW_SIM_FAIL_PRESENT_STEP` (one failure for a step).

Verification (Linux, 6 November 2026; isolated profile; throwaway neutral project; simulated provider; the trial's own Xvfb with openbox, input through xdotool, X screenshots, never the user's display):
- `npm run typecheck` clean; `review` 257/257 (new `presentation-profiles.test.ts`, 10 tests, and two service tests in `review-discussion-service.test.ts`: a step presented in Essens, Explain more simply twice on it, a follow-up, and Explain more simply twice along a chain of discussion answers, against the exact prompts); `presentation` 311/311; `fast` 1583 passed, 5 skipped, 0 failed.
- `scripts/profile-trial.mjs`: 59/59. Original the default with the prepared explanation; the three choices described and their instructions readable; Essens asked once, for the current step only, with the prepared explanation and a quiet indicator meanwhile; Show more with the Essens depth; Pedagog the same; back to Essens and to Original at once without a call; Explain more simply twice with the explanations already shown and another way in; a follow-up carrying Essens and what it follows; arriving at another step sending nothing; a late answer for a step not shown at the next; a quick switch never showing one profile's answer under another; a failure keeping the prepared explanation, with Try again; a question in a finding's thread staying in the thread; coverage, what remains and the findings unchanged; after a restart the profile kept and both alternatives shown without a call; in the panel's own window the choice working without a call, the unsent draft and the discussion's place kept, the place back from Step, and zoom +1, 0 and −1. Evidence (not in Git): `app/release/trial-profiles-dsp176/`. After the change to the discussion's scrolling, `scripts/dock-trial.mjs` (54/54) and `scripts/thread-trial.mjs` (all passed) were run again.

Not established: what a real model makes of the instructions (simulated answers show the UI and the data flow, not teaching quality; Niclas judges that with a real provider on real code); the refusal path of a switch while another answer is still being written, in a window (in the trial the earlier answer had finished each time, so the switch was asked at once; the refusal is the discussion's existing rule and shows as a failure with Try again); Windows; a physical mouse and keyboard.
<!-- SECTION:NOTES:END -->
