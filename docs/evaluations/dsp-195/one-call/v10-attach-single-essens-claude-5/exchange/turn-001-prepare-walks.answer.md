```json
{
  "summary": "The VS Code debug configuration no longer starts the service as a local Python process. It now starts the service in a Docker container and attaches the debugger to it. A new VS Code task runs `docker compose up -d --build service`. A new Dockerfile builds a Python 3.12 image with debugpy and the `service` package. The new `compose.yaml` runs the service under a debugpy listener on port 5678 and publishes that port and the service's port 8080 to the host. The launch configuration then connects to `localhost:5678` and maps the local `service` folder to `/app/service` in the container.",
  "background": "The old configuration launched `service/main.py` as a script. `main.py` imports `service.server`, which needs the folder *above* `service` on the import path, and running the file as a script puts `service/` itself there instead. The new setup runs `python -m service.main` from `/app`, so the package import resolves.\n\nNo service code changes. Only the way it is started and debugged changes.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer starts debugging",
      "question": "When the developer presses F5 on the new configuration, how does the service come up in a container and how does the debugger reach it?",
      "purpose": "Follow the path from the launch configuration through the task, the image and compose, to the debugger attaching and matching files.",
      "steps": [
        {
          "title": "From launch to attach",
          "summary": "The configuration changes from starting a local process to attaching to a running one, after a task has run.",
          "body": "Before, VS Code started `service/main.py` itself in the integrated terminal. Now `request` is `attach`: **VS Code starts no Python process**. It expects one that is already listening for a debugger.\n\nThe `preLaunchTask` names the task that starts that process. VS Code runs the task first and starts the attach only when the task has finished. The task is shown in the next step.",
          "why": "Anyone who used \"Run the service\" for local runs without Docker loses that option. This file has no local launch configuration left.",
          "details": "",
          "places": [
            {
              "label": "Old local launch",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"launch\""
            },
            {
              "label": "New attach with a pre-launch task",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 8,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ],
          "together": "Seeing the old launch beside the new attach shows exactly what responsibility moved out of VS Code."
        },
        {
          "title": "The task builds and starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "The task's `label` must match the `preLaunchTask` string from the previous step exactly. Here it does.\n\n- `--build` rebuilds the image on every debug start. The code is copied into the image (see the Dockerfile step), so this is what puts local edits into the container.\n- `-d` detaches. The command returns once compose has started the container, not once the service inside is ready.\n\nThe task has no `isBackground` or problem matcher, so VS Code treats it as finished when the command exits.",
          "why": "The task can finish before debugpy in the container is listening on 5678. Whether the attach in the last steps reliably wins that race is not settled by this change.",
          "details": "",
          "places": [
            {
              "label": "Task definition",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
              "from": {
                "label": "preLaunchTask reference",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "The image: Python, debugpy and the copied package",
          "summary": "The Dockerfile installs debugpy and copies `service` to `/app/service`, with `/app` as the working folder.",
          "body": "Compose builds this file because of `build: .`. Two facts matter for later steps:\n\n- The code sits at `/app/service`, which is what the path mapping in a later step refers to.\n- `WORKDIR /app` makes `/app` the current folder, so `-m service.main` can import the `service` package.\n\nThe code is **copied, not mounted**. A change only reaches the container after a rebuild, which the task does on each start.",
          "why": "",
          "details": "Only debugpy is installed. The service needs only the standard library (`http.server`), so this is enough for the code here.",
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
          "title": "The container runs the service under a debugpy listener",
          "summary": "Compose starts `python -m debugpy --listen 0.0.0.0:5678 -m service.main`.",
          "body": "debugpy opens a debugger port on 5678 inside the container and then runs `service.main` as a module.\n\nThe command has no `--wait-for-client`, so **the service starts running immediately** and does not wait for VS Code. Breakpoints in startup code can be passed before the debugger attaches. Request-handling code is still reachable later.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Service definition and command",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Task starts the 'service' service",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "What the module run starts",
          "summary": "`service.main` calls `serve(port=8080)`, an HTTP server that runs until the container stops.",
          "body": "This code is unchanged. Running it with `-m` from `/app` is what makes `from service.server import serve` resolve.\n\n`serve` binds `0.0.0.0:8080` and runs `serve_forever`, so the process does not exit, and the debugger has a live process to attach to.",
          "why": "",
          "details": "`SimpleHTTPRequestHandler` serves files from the current folder. In the container that folder is `/app`, so the copied service source can be fetched over port 8080. This follows from unchanged code combined with the new working folder.",
          "places": [
            {
              "label": "main entry",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)"
            }
          ]
        },
        {
          "title": "Ports published to the host",
          "summary": "Ports 5678 (debugger) and 8080 (service) are published to the host.",
          "body": "Publishing 5678 lets VS Code on the host reach debugpy at `localhost:5678`. Publishing 8080 makes the service reachable as before.\n\nA short `\"5678:5678\"` mapping with no host address binds on all host interfaces, not only on `localhost`.",
          "why": "**A debugpy port can run arbitrary code in the process.** With this mapping, anyone who can reach the host on 5678 can do that. Binding as `127.0.0.1:5678:5678` would limit it to the host itself.",
          "details": "",
          "places": [
            {
              "label": "Port mappings",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"5678:5678\""
            }
          ]
        },
        {
          "title": "VS Code connects and matches files",
          "summary": "The attach goes to `localhost:5678`. Local `service/` is mapped to `/app/service`.",
          "body": "Once the task has finished, VS Code connects to the published debugger port from the previous step.\n\nThe container reports file paths under `/app/service`. `pathMappings` translates them to the workspace's `service` folder, so breakpoints set locally match container files and stack frames open the local files. The mapping matches the `COPY` target in the Dockerfile. If either side moves, breakpoints stop binding.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Connect and path mapping",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 12,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ]
        },
        {
          "title": "Stepping beyond the project's own code",
          "summary": "`justMyCode: false` lets the debugger step into library code.",
          "body": "With this setting the debugger also stops in and steps into code outside the project, such as `http.server` from the standard library, which runs every request.\n\nThose files exist only in the container and have no path mapping. VS Code therefore cannot open them from the workspace and has to show them from the debug session.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 13,
              "end": 13,
              "anchor": "\"justMyCode\": false"
            }
          ]
        }
      ]
    }
  ]
}
```