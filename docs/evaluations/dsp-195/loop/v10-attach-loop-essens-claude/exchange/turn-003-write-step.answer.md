When F5 is pressed, VS Code runs this one shell command before it attaches:

- `--build` rebuilds the image from the current workspace first, so the container gets the code as it is now (the image comes in the next step).
- `service` starts only that one service from the compose file.
- `-d` (detached) makes the command return once the container has started. It does not wait for the program inside to be ready.

**VS Code counts the task as finished when the command exits, and then attaches.** The task has no `isBackground` flag and no problem matcher, so nothing tells VS Code to wait until the debugger inside the container is listening. "Container started" and "debugger listening on 5678" are different moments. Keep this gap in mind until the attach in W1.8.

<!-- dspatch:details -->
If the command fails, for example because Docker isn't running or the build breaks, it exits with an error. VS Code then reports the pre-launch task as failed instead of attaching. Docker Compose has a `--wait` flag that waits for the container to be running or healthy. This task doesn't use it, and the compose file defines no health check, so the compose file gives no readiness signal tied to debugpy.