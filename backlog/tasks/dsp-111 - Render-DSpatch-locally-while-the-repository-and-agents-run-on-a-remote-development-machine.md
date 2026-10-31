---
id: DSP-111
title: >-
  Render DSpatch locally while the repository and agents run on a remote
  development machine
status: In Progress
assignee: []
created_date: '2026-10-21 15:09'
updated_date: '2026-10-30 22:12'
labels:
  - integration
dependencies:
  - DSP-131
priority: high
type: feature
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas (21 Oct 2026): DSpatch must relatively early support a VS Code Remote-like arrangement. The Electron/React UI runs and renders locally on a laptop; the repository, agents, scripts, Git operations, builds and tests run on a remote development machine. This matters for moving an existing autonomous orchestration project from VS Code to DSpatch. Not started; it is recorded now so that DSP-109 and later runtime work keep the separation it needs without building it early. Direction: docs/RUNTIME_PLATFORM_ROADMAP.md, section 1.2.

Requirements as stated:
- File contents, including images and other binary files, can be transferred to the local client and rendered there.
- SSH may be the transport. Graphical forwarding over SSH is slow in the work environment, while SCP-style file transfer works well; do not assume generally low SSH bandwidth.
- A DSpatch conversation and its durable task history are reachable from both the laptop and the development machine without manually transferring chat context.
- Provider-session resumption is a separate capability: used where the provider supports it, otherwise DSpatch continues explicitly in a new session from its persisted context, and says so.
- Long-running autonomous Maestro execution without an attached client is a further, distinct capability, not part of the first milestone.
- Content exclusion and authorization boundaries stay explicit: a human viewing a file or image locally does not grant an agent or external model access to it.

First milestone (this card): demonstrate local rendering, remote repository access and execution, and shared durable conversation context. Out of scope: unattended Maestro execution, AHP migration, host-loss recovery, multi-user access, a general remote-workspace system.

Reuse, do not duplicate: workspace and root records (DSP-71, DSP-72), conversation continuity (DSP-4), kept runs (DSP-25), the AgentAdapter boundary. Dependencies to settle at planning time: DSP-109 (first non-Cursor provider) and DSP-110 (what an agent host offers) inform the design; the work-environment content-exclusion contract applies to any work use.

### Widened 27 Oct 2026: a usable host-client function (Niclas)

The original text above is kept as written. This section states the whole flow the card now has to deliver. Its first milestone still stands inside it.

**The problem.** Niclas wants to work from the laptop while the repository, Git, agent runs, builds and tests stay on the development machine. Graphical forwarding is too slow for that, and copying chat context by hand is not acceptable. Today DSpatch only runs where it renders.

**The flow that must work (at home: the UI on the laptop; the repository and execution on the home Linux development machine).**
1. On the laptop, the person connects to the DSpatch host on the development machine and sees which host and workspace they are connected to.
2. They open a workspace that lives on the host. They browse and read its files, including images, rendered locally. File choosers browse the host, not the laptop.
3. **Chat:** they give a task. The agent chosen on the host works there, and the diff, the commands and their results are shown on the laptop.
4. **Review:** they open a review on the host. Code views, notes and decisions are saved on the host, and the review discussion runs there.
5. **Loop:** they start a loop run. Its steps run on the host, and the graph and the record are followed on the laptop.
6. The connection drops. The laptop says so, sends nothing further, and does not report work as finished or failed when it does not know.
7. They reconnect from the laptop or open DSpatch on the development machine itself. They see the same conversations, reviews and runs, with the actual state the host recorded. Nothing is started twice, and nothing saved is lost.

**Governing decisions.**
- [RUNTIME_PLATFORM_ROADMAP.md §1.2](../../docs/RUNTIME_PLATFORM_ROADMAP.md), "Remote development" and the order of 26 Oct 2026: the host-client function is developed and tried at home. It is provider-independent. Its three capabilities stay distinct: shared durable context, provider-session resumption, and unattended execution without a client, which is not part of this card. Viewing a file locally grants no agent access to it.
- INTERACTION_MODEL.md §4.5: never silently start overlapping work, and show an unconfirmed stop as unconfirmed. AGENTS.md: cancellation and restart must not reapply changes or launch commands twice.
- The content-exclusion contract, "Enforcement follows execution": controls are applied where execution happens, which is on the host. Controls that live only in a client do not protect a host that runs without one.

