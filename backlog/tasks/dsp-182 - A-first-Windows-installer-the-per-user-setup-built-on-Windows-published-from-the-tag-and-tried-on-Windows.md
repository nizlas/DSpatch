---
id: DSP-182
title: >-
  A first Windows installer: the per-user setup built on Windows, published from
  the tag and tried on Windows
status: To Do
assignee: []
created_date: '2026-11-08 20:01'
labels:
  - release
  - windows
dependencies:
  - DSP-153
  - DSP-164
  - DSP-165.1
priority: high
type: feature
ordinal: 101000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 8 November 2026: give DSpatch a first usable Windows installer with the same kind of smooth installation as MiniDAWLab, adapted to DSpatch's technology. This card proposes the scope; the investigation behind it is in the notes. Nothing is built or published by the investigation itself.

**What exists.** `app/electron-builder.yml` already configures a Windows x64 NSIS target: a per-user one-click installer (no administrator rights, installed under `%LOCALAPPDATA%\Programs\DSpatch`), which by electron-builder's documented defaults creates a Start menu entry and a desktop shortcut, starts the app when it finishes, registers an uninstaller named "DSpatch <version>" under Apps and features, and keeps app data on uninstall. `scripts/build-host-package.mjs` builds the win32 host package (a fixed Node 24.22.2 `node.exe` and `dspatch-host.cmd`); `prepare-bundled` refuses a client whose own platform has no host package; `stage-release.mjs` already expects `DSpatch Setup <version>.exe` unless `--linux-only`. `.github/workflows/package.yml` has a manual `windows-installer` job on `windows-latest` that downloads the host packages and builds the NSIS installer. DSpatch runs on Windows from the repository (DSP-164) and the standalone host was verified on Windows with an isolated profile (DSP-165.1). `docs/INSTALL.md` already tells a Windows user to run `DSpatch-Setup-VERSION.exe`, says the installer is unsigned, and keeps a seven-point Windows list to try.

**What is missing.** No installer has ever been produced by that job: its last manual run (4 November 2026) failed because `-c.win.signAndEditExecutable=true` was read as a configuration file path, and the installers built on Linux carried the Linux Copilot runtime (DSP-153). Tag builds make no win32 host package and publish with `--linux-only`, so no release has a Windows installer or a Windows host package since v0.1.4. No installer has been run on Windows: install, first start, upgrade and uninstall are unverified. Nothing is signed.

