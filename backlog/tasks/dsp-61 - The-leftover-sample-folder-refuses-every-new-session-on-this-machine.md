---
id: DSP-61
title: The leftover sample folder refuses every new session on this machine
status: Review
assignee: []
created_date: '2026-09-19 14:46'
updated_date: '2026-09-19 17:24'
labels: []
dependencies: []
priority: high
type: bug
ordinal: 15618
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while driving the window in run 20260919-142600-converse. The default generated-project path %TEMP%\dspatch-chat\duration-repo holds a full sample project from 14-16 September that has no .dspatch-experiment marker, because it predates the marker. The generator therefore refuses it: it is not empty and has no marker, so it was not generated here and may be someone's work. The refusal is correct and the guard should not be weakened - it is the thing standing between a loop run and someone's real directory. But the consequence is that New session with the default path fails on this machine forever, and the message does not say what to do about it. Either the marker is written into that folder, or the refusal names the way past it. In the run where this first bit, the script then sat waiting for a session id and had to be killed, so a failed prerequisite produced no record at all - worth knowing about the harness.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A person who meets this refusal is told concretely how to proceed.
- [ ] #2 The guard against using a directory DSpatch did not generate is not weakened.
<!-- AC:END -->


## Niclas's decision, 19 September 2026

<!-- SECTION:NOTES:BEGIN -->
This is now blocking **Use a generated sample project** in the application itself, not only the test harness, so it is raised and given its shape.

**Make it work without manual deletion.** A new sample project goes in its own fresh folder. Cleaning up old app-created sample folders is a **separate action**, not something a new session does on the way past. The refusal that started this is correct and stays: **the user's own project directories are never touched**, and a folder DSpatch did not create is not DSpatch's to remove.

The distinction that makes this safe is the one already in the code — whether DSpatch created the folder — and the leftover at `%TEMP%/dspatch-chat/duration-repo` is precisely the hard case, because DSpatch *did* create it but before the marker existed. Treat an unmarked folder in DSpatch's own sample location as **old app-created content that may be cleaned up on request**, and an unmarked folder anywhere else as **not ours**.

**Verify this exact case**: an old, locked, unmarked sample folder present, a new session started, and the new session succeeding in its own folder. **No provider calls** — this is about folder handling, and a model turn would prove nothing about it. Proportionate verification applies: check what changed.
<!-- SECTION:NOTES:END -->
