---
id: DSP-131
title: Prepare a local Linux development launch from a clone (P2)
status: Review
assignee: []
created_date: '2026-10-26 11:08'
updated_date: '2026-10-31 15:33'
labels: []
dependencies:
  - DSP-129
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 26 Oct 2026 (step 1 of the agreed order: local Linux at home with Claude; then provider-independent host-client separation at home; then the Copilot SDK at work; then Christian's test with Copilot and the bundled DSP-116 walk). Prepare DSpatch to run from a clone on Niclas's home Linux machine: fix concrete Windows dependencies in install, build and start scripts, paths, case and file URLs, application data and persistent workspaces, git and executable discovery, process arguments, working directory and shell assumptions, cancellation, shutdown and process cleanup. Keep Windows working; reuse existing platform abstractions. Out of scope: installers, auto-update, distribution packaging, starting a Linux clone, VM, WSL or remote connection in this step. The bundled DSP-116 example must open on Linux through the existing button and menu. Delivered as prepared for Linux until it has actually run there.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Concrete Windows-only assumptions in the current launch, build, path, application-data, git/executable discovery, process and cleanup code are fixed or isolated behind small platform boundaries, with Windows behaviour unchanged
- [x] #2 Documented dependencies and exact start instructions for a clone on Linux, with the expected result of a first home trial
- [x] #3 Platform-dependent logic is covered by bounded tests; simulated platform tests are not reported as Linux verification
- [x] #4 The bundled DSP-116 example opens through the existing action with no Temp material or machine-specific path
- [x] #5 Windows regression: typecheck, build and the relevant test groups pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Focus (run 20261026-200000-linux-claude, base c6cb57e): mapping the starting point from the code and planning, together with DSP-117.

Result (run 20261026-200000-linux-claude, candidate 003): PREPARED FOR LINUX, NOT RUN ON LINUX. No code-level launch blocker found. Fixed: Stop on the chat command and the loop gate command now kills the whole POSIX process group (detached group, kill(-pid, SIGKILL), fallback to the shell) while each caller's Windows taskkill call is byte-for-byte unchanged; engines ^22.18.0 || >=23.6.0 from Node's documentation (Node 24 tested on Windows); run-loop-graph path via path.join; README 'Linux (prepared, not yet run)' with requirements, the chrome-sandbox step (never --no-sandbox), exact commands, plain-terminal launch, userData location, residual stop risks; docs/LINUX_HOME_TRIAL.md for the first home trial with expected results. The DSP-116 example is portable (git blobs, ../..). Platform logic covered by simulated-platform tests on Windows only (process-tree.test.ts), not Linux evidence. Windows regression: typecheck, build, fast 1246, chat 375, provider 78, presentation 294, live 71, review 68; resume-choice, review-window, review-discussion scenarios exit 0 (a narrow-window overlap present at base c6cb57e and worsened by the Agent select was fixed). HUMAN_PENDING: the first home trial (Part A) with the distribution, kernel, Node, npm, Electron and git versions recorded. Not done: .sh hand-over kits (P-2, low priority after the trial), packaging, Job Objects (DSP-34).

P-2 (low priority, after the first home trial): Linux equivalents of the Windows-only start-review.cmd and start-resume-choice.cmd hand-over kits.
31 Oct 2026, night session: a code audit found no new launch blocker. Fixed on Windows only: orderly close on signals and a closed channel, dev scripts forwarding stops, path comparison by platform, the snapshot asking its folder about case, the per-user Claude model folder, a program named through the shell left undecided, Linux packaging settings. Remaining are listed in docs/LINUX_HOME_TRIAL.md. Still PREPARED, NOT RUN ON LINUX. Exact Ubuntu commands: docs/REMOTE_TRIAL.md.

31 Oct 2026, fix pass after the first Ubuntu trial with real Claude: inherit agent and model in Prepare code walks, open DSpatch's own repository like any project, a quiet empty chat, and the model list after login. In progress.

Fix pass after the first Ubuntu trial with real Claude (31 Oct 2026, implemented on the Windows checkout; this session had no Linux machine). Niclas's decisions: DSpatch's own repository opens like any project; the empty chat shows no invitation or idle status.
- Prepare code walks: the chat on Claude's default stores no model, so the opener's choice had an empty model and agentChoiceFrom discarded the agent too. openerChoiceFrom keeps the agent; the picker takes the row the list marks as the default once the list arrives. A person's later choice is never replaced and an unoffered model stays named.
- Own repository: the refusals in validateProjectFolder and refuseLiveWorkingRoots and DSPATCH_ALLOW_OWN_REPO are removed, for chat and loops. Recognition stays for the application's own loop definitions and example review.
- Empty chat: the note and the idle line are gone; working status stays.
- Model list: the list was kept for the whole launch, so a login needed a restart. It is now reused for 60 seconds and the log names the ids. DSpatch removes only the `default` alias. Whether Claude offers more variants after login on Ubuntu is not established.
Verified on Windows only, simulated provider, isolated userData: typecheck, build, fast, chat 365 pass 1 skipped, review 186, loop-live, loop-chat, loop-choice 164, walk-start phases inherit, inherit-switch, clean, blocked in real windows. Not tried: Linux windows, real Claude, a loop over DSpatch's own repository.
Left as found: main.ts passes only cursor and claude as the opener, so a Copilot chat gives no inherited agent (out of this pass's scope).
Ubuntu verification, 31 Oct 2026 (Ubuntu 24.04, X11, real windows, isolated userData, simulated provider, no provider contacted). The walk-start phases inherit, inherit-switch, clean, blocked and the new inherit-copilot pass. The Copilot gap above is closed, and it had two more causes: ChatService.availabilityOf never passed copilotInstalled, so the chat refused Copilot on every machine, and the review discussion's select ignored Copilot. Not exercised in a window: choosing Copilot in the discussion's select (typecheck only); the late-list race in inherit-switch, because the chat has already read the list within the reuse minute. A model list is read again only when something asks; nothing refreshes it by itself. Ten failing tests, identical on a clean export of 60c2aa1, were left: Windows paths and PATHEXT (command-start, loop-definition), CRLF expected in generated roles (role-generate), and the wording of a save failure on Linux (conversation-store, two WS-1 cases not examined individually). A fresh profile fetches Chromium's spellcheck dictionary from redirector.gvt1.com at start. Real Claude on Linux is Niclas's next trial.
Discussion panel with Copilot, 31 Oct 2026 (Ubuntu, real windows, isolated userData, simulated provider): review-flow phase panel-copilot chose Copilot and a model with the keyboard, in the panel's own window and docked in the diff. The prompts held the question, the selection and both revisions, the adapter got sonnet then haiku on the same session, and both answers stayed in one discussion. No product fault. Not tried: docked in the walk window. README's Linux section now separates agent runs, Niclas's reported trial with real Claude, and what is unverified.
<!-- SECTION:NOTES:END -->
