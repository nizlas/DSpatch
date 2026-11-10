This is the script's last command, and its job is to hand off. `docker exec -d` starts debugpy inside the container and returns as soon as the process has been created. The script then ends with exit 0, and VS Code treats the pre-launch task from [W1.2] as finished. The debugpy process keeps running in `orders-dev`, which stays up because of its `sleep infinity` command ([W1.4]).

Inside the container, debugpy listens on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it does not run `orders.main` until a debugger attaches. Listening on all interfaces is needed: the editor's connection arrives through the port that compose publishes, and from inside the container that traffic does not come from localhost.

**What decides the outcome:**

- **Timing between the two sides.** Once the task has finished, VS Code moves straight on to attach ([W1.8]). Nothing in the script checks that debugpy is already listening before it exits, so whether the port is open first or the attach happens first depends on timing.
- **Errors after the start are not reported.** With `-d`, the exit code covers only creating the exec. If debugpy fails after that, for example because the port is taken or the module can't be imported, the task still succeeds. The only sign is a failed attach in the next step.

<!-- dspatch:details -->

**The port is set in three places.** `PORT` comes from `DEBUG_PORT`, which defaults to 5678 and is set to 5678 in the task's environment. But the published port in `compose.yaml` and the `connect.port` in `launch.json` are both fixed at 5678. If only `DEBUG_PORT` changes, debugpy listens on a port that is neither published nor the one the editor connects to.

**A second run can collide with the first.** Nothing here stops an earlier debugpy/`orders.main` process that may still be running in the container. If one is still alive and holding 5678, the new debugpy cannot listen there. Because the start is detached, that failure is not reported, and the attach may reach the old process instead. This comes from reading the script; I haven't seen it happen.

**The service runs as root.** `docker exec` runs as the container's default user, which the comment on the log-folder lines says is root. So the service runs as root too. That is why the script hands the log folder to the host user beforehand ([W1.6]); what the service writes there is covered in [W1.9].

This script is new in the target revision. The base revision has no `scripts/` folder.

```dspatch-references
{"references": [{"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "PORT and CONTAINER defaults from the environment", "path": "scripts/start-debugger.sh", "side": "target", "start": 5, "end": 6}, {"label": "Task that runs the script and sets DEBUG_PORT", "step": "W1.2"}, {"label": "Container with sleep infinity and published 5678", "step": "W1.4"}, {"label": "Log folder handed to the host user", "step": "W1.6"}, {"label": "Attach through the published port", "step": "W1.8"}, {"label": "Released service writes its log", "step": "W1.9"}], "insufficient": false}
```