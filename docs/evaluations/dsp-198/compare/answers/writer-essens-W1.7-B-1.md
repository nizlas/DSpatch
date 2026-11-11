This is the last command the script runs, and the point where control passes from the script to the container. `docker exec -d` starts `python -m debugpy` inside the container and **returns at once**, without waiting for that process. The script then ends with exit code 0. Because the task has no background setting, VS Code waited for the script to exit, and now treats the pre-launch task as successful.

Inside the container, debugpy keeps running on its own:

- `--listen "0.0.0.0:$PORT"` makes it listen on every interface of the container, not only on its own loopback address. The editor's connection reaches it through the port that `compose.yaml` publishes, as shown in W1.4.
- `--wait-for-client` holds `orders.main` back. None of the service's code runs until a debugger attaches.

From here on, two things happen at the same time: VS Code moves on to attach (next step), and debugpy starts up in the container. Nothing in the script waits until debugpy is actually listening. If the editor connects before the port is open, that attach could fail; how likely that is cannot be told from the code. Since the process is detached, its output and any startup error (for example, a broken `orders.main` import) do not appear in the task's terminal. The task's success only means `docker exec` started the process. It does not show that debugpy came up.