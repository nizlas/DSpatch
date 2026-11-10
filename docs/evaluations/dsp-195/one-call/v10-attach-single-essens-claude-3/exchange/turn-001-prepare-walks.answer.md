```json
{
  "summary": "The VS Code debug configuration stops starting the service as a local Python process. It now starts the service in a Docker container and attaches the debugger to it. A new pre-launch task runs `docker compose up -d --build service`. The new `compose.yaml` and `Dockerfile` build a Python 3.12 image with debugpy and the `service` package, and run the service under a debugpy listener on port 5678. The launch configuration then connects to that port and maps local source paths to the container paths.",
  "background": "Before this change, F5 ran `service/main.py` directly in VS Code's integrated terminal. With this change, the only debug configuration needs Docker, and the service runs from the copy of `service/` inside the image, not from the working tree.\n\nThe Python code under `service/` does not change. `serve` already binds to `0.0.0.0`, which is what lets the published container port 8080 reach it.",
  "walks": [
    {
      "kind": "walk",
      "title": "Pressing F5: from the launch configuration to a debugger attached in the container",
      "question": "What happens, in order, when the developer starts the debug configuration?",
      "purpose": "Follow the chain from the launch configuration through the task, Compose and the image to the running service and the debugger connection.",
      "steps": [
        {
          "title": "Launch becomes attach",
          "summary": "The configuration no longer starts a program; it runs a task first and then attaches.",
          "body": "In the old version, VS Code started `service/main.py` itself, so the debugger owned the process. In the new version, `request` is `attach`. VS Code starts nothing directly: **it runs `preLaunchTask` first and only then connects to a debugpy server that something else has started**.\n\nThis also removes the local way of running the service from the debugger. The only remaining configuration needs Docker.",
          "why": "",
          "details": "The old `launch` config ran `main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root, so `from service.server import serve` in `main` would not obviously resolve. The new setup runs the code as a module (`-m service.main`) from `/app`, so the package import works there (see the later step on the Compose `command`).",
          "places": [
            {
              "label": "Old launch configuration",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"launch\""
            },
            {
              "label": "New attach configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ],
          "together": "Seen side by side, the move from starting the program to attaching after a task is clear."
        },
        {
          "title": "The pre-launch task",
          "summary": "VS Code runs `docker compose up -d --build service` before attaching.",
          "body": "`preLaunchTask` refers to this task by its `label`. It is a plain shell task. VS Code waits for it to finish, and with `-d` Compose returns once the container has been started.\n\n`--build` rebuilds the image on every debug start. That matters because the code is copied into the image (see the Dockerfile step), so a rebuild is how local edits get into the container.\n\nNote what \"finished\" means here: the container process has started. **Nothing waits until debugpy is actually listening on 5678**, so the attach in a later step can reach the port before it is open.",
          "why": "",
          "details": "The task has no `problemMatcher` and no `isBackground`, so VS Code treats it as an ordinary task that must exit. When the debug session ends, nothing stops the container (there is no `postDebugTask`), and it keeps running. The next F5 runs `up -d` again. Compose recreates the container only if the image or the configuration changed.",
          "places": [
            {
              "label": "Task run before attaching",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
              "from": {
                "label": "preLaunchTask",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "The image Compose builds",
          "summary": "Python 3.12, debugpy, and a copy of `service/` under `/app`.",
          "body": "`build: .` in `compose.yaml` makes Compose build this Dockerfile from the repository root. The image installs debugpy and **copies** `service` to `/app/service`. Nothing is mounted. The container runs the code as it was at build time, which is why the task step's `--build` matters.\n\n`WORKDIR /app` is the directory the command in the next step runs from. It is what makes `service` importable as a package.",
          "why": "",
          "details": "Only `debugpy` is installed. The service itself uses only the standard library (`http.server`), so nothing else is needed today.",
          "places": [
            {
              "label": "Dockerfile",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "build: .",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container command and published ports",
          "summary": "debugpy listens on 5678 and then runs `service.main`; 5678 and 8080 are published.",
          "body": "The container starts Python with debugpy as a wrapper. debugpy opens its debug server on `0.0.0.0:5678` and **then runs `service.main` right away, without waiting for a debugger**, because there is no `--wait-for-client`. Code that runs before VS Code attaches, such as the start of `main`, runs without the debugger. Breakpoints only take effect after the attach.\n\nThe `ports` entries publish both the debug port and the service's HTTP port on the host. They are written without a host address, so Docker binds them on all host interfaces. **That makes the debugpy port reachable from the network, and anyone who connects to it can run code in the container.**",
          "why": "",
          "details": "If halting at startup is wanted, the usual option is `--wait-for-client`. To publish only locally, the usual form is `\"127.0.0.1:5678:5678\"`.",
          "places": [
            {
              "label": "Service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "What runs inside: the unchanged service",
          "summary": "`main` calls `serve(port=8080)`, which serves HTTP on all interfaces.",
          "body": "`-m service.main` runs this module, and `main` starts the HTTP server on port 8080. This code does not change. It is shown because the container setup relies on it: `serve` binds `0.0.0.0`, which the published `8080:8080` needs to reach the server from outside the container. Its port must also match the one Compose publishes.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Entry point run by debugpy",
              "path": "service/main.py",
              "side": "target",
              "start": 4,
              "end": 5,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "-m service.main",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            },
            {
              "label": "Server bound to all interfaces",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "(\"0.0.0.0\", port)"
            }
          ],
          "together": "The port passed in `main` and the address bound in `serve` together decide what the published 8080 reaches."
        },
        {
          "title": "VS Code connects to debugpy",
          "summary": "After the task, the debugger connects to localhost:5678.",
          "body": "Back in the launch configuration: once the task has finished, VS Code connects to `localhost:5678`. That is the host side of the port Compose published in the earlier step. If debugpy is not listening yet (see the race noted in the task step), the attach fails and the developer must start it again. The container keeps running either way.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Connection target",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }"
            }
          ],
          "revisit": "The first step showed this configuration for its task; now the connection it makes after the task."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How breakpoints in local files reach code in the container",
      "question": "Why does a breakpoint set in the editor stop the code running in the container?",
      "purpose": "See how `pathMappings` ties local files to the paths the image uses, and what `justMyCode` changes.",
      "steps": [
        {
          "title": "Where the code lives in the container",
          "summary": "The image puts the source at `/app/service`.",
          "body": "This path is defined by the `COPY` here. The debugger only knows the container's file paths, so the mapping in the next step has to name exactly this directory. If the destination of `COPY` ever changes, the mapping must change with it.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Copy destination",
              "path": "Dockerfile",
              "side": "target",
              "start": 2,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "Mapping local paths to container paths",
          "summary": "`${workspaceFolder}/service` corresponds to `/app/service`.",
          "body": "When the developer sets a breakpoint in `service/server.py` in the editor, VS Code converts the path with this mapping before sending it to debugpy, and converts the other way when execution stops. **The breakpoint only lines up if the container runs the same contents as the local file.** That holds right after `--build`. It no longer holds after an edit made while the session runs: debugpy still runs the old copy until the next build.\n\n`justMyCode: false` lets the debugger step into and stop in library code too, such as `http.server`. That code lives only in the container, and this mapping does not cover it.",
          "why": "",
          "details": "Library files stepped into are outside the mapped root. VS Code can show them only by fetching their source from debugpy, not from a local file.",
          "places": [
            {
              "label": "pathMappings and justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 10,
              "end": 13,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ]
        }
      ]
    }
  ]
}
```