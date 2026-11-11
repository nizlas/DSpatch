This task is the step that VS Code runs before it attaches the debugger. Its label is the name that `preLaunchTask` in `launch.json` points to. When the "Debug orders in the dev container" configuration starts, VS Code first runs `start-debugger.sh`. That script starts the orders service under debugpy inside the running `orders-dev` container, listening on port 5678. Only after that does VS Code connect to `localhost:5678`. So the task's job is to make sure a debug server is waiting for the editor before the attach happens.

This only holds if a few things stay true:

- **Label:** The label must match `preLaunchTask` exactly, or VS Code won't find the task.
- **Port:** `DEBUG_PORT` must match `connect.port` in `launch.json`. Both are 5678 now, but they are set in two separate places.
- **Container:** `DEV_CONTAINER` must name a container that is already running. The script doesn't start it; it exits with an error and tells you to run `docker compose up -d dev`.
- **Task must finish:** With an empty `problemMatcher`, VS Code waits for the task to finish before attaching. That works only because the script starts debugpy in the background (`docker exec -d`) and returns right away. If it ran in the foreground, the attach would never start.