---
id: DSP-12
title: Survey smart tools and interaction designs
status: Done
assignee: []
created_date: '2026-09-14 20:13'
updated_date: '2026-09-15 22:42'
labels:
  - ux
milestone: m-1
dependencies:
  - DSP-6
documentation:
  - docs/VISION.md
  - docs/REVIEW_RESEARCH.md
  - BACKLOG.md
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

We need to learn what useful interaction designs already exist before choosing DSpatch's next review features. A list of competitors or a checkmark for "has a diff view" does not explain how a person understands and navigates a change.

### Scope

Conduct a bounded, open survey of current and older development tools, code browsers, debuggers, review/visualisation tools and research prototypes. Look at code/data flow navigation, semantic or intent-based changes, linked views, explanations, revision history and overview-to-detail transitions. Include relevant examples outside AI-first tools and outside IDEs where the interaction offers a useful comparison.

Collect concrete interaction examples from official documentation, demonstrations or bounded hands-on trials. Record the product/version/date, source, task served, interaction sequence, strengths and limitations, and whether the evidence was documented, demonstrated or personally observed. Expensive or inaccessible products can be documented with the limitation visible; do not purchase tools merely to complete the survey.

Search beyond the five seeds and include alternatives that could change our direction. Produce a compact interaction gallery/comparison for DSP-14, not a recommendation that commits us to a product or feature. DSP-13 owns the research synthesis; relevant references may be shared without duplicating the same analysis.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A bounded search scope and dated source record cover relevant existing tools and prototypes, including older or non-AI examples; coverage gaps and access limits are explicit.
- [x] #2 Each selected example shows a concrete interaction sequence through screenshots, a linked demonstration or a clear walkthrough, with version/date and provenance.
- [x] #3 The comparison explains the user problem, useful ideas and limitations, and distinguishes documented or demonstrated capabilities from our own observations.
- [x] #4 The survey includes approaches beyond the five concept seeds and identifies what DSpatch could reuse, adapt or test without unsupported novelty or superiority claims.
- [x] #5 A concise handoff to DSP-14 lists promising patterns, conflicting examples and unresolved questions.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Survey delivered 15 September 2026 by Researcher call 005 of run `20260915-174013-p6qd`. The deliverable is [docs/research/dsp-12-interaction-survey.md](../../docs/research/dsp-12-interaction-survey.md); the call report is `reports/005-researcher-dsp12-survey.md` in that run. Criteria are left unticked for the Reviewer.

Sixteen examples across six categories, exceeding the assignment's floors: twelve are non-AI, ten predate 2015, and six carry a limitation, negative result or abandonment. The bound was respected — Light Table was identified as a seventeenth strong candidate and left out with a pointer rather than added.

Three findings shape what DSP-14 should argue about:

- **Seed 4 is the real gap.** Nothing found visually separates a predicted risk from a measured result. SeeSoft came closest in 1992 by colouring lines with measured statistics including test results. Phase 0 already holds the matching substrate: a test pass bound to a revision that demotes itself when the code changes, which Niclas confirmed working on 15 September.
- **Seed 3 already ships, unevaluated.** CodeRabbit posts a generated walkthrough with a Mermaid sequence diagram on every pull request, on by default, and no controlled evidence was found that this improves comprehension.
- **Seed 5's minimap framing is the weakest.** The stronger prior arts are Ardour's Summary pane, where a draggable, resizable viewport rectangle is both the overview and the navigation control, and Mylyn's degree-of-interest filtering, which abolishes the miniature instead. They contradict each other, which is the useful part.

**Known weakness against AC#3: no example is personally observed** — 14 documented, 2 demonstrated, 0 observed. The Researcher is a read-only role with no shell, so not even the local `git` options could be exercised. The survey states this in its own evidence section rather than hiding it. It is cheaply fixed later by running `git diff --color-moved` and `git range-diff` on two real DSpatch revisions and `difft` on one changed TypeScript file, which would convert three entries to observed. Not a blocker for DSP-14.

Three claims are marked unverified in the survey and must not be repeated as established: Word's Simple Markup being the Windows default, Sublime Text's minimap origin, and Difftastic's current release number.

One claim was withdrawn on first reading. The survey stated that Niclas already knew Ardour's Summary pane, inferred from his project being a DAW spike rather than from anything he said; he queried it immediately. Both passages are corrected in place so the mistake stays visible, and the Researcher role now states that what Niclas knows or prefers is evidence only where he said it or we watched him.

Asking him produced a better fact than the inference had, and he then invited us to read the code. His MIDI summary turns out to be the *other* family: `paintMidiClipNotePreview` draws one bar per note inside each clip rectangle on the arrangement row, a miniature rendered in place, which is what SeeSoft did with source lines. There is no separate overview widget and no viewport rectangle, so the Ardour analogy would not land. Read in `MiniDAWLab` at `1aa7d27`, confirmed in `MiniDAWLab-spike01` at `b87f042`.

Two properties of his own code are worth more to DSP-14 than the analogy was: `zoomAroundSample` keeps the sample under the pointer anchored while the scale changes, which is a defence against losing your place that he uses daily; and the note preview scales pitch per clip, so small content stays legible rather than collapsing. The second raises a real question for a change overview — whether a two-line change in a small file should look like a two-line change in a large one. His answer in the DAW was no.

A delivery defect surfaced here and was fixed rather than worked around. The handoff told a read-only role to write two files it has no permission to create, so neither the survey nor the report reached disk; the coordinator recovered both verbatim from the Researcher's own transcript. `docs/loop/HANDOFF.md` now states the report-delivery rule separately for writing and read-only roles.
<!-- SECTION:NOTES:END -->
