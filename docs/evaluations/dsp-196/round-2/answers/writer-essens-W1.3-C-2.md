This is the gate for everything inside the container. The script settles which container and port to use, then refuses to go further unless that container is **already running**. It never starts the container itself.

- **Settings:** `CONTAINER` and `PORT` come from the `DEV_CONTAINER` and `DEBUG_PORT` values that the task passed in (W1.2). If either is unset or empty, it falls back to `orders-dev` or `5678`. These are the same values the task sets, so running the script by hand outside VS Code behaves the same.
- **Running check:** the script asks `docker inspect` for `.State.Running` and goes on only if the answer is exactly `true`. This walk follows that branch. W2 follows the other one.

Take this forward: `set -euo pipefail` means that from here on, **any command that fails ends the script with a non-zero exit, so the task fails and VS Code does not attach**. Every later step in the script can only fail this way.

<!-- dspatch:details -->
How the check behaves in the edge cases:

- **The container is stopped:** `docker inspect` prints `false`, so the script prints its message and exits 1.
- **The container does not exist, or `docker inspect` fails for some other reason:** its error output is thrown away, the result is an empty string, and the script takes the same failing branch. The `docker` failure itself doesn't trigger `set -e`, because the command substitution is only an argument to `[`. Only the result of the comparison decides the branch.
- **`set -u` and the variables:** the `:-` defaults keep `set -u` from stopping the script when `DEV_CONTAINER` or `DEBUG_PORT` is missing.