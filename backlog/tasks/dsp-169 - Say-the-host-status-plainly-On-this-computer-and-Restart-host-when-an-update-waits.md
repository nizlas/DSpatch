---
id: DSP-169
title: >-
  Say the host status plainly: On this computer, and Restart host when an update
  waits
status: Review
assignee: []
created_date: '2026-11-04 10:40'
updated_date: '2026-11-04 11:28'
labels:
  - ui
  - host
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 4 November 2026. Remove 'through the host that stays running' from the status line in every window: that the host keeps running is implicit. Normal local status reads 'On this computer'. When an updated client is attached to an older host it reads 'Restart needed to finish updating' with a button 'Restart host'. Commit ids and build digests leave the status line and stay in technical detail and the logs. The existing End host action already ends the old host, starts the new one and reconnects the window (Niclas's trial of an upgrade from 0.1.6 over 0.1.4): reuse it; this is a change of presentation. Other actions that only end the host keep their names. Protection of and information about running work stays. A remote connection still says which machine. A difference between two development builds of one version is not described as an installed update.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The local status line reads 'On this computer' with no clause about the host staying running, in the chat, editor and review windows
- [x] #2 An updated client attached to an older host reads 'Restart needed to finish updating' with a 'Restart host' button that does what End host did: ends the old host, starts this build's and reconnects the window
- [x] #3 No commit id or build digest is in the status line; the builds are still told apart in the log and in a technical detail the person can open
- [x] #4 Running work is still protected and said; a remote connection still names its machine; two development builds of one version are not called an update
- [x] #5 Verified in real windows on an isolated profile: the short status, the update status and the restart that follows, with the existing tests adjusted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (4 November 2026): the status words in HostLink.tsx and the host-versus-window note in shared/remote-protocol.ts; the restart reuses leaveRemoteSession.

Result (4 November 2026, Windows 11, run from the repository). The status line (`src/renderer/HostLink.tsx`) reads *On this computer* with *End host* while this computer's host is this build; *Restart needed to finish updating* with *Restart host* when the host is an older version, which is what an installed update leaves behind; and *The host is another build* with *Restart host* when the same version runs from other sources, as in development, or the host is the newer one. `src/shared/remote-protocol.ts`: `hostBuildDifference(host, client)` replaces `hostBuildNote`: `update` when the host's version is older (`compareVersions`, number by number), `other` for any other difference (the source digest first, else the commit), `null` for the same build or when nothing says; a side with no known version is compared by its sources alone. The detail ("The host runs 0.1.6 (7f929eb9653e, build 3f5b6508); this window is 9.9.9 (7f929eb9653e, build 3f5b6508).") is the title of the line's words and of the button, and the client log says `host link: connected [an update waits for a restart: …]` or `[another build: …]`; none of it is in the line. `main.ts` computes the difference in `publishLink` for every connected state, so every call site says it the same way, and the five earlier call sites pass no note. A remote connection still reads *On <machine>*, with a short note (*The host there is an older version* / *another build*) and the detail in its title. The action is the existing `leaveRemoteSession`, named *Restart host* when the host is another build; *End host* keeps its name and behaviour when the host is this build (docs/INSTALL.md: it ends the host and the window starts a fresh one). The dot is amber while a restart waits. `data-ev="host-link-words"` added; `host-link-leave` unchanged, so the trials' clicks still find the button.

Verified in real windows (an isolated profile, the simulated provider, the instrument in the session's scratchpad, 19 checks): (1) a plain local start reads *On this computer* / *End host* with no commit in the line, and the host stays running after the client quits. (2) The client started again with `package.json` at 9.9.9 attached to the running 0.1.6 host rather than start another, read *Restart needed to finish updating* / *Restart host* with the versions in the title and the log and not in the line; *Restart host* ended the 0.1.6 host, started the 9.9.9 build's and the line read *On this computer* / *End host* again, as Niclas saw going from 0.1.4 to 0.1.6. (3) The real version meeting the 9.9.9 host: *The host is another build* / *Restart host*, not called an update. (4) The same version from other sources (`dist/build-identity.json` with another digest): *The host is another build*, the digests in the title. Unit tests: `tests/remote-transport.test.ts` (the difference's kinds, the detail, unknown versions, `compareVersions`). docs/INSTALL.md says what End host and Restart host are.

Limits: the remote line's note was not seen in a real remote session (no SSH host in this trial); the refusals while work runs or the loop editor holds unsaved changes are unchanged code, not run again; the wording itself is Niclas's to judge.
<!-- SECTION:NOTES:END -->
