---
id: DSP-195
title: >-
  Essentials' visible text is as full as Standard's in a whole generated walk:
  trace the one-call and loop chains, fix the established cause
status: In Progress
assignee: []
created_date: '2026-11-10 19:14'
updated_date: '2026-11-10 20:30'
labels:
  - review
dependencies:
  - DSP-192
  - DSP-194
priority: medium
type: bug
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's observation (10 November 2026, after 0.1.19): a whole walk generated in Essentials still read nearly like Standard. In the step "The attach configuration" the text before Show more held a summary, several paragraphs on attach versus launch, a numbered walk-through of preLaunchTask and the attach order, the success condition, and settings that later steps treat; Standard looked nearly the same. He asked for a targeted trace of the whole generation and presentation chain, not another general rewrite of the profile descriptions.

The brief (in Swedish, summarised): establish the app, host, instruction version and profile of the observed run if its material is available, else make a generic reproduction (a debug configuration, a preparing task, a process whose start does not guarantee readiness) without his work repository; trace the reference, the planner's brief, the writer's effective instruction, context and schema, the writer's first answer, the reviewer's findings, the answer after rework, parsing, storage and fallback, what the Step view shows before and behind Show more, and the profile-alternative path; tell apart (A) the writer detailed from the start, (B) the reviewer demanding detail back, (C) the schema's fields together making a full walk-through, (D) rendering showing more before Show more, (E) a wrong profile, old instructions or state; check whether the requirements on mechanism, risks, conditions, code names, previous behaviour and transitions together act as a mandatory content list and whether the same content is asked for in several fields. Judge all text visible before Show more; do not clip, hide or move text arbitrarily. The intended level is given by a calibration example, not a template: "This configuration connects the debugger to Python in the container. It first runs the startup task, then attempts to attach—but completion of that task does not guarantee that the debug server is ready. The next step follows that startup task." Make the minimal coherent fix at the right level: no extra brevity rule over a completeness requirement, no sentence quotas, identifier limits or clipping, no new generation architecture, keep code access and the walk context, Standard's mechanism and Teacher's concepts, the walk structure and review decisions; revise the reference only if it contributes. Verify before and after on the same locked plan, revision and model, for the original generation and the profile switch, with the reproduction and a step of interacting mechanisms, Standard and Teacher as regression, through the real provider flow (preferring the configured Copilot, reporting the model actually reported), the full visible text and the deepening apart, the reviewer's first answer and rework where it changed, a targeted window trial, a limited round with its variation. Keep saved explanations, raise the instruction version, no automatic regeneration. Check, commit, push without force, publish the next Linux pre-release; leave the task in Review. Essentials' pedagogical quality is not accepted on green tests or shorter text.

Governing decisions: VISION.md section 3.4 (the profiles and the DSP-194 record: what reaches the agent outside the profile must not act as its content list); docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md sections 4 to 6 (each profile's responsibility, the Essentials calibration, the shared task, section 6's rule on material outside the profile) at version 1.2; AGENTS.md's design-conformance rules (no change of architecture, control boundary or division of responsibility).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The chain is traced stage by stage for the one-call preparation, the walk loop and the profile switch, and each of A to E is judged with evidence from real-provider runs; the observed run's versions are stated or said to be unavailable.
- [x] #2 The fix removes or rewords the conflicting requirements where they arise, adds no brevity rule, quota, identifier limit or clipping, keeps code access, the walk context, Standard's mechanism, Teacher's concepts, the walk structure and review decisions; the instruction version is raised; nothing is regenerated.
- [x] #3 Before and after on one locked plan and revision content with the same models, for the writer and the profile switch, the reproduction step and a step of interacting mechanisms, Standard and Teacher as regression, and the one-call preparation sampled; the reported model is named; the visible text and the deepening are shown apart; the reviewer's first answer and rework are shown where it changed; the variation is reported.
- [x] #4 Window trials show what the Step panel shows before and behind Show more, after the original generation and after a profile switch, with pictures.
- [ ] #5 Checks, commit and push; CI green; the Linux pre-release with the .deb, host package, manifest and checksums; the published upgrade trial green.
- [ ] #6 Niclas judges Essentials' pedagogical quality in his own use (not accepted on green tests or on shorter text).
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Trace and findings (10 November 2026)

