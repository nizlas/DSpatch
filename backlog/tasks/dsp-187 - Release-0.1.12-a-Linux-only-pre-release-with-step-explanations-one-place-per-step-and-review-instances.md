---
id: DSP-187
title: >-
  Release 0.1.12: a Linux-only pre-release with step explanations apart from
  the discussion, one place per step and reviews as instances
status: Review
assignee: []
created_date: '2026-11-09 18:00'
updated_date: '2026-11-09 18:00'
labels:
  - release
dependencies:
  - DSP-184
  - DSP-185
  - DSP-186
ordinal: 106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 9 November 2026: after DSP-184, DSP-185 and DSP-186 are implemented and verified, publish a Linux pre-release with the x86_64 .deb, the matching Linux host package, the manifest and SHA256SUMS through the existing release flow (the tag's docs/releases/v0.1.12.json keeps it Linux only and a pre-release), verify the packaged and installed client and the build identity, and publish no new untested Windows artifacts. DSP-182 stays open.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Version 0.1.12 committed with user-facing notes stating the limits
- [x] #2 Client and host carry one build identity; packaged trials, upgrade from 0.1.11 and linux-verify pass
- [x] #3 Published as a Linux-only pre-release; files checked; installed smoke test against the published release
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
9 November 2026, Linux. Release commit 7441761 (version 0.1.12, docs/releases/v0.1.12.md and .json), pushed to origin/main by fast-forward from 6ece045 (no force); annotated tag v0.1.12. The package workflow's tag run: plan (Linux only, pre-release), hosts-and-deb and publish-release succeeded; the Windows jobs were skipped. Published https://github.com/nizlas/DSpatch/releases/tag/v0.1.12 as a pre-release with four files:
- dspatch_0.1.12_amd64.deb, 288039644 bytes, sha256 2aaccaccb706a70e0835d7f701bc3d4f44e205a162792a3078b4aca1dafed177
- dspatch-host-0.1.12-7441761393ff-linux-x64.tar.gz, sha256 a084aed93a896e55146f5bcd12ba899329001a3493826a8c91acff6394ad005f
- host-manifest.json (hostId 0.1.12-7441761393ff, contract 22f78105b1a0dcac, linux only), SHA256SUMS

Verification (isolated profiles, neutral throwaway projects, simulated provider; window trials on their own Xvfb with openbox, never the user's display; Niclas's own host and data untouched):
- Before the tag, on 7441761: typecheck clean; fast 1631, review 319, presentation 317, host 149, chat 362 passed, 0 failed; linux-verify run 42629227787 green.
- Local package: client and bundled host carry one build identity (digest ec67bba3…, revision 7441761, no dirty files); the bundled manifest equals the host package's; no PE executables or DLLs (the host package carries the koffi library's C sources, as earlier releases did, not Windows runtime files).
- Against the local package: walk 20/20, profile 100/100, thread 111/111, dock 54/54, zoom 78/78, review-instances 47/47.
- Upgrade in the container from the published v0.1.11 to 0.1.12 (upgrade.mjs): 27/27. The host contract changed, so the new client met the running 0.1.11 host with the dialog before any window, as the notes say; the review made by 0.1.11 with its delegated result, the conversation, agent, project, own loop and zoom were kept.
- Published files: SHA256SUMS OK; the published .deb's build identity equals the local build's and its bundled manifest equals the published one. release.mjs --published 14/14. Against the published client: walk 20/20, profile 100/100, review-instances 47/47, dock 54/54.

Qualitative check of the profile instructions (not a DSpatch feature, not evidence about Niclas's provider): Claude subagents outside DSpatch's providers answered DSpatch's exact prompts (scripts/explain-prompt.mjs) for a synthetic producer/worker step, and a separate subagent judged them on understanding with Niclas's three questions. After three rounds of generic instruction changes: Standard achieved understanding (the handover and why only the start-up notification can be lost; ownership versus synchronisation); Teacher mostly (defines the terms, states what a wait releases and takes back); Essentials partly — correct and decisive, but its short part still tends to two long sentences. The final texts and the context they were written from were given to Niclas (app/release/profile-examples-0.1.12.md, not in Git). Real-model quality on real code is Niclas's judgement in the app.

Not established: Windows; other distributions; arm64; a real provider.
<!-- SECTION:NOTES:END -->
