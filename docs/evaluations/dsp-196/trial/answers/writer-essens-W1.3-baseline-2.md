The task from the previous step has started the script. Here it settles two values and makes sure the target container exists before doing anything in it.

- **Settings.** `CONTAINER` and `PORT` come from `DEV_CONTAINER` and `DEBUG_PORT`. The fallbacks `orders-dev` and `5678` are the same values the task passes. They only take effect when the script runs outside the task, for example from a terminal.
- **Strict mode.** `set -euo pipefail` means a failing command or an unset variable stops the script with a non-zero exit code. The task reports that failure, which keeps VS Code from attaching to a half-prepared container.
- **Running check.** The script continues only if `docker inspect` prints exactly `true` for the container's running state. A stopped container prints `false`. A missing container makes `docker inspect` fail, its error is thrown away by `2>/dev/null`, and the result is an empty string. **Both cases fall into the same branch:** it prints a hint to run `docker compose up -d dev` and exits with 1. W2 follows that branch.

This walk continues with a running container. The next step shows the compose service this check expects to find under that name.

<!-- dspatch:details -->
A few edge cases the code allows (read from the code, not seen running):

- **Hint can be wrong.** Any failure of `docker inspect` is hidden the same way: Docker not installed, the daemon not reachable, or no permission to the Docker socket. The script then says the container "is not running" and suggests `docker compose up`, which may not be the actual problem.
- **Strict mode does not apply to the check.** The `docker inspect` call runs inside the `[ ... ]` test, so its failure does not trigger `set -e`. Only the comparison decides the outcome. That is why a missing container produces the hint instead of an abrupt exit.
- **Paused containers pass.** Docker still reports a paused container as running, so the check lets it through. The later `docker exec` calls would then fail, and strict mode would stop the script there.