The observed run is not on this machine: a read-only search of the DSpatch review stores here found no walk with that step, so its app, host and instruction versions and its provider are not established. A generic reproduction was made instead: `tests/support/synthetic-attach.ts` (a VS Code attach configuration with a pre-launch task, a Compose service that starts debugpy listening, the service). The product's default preparation method is the one-call preparation (`walksPrompt`); the loop (planner, writer, reviewer) is the alternative; a profile switch on a walk asks the step explanation channel. Harnesses: `scripts/walk-real-chain.mjs` (a whole preparation through the host's job service and the product's adapter, every prompt and answer kept), `scripts/profile-locked-compare.mjs --case attach` (the writer and the profile switch on one locked plan), `scripts/walk-step-surface.mjs` (what the Step view shows of a definition step), `scripts/profile-real-trial.mjs --case attach --method single` (the real windows, with pictures of the Step panel).

- **The provider decides whether the observation reproduces.** Copilot (`copilot-default`, reported `gpt-6-luna`) wrote every profile short (about 260 to 560 visible characters for the attach step) at version 9. Claude (`opus`, reported `claude-opus-5-5`) reproduced it: in the one-call preparation, one of five version 9 samples had the numbered walk-through, all had the change from launch, and Essentials was close to Standard; on the locked plan the writer's Essentials was 916 visible characters against Standard's 1150.
- **A, the writer is detailed from the start: the primary cause.** The long text is the writer's first answer (the one-call preparation has no reviewer at all; in the loop the first answer is already long). Controlled variations with Claude at version 9 (the writing rules' content line out, the shared task and role purpose leaving the choice to the profile, the planner's brief out, the reference's background-worker calibration added) and at version 10 (the shared rules on adding understanding and on scope out, the walk rules on orientation and transitions out, both) gave no change beyond the sample spread. The remaining level is the model's own selection under the Essentials reader as written.
- **The duplicated content lists: a real but partial contributor.** Beside the profile's section, every profiled walk prompt still carried a reader and a content list of its own, which every profile met: the shared task's first sentence ("say what the code does here and why it matters…, how it connects…, what the reader must understand to judge it: a condition…, a risk…"), the walk writer role's purpose with the same list, the writing rules (a developer who did not write the change; each step says what happens, why and what to notice; cause and effect; the names explained), and the one-call answer format's `body` ("what happens, why, what to notice in the code") and `why` ("the consequence"). The loop reviewer's place check named the same three items for every place. DSP-194 had taken such rules out of the profile switch's answer format; the walk's own preparation still had them.
- **B, the reviewer:** not observed driving detail. Copilot's loop reviewer at version 9 and 10 asked once each for a main-behaviour fact (what the service serves; the reworked W1.6 grew from 266 to 330 characters); Claude's loop reviewer at version 10 accepted the walk at once.
- **C, the fields together:** at version 9 the one-call answer format asked for what happens in `summary`, again with why and what to notice in `body`, and for the consequence in `why`, so the visible surface carried one content list across three fields; the summary often restates the body. Version 10 removes the fields' content descriptions; the summary still sometimes restates the body.
- **D, rendering:** nothing behind Show more leaked before it. But "Why it matters" was rendered after the Show more control while always visible, so base text stood on both sides of the control.
- **E, wrong profile or old state:** not in the runs made: every prompt carried "How to explain the steps (Essentials)" at the version stated, and every definition recorded it. For the observed run it cannot be established.

### The fix, instruction version 10

- `EXPLANATION_TASK[0]` (presentation-profiles.ts) names what an explanation may cover and says that which of it this reader needs, and at what level, the reader's profile decides.
- The walk writer role's purpose (docs/loop/roles/review/walk-writer.role.md) is the reader the profile names and what that reader needs.
- `WRITING_CONTENT_RULES` (review-agent.ts): the reader and content rules of the writing rules are named; with a profile, the one-call prompt and the loop writer get the form rules only. Without a profile nothing changes.
- The one-call answer format describes `body` and `why` without a content list when a profile is set.
- The loop reviewer's place check asks whether every place is explained at this reader's level, without a list of its own; its check that an omission which misleads is a finding in any profile is unchanged.
- The Step view (ReviewView.tsx, DiscussionAnswer.tsx): "Why it matters" is passed to `ShortThenMore` as base text and stands between the first part and the Show more control.
- `PRESENTATION_INSTRUCTION_VERSION` = 10. The reference is unchanged at 1.2: its section 6 already says that what reaches the agent outside the profile must not act as its content list; the conflict was in the implementation. No calibration example was added to the prompts (no robust effect in the trial). Saved explanations are kept; nothing is regenerated.

