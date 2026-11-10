This configuration is the starting point of the change. Pressing F5 on it no longer starts `service/main.py` on the developer's machine. VS Code now **attaches** the Python debugger (`type: "debugpy"`, `request: "attach"`) to a process that is already running somewhere else. In the earlier revision, the only configuration was "Run the service", which used `request: "launch"` to run the program locally in the integrated terminal.

Attaching means VS Code doesn't start the service itself. Something else has to start it first, and that is the job of `preLaunchTask`. Before attaching, VS Code runs the task whose label is exactly "Start the service container". The next step (W1.2) shows that task. The address VS Code attaches to and how it maps file paths come in W1.6.

<!-- dspatch:details -->
VS Code finds the task by its label, so the `preLaunchTask` string must match the `label` in the task file exactly. If the label is renamed in one place only, VS Code reports that it can't find the task and doesn't attach.

The task (W1.2) runs `docker compose up -d`, which returns once Compose has started the container. VS Code waits only for the task to finish. Nothing in these two files waits until the service inside the container is actually accepting debugger connections. Whether the attach can come too early is decided by timing at runtime, not by these files.