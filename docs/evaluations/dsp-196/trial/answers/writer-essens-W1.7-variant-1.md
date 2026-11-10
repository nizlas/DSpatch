This is the hand-off. With `docker exec -d`, Docker starts debugpy inside `orders-dev` and returns at once. The script ends there, so the pre-launch task ends too, normally with exit code 0. debugpy keeps running in the container on its own. It listens on `0.0.0.0:$PORT` and, because of `--wait-for-client`, holds `orders.main` back until a debugger connects.

**From here two things can run at the same time:** VS Code moves on to attach (next step, W1.8), and debugpy starts listening in the container. Nothing in the script or the task waits until debugpy is actually listening. The task's exit code also says nothing about whether debugpy started. Because the process is detached, its output and any startup error never reach the task terminal.

<!-- dspatch:details -->
Some details that affect the outcome:

- **What a success means here.** With `-d`, `docker exec` reports only whether Docker could start the command in the container. If debugpy or `orders.main` fails after that, `set -e` cannot catch it, because the script is already done. Such a failure would most likely show up only as a failed attach in W1.8.
- **How `-m orders.main` finds the module.** The `docker exec` call sets no working directory. The command therefore runs in the container's default, `working_dir: /workspace` from the `dev` service in `compose.yaml` (target, line 5), which is the bind-mounted repository from W1.4. That is why the `orders` package resolves.
- **Pressing F5 again.** The script does not check for, or stop, a debugpy that an earlier run left behind. From the code, a second run would start another debugpy on the same port while the first one may still hold it. What happens then depends on that earlier process; it cannot be read from this change.