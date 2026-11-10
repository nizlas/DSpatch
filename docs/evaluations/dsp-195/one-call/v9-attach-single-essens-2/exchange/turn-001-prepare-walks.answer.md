```json
{
  "summary": "The VS Code launch configuration now starts the service in Docker and attaches to its `debugpy` listener, mapping container source paths back to the local workspace. The container also publishes the service port so it remains reachable while debugging.",
  "background": "",
  "walks": [
    {
      "kind": "walk",
      "title": "How does VS Code attach to the containerized service?",
      "question": "What starts the service, and how does the debugger connect to it?",
      "purpose": "Follow the launch from VS Code through the container to the Python server and debugger connection.",
      "steps": [
        {
          "title": "Configure the attach",
          "summary": "VS Code runs a pre-launch task, then connects to the debug listener.",
          "body": "This configuration changes the launch from running `main.py` locally to attaching to a process at `localhost:5678`. It names the task VS Code runs first; the next step shows that task. `pathMappings` relates local files under `service` to `/app/service` in the container, so the debugger can associate container paths with workspace files.",
          "why": "The debugger attaches after the task completes; this configuration does not itself start the Python process.",
          "details": "",
          "places": [
            {
              "label": "VS Code debug configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 13,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "Start the Compose service",
          "summary": "The pre-launch task builds and starts the `service` container in the background.",
          "body": "This is the task named by `preLaunchTask` in the previous step. Its command runs `docker compose up -d --build service`; the Compose configuration that command reads is the next step.",
          "why": "The task starts the container, but does not wait for a health check or for the debugger to attach.",
          "details": "",
          "places": [
            {
              "label": "VS Code pre-launch task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "\"command\": \"docker compose up -d --build service\"",
              "from": {
                "label": "preLaunchTask reference",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "Define the container process and ports",
          "summary": "Compose runs `debugpy` around the service module and publishes both listener ports.",
          "body": "The task's command uses this Compose service. Compose builds the image, then starts `python -m debugpy` listening on `0.0.0.0:5678` and runs `service.main` as the application. The port mappings make the debug listener available to the configured localhost connection and expose the service on port 8080. The Dockerfile used for the build is covered next.\n\nBecause the command does not ask `debugpy` to wait for a client, the application can begin running before VS Code attaches; the task completing does not guarantee that startup code is still ahead of the debugger.",
          "why": "Breakpoints in code that runs during startup may be missed if the attach occurs after that code has run.",
          "details": "",
          "places": [
            {
              "label": "Compose service command and port mappings",
              "path": "compose.yaml",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "command: python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Compose command",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Build the image",
          "summary": "The image installs `debugpy` and copies the service source into the path used by Compose.",
          "body": "Compose's `build: .` uses this Dockerfile. It starts from a Python 3.12 slim image, installs the debugger, and copies `service` to `/app/service`, matching the module path and remote source root used elsewhere in this walk.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Container image definition",
              "path": "Dockerfile",
              "side": "target",
              "start": 1,
              "end": 4,
              "anchor": "COPY service /app/service",
              "from": {
                "label": "Compose build setting",
                "path": "compose.yaml",
                "side": "target",
                "start": 3,
                "end": 3
              }
            }
          ]
        },
        {
          "title": "Enter the service module",
          "summary": "`service.main` calls the server with the published application port.",
          "body": "After `debugpy` starts, its `-m service.main` argument selects this module. When run as the main module, `main()` calls `serve(port=8080)`, passing the port mapped by Compose.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Service entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 1,
              "end": 7,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "Module argument",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Serve HTTP requests",
          "summary": "`serve` binds the HTTP server to port 8080 and serves requests until it stops.",
          "body": "`main()` passes 8080 to `serve`. Here, `ThreadingHTTPServer` binds to `0.0.0.0`, allowing traffic forwarded to the container port, and `serve_forever()` keeps the server running. This server implementation is unchanged; the new setup changes how it is launched and debugged.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "HTTP server implementation",
              "path": "service/server.py",
              "side": "target",
              "start": 1,
              "end": 6,
              "anchor": "httpd.serve_forever()",
              "from": {
                "label": "serve call",
                "path": "service/main.py",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        }
      ]
    }
  ]
}
```