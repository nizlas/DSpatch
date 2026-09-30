---
id: DSP-60
title: Give the conversation the main space and move the chrome out of it
status: Review
assignee: []
created_date: '2026-09-19 13:50'
updated_date: '2026-09-19 17:24'
labels: []
dependencies:
  - DSP-27
priority: high
type: feature
ordinal: 15617
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
INTERACTION_MODEL v1.3 section 9, from trying the packaged window against the Cursor reference. The large project, model and connection summary card goes: it takes the space the conversation should have and explains things a person needs once rather than continuously. Session details, internal identifiers, full paths and diagnostics move behind a conventional top application menu, as in the Cursor menu bar; exact grouping is an implementation choice. Long explanations of session restoration, provider mechanics or how a result was verified do not belong above the conversation, though they stay available as details. Model selection moves beside the message composer and must make clear which work a selection affects. Two things must survive the tidying: project identity and access stay compact and reachable rather than waiting for a left explorer to be built first, and a real connection problem affecting work stays visible and understandable in context even though ordinary connection detail moves into details. This supersedes part of DSP-27, which introduced the summary strip as an improvement at the time.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The large project/model/connection card is gone and the conversation has the main space.
- [ ] #2 Session details, identifiers, full paths and diagnostics are reachable from a top application menu.
- [ ] #3 Model selection sits beside the composer and says which work it affects.
- [ ] #4 Project identity and access remain compact and reachable without requiring a left explorer first.
- [ ] #5 A connection problem that actually affects work stays visible in context.
<!-- AC:END -->
