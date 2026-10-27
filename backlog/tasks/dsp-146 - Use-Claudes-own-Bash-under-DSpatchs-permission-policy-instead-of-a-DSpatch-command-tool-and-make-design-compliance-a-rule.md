---
id: DSP-146
title: >-
  Use Claude's own Bash under DSpatch's permission policy instead of a DSpatch
  command tool, and make design compliance a rule
status: Review
assignee: []
created_date: '2026-10-27 12:24'
updated_date: '2026-10-27 13:00'
labels:
  - agent
  - claude
  - architecture
dependencies:
  - DSP-145
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
DSP-145 added a DSpatch-owned MCP command tool (mcp__dspatch__run_command) that spawns the agent's commands itself. The governing documents (INTERACTION_MODEL.md section 1, 5 and 8; VISION.md 'Explanations must be checkable'; RUNTIME_PLATFORM_ROADMAP.md section 1.2 and 'Keep the product common') decide that the agent runs commands with its own tools and the runtime owns its model-tool loop; DSpatch applies permissions and records what happened, and does not need to own the spawn. This task compares the command tool with the pinned Claude Agent SDK's built-in Bash, permission callbacks and hooks, corrects the drift if the SDK path meets the decided requirements, and adds a design-compliance rule to AGENTS.md for the coordinator, specialists and reviewer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The governing decisions are identified, with decisions kept apart from drafts, proposals and open questions (the content-exclusion contract is Copilot-scoped).
- [x] #2 The command tool is compared with the pinned SDK version's Bash, canUseTool and hooks from its own types and documentation: permission before execution, recording of command and result, cancellation and child processes, session and provider isolation, the review policy, optional installation, future host placement.
- [x] #3 Where the SDK path meets the requirements, Claude uses its own Bash under DSpatch's permission policy and observation; the DSpatch command tool and its special configuration are removed; chat and loop keep a usable flow; earlier command records still display.
- [x] #4 Any concrete gap against a mandatory requirement is documented with requirement, source, gap, smallest alternative and consequences, and left for Niclas's decision.
- [x] #5 A provider-reported result or a finished agent turn is never treated as a verification; content exclusion is not claimed.
- [x] #6 AGENTS.md carries a design-compliance rule covering reading the governing decisions, reuse, architecture changes not being routine, ambiguous prompts not overriding decisions, conflict reporting, autonomy within bounds, no retroactive document rewriting, review of design conformance and remaining deviations in the final report; it reaches the coordinator and delegated work.
- [x] #7 Targeted verification: adapter wiring, a failing command returned to the same agent, cancellation, review without development tools; real-SDK type check kept apart from simulated-SDK tests; independent review.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Governing decisions (read 27 Oct 2026, current repository versions)

Decisions that govern this work:
- INTERACTION_MODEL.md section 1: the agent "decides how to carry out the work using its own tools"; section 5: "DSpatch does not need to own the command execution to record it"; section 6: no DSpatch approval for ordinary agent commands; section 8: owning the spawn was a misallocation, "Who started the process is not what the principle was ever about".
- VISION.md, "Explanations must be checkable": a requirement about traceability, not about who starts a process.
- RUNTIME_PLATFORM_ROADMAP.md section 1.2 step 1: DSpatch work runs through Claude's own agent harness (tool set, permission rules and modes, sessions); "Keep the product common": the agent runtime owns its model-tool loop; review uses the same adapter with the same tool control.
- AGENT_BEHAVIOUR_AND_ORCHESTRATION.md section 1 and 5: DSpatch owns tool access, sessions, interruptions and history; every instruction DSpatch adds is visible.
- MAESTRO_ORCHESTRATION.md (cancellation): a cancel is a request; the UI shows whether termination is confirmed or unknown.

Kept apart:
- DSPATCH_CONTENT_EXCLUSION_CONTRACT.md is a draft, scoped to the Copilot runtime. Its "prefer native loading, do not add a callback runner that duplicates it" points the same way, but it is not evidence about Claude and was not used as such.
- AGENT_BEHAVIOUR sections 3-4 are proposals, not used.

## Drift found

DSP-145 gave Claude a DSpatch-owned MCP command tool (`mcp__dspatch__run_command`) whose handler spawned every command itself, and kept "no Bash". That re-created the misallocation INTERACTION_MODEL.md section 8 records: DSpatch owning the spawn as the definition of evidence. It was implemented on a mandate that emphasised DSpatch control; no decision changed the governing documents. Treated as drift, not as an approved architecture.

## Comparison with the pinned SDK (0.3.306, installed at home for this; types, installed code and official docs)

