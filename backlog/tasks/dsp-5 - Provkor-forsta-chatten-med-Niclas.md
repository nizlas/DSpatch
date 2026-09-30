---
id: DSP-5
title: Try the code-change workflow with Niclas and capture friction
status: Done
assignee:
  - '@nizlas'
created_date: '2026-09-13'
updated_date: '2026-09-16 19:13'
labels:
  - ux
milestone: m-0
dependencies:
  - DSP-2
documentation:
  - docs/VISION.md
  - BACKLOG.md
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

Technically working chat and code changes do not automatically provide the intended experience. Niclas should try the first runnable version early, before a larger workspace is built around untested assumptions.

### Scope and proposed approach

Prepare short instructions and a runnable result. Niclas selects a small real task and tries opening the repository, discussing the task, asking for a code change, reviewing affected files and the diff, running a relevant build/test and following up. Include a follow-up or rework and a cancellation.

Observe where he has to search, guess or ask for an explanation. Assess whether the agent's changes, the command's purpose and the code covered by the result are understandable. Clickable controls alone do not establish usability.

Niclas may give early feedback on DSP-2 as soon as chat runs. DSP-5's full trial then covers code changes, diff and build/test. DSP-3 and DSP-4 need not be complete yet. Record available functionality in the tested version; deeper error recovery and restart are followed up in DSP-6.

### Results and next step

Save brief observations and Niclas's comments with environment and version, separating observations from agent interpretations. Prioritise at most three friction points and propose a small improvement for DSP-6. Agents may check the GUI themselves but cannot attribute an assessment to Niclas that he has not made. A significant new finding may justify changing the plan.

### References

[VISION.md, sections 1.1, 2.1, 3.1 and 15](../../docs/VISION.md#21-simplicity-with-full-capability).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A concrete runnable result and short trial covering code change, diff and build/test are available to Niclas.
- [x] #2 Niclas has personally made a real bounded code change through chat, reviewed the diff, run a relevant build/test and followed up. Environment, tested version and available functionality are recorded.
- [x] #3 Observations about clarity, code understanding, the connection between code and test results, and unnecessary steps are separated from agent assumptions.
- [x] #4 At most three prioritised friction points and a bounded next improvement are documented, or an explicit finding that no blocking friction was found.
<!-- AC:END -->

## Implementation Notes
<!-- SECTION:NOTES:BEGIN -->
## Trial of 15 September 2026

### Environment and tested version

Niclas ran the packaged Windows build at `app/release/win-unpacked`, built 2026-09-15T09:21:52Z from git 3d44171 plus 39 uncommitted files, build identity `b4a87678dd5203cd`, `app.asar` sha256 `2625735ca2384b1076a503af5fbf96d69f8e4a3a401dabf23b308d29ad1ac88c`. The project under test was his own C++ project `MiniDAWLab-spike01`, not a scratch repository made by an agent. Model `claude-haiku-4-5`. Conversation `dsp-conv-20260915150209-qrg0tp`.

### What Niclas did and observed

These are his own statements and screenshots, not an agent's inference.

- Opened the repository, held a conversation and read the complete text diff of a README change in the Changes and diff panel.
- Ran his project's real self-test suite from the Build and test panel with a hand-typed command, and reported that it ran and passed.
- Edited a file externally afterwards and confirmed that the recorded pass was correctly demoted so it no longer claimed to describe the current code.
- Closed the application while an answer was still arriving, reopened it, and was offered the saved conversation with its unresolved attempt named before anything opened.
- Escaped a provider refusal with "Continue in a new provider session" and confirmed that the new session, given only the recap DSpatch showed him word for word, correctly answered a question about the conversation it had never seen.

### Observations, separated from interpretation

Observed by Niclas: the block after killing a turn did not clear by waiting; the acknowledgement of an unresolved attempt had to be repeated for every message; the sentence "Use the composer above" pointed the wrong way; reopening read as being asked to choose the repository again; the remembered-projects list was full of throwaway entries he could not remove; no test command was suggested for a CMake project.

Coordinator interpretation, marked as such: the non-clearing block is most likely the provider keeping a session marked busy when its client disappears mid-run, since no terminal event is ever delivered. This mechanism is inferred, not measured. Separately, reading the stored conversation showed that exactly one of eleven attempts is `outcome-unknown` and can never be resolved, so the repeated acknowledgement is permanent for the life of that conversation rather than temporary.

### Prioritised friction and the bounded improvement for DSP-6

1. The unresolved-attempt gate asks for acknowledgement per message rather than per conversation, so a conversation interrupted once pays the toll forever, including in a new provider session where the risk it guards against no longer exists.
2. After restoring a conversation the panel says the composer is above it when it is below, sending the user looking in the wrong place.
3. The remembered-projects list accumulates entries, some no longer on disk, with no way to remove one.

A fourth item is a correctness defect rather than friction and is carried with them: the held-run block states as fact that it "disappears on its own" once the run ends. Measured against a killed turn, it had not cleared after eleven minutes.

Two observations are recorded without proposing work: a seven-message conversation occupies 5.7 MB of a 16 MB budget because baselines are stored as base64 copies, and the suggested test command is derived from `package.json` so projects built another way get no suggestion. The second is honest rather than wrong: DSpatch states that it could not work out how the project is built instead of guessing.

Full detail, including which agent had or had not measured each behaviour, is in the run journal at `.dspatch-loop/runs/20260914-205132-nt4m/state.json` under the `dsp5_` keys.

### Containment, carried to its own task

Reviewer 011 asked for containment to become a task of its own rather than a README warning. That is now [DSP-16](dsp-16%20-%20Contain-the-agent-to-the-chosen-project.md).

### Closed with DSP-6, 16 September 2026

Niclas confirmed the 15 September trial is the Phase 0 assessment and added: it was a functional test; where things live in menus still needs a great deal of iteration; the window feels like one big debug window. That is his observation, not an agent reading. The three friction points above were the DSP-6 increment. The debug-window judgement is accepted and handed to DSP-11, not treated as a fourth DSP-6 fix.
<!-- SECTION:NOTES:END -->
