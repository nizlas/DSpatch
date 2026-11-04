---
id: DSP-173
title: >-
  Resource governor: observe system pressure on the host and hold DSpatch's own
  heavy work and new loop steps under sustained pressure
status: Review
assignee: []
created_date: '2026-11-04 14:50'
updated_date: '2026-11-04 15:07'
labels:
  - host
  - linux
  - loop
dependencies: []
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 4 November 2026. In a real DSpatch 0.1.4 loop on Linux the machine became extremely slow; the run log showed heavy file operations (large head -c, Python reads of tens to hundreds of MB, repeated test runs) but no CPU, memory or swap measurements, and the cause is not established. Shell commands in steps are run by the provider's shell tool, not by DSpatch. First version: a cheap periodic monitor on the host (Linux first: PSI where available, available memory, swap and I/O activity, load per CPU), health states GREEN/YELLOW/RED/UNKNOWN with hysteresis and duration, modes off/observe/enforce (observe by default), journalled mode changes and the mode each step started under. In enforce: YELLOW is mild throttling, RED defers DSpatch's own heavy non-critical work and holds the start of new loop steps, with a bounded, stoppable wait that ends in a stated outcome. Never delays transport, heartbeat, Stop, journalling or recovery; a deferred snapshot is a missing observation, never an unchanged or verified one; already running provider commands are not paused, killed or reprioritised and can go on loading the system. Does not claim the 0.1.4 incident is solved.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The governor can be turned off, observe or enforce by configuration, observe by default, and reports its health state and why
- [x] #2 Under injected sustained pressure in enforce, the start of a new loop step and DSpatch's own heavy observation are held or deferred, and every hold, deferral and skip is in the run journal with a timestamp and reason
- [x] #3 A wait for resources is bounded, ends in a stated outcome and is ended at once by Stop
- [x] #4 A deferred or skipped snapshot is never read as unchanged files, a passed verification or a known outcome
- [x] #5 Missing or unreadable measurements are unknown, not GREEN; short spikes, high CPU use alone and swap already in use do not trigger protection; recovery needs a sustained calm period
- [x] #6 Existing loop flows pass their tests unchanged with the governor in observe
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
4 November 2026 — first version (MVP), Windows home computer; Linux not run.

Governing decisions: the host owns the work and its durable state, and Stop work and ending the host are separate actions (RUNTIME_PLATFORM_ROADMAP section 2, unified standalone host, 2 Nov 2026); unknown execution state is neither success nor permission to go on, and an incomplete observation is never unchanged (roadmap section 2, storage rules; AGENT_BEHAVIOUR_AND_ORCHESTRATION section 2, observation is runtime behaviour); a paused run keeps its history and waits for a person (LoopRunController, DSP-29/30). Within those, this adds no new control boundary: it holds a step through the existing step-release port and defers only DSpatch's own observations.

