# Installing DSpatch and working on another machine

*Status: releases publish the Debian package for Linux x64; see [what has been shown](#what-has-been-shown). From v0.1.10, published as a pre-release, they also carry the Windows installer and the Windows host package (DSP-182), tried as described under [Windows](#windows). Releases before it have neither: with them, DSpatch on Windows is run from the repository, and a Windows machine cannot be connected to over SSH.*

## For a person using DSpatch

**Ubuntu or Debian x64:**

```bash
sudo apt install ./dspatch_VERSION_amd64.deb
```

**Windows x64:** run `DSpatch-Setup-VERSION.exe`. It installs for your user and needs no administrator rights. The installer is not signed yet, so Windows warns about it; the pages, the warnings and what an upgrade and an uninstall do are under [Windows](#windows).

Start DSpatch from the menu. To work on this computer, choose an agent and open a project. The Linux installer includes the standalone host and its own Node runtime. DSpatch finds a running host or starts one on authenticated loopback. Closing the window disconnects without stopping started work; reopening follows the same host and history. No login-time service is installed.

**To work on another machine,** choose **Remote Session**, give `user@machine` or an alias from your SSH config, and press **Connect**. DSpatch uses your own `ssh`, with your config, agent and keys. It asks when ssh needs an answer: a new machine's fingerprint, or a password. On that machine it installs a host if none is there, starts it, and opens the tunnel; there is nothing to copy and no terminal to keep open. **Leave** closes this computer's connection. The host goes on, and so does work started there.

**Starting locally and continuing from elsewhere.** A computer holds one work context per user, however it is reached. If you have used DSpatch on a computer, connecting to the same account over SSH finds the same projects, conversations, reviews, review decisions, loop runs and provider logins. Nothing has to be moved.

One host works on that context at a time, so the handover is always clear:

- **DSpatch left open on that computer, idle or working.** A connecting client attaches to the same standalone host. The last client is told it was replaced; the work is neither interrupted nor sent again. **Use here** brings the connection back to the local client.
- **Both clients closed.** Work already started continues on the host. Reopening locally or connecting over SSH recovers its current state and saved history.
- **End host.** This explicit action is refused while work is running. When idle, it ends the host and the local window starts a fresh standalone host. Stop work and closing a window are separate actions. The window's line reads *On this computer* while it is attached to this computer's host.
- **Restart host.** The same action under the name it deserves when the host is another build than the window: after an update, the host the closed windows left running is still the old version, the line reads *Restart needed to finish updating*, and the restart ends it once nothing runs in it and starts the installed build's host. A host of the same version from other sources, as in development, reads *The host is another build*. Which commit and build each side is stays in the line's detail and the log.

Only the client attached at that moment works on the host. Another client that connects replaces it, and the replaced one says so. Reopening a saved conversation is not the same as attaching to running work: reopening reads what is saved, and nothing is ever resent.

**An installed host that is not running.** Connect starts an installed host with the same protocol and contract as the client. An exact build match takes precedence; otherwise a compatible installation of the same application version is preferred, with a stable host-id ordering between remaining candidates. Its build is shown while starting. With no compatible installation, the client deploys the verified host archive included in the Linux installation; fetching a package is a fallback. An explicit choice to replace a running host uses the client's build, not a fallback to the host just stopped. An older desktop-owned host must still hand over safely; an upgrade never kills it silently.

**After an upgrade.** A host from an earlier version kept its data in `~/.local/share/dspatch-host` (Windows: `%LOCALAPPDATA%\dspatch-host`). The first host that starts on that computer brings that data in, after backing up both sides under `backups/` in the data folder. Nothing is overwritten and the old folder stays as it was. If a record exists in both places with different content, both are kept and you are told: a conversation then appears twice, the second one ending in `from-older-host`. If an earlier version saved a manual tunnel that no longer answers, DSpatch says so at the start and offers **Connect over SSH**; nothing is lost.

If an alias is refused, the message shows the user, host and port that ssh actually resolved. `ssh -G <alias>` shows the same in a terminal.

**Providers** are set up where the work runs, from the start page:

- Choose **Claude** or **Copilot** in the agent list. If it needs preparing, a small **Get started** dialog opens: **Continue** fetches what is needed on the machine where the work runs and goes on to the vendor's own sign-in page, in the browser on the computer in front of you. A one-time code is shown in the dialog. A valid login on that machine is reused, and with everything ready no dialog opens. Your draft stays, and nothing is sent for you.
- If support turns out incomplete, the failure says so once, with **Repair**. Repair fetches support again on that machine and keeps sign-in, conversations and settings.

A login that already exists on the machine is used. DSpatch offers no API-key or other billed route, and never moves to one by itself.

### Copilot hooks at work

Copilot's hooks in `~/.copilot/hooks` run on the machine where the work runs: your own for local work, the remote machine over SSH. Installing or updating DSpatch does not touch them. To refuse Copilot work on a machine where no such hook is found, create an empty file `copilot-hooks-required` in DSpatch's data folder there: `~/.config/DSpatch/` on Linux, `%APPDATA%\DSpatch\` on Windows, for local and remote work alike. It takes effect at the next session, with no restart of the host. What they do and do not cover is in the [content-exclusion contract](DSPATCH_CONTENT_EXCLUSION_CONTRACT.md#6-tool-hooks-on-dspatchs-path-1-november-2026-dsp-154).

### The machine's load during a loop run (DSP-173)

While a loop run goes on, the host reads how hard the machine is pressed, on Linux only so far: memory and disk stall (`/proc/pressure`), available memory, swap traffic and, without stall figures, the load per CPU. Busy CPUs and swap that is merely in use do not count as pressure. It says the machine's health, GREEN, YELLOW, RED or UNKNOWN, in the run's journal when the run starts and each time the health changes, and on each step's start. A signal it cannot read is unknown, never GREEN: GREEN needs every signal, and a reading with no pressure but a signal missing is UNKNOWN, naming what was not read. Without PSI, where a disk stall cannot be seen, the health is therefore never GREEN. On Windows everything is unknown and nothing changes.

- **`observe`**, the default, only records.
- **`enforce`** also acts on DSpatch's own work. Under sustained YELLOW a new step waits 5 s. Under sustained RED a new step waits for the pressure to ease, ended at once by Stop. After 5 minutes the run pauses for you and does not go on by itself. Continue checks the machine again: the step starts if the pressure has eased, and is held again, said so in the journal, if it has not. Continue does not lift the protection; Stop ends the run. Also under RED, DSpatch takes no snapshot of the folders at the agents' shell commands. Such a command is then recorded as not observed, never as unchanged or verified.
- **`off`** reads nothing.

Enforce does not stop all of DSpatch's heavy work under RED. What remains:

- A step already running is not held. If RED begins during a step, the step goes on and its end snapshot of the folders is still taken, as is each step's snapshot before it starts: the step's outcome cannot be checked without them.
- Review jobs, the chat's own snapshots and other host work are not governed.
- Commands a provider already runs with its own shell tool are not paused, slowed or ended, and can go on loading the machine. Set the mode with `DSPATCH_RESOURCE_GOVERNOR=off|observe|enforce` when the host starts, or with `{"mode": "enforce"}` in a file `resource-governor.json` in DSpatch's data folder; the environment wins. The same file can change the timings and thresholds (`sampleEveryMs`, `escalateAfterMs`, `recoverAfterMs`, `yellowPauseMs`, `maxWaitMs`, `thresholds.yellow.*`, `thresholds.red.*`, as named in `app/src/main/resource-governor.ts`). A value it does not understand is ignored and named in the host's log.

<a id="windows"></a>

## Windows

**Installing.** `DSpatch-Setup-VERSION.exe` installs for your user alone and asks for no administrator rights. Its pages are the folder, `%LOCALAPPDATA%\Programs\DSpatch` unless you choose another; **Shortcuts**, where a Start menu entry is always made and a desktop shortcut only if you tick it; the installation; and a finish page that offers to start DSpatch. Afterwards Apps and features lists *DSpatch VERSION* with its uninstaller. For a script, `DSpatch-Setup-VERSION.exe /S /D=C:\path\DSpatch` installs silently into that folder (`/D=` last and unquoted, a path without spaces that contains "DSpatch").

**The installer is not signed, and what Windows shows about that differs between machines**: the edition, the SmartScreen settings, the browser and the security products all have a say. On the one machine it has been tried on, Niclas's Windows 11 Home with Bitdefender (8 November 2026): a setup file that carries a browser's download mark opens with the attachment manager's **Open File - Security Warning** ("The publisher could not be verified"), where *Run* goes on and *Cancel* ends it. SmartScreen's **Windows protected your PC** page, answered with *More info* and *Run anyway*, is what Microsoft documents for an unrecognised application; it was not reached there, because the trial cancels the first dialog. Edge and Chrome may first hold the download itself as uncommon. On that machine Bitdefender's Advanced Threat Control reported `ATC.Malicious` for the uninstaller, `Uninstall DSpatch.exe`, the first time it ran silently (an NSIS uninstaller copies itself to the temp folder and runs from there, then asks PowerShell which DSpatch processes run from the folder), quarantined it, and from then on blocked every uninstaller the installer tried to write, of two different builds. In the wizard that shows as NSIS's dialog *Error opening file for writing: …\Uninstall DSpatch.exe* with *Abort*, *Retry* and *Ignore*: *Ignore* finishes the installation without an uninstaller, so Apps and features cannot remove it later and [removing by hand](#removing-by-hand) is the way; a silent install skips the file without a word. The program itself ran. Which of these a person meets is not known in advance. Signing is a later decision, recorded in DSP-182.

**Upgrading.** Run the newer setup. It closes a DSpatch that is running from the folder it replaces (it asks, "DSpatch is running. Click OK to close it."; a silent install answers OK), runs the previous version's uninstaller with the data kept, and installs over. `%APPDATA%\DSpatch` is untouched: conversations, reviews, provider support, settings, window layout and zoom. The vendors' logins are outside DSpatch's folders. The host the closed window left running is the older build, so the next window reads *Restart needed to finish updating* and **Restart host** finishes the update, as described above.

**Uninstalling.** Apps and features, or `Uninstall DSpatch.exe` in the program folder (`/S` for silent), removes the program folder, the Start menu entry, a desktop shortcut it made and the installer's two registry keys. It closes only what runs from the program folder, so a standalone host, which runs from the data folder, goes on. It leaves `%APPDATA%\DSpatch` and the logins where they are, so a later install finds them. To take the data away too, delete `%APPDATA%\DSpatch`, and `%LOCALAPPDATA%\dspatch-host` if an older host left it; the uninstaller does the first when run with `--delete-app-data` (electron-builder's option, read in its template, not tried).

<a id="removing-by-hand"></a>

**Removing by hand,** when the uninstaller is gone: end DSpatch, delete `%LOCALAPPDATA%\Programs\DSpatch` (or the folder you chose), delete `DSpatch.lnk` from `%APPDATA%\Microsoft\Windows\Start Menu\Programs` and from the desktop, and delete the installer's two keys under `HKEY_CURRENT_USER\Software`: `Microsoft\Windows\CurrentVersion\Uninstall\ae725ec0-0388-59e4-822d-e71b68d747c1`, which is the Apps and features entry, and `ae725ec0-0388-59e4-822d-e71b68d747c1`, which records the folder; the id is the one electron-builder derives from DSpatch's application id. The data folder is yours to keep or to delete as above.

## How it fits together

- **Client.** Electron with the built app and its production dependencies. No `asar`: provider runtimes must be real files. `resources/bundled/` holds the loops, their graphs and roles, the pinned provider lists and `host-manifest.json`. It is read-only and replaced by an update; a person's own loops are in their projects and are not touched.
- **Host package.** `dspatch-host-<version>-<commit>-<platform>-x64.tar.gz`: a fixed Node runtime (`HOST_NODE_VERSION` in `app/scripts/build-host-package.mjs`, checked against Node's `SHASUMS256.txt`), the built host, production dependencies for that platform and the same bundled folder. No Electron and no window system.
- **Which package.** The client carries `host-manifest.json` and the Linux host archive for its own commit. SSH deployment checks `DSPATCH_HOST_PACKAGES`, the installed `bundled/host-packages/`, the user's package cache and then the matching GitHub release; a package is used only if its SHA-256 matches. The client sends it over SSH, so the remote machine never needs GitHub. Local startup extracts the verified bundled archive under `<userData>/host-installations/` and starts its own Node runtime.
- **On the machine.** Versions in `${XDG_DATA_HOME:-~/.local/share}/dspatch/host/versions/<version>-<commit>/` (Windows: `%LOCALAPPDATA%\DSpatch\host\versions\`), unpacked beside the others and renamed when whole. Data is in the application's own folder (`${XDG_CONFIG_HOME:-~/.config}/DSpatch`, Windows: `%APPDATA%\DSpatch`), the same for local and remote use. A host claims that folder in `host-claim.json` before reading it, and a second host is refused. A running host records its port and build in `host-running.json`, readable by that user; the port is chosen by the system, and the token stays in the host's own file and reaches the client on the SSH channel, into memory only.
- **Another version running.** The person is asked: replacing stops work there, with an unknown outcome. If the two can work together, *No* keeps using it. Old version folders stay.
- **SSH.** The system's OpenSSH, with `StrictHostKeyChecking=ask`: an unknown key is asked about with its fingerprint, and a changed key is refused by ssh. On Linux one master connection carries everything. Windows' ssh has no multiplexing, so each step is its own connection. A password stays in memory for that session's reconnects and is never written.
- **A provider's support.** See [what is installed where](#what-is-installed-where).
- **Consent.** Continuing in the Claude dialog, which shows the consent once, writes `claude-consent.json` in that machine's data. It stands where `DSPATCH_CLAUDE_AUTHORIZATION` stood, which still works.

## Building

From `app/`, after `npm ci`:

```bash
npm run package:host -- --platform linux
```

```bash
node scripts/build-host-package.mjs --platform win32
```

```bash
npm run package:client -- --linux deb --x64
```

The host packages come first, because the client carries their manifest. Everything lands in `app/release/`. Build from a clean commit: the manifest binds packages to it. The Windows installer is built on Windows: `npm run package:host -- --platform win32`, then `npm run package:client -- --win nsis --x64`, from `app/` in PowerShell or cmd (Git for Windows' tar and Windows' own are both handled). Built on Linux it carries the Linux Copilot runtime. `.github/workflows/package.yml` builds everything from one commit, and publishes only from a tag.

**A release.** Commit the version, build everything from that commit, run `node scripts/stage-release.mjs`, which gathers the files and `SHA256SUMS` into `release/stage-v<version>` and refuses anything else, and try it with `node scripts/trial-package/release.mjs --stage`. Publish that folder under the tag `v<version>`, with `--prerelease` for a test build. The client asks for exactly its own tag, never `latest`. Then `release.mjs --published` tries the real release.

**Building on GitHub.** The `package` workflow builds the Linux host package, the `.deb`, the Windows host package and, on a Windows runner, the Windows installer from one commit, on manual runs and on `v*` tags alike. A manual run keeps them as artifacts and also tries the installer on a Windows runner (the `windows-install-trial` job: the wizard, the first start, an upgrade and the uninstall through `scripts/install-trial.mjs`, then the zoom, dock and profile trials against the installed client). A tag build checks the package version against the tag, stages everything with `SHA256SUMS` through `stage-release.mjs`, and publishes it with `docs/releases/<tag>.md` as release notes. Tags containing a hyphen are published as prereleases. Only the publication job receives write permission. Build success does not replace the packaged or manual trials; release notes state outstanding verification.

The `linux-verify` workflow, started by hand, runs the Linux checks of a release candidate on the same runners: the fast, host, review, chat, presentation and provider test groups, and the zoom trial in real Xvfb windows (`node scripts/zoom-trial.mjs`). Started with `published`, it instead tries the published release of the checked-out version in clean containers (`release.mjs --published`) and an upgrade to it from the previous release (`node scripts/trial-package/upgrade.mjs --from v<previous>`), which installs that release, uses it, installs this one over it, meets the host the closed window left running, ends it, and checks that the conversation, the choices and a loop of the person's own are still there.

**Before a release exists,** put the host package in the client's data, which needs no rebuild:

```bash
mkdir -p ~/.config/DSpatch/host-packages && cp dspatch-host-*.tar.gz ~/.config/DSpatch/host-packages/
```

## Packaged trial

`scripts/trial-package/setup.mjs` is the setup trial (DSP-155): the real .deb and host package, the real SDK and programs fetched from npm, and a local stand-in behind every Anthropic, GitHub and Cursor name, so no model or account is reached.

```bash
docker build -t dspatch-trial -f scripts/trial-package/Dockerfile scripts/trial-package
```

```bash
node scripts/trial-package/run.mjs
```

The real .deb and host package on two clean Ubuntu containers without Node, a real sshd and a real window on Xvfb, with a SIMULATED provider on the host. Nothing of the machine it runs on is touched. Evidence lands in `app/release/trial/`.

**The Windows install trial** (DSP-182) tries the real installer on Windows: `node scripts/install-trial.mjs --setup "release/DSpatch Setup VERSION.exe" --upgrade "<a newer setup>"`, with `--no-windows` when the desktop is in use. It refuses to run where DSpatch is installed or running, installs into `%LOCALAPPDATA%\Programs\DSpatch-trial` with a data folder of its own and the SIMULATED provider, drives the wizard through UI Automation, and records each step in `release/trial-install/<run>/results.json` with screenshots. The person's own `%APPDATA%\DSpatch` is checked unchanged at the end. A missing uninstaller, a security product's doing, is recorded as a finding and the installation removed by hand as the Windows section says.

<a id="what-has-been-shown"></a>

Hooks over ssh on the packaged host: `node scripts/trial-package/hooks.mjs`, after `npm run package:host -- --platform linux` and the same image.

## What is installed where

| Part | Comes with | Where it lives |
| --- | --- | --- |
| `@github/copilot-sdk` and its platform package, which holds the Copilot runtime for sessions | the app and the host package (MIT) | inside the installation |
| `@anthropic-ai/claude-agent-sdk`, its `claude` program in the platform package, and what the lockfile pins beside it, among them zod and `@modelcontextprotocol/sdk` | fetched on request | `<data>/provider-support/claude` |
| `@github/copilot` with its `copilot` program, used to sign in | fetched on request, only when Copilot is not signed in | `<data>/provider-support/copilot` |

`<data>` is `~/.config/DSpatch` on Linux and `%APPDATA%\DSpatch` on Windows. The versions are those in `claude-support/` and `copilot-support/`; each download is checked against the lockfile's integrity, so that machine must reach the npm registry. Before fetched support is put in place, the program starts and, for Claude, the SDK and zod load and a tool server is built from where the files stand. Node and npm are not involved beyond the runtime the product carries.

On a remote Linux host with no keychain, Copilot's own `copilot login` signs in but cannot keep the token when it is not run in a terminal, and DSpatch says so. It does not switch on plain-text storage for you. Claude's program keeps its login in `~/.claude`.

Logins are the vendors' own and stay outside these folders, in `~/.claude` and in the Copilot runtime's store, so repairing support does not touch them. Claude Desktop is a separate application with its own installation. DSpatch does not use it. What DSpatch installs is its own copy of the Agent SDK and the Claude Code program, and it reuses a login only if that copy reports one on that machine.

### Why support is fetched, and what the terms say

Read on 1 November 2026. This is a record of sources, not legal advice, and the distribution strategy has not changed.

- *Copilot CLI.* The package's `LICENSE.md` allows redistributing unmodified copies as part of an application with material functionality of its own, on conditions. An earlier version of this page implied otherwise.
- *Claude.* The SDK's `LICENSE.md` reserves all rights and refers to Anthropic's [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance) page. That page allows preinstalling or running Claude Code in a product under the Commercial Terms and conditions: the program unmodified, with no authentication method removed, and each end user authenticating with their own credentials. The [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) puts the SDK under the Commercial Terms.
- *Open question, for a decision before public release.* Both pages say third-party developers may not offer claude.ai login in their products unless approved, and should use API keys. The first page also says this does not prevent an end user from signing in to the unmodified Claude Code program with their own subscription. Whether DSpatch's use, running that program through the SDK for a person's own account, needs Anthropic's approval is not settled by the text. The same page's rule against removing an authentication method also bears on DSpatch offering no API-key route.

## What has been shown

The packaged trial's table is in [DSP-153](../backlog/tasks/dsp-153%20-%20Install-DSpatch-and-connect-to-another-machine-over-SSH.md). Agent runs use a simulated provider and containers; they do not show what a real provider does, nor how the .deb behaves under Ubuntu's AppArmor on a real desktop. What each release had run on Linux before and after publication is in its notes under `docs/releases/`.

## Windows: what has been shown, and what remains

Shown on 8 November 2026 by `scripts/install-trial.mjs` on Niclas's Windows 11 Home machine, with the trial's own install folder and data folder and his own data untouched. Silently (`--no-windows`): the per-user install without administrator rights into a chosen folder; the win32 Copilot runtime and the win32 host package inside it; the version resource; the Start menu entry and no desktop shortcut; the uninstall entry and the installer's key with the folder and `/currentuser`; an upgrade from 0.1.9 to a 0.1.10 build over it with the data folder byte for byte as before; removal by hand leaving the data; and Bitdefender blocking the uninstaller of both builds, as the [Windows](#windows) section says. In real windows: the attachment manager's warning for a copy carrying the download mark, the wizard's folder page with the default folder and a changed folder, the Shortcuts page unchecked by default, and after Install the file-write dialog for the uninstaller. On GitHub's Windows runner (Windows Server 2025, no Bitdefender), the `package` workflow's manual `windows-install-trial` job built the installer with both host packages and an upgrade one patch version up and, on 9 November 2026 with the build-identity fix, passed the whole install trial: the same warning for the downloaded copy, every wizard page including the finish page's offer to start DSpatch (on by default, declined), the installation with its uninstaller, the first start with the window reading *On this computer* and the host started from the bundled package, the upgrade installed over a running client and host (the installer closed the client, the host went on, the data stayed byte for byte), the new window's *Restart needed to finish updating* and Restart host starting the new build's host with the data kept, and the uninstall while the host ran: program, shortcuts and registry keys gone, data and host left. The zoom and profile trials are Linux-only scripts and stop at their preflight on Windows; the dock trial ran against the installed client but its capture of the runner's display came out black, which says nothing certain about the product. v0.1.10, tagged before that run, shows *The host is another build* at the first start on Windows (its release notes say so); the fix is in later commits. What each run showed is recorded in DSP-182.

Still to be tried by hand on a Windows machine:

1. The wizard and the unsigned-installer warnings as they appear to you, from a real download; the Start menu entry; the start.
2. Open a local project; check that the loops are offered and Copilot's runtime starts.
3. Connect to a Linux machine with a key, then with a password: fingerprint question, status line, tunnel. Windows' `ssh` must support `SSH_ASKPASS` through a `.cmd`, and older versions lack `SSH_ASKPASS_REQUIRE`; this is the first thing to look at if no question appears.
4. Cut the connection during a turn (stop `ssh.exe`): it comes back, and nothing is sent twice.
5. Connect from Linux to a Windows machine with the OpenSSH server: the steps run through PowerShell and have never been run; the host must survive the end of the SSH connection.
6. Install fails or stops halfway: check `%LOCALAPPDATA%\DSpatch\host\versions` holds no half version.
7. Sign in to Copilot and Claude there with `claude`'s and `copilot`'s Windows programs.
