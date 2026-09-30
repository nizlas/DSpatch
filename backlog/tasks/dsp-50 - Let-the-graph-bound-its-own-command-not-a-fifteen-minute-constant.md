---
id: DSP-50
title: 'Let the graph bound its own command, not a fifteen-minute constant'
status: To Do
assignee: []
created_date: '2026-09-18 17:36'
labels: []
dependencies:
  - DSP-45
priority: high
type: bug
ordinal: 15597
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The graph's maxMinutes does not bound the command. main.ts calls runConfiguredProjectTest with two arguments, so the real bound is DEFAULT_GATE_COMMAND_TIMEOUT_MS at fifteen minutes, and raising the graph's limit to 45 for a real C++ build did not achieve what it looks like it achieved. A full build that meets the constant is reported as did-not-finish with a warning that the process may still be running, which is honest and is a bad first experience. loop-live.ts already says in a comment that this bound is planned to become a per-node budget owned by the graph editor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A project whose build legitimately takes longer than fifteen minutes is not reported as having failed to finish.
- [ ] #2 What bounds a command is visible to the person before they press, rather than being a constant in the code.
<!-- AC:END -->

## Disclosure while this is open (call 007)

<!-- SECTION:NOTES:BEGIN -->
Not fixed, but **disclosed at the moment it matters**. The sentence beside the confirmation button now reads: "If you do run it, DSpatch gives the command 15 minutes and stops it if it has not finished by then — which a large CMake build can reach." The figure is taken from `DEFAULT_GATE_COMMAND_TIMEOUT_MS` rather than written out, and a test asserts that, so the sentence cannot drift from the constant that enforces it.

This matters more now than when the card was written, because the confirmation sits in front of the build: the worst path is that the person waits, presses *Run this command*, and fifteen minutes later reads that the command may still be running.

Also unchanged and belonging here: the ten-minute confirmation wait runs inside the gate step's own bound, so waiting for a person spends the same budget as running the command. DSP-51 makes that visible, which is the most a string can do.
<!-- SECTION:NOTES:END -->


## Superseded in part, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
Cancelled as written. The fifteen-minute constant bounded a command **DSpatch spawned**, and the loop no longer spawns one. The real bound is now the provider's own 30-second default on an agent's shell tool, measured on this machine and raisable by the agent itself (probe 3: the agent set 90 000 ms and an 81-second command completed with its output intact). That makes it a line in the role's prose, not a setting in the orchestrator — which is where the corrected division puts it. Anything still wanted here belongs to the Build-and-test panel, which keeps its own bound.

Governing text: [INTERACTION_MODEL.md](../../docs/INTERACTION_MODEL.md). Correction under way in run `20260919-012200-agency`.
<!-- SECTION:NOTES:END -->
