---
id: DSP-104
title: The prompt promises a stricter machine than the one reading the reply
status: Done
assignee: []
created_date: '2026-09-22 21:42'
updated_date: '2026-09-30 19:35'
labels:
  - loop runtime
dependencies: []
ordinal: 43000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during DSP-102. outcomeInstructions tells a node that has no verdicts to name: 'Do not invent a name: any other name on such a line is read as a result nobody can route.' For a node with no outcomes that is untrue. An invented name is rejected as not allowed, the fallback finds nothing, and the residual fires, so the reply is read as plain success. DSP-91's first walk recorded an implementer inventing RESULT: change and judged it harmless, which it is. What is not harmless is the message describing a machine that does not exist, which is the same class of defect as promising an attachment the message does not carry, and the thing DSP-94 was about.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 What the run actually does with an unrecognised name on a RESULT line is what the message says it does
- [x] #2 The correction is made where the sentence is built, so the node panel and the prompt cannot disagree
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented as a focused instruction correction; the routing was not touched. The sentence sent to a node with no verdicts read that any other name on a RESULT line is read as a result nobody can route. Nothing reads it as anything: declaredOutcomeFrom refuses a name the node does not declare, a node declaring none can state no whenUndeclared, and the reply falls through to plain success. It now says the name is not read as a result at all, that the run takes the step to have finished and carries on exactly as for a reply with no such line, so writing one tells the run nothing. The test asserts both halves together, that the prompt says this and that productFromAssistantText returns the same product for an invented name as for no line, while a name the node does declare is still read as that declared failure; productFromAssistantText was exported for it, because a test that could see only one side is how the disagreement survived. Both branches now come from one function, resultLineSentence, and the node inspection shows the string it returns rather than an account of it. That found a live instance of the same defect: briefParts still told a person the message says a missing or contradictory name is read as a result it could not establish, wording DSP-103 had removed from the prompt hours earlier. A separately written description had outlived what it described; it now carries the builder's own sentence and loop-node-help.test.ts asserts every such line appears verbatim in the assembled prompt. Where the behaviour is defined: the sentence is Maestro's general execution rules in the prompt builder, which variant is sent is node configuration, and where a plain success goes is graph connections. No role text changed. Coordinator re-ran the whole suite, 49 files, exit 0. Deterministic tests only; the panel's rendering is unverified and is Niclas's to accept.
<!-- SECTION:NOTES:END -->
