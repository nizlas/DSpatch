---
id: DSP-214
title: Prepare a Windows SSH host with one script and a short Help flow
status: Review
assignee: []
created_date: '2026-11-15 23:45'
updated_date: '2026-11-16 00:30'
labels:
  - remote
  - windows
  - docs
dependencies:
  - DSP-212
  - DSP-213
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's request of 15 November 2026: the Windows-host guide (DSP-212) is too long as the normal path. Keep it as reference and troubleshooting, and make the main flow short with automation.

1. A bundled Windows PowerShell script, `dspatch-prepare-windows-host.ps1` (Windows PowerShell 5.1, also 7), sources under `app/remote-setup/`, that prepares the SSH host: elevated only; re-runnable without duplicate keys or firewall rules; parameters `-PublicKey`/`-PublicKeyFile`, `-User` (default the current user), `-AllowFrom` (required, no default), optional `-InterfaceAlias`, `-DryRun` (plan only, changes nothing), `-Yes`; no personal defaults. It validates the public key and refuses private keys; picks the interface with an IPv4 default gateway (by -AllowFrom's subnet, or asks); shows a plan of every change before any change and asks to proceed; installs OpenSSH Server only if absent and stops on a pending restart or a blocked install (never restarts, never bypasses policy); creates or updates its own firewall rule `DSpatch-SSH-In` before sshd starts, disables the broad `OpenSSH-Server-In-TCP` only when this run installed OpenSSH, and lists other port-22 rules; never modifies `sshd_config`, reads it to decide where the key goes (administrators_authorized_keys or the user's authorized_keys) and stops on conflicts; decides Administrators membership by SID, not by IsInRole; writes the key once, UTF-8 without BOM, with ACLs set by SID; starts sshd with automatic start; prints host key fingerprints, the ssh command and a summary. Exit codes 0 ok, 1 refused/conflict, 2 restart needed, 3 blocked by policy/IT.
2. A Linux helper `dspatch-prepare-linux-client.sh` that finds or creates a public key without overwriting anything, never prints the private key, shows the address used to reach the Windows host, and prints the exact Windows command and the ssh command.
3. Ship both: in the client's `bundled/remote-setup/` (the .deb and the Windows installer) and as release assets in `SHA256SUMS`. Help substitutes the app version so it can show the release download URL, and gets *Save Windows script…* and *Save Linux helper…* actions.
4. Rewrite the guide: a short main flow first, then *What runs where*, then the manual steps as *Manual setup (reference)* and *Troubleshooting*; fix the IsInRole advice and the icacls text.
5. Targeted tests; version 1.0.2 with release notes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `app/remote-setup/dspatch-prepare-windows-host.ps1` implements the parameters, checks, plan-before-change, idempotency, key placement, ACLs and exit codes above; every system change happens only after the plan and confirmation, and -DryRun changes nothing
- [x] #2 `app/remote-setup/dspatch-prepare-linux-client.sh` finds or creates a key without overwriting, never prints the private key, and prints the Windows command and the ssh command
- [x] #3 Both scripts are in the client's `bundled/remote-setup/` and in a release's staged assets and `SHA256SUMS`; staging refuses when one is missing
- [ ] #4 Help shows the guide with the app's version in the download URL and offers *Save Windows script…* and *Save Linux helper…*; the window still does not navigate and opens only https links outside
- [x] #5 The guide starts with the short flow; the manual setup is reference with the IsInRole and icacls errors fixed; the help-guides test keeps its rules
- [x] #6 Targeted tests for the Linux helper, the PowerShell script's static rules and the staged file list pass; typecheck and build pass
- [x] #7 Version 1.0.2 with docs/releases/v1.0.2.md and .json (pre-release); INSTALL.md mentions the scripts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
15 November 2026, Implementer. Implemented; not run on any Windows computer (the coordinator does read-only checks there), and not parsed by PowerShell (none on this Linux machine).

