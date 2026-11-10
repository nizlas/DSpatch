Here the task from the previous step has started the script in a host shell, with `DEV_CONTAINER` and `DEBUG_PORT` in its environment. Before the script touches the container, it sets strict error handling, picks up its two settings and makes sure the container is up.

**Strict mode.** `set -euo pipefail` turns on three Bash options:
- `-e`: the script exits as soon as a plain command fails, meaning it returns a non-zero exit status.
- `-u`: using a variable that was never set is an error. It does not silently become an empty string.
- `-o pipefail`: a pipeline fails if any command in it fails, not only the last one.

This matters for the whole walk. VS Code judges the task only by the script's exit code (step W1.2), so `-e` is what turns a failed `docker exec` in later steps into a failed task.

**Settings with defaults.** `${DEV_CONTAINER:-orders-dev}` means "the value of `DEV_CONTAINER`, or `orders-dev` if it is unset or empty". `PORT` works the same way, with `5678` as its default. The `:-` form is also safe under `-u`. The defaults match what the task passes, so they only take effect when someone runs the script without the task, for example by hand in a terminal.

**The running check.** `docker inspect -f '{{.State.Running}}' "$CONTAINER"` asks Docker for one field of the container's state. The `-f` option takes a Go template, and this one prints only that field, so the output is `true` or `false`. `$( … )` captures that output as a string, and the `[ … != "true" ]` test compares it with the exact text `true`.

**The container is running**, so the output is `true`, the test is false and the script skips the `if` body. That is the path this walk follows next.

If the container is stopped or does not exist, the script prints a hint to stderr and exits with 1. Walk W2 follows that branch.

<!-- dspatch:details -->

**How `2>/dev/null` covers a missing container.** If no container has that name, `docker inspect` writes nothing to stdout. It writes an error message to stderr and exits with a non-zero status. `2>/dev/null` discards that error text, so the captured string is just empty, and an empty string is not `"true"`. A stopped container and a missing container therefore end up in the same branch, and the developer sees only the script's own hint, not Docker's error.

**Why `-e` doesn't stop the script here.** The failing `docker inspect` sits inside a command substitution, and that substitution is an argument to the `[` test. Only the exit status of the test counts for the `if`. Commands tested by an `if` are exempt from `-e` anyway. So a failing `inspect` leads to the hint and `exit 1`, not to an early silent exit.

**A case the check can't tell apart (my reading of the code, not something observed running):**
- Docker isn't installed, or the Docker daemon can't be reached.
- `docker inspect` fails, and its error is also discarded.
- The script then says the container "is not running" and suggests `docker compose up -d dev`. That message would point the developer in the wrong direction.

**What the check proves.** It confirms only that a container with this name is running when it runs. It doesn't confirm that this is the container defined in `compose.yaml`, with the expected mount and port. That link rests on the name alone, and the next step shows where the name is defined.