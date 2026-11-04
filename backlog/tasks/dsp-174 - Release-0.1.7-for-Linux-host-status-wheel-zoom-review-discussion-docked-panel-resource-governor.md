---
id: DSP-174
title: >-
  Release 0.1.7 for Linux: the host status, wheel zoom, the review discussion's
  reading, the docked panel on Linux, the resource governor and the DSP-163
  follow-ups
status: Review
assignee: []
created_date: '2026-11-04 19:30'
updated_date: '2026-11-05 00:45'
labels:
  - release
dependencies: []
ordinal: 95000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 4 November 2026, run from the Linux machine. Integrate the two DSP-163 follow-up commits (a Stop while a step reads the folders starts no agent; unticking Use loop while the connection is away does not show the run as stopped; the held-process diagnostic and the remote loop trial) onto the current origin/main without bringing back the older local snapshot code, which origin/main replaced; keep `backup/linux-dsp163`. Then release the next free patch version after 0.1.6 for Linux with DSP-169 (host status and Restart host), DSP-170 (Ctrl and the wheel), DSP-171 (the review discussion's reading), DSP-172 (Electron 44.9.3, the docked discussion drawn on Linux, a direct move A → B), DSP-173 (the resource governor, observe by default) and the follow-ups. Build from a clean tagged commit through the existing package workflow; publish the .deb, the Linux host package, host-manifest.json and SHA256SUMS. No Windows release, no heavy stress test. Observe measures and logs without limiting a run; the colleague's earlier slowness is not described as solved, its cause is not established. Tasks awaiting Niclas's acceptance stay in Review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Local main is origin/main plus the two follow-up commits, with backup/linux-dsp163 and dsp-163-linux-followups kept
- [x] #2 The relevant test groups, the typecheck and the release checks pass on Linux, and remaining failures are compared by their output on the same base
- [x] #3 The package of the release commit is tried on Linux: install and start, upgrade from 0.1.6 keeping conversations, settings, project and own loop, meeting the older host and switching to the new one, the docked discussion drawn and taking input after A → B, redocking and zoom, Ctrl and the wheel with saved levels, and a light loop in observe reading real Linux signals with time-stamped records
- [x] #4 The release is published from the tagged commit with the .deb, the Linux host package, the manifest and SHA256SUMS, and their checksums and build identities match that commit
- [x] #5 Release notes state the user-visible changes and the verification limits honestly
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Integration (4 November 2026): done (main = origin/main 75eaa74 + 84ce8d8, eb0ab50; backup/linux-dsp163 at 26b89d8 kept). Verifying on Linux before the version commit.

Tests on this Linux machine (kernel 7.0.0-42, 28 CPUs), main at eb0ab50. The three fast failures seen earlier came from a stale local install: node_modules held Electron 44.3.0 against the pinned 44.9.3 (`tests/electron-version.test.ts`); after `npm ci` and Electron's own install the fast group passes on both origin/main 75eaa74 and main eb0ab50 (1523 passed, 5 skipped, 0 failed). Typecheck clean. live 116 passed (6 skipped), loop 674, host 145 (2 skipped), chat 362 (7 skipped), presentation 288, review 199. project: one failure, `experiment-repo.test.ts` "names the real cause when a live process holds the working directory" (Missing expected exception), the same output on origin/main; it expects Windows' refusal to remove a directory a process sits in, which Linux does not have; not in linux-verify, not a regression and not a release blocker. The heavy group as one run, and the provider group while the package build and container trials ran, exceeded the runner's 420 s bound (stopped, neither pass nor fail).

Package of 76a68e0 (version 0.1.7, built locally from the clean commit): the zoom trial (`DSPATCH_TRIAL_CLIENT` pointing at the unpacked .deb's `opt/DSpatch/dspatch`, own Xvfb with openbox, xdotool from Ubuntu's archive unpacked into the session's scratchpad) passed 78 checks, Ctrl and the wheel and the saved levels after a restart included; the dock trial with the same package passed 54 checks, its evidence screenshots of the X display. The governor check on this machine's real /proc (PSI present): 27 of 27. The desktop (:0) was locked by GNOME's screensaver, so no trial was run there: typed text could have reached the unlock field.

Container trials of the same package (dspatch-trial image, real sshd, SIMULATED provider): upgrade.mjs --from v0.1.6 --to the local .deb, 22 checks: v0.1.6 used (conversation, Copilot chosen, project, a loop of the person's own), 0.1.7 installed over it, the new client attached to the 0.1.6 host the closed window left running and its line read "Restart needed to finish updating · Restart host" (02-new-client-previous-host.png); the host was ended and 0.1.7's took its place; everything was as before, also after a restart. standalone.mjs 40 checks (a first run failed at its client's Xvfb on :97, which a test Xvfb of this session still held over the shared host network; and a second at port 9382, still held by the previous trial's container; both trial-environment collisions of this session, passed when run alone). loop-remote.mjs 32 checks. A light host-only loop kept (`--only hostOnly --keep`): the work container reads the machine's own /proc (PSI and meminfo identical inside and out); journal `~/.config/DSpatch/loop-runs/chat-loop-2026-11-04T23-05-00-321Z.jsonl`: `resource-governor` "Resource governor: observe. It records the machine's health and changes nothing in how the run goes. Health UNKNOWN." at 2026-11-04T23:05:00.339Z, each step's `node-entered` with `resourceGovernor: observe, resourceHealth: UNKNOWN` (the run lasted 5 s, shorter than the 15 s a change needs); in the full loop-remote run's host log, `resource governor (observe): UNKNOWN → GREEN: no pressure in any signal` for each run longer than that. The host log's lines carry no time stamp; the journal's entries do.

release.mjs --stage stopped twice at the same point: after its first 9 checks it restarts the client with a stand-in github.com, and the restarted client's DevTools port (9362) never answers, while the client itself is up (renderer ready) and idle; a listening socket on 9362 is held by no process visible in the container. Not resolved; it sits in the trial's restart, before any check of the product's own, and its remaining checks (Connect over SSH installing the carried host, a simulated Copilot turn) are covered by loop-remote and standalone and run again by `release.mjs --published` after publication.

Provider group: `copilot-runtime.test.ts` "with no login the session is refused with one sentence, and nothing is sent" is not refused on this machine (Missing expected rejection), and the file then does not end; the Copilot code and the test are unchanged since v0.1.6. The test empties COPILOT_HOME, GH_CONFIG_DIR and HOME, but the runtime evidently still finds a sign-in on this desktop (a hypothesis: the session keyring). It was not run again here so as not to reach Niclas's real Copilot account; the provider group runs on linux-verify's clean runner instead.

Before the tag: linux-verify on edbc458 (run 41933174112) green: fast 1522 (6 skipped), host 144 (3 skipped), review 199, chat 362 (7 skipped), presentation 288, provider 170, loop 674, live 116 (6 skipped), zoom trial 78, dock trial 54, governor 27.

Published (5 November 2026): v0.1.7 at 554cafa (tag v0.1.7, annotated), https://github.com/nizlas/DSpatch/releases/tag/v0.1.7, built by the package workflow (run 41934039485; its installed trial on the tagged build 40 checks): dspatch_0.1.7_amd64.deb (sha256 23195e45cb3d61f3c4b04e3d335ae155cd67d4ef62d217dd877cf93f1afb7c07), dspatch-host-0.1.7-554cafa7039f-linux-x64.tar.gz (34437646fc7726a604720249cd38d9263432b32cef3e63b32043a08612dc80bc), host-manifest.json, SHA256SUMS. Downloaded and checked: SHA256SUMS holds for all three; the client's and the host archive's build-identity.json both name git revision 554cafa7039f337fd2eaac4f859c14744e410d42 with no changed files; the manifest names hostId 0.1.7-554cafa7039f; the manifest inside the .deb is the published one byte for byte, and the host archive inside it has the published SHA-256.

After publication, on the Linux machine: the dock trial with the published .deb's client under Xvfb 54 checks; release.mjs --published 14 checks (the .deb from the release, installed in a clean container, Connect over real SSH installing the carried host with github.com unreachable, a simulated Copilot turn there); upgrade.mjs --from v0.1.6 to the published .deb 22 checks.

Not established: a real provider; a physical mouse or keyboard; the docked discussion on a real desktop session (the machine's desktop was locked throughout); Windows; a machine under real pressure. DSP-169 to DSP-173 stay in Review for Niclas's acceptance.
<!-- SECTION:NOTES:END -->