Files: `app/remote-setup/dspatch-prepare-windows-host.ps1` (ASCII only, so Windows PowerShell 5.1 reads it as written), `app/remote-setup/dspatch-prepare-linux-client.sh`; `scripts/prepare-bundled.mjs` copies `remote-setup/` into `build/bundled/remote-setup/`; `scripts/stage-release.mjs` exports `releaseFiles` and `REMOTE_SETUP_FILES` and stages both scripts into `SHA256SUMS` (refuses if missing; runs only when invoked directly); the package workflow already uploads everything in the stage folder. `src/shared/remote-setup.ts` names the two scripts and the channel; `openHelpGuide` adds `&version=`; `registerHelpIpc` in `main.ts` answers only a Help window and only for the two names, copying from `bundled/remote-setup` (installed) or `app/remote-setup` (checkout) after `dialog.showSaveDialog`; the preload exposes `dspatchHelp`; `HelpWindow.tsx` replaces `{{version}}` (only a version-shaped value) and shows *Save Windows script…* / *Save Linux helper…* for this guide. The window's navigation rules are unchanged.

Decisions within the request:
- Every change is in the script's `#region Changes`, called only by `Invoke-AllChanges`, which runs after the plan, the `-DryRun` exit and *Proceed?*. A conflict known at plan time (sshd_config, a user key file others may write, a UTF-16 key file) stops before any change, exit 1, rather than setting up the rest without the key.
- Elevation is the token's integrity SID from `whoami /groups` (S-1-16-12288/16384); current-user Administrators membership is S-1-5-32-544 in `whoami /groups` (includes deny-only and nested domain groups); other accounts `Get-LocalGroupMember -SID S-1-5-32-544`, falling back to ADSI. No IsInRole. Note: .NET's `WindowsIdentity.Groups` lists only enabled groups (deny-only excluded), so it is used only as an elevation fallback.
- "Fresh" (broad rule disabled) = installed by this run, or installed but sshd never started (no host keys, not running).
- -DryRun without administrator works with approximations (stated in its Notes); the real run refuses without administrator.
- Existing user authorized_keys with write access for others: no key is added, exit 1, and the icacls fix commands are printed. administrators_authorized_keys: its ACL is rewritten to exactly Administrators+SYSTEM when it differs (sshd requires it).
- The user file's owner is set with `icacls /setowner` (Set-Acl cannot give ownership to another account without the restore privilege); a failure is a note, since sshd accepts Administrators as owner.

Checked (own checks): `npm run typecheck`; `tests/remote-setup-linux.test.ts` 4/4, `tests/remote-setup-scripts.test.ts` 5/5, `tests/help-guides.test.ts` with `tests/markdown.test.ts` 19 pass; `scripts/prepare-bundled.test.mjs` 18/18; `npm run build` carries the handler, the preload channel and the buttons. Not checked: the PowerShell script on any Windows (no parse, no -DryRun, no change path); the Help window and its save dialog on screen; the packaged .deb/installer containing `bundled/remote-setup/`; staging with real release files.

Coordinator's check, 15 November 2026, on Niclas's Windows 11 computer over SSH, read-only (the script copied to %TEMP% and removed afterwards; a throwaway test key; nothing system-changing): PowerShell 5.1.26100 parses the script with 0 errors; `-DryRun -User nicla -AllowFrom <the Linux client's address>` reported the account as administrator from `whoami /groups`, interface Ethernet /24 with profile Public, OpenSSH installed and sshd running with automatic start, key file administrators_authorized_keys with its ACL already exactly Administrators and SYSTEM, a plan of two changes (create DSpatch-SSH-In, add the key), the enabled broad rule OpenSSH-Server-In-TCP explained and left alone, exit 0. Afterwards: no DSpatch-SSH-In rule, the test key not in the file, the broad rule unchanged. Locally: typecheck; remote-setup-linux, remote-setup-scripts, help-guides, markdown and ssh-connection 56/56; prepare-bundled 18/18; bash -n; build. Not run: the system-changing path anywhere; the Help window's save actions on screen.

Released in 1.0.2 (pre-release), 15 November 2026: tag v1.0.2 on 9ef10a1, package run 43767185950 (plan, hosts-and-deb, windows-installer, publish-release succeeded). https://github.com/nizlas/DSpatch/releases/tag/v1.0.2 carries the .deb (e20cd565…), DSpatch-Setup-1.0.2.exe (a2715615…), both host packages, host-manifest.json (contract e79215b20268b2ba), dspatch-prepare-windows-host.ps1 (094b9938…), dspatch-prepare-linux-client.sh (94f82182…) and SHA256SUMS; all checked against SHA256SUMS. The .deb's build identity is 9ef10a1 with no dirty files, its bundled manifest equals the published one, and its bundled scripts are byte for byte the released ones and the ones in the repository; the Windows script released is the same file that was parsed and dry-run on Windows.
<!-- SECTION:NOTES:END -->
