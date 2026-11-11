Here the script starts `orders.main` inside the container under a debugpy server and exits right away. The process keeps running in the container, but `orders.main` is held back until a debugger connects to `$PORT`. When the script exits, the pre-launch task is done and VS Code goes on to attach, but nothing makes sure debugpy is already listening by then.

<!-- dspatch:details -->

**What `-d` guarantees.** With `-d`, `docker exec` only reports whether the process could be started in the container. It does not report what happens next. If debugpy fails after starting, the script cannot see it, and `set -euo pipefail` does not help. That covers an import error in `orders.main`, a debugpy that will not start, or a port that is already taken. The process's output is not attached to the task terminal either, so these failures leave no trace there.

**The race with the attach.** The task in `tasks.json` has no background or readiness settings, so VS Code treats it as finished when the script exits. The attach in `launch.json` then connects to `localhost:5678`, which `compose.yaml` publishes to the container. Whether debugpy is listening by that moment depends on timing, and nothing in this change waits for it. If it is not, the attach fails with a connection error. The service stays blocked in `--wait-for-client` until something connects.

**Running it again (my observation, not checked).** The script never stops an earlier debugpy process. Suppose a previous session's process is still in the container, either still waiting or still running `orders.main`. A second run would start another debugpy on the same port. That bind would probably fail, and because of `-d` the failure would not show up. The attach would then reach the old process, if anything.

**Why `0.0.0.0`.** debugpy has to listen on all interfaces inside the container. The published port forwards host traffic to the container's network interface, not to its loopback address.

```dspatch-references
{"references": [{"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "Strict mode that does not cover the detached process", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 6}, {"label": "Pre-launch task with no readiness settings", "step": "W1.2"}, {"label": "Attach to the published port", "step": "W1.8"}, {"label": "Port 5678 published by the dev container", "path": "compose.yaml", "side": "target", "start": 8, "end": 10}], "insufficient": false}
```