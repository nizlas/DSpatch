---
id: DSP-147
title: >-
  Steer the running work from the chat, kept apart from running a command
  yourself
status: Review
assignee: []
created_date: '2026-10-27 14:09'
updated_date: '2026-10-28 18:20'
labels: []
dependencies: []
priority: high
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

Before the Copilot integration (DSP-148): Niclas prioritised this story explicitly on 28 Oct 2026, replacing the earlier "after the Copilot integration". Not a precondition for the first external tester's trial.

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
- [x] #2 Where a runtime cannot deliver into running work, the message is shown as waiting, with when it will be delivered; nothing imitates steering through a DSpatch resend without Niclas's decision.
- [x] #3 The window shows each steering message as waiting for delivery or delivered, and never claims the agent read or acted on it without evidence; the message and its delivery are saved with the work.
- [x] #4 Running a separate manual command is a distinct control from steering, and the window does not present one as the other.
- [x] #5 In one working copy, agent work and a separate manual command exclude each other in both directions: the later start waits or is refused with an understandable reason until the earlier has ended, including after a cancel whose end is unconfirmed.
- [x] #6 The agent's own tool calls and internal parallelism are left to the SDK; DSpatch adds no serialisation of them.
- [x] #7 What each supported runtime offers for steering is established from its code, types and official docs, and stated per runtime; anything not established is called unknown.
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

28 Oct 2026: Niclas explicitly prioritised DSP-147 before the Copilot integration (DSP-148); the earlier dependency on DSP-148 and the priority "after the Copilot integration" are withdrawn. Copilot's steering support stays unknown until DSP-148 establishes it (AC #7). Current focus: SDK steering for Claude (Query.streamInput) and Cursor (Run.steer), steering of a running chat turn and loop node, the symmetric lock with manual Run, and the loop start prompt left in the composer (observed in Niclas's manual trial: a typed 'avbryt' during a loop was not a Stop press; the node ran to its end and the loop stopped before the next node).

28 Oct 2026, implemented (local commit, not pushed). Governing decisions: INTERACTION_MODEL.md §3 (received is not delivered), §3.1 (steering, the symmetric lock), §4.4 and §4.5 (Pause, Stop); AGENT_BEHAVIOUR_AND_ORCHESTRATION.md §2 (the task and its constraints survive handoffs). No departure from them is known.

What each runtime offers (AC #7, from the installed code, types and official docs; nothing here was tried live):
- **Claude Agent SDK 0.3.306:** `Query.streamInput()` writes a user message into the running query (streaming input mode). The type docs of `SDKResultMessage.user_message_uuids` say a queued user message is "folded into the running turn between tool rounds", or runs as a following turn of the same query; the result lists the uuids each turn consumed. DSpatch sends the message with a uuid. It reports `accepted` when the SDK has written it to Claude Code, and `delivered` only when a result lists that uuid. The run stays open while an accepted message is pending, so a following turn stays inside the same run. A message no result lists is `unconfirmed` and is never resent: the official TypeScript reference warns that resending a message Claude Code holds delivers it twice. Whether and when the model reads the message mid-turn is not established. The `priority` field (now/next/later) is undocumented, so it is not set.
- **Cursor SDK 1.0.31:** `Run.steer(text)` answers `complete_delivered` (the turn has it) or `revert_to_followup` (send it as an ordinary follow-up). In the installed code, a cloud run always answers the second, and a local run does so after a 15 s acknowledgement timeout. `steer` is optional on `Run`. Implemented; not tried, because the account is closed.
- **Copilot:** unknown until DSP-148.
- **Presentation adapter:** SIMULATED steering shaped like Claude's, for scripted trials only.

What was built:
- `AgentAdapter.steer` in both real adapters and the presentation adapter.
- The chat's Steering route: `chat.steerTurn`, with the message saved on its turn (`StoredMessage.steering`).
- The loop: `loop.addInstruction` offers the message to the working step through the executor's `onSteerableStep`. It falls back to the next step (DSP-32's queue) when the runtime never took it.
- Later steps are briefed with every message the run has sent to the work (`earlierInstructionsContext`), so a verifier judges against the updated task. The run record's ending note keeps what became of each steering message.
- In chat, a message the running turn could not take waits for the end of that turn. If the turn finished, it then goes in as the next message through the window's ordinary send. If the turn was stopped or failed, it is not sent.
- The window: a discreet **Steering** button, shown only while work runs (Enter does the same). Each message carries one line: waiting, sent, delivered, not confirmed, or not delivered.
- The symmetric working-copy lock (`working-copy-lock.ts`) between agent work (a chat turn, a chat-loop run) and the Run command, for folders that overlap. A turn whose cancel ended unconfirmed holds the lock until its session closes. Steering is part of the work that already holds the lock. The agent's own tool calls are not touched.
- The composer clears only what was sent once a send is accepted. A loop start is accepted at its first journal entry, not when the run ends. A refused or failed start keeps the draft, and text typed after the send stays.

