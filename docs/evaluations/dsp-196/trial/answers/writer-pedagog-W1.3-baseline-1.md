The task from the previous step started this script. The script now has to answer one question before it does anything inside Docker: **is the dev container actually running?** Every later command in the script uses `docker exec`, and that only works in a running container.

**`set -euo pipefail`** changes how bash handles errors for the rest of the script. By default bash just moves on to the next line when a command fails. With this line:

- `-e`: the script stops as soon as a command fails, and that failure becomes the script's exit code. This matters later in the walk: a failed `docker exec` stops the script, so the task also fails.
- `-u`: using a variable that was never set is an error, not a silent empty string.
- `-o pipefail`: a pipeline such as `a | b` fails if any part of it fails, not only the last part. This script has no pipelines, so this flag has nothing to act on here.

**The two settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`, which the task put into the environment in the previous step. The form `${DEV_CONTAINER:-orders-dev}` means "use the variable's value, or `orders-dev` if it is unset or empty". It does not break the `-u` rule, because the default covers the missing case. So the script also works when you run it by hand from a terminal. The defaults are the same values the task passes. That means the container name and port are written in two places that must match.

**The running check.** `docker inspect -f '{{.State.Running}}' "$CONTAINER"` asks Docker for the container's details. It prints only the `Running` field, as the text `true` or `false`. `$( … )` captures that text, and the `[ … != "true" ]` test compares it.

- **Stopped container:** Docker prints `false`, so the test fails.
- **No container with that name:** `docker inspect` writes an error and exits non-zero. `2>/dev/null` throws away the error text, so the captured string is empty and the test fails the same way. The `-e` rule does not stop the script here, because a command whose result is tested by `if` doesn't trigger `-e`.

In both cases the script prints the `docker compose up -d dev` hint to stderr and exits with 1. That branch is followed in W2.1.

This walk takes the other outcome: Docker printed `true`, so the script goes on past the `if`. The next step looks at the compose service that the name `orders-dev` is expected to refer to.

<!-- dspatch:details -->

The check accepts exactly one answer: the text `true`. Anything else counts as "not running". This also covers cases the hint doesn't mention. Reading the code, if the `docker` command is missing from the PATH, or the Docker daemon can't be reached, the substitution also comes out empty, because its stderr is discarded. The developer would then see "Container orders-dev is not running" when the real cause is that Docker itself isn't available. This is what the code allows, not something observed running.

The check is a snapshot taken at one moment. If the container stops between this check and the `docker exec` calls after it, those calls fail. Because of `-e`, the script then stops with Docker's own error and does not print this hint.