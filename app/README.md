# DSpatch – minimal connected chat

This is DSpatch's first product code. It opens a window that connects to
Cursor through the adapter in the main process, holds one chat session over one
generated working copy, streams answers, makes a real code change on disk, runs
that working copy's test and can cancel a turn in progress.

The substeps were kept separate so that failures are attributable: substep 2
established that the stack works, 3 that it can be packaged, 4 that the agent
connection works, 5 that a bounded code change can be made and tested, 6 what
cancellation and connection failure actually do, and 7 that the whole workflow
runs from the packaged artifact.

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
2. **New session.** Generates a small disposable test repository **outside** this
   repository — by default under `%TEMP%\dspatch-chat\duration-repo` — commits its
   generated state with its own Git, and opens a session over it. The generator
   refuses to write inside the DSpatch repository and refuses to wipe a directory
   that lacks its own `.dspatch-experiment` marker. **It regenerates on every new
   session, so nothing in there is yours to keep.**
3. **Send.** The answer streams into the transcript as it arrives. A follow-up in
   the same session keeps the conversation's context.
4. **A change request** makes the agent edit a file in that working copy.
5. **Check files on disk** hashes the working copy and lists what differs from the
   snapshot taken when the session opened — path, before and after SHA-256, and
   sizes. This is the evidence that something changed; the agent's own account of
   what it did is not used.
6. **Run the working copy tests** starts `node --test test/duration.test.ts` as a
   child of the main process and shows the command, working directory, exit code
   and output. On the generated state it fails with exit code 1, because
   `formatDuration` handles seconds only and the tests specify minutes and hours.
   After the change it passes with exit code 0.
7. **Cancel** during a turn asks the provider to stop and then keeps watching for
   20 seconds for signs that it did not: further tool calls, further files, a
   later usage record. The panel reports what was observed and says plainly that
   "no continued work observed" is not the same as "the provider stopped".

Cost is shown as **unknown**, never as 0. Per-turn token counts arrive on the run
stream and are shown when they do; the account-level cost API is refused for this
account with HTTP 403, and a cancelled turn reports no token count at all.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `DSPATCH_CHAT_WORKSPACE` | Where the generated working copy goes. Must be outside this repository. |
| `DSPATCH_NODE_PATH` | The `node` executable used to run the working copy's test. Otherwise the first `node.exe` on `PATH` is used, and if none is found the window says the runner is missing instead of showing a test result that never ran. |
| `DSPATCH_CHAT_MODEL` | Model requested. Default `claude-haiku-4-5`. |
| `DSPATCH_PROBE_REPO_ROOT` | The repository boundary the working-copy generator checks against. **A packaged run must set this**: from inside `app.asar` the repository is not an ancestor of the app path, so the default cannot be trusted. |

### The scripted workflow run

Set `DSPATCH_CHAT_RUN=1` and the window drives its own controls through the whole
workflow and exits with a code. It finds the real buttons and the real composer,
clicks and types into them, and records what reached the rendered document —
including the answer's length sampled repeatedly while the turn was still
streaming, so incremental rendering is measured rather than assumed.

This makes real, billed provider calls: four turns in one session.

```powershell
$env:DSPATCH_CHAT_RUN="1"
$env:DSPATCH_CHAT_LOG="C:\somewhere\chat-run.json"
$env:DSPATCH_PROBE_REPO_ROOT="C:\path\to\DSpatch"
$env:DSPATCH_CHAT_WORKSPACE="$env:TEMP\dspatch-chat\run-repo"
$env:DSPATCH_NODE_PATH="C:\Program Files\nodejs\node.exe"
Start-Process .\release\win-unpacked\DSpatch.exe -Wait -PassThru `
  -RedirectStandardOutput run.log -RedirectStandardError run.err
