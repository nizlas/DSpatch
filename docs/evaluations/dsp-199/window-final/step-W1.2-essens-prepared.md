# W1.2  (essens-prepared)

## Before Show more

The task with the label preLaunchTask names runs start-debugger.sh in a shell. It passes the container name and debug port as environment variables.

## Behind Show more

problemMatcher: [] tells VS Code not to scan the output for errors. Whether the debug session goes ahead then depends on the script's exit code. A non-zero exit, like the one from the container check, makes VS Code report that the preLaunchTask failed.

The script is added as a regular file, and the diff shows no executable mode. If the file is not executable on checkout, running it directly as the command will fail.
