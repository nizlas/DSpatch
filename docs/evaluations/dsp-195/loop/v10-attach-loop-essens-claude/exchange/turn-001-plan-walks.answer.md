```json
{
  "summary": "The change moves debugging the service from running it locally under VS Code to running it in a Docker container and attaching to it. Pressing F5 now starts a pre-launch task that builds and starts the `service` container with `docker compose`. Inside the container, debugpy listens on port 5678 and runs `service.main`. VS Code then attaches to localhost:5678 and maps the source paths in the container back to the local `service/` folder. The new files are a Dockerfile (Python 3.12, debugpy, the code copied to `/app/service`), compose.yaml (the debugpy command and the published ports 5678 and 8080) and tasks.json (the pre-launch task). The service code itself does not change.",
  "background": "The old configuration ran `service/main.py` directly as a script (`\"program\"`). The new setup runs it as a module (`-m service.main`) from `/app`. That matches the package-style import `from service.server import serve` in main.py.\n\nThe code is copied into the image with COPY, not mounted. Local edits reach the container only through a rebuild. The task's `--build` does that rebuild on every debug start.\n\nThe review questions are about timing and exposure. The pre-launch task is a plain shell task that ends when `docker compose up -d` returns. debugpy is started without `--wait-for-client`. Port 5678 is published without a host address.",
  "walks": [
    {
      "kind": "walk",
      "title": "What happens when you press F5 to debug the service",
      "question": "How does the debug start now reach a service running in a container, and where can that path fail?",
      "purpose": "Follow the debug start from the launch configuration through the task, the image and the container command to the attach and the source mapping.",
      "steps": [
        {
          "title": "From launching to attaching",
          "summary": "The debug configuration no longer starts the program; it attaches after a pre-launch task.",
          "brief": "This is the entry point: the user picks this configuration and presses F5. Contrast the old `launch` of `service/main.py` in an integrated terminal with the new `request: attach` and `preLaunchTask`: VS Code no longer starts the process, it expects one to be there. The reader should leave knowing that VS Code first runs the task named here, then connects (step 7), and that the task is next.",
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
              "label": "New configuration: attach, with a pre-launch task",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ],
          "together": "The From and To configurations side by side show that responsibility for starting the process moves out of VS Code."
        },
        {
          "title": "The pre-launch task starts the container",
          "summary": "A shell task runs `docker compose up -d --build service`.",
          "brief": "The task is reached by its label, which matches `preLaunchTask` exactly. Explain what the command does: it rebuilds the image (so local edits get in), starts only the `service` service, and with `-d` returns as soon as the container has started. The task has no `isBackground` and no problem matcher, so VS Code treats it as done when the command exits. That is not the same as debugpy listening. The reader carries this timing question to the attach in step 7.",
          "places": [
            {
              "label": "Task that builds and starts the service container",
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
          "title": "The image the service runs in",
          "summary": "The Dockerfile installs debugpy and copies the service code to /app/service.",
          "brief": "Reached because compose's `build: .` builds the Dockerfile in the repository root. The step must explain each line: the Python 3.12 slim base, WORKDIR /app, debugpy installed in the image, and COPY placing the package at `/app/service`. The reader takes two facts forward. `/app` is the working directory, so `service` can be imported as a package (step 4). `/app/service` is the remote root the path mapping depends on (step 8).",
          "places": [
            {
              "label": "Dockerfile",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "compose builds the image from this folder",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "The container command: debugpy wraps the service",
          "summary": "The container runs `python -m debugpy --listen 0.0.0.0:5678 -m service.main`.",
          "brief": "This is what runs once the container started by step 2 exists. Explain that debugpy starts first, opens a debug listener on all container interfaces at 5678, and then runs `service.main` as a module from /app. Note what is missing: there is no `--wait-for-client`, so the service runs immediately without waiting for VS Code. Code that runs early can pass before any breakpoint is set. The next step follows the program debugpy runs.",
          "places": [
            {
              "label": "Service command in compose",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main"
            }
          ]
        },
        {
          "title": "service.main runs as a module",
          "summary": "Unchanged main.py imports the server package and serves on port 8080.",
          "brief": "Reached because debugpy runs `-m service.main`, so `__name__` is `\"__main__\"` and `main()` calls `serve(port=8080)`. Explain why running it as a module from /app makes `from service.server import serve` resolve. The old launch ran main.py as a script, which put `service/` itself on the path. Say this from reading the imports; it was not observed running. The reader moves into `serve`.",
          "places": [
            {
              "label": "Entry module",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 9,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "debugpy runs this module",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "The server listens on all interfaces",
          "summary": "Unchanged serve() binds 0.0.0.0:8080 and serves forever.",
          "brief": "Reached from the call in main.py. The point is that binding 0.0.0.0, not localhost, is what lets the published container port reach the server. `serve_forever` keeps the process, and so the debug session, alive. The next step shows how both ports are published to the host.",
          "places": [
            {
              "label": "serve()",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "ThreadingHTTPServer((\"0.0.0.0\", port), handler)",
              "from": {
                "label": "main() calls serve",
                "path": "service/main.py",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        },
        {
          "title": "Publishing the debug and HTTP ports",
          "summary": "compose publishes 5678 (debugpy) and 8080 (the service) on the host.",
          "brief": "Explain that these mappings connect host ports to the listeners from steps 4 and 6. Without a host address, Docker publishes them on all host interfaces by default. That makes the debugpy port, which allows running arbitrary code, reachable from the network as well as from localhost. The reader takes port 5678 on the host to the attach.",
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
          "title": "VS Code connects to the debug port",
          "summary": "After the task finishes, VS Code attaches to localhost:5678.",
          "brief": "Back in VS Code: once the task from step 2 has exited, the attach connects to the host port published in step 7. Make the timing question explicit. The task ends when compose has started the container, while debugpy may still be starting. From reading the configuration, an attach could therefore come too early. This is an open question, not an observed failure.",
          "places": [
            {
              "label": "Attach target",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 9,
              "end": 9,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }"
            }
          ]
        },
        {
          "title": "Mapping container paths back to the workspace",
          "summary": "pathMappings ties /app/service to the local service folder; justMyCode is off.",
          "brief": "Explain how breakpoints set in local files reach the code in the container: `localRoot` `${workspaceFolder}/service` corresponds to `remoteRoot` `/app/service`, the destination of the Dockerfile COPY from step 3. Note that the mapping holds only while the copied code matches the local files, which the task's `--build` keeps true. Also explain what `justMyCode: false` changes: the debugger also steps into library code, such as http.server.",
          "places": [
            {
              "label": "Path mapping and justMyCode",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 10,
              "end": 13,
              "anchor": "\"remoteRoot\": \"/app/service\""
            },
            {
              "label": "Where the code lands in the image",
              "path": "Dockerfile",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "COPY service /app/service"
            }
          ],
          "together": "The remote root only makes sense next to the COPY destination it must match."
        }
      ]
    }
  ]
}
```