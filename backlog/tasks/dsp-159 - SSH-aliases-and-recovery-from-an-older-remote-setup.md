---
id: DSP-159
title: SSH aliases and recovery from an older remote setup
status: Review
assignee: []
created_date: '2026-11-01'
labels: [remote]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Establish how DSpatch calls the system's ssh with an alias, user@alias, HostName, User and Port, against a reproducible alias trial through the whole connection flow, with host-key checks intact. Separate what is reproduced from the unknown original cause. After an upgrade, a saved manual tunnel session must lead understandably to the SSH flow with nothing lost.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
How DSpatch calls ssh: the system's program, with the person's config, `-T`, `StrictHostKeyChecking=ask`, and the target after `--`, so `alias` and `user@alias` resolve as in a terminal. Reproduced in `continuity.mjs` with an alias with its own HostName, User and Port: `ssh -G`, a terminal and DSpatch agree, including refusing the same wrong user.

The original refusal: **cause unknown.** The original environment is not reachable from here, and this trial did not reproduce it. Nothing shows that the fault was in DSpatch or that the alias worked in a terminal.

Reproduced product faults, now fixed: a host block written for a terminal stopped DSpatch's own connections (`LocalForward` on a taken port with `ExitOnForwardFailure`, `ControlPersist`, `RemoteCommand`). A refused sign-in now shows the user, host and port ssh resolved, so an alias that went astray can be seen. Host-key checks are unchanged.

A saved manual tunnel that no longer answers now gets a dialog offering Connect over SSH, Work on this computer, Try again or Quit, found within seconds of starting. Connect over SSH opens the form. Only `remote-session.json` is removed. Verified in the packaged trial with a real dialog.
<!-- SECTION:NOTES:END -->
