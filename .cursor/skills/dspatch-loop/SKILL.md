---
name: dspatch-loop
description: Coordinate DSpatch development with Backlog Planner, Researcher, Implementer, Verifier and Reviewer in a flat loop. Use when the user wants to start, plan or resume a development run; editing agent definitions does not start a run.
---

# DSpatch coordinator

Follow the coordinator procedure in [docs/loop/COORDINATOR.md](../../../docs/loop/COORDINATOR.md). Read it in full before step 1; it is the one maintained source of the procedure, and this skill adds only what is specific to Cursor.

In Cursor:

- Call the specialists through Cursor's real agent tool. They are defined in `.cursor/agents/`, generated from `docs/loop/roles/`.
- A foreground call is a normal subagent call; an unattended run calls them in the background.
- The question-form tool you must not use for your own questions unless Niclas asks for it is `AskQuestion`.
- Read-only specialists run with `readonly: true` and cannot write their own reports; the coordinator saves them as [the handoff contract](../../../docs/loop/HANDOFF.md) states per role.
- Cursor does not prevent a subagent from starting child subagents; the flat call structure is our policy, stated in every specialist's instructions.
