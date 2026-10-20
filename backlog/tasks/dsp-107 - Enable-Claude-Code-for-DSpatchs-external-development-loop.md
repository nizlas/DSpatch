---
id: DSP-107
title: Enable Claude Code for DSpatch's external development loop
status: Done
assignee: []
created_date: '2026-10-20 20:20'
updated_date: '2026-10-20 21:37'
labels:
  - development loop
dependencies:
  - DSP-23
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas asked on 20 October 2026 that Claude Code be able to take part in the external development loop that helps us build DSpatch, using the existing governance rather than a second copy of it. Scope: a root CLAUDE.md that imports AGENTS.md; Claude Code custom-agent definitions for the five specialists generated from the existing role sources in docs/loop/roles/ into .claude/agents/; a Claude coordinator skill at .claude/skills/dspatch-loop/SKILL.md that shares its procedure with the Cursor skill; and targeted updates to AGENTS.md and docs/DEVELOPMENT_LOOP.md so an agent finds the entry point for its environment. Out of scope: DSpatch's own run engine, graph execution and provider integrations. Generating Claude agent files does not establish Claude as a runtime provider, and the capability table's DSpatch-walked-run answers for claude-code stay unknown. No Claude SDK adapter, no authentication or billing change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A root CLAUDE.md imports AGENTS.md and adds only Claude-specific startup or routing
- [x] #2 The five specialists are generated for Claude Code from their existing role sources into .claude/agents/, with provenance and hand-edit protection
- [x] #3 Read-only roles get no write-capable tool, the Verifier's write scope is stated honestly, and no specialist can delegate; any guarantee Claude cannot express is reported, not implied
- [x] #4 The generated Cursor agent files are byte-identical to their previous content
- [x] #5 The product runtime path for claude-code keeps its unknown capability status
- [x] #6 A Claude coordinator skill exists and the shared coordinator procedure has one maintained source
- [x] #7 AGENTS.md and docs/DEVELOPMENT_LOOP.md name the right entry point for Cursor and for Claude Code
- [x] #8 A real call to a registered Claude specialist has been observed, or is recorded as pending with a precise follow-up
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inspect existing governance, roles, generator and Cursor skill. 2. Confirm Claude Code formats from official docs and the running session. 3. Add a claude-code emitter to role-generate.ts and capability answers that keep the walked-run path unknown. 4. Declare claude-code in the five role sources, generate .claude/agents/. 5. Extract a shared coordinator procedure; thin Cursor and Claude skills. 6. CLAUDE.md, AGENTS.md, DEVELOPMENT_LOOP.md. 7. Targeted tests, generator checks, real reviewer probe, commit.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (20 Oct 2026): inspection complete; confirming Claude Code formats before implementation.