The roadmap's map of the host-client boundary (§1.2, 26 Oct 2026) is a map and a proposal, not a decision. That includes "host `userData` owns durable history; one writer per conversation" and "a dropped client is treated like DSpatch stopping listening; reconnect re-reads and resends nothing". Planning proposes from it, and the open decisions below go to Niclas.

**Already implemented (locally, not remotely).** The review host step: `ReviewHostApi` with a host module and a local binding (see the notes, run 20261026-230000-host-review). It is the pattern to extend. It is not remote operation: there is no separate host process, no transport, no authentication, no reconnection and no host-side browsing. Chat, loops, workspace and conversation channels still run in Electron's main process over IPC.

**Remaining.**
- A host process that holds the stores, the adapters, the loop runner and the command runner.
- Host contracts for the chat, workspace, conversation and loop channels, following the review contract.
- A transport between laptop and host, with SSH as a candidate per the stated requirements.
- Authentication of the connection.
- Host-side browsing.
- A single writer per conversation and per review, enforced on the host.
- Disconnect and reconnect behaviour.
- A real two-machine trial at home.

**Out of scope.**
- Unattended Maestro execution without a client.
- Host-loss recovery beyond reporting uncertainty truthfully.
- Multiple users.
- Use at work and with Copilot. A later work trial needs its own verification, because a change of host or transport inherits nothing (content-exclusion contract §3).
- AHP (DSP-110 may inform the design but is not a dependency).
- A general remote-workspace product.
- A separate solution per provider.

**Splitting.** Keep this as one story unless planning finds deliveries that are each useful on their own. One such split: review over the transport first, then chat and loops.

