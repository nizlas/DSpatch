# DSP-198 purpose trial · the four answers

Each answer verbatim, as shown beside the code: plain text, no Show more. **A** is the orientation-summary task of `../standalone/prompt-2-orientation.md` with its calibration example; **B** is the purpose description in `task-B.md`. Everything else in a step's two prompts is identical. One new session per answer; Claude, reported `claude-opus-5-5`. The whole calls, with tool calls and results, are in `run-<step>-<variant>/call.md`.

## W1.2

### W1.2 · variant A (1256 characters)

> This task is the step that VS Code runs before it attaches the debugger. Its label is the name that `preLaunchTask` in `launch.json` points to. When the "Debug orders in the dev container" configuration starts, VS Code first runs `start-debugger.sh`. That script starts the orders service under debugpy inside the running `orders-dev` container, listening on port 5678. Only after that does VS Code connect to `localhost:5678`. So the task's job is to make sure a debug server is waiting for the editor before the attach happens.
>
> This only holds if a few things stay true:
>
> - **Label:** The label must match `preLaunchTask` exactly, or VS Code won't find the task.
> - **Port:** `DEBUG_PORT` must match `connect.port` in `launch.json`. Both are 5678 now, but they are set in two separate places.
> - **Container:** `DEV_CONTAINER` must name a container that is already running. The script doesn't start it; it exits with an error and tells you to run `docker compose up -d dev`.
> - **Task must finish:** With an empty `problemMatcher`, VS Code waits for the task to finish before attaching. That works only because the script starts debugpy in the background (`docker exec -d`) and returns right away. If it ran in the foreground, the attach would never start.

### W1.2 · variant B (1290 characters)

> This task is the link between the debug configuration and the start script. Its label is the exact string that the attach configuration in `launch.json` names as its `preLaunchTask`. When you pick "Debug orders in the dev container", VS Code runs this task first and attaches only after the task has finished.
>
> The task runs `start-debugger.sh` in a shell on the host. It doesn't run inside the container. It passes the script two values as environment variables: which container to target and which port debugpy should listen on. The port matters most here. `DEBUG_PORT` 5678 has to match the `connect.port` in `launch.json`, because debugpy will listen on that port inside the container and the editor will try to connect to it. If one changes without the other, the attach fails. The script falls back to the same defaults (`orders-dev` and 5678) if the variables are missing, so these values set the defaults explicitly rather than add new behaviour.
>
> This is a plain task that ends when the script exits. It is not a background task, and the empty `problemMatcher` means VS Code doesn't scan the output. That works only because the script returns quickly: its last command starts debugpy detached, and debugpy then waits for the editor to connect. The next step shows how that happens.

## W1.7

### W1.7 · variant A (718 characters)

> This line starts the orders service inside the running dev container, but holds it back until the editor connects. The script returns right away. The service then waits in the background, so the editor can attach (W1.8) before any of `orders.main` runs, including its startup code.
>
> **Condition:** this only works while the debug port matches everywhere, and the defaults all use 5678. `compose.yaml` publishes only `5678:5678`, and `.vscode/launch.json` connects to `localhost:5678`. The script itself takes `DEBUG_PORT` from the environment. If you set `DEBUG_PORT` to anything else, debugpy listens on a port that isn't published to the host. The editor can't connect, and the service waits forever without running.

### W1.7 · variant B (1415 characters)

> This line starts the orders service inside the dev container, with debugpy wrapped around it. It's the step that hands control from the script to the editor.
>
> There are two flags to notice, and they rely on each other:
>
> - **`-d` (detached)** makes `docker exec` return right away and leaves debugpy running in the container. The editor runs this script as the attach configuration's `preLaunchTask`, and it won't try to attach until that task finishes. If the line ran in the foreground, the task would never end and the editor would never attach.
> - **`--wait-for-client`** makes debugpy open its port and then hold off on running `orders.main` until a debugger connects. So nothing in the service has run by the time the editor attaches, and breakpoints in startup code still get hit.
>
> Together, the script exits straight away and the service waits for the editor.
>
> Two smaller points connect this line to the rest of the setup:
> - debugpy listens on `0.0.0.0` so connections from outside the container can reach it. That lets the port mapping in `compose.yaml` (`5678:5678`) carry the editor's connection from `localhost:5678` on the host.
> - The service runs as root in the container, and that's why the previous step created `logs/` and gave it to the host user first. Log files the service writes there stay editable from the host.
>
> Next, in W1.8, the editor connects to that port and the service starts running.
