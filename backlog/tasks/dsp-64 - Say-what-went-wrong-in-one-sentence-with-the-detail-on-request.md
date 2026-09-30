---
id: DSP-64
title: 'Say what went wrong in one sentence, with the detail on request'
status: Review
assignee: []
created_date: '2026-09-19 16:01'
updated_date: '2026-09-19 17:24'
labels: []
dependencies:
  - DSP-60
priority: high
type: feature
ordinal: 15621
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL v1.3 section 9 asks for diagnostics to live behind details rather than above the conversation, and Niclas asked for this directly after meeting a refusal whose message was correct but did not say what to do. An error a person meets in normal use should be a short, understandable sentence saying what happened and what they can do, with the technical detail - paths, identifiers, provider codes, stack text - available on request rather than in their face. This is presentation, not a change to what the errors mean: the honesty rules in section 5 still hold, an unknown stays unknown, and a refusal must not become vaguer in the name of being shorter. The failure to design against is an error that is either too short to act on or too long to read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An error met in normal use reads as a short sentence saying what happened and what can be done.
- [ ] #2 The technical detail behind it is available on request rather than shown by default.
- [ ] #3 No error becomes less accurate or less honest in being shortened.
<!-- AC:END -->
