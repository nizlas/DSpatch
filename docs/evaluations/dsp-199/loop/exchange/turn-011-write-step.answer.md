This is the same guard as in the first walk, now with the container stopped or missing. The script prints how to start the container and exits with status 1 before it touches the container, so **the pre-launch task fails** and no debugger is started.

<!-- dspatch:details -->
For a stopped container, `docker inspect` prints `false`. For a missing one, it fails, and `2>/dev/null` discards its error. Either way the result isn't `true`.

The same branch also catches cases the message doesn't describe, because the discarded error was the only clue:

- the Docker daemon isn't reachable;
- `docker` isn't installed on the host;
- the container runs under a different name than `DEV_CONTAINER`.

In all of these the developer sees the same hint to run `docker compose up -d dev`.

The message goes to stderr in the task's terminal, and the exit code is the only signal the editor gets. The next step shows what the editor does with it.