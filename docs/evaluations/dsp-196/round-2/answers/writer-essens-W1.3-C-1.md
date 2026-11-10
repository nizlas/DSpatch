The script is new in this change. This first block guards it: it decides which container and port to use, then refuses to continue unless that container is **already running**. The script never starts the container itself.

- **Settings:** `CONTAINER` and `PORT` come from the `DEV_CONTAINER` and `DEBUG_PORT` values the task passed in (W1.2). If those are unset or empty, the script falls back to `orders-dev` and `5678`. The fallbacks match the task's values, so running the script by hand gives the same result.
- **Running check:** the script asks `docker inspect` for `.State.Running` and goes on only if the answer is exactly `"true"`. The walk takes that branch here. The other branch prints a hint and exits 1, which W2.1 follows.

From here on the script runs under `set -euo pipefail`. **From this point, any failing command ends the script with a non-zero exit, so the task fails and VS Code does not attach.** This is why each later step in the container is a point where the walk can stop.

<!-- dspatch:details -->
Three details of the check are easy to miss:

- `docker inspect`'s error output is sent to `/dev/null`. A container that doesn't exist gives empty output with no error message, and that fails the `"true"` comparison in the same way as a stopped container (which prints `"false"`).
- The `docker inspect` call sits inside the `[ ]` test. So when it fails, `set -e` does not stop the script, and only the comparison decides the branch. The same holds when Docker itself can't be reached, so that case also lands on the "not running" message (W2.1).
- The `:-` form of the fallbacks is also what keeps `set -u` from stopping the script when the variables are missing.

`PORT` is not used until the script starts debugpy in W1.7. The container name `orders-dev` is defined in the compose service shown in the next step (W1.4).