This is the task that `preLaunchTask` in the debug configuration names ([W1.1]). VS Code finds it by its exact `label` and runs it before it tries to attach. `tasks.json` did not exist at base. Before this change no task ran first, and the configuration started `orders.main` directly.

**The task's exit code decides whether the debugger attaches.** It is a plain `shell` task with no background settings, so VS Code waits for `start-debugger.sh` to exit before going on. The script ends with a detached `docker exec -d` (shown in [W1.7]), so it does exit quickly, and that exit is when VS Code moves on:

- Exit code 0: VS Code goes on to attach to the waiting debugpy ([W1.8]).
- Non-zero exit, for example when the container is not running: no attach happens ([W2.1], [W2.2]).

The empty `problemMatcher` means VS Code does not scan the output for errors. What the script prints only appears in the task terminal.

The `env` block gives the script its container name (`orders-dev`) and debug port (`5678`). The script reads them in the next step ([W1.3]).

<!-- dspatch:details -->

**The port number is written in four places, and nothing links them.** At target, the port is the same literal number in:

- the task's `DEBUG_PORT`
- the script's fallback `${DEBUG_PORT:-5678}`
- `connect.port` in `launch.json`
- the published port `"5678:5678"` in `compose.yaml`

If you change only the task's `DEBUG_PORT`, debugpy listens on a port that `compose.yaml` does not publish, and `launch.json` still connects to 5678. All four values have to be changed together.

**The container name is repeated too.** `DEV_CONTAINER` matches the script's fallback and `container_name` in `compose.yaml`. As things stand, the task's `env` only repeats the script's defaults. It changes nothing unless someone edits one side and not the others.

```dspatch-references
{"references": [{"label": "The task and its environment", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Configuration that names this task", "step": "W1.1"}, {"label": "Script reads the env values, with matching defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Detached start that lets the script exit", "step": "W1.7"}, {"label": "Attach after a successful task", "step": "W1.8"}, {"label": "Failed task blocks the attach", "step": "W2.2"}, {"label": "Published debug port and container name", "path": "compose.yaml", "side": "target", "start": 4, "end": 9}, {"label": "Base launch configuration (no pre-launch task)", "path": ".vscode/launch.json", "side": "base", "start": 1, "end": 1}], "insufficient": false}
```