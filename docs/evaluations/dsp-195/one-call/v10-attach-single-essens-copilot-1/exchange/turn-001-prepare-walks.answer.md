```json
{
  "summary": "The VS Code workflow now builds and starts the service in Docker, then attaches the debugger to it. This replaces launching the Python service directly on the host.",
  "background": "",
  "walks": [
    {
      "kind": "walk",
      "title": "How does VS Code attach to the service in Docker?",
      "question": "What starts the container, and how does the debugger reach the service code?",
      "purpose": "Follow the VS Code launch configuration through the container build and startup to the debugger and HTTP service.",
      "steps": [
        {
          "title": "Choose attach mode",
          "summary": "VS Code runs a startup task before attaching to the debug listener.",
          "body": "This configuration no longer launches `main.py` on the host. It asks VS Code to run **Start the service container** first, then connect to `localhost:5678`. The path mapping relates the container's `/app/service` files to the workspace's `service` directory, so the attached debugger can associate remote code with local files.",
          "why": "",
          "details": "The configuration also sets `justMyCode` to `false`, allowing debugging to include code outside the user's files.",
          "places": [
            {
              "label": "VS Code debug configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 12,
              "anchor": "\"request\": \"attach\""
            }
          ]
        },
        {
          "title": "Start the container task",
          "summary": "The pre-launch task asks Docker Compose to build and start the service.",
          "body": "Because the launch configuration names this task, VS Code runs its shell command before attempting the debugger connection. The command starts the `service` and requests a build; the Compose configuration that defines those actions is the next step.",
          "why": "The task starts Compose in detached mode, but its completion does not establish that the debug listener is ready to accept a connection.",
          "details": "",
          "places": [
            {
              "label": "Container startup task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 3,
              "end": 8,
              "anchor": "\"command\": \"docker compose up -d --build service\"",
              "from": {
                "label": "Pre-launch task reference",
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
          "summary": "Compose builds the service image, runs it under debugpy, and publishes both ports.",
          "body": "The task's command selects this Compose service. Its build uses the repository's Dockerfile, and its command runs `service.main` under debugpy, listening on port `5678` on all container interfaces. Publishing `5678` makes the listener reachable at the host address used in the launch configuration; publishing `8080` exposes the HTTP service.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 2,
              "end": 7,
              "anchor": "command: python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Compose startup command",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 8,
                "end": 8
              }
            }
          ]
        },
        {
          "title": "Build the Python image",
          "summary": "The image supplies Python, debugpy, and the service source.",
          "body": "Compose's `build: .` uses this Dockerfile. It sets `/app` as the working directory, installs debugpy, and copies the service package there. That working directory lets the container command run `service.main` as a module.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "Image build instructions",
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
          "title": "Enter the service",
          "summary": "The container command reaches `main`, which starts the HTTP server.",
          "body": "Compose runs `service.main` as a module in the container. Its entry point calls `serve` on port `8080`; the server implementation in the next step shows how that port is used.",
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
                "label": "Module command",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "Bind the HTTP server",
          "summary": "The server listens on all container interfaces at the published HTTP port.",
          "body": "`serve` creates a `ThreadingHTTPServer` bound to `0.0.0.0` and the port supplied by `main`, then serves requests continuously. This is the process behind Compose's published `8080` port.",
          "why": "",
          "details": "",
          "places": [
            {
              "label": "HTTP server implementation",
              "path": "service/server.py",
              "side": "target",
              "start": 3,
              "end": 6,
              "anchor": "http.server.ThreadingHTTPServer((\"0.0.0.0\", port), handler)",
              "from": {
                "label": "Call to serve",
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