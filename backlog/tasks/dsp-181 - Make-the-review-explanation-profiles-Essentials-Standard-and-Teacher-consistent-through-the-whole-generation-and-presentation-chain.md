---
id: DSP-181
title: >-
  Make the review explanation profiles Essentials, Standard and Teacher
  consistent through the whole generation and presentation chain
status: Review
assignee: []
created_date: '2026-11-08 17:15'
updated_date: '2026-11-08 18:20'
labels:
  - ux
  - review
dependencies:
  - DSP-176
  - DSP-179
  - DSP-180
priority: high
type: enhancement
ordinal: 100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 8 November 2026. In real use the Essens profile came out markedly wordier than Original, in brand-new reviews with freshly generated explanations too, so it is not only cached answers; formatting has also differed between profiles. Review the whole chain for review explanations (shared instructions, role instructions, history, profile instructions, the answer contract and the rendering) and fix contradictions rather than adding another 'write shorter' instruction on top.

Public profiles: Swedish Essens, Standard, Pedagog; English Essentials, Standard, Teacher; names and descriptions follow the application's UI language, with stable internal identities. Standard is the default when no earlier active choice exists; saved choices of Essens and Pedagog are respected. Original becomes a legacy presentation hidden from the ordinary chooser; older explanations stay viewable for comparison, nothing is renamed silently and no saved alternative or discussion is deleted.

All profiles rest on the same facts and review scope: the profile never changes facts, code references, findings, decisions or coverage. The base text before Show more is understandable and factually sufficient on its own: it names the concrete functions, settings or parts, says what changes and the main consequence, states relevant defaults, and keeps decisive conditions, fallbacks and uncertainties. Brevity never replaces concrete names with vague phrases. A step's presentation is not a new broad review and does not retell the whole discussion.

Essentials picks the core precisely, keeps names, defaults and the main behaviour, drops mechanical intermediate steps. Standard gives a straight technical explanation for a developer of ordinary experience, explaining how the central parts connect. Teacher builds the prerequisite knowledge the step needs, explains unfamiliar tools or concepts, builds the reasoning stepwise with an example or analogy when it helps, then connects to the concrete code, without general lessons. Length is a guideline (about 2, 5 and 10 sentences for a normal step), not a quota, a cap, an ordering requirement or a reason to pad; no mechanical truncation, no hidden caveats, no extra model calls to chase a word count.

Show more holds complementary mechanics, special cases, longer evidence and more code references, never repeats the base text, keeps the profile's manner and readable paragraphs and lists. Tell me more deepens from what is shown without restarting. Explain more simply reduces conceptual complexity rather than adding detail, per profile; repeated presses take earlier attempts into account and choose another approach; follow-up questions keep the reached level. All profiles share one readable typography everywhere (Step and Discussion, docked and floating); the profile steers content and manner, not CSS or density. Zoom, text selection and Ask, scroll following and window layout keep working.

Every generation path is traced for its effective prompt and answer handling: a new walk with a profile chosen before generation, a profile change in an existing walk, navigation-triggered generation, explicit regeneration, Show more and Tell me more, Explain more simply including repeats, and follow-ups. Decided behaviours stay: saved profile choice, the ~500 ms navigation delay, latest-step-wins, late answers, cache and explicit retry; opening alone starts no model call. New profile instructions and results are versioned; older alternatives stay viewable and can be regenerated explicitly without destroying history or origin.

