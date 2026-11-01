---
id: DSP-162
title: First non-prerelease release
status: Done
assignee: []
created_date: '2026-11-01'
labels: [release]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Integrate, verify on the final code, build the Linux and Windows clients and host packages from one product commit, publish matching manifest and checksums, check the real download and an install of the published Linux package, and keep README, tutorial and limitations true.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Product commit a99d1e9, version 0.1.1 (the next after v0.1.1-rc.1). Packaged trials on those packages, all SIMULATED provider or local stand-ins: continuity 36/36, run 38/38, setup 44/44, hooks 17/17, release --stage 11/11. Tests compared by name with 2a0985a: the same failures on both and no new ones. On Linux these are Windows path fixtures, CRLF in generated role files, ENOTDIR wording and tests needing Windows-only conditions; the heavy group exceeds its time bound on both, so its files were run one by one.

Windows: installer and host package built, PowerShell steps parsed by PowerShell, path logic unit-tested. An install under Wine did not complete, so nothing Windows was run.

Observed and left: Enter is ignored while the provider's model list is read after Repair, and the text stays in the box.
<!-- SECTION:NOTES:END -->
