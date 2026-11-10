```json
{
  "summary": "The VS Code debug setup no longer starts `service/main.py` on the developer's machine. It now builds a Docker image, starts the service in a container under debugpy, and attaches the VS Code debugger to it over port 5678. A new task (`tasks.json`), a `Dockerfile` and a `compose.yaml` make that possible, and `launch.json` changes from a `launch` configuration to an `attach` configuration.",
  "background": "With the old configuration, VS Code's Python debugger started the program itself. With the new one, the program is started by something else (Docker Compose), and the debugger only connects to a debugpy server that is already running in the container. Two things come with that split. First, starting the container and connecting to it are separate steps, so timing matters. Second, the debugger needs to know how file paths in the container map to files in the workspace.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer starts debugging",
      "question": "What runs, and where, when the developer picks \"Attach to the service in the container\" and presses F5?",
      "purpose": "Follow the path from the VS Code launch configuration through the task, Compose and the image to the running service and the debugger connection.",
      "steps": [
        {
          "title": "The debug configuration now attaches instead of launching",
          "summary": "VS Code no longer starts the program. It runs a task first and then connects to a debug server.",
          "body": "This is the entry point: the configuration the developer picks in VS Code's Run and Debug view.\n\nOld configuration (`request: \"launch\"` with `program`): VS Code's debugpy extension started `service/main.py` itself, in the integrated terminal, on the host's Python.\n\nNew configuration (`request: \"attach\"`): VS Code starts no process. It does two things, in this order:\n1. It runs `preLaunchTask`, the task labelled \"Start the service container\" (next step).\n2. It connects to a debugpy server at the `connect` address (a later step).\n\nThe launch configuration is replaced, not added to. **Running the service locally under the debugger now needs Docker.**",
          "details": "One likely side benefit, read from the code rather than tested: the old way started `service/main.py` as a script. That puts `service/` itself first on `sys.path`, so `from service.server import serve` in `main.py` would only resolve if the workspace root were importable some other way. The new command, `-m service.main` run from `/app`, imports `service` as a package, which is how `main.py` is written.",
          "places": [
            {
              "label": "New attach configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 13,
              "anchor": "\"request\": \"attach\""
            },
            {
              "label": "Old launch configuration",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"launch\""
            }
          ],
          "together": "Seeing the old and the new configuration side by side shows that the setup moves from starting the program to connecting to it."
        },
        {
          "title": "The pre-launch task starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "VS Code finds this task by matching the `preLaunchTask` value against `label`, so the two strings must stay identical.\n\nThe command does three things:\n- `--build` rebuilds the image each time, so the image picks up the current source (the Dockerfile copies the code in, see a later step).\n- `-d` starts the container in the background, so the command returns and VS Code can move on to attaching.\n- `service` limits the command to the one service defined in `compose.yaml`.\n\n**Worth noticing:** the task has no `problemMatcher` and is not marked as a background task. VS Code therefore waits only until the command exits. `up -d` exits once the container has started, not once debugpy inside it is listening. If debugpy is not listening yet when VS Code attaches, the attach can fail on the first try.",
          "places": [
            {
              "label": "Task started by preLaunchTask",
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
          "title": "The image: Python, debugpy and a copy of the code",
          "summary": "The image installs debugpy and copies `service/` to `/app/service`.",
          "body": "`build: .` in `compose.yaml` points Compose at this `Dockerfile`.\n\nThe image does three things:\n- It installs debugpy, which the container command needs.\n- It sets `/app` as the working directory.\n- It **copies** the `service` folder to `/app/service`. It does not mount it.\n\nBecause the code is copied, the running container keeps the code from its last build. Edits reach the container only through a rebuild, which `--build` in the task triggers on every debug start. Edits made while a session is running are not picked up until the next start.\n\nThe path `/app/service` is the `remoteRoot` that `launch.json` maps back to the workspace (final step).",
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
          "title": "The container runs the service under debugpy",
          "summary": "Compose starts `python -m debugpy --listen 0.0.0.0:5678 -m service.main` and publishes ports 5678 and 8080.",
          "body": "This command is what makes attaching possible. debugpy opens a debug server on port 5678 and then runs the module `service.main` in the same process. The command runs from `/app`, so `service` resolves to the copied package.\n\n- Without `--wait-for-client`, debugpy does **not wait** for the debugger. The service starts at once, so breakpoints in code that runs before VS Code connects (imports, the top of `main`) are missed. Breakpoints in request handling still work, because the server keeps running.\n- `--listen 0.0.0.0` is needed inside the container, because the published port reaches the container from outside it, not on its loopback address.\n- `\"5678:5678\"` with no host address publishes the debug port on all host interfaces. A debugpy server lets whoever connects run code in the process, so **anyone who can reach port 5678 on the developer's machine can run code in the service**. Writing `\"127.0.0.1:5678:5678\"` would limit it to the local machine.",
          "places": [
            {
              "label": "Compose service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The service itself: an HTTP server on 8080",
          "summary": "`service.main` starts a threading HTTP server on port 8080. This code is unchanged.",
          "body": "`-m service.main` runs this module as `__main__`, so `main()` calls `serve(port=8080)`. `serve` binds `0.0.0.0:8080` and serves until the process stops.\n\nThe `\"8080:8080\"` entry in `compose.yaml` (previous step) exists for this server. It lets the developer send requests from the host to the service in the container, and those requests are what hit breakpoints once the debugger is attached.\n\n`ThreadingHTTPServer` handles each request on its own thread. debugpy follows those threads, so breakpoints inside request handling stop the thread handling that request.",
          "places": [
            {
              "label": "Entry module",
              "path": "service/main.py",
              "side": "target",
              "start": 4,
              "end": 9,
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
              "label": "HTTP server",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer"
            }
          ],
          "together": "The module that `-m` runs and the server it starts are two short functions, and they read best as one chain."
        },
        {
          "title": "VS Code connects and maps container paths to workspace files",
          "summary": "The debugger attaches to `localhost:5678` and translates `/app/service` paths to `${workspaceFolder}/service`.",
          "body": "Back in `launch.json`: after the task from the second step exits, VS Code connects to `localhost:5678`. That is the port Compose published from the container. This connection is where the startup race from the second step shows up.\n\nThe debugger and the running code see different file paths. Breakpoints are set on files under `${workspaceFolder}/service`, but the code runs from `/app/service`. `pathMappings` converts between the two, and it matches the `COPY` target in the Dockerfile. **If either path changes without the other, breakpoints no longer bind.**\n\n`justMyCode: false` lets the debugger step into library code, for example the standard library's `http.server`. Those files exist only in the container and are not covered by the mapping.",
          "details": "For files outside the mapping, such as the container's standard library, debugpy can send the source to VS Code, which shows it read-only. The local workspace cannot provide it. This is how debugpy usually behaves and was not checked in this repository.",
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
          "revisit": "The first step showed the overall shape of the configuration. This step looks at what the connection and the path mapping need from the container."
        }
      ]
    }
  ]
}
```