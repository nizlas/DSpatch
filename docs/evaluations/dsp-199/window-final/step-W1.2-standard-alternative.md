# W1.2  (standard-alternative)

## Before Show more

This task is the link between the editor and the dev container. As we saw in the previous step, the debug configuration now attaches to an already-listening debugpy rather than starting Python itself (W1.1). Something has to start that listener first. The configuration's preLaunchTask refers to this task by its exact label string, "Start debugger in dev container". So when the reader starts that debug configuration, VS Code runs this task first and attaches only after it finishes.

What the task does:

"type": "shell": VS Code runs command through the user's terminal shell, in a terminal panel. The path is built from ${workspaceFolder}, so it always points at the script in this repository.

options.env: sets DEV_CONTAINER=orders-dev and DEBUG_PORT=5678 for that process. The script reads both, falling back to the same values (${DEV_CONTAINER:-orders-dev}, ${DEBUG_PORT:-5678}). So the values here make the settings visible in one place but don't change behaviour. orders-dev matches the container_name in the compose file. How the port matches the attach side is covered in W1.6.

"problemMatcher": []: tells VS Code not to scan the output for compiler-style errors. Without this line, VS Code asks the user to choose a problem matcher when the task runs.

Why the attach can wait for the task: the task is not marked isBackground, so VS Code treats it as done when the script exits. The script's last command starts debugpy with docker exec -d (detached), so it returns at once while debugpy keeps listening with --wait-for-client. The task can therefore finish and the attach can follow. If the script had started debugpy in the foreground, the task would never finish and the editor would never attach. The next steps go through the script itself, starting with the check that the container is running (W1.3).

## Behind Show more

When the script fails. The script runs with set -euo pipefail and exits with 1 if the container isn't running. When a preLaunchTask ends with a non-zero exit code, VS Code doesn't attach on its own: it reports the failure and lets the user choose to debug anyway or abort. The script's message ("Start it with: docker compose up -d dev") goes to stderr, so it appears in the task's terminal. Since problemMatcher is empty, it doesn't appear in the Problems panel.

Things to check that the files can't settle:

The command is a bare .sh path run through the user's default shell. On Linux or macOS this needs the script to be executable. The file mode can't be seen here. On a Windows host using PowerShell or cmd, running a .sh path directly would probably not run it with bash. The task has no windows-specific override, and none of the files states which host platform it is meant for.

The port 5678 appears three times: in this task's env, in the debug configuration's connect.port, and in the compose port mapping. Changing it here alone would make debugpy listen on a port the editor doesn't connect to. W1.6 follows that path.
