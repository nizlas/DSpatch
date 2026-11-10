```json
{
  "summary": "The VS Code debug setup changes from starting the service locally to attaching to it inside a Docker container. A new `Dockerfile` builds an image with Python 3.12, `debugpy` and the `service` package. A new `compose.yaml` starts that image under `debugpy --listen 0.0.0.0:5678` and publishes the debug port and the service's HTTP port 8080. A new VS Code task runs `docker compose up -d --build service`. The single launch configuration now runs that task first and then attaches to port 5678, mapping local `service/` files onto `/app/service` in the container.",
  "background": "The service code itself (`service/main.py`, `service/server.py`) does not change. The new setup depends on it in two ways: it is started as the module `service.main` from `/app`, and `serve` binds to `0.0.0.0` so the published port 8080 can reach it from the host.\n\nThe old local \"Run the service\" configuration is replaced rather than kept beside the new one. Debugging from VS Code now always needs Docker.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when the developer starts debugging",
      "question": "What runs, in which order, when the developer presses F5 on \"Attach to the service in the container\"?",
      "purpose": "Follow the path from the launch configuration through the task, Compose and the image to the running service and the debugger connection.",
      "steps": [
        {
          "title": "The launch configuration switches from launch to attach",
          "summary": "VS Code no longer starts the service itself; it connects to a debugger that is already running.",
          "body": "With `\"request\": \"launch\"`, VS Code started `service/main.py` locally under debugpy, in the integrated terminal. With `\"request\": \"attach\"`, VS Code starts no process at all. It only connects to a debugpy server at `localhost:5678`.\n\nSomething else must therefore start the service with debugpy listening first. That is the job of `preLaunchTask`, which names a task by its label. The next steps follow that task.\n\nThis is the only configuration in the file, so **the local way to run and debug the service is removed**, not kept as an alternative.",
          "why": "Debugging from VS Code now needs Docker. The service's output also goes to the container log (`docker compose logs service`) instead of VS Code's integrated terminal.",
          "details": "The old configuration ran `service/main.py` as a script, while `main.py` imports `service.server` as a package. Run that way, Python puts `service/` on `sys.path`, not the workspace root. So the old setup worked only if the root was on the path some other way. The new setup avoids this question by running `-m service.main` from `/app` (see the Compose step).",
          "places": [
            {
              "label": "Launch configuration, before and after",
              "path": ".vscode/launch.json",
              "side": "base",
              "start": 5,
              "end": 9,
              "anchor": "\"request\": \"launch\""
            },
            {
              "label": "Launch configuration, before and after",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 9,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ]
        },
        {
          "title": "The task builds and starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "body": "VS Code finds this task through the label that `preLaunchTask` names.\n\n- `--build` rebuilds the image on every debug start. Because the source is copied into the image (see the Dockerfile step), this is how local edits reach the container.\n- `-d` runs the container in the background, so the command returns and VS Code goes on to attach.\n\nThe task has no `problemMatcher` and no background or readiness pattern. VS Code therefore treats it as done when the shell command exits. **`up -d` exits once the container has started, not once debugpy is listening inside it.** The code allows the attach to come before port 5678 accepts connections; whether it does depends on timing.",
          "why": "If the attach comes too early, the debug session can fail to connect, and the developer has to start it again.",
          "places": [
            {
              "label": "The pre-launch task",
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
          "title": "The image: Python, debugpy and the service source",
          "summary": "Compose's `build: .` builds this Dockerfile.",
          "body": "The image sets up three things the later steps depend on:\n\n- `debugpy` is installed, so the container can run `python -m debugpy`.\n- `WORKDIR /app` becomes the working directory, so `/app` is where Python looks for the `service` package.\n- The `service` folder is **copied** to `/app/service`. This is the remote path the debugger mapping uses later.\n\nThe Dockerfile has no `CMD` of its own. The start command comes from `compose.yaml`, so this image runs the service only when it is started through Compose.",
          "details": "`service/` has no `__init__.py`. `-m service.main` still works because Python 3.3+ treats such a folder as a namespace package.\n\nNo volume is mounted, so the container runs the code that was copied at build time. Edits made while the container runs reach it only after a rebuild, that is, at the next debug start.",
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
          "title": "Compose starts the service under debugpy and publishes the ports",
          "summary": "debugpy listens on 5678, runs `service.main`, and both ports are published to the host.",
          "body": "`python -m debugpy --listen 0.0.0.0:5678 -m service.main` starts a debug server and then runs the service module straight away. There is no `--wait-for-client`, so **the service does not wait for VS Code**. Breakpoints in code that runs before the attach completes, such as startup, are not hit.\n\nThe ports mapping makes the container reachable from the host:\n\n- `5678` lets VS Code reach `localhost:5678`. Inside the container debugpy must listen on `0.0.0.0`; on `127.0.0.1` it could not be reached through the port mapping.\n- `8080` is the service's HTTP port.\n\nA port written as `\"5678:5678\"` is published on all host interfaces, not only on localhost. A debugpy connection can run arbitrary code in the process, so **anyone who can reach this host's port 5678 can control the service**.",
          "why": "Debugging the service from startup needs `--wait-for-client`. To keep the debug port local, it would need to be published as `127.0.0.1:5678:5678`.",
          "places": [
            {
              "label": "The service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "--listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "compose up … service",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "The unchanged service runs and binds to all interfaces",
          "summary": "`main` calls `serve(port=8080)`, which listens on `0.0.0.0`.",
          "body": "This code is unchanged. Two of its existing choices are what make the container setup work:\n\n- `main.py` runs `main()` under `if __name__ == \"__main__\"`. That block also runs when the module is started with `-m service.main`, as Compose does.\n- `serve` binds `ThreadingHTTPServer` to `0.0.0.0:8080`. Inside a container, a server bound to `127.0.0.1` could not be reached through the published port 8080.\n\n`serve_forever()` blocks, so the process and the container keep running until they are stopped.",
          "places": [
            {
              "label": "serve binds to 0.0.0.0",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer((\"0.0.0.0\", port), handler)",
              "from": {
                "label": "main calls serve(port=8080)",
                "path": "service/main.py",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "VS Code attaches, and nothing stops the container afterwards",
          "summary": "When the task finishes, VS Code connects to `localhost:5678`.",
          "body": "When the task has finished, the walk is back in the launch configuration. VS Code connects to `localhost:5678`, which reaches debugpy in the container through the published port. The next walk covers how breakpoints are matched across this connection (`pathMappings`).\n\nThe configuration has no `postDebugTask`. **Ending the debug session only disconnects VS Code. The container keeps running** and keeps holding ports 5678 and 8080 until someone runs `docker compose down` or `stop`. The next debug start runs `up -d --build` again, and Compose recreates the container if the image changed.",
          "revisit": "Now the attach target itself: where VS Code connects once the task is done, and what is left running after the session ends.",
          "places": [
            {
              "label": "Connection target",
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
      "title": "How breakpoints in local files reach the code in the container",
      "question": "How does a breakpoint set in the local editor match the code that runs in the container?",
      "purpose": "Understand why `pathMappings` must match the Dockerfile's `COPY`, and what `justMyCode: false` changes.",
      "steps": [
        {
          "title": "The image puts the source at /app/service",
          "summary": "The copied code runs from `/app/service/...` inside the container.",
          "body": "Inside the container, Python knows the service files only by their container paths, for example `/app/service/server.py`. debugpy reports and matches breakpoints by these paths. A path on the developer's machine means nothing to it unless something translates between the two.",
          "places": [
            {
              "label": "Where the source lands",
              "path": "Dockerfile",
              "side": "target",
              "start": 2,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ]
        },
        {
          "title": "pathMappings translates between local and container paths",
          "summary": "Local `service/` maps to `/app/service`, and debugging steps into library code too.",
          "body": "`pathMappings` tells VS Code that `${workspaceFolder}/service` on the developer's machine is `/app/service` in the container. Breakpoints set locally are sent with the container path, and stack frames from the container open the local file.\n\n**This works only while the mapping stays in step with the Dockerfile's `COPY` target.** If either one changes alone, breakpoints silently stop binding.\n\nThe mapping also assumes the local files equal the copied files. The task rebuilds the image on every debug start, so that holds at the start of a session. If a file is edited during a session, the editor and the running code no longer match until the next start.\n\n`justMyCode: false` lets the debugger stop in and step into library code, such as `http.server`, not only the service's own files. Those library files exist only inside the container. They are not covered by the mapping, so VS Code has no local copy of them to open.",
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