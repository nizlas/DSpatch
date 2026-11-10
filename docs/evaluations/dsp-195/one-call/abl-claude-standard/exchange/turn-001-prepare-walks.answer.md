```json
{
  "summary": "Pressing F5 in VS Code no longer runs `service/main.py` directly on the developer's machine. It now builds and starts the service in a Docker container, where it runs under debugpy, and attaches the VS Code debugger to it through port 5678. The change adds a `Dockerfile` and a `compose.yaml` that describe the container. It also adds a VS Code task that runs `docker compose up -d --build service`, and swaps the `launch` debug configuration for an `attach` configuration. That configuration first runs the task, then connects to the container and maps local source paths to the paths inside it.",
  "background": "The service itself (`service/main.py`, `service/server.py`) does not change. It is a stdlib `ThreadingHTTPServer` on port 8080 that uses `SimpleHTTPRequestHandler`. So the change is purely about how the developer runs and debugs it.\n\nThe change has two consequences a reviewer should weigh:\n\n- The container is started detached and nothing stops it again. It keeps running after the debug session ends.\n- The debug port is published on all host interfaces. Anyone who can reach that port can attach a debugger, and a debugger can run arbitrary code.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does starting the debug configuration get from VS Code to a debugger attached to the service in a container?",
      "purpose": "Follow the F5 path through the debug configuration, the task, Compose and the Dockerfile to the running service, and see where timing and lifetime matter.",
      "steps": [
        {
          "title": "The debug configuration switches from launch to attach",
          "summary": "VS Code no longer starts the program itself. It runs a task first and then connects to a debugger that is already listening.",
          "body": "This is the entry point: the developer picks this configuration and presses F5.\n\nIn From, `\"request\": \"launch\"` told the debugpy extension to start `service/main.py` itself, in the integrated terminal. In To, `\"request\": \"attach\"` means VS Code starts no process. It only connects a debug client to `connect.host`/`connect.port` (`localhost:5678`), where something else must already be listening.\n\nThat something is started by `preLaunchTask`. VS Code looks up a task with the label `\"Start the service container\"` and runs it **before** it tries to connect. The next step shows that task.\n\nThe removed `console` and `program` keys belong to launch mode. With attach, the service's output goes to the container's logs, not to a VS Code terminal.",
          "why": "Where the service runs, and who starts it, moves from VS Code to Docker.",
          "details": "Running `service/main.py` as a script (the From way) puts `service/` itself on `sys.path`, not the workspace root. The file then imports `from service.server import serve`, which needs the folder that contains `service/` to be importable. Whether From worked depended on the working directory or `PYTHONPATH`. The container runs `-m service.main` from `/app` instead, which fits that absolute import. That fit is a side effect of the change, not something the diff states as its goal.",
          "places": [
            {
              "label": "Debug configuration, From → To",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "The task starts the container detached",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "The label here matches the `preLaunchTask` from the previous step exactly. That matching label is the only link between the two files.\n\nWhat the command does:\n\n- `--build` rebuilds the image on every F5. As a later step shows, the source is copied into the image, so this rebuild is what puts local edits into the container.\n- `-d` starts the container in the background, so the command returns once Compose has started it.\n\nThe task is a plain `shell` task with no `isBackground` and no `problemMatcher`. VS Code therefore treats it as done when the command exits, and goes on to connect. **The command exits when the container has started, not when debugpy inside it is listening.** Python startup and `debugpy --listen` take a moment, so the attach can race against the listener. Whether it does depends on timing, not on anything the configuration guarantees.",
          "why": "A failed first attach right after a rebuild would come from this ordering, not from the configuration values.",
          "details": "Nothing stops the container again. There is no `postDebugTask` running `docker compose down`. The container, and with it the HTTP server and the open debug port, keeps running after the debug session ends. The next F5 runs `up -d --build` again, and Compose recreates the container if the image changed.",
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
          "title": "The image: Python, debugpy and a copy of the source",
          "summary": "Compose's `build: .` builds this Dockerfile.",
          "body": "Compose reaches this file through `build: .` in `compose.yaml` (shown as the source of this step). The image:\n\n1. starts from `python:3.12-slim`;\n2. sets `/app` as the working directory;\n3. installs `debugpy`, with no version pinned;\n4. copies the local `service` folder to `/app/service`.\n\nThe source is **copied at build time, not mounted**. The code running in the container is the code from the last build, which is why the task rebuilds on every F5.\n\nThere is no `CMD`. What runs is decided by `command` in `compose.yaml`, in the next step.",
          "why": "`/app/service` is the path the debugger's path mapping must match, as the second walk shows.",
          "details": "",
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
          "title": "The container command and its published ports",
          "summary": "debugpy listens on 5678 and runs `service.main` as a module. Ports 5678 and 8080 are published.",
          "body": "`python -m debugpy --listen 0.0.0.0:5678 -m service.main` starts debugpy, which opens a debug server on port 5678 and then runs the module `service.main`. The working directory is `/app` (from the Dockerfile), so `service` is found as a package there. `service/` has no `__init__.py`, so Python treats it as a namespace package.\n\nThe command has no `--wait-for-client`, so **the service starts at once and does not wait for VS Code**. Code that runs before the attach completes, such as the call into `serve`, is not paused, and breakpoints there can be missed. Request handling runs later, so breakpoints there can be hit.\n\nThe ports:\n\n- `\"5678:5678\"` lets VS Code's `localhost:5678` reach the debug server. Debugpy listens on `0.0.0.0` inside the container, which is needed for the port forwarding to work.\n- `\"8080:8080\"` exposes the HTTP server.\n\nBoth mappings have no host IP, so Docker binds them on all host interfaces. **The debug port is then reachable from the network, not only from localhost.** An attached debugger can run arbitrary code in the service. Writing `\"127.0.0.1:5678:5678\"` would limit it to localhost.",
          "why": "This is where the timing (no waiting for the client) and the exposure (open debug port) are decided.",
          "details": "",
          "places": [
            {
              "label": "service in compose.yaml",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "The service starts and blocks in serve_forever",
          "summary": "`main()` calls `serve(port=8080)`, which runs until the container stops.",
          "body": "Running `-m service.main` executes the `if __name__ == \"__main__\"` block, which calls `main()` and then `serve(port=8080)`. This code is unchanged, and port 8080 here is what the `8080:8080` mapping in the previous step publishes.\n\n`serve` binds `0.0.0.0`, which is needed for the published port to reach it from outside the container. `ThreadingHTTPServer` then handles each request in its own thread, and `serve_forever()` does not return. So the process, and debugpy with it, stays alive. That is what lets VS Code attach whenever it gets there.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "main entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 4,
              "end": 9,
              "anchor": "serve(port=8080)"
            },
            {
              "label": "serve",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "httpd.serve_forever()"
            }
          ],
          "together": "The call and the function it calls are two short files that read as one path."
        },
        {
          "title": "VS Code connects to the listener",
          "summary": "After the task, the debug client connects to localhost:5678.",
          "body": "Back in the debug configuration: once the task from the second step has exited, VS Code connects to `localhost:5678`. Through the port mapping, that reaches the debugpy server started by the container command.\n\nIf debugpy is not listening yet (the race described in the second step), the connection fails and the developer starts the session again. Once connected, the session lasts until the developer detaches. Detaching leaves the service running, because debugpy started it and not VS Code.",
          "why": "",
          "details": "",
          "revisit": "Now the `connect` part matters: where the client connects once the task has finished.",
          "places": [
            {
              "label": "connect",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }"
            }
          ]
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How a breakpoint in the editor reaches the code in the container",
      "question": "Why does a breakpoint set in the local `service/` files stop the process running in `/app/service`?",
      "purpose": "See how `pathMappings`, the Dockerfile's `COPY` and `justMyCode` together decide where breakpoints work.",
      "steps": [
        {
          "title": "Local paths are translated to container paths",
          "summary": "`pathMappings` maps `${workspaceFolder}/service` to `/app/service`.",
          "body": "The developer sets a breakpoint in a local file, for example `service/server.py`. The debugger inside the container only knows that code by its container path, `/app/service/server.py`. `pathMappings` tells the debugpy client how to translate between the two, in both directions:\n\n- breakpoints sent from VS Code are translated to container paths;\n- stack frames reported back are translated to local paths.\n\nThe mapping is only right if `remoteRoot` matches where the files really are in the container. The next step shows the line that decides that.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "pathMappings",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 10,
              "end": 12,
              "anchor": "\"remoteRoot\": \"/app/service\""
            }
          ]
        },
        {
          "title": "The COPY line has to agree with remoteRoot",
          "summary": "`COPY service /app/service` puts the files where `remoteRoot` expects them.",
          "body": "The mapping in the previous step is correct only because this line copies the local `service` folder to exactly `/app/service`. Nothing checks that the two stay in sync. If either changes alone, breakpoints silently stop binding.\n\nThe files in the container are copies from build time. A breakpoint set on a line edited after the last build would point at different code in the container. The `--build` in the F5 task (first walk, second step) prevents this when the session starts, but not for edits made during a session.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "COPY into /app/service",
              "path": "Dockerfile",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "justMyCode: false lets the debugger stop in library code",
          "summary": "Breakpoints and stepping are allowed in the standard library, not only in the service's own files.",
          "body": "By default, debugpy only stops in \"user code\" and skips the standard library and installed packages. This configuration turns that off.\n\nIn this service that matters: the request handling is `http.server.SimpleHTTPRequestHandler` from the standard library, as `serve` shows. The project's own code only sets the server up and then blocks in `serve_forever()`. To step into what happens on a request, the developer has to go into stdlib code. With `justMyCode: true` that would be skipped.\n\nA side effect: stepping and stopping on raised exceptions also go into library frames, which can make sessions noisier.",
          "why": "",
          "details": "Library code is not covered by `pathMappings`. Stdlib frames resolve to paths under the container's Python installation (from `python:3.12-slim`), not to local files. VS Code then gets the source from the debug adapter rather than from the workspace.",
          "places": [
            {
              "label": "justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 13,
              "end": 13,
              "anchor": "\"justMyCode\": false"
            },
            {
              "label": "The handler is stdlib code",
              "path": "service/server.py",
              "side": "target",
              "start": 5,
              "end": 5,
              "anchor": "SimpleHTTPRequestHandler"
            }
          ],
          "together": "The setting only makes sense next to the line showing that request handling is standard-library code."
        }
      ]
    }
  ]
}
```