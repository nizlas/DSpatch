This is the script's guard. The task from the previous step [W1.2] started it with `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678`. Before the script runs anything inside the container, it settles which container to use and checks that the container is up. The script is new in this change; the base revision has no `scripts/` folder.

**Why it matters:** the script's exit status is the result of the pre-launch task, and that result decides whether VS Code attaches. `set -euo pipefail` makes any failing command end the script with a non-zero status. So a failure in this check, or in any later `docker exec` step, means no attach.

**The check:** the script continues only when `docker inspect` reports the container's running state as exactly `true`. Two cases fail it:
- **The container exists but is stopped.** The output is `false`.
- **No container has that name.** `docker inspect` fails, its error goes to `/dev/null`, and the captured output is empty.

In both cases the script prints a hint to run `docker compose up -d dev` and exits with 1. W2 follows that path. This walk continues with the container running.

**Defaults:** `orders-dev` and `5678` are the same values the task passes, so the defaults only matter when someone runs the script by hand. `PORT` is not used here; it is used when debugpy starts listening [W1.7].

<!-- dspatch:details -->

Some points that affect how far the check and the defaults can be trusted:

- **The two failure cases look the same.** A missing container and a stopped one produce the same message. A typo in `DEV_CONTAINER` therefore shows up as "not running" rather than "no such container". The hint also assumes the name refers to the `dev` service, which only holds while compose's `container_name: orders-dev` matches [W1.4].
- **Why the `:-` form is needed.** Under `-u`, a plain `$DEV_CONTAINER` would abort the script when it runs outside the task. The `:-` form also falls back when the variable is set but empty.
- **Changing the port in one place is not enough (my observation).** `DEBUG_PORT` only changes the port debugpy listens on inside the container. The attach target in `launch.json` (`port: 5678`) and the published port in `compose.yaml` (`"5678:5678"`) are both fixed. If you set `DEBUG_PORT` to anything else, you also have to change those two files; otherwise the attach does not reach debugpy [W1.8].
- **This check only proves the container was running at that moment.** The later `docker exec` steps can still fail, for example if the container stops in between. `-e` turns any such failure into a failed task as well.

```dspatch-references
{"references": [{"label": "Settings and running check", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 11}, {"label": "Task that runs the script with the environment", "step": "W1.2"}, {"label": "Container name and published ports", "step": "W1.4"}, {"label": "Where PORT is used", "step": "W1.7"}, {"label": "Attach target port", "step": "W1.8"}, {"label": "The failing branch", "step": "W2.1"}], "insufficient": false}
```