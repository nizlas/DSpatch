# DSpatch – open a project, change it, review the diff

This is DSpatch's product code. It opens a window that connects to Cursor
through the adapter in the main process, opens a session over **a project you
choose**, streams a conversation about it, lets the agent make real code changes
on disk, shows a conventional unified diff of what actually changed, and runs a
build or test command you can see and edit — with the result tied to the exact
content it ran against.

DSP-1 built the connection and the evidence habits: substep 2 established that
the stack works, 3 that it can be packaged, 4 that the agent connection works,
5 that a bounded code change can be made and tested, 6 what cancellation and
connection failure actually do, and 7 that the whole workflow runs from the
packaged artifact. DSP-2 replaced the generated scratch repository with a real
one and added the review surface.

This document is intended for a developer who did not write the code. It covers
fetching the repository, installation, development mode, building and running
the packaged artifact, and what a first connected run needs.

## Prerequisites

- Windows. Linux is a target but remains untested; none of these instructions
  have been tested there.
- Node 22.12 or later, with npm. Tested with Node 24.21.0 and npm 11.19.0.
  A real `node` executable is also what runs the working copy's test; see
  [Running the test](#the-connected-workflow).
- Git.
- Internet access for initial installation and packaging, when the Electron
  binary and distribution archive are downloaded.
- **A Cursor login**, for anything that talks to the provider. See
  [Signing in without a secret in the repository](#signing-in-without-a-secret-in-the-repository).
  Building, packaging and the startup smoke test need no account.

No key or secret environment variable is ever set by DSpatch, and none belongs
in this repository.

## Fetch and install

Clone the repository and install dependencies. All product code is in `app/`;
run the commands below from that directory.

```powershell
git clone <repository URL>     # see `git remote -v` in an existing working copy
cd DSpatch\app
npm install
```

Electron 44 does not download its binary during installation: the package has
no `postinstall`. The download happens on first use, during the first
`npm run dev`, and takes a little time. This is expected.

If `node` or `npm` cannot be found in an already open terminal, its PATH may be
stale. Open a new terminal or update the session:

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:PATH"
```

## Run in development mode

```powershell
npm run dev
```

The command compiles the main process and preload with `tsc`, starts Vite's
renderer development server on port 5273 and opens Electron against it.
`strictPort` fixes the port: startup fails if it is occupied rather than
silently switching ports.

The chat window has **Edit agent loops** (the graph editor at `#editor`; the
editor has **Back to chat**) and **Use loop**. With Use loop off, Send is the
ordinary single-agent chat. With it on, Send walks
`docs/loop/graphs/dspatch-chat-loop.graph.json` on the project already open;
the composer text is the entry mandate. `npm run editor` opens the editor
directly.

Nothing has to be configured first. The user gives the assignment; the agent
investigates the project and runs whatever commands the work needs. The
**Build and test** panel is a separate, older tool for running a command
yourself — it is not a precondition for the loop. How a person, the agents
and Maestro share the work is in
[INTERACTION_MODEL.md](../docs/INTERACTION_MODEL.md). The chat loop is being
corrected to match that document; until the correction lands, a loop run may
still ask you to confirm a command. That confirmation is a defect, not the
intended product.

That comparison is of the **project folder**, not of the agent, so a run names the
files it measured as changed rather than only counting them: anything else that
wrote into the folder while the loop was working — a build server, an editor
saving, an indexer, or you in another window — is counted as a change and appears
in that list. A path you did not expect is more likely to be one of those than
something the agent did. What the comparison does not look at is `.git`,
`node_modules` and `artifacts`, at any depth.

An agent can also end a run by saying the task itself cannot be done. That is read
from how the reply **opens**: a reply beginning with `SPEC_ERROR` or `BLOCKED` ends
the run at *Stopped without doing the work*. Mentioning either word in the middle
of a sentence — *"the render thread is blocked on a mutex"* — is ordinary prose and
ends nothing, which matters on a C++ project where that is the expected answer.

## Build and run the packaged artifact

```powershell
npm run clean     # removes dist/
npm run package   # builds and packages everything
```

`npm run package` runs `npm run typecheck`, then `npm test`, then `npm run build`,
then `electron-builder` using `electron-builder.yml`. The tests run before the
build on purpose: they are the negative controls for the scripted run's pass/fail
rules, and a rule that has stopped being able to fail should stop the packaging
rather than be discovered later. The output is an unpacked executable directory:

```text
app\release\win-unpacked\DSpatch.exe
```

Double-click it or run:

```powershell
.\release\win-unpacked\DSpatch.exe
```

The artifact needs **no** development server and **no** `npm`. It loads the
renderer from its own `resources\app.asar` and requires `@cursor/sdk` from the
`node_modules` inside that archive. Keep the entire directory together;
`DSpatch.exe` cannot be moved out on its own, and neither can
`resources\app.asar` — the native binaries beside it in
`resources\app.asar.unpacked\` have to stay where they are.

The directory is approximately 415 MB, mostly Electron's runtime. It is
Git-ignored and must not be committed.

It does need a Cursor login and a `node` executable to reach its own connected
workflow. Without a login the window opens and reports the connection as
`not-connected` rather than failing.

### Starting it, and what to expect

Everything below was measured on the packaged artifact, driven from outside the
window, on 15 September 2026. Where a number is quoted it is what that run
produced; your session will produce different ids and different answers.

```powershell
.\release\win-unpacked\DSpatch.exe
```

**At startup** the window shows a status strip and, under *Version*, two facts
worth a glance: *Running as* says `a packaged application`, and *Build identity*
names the sources this executable was built from — a digest, a file count, the
build time and the git revision, including how many files were uncommitted at
build time. That last part matters: the artifact that sat in `release/` before
this field existed turned out to predate three stories, with nothing on it to say
so. To check the digest against a working copy, run `node
scripts/build-identity.mjs` there; it prints the same digest if the sources
match. The same facts are also printed on stdout at startup, so a run whose
output is redirected to a file answers the question without opening *Version*:

```text
[dspatch] build packaged=true version=0.1.0 identity=b4a87678dd5203cd files=35 git=3d44171 changedAtBuild=39 built=2026-09-15T09:21:52.383Z
```

**The connection** resolves on its own within a few seconds and the strip says
`connected` with the account it found. Nothing is sent to a model by starting the
application, opening a project, reading a diff or running a test — only the
*Send* button does that.

**Opening a project.** *Choose a folder* opens a native dialog; folders opened
before are listed as shortcuts. On opening, DSpatch reads the working copy's git
status and takes a content-addressed baseline snapshot of the files, which is
what every later diff is measured against, so a change you make outside the
window is as visible as one the agent makes.

DSpatch **refuses to open its own working copy**, and the refusal is by content
rather than by path. From the folder you chose it walks **up** through the parent
directories and asks each one whether it is DSpatch's own repository —
`app/package.json` naming the project `dspatch`, with a `docs/VISION.md` beside
it. So the repository root is refused, and so is any folder inside it, `DSpatch\app`
included, from anywhere on disk and with nothing opened and nothing changed. No
environment variable is involved and none needs to be set: the check works the
same from source and from the packaged artifact. That is now true of the code as
well as of this paragraph. A fourth refusal survived beside these three until
15 September 2026, comparing the folder you chose against a path DSpatch had been
*told* was its own — a path `DSPATCH_PROBE_REPO_ROOT` can set. Pointed at an
ordinary directory, it refused an unrelated project inside it while claiming the
project was inside DSpatch's working copy, which nobody could act on because it
was not true. It is gone: setting that variable cannot add a folder to what is
refused or remove one from it. The reason is DSP-1's
measurement that the agent is not confined to the folder it is given: a writing
run in DSpatch's own tree could edit DSpatch while it runs. Containment is not
built yet. Use a copy elsewhere.

**A folder that *contains* DSpatch is refused as well.** The walk above looks
upwards, so it cannot see a clone sitting below the folder you chose — choosing
your whole `development` directory would hand the agent `development\DSpatch`
along with everything else under it, which is opening DSpatch the long way round.
So DSpatch also refuses a folder that its own working copy is inside, at any
depth. That refusal names where DSpatch sits within the folder you chose and
points you at opening the specific project instead, because someone who keeps
every project under one parent directory will meet it while doing nothing wrong.
It answers this from where the application is running rather than from the
contents of the folder you chose, and it finds that by the same content walk, so
no environment variable is involved here either.

Which folders are the same folder is a question for the filesystem rather than for
the text of the paths. One directory can be written several ways —
`C:\Users\you\dev`, the same directory over a share as
`\\localhost\C$\Users\you\dev`, or by its 8.3 short name `C:\Users\you\DEV~1` —
and until 15 September 2026 every one of those spellings opened the directory above
DSpatch, because the two paths were compared as text and text that shares no prefix
looked like two different places. That was not a corner: DSpatch's own folder dialog
hands back a share path exactly as you typed it, and a network share is an ordinary
place to keep a project. The two are now compared by the identity the filesystem
reports for them, so a spelling nobody has thought of costs nothing. Links are the
exception, and the paragraph below says so.

**When DSpatch cannot tell, it refuses.** If the `app/package.json` that would
identify a folder cannot be read or is not valid JSON, the folder is refused
rather than opened, and the refusal names the file, quotes why it could not be
read and says what to do about it. A check that lets a folder through because the
marker it reads is unreadable is worse than no check, since it is trusted — and
this is not hypothetical: an agent overwrote that file earlier in this project's
own development. So that this cannot refuse your own project because its manifest
is half-typed, refusing on an unreadable manifest also needs one of DSpatch's
other distinctive files to be present — `AGENTS.md`, `BACKLOG.md`,
`docs/DEVELOPMENT_LOOP.md` or `backlog/tasks/`. This, the folder inside DSpatch and
the folder containing it were all three holes in the refusal until 15 September
2026, and the tests fail if any of them returns.

**The reach, stated exactly, because a guard is only worth what it covers.** It
identifies a tree by `app/package.json` plus `docs/VISION.md`, so a copy with
either of those removed is not recognised at all. The refusal for a folder that
*contains* DSpatch needs the running application to be able to resolve its own
location, which it can from source and from the packaged artifact inside the tree
it was built in; a copy of that artifact moved out of its tree cannot, and then
that particular refusal cannot fire, although refusing DSpatch itself and every
folder inside it still does. **Links are not followed**: a folder that reaches
DSpatch through a junction or a symlink *inside* it — an ordinary project with a
`vendor\dspatch` that points at this repository — is not recognised as containing
DSpatch, and opening it is allowed even though the agent can reach DSpatch's source
through the link. Choosing the link itself, or any folder under it, is refused,
because the walk upwards reads DSpatch's markers through it. Recognising the folder
*above* such a link would mean searching downwards through everything under the
folder you chose, and every question here is answered by looking up; that is work
with a cost nobody has measured yet, so this is a limit and not a claim. One more:
if the filesystem will not say whether two directories are the same directory,
DSpatch refuses and names the directory it could not identify, rather than treating
silence as a clean answer. Whether the running application could resolve its own
location — the state the containing refusal depends on — is printed at startup, so
it is checkable rather than assumed:

```text
[dspatch] ownRepo=C:\Users\you\development\DSpatch generatorBoundary=C:\Users\you\development\DSpatch
```

`ownRepo=none` is the case above where a moved artifact cannot resolve its own
location. And the guard decides which project may be opened, not what
the agent does once inside one: DSP-1 measured that the agent reads and writes
outside the folder it is given, so this is a guard against pointing the tool at
itself, not a boundary. `DSPATCH_ALLOW_OWN_REPO=1` lifts it for someone who means
to.

**A turn** streams into the window as it arrives, with the model and the token
count beneath it when the provider reports one. Monetary cost always reads
`cost unknown` rather than zero: this account's cost API answers HTTP 403, and the
*Capabilities* card says so instead of the turn pretending otherwise. *Read files* produces a normal unified diff, labelled
with the two snapshot ids it is between. The test command is yours to edit and
defaults to something sensible for the project; its verdict is tied to the
snapshot it ran against, so a pass stops being presented as a pass once the code
has changed under it. `npm test` needs a real `node` on `PATH` — the measured run
found Node 24.21.0 and finished the trial repository's three tests in 114 ms.

**Closing while an answer is still arriving** is a supported way to stop, not a
crash. The conversation is on disk already. Reopening lists it; opening it shows
the messages, the reviewed diff and the command result before any provider
session exists, and the attempt that never reported an ending is shown as an
unknown outcome you confirm before sending again — once for that attempt, not
once per message, and not at all if you confirmed it before the window closed.
DSpatch does not repeat it.

*Continue* then asks Cursor for the session the conversation was last worked in.
Two things can happen next, and the window says which:

- It is resumed, and the model still has the earlier turns in its own memory.
  But a session that was left holding an unfinished run **refuses the next
  message** — `already has active run`, in the provider's own words. Waiting is
  not known to clear that block, and DSpatch no longer says it does. Measured on
  15 September 2026: a turn killed in the window was still refused 11 minutes
  later, and a run whose client process tree was killed mid-stream was refused at
  every one of fifteen once-a-minute checks across 15 minutes — the first 2.3
  seconds after the kill, the last 14 minutes after it — while a new session over
  the same repository answered on the first try. `Agent.resume` succeeded each
  time; it is `send` that is refused. Whether such a run ever reports an end is
  unknown: fifteen minutes is not a proof of "never", and DSpatch never subscribed
  to that run and cannot see it end. So the failure offers *Continue in a new
  provider session* as **the** way out: a fresh session over the same project and
  the same conversation, nothing sent to the run that is in the way, nothing on
  disk touched.
- It cannot be resumed, or you asked for a new session. The model then has no
  memory of the conversation, so DSpatch puts its own recap in front of your next
  message — and shows you that recap, in full, **before** you send it. In the
  measured run it was 2 519 characters and the text sent was identical to the
  text shown. Whether the model then acts on it is the model's decision: one run
  answered the question the recap set up, another declined to trust a passphrase
  quoted from a previous session.

### Where the data lives

Conversations are written to Electron's `userData` directory, which on Windows
is `%APPDATA%\dspatch`, in a `conversations` subdirectory — one JSON file per
conversation, written as you work rather than on exit. The window names the
directory it is actually using at the top of the conversation list, and the main
process prints it at startup:

```text
[dspatch] userData=C:\Users\you\AppData\Roaming\dspatch conversations=...\conversations
```

Two things about those files are worth knowing before sharing one. Command output
is stored **verbatim**, and so is a base64 copy of the project files the session
started from — that copy is what lets the diff be read back after a restart, with
git-ignored files and anything over the size limits excluded. Treat a
conversation file with the same care as the code and the terminal output in it.
*Export* writes a byte-for-byte copy wherever you choose, including for a file
this build cannot parse.

A save that was interrupted leaves a `*.json.writing-<pid>` file behind. Those
are listed, never read back, and left alone deliberately: they may hold the turn
that is missing from the conversation. Delete them when you are finished with
them.

To keep a trial run out of the real profile, redirect the whole directory:

```powershell
.\release\win-unpacked\DSpatch.exe --user-data-dir=C:\Users\you\AppData\Local\Temp\dspatch-trial
```

The startup line above then names that directory, which is how to confirm the
redirection actually took effect rather than assuming it.

### Packaging scope

The target is `dir`, an executable directory. There is **no installer, code
signing or automatic update mechanism**. These are outside the task.

### Unsigned `DSpatch.exe`

The binary has no digital signature (`Get-AuthenticodeSignature` reports
`NotSigned`). Practical implications:

- **Locally built artifact:** it started without a warning in the observed
  Windows test. The local file had no internet-origin marker.
- **Artifact transferred from another computer or downloaded as a ZIP
  (untested):** internet-origin marking and Windows policy may trigger
  SmartScreen's *“Windows protected your PC”* dialog, identifying the publisher
  as unknown. Where policy permits, **More info** and **Run anyway** are the
  available controls. **This has not been tested.** The local build test does
  not cover it, and copying a file does not always give it an internet-origin
  marker, so it is a prediction rather than an observation.
- Antivirus software may also flag an unsigned Electron binary. This was not
  tested here.

`electron-builder` logs `signing with signtool.exe` while packaging. That is not
a signature: with no certificate configured the result is still unsigned, and
`Get-AuthenticodeSignature` reports `NotSigned` on the built `DSpatch.exe`.

## Startup smoke test

Set `DSPATCH_SMOKE=1` to start the app, load the renderer, report observations
and exit with a code. A launched command is not evidence of a window: the probe
passes only after the window is shown **and** the renderer has painted and
acknowledged readiness through preload.

```powershell
$env:DSPATCH_SMOKE="1"; npm run dev                         # development mode
$env:DSPATCH_SMOKE="1"; npx electron .                      # built files; run npm run build first
$env:DSPATCH_SMOKE="1"; .\release\win-unpacked\DSpatch.exe   # packaged artifact
```

Clear the variable afterwards (`Remove-Item Env:\DSPATCH_SMOKE`) or the app
will immediately exit on its next launch.

| Exit code | Meaning |
| --- | --- |
| 0 | The window was shown and the renderer painted. |
| 2 | The renderer could not be loaded. |
| 3 | Both conditions were not met within 30 seconds. |
| 4 | The renderer process disappeared. |

Interpret output carefully. `did-finish-load` is also logged when Chromium
displays its own error page, so it cannot distinguish success from failure.
The decisive lines are `renderer-ready …` and `startup smoke test passed …`.
Earlier Swedish logs used `startprovet lyckades …`; retain those logs verbatim.

When `DSpatch.exe` starts as a Windows GUI process, logs do not automatically
appear in the terminal. Redirect them to files:

```powershell
$env:DSPATCH_SMOKE="1"
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput smoke.log -RedirectStandardError smoke.err
```

`-PassThru` returns the process object whose `ExitCode` should be read.

## Signing in without a secret in the repository

A first connected run needs a Cursor login. **DSpatch never performs it, never
reads the credential and never stores one.**

The SDK resolves the credential from its own store, outside this repository:

```text
%USERPROFILE%\.cursor\sdk\auth.json
```

To create it, sign in once with Cursor's own tooling — `cursor-agent login`, or
Cursor's normal sign-in — and let it write that file. Then start DSpatch. The
Connection panel names the account it found, the backend it is talking to, how
many models the account can request and when the credential expires.

What keeps a secret out of the repository is not a rule in a document, it is
where the credential lives and what the code does with it:

- The adapter passes no `apiKey`, so the stored login is the only source.
- DSpatch never calls `Cursor.auth.login()` or `logout()`, and never sets
  `CURSOR_API_KEY`.
- Nothing reads, copies, prints or hashes `auth.json`. The window shows its
  **path** so you know where to sign in; it never shows its contents.
- The SDK's local agent store is written outside the repository too. Its
  contents are deliberately not read: it contains a `blobEncryptionKey` in clear
  text, and a saved log must not be one provider change away from carrying it.
  Saved records list that store's file names and sizes only.

If no login is found, the window reports the connection as `not-connected` with
the reason and the expected store path. It does not offer to log you in, and no
session can be started until you have.

Observed on this machine: credential resolution behaved the same from the
**packaged artifact** as from built files. Both reported `connected`, named the
same account and read the same number of available models.

## The connected workflow

Everything below happens in one window, over one working copy, in one session.

1. **Connection.** Checked at startup and shown in the Connection panel. While
   the check is in flight the panel says so; it never shows an empty field that
   could be read as "no account".
2. **Choose a folder.** The picker opens in the main process; the renderer is
   sandboxed and has no file system access. Before anything else happens DSpatch
   records the folder's git revision, branch and **which files were already
   modified**, then hashes its content into a baseline snapshot with an
   identifier derived from the bytes. Your own uncommitted work is therefore
   established before the agent exists and can never be attributed to it later.
   Projects you have opened are remembered and offered on the next launch.

   **DSpatch refuses to open its own working copy, any folder inside it, and any
   folder that contains it.** The repository containing the folder you chose is
   resolved by walking up from it, and a manifest that cannot be read makes the
   check refuse rather than allow. DSP-1 measured that the agent is not confined
   to the folder it is given, so a writing run here could edit DSpatch while it
   is running. See
   *Opening a project* above for exactly how far this reaches and what it does
   not cover. `DSPATCH_ALLOW_OWN_REPO=1` overrides it for someone who means to.

   *Use a generated sample project* is still there: it creates a small
   disposable repository **outside** this repository, in a folder of its own under
   `%TEMP%\dspatch-chat`. **Every new session generates a new one, so nothing in
   there is yours to keep.** Earlier ones are left alone rather than reused or
   cleared — a sample project that is in the way cannot stop a new session, which
   is what DSP-61 was about — and *Project → Old sample projects…* removes them
   when you ask. `DSPATCH_CHAT_WORKSPACE` still names a path directly, and a path
   named that way is treated as named by a person: no fresh folder, no cleanup, and
   a non-empty directory without the `.dspatch-experiment` marker is refused.
3. **Send.** The answer streams into the transcript as it arrives. A follow-up in
   the same session keeps the conversation's context. Every turn carries its own
   run id, so a late event from a superseded run is dropped and counted rather
   than appended to the wrong message.
4. **A change request** makes the agent edit files in that working copy. A
   reading question can remain read-only, and the window shows how many tool
   calls the agent made of its own accord.
5. **Check files on disk** hashes the working copy, compares it with the session
   baseline and shows, for every difference, a **conventional unified diff**
   computed from the bytes on both sides. The patch header names the two
   snapshots it is between. Added and deleted text files appear in full. A file
   that cannot be shown as text — binary, not valid UTF-8, above the 1 MB
   per-file limit, or one whose baseline content was not kept — is still listed,
   with the specific reason. A file that already carried your uncommitted work is
   marked, and its diff shows only what changed since the session opened.

   **The diff is not exhaustive, and the panel says so.** In a git repository the
   baseline lists files with `git ls-files`, so a change to a git-ignored file is
   outside it and will not appear at all.
6. **Build and test.** The command and the working directory are two editable
   fields in the window; there is no configuration file. DSpatch fills them in
   from the project — `npm test` when package.json has a test script, its build
   script otherwise, the sample project's own `node --test` where that applies,
   and an empty field with an explanation when it cannot tell. The command is run
   through the platform shell as a child of the main process, and the window
   shows exactly what was executed, which shell interpreted it, stdout, stderr,
   the exit code and the duration.

   **A result is bound to the code it ran against.** DSpatch hashes the working
   copy immediately before the command starts and immediately after it finishes.
   Once the working copy moves on, the result is marked `stale` and says which
   snapshot it describes and which one is on disk now; it is not deleted, because
   it is still a true record of the state it ran on. If the command wrote into
   its own working copy, that is reported separately. **Stop it** kills the
   command and its whole process tree, and a stopped run is never shown as having
   an exit code.

   **An interrupted run can never read as a pass.** The verdict is decided in the
   main process from what actually happened — whether DSpatch killed the process,
   whether it ended on a signal, whether there is an exit code at all — and the
   window only displays that decision. A run DSpatch stopped is shown as
   `interrupted — not a result`, and it stays that even if the exit code that
   arrives happens to be 0.
7. **Cancel** during a turn asks the provider to stop and then keeps watching for
   90 seconds for signs that it did not: further tool calls, further files, a
   later usage record. The panel reports what was observed and says plainly that
   "no continued work observed" is not the same as "the provider stopped".

### Interruption and recovery

Every message and every command is an **attempt** with its own identifier and an
explicit state, listed in the **Execution state** panel: waiting, running,
cancellation requested, confirmed stopped, outcome unknown, completed or failed.
Each attempt says what may still be running — separately for the provider and for
a process DSpatch started — and carries the one action that applies to it.

- **A send that has not come back can be abandoned.** *Stop waiting* is available
  for as long as the send is outstanding. That interval is real and measurable:
  the adapter announces the run within about 100 ms, but it holds nothing it can
  cancel until the provider replies, which took 11–12 seconds in the measured
  runs. Cancel in that window fails; *Stop waiting* does not attempt it. It
  records the outcome as **unknown**, keeps your text in the composer, and asks
  the provider to cancel the run the moment a cancellable one exists. In a real
  run the record improved from unknown to confirmed stopped about two seconds
  later, when the provider reported the run as cancelled.
- **Unknown is a state, not a gap.** It is never collapsed into "stopped": DSP-1
  measured a turn that kept producing tool calls for 69.5 seconds after its
  connection was severed.
- **Nothing is repeated by itself.** While an attempt of the same kind is
  unresolved, DSpatch refuses to send another message or start another command,
  and the refusal happens **before** the provider is touched. To proceed you name
  the attempts you have seen — *Send anyway* or *Run again* — and they stay on the
  record as unresolved rather than being marked stopped. Nothing automatic can
  supply those names, so no retry, reconnection or double click can duplicate work
  that may still be going. A confirmed stop needs no such confirmation, so an
  ordinary cancel does not get in your way. **Every** unresolved attempt of that
  kind has to be named, not the most recent one: the control lists all of them and
  says how many, because a restart can easily produce two and letting one through
  unnamed would leave work nobody has looked at.
- **You are asked once per attempt, not once per message.** The acknowledgement is
  written to the attempt's record, so after it the composer works normally for the
  rest of the conversation — including after a restart, because the record is in
  the conversation file. Before this, the acknowledgement was written and never
  read back: in the 15 September trial one dead attempt in an eleven-attempt
  conversation blocked every following message, and since the run had no listener
  left, nothing could ever resolve it. A *new* unknown outcome still raises the
  gate on its own account. What does not change is the record: the attempt stays
  `outcome-unknown` in **Execution state** and in the file, the row shows when you
  accepted it, and acknowledging never claims the work stopped.
- **A long wait reads as a wait.** Silence is never presented as a failure, at
  any length. Past 20 seconds the window says the wait is longer than usual, and
  it still offers only a way out, not a verdict.
- **Failures arrive as sentences.** A rejection that crosses Electron's bridge
  reaches the window as `Error invoking remote method 'dspatch:…': Error: …`.
  DSpatch strips that wrapping, shows the failure's own words, names the channel
  as a detail, and offers the one action that applies: try again, check the
  connection, choose another folder, open the project again, or continue with an
  earlier attempt left unresolved.
- **The connection check retries twice and then stops** — after 2 s and 6 s — and
  says how many times it has failed. Only the check is ever repeated; a message
  or a command is never retried on its own. Everything else waits for you.

Cost is shown as **unknown**, never as 0. Per-turn token counts arrive on the run
stream and are shown when they do; the account-level cost API is refused for this
account with HTTP 403, and a cancelled turn reports no token count at all.

### Saved conversations

Closing the window no longer loses the work. Each conversation is one JSON file
under Electron's `userData`, and **Saved conversations** in the project chooser
lists them newest first:

| Windows | `%APPDATA%\DSpatch\conversations\<conversation-id>.json` |
| --- | --- |
| Linux | `~/.config/DSpatch/conversations/<conversation-id>.json` |

The remembered-projects file (`dspatch-projects.json`) sits beside that directory
and now records which conversation each project belongs to, so opening a project
again continues its conversation rather than starting an empty one next to it.
Both are outside every project, so nothing DSpatch remembers reaches your git
history. The current format version is **1**; a file written by a later DSpatch is
read-only and is never rewritten, and one that has been hand-edited into invalid
JSON is reported and left exactly as it is.

**The list can be pruned.** Each remembered row has *Forget*, and a row whose
folder is no longer on disk says so; when several are gone the panel offers to
forget all of them at once. *Forget* edits that one list and nothing else: the
folder on disk is untouched, and every saved conversation is still saved, still
listed under **Saved conversations** and still openable. The entry's record of
which conversation it belonged to goes with the entry, so opening that folder
again starts a new conversation — the old one is reached from the conversation
list. A file this build must not rewrite is refused with nothing removed rather
than pruned on screen. This exists because the 15 September trial found nine of
ten remembered entries were throwaway `%TEMP%` repositories from overnight
verification, several already deleted, with no way to remove any of them.

A file holds the messages in order with their run IDs and token counts, every
attempt with its state and history, each command run with its command, working
directory, output, exit code and the snapshot identity it ran against, the diff
that was reviewed verbatim, and enough of the session baseline to read that diff
again — up to 256 kB per file and 16 MB per conversation, with every omission
named in the file so a file whose diff cannot be shown says why instead of
appearing unchanged. There is no field for the credential, the account address or
the backend URL: secrets are excluded by construction rather than filtered.

**Command output is stored verbatim.** Whatever your build or test printed is in
the file as it was printed, including any path, host name, environment value or
token that the command itself wrote to its output. DSpatch neither redacts nor
truncates it, because a result you cannot read in full is not evidence. Treat a
conversation file you send to someone else the way you would treat the terminal
output it contains.

#### Exporting one conversation

Each row in **Saved conversations** has *Export a copy*, which asks where to save
and then writes a **byte-for-byte copy** of that conversation's file. There is no
separate export format: the stored JSON is the export, so a copy read by anything
else sees exactly what DSpatch sees. After writing, DSpatch reads its own copy
back and reports what came out of it — the size, a SHA-256 of the bytes, whether
they hash the same as the source, and the message count and format version it
could parse — so "you can read this back" is a measurement rather than a claim.

The button is deliberately **not disabled for a file DSpatch cannot read**.
Getting an unreadable record somewhere safe is exactly what you want when the
record is unreadable, and copying bytes needs no parser. When the source is
corrupt the copy is corrupt in the same way, and the result says so rather than
implying a rescue. *Show the file* opens the containing folder with the file
selected, for the same reason.

Setting `DSPATCH_EXPORT_DIR` writes to that directory instead of opening the save
dialog. That exists for automated runs; interactively the dialog is the only thing
that chooses a path.

#### When a stored file cannot be read

Every way a conversation file can be unusable produces its own explanation **and**
a concrete recovery action, and none of them loses anything: the file is left
exactly as it is in all of them, and the two buttons above keep working because
neither parses it.

| What DSpatch found | What it says you can do |
| --- | --- |
| No file at all | Nothing. This is the normal first run and is not reported as a problem. |
| The file exists but this account cannot open it | The problem is the file system — a permission, a lock held by another program, or a disconnected drive — rather than the conversation. |
| Not valid JSON | Usually a hand edit. Export a copy, then look at it. |
| Not valid JSON **and** ending mid-value | Reported separately, with the byte count. A save interrupted mid-write leaves the *previous* complete file, so a cut-off file points at something else: a disk that filled up, a sync client, or an editor writing it. |
| Valid JSON but not an object | Something other than a conversation has been written to this path. |
| No usable `formatVersion` | DSpatch cannot tell which rules to read it by, and will not guess. |
| A `formatVersion` newer than 1 | A later DSpatch wrote it. Open it with that build. This one never rewrites it, so nothing in it can be lost by running this one. |
| Parsable and current, but the fields are missing or of the wrong type | DSpatch will not invent them: a conversation half-guessed from a damaged file would be a record of something that never happened. |

A file in any of those states is still **listed**, carrying its own explanation. A
conversation you can see and cannot open is a problem you can act on; one that has
silently vanished from the list is not.

Saves are written to a temporary file and renamed into place, so a process that
dies mid-write leaves the previous complete file untouched and the temporary
beside it. Those leftovers are **listed and never deleted**: the file is the only
evidence that a save was lost, and tidying it away would remove the only trace of
what went wrong. What was in that save is gone; what was already saved is not.

What comes back is **history, never activity**:

- Reading a conversation back opens no provider session, sends no message, runs no
  command and writes nothing into your project. It reads one file and hashes the
  project once. The panel states that and shows the three counts — model runs,
  commands, writes into your project — as measurements rather than as a promise.
- **A saved diff is evidence, not a patch.** It is shown with the two snapshot
  identities it named, unchanged. If the working copy has moved on since, it is
  labelled a record of what was reviewed rather than a description of the code on
  disk; it is never adjusted to fit code it was not taken from, and DSpatch has no
  code path that applies one.
- **A saved result does not verify new code.** The freshness rule runs again
  against a fresh hash of the working copy, so a pass saved against code that has
  since changed comes back as *passed for older code*.
- **An attempt that was still going when the window closed comes back as an
  unknown outcome** — never as stopped, and never as finished. Closing a window is
  not an ending. Continuing the conversation is refused until you name it, exactly
  as after a cancellation nobody confirmed, and naming it leaves it on the record
  as unresolved. An attempt you had already named keeps that on its record, so the
  conversation opens and sends without asking again — and the row in **Saved
  conversations** and the restored panel both say which of the two this is instead
  of promising a confirmation that is not coming.
- One conversation is held from disk at a time. Attempts are numbered per window,
  so reading a second conversation back releases the first's attempts; they stay in
  its file. If a saved attempt's number is already in use by work done in this
  window, it is not read back and the panel says so rather than merging two
  different pieces of work under one identity.

#### What a continued conversation actually tells the model

Reading a conversation back shows you the old turns. That is not evidence the
model has them. When you open the project again to carry on, one of two things
happens, and the window says which:

- **The provider session was resumed.** DSpatch asks Cursor for the session this
  conversation was last worked in. If Cursor still holds it, this is the same
  agent as before, with the earlier turns in its own memory, and **DSpatch resends
  nothing**. A resume that succeeds is evidence: asking for an agent the provider
  does not have is refused rather than quietly answered with a fresh one. Measured
  in a three-process trial — an agent was told a passphrase in one process and
  repeated it verbatim in another, and a resume of an ID nothing had created was
  refused in 11 ms with `AgentNotFoundError`.
- **A new provider session was opened.** Cursor's store is under your user profile
  and keyed by the project's path — a different place, on a different key, with a
  different lifetime from the conversation file DSpatch writes. The two can drift
  apart: a conversation carried to another machine, or one whose provider store has
  been cleared, comes back as history with no session behind it. The model then has
  **no memory of the conversation on screen**, so DSpatch puts its own short recap
  in front of your next message and shows you that recap **word for word**, before
  you send and again on the message that carried it. What the model was told is
  also saved with that message, so the same question has the same answer after the
  next restart.

The recap is deliberately small and says so inside itself: the last few exchanges
with long answers shortened, the names of the files in the diff you reviewed, and
how the last command ended. It is a summary, not the conversation, and it is sent
once — in front of the first message of that session, not attached to every later
one. It is not a way of making a new session into the old one; it is a way of not
pretending the difference does not exist.

**"Word for word" covers DSpatch's text, not the whole envelope.** The character
count and the text shown are exact for what DSpatch composed. The provider then
wraps whatever it delivers in an envelope of its own — a timestamp and its own
tags — so the model receives slightly more than what is on screen. Measured
against Cursor's own transcript of a received message: 2 443 characters where
DSpatch's count said 2 260. None of the difference comes from DSpatch or from you,
and the window says so beside the count rather than leaving it to be discovered.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DSPATCH_PROJECT_PATH` | A project to offer in the list at startup, for an automated run or a shortcut. Distinct from `DSPATCH_CHAT_WORKSPACE`, which still means the generated sample. |
| `DSPATCH_ALLOW_OWN_REPO` | Set to `1` to lift the refusal to open DSpatch's own working copy. Read the warning in step 2 first. |
| `DSPATCH_CHAT_WORKSPACE` | Where the generated sample working copy goes. Must be outside this repository. |
| `DSPATCH_NODE_PATH` | The `node` executable DSpatch offers when it suggests a command, and the one it reports in the session details. Otherwise the first `node.exe` on `PATH` is used. The command you actually run is whatever is in the field. |
| `DSPATCH_CHAT_MODEL` | Model requested. Default `claude-haiku-4-5`. |
| `DSPATCH_PROBE_REPO_ROOT` | The boundary the **generated sample project** and the DSP-1 connection probe stay outside of. Not needed normally: DSpatch finds its own repository by walking up from the application path, from source and from the packaged artifact alike. Set it only for a copy of the artifact that has been moved out of the tree it was built in, where that walk finds nothing. **It is not what contains the agent** — the refusal to open DSpatch's own working copy does not read it, and setting it cannot widen or weaken that refusal. |
| `DSPATCH_EXPORT_DIR` | Where *Export a copy* writes, instead of opening the save dialog. For automated runs. |
| `DSPATCH_CHAT_SHOT` | Where a scripted run photographs the window. The file named here is written when the run reports; a scenario that asks for pictures of its own gets them beside it, as `<name>-<label>.png`. What a layout looks like is not a number, and this is how the window itself reaches whoever asked for the change. Unset means no pictures; a failure to write one never changes the run's exit code. |

### The scripted workflow runs

Set `DSPATCH_CHAT_RUN` and the window drives its own controls and exits with a
code. It finds the real buttons, composer and fields by their `data-ev`
attributes, clicks and types into them, and records what reached the rendered
document — including the answer's length sampled repeatedly while the turn was
still streaming, so incremental rendering is measured rather than assumed.

These make real, billed provider calls.

| Value | Scenario | Turns |
| --- | --- | --- |
| `1` | DSP-1's whole workflow over the generated sample project. | 4 |
| `chat` | Open an existing project, one streaming turn and one follow-up. | 2 |
| `review` | Diff review and build/test: a failing command, a change request, the diff, a passing command, content planted through the command field, and a second change that must make the passing result read as stale. | 2 |
| `converse` | [INTERACTION_MODEL](../docs/INTERACTION_MODEL.md) §10 trials 4, 10 and 11: Enter sends and Shift+Enter does not; a loop run whose two steps hand over in one thread; a message sent while that run works, which must not start a second run and must read as received, then as given to a named step; a second message the run ends before anyone takes; and a second run interrupted, which must keep the assignment and the history and claim no success. | 3 |

`converse` generates its own throwaway project with *New session* and never opens
one from the list: a loop run writes files and runs commands in the project it is
given, so it must not be pointed at somebody's work by a remembered entry. Its
report waits 45 minutes rather than 15, because the chat loop's own drawing allows
15 minutes for one step.

`review` needs a project to work in, and it expects a specific shape: a git
repository with `src/duration.ts` incomplete against `test/format.test.ts`, a
`tools/plant.js` that writes into `scratch/` and a git-ignored directory, and
some uncommitted work planted before the run. The generator used for the DSP-2
trial is kept with that run's evidence rather than in `app/`.

```powershell
$env:DSPATCH_CHAT_RUN="review"
$env:DSPATCH_CHAT_LOG="C:\somewhere\chat-run.json"
$env:DSPATCH_PROJECT_PATH="$env:TEMP\my-throwaway-repo"
$env:DSPATCH_NODE_PATH="C:\Program Files\nodejs\node.exe"
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput run.log -RedirectStandardError run.err
Remove-Item Env:\DSPATCH_CHAT_RUN
```

`converse` needs no project of its own and no node path:

```powershell
$env:DSPATCH_CHAT_RUN="converse"
$env:DSPATCH_CHAT_LOG="C:\somewhere\converse-run.json"
Remove-Item Env:\DSPATCH_PROBE, Env:\DSPATCH_SMOKE -ErrorAction SilentlyContinue
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput converse.log -RedirectStandardError converse.err
Remove-Item Env:\DSPATCH_CHAT_RUN
```

Against built files rather than the packaged artifact, replace the
`Start-Process` line with `npx electron .` after `npm run build`.

`presentation` is the one that makes **no provider call at all**, and it is how
scrolling, Markdown and the shape of the window are checked. Its replies are
streamed by a local adapter in the main process and its login status is a fixed
reading, so it costs nothing, needs no account and is the same every time — which
is what makes a conversation of ten turns, long enough to scroll back in,
affordable to produce. It shows what the window does with text and nothing
whatever about the provider.

```powershell
$env:DSPATCH_CHAT_RUN="presentation"
$env:DSPATCH_CHAT_LOG="C:\somewhere\presentation-run.json"
$env:DSPATCH_CHAT_SHOT="C:\somewhere\window.png"
npx electron .
Remove-Item Env:\DSPATCH_CHAT_RUN, Env:\DSPATCH_CHAT_SHOT
```

It also drives the **real application menu**, because the session details and the
way to another project are menu items and a script in the document cannot see a
native menu bar. The main process presses the item; that handler exists only
while `DSPATCH_CHAT_RUN` is set, so an ordinary launch has no second way of being
driven.

`DSPATCH_CHAT_WORKSPACE` is no longer needed here. It used to be, as a workaround:
a leftover sample folder was refused, and a lingering earlier run held its files
open. DSP-61 removed the first — every sample project is generated in a folder of
its own, so a previous one cannot be in the way — and the second no longer matters
for the same reason, though the lingering process itself is still DSP-62. Removing
old sample folders is a separate action, under **Project → Old sample projects…**.

`errors` is the other scenario that makes **no provider call**: it points
`DSPATCH_CHAT_WORKSPACE` at a directory DSpatch did not generate, asks for a sample
project, and reads the refusal as a person meets it. Two things at once — the guard
still refuses a folder that is not DSpatch's, and the error is one sentence with the
technical detail behind a disclosure (DSP-64).

```powershell
$env:DSPATCH_CHAT_RUN="errors"
$env:DSPATCH_CHAT_LOG="C:\somewhere\errors-run.json"
# Not empty, and no .dspatch-experiment marker: the refusal's own case.
$env:DSPATCH_CHAT_WORKSPACE="$env:TEMP\dspatch-not-ours"
New-Item -ItemType Directory -Force $env:DSPATCH_CHAT_WORKSPACE | Out-Null
'years of work' | Set-Content "$env:DSPATCH_CHAT_WORKSPACE\thesis.txt"
npx electron .
Remove-Item Env:\DSPATCH_CHAT_RUN, Env:\DSPATCH_CHAT_WORKSPACE
```

`DSPATCH_CHAT_LOG` receives the record: the renderer's observations and the main
process's kept separate, because what the document showed and what was on disk are
different kinds of evidence.

| Exit code | Meaning |
| --- | --- |
| 0 | The whole scenario ran. |
| 30 | The window reported the connection as not connected. |
| 31 | A session could not be started. |
| 32 | The answer did not visibly grow in the window while the turn was streaming. |
| 33 | The follow-up did not recall the token planted in the first turn, so a shared session is not established. |
| 34 | The window did not show the target file as changed on disk. |
| 35 | The command did not fail before the change and pass after it. |
| 36 | Cancel could not be exercised during streaming, or the turn did not end as cancelled. |
| 37 | The script itself failed; the failure text is in the record. |
| 38 | No report within 15 minutes. **A timeout, not a verdict** — the turn may still have been running. |
| 39 | The renderer never painted, so the script never ran. |
| 40 | No unified diff bound to two named snapshots after a file changed. |
| 41 | A passing result stayed current after the code changed underneath it. |
| 42 | Content planted through the command field did not appear in the diff, so the diff is not established as reading the disk. |
| 43 | A git-ignored file appeared in the diff, so the coverage note is wrong. |
| 44 | A change with no diff text was shown without saying why, or a field did not accept typed text. |
| 50 | Enter did not send, or Shift+Enter sent, or the window took the key away from the textarea. |
| 51 | The conversation was not one thread: a message was missing from it, only one agent spoke, or a handover did not say why control moved. |
| 52 | A message sent during a run started a second run, read as delivered while only received, or named no step — or named the step that was already working. |
| 53 | An interruption lost the assignment or the history, could not be told from an observed stop, or reported a success. |
| 54 | Enter was pressed with a mandate in the box and no loop run appeared. |
| 60 | The conversation jumped, had more than one vertical scroller, or did not keep a reader's position while they read. |
| 61 | A reply was not rendered, lost characters out of its code, or produced something executable. |
| 62 | Chrome took the conversation's space, the session details were lost or shown unasked, or the model control is not beside the composer. |
| 63 | An error said nothing about what to do, showed its diagnostics unasked, could not show them at all, lost words out of a refusal in being shortened, or offered no action — or a session opened over a directory DSpatch did not generate. |

`DSPATCH_SMOKE`, `DSPATCH_PROBE` and `DSPATCH_CHAT_RUN` each own the exit code.
Setting more than one exits immediately with code 10 rather than letting them
fight over it. Clear the variable afterwards or the app will keep doing this on
every launch.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development mode: Vite server and Electron. |
| `npm run build` | Compile main/preload with `tsc` and bundle the renderer with Vite. |
| `npm start` | Launch Electron against built files. Requires `npm run build` first. |
| `npm run package` | Build and package into `release/win-unpacked/`. |
| `npm run typecheck` | Type-check main, preload, renderer and build tools. |
| `npm test` | The whole suite, through `scripts/run-tests.mjs`. No build step: Node strips the types. Several of the tests are negative controls — they reconstruct the rule they replace and show it failing — so a rule that has quietly stopped being able to fail stops the packaging. |
| `npm run test:fast` | The 35 files that do not spawn a process, run git or wait on a clock. This is the one to run while working. |
| `npm run test:list` | The groups, what each covers, and how many files it has. |
| `npm run clean` | Remove `dist/`. |

### Running part of the suite

Measured on 19 September 2026: the whole suite is about 17 seconds for 819 tests,
and **six of the 41 files are almost all of it** — they really spawn processes, run
git and wait on clocks. The remaining 35 answer in about one second together. The
count of tests was never the cost.

So the suite is grouped by the question someone is actually asking, and
`npm run test:fast` skips the six. The areas are `presentation`, `loop`, `chat`,
`project` and `live`; `npm run test:heavy` is the six on their own. A file that is
in no group fails the command rather than being silently skipped.

```powershell
npm run test:presentation   # Markdown, scrolling, diffs, plain errors, the window
npm run test:loop           # the graph, its editor, the record, control, instructions
node scripts/run-tests.mjs chat --tap   # any group, TAP instead of the spec reporter
```

Three timeouts bound every run: one per test, so Node names the test that hung; one
for the whole command; and a short grace after the tests report, because **a process
that outlives its own tests is a resource leak, not a pass**. `--test-force-exit`
would hide exactly that and is deliberately not used. Output is echoed as it
arrives, and `DSPATCH_*` variables are removed from the child's environment unless
`--keep-env` is passed — one left in a shell (DSP-65) once made a working
implementation look broken.

`npm run clean` does not touch `release/`. To package from a clean state:

```powershell
npm run clean
Remove-Item -Recurse -Force release
npm run package
```

## What the window shows

- **Status strip:** the active project with its git revision and how many files
  were already modified; the connection; what context the agent was actually
  given — which is a folder path, a model name and your prompts, and **no file
  content**, because opening a folder does not put it in front of the model; and
  what is happening right now.
- **Connection:** connected or not, and to which account, plus the backend, the
  model requested, how many models the account can request, when the credential
  expires and where it came from. A stored login that the provider will not accept
  reads as a failure with the provider's own reason, not as `connected`: driving
  the real window with the SDK's data directory redirected produced exactly that
  combination — a valid login and an unusable provider — and it used to be shown
  as a working connection.
- **Execution state:** every attempt DSpatch has made in this window, newest
  first, with its identifier, its state, why it is in that state, what may still
  be running, and the one action that applies to it. With no project open — after
  reading a conversation back, for instance — the list is shown as a record, and
  the actions that would need a session are not offered.
- **Saved conversations** in the project chooser: the directory the files are in
  and their format version, then one row per saved conversation with its project,
  when it was last saved, how many messages it holds, whether it carries a reviewed
  diff or a command result, and how many attempts were left unresolved — before it
  is opened, so that is not a surprise. A file DSpatch cannot read says what it
  found and what you can do about it. Every row offers *Export a copy* and *Show
  the file*, both of which work on a file that cannot be parsed. Leftover temporary
  files from a save that never finished are listed and never deleted.
- **Restored conversation:** what was read back and what was deliberately not
  done, the attempts that need naming, the messages, the saved command result with
  a fresh freshness verdict, and the diff that was reviewed. The only button that
  acts opens the project again.
- **Project and session details:** DSpatch's session id, the provider's, the
  working copy, how that working copy came to exist, the baseline snapshot with
  its file count and timing, how the files were listed, and the list of files
  that were already modified when the session opened.
- **Conversation:** one entry per turn — the prompt, the answer as it streams in,
  how many text fragments arrived, how many tool calls started and finished, the
  turn's token count and its terminal status. The composer, Send, Cancel and
  Stop waiting. When the conversation was continued after a restart, a line above
  the transcript says whether the earlier provider session was resumed or a new one
  was opened, and a message that carried a recap can be expanded to read the exact
  text the model was given.
- **Changes and diff:** which files differ from the session baseline, their
  before and after hashes and sizes, and the unified diff of each one, with a
  stated reason wherever there is no diff text.
- **Build and test:** editable command and working directory, what was executed
  and by which shell, exit code, duration, output, the snapshot the result
  describes, and whether it still applies to the code on disk.
- **After cancellation:** what was observed in the 90 seconds after a cancel.
- **Runtime environment:** Electron, Chromium, Node and V8 versions, platform,
  app version and whether the renderer loaded from the development server or
  built files. The last field identifies the mode being run.
- **Adapter `cursor-sdk`:** the integration contract's seven capabilities:
  starting runs, streaming responses, cancellation, resumption, model selection,
  approvals, and usage/cost reporting.

Approvals are **unsupported** on this transport: Cursor documents file-based hooks
with no programmatic callback and no human-in-the-loop flow for headless SDK runs.
Usage and cost is **unknown**, which is the honest value rather than a cautious
one — token counts arrive per turn while cost is refused. `unknown` is a valid
answer and is never presented as a positive result.

Niclas approved the current colour palette as the visual starting point on
13 September 2026. Preserve it as features are added. This feedback does not
by itself accept the usability of the chat and code-review workflows, which he
has not yet assessed.

## Not implemented yet

- **Containment.** DSP-1 established by measurement that the agent is not
  confined to the folder it is given: it read and wrote a file outside the
  working copy and ran a shell command that did the same, with no approval
  request. Choosing a folder scopes what DSpatch *watches*, not what the agent
  *can reach*. This is why DSpatch refuses to open its own working copy — and
  that refusal decides which project may be **chosen**, which is all it claims
  to do. It does not restrict where an agent writes once a project is open, and
  DSP-16 deliberately left that larger question alone.
- **Git-ignored files.** They are outside the baseline, so a change to one is
  invisible to the diff. The panel says so; nothing detects it.
- **Semantic diffs, a custom editor, a terminal emulator, and commit, push or
  pull request handling.** All deliberately out of scope so far.
- **Keeping a conversation alive past Cursor's own store.** Resuming a provider
  session across a restart works and is exercised — see *What a continued
  conversation actually tells the model* above — but it depends on Cursor's store,
  which is keyed by the project's path and is not DSpatch's to keep. Move the
  project, move the conversation to another machine, or clear that store, and the
  resume is refused; what the model then gets is DSpatch's short recap, which is
  a summary and not the conversation. Nothing here extends the provider's
  retention or reconstructs a session it no longer holds.
- **Answering an approval request.** DSpatch surfaces one if it ever arrives, so
  it is visible as waiting rather than as a hang, but this transport gives no way
  to answer it. None has appeared yet, including on turns that edited files.
- **Stopping provider-side work.** Cancel stops DSpatch listening and stopped the
  observed tool work; whether generation stops on the provider's side is not
  established. Destroying every TLS socket to the backend did **not** stop a turn:
  it ran to completion afterwards.
- **A new message immediately after abandoning a send in flight.** One session
  holds one run, so until the abandoned run reports its end the provider refuses
  the next message. Measured: it was refused, and the run reported `cancelled`
  about two seconds later, after which sending worked. DSpatch explains this and
  offers opening the project again; it does not queue the message or wait for you.
- **Monetary cost.** Refused by the provider for this account.
- Application menu: there is one, and every item does something. **Project** (Open a
  project…, Old sample projects…, Exit), **Session** (Session details, identifiers
  and diagnostics · Ctrl+I; Back to the conversation) and **View** (Reload, Toggle
  Developer Tools, zoom). *Old sample projects…* shows what DSpatch has generated
  under `%TEMP%\dspatch-chat` and offers to remove it; nothing is deleted until that
  button is used, and nothing outside that location can be.
- Installer, signing and automatic updates.
- Linux testing.

Do not present these features as available before they are implemented.

## Structure

```text
src/main/                Main process. Compiled by tsc, not bundled.
  chat-service.ts        Owns the adapter, the working copy, the diff and the command runner.
  own-repository.ts      Recognises DSpatch's own working copy from any folder inside or above it, and refuses when it cannot tell.
  git-state.ts           Revision, branch and the already-modified files, read before the agent exists.
  workspace-baseline.ts  The content baseline, its snapshot identity and the retained bytes.
  text-diff.ts           Unified diffs, and the reason when there cannot be one.
  test-command.ts        Command suggestion, refusal, the run's verdict, and whether a result still applies.
  attempt-ledger.ts      Every attempt's state, and what may be repeated. Pure, with an injected clock.
  project-store.ts       Remembered projects and which conversation each belongs to, one versioned file under userData.
  conversation-store.ts  Saved conversations: one versioned file each, read whole, never rewritten when unrecognised.
  probe-cursor.ts        Scripted connection probe (DSPATCH_PROBE).
  experiment-repo.ts     Generates the disposable sample working copy; hashes and diffs trees.
  sample-projects.ts     Where a generated sample project goes, and which folders may be removed on request.
  experiment-work.ts     The DSP-1 substep 5–6 experiments, run as a plain Node program.
src/preload/             Sandboxed bridge, exposing one interface via contextBridge.
src/renderer/            React UI, bundled by Vite.
  turn-routing.ts        Event routing, kept pure so the superseded-run rule is testable.
  recovery.ts            What a failure says, how a long wait reads, and the bounded retry.
  plain-error.ts         One sentence first, the technical detail on request, and nothing lost in between.
  workflow-script.ts     Drives the window's own controls (DSPATCH_CHAT_RUN).
  workflow-gates.ts      Those runs' pass/fail rules, kept out of the DOM so a counter-example can be fed to them.
src/shared/              Renderer/main contract. Types only.
src/adapter/             Provider adapter interface, Cursor implementation, placeholder.
scripts/dev.mjs          Starts the development server and Electron.
electron-builder.yml     Packaging configuration.
dist/                    Build output. Git-ignored.
release/                 Packaging output. Git-ignored.
```

**The adapter lives in the main process and only there.** The renderer never
imports it and reaches it only over IPC. That is enforced rather than intended:
`tsconfig.renderer.json` excludes `src/adapter/cursor-sdk-adapter.ts`, so a
renderer-side import fails the typecheck instead of the packaged build. The window
uses `contextIsolation`, disables `nodeIntegration`, enables the sandbox and
communicates through preload; the renderer has no Node access at all.

The main process is deliberately not bundled. Cursor's SDK lazily loads parts of
itself that a single-file bundle cannot follow; its documentation describes such a
bundle failing on the first `Agent.create()`. Compiling to ordinary modules with
normal `node_modules` resolution avoids that problem.

### Two packaging traps, both measured rather than predicted

1. **`files` must not exclude `node_modules`.** Up to substep 6 the pattern list
   ended with `!node_modules/**/*`, which excluded production dependencies
   *silently*: the substep 3 archive was missing `react` and `react-dom` although
   both are declared in the artifact's `package.json`, and the build exited 0 with
   no warning. That was harmless only because Vite inlines them. With `@cursor/sdk`
   required by the unbundled main process it would not have been. The negation is
   gone; electron-builder walks the production dependency tree itself.
2. **Native binaries must be unpacked.** `@cursor/sdk-win32-x64` carries
   `cursorsandbox.exe`, `rg.exe` and two `.node` files. Inside the archive they
   cannot execute or load, the ripgrep lookup falls back to `rg` on `PATH` and
   `sandboxOptions` throws `ConfigurationError`. `asarUnpack` puts them in
   `resources\app.asar.unpacked\`.

**A successful build is not evidence that a dependency is in the archive.** Check
the contents:

```powershell
npx asar list release\win-unpacked\resources\app.asar
```

Note that `asar list` shows unpacked files too — they remain in the index while
their bytes live outside. To tell the two apart, also list
`release\win-unpacked\resources\app.asar.unpacked`.
