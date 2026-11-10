This is the task that the debug configuration's `preLaunchTask` names (see [W1.1]). VS Code finds it by its exact `label`. Its job is to run `start-debugger.sh` before VS Code tries to attach. `tasks.json` is new in this change. In the base revision, the configuration ran the service directly and there was no task.

**What decides the outcome:** this is a plain `shell` task with no background or `isBackground` settings. VS Code waits for the script to exit, and the exit code decides what happens next. Exit 0 lets the session go on to attach ([W1.8]). A non-zero exit stops the attach, which is the path [W2.2] follows. With `problemMatcher: []`, VS Code does not scan the output for errors, so only the exit code counts.

`options.env` gives the script its two inputs: the container name `orders-dev` and the port `5678`. The script reads them in the next step.

<!-- dspatch:details -->
**The same values are written in several places.** Nothing connects these copies, so a change to one has to be made by hand in the others:

- **Port 5678** appears in:
  - `DEBUG_PORT` here
  - `connect.port` in `launch.json`
  - the `"5678:5678"` mapping in `compose.yaml`
  - the script's fallback, `${DEBUG_PORT:-5678}`
- **Container name `orders-dev`** appears in:
  - `DEV_CONTAINER` here
  - `container_name` in `compose.yaml`
  - the script's fallback, `${DEV_CONTAINER:-orders-dev}`

Because the script's fallbacks are the same as the values set here, the `env` block changes nothing at the moment. It only states the inputs openly. If someone edits only one of these copies, nothing reports an error; the attach simply fails or reaches the wrong place.

**When the task counts as finished.** The script ends with a detached `docker exec -d`, so it exits as soon as it has started debugpy. It does not wait for debugpy to be listening. The task therefore succeeds once the start command has been issued, not once the debugger is ready. Whether VS Code's connection can arrive before debugpy is listening is a question for the attach step ([W1.7], [W1.8]), and the code here does not answer it.

```dspatch-references
{"references": [{"label": "The task", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Configuration that names the task", "step": "W1.1"}, {"label": "Script reads DEV_CONTAINER and DEBUG_PORT with defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Container name and port mapping in compose", "path": "compose.yaml", "side": "target", "start": 4, "end": 9}, {"label": "Detached start: script exits right after", "step": "W1.7"}, {"label": "Attach through the port", "step": "W1.8"}, {"label": "Failed task blocks the attach", "step": "W2.2"}], "insufficient": false}
```