This task is what the debug configuration's `preLaunchTask` names: it runs `start-debugger.sh` with `DEV_CONTAINER` and `DEBUG_PORT` set in its environment. Because it is a plain foreground shell task, VS Code waits for the script to exit and attaches only if the exit code is zero. The script's exit is therefore the signal that lets the attach go ahead.

<!-- dspatch:details -->
**What "done" means here.** `isBackground` is not set, so VS Code doesn't watch the output for a ready pattern. It only waits for the process to end. The empty `problemMatcher` turns off output scanning and the prompt asking you to pick a matcher. Anything the script prints just stays in the task terminal. `tasks.json` is new in this change; the base revision has only `launch.json`.

**The exit comes early.** The script's last command is `docker exec -d … debugpy --listen … --wait-for-client`. With `-d`, `docker exec` returns as soon as the process has been started in the container, not when debugpy is listening. So the task can finish, and the attach can start, slightly before the port is open. This is something I noticed in the code, not something I saw happen at runtime. Whether it causes a problem depends on how the debugpy attach handles a refused first connection. That logic isn't in this repository.

**The same values live in several places.**
- `DEBUG_PORT` is `5678` here, and the attach uses its own `connect.port` of `5678`. Nothing ties the two together, so changing one without the other breaks the attach.
- Both env values here are the same as the script's built-in fallbacks (`${DEV_CONTAINER:-orders-dev}`, `${DEBUG_PORT:-5678}`). Setting them in the task makes them explicit, but they aren't needed for the default case.

```dspatch-references
{"references": [{"label": "The task", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Configuration that names this task", "step": "W1.1"}, {"label": "Attach target port, set separately from DEBUG_PORT", "step": "W1.8"}, {"label": "Script defaults for the same variables", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Detached start that ends the script", "step": "W1.7"}], "insufficient": false}
```