Verification uses neutral, invented examples only: a trivial change, a normal change with a default and a fallback, a complex change spanning several code places, and a step where Teacher must explain a tool unfamiliar to the reader. Tests and window trials run in an isolated profile with the simulated provider and no real model; simulated answers verify the interface, prompt transfer and data flow, not a real model's pedagogical quality, which Niclas judges on real code. No project-specific names, code or descriptions from Niclas's work code enter the repository. Delivery: implement and commit locally; no push, release or Windows installer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Public profiles are Essens/Standard/Pedagog in Swedish and Essentials/Standard/Teacher in English, following the UI language over stable internal identities; Standard is the default without an earlier choice, and saved Essens and Pedagog choices are kept
- [x] #2 Original is a legacy presentation hidden from the ordinary chooser; older Original explanations remain viewable for comparison, nothing is renamed silently and no saved alternative or discussion is deleted
- [x] #3 One shared presentation policy reaches every generation path (new walk, profile change, navigation-triggered generation, explicit regeneration, Show more, Tell me more, Explain more simply with repeats, follow-ups) and the contradictions found in the chain are fixed, not papered over
- [x] #4 The base text before Show more names the concrete parts, says what changes and its main consequence, states relevant defaults and keeps decisive conditions, fallbacks and uncertainties; Show more and Tell me more hold deepening only and do not repeat the base; material meant as deepening lands behind the control
- [x] #5 Essentials, Standard and Teacher differ in selection and manner as specified, with length as a guideline and no truncation, padding or extra model calls; the profile changes no fact, code reference, finding, decision or coverage
- [x] #6 Explain more simply reduces conceptual complexity per profile, repeated presses take earlier attempts into account, and follow-up answers keep the reached level
- [x] #7 All profiles render the same Markdown with the same typography in Step and Discussion, docked and floating; zoom, selection and Ask, scroll following and window layout keep working
- [x] #8 Saved profile choice, the ~500 ms navigation delay, latest-step-wins, late answers, cache and explicit retry are preserved; opening alone starts no model call; new instructions and results are versioned and older alternatives can be regenerated explicitly
- [ ] #9 Tests with neutral examples (trivial, normal with default and fallback, complex across several places, Teacher explaining an unfamiliar tool) and window trials in an isolated profile with the simulated provider are run, with what they prove and do not prove stated
- [x] #10 A profile chosen before the walks are prepared is written into every step's explanation by the ordinary walk generation, with its deepening behind Show more; opening and navigating that walk in its profile asks for nothing; the profile changes how the steps are explained and nothing else, so the overview, walk and step titles, places and coverage are the same whatever the profile
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Read the governing documents and the presentation code. 2. Trace each generation path's effective prompt and answer handling. 3. Design the shared policy and the profile roles. 4. Implement profiles, names, language and legacy Original. 5. Implement the answer contract, Show more and rendering. 6. Fix Explain more simply and follow-ups. 7. Tests with neutral examples; window trials with the simulated provider. 8. Docs, backlog, local commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 8 November 2026 on Windows, main checkout at 32030e3 (0.1.9). Current focus: reading the governing documents and tracing the generation chain.

8 November 2026, Windows home computer, main at 32030e3 (0.1.9); Linux not run.

Governing decisions read and followed: VISION.md 3.4 (teaching modes and review depth are separate choices; a walk or an explanation is never an approval; the agent-generated walks decision; the DSP-176 trial arrangement, revised by Niclas's decision of 8 November 2026 recorded below it), AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 2 (every instruction DSpatch adds is visible and inspectable) and section 5 (review through the shared agent connection, findings never advance anything), REVIEW_COVERAGE_AND_CODE_WALKS.md section 5 (depth and learning apart), the code-walks plan sections 2 and 3 (what a base explanation holds; Tell me more, Explain more simply and Explain this; a simpler explanation does not change the review's level). No control boundary, permission or division of responsibility changes: presentation instructions, answer contract and rendering only.

