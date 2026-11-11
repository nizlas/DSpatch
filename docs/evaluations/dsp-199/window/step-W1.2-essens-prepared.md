# W1.2  (essens-prepared)

## Before Show more

The preLaunchTask label refers to this shell task. The task runs the script and passes the container name and port as environment variables. The task is not marked as a background task, so VS Code waits for the script to exit before attaching.

## Behind Show more

problemMatcher: [] turns off output parsing. The script is run by its path, so it needs the executable bit. The file was added with mode 100644, so on Linux or macOS the task can fail with "permission denied" unless the mode is changed or the command becomes bash ….
