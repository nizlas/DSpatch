```json
{
  "summary": "The VS Code debug configuration no longer starts the service as a local Python process. It now starts the service in a Docker container and attaches the debugger to it. A new VS Code task runs `docker compose up -d --build service`. The new `compose.yaml` and `Dockerfile` build an image with the service code and debugpy, then run the service under a debugpy listener on port 5678. The launch configuration connects to that port and maps the local `service` folder to `/app/service` inside the container. The service code itself does not change.",
  "background": "Before this change, F5 ran `service/main.py` directly in VS Code's integrated terminal. After it, F5 always goes through Docker: the image is rebuilt, the container is started in the background, and the debugger attaches over the network.\n\nNothing in the change stops the container when debugging ends. It keeps running until someone stops it with Docker.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does starting the debugger now get from VS Code to a running, debuggable service in a container?",
      "purpose": "Follow the path from the launch configuration through the task, the image and the container command to the debugger connection.",
      "steps": [
        {
          "title": "The debug configuration switches from launch to attach",
          "summary": "VS Code no longer starts the Python process. It runs a task first and then connects to a debugger that is already listening.",
          "body": "Before, `request: launch` with `program` meant VS Code started `service/main.py` itself, and the debugger was there from the first line.\n\nNow `request: attach` means VS Code starts nothing in Python. It runs the `preLaunchTask` and then connects to `localhost:5678`. The service is only debuggable if something else has already started it **with a debugpy listener on that port**. The following steps show what does that.",
          "why": "",
          "details": "There is a small difference in how the module is loaded. Run as a `program`, the script directory `service/` comes first on `sys.path`, so `from service.server import serve` in `main.py` depends on how the workspace root reaches the path. In the container the service runs as `-m service.main` from `/app` (see the compose step), so the `service` package import resolves from the working directory.",
          "places": [
            {
              "label": "Old configuration: launch main.py locally",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 4,
              "end": 10,
              "anchor": "\"request\": \"launch\""
            },
            {
              "label": "New configuration: attach after a pre-launch task",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 14,
              "anchor": "\"request\": \"attach\""
            }
          ],
          "together": "Seeing the old and new configuration side by side shows that the debugger stops starting the process and starts joining one."
        },
        {
          "title": "The pre-launch task brings the container up",
          "summary": "The task runs `docker compose up -d --build service` in a shell.",
          "body": "VS Code finds this task through the `label` named in `preLaunchTask`. It runs the task and starts attaching once the task finishes.\n\nBecause of `-d`, the command returns as soon as Compose has started the container. It does not wait for the service, or for debugpy, to be ready. **Nothing waits for port 5678 to accept connections**, so the attach can race the container's Python start-up. Whether that is a problem in practice depends on timing that this change does not control.\n\n`--build` rebuilds the image on every F5. That keeps the code in the container in step with local edits (see the walk on breakpoints), but every debug start pays for a build.",
          "why": "",
          "details": "The task defines no `problemMatcher` and no `isBackground`. VS Code therefore treats it as an ordinary task that ends when the shell command exits.",
          "places": [
            {
              "label": "Task started before the debugger attaches",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "docker compose up -d --build service",
              "from": {
                "label": "preLaunchTask names this task",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "The image: Python, debugpy and a copy of the service",
          "summary": "Compose builds this Dockerfile, which installs debugpy and copies the service code into `/app/service`.",
          "body": "`build: .` in `compose.yaml` points Compose at this Dockerfile. The image provides three things the rest of the path depends on:\n\n- **debugpy installed**, so the container command can start the listener.\n- **`WORKDIR /app`**, so `-m service.main` finds the `service` package.\n- **A copy of `service` at `/app/service`.** This is the path that `pathMappings` refers to later.\n\nThe Dockerfile has no `CMD`. What runs is decided entirely by `command` in `compose.yaml`, shown in the next step.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Image definition",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "RUN pip install --no-cache-dir debugpy",
              "from": {
                "label": "build: . selects this Dockerfile",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container runs the service under a debugpy listener",
          "summary": "The service starts immediately under debugpy, and Compose publishes the debug port and the HTTP port.",
          "body": "`python -m debugpy --listen 0.0.0.0:5678 -m service.main` opens the debug listener and then runs `service.main` right away. There is no `--wait-for-client`, so **the service does not wait for the debugger**. Code that runs before the attach, such as module import and server start-up, cannot be stopped at a breakpoint.\n\n`ports` publishes 5678 for the debugger and 8080 for the HTTP server on the host. A mapping written as `\"5678:5678\"` binds to all host interfaces by default, not only `localhost`. A debugpy connection can run arbitrary code in the process, so **anyone who can reach the machine on 5678 can control the service**.",
          "why": "Port 5678 is published to the network, not only to this machine, and debugpy accepts any client that connects. Publishing it as `127.0.0.1:5678:5678` would limit access to this machine.",
          "details": "",
          "places": [
            {
              "label": "Service definition: command and published ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The unchanged service listens on all interfaces",
          "summary": "`main` calls `serve(port=8080)`, which binds the HTTP server to `0.0.0.0`.",
          "body": "This code does not change, but the container setup depends on it. `-m service.main` runs `main()`, which calls `serve` with port 8080. The server binds to `0.0.0.0`, which is what makes the published `8080:8080` mapping reach it from outside the container. A server bound only to `127.0.0.1` inside the container could not be reached through the mapping.",
          "why": "",
          "details": "`SimpleHTTPRequestHandler` serves files from the current directory. In the container that directory is `/app`, so the HTTP endpoint lists and serves the copied service source. Locally it served whatever directory the process was started from.",
          "places": [
            {
              "label": "HTTP server bound to 0.0.0.0",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer((\"0.0.0.0\", port), handler)",
              "from": {
                "label": "main() starts the server on 8080",
                "path": "service/main.py",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "VS Code connects to the published debug port",
          "summary": "After the task, the debugger connects to `localhost:5678`, which Compose forwards into the container.",
          "body": "With the container running, VS Code's attach goes to `localhost:5678`. The `5678:5678` mapping from the compose step carries it to the debugpy listener inside the container. From then on, breakpoints apply to code that runs after the attach, such as request handling.\n\nIf the listener is not up yet, the attach fails. Nothing here retries or waits.\n\nWhen the debug session ends, nothing stops the container. The task has no counterpart (`postDebugTask`), so the service keeps running in the background.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Attach target",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }"
            }
          ],
          "revisit": "Step 1 showed the whole configuration. Here the focus is the `connect` target and what is listening behind it."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How breakpoints in local files match code in the container",
      "question": "When the developer sets a breakpoint in `service/server.py` locally, how does it reach the code running in the container?",
      "purpose": "Understand the path mapping, why it matches the image, and where it stops holding.",
      "steps": [
        {
          "title": "The container runs a copy, not the workspace files",
          "summary": "`COPY service /app/service` copies the code into the image at build time.",
          "body": "The running code is a copy taken at image build time. The workspace is not mounted. A local edit reaches the container only when the image is rebuilt. That happens on the next F5 because the task passes `--build` (see the task step in the first walk).\n\nWhile a session runs, the local file and the code in the container can drift apart. Breakpoints and line numbers then refer to the old copy.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Service code copied into the image",
              "path": "Dockerfile",
              "side": "target",
              "start": 2,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "pathMappings ties the local folder to the container path",
          "summary": "VS Code translates `${workspaceFolder}/service` to `/app/service` and back.",
          "body": "debugpy in the container reports file paths such as `/app/service/server.py`. VS Code sets breakpoints by local path. The mapping translates between the two in both directions.\n\nThe mapping is correct only because `remoteRoot` matches the `COPY` destination and `WORKDIR` in the previous step. **The two must change together.** If one of them moves, breakpoints silently stop binding.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Local to remote path mapping",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 10,
              "end": 12,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ]
        },
        {
          "title": "justMyCode is turned off",
          "summary": "The debugger also steps into and stops in library code.",
          "body": "With `justMyCode: false`, debugpy no longer limits stepping and exception stops to the user's own code. A developer can step into the standard library, for example `http.server`, which does the actual request handling here.\n\nThose library files exist only inside the container and fall outside `pathMappings`. Whether VS Code can show their source then depends on the debugger fetching it from the remote process. That cannot be determined from this configuration alone.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Library code included in debugging",
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