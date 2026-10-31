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
<!-- SECTION:NOTES:END -->
