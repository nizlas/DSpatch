---
id: DSP-137
title: resume-choice scroll check fails intermittently
status: To Do
assignee: []
created_date: '2026-10-26 22:27'
labels: []
dependencies: []
ordinal: 74000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in run 20261026-230000-host-review (Verifier 008, Implementer 010). The resume-choice refused scenario exits 88 intermittently with 'the conversation does not scroll even at 700 px ({"scrollHeightPx":311,"clientHeightPx":311})' and 'did not actually scroll to its first message'. Measured 5+5 on 26 Oct 2026: base 977a359 0,88,88,88,0; candidate 0,88,88,0,0 - pre-existing, not caused by DSP-136/DSP-132. Probably the measurement is taken before the history has rendered. Make the scenario wait for the rendered history (or the expected content height) before measuring.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 resume-choice refused and failed pass 10 consecutive runs on fresh kits
<!-- AC:END -->
