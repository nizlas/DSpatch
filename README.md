# DSpatch

**Develop with agents. Understand the code. Choose how much to delegate.**

DSpatch is an experimental desktop workspace for interactive agent-assisted development, configurable agent loops, and code review. Work in conversation or delegate a larger effort through a loop that coordinates agent roles and checks. The broader aim is sustained autonomous work across research, concept development, implementation and evaluation, with human direction at meaningful checkpoints. DSpatch currently provides simpler runnable workflows as a starting point; you can steer them in conversation or pause between steps.

Review combines a traditional diff for the overview with **code walks** that connect related code into an explained flow, including the purpose of the change. Select code, ask questions and follow references within the same review: the integrated agent receives the relevant code and revision without you having to assemble the context yourself. The aim is to make complex changes easier to understand while leaving review decisions with you, with selective agent delegation when you judge it appropriate. Review also works independently of development in DSpatch, for changes made in any editor.

See the [tutorial introduction](TUTORIAL.md#why-use-a-loop) for the reasoning behind loops and this approach to code understanding.

**[Download a release](https://github.com/nizlas/DSpatch/releases) · [Read the tutorial](TUTORIAL.md) · [Run from source](#run-from-source)**

## What you can do

| Start with | Use DSpatch to |
| --- | --- |
| A question or development task | Read and discuss a project, request changes, and ask the agent to build or test them. |
| A larger assignment | Choose or edit an agent loop, follow its steps, steer the work, and control when the next step starts. |
| Two Git revisions | Browse every changed file, expand context, ask about selected code, generate code walks, and review or delegate selected changes. |
| A remote development machine | Keep the interface on your computer while the repository, agents and tools run on the host over SSH. |

DSpatch uses TypeScript, React and Electron. Releases publish a Linux x64 Debian package; on Windows, DSpatch is run from the repository (see [Run from source](#run-from-source)). Read the chosen release's notes for platform verification and known limitations; a built artifact is not necessarily a tested platform.

## Install from a release

No source checkout or separate Node/npm installation is needed for a release installation. You need an account supported by your chosen provider for agent features, and Git on the machine holding the repositories. Ordinary diff browsing does not need an agent account.

### 1. Download and install

Open **[Releases](https://github.com/nizlas/DSpatch/releases)**, choose the release or prerelease you want to try, and expand **Assets**. Download the application installer, not GitHub's automatically generated **Source code** archives. If no installer assets have been published yet, use [Run from source](#run-from-source).

**Ubuntu / Debian x64:** download `dspatch_VERSION_amd64.deb`. In a terminal, replace `VERSION` below with the version in the downloaded filename:

```bash
cd ~/Downloads
sudo apt install "./dspatch_VERSION_amd64.deb"
```

Start **DSpatch** from your application menu. The package includes the application runtime and configures its sandbox; you do not need the source-build sandbox steps below.

**Windows x64:** current releases publish no Windows installer; run DSpatch from the repository instead ([Run from source](#run-from-source)). Only v0.1.1 has one, `DSpatch-Setup-0.1.1.exe`, and it is not maintained.

### 2. Choose where to work

- **This computer:** choose **Open Project** and select your project folder.
- **Another computer:** choose **Remote Session**, enter `user@machine` or an SSH configuration alias, and press **Connect**. Then open a project on that host.

For remote work, the client needs system OpenSSH and network access to the host's SSH server. The host needs Git and the project's own build/test tools. DSpatch obtains the matching host package from its release, verifies it, transfers it over SSH, and starts the host and tunnel. You do not need to clone DSpatch on either machine or copy host packages manually when using a complete published release.

Your existing SSH keys and configuration can be used. A new host may require fingerprint confirmation, and password authentication may prompt for a password. **Leave** disconnects the client; it does not shut down the remote host.

If you already use DSpatch on that computer, connecting to the same account continues the same projects, conversations and reviews. One client works at a time: a window left open there hands over unless work is running, and you can return with **Use here**. See [starting locally and continuing from elsewhere](docs/INSTALL.md#for-a-person-using-dspatch).

### 3. Choose an agent and start

Select **Claude** or **Copilot**, then a model. If setup is needed, **Get started** guides you through preparing the support and signing in through the provider's official browser flow. Follow any displayed code or return step. A usable existing login on the host is reused.

Provider support is prepared on the machine where the agent runs. That machine needs access to the npm registry for on-demand downloads. A Claude Desktop installation is separate from the Claude support used by DSpatch.

Try a first message:

```text
Describe this repository briefly. Where does execution begin, and how is it tested?
Do not change any files.
```

Or choose **Open review** to inspect two commits without starting development work. Continue with the **[review walkthrough](TUTORIAL.md#review-a-change)**.

## Run from source

Use this route to experiment with the GUI, implement your own features, or contribute a change. Install **Git and Node.js 24 with npm** first. Use a normal terminal outside an agent's own managed session.

### 1. Clone and create your branch

```bash
git clone https://github.com/nizlas/DSpatch.git
cd DSpatch
git switch -c feature/my-dspatch-change
cd app
npm ci
```

If you want to publish your branch without write access to this repository, fork it on GitHub first and clone your fork instead.

### 2. Start development mode

```bash
npm run dev
```

This compiles the Node-side code, starts the renderer development server, and opens Electron. Renderer changes are served by Vite; restart the command after changes to the host, main process or preload. Stop agent work in the UI before restarting the development process.

If Electron says it failed to install, npm skipped its download: npm 11 runs no package's install script it has not been told to allow. From `app/`, run `node node_modules/electron/install.js` once and start again; the same applies after every `npm ci`.

On Linux, if Electron reports that its SUID sandbox helper is incorrectly configured, stop the app and run the following **from `app/`** for your trusted checkout:

```bash
node node_modules/electron/install.js
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
npm run dev
```

Reinstalling dependencies may replace that helper. Keep the sandbox enabled; do not use `--no-sandbox`. If the error instead names a missing shared library or an AppArmor restriction, see the [Linux development notes](app/README.md#linux-ubuntu-status).

Choose and prepare a provider in the application as above. For SDK development, `npm run claude:install` installs the checkout's separately pinned Claude support; it is not required to build DSpatch itself. See [provider setup details](docs/INSTALL.md#what-is-installed-where).

### 3. Make and check your change

Most interface code is in `app/src/renderer/`; agent adapters are in `app/src/adapter/`, and project execution is in `app/src/host/`. Read [AGENTS.md](AGENTS.md) for project conventions before contributing.

From `app/`:

```bash
npm run typecheck
npm run test:fast
npm run build
npm start
```

Choose additional relevant test groups with `npm run test:list`. Some platform-specific tests have known failures; compare failing test names with the current branch's documented baseline rather than treating every failure as expected. The release notes and task records distinguish automated tests from real-provider trials.

**Keep experiments separate from your everyday installation.** Development and installed builds may otherwise use the same user profile. After building, you can launch with a separate profile:

```bash
# Linux, from app/
npm start -- --user-data-dir="$HOME/.local/share/dspatch-dev-profile"
```

```powershell
# Windows PowerShell, from app/
npm start -- --user-data-dir="$env:LOCALAPPDATA\DSpatch-dev-profile"
```

This separates DSpatch's conversations and settings, not the project files an agent edits. Use a branch or separate worktree for those changes.

Commit on your branch and open a pull request if you want to share the result. Personal UI and workflow variations are welcome experiments; include the problem solved, screenshots for interface changes, and the checks you ran. DSpatch is MIT-licensed; provider software and services retain their own terms.

## Practical limits

- DSpatch is under active development. Follow the installed version's release notes when they differ from documentation on `main`.
- Agents in development chat and loops can change files and run commands. Review questions use the selected revisions and read-only analysis where the provider supports it.
- Copilot tool hooks run on the host, but they do **not** filter everything DSpatch sends. In particular, direct prompt content such as selected code and diffs is outside tool hooks. See the [content-exclusion contract](docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md) before using restricted material.
- Claude integration and distribution have provider-specific conditions and an unresolved approval question documented in [installation notes](docs/INSTALL.md#why-support-is-fetched-and-what-the-terms-say). A successful sign-in is not evidence of distribution permission.

## More documentation

<a id="börja-här"></a>

| Read | For |
| --- | --- |
| [Tutorial](TUTORIAL.md) | A guided introduction to review, interactive development and loops. |
| [Installation details](docs/INSTALL.md) | Package layout, provider support, SSH and troubleshooting details. |
| [Developer reference](app/README.md) | Scripts, architecture and implementation history; some sections describe earlier stages. |
| [Vision](docs/VISION.md) | Product direction and design decisions; proposals are distinguished from implemented behaviour. |
| [Interaction model](docs/INTERACTION_MODEL.md) | How people, agents and orchestration share responsibility. |
| [Development plan](BACKLOG.md) | Tasks, priorities and verification records. |
| [Agent instructions](AGENTS.md) | Contribution conventions and which design documents to read. |

<details>
<summary>Maintainer workflows</summary>

<a id="prova-utvecklingsloopen-i-cursor"></a>

The [external development loop](docs/DEVELOPMENT_LOOP.md) helps develop DSpatch from Cursor or Claude Code. It is separate from the loops run inside DSpatch. Its coordinator, roles and calibration history are described there; installing DSpatch does not require running that calibration.

<a id="granska-direkt-på-github"></a>

The [development plan](BACKLOG.md) and task files can be read directly on GitHub. [Maestro orchestration](docs/MAESTRO_ORCHESTRATION.md) and [agent behaviour](docs/AGENT_BEHAVIOUR_AND_ORCHESTRATION.md) cover the design in more depth.

<a id="öppna-backlogs-webbgränssnitt-lokalt"></a>

To open the optional planning board from the repository root:

```bash
npm install -g backlog.md@1.52.0
backlog browser
```

The repository already contains its Backlog configuration; do not run `backlog init`. This opens the planning tool, not DSpatch.

</details>

## License

[MIT](LICENSE). Third-party dependencies and agent providers remain subject to their own licenses and terms.
