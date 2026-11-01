# Installing DSpatch and working on another machine

*Status: built and tried on Linux x64 with a simulated provider; see [what has been shown](#what-has-been-shown). Windows is built and not run. Nothing is published yet.*

## For a person using DSpatch

**Ubuntu or Debian x64:**

```bash
sudo apt install ./dspatch_0.1.0_amd64.deb
```

**Windows x64:** run `DSpatch Setup 0.1.0.exe`. It installs for your user and needs no administrator rights. The installer is not signed yet, so Windows warns about it.

Start DSpatch from the menu. To work on this computer, choose an agent and open a project.

**To work on another machine,** choose **Remote Session**, give `user@machine` or an alias from your SSH config, and press **Connect**. DSpatch uses your own `ssh`, with your config, agent and keys. It asks when ssh needs an answer: a new machine's fingerprint, or a password. On that machine it installs a host if none is there, starts it, and opens the tunnel; there is nothing to copy and no terminal to keep open. **Leave** closes this computer's connection. The host goes on, and so does work started there.

**Providers** are set up where the work runs, from the start page:

- *Copilot:* **Sign in to Copilot** fetches GitHub's Copilot CLI to that machine and gives a sign-in page and, on a machine with no display, a code to enter there. The page opens on the computer in front of you.
- *Claude:* **Use my Claude subscription**, **Install Claude Code**, **Sign in to Claude**. Sign-in gives a page and a place to paste its code.

A login that already exists on the machine is used. DSpatch offers no API-key or other billed route, and never moves to one by itself.

### Copilot hooks at work

Copilot's hooks in `~/.copilot/hooks` run on the machine where the work runs: your own for local work, the remote machine over SSH. Installing or updating DSpatch does not touch them. To refuse Copilot work on a machine where no such hook is found, create an empty file `copilot-hooks-required` in DSpatch's data folder there: `~/.local/share/dspatch-host/` on a remote Linux host, `~/.config/DSpatch/` for local work on Linux. What they do and do not cover is in the [content-exclusion contract](DSPATCH_CONTENT_EXCLUSION_CONTRACT.md#6-tool-hooks-on-dspatchs-path-1-november-2026-dsp-154).

## How it fits together

- **Client.** Electron with the built app and its production dependencies. No `asar`: provider runtimes must be real files. `resources/bundled/` holds the loops, their graphs and roles, the pinned provider lists and `host-manifest.json`. It is read-only and replaced by an update; a person's own loops are in their projects and are not touched.
- **Host package.** `dspatch-host-<version>-<commit>-<platform>-x64.tar.gz`: a fixed Node runtime (`HOST_NODE_VERSION` in `app/scripts/build-host-package.mjs`, checked against Node's `SHASUMS256.txt`), the built host, production dependencies for that platform and the same bundled folder. No Electron and no window system.
- **Which package.** The client carries `host-manifest.json` for its own commit, with each package's SHA-256. A package is looked for in `DSPATCH_HOST_PACKAGES`, then `<client data>/host-packages/`, then the GitHub release of that version, and is used only if it matches. The client sends it over SSH, so the remote machine never reaches GitHub.
- **On the machine.** Versions in `${XDG_DATA_HOME:-~/.local/share}/dspatch/host/versions/<version>-<commit>/` (Windows: `%LOCALAPPDATA%\DSpatch\host\versions\`), unpacked beside the others and renamed when whole. Data stays in `dspatch-host/` beside it, as it always was. A running host records its port and build in `host-running.json`, readable by that user; the port is chosen by the system, and the token stays in the host's own file and reaches the client on the SSH channel, into memory only.
- **Another version running.** The person is asked: replacing stops work there, with an unknown outcome. If the two can work together, *No* keeps using it. Old version folders stay.
- **SSH.** The system's OpenSSH, with `StrictHostKeyChecking=ask`: an unknown key is asked about with its fingerprint, and a changed key is refused by ssh. On Linux one master connection carries everything. Windows' ssh has no multiplexing, so each step is its own connection. A password stays in memory for that session's reconnects and is never written.
- **A provider's program.** Claude Code's licence reserves redistribution and the Copilot CLI is GitHub's, so neither ships with DSpatch. Asked by the person, the machine fetches the versions in `claude-support/` and `copilot-support/` from the npm registry and checks each against the lockfile's integrity. That machine needs to reach the npm registry. Copilot's SDK is MIT licensed and ships in the app and the host.
- **Consent.** Accepting the Claude line writes `claude-consent.json` in that machine's data. It stands where `DSPATCH_CLAUDE_AUTHORIZATION` stood, which still works.

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

The host packages come first, because the client carries their manifest. Everything lands in `app/release/`. Build from a clean commit: the manifest binds packages to it. A Windows installer needs Windows or Wine; `.github/workflows/package.yml` builds everything from one commit by hand and publishes nothing.

**Before a release exists,** put the host package in the client's data, which needs no rebuild:

```bash
mkdir -p ~/.config/DSpatch/host-packages && cp dspatch-host-*.tar.gz ~/.config/DSpatch/host-packages/
```

## Packaged trial

```bash
docker build -t dspatch-trial -f scripts/trial-package/Dockerfile scripts/trial-package
```

```bash
node scripts/trial-package/run.mjs
```

The real .deb and host package on two clean Ubuntu containers without Node, a real sshd and a real window on Xvfb, with a SIMULATED provider on the host. Nothing of the machine it runs on is touched. Evidence lands in `app/release/trial/`.

<a id="what-has-been-shown"></a>

Hooks over ssh on the packaged host: `node scripts/trial-package/hooks.mjs`, after `npm run package:host -- --platform linux` and the same image.

## What has been shown

The packaged trial's table is in [DSP-153](../backlog/tasks/dsp-153%20-%20Install-DSpatch-and-connect-to-another-machine-over-SSH.md). Agent runs use a simulated provider and containers; they do not show what a real provider does, nor how the .deb behaves under Ubuntu's AppArmor on a real desktop.

## Windows, to be tried on a Windows machine

1. Run the installer without administrator rights: Start menu entry, start, uninstall.
2. Open a local project; check that the loops are offered and Copilot's runtime starts.
3. Connect to a Linux machine with a key, then with a password: fingerprint question, status line, tunnel. Windows' `ssh` must support `SSH_ASKPASS` through a `.cmd`, and older versions lack `SSH_ASKPASS_REQUIRE`; this is the first thing to look at if no question appears.
4. Cut the connection during a turn (stop `ssh.exe`): it comes back, and nothing is sent twice.
5. Connect from Linux to a Windows machine with the OpenSSH server: the steps run through PowerShell and have never been run; the host must survive the end of the SSH connection.
6. Install fails or stops halfway: check `%LOCALAPPDATA%\DSpatch\host\versions` holds no half version.
7. Sign in to Copilot and Claude there with `claude`'s and `copilot`'s Windows programs.
