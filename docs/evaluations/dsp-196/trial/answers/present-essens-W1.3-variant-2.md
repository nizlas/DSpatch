This is the script's guard step. Before it runs anything inside the container, it decides which container and port to use and stops early if that container isn't running. The script is new in this change: `base` has no `scripts/` folder.

The important consequence is in `set -euo pipefail`. With it, any later `docker exec` that fails ends the script with a non-zero code. That code is the result of the pre-launch task we saw in [W1.2], so a failure here or later in the script means VS Code doesn't attach. The `-u` flag would also make an unset variable fatal. The `:-` defaults avoid that, so the script still works when you run it by hand without the task's environment.

The running check gives one of two outcomes:
- **Running:** `docker inspect` prints exactly `true`, and the script goes on to set up debugpy. This walk follows that path.
- **Anything else:** the container is stopped (`false`) or doesn't exist (empty output, with the error discarded). The script prints the `docker compose up -d dev` hint to stderr and exits 1. [W2.1] follows this branch.

`PORT` isn't used in this step. It's only read when debugpy starts listening in [W1.7].

<!-- dspatch:details -->

**What the defaults actually cover.** The task always passes `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Those are the same as the fallbacks, and `orders-dev` is also the `container_name` in `compose.yaml` ([W1.4]). Inside VS Code, then, the defaults never take effect.

**The port is set in three places.** Changing `DEBUG_PORT` alone would not move the debugger. It changes where debugpy listens inside the container, but two other values stay at 5678: the port that `compose.yaml` publishes (`"5678:5678"`) and the attach target in `launch.json` (`connect.port: 5678`). If you changed only the variable, the attach would fail. I found this while reading the code; it is not one of the review's findings.

**Why only an exact `true` passes.** The command substitution sits inside `[ ... ]`. A missing container makes `docker inspect` fail, but that failure doesn't trigger `set -e` here: the substitution only produces the string being tested, and the `!=` test decides which branch runs. Because only the exact string `true` passes, a missing container and a stopped one end at the same exit 1.

```dspatch-references
{"references": [{"label": "Strict mode, defaults and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script", "step": "W1.2"}, {"label": "Container name in compose", "step": "W1.4"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "Failure branch", "step": "W2.1"}, {"label": "Published debug port", "path": "compose.yaml", "side": "target", "start": 8, "end": 9}, {"label": "Attach port in launch config", "path": ".vscode/launch.json", "side": "target", "start": 9, "end": 9}], "insufficient": false}
```