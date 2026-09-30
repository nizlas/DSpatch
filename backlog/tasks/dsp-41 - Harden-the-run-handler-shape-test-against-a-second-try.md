---
id: DSP-41
title: Harden the run handler shape test against a second try
status: To Do
assignee: []
created_date: '2026-09-18 09:40'
labels: []
dependencies:
  - DSP-38
priority: low
type: chore
ordinal: 15570
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The DSP-38 regression test reads main.ts and requires the gap between claiming the loop control and the try that releases it to be empty. Call 013 extracted the shipped reader verbatim and attacked it five ways. Comments, template literals, braces inside strings and a reformatted refusal branch are all handled safely, three of them by failing loudly.

One edit fools it. A non-releasing inner try and catch placed before the real one makes the reader match the wrong try and report an empty gap, while a statement after it sits outside the block that releases the claim.

Today the code is fine: both handlers matched try really does release the control. But a source shape test that can be fooled is worse than none, because it is trusted, and this one is now trusted by two reports.

The hardening is one assertion: that a finally calling endRun follows the matched try, with no intervening try.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A non-releasing try placed before the real one fails the shape test rather than passing it.
<!-- AC:END -->