**Open decisions for Niclas, before implementation.**
1. **The transport and how the connection is authenticated.** This is architecture; planning proposes and Niclas decides.
2. **What a dropped connection does to work in progress.** One option is to stop it as "outcome unknown", as the roadmap map proposes. The other is to let the current turn or step finish on the host while the client is away, which comes close to the excluded unattended mode.
3. **Several clients.** Either one attached client at a time, or several clients with a single writer per conversation and review held by the host.
4. **Where durable history lives.** The proposal is the host only, with the client holding window preferences at most.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 With the UI on a local laptop and the repository on a remote development machine, a person opens the remote workspace, reads text and binary files including an image rendered locally, and sees an agent's change and its diff, with all Git, agent, build and test execution observed on the remote machine
- [ ] #2 A conversation and its durable task history started from the laptop are available on the development machine (and back) without manual transfer; when the provider session cannot be resumed, the continuation is explicitly a new session built from DSpatch's persisted context
- [ ] #3 Transferring a file for local viewing grants no agent or external model access to it; the access path for agents and the viewing path for the person are stated and checked separately
- [ ] #4 The transport and its measured behaviour (including file transfer over SSH) are recorded on the tested machines; unattended execution without an attached client is stated as not covered
- [ ] #5 From the laptop, a person connects to the host on the home development machine, opens a host workspace through host-side browsing, and sees which host and workspace they are connected to.
- [ ] #6 Chat, review (including notes, decisions and the review discussion) and a loop run each work end to end with execution on the host and rendering on the laptop, through host contracts rather than client-side file or process access.
- [ ] #7 When the connection drops during a chat turn, a review save and a loop step, the laptop says so, sends nothing further and claims no outcome it does not know; the host handles the work as Niclas decides for disconnects (open decision 2).
- [ ] #8 After reconnecting from the laptop, or opening DSpatch on the development machine itself, the same conversations, reviews and runs appear with the host's recorded state; no turn, step or command is started twice and no saved work is lost.
- [ ] #9 The host enforces one writer per conversation and per review; a second client or window cannot write the same conversation or review at once.
- [ ] #10 These criteria are met on two real machines at home with the agreed transport; tests over an in-process binding or a simulated transport are reported apart and do not satisfy them alone.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
26 Oct 2026 (run 20261026-200000-linux-claude): map of the current host-client boundary in docs/RUNTIME_PLATFORM_ROADMAP.md section 1.2, 'Where the current code draws the host-client boundary (map, 26 Oct 2026)' - a map and proposal, not an implementation. Proposed first implementation step at home (step 2 of Niclas's 26 Oct order): (a) a test that classifies every bridge channel (62 ipcMain.handle in main.ts, 13 in review-ipc.ts, plus UiAgentEvent) as host or client; (b) move one bounded group of handler bodies into a transport-neutral host module that the Electron IPC binds thinly. No transport chosen. Known coupling to undo: native dialogs return client-local paths; startup constructs a Cursor adapter for environment info.

Focus (Niclas, 26 Oct 2026; run 20261026-230000-host-review): the first host step for review - move opening and validating a review definition, reading identified git revisions, code and diff, and reading and saving review state, notes and decisions into a transport-neutral host module with an explicit serialisable contract and plain errors; no Electron or renderer imports in it; the local app uses the same contract through a local binding. Separate host process, network transport, authentication and reconnection are the next steps, not this one.

Result (run 20261026-230000-host-review; I-3 call 11; Verifier 012 PASS; Reviewer 013 ACCEPT; coordinator applied R-2 item 6): first host step for review done LOCALLY - not remote operation. src/shared/review-host-contract.ts ReviewHostApi (serialisable; host-error codes unknown-session, invalid-request, definition-unreadable, git-failed, save-failed, internal; plain messages, technical detail separate); src/host/review-host.ts (owns repository access via ReviewService per session, the recent index, identity keys and review records; imports no Electron or renderer - pinned by a boundary test and a runtime require walk); src/host/local-review-host.ts binding (structuredClone in/out; throws -> internal). review-windows.ts and review-ipc.ts reach the repository and review records only through the contract; renderer and preloads unchanged. Verified on Windows: the same flows through the binding on a git fixture; in a real window a base-build record restored unchanged, navigation, code views, sv/en, note and position across a restart, a simulated save error keeping the work, Open example review; review-direct, review-window, review-discussion scenarios. ACs #1-#4 stay open. Next steps: a separate host process; a transport; authentication; reconnection; host-side browsing for review definitions (dialogs still return client-local paths); a host-side refusal of a second session on one review (single writer); moving ReviewService under src/host/; the review discussion still runs in main.

27 Oct 2026: description widened to the full host-client flow (chat, review, loops, disconnect and reconnect), with criteria #5-#10 and four open decisions for Niclas. The first milestone and criteria #1-#4 are kept. DSP-131 (Linux launch) is now a dependency because the host runs on the home Linux machine. DSP-110 informs the design but is not a dependency. Copilot at work is DSP-148 and is not part of this card.

27 Oct 2026, current focus (Niclas): implement a separate local host process that an ordinary local start uses automatically for project work (projects, chat, review, loops), behind serialisable contracts reusable by a later remote transport. Approved here: the separate local host process and automatic local connection without SSH. Not approved: remote authentication, SSH, disconnect policy for work in progress, several clients, local caching of remote history. Real Linux and two-machine trials are later.

Result, 27 Oct 2026: separate local host process (local, NOT remote operation; criteria #1-#10 stay open).

What a person can now do: an ordinary local start of DSpatch starts a separate project host process automatically, with no SSH, no sign-in and no manual start. Opening projects, the chat, review (with the review discussion) and loop runs work through it, in the same windows as before.

Which functions go through the host:
- The host (`app/src/host/project-host.ts`, entry `host-process.ts`, Electron `utilityProcess`, local process channel, nothing on a network) holds:
  - the chat service and its adapter, and projects, conversations, sample projects and the workspace;
  - loop definitions, graphs, role files, loop runs, their control, instructions and run records;
  - the review host (`ReviewHostApi`) and the review discussions with their adapters (tool-free policy unchanged);
  - the probe.
- Methods form a typed contract (`shared/project-host-contract.ts`). Both sides typecheck against it, and the host refuses to start unless it serves exactly those methods. Events go to an audience: the chat window, every window, the run audience, or one renderer.
- The client (`main/main.ts`) keeps windows, menus, file choosers, message boxes, the clipboard, the file manager, the editor's unsaved-drawing registry and the scripted-run harness.

Failures:
- **Start failure:** said before any window opens (Try again / Quit; unattended runs exit 26).
- **Lost host:** every waiting call is answered `host-lost` ("unknown; nothing was sent again"), and calls after that are refused as not done. The person may restart, which reattaches the review windows to the new host and reloads the windows. The editor's unsaved drawing is asked about first (Save / Discard / Keep). Unattended runs exit 27.
- **Client gone:** the host closes its adapters and ends; this is interim local behaviour, not a disconnect policy.
- **Quit:** the host closes within its own stated bound plus a margin.

Data: no format change and the same files under userData. Export reads the bytes on the host and writes them on the client, byte for byte.

Verification on Windows, home computer.
- **Real processes:**
  - typecheck and build pass. The whole suite passed once on the final code (1625/1625), including a new `host` group: the channel against a separate stand-in process, the real host process under Node (serves, events, data across a restart, the after-close reading, ends when the client is gone), and boundaries (the host reaches no Electron or renderer; the client loads only its own files and shared shapes).
  - Window scenarios in presentation mode through Electron and the utility-process host, final build: presentation, loop-result, stop-asked, errors, switch first and again, resume-choice refused, failed and ok, review-window, review-discussion, review-direct, unsaved-edits-survive-a-switch, one-graph-view regression, and liveness-and-an-ending, all exit 0.
  - Host killed mid chat-loop run: one unanswered call (`loop.startChatRun`), exit 27, the run record left without an ending (reads back incomplete), nothing resent.
  - Host entry removed: "stopped while starting", no window opened, no DSpatch file written.
  - Packaged build (into the scratchpad) ran presentation from app.asar: passed.
- **Simulated:** every provider answer (presentation adapters); the native file dialogs (scripted picks).
- **Pre-existing failures, identical on an unchanged build of aec3140:**
  - says-less fails on the words "mandate" and "walks";
  - folders: the large folder is not drawn within 120 s.

Review: dspatch-reviewer REWORK (B1 after-close reading lost on shutdown; B2 a restart discarding the editor's unsaved drawing; improvements I1-I6), all addressed; the re-review gave ACCEPT. It notes that `host.shutdown` is registered outside the typed `handle()`, and that the client allowlist accepts any `shared/` file.

Remaining direct dependencies or departures:
- File choosers return client paths.
- *Show in folder* and the role-source reveal use the client's file manager on host paths (same machine today).
- The scripted harness reads host evidence through scripted-only methods.
- Ending the host when the client is gone is interim behaviour.
- The review discussion panel after a restart is not observed.
- Child processes of a host that crashed are not established to end.

Still open and needing Niclas's decision (unchanged): the transport and its authentication; what a dropped connection does to work in progress; one or several clients (single writer per conversation and review is not host-enforced yet); where durable history lives and any local caching. Not done: host-side browsing, a remote transport, reconnection, two-machine and Linux trials (DSP-131).

27 Oct 2026, DSP-149 (Niclas's decision): the start page has a Remote Session button beside Open Project, the approved entrance to connecting over SSH and choosing folders on the remote host. Placement, name and SSH as the intended path are approved; authentication details, disconnect behaviour and several clients are not decided. Until this card's remote transport exists the button is shown inactive with a short explanation, and nothing connects. Local and remote workspaces are meant to reopen from the same Recent list, with a remote workspace's connection settings saved with it.

Focus (night session 30 Oct 2026, Niclas): a remote host-client first version. His message settles for this trial: the transport is chosen by the implementer, small and safe, a local endpoint through an SSH tunnel being acceptable; no unauthenticated host on a network; the host owns files, git, providers, jobs and durable review state; work on the host may finish while the client is away and the client recovers state and finished answers; nothing is resent. Use at work with Copilot is now in scope for this trial.
Night session, 30-31 Oct 2026: first remote version, on Niclas's instruction, which settles for this trial the transport (TCP on the host's loopback through an SSH tunnel; token proved by HMAC both ways), disconnect (work goes on, its state unknown until reconnected; numbered messages replayed; nothing resent), one client at a time (a new one takes over; this is not AC #9's per-conversation writer) and history on the host only. See the roadmap's paragraph of 31 Oct. Use at work with Copilot, out of scope above, is now in scope for this trial.

Done: `dist/host/remote-host.js`, RemoteServer, RemoteLink, the connection line in every window, the Remote Session form, the host chooser, `files.browse`, `scripts/remote-trial.mjs`. An independent review (REWORK: an answer or event reaching the next client, a claim that work goes on, SIGHUP, runtime death and others) was addressed.

Verified on one Windows machine, separate processes and data folders, real TCP, a forwarder in the tunnel's place, real windows and input, SIMULATED provider (presentation adapter): phases panel, context, context-walk, insight, selection; remote (Stop, a cut during an answer and during a walk job, one prompt each, the host chooser), remote-again (new client, saved history, no prompt), remote-restart (reads unknown, no prompt), remote-version (refused in a sentence, exit 26). The guard saw 0 client touches of the project in those paths. The Remote Session form: its refusal only; Connect's restart into a session is not tried. Intermittent: `selection` failed 2 of 6 remote runs with a scripted drag ending one character short, the same step as the panel-phase stop recorded on DSP-150; unexplained.

Not tried: real SSH (no SSH server here), two machines, Linux, chat and loops with a real provider over the transport, a real network failure. ACs stay open; AC #10 requires two real machines.

Trial feedback on b99629f (real Copilot over a real SSH tunnel, two Linux machines, user-reported), 31 October 2026:

- **Connect:** `app.relaunch()` + `app.exit(0)` replaced by a host move in the same process (`moveToHost`, `main.ts`). Reproduced here: the relaunched client has stdin, stdout and stderr on /dev/null and the terminal returns to its prompt, with the same last log lines. On this machine its window did appear, so why none appeared on the laptop was NOT reproduced; the move removes the dependency on it. The exit also killed the local host without its orderly close, which was the false "stopped unexpectedly". Review and editor windows save and close; a remote host is left running; a saved session is written only once the move goes ahead; an unsaved drawing is asked about first (a change from the silent loss before).
- **Default model:** Copilot's catalogue marks no default and the SDK does not say what an unset model means, so the row says "Default model (not identified by the provider)" until a session's `session.start` reports `selectedModel`. `modelRows` shows a named default on its model, `auto` as Auto. *Last reply* remains the provider's report of the model used. The `session.start` reading has not been seen with real Copilot.
- **Project chat:** command lines left the conversation, live and reopened (Niclas's decision of 31 October 2026, replacing DSP-145's transcript lines); records stay and Session details still shows them. One activity line from the provider's events, in all providers' path; the composer's turn-progress sentences went with it.

Verified on Linux, real window, real clicks over the DevTools protocol, isolated data, host in its own process on the same machine, SIMULATED provider: local start, Connect, working remote chat in the same process, Leave with a review window open, Connect again; no "stopped unexpectedly"; each prompt once in the host's record; Read, Search, Command and Writing lines with never more than one at a time; Stop; error; reopened conversation free of tool lines. Picker and Discussion: `inherit-copilot` (none, Auto), the same with a named default (`haiku`, startable; the phase's literal `copilot-default` then reports a mismatch by design of its expectation), `panel-copilot` (none, Auto). Superseded for what the follow-up below settles.

Follow-up on c9d8fbe, same setting:

- **Connect now asks first** (`probeHost`, `remote-link.ts`): a port with nothing behind it answers in the form after 6 s, a wrong token at once. The local host, the window and the saved settings stay as they were, and the same form connected on the next try. Before this it closed the local host first and then showed a native dialog.
- **Model handed to the adapter:** settled by Niclas's decision of 1 November 2026, see below.
- **Unsaved drawing:** a real edit in the editor view of the chat window, the native question answered from `DSPATCH_UNSAVED_DRAWING` because the window cannot press it. `cancel` kept the drawing, the local host and no saved session; `discard` moved.
- **Agent error:** the turn shows the provider's sentence under the status, and the composer stays usable.

Not tried: real SSH with this build, real Copilot, Windows, the native dialogs (unsaved drawing; a saved session's host not answering at start or after a restart).

Niclas's decision, recorded with the follow-up to bd409c8: following the provider's default is a choice of its own, everywhere.

- **Default model:** the default row's value is the provider's default whatever it names now (`Haiku 5.5 · default`), and the same model's plain row is locked to it. Choosing the default row clears the stored choice. Claude's walks and reviews on it ask for no model; the job records `default`. Verified in real windows, SIMULATED provider. Chat: `copilot-default` before and after a later list named `haiku` (words changed, value not), `haiku` when the plain row was chosen and after reopening, `copilot-default` when the default row was chosen again. Discussion: `copilot-default` then `haiku`. Picker: `copilot-default` for none, Auto and named; Claude asked for no model on its default, `opus` kept when inherited, `sonnet` when chosen.
- **Save across a host change:** a temporary loop in an isolated folder, a real edit and the real save path; the native question answered from `DSPATCH_UNSAVED_DRAWING`. Cancel and a failed save (a read-only folder) kept the editor, its unsaved changes, the session state and the file. A save wrote the moved node (x 360 to 383) before `connecting to the host`, in that log order. The save also rewrites key order in the file, as any save of a graph does.

Not run on this code: the `model-list`, `model-start` and `model-flow` window scenarios. Native dialogs were still not pressed.
<!-- SECTION:NOTES:END -->