Causes and contradictions found in the chain:
1. Essens's first-part rules mandated three answers in order ("What changes? Why does it matter? What does the reader need…") with a 60–100 word budget, while the prepared summary is one or two sentences; with "do not cut an important fact… keep the needed caveat" the base text grew, in new reviews too.
2. Three descriptions of the short part in one prompt: the profile's rules, PRESENTATION_COMMON_RULES and ANSWER_SHAPE_RULES ("the concept and the details that matter most, enough to understand it without reading further"), the widest one last.
3. "Then the line that starts Show more, as the answer format below says" contradicted the format, whose line holds only the marker; a literal Show more line renders as text, so the deepening lands before the control.
4. The envelope hands over the whole prepared explanation and the code and asks to present the step again: a rewrite over rich material, anchored to the prepared scale only by a rule the three-part mandate contradicted.
5. Two wordings of the same contract: the walk generator's WRITING_RULES and DETAILS_RULES (review-agent.ts) and the discussion's; the prepared explanation is three rendered blocks (summary, body, why), an alternative one answer with Show more.
6. Explain more simply in three wordings: SIMPLER_RULES (fewer concepts, no added detail) against followUpWords for selections and deepenQuestion for points, which asked for "more background" and a concrete example, i.e. more detail.
7. The discussion prompt named no answer language, unlike the walk, step and selection prompts; the envelope knew it.
8. Profile names hard-coded in English with Swedish words shown in the English UI; the default fell back to Original.
9. A follow-up with a profile and nothing shown said "the explanation below" with nothing below.
10. Tell me more in a profile went through the follow-up section, which never said "do not restart with the base".
11. The alternative was rendered inside .rv-explanation (paragraphs white-space: pre-line, for prepared text with hard line breaks); the Discussion tab rendered the same answer with its own margins, list, code and table rules.

The model (presentation-profiles.ts, instruction version 3): stable ids essens | standard | pedagog in public and original as legacy; names and descriptions per UI language in review-i18n.ts (Essens/Standard/Pedagog, Essentials/Standard/Teacher), English names in prompts. Standard is the default when no public choice is stored (walk, state, computer); essens and pedagog are kept; a stored original is no choice and is not rewritten. One policy: SAME_FACTS_RULES, GROUNDING_RULES (concrete names, what changes and its consequence, defaults, decisive conditions/fallbacks/uncertainties, not a new broad review), the details contract in one wording (SHORT_PART_RULE and DETAILS_PART_RULE, reused by ANSWER_SHAPE_RULES; the marker is named once per prompt and the agent is told not to write "Show more"), LENGTH_GUIDELINE_RULES (two, five, ten sentences for a normal step, with what it is not), DEEPENING_RULES; per profile a manner, a guideline and a simpler rule. Modes: present (How to present (Essentials)), more (Going deeper, from the last shown explanation, no restart), simpler (attempt N, profile, the profile's simpler rule, another way in when pressed again, a directed question allowed), follow (the level kept; with nothing shown only the reader's profile). The Review header carries the answer language. The walk generator's WRITING_RULES reuse the grounding rules and its DETAILS_RULES the deepening wording; its simpler wording for selections and points no longer asks for more background. Rendering: one rv-reading typography block in review.css for prepared text, alternatives, deepenings and discussion answers; pre-line only for the prepared text (rv-prepared); the surface-specific Markdown rules are removed. splitDetails also reads a line that is only Show more / Visa mer (heading or bold allowed) as the marker. Original is hidden from the chooser; "Show the original explanation (Original)" per step; an alternative written under an older instruction version is said so with Regenerate. The simulated provider answers the three profiles in their shapes over one neutral example (a greeting function with a default) and answers a step titled trivial in one sentence in every profile.

Verification, Windows: typecheck clean. Review group 266 of 267 passed: the one failure is review-context.test.ts line 352, which compares a path joined with Windows backslashes against a read recorded with forward slashes, fails on Windows at HEAD too and is untouched by this change. Presentation group 317 passed. New tests: presentation-profiles.test.ts (names per language, the default and saved choices, one policy per mode with the grounding, manner and guideline said once, no three-part mandate or word budget, the answer format in the policy's words, simpler per profile and when repeated, Tell me more, follow-ups with and without something shown, the window's instruction text, requests and legacy records, what the walk shows); presentation-chain.test.ts (the four neutral examples through buildEnvelopePrompt, the simulated provider, splitCodeAnswer and splitDetails: a normal change with a default and a fallback names them in every profile with the deepening behind the marker and the references read, Essentials about two sentences, Standard about five, Teacher about ten with the prerequisite before the code; a trivial change short in every profile with nothing behind Show more; a complex change with three places in the prompt apart by file and revision; a Teacher step about an unfamiliar tool asked for the prerequisite); review-reading-style.test.ts (the shared typography block covers paragraphs, lists, nested lists, headings, inline code, code blocks, quotes, tables and links; no surface keeps Markdown rules of its own; every explanation and answer carries rv-reading and only the prepared text rv-prepared). review-discussion-service.test.ts extended with Tell me more in a profile and the language line; review-discussion.test.ts with the tolerant marker. SIMULATED answers verify the interface, the prompt and the data flow, never a real model's pedagogical quality, which Niclas judges on real code.

