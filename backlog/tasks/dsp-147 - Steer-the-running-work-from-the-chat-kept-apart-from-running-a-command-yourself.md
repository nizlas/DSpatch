---
id: DSP-147
title: >-
  Steer the running work from the chat, kept apart from running a command
  yourself
status: To Do
assignee: []
created_date: '2026-10-27 14:09'
updated_date: '2026-10-27 16:10'
labels: []
dependencies:
  - DSP-148
priority: low
type: feature
ordinal: 84000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Why this matters

Today a message typed while the agent works has no clear meaning, and a person's own command can run beside the agent's work in the same working copy. Niclas decided on 27 Oct 2026 how both should behave (recorded in [INTERACTION_MODEL.md §3.1](../../docs/INTERACTION_MODEL.md)). This story implements that decision.

### Decided direction (Niclas, 27 Oct 2026)

- A new chat message sent while the agent is working is **steering of that same work**, delivered through the SDK's or runtime's own support for adding input to a running session. It does not start a competing run.
- **Separate manual command execution** (the Run button and anything like it) is clearly distinct from steering. It is not a way of talking to the agent, and a chat message is not a way of starting it.
- **Symmetric lock.** In one working copy, agent work and a separate manual command exclude each other in both directions: whichever starts later waits, or is refused with an understandable reason, until the earlier one has ended.
- The agent's own tool calls and its internal parallelism stay the SDK's business. DSpatch does not serialise or reschedule them.
- The window says truthfully whether a steering message is **waiting for delivery** or **delivered**. It does not claim the agent has read or acted on it without evidence.

### Priority

After the Copilot integration. Not a precondition for the first external tester's trial.

### Current state, for orientation (not verified for this card)

- The Claude adapter sends one message per query (`oneMessagePrompt`). The pinned SDK 0.3.306 types offer `prompt: AsyncIterable<SDKUserMessage>` and `Query.streamInput()`. What they guarantee about when added input reaches the model is not established; read the SDK's code, types and official docs, do not guess.
- The Cursor path's support for steering is not established. The Copilot runtime's support depends on the integration still to be built.
- The working-copy lock today is per command, not per agent turn (DSP-145/DSP-146). The Run button is refused while an agent shell command runs. The agent is not stopped from starting a command while the person's Run command runs; DSP-146 reported this as a loss.

### Bounds

- Use each runtime's own steering mechanism. Where a runtime has none, show the message as waiting and say when it will be delivered (for example when the work ends or is continued). Do not build a DSpatch queue-and-resend mechanism that imitates steering without a decision from Niclas.
- The lock is a DSpatch control at the boundary between agent work and manual commands. Changing that boundary to per-command granularity or into the agent's tool calls needs Niclas's decision.
- Not in scope: content exclusion, remote transport, a message-type switch the user must operate (INTERACTION_MODEL §7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A chat message sent while the agent works is delivered to that same work through the runtime's own steering support and never starts a competing run in the same working copy.
- [ ] #2 Where a runtime cannot deliver into running work, the message is shown as waiting, with when it will be delivered; nothing imitates steering through a DSpatch resend without Niclas's decision.
- [ ] #3 The window shows each steering message as waiting for delivery or delivered, and never claims the agent read or acted on it without evidence; the message and its delivery are saved with the work.
- [ ] #4 Running a separate manual command is a distinct control from steering, and the window does not present one as the other.
- [ ] #5 In one working copy, agent work and a separate manual command exclude each other in both directions: the later start waits or is refused with an understandable reason until the earlier has ended, including after a cancel whose end is unconfirmed.
- [ ] #6 The agent's own tool calls and internal parallelism are left to the SDK; DSpatch adds no serialisation of them.
- [ ] #7 What each supported runtime offers for steering is established from its code, types and official docs, and stated per runtime; anything not established is called unknown.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Created 27 Oct 2026 on Niclas's explicit decision; implementation not started.

Existing cards checked:
- DSP-32 "Add an instruction while the loop is working": loop-only, and takes the instruction up "at the next safe handover". This story covers the chat and the loop step that is running, and delivers steering into the running work through the runtime's support. A note on DSP-32 records the overlap; DSP-32 is not rewritten.
- DSP-53 "Keep the composer usable while a loop is running": a precondition for sending during a loop, not for steering itself. A note on DSP-53 points here.
- DSP-120: a DSpatch-started command left running after a session change. Related to the lock, separate scope.
- DSP-146: reported the one-directional per-command lock as a loss. This story replaces it with the decided symmetric lock.

Conflicts with older rules (resolved by the decision, recorded in INTERACTION_MODEL.md §3.1 without rewriting earlier sections):
1. INTERACTION_MODEL §4.3 says a question during work "does not automatically pause, steer or restart the work" and is answered from available context. Under the decision, every message sent during agent work goes to that work. Reading adopted: the agent receiving it interprets intent (§3). A question is still answered, and it changes the direction only if the agent takes it as an instruction. DSpatch does not answer it separately on the agent's behalf. If Niclas wants a separate answer path for questions during work, that is a new decision.
2. DSP-32 AC #1 and INTERACTION_MODEL §4.4 assume delivery at a handover or on continuation. The decision adds delivery into the running work where the runtime supports it. Handover delivery remains the fallback where it does not.
3. The DSP-145/146 per-command, one-directional lock is narrower than the decided symmetric lock between agent work and manual commands.

27 Oct 2026: the priority "after the Copilot integration" means after DSP-148. DSP-147 also needs DSP-148 to establish what the Copilot runtime offers for steering (AC #7). It does not block the first external user trial.
<!-- SECTION:NOTES:END -->
