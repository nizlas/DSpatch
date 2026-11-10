```json
{
  "summary": "The VS Code debug configuration no longer starts the service as a local Python process. It now runs the service in a Docker container under debugpy, and VS Code attaches to it. A new VS Code task builds and starts the container through Docker Compose before every debug session. A new Dockerfile and compose.yaml define the image and how the service starts in the container. The service code itself is unchanged.",
  "background": "Before this change, F5 ran `service/main.py` directly on the developer's machine in the integrated terminal. After it, the only debug configuration needs Docker. No configuration for running the service locally is left.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does starting the debug configuration lead to a debugger attached to the service running in a container?",
      "purpose": "Follow the path from the launch configuration through the task, the image and the container start-up to the attach, and see where the parts must agree.",
      "steps": [
        {
          "title": "The debug configuration switches from launch to attach",
          "summary": "VS Code no longer starts the service itself. It connects to a service that already runs.",
          "body": "In the old configuration, the debugpy extension started `service/main.py` as a local process (`request: launch`, `program`, `console`). In the new one, `request` is `attach`: VS Code starts nothing itself. It expects a debugpy server to be listening already, and `preLaunchTask` names the task that is meant to make that true.\n\nThis was the only configuration, so **no way to debug the service locally without Docker remains**.",
          "details": "The old local launch ran `main.py` as a script. Python then puts `service/` on `sys.path`, not the workspace root. So `from service.server import serve` in `main.py` resolved only if the workspace root reached the path some other way, for example through `PYTHONPATH`. The new container command (a later step) runs `-m service.main` from `/app`, where the package import works by Python's rules.",
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
              "end": 8,
              "anchor": "\"request\": \"attach\""
            }
          ],
          "together": "Comparing the old and new entry shows that the debugger's role changes from starting the process to joining it."
        },
        {
          "title": "The pre-launch task builds and starts the container",
          "summary": "Before attaching, VS Code runs `docker compose up -d --build service`.",
          "body": "VS Code finds this task by its label, which must match `preLaunchTask` in the launch configuration exactly. The task is a plain shell command with no problem matcher and no background settings. VS Code therefore waits for the command to exit before it attaches.\n\nBecause of `-d`, Compose exits once the container is started, **not once debugpy inside it is listening**. The attach in a later step can therefore come very early. Whether it then fails or succeeds depends on how fast the container starts and on how the debugpy client handles a refused connection; this code does not establish either.\n\n`--build` rebuilds the image on every F5. As the next steps show, the code is copied into the image, so this rebuild is what puts current edits into the container. If the image changed, Compose recreates the running container.",
          "places": [
            {
              "label": "Start the service container task",
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
          "summary": "Compose builds this Dockerfile, which installs debugpy and copies `service/` to `/app/service`.",
          "body": "Compose builds this file because of `build: .` in compose.yaml. The image has no `CMD` of its own; the start command comes from compose.yaml (next step). Started without Compose, the image would run the base image's default command, not the service.\n\nThe code is copied in with `COPY`, not mounted. **The container runs whatever code existed at the last build**, which is why the task rebuilds every time.\n\nTwo paths matter in later steps:\n- `WORKDIR /app` lets `-m service.main` find the `service` package.\n- `/app/service` is the remote side of the path mapping.",
          "details": "`debugpy` is installed without a pinned version. Each rebuild that is not served from the cache can pick up a newer release.",
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
          "title": "The container starts the service under debugpy",
          "summary": "debugpy listens on port 5678 and then runs `service.main` as a module.",
          "body": "`python -m debugpy --listen 0.0.0.0:5678` starts a debug server and then runs the target module in the same process. Listening on `0.0.0.0` is needed because the connection comes from outside the container, through the published port.\n\nThe command has no `--wait-for-client`, so **the service starts running immediately, before any debugger is attached**. Breakpoints in start-up code, such as `main()` before `serve()`, are probably passed before VS Code connects. Breakpoints in code that runs while handling a request take effect once VS Code is attached.",
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
          "title": "The unchanged service serves HTTP on port 8080",
          "summary": "`main()` calls `serve(port=8080)`, which blocks in `serve_forever()`.",
          "body": "This is the module that the `-m service.main` command in the previous step runs. It is unchanged. Two facts in it matter for the container:\n- The absolute import `from service.server import serve` works because the module runs with `-m` from `/app`.\n- The port 8080 is fixed in code, and the server binds `0.0.0.0`, so it is reachable through the published port in the next step.",
          "places": [
            {
              "label": "Service entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "-m service.main",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Ports published to the host",
          "summary": "Port 5678 (debugger) and 8080 (HTTP) are mapped to the same ports on the host.",
          "body": "The 8080 mapping must agree with the port hard-coded in `main()`. The 5678 mapping must agree with both `--listen` in the command and `connect.port` in the launch configuration.\n\nA mapping in the short `\"5678:5678\"` form, without a host address, publishes on all of the host's network interfaces by default. **The debugpy port then accepts connections from the network, and a connected debugger can run arbitrary code in the service.** Binding it to the local machine only would need `\"127.0.0.1:5678:5678\"`.",
          "places": [
            {
              "label": "Published ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"5678:5678\""
            }
          ]
        },
        {
          "title": "VS Code attaches and maps the file paths",
          "summary": "VS Code connects to localhost:5678 and translates between `service/` locally and `/app/service` in the container.",
          "body": "Once the task has exited, VS Code connects to `localhost:5678`, which reaches the container's debugpy through the published port from the previous step.\n\nThe debugger reports file paths as they are inside the container. `pathMappings` translates them, so that a breakpoint set in the local `service/server.py` matches `/app/service/server.py`. The remote root must match the `COPY` destination in the Dockerfile. If the two drift apart, breakpoints are never hit, and VS Code shows no error for it.\n\n`justMyCode: false` lets the debugger stop in, and step into, library code such as `http.server`. Those files exist only in the container and have no local mapping.",
          "details": "There is no `postDebugTask`. When the debug session ends, VS Code only disconnects; the container keeps running with the service and its open ports until someone stops it, for example with `docker compose down`.",
          "places": [
            {
              "label": "connect, pathMappings, justMyCode",
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