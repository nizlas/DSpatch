This line is where the script hands the service to the container and gets out of the way. It starts `orders.main` inside `orders-dev` under debugpy, then lets `start-debugger.sh` finish. Because of `-d`, `docker exec` returns as soon as the exec has been created. The script ends with status 0, so the pre-launch task "Start debugger in dev container" counts as complete. The debugpy process keeps running inside the container, which is kept alive by `sleep infinity` ([W1.4]).

The process is set up to be attached to from outside:

- **`--listen "0.0.0.0:$PORT"`**: binds on all container interfaces. The editor's connection reaches the container through the `5678:5678` mapping in compose, so a localhost-only bind would not be reachable.
- **`--wait-for-client`**: keeps `orders.main` from running until a debugger attaches. Nothing in the service runs before the editor is connected.

**The deciding consequence: the task finishing does not mean debugpy is ready.** The script does not check that the port is listening before it exits. VS Code moves on to attach to `localhost:5678` ([W1.8]) while debugpy may still be starting in the container. Which happens first depends on timing. Nothing in this change waits for readiness or retries the attach. The code here doesn't show how the debugpy extension behaves if it connects too early.

<!-- dspatch:details -->

**What `-d` hides.** With `-d`, the exit status of `docker exec` only says the exec was started. It says nothing about whether debugpy came up. Two failures would go unnoticed, and the attach would just fail to connect:

- debugpy crashes on startup.
- The port is already taken, for example by a debugpy or service process left over from an earlier session. Nothing in the script stops an earlier process.

Its output also goes nowhere you can see, so the task's terminal shows none of it. This is an observation from reading the code, not something seen at run time.

**The port is set in three places.** The script reads `DEBUG_PORT` (default 5678, and `tasks.json` sets it to `"5678"`). The compose file publishes `5678:5678`, and `launch.json` connects to port `5678`, both fixed values. They match today. If only `DEBUG_PORT` changed, debugpy would listen on a port that is neither published nor the one the editor attaches to.

**Execution context.** `docker exec` runs as the container's default user. That is root, as the comment at lines 18–19 of the script says (the compose file sets no `user`). It runs in `working_dir: /workspace`, the bind-mounted repository, which is why `-m orders.main` resolves. Once the editor has attached, `main()` creates `/workspace/logs/orders.log` and serves on port 8000 ([W1.9]).

**Compared with base.** Base has no `scripts/` folder and no `tasks.json`. This detached exec is the new way the service gets started for debugging.

```dspatch-references
{"references": [{"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "Port and container defaults read by the script", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Task env sets DEV_CONTAINER and DEBUG_PORT", "path": ".vscode/tasks.json", "side": "target", "start": 4, "end": 10}, {"label": "Published debug port, working dir and idle command", "path": "compose.yaml", "side": "target", "start": 2, "end": 11}, {"label": "Container the script expects", "step": "W1.4"}, {"label": "VS Code attaches through the published port", "step": "W1.8"}, {"label": "The released service writes its log", "step": "W1.9"}], "insufficient": false}
```