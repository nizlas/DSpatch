This step is where a debug session starts. In VS Code's Run and Debug view the user picks the entry whose `name` is **"Attach to the service in the container"**. `type: "debugpy"` tells VS Code to use the Python debugger extension (debugpy) for this session.

**What changed here.** In the base revision, the only entry in this file was a different configuration:

- It was called "Run the service" and used `request: "launch"`.
- It pointed `program` at `${workspaceFolder}/service/main.py`.
- It used `console: "integratedTerminal"`.

With `"launch"`, VS Code starts the Python process itself on your machine, with the debugger already inside it. This change replaces that entry. The only configuration now uses `request: "attach"`.

**What "attach" means.** A debugger can come into play in two ways:

- **Launch:** the debugger starts the program. It's like clicking Run in an IDE.
- **Attach:** the program is already running somewhere, with a small debug server (a "listener") on a network port. The debugger only connects to that listener.

This is why the target configuration has no `program` field. VS Code doesn't start any Python here. It expects that something else has already started the service, with debugpy listening. In this repository that "somewhere else" is a Docker container. As a comparison: launch is starting a phone call yourself, and attach is dialling into a conference call someone else has already opened.

**Who starts the process.** Right after this step's lines comes `preLaunchTask: "Start the service container"`. VS Code runs that task before it tries to connect. It finds the task by its exact label among the workspace tasks, and the target's tasks file defines a task with that same label. The next step [W1.2] follows that label. The connection target (`connect`, `pathMappings`) is covered in [W1.6].

<!-- dspatch:details -->
**Things the switch to attach implies.** These are observations from reading the target files, not behaviour anyone has watched run:

- **The program doesn't wait for the debugger.** The container's command (shown in [W1.5]) starts debugpy with `--listen 0.0.0.0:5678` but without `--wait-for-client`. So the service starts running at once, whether or not VS Code has connected yet. Breakpoints in code that runs early (module import, server setup in [W1.7]/[W1.8]) may already have been passed by the time the debugger attaches. Code that runs on each request will still hit breakpoints.
- **The task finishing doesn't mean the listener is ready.** The pre-launch task runs `docker compose up -d --build service`. With `-d`, the command returns once the container has started, not once debugpy is listening on port 5678. Whether VS Code's first connection attempt can arrive too early depends on timing and on how the debugpy extension handles a refused connection. The repository's code doesn't settle that.
- **The base's `console: "integratedTerminal"` is gone.** It only makes sense for launch, where VS Code owns the process's input and output. With attach, the service's output goes to the container's logs instead. The task starts the container with `-d` (detached), so that output won't appear in VS Code's terminal.

```dspatch-references
{"references": [
  {"label": "Attach configuration (target)", "path": ".vscode/launch.json", "side": "target", "start": 4, "end": 14},
  {"label": "Earlier launch configuration (base)", "path": ".vscode/launch.json", "side": "base", "start": 4, "end": 10},
  {"label": "Task the label points to", "step": "W1.2"},
  {"label": "Container starts debugpy without --wait-for-client", "step": "W1.5"},
  {"label": "Connection details", "step": "W1.6"}
], "insufficient": false}
```