---
id: DSP-145
title: >-
  Let the development agent run its own builds and tests with Claude, in chat
  and in loops
status: Review
assignee: []
created_date: '2026-10-27 08:43'
updated_date: '2026-10-27 12:50'
labels:
  - providers
  - loop
  - chat
dependencies: []
ordinal: 82000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Direction from Niclas, 27 Oct 2026, replacing the earlier instruction not to give Claude command execution: a usable development agent with Claude through the existing chat and loop engine. Open a project, choose Claude, give an ordinary development task; the agent investigates code and project instructions, edits, chooses and runs relevant build and test commands itself, reads results, fixes and verifies again, and reports what changed, what was checked and what remains. No test command entered by the user, no special example graph, no manual hand-over of results between steps. Command execution goes through DSpatch's control and permission boundaries (control of the tool request, permissions and working folder, recorded results, cancel including child processes), not prompt instructions alone; existing approval rules, no new per-command confirmations. Loops: the check step gets enough evidence of the work and of real verification; a failed test can lead to correction within the loop's limits and cancel; missing or stale results never count as approval. The review discussion keeps its text-only policy. Provider-neutral; no new Windows dependencies; no remote transport or Copilot. Supersedes the direction of DSP-139's hard-coded gate as the main verification flow; DSP-140 to DSP-144 to be reconciled against this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With Claude in the chat the agent runs commands it chooses through DSpatch's command tool; DSpatch starts the process in the session's working folder with a time bound and records line, folder, exit code or how it ended, duration, bounded output and the tested and after-run snapshots; the policy text names the tool
- [x] #2 A failed or unstartable command returns to the same agent as a tool result; the turn continues and the step is not faulted, and it does not by itself decide the run's outcome
- [x] #3 Cancel or a time bound during a running command stops it including its child processes and the command is recorded as interrupted even if the SDK delivers no tool result; shown with a real child process
- [x] #4 The review discussion gets no command tool: no MCP server, a runner with the review policy is refused, the deny-all hook still applies
- [x] #5 In a loop, commands from agent steps (Claude via the tool, Cursor as provider-reported) are recorded per step and handed to the check with their current or stale standing
- [x] #6 An outcome leading to a success terminal stands only with a completed command current for every working folder at the end of the step, or when the run changed no files; otherwise the node's whenUndeclared is recorded as verification-stale, or, where whenUndeclared is absent or itself a success route, the run stops with a runtime fault; either way the run does not end at success
- [x] #7 The check's rework with concrete findings sends the work back, counted against maxReworkRounds; a spent bound ends at not met; cancel stops the walk and the running command
- [x] #8 Use loop and the editor's Run need no command typed by the user; the duration example's command stays confined to its drawing; production code does not know the verification example
- [x] #9 Offline evidence: real adapter on a substituted SDK, real node --test in a generated repository, the chain task, change, failing test, correction, passing test, report in chat and in a loop; Cursor constructed 0 times; no installs, provider calls or profile reads
- [x] #10 Cards and LINUX_HOME_TRIAL.md updated; the next live trial is an ordinary development task with no test command configured
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Run 20261027-120000-dev-agent. Focus: plan - a DSpatch-owned command tool offered to the Claude agent (reusing DSpatch's command runner and process-tree handling), in chat and loop steps; loop correction after a failed check.

Plan report 001 accepted with amendments B1-B5 (report 002). Decisions on recommendation: Q1 freshness against the after-run snapshot, rule only on edges to success terminals (replaces DSP-139 A2 for tool commands); Q2 Cursor shell completions recorded as provider-reported evidence; Q3 old Claude chats refused on resume after the policy change, the refusal says why; Q4 chat-loop limits are guesses; Q5 a live trial needs Niclas's explicit approval at home. Focus: implementation S1 (shared runner, Claude command tool, chat).

Recorded, not done here (R-1 improvements): I3 the check's evidence section can reach about 80 000 characters (20 entries, 2 000-character tails); I4 in dspatch-development-loop-runnable the approval rule lands on coordinator-report (reported -> delivered), so a run that changed files with no current completed command ends at reporting-incomplete with verification-stale; I5 the chat's freshness for a session with several folders would always read stale (chat sessions are single-folder today). Known limit: a gate-less chat loop's outcome badge reads verification-not-performed even when the check ran tests through DSpatch; the sentence beside it explains. Snapshot cost of hashing the working folders around each command is unmeasured on large repositories. The approval rule applies to every agent node with a success route in any graph, including Cursor graphs (Cursor shell calls count as provider-reported evidence).

Result (offline, Windows; simulated model, real commands): Claude gets DSpatch's command tool (mcp__dspatch__run_command, an in-process MCP tool) in the chat and in loops, never in the review discussion. DSpatch starts each command in the working folder under a 10-minute bound, records it with the snapshots it ran on, shows it under the reply and in Session details, and stops it with its child processes on cancel; a failed command is a tool result to the same agent. In the chat loop the check runs its own checks, can send the work back with concrete findings (at most 2 correction rounds), and a met stands only with a completed command current for every folder or no change. Verified: task, edit, failing npm test, correction, passing test, report in chat (ChatService.sendPrompt) and loop (prepareLoopRun -> runLiveGraph) with real node --test in generated repositories; cancel with real child processes; review separation; Cursor 0, no installs. Tests: loop 611, live 107, chat 386, presentation 299, provider 96, review 90, typecheck and build. Reviews: R-0 accept with B1-B5, R-1 rework R1-R5, R-2 accept. Not established: a real Claude choosing and correcting its own commands, the real SDK MCP/zod handshake and typecheck:claude, Linux, Niclas's UX assessment. Recorded, not done: R-2 I-d (no test of the default runner choice per purpose in provider-adapters.ts). Next: Linux trial Part C steps 13-18.

27 Oct 2026, DSP-146: the DSpatch-owned command tool this task added (mcp__dspatch__run_command) departed from the governing decisions (INTERACTION_MODEL.md sections 1, 5, 8; RUNTIME_PLATFORM_ROADMAP.md section 1.2) and was not an approved architecture change. DSP-146 replaced it with Claude Code's own Bash/PowerShell under DSpatch's permission policy, recorded through the SDK's hooks. The notes above are kept as the record of what was built at the time.
<!-- SECTION:NOTES:END -->