| Need | DSP-145 command tool | SDK's own Bash with DSpatch controls |
| --- | --- | --- |
| Permission before execution | allowedTools + dontAsk | Same: `Bash`/`PowerShell` in allowedTools, dontAsk; PreToolUse hook runs before (documented; an SDK callback hook on PreToolUse that times out blocks the call) |
| Record command and real result | DSpatch's own record | PreToolUse (start), PostToolUse (`tool_response` stdout/stderr/interrupted) and PostToolUseFailure (`error`, first line `Exit code N` for a command that ran and exited) - documented in the hooks reference. Exit 0 on success is DSpatch's reading (Claude Code states exit codes only for failures); a benign non-zero (returnCodeInterpretation) stays unknown |
| Snapshots | runner took them | DSpatch takes them in the hook callbacks (awaited by the SDK) |
| Background / orphaned commands | n/a | `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (documented): no run_in_background, a timed-out command stops instead of moving to the background |
| Time bound | DSpatch's 10 minutes | Claude Code's own: 2 min default, at most 10 (documented) |
| Cancel | DSpatch killed the command tree and confirmed it | Existing DSP-115 sequence: hook denies further calls, interrupt, abort, kill the Claude Code process, confirmed end = its exit. Whether a running command's children end is NOT documented; recorded as not established |
| Session/provider isolation | unchanged | unchanged |
| Review text-only | refused a runner | unchanged deny-all policy; Bash/PowerShell disallowed; no recording hooks |
| Optional install | needed zod from claude-support | no extra dependency; loadClaudeZod removed |
| Host placement | handler in the SDK's host process | hooks in the same host process |

Result: the SDK path meets every documented requirement; no architecture deviation was needed.

## What was corrected

- Removed: the MCP command tool, its description, server and handler, the `mcpTools` seam, `loadClaudeZod`, `AgentCommandRunner`/`AgentCommandRequest`, `createAgentCommandRunner`, `commandRunnerFor`, the `commandTool` policy flag, the SDK shapes for in-process MCP.
- CHAT_PERMISSIONS (chat and loop): Read, Glob, Grep, Edit, Write, Bash, PowerShell; Bash and PowerShell pre-approved; still no MCP servers, dontAsk, no settings from disk.
- Adapter: PreToolUse records the start of a shell command it lets through; PostToolUse/PostToolUseFailure record the end; a command still open at the run's end is recorded as `stopped` (cancelled; children not established) or the new ending `not-reported`. Records are `requestedBy: 'provider-reported'`.
- Chat: snapshots taken at the hook events; the Run button is refused while an agent command runs (slot claimed on start, released on end or session close).
- Loop: records keep `provider-reported` with a hook note; the approval rule and check evidence are unchanged.
- History: `agent-tool` records from DSP-145 still read and display ("DSpatch's former command tool").
- Kept from DSP-145: shared runner for the gate and the Run button, chat command lines and Session details, loop rework/limits, approval rule.
- Policy digest changed; DSP-145 Claude conversations are refused on resume with the existing sentence.

## Lost or weaker than DSP-145 (reported, not hidden)

- Cancel no longer confirms that the command's child processes ended; DSpatch says so.
- The person's Run button no longer stops the agent from starting a command while the person's command runs (the reverse is still refused).
- Success exit code is DSpatch's reading; failing output arrives as one text (stdout/stderr not separated).
- The time bound is Claude Code's, not DSpatch's.

## Open for Niclas's decision

- Whether DSpatch, at the existing kill step of a cancellation, should stop Claude Code's whole process tree (it already observes that process) to cover a command's descendants, or wait for the live trial to show what Claude Code does. Not implemented.

Content exclusion: not implemented or verified here; recording or permitting a command proves nothing about what reaches the model.

## After review R-1 (REWORK, one blocking finding)

- B1 fixed: a provider-reported command whose end nobody reported no longer reads as run or stopped. The window shows *Requested: how it ended was not reported* or *Cancelled (end not confirmed)*, and *(no output was reported)* instead of *(no standard output)*. *through DSpatch* is gone from the empty-state sentence. turn-routing tests added.
- I1 fixed: the trial step no longer expects Session details to show the session's reported tool list, which it does not.
- I2 fixed: a late end hook after the run's end is ignored.
- I3 fixed: Claude Code's persisted-output preview is noted on the record.
- I6 fixed: the post-tool hooks have matcher Bash|PowerShell.
- **A control DSpatch chose:** `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` narrows Claude Code's own tool. It removes run_in_background and stops a timed-out command instead of moving it to the background. It is documented and visible in the policy text. It keeps every command inside its turn, where hooks record it and cancel reaches it. The DSP-145 envelope was foreground-only too.
- **Further losses (I4):**
  - Agent-against-agent one-command-at-a-time is no longer enforced by DSpatch.
  - Records carry no process id.
  - `shell` names the tool (*Claude Code Bash tool*), not the interpreter.
  - The model-facing tool description of folder, time bound and not-a-sandbox is gone. The person still sees the policy text.
- **canUseTool (I5):** not used and not needed. With dontAsk and allowedTools the decision is made before any prompt, and the SDK documents that canUseTool is then never called. PreToolUse hooks cover what DSpatch must see before execution.
- **For the live trial (I5):**
  - Whether PowerShell's failure text in the hook `error` starts with `Exit code N`. If not, DSpatch records not-reported, which is honest.
  - What a timeout reports with the env switch set.
  - What happens to a command's children on interrupt.
  - The real hook payloads.

Review R-2: ACCEPT. Remaining suggestion: Claude Code's own reported interrupt also reads *Cancelled (end not confirmed)* (conservative); revisit after the live trial. Not verified: real Claude Code behaviour (hook payloads, PowerShell error text, children on interrupt), Linux, Niclas's UX assessment.
<!-- SECTION:NOTES:END -->
