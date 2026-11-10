```json
{
  "summary": "The VS Code debug configuration no longer starts the service as a local Python process. It now starts the service in a Docker container and attaches the debugger to it. Pressing F5 runs a new task, `docker compose up -d --build service`. That task builds an image from the new `Dockerfile`, which contains Python 3.12, debugpy and a copy of `service/`. `compose.yaml` then starts the service under a debugpy listener on port 5678. VS Code connects to `localhost:5678` and maps the local `service/` folder onto `/app/service` in the container, so breakpoints set in the editor land on the container's code.",
  "background": "The base configuration launched `service/main.py` directly as a script. Python then puts `service/` itself on `sys.path`, not the workspace root, so the absolute import `from service.server import serve` in `main.py` probably could not be resolved that way. This is a conclusion from reading the code; no run was observed. The container runs the code as a module (`-m service.main`) with `/app` as the working directory, and that makes the package import resolve.\n\nThere are a few consequences to keep in mind when reviewing:\n\n- The container keeps running after the debug session ends. Nothing stops it.\n- The code in the container is a copy made at build time.\n- debugpy is started without waiting for a client, so the service runs before the debugger attaches.\n- Both ports are published on all host interfaces.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer presses F5",
      "question": "How does the debug configuration get from F5 to a debugger attached to the running service?",
      "purpose": "Follow the chain from the launch configuration through the task, the image build and the container start to the debugger connection.",
      "steps": [
        {
          "title": "The configuration switches from launch to attach",
          "summary": "VS Code no longer starts the program. It runs a task first and then connects to a debugger that is already running.",
          "body": "In the base version, `request: \"launch\"` with `program` made VS Code start `service/main.py` locally under debugpy. In the target version, `request: \"attach\"` means VS Code starts nothing itself. It expects a debugpy server to be listening already.\n\nBefore it connects, VS Code runs the task named in `preLaunchTask`. The name must match a task `label` exactly. The next step shows that task. `connect` then points the debugger at `localhost:5678`, which a later step shows is the container's published debug port.",
          "why": "",
          "details": "The base `program` approach ran `main.py` as a script. That puts `service/` on `sys.path`, so `from service.server import serve` likely failed with a module-not-found error. Starting the service as a module in the container, shown in a later step, avoids this. This is inferred from the code, not observed.",
          "places": [
            {
              "label": "Launch configuration, before and after",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            },
            {
              "label": "Base: local launch of main.py",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"launch\""
            }
          ],
          "together": "The From and To versions of the same configuration show what the switch from launch to attach replaces."
        },
        {
          "title": "The pre-launch task builds and starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "This is the task that `preLaunchTask` names. It does two things:\n\n- `--build` rebuilds the image before every start. Because the source is copied into the image (shown later), this is what makes the latest local code reach the container on each F5.\n- `-d` starts the container in the background, so the command returns once Compose has started the container.\n\n**VS Code treats the task as finished when that command exits, and then attaches straight away.** The task has no problem matcher or readiness check, so nothing waits for debugpy inside the container to be listening. If the Python process has not opened port 5678 yet, the attach can fail with a refused connection. That depends on timing, which the code does not control.",
          "why": "",
          "details": "There is no matching `postDebugTask`, so the container keeps running after the debug session ends. The next F5 runs `up -d --build` again. If the image changed, Compose recreates the container. If it did not, Compose leaves the running container in place.",
          "places": [
            {
              "label": "The task referenced by preLaunchTask",
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
          "summary": "The image is Python 3.12 with debugpy installed and a copy of `service/` under `/app/service`.",
          "body": "`build: .` in `compose.yaml` makes Compose build this `Dockerfile`. The image installs `debugpy`, which the container command in the next step needs. It also copies the local `service` folder to `/app/service`.\n\n`WORKDIR /app` matters for two reasons. It is the directory the command in the next step runs from. It also puts `/app` on the import path when Python runs a module, so `import service.server` resolves.\n\n**The code is copied, not mounted.** Edits made while the container runs do not reach it until the next build, which happens on the next F5.",
          "why": "",
          "details": "Only `service/` is copied. The build context is the whole repository, though, and there is no `.dockerignore`, so Docker sends everything to the builder even though most of it is unused. `service/` has no `__init__.py`. It still imports as a namespace package on Python 3.12.",
          "places": [
            {
              "label": "Image definition",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "build: . in the service definition",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container starts the service under a debugpy listener",
          "summary": "debugpy listens on 5678 and then runs `service.main` as a module, and both ports are published.",
          "body": "The container command wraps the service in debugpy. `--listen 0.0.0.0:5678` opens the debug server on every interface inside the container. Listening on all interfaces is needed because the published port arrives from outside the container's loopback. `-m service.main` then runs the module, which the next step shows.\n\n**There is no `--wait-for-client`.** debugpy starts the service immediately and does not wait for VS Code. Code that runs before the attach completes, such as the import and the call into `serve`, runs without the debugger. Breakpoints there are missed unless the service is restarted while attached.\n\n`ports` publishes 5678 (debugger) and 8080 (the HTTP server) on the host, which is what makes `localhost:5678` in the launch configuration reach this listener.",
          "why": "",
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
          "title": "The service itself, unchanged",
          "summary": "`main()` calls `serve(port=8080)`, and that call blocks in an HTTP server loop.",
          "body": "The `__main__` guard in this unchanged module runs `main()` when debugpy starts the module. `serve` opens a `ThreadingHTTPServer` on `0.0.0.0:8080` and calls `serve_forever()`. The server binds to all interfaces, so the published port 8080 from the previous step can reach it. In practice the process spends its life in this loop, and the debugger attaches to it there.\n\nEach request is handled on its own thread. debugpy can stop at breakpoints in those request threads.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Entry point run by -m service.main",
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
          "summary": "After the task exits, the debugger connects to `localhost:5678` and attaches to the running process.",
          "body": "Back in the launch configuration. Once the task from the second step has exited, VS Code opens a connection to `localhost:5678`. Docker forwards that connection to debugpy in the container, from the fourth step.\n\nThe attach succeeds only if the container is up and debugpy is already listening. As noted in the second step, nothing in the configuration waits for that. The next walk shows how breakpoints then reach the container's files.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Debugger connection target",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }"
            }
          ],
          "revisit": "The first step showed this line as part of the switch to attach. Here it closes the chain: the port it names is the one compose.yaml publishes."
        }
      ]
    },
    {
      "kind": "walk",
      "title": "How a breakpoint in the editor reaches the container",
      "question": "Why does a breakpoint set on a local file stop the code running in the container?",
      "purpose": "Understand the path mapping and which conditions it depends on.",
      "steps": [
        {
          "title": "Image layout that the mapping relies on",
          "summary": "The service code lives at `/app/service` in the container.",
          "body": "When debugpy reports a stack frame, it gives the file path as the container sees it, for example `/app/service/server.py`. That path comes from this `COPY` line. Any mapping on the VS Code side has to match it exactly.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Where the source lands in the image",
              "path": "Dockerfile",
              "side": "target",
              "start": 2,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "pathMappings translate between local and container paths",
          "summary": "The local `service/` folder is mapped to `/app/service`, and `justMyCode` is turned off.",
          "body": "`pathMappings` tells debugpy that a breakpoint in `${workspaceFolder}/service/...` corresponds to `/app/service/...` in the container. Stopped frames are translated back the other way, so the editor opens the local file. **This works only while both sides contain the same code.** Because the container holds a build-time copy, as we saw in the previous step, a local edit made after the last build moves breakpoints onto lines that no longer match.\n\n`justMyCode: false` lets the debugger step into code outside the mapped folder, for example the standard library's `http.server`. Those files exist only in the container. They are not under the mapped folder, so VS Code cannot open them from disk. It typically shows them as source fetched from the debugger.",
          "why": "",
          "details": "",
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
    },
    {
      "kind": "walk",
      "title": "What the container makes reachable on the host",
      "question": "What is reachable on the developer's machine while the container runs?",
      "purpose": "See which ports the change publishes and what each one gives access to.",
      "steps": [
        {
          "title": "Ports published without a host address",
          "summary": "5678 and 8080 are published on all host interfaces.",
          "body": "A short `\"5678:5678\"` mapping with no host IP makes Docker bind the port on every interface of the host, not only on `localhost`.\n\nFor 5678, this matters: **anyone who can reach the machine on that port can attach to debugpy, and an attached debugger can run arbitrary code in the process.** The launch configuration needs only `localhost`, so `\"127.0.0.1:5678:5678\"` would be enough for it. That is a conclusion from the configuration, not something the change states.\n\nThe container also keeps running after the debug session ends, as the first walk showed. The ports stay open until the container is stopped by hand.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Published ports",
              "path": "compose.yaml",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "- \"5678:5678\""
            }
          ]
        },
        {
          "title": "What port 8080 serves",
          "summary": "The unchanged server serves files from its working directory, which is now `/app`.",
          "body": "`SimpleHTTPRequestHandler` serves files from the process's current directory. In the container, that is `/app`, set by `WORKDIR` in the `Dockerfile`, so port 8080 serves the copied `service/` source. This handler is unchanged code, but the change decides which directory it exposes and publishes it on the host.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "HTTP server and handler",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "SimpleHTTPRequestHandler"
            }
          ]
        }
      ]
    }
  ]
}
```