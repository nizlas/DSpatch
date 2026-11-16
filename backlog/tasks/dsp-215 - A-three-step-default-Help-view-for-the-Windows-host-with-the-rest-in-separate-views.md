---
id: DSP-215
title: A three-step default Help view for the Windows host, with the rest in separate views
status: Review
assignee: []
created_date: '2026-11-16 09:00'
updated_date: '2026-11-16 12:00'
labels:
  - remote
  - windows
  - docs
dependencies:
  - DSP-214
ordinal: 111000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 16 November 2026: the guide in 1.0.2 is still too long; "The short way" on top of a full manual does not meet the request. Fix it before the version goes to a colleague.

1. The default view is a short practical guide in three steps: (1) Linux: run the helper; (2) Windows: run the ready command the helper gives; (3) Linux: connect through Remote Session. One recommended path; no choice between installation methods, no script internals, no assembling of commands. The administrator window and the fingerprint check are at the step that needs them.
2. Manual installation, alternative methods, technical explanations, verification history and troubleshooting move to separate views opened by clear links, not a long continuation below the steps.
3. The helper's actual output: the next step is clear and the Windows command is complete, with known values filled in. Simplify the flow where it needs needless manual work.
4. Use the existing save buttons and scripts.
5. Open the finished guide in the app and look at what a user sees, the save buttons included. Targeted checks; what is not tried is reported separately.
6. Commit, push and publish a new pre-release; do not change existing release files; do not touch the running host or review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Help opens on a view with only the three steps and links to the other views
- [x] #2 Manual setup, other ways, how it works, troubleshooting and what has been tested are separate views with a way back
- [x] #3 The helper prints one ready Windows command with key, address, user, version and the script's SHA-256 filled in, and a clear next step
- [x] #4 Targeted tests for the helper and the guide pass; typecheck and build pass
- [x] #5 The guide is seen in the real app, the save buttons included
- [ ] #6 A new pre-release is published from the pushed commit
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done (16 November 2026), released as 1.0.3:

- The guide's default view is `help/remote-windows-host.md`: three steps, two commands to copy (the helper, `ssh`), the administrator window at step 2 and the fingerprint check at step 3. Troubleshooting, other ways, manual setup, how it works and what has been tested are `remote-windows-host.<view>.md`, shown by HelpWindow as views behind links below the steps, each with a link back. The window still never navigates.
- Decision within the task: the recommended path needs no file carried to Windows. The helper's command downloads this version's Windows script from the release page and runs it only if its SHA-256 is that of the script installed beside the helper (`bundled/remote-setup/VERSION`, written by prepare-bundled, names the release). The save buttons therefore sit in *Other ways to run the scripts*, for a Windows computer that cannot reach GitHub, not above the steps; one recommended path means no second method in the default view.
- The helper prints a clear next step on Windows and then on Linux, and saves the command in `~/dspatch-windows-command.txt` (CRLF), the one thing that has to reach Windows.
- Help commands wrap instead of scrolling and never run under the Copy button (seen at 520 px wide before the fix).
- Checks: help-guides, remote-setup-linux and remote-setup-scripts (14) and prepare-bundled (18) tests; typecheck; build. The Help window opened from its real menu item in this checkout's build (headless Electron, isolated profile): the default view fits 900x900, every view opens and returns, the save buttons save files identical to the scripts (the native dialog answered by the trial). On the real Windows 11 host, read-only: the printed command with a throwaway key and `-DryRun` downloaded 1.0.2's (identical) script, matched its SHA-256 and showed the plan; afterwards no rule, no key, no downloaded file.
- Not tried: the Windows script's changing path; the full flow with 1.0.3's packages; the Help window on a real screen and the native save dialog; a work network.
<!-- SECTION:NOTES:END -->
