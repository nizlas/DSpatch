---
id: DSP-197
title: >-
  Profile calibration: the first part judged for being too thin or too dense, in
  the prompts and the loop reviewer (instruction version 11)
status: Review
assignee: []
created_date: '2026-11-11 17:49'
updated_date: '2026-11-11 17:49'
labels:
  - review
dependencies:
  - DSP-195
  - DSP-196
priority: medium
type: enhancement
ordinal: 116000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Made on 11 November 2026 by Copilot in Niclas's work environment, while this repository's Claude Code session was unreachable; this task records it afterwards (the commit names DSP-197, but no task file existed). Commit a73f68f raised PRESENTATION_INSTRUCTION_VERSION to 11 and changed three instructions: the shared scope rule (EXPLANATION_TASK[3]) gained 'Keep the first part readable for this reader: when the main point is already clear, move secondary detail to the part after the marker rather than crowding the first part.'; Standard's reader gained 'Keep the first part compact enough that the mechanism stays in view: examples or side mechanics that do not change that understanding belong after the marker.'; the loop reviewer gained the check 'Is the first part calibrated for this reader: enough to stand on its own, but not so dense or verbose that the main point is hard to see? A short part that is too thin or too crowded for this profile is an explanation shortcoming.' The pinned tests were updated, and release notes for 0.1.21 were written (docs/releases/v0.1.21.md). Commit b842a87 added retries to the packaged trial's image build.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The instruction changes above are made at version 11 and the pinned tests pass
- [x] #2 Linux pre-release 0.1.21 is published with the .deb, host package, manifest and checksums, and the published upgrade trial is green
- [ ] #3 Niclas judges whether the version 11 wording fits the decided design and the profiles' texts in his own use
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Release (completed by Claude Code on 11 November 2026): the tag v0.1.21 (b842a87) failed three package runs in the trial image build, because archive.ubuntu.com could not be resolved inside Docker's bridge network while the runner's own downloads worked. The retry b842a87 added could not take effect, since apt-get update exits 0 when every index fails. A rerun of the failed jobs (run 43042140478, attempt 2) passed and published v0.1.21 with dspatch_0.1.21_amd64.deb, dspatch-host-0.1.21-b842a87a9474-linux-x64.tar.gz, host-manifest.json and SHA256SUMS; the notes were set from docs/releases/v0.1.21.md. The first published upgrade trial (run 43065836352) failed the same way; commit 74ad8fa builds the trial image with --network host in package.yml and linux-verify.yml and adds --error-on=any to the apt retry, and the published upgrade trial from v0.1.20 (run 43066185767) then passed, 30 checks. Not done: a linux-verify run of the test groups on a73f68f (the package workflow's own tests passed), and any real-model run at version 11.

Points for Niclas's judgment (possible departures from decided design, not resolved here): (1) DSP-195's brief said no extra brevity rule on top of a completeness requirement; version 11 adds a rule to move secondary detail behind Show more and a reviewer check against too dense or verbose text. (2) DSP-196 observed that facts moved behind Show more turn the deepening into an inventory; the reference (section 4) says Show more is not a dump of what the short part left out. (3) The reference (section 4) keeps Standard as it works as the comparison point; version 11 changes Standard's reader. (4) The 0.1.21 notes lack the usual paragraph on the host contract and Restart host, although the host builds the instructions. (5) The commits a73f68f and b842a87 carry a work email address as author in this public repository.
<!-- SECTION:NOTES:END -->
