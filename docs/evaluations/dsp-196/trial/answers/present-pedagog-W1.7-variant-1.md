This line hands work from the editor's task to the container. It starts the service under the debugger and lets the script end without waiting for the service to start.

**`docker exec` with and without `-d`.** `docker exec` runs a command inside a container that is already running (here `orders-dev`, the container checked in [W1.3]). Without `-d`, it is like calling a function: the script waits until the command finishes and gets its exit code back. The earlier `docker exec` calls in the script work that way. With `-d` ("detached"), Docker starts the command and returns at once. The new process keeps running inside the container on its own, next to the container's `sleep infinity` main process from [W1.4]. A rough comparison is ending a shell command with `&`, except that the process lives in the container, not on your machine.

That is why this is the script's last line. Once the script exits with 0, VS Code treats the `preLaunchTask` from [W1.2] as finished. If the service ran in the foreground, the task would never end and the attach would never start.

**What the detached process does.** `python -m debugpy` starts debugpy's server first. That server is what a debugger client connects to. Two options control it:

- `--listen "0.0.0.0:$PORT"` accepts connections on every network interface in the container. Compose publishes container port 5678 to host port 5678 (the `ports:` mapping in [W1.4]). A connection arriving through that mapping comes from outside the container's own loopback, so a server listening only on `127.0.0.1` would not be reachable that way.
- `--wait-for-client` holds the program before `-m orders.main` runs. None of your service code runs until a debugger attaches, so breakpoints near the start of `main` still get hit.

**What the exit code tells you, and what it doesn't.** The script runs under `set -euo pipefail`, so any failing command stops it. With `-d`, though, the exit code of `docker exec` only says that Docker started the process. It says nothing about whether debugpy started listening. Suppose debugpy fails right after starting, for example because the port is already taken. The script still exits 0, and with `-d` that error output never reaches the task terminal.

**Two things now run at the same time.** The editor moves on to attach (next step, [W1.8]). Meanwhile, Python inside the container is still importing debugpy and opening the port. The script never checks that the port is listening, so nothing in the code makes sure the listener is ready before the attach. Which comes first depends on timing.

<!-- dspatch:details -->

**What can go wrong when the attach arrives first.** The attach config in [W1.1] connects to `localhost:5678`. If that connection arrives before debugpy is listening, it is refused, or Docker's port forwarder may accept it and then close it. Whether VS Code's debugpy extension retries is not defined in this repository, so the code does not show what happens next. One usual fix is to have the script poll the port before exiting, for example by retrying `docker exec … python -c` with a socket connect until it succeeds or a timeout runs out. That would also turn a startup failure into a non-zero exit code. This is an observation, not something the change does.

**Starting the session a second time.** Each run of the task starts another detached debugpy, and nothing stops the previous one. If an earlier session's process is still in the container (for example, the service is still running after the debugger disconnected), the new one cannot bind `0.0.0.0:5678`. As described above, that failure is silent, and the editor may end up attaching to the old process. Whether the old process is still alive depends on how the service and debugpy behave after disconnect, which this line does not decide.

**The port is configurable in only one place.** `PORT` comes from `DEBUG_PORT` (the task sets it to `"5678"`), but compose publishes a fixed `5678:5678` and the launch config connects to a fixed `5678`. If you change `DEBUG_PORT` on its own, debugpy listens on a port that is neither published nor attached to.

**Who owns the files the service writes.** `docker exec` runs as the container's default user. This compose file sets no `user:`, so that is root. That is why the earlier step [W1.6] gives `/workspace/logs` to the host user: the service started here runs as root and writes its log there in [W1.9].

**Compared with base.** The base revision has no `scripts/` directory and no `tasks.json`, so this detached start is entirely new in the target.

```dspatch-references
{"references": [{"label": "Detached debugpy start", "path": "scripts/start-debugger.sh", "side": "target", "start": 23, "end": 24}, {"label": "Strict mode and the PORT/CONTAINER defaults", "path": "scripts/start-debugger.sh", "side": "target", "start": 3, "end": 6}, {"label": "Task that runs the script and sets DEBUG_PORT", "step": "W1.2"}, {"label": "Container: sleep infinity and published 5678", "step": "W1.4"}, {"label": "Log folder handed to the host user", "step": "W1.6"}, {"label": "Attach through localhost:5678", "step": "W1.8"}, {"label": "Attach configuration with preLaunchTask", "step": "W1.1"}, {"label": "Service writes its log", "step": "W1.9"}], "insufficient": false}
```