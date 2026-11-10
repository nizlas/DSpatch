The script gets the container name and debug port from the task's environment in `CONTAINER` and `PORT`, then makes sure the container is up before it does anything else. The task in the previous step (W1.2) sets `DEV_CONTAINER` and `DEBUG_PORT`. The defaults, `orders-dev` and `5678`, are the same values, so they only matter if someone runs the script outside the task.

The check accepts only one result: `docker inspect` must print `true` for `.State.Running`. A stopped container prints `false`. A container that doesn't exist makes `docker inspect` fail, and its error message is thrown away, so the output is empty. **Both cases lead to the same hint and `exit 1`, and that exit code is how the task fails.** Walk W2 follows that branch. This walk continues with the container running.

<!-- dspatch:details -->
How the opening options play out here:

- `set -u` makes the script stop if it uses a variable that was never set. The `${VAR:-default}` form avoids that, because it falls back to the default when the variable is unset or empty.
- `set -e` makes the script stop at the first command that fails. The failure of `docker inspect` happens inside a command substitution that is only an argument to `[ ... ]`, and the `[` test sits in an `if` condition. So `set -e` does not stop the script there, and the `if` decides what happens. For the rest of the script, `set -e` means that any failing `docker exec` ends the script with a non-zero code, so the task fails as well.
- `pipefail` makes a pipeline fail if any command in it fails. The script has no pipelines, so it has no effect here.

The name must match exactly. The check uses `container_name: orders-dev` from the compose file, shown in the next step (W1.4), not the compose service name `dev`.

One case the check may not catch (from Docker's documented behaviour, not from this code): Docker generally reports a paused container with `Running` still `true`. If so, a paused `orders-dev` would pass this check.