### Before and after (evidence in docs/evaluations/dsp-195/)

Visible characters before Show more, reference blocks left out:

| Text (locked plan) | Copilot v9 | Copilot v10 | Claude v9 | Claude v10 (samples) |
|---|---|---|---|---|
| writer Essentials W1.1 | 314 | 274 | 916 | 601, 916, 588 |
| writer Standard W1.1 | 315 | 257 | 1150 | 888, 983, 1007 |
| writer Teacher W1.1 | 322 | 299 | 1589 | 1375, 1463, 1699 |
| switch Essentials W1.1 | 316 | 342 | 1163 | 825, 940, 1179 |
| writer Essentials W1.6 | 347 | 520 | 1274 | 1063, 1384 |
| writer Standard W1.6 | 352 | 476 | 1985 | 1647, 1312 |
| switch Essentials W1.6 | 528 | 451 | 1595 | 1616, 1438 |

One-call preparation with Claude, the attach step, five samples per version (version 9 samples three to five are the version 10 harness with the prompt put back to version 9 exactly, checked identical to a real version 9 prompt apart from revisions and paths): Essentials 517, 752, 605, 813, 605 at version 9 (mean 658; one numbered walk-through) and 614, 507, 491, 547, 623 at version 10 (mean 556; none). Standard 945 (v9) and 772 (v10), Teacher 911 (v10), one sample each. Copilot's one-call Essentials 528 and 519 (v9) and 396 (v10). The connect case with Copilot (DSP-194's locked plan) is unchanged within its spread.

Window trials with the real windows and the one-call preparation (`profile-real-trial.mjs --case attach --method single --switch-only`): Copilot Essentials, then a switch to Standard; Copilot Standard, then a switch to Essentials; Claude Essentials, then a switch to Standard. Pictures and the panel's texts are in the evidence folder. Visible before Show more in the attach step: Claude's Essentials walk 500 characters against 1528 for Standard as an alternative on the same step; Copilot's Essentials walk 359; Copilot's Essentials after a switch from Standard 564. One picture (Claude, the attach step before Show more) could not be drawn ("UnknownVizError" while the display was off); the trial now notes a missing picture instead of failing, and the picture with Show more open shows the same first part. No step in those trials had both "Why it matters" and a deepening, so the new position of "Why it matters" is checked on the source (review-reading-style.test.ts), not seen in a window.

### Established and uncertain

Established: the observation reproduces with Claude and not with Copilot; it arises in the writer's first answer; the reviewer did not add detail in the three loops run; the profile reached the model in every run; the duplicated content lists existed and are gone; "Why it matters" stood after the control and now stands before it. After the change, Claude's Essentials in the one-call preparation is somewhat shorter and lost the numbered walk-through in the samples; on the locked plan and in the profile switch the change is within the sample spread; Standard and Teacher keep their mechanism and concepts (Claude Standard and Teacher stay full; Copilot unchanged).

Uncertain or open: the observed run's provider and versions; whether Claude's Essentials can reach the calibration level without changing the Essentials definition or the model, which is a decision for Niclas, not a brevity rule to add; the pedagogical quality, for Niclas's own reading.

### Checks

`npm run typecheck`; `npm run build`; the targeted prompt and walk tests (134 pass); the follow trial in real windows with the simulated provider (`walk-follow-trial.mjs`, 73 checks pass; its New response check now reads the current instruction version from the source instead of a pinned 9); the presentation group (317 pass), the loop group (675 pass); the review group 349 pass and 1 fail: `review-context.test.ts` "reads lib as context…" fails on Windows on HEAD before this change as well (it compares a read path with `path.join`'s backslashes against a forward-slash read), so it is not caused by DSP-195 and is not fixed here.
<!-- SECTION:NOTES:END -->
