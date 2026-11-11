```json
{
  "summary": "The change stops the editor's debug configuration from running the orders service directly on the host. Instead, pressing F5 now runs a pre-launch task with a new shell script. The script checks that the `orders-dev` container is running, installs debugpy in it if needed, creates `/workspace/logs` and hands it to the host user, then starts `orders.main` under debugpy, detached, waiting for a client on port 5678. The debug configuration then attaches to that port and maps the host workspace to `/workspace` in the container.",
  "background": "The container comes from the unchanged `compose.yaml`. It runs `python:3.12-slim` as `orders-dev`, bind-mounts the repository at `/workspace`, publishes ports 5678 and 8000 and only sleeps. So the service exists in the container only when this script starts it.\n\nThree work contexts are involved: the editor on the host, the task's shell and its `docker` commands on the host, and the processes inside the container. The detached debugpy process keeps running in the container after the script has returned.\n\nThe diff records `scripts/start-debugger.sh` as `new file mode 100644`, meaning it is not executable, while the task runs it as a command.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer starts \"Debug orders in the dev container\"",
      "question": "How does pressing F5 lead to an editor attached to the orders service inside the container?",
      "purpose": "Follow F5 from the debug configuration through the task and the script into the container, and back to the attach.",
      "steps": [
        {
          "title": "The debug configuration now attaches",
          "summary": "The configuration changes from launching orders.main locally to attaching to port 5678, after a pre-launch task.",
          "brief": "This is the entry point: the developer picks this configuration and presses F5. Contrast it with the removed base version (lines 5-9: `request: launch`, `module: orders.main`, integrated terminal). Explain that `attach` means the editor no longer starts any process itself; it needs something else to be listening. `preLaunchTask` names the task that has to provide that listener, and it runs before the attach. Leave `connect` and `pathMappings` for a later step. The reader takes the task label to the next step.",
          "places": [
            {
              "label": "Debug configuration (attach with preLaunchTask)",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 12,
              "anchor": "\"preLaunchTask\": \"Start debugger in dev container\""
            }
          ]
        },
        {
          "title": "The pre-launch task runs the script on the host",
          "summary": "A shell task with the matching label runs start-debugger.sh with DEV_CONTAINER and DEBUG_PORT set.",
          "brief": "Reached because the label matches `preLaunchTask`. Make clear that the task runs on the host in a shell, and that it passes the container name and port as environment variables. `problemMatcher: []` means the editor treats the task as done when the command exits. That is why the script must return rather than keep running in the foreground. Mention that the diff gives the script mode 100644 (not executable) while `command` runs it directly; present this as a point to check, not as observed behaviour. The reader carries the two variables into the script.",
          "places": [
            {
              "label": "Task definition",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 10,
              "anchor": "\"label\": \"Start debugger in dev container\"",
              "from": {
                "label": "preLaunchTask that names this task",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Settings and the running-container guard",
          "summary": "The script reads the container and port with defaults and stops if the container is not running.",
          "brief": "Now inside the script, still on the host. Explain `set -euo pipefail`, the defaults on lines 5-6 (they repeat the task's values), and how `docker inspect` checks the container state. In this walk the container is running and execution continues. The failing branch is its own walk. Point out that the port appears in the task, the script default, `compose.yaml` and the attach configuration, and these must agree.",
          "places": [
            {
              "label": "Defaults and container check",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 3,
              "end": 11,
              "anchor": "docker inspect -f '{{.State.Running}}'"
            }
          ]
        },
        {
          "title": "debugpy is installed into the container on demand",
          "summary": "If importing debugpy fails in the container, pip installs it there.",
          "brief": "Next in the script. Explain that both `docker exec` commands run Python inside the container, not on the host. The image is plain `python:3.12-slim` (`compose.yaml`), so debugpy is missing on the first run. The install lives in the container's filesystem, not in the bind mount, so it lasts only as long as that container. The reader moves on knowing debugpy is now available in the container.",
          "places": [
            {
              "label": "Conditional debugpy install",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 13,
              "end": 16,
              "anchor": "python -m pip install --quiet debugpy"
            }
          ]
        },
        {
          "title": "The log folder is created and given to the host user",
          "summary": "The script creates /workspace/logs in the container and chowns it to the host user's uid:gid.",
          "brief": "Next in the script. Explain that `$(id -u):$(id -g)` is expanded by the host shell before `docker exec` runs, so it gives the host user's ids. Because `/workspace` is the bind-mounted repository, the folder appears on the host. Make the claim in the comment precise: this sets the folder's owner. Whether files the service later creates in it are editable is a question the reader takes along to the step where `main()` writes the log.",
          "places": [
            {
              "label": "mkdir and chown of the log folder",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 18,
              "end": 21,
              "anchor": "chown \"$(id -u):$(id -g)\" /workspace/logs"
            }
          ]
        },
        {
          "title": "The service starts detached under debugpy",
          "summary": "docker exec -d starts debugpy with --wait-for-client in the container and returns at once; the script and the task end.",
          "brief": "The last line of the script. This is where work moves to another context: `-d` leaves a process running inside the container, independent of the host shell. With `--wait-for-client`, debugpy listens on 0.0.0.0:PORT and only runs `orders.main` once a client connects. `docker exec` returns, the script exits 0, and so the task is complete (see the task step). Frame two points as questions to check rather than facts: whether debugpy is already listening when the editor tries to attach, and what happens to a second start while an earlier debugpy process still holds the port. A detached failure is not visible in the task output. Next, the walk goes back to the editor.",
          "places": [
            {
              "label": "Detached debugpy start",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 23,
              "end": 24,
              "anchor": "docker exec -d \"$CONTAINER\" python -m debugpy"
            }
          ]
        },
        {
          "title": "How localhost:5678 and /workspace reach the container",
          "summary": "compose.yaml publishes port 5678 and bind-mounts the repository at /workspace, which the attach relies on.",
          "brief": "This unchanged file is shown as a dependency, not as an execution step. It explains why the editor's `localhost:5678` reaches debugpy in the container, why the container name `orders-dev` matches, and why `-m orders.main` resolves from the working directory `/workspace`. It is the ground for the attach settings in the next step.",
          "places": [
            {
              "label": "Dev service: name, mount, ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 2,
              "end": 11,
              "anchor": "container_name: orders-dev"
            }
          ]
        },
        {
          "title": "The editor attaches and maps paths",
          "summary": "After the task, the editor connects to localhost:5678 and maps the workspace folder to /workspace.",
          "brief": "Back in the editor's context, after the task has finished. Explain `connect` and `pathMappings`: breakpoints set on host files are translated to `/workspace/...` paths in the container, and back again, which matches the bind mount from the previous step. When the client connects, debugpy stops waiting and runs `orders.main`; the next step follows that, inside the container.",
          "places": [
            {
              "label": "connect and pathMappings",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 12,
              "anchor": "\"remoteRoot\": \"/workspace\""
            }
          ],
          "revisit": "The first step showed the switch to attach; here the connection target and the path translation are read against compose.yaml."
        },
        {
          "title": "main() runs in the container and writes the log",
          "summary": "The unchanged main() creates /workspace/logs if needed, logs to orders.log and serves on port 8000.",
          "brief": "This runs in the container process that debugpy started, once the editor is attached. Show that `main()` creates the log folder itself (`exist_ok=True`), so the script's mkdir is there for the chown. The service runs as the container's user (root, per the script's comment), so `orders.log` is created by that user inside a folder owned by the host user. Bring back the question from the log-folder step without settling it: does the folder's ownership make the file itself editable from the host?",
          "places": [
            {
              "label": "main(): log setup and serve",
              "path": "orders/main.py",
              "side": "target",
              "start": 6,
              "end": 12,
              "anchor": "logging.basicConfig(filename=LOG_DIR / \"orders.log\""
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "What happens when the dev container is not running",
      "question": "What does the developer see if they press F5 before `docker compose up -d dev`?",
      "purpose": "Follow the failing branch of the container guard back to the editor.",
      "steps": [
        {
          "title": "The guard fails and the script exits 1",
          "summary": "docker inspect gives no \"true\", so the script prints how to start the container and exits with status 1.",
          "brief": "Start again at the guard from the main walk, on the condition that the container is missing or stopped. `docker inspect` then fails or prints `false`, and its stderr is discarded. Explain the message on stderr and `exit 1`: nothing is installed or started in the container. The reader takes away that the task ends with a failure, which matters in the next step.",
          "places": [
            {
              "label": "Not-running branch",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 8,
              "end": 11,
              "anchor": "is not running. Start it with: docker compose up -d dev"
            }
          ]
        },
        {
          "title": "The failed pre-launch task stops the attach",
          "summary": "The task's non-zero exit is reported back to the debug configuration that required it.",
          "brief": "Back in the editor's context: the configuration's `preLaunchTask` has failed. Say that what the editor then does (an error or prompt, and no attach) is the editor's behaviour, not code in this repository. Note that `problemMatcher: []` means only the exit code and the terminal output report the failure. Compare with the base configuration, which needed no container.",
          "places": [
            {
              "label": "preLaunchTask dependency",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 7,
              "end": 8,
              "anchor": "\"preLaunchTask\": \"Start debugger in dev container\""
            }
          ]
        }
      ]
    }
  ]
}
```