Not run: the profile window trial (scripts/profile-trial.mjs). This machine has no Xvfb and running it here would use the real desktop; a Linux CI run needs a pushed branch, which this task excludes. The trial's expectations were updated to the new model and its navigation stages to DSP-180's generation on arrival (it had not run since DSP-180 either); the first run may need adjusting.

Remaining limits: real-model quality and the actual lengths are unverified until Niclas reads real reviews; Standard as the default means a new walk asks for each visited step's explanation once it settles (the original explanation shows meanwhile), where Original asked for nothing; the Step tab's action labels (Tell me more, Explain more simply, Show more) stay English in the Swedish window as before, names, descriptions, the chooser and the status line follow the language; a saved Original choice now reads as Standard; thresholds such as the settle delay are DSP-180's.

Correction and extension, 8 November 2026 (later the same day, Windows). The earlier limit "Standard as the default means a new walk asks for each visited step's explanation once it settles" described the alternative path only and is withdrawn: Niclas's requirement is that the profile is chosen before the walks are prepared and that such a walk is read in its profile with no further call.

Where the profile is chosen before generation: in the review's panel, whose chooser (Explanations) now shows before any walk exists (it was hidden while there were none), and in the diff window's agent picker beside the agent and model when Prepare code walks is pressed (`AgentPicker` has an Explanations select; `PairReview` sends `presentation: { profile }` with the walks request). Both read and write the computer's last choice (the storage key the panel uses), so the panel's choice and the picker's are one.

The path: `AgentJobRequestInput.presentation.profile` → the host validates it in `startChecked` and stores `presentation: { profile, version }` on the job → `walksPrompt(material, folder, language, profile)` adds one section, "How to explain the steps (<profile>)" (`walkExplanationSection`), with the grounding rules, the profile's manner, the length guideline and the rule for the step's `details` field, and says explicitly that it decides how the steps are explained and nothing else → `readWalksAnswer` reads each step's `details` → `definitionFrom` writes `presentation: { profile, version }` and the steps' `details` into the definition, and the provenance names the profile → `parseReviewDefinition` reads them (`ReviewDefinition.presentation`, `WalkStep.details`), and `stepContentHash` includes `details`.

Reading without a call: the walk window takes the definition's profile as the walk's own (`walkProfile`); the chooser opens on it unless the person chose otherwise for this walk; `wantsAlternative(walkProfile, profile, done, pending)` is false for the walk's own profile, so navigation asks for nothing; the step's own text is shown with its deepening behind Show more, and the status line says "<Profile> · written with the walk" with an explicit Regenerate. Another profile asks for an alternative on arrival as DSP-180 decided. Tell me more, Explain more simply and a follow-up in the walk's own profile quote the prepared explanation as what was shown. Older walks have no profile: their prepared text is the legacy Original, and every public profile is an alternative, as before.

What stays profile-free: the walk list, walk titles and purposes, step titles and summaries in the left column, the change's summary and background, the places and the coverage. Verified in `presentation-walks.test.ts` with the simulated provider: the same walks, titles, questions, purposes, steps, summaries and places for Essentials, Standard, Teacher and none, only `body` and `details` differ; the walk prompt with a profile equals the plain one once the section is removed (`review-agent-jobs.test.ts`); the definition round-trips the profile and the details, an unknown profile reads as none, the content hash sees the details, the job record keeps the profile; `wantsAlternative` by profile.

Verification, Windows: typecheck clean; review group 273 of 274 passed (the same pre-existing review-context.test.ts path-separator failure); presentation group 317 passed. The profile trial's expectations were updated again (the walks prepared in Standard are read without a call); the trial is still not run.
<!-- SECTION:NOTES:END -->
