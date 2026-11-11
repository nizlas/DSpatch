```json
{
  "summary": "The change replaces the editor's local \"Run orders locally\" launch configuration with one that attaches to the orders service inside the already-running `orders-dev` container. Before attaching, VS Code runs a new task, which calls `scripts/start-debugger.sh`. The script checks that the container is running, installs debugpy in it if it is missing, creates the bind-mounted `/workspace/logs` folder and hands it to the host user, and then starts `orders.main` under debugpy in the background. debugpy waits for the editor to connect before `main` runs.",
  "background": "The dev container comes from `compose.yaml`, which this change leaves alone. It runs `python:3.12-slim` as root, bind-mounts the repository at `/workspace`, publishes ports 5678 and 8000, and only sleeps. The service is never started by the container itself: from now on the script starts it, through `docker exec`.\n\nThe old configuration ran `orders.main` on the host, and the change removes it. The new configuration is the only one left.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the user starts debugging",
      "question": "What runs, and in what order, when the user picks \"Debug orders in the dev container\"?",
      "purpose": "Follow the chain from the launch configuration through the task and the script to the editor attaching to debugpy.",
      "steps": [
        {
          "title": "The attach configuration",
          "summary": "Launch becomes attach",
          "body": "The configuration no longer starts Python itself. It attaches to a debugpy server on `localhost:5678`, and before that, `preLaunchTask` makes VS Code run a task found by its label.",
          "why": "",
          "details": "The old configuration launched `orders.main` on the host in the integrated terminal. That way of running the service is gone, and no configuration replaces it.\n\n`pathMappings` maps the workspace folder to `/workspace`, the bind mount in `compose.yaml`. This lets breakpoints set in host files match the paths that the code inside the container reports.",
          "places": [
            {
              "label": "Debug configuration, From and To",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 12,
              "anchor": "\"preLaunchTask\": \"Start debugger in dev container\""
            }
          ]
        },
        {
          "title": "The task that runs the script",
          "summary": "Shell task with container and port",
          "body": "The task runs the script as a shell command and passes the container name and the debug port in as environment variables. VS Code starts the attach only after this task has finished.",
          "why": "",
          "details": "The task is not marked `isBackground`, so VS Code waits for the script to exit. That is why the script must return quickly, which is what the detached start in a later step does.\n\nThe command runs the script file directly. The diff adds `scripts/start-debugger.sh` with mode `100644`, without the executable bit. Unless the bit is set some other way, a shell on Linux or macOS refuses to run the file directly.",
          "places": [
            {
              "label": "Task definition",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 10,
              "anchor": "\"label\": \"Start debugger in dev container\"",
              "from": {
                "label": "preLaunchTask names this label",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Stop early if the container is down",
          "summary": "Container running check",
          "body": "The script asks Docker whether the container is running and stops with a hint if it is not. Because the task then fails, the attach does not go ahead.",
          "why": "",
          "details": "`docker inspect` errors are discarded, so a container that does not exist gives the same message as one that is stopped. `set -euo pipefail` near the top makes any later failing `docker exec` stop the script as well.",
          "places": [
            {
              "label": "Running check",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 8,
              "end": 11,
              "anchor": "docker inspect -f"
            }
          ]
        },
        {
          "title": "Install debugpy on first use",
          "summary": "One-time debugpy install",
          "body": "If `import debugpy` fails inside the container, the script installs debugpy with pip. Later runs skip this step.",
          "why": "",
          "details": "The install lives only in the container's writable layer. Recreating the container (for example with `docker compose down`) removes it, and the next run installs it again. The install needs network access from the container.",
          "places": [
            {
              "label": "Conditional pip install",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 13,
              "end": 16,
              "anchor": "import debugpy"
            }
          ]
        },
        {
          "title": "Start the service under debugpy, detached",
          "summary": "Detached debugpy start",
          "body": "`docker exec -d` starts `orders.main` under debugpy and returns at once, so the script and the task finish. Thanks to `--wait-for-client`, debugpy holds `main` back until the editor connects.",
          "why": "",
          "details": "Because the start is detached, the script never learns whether debugpy actually started or began listening. Its output stays inside the container. Two cases the code allows:\n\n- The task finishes as soon as `docker exec -d` returns, which can be before debugpy is listening. The attach can then hit a port that is not open yet. Nothing in the script waits for the port.\n- If a debug session from an earlier run is still alive in the container, the new process cannot bind port 5678 (and the service cannot bind port 8000). That failure is invisible here, because the error goes to the detached process.",
          "places": [
            {
              "label": "Detached debugpy start",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 23,
              "end": 24,
              "anchor": "docker exec -d"
            }
          ]
        },
        {
          "title": "The editor attaches",
          "summary": "Attach through the published port",
          "body": "Once the task is done, VS Code connects to `localhost:5678`. That port reaches debugpy only because `compose.yaml` publishes container port 5678 on the same host port.",
          "why": "",
          "details": "debugpy listens on `0.0.0.0` inside the container, which is what makes the published port reachable. After the editor connects, `main` runs and serves HTTP on port 8000, which compose also publishes.",
          "places": [
            {
              "label": "Port publishing in the dev service",
              "path": "compose.yaml",
              "side": "target",
              "start": 8,
              "end": 10,
              "anchor": "\"5678:5678\""
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "Who owns the log files",
      "question": "Does handing the logs folder to the host user keep the service's log files editable on the host?",
      "purpose": "See what the chown in the script covers and what the service then writes as root.",
      "steps": [
        {
          "title": "Create and hand over the logs folder",
          "summary": "chown of the folder only",
          "body": "Before starting the service, the script creates `/workspace/logs` as root and changes the owner of the folder to the host user's IDs. Only the folder changes owner, not files that are created in it later.",
          "why": "",
          "details": "`id -u` and `id -g` run on the host, inside the script, not in the container. Owning the folder lets the host user add, rename and delete files in it. It does not change who owns a file that a root process creates there.\n\nOn Docker Desktop (Windows or macOS), file ownership on bind mounts is handled by the file-sharing layer, so this step may have no visible effect there.",
          "places": [
            {
              "label": "mkdir and chown",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 18,
              "end": 21,
              "anchor": "chown"
            }
          ]
        },
        {
          "title": "The service writes its log as root",
          "summary": "orders.log created by root",
          "body": "`main` opens `orders.log` in that folder. Because `docker exec` runs as root by default, the file is created owned by root. So, going by the code, the log file itself is not editable by the host user on a native Linux bind mount, which is what the script's comment promises.",
          "why": "",
          "details": "The `LOG_DIR.mkdir(exist_ok=True)` call here makes the script's `mkdir` redundant, but harmless. The script would need to start the service as the host user, for example with `docker exec -u`, or change the owner of the files afterwards, for the comment to hold for the files themselves.",
          "places": [
            {
              "label": "Log setup in main",
              "path": "orders/main.py",
              "side": "target",
              "start": 9,
              "end": 12,
              "anchor": "logging.basicConfig"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "Where the debug port is decided",
      "question": "Can the debug port be changed in one place?",
      "purpose": "See that port 5678 is written in four places and that only two of them read each other.",
      "steps": [
        {
          "title": "Port in the task, launch configuration, script and compose file",
          "summary": "Four copies of 5678",
          "body": "The task's `DEBUG_PORT` reaches the script, but the attach configuration hard-codes 5678 and `compose.yaml` publishes only 5678. Changing `DEBUG_PORT` alone would make debugpy listen on a port that the editor never connects to and that the container does not publish.",
          "why": "",
          "details": "The container name is in the same situation. The task's `DEV_CONTAINER` must match `container_name` in `compose.yaml`, and the script's error message tells the user to start the `dev` service by name. The values agree today.",
          "places": [
            {
              "label": "Task env",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 8,
              "end": 8,
              "anchor": "\"DEBUG_PORT\": \"5678\""
            },
            {
              "label": "Script default",
              "path": "scripts/start-debugger.sh",
              "side": "target",
              "start": 5,
              "end": 6,
              "anchor": "PORT=\"${DEBUG_PORT:-5678}\""
            },
            {
              "label": "Attach target",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"port\": 5678"
            },
            {
              "label": "Published port",
              "path": "compose.yaml",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"5678:5678\""
            }
          ],
          "together": "The port only works when all four copies agree, which is easiest to see side by side."
        }
      ]
    }
  ]
}
```