Niclas's manual trial (recorded as observed, not as a Stop fault): the loop's start prompt stayed in the box; "avbryt" typed during a run reached no step until the next one, then the loop stopped before it. With this change the message goes to the working step. The agent interprets it; DSpatch adds no keyword rule.

Verified, SIMULATED provider, through the real window, host and loop. Scripted run `DSPATCH_CHAT_RUN=steering`, isolated userData, real clicks and Enter, passed:
1. The accepted loop start cleared the box.
2. A refused start, beside a running Run command, kept the draft. The host refused both the message and the loop.
3. Text typed during the start stayed.
4. Steering into the working loop step showed "Delivered to "Do what was asked" while it worked".
5. One chat turn and one loop run: no extra turn or run.
6. A message arriving as a step ended went to the next step.
7. The verifier step's prompt carried the message ("Earlier in this run…"), and the steered step's own prompt did not.
8. Waiting and not-confirmed states (unit tests), with no resend.
9. Pause held the run before the next step while the steered step finished. Stop ended the run.
10. Run was refused while the agent worked, and agent work was refused while Run ran, nested folders included.

Also run: the test groups loop, chat, provider, host and presentation; all typechecks (including `typecheck:claude` against the installed SDK); the build; and the presentation scenario.

Not verified: when a real Claude model reads a steering message, and whether Claude Code folds it in mid-turn as its type docs say. That needs a home trial with the existing login. Cursor steering was not tried (closed account), and Copilot is unknown. The editor's own loop run works in a workspace of its own and does not take the lock. A loop step's cancel that ends unconfirmed releases the lock at the end of the run.

28 Oct 2026, cleanup after cd0aaec (local commit, not pushed). This corrects three statements above.

1. **What a delivery means.** For Claude, a uuid in `user_message_uuids` is the SDK's receipt that the query consumed the message. The SDK gives the same receipt when Claude Code folded the message into the running turn and when it ran the message as a following turn. So it does not show that the message changed the step while the step worked. The window now says at most "Delivered" (loop: "Delivered to "Step""). It does not say "read", "applied" or "while it worked", and neither does the run record's ending note.
   - In the conversation, a delivered message has no status line.
   - A waiting message gets one quiet word.
   - Delivery not confirmed, or not delivered, gets a visible line.
   - The full account is in Session details under **Steering**.
   - Persistence and the no-resend rule are unchanged.
2. **Uncertain end of agent work.** This now reuses the attempt ledger's existing rule (DSP-4, DSP-6, DSP-116).
   - **What is recorded:** an unconfirmed stop is an `agent-turn` attempt with an unknown outcome, saved and kept across a restart. For a chat turn the existing code already recorded it. A loop step whose stop ended unconfirmed is now recorded too, unless the adapter's `dispose` then saw its process exit. So is a process `dispose` itself could not see exit (`uncertainLoopWork`). The loop run ending is not counted as the work ending.
   - **What it holds back:** until the person names the attempt, it holds back the next message (existing gate) and the next loop start (host and composer). It also holds back the next Run in the same working copy or a nested one: new, the same rule applied to the agent's attempts.
   - **The way on:** the existing explicit acknowledgement, "Send anyway, leaving … unresolved" for a message, and now "Run anyway, leaving … unresolved" in the Run panel. The attempt then stays on record as unresolved, as before.
   - **The working-copy lock itself** is now released when its run ends. The earlier hold until the session closed had no recovery path of its own.
   - **Unchanged:** process stopping.
3. **The graph editor's run** gives its agents one new `mkdtemp` folder under the system temp folder, as `cwd` and as the only root (`additionalDirectories` / `local.dirs`). It has no other working roots; its results folder is under userData and is not given to the agent. That is not isolation: a workspace or a Run folder that contains the temp folder (or a whole drive) overlaps it. The editor's run now takes the same lock through `runLiveGraph`'s `claimWorkingRoots`, for the folders it actually gives.

