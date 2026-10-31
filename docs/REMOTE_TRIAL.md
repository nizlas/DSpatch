# Linux, Copilot and remote host trial

*An installed DSpatch connects with `user@machine` and needs none of this: see [INSTALL.md](INSTALL.md). This guide stays for running from a clone and for the Advanced address and token.*

The start guide for the first real trial: the DSpatch client on a laptop, a DSpatch host on another machine that holds the repository and runs Copilot (DSP-111, DSP-148, DSP-131). **None of this has yet run on Linux, against a real Copilot account, over real SSH or across two machines.** Section 7 says exactly what has.

Both machines must run the same commit (section 1). In the commands below, **HOST** is the machine with the repository, **CLIENT** is the laptop.

## 1. Same commit on both machines

The commits are local and not pushed, so they travel as a Git bundle. On the machine that has them, in the repository root:

```bash
git bundle create dspatch-trial.bundle main
git bundle verify dspatch-trial.bundle
```

Copy `dspatch-trial.bundle` to each machine, by any route the work environment allows. Then, in the existing clone on **each** machine (this does not touch local branches other than the new one):

```bash
git fetch /path/to/dspatch-trial.bundle main:refs/heads/trial
git switch trial
git rev-parse HEAD
```

On Windows, if Git says a file name is too long, run `git config core.longpaths true` first.

Expected: the same commit on both machines, the one named in section 7. Without a clone, `git clone /path/to/dspatch-trial.bundle DSpatch` works too.

## 2. Install

Node must be `^22.18.0 || >=23.6.0`; Node 24.21 and npm 11.19 are what was tested on Windows. Check with `node --version` and `npm --version`. Ubuntu's own `nodejs` package may be older; if so install Node from nvm:

```bash
nvm install 24
```

### HOST (no window system needed)

Ubuntu or Windows. The host needs Git and Node, and not Electron:

```bash
cd DSpatch/app
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run build:host
```

On Windows PowerShell, `$env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm ci` then `npm run build:host`. `npm ci` installs Copilot's runtime for the platform (`@github/copilot-sdk-linux-x64`, about 160 MB) and nothing of Claude.

### CLIENT

Ubuntu 24.04 needs Electron's system libraries. This list is electron-builder's Debian dependency list for Electron apps, with Ubuntu 24.04's names and the audio and graphics libraries the app README lists:

```bash
sudo apt install git libgtk-3-0t64 libnotify4 libnss3 libxss1 libxtst6 xdg-utils libatspi2.0-0t64 libuuid1 libsecret-1-0 libasound2t64 libgbm1 libxshmfence1
```

Then:

```bash
cd DSpatch/app
npm ci
node node_modules/electron/install.js
npm run build
ldd node_modules/electron/dist/electron | grep "not found"
```

`ldd` must print nothing; a line it prints names a missing library, which `apt-file search` maps to a package. The list above has not been tried on Ubuntu, so this check is the proof.

**The sandbox.** If Electron says the sandbox is not configured (Ubuntu 24.04 restricts unprivileged user namespaces), give its helper what it asks for, once:

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

Never start with `--no-sandbox`. If AppArmor still refuses, write down the message and stop there: it needs a decision, not a switch.

**Wayland.** Windows, focus and placement are the compositor's. If the review panel or its window misbehaves, compare with X11 once:

```bash
npx electron . --ozone-platform=x11
```

A client on Windows needs only `npm ci` and `npm run build`.

## 3. Copilot sign-in, on the HOST

Copilot runs where the host runs, so that is where it signs in. Nothing is copied from the client, and DSpatch stores no credential.

```bash
cd DSpatch/app
npx @github/copilot@1.0.105 login --device-code
```

Use the work account. The runtime and this CLI are the same version (1.0.105), and the SDK reuses the login. Then check, without sending anything to a model:

```bash
npm run copilot:check
```

Expected: `Copilot runtime 1.0.105`, `Signed in as <work account>`, the hooks it finds and the models the account can ask for.

**What a VS Code login gives.** Nothing to rely on. GitHub's documented sources for the runtime are, in order, `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, the OAuth token from `copilot login` in the system keychain, then `gh` CLI credentials. VS Code's session is not among them, on any machine. If `copilot:check` says signed in without `copilot login`, the line says which route answered (`env`, `gh-cli`, `user`). A token variable silently overrides a stored login.

