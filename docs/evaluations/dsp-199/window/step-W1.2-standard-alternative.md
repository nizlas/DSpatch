# W1.2  (standard-alternative)

## Before Show more

The launch configuration's preLaunchTask value, "Start debugger in dev container", matches this task by its label. As we saw earlier, F5 now does an attach instead of starting Python itself [W1.1]. This task's job is to get a debugpy server listening before that attach happens.

What the task does:

"type": "shell": VS Code passes command to the integrated terminal's shell. That command is the new scripts/start-debugger.sh.

options.env: sets DEV_CONTAINER=orders-dev and DEBUG_PORT=5678 for that process only. The script reads them into CONTAINER and PORT and falls back to the same two values if they're missing. So setting them here mostly documents the values and makes them easy to override.

No isBackground: VS Code treats the task as finished when the process exits, and only then starts the attach. This works because the script doesn't stay running. Its last command starts debugpy with docker exec -d, which returns right away (a later step covers this [W1.5]).

"problemMatcher": []: VS Code won't scan the output for compiler-style errors and won't ask the user to pick a matcher. Success or failure depends only on the exit code.

The exit code is what links the two files. When the script fails, for example with exit 1 because the container isn't running [W1.3], VS Code reports that the preLaunchTask failed and doesn't attach quietly. When it succeeds, the attach goes to localhost:5678.

## Behind Show more

The values are written down in several places. No single setting holds them, so each copy has to be kept in sync by hand:

Value	Where it appears (target)
orders-dev	the task env (tasks.json 8), the script default (start-debugger.sh 5), container_name in compose.yaml 4
5678	the task env (tasks.json 8), the script default (start-debugger.sh 6), connect.port in launch.json 9, the port mapping in compose.yaml 9

If you change DEBUG_PORT here, debugpy will listen on the new port inside the container. But the attach still connects to 5678 and compose still publishes only 5678, so you'd have to change those too. How the connection crosses into the container is covered in [W1.6].

"Waits for exit" doesn't mean "waits until debugpy is ready". The task ends when docker exec -d returns. At that point debugpy has been started inside the container, but nothing in the script checks that it is already listening on the port. The code allows a short window where the attach could arrive first. Whether that happens in practice depends on timing, not on anything this change guarantees.

How the command runs (an observation, not checked). The command is a bare path to a .sh file. That needs a shell that can run it, plus the file's executable bit or a working shebang. On a Linux or macOS host with bash that's normal. With PowerShell or cmd as the default task shell on Windows, it wouldn't run as written. Neither file sets an OS-specific windows override or picks a shell explicitly.