Inspection findings (20 Oct 2026): baseline 'npm run roles:generate' compares all five Cursor files as identical bytes, exit 0. Product runtime only runs connectedTargets ['cursor'] (loop-live-run.ts, loop-choice-check.ts, main.ts), so declaring claude-code in role sources does not make a claude-code graph runnable; the claude-code row must still state its dspatch-walked-run answers explicitly as unknown because capabilityAnswer falls back to the generated-file answer. Claude Code docs (sub-agents, memory, skills, read 20 Oct 2026): .claude/agents/*.md with name, description, tools allowlist, model; omitting tools inherits every tool including Agent; disallowedTools with a Bash specifier removes all of Bash; custom subagents load CLAUDE.md; a first agents directory needs a restart to load. Design: read-only roles get Read, Grep, Glob, WebFetch, WebSearch only (no shell); delegation is closed by omitting Agent and Skill. Blocked: this session runs in worktree .claude/worktrees/remote-control-ba3626 and the app's edit hook refuses Edit/Write in the main checkout; waiting for Niclas to choose how to proceed.

Next step (20 Oct 2026): Niclas is starting a new Claude Code session without worktree in C:\Users\nicla\development\DSpatch to continue. Resume from 'Design' above: add the claude-code emitter (claudeCodeAgentPath, tools allowlist, background only when required) and EMITTED_TARGETS in app/src/main/role-generate.ts; fill the claude-code row in TARGET_CAPABILITIES with generated-agent-file answers (documentation evidence) and explicit whenDSpatchWalksTheRun NOT_RUN on every cell; let generate-roles.mjs default to all emitted targets the role declares; declare claude-code in the five role sources; generate .claude/agents/; extract the shared coordinator procedure; add CLAUDE.md, .claude/skills/dspatch-loop/SKILL.md, AGENTS.md and DEVELOPMENT_LOOP.md routing; tests; reviewer probe after a restart if needed; commit on main. Cursor baseline hashes: planner 5a0c4a9a, implementer c824f062, researcher 3a3117e9, reviewer a4996f1f, verifier 80d4f140 (sha256 prefixes).

Resumed (20 Oct 2026) in a new local Claude Code session: main checkout C:\Users\nicla\development\DSpatch, branch main at f83f476, no worktree. Cursor baseline hashes re-checked and unchanged. Current focus: implementing the claude-code emitter in role-generate.ts.

Implemented (20 Oct 2026, main checkout, uncommitted base f83f476):
- app/src/shared/loop-graph.ts: claude-code row filled for the generated-agent-file path from Claude Code's sub-agent documentation (re-read 20 Oct 2026; evidence 'documentation'): no-file-writes, no-subagent-delegation and tool-restriction via the `tools` allowlist, fixed-model-selection via `model`, background-execution via `background: true`. Every cell carries an explicit whenDSpatchWalksTheRun NOT_RUN, so every product path (all ask 'dspatch-walked-run') still reads unknown. connectedTargets stays ['cursor'].
- app/src/main/role-generate.ts: claude-code emitter (claudeCodeAgentPath, claudeCodeTools, EMITTED_TARGETS), LF line endings, the same provenance and digest. `tools` is always written. Read-only roles: Read, Grep, Glob, WebFetch, WebSearch, so no shell (warned). Writing roles: + Edit, Write, Bash, with no path limit (warned, including that Bash can still start another agent program). Agent and Skill are never granted to a role that requires no-subagent-delegation.
- app/scripts/generate-roles.mjs: without --target, generates every emitted target each role declares; --flat requires --target.
- docs/loop/roles/*.role.md: targets: cursor, claude-code; the three read-only roles get a claude-code block saying they have no shell and must ask the coordinator for command output.
- .claude/agents/*.md: five generated files.
- docs/loop/COORDINATOR.md: the single maintained coordinator procedure. .cursor/skills/dspatch-loop/SKILL.md is now a thin Cursor entry point; .claude/skills/dspatch-loop/SKILL.md is the Claude Code entry point.
- CLAUDE.md (imports AGENTS.md), AGENTS.md, docs/DEVELOPMENT_LOOP.md (new 'Start in Claude Code'), docs/loop/ROLE_FORMAT.md (targets section).
Visible side effect: dspatch-development-loop.graph.json points its coordinator nodes at .cursor/skills/dspatch-loop/SKILL.md, so the graph editor now shows the thin entry skill (which points to COORDINATOR.md) instead of the full procedure. The test pinning that pointer still passes.

Verification (20 Oct 2026, working tree on f83f476 plus the changes above): `npm run roles:generate` from app/ exit 0, all ten files identical bytes; Cursor sha256 prefixes unchanged (5a0c4a9a c824f062 3a3117e9 a4996f1f 80d4f140); `--target copilot` exit 1 (refused); `--flat` without --target exit 2, nothing written. `npm run test:loop` 571/571 pass, including 8 new Claude Code tests in role-generate.test.ts; `npm run typecheck` exit 0. Full suite not run: the change is confined to the generator, the capability table and docs, all covered by the loop group.

PENDING, AC#8 (20 Oct 2026): `Agent` with subagent_type 'dspatch-reviewer' in this session returned "Agent type 'dspatch-reviewer' not found" (available: claude, claude-code-guide, Explore, general-purpose, Plan, statusline-setup). This is expected, because .claude/agents/ was created after the session started. Follow-up: in a new Claude Code session at the main checkout, call Agent with subagent_type 'dspatch-reviewer' and a read-only probe (report its name and tools, and whether it can start a subagent, writing nothing). Record the result here; check AC#8 only if the call succeeds. Also confirm that /dspatch-loop resolves to .claude/skills/dspatch-loop/SKILL.md. Task stays In Progress until then.

Correction (20 Oct 2026, after commit 25257bb): Claude Code files now default to CRLF instead of LF. core.autocrlf=true would have checked the LF files out as CRLF, after which roles:generate would report them as differing and the byte-for-byte test would fail. Re-verified: roles:generate exit 0, test:loop 571/571, typecheck:node exit 0, Cursor hashes unchanged.

AC#8 verified (20 Oct 2026, new Claude Code session, main checkout C:\Users\nicla\development\DSpatch, branch main, HEAD da63a32, no worktree; untracked unrelated files only).
- Registration (observed): this session's Agent tool lists the five dspatch-* specialists; dspatch-reviewer is listed with "Tools: Read, Grep, Glob, WebFetch, WebSearch".
- Invocation (observed): `Agent` with subagent_type "dspatch-reviewer" was accepted and ran as a background custom agent (~5 min, 43 tool uses) and returned its report through the harness. Not a general-purpose agent or fork.
- Configuration (read from file): .claude/agents/dspatch-reviewer.md has name dspatch-reviewer, tools Read, Grep, Glob, WebFetch, WebSearch (no Edit, Write, NotebookEdit, Bash, Agent, Skill), model: inherit, provenance header and digest.
- Agent self-report (not independent evidence): it reported exactly Read, Grep, Glob, WebFetch, WebSearch plus the harness's hand-back tool, and no Edit, Write, NotebookEdit, Bash, Agent or Skill. It agrees with the file and the listing. No file in the repository changed during the call (git status unchanged).
- Skill discovery (observed): invoking the Skill tool with "dspatch-loop" loaded "Base directory for this skill: C:\Users\nicla\development\DSpatch\.claude\skills\dspatch-loop" with the Claude Code body. No ~/.claude/skills or ~/.claude/agents exist, so nothing user-level shadows it.

Evidence supplied to the reviewer (no shell): `git diff f83f476 da63a32`, its stat, and a fresh run on HEAD da63a32: `npm run roles:generate` exit 0 (10 files identical bytes), Cursor sha256 prefixes unchanged (5a0c4a9a c824f062 3a3117e9 a4996f1f 80d4f140), .claude/agents/*.md CRLF, `npm run test:loop` 571/571 exit 0. Afterwards `npm run typecheck` exit 0 on HEAD da63a32 (reviewer's S2).

Review of the combined DSP-107 change (dspatch-reviewer, implementation mode): ACCEPT, no blocking findings. AC#1-#7 supported by the diff, the code and the HEAD evidence; the COORDINATOR.md extraction loses nothing from the old Cursor skill procedure (environment-specific tool names moved to the entry skills; one tightening: a general-purpose agent playing a role is not a probe).
Suggestions (not blocking, recorded, no change made):
- S1: role sources now declare targets cursor, claude-code, so the editor's role panel for the runnable graph's specialists reads "Supports cursor, claude-code, declared in the file" (app/src/renderer/LoopEditor.tsx ~3644) and describeTargetChange to claude-code no longer lists those nodes under rolesWithoutSupport (app/src/shared/loop-graph.ts ~1255). Capability stays unknown and validation against ['cursor'] still refuses a claude-code graph, so AC#5 holds; the panel wording could later say "role declares" to avoid being read as runtime support.
- S2: typecheck on HEAD was not in the supplied evidence; resolved by the run above.
- S3 (future): see coordinator-reference conclusion.

Coordinator-reference conclusion (read in code by coordinator and reviewer): docs/loop/graphs/dspatch-development-loop.graph.json still points coordinator and coordinator-report at .cursor/skills/dspatch-loop/SKILL.md (cursor-skill-file). loop-graph-roles.ts resolveOnce returns the body after front matter as instructions and follows no links, so the drawing's role panel and brief preview now show the thin entry skill. No execution path sends it to a provider: the only tracked loop definition (.dspatch/loops/dspatch-chat-loop.loop.json) runs dspatch-chat-loop.graph.json; the runnable development loop resolves its coordinators through role-source docs/loop/roles/run/dspatch-run-coordinator.role.md; OPEN_LOOP_GRAPH development-loop is editor-only; a live walk of the drawing (loop:live CLI or a hand-made .loop.json) stops at its human entry node niclas-mandate (loop-live.ts returns awaiting-human); dry runs call no provider. The claude-code target blocks in role sources go to targetBlocks, not sections (role-source.ts), so walked prompts do not gain them. The external loop's coordinators (Cursor and Claude Code) read their entry skill directly and are told to read COORDINATOR.md in full. No regression; the reference remains sufficient and is pinned by app/tests/loop-node-help.test.ts. S3: if a later change lets a live run get past the human entry, point the drawing's coordinator nodes at a role-source file instead; the thin skill's relative link would not resolve in a foreign workspace, though the old full Cursor procedure was already judged wrong for a coordinator inside a run (DSP-83).

Status: AC#8 checked; task moved to Review for Niclas's assessment.

Accepted by Niclas (20 Oct 2026), on the basis of the implementation, the successful dspatch-reviewer custom-agent call and the recorded verification. Status Review -> Done. S1 (the editor's role panel reads 'Supports cursor, claude-code' for role sources, which could be taken as runtime support) and S3 (point the drawing's coordinator nodes at a role-source file if a live run can ever pass its human entry node) remain non-blocking observations for future work.
<!-- SECTION:NOTES:END -->
