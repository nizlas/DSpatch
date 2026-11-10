As we saw in W1.1, the debug configuration no longer starts the program itself. Its `preLaunchTask` value names a task that VS Code must run first. This is that task. VS Code finds it by text: the `preLaunchTask` string has to match this `label` exactly, character for character. If someone renames one and not the other, the link breaks.

Here are the parts of the task that matter for this walk:

- **`"type": "shell"`**: VS Code runs `command` in a shell in a terminal panel, just as if you had typed the script's path there. `${workspaceFolder}` is VS Code's variable for the repository root, so the command always points at this repository's `start-debugger.sh`, whatever folder the shell is in.
- **`options.env`**: `DEV_CONTAINER=orders-dev` and `DEBUG_PORT=5678` are set as environment variables for the script's process, along with the variables it would normally inherit. In the next step (W1.3) the script reads these two names, and that is where the container name and port come from.
- **`"problemMatcher": []`**: a problem matcher is a pattern VS Code applies to a task's output to turn compiler-style messages into entries in the Problems panel. An empty list says there is nothing to scan for. It also stops VS Code from asking the developer to choose a matcher when the task runs.

**What makes the hand-off to the attach work is what's missing:** the task has no `isBackground` setting. That makes it an ordinary task, so VS Code waits for the script process to exit and then judges the result by its exit code:

1. The script exits with 0, so VS Code goes on with the configuration and attaches (W1.8).
2. The script exits with anything else, so VS Code reports the pre-launch task as failed and does not simply go on. W2 follows that path.

<!-- dspatch:details -->
**Two consequences of this "wait for exit" design**

The script must finish for the attach to happen at all. This is why the last command in the script, which you'll see in W1.7, starts the service detached instead of running it in the foreground. If the script ran debugpy in the foreground, the task would never end, so VS Code would never attach. debugpy would wait for a client that never comes, and you'd have a deadlock.

The comparison point is a background task. With `isBackground: true` and a problem matcher that has begin and end patterns, VS Code would treat the task as ready when a certain line appeared in its output, even though the process was still running. That is the usual way to wait until a long-running server is ready. This task doesn't use it, so the exit code is the only signal VS Code gets. A zero exit code means the script's commands succeeded. It does not mean debugpy is already listening. W1.8 comes back to that gap.

**The port appears more than once**

The value `5678` given here is used by the script for debugpy's `--listen` address. The configuration's `connect` (W1.1) has its own `5678`, written separately, and so does the compose port mapping (W1.4). Nothing links these values: if one changes, the others have to be changed by hand.

**This file is new in the change**

At base there was only `launch.json`, with no tasks file. This task and its link from `preLaunchTask` come entirely from this change.