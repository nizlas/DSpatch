---
name: dspatch-loop
description: Coordinate DSpatch development with Backlog Planner, Researcher, Implementer, Verifier and Reviewer in a flat loop. Use when the user wants to start, plan or resume a development run; editing agent definitions does not start a run.
---

# DSpatch coordinator

Follow the coordinator procedure in [docs/loop/COORDINATOR.md](../../../docs/loop/COORDINATOR.md). Read it in full before step 1; it is the one maintained source of the procedure, and this skill adds only what is specific to Claude Code.

In Claude Code:

- Call a specialist with the `Agent` tool and `subagent_type` set to its name: `dspatch-backlog-planner`, `dspatch-researcher`, `dspatch-implementer`, `dspatch-verifier` or `dspatch-reviewer`. They are defined in `.claude/agents/`, generated from `docs/loop/roles/`. A `general-purpose` agent, an `Explore` agent or a fork playing the role is not a specialist call. If `subagent_type` is rejected, the agents are not registered in this session: report that, and restart Claude Code if `.claude/agents/` was created after the session started.
- Do not pass `isolation: "worktree"`. The loop works in one working copy, and a specialist in its own worktree would produce a candidate the others never see.
- A call may return before the specialist has finished and deliver its result later as a notification. One call at a time still holds: the call is in progress until its result has arrived, and the next one waits for it. While Niclas is present, wait for each result before doing anything else; for an unattended run, the same order applies without him watching.
- The question-form tool you must not use for your own questions unless Niclas asks for it is `AskUserQuestion`.
- Backlog Planner, Researcher and Reviewer are read-only because they have **no shell**: their tools are Read, Grep, Glob, WebFetch and WebSearch. They cannot run `git diff`, `git log`, `scripts/loop_snapshot.py` or any other command. Before calling one, write what it needs from a command — the candidate diff, the snapshot output, a log — to a file in the run directory and name that path in the handoff. They cannot write their own reports either; save each one as [the handoff contract](../../../docs/loop/HANDOFF.md) states per role.
- Implementer and Verifier have Edit, Write and Bash without a path limit. Their write scopes are instructions, not restrictions. None of the five has the `Agent` or `Skill` tool, so none can start a subagent through Claude Code; Bash could still start another agent program, which the role instructions forbid.
- Specialists read `CLAUDE.md`, and through it `AGENTS.md`, but not this conversation. The handoff must carry everything else they need.
- What this loop establishes about Claude Code is about the generated agent files. It says nothing about DSpatch's own run engine, which cannot run a Claude Code graph; see [ROLE_FORMAT.md](../../../docs/loop/ROLE_FORMAT.md#targets).