**Keychain on Linux.** The token goes to libsecret (GNOME Keyring or KWallet). Over SSH with no keyring running, the CLI offers a plain-text file, `~/.copilot/config.json`. Whether that is acceptable on the work machine is a question for its rules; do not accept it by reflex.

**Not used, by design.** No Anthropic or OpenAI key and no bring-your-own-model route: DSpatch removes `COPILOT_PROVIDER_*`, `GITHUB_COPILOT_API_TOKEN`, `COPILOT_API_URL`, `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` from the runtime's environment.

## 4. Start

### On the HOST

```bash
cd DSpatch/app
npm run host
```

Start it so that it outlives your SSH session: inside `tmux` on Linux (`tmux new -s dspatch`, then the command), or from a local desktop session on the machine. It prints its address, data folder and commit. It listens on `127.0.0.1:47917` only and has no option for anything else. Data: `~/.local/share/dspatch-host` (Windows: `%LOCALAPPDATA%\dspatch-host`), or `--data <folder>`; another port with `npm run host -- --port <n>`. Ctrl+C closes the adapters and ends it.

Print the token once, and carry it to the client as you would a password:

```bash
npm run host -- --print-token
```

To refuse Copilot work unless the runtime reports an enabled pre-tool hook from a user or managed source, start the host with `DSPATCH_COPILOT_REQUIRE_HOOKS=1`. It checks that one exists, not what it does.

### The tunnel, on the CLIENT

```bash
ssh -N -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -L 47917:127.0.0.1:47917 <user>@<host>
```

Leave it running. **The laptop must be able to reach the host's SSH server.** That is not given by being on the VPN: check `ssh <user>@<host> exit` first. A Windows host needs its OpenSSH Server feature enabled and running. If the work network blocks SSH to the host, there is no connection, and DSpatch has no other route.

### On the CLIENT

```bash
cd DSpatch/app
npm start
```

On the start page choose **Remote Session**, keep `127.0.0.1:47917`, paste the token, **Connect**. The same DSpatch process moves to the host, without a restart, and keeps logging in the terminal. Every window then shows *On \<machine\>* at the bottom left. **Leave** there ends the session and returns to this computer, the same way. Review and editor windows close when the host changes. The address and token are in `remote-session.json` in the client's own data, readable by this user only, until then.

Scripted alternative, one launch:

```bash
DSPATCH_REMOTE=127.0.0.1:47917 DSPATCH_REMOTE_TOKEN_FILE=/path/to/token npm start
```

## 5. What to expect

- **Open Project** browses the host, in a small window, by name only. Nothing on the laptop is read as a project.
- **A lost connection** reads *Disconnected from \<machine\>, reconnecting…* along the bottom. A drop does not stop work on the host, but how it stands is unknown until the connection is back. Nothing is sent, and a new action says it was not sent. On reconnection the missed events and answers arrive; nothing is resent. A client that was **restarted** does not get those back: it reads what the host has saved.
- **A host restarted** ends what ran there: the windows reload and what was running reads as unknown, never as finished.
- **One client at a time.** A second client takes over; the first says so and stops.
- **Different commits** with the same contract connect, and the line says so. Another protocol or contract is refused with a sentence, before any work.
- **Show in folder** tells the path on the host instead of opening anything.

## 6. Manual trial

Record the commit, distribution, kernel, X11 or Wayland, `node --version`, Electron's version and `npm run copilot:check`'s output. Use **synthetic or public material** until section 8's gate is met. Mark anything skipped as not tried.