**MiniDAWLab as the reference** (`installer/MiniDAWLab.iss`, `scripts/package-windows.ps1`, `scripts/certify-release.ps1`, `installer/README.md`): Inno Setup 6, an administrator install into Program Files with a Start menu group and an optional desktop icon, the VC++ redistributable embedded and run silently, "Launch" at the end, the version stamped into the setup file from the single source (CMake's project version) by a script that also writes a zip beside it, and a certification gate before anything goes to testers; no code signing and no GitHub releases (handed out by hand). What fits DSpatch: one setup file per version with the version in its name and in the file's metadata, install, Start menu and start in one flow, packaging scripted from the single version source (`package.json`), a verification gate before publishing, and the honest unsigned story. What does not: a second installer system (electron-builder's NSIS is configured and builds the Electron app correctly), an administrator install (a per-user install suits a developer tool and avoids UAC), and the redistributable (Electron carries its runtime). DSpatch keeps what MiniDAWLab lacks: GitHub releases with `SHA256SUMS` and the host manifest.

**Recommended first installer.** Keep electron-builder's per-user one-click NSIS installer, built on a Windows runner only; decide the desktop shortcut (default on) and keep the Start menu entry and the start after install; set the executable's version metadata; publish it from the tag with the .deb, both host packages, the manifest and the checksums; document the unsigned warnings as the steps a person takes; verify install, first start, upgrade and uninstall on Windows with an isolated profile and the simulated provider, and run the existing window trials against the installed client through `DSPATCH_TRIAL_CLIENT`. Signing (Azure Trusted Signing through `win.azureSignOptions`, or an OV certificate), automatic updates and a winget manifest are later decisions, not part of this card.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 package.yml builds the win32 host package and the Windows installer on a Windows runner for v* tags as well as manual runs, with the executable's version metadata set, and publish-release publishes DSpatch-Setup-<version>.exe together with the .deb, both host packages, the manifest and SHA256SUMS (stage-release without --linux-only)
- [ ] #2 The installer installs per user without administrator rights under %LOCALAPPDATA%\Programs\DSpatch, creates a Start menu entry (the desktop shortcut decided and documented), starts DSpatch when it finishes, and registers an uninstaller under Apps and features named with the version
- [ ] #3 The installed client carries the win32 Copilot runtime and the win32 host package, starts the standalone host from its data folder, opens a local project and completes a Copilot turn; the simulated provider is enough for the trial, and one real sign-in is tried by hand
- [ ] #4 Installing a newer setup over an older one replaces the program and keeps %APPDATA%\DSpatch (conversations, reviews, provider support, settings, window layout and zoom) and the vendors' logins; an older running host is handled by the existing Restart host flow and nothing is sent twice
- [ ] #5 Uninstalling removes the program and the shortcuts, leaves %APPDATA%\DSpatch and the logins in place and stops no running host; INSTALL.md says what remains and how to remove it by hand
- [ ] #6 The unsigned installer's SmartScreen and browser warnings are described in INSTALL.md and the release notes as the exact steps a person takes; signing is a recorded decision for later, not part of this card
- [ ] #7 Verified on Windows with an isolated profile and the simulated provider: install, first start, an upgrade from the previous build and an uninstall, and the zoom, dock and profile trials against the installed client through DSPATCH_TRIAL_CLIENT; what ran by hand and what remains is recorded here and in INSTALL.md's Windows list
- [ ] #8 The release notes and INSTALL.md state the Windows status honestly, and no release is published from this card without Niclas's decision
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Investigation, 8 November 2026 (Windows home computer; nothing built or published).

Data a Windows installation uses, and what an upgrade and an uninstall do to it:
- Program: `%LOCALAPPDATA%\Programs\DSpatch` (per-user NSIS). An upgrade replaces it; the uninstaller removes it and the shortcuts.
- The client's data, Electron's userData: `%APPDATA%\DSpatch` with `conversations/`, `reviews/`, `provider-support/` (fetched Claude and Copilot support), `host-installations/` (the bundled host unpacked for local start), `host-packages/` (a cache), `ssh-recent.json`, `window-zoom.json`, `window-layout.json`, `claude-consent.json`, `host-claim.json`, `host-running.json`, `resource-governor.json`. electron-builder keeps it on uninstall (`deleteAppDataOnUninstall` defaults to false) and an upgrade does not touch it.
- An older host's data: `%LOCALAPPDATA%\dspatch-host`, adopted by the first host that starts (INSTALL.md, "After an upgrade").
- Logins: Claude's in `~/.claude`, Copilot's in its own store; outside DSpatch's folders, untouched by install, upgrade and uninstall.
- A running standalone host is a separate `node.exe` from `host-installations`; the uninstaller removes no file it holds and does not stop it. Ending it is the existing End host action; the existing Restart host flow handles an older host after an upgrade.

Runtime dependencies that must ship: Electron, the production dependencies including the Copilot SDK with its win32 runtime package and Cursor's SDK, the bundled loops, graphs, roles and pinned lists, and the win32 host package (Node 24.22.2) in `resources/bundled/host-packages`. Not shipped and fetched on request: the Claude Agent SDK with the `claude` program (its licence reserves redistribution) and `@github/copilot` for sign-in. Separately installed by the person: Git for the projects, Windows' OpenSSH client for Connect, and the accounts. The host package is a `.tar.gz` extracted with Windows' own `tar`; Windows 10 1803 and later have it.

CI and versions today: `package.json` is the single version source; the tag must equal `v<version>`; the host manifest binds version and commit; the installer's file is `DSpatch Setup <version>.exe`, staged as `DSpatch-Setup-<version>.exe`. `package.yml` builds the win32 host package and the Windows installer on manual runs only, and `publish-release` stages `--linux-only`. The one Windows run that reached the build (41798830717) failed on the CLI override; the fix is `--config.win.signAndEditExecutable=true`, or simply `signAndEditExecutable: true` in `electron-builder.yml` now that the installer is built on Windows only.

Signing: nothing is configured. An unsigned installer meets SmartScreen's "Windows protected your PC" on first run (More info, Run anyway), and Edge or Chrome may hold the download as uncommon. electron-builder 26 supports Azure Trusted Signing (`win.azureSignOptions`) and signtool with a certificate; both need an account or a certificate and a decision from Niclas. MiniDAWLab is unsigned too.

Verification on Windows: by hand on a Windows machine with an isolated profile (`--user-data-dir`) and the simulated provider: install without administrator rights, Start menu entry, first start, a local project and a Copilot turn, install a newer build over it with conversations and settings kept, uninstall with the data left; plus the existing zoom, dock and profile trials against the installed client through `DSPATCH_TRIAL_CLIENT`. GitHub's Windows runners have not been tried for window trials; the first version does not depend on them.

Remaining decisions: the desktop shortcut (electron-builder's default is on; MiniDAWLab offers it unchecked), one-click or assisted installer (folder choice), whether to sign the first version, and whether the Windows installer is published in the same release as Linux or as its own prerelease first. Obstacles: no Windows installer has run on Windows yet, so the first trial may find Windows-only defects; a previous Windows release does not exist, so the upgrade is tried between two local builds; the Claude and Copilot programs' Windows sign-in (INSTALL.md item 7) is part of first use but outside the installer.
<!-- SECTION:NOTES:END -->
