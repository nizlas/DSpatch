DSPATCH-REVIEW-TASK: rewrite-briefs (DSP-196 trial)

You planned the walks below for a code review. Keep every walk, step, title and place exactly as they are. For every step, write three things again:
- "summary": one line the person reads first above the step's explanation, in every profile. Say what the step does in the flow: its task and its effect, the way an experienced developer would name it. Do not list the operations, flags or fields the code uses.
- "brief": orientation for the writer, written before the profile is known. Say what the step is for in the flow, how the walk reaches it, and what the reader takes onward to the next step, including a condition or risk that decides the outcome. Do not tell the writer which operations, flags or fields to explain: which of the material this reader needs, and at what level, the profile decides.
- "notes": the facts, conditions and risks that the old brief and your reading of the code hold for this step, as plain statements of what the code does and allows, each grounded in the code. Keep every fact of the old brief that the code supports. These are material the writer can draw on in every profile, not a list of what must be said.
Read the code at the places with your tools before you write. Answer with one JSON object in a fence: {"steps": {"<step id>": {"summary": "...", "brief": "...", "notes": "..."}}}, with every step of the plan.

## The plan, with its current summaries and briefs

### W1 (walk): Starting "Debug orders in the dev container"
Purpose: Follow the F5 press from the launch configuration through the pre-launch task and the script into the container, and back to the editor's attach.
Question: What happens, in order, from the moment the developer starts the new debug configuration until the debugger is attached to the running service?
- W1.1 The debug configuration now attaches — The configuration changes from launching orders.main locally to attaching after a pre-launch task.
  - Debug configuration, From and To: .vscode/launch.json (To) lines 5–12
  - Brief: This is the entry point: the developer picks this configuration and starts it. Explain the move from `launch` with `module` and `console` to `attach` with `preLaunchTask`, `connect` and `pathMappings`. VS Code runs the named task first and attaches only after it, so nothing in this file starts the program any more. Tell the reader to keep `connect` and `pathMappings` in mind, because the last steps come back to them.
- W1.2 The pre-launch task runs the script — A shell task with the matching label runs start-debugger.sh with the container name and port in its environment.
  - The "Start debugger in dev container" task: .vscode/tasks.json (To) lines 4–10 — reached from preLaunchTask in the debug configuration (.vscode/launch.json target 8–8)
  - Brief: The configuration reaches this task through its `preLaunchTask` value, which matches this `label` exactly. Explain that the task is an ordinary shell task, not a background task, and has an empty `problemMatcher`. VS Code therefore treats the task as finished when the script exits and judges it by the exit code. Then it attaches. Point out that `DEV_CONTAINER` and `DEBUG_PORT` are passed here and that the script reads them next.
- W1.3 The script checks that the container is running — The script reads the container name and port, and stops with a hint if the container is not running.
  - Settings and running check: scripts/start-debugger.sh (To) lines 3–11
  - Brief: Execution is now in the shell script, started by the task. Explain what `set -euo pipefail` does, the defaults that apply when the task's environment variables are missing, and the `docker inspect` check, including how `2>/dev/null` covers a container that does not exist. This walk follows the outcome where the container is running. The failing branch is its own walk.
- W1.4 The container the script expects — compose.yaml defines orders-dev: the image, the /workspace bind mount, the published ports and an idle command.
  - The dev service: compose.yaml (To) lines 2–11
  - Brief: This step leaves the order of execution to show the unchanged compose service that the check and the rest of the script rely on. Explain that the container name, the published 5678 port and the `.:/workspace` bind mount are what make the task values, `connect` and `pathMappings` fit together. `sleep infinity` means the container does nothing until the script runs commands in it with `docker exec`. The reader brings these facts back to the script.
- W1.5 debugpy is installed if missing — The script tests whether debugpy can be imported in the container and installs it with pip if it cannot.
  - Install debugpy once: scripts/start-debugger.sh (To) lines 13–16
  - Brief: Back in the script, after a successful check. Explain the import test and the pip install. debugpy is not part of the `python:3.12-slim` image, so the first run installs it into the running container. The install lasts only as long as that container and needs network access. Under `set -e`, a failed install stops the script and so the task.