1. **Ubuntu.** Follow section 2. `ldd` prints nothing; DSpatch opens; the sandbox step was needed or not.
2. **Local, no provider.** File → Open Example Review. Close and reopen: position and notes are back.
3. **Connect.** Section 4. The line reads *On \<machine\>*.
4. **Open.** Open Project browses the host; pick a test repository. Open review, choose two commits; files and diff appear.
5. **Read.** Expand context; open a code reference.
6. **Ask.** Choose **Copilot** and a model. Select code, write a question, Enter. The activity line moves; the answer streams; the model reported is recorded. **Explain more simply**.
7. **Walks.** Prepare code walks; a walk window opens; follow a step in the shared panel. **Worth checking** on request.
8. **Panel.** Move it between its own window, docked in diff and docked in walk; hide it; show it. On Wayland note where it lands.
9. **Stop** a question and a job. They read as stopped.
10. **Cut.** Stop the `ssh` tunnel during an answer. The bottom line appears; on the host the job goes on. Start the tunnel again: the answer arrives, once. Check the host's log for one prompt.
11. **Restart the client.** Close it and start it again: saved review, no new model call.
12. **Restart the host** during an answer: it reads unknown, and nothing is sent again.
13. **Delegate** a file. Approvals land only inside the scope.
14. **No login.** On the host, `copilot:check` before signing in; in DSpatch, one sentence saying where to sign in.

Stop and record if a question reaches the model twice, if a stop reads as success with work still running, or if anything reads a path on the client.

## 7. What is verified, simulated and untried

Candidate commit: see the handover report. Versions: Node 24.21, npm 11.19, Electron 44.3.0, `@github/copilot-sdk` 1.0.28, Copilot runtime and CLI 1.0.105, Windows 11.

| Area | Status |
| --- | --- |
| Host and client as separate processes on one Windows machine, real TCP, real windows and input, forwarder in the tunnel's place | **Verified** |
| Remote: diff, expanded context, references, selection, question with Enter, streaming, activity line, Explain more simply, walks, shared panel, docking, delegated review | **Verified with a simulated provider**; `selection` failed intermittently, with a scripted drag one character short |
| Stop; a cut during an answer and during a job; client restart; host restart; a refused version | **Verified with a simulated provider** |
| The client touched no project file and started no process | **Verified for the paths the scripted runs exercised**: a guard logs every touch. Not a proof for every code path |
| Copilot runtime: tool lists offered, refused reads and writes, links, repository hooks and instructions, user hook running, stop, no-login sentence, walks job | **Verified against the real runtime 1.0.105 with a local stand-in model**, not a real model |
| Docked panel, its layout beside diff and commit log | **Seen** in desktop captures, simulated answers |
| Real SSH tunnel | **Not tried** (no SSH server here) |
| Two machines; a real network drop | **Not tried** |
| Linux: install, Electron, sandbox, Wayland, process ends | **Not tried**. Reviewed from the code; simulated-platform tests only |
| Real Copilot account: login, entitlement, models, credits, real streaming shape, usage figures | **Not tried** |
| Real model following the tools; hooks with a real account | **Not tried** |
| Managed hooks at work | **Not tried**, and the scripts have not been seen |
| Chat and loop runs with Copilot through the real windows | **Not tried**. Same adapter; unit-level only |
| The host chooser | **Clicked once**: it opened on the host and chose a folder. Going into folders is not tried |
| The Remote Session form | **Connect, Leave and Connect again in a real Linux window** against a host in its own process on the same machine, simulated provider, without a restart. Connect to a port with no host, and with a wrong token, answers in the form, stays on this computer and can be tried again. Real SSH with this build and Windows are **not tried**. The dialog when a saved session's host does not answer at start or after a restart is **not tried** |

## 8. What stands between this and work code

The [content-exclusion contract](DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) has the findings in its section 5. In short: GitHub documents that its own content exclusion does not cover the Copilot CLI, and DSpatch's prompt and diff pass no tool hook. Revision folders are outside the repository, so a repository-scoped rule does not follow them. **The first trial should use synthetic or public material** unless the responsible tooling team says otherwise.

## 9. If something goes wrong

| Seen | Likely | Do |
| --- | --- | --- |
| *No DSpatch host answered* | The tunnel or the host is not up | Try `ssh`, and the host's window |
| *does not hold this token* | Token from another data folder | `--print-token` again |
| *different versions / different sources* | Different commits | Section 1 |
| *Copilot is not signed in on …* | Login on the wrong machine | Section 3, on the host |
| Copilot reads *not installed* | `npm ci` did not fetch the platform package | `ls node_modules/@github` on the host |
| *Port … is in use* | A host already runs | Stop it, or use `--port` |
| Electron fails with a library's name | Missing system library | `ldd`, section 2 |
| A hung tunnel | The silence check ends it after 14 s | The client reconnects by itself |
