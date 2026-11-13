---
id: DSP-207
title: >-
  Code walks: every changed line reachable through the walks, and the whole
  enclosing function as the default context
status: In Progress
assignee: []
created_date: '2026-11-13 16:40'
labels:
  - review
  - walks
dependencies: []
ordinal: 126000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas asked for two improvements of code walks (13 November 2026), with no release; he assesses the result first.

1. Coverage gaps. A walk step accepted for an added if-block on new lines 128-130 of a C++ file left the added blank line 131 unmarked: lines counted in the total but covered by no walk place cannot be reached to 100% through the walks. Establish the cause; give adjacent changed blank lines a clear, deterministic owner when they belong to a place's change, shown in its strong marking and exact line count and decided by Accept and delegation exactly as marked (additions and removals, boundaries between nearby places, never across unchanged code, never pulling in other substantive changes, never approving blank lines hidden). Compare the union of the walks' changed lines with every changed line, tell changes with no walk place apart from walk places without a decision, and give a clear path from the walk interface to changes no walk covers, with context and a decision about exactly those lines, reusing the coverage view and existing navigation; also for walks already saved. No hiding: blank lines stay in the denominator, nothing rounds to 100%, nothing is accepted or exempted automatically. DSP-201-203's exact scope holds: marking, Accept and new delegations share one definition; an overlapping hunk never approves the whole hunk or file; unchanged context never counts; navigation decides nothing; overlaps count once; earlier decisions keep their stored lines, started agent jobs their mandates, and manual decisions and agent assessments stay apart.

2. Whole-function context. Walk panes often show a few lines around a change (W3.2 in a C++ file starts at a try block around line 628), so the function's name, signature and documentation are hidden behind repeated 'show 20 more lines'. The default context of the walk's context level becomes the enclosing function or method with its documentation, whole signature (also over several lines), body and end; for long functions the name, signature, documentation, the change and its enclosing control structure are shown from the start with clear folds between; outside functions a declaration, class or configuration section; a plain, honest fallback where the structure cannot be determined. Computed from the right revision so Before, After and Before -> After work when the signature or boundaries changed. Shown context never widens Accept, delegation or coverage; only the place's own changed lines are strong, other changes weak, unchanged code plain; the arrival flash and syntax colours unchanged; the person's view level, expansions, pane sizes and scroll positions kept; saved walks get the better context without regeneration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The cause of the unmarked blank line is established and recorded (reference, scope computation or saved decision)
- [ ] #2 Changed blank lines adjacent to a place's changed lines belong to it by one deterministic rule, shown in its strong marking and line count, and Accept and new delegations cover exactly the marked lines; the rule handles additions, removals and boundaries between places, never crosses unchanged code and never takes substantive changes
- [ ] #3 Changed lines no walk place covers are listed apart from walk places without a decision, reachable from the walk interface with context, and can be accepted or exempted exactly; 100% is reachable through the walk window with no hidden approval, also for saved walks
- [ ] #4 Earlier decisions keep only their stored lines when a place's scope grows; started agent jobs keep their mandates; manual decisions and agent assessments stay apart
- [ ] #5 The walk's context level shows the enclosing function or method with its documentation, whole signature and end by default, computed from the right revision; long functions show name, signature, documentation, the change and its control structure with clear folds; declarations, classes or sections outside functions; an honest fallback without language support
- [ ] #6 More context never changes what Accept, delegation or coverage include; marking strengths, the arrival flash, syntax colours and the person's view choices, expansions, sizes and scroll positions are kept
- [ ] #7 Targeted regression tests and a real-window trial on Windows and on Linux under Xvfb cover both improvements, with screenshots; existing Accept, colour and delegation trials still pass
<!-- AC:END -->
