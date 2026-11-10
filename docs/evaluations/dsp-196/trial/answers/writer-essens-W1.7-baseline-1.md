This is the handoff. With `-d`, `docker exec` starts the debugpy process inside `orders-dev` and returns at once without waiting for it. The script has nothing left to run, so it exits with 0 and the pre-launch task counts as successful.

**From this point two things run in parallel:**
- VS Code sees the task finished and goes on to attach (next step).
- In the container, debugpy starts up and opens its listener on `0.0.0.0:$PORT`. Because of `--wait-for-client`, it holds `orders.main` back until a debugger connects.

Nothing in the script or the task checks that debugpy actually came up. Its output and any startup error, such as a bad module path or a port already in use, go to the detached process and never reach the task terminal. A failure here would only show up when the attach fails.

<!-- dspatch:details -->
Two details make the command work as written:

- `--listen "0.0.0.0:$PORT"` binds on all interfaces inside the container. This is what lets the compose port mapping (`5678:5678` in compose.yaml, target line 9) forward the host's connection to it. A listener on `127.0.0.1` would be unreachable from the host.
- `-m orders.main` is resolved from the container's working directory. `docker exec` inherits that directory from the service's `working_dir: /workspace` (compose.yaml, target line 5), which is the bind-mounted repository, so the module found there is the developer's current source.

The script can exit 0 even if debugpy dies right after it starts. That's because `set -e` only sees the exit code of `docker exec -d` itself, and that code only says whether Docker managed to start the process.