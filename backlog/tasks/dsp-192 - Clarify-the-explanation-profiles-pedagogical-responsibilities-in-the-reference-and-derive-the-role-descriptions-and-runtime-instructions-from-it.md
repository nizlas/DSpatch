---
id: DSP-192
title: >-
  Clarify the explanation profiles' pedagogical responsibilities in the
  reference and derive the role descriptions and runtime instructions from it
status: In Progress
assignee: []
created_date: '2026-11-10 12:50'
updated_date: '2026-11-10 12:09'
labels:
  - review
dependencies:
  - DSP-191
priority: medium
type: enhancement
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 10 November 2026, after DSP-190 and DSP-191 and his use of 0.1.14 to 0.1.16. Standard from the complete loop generation is promising and is kept as it is while his deeper evaluation goes on. Essentials does not work as intended: in a concrete trial it was nearly as long as Standard and developed more mechanical detail. Teacher read as only somewhat longer, without a clear difference in pedagogical help. The goal is clearer differences in abstraction level, selection and teaching, not sentence quotas, identifier limits, mandatory headings, or the same content at different densities. Also a small cleanup of the loop viewer: the line *The run goes on; what the agent reports appears here as it comes.* goes, with no replacement.

**Governing decisions.** docs/CODE_WALK_UNDERSTANDING_AND_PROFILES.md is the reference and is revised first, coherently (its sections 4 to 6 and 11); docs/VISION.md section 3.4 (the reference's adoption, one explanation task and three readers, no quotas; the profile entry of DSP-181; the decisions of DSP-184 to DSP-188 on history and provenance); docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 1 (every instruction DSpatch adds is explicit, inspectable and derived at the reference's level). The generation path (the one call, the loop's writer and reviewer, a profile alternative by a step explanation) is kept apart from the profile question: introducing writer and reviewer for profile alternatives is a separate architecture question, not a solution here.

**What is built.** (1) The reference, version 1.1: section 4 states each profile's pedagogical responsibility (Essentials: purpose, the main work and the decisive conditions or consequences for an accurate main picture, at a higher level of abstraction, brevity from meaningful selection; Standard unchanged as the comparison point; Teacher: build the understanding the reasoning presupposes, chosen for the step, using what the walk established), the common ground (all profiles correct and grounded in the same code, selecting differently; truthfulness does not mean every short part restates every fact of the original; findings stay in the review's state; length is a consequence of the chosen help), Show more as relevant continued explanation rather than a dump; section 5 gains the background-worker calibration example with how Standard and Teacher treat it; section 6 says the original text is material, not a content list; section 11 asks every evaluation to name its generation path. (2) The runtime instructions derived from it (`presentation-profiles.ts`, instruction version 8): the Essentials and Teacher readers rewritten; the shared boundary reworded so that the prepared text and earlier answers are material and the code the source of truth, with the review's findings kept in the review's state rather than restated; Show more and Regenerate worded to the same effect; Standard's reader kept word for word. (3) The loop's reviewer judges whether the text helps the profile's reader: it does not ask Essentials for the mechanics it left out unless the main picture misleads, and does not ask Teacher for more detail to be longer; the roles' texts follow. (4) The loop viewer's redundant line removed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The reference states each profile's pedagogical responsibility and the common ground coherently, with the background-worker calibration example and how Standard and Teacher treat it, without sentence counts, identifier limits, mandatory headings or the same content at different densities; the document stays in English and its history is preserved
- [x] #2 The runtime instructions are derived from the revised reference: short coherent readers for Essentials and Teacher, a shared task that leaves room for selection, no wording that makes the original text a mandatory content list or requires every fact in every short part; Standard's reader and its working behaviour are kept; the instruction version is raised and saved history is not regenerated
- [x] #3 The loop's reviewer judges help for the profile's reader, neither demanding omitted details back in Essentials nor more detail in Teacher for length, while catching omissions that mislead; the judging of explanation quality stays apart from approval of the code
- [x] #4 Essentials, Standard and Teacher are generated for the same locked walk plan, revision and steps with the same model and comparable code access, for simple code and a step where several mechanisms interact, plus a profile alternative made after the walk; the texts are judged against the readers' needs; the generation path of every example is named; what was done with a real provider is stated
- [x] #5 The line *The run goes on; what the agent reports appears here as it comes.* is gone from the loop viewer with no replacement, and the rest of the viewer's behaviour is unchanged
- [ ] #6 Documents and instructions that contradict the clarification are aligned; relevant automated checks and the profile and follow window trials pass; the work is pushed, CI is green, and a Linux pre-release with .deb, host package, manifest and checksums is published and verified
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Save the instructions at version 7 and point at the DSP-189 Standard texts as the comparison point.
2. Revise the reference's sections 4, 5, 6 and 11; version 1.1.
3. Derive the readers, the boundary, Show more, Regenerate and the reviewer's judging; version 8; the role files; the tests that pin the wording.
4. Remove the loop viewer's line; type check and build.
5. Generate the three profiles for two steps of the connect case through the writer's prompt, and an Essentials alternative through the step explanation's prompt, with the stand-in; judge the texts; fix clear faults once.
6. The profile trial and the follow trial; docs; release.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
10 November 2026, Windows, main checkout.

**Done.** (1) The reference, version 1.1: section 4 rewritten (common ground; Essentials as an accurate main picture at a higher level of abstraction by meaningful selection; Standard unchanged and named the comparison point; Teacher building the understanding the reasoning presupposes; Show more as relevant continued explanation), section 5 with the background-worker example in the three profiles, section 6 (the shared instruction leaves room; the original text is material; the reviewer judges help for the reader), section 11 (name the generation path). (2) `presentation-profiles.ts` version 8: the Essentials and Teacher readers rewritten from the reference; the shared boundary rules reworded (a profile changes selection and level, not what is true; the prepared text and earlier answers are material, not a list of what must be said); the deepening, regenerate and walk-details rules worded as relevant continued explanation, not an inventory; Standard's reader word for word as in version 7. (3) `walk-loop.ts`: the reviewer judges the help for the profile's reader (no mechanics demanded back in Essentials unless the main picture misleads, no more detail demanded in Teacher for length; an omission that misleads is a finding in any profile); the writer, reviewer and planner role files follow (version 1.1). (4) The run view's line "The run goes on; what the agent reports appears here as it comes" removed with its CSS rule; nothing replaces it. (5) The writer's prompt had a contradiction the comparison surfaced: the folder section asked it to name places by path and line, the walk rules ask for functions and types in the prose; the writer now gets its own sentence (`WRITER_PLACE_NAMING`, `folderSection`'s third parameter). Fixed once, after the comparison; the saved answers were not regenerated.

**The comparison** (`docs/evaluations/dsp-192/`): the instructions at version 7 saved (`baseline/instructions-v7.md`) and version 8 beside them; nine prompts built by the product's own builders for walk W1 of DSP-189's connect run 2 (locked plan, revision and steps): the loop writer's prompt for W1.1 and W1.5 in all three profiles, the step explanation channel's prompt for an Essentials and a Teacher alternative of W1.5 made after the walk from the DSP-189 Standard text, and the writer's Essentials prompt for W1.5 with version 7's rules; each answered by one fresh Claude Code subagent with read-only access to the revision folder (a stand-in, not a DSpatch provider; the DSP-189 Standard baseline was made the same way). Judged in `run/JUDGMENT.md`: all nine true to the code (three claims rest on more than the code shows, noted); the profiles differ in selection and level, not in facts; Teacher adds concepts, not facts; the alternative made after the walk is comparable with the text written during it, and its Teacher was the best Teacher text; version 7 against 8 for Essentials differs little with this stand-in, so the comparison shows version 8 does not make Essentials worse and shapes the deepening as intended, not that it cures what version 7 did with the real provider. The harness is `app/scripts/profile-compare.mjs` and `app/scripts/print-instructions.mjs`.

**Checks.** Type checks clean. Tests: presentation-profiles, presentation-chain, walk-loop, review-discussion-service, presentation-walks, explain-prompts (70 of 70 after the instruction version in one assertion was raised to 8) and review-discussion (18 of 18). Build clean. The follow preparation trial in real windows on Windows: 69 of 69 checks, with a new check that the removed line and its class are absent during a run. The profile trial needs xdotool and ImageMagick and runs only in `linux-verify`'s Xvfb job; locally it stops in its preflight. Not run: the broad loop, provider, host and presentation groups (nothing in them reaches the changed code beyond the files above); the reviewer's turn with the new judging rule, whose output is untested.

**Not established.** Anything with a real provider: whether Claude, Copilot or Cursor give Essentials and Teacher the intended shape under version 8 is open and is the first thing to look at in a real run.
<!-- SECTION:NOTES:END -->