- W1.6 The log folder is prepared for the host user — The script creates /workspace/logs in the container and changes its owner to the host user's uid and gid.
  - Create and chown the log folder: scripts/start-debugger.sh (To) lines 18–21
  - Brief: Explain the reason given in the script comment: the container runs as root and `/workspace` is the bind-mounted repository. Note that `$(id -u):$(id -g)` is expanded by the host shell before `docker exec` runs, so it is the host user's ids. Make clear that the chown applies to the folder only, as the code reads, and tell the reader that a later step shows what the service writes inside it.
- W1.7 The service starts detached under debugpy — docker exec -d starts debugpy listening on the port, waiting for a client before it runs orders.main, and the script ends.
  - Detached debugpy start: scripts/start-debugger.sh (To) lines 23–24
  - Brief: Explain `-d`: `docker exec` returns at once, and the debugpy process goes on in the container on its own. This is a handoff to another process. The script exits and the task finishes, while debugpy listens on `0.0.0.0:$PORT` and holds `orders.main` back until a client connects. Its output and any startup error do not reach the task terminal. The reader takes from this step that two things now run in parallel: VS Code moving on to attach, and debugpy starting to listen in the container.
- W1.8 VS Code attaches through the published port — After the task exits, the editor connects to localhost:5678 and maps the workspace to /workspace.
  - connect and pathMappings: .vscode/launch.json (To) lines 9–12
  - Revisit: The first step showed these lines as part of the new configuration. Here they are what VS Code actually does after the task: the connection target and how paths are translated.
  - Brief: Execution is back in VS Code, which goes on with the configuration once the pre-launch task has exited successfully. Explain how `localhost:5678` reaches debugpy through the compose port mapping. Explain how `pathMappings` turns host file paths into `/workspace` paths so that breakpoints match. Note that the port is written separately here, in the task environment and in compose, and that nothing in the task waits for debugpy to be listening before the attach.
- W1.9 The released service writes its log — Once the client is attached, debugpy runs orders.main: main creates the log folder if needed, logs to orders.log and serves on 8000.
  - main: log folder, log file, server: orders/main.py (To) lines 6–12
  - Brief: In the container, the debugpy process from the detached start runs the module once the editor has connected. Show that `main` uses the same `/workspace/logs` folder the script prepared and that its `mkdir(exist_ok=True)` now finds the folder already there. Then `logging.basicConfig` creates `orders.log` as the container's root user. Leave the reader with the ownership of that file compared with the chowned folder, and with the fact that breakpoints in this code now resolve through the path mapping.

### W2 (walk): When the dev container is not running
Purpose: Follow the failing branch of the running check back to VS Code's pre-launch task handling.
Question: What does the developer see if they start the debug configuration while orders-dev is stopped or missing?
- W2.1 The check fails and the script exits — docker inspect does not report true, so the script prints how to start the container and exits with 1.
  - Failing running check: scripts/start-debugger.sh (To) lines 8–11
  - Brief: Start again at the branch point in the script, this time where the container is stopped or does not exist. Explain why both cases end up in this branch: `docker inspect` either prints `false` or fails with its error output discarded. The message goes to stderr in the task terminal, and the exit code is 1. Nothing after this point runs in the container.
- W2.2 The failed task blocks the attach — Because the pre-launch task ended with a non-zero exit code, VS Code does not go on to the attach.
  - preLaunchTask link: .vscode/launch.json (To) lines 8–8
  - Brief: Execution is back in VS Code at the `preLaunchTask` link. Explain that a task that exits with an error is reported as failed, and that the debug session does not attach unless the developer chooses to debug anyway. The visible hint is the script's message in the task terminal. Present this as how VS Code handles a failed pre-launch task, not as something seen running here.


## The code, and how to read it
Your working folder holds the two revisions as files, written by DSpatch from the repository's commits:
- `base/` is From, commit e3cf9a268a6d276516b33019ab42446c3477a8fe
- `target/` is To, commit f78f14a342d216c0b76732b9578c8a67b58e2f5e
Use your Read, Glob and Grep tools there. Read whole files, follow the calls, definitions, imports and callers the change touches across files, look at unchanged code, tests and configuration, and compare base/ with target/ where behaviour changed. Keep looking until you can explain or judge from the code itself; the diff below is a starting point, not everything you may need.
Only these tools exist here and only inside this folder: you cannot change files, run commands or reach anything else. Nothing here comes from a working copy.
In your answer, name places by repository path without `base/` or `target/`, with the side ("base" for From, "target" for To) and 1-based lines at that side.