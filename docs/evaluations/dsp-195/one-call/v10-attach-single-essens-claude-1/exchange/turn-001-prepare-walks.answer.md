```json
{
  "summary": "The VS Code debug configuration changes from running the service locally to attaching to it inside a Docker container. Pressing F5 first runs a new task that builds and starts the container with `docker compose`. In the container, the service runs under debugpy, which listens on port 5678. VS Code then connects to that port and maps the local `service` folder to `/app/service` in the container, so breakpoints set in local files apply to the code in the container. The change adds a `Dockerfile`, a `compose.yaml` and a `.vscode/tasks.json`, and replaces the old `launch` configuration.",
  "background": "Before this change, the only debug configuration started `service/main.py` directly in the local Python interpreter. That configuration is replaced, not kept beside the new one, so debugging now always needs Docker.\n\nThe service is a plain `ThreadingHTTPServer` on port 8080 (`service/server.py`). The change does not touch it. Only the way it is started and debugged changes.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer starts debugging",
      "question": "When the developer presses F5, how does VS Code end up attached to the service in the container?",
      "purpose": "Follow the chain from the debug configuration through the task, compose and the image to the running service and the debugger connection.",
      "steps": [
        {
          "title": "The debug configuration now attaches",
          "summary": "F5 now attaches to a running debugpy instead of starting the program locally.",
          "body": "The old configuration used `request: launch`, so VS Code started `service/main.py` itself. The new one uses `request: attach`, so VS Code starts nothing. It connects to a debugpy server that something else must already have started.\n\nThat something is `preLaunchTask`. Before attaching, VS Code runs the task named \"Start the service container\" (next step). Only after that task ends does VS Code try `localhost:5678`.",
          "why": "**Attaching depends on debugpy already listening when the task ends.** Later steps show why that is not guaranteed.",
          "details": "",
          "places": [
            {
              "label": "Debug configuration, launch → attach",
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
          "together": "These are the From and To of the same configuration, so the switch from launch to attach is easiest to see side by side."
        },
        {
          "title": "The task builds and starts the container",
          "summary": "The task runs `docker compose up -d --build service` in a shell.",
          "body": "The `label` must match the `preLaunchTask` name exactly. That is how the configuration from the previous step finds this task.\n\n- `--build` rebuilds the image on every F5. The code is copied into the image (shown in a later step), so this is how local edits reach the container.\n- `-d` makes the command return once the container has started, without waiting for the process inside it to be ready.\n\nThe task has no `isBackground` and no problem matcher. VS Code treats it as an ordinary task that is done when the shell command exits.",
          "why": "`-d` returns when the container is up, not when debugpy is listening. The attach that follows can therefore come before port 5678 accepts connections. Nothing in this configuration waits or retries.",
          "details": "Nothing stops the container again: there is no `postDebugTask`. When the debug session ends, the container keeps running and keeps ports 5678 and 8080 published. The next F5 rebuilds the image, and `compose up` recreates the container if the image changed.",
          "places": [
            {
              "label": "Start the service container task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service"
            }
          ]
        },
        {
          "title": "Compose builds the image from the Dockerfile",
          "summary": "The `service` service is built from the repository root.",
          "body": "`build: .` points compose at the repository root, so it uses the `Dockerfile` there. The image has three relevant parts:\n\n1. It starts from `python:3.12-slim`.\n2. It installs debugpy, the only extra package.\n3. It copies the local `service` folder to `/app/service`, with `/app` as the working directory.\n\nThe code is baked into the image, not mounted. The container always runs the code from the last build, which is why the task in the previous step passes `--build`.",
          "why": "",
          "details": "`service` has no `__init__.py`. It is still importable as `service` because `python -m` puts the working directory `/app` on `sys.path`, and Python 3 treats a folder without `__init__.py` as a namespace package. The `COPY` target and the `WORKDIR` together are what make `-m service.main` in the next step resolve.",
          "places": [
            {
              "label": "Image definition",
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
          "title": "The container runs the service under debugpy",
          "summary": "debugpy listens on 5678 and runs `service.main`. Both ports are published to the host.",
          "body": "`command` replaces the image's default command. debugpy opens a debug server on `0.0.0.0:5678` and then runs the module `service.main` right away.\n\nThere is no `--wait-for-client`, so the service does not wait for VS Code. It starts serving at once. Code that runs before the attach completes, such as startup in `main`, does not stop at breakpoints.\n\n`ports` publishes 5678 for the debugger and 8080 for the HTTP server. The short form `\"5678:5678\"` binds on all host interfaces, not only on localhost.",
          "why": "**The debug port is open to the network.** Anyone who can reach port 5678 on the host can attach debugpy, and debugpy lets a client run arbitrary code in the process. `\"127.0.0.1:5678:5678\"` would limit the port to the local machine.",
          "details": "",
          "places": [
            {
              "label": "Service command and published ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The service itself is unchanged",
          "summary": "`main` starts the HTTP server on port 8080, which compose publishes.",
          "body": "debugpy runs this module like `python -m service.main` would, so `main()` calls `serve(port=8080)`. That port matches the second published port in the previous step.\n\nThe server binds to `0.0.0.0`, which is needed for it to be reachable from outside the container. The change does not touch it.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Service entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)"
            }
          ]
        },
        {
          "title": "VS Code connects to the published debug port",
          "summary": "After the task ends, VS Code attaches to `localhost:5678`.",
          "body": "The container's port 5678 is published to the host, so `localhost:5678` reaches the debugpy server from the previous steps.\n\nIf the attach comes before debugpy listens (the risk named in the task step), it fails and the developer has to press F5 again. The container is then already running, so the second try normally finds debugpy ready.",
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
          "revisit": "The first step showed that this configuration attaches. Here we see where it connects, now that the container and its ports are known."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How local breakpoints reach the code in the container",
      "question": "How does a breakpoint set in a local file stop the code that runs in the container, and what happens outside the service's own code?",
      "purpose": "Understand how local and container paths are matched and what `justMyCode: false` changes.",
      "steps": [
        {
          "title": "Where the code lives in the container",
          "summary": "The local `service` folder becomes `/app/service` in the image.",
          "body": "This `COPY` decides the container path that the path mapping in the next step must name. If the target folder changes here, the mapping must change with it, or breakpoints stop binding.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Code copied into the image",
              "path": "Dockerfile",
              "side": "target",
              "start": 2,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "Path mapping and justMyCode",
          "summary": "Local `service/` maps to `/app/service`, and debugging is not limited to the service's own code.",
          "body": "`pathMappings` lets VS Code and debugpy translate file paths in both directions:\n\n- A breakpoint in a local file under `service/` is sent as the matching path under `/app/service`, so debugpy can set it in the copy from the previous step.\n- A frame that debugpy reports under `/app/service` opens the local file.\n\n`justMyCode: false` lets the debugger step into, and stop in, code outside the service as well, such as the standard library's `http.server`. Those files have no local mapping: they exist only in the container's Python.",
          "why": "**Breakpoints bind against the image built at the last F5, not against the editor's current text.** The mapping is correct only while the local file matches that copy. Edits made during a debug session are not in the container until the next rebuild.",
          "details": "For frames outside the mapped folder, VS Code cannot open a local file and normally asks debugpy for the source instead. You can read that code, but breakpoints set in it are not tied to anything in the workspace.",
          "places": [
            {
              "label": "Path mapping and justMyCode",
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