Design.
- Signals (`app/src/main/resource-governor.ts`), read every 5 s, one read at a time, only while a loop run is going, Linux only: PSI avg10 for memory, io and cpu (`/proc/pressure/*`), MemAvailable/MemTotal (`/proc/meminfo`), swap-in+out pages per second between two reads (`/proc/vmstat`), the 1-minute load over the CPUs this process may use (`/proc/loadavg`, only when the kernel has no PSI). A file that cannot be read leaves its signals unknown and is named; all unknown is UNKNOWN, never GREEN. Elsewhere nothing is read: UNKNOWN, behaviour unchanged.
- Levels, default thresholds: RED for PSI memory full ≥ 10, PSI io full ≥ 30, or memory available ≤ 5 % while swapping ≥ 1000 pages/s. YELLOW for PSI memory some ≥ 10, PSI io some ≥ 30, PSI cpu some ≥ 80, memory available ≤ 10 %, swapping ≥ 200 pages/s, or (without PSI) load per CPU ≥ 2. CPU stall and load reach YELLOW at most; swap in use counts for nothing, only swap traffic.
- Steadiness: a level is entered after its readings have held for 15 s and left after 60 s calm below it, to the highest level seen in the calm period. A first reading showing pressure has to hold too. The health starts over at each run.
- Modes: `DSPATCH_RESOURCE_GOVERNOR` = off | observe | enforce, or `resource-governor.json` in the host's data folder (mode, timings, thresholds); the environment wins; observe by default; anything not understood is ignored and logged.
- In enforce, at the start of a new loop step (`GovernedRunControl`, wrapping the run's `LoopRunController` at the existing step-release port, before `node-entered`, so the step's time bound has not begun): the person's pause, interactive mode and Stop are asked first and unchanged; YELLOW waits 5 s; RED waits for the health to fall below RED. Stop ends either wait at once (the step is not started). After 5 min under RED the run asks for a pause and waits for a person, as a pause does; it neither goes on by itself nor ends. After any wait the run's own control is asked again, so a pause asked for meanwhile still holds.
- In enforce, under RED, DSpatch's own snapshots of the folders at an agent's shell command (start and end, and the metadata fingerprint before them) are skipped. Such a command is recorded exactly as a late observation already is: not observed at its moment (`testedSnapshotId`, `afterRunSnapshotId`, `changedWhileRunning` and `currentAtEnd` null), so it is never current and a `met` resting on it does not stand. The step's own before and after snapshots are not deferred: without them the step's outcome could not be checked, and the approval rule would turn every success under RED into a fallback.
- Never delayed: transport, heartbeats, Stop, journalling, recovery, a gate's own command, a step already running. Nothing is paused, killed or reprioritised. A command a provider already runs with its own shell tool (Claude Code's Bash, Cursor's and Copilot's shell) runs inside the provider's runtime and is not touched: it can go on loading the machine whatever the health. What DSpatch can hold before it starts: the next loop step's provider turn (the one `adapter.send` per step), for every provider alike; it cannot hold a command inside a turn.
- Journal: a new kind `resource-governor` (appended to the vocabulary; older records parse unchanged): one line when the run starts (mode, health, what is unknown), one per change of the health with its reasons and time, one per hold, release and pause for a person, and one per step for deferred command observations (the first at once, the count at the step's end). `run-held`/`run-released` carry `hold: resources`. Each work step's `node-entered` carries `resourceGovernor`, `resourceHealth` and, after a hold, `resourceHeldMs`. In the chat loop's conversation only what DSpatch did is said (`acted`); observe adds no lines there. The host log says each change: `resource governor (observe): GREEN → RED: memory stalled (PSI full) 35 ≥ 10; …`.

Verification, Windows, uncommitted tree on aaa2d86: typecheck; fast group 1519 passed, 2 skipped (with the new `resource-governor.test.ts`, 22 tests: one reading, spikes, sustained pressure, recovery, unknown signals, unreadable files, the sampler's parsing and swap rate, no overlapping reads, YELLOW pause, RED hold and release, the bound, Stop during a hold and a pause, UNKNOWN changing nothing, configuration; and `resource-governor-run.test.ts`, 6 tests: the development loop walked with the real LoopRunController in observe, enforce with a hold and release, Stop during the hold, the bound pausing for a person until Continue, off, and a command with no observation never current); `loop-agent-commands.test.ts` gained a Cursor walk with every command observation deferred: all three commands recorded as not observed, the run does not reach done, and the journal says so. The live group 121 passed (the real loop walks, snapshots, gate commands); the host group 140 passed, 2 skipped as before. A demonstration script printed the journal lines of both modes from injected readings; no load was generated. One existing test was extended: the journal vocabulary test pins the new kind's position at the end.

Known limits: Linux only, and not run on Linux yet; no PSI on older kernels (fallbacks are memory, swap traffic, load); the editor's run writes no run record, so its journal lines reach the windows only; a step already running is never slowed; review jobs, the chat's own snapshots and other host work are not governed in this version; thresholds are first guesses to be set from observe-mode records. The 0.1.4 incident's cause is still not established; this gives records to find it, not a fix for it.
<!-- SECTION:NOTES:END -->
