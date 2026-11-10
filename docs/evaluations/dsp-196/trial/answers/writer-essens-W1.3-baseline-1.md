The task from the previous step has started the script. This first part fixes which container and port the script works with, and stops early unless that container is running.

- **Settings:** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT` in the task's environment. If either variable is missing or empty, the script uses `orders-dev` or `5678`. These defaults are the same values the task passes, so running the script by hand outside VS Code targets the same container and port.
- **Strict mode:** `set -euo pipefail` makes the script stop at the first command that fails. That matters for the rest of the script: a failed step ends it with a non-zero exit code, and VS Code sees the task as failed.
- **Running check:** the script asks Docker whether the container's `State.Running` is `true`. A container that is stopped gives `false`. A container that doesn't exist makes `docker inspect` fail, and `2>/dev/null` discards its error message, so the comparison gets an empty string. **Both cases lead to the same hint and `exit 1`.**

This walk continues with the outcome where the container is running. The failing branch, and what the developer sees then, is walk W2. The next step looks at the `orders-dev` container that this check expects.

<!-- dspatch:details -->
`set -e` does not end the script when `docker inspect` fails, because the failure happens inside a command substitution that is an argument to the `[` test in an `if` condition. Only the result of the comparison decides what happens. `pipefail` has no effect in this part because there are no pipelines here. `-u` would stop the script on an unset variable, but the `${VAR:-default}` form means `DEV_CONTAINER` and `DEBUG_PORT` never trigger that.

The hint tells the developer to run `docker compose up -d dev`. That uses the compose service name `dev`, not the container name. The two connect through `container_name` in compose.yaml, which the next step shows.