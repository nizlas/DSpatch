---
id: DSP-183
title: 'Release 0.1.11: a Linux-only pre-release from main with the build-identity fix'
status: Review
assignee: []
created_date: '2026-11-09 09:00'
updated_date: '2026-11-09 12:00'
labels:
  - release
dependencies:
  - DSP-182
ordinal: 102000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 9 November 2026: a pre-release from the latest main with a working `.deb` for Linux x64, the matching Linux host package, the manifest and SHA256SUMS, so that he can install DSpatch on his work computer and review code. Follows the release process in docs/INSTALL.md: version commit and notes, a local package from the clean commit, `linux-verify`, the packaged trials and the upgrade trial in a container, the tag, the package workflow's publication, checks of the published files and `release.mjs --published`.

Windows is not part of this release. The Windows uninstaller's Bitdefender problem and the remaining Windows window trials stay open in DSP-182, which is not marked done. Because a tag build also built and published the Windows installer and the Windows host package, the package workflow gets the smallest change that lets one tag publish Linux only: an optional `docs/releases/<tag>.json` (`{"platforms": ["linux"], "prerelease": true}`).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Version 0.1.11 committed with user-facing notes that state the known limits; the workflow can publish a tag for Linux only, as a pre-release, without building or publishing Windows artifacts
- [x] #2 The .deb and the Linux host package carry one build identity from the release commit and no Windows runtime files; linux-verify, the packaged trials and the upgrade trial pass, with limits stated
- [x] #3 v0.1.11 published as a pre-release with the .deb, the Linux host package, the manifest and SHA256SUMS; the published files checked and the installed smoke test run against the published release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Started 9 November 2026 on Linux. main fast-forwarded from 32030e3 to origin/main 65180d9 (no local unpushed commits, clean working copy); tags up to v0.1.10 (a pre-release with the Windows installer, built before the build-identity fix e5866b9); v0.1.11 free.

Release commit 892d379 (version 0.1.11, docs/releases/v0.1.11.md and .json, the workflow change), pushed to origin/main by fast-forward; annotated tag v0.1.11 on it. The package workflow's tag run 42598389154: plan (windows=false, prerelease=true), hosts-and-deb and publish-release succeeded; windows-installer and windows-install-trial were skipped. Published https://github.com/nizlas/DSpatch/releases/tag/v0.1.11 as a pre-release with exactly four files:
- dspatch_0.1.11_amd64.deb, 287947464 bytes, sha256 eb811cdb75f01032401a8f496dabdfc6c921da716ecdc243041d9987bc514fb3
- dspatch-host-0.1.11-892d3799dbaf-linux-x64.tar.gz, sha256 9fce04df57c8bc26eaba23cab6b049bc480c8f23a4eeec3009b2ed3752ee0c13
- host-manifest.json (hostId 0.1.11-892d3799dbaf, contract 6a653107b43c8617, linux only), SHA256SUMS

Verification (Linux, 9 November 2026; isolated profiles, throwaway neutral projects, simulated provider; window trials on the trial's own Xvfb with openbox, X tools unpacked into a scratch folder with apt-get download, never the user's display; Niclas's own host, profile and settings untouched):
- linux-verify on 892d379, run 42588962762: all jobs green (tests, provider-tests, governor, the zoom trial 78/78, the dock trial 54/54, the profile trial 85/85, from source).
- Local package of 892d379: client and bundled host carry the same build identity (digest a8c17c51…, revision 892d379, no dirty files); the bundled manifest equals the host package's; no PE executables, DLLs or win32 runtime packages in the .deb or the host package; Depends as before (libasound2 | libasound2t64, openssh-client, git …).
- Against the local package (DSPATCH_TRIAL_CLIENT): profile trial 85/85, dock trial 54/54, zoom trial 78/78 on a second run (the first stopped at 'undocked again', see below).
- Upgrade in the container from the published v0.1.9 to the local 0.1.11 .deb (upgrade.mjs --from v0.1.9 --to): 30/30. The new client met the running 0.1.9 host in the window (*Restart needed to finish updating*, Restart host), attached to it rather than starting a second one, and Restart host replaced it with the 0.1.11 host (commit 892d3799dbaf, digest a8c17c51); conversation, agent choice, project, own loop, review with its delegated result, and window and review zoom kept.
- release.mjs --stage stopped after 5 passing checks (the .deb matches SHA256SUMS and installs; no Node or npm; Connect installs the carried host with github.com unreachable; nothing asked of GitHub) and hung at the restart with a github.com substitute, the same trial defect as for 0.1.7 and 0.1.8; stopped by hand after 50 minutes, containers removed. Covered by --published.
- Published files: downloaded, SHA256SUMS OK for all three; the published .deb's build identity equals the local build's (a8c17c51…, 892d379) and its bundled manifest equals the published one. release.mjs --published: 14/14, including the installed client's first start and a simulated Copilot turn on the host. Against the published client: profile trial 85/85, dock trial 54/54.

Not established, or found:
- The zoom trial against the packaged client stopped twice out of three runs (once local, once published) at 'undocked again': after dock → undock → dock, the third press of the panel's own-window button left the panel docked for 20 s; the panel page was rendered (CDP screenshot) while the X capture showed the docked area blank. From source on the CI runner it passed, and on one local packaged run. Whether this is the trial's timing or a product defect in the docked panel's third transition is not known; to be investigated.
- thread-trial.mjs (DSP-175) is stale after DSP-181: Standard is now the default, so a question asked with Ask from a step's explanation goes as a profile follow-up and the simulator answers in that form, without the 'You selected this text' line the trial expects; it stopped at check 76 of the docked Ask (the quote and its origin were sent, check 75). Not a release blocker; the trial needs updating.
- Windows: no Windows artifacts in this release. DSP-182 stays open (the uninstaller under Bitdefender, the window trials on Windows) and is not marked done.
- Real-provider explanation quality; distributions other than Ubuntu 24.04 (container) and Niclas's work machine; arm64.
<!-- SECTION:NOTES:END -->
