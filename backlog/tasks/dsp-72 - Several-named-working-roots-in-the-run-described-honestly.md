---
id: DSP-72
title: 'Several named working roots in the run, described honestly'
status: Review
assignee: []
created_date: '2026-09-20 09:03'
updated_date: '2026-09-20 12:44'
labels: []
dependencies:
  - DSP-70
priority: high
type: feature
ordinal: 15703
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Compare two repos; read code in one and port it to another. The run model carries an ordered list of named roots with one primary. The SDK does support this: LocalAgentOptions.dirs takes additional multi-root workspace folders merged with cwd, so project rules, skills and workspace metadata load from every unique path, which gives the roots real provider standing rather than only a sentence in a prompt. But dirs is a LOADING mechanism and grants no permission, SandboxOptions is a bare enabled boolean with no notion of folders at all, and DSP-1 measured an agent writing outside the folder it was given. So no string in the UI or the prompt may read as a restriction: working folders for this run is fine, the agent is limited to these folders is a defect. Detection is not containment, and a list a user believes is a boundary is worse than no list. Two subtleties: cwd scopes the local agent store, so which root is primary is part of the resume key; and adding a folder silently loads that project's rules and skills into the agent, which is reasonable and is also a surprise unless it is said.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A run with two roots records both, with names, and passes them as cwd plus dirs.
- [ ] #2 The agent's prompt names both paths and says which is the working directory.
- [ ] #3 The record reports changed paths per root, with a negative control in both directions.
- [ ] #4 The record states that folders outside the named roots were not observed.
- [ ] #5 A root that is DSpatch's own working copy is refused, naming which root.
- [ ] #6 No UI or prompt string asserts a restriction.
- [ ] #7 A second root's rules reaching the agent is measured rather than assumed.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Delivered in run 20260920-104500-folders, calls 010 and 012. A run carries an ordered list of named working roots with one primary; the primary is the project the chat session opened and every other open folder joins it. Passed to Cursor as cwd plus dirs on create AND resume, named in the prompt, measured per root, guarded per root. A one-root run produces the same adapter call, the same prompt byte for byte, one tree walk and the same refusal as before - asserted by comparing the one-root prompt with the no-roots prompt.

WHAT THIS PROVIDES, PLAINLY: no isolation at all. It gives the folders real standing at the provider, attribution afterwards through per-root diffs, and a named scope in the prompt. None of those is containment. The list is not consulted when a tool call happens; nothing is denied and nothing is even detected. A file written outside every root leaves NO TRACE, which is why the record says 'not observed' and never 'none'. A test writes such a file, confirms it on disk, and asserts it appears nowhere in the measurement.

MEASURED, NOT REASONED, and reproduced exactly by the Verifier on an independent run: one root reads 36 paths under A and 0 under B; two roots read 36 under A and 32 under B. Two rules services rather than one. The Verifier also settled the artefact question - prewarmLocalWorkspace and a real agent's getExecutor() resolve to the same bundled function, so the probe is not a side door. DSP-1's containment measurements were reused rather than repeated. No provider turn was spent on any of it.

SO: adding a folder to the workspace silently loads that project's RULES AND SKILLS into the agent. Not its MCP servers and not its hooks - those come from the working directory only, on both paths. The implementer first claimed MCP and hooks too; its own log disconfirmed that and the Verifier caught it. The test that let it through asserted a literal phrase and now checks membership against lists drawn from the probe log, so putting MCP back into the sentence fails.

The roots reach the provider ONLY on a loop run. An ordinary chat message gives the agent the working directory alone. The on-screen note now names the path for every claim rather than describing a loop run's behaviour whenever a folder is open.

DECISIONS: a root containing DSpatch refuses the WHOLE RUN, naming every offending root, rather than dropping it - dropping would refuse nothing while looking protective, and would change the assignment behind the user's back. DSP-71's decision not to store a second conversation pointer was reopened deliberately and KEPT: working roots stopped being singular, the working directory did not, and cwd is the provider's own resume key.

Verified in report 011 (PASS WITH FINDINGS); all three findings closed. Candidate sha256:538ece71. 822 fast tests, 55 live, 0 fail. UX acceptance HUMAN_PENDING.

STILL OPEN: no run with two roots has actually walked, so what an agent DOES with two roots is unobserved. Per-root measurement is proven with a fake adapter. Two roots cost two tree walks per step and nothing measures that cost. dirs on resume is unexercised - the Verifier judged it not worth its own card since create and resume call the same function, and recommends folding the check into whichever card spends the first two-root provider turn.
<!-- SECTION:NOTES:END -->
