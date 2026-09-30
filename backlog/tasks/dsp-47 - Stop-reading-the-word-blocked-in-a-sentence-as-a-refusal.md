---
id: DSP-47
title: Stop reading the word "blocked" in a sentence as a refusal
status: Review
assignee: []
created_date: '2026-09-18 18:15'
updated_date: '2026-09-18 16:43'
labels: []
dependencies:
  - DSP-43
priority: high
type: bug
ordinal: 15591
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### What happens

`productFromAssistantText` matches `/\bBLOCKED\b/i` anywhere in the agent's reply, and a declared failure is computed before the measured branch and wins over it. With a word boundary and no case sensitivity, that is the ordinary English word.

So an agent that did the work, read the project and reported a finding is routed to the `stopped` ending, whose own purpose sentence reads *"The agent reported that the premise was wrong or that it was blocked, so the work was not done and nothing was checked."* Measured on three plausible C++ review sentences, all three end at `stopped`:

- *"The render thread is **blocked** on a mutex held by the loader — that is the first defect."*
- *"Nothing is **Blocked** and nothing failed; the repository is visible and has three defects."*
- *"The build is not **blocked**."*

The reply itself still reaches the conversation, so the finding is not lost. The ending contradicts it.

### Why it is urgent now rather than whenever

The code is old and the defect is pre-existing. **What changed is how reachable it is.** Before DSP-43 a read-only mandate was refused before an agent was called. Now a read-only mandate is the primary use, its whole product is English prose about the project, and the projects DSpatch is pointed at are C++ — where *blocked* is a term of art for threads, mutexes, sockets and queues.

This is the likeliest single thing to make the next trial produce a confusing result and read as the agent refusing.

### The shape of the fix

`chatPromptFor` asks the agent to *"reply BLOCKED and a sentence"*. The contract is therefore about how the reply opens, not about whether a token appears in it somewhere. An anchored match — the start of the reply, or its whole first line — is closer to what was asked for than a search of the whole text. The same applies to `SPEC_ERROR`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An agent that did the work and mentions being blocked, or not blocked, in the course of describing what it found is not recorded as having refused the task.
- [ ] #2 An agent that means to declare it is blocked, in the form the prompt asks for, still routes exactly as it does today.
- [ ] #3 The same distinction holds for a specification error.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in run `20260918-171500-shape`, call 004. `declaredFailureFrom` lives in `loop-chat.ts` beside `chatPromptFor`, so the sentence DSpatch sends and the sentence it reads back cannot drift apart. The rule: the reply's first non-blank line, leading whitespace and markdown emphasis stripped, must begin with the exact upper-case token followed by end of line or a non-word character.

A code fence or a blockquote does not declare, because the likeliest fenced reply is one quoting the instruction back. Case is what separates the term of art from the token.

**The asymmetry is deliberate.** A missed declaration continues to the measured branch and ends at `nothing-changed`, where the reply is the result and reaches the conversation whole. A false declaration ends at `stopped` and tells the user the work was not done. The cheap error is the one kept.

**Residual, stated rather than hidden:** a reply that opens with the literal all-caps word BLOCKED in prose still declares. Closing that needs the contract to ask for more than a word, which is a change to what DSpatch asks every agent.

Evidence: 66-reply sweep across both tokens, three casings and eleven positions with zero invariant violations; 294 paragraphs of this repository's own prose about blocking, where the old predicate declared on 21 and the new one on 0; and the three measured C++ sentences reaching `nothing-changed` end to end with no command spawned, against declarations still reaching `stopped` on the same edges as before.

**The negative control caught the implementer's own error.** It asserted the old predicate would have taken 8 of 10 trap strings. It took 9: `/\bSPEC_ERROR\b/i` also read the ordinary lowercase identifier `spec_error` in a C++ file as a declared failure. So the defect was never only about the word blocked.
<!-- SECTION:NOTES:END -->

## Verification (call 006)

<!-- SECTION:NOTES:BEGIN -->
Verified on `candidate-6`, `sha256:c6d49c18…f70aef`, confirmed at both ends with two negative controls. 647 tests / 92 suites / 0 fail; typecheck 0. Test **names** compared against the delivery, 739 each side, 0 differences either direction — so nothing was deleted, renamed or loosened.

All three criteria **PASS**, measured end to end on the real graph rather than read. The three C++ review sentences that ended at `stopped` in call 003 now all reach `nothing-changed` with zero commands spawned, and four real declaration forms still stop on the same edges they always did.

The verifier then attacked from a fourth direction the fix had not been tried against — headings, tool calls, non-English replies, real provider formatting — with 29 cases: **1 false declare, against 10 for the old predicate on the same table.** Nine misses, all in the cheap direction where the run finishes and the reply is the result.

**The residual is wider than this card states.** `declaredFailureFrom` strips `^[*_\s]+` as markdown emphasis, and a `*` bullet is indistinguishable from emphasis, so `* BLOCKED THREADS are the first defect I found.` declares. A bulleted list of findings is common provider output. Still needs the word capitalised, so not rated likely; recorded so it is not rediscovered.
<!-- SECTION:NOTES:END -->
