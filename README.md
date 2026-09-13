# DSpatch

An experimental development workspace for human–AI collaboration and autonomous agent workflows, focused on simplicity, code understanding, and evolving how software is built.

<a id="börja-här"></a>

## Start here

| Material | Contents |
| --- | --- |
| [Vision](docs/VISION.md) | The complete product vision. Markdown is the governing source. |
| [Agent instructions](AGENTS.md) | Reading order, principles, working rules and project language. |
| [Development plan](BACKLOG.md) | Preparatory loop calibration and six product steps, with ordering and task links. |
| [Development loop](docs/DEVELOPMENT_LOOP.md) | Cursor agents, coordinator, handoffs, rework and recovery. |
| [Run the application](app/README.md) | Install, run, build and package the current application skeleton. |

The selected stack is TypeScript, React and Electron. Windows and Linux are target platforms, with a consistent workspace as the goal. Initial implementation and testing use Cursor on Niclas's Windows computer; Linux support is introduced incrementally. [Decisions and verification](docs/VISION.md#91-selected-stack-and-platforms) define the scope. The runnable application skeleton is in `app/`; a verified provider connection is still pending in DSP-1. VS Code/Copilot remains in the vision and informs technical decisions, with implementation and testing later. The first milestone goes from interactive chat to a real repository code change, review of a normal diff and a build or test run. Cancellation, recovery and persisted history are included; actual use guides further development.

Maestro is the orchestrator's internal working name. Human-interactive work and autonomous iteration are both part of the vision; the user chooses their level of involvement.

English is the project's maintained language. Conversations with Niclas may be in Swedish; see the [language policy](AGENTS.md#project-language).

<a id="prova-utvecklingsloopen-i-cursor"></a>

## Try the development loop in Cursor

Open the repository root in Cursor and enter `/dspatch-loop calibrate` in an Agent chat for the initial calibration. The coordinator runs in the main chat and calls five specialists directly. Git and Python 3.10+ are needed for the local probe. [Startup instructions and limitations](docs/DEVELOPMENT_LOOP.md) also describe resuming a run in a new chat.

DSP-7 records the completed calibration on Niclas's computer. Consult the task files for current state; do not repeat completed calibration simply because these startup instructions exist. This loop helps build DSpatch; it is not a finished Maestro feature in the product.

<a id="granska-direkt-på-github"></a>

## Review directly on GitHub

Open the development plan above and follow its task links. Each task describes its value, scope, dependencies and assessment criteria. GitHub's preview is sufficient to read the proposal and comment in its pull request.

<a id="öppna-backlogs-webbgränssnitt-lokalt"></a>

## Open Backlog's web interface locally

After cloning the repository and fetching the branch containing these files, install Backlog.md and start it from the repository root. These commands require Node.js/npm:

```sh
npm install -g backlog.md@1.52.0
backlog browser
```

The Backlog configuration and tasks already exist in `backlog/`; no new `backlog init` is needed. The command opens the local board in a browser. Keep the terminal process running while using it. This starts the planning tool. To start DSpatch itself, follow [app/README.md](app/README.md).

Planning reads the current working copy. Backlog's automatic remote calls and cross-branch searches are disabled in this initial setup. Fetch and publish changes explicitly with Git when needed. No MCP connection is required to read or update the plan.

See also [Backlog.md's official documentation](https://github.com/MrLesk/Backlog.md).
