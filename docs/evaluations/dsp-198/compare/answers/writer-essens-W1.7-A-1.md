In this last command, the script hands the service over to a separate process in the container. With `-d`, `docker exec` starts `python -m debugpy … -m orders.main` and returns straight away without waiting for it. The script then ends, and because the task is an ordinary shell task (W1.2), VS Code counts the pre-launch task as finished and successful.

Inside the container, debugpy runs by itself:

- it listens on `0.0.0.0:$PORT`, so it accepts connections that come in through the compose port mapping (W1.4), not only from inside the container;
- `--wait-for-client` makes it hold `orders.main` back. The service's own code does not start until a debugger has attached.

**From this point two things run at the same time:** VS Code goes on to attach (next step), and debugpy starts up and begins listening in the container. Nothing in the script or the task waits for debugpy to be ready first.

<!-- dspatch:details -->
A detached exec has two consequences for what the developer sees:

- **Errors are hidden from the task.** The script's exit code only says that `docker exec -d` could start the process. If debugpy fails afterwards (for example, the port is already taken or `orders.main` cannot be imported), the task still counts as successful. The process's output does not appear in the task terminal either. The problem would only show up later, as an attach that fails.
- **Earlier runs are not stopped.** The script never ends a debugpy process left over from a previous run. If such a process still holds the port, the new one cannot listen on it. This is my reading of the code, not something observed running.

`-m orders.main` can find the package because the compose service sets `working_dir: /workspace`, which is the bind-mounted repository (W1.4). `docker exec` uses that directory by default.