Verified, SIMULATED provider (presentation, including a SIMULATED unconfirmed stop), isolated userData, real window, host and loop: `DSPATCH_CHAT_RUN=steering`, all phases passed.
- No line under a delivered message; the quiet waiting line; the Session details account.
- An unconfirmed chat-turn stop: Run disabled with its note; loop start refused by the host; "Run anyway" names it and the command runs.
- An unconfirmed loop-step stop recorded as outcome-unknown after the run ended, and Run held back again.
- An editor run beside a command in the sample project started. One beside a command in the temp folder that contains its run folder was refused by the lock.

Tests: steering, loop-instruction, chat-workspace, workflow-gates; groups chat, host and presentation; loop group with the one structural test adapted. Typechecks pass, including `typecheck:claude`; the build passes.

Not established:
- When a real Claude model reads a steering message, and whether Claude Code folds it in mid-turn (open for the manual home trial; AC #1 stays open).
- How a real Claude Code process behaves after an unconfirmed stop.
- Cursor steering.
- Copilot.
- An editor run whose own stop ends unconfirmed is not recorded, because the editor has no conversation ledger. Its lock is released when its run ends.

28 Oct 2026, the gap after ff3ce19 is closed: a graph editor run whose stop ends unconfirmed (local commit, not pushed).
- **The record.** It is now kept by the same rule as the chat: an `agent-turn` attempt with an unknown outcome in an `AttemptLedger`, with no conversation invented for it. The attempt is stored with the editor run's id and the folders that run gave its agents, in `dspatch-uncertain-work.json` in user data (`UncertainWorkStore`). It is written on change and reconciled on read after a restart, exactly as a conversation's attempts are. As before, the run ending does not count, and a stop that `dispose` saw exit is not recorded.
- **What it holds back.** The chat service treats these entries like another conversation's ledger over an overlapping working copy. So a chat or chat loop whose folders overlap the run's is held back, and so is a Run whose folder contains it. They are held back until the person names the attempt, and stay held back across a restart. The Run panel's list now also covers the folder Run was last asked to use (`needsAcknowledgement.agentWorkForRun`), so "Run anyway" is offered there too. A new editor run is gated the same way for its own folders (`agentWorkGateFor`).
- **The way on.** The existing naming: "Send anyway" or "Run anyway", and from the editor's run path "Run anyway, leaving … unresolved" beside the refusal (`acknowledgedAttemptIds` on the editor run). A named attempt stays unresolved on disk and is not asked about again. Folders that do not overlap are not held back. A confirmed stop leaves no record.
- **Test support.** The Open Project chooser answers from `DSPATCH_PICK_FILE` in a scripted run, as the editor's choosers already did. `DSPATCH_PRESENTATION_UNCONFIRMED_STOP=1` makes the simulated provider's stops unconfirmed. Steering, process stopping and other UI are unchanged.

Verified, SIMULATED provider and isolated userData, `DSPATCH_CHAT_RUN=editor-uncertain`, three processes over one userData, all passed:
1. `first`: an editor run with a confirmed stop left no record, and Run in its folder ran.
2. `again`: an unconfirmed stop was recorded with its folder, and Run there was refused.
3. `retry`: after a restart, Run in an unrelated folder ran. A chat opened on the editor run's folder held its message back, and Run there was disabled with "Run anyway". Naming it ran the command. The held message then went without asking again. The file kept the attempt as `outcome-unknown` with its acknowledgement.

Unit tests (steering.test.ts) cover the same rules, plus the gate a new editor run meets. The steering scenario, the test groups chat, loop and host, and the typechecks also pass.

Not shown in the window: an editor run refused by earlier unconfirmed work. Its fresh folder can only overlap a workspace that contains the temp folder. The gate and its naming are unit-tested, and the editor's button is typechecked only. The real steering trial with Claude stays open (AC #1).

28 Oct 2026, current focus (follow-up from Niclas's manual Claude trial): a message sent with Enter while a loop node worked seemed to take effect only in the next node, and a delivered steering message stayed in a separate box at the bottom instead of in the conversation. Reconstructing the path UI → host → loop → adapter; cause not yet established.
28 Oct 2026, follow-up of Niclas's manual Claude trial (local commit, not pushed). Two observations were reported: a message sent with Enter while a loop node worked seemed to take effect only in the next node, and a delivered steering message stayed in a separate box at the bottom. The old run no longer exists, so the path was reconstructed from the code. The cause of the first observation is not established.

**Delivery: what the code shows**
- **One delivery path.** Enter and the Steering button already used the same path: both call the same `send()` and the same `composerSendRoute`. That path goes to `loop.addInstruction` for a loop run and to `chat.steerTurn` for a turn. The host offers the message to the working step's adapter through `onSteerableStep`, which is set before the step's `send`. The adapter writes it at once with the SDK's `Query.streamInput()`, which writes to Claude Code without waiting (read in sdk.mjs 0.3.306). In the installed Claude Code binary, a message on stdin gets the queue priority `"next"` by default and is folded into the running turn between tool rounds (code reading, not a contract; the SDK's `user_message_uuids` documentation says the same).
- **A real gap, fixed.** Between `send()` opening a turn and `query()` returning a handle, `steer()` answered `no-running-turn`. During that time the previous stream, the SDK or the app tools may still be loading. The host then put the message back in the queue, so the **next** step took it. Now the Claude adapter holds such a message in the run and gives it to `streamInput` as soon as the handle exists. This is the first offer, not a resend. If the turn never starts, the message is settled as not delivered and waits for the next step, as before. The Cursor adapter does the same: it waits for `agent.send`'s `Run` before calling `Run.steer()`, which is typechecked but not tested.
- **Other explanations that remain.** If Claude Code has no tool round left in the node's turn, it runs the message as a following turn of the same query. The node then answers it after its own reply, and later nodes are briefed with it ("Earlier in this run"). Either case could look like "the next node acted on it". Which one happened in the trial is unknown.
- **What each signal means.** DSpatch's delivery is the write through `streamInput`, shown as accepted. The SDK's receipt is the uuid in a result's `user_message_uuids`, shown as delivered. Neither shows when the model took the instruction into account. The receipt is also given for a following turn, so it does not prove an effect mid-turn.

**Placement**
- **Inside the work it was sent into.** A message sent into running work is now drawn inside that work instead of after it by time. The window sends an anchor with the message: for a turn, how much of the answer it had shown; for a loop run, how many replies it had shown and how much of the working step's text. The answer is split there, moved forward only to the end of a word or past an open code fence. The text shown before stays before, and later output comes after. This applies live, in the working step and in the finished reply.
- **After reopening.** A turn's anchor is saved on `StoredSteering`. A loop run's messages, with their anchor and outcome, are saved on the run's ending line (`RecordedRunEnding.messages`, an optional field added to that line). An older build ignores the field, and no new record line kind was added. The window takes messages read back from a record together with its own by id, so none is drawn twice. A message without an anchor keeps its place by time, as before.
- **Status.** A quiet word while the message waits. Nothing once it is delivered. A visible line when delivery is unconfirmed or did not happen. Technical details stay in Session details.

**Verified, SIMULATED provider and steering, isolated userData** (`DSPATCH_CHAT_RUN=steering-placement`, two processes, real Enter and clicks, both passed):
1. `first`: a chat turn steered with Enter, then with the Steering button. Both messages sat inside the turn: after the answer text shown when they were sent, and before the output that followed. Both were delivered, with no status line, and nothing was drawn apart.
2. A loop step steered with Enter. The message was drawn inside the working step and delivered while the same step was still working, with no new reply in between. The step wrote on after it, and once the step had ended the message sat inside that step's reply. The later step ("check") was briefed with it and the steered step's prompt did not hold it. The record kept it as delivered (`during`) with its anchor.
3. `again`, after a restart: the saved chat (read from the file, then continued) and the loop run read back with each message in the same place, once each.

**Other checks.** Unit tests: the adapter holds a message sent before `query()`, the split point and its interleaving, the record round-trip, and the anchor saved with a turn's steering. The test groups chat (399 of 400 pass, none fail), loop (620) and host (13), the typechecks, and the existing steering scenario also pass.

**Not established**
- When a real Claude model takes a steering message into account, and what happened in Niclas's trial. AC #1 stays open.
- Cursor's hold before `Run` exists is typechecked only.

**Trial at home**
1. Start a Use loop run whose first node does several tool calls (for example, "read every file under src and summarise each").
2. While it reads, press Enter with a short, checkable instruction (for example, "Also count the lines of each file").
3. Session details should say "Delivered to “<node>”". If the node's own reply already acts on the instruction, it was folded in mid-turn.
4. If the node acts on it only after its reply, or only the next node does, Claude Code ran it as a following turn.

<!-- SECTION:NOTES:END -->
