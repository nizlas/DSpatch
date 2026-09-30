---
id: DSP-16
title: Contain the agent to the chosen project
status: Review
assignee: []
created_date: '2026-09-15 15:38'
updated_date: '2026-09-15 20:06'
labels:
  - security
milestone: m-0
dependencies:
  - DSP-2
documentation:
  - docs/VISION.md
ordinal: 12000
---

## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
### Purpose and intended result

DSpatch refuses to point an agent at its own source, so a mistake cannot have the tool rewrite itself while running. Verifier 010 measured two holes in that refusal, and Reviewer 011 asked for them to be closed as a task of their own rather than carried as a warning in the README.

### The two measured holes

The guard compares the chosen folder against the DSpatch repository root. Choosing `<repo>\app` is therefore accepted, although it is DSpatch's own source. Separately, the guard identifies the project by reading `app/package.json`; if that file cannot be read or parsed, the guard allows the choice. A safety check that fails open is worse than one that is absent, because it is trusted.

`DSPATCH_PROBE_REPO_ROOT` was found during the DSP-2 to DSP-4 delivery as a way to close the first hole without rebuilding. It is a mitigation for a trial, not a design. An environment variable that a user must remember is not containment.

### Scope and proposed approach

Resolve the repository that contains the chosen folder, by walking up from the folder, and compare that against DSpatch's own repository. Refuse on any subfolder of it. Make an unreadable or unparsable manifest refuse rather than allow, and say why in the refusal. Keep the message specific enough that a user who has legitimately opened an unrelated project understands what was checked.

Cover the behaviour with tests that fail if the guard is removed, including a legitimate project that must still be allowed. Then correct the README so it describes the guard's real reach rather than pointing at the environment variable.

Keep this bounded. Containment of what an agent does once inside a project is a larger question and is not in scope here; this task is only about which project can be chosen.

### References

Verifier report `.dspatch-loop/runs/20260914-205132-nt4m/reports/010-verifier-artifact.md` and Reviewer report `011-reviewer-dsp2-dsp4.md` in the same run.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The own-project guard resolves the repository containing the chosen folder rather than matching the folder itself, so a subfolder of DSpatch is refused.
- [ ] #2 An unreadable or unparsable project manifest makes the guard refuse rather than allow.
- [ ] #3 Automated tests cover the subfolder case, the unparsable-manifest case and a legitimate unrelated project, and fail if the guard is removed.
- [ ] #4 The README describes the guard's actual reach without relying on an environment variable as the remedy.
- [ ] #5 A chosen folder that contains DSpatch's own working copy is refused too, naming the reason and pointing at choosing the specific project instead.
<!-- AC:END -->