Remove-Item Env:\DSPATCH_CHAT_RUN
```

`DSPATCH_CHAT_LOG` receives the record: the renderer's observations and the main
process's kept separate, because what the document showed and what was on disk are
different kinds of evidence.

| Exit code | Meaning |
| --- | --- |
| 0 | The whole workflow ran. |
| 30 | The window reported the connection as not connected. |
| 31 | A session could not be started. |
| 32 | The answer did not visibly grow in the window while the turn was streaming. |
| 33 | The follow-up did not recall the token planted in the first turn, so a shared session is not established. |
| 34 | The window did not show the target file as changed on disk. |
| 35 | The test did not fail before the change and pass after it. |
| 36 | Cancel could not be exercised during streaming, or the turn did not end as cancelled. |
| 37 | The script itself failed; the failure text is in the record. |
| 38 | No report within 15 minutes. **A timeout, not a verdict** — the turn may still have been running. |
| 39 | The renderer never painted, so the script never ran. |

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
| `npm test` | Run the workflow gate tests in `tests/` with `node --test`. No build step: Node strips the types. |
| `npm run clean` | Remove `dist/`. |

`npm run clean` does not touch `release/`. To package from a clean state:

```powershell
npm run clean
Remove-Item -Recurse -Force release
npm run package
```

## What the window shows

- **Connection:** connected or not, and to which account, plus the backend, the
  model requested, how many models the account can request, when the credential
  expires and where it came from.
- **Session:** DSpatch's session id, the provider's, the working copy, how that
  working copy came to exist and which `node` will run its test.
- **Chat:** one entry per turn — the prompt, the answer as it streams in, how many
  text fragments arrived, how many tool calls started and finished, the turn's
  token count and its terminal status. The composer, Send and Cancel.
- **Working copy on disk:** what differs from the session's baseline, by content
  hash.
- **Test:** command, working directory, exit code, duration, output.
- **After cancellation:** what was observed in the 20 seconds after a cancel.
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

- **A real workspace.** The working copy is generated and disposable; there is no
  way to open one of your own. See [The next step](#the-next-step).
- **A diff.** Changed files are listed with content hashes and sizes, not with
  their text.
- **Resuming a session after a restart.** The adapter implements it against
  Cursor's own local store, but nothing has exercised that path.
- **Answering an approval request.** DSpatch surfaces one if it ever arrives, so
  it is visible as waiting rather than as a hang, but this transport gives no way
  to answer it. None has appeared yet, including on turns that edited files.
- **Stopping provider-side work.** Cancel stops DSpatch listening and stopped the
  observed tool work; whether generation stops on the provider's side is not
  established. Destroying every TLS socket to the backend did **not** stop a turn:
  it ran to completion afterwards.
- **Monetary cost.** Refused by the provider for this account.
- Application menu: Electron's default menu is removed because its actions
  have not been built.
- Installer, signing and automatic updates.
- Linux testing.

Do not present these features as available before they are implemented.

## The next step

The bounded next step towards a real workspace, and the first thing DSP-2 needs:

**Replace the generated working copy with one the user chooses.** A visible
control that opens a directory picker, a check that the directory is a Git working
copy, the chosen path shown in the Session panel and remembered between launches,
and the session opened over that path instead of over a regenerated scratch
repository.

Three things already in place make it small: the working copy is already a session
input rather than something the adapter owns, the on-disk baseline and content-hash
diff already work against any directory, and the test runner already takes its
command and working directory from the session.

Two things have to be decided rather than assumed, and they are why this is a task
and not a patch:

- **The baseline.** A repository the user already has is not a clean generated
  state. Changes the user made before the session began must survive and must be
  distinguishable from what the run changed — DSP-2's AC#6 requires exactly that,
  and today's baseline snapshot cannot tell them apart.
- **Containment.** Substep 5 established that the agent's workspace is not a
  boundary: the agent read and modified a file outside its workspace and ran shell
  commands that wrote outside it, without any approval request. Pointing DSpatch at
  a real repository therefore has to be a deliberate act with a visible scope, not
  a convenience.

**This is a description, not work in progress. DSP-2 has not been started.**

## Structure

```text
src/main/             Main process. Compiled by tsc, not bundled.
  chat-service.ts     Owns the adapter, the working copy and the test runner.
  probe-cursor.ts     Scripted connection probe (DSPATCH_PROBE).
  experiment-repo.ts  Generates the disposable working copy; hashes and diffs it.
  experiment-work.ts  The substep 5–6 experiments, run as a plain Node program.
src/preload/          Sandboxed bridge, exposing one interface via contextBridge.
src/renderer/         React UI, bundled by Vite.
  workflow-script.ts  Drives the window's own controls (DSPATCH_CHAT_RUN).
src/shared/           Renderer/main contract. Types only.
src/adapter/          Provider adapter interface, Cursor implementation, placeholder.
scripts/dev.mjs       Starts the development server and Electron.
electron-builder.yml Packaging configuration.
dist/                 Build output. Git-ignored.
release/              Packaging output. Git-ignored.
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
