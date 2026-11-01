---
id: DSP-153
title: Install DSpatch and connect to another machine over SSH
status: In Progress
assignee: []
created_date: '2026-11-01 00:10'
updated_date: '2026-11-01 00:10'
labels:
  - integration
dependencies:
  - DSP-111
  - DSP-148
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A person installs DSpatch like any application, on Linux or Windows, works locally or gives `user@machine`, signs in to their provider and starts working: no clone, no Node, no build, no copied token, no host started by hand and no tunnel terminal. Niclas's instruction of 1 November 2026, after the first real trial over SSH. Content exclusion is the next task and is not part of this.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ubuntu/Debian x64 .deb and a per-user Windows x64 installer, with menu entry and working sandbox
- [ ] #2 Host packages with a fixed Node runtime, bound to the client by a manifest with SHA-256
- [ ] #3 Bundled loops, graphs and roles work without a clone and updates leave a person's loops alone
- [ ] #4 Claude and Copilot programs and sign-in from the interface, locally and on a host, with no API-key route
- [ ] #5 Connect with `user@machine` using OpenSSH's config, agent, keys, passwords and host-key checking
- [ ] #6 Install, reuse, update and interrupted install on the machine, without harming a working version or data
- [ ] #7 Short status, understandable failures, reconnect without sending work again, Leave leaves the host running
- [ ] #8 Verified on the packaged product; Windows verified on Windows or handed off with a concrete list
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: `docs/INSTALL.md`. Decisions taken within the instruction, each reversible: the system's OpenSSH rather than an SSH library, because config, agent and known_hosts then need nothing of ours; no `asar`; provider programs fetched on request from npm, because Claude Code's licence reserves redistribution; `host-running.json` with a system-chosen port; a client that does not reconnect by itself at launch, because that would need a prompt before any window exists: the machine is offered first in the form.

Found by the packaged trial and fixed: a postinst that tested `unshare` as root and left the sandbox helper unusable for ordinary users; Copilot's SDK failing inside `asar`; the host's bundled root lost between client and host; a stop that waited on a zombie.

Verified on Linux x64 by `app/scripts/trial-package/run.mjs`: the real .deb and host package, two clean Ubuntu 24.04 containers without Node or sources, real sshd, a real window on Xvfb, real clicks, SIMULATED provider on the host. Installed with `dpkg -i`, helper `4755` by the postinst, no `--no-sandbox`; menu entry and icon; loops offered from `resources/bundled` and from the host package with the chat loop still chosen; a nonexistent name, a refused password, no SSH server, a changed host key (no question) and an unknown key (fingerprint asked); alias with password and with key; new install with status steps, one client process throughout; neither password nor token on a command line, in the client log or in settings; tunnel cut during a turn: back, one message, one attempt; Leave closes the tunnel and leaves the host; reuse without installing or asking again; stopped host started; install cut in the middle leaves no version and the retry works; another version running: No keeps it, Yes replaces it beside the old folder, conversations kept; a host restarted under a connected client: tunnel moved to its new port, the window says the outcome is unknown; a hand-started host is not run over. On the installed client, real downloads from npm: Copilot CLI and Claude Code fetched and checked, each sign-in reached a link (and Claude a place for its code, Copilot a device code without a display), and was then cancelled: no sign-in was completed and no model called.

Not verified: the .deb on a real desktop with AppArmor (no sudo here; the container runs with Docker's restrictions lifted for Chromium's sandbox, which stays on); completed real sign-ins; real SSH between real machines with this build; keyboard-interactive beyond the same askpass path; Windows at all, as client or host (the PowerShell steps have never run). See the list in docs/INSTALL.md. The `workspace-flow` window scenario was adjusted for the form and not re-run. Ten known Linux test failures unchanged.

Found on 1 November 2026: the Windows installer built at 3da495d on Linux carried the Linux Copilot runtime, because `npm ci` had run on Linux, so Copilot would not have started on a Windows client. A Windows build through `.github/workflows/package.yml` installs the right one. The installer of 0ecf8df was built from `npm ci --os=win32 --cpu=x64 --ignore-scripts` in the Wine container. It has not been run on Windows either.
<!-- SECTION:NOTES:END -->
