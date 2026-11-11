# W1.5  (essens-prepared)

## Before Show more

docker exec -d starts debugpy, which runs orders.main inside the container and returns at once, so the task ends and VS Code goes on to attach. Because of --wait-for-client, main does not run until a debugger connects.

## Behind Show more

Since the command runs detached, the script never sees whether debugpy actually started: an error inside the container does not reach the task's exit code. From the code, two cases look possible:

Race: the task may finish before debugpy listens, and then VS Code's first connection attempt can be refused.

Rerun: with an attach configuration, ending the session normally disconnects without stopping the program. A process from an earlier run may still hold ports 5678 and 8000, and the new debugpy then fails without anyone seeing it.

The log-folder commands just before this are covered in the next item.
