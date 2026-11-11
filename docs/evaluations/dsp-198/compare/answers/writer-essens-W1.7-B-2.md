This is the script's last command, and it hands the work to another process. `docker exec -d` starts `python -m debugpy` inside `orders-dev` and returns right away. Nothing in the script waits for that process, so the script ends and the pre-launch task finishes.

Inside the container, debugpy listens on `0.0.0.0:$PORT`. That is the port compose publishes to the host (W1.4). Because of `--wait-for-client`, debugpy holds `orders.main` back until a debugger connects. The module runs from the container's `/workspace` working directory, which is the bind-mounted repository.

**From here, two things run independently:**
- VS Code sees that the task has ended and goes on to attach (next step).
- debugpy is still starting up in the container.

The script never checks that debugpy is actually listening before it exits. With `-d`, debugpy's output and any startup error (for example, the port is already taken) also don't appear in the task terminal. The task's exit code only shows whether `docker exec` managed to start the process, not whether the debugger came up.

<!-- dspatch:details -->
The task doesn't set `isBackground`, so VS Code treats it as an ordinary task and waits for the script to exit before it attaches. That makes the detach necessary. Without `-d`, `docker exec` would block on a debugpy that is waiting for a client, the task would never end, and the attach would never start.

The cost is a possible race. Nothing makes debugpy listen before VS Code tries to connect. In practice debugpy probably starts fast enough, but the code doesn't guarantee it. If the attach fails, the debugpy process left in the container is the place to look.