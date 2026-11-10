This is the script's last command, and it hands work off to another process. The `-d` flag tells `docker exec` to start the command inside `orders-dev` and return straight away without waiting for it. So the script reaches its end and exits with 0, and the pre-launch task from W1.2 counts as finished. The `debugpy` process keeps running in the container by itself, under the container's idle `sleep infinity` (W1.4).

That process does two things in a fixed order:

1. `--listen "0.0.0.0:$PORT"` opens debugpy's server on every interface in the container. Listening on `0.0.0.0` rather than localhost matters here, because the editor's connection comes in through the port that compose publishes, which arrives from outside the container.
2. `--wait-for-client` stops it before `-m orders.main` runs. The service code does not run until a debugger has attached.

**From this point two things run in parallel.** VS Code sees the task finish and moves on to attach (next step). At the same time, debugpy is still starting up in the container. The script does not wait for the port to be listening before it exits, so the order of those two events depends on timing.

<!-- dspatch:details -->
Because the process is detached, its output goes nowhere the developer can see. If debugpy is missing, `$PORT` is already in use, or the module fails to import, nothing about it reaches the task terminal. The script's exit code is decided only by whether `docker exec -d` could start the process, not by whether debugpy came up. If the attach in W1.8 fails, the cause has to be found inside the container.

`-m orders.main` resolves against the container's working directory. `docker exec` inherits that from the compose service's `working_dir: /workspace` (compose.yaml, target, line 5). So Python finds the `orders` package in the bind-mounted repository, the same `/workspace` that `pathMappings` refers to.

The script does not check whether an earlier debugpy process from a previous start is still running. Pressing F5 again would start a second process that tries to bind the same port. Nothing in the script prevents this, and its effect would not show in the task terminal.