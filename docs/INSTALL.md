# Installing DSpatch and working on another machine

*Status: published as v0.1.1. Tried on Linux x64 with a simulated provider; see [what has been shown](#what-has-been-shown). Windows is built and not run.*

## For a person using DSpatch

**Ubuntu or Debian x64:**

```bash
sudo apt install ./dspatch_VERSION_amd64.deb
```

**Windows x64:** run `DSpatch-Setup-VERSION.exe`. It installs for your user and needs no administrator rights. The installer is not signed yet, so Windows warns about it.

Start DSpatch from the menu. To work on this computer, choose an agent and open a project.

**To work on another machine,** choose **Remote Session**, give `user@machine` or an alias from your SSH config, and press **Connect**. DSpatch uses your own `ssh`, with your config, agent and keys. It asks when ssh needs an answer: a new machine's fingerprint, or a password. On that machine it installs a host if none is there, starts it, and opens the tunnel; there is nothing to copy and no terminal to keep open. **Leave** closes this computer's connection. The host goes on, and so does work started there.

**Starting locally and continuing from elsewhere.** A computer holds one work context per user, however it is reached. If you have used DSpatch on a computer, connecting to the same account over SSH finds the same projects, conversations, reviews, review decisions, loop runs and provider logins. Nothing has to be moved.

One host works on that context at a time, so the handover is always clear:

- **DSpatch left open on that computer with nothing running.** Connecting asks you first, then takes over. The window there says *In use from another computer* and keeps **Use here**, which brings the work back and tells the other client.
- **Work is running in that window.** It is not interrupted and nothing changes; you are told, and can connect again when it is done.
- **Back at that computer after working remotely.** The host started over SSH stays running, with any work in it. Opening DSpatch, or pressing **Use here**, attaches to it: a running job is shown as running and is neither sent again nor started twice. **End host** ends that host when nothing runs in it, and the window goes on alone.

Only the client attached at that moment works on the host. Another client that connects replaces it, and the replaced one says so. Reopening a saved conversation is not the same as attaching to running work: reopening reads what is saved, and nothing is ever resent.

**After an upgrade.** A host from an earlier version kept its data in `~/.local/share/dspatch-host` (Windows: `%LOCALAPPDATA%\dspatch-host`). The first host that starts on that computer brings that data in, after backing up both sides under `backups/` in the data folder. Nothing is overwritten and the old folder stays as it was. If a record exists in both places with different content, both are kept and you are told: a conversation then appears twice, the second one ending in `from-older-host`. If an earlier version saved a manual tunnel that no longer answers, DSpatch says so at the start and offers **Connect over SSH**; nothing is lost.

If an alias is refused, the message shows the user, host and port that ssh actually resolved. `ssh -G <alias>` shows the same in a terminal.

**Providers** are set up where the work runs, from the start page:

- Choose **Claude** or **Copilot** in the agent list. If it needs preparing, a small **Get started** dialog opens: **Continue** fetches what is needed on the machine where the work runs and goes on to the vendor's own sign-in page, in the browser on the computer in front of you. A one-time code is shown in the dialog. A valid login on that machine is reused, and with everything ready no dialog opens. Your draft stays, and nothing is sent for you.
- If support turns out incomplete, the failure says so once, with **Repair**. Repair fetches support again on that machine and keeps sign-in, conversations and settings.

A login that already exists on the machine is used. DSpatch offers no API-key or other billed route, and never moves to one by itself.

### Copilot hooks at work

Copilot's hooks in `~/.copilot/hooks` run on the machine where the work runs: your own for local work, the remote machine over SSH. Installing or updating DSpatch does not touch them. To refuse Copilot work on a machine where no such hook is found, create an empty file `copilot-hooks-required` in DSpatch's data folder there: `~/.config/DSpatch/` on Linux, `%APPDATA%\DSpatch\` on Windows, for local and remote work alike. It takes effect at the next session, with no restart of the host. What they do and do not cover is in the [content-exclusion contract](DSPATCH_CONTENT_EXCLUSION_CONTRACT.md#6-tool-hooks-on-dspatchs-path-1-november-2026-dsp-154).

## How it fits together

- **Client.** Electron with the built app and its production dependencies. No `asar`: provider runtimes must be real files. `resources/bundled/` holds the loops, their graphs and roles, the pinned provider lists and `host-manifest.json`. It is read-only and replaced by an update; a person's own loops are in their projects and are not touched.
- **Host package.** `dspatch-host-<version>-<commit>-<platform>-x64.tar.gz`: a fixed Node runtime (`HOST_NODE_VERSION` in `app/scripts/build-host-package.mjs`, checked against Node's `SHASUMS256.txt`), the built host, production dependencies for that platform and the same bundled folder. No Electron and no window system.
- **Which package.** The client carries `host-manifest.json` for its own commit, with each package's SHA-256. A package is looked for in `DSPATCH_HOST_PACKAGES`, then `<client data>/host-packages/`, then the GitHub release of that version, and is used only if it matches. The client sends it over SSH, so the remote machine never reaches GitHub.
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

The host packages come first, because the client carries their manifest. Everything lands in `app/release/`. Build from a clean commit: the manifest binds packages to it. A Windows installer needs Windows or Wine, and Windows dependencies: on Linux, build it from a copy of `app/` after `npm ci --os=win32 --cpu=x64 --ignore-scripts`, or it carries the Linux Copilot runtime; `.github/workflows/package.yml` builds everything from one commit by hand and publishes nothing.

**A release.** Commit the version, build everything from that commit, run `node scripts/stage-release.mjs`, which gathers the files and `SHA256SUMS` into `release/stage-v<version>` and refuses anything else, and try it with `node scripts/trial-package/release.mjs --stage`. Publish that folder under the tag `v<version>`, with `--prerelease` for a test build. The client asks for exactly its own tag, never `latest`. Then `release.mjs --published` tries the real release.

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

The packaged trial's table is in [DSP-153](../backlog/tasks/dsp-153%20-%20Install-DSpatch-and-connect-to-another-machine-over-SSH.md). Agent runs use a simulated provider and containers; they do not show what a real provider does, nor how the .deb behaves under Ubuntu's AppArmor on a real desktop.

## Windows, to be tried on a Windows machine

1. Run the installer without administrator rights: Start menu entry, start, uninstall.
2. Open a local project; check that the loops are offered and Copilot's runtime starts.
3. Connect to a Linux machine with a key, then with a password: fingerprint question, status line, tunnel. Windows' `ssh` must support `SSH_ASKPASS` through a `.cmd`, and older versions lack `SSH_ASKPASS_REQUIRE`; this is the first thing to look at if no question appears.
4. Cut the connection during a turn (stop `ssh.exe`): it comes back, and nothing is sent twice.
5. Connect from Linux to a Windows machine with the OpenSSH server: the steps run through PowerShell and have never been run; the host must survive the end of the SSH connection.
6. Install fails or stops halfway: check `%LOCALAPPDATA%\DSpatch\host\versions` holds no half version.
7. Sign in to Copilot and Claude there with `claude`'s and `copilot`'s Windows programs.
