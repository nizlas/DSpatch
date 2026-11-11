Here debugpy is handed off to run on its own inside the container, and the script ends. **From now on two things run side by side:** the task finishes so VS Code can move on to attach, while debugpy starts listening and holds `orders.main` back until a client connects.

<!-- dspatch:details -->
`-d` makes `docker exec` return as soon as the process has been started in the container. It does not wait for the process to finish. This is the last command in the script, so its exit status becomes the script's exit status, and that decides whether the task succeeded. This status only says whether the process was started. It says nothing about whether debugpy is listening yet, or about whether it is listening at all.

Some consequences of handing off the process this way:

- **Output is lost to the developer.** debugpy and `orders.main` print nothing to the task terminal. If `python -m debugpy` fails at startup, for example because the port is already taken, the task still ends successfully, and the failure only shows when the attach in the next step fails to connect.
- **Nothing synchronises the two sides.** The script does not wait for the port to open. Whether debugpy is listening by the time VS Code connects depends on timing that this code does not control.
- **`--listen "0.0.0.0:$PORT"`** binds to all interfaces inside the container. That is needed for the published port from compose (as we saw earlier) to reach it from the host. `$PORT` is the `DEBUG_PORT` value from the task, or 5678 by default.
- **`--wait-for-client`** stops debugpy from running `orders.main` until the editor connects, so breakpoints near the start of `main` can still be hit.
- Each run starts a new detached process. The script never checks for or stops one left over from an earlier session.