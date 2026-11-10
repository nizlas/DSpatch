The task from the previous step (W1.2) has started the script. This first part makes sure there is a container to work in before anything else is sent to it:

1. **Settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. When the variables are missing, which happens only if someone runs the script outside the task, they fall back to `orders-dev` and `5678`. These are the same values the task passes.
2. **Running check.** `docker inspect` reads the container's `State.Running` flag. Anything other than the exact output `true` stops the script with exit code 1 and prints a hint to run `docker compose up -d dev`.

**The script does not start the container.** The developer must already have brought it up with compose. This walk follows the case where the container is running. W2 follows the failing branch.

<!-- dspatch:details -->
- **`set -euo pipefail`** makes the rest of the script fail fast. Any failing `docker exec` in the later steps ends the script with a non-zero code, so the task fails too. With `-u`, an unset variable is an error, which is why the settings use the `${VAR:-default}` form.
- **Why one test covers both failure cases.** A stopped container makes `docker inspect` print `false`. A container that doesn't exist makes it fail with an error message, which `2>/dev/null` throws away, and the command substitution then returns an empty string. Neither value is `true`, so both cases take the same branch. The failing `docker inspect` inside `$(...)` doesn't trigger `set -e` here, because it is part of the `if` test.
- **Where the default name comes from.** `orders-dev` matches `container_name` in compose.yaml (target, line 4). The next step shows that service.