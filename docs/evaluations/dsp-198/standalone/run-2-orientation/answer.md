This task is what the debug configuration from the previous step runs before it attaches. Its job is to get the orders service running under the debugger inside the already-running dev container, so the editor has something to connect to. The task itself does very little. It names the start script and gives it the container name and port to use, and the script does the actual work.

For this to stay accurate, these values have to match across files:

- **Task label:** "Start debugger in dev container" must match `preLaunchTask` in `launch.json` exactly. If it doesn't, VS Code can't find the task.
- **Port 5678:** it has to be the same here, in `launch.json`'s `connect` port, and in the port mapping in `compose.yaml`.
- **Container name `orders-dev`:** it has to match `container_name` in `compose.yaml`.

The script falls back to these same values if the variables aren't set. That means a mismatch introduced here wouldn't fail loudly; the editor would simply try to attach to the wrong place.