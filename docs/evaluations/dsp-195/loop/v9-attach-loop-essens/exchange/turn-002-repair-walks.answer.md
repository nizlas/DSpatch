```json
{
  "summary": "The VS Code launch configuration now starts the service in a Docker container and attaches the debugger to it, instead of launching the Python program directly. The container runs the existing service module under debugpy and exposes the debugger and HTTP ports.",
  "background": "",
  "walks": [
    {
      "kind": "walk",
      "title": "How does VS Code start and attach to the containerized service?",
      "question": "What starts the container, how does the service run inside it, and how does VS Code connect the debugger?",
      "purpose": "Understand the handoff from the VS Code launch configuration to the containerized service and the debugger connection.",
      "steps": [
        {
          "title": "The launch configuration selects attach mode",
          "summary": "VS Code selects a pre-launch task and configures a debugger attach request.",
          "brief": "Establish that this launch configuration requests an attach rather than launching the Python program, and that it names the task VS Code runs first. The reader takes that task label to the next step.",
          "places": [
            {
              "label": "VS Code launch configuration",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "\"preLaunchTask\": \"Start the service container\""
            }
          ]
        },
        {
          "title": "The pre-launch task starts Compose",
          "summary": "The named task runs Docker Compose to build and start the service.",
          "brief": "Explain that VS Code reaches this shell task through the preLaunchTask label, and that its command asks Compose to build and start the service in detached mode. The reader takes the service name and build request to the Compose definition.",
          "places": [
            {
              "label": "VS Code task",
              "path": ".vscode/tasks.json",
              "side": "target",
              "start": 5,
              "end": 7,
              "anchor": "\"command\": \"docker compose up -d --build service\"",
              "from": {
                "label": "Pre-launch task selection",
                "path": ".vscode/launch.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "Compose defines the service container",
          "summary": "Compose builds the service image, specifies its command, and publishes its ports.",
          "brief": "Explain how the task's service name maps to this service definition: Compose builds from the project directory, runs the debugpy command, and publishes ports 5678 and 8080. The build setting leads to the Dockerfile; the command leads to the container's Python process.",
          "places": [
            {
              "label": "Compose service definition",
              "path": "compose.yaml",
              "side": "target",
              "start": 2,
              "end": 7,
              "anchor": "build: .",
              "from": {
                "label": "Compose command",
                "path": ".vscode/tasks.json",
                "side": "target",
                "start": 7,
                "end": 7
              }
            }
          ]
        },
        {
          "title": "The Dockerfile prepares the image",
          "summary": "The image installs debugpy and copies the service source into the container.",
          "brief": "Follow the build setting from the previous step to show what image Compose builds: a Python 3.12 base with debugpy installed and the service copied to /app/service. The reader takes that runtime environment back to the service command.",
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
          "title": "The container starts debugpy and the service module",
          "summary": "The container listens for debugger connections and launches service.main.",
          "brief": "Return to the Compose command after the image is built. Explain that debugpy listens on port 5678 while Python runs service.main; this starts the application path, while the published ports make the listener and HTTP service reachable from the host.",
          "places": [
            {
              "label": "Container command",
              "path": "compose.yaml",
              "side": "target",
              "start": 4,
              "end": 4,
              "anchor": "python -m debugpy --listen 0.0.0.0:5678 -m service.main",
              "from": {
                "label": "Image build and copied service",
                "path": "Dockerfile",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ],
          "revisit": "Now follow the runtime command that uses the image prepared in the earlier step."
        },
        {
          "title": "VS Code connects to the debug listener",
          "summary": "The editor attaches to the published debug port and maps container source paths to workspace files.",
          "brief": "This is the editor-side connection configured by the launch request, not a call from the service: VS Code connects to localhost:5678, which Compose publishes from the debugpy listener, and maps /app/service to the workspace service directory. Note that the pre-launch task uses detached startup and defines no readiness check, so it does not explicitly wait for the listener before the attach request.",
          "places": [
            {
              "label": "Debugger connection and path mappings",
              "path": ".vscode/launch.json",
              "side": "target",
              "start": 5,
              "end": 11,
              "anchor": "\"connect\": { \"host\": \"localhost\", \"port\": 5678 }",
              "from": {
                "label": "Debugpy listener and published port",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 6
              }
            }
          ],
          "revisit": "The earlier step showed why the container exposes the debug port; this step follows the separate editor-side attach configuration."
        },
        {
          "title": "The module enters the service",
          "summary": "Running service.main calls the server entry point on port 8080.",
          "brief": "Follow the module named in the Compose command into its main guard: when run as a module, it calls serve with port 8080. The reader takes that call and port to the server implementation.",
          "places": [
            {
              "label": "Application entry point",
              "path": "service/main.py",
              "side": "target",
              "start": 4,
              "end": 8,
              "anchor": "serve(port=8080)",
              "from": {
                "label": "Module launched in the container",
                "path": "compose.yaml",
                "side": "target",
                "start": 4,
                "end": 4
              }
            }
          ]
        },
        {
          "title": "The server binds and serves requests",
          "summary": "The service creates a threaded HTTP server bound to all container interfaces.",
          "brief": "Explain the implementation reached by main's call: it uses SimpleHTTPRequestHandler, binds ThreadingHTTPServer to 0.0.0.0 on the supplied port, and serves until stopped. Relate port 8080 to the HTTP port published by Compose.",
          "places": [
            {
              "label": "HTTP server implementation",
              "path": "service/server.py",
              "side": "target",
              "start": 4,
              "end": 7,
              "anchor": "httpd.serve_forever()",
              "from": {
                "label": "Call to serve",
                "path": "service/main.py",
                "side": "target",
                "start": 5,
                "end": 5
              }
            }
          ]
        }
      ]
    }
  ]
}
```