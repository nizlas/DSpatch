---
id: DSP-199
title: >-
  Essentials becomes extremely short: about two natural sentences before Show
  more, in the reference and in every generation path
status: Review
assignee: []
created_date: '2026-11-11 20:48'
updated_date: '2026-11-11 22:34'
labels:
  - review
dependencies:
  - DSP-198
priority: medium
type: enhancement
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's explicit decision (11 November 2026), replacing the earlier caution about length guidelines: Essentials is to be extremely short and concise. The visible explanation is normally about two ordinary sentences: a clear guideline, not an exact quota; a very large piece of code may need more, but the short part still gives only the main picture. The reader can always choose Show more, so missing implementation detail in the short part is not a failure; the short part must be correct, not comprehensive. Update docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md (replace the Essentials definition and conflicting wording; keep Standard and Teacher; mark superseded decisions), replace conflicting Essentials instructions in the product (one-call generation, the loop writer and reviewer, profile switch and regeneration, shared rules, role texts, format descriptions, the planner's material), make the whole visible block before Show more short (no separate summary, introduction or Why it matters adding a second walkthrough or repeating it), adapt the reviewer to judge the short part apart from Show more without asking for details back, keep Standard and Teacher at their level, keep saved explanations, regenerate nothing. Verify with real generations on existing cases with the configured provider, showing what the user sees before and after Show more; targeted tests and project checks. No release in this task: Niclas judges the form first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The reference states the new Essentials goal coherently, conflicting wording is replaced and superseded decisions are marked; Standard and Teacher definitions are kept
- [x] #2 Every generation path (one-call, loop writer, profile switch, regeneration) gets one Essentials definition with no competing shared rule, role text, format description or planner material asking for a walkthrough in the short part
- [x] #3 The visible block before Show more in Essentials adds no second walkthrough through a summary, introduction or Why it matters
- [x] #4 The loop reviewer judges the short part apart from Show more and does not ask for details back; facts are still checked
- [x] #5 Standard and Teacher prompts and level are unchanged; saved explanations kept; the instruction version raised
- [x] #6 Real generations with the configured provider on a simple and a larger step show the short part and Show more; targeted tests and project checks pass; remaining shortcomings are reported
- [ ] #7 Commit and push; no release; Niclas judges the form
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Niclas's decision of 11 November 2026, implemented at instruction version 12; verification in docs/evaluations/dsp-199/ (README.md, TEXTS.md).

**Where the new goal is expressed.**
- docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md version 1.3: section 4's Essentials definition, rewritten in full; the introduction (a size guideline, judged by reading); the general paragraph of section 4; the Show more paragraph; the background-worker example in section 5, now two sentences; the instruction and reviewer paragraphs of section 6; the assessment paragraph of section 11. The status paragraph marks the superseded wording.
- docs/VISION.md section 3.4: a new DSP-199 entry; "No sentence or identifier counts" and the DSP-192 entry are marked as superseded for Essentials.
- app/src/shared/presentation-profiles.ts: PROFILES.essens.reader is the one Essentials definition (extreme brevity, about two natural sentences, correct but not comprehensive, depth after the marker, overreaching claims made precise).

**Old active instructions replaced for Essentials.**
- The old Essentials reader (higher abstraction; scope grows with the step).
- The shared scope rule (EXPLANATION_TASK[3]: a step of interacting mechanisms takes the room it needs; v11's compact-first-part wording).
- The walk's orientation and transition rules (WALK_READING_RULES[1] and [2]).
- The Show more contract (DEEPENING_RULES: "for Essentials the mechanics an experienced developer may want next") and the one-call details rule (WALK_DETAILS_RULE).
- These are replaced through ProfileDefinition.own in walk generation, the profile switch, regeneration, the deepening sections and the loop writer, so no shared rule stands beside the definition.

**The visible block and the paths.**
- One-call: summary is a few words and why is empty in Essentials (schema and section).
- The Step panel shows no separate summary above the short part of an Essentials walk prepared at version 12 or later; older walks are shown as they were.
- The loop writer sees the planner's brief as "notes, material to select from".
- The writer and reviewer roles' shared sentence describes Essentials the new way.
- The loop reviewer gets ESSENTIALS_REVIEW_CHECKS: the short part judged apart from Show more, a missing detail not by itself a finding, a correct but detailed walkthrough not Essentials, facts checked as before.
- Standard and Teacher: their prompts are unchanged in substance in every path. The snapshot comparison (docs/evaluations/dsp-199/prompts/) shows only the shared role sentence changed.

**Real generations** (Claude, requested opus, reported claude-opus-5-5): the locked plan (writer in three profiles, switch to Essentials and Teacher, W1.2 and W1.7), a one-call Essentials walk, an Essentials loop, and a window trial. The short parts are 112 to 395 characters, two to three sentences, one of four, and none is a packed walkthrough. One overclaim: the switch's W1.2 says VS Code attaches "only" if the exit code is zero. The readiness gap is in the short part of the switch's W1.7 and behind Show more elsewhere. Show more opens and adds understanding but is often a list. The loop reviewer accepted at once, so its new checks were not exercised on a too-long text. Standard keeps the mechanism and Teacher its breadth.

**Checks:** typecheck and build. Targeted tests 134 pass; presentation 317, loop 675; review 349 plus the known Windows failure in review-context.test.ts. The window trial passed 24 checks. The follow trial (simulated provider, real input) could not run: another full-screen application was in front on the desktop; its screen pictures were deleted. Regeneration and the return to a saved text were therefore not exercised in real windows here; regeneration was not run live.

Commit f326ca9; linux-verify run 43100697122 green (dock, profiles, governor, provider tests, windows, tests).

**Final check (Niclas's follow-up, 11 November 2026):**
- The profile switch's "only if the exit code is zero" is a generated factual error: VS Code's debug.onTaskErrors defaults to prompt. Its source was the run's own Standard text, given as material, and the same belief recurs in the one-call walk's W1.3. It is documented, not corrected by a rule.
- The follow trial passed 73 checks under Xvfb in Linux CI on f326ca9. The window trial with Claude passed 30 checks, including Show more opening and closing and the Essentials short part with no summary line and no Why it matters.
- The loop reviewer, given the version 11 Essentials walkthrough of W1.7, returned rework with "The first part is a full walkthrough, not an Essentials orientation" and proposed about two sentences, with details after the marker. No reviewer change was needed.
- The walks' transitions remain followable; no addition was needed.
- Show more: one stray line documented; no format rule added.

Released as 0.1.22 on Niclas's authorisation. Check commit e554e39, with linux-verify run 43109481382 green. Release commit b41aece, tag v0.1.22. Package run 43111027151 published https://github.com/nizlas/DSpatch/releases/tag/v0.1.22 with dspatch_0.1.22_amd64.deb, dspatch-host-0.1.22-b41aeceb0b32-linux-x64.tar.gz, host-manifest.json and SHA256SUMS; the notes are docs/releases/v0.1.22.md. The published upgrade trial from v0.1.21 (run 43111765190) passed 30 checks. In Review: Niclas's reading of Essentials on real code remains.
<!-- SECTION:NOTES:END -->
