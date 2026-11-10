The task starts this new script, which does one thing before any other work: it confirms that the dev container is already running. Three points matter for the rest of the walk:

- **From here on, any failing command ends the script with an error.** `set -euo pipefail` turns that failure into a failed pre-launch task, so VS Code does not attach (the gate from W1.2).
- **The container name and port come from the task's environment.** If either is missing, it falls back to a built-in default (`orders-dev` and `5678`). These are the same values the task passes, so running the script by hand behaves the same way.
- **The script never starts the container.** It only asks Docker whether the container is running. If the answer is anything other than `true`, it prints how to start the container and exits. This walk follows the case where the container is running. W2 follows the case where it isn't.

<!-- dspatch:details -->
The check sends `docker inspect`'s error output to nowhere. Because that call sits inside the `[ ]` test, its failure doesn't trip `set -e`. The only thing that decides the branch is whether its output equals `true`. So several situations all end in the same "not running" message:

- the container exists but is stopped (Docker prints `false`)
- the container doesn't exist
- Docker itself can't be reached (both give empty output)

W2.1 covers what the developer sees in that case.