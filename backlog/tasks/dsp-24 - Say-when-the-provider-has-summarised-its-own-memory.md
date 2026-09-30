---
id: DSP-24
title: Say when the provider has summarised its own memory
status: To Do
assignee: []
created_date: '2026-09-15 22:51'
labels: []
dependencies:
  - DSP-17
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this exists

[DSP-17](dsp-17%20-%20Establish-what-happens-when-a-sessions-context-fills.md) measured what happens when a provider session's context fills, and the answer was reassuring in every respect but one.

A Cursor SDK session **compacts**. It does not fail and it does not visibly degrade: on `claude-haiku-4-5` through SDK 1.0.31, input tokens fell from 188,021 to 19,457 in a single turn and the session carried on answering correctly. A second independent session reproduced it within 22 tokens. Nothing needs recovering, nothing needs restarting, and DSpatch's own record on disk is unaffected because it is written from what DSpatch saw rather than from the provider's memory.

**What is wrong is a claim DSpatch makes silently.** After compaction the window still shows the whole conversation, while the model now holds roughly 2,500 tokens of summary of it. That is exactly the distinction DSP-4 was careful about — a visible old chat is not evidence the model received it — and DSpatch currently has no way to say it happened.

### Why the detection has to be this crude

Because everything better was measured and found silent. Nothing on `run.stream()` marks the compacting turn; its message kinds are identical to every other turn. Nothing on `onDelta` marks it either, and the SDK's own `summary-started` and `summary-completed` update types **exist in the typings and never fired once** across 38 measured turns. `run.conversation()` cannot help: it returns only the current turn, before and after.

The per-turn token count is the whole signal. Latency is not usable — the turn *before* the real compaction took 11.3 seconds against a median of 3.6, so it produces false positives.

### Scope

Persist a number DSpatch already receives, watch it for a sharp fall, and say one careful sentence. No new provider surface, no change to the graph, editor, runner or roles.

The wording carries the whole risk. It must say the provider **appears to** have summarised, because a token count is evidence and not an announcement. A sentence that overclaimed here would be worse than no sentence — it would be the product asserting something about the model's memory that it cannot actually see.

### The decision that comes first

Whether the sentence is worth its false-positive risk is Niclas's call, and this task should not start before he has made it. It is a disclosure, not a defect, and the behaviour it describes is the provider doing its job well.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 DSpatch persists the per-turn input token count it already receives, so a sharp fall between turns of the same session can be detected after a restart and not only while the window is open.
- [ ] #2 When such a fall is detected, the conversation says once, at that point, that the provider APPEARS to have replaced its memory of the earlier conversation with a summary, that DSpatch's own record above is complete and the model's is not. The wording never states it as established: the signal is a token count, not an announcement.
- [ ] #3 Latency is not used as a signal. It was measured producing a false positive on the turn before a real compaction.
- [ ] #4 Nothing is built on the SDK's summary-started or summary-completed events until they have actually been observed firing. They are typed and were silent across 38 measured turns.
- [ ] #5 The recap path is not reused for this. It exists for a session that cannot be resumed, and pushing a recap into a session that has just summarised itself would pay to restore context the model already holds in condensed form.
<!-- AC:END -->
