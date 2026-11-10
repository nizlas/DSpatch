```json
{
  "summary": "Debugging the service now runs it in a Docker container instead of starting it locally. The VS Code debug configuration changes from launching `service/main.py` to attaching to a debugpy server inside a container. A new pre-launch task builds and starts that container with Docker Compose. A new Dockerfile and compose.yaml define the image, the debugpy-wrapped start command and the published ports (5678 for the debugger, 8080 for the HTTP service). The service code is unchanged.",
  "background": "Before this change, pressing F5 ran `service/main.py` as a script in VS Code's terminal. Running it that way puts `service/` on `sys.path`, not the repository root, so the module's own `from service.server import serve` depends on how Python's path is set up. The container runs the code as a module (`-m service.main`) from `/app`, where the `service` package can be imported.\n\nThe code is copied into the image, not mounted. So every debug start rebuilds the image to pick up edits, and the container keeps running after the debug session ends.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does starting the debugger now get the service running in a container and connect VS Code to it?",
      "purpose": "Follow the path from the debug configuration through the task, the Compose service and the image to the attached debugger, and note where the steps can fail to line up.",
      "steps": [
        {
          "title": "The debug configuration now attaches",
          "summary": "F5 no longer starts Python locally. It attaches to a debugpy server and runs a task first.",
          "body": "The old configuration had VS Code start `service/main.py` itself. The new one uses `request: attach`: VS Code starts no process. It connects to a debugpy server that is already listening on `localhost:5678`.\n\nThe server has to come from somewhere, so `preLaunchTask` names a task that VS Code runs before it tries to connect. The next steps follow that task. A later step comes back to `connect` and `pathMappings`.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Debug configuration, launch → attach",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "The pre-launch task starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "VS Code finds this task by its `label`, which must match the `preLaunchTask` string exactly. The command builds the image and starts the `service` container.\n\n**`-d` (detached) makes the command return as soon as the container has started.** That is before the Python process inside has opened port 5678. VS Code then attempts the attach right away. If debugpy is not yet listening, the first attach can fail and the developer has to press F5 again. Nothing in the task waits for the port to be ready.",
          "why": "`--build` rebuilds the image on every debug start. That is the only way local edits reach the container, because the code is copied into the image (see the Dockerfile step).",
          "details": "The task has no `problemMatcher` and no `isBackground` setting, so VS Code treats it as an ordinary task that finishes when the shell command exits. That is correct for a detached `up`. It does mean that the container's own output does not show up in the task terminal; it is only available through `docker compose logs`.",
          "places": [
            {
              "label": "Task that builds and starts the container",
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
          "title": "The image holds Python, debugpy and a copy of the code",
          "summary": "The Dockerfile builds from the repository root, installs debugpy and copies `service` to `/app/service`.",
          "body": "Compose builds this file because of `build: .` in compose.yaml (shown in the next step).\n\nThe image installs debugpy and copies the source to `/app/service`, with `/app` as the working directory. Two things depend on these paths:\n\n- `python -m service.main` (next step) can import the `service` package because it runs from `/app`.\n- `/app/service` is the `remoteRoot` the debugger maps local files to (a later step).\n\nThe code is a copy taken when the image is built. Edits made while the container runs are not seen until the next build.",
          "why": "",
          "details": "`service/` has no `__init__.py`. Python 3 still imports it as a namespace package, so `service.main` and `service.server` resolve. The debugpy version is not pinned, so a rebuild can pick up a newer debugpy.",
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
          "title": "Compose runs the service under debugpy and publishes the ports",
          "summary": "The container starts `service.main` wrapped in a debugpy server on port 5678 and publishes 5678 and 8080.",
          "body": "This is what the task's `up` starts. `python -m debugpy --listen 0.0.0.0:5678 -m service.main` opens the debug server and then runs the service module right away.\n\nThere is **no `--wait-for-client`**, so the service does not wait for VS Code. The service starts running before the attach. Breakpoints in startup code can therefore be passed before the debugger connects; in practice, only code that runs later (request handling) can be stopped at reliably.\n\nThe ports are published as `\"5678:5678\"` with no host address, so Docker binds them on all of the host's network interfaces. That includes the debug port. A debugpy server lets any client that connects run code in the process. So the published debug port is reachable from the network unless a host firewall blocks it. Binding it to `127.0.0.1:5678:5678` would limit it to the local machine.",
          "why": "As written, anyone who can reach the developer's machine on port 5678 can run code in the container.",
          "details": "Port 8080 is the service's own HTTP port (next step). Both ports have to match their counterparts: 5678 must match `connect.port` in launch.json, and 8080 must match the port `main()` passes to `serve`.",
          "places": [
            {
              "label": "Compose service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "--listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The service itself is unchanged",
          "summary": "`main()` serves HTTP on port 8080 with a standard file server.",
          "body": "This code is reached through `-m service.main` from the previous step. It is unchanged, but it now runs in a different place.\n\n`serve` uses `SimpleHTTPRequestHandler`, which serves files from the current directory. In the container that directory is `/app`, so the service now serves the copied source tree under `/app` on port 8080. Before, it served whatever directory the VS Code terminal was in.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)"
            },
            {
              "label": "HTTP server",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "SimpleHTTPRequestHandler"
            }
          ],
          "together": "The entry point only passes the port on; the server next to it shows what is actually served from the working directory."
        },
        {
          "title": "VS Code attaches and maps the file paths",
          "summary": "VS Code connects to localhost:5678 and treats local `service/` as the same files as `/app/service` in the container.",
          "body": "When the task has finished, VS Code connects to the debug port that compose.yaml published.\n\n`pathMappings` makes breakpoints work across the container boundary. A breakpoint set in `${workspaceFolder}/service/...` is sent to debugpy as `/app/service/...`, and stack frames from the container open the local files. The mapping matches the Dockerfile's `COPY service /app/service`. If either path changes, breakpoints silently stop binding.\n\n`justMyCode: false` also lets the debugger step into library code, such as `http.server`.",
          "why": "",
          "details": "If the local file has been edited since the last build, the line numbers the debugger shows refer to the copy in the image, not to the editor contents. Detaching does not stop the container. Because debugpy keeps listening, a second F5 rebuilds the image and recreates the container if anything changed. Otherwise it simply reattaches.",
          "revisit": "Step 1 showed only the switch to attach; here the connection target and the path mapping are what matter.",
          "places": [
            {
              "label": "Connection and path mapping",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
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