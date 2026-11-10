```json
{
  "summary": "VS Code no longer starts the service as a local Python process. Pressing F5 now builds and starts the service in a Docker container (new Dockerfile and compose.yaml) through a pre-launch task, and then attaches the debugger to a debugpy server inside that container. The container runs the same `service.main` code on port 8080, and source paths are mapped so that breakpoints set in the local files apply to the copies in the container.",
  "background": "The service itself (`service/main.py`, `service/server.py`) is unchanged. It is a stdlib `ThreadingHTTPServer` on port 8080 and needs no dependencies, so the image only adds `debugpy`.\n\nThe compose setup is a development setup. The debug port is published like the service port, and debugpy accepts no authentication, so anyone who can reach the port can run code in the container.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does a debug session now reach the service, from the launch configuration to a breakpoint in the container?",
      "purpose": "Follow the new debug path through the launch configuration, the task, the image, the container command and the attach settings.",
      "steps": [
        {
          "title": "The launch configuration now attaches, after a task",
          "summary": "F5 picks an attach configuration that first runs the task \"Start the service container\".",
          "body": "The only configuration has changed from `launch` to `attach`. VS Code no longer starts any Python process itself. It expects a debugpy server that is already listening, and `connect` in a later step says where.\n\nBefore attaching, VS Code runs `preLaunchTask`. This task is what brings that server up. The name has to match a task `label` exactly, which is the link to the next step.",
          "why": "If the task fails, for example because Docker is not running, VS Code reports the task error instead of starting the debug session.",
          "places": [
            {
              "label": "Attach configuration with pre-launch task",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ]
        },
        {
          "title": "The task builds and starts the container",
          "summary": "`docker compose up -d --build service` builds the image and starts the container in the background.",
          "body": "VS Code finds this task by its label from `preLaunchTask` in the previous step and runs it as a shell command.\n\n- `--build` rebuilds the image on every F5. The source is copied into the image (next step), so this is what gets the current local code into the container.\n- `-d` runs detached. The command returns once compose has started the container, not when the service is ready. The task has no problem matcher and is not a background task, so VS Code continues to the attach as soon as the command exits.",
          "why": "Nothing waits for debugpy to be listening on port 5678. The code allows a race where the attach comes too early and fails, so a second F5 may be needed.",
          "details": "There is no `postDebugTask`. When the debug session ends, the debugger only disconnects and the container keeps running, with the service still serving on 8080. On the next F5, compose recreates the container only if the image or configuration changed. Otherwise it leaves the running container as it is.",
          "places": [
            {
              "label": "The task \"Start the service container\"",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
              "from": {
                "label": "preLaunchTask refers to this label",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "The image: Python, debugpy and a copy of the code",
          "summary": "The Dockerfile installs debugpy and copies `service` to `/app/service`.",
          "body": "compose builds this file because of `build: .` in compose.yaml. The image adds only `debugpy`, because the service uses nothing outside the standard library.\n\nTwo details here matter for later steps:\n\n- `WORKDIR /app` is the working directory the container command runs in. It is what lets `-m service.main` find the `service` package.\n- `COPY service /app/service` sets the remote path. The `pathMappings` in a later step must point at `/app/service` exactly.\n\nThe code is **copied, not mounted**. Edits to local files reach the container only through a rebuild, which the task in the previous step does on each F5.",
          "places": [
            {
              "label": "Dockerfile",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "debugpy wraps the service at container start",
          "summary": "The container starts `service.main` under a debugpy server that listens on 5678.",
          "body": "This command replaces the image's default command. debugpy opens a debug server on `0.0.0.0:5678`. Binding to all interfaces is needed so the published port can reach it from outside the container. debugpy then runs `service.main` as a module, the way `python -m` would.\n\nThe command has no `--wait-for-client`. **The service starts right away, without waiting for the debugger.** Breakpoints in code that runs before VS Code attaches, such as startup in `main()`, can be passed before the debugger is connected. Breakpoints in request handling can still hit, because that code runs for each request.",
          "places": [
            {
              "label": "Container command",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The unchanged service runs as a module",
          "summary": "`service.main` runs as `__main__` and starts the HTTP server on port 8080.",
          "body": "With `-m`, Python runs the module under the name `__main__`, so the existing `if __name__ == \"__main__\"` guard calls `main()`, and `main()` calls `serve(port=8080)`.\n\nThe import `from service.server import serve` works because the working directory `/app` is on the import path when a module is run with `-m`. `service` has no `__init__.py`, and Python 3 imports it as a namespace package.",
          "details": "`serve` binds `ThreadingHTTPServer` to `0.0.0.0`, so it accepts connections from outside the container. That is what lets the published port 8080 in the next step work. `SimpleHTTPRequestHandler` serves files from the process's working directory, which in the container is `/app`.",
          "places": [
            {
              "label": "Entry point of the service (unchanged)",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "debugpy runs it with -m service.main",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Published ports: debugger and service",
          "summary": "Ports 5678 (debugpy) and 8080 (HTTP) are mapped to the same ports on the host.",
          "body": "Port 5678 is what the attach in the next step connects to. Port 8080 keeps the service reachable from the host the way it was when it ran locally.\n\nA short `\"host:container\"` mapping publishes on all host interfaces, not only on localhost. **The debug port can be reached from the network**, and a debugpy connection can run arbitrary code in the container. Binding to localhost only (`\"127.0.0.1:5678:5678\"`) would limit that, but this change does not do it.",
          "places": [
            {
              "label": "Port mappings",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "- \"5678:5678\""
            }
          ]
        },
        {
          "title": "Attaching, and mapping local files to the container",
          "summary": "VS Code connects to localhost:5678 and maps local `service/` to `/app/service`.",
          "body": "Once the task has finished, VS Code connects to `localhost:5678`. That port leads to the debugpy server through the mapping in the previous step.\n\n`pathMappings` is needed because debugpy reports file paths as the container sees them (`/app/service/...`), while the breakpoints are set on `${workspaceFolder}/service/...`. Without the mapping, breakpoints would not bind and stepping would not open the local files. The remote side must match the `COPY` target in the Dockerfile.\n\n`justMyCode: false` lets the debugger step into and stop in library code too, such as `http.server`, where this service does most of its work.",
          "why": "The mapping is correct only while local files and the image are in sync. That holds because each F5 rebuilds.",
          "places": [
            {
              "label": "Connect, path mapping and justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 13,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "The removed local run",
      "question": "What did the old configuration do, and what is no longer available?",
      "purpose": "See which local debug path the change replaces.",
      "steps": [
        {
          "title": "The old launch configuration",
          "summary": "VS Code used to start `service/main.py` itself in the integrated terminal.",
          "body": "Before the change, F5 ran `service/main.py` locally as a script, using the selected Python interpreter, and attached to it from the start. Code at startup was therefore always under the debugger. The new setup does not guarantee that, as the step on the container command shows.\n\nThere was a catch in this path. A file run as a script gets its own folder (`service/`) on the import path, not the workspace folder. The `from service.server import serve` in `main.py` then works only if the workspace root is on the path some other way. The new `-m service.main` from `/app` avoids that.\n\nThe change replaces this configuration and does not add a local alternative. Debugging from VS Code now always requires Docker.",
          "places": [
            {
              "label": "Old configuration: launch the script",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"program\": \"${workspaceFolder}/service/main.py\""
            }
          ]
        }
      ]
    }
  ]
}
```