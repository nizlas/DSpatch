# W1.1  (essens-prepared)

## Before Show more

VS Code no longer starts the program. It connects to a debugger that is already running.

Before the change, VS Code started service/main.py itself, as a local process in the integrated terminal. Now the configuration is an attach: VS Code starts no Python process. It expects a debugpy server to be waiting somewhere and connects to it.

Before it connects, VS Code runs the task named in preLaunchTask. That task is the only thing in this setup that brings the container up. The next step shows it.

## Behind Show more

VS Code matches the preLaunchTask value against a task label in tasks.json. If the two strings drift apart, VS Code reports that it cannot find the task, and the attach fails.
