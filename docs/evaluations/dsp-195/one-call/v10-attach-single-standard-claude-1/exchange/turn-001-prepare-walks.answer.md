```json
{
  "summary": "The VS Code debug configuration stops running `service/main.py` as a local process and attaches to the service inside a Docker container instead. A new VS Code task runs `docker compose up -d --build service` before every debug session. A new `compose.yaml` starts the service under `debugpy`, which listens on port 5678, and publishes ports 5678 and 8080. A new `Dockerfile` builds a Python 3.12 image with `debugpy` installed and the `service` folder copied into `/app/service`. Python code does not change.",
  "background": "The service itself (`service/main.py` calling `serve(port=8080)` in `service/server.py`) is the same in both revisions. Only how a developer starts and debugs it changes.\n\nIn practice:\n- The code in the container is a **copy taken at image build time**. No volume is mounted. Edits only reach the container because the task passes `--build` on every F5.\n- The container is started detached and **keeps running after the debug session ends**. No `postDebugTask` stops it.\n- Debugging now needs Docker, but no longer needs a local Python environment with `debugpy`.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does starting the debug configuration get from VS Code to a debugger attached to the running service?",
      "purpose": "Follow the chain from the launch configuration through the task, compose and the image to the attach, and see where it can go wrong.",
      "steps": [
        {
          "title": "The launch configuration: from launch to attach",
          "summary": "The debug configuration now attaches to a debugger that is already listening, after running a task first.",
          "body": "This is where F5 starts. In the old version (From), VS Code started `service/main.py` itself as a local process (`request: launch`, `program`).\n\nIn the new version (To), `request: \"attach\"` means VS Code starts nothing. It connects to a `debugpy` server that is expected to be listening at `connect` (`localhost:5678`). Something else must start that server first. This is the job of `preLaunchTask`: VS Code runs the task whose **label** is exactly `\"Start the service container\"` and only connects once the task has finished.\n\nThe next steps follow that task. `pathMappings` and `justMyCode` matter once the debugger is connected; they come back in the last step.",
          "why": "",
          "details": "The old `launch` configuration ran `${workspaceFolder}/service/main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root, so `from service.server import serve` in `main` could only resolve if the workspace root was on the path in some other way (for example through `PYTHONPATH`). The new setup runs `-m service.main` from `/app` (see a later step), which avoids this question.",
          "places": [
            {
              "label": "Debug configuration, From and To",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 14,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "The pre-launch task runs docker compose",
          "summary": "A shell task builds the image and starts the `service` container in the background.",
          "body": "VS Code finds this task through its `label`, which must match `preLaunchTask` from the previous step character for character. It runs the command in a shell.\n\n`docker compose up -d --build service` does three things:\n1. `--build` rebuilds the image from the `Dockerfile`, so current source edits get into the container.\n2. If the image changed, it recreates the container. If not, it leaves an already running container as it is.\n3. `-d` (detached) makes the command return once the container has started, not when the service exits. A task without `-d` would never finish, and VS Code would never attach.\n\nThe task has no `problemMatcher` and is not marked `isBackground`. VS Code waits for the shell command to exit and then connects.",
          "why": "When `docker compose up -d` returns, the container has been started. That does not mean `debugpy` inside it is already listening on 5678. Nothing here waits for the port, so the attach can race the container's start. If the attach comes too early, the result is a connection error, and a second F5 normally succeeds.",
          "details": "Because the task does not use a `problemMatcher`, VS Code may ask once whether to scan the task output. This does not affect the run.\n\nNo matching `postDebugTask` exists. When the developer stops debugging, the container keeps running, and so does the service on port 8080. The next F5 reuses it or recreates it through `up --build`.",
          "places": [
            {
              "label": "The task VS Code runs before attaching",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
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
          "title": "The image: Python, debugpy and a copy of the code",
          "summary": "The Dockerfile installs debugpy and copies `service` into `/app/service`.",
          "body": "Compose builds this file because of `build: .` in `compose.yaml`, with the repository root as build context.\n\nThe image does three things:\n- It starts from `python:3.12-slim`.\n- It installs `debugpy`, the server side that VS Code's `debugpy` debug type talks to.\n- It copies only the `service` folder to `/app/service`. `WORKDIR /app` makes `/app` the working directory for the command in the next step.\n\nThe code is **baked into the image**. Nothing mounts the workspace into the container, so source edits only take effect through the `--build` in the task.",
          "why": "",
          "details": "`debugpy` is not pinned to a version. A rebuild can pick up a newer release than the one the VS Code Python debugger extension expects. Usually this works, but builds are not reproducible.\n\nNo `.dockerignore` exists, so the whole repository is sent as build context, including `.vscode` and any local virtual environments. Only `service` ends up in the image. The `COPY` layer, and the layers after it, are rebuilt whenever a file under `service` changes.",
          "places": [
            {
              "label": "Image definition",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "compose builds this file",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container command starts the service under debugpy",
          "summary": "debugpy listens on 0.0.0.0:5678 and then runs `service.main` as a module.",
          "body": "This is the process the container runs. `python -m debugpy --listen 0.0.0.0:5678` opens the debug server, then runs `-m service.main` in the same process.\n\nTwo details decide whether this works:\n- **Listening on `0.0.0.0`** inside the container is needed. With `localhost`, the port mapping could not reach it from the host.\n- **`-m service.main` from `/app`.** With `-m`, Python puts the current directory (`/app`, from `WORKDIR`) on `sys.path`. So `service` is found as a package (a namespace package, since the folder has no `__init__.py`), and `from service.server import serve` in `main` resolves.\n\nThe command has no `--wait-for-client`. The service does not wait for VS Code and starts serving at once.\n\n`ports` publishes 5678 for the debugger's `connect` and 8080 for the HTTP server.",
          "why": "Without `--wait-for-client`, breakpoints in code that runs during startup (module import, the start of `main`) are hit only if VS Code attaches before that code runs, which is unlikely. Breakpoints in request handling work, because that code runs later.\n\n`\"5678:5678\"` without a host address publishes the debug port on all host interfaces, not only on localhost. Anyone who can reach that port can attach a debugger and run code in the container. `\"127.0.0.1:5678:5678\"` would limit it to the developer's machine.",
          "details": "",
          "places": [
            {
              "label": "Service definition in compose",
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
          "summary": "`main` calls `serve(port=8080)`, which serves HTTP forever on all interfaces.",
          "body": "The module that `-m service.main` runs is unchanged. The `__name__ == \"__main__\"` guard is true when run with `-m`, so `main` runs and calls `serve(port=8080)`.\n\n`serve` binds a `ThreadingHTTPServer` to `0.0.0.0`, the container's interfaces, which the `8080:8080` mapping in the previous step needs. It then blocks in `serve_forever`. This is why the task must start the container with `-d`.\n\nThe server is a `ThreadingHTTPServer`, so each request runs on its own thread. `debugpy` debugs those threads too: a breakpoint in request handling stops the thread that handles that request.",
          "why": "",
          "details": "`SimpleHTTPRequestHandler` serves files from the process's working directory, which is now `/app` inside the container. In the container, that directory contains only `service/`. A local run served whatever directory it was started from.",
          "places": [
            {
              "label": "Entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 4,
              "end": 9,
              "anchor": "serve(port=8080)"
            },
            {
              "label": "HTTP server",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer((\"0.0.0.0\", port), handler)"
            }
          ],
          "together": "The entry point is short and only meaningful together with the blocking server it starts."
        },
        {
          "title": "Back in VS Code: connecting and mapping paths",
          "summary": "VS Code attaches to localhost:5678 and translates file paths between workspace and container.",
          "body": "Once the task has finished, VS Code connects to `localhost:5678`. The compose port mapping forwards that to `debugpy` in the container.\n\nThe debugger in the container knows the files as `/app/service/...`, while the editor knows them as `${workspaceFolder}/service/...`. `pathMappings` translates between the two. It **must match the `COPY service /app/service` target** in the `Dockerfile`. If one changes without the other, breakpoints stay unverified and stack frames cannot be opened in the editor.\n\n`justMyCode: false` lets the debugger stop in and step into library code too, for example `http.server` from the standard library. Those files exist only in the container. VS Code shows them as read-only remote sources rather than opening a local file.",
          "why": "The mapping only translates paths. It does not sync contents. If the developer edits a file and attaches to a container built from older source, breakpoint lines can point at code that differs from what runs. The `--build` in the task normally prevents this.",
          "details": "",
          "places": [
            {
              "label": "connect, pathMappings and justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 13,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ],
          "revisit": "The first step showed the switch to attach. Here the focus is on what happens after the task has finished: the connection and the path translation."
        }
      ]
    }
  ]
}
```