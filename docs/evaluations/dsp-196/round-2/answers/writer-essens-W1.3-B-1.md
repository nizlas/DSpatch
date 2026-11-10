The task has started the script. Before the script touches the container, it does three things:

1. It switches on strict mode with `set -euo pipefail`. **From here on, any command that fails ends the script with a non-zero exit, and VS Code then treats the pre-launch task as failed**, so the attach doesn't happen (W1.2).
2. It sets `CONTAINER` and `PORT` from the `DEV_CONTAINER` and `DEBUG_PORT` values the task passes. If a variable is unset or empty, it falls back to `orders-dev` and `5678`. These defaults are the same values the task passes, so running the script by hand gives the same result.
3. It checks that the container is already running. The script never starts the container itself. If the check fails, it prints a hint and exits 1. This walk follows the branch where the container is running; W2 follows the failing branch.

<!-- dspatch:details -->
The check passes only when `docker inspect` prints exactly `true` for `.State.Running`. Several cases print something else and take the failing branch:

- **Stopped container:** `docker inspect` prints `false`.
- **Missing container:** `docker inspect` fails. Its error goes to `/dev/null`, so the output is empty.
- **Docker itself unavailable:** for example, the daemon can't be reached. The output is empty, the same as for a missing container.

In all of these cases the script prints the same message: the container is not running.

A failing `docker inspect` here doesn't trigger `set -e`. The command runs inside the `[ … ]` test, so only the result of the comparison decides which